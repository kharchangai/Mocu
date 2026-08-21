pub mod manager;
pub mod manifest;
pub mod process;
pub mod protocol;

use serde::Deserialize;
use serde_json::Value;
use tauri::{AppHandle, State};

use protocol::JsonRpcErrorObject;

use manager::{
    ExtensionManager,
    ExtensionStatus,
    SendExtensionRequestInput,
    SendExtensionRequestResult,
    StartExtensionInput,
    StartExtensionResult,
};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StopExtensionInput {
    pub extension_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionStatusInput {
    pub extension_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SendNotificationInput {
    pub extension_id: String,
    pub method: String,
    pub params: Option<Value>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RespondExtensionInput {
    pub extension_id: String,
    pub request_id: String,

    #[serde(default)]
    pub result: Option<Value>,

    #[serde(default)]
    pub error: Option<JsonRpcErrorObject>,
}

#[tauri::command]
pub fn extension_start(
    app_handle: AppHandle,
    manager: State<'_, ExtensionManager>,
    input: StartExtensionInput,
) -> Result<StartExtensionResult, String> {
    manager.start(app_handle, input)
}

#[tauri::command]
pub fn extension_send_request(
    manager: State<'_, ExtensionManager>,
    input: SendExtensionRequestInput,
) -> Result<SendExtensionRequestResult, String> {
    manager.send_request(input)
}

#[tauri::command]
pub fn extension_send_notification(
    manager: State<'_, ExtensionManager>,
    input: SendNotificationInput,
) -> Result<(), String> {
    manager.send_notification(
        &input.extension_id,
        input.method,
        input.params,
    )
}

#[tauri::command]
pub fn extension_stop(
    manager: State<'_, ExtensionManager>,
    input: StopExtensionInput,
) -> Result<bool, String> {
    manager.stop(&input.extension_id)
}

#[tauri::command]
pub fn extension_status(
    manager: State<'_, ExtensionManager>,
    input: ExtensionStatusInput,
) -> Result<ExtensionStatus, String> {
    manager.status(&input.extension_id)
}

/// Sends a JSON-RPC response back to an extension request.
///
/// When an extension calls a host method (for example `mocu.llm.generate`
/// or `mocu.getSettings`), the frontend resolves it and uses this command to
/// send the result (or error) back through Rust into the extension.
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