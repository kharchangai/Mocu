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
    manifest::{ExtensionManifest, ExtensionRuntime},
    protocol::{ExtensionLogEvent, ExtensionOutputEvent},
};

pub struct RunningExtension {
    pub id: String,
    pub root_path: PathBuf,
    pub manifest: ExtensionManifest,
    pub child: Arc<Mutex<Child>>,
    pub stdin: Arc<Mutex<ChildStdin>>,
}

impl RunningExtension {
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

    pub fn stop(&self) -> Result<(), String> {
        let mut child = self
            .child
            .lock()
            .map_err(|_| "Extension process lock is poisoned".to_string())?;

        match child.try_wait() {
            Ok(Some(_)) => Ok(()),
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

fn build_command(
    root_path: &Path,
    manifest: &ExtensionManifest,
) -> Result<Command, String> {
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

    command
        .current_dir(root_path)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .env("MOCU_EXTENSION_ID", &manifest.id)
        .env("MOCU_EXTENSION_ROOT", root_path);

    Ok(command)
}

pub fn spawn_extension(
    app_handle: AppHandle,
    root_path: PathBuf,
    manifest: ExtensionManifest,
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

    let extension_id_for_stdout = manifest.id.clone();
    let stdout_app_handle = app_handle.clone();

    std::thread::spawn(move || {
        let reader = BufReader::new(stdout);

        for line_result in reader.lines() {
            match line_result {
                Ok(line) => {
                    if line.trim().is_empty() {
                        continue;
                    }

                    match serde_json::from_str::<Value>(&line) {
                        Ok(message) => {
                            let event = ExtensionOutputEvent {
                                extension_id: extension_id_for_stdout.clone(),
                                message,
                            };

                            let _ = stdout_app_handle.emit("extension://message", event);
                        }

                        Err(error) => {
                            let event = ExtensionLogEvent {
                                extension_id: extension_id_for_stdout.clone(),
                                level: "error".to_string(),
                                message: format!(
                                    "Invalid JSON received from extension stdout: {error}. Output: {line}"
                                ),
                            };

                            let _ = stdout_app_handle.emit("extension://log", event);
                        }
                    }
                }

                Err(error) => {
                    let event = ExtensionLogEvent {
                        extension_id: extension_id_for_stdout.clone(),
                        level: "error".to_string(),
                        message: format!("Failed to read extension stdout: {error}"),
                    };

                    let _ = stdout_app_handle.emit("extension://log", event);
                    break;
                }
            }
        }

        let _ = stdout_app_handle.emit(
            "extension://exit",
            serde_json::json!({
                "extensionId": extension_id_for_stdout
            }),
        );
    });

    let extension_id_for_stderr = manifest.id.clone();
    let stderr_app_handle = app_handle;

    std::thread::spawn(move || {
        let reader = BufReader::new(stderr);

        for line_result in reader.lines() {
            match line_result {
                Ok(line) => {
                    if line.trim().is_empty() {
                        continue;
                    }

                    let event = ExtensionLogEvent {
                        extension_id: extension_id_for_stderr.clone(),
                        level: "error".to_string(),
                        message: line,
                    };

                    let _ = stderr_app_handle.emit("extension://log", event);
                }

                Err(error) => {
                    let event = ExtensionLogEvent {
                        extension_id: extension_id_for_stderr.clone(),
                        level: "error".to_string(),
                        message: format!("Failed to read extension stderr: {error}"),
                    };

                    let _ = stderr_app_handle.emit("extension://log", event);
                    break;
                }
            }
        }
    });

    Ok(RunningExtension {
        id: manifest.id.clone(),
        root_path,
        manifest,
        child: Arc::new(Mutex::new(child)),
        stdin: Arc::new(Mutex::new(stdin)),
    })
}