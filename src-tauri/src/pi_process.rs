use std::{
    io::{BufRead, BufReader, Write},
    path::PathBuf,
    process::{Child, ChildStdin, Command, Stdio},
    sync::Mutex,
};

use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};

pub struct PiProcess {
    child: Child,
    stdin: ChildStdin,
}

impl PiProcess {
    pub fn start(app: AppHandle, script_path: PathBuf) -> Result<Self, String> {
        let working_directory = script_path
            .parent()
            .ok_or("Invalid Pi sidecar path")?;

        let mut child = Command::new("node")
            .arg(&script_path)
            .current_dir(working_directory)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|error| format!("Failed to start Node.js: {error}"))?;

        let stdin = child
            .stdin
            .take()
            .ok_or("Failed to open Pi stdin")?;

        let stdout = child
            .stdout
            .take()
            .ok_or("Failed to open Pi stdout")?;

        let stderr = child
            .stderr
            .take()
            .ok_or("Failed to open Pi stderr")?;

        // Read JSON events
        let stdout_app = app.clone();

        std::thread::spawn(move || {
            let reader = BufReader::new(stdout);

            for result in reader.lines() {
                match result {
                    Ok(line) => match serde_json::from_str::<Value>(&line) {
                        Ok(event) => {
                            if let Err(error) =
                                stdout_app.emit("pi-event", event)
                            {
                                eprintln!(
                                    "[pi-process] Failed to emit event: {error}"
                                );
                            }
                        }
                        Err(error) => {
                            eprintln!(
                                "[pi-process] Invalid JSON from Pi: {error}; line={line}"
                            );
                        }
                    },
                    Err(error) => {
                        eprintln!(
                            "[pi-process] Failed to read stdout: {error}"
                        );
                        break;
                    }
                }
            }

            let _ = stdout_app.emit(
                "pi-event",
                json!({
                    "type": "closed"
                }),
            );
        });

        let stderr_app = app;

        std::thread::spawn(move || {
            let reader = BufReader::new(stderr);

            for line in reader.lines().map_while(Result::ok) {
                eprintln!("[pi-sidecar] {line}");

                let _ = stderr_app.emit(
                    "pi-log",
                    json!({
                        "message": line
                    }),
                );
            }
        });

        Ok(Self { child, stdin })
    }

    pub fn send(&mut self, value: Value) -> Result<(), String> {
        let serialized =
            serde_json::to_string(&value).map_err(|error| error.to_string())?;

        writeln!(self.stdin, "{serialized}")
            .map_err(|error| format!("Failed to write to Pi: {error}"))?;

        self.stdin
            .flush()
            .map_err(|error| format!("Failed to flush Pi stdin: {error}"))
    }
}

impl Drop for PiProcess {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

pub struct PiState(pub Mutex<Option<PiProcess>>);

impl Default for PiState {
    fn default() -> Self {
        Self(Mutex::new(None))
    }
}