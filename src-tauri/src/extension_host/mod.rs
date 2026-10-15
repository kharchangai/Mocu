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
mod fs_permission_tests {
    use super::declares_permission;

    const PERMISSIONS: &[&str] = &["filesystem.read", "filesystem.write"];

    #[test]
    fn read_and_write_are_distinct_permissions() {
        let read_only = vec!["filesystem.read".to_string()];
        let write_only = vec!["filesystem.write".to_string()];
        let none: Vec<String> = Vec::new();

        // `filesystem.write` must never be satisfied by `filesystem.read`.
        assert!(declares_permission(&read_only, PERMISSIONS[0]));
        assert!(!declares_permission(&read_only, PERMISSIONS[1]));

        // Symmetrically, a write-only extension may not list or read.
        assert!(declares_permission(&write_only, PERMISSIONS[1]));
        assert!(!declares_permission(&write_only, PERMISSIONS[0]));

        assert!(!declares_permission(&none, PERMISSIONS[0]));
        assert!(!declares_permission(&none, PERMISSIONS[1]));
    }

    #[test]
    fn rejects_substring_lookalike_permissions() {
        for forger in [
            "filesystem.readwrite",
            "filesystem.writex",
            "xfilesystem.write",
            "filesystem.read ",
            " Filesystem.write",
        ] {
            assert!(
                !declares_permission(&[forger.to_string()], PERMISSIONS[1]),
                "accepted '{forger}' as filesystem.write"
            );
        }
    }
}

#[cfg(test)]
mod write_target_tests {
    use super::resolve_write_target;
    use std::path::PathBuf;

    fn sandbox_root() -> PathBuf {
        let root = std::env::temp_dir().canonicalize().expect("temp dir should exist");
        let unique = format!(
            "mocu-fs-test-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|elapsed| elapsed.as_nanos())
                .unwrap_or_default()
        );
        let path = root.join(unique);
        std::fs::create_dir_all(&path).expect("test sandbox should be created");
        path
    }

