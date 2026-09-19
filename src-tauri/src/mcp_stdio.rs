//! MCP stdio process host.
//!
//! Mocu's WebView cannot spawn processes, so the trusted Rust backend owns
//! the lifecycle of local MCP server processes (stdio transport). The
//! frontend speaks the MCP protocol itself using the official TypeScript
//! SDK; this module only pipes raw stdin/stdout lines between the SDK's
//! transport and the spawned server process.
//!
//! Design rules enforced here:
//! - Structured `command + args` execution, never a shell string. Windows
//!   `.cmd`/`.bat` wrappers (e.g. `npx.cmd`) are resolved explicitly and
//!   launched through `cmd /c`, which is the safe pattern for Rust std.
//! - Child processes inherit only a minimal safe environment (PATH, system
//!   locations, ...). Unrelated application credentials are never forwarded;
//!   user-configured MCP env vars are applied on top.
//! - stdout is reserved for MCP messages (one JSON-RPC message per line,
//!   emitted as `mcp://stdio-out` events filtered by connection id).
//! - stderr is captured in a bounded per-process buffer and mirrored as
//!   `mcp://stdio-stderr` events; the frontend applies secret redaction
//!   before displaying diagnostics.
//! - Processes are tracked by a caller-provided connection id and can always
//!   be killed (`mcp_stdio_stop`), including during app exit
//!   (`stop_all`), so no orphan MCP server processes survive Mocu.

use std::{
    collections::HashMap,
    io::Write,
    path::{Path, PathBuf},
    process::{Child, ChildStdin, Command, Stdio},
    sync::{Arc, Mutex, MutexGuard},
};

use serde::Deserialize;
use serde_json::json;
use tauri::{AppHandle, Emitter, State};

const MAX_STDERR_LINES: usize = 200;
const MAX_STDERR_LINE_LENGTH: usize = 4_000;

/// Environment variables a spawned MCP server may inherit from Mocu.
/// Everything else is stripped so unrelated application credentials are
/// never forwarded into third-party child processes.
const SAFE_INHERITED_ENV_VARS: &[&str] = &[
    // System locations
    "PATH", "PATHEXT", "SYSTEMROOT", "SYSTEMDRIVE", "COMSPEC", "WINDIR",
    "PROGRAMFILES", "PROGRAMFILES(X86)", "PROGRAMDATA", "PROGRAMW6432",
    "COMMONPROGRAMFILES", "COMMONPROGRAMFILES(X86)",
    // User locations
    "HOME", "USERPROFILE", "HOMEDRIVE", "HOMEPATH", "APPDATA", "LOCALAPPDATA",
    "TMP", "TEMP", "XDG_CONFIG_HOME", "XDG_CACHE_HOME", "XDG_DATA_HOME",
    // Locale / runtime hints
    "LANG", "LC_ALL", "TZ", "TERM", "NUMBER_OF_PROCESSORS", "OS", "PROCESSOR_ARCHITECTURE",
    "USERNAME", "COMPUTERNAME", "NODE_OPTIONS", "NO_COLOR", "FORCE_COLOR",
];

/// Environment variables that must never be inherited even if present.
const BLOCKED_ENV_VARS: &[&str] = &["MOCU_API_KEY"];

/// One live MCP server child process plus its stdin writer.
#[derive(Clone)]
struct RunningStdioProcess {
    child: Arc<Mutex<Child>>,
    stdin: Arc<Mutex<Option<ChildStdin>>>,
    stderr: Arc<Mutex<Vec<String>>>,
}

