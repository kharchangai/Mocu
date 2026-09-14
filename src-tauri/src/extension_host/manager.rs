use std::{
    collections::HashMap,
    path::PathBuf,
    sync::{mpsc, Arc, Mutex, MutexGuard},
    time::Duration,
};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::AppHandle;
use uuid::Uuid;

use super::{
    manifest::ExtensionManifest,
    process::{spawn_extension, RunningExtension},
};

/// JSON-RPC error object, as sent back to an extension (frontend -> host).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JsonRpcErrorObject {
    pub code: i64,
    pub message: String,
    #[serde(default)]
    pub data: Option<Value>,
}

/// Hard cap for a single `extension.execute` call. Extensions that take longer
/// than this report a timeout so the calling thread is never blocked forever.
const EXECUTE_TIMEOUT: Duration = Duration::from_secs(90);

/// A registered (installed) extension that is ready to be spawned on demand.
#[derive(Clone)]
pub struct RegisteredExtension {
    pub path: PathBuf,
    pub manifest: ExtensionManifest,
}

/*
 * Lazy request/response bridge.
 *
 * When `execute` is called, a channel sender is stored keyed by the JSON-RPC
 * request id. The extension's stdout reader (`process.rs`) resolves the
 * matching id when the child writes back. This is what lets the manager spawn
 * an extension on first use, route the command and synchronously return the
 * output without any frontend/event round-trip.
 */
#[derive(Default)]
pub struct PendingRpc {
    senders: Mutex<HashMap<String, mpsc::Sender<Value>>>,
}

impl PendingRpc {
    pub fn new() -> Self {
        Self::default()
    }

    /// Reserve a fresh request id and hand back the receiver that will be
    /// fulfilled once the extension responds.
    pub fn create(&self) -> (String, mpsc::Receiver<Value>) {
        let id = Uuid::new_v4().to_string();
        let (sender, receiver) = mpsc::channel();

        if let Ok(mut senders) = self.senders.lock() {
            senders.insert(id.clone(), sender);
        }

        (id, receiver)
    }

    /// Called by the stdout reader when a response matching `id` arrives.
    pub fn resolve(&self, id: &str, result: Value) {
        let sender = match self.senders.lock() {
            Ok(mut senders) => senders.remove(id),
            Err(_) => None,
        };

        if let Some(sender) = sender {
            let _ = sender.send(result);
        }
    }
}

/// Owns every installed extension and its (optionally running) process.
///
/// The whole lifecycle is *automatic*: extensions are never started by the
/// user or the frontend explicitly. `execute` registers the extension if
/// needed, spawns a process only when none is running (lazy activation),
/// routes the command, and returns the extension's output.
#[derive(Clone)]
pub struct ExtensionManager {
    registry: Arc<Mutex<HashMap<String, RegisteredExtension>>>,
    processes: Arc<Mutex<HashMap<String, RunningExtension>>>,
    rpc: Arc<PendingRpc>,
}

impl Default for ExtensionManager {
    fn default() -> Self {
        Self {
            registry: Arc::new(Mutex::new(HashMap::new())),
            processes: Arc::new(Mutex::new(HashMap::new())),
            rpc: Arc::new(PendingRpc::new()),
        }
    }
}

impl ExtensionManager {
    /// Load / register an installed extension so it can be spawned on demand.
    ///
    /// Re-registering the same extension at the same path is a no-op (keeps a
    /// running process alive). Registering a *different* path for an existing
    /// id stops the old process so the next call starts from the new files.
    pub fn register(
        &self,
        path: PathBuf,
        manifest: ExtensionManifest,
    ) -> Result<(), String> {
        let id = manifest.id.trim().to_string();

        if id.is_empty() {
            return Err("Extension ID cannot be empty".to_string());
        }

        if !path.exists() {
            return Err(format!(
                "Extension directory does not exist: {}",
                path.display()
            ));
        }

        if !path.is_dir() {
            return Err("Extension path is not a directory".to_string());
        }

        {
            let registry = self.lock_registry()?;

            if let Some(existing) = registry.get(&id) {
                if existing.path == path {
                    // Same location as before: nothing to reload.
                    return Ok(());
                }
            }
        }

        // A stale/old installation: tear the process down so the next spawn
        // uses the freshly registered files.
        let _ = self.stop(&id);

        let mut registry = self.lock_registry()?;

        registry.insert(
            id,
            RegisteredExtension { path, manifest },
        );

        Ok(())
    }

