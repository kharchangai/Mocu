pub mod jobs;
pub mod manager;
pub mod manifest;
pub mod process;
use std::path::{Component, Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Manager, State};

use manager::{ExtensionManager, JsonRpcErrorObject};
use manifest::{ExtensionApp, ExtensionManifest};
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
pub struct ExtensionAppUrlInput {
    pub extension_id: String,
    pub extension_path: String,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionAppListing {
    pub path: String,
    pub manifest: ExtensionManifest,
}

fn resolve_app_entry(extension_path: &str, app: &ExtensionApp) -> Result<PathBuf, String> {
    let entry = app.entry.trim().replace('\\', "/");
    let relative = Path::new(&entry);
    if entry.is_empty()
        || relative.is_absolute()
        || entry.contains(':')
        || entry.contains('?')
        || entry.contains('#')
        || relative
            .components()
            .any(|component| !matches!(component, Component::Normal(_)))
    {
        return Err("Extension app entry must be a safe relative file path.".to_string());
    }

    let root = PathBuf::from(extension_path)
        .canonicalize()
        .map_err(|error| format!("Invalid extension directory: {error}"))?;
    let resolved = root
        .join(relative)
        .canonicalize()
        .map_err(|error| format!("Extension app entry could not be found: {error}"))?;
    if !resolved.starts_with(&root) || !resolved.is_file() {
        return Err(
            "Extension app entry must resolve to a file inside its extension directory."
                .to_string(),
        );
    }
    Ok(resolved)
}

#[tauri::command]
pub fn extension_list_apps(app: AppHandle) -> Result<Vec<ExtensionAppListing>, String> {
    let root = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("extensions");
    let mut apps = Vec::new();
    let directories = std::fs::read_dir(&root)
        .map_err(|error| format!("Could not scan installed extensions: {error}"))?;
    for directory in directories {
        let directory = directory.map_err(|error| error.to_string())?;
        if !directory
            .file_type()
            .map_err(|error| error.to_string())?
            .is_dir()
        {
            continue;
        }
        let path = directory.path();
        let manifest_path = path.join("manifest.json");
        let Ok(contents) = std::fs::read_to_string(&manifest_path) else {
            continue;
        };
        let Ok(manifest) = serde_json::from_str::<ExtensionManifest>(&contents) else {
            continue;
        };
        if manifest.app.is_some() {
            apps.push(ExtensionAppListing {
                path: path.to_string_lossy().into_owned(),
                manifest,
            });
        }
    }
    apps.sort_by(|a, b| a.manifest.name.cmp(&b.manifest.name));
    Ok(apps)
}

#[tauri::command]
pub fn extension_app_url(
    app: AppHandle,
    input: ExtensionAppUrlInput,
) -> Result<String, String> {
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;

    let root = app_data
        .join("extensions")
        .join(&input.extension_id)
        .canonicalize()
        .map_err(|error| format!("Extension is not installed: {error}"))?;
    let supplied = PathBuf::from(&input.extension_path)
        .canonicalize()
        .map_err(|error| format!("Invalid extension path: {error}"))?;
    if root != supplied {
        return Err("Extension path did not match the installed extension ID.".to_string());
    }
    let contents = std::fs::read_to_string(root.join("manifest.json"))
        .map_err(|error| format!("Cannot read extension manifest: {error}"))?;
    let manifest: ExtensionManifest = serde_json::from_str(&contents)
        .map_err(|error| format!("Invalid extension manifest: {error}"))?;
    let app_manifest = manifest
        .app
        .as_ref()
        .ok_or_else(|| "Extension has no app UI.".to_string())?;
    if manifest.id != input.extension_id {
        return Err("Extension ID does not match its manifest.".to_string());
    }
    let entry = resolve_app_entry(root.to_string_lossy().as_ref(), app_manifest)?;
    let asset_directory = entry
        .parent()
        .ok_or_else(|| "App entry has no parent folder.".to_string())?;

    app.asset_protocol_scope()
        .allow_directory(asset_directory, true)
        .map_err(|error| format!("Could not authorize extension app assets: {error}"))?;

    Ok(entry.to_string_lossy().into_owned())
}

#[cfg(test)]
mod app_tests {
    use super::resolve_app_entry;
    use crate::extension_host::manifest::ExtensionApp;