/// Shared process registry. Clones of the host (used to move it into
/// background tasks) must observe the same live processes, so the map is
/// behind an Arc; a deep copy would silently detach spawned processes from
/// send/stop lookups.
#[derive(Clone, Default)]
pub struct McpStdioHost {
    processes: Arc<Mutex<HashMap<String, RunningStdioProcess>>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpStdioStartInput {
    /// Stable connection id (the Mocu MCP server id). Used to route events
    /// and to address the process for send/stop.
    pub id: String,
    pub command: String,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub cwd: Option<String>,
    /// User-configured environment applied on top of the safe inherited set.
    #[serde(default)]
    pub env: HashMap<String, String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpStdioSendInput {
    pub id: String,
    /// One serialized JSON-RPC message (a single line, no embedded newline).
    pub message: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpStdioIdInput {
    pub id: String,
}

/// Start an MCP server process and wire its stdout/stderr into Tauri events.
#[tauri::command]
pub async fn mcp_stdio_start(
    app_handle: AppHandle,
    host: State<'_, McpStdioHost>,
    input: McpStdioStartInput,
) -> Result<(), String> {
    let host = host.inner().clone();
    let app = app_handle.clone();

    tauri::async_runtime::spawn_blocking(move || host.start(&app, input))
        .await
        .map_err(|error| format!("MCP stdio start task failed: {error}"))?
}

/// Write one JSON-RPC message line to the MCP server's stdin.
#[tauri::command]
pub fn mcp_stdio_send(
    host: State<'_, McpStdioHost>,
    input: McpStdioSendInput,
) -> Result<(), String> {
    if input.message.contains('\n') || input.message.contains('\r') {
        return Err("MCP stdio messages must be a single line".to_string());
    }

    let process = host.lock_processes()?.get(&input.id).cloned().ok_or_else(|| {
        format!("MCP stdio process '{}' is not running", input.id)
    })?;

    let stdin = process.stdin.clone();
    let mut writer = stdin
        .lock()
        .map_err(|_| "MCP stdio stdin lock is poisoned".to_string())?;

    if let Some(stdin) = writer.as_mut() {
        stdin
            .write_all(input.message.as_bytes())
            .and_then(|_| stdin.write_all(b"\n"))
            .and_then(|_| stdin.flush())
            .map_err(|error| format!("Failed to write to MCP server stdin: {error}"))
    } else {
        Err(format!("MCP stdio process '{}' stdin is closed", input.id))
    }
}

/// Return the bounded stderr diagnostics captured so far for a process.
#[tauri::command]
pub fn mcp_stdio_stderr(
    host: State<'_, McpStdioHost>,
    input: McpStdioIdInput,
) -> Result<Vec<String>, String> {
    let process = host.lock_processes()?.get(&input.id).cloned().ok_or_else(|| {
        format!("MCP stdio process '{}' is not running", input.id)
    })?;

    let stderr = process
        .stderr
        .lock()
        .map_err(|_| "MCP stdio stderr lock is poisoned".to_string())?;

    Ok(stderr.clone())
}

/// Kill one MCP server process.
#[tauri::command]
pub fn mcp_stdio_stop(
    host: State<'_, McpStdioHost>,
    input: McpStdioIdInput,
) -> Result<bool, String> {
    host.stop(&input.id)
}

impl McpStdioHost {
    pub fn start(
        &self,
        app_handle: &AppHandle,
        input: McpStdioStartInput,
    ) -> Result<(), String> {
        let id = input.id.trim().to_string();
        if id.is_empty() {
            return Err("MCP stdio connection id cannot be empty".to_string());
        }
        if input.command.trim().is_empty() {
            return Err("MCP stdio command cannot be empty".to_string());
        }

        // Refuse duplicate connection ids so events are never ambiguous.
        {
            let processes = self.lock_processes()?;
            if let Some(existing) = processes.get(&id) {
                if existing.is_running() {
                    return Err(format!(
                        "MCP stdio process '{id}' is already running"
                    ));
                }
            }
        }

        let mut command = build_command(&input)?;

        let mut child = command
            .spawn()
            .map_err(|error| format!("Failed to start MCP server '{id}': {error}"))?;

        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| "Could not access MCP server stdin".to_string())?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| "Could not access MCP server stdout".to_string())?;
        let stderr = child
            .stderr
            .take()
            .ok_or_else(|| "Could not access MCP server stderr".to_string())?;

        let child = Arc::new(Mutex::new(child));
        let stdin = Arc::new(Mutex::new(Some(stdin)));
        let stderr_buffer = Arc::new(Mutex::new(Vec::<String>::new()));

        // stdout: every line is one MCP message for the SDK transport.
        let out_app = app_handle.clone();
        let out_id = id.clone();
        let out_child = child.clone();
        let out_stdin = stdin.clone();
        std::thread::spawn(move || {
            use std::io::BufRead;

            let reader = std::io::BufReader::new(stdout);
            for line in reader.lines() {
                let Ok(line) = line else { break };
                let _ = out_app.emit("mcp://stdio-out", json!({ "id": out_id, "line": line }));
            }

            // stdout EOF: the server closed its side. Stop the process if it
            // is still alive, notify the transport, and release stdin.
            if let Ok(mut child) = out_child.lock() {
                let _ = child.kill();
                let _ = child.wait();
            }
            if let Ok(mut writer) = out_stdin.lock() {
                *writer = None;
            }
            let _ = out_app.emit(
                "mcp://stdio-exit",
                json!({ "id": out_id }),
            );
        });

        // stderr: bounded diagnostics buffer + event mirror. Secret redaction
        // is applied by the frontend, which knows the configured secrets.
        let err_app = app_handle.clone();
        let err_id = id.clone();
        let err_buffer = stderr_buffer.clone();
        std::thread::spawn(move || {
            use std::io::BufRead;

            let reader = std::io::BufReader::new(stderr);
            for line in reader.lines() {
                let Ok(line) = line else { break };
                let truncated: String = line.chars().take(MAX_STDERR_LINE_LENGTH).collect();

                if let Ok(mut buffer) = err_buffer.lock() {
                    buffer.push(truncated.clone());
                    while buffer.len() > MAX_STDERR_LINES {
                        buffer.remove(0);
                    }
                }

                let _ = err_app.emit(
                    "mcp://stdio-stderr",
                    json!({ "id": err_id, "line": truncated }),
                );
            }
        });

        let mut processes = self.lock_processes()?;
        processes.insert(
            id,
            RunningStdioProcess {
                child,
                stdin,
                stderr: stderr_buffer,
            },
        );

        Ok(())
    }

    pub fn stop(&self, id: &str) -> Result<bool, String> {
        let mut processes = self.lock_processes()?;

        match processes.remove(id) {
            Some(process) => {
                process.kill();
                Ok(true)
            }
            None => Ok(false),
        }
    }

    /// Stop every running MCP server process. Called on app shutdown.
    pub fn stop_all(&self) {
        let Ok(mut processes) = self.processes.lock() else {
            return;
        };

        for (_, process) in processes.drain() {
            process.kill();
        }
    }

    fn lock_processes(
        &self,
    ) -> Result<MutexGuard<'_, HashMap<String, RunningStdioProcess>>, String> {
        self.processes
            .lock()
            .map_err(|_| "MCP stdio process lock is poisoned".to_string())
    }
}

impl RunningStdioProcess {
    fn kill(&self) {
        if let Ok(mut child) = self.child.lock() {
            match child.try_wait() {
                Ok(Some(_)) => {}
                Ok(None) => {
                    let _ = child.kill();
                    let _ = child.wait();
                }
                Err(_) => {}
            }
        }
    }

    fn is_running(&self) -> bool {
        match self.child.lock() {
            Ok(mut child) => matches!(child.try_wait(), Ok(None)),
            Err(_) => false,
        }
    }
}

fn build_command(input: &McpStdioStartInput) -> Result<Command, String> {
    let resolved = resolve_executable(&input.command)?;

    let mut command = match resolved {
        ResolvedExecutable::Direct(program) => {
            let mut command = Command::new(&program);
            command.args(&input.args);
            command
        }
        ResolvedExecutable::WindowsBatch(program) => {
            // .cmd/.bat shims (npx, uvx wrappers, ...) must go through cmd.
            // Arguments are passed as a structured list, never interpolated.
            let mut command = Command::new("cmd");
            command.arg("/c").arg(&program).args(&input.args);
            command
        }
    };

    if let Some(cwd) = input.cwd.as_deref() {
        let cwd_path = PathBuf::from(cwd);
        if !cwd_path.is_dir() {
            return Err(format!(
                "MCP server cwd does not exist or is not a directory: {cwd}"
            ));
        }
        command.current_dir(cwd_path);
    }

    command
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    // Minimal inherited environment + user-configured overrides.
    let inherited: HashMap<String, String> = std::env::vars()
        .filter(|(key, _)| {
            let upper = key.to_uppercase();
            SAFE_INHERITED_ENV_VARS.contains(&upper.as_str())
                && !BLOCKED_ENV_VARS.contains(&upper.as_str())
        })
        .collect();

    command.env_clear();
    for (key, value) in inherited {
        command.env(&key, &value);
    }
    for (key, value) in &input.env {
        if key.trim().is_empty() {
            return Err("MCP server environment keys cannot be empty".to_string());
        }
        command.env(key, value);
    }

    Ok(command)
}