    /// Run an extension command, spawning the process lazily if needed.
    ///
    /// This is the only execution entry point. It returns the JSON-RPC result
    /// written by the extension as a structured value:
    /// `{ "success": true, "output": ... }` or `{ "success": false, "error": ... }`.
    pub fn execute(
        &self,
        app_handle: AppHandle,
        path: PathBuf,
        manifest: ExtensionManifest,
        command: String,
        input: Option<Value>,
    ) -> Result<Value, String> {
        let id = manifest.id.trim().to_string();

        self.register(path.clone(), manifest.clone())?;

        let (request_id, receiver) = self.rpc.create();

        // Start (lazily) if absent or already exited, then send the command.
        let request = json!({
            "jsonrpc": "2.0",
            "id": request_id,
            "method": "extension.execute",
            "params": {
                "command": command,
                "input": input.unwrap_or(Value::Null),
            }
        });

        {
            let mut processes = self.lock_processes()?;

            let running = match processes.get(&id) {
                Some(process) => process.is_running(),
                None => false,
            };

            if !running {
                let registry = self.lock_registry()?;
                let entry = registry.get(&id).cloned().ok_or_else(|| {
                    format!("Extension '{id}' is not registered")
                })?;

                let process = spawn_extension(
                    app_handle,
                    entry.path,
                    entry.manifest,
                    self.rpc.clone(),
                )?;

                processes.insert(id.clone(), process);
            }

            let process = processes.get(&id).ok_or_else(|| {
                format!("Extension '{id}' process is missing")
            })?;

            process.send_json(&request)?;
        }

        // Wait (without holding any manager lock) for the extension to answer.
        match receiver.recv_timeout(EXECUTE_TIMEOUT) {
            Ok(result) => Ok(result),
            Err(_) => Err(format!(
                "Extension '{id}' timed out while handling command '{command}'"
            )),
        }
    }

    /// Write a JSON-RPC response back into an extension's stdin.
    ///
    /// Used to resolve a host-bound request (e.g. `mocu.llm.generate`) that
    /// the extension sent to the frontend.
    pub fn respond(
        &self,
        extension_id: &str,
        request_id: Value,
        result: Option<Value>,
        error: Option<JsonRpcErrorObject>,
    ) -> Result<(), String> {
        let mut response = serde_json::Map::new();
        response.insert("jsonrpc".into(), Value::String("2.0".into()));
        response.insert("id".into(), request_id);

        if let Some(result) = result {
            response.insert("result".into(), result);
        } else if let Some(error) = error {
            response.insert(
                "error".into(),
                serde_json::to_value(error)
                    .map_err(|e| format!("Failed to serialize error: {e}"))?,
            );
        }

        let processes = self.lock_processes()?;

        let process = processes.get(extension_id).ok_or_else(|| {
            format!("Extension '{extension_id}' is not running")
        })?;

        process.send_json(&Value::Object(response))
    }

    /// Stop a running extension process (used on uninstall / shutdown).
    pub fn stop(&self, id: &str) -> Result<bool, String> {
        let mut processes = self.lock_processes()?;

        match processes.remove(id) {
            Some(process) => {
                process.stop()?;
                Ok(true)
            }
            None => Ok(false),
        }
    }

    /// Stop every running extension. Called once during application shutdown.
    pub fn stop_all(&self) {
        let Ok(mut processes) = self.processes.lock() else {
            return;
        };

        for (_, process) in processes.drain() {
            let _ = process.stop();
        }
    }

    fn lock_registry<'a>(
        &'a self,
    ) -> Result<MutexGuard<'a, HashMap<String, RegisteredExtension>>, String> {
        self.registry
            .lock()
            .map_err(|_| "Extension registry lock is poisoned".to_string())
    }

    fn lock_processes<'a>(
        &'a self,
    ) -> Result<MutexGuard<'a, HashMap<String, RunningExtension>>, String> {
        self.processes
            .lock()
            .map_err(|_| "Extension process lock is poisoned".to_string())
    }
}