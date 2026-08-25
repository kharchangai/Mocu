pub mod manager;
pub mod manifest;
pub mod process;

use std::path::PathBuf;

use serde::Deserialize;
use serde_json::Value;
use tauri::{AppHandle, State};

use manager::{ExtensionManager, JsonRpcErrorObject};
use manifest::ExtensionManifest;

/// Execute an extension command. The extension is registered, spawned on
/// demand (if not already running), invoked, and its output returned.
///
/// The command is `async` and runs the blocking wait on a background worker
/// so the main thread stays free. That matters because an extension can call
/// `mocu.llm.generate` mid-execution: the frontend must be able to run
/// `extension_respond` (which needs the main thread) to reply *before* this
/// command returns. Blocking the main thread here would deadlock the whole
/// app.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionExecuteInput {
    pub extension_path: String,
    pub manifest: ExtensionManifest,
    pub command: String,
    pub input: Option<Value>,
}

#[tauri::command]
pub async fn extension_execute(
    app_handle: AppHandle,
    manager: State<'_, ExtensionManager>,
    input: ExtensionExecuteInput,
) -> Result<Value, String> {
    let manager = manager.inner().clone();
    let path = PathBuf::from(&input.extension_path);
    let manifest = input.manifest;
    let command = input.command;
    let input_value = input.input;

    tauri::async_runtime::spawn_blocking(move || {
        manager.execute(app_handle, path, manifest, command, input_value)
    })
    .await
    .map_err(|error| format!("Extension execution task failed: {error}"))?
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionStopInput {
    pub extension_id: String,
}

/// Stop a running extension process (used on uninstall or restart).
#[tauri::command]
pub fn extension_stop(
    manager: State<'_, ExtensionManager>,
    input: ExtensionStopInput,
) -> Result<bool, String> {
    manager.stop(&input.extension_id)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RespondExtensionInput {
    pub extension_id: String,
    /// Preserve the id type (string or number) sent by the extension so the
    /// SDK's pending-request lookup matches.
    pub request_id: Value,
    #[serde(default)]
    pub result: Option<Value>,
    #[serde(default)]
    pub error: Option<JsonRpcErrorObject>,
}

/// Send a JSON-RPC response back to an extension request. Used to resolve a
/// host-bound request (e.g. `mocu.llm.generate`) that the extension sent to
/// the frontend.
#[tauri::command]
pub fn extension_respond(
    manager: State<'_, ExtensionManager>,
    input: RespondExtensionInput,
) -> Result<(), String> {
    manager.respond(
        &input.extension_id,
        input.request_id,
        input.result,
        input.error,
    )
}