enum ResolvedExecutable {
    Direct(PathBuf),
    WindowsBatch(PathBuf),
}

/// Resolve `command` against PATH. Handles Windows executable wrappers:
/// `npx` must resolve to `npx.cmd` and run through `cmd /c`, plain `.exe`
/// files run directly. Commands containing a path separator are used as-is.
fn resolve_executable(command: &str) -> Result<ResolvedExecutable, String> {
    let candidate = Path::new(command);

    if candidate.parent().map(|p| !p.as_os_str().is_empty()).unwrap_or(false) {
        // Explicit path: require existence, no PATH search.
        if !candidate.is_file() {
            return Err(format!(
                "MCP server executable does not exist: {command}"
            ));
        }
        return classify(candidate.to_path_buf());
    }

    let path_variable =
        std::env::var_os("PATH")
            .ok_or_else(|| "PATH environment variable is unavailable".to_string())?;

    let extensions: Vec<String> = if cfg!(windows) {
        match std::env::var("PATHEXT") {
            Ok(value) => value
                .split(';')
                .filter(|part| !part.trim().is_empty())
                .map(|part| part.trim().to_string())
                .collect(),
            Err(_) => vec![".EXE".to_string(), ".CMD".to_string(), ".BAT".to_string()],
        }
    } else {
        vec![String::new()]
    };

    // PATH uses ';' on Windows and ':' on unix; split_paths handles both.
    for directory in std::env::split_paths(&path_variable) {
        if directory.as_os_str().is_empty() {
            continue;
        }

        for extension in &extensions {
            let file_name = format!("{command}{extension}");
            let full_path = directory.join(&file_name);

            if full_path.is_file() {
                return classify(full_path);
            }
        }

        // On Windows, CreateProcess appends .exe automatically; match it so
        // bare executables (node, python, docker) resolve the same way.
        if cfg!(windows) {
            let exe_path = directory.join(format!("{command}.exe"));
            if exe_path.is_file() {
                return Ok(ResolvedExecutable::Direct(exe_path));
            }
        }
    }

    // Fall back to the OS lookup (works for .exe on Windows and unix PATH
    // entries resolved by the runtime); spawn errors surface actionable
    // messages to the user.
    Ok(ResolvedExecutable::Direct(PathBuf::from(command)))
}

fn classify(path: PathBuf) -> Result<ResolvedExecutable, String> {
    let lower = path
        .extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| extension.to_ascii_lowercase())
        .unwrap_or_default();

    if cfg!(windows) && (lower == "cmd" || lower == "bat") {
        Ok(ResolvedExecutable::WindowsBatch(path))
    } else {
        Ok(ResolvedExecutable::Direct(path))
    }
}
