use std::{
    fs,
    io::{BufRead, BufReader, Write},
    path::{Path, PathBuf},
    process::{Child, ChildStdin, Command, Stdio},
    sync::{Arc, Mutex},
};

use serde_json::Value;
use tauri::{AppHandle, Emitter};

use super::{
    diagnostics::ExtensionLogger,
    manager::PendingRpc,
    manifest::{ExtensionManifest, ExtensionRuntime},
};

/// A live extension child process plus its (lazily started) stdin/stdout.
pub struct RunningExtension {
    child: Arc<Mutex<Child>>,
    stdin: Arc<Mutex<ChildStdin>>,
}

impl RunningExtension {
    /// Write one JSON-RPC message followed by a newline to the child's stdin.
    pub fn send_json(&self, message: &Value) -> Result<(), String> {
        let serialized = serde_json::to_string(message)
            .map_err(|error| format!("Failed to serialize JSON-RPC message: {error}"))?;

        let mut stdin = self
            .stdin
            .lock()
            .map_err(|_| "Extension stdin lock is poisoned".to_string())?;

        stdin
            .write_all(serialized.as_bytes())
            .map_err(|error| format!("Failed to write to extension stdin: {error}"))?;

        stdin
            .write_all(b"\n")
            .map_err(|error| format!("Failed to write newline to extension stdin: {error}"))?;

        stdin
            .flush()
            .map_err(|error| format!("Failed to flush extension stdin: {error}"))?;

        Ok(())
    }

    /// Terminate the process if it is still alive.
    pub fn stop(&self) -> Result<(), String> {
        let mut child = self
            .child
            .lock()
            .map_err(|_| "Extension process lock is poisoned".to_string())?;

        match child.try_wait() {
            Ok(Some(_)) => Ok(()), // already exited
            Ok(None) => child
                .kill()
                .map_err(|error| format!("Failed to stop extension process: {error}")),
            Err(error) => Err(format!("Failed to inspect extension process: {error}")),
        }
    }

    pub fn is_running(&self) -> bool {
        let Ok(mut child) = self.child.lock() else {
            return false;
        };

        matches!(child.try_wait(), Ok(None))
    }
}

fn verify_entry_path(root_path: &Path, entry: &str) -> Result<PathBuf, String> {
    if entry.trim().is_empty() {
        return Err("Extension entry is empty".to_string());
    }

    let canonical_root = fs::canonicalize(root_path)
        .map_err(|error| format!("Invalid extension root path: {error}"))?;

    let requested_entry = root_path.join(entry);

    let canonical_entry = fs::canonicalize(&requested_entry).map_err(|error| {
        format!(
            "Extension entry does not exist: {}: {error}",
            requested_entry.display()
        )
    })?;

    if !canonical_entry.starts_with(&canonical_root) {
        return Err("Extension entry is outside the extension directory".to_string());
    }

    if !canonical_entry.is_file() {
        return Err("Extension entry is not a file".to_string());
    }

    Ok(canonical_entry)
}

fn build_command(root_path: &Path, manifest: &ExtensionManifest) -> Result<Command, String> {
    let entry_path = verify_entry_path(root_path, &manifest.entry)?;

    let mut command = match manifest.runtime {
        ExtensionRuntime::Node => {
            let mut command = Command::new("node");
            command.arg(&entry_path);
            command
        }

        ExtensionRuntime::Python => {
            #[cfg(target_os = "windows")]
            let mut command = {
                let mut command = Command::new("python");
                command.arg("-u");
                command
            };

            #[cfg(not(target_os = "windows"))]
            let mut command = {
                let mut command = Command::new("python3");
                command.arg("-u");
                command
            };

            command.arg(&entry_path);
            command
        }
    };

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;

        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    command
        .current_dir(root_path)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .env("MOCU_EXTENSION_ID", &manifest.id)
        .env("MOCU_EXTENSION_ROOT", root_path);

    Ok(command)
}

/// Start the extension process and wire its stdout back into the manager's
/// synchronous request/response bus (`PendingRpc`).
///
/// Host-bound requests from the extension (e.g. `mocu.llm.generate`) are
/// forwarded to the frontend as `extension://message` events so the frontend
/// can resolve them (run the LLM) and reply through `extension_respond`.
pub fn spawn_extension(
    app_handle: AppHandle,
    root_path: PathBuf,
    manifest: ExtensionManifest,
    rpc: Arc<PendingRpc>,
    logger: ExtensionLogger,
) -> Result<RunningExtension, String> {
    let mut command = build_command(&root_path, &manifest)?;

    let mut child = command
        .spawn()
        .map_err(|error| format!("Failed to start extension '{}': {error}", manifest.id))?;

    let stdin = child
        .stdin
        .take()
        .ok_or_else(|| "Could not access extension stdin".to_string())?;

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Could not access extension stdout".to_string())?;

    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "Could not access extension stderr".to_string())?;

    // stdout: responses resolve pending manager requests; requests from the
    // extension (`method` present) are forwarded to the frontend as events.
    let stdout_rpc = rpc.clone();
    let id_for_stdout = manifest.id.clone();
    let stdout_app_handle = app_handle.clone();
    let stdout_logger = logger.clone();
    std::thread::spawn(move || {
        let reader = BufReader::new(stdout);

        for line in reader.lines() {
            let Ok(line) = line else { break };

            let trimmed = line.trim();
            if trimmed.is_empty() {
                continue;
            }

            let Ok(message) = serde_json::from_str::<Value>(trimmed) else {
                // Keep stdout reserved for JSON-RPC; record non-protocol output
                // because it is a common cause of extension communication bugs.
                stdout_logger.log(
                    "warning",
                    "non_json_stdout",
                    serde_json::json!({ "line": preview(trimmed) }),
                );
                continue;
            };

            // A request/notification initiated by the extension toward the host.
            if message.get("method").is_some() {
                let _ = stdout_app_handle.emit(
                    "extension://message",
                    serde_json::json!({
                        "extensionId": id_for_stdout,
                        "message": message,
                    }),
                );
                continue;
            }

            // Otherwise it is a response to one of the manager's own requests.
            resolve_response(&stdout_rpc, &message);
        }

        stdout_logger.log("info", "stdout_closed", serde_json::json!({}));
    });

    // stderr is developer output; persist bounded lines for post-mortem troubleshooting.
    let id_for_stderr = manifest.id;
    let stderr_logger = logger;
    std::thread::spawn(move || {
        let reader = BufReader::new(stderr);

        for line in reader.lines() {
            let Ok(line) = line else { break };

            if !line.trim().is_empty() {
                let line = line.trim_end();
                eprintln!("[extension:{}] {}", id_for_stderr, line);
                stderr_logger.log(
                    "warning",
                    "stderr",
                    serde_json::json!({ "line": preview(line) }),
                );
            }
        }

        stderr_logger.log("info", "stderr_closed", serde_json::json!({}));
    });
    Ok(RunningExtension {
        child: Arc::new(Mutex::new(child)),
        stdin: Arc::new(Mutex::new(stdin)),
    })
}

/// Keep diagnostic text bounded and redact common secret assignments before persistence.
fn preview(line: &str) -> String {
    let mut sanitized = line.chars().take(4096).collect::<String>();
    let lower = sanitized.to_lowercase();
    for marker in [
        "api_key",
        "apikey",
        "api-key",
        "token",
        "password",
        "secret",
        "authorization",
    ] {
        let mut search_from = 0;
        while let Some(relative) = lower[search_from..].find(marker) {
            let start = search_from + relative;
            let after_marker = start + marker.len();
            let tail = &sanitized[after_marker..];
            let Some(delimiter_offset) = tail.find(['=', ':']) else {
                search_from = after_marker;
                continue;
            };
            let value_start = after_marker + delimiter_offset + 1;
            let value_end = sanitized[value_start..]
                .find(|character: char| {
                    character.is_whitespace() || character == ',' || character == ';'
                })
                .map(|offset| value_start + offset)
                .unwrap_or(sanitized.len());
            sanitized.replace_range(value_start..value_end, "[REDACTED]");
            search_from = value_start + "[REDACTED]".len();
        }
    }
    sanitized
}

/// If `message` is a JSON-RPC response (`id` + `result`/`error`), hand it to
/// the matching pending request in the manager.
fn resolve_response(rpc: &PendingRpc, message: &Value) {
    let has_result = message.get("result").is_some();
    let has_error = message.get("error").is_some();

    if !has_result && !has_error {
        return;
    }

    let Some(id) = message.get("id").and_then(Value::as_str) else {
        return;
    };

    rpc.resolve(id, message.clone());
}