    #[test]
    fn accepts_new_and_existing_files_inside_the_root() {
        let root = sandbox_root();
        std::fs::create_dir_all(root.join("nested")).expect("nested folder should exist");
        std::fs::write(root.join("existing.txt"), "old").expect("existing file should exist");

        assert_eq!(resolve_write_target(&root, "new-file.txt").unwrap(), root.join("new-file.txt"));
        // A path that already exists resolves to exactly that file, not a copy.
        assert_eq!(resolve_write_target(&root, "existing.txt").unwrap(), root.join("existing.txt"));
        assert_eq!(
            resolve_write_target(&root, "nested\\new-file.txt").unwrap(),
            root.join("nested").join("new-file.txt")
        );

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn rejects_traversal_and_absolute_paths() {
        let root = sandbox_root();
        for path in [
            "",
            "..",
            ".",
            "../escape.txt",
            "a/../../escape.txt",
            "C:/Windows/x.txt",
            "/etc/x.txt",
            "nested/",
            "nested/..",
        ] {
            assert!(
                resolve_write_target(&root, path).is_err(),
                "accepted unsafe write target '{path}'"
            );
        }
        let _ = std::fs::remove_dir_all(&root);
    }
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
const MAX_EXTENSION_FS_WRITE_BYTES: usize = 2 * 1024 * 1024;

/// Manifest permission that unlocks listing and reading inside the folder a
/// user approved for an extension app.
const FILESYSTEM_READ_PERMISSION: &str = "filesystem.read";
/// Manifest permission required to write a text file inside that same folder.
const FILESYSTEM_WRITE_PERMISSION: &str = "filesystem.write";

/// Session-scoped user-approved folder grants for extension app file access.
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

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionFsWriteInput {
    pub extension_id: String,
    pub extension_path: String,
    pub relative_path: String,
    pub text: String,
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

/// Resolve a write target inside the approved folder. Unlike
/// `resolve_inside_root`, the file itself does not have to exist yet: the parent
/// folder is canonicalized and the final component is appended, so creating a
/// new file works while traversal outside the approved folder stays blocked.
fn resolve_write_target(root: &Path, relative_path: &str) -> Result<PathBuf, String> {
    let normalized = relative_path.trim().replace('\\', "/");
    if normalized.is_empty()
        || normalized.contains(':')
        || Path::new(&normalized).is_absolute()
        || Path::new(&normalized)
            .components()
            .any(|component| !matches!(component, Component::Normal(_)))
    {
        return Err(
            "The requested path must be a relative file path inside the approved folder.".to_string(),
        );
    }
    let (parent_relative, file_name) = match normalized.rfind('/') {
        Some(index) => (&normalized[..index], &normalized[index + 1..]),
        None => ("", normalized.as_str()),
    };
    if file_name.is_empty() || file_name == "." || file_name == ".." {
        return Err(
            "The requested path must be a relative file path inside the approved folder.".to_string(),
        );
    }
    let parent = resolve_inside_root(root, parent_relative)?;
    if !parent.is_dir() {
        return Err("The parent folder does not exist.".to_string());
    }
    let target = parent.join(file_name);
    // A pre-existing symlink must not let the write escape the approved folder.
    if std::fs::symlink_metadata(&target)
        .map(|metadata| metadata.file_type().is_symlink())
        .unwrap_or(false)
    {
        let resolved = target
            .canonicalize()
            .map_err(|error| format!("Cannot access the requested path: {error}"))?;
        if !resolved.starts_with(root) {
            return Err("The requested path resolves outside the approved folder.".to_string());
        }
    }
    Ok(target)
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
    // The grant does not decide what may be done inside the folder, but an
    // extension still needs at least one filesystem permission to ask for it.
    verify_filesystem_folder_permission(&app, &input.extension_id, &input.extension_path)?;
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
    // Write-only apps can create a folder grant too; subsequent filesystem
    // operations still require their own exact read/write permission.
    verify_filesystem_folder_permission(
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

/// True when the manifest declares exactly this permission.
fn declares_permission(permissions: &[String], required: &str) -> bool {
    permissions.iter().any(|permission| permission == required)
}

/// Read the installed manifest's declared permissions for the app bridge.
fn manifest_permissions(
    app: &AppHandle,
    extension_id: &str,
    extension_path: &str,
) -> Result<Vec<String>, String> {
    let root = get_extension_root(app, extension_id, extension_path)?;
    let manifest: ExtensionManifest = serde_json::from_str(
        &std::fs::read_to_string(root.join("manifest.json"))
            .map_err(|error| format!("Cannot read extension manifest: {error}"))?,
    )
    .map_err(|error| format!("Invalid extension manifest: {error}"))?;
    Ok(manifest.permissions)
}
/// Verify a filesystem bridge call against the installed manifest. Listing and
/// reading need `filesystem.read`; writing needs `filesystem.write`.
fn verify_filesystem_permission(
    app: &AppHandle,
    extension_id: &str,
    extension_path: &str,
    required_permission: &str,
) -> Result<(), String> {
    let permissions = manifest_permissions(app, extension_id, extension_path)?;
    if declares_permission(&permissions, required_permission) {
        Ok(())
    } else {
        Err(format!(
            "The extension has not declared the '{required_permission}' permission."
        ))
    }
}

/// Verify that an extension is allowed to ask for a folder grant at all. The
/// grant only authorizes the folder itself; every following call still checks
/// its own permission, so either filesystem permission is enough here.
fn verify_filesystem_folder_permission(
    app: &AppHandle,
    extension_id: &str,
    extension_path: &str,
) -> Result<(), String> {
    let permissions = manifest_permissions(app, extension_id, extension_path)?;
    if declares_permission(&permissions, FILESYSTEM_READ_PERMISSION)
        || declares_permission(&permissions, FILESYSTEM_WRITE_PERMISSION)
    {
        Ok(())
    } else {
        Err(format!(
            "The extension has not declared the '{FILESYSTEM_READ_PERMISSION}' or '{FILESYSTEM_WRITE_PERMISSION}' permission."
        ))
    }
}

/// Listing and reading stay read-only; writing lives in `extension_fs_write`.
/// A folder is granted only after the user chooses it in Mocu's native folder
/// picker.
#[tauri::command]
pub fn extension_fs_list(
    app: AppHandle,
    access: State<'_, ExtensionFileAccess>,
    input: ExtensionFsListInput,
) -> Result<Vec<ExtensionFsEntry>, String> {
    let extension_root = get_extension_root(&app, &input.extension_id, &input.extension_path)?;
    verify_filesystem_permission(
        &app,
        &input.extension_id,
        &input.extension_path,
        FILESYSTEM_READ_PERMISSION,
    )?;
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
    verify_filesystem_permission(
        &app,
        &input.extension_id,
        &input.extension_path,
        FILESYSTEM_READ_PERMISSION,
    )?;
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

/// Write a UTF-8 text file inside the user-approved folder. Unlike the listing
/// and reading calls, this requires the `filesystem.write` manifest
/// permission; `filesystem.read` alone does not allow overwriting files.
#[tauri::command]
pub fn extension_fs_write(
    app: AppHandle,
    access: State<'_, ExtensionFileAccess>,
    input: ExtensionFsWriteInput,
) -> Result<(), String> {
    let extension_root = get_extension_root(&app, &input.extension_id, &input.extension_path)?;
    verify_filesystem_permission(
        &app,
        &input.extension_id,
        &input.extension_path,
        FILESYSTEM_WRITE_PERMISSION,
    )?;
    let root = extension_granted_root(&access, &input.extension_id, &extension_root)?;
    if input.text.len() > MAX_EXTENSION_FS_WRITE_BYTES {
        return Err("The text is larger than the 2 MiB write limit.".to_string());
    }
    let file = resolve_write_target(&root, &input.relative_path)?;
    if file.is_dir() {
        return Err("The requested path is a folder, not a file.".to_string());
    }
    std::fs::write(&file, input.text)
        .map_err(|error| format!("Cannot write the requested text file: {error}"))
}