    #[test]
    fn rejects_extension_app_path_traversal() {
        for entry in [
            "../outside.html",
            "ui/../../outside.html",
            "C:/outside.html",
            "https://example.test/app",
        ] {
            let app = ExtensionApp {
                entry: entry.to_string(),
                title: None,
            };
            assert!(
                resolve_app_entry("unused", &app).is_err(),
                "accepted unsafe app entry {entry}"
            );
        }
    }
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
const MAX_EXTENSION_FS_ENTRIES: usize = 2_000;
const MAX_EXTENSION_FS_READ_BYTES: u64 = 2 * 1024 * 1024;

/// Session-scoped user-approved folder grants for read-only extension app access.
#[derive(Default)]
pub struct ExtensionFileAccess {
    grants: std::sync::Mutex<std::collections::HashMap<String, (PathBuf, PathBuf)>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionFsGrantInput {
    pub extension_id: String,
    pub extension_path: String,
    pub root_path: String,
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionFsListInput {
    pub extension_id: String,
    pub extension_path: String,
    pub relative_path: Option<String>,
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionFsReadInput {
    pub extension_id: String,
    pub extension_path: String,
    pub relative_path: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionFsEntry {
    pub name: String,
    pub path: String,
    pub kind: String,
    pub size: Option<u64>,
}

fn resolve_inside_root(root: &Path, relative_path: &str) -> Result<PathBuf, String> {
    let normalized = relative_path.trim().replace('\\', "/");
    let relative = Path::new(&normalized);
    if normalized.contains(':')
        || relative.is_absolute()
        || relative
            .components()
            .any(|component| !matches!(component, Component::Normal(_)))
    {
        return Err("The requested path must be relative to the approved folder.".to_string());
    }
    let candidate = if normalized.is_empty() {
        root.to_path_buf()
    } else {
        root.join(relative)
    };
    let resolved = candidate
        .canonicalize()
        .map_err(|error| format!("Cannot access the requested path: {error}"))?;
    if !resolved.starts_with(root) {
        return Err("The requested path resolves outside the approved folder.".to_string());
    }
    Ok(resolved)
}

fn get_extension_root(
    app: &AppHandle,
    input_id: &str,
    input_path: &str,
) -> Result<PathBuf, String> {
    if input_id.trim().is_empty()
        || input_id
            .chars()
            .any(|character| matches!(character, '/' | '\\' | ':'))
    {
        return Err("Invalid extension ID.".to_string());
    }
    let installed = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("extensions")
        .join(input_id)
        .canonicalize()
        .map_err(|error| format!("Extension is not installed: {error}"))?;
    let supplied = PathBuf::from(input_path)
        .canonicalize()
        .map_err(|error| format!("Invalid extension path: {error}"))?;
    if installed != supplied || !installed.is_dir() {
        return Err("Extension path did not match the installed extension ID.".to_string());
    }
    let manifest_path = installed.join("manifest.json");
    let manifest: ExtensionManifest = serde_json::from_str(
        &std::fs::read_to_string(&manifest_path)
            .map_err(|error| format!("Cannot read extension manifest: {error}"))?,
    )
    .map_err(|error| format!("Invalid extension manifest: {error}"))?;
    if manifest.id != input_id {
        return Err("Extension ID does not match its manifest.".to_string());
    }
    Ok(installed)
}

#[tauri::command]
pub fn extension_fs_grant(
    app: AppHandle,
    access: State<'_, ExtensionFileAccess>,
    input: ExtensionFsGrantInput,
) -> Result<(), String> {
    let extension_root = get_extension_root(&app, &input.extension_id, &input.extension_path)?;
    verify_filesystem_permission(&app, &input.extension_id, &input.extension_path)?;
    let root = PathBuf::from(&input.root_path)
        .canonicalize()
        .map_err(|error| format!("Cannot access the approved folder: {error}"))?;
    if !root.is_dir() {
        return Err("The approved filesystem path is not a folder.".to_string());
    }
    access
        .grants
        .lock()
        .map_err(|_| "Filesystem permission store is unavailable.".to_string())?
        .insert(input.extension_id, (extension_root, root));
    Ok(())
}

/// Check whether this installed extension already has an approved folder.
#[tauri::command]
pub fn extension_fs_has_grant(
    app: AppHandle,
    access: State<'_, ExtensionFileAccess>,
    extension_id: String,
) -> Result<bool, String> {
    if extension_id.trim().is_empty()
        || extension_id
            .chars()
            .any(|character| matches!(character, '/' | '\\' | ':'))
    {
        return Err("Invalid extension ID.".to_string());
    }
    let extension_root = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("extensions")
        .join(&extension_id)
        .canonicalize()
        .map_err(|error| format!("Extension is not installed: {error}"))?;
    verify_filesystem_permission(
        &app,
        &extension_id,
        extension_root.to_string_lossy().as_ref(),
    )?;
    let mut grants = access
        .grants
        .lock()
        .map_err(|_| "Filesystem permission store is unavailable.".to_string())?;
    let Some((granted_extension_root, root)) = grants.get(&extension_id).cloned() else {
        return Ok(false);
    };
    if granted_extension_root == extension_root && root.is_dir() {
        Ok(true)
    } else {
        grants.remove(&extension_id);
        Ok(false)
    }
}

fn extension_granted_root(
    access: &ExtensionFileAccess,
    extension_id: &str,
    extension_root: &Path,
) -> Result<PathBuf, String> {
    access
        .grants
        .lock()
        .map_err(|_| "Filesystem permission store is unavailable.".to_string())?
        .get(extension_id)
        .filter(|(granted_extension_root, root)| {
            granted_extension_root == extension_root && root.is_dir()
        })
        .map(|(_, root)| root.clone())
        .ok_or_else(|| {
            "No folder has been approved for this extension. Choose a folder first.".to_string()
        })
}

/// Verify each filesystem bridge call against the installed manifest.
fn verify_filesystem_permission(
    app: &AppHandle,
    extension_id: &str,
    extension_path: &str,
) -> Result<(), String> {
    let root = get_extension_root(app, extension_id, extension_path)?;
    let manifest: ExtensionManifest = serde_json::from_str(
        &std::fs::read_to_string(root.join("manifest.json"))
            .map_err(|error| format!("Cannot read extension manifest: {error}"))?,
    )
    .map_err(|error| format!("Invalid extension manifest: {error}"))?;
    if manifest
        .permissions
        .iter()
        .any(|permission| permission == "filesystem.read")
    {
        Ok(())
    } else {
        Err("The extension has not declared the 'filesystem.read' permission.".to_string())
    }
}

/// Read-only filesystem APIs for extension app UIs. A folder is granted only
/// after the user chooses it in Mocu's native directory picker.
#[tauri::command]
pub fn extension_fs_list(
    app: AppHandle,
    access: State<'_, ExtensionFileAccess>,
    input: ExtensionFsListInput,
) -> Result<Vec<ExtensionFsEntry>, String> {
    let extension_root = get_extension_root(&app, &input.extension_id, &input.extension_path)?;
    verify_filesystem_permission(&app, &input.extension_id, &input.extension_path)?;
    let root = extension_granted_root(&access, &input.extension_id, &extension_root)?;
    let relative = input.relative_path.as_deref().unwrap_or("");
    let directory = resolve_inside_root(&root, relative)?;
    if !directory.is_dir() {
        return Err("The requested path is not a folder.".to_string());
    }
    let mut entries = Vec::new();
    for entry in std::fs::read_dir(&directory)
        .map_err(|error| format!("Cannot list the approved folder: {error}"))?
    {
        if entries.len() >= MAX_EXTENSION_FS_ENTRIES {
            return Err(format!(
                "Folder contains more than {MAX_EXTENSION_FS_ENTRIES} items."
            ));
        }
        let entry = entry.map_err(|error| error.to_string())?;
        let path = entry.path();
        let resolved = path
            .canonicalize()
            .map_err(|error| format!("Cannot resolve a folder entry: {error}"))?;
        if !resolved.starts_with(&root) {
            continue;
        }
        let file_type = entry.file_type().map_err(|error| error.to_string())?;
        if !file_type.is_dir() && !file_type.is_file() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().into_owned();
        let child_relative = Path::new(relative).join(&name);
        entries.push(ExtensionFsEntry {
            name,
            path: child_relative.to_string_lossy().replace('\\', "/"),
            kind: if file_type.is_dir() {
                "directory"
            } else {
                "file"
            }
            .to_string(),
            size: if file_type.is_file() {
                Some(entry.metadata().map_err(|error| error.to_string())?.len())
            } else {
                None
            },
        });
    }
    entries.sort_by(|left, right| {
        let left_dir = left.kind == "directory";
        let right_dir = right.kind == "directory";
        right_dir
            .cmp(&left_dir)
            .then_with(|| left.name.cmp(&right.name))
    });
    Ok(entries)
}

#[tauri::command]
pub fn extension_fs_read(
    app: AppHandle,
    access: State<'_, ExtensionFileAccess>,
    input: ExtensionFsReadInput,
) -> Result<String, String> {
    let extension_root = get_extension_root(&app, &input.extension_id, &input.extension_path)?;
    verify_filesystem_permission(&app, &input.extension_id, &input.extension_path)?;
    let root = extension_granted_root(&access, &input.extension_id, &extension_root)?;
    let file = resolve_inside_root(&root, &input.relative_path)?;
    if !file.is_file() {
        return Err("The requested path is not a file.".to_string());
    }
    let metadata = std::fs::metadata(&file).map_err(|error| error.to_string())?;
    if metadata.len() > MAX_EXTENSION_FS_READ_BYTES {
        return Err("The requested file is larger than the 2 MiB read limit.".to_string());
    }
    std::fs::read_to_string(file)
        .map_err(|error| format!("Cannot read the requested text file: {error}"))
}
