pub mod jobs;
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
    /// Opaque context forwarded verbatim to the extension inside the
    /// `extension.execute` params. Used e.g. to carry the calling agent's
    /// tool-card id so extensions can stream live progress back to chat.
    #[serde(default)]
    pub context: Option<Value>,
    /// User-filled values for the manifest's `config` fields (API keys,
    /// URLs, ...) resolved by the frontend; forwarded verbatim inside the
    /// `extension.execute` params as `config`.
    #[serde(default)]
    pub config: Option<Value>,
    /// Optional tracking id for agent-initiated calls. When present, Rust
    /// records the run (`running` -> `completed`/`failed`/`timeout`) so the
    /// result can be recovered after a webview reload.
    #[serde(default)]
    pub job_id: Option<String>,
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
    let context_value = input.context;
    let config_value = input.config;
    let job_id = input.job_id;

    tauri::async_runtime::spawn_blocking(move || {
        manager.execute(
            app_handle,
            path,
            manifest,
            command,
            input_value,
            context_value,
            config_value,
            job_id,
        )
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

/// Read a tracked extension job without removing it. Used by the frontend to
/// poll a long-running command after a webview reload.
#[tauri::command]
pub fn extension_job_status(
    manager: State<'_, ExtensionManager>,
    job_id: String,
) -> Result<Option<jobs::JobRecord>, String> {
    Ok(manager.job_status(&job_id))
}

/// Read a tracked extension job and remove it. Used once the frontend has
/// consumed a recovered result so it is never appended twice.
#[tauri::command]
pub fn extension_job_take(
    manager: State<'_, ExtensionManager>,
    job_id: String,
) -> Result<Option<jobs::JobRecord>, String> {
    Ok(manager.job_take(&job_id))
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