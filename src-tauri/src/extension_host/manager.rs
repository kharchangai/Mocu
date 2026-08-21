use std::{
    collections::HashMap,
    path::PathBuf,
    sync::{Arc, Mutex},
};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::AppHandle;
use uuid::Uuid;

use super::{
    manifest::ExtensionManifest,
    process::{spawn_extension, RunningExtension},
    protocol::{JsonRpcErrorObject, JsonRpcRequest, JsonRpcResponse},
};

#[derive(Default, Clone)]
pub struct ExtensionManager {
    processes: Arc<Mutex<HashMap<String, RunningExtension>>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartExtensionInput {
    pub extension_path: String,
    pub manifest: ExtensionManifest,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StartExtensionResult {
    pub extension_id: String,
    pub started: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SendExtensionRequestInput {
    pub extension_id: String,
    pub request_id: Option<String>,
    pub method: String,
    pub params: Option<Value>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SendExtensionRequestResult {
    pub request_id: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionStatus {
    pub extension_id: String,
    pub running: bool,
}

impl ExtensionManager {
    pub fn start(
        &self,
        app_handle: AppHandle,
        input: StartExtensionInput,
    ) -> Result<StartExtensionResult, String> {
        let extension_id = input.manifest.id.trim().to_string();

        if extension_id.is_empty() {
            return Err("Extension ID cannot be empty".to_string());
        }

        let extension_path = PathBuf::from(&input.extension_path);

        if !extension_path.exists() {
            return Err(format!(
                "Extension directory does not exist: {}",
                extension_path.display()
            ));
        }

        if !extension_path.is_dir() {
            return Err("Extension path is not a directory".to_string());
        }

        let mut processes = self
            .processes
            .lock()
            .map_err(|_| "Extension manager lock is poisoned".to_string())?;

        if let Some(existing) = processes.get(&extension_id) {
            if existing.is_running() {
                return Ok(StartExtensionResult {
                    extension_id,
                    started: false,
                });
            }
        }

        processes.remove(&extension_id);

        let process = spawn_extension(
            app_handle,
            extension_path,
            input.manifest,
        )?;

        processes.insert(extension_id.clone(), process);

        Ok(StartExtensionResult {
            extension_id,
            started: true,
        })
    }

    pub fn send_request(
        &self,
        input: SendExtensionRequestInput,
    ) -> Result<SendExtensionRequestResult, String> {
        let request_id = input
            .request_id
            .unwrap_or_else(|| Uuid::new_v4().to_string());

        let request = JsonRpcRequest {
            jsonrpc: "2.0".to_string(),
            id: request_id.clone(),
            method: input.method,
            params: input.params,
        };

        let value = serde_json::to_value(request)
            .map_err(|error| format!("Failed to build JSON-RPC request: {error}"))?;

        let processes = self
            .processes
            .lock()
            .map_err(|_| "Extension manager lock is poisoned".to_string())?;

        let process = processes
            .get(&input.extension_id)
            .ok_or_else(|| format!("Extension '{}' is not running", input.extension_id))?;

        if !process.is_running() {
            return Err(format!(
                "Extension '{}' process has already exited",
                input.extension_id
            ));
        }

        process.send_json(&value)?;

        Ok(SendExtensionRequestResult { request_id })
    }

    pub fn send_notification(
        &self,
        extension_id: &str,
        method: String,
        params: Option<Value>,
    ) -> Result<(), String> {
        let message = json!({
            "jsonrpc": "2.0",
            "method": method,
            "params": params
        });

        let processes = self
            .processes
            .lock()
            .map_err(|_| "Extension manager lock is poisoned".to_string())?;

        let process = processes
            .get(extension_id)
            .ok_or_else(|| format!("Extension '{extension_id}' is not running"))?;

        process.send_json(&message)
    }

    pub fn stop(&self, extension_id: &str) -> Result<bool, String> {
        let mut processes = self
            .processes
            .lock()
            .map_err(|_| "Extension manager lock is poisoned".to_string())?;

        let Some(process) = processes.remove(extension_id) else {
            return Ok(false);
        };

        process.stop()?;

        Ok(true)
    }

    pub fn respond(
        &self,
        extension_id: &str,
        request_id: String,
        result: Option<Value>,
        error: Option<JsonRpcErrorObject>,
    ) -> Result<(), String> {
        let response = JsonRpcResponse {
            jsonrpc: "2.0".to_string(),
            id: request_id,
            result,
            error,
        };

        let value = serde_json::to_value(response)
            .map_err(|error| format!("Failed to build JSON-RPC response: {error}"))?;

        let processes = self
            .processes
            .lock()
            .map_err(|_| "Extension manager lock is poisoned".to_string())?;

        let process = processes
            .get(extension_id)
            .ok_or_else(|| format!("Extension '{extension_id}' is not running"))?;

        if !process.is_running() {
            return Err(format!(
                "Extension '{extension_id}' process has already exited"
            ));
        }

        process.send_json(&value)?;

        Ok(())
    }

    pub fn status(&self, extension_id: &str) -> Result<ExtensionStatus, String> {
        let processes = self
            .processes
            .lock()
            .map_err(|_| "Extension manager lock is poisoned".to_string())?;

        let running = processes
            .get(extension_id)
            .map(|process| process.is_running())
            .unwrap_or(false);

        Ok(ExtensionStatus {
            extension_id: extension_id.to_string(),
            running,
        })
    }

    pub fn stop_all(&self) {
        let Ok(mut processes) = self.processes.lock() else {
            return;
        };

        for (_, process) in processes.drain() {
            let _ = process.stop();
        }
    }
}