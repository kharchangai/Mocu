use rdev::{listen, EventType};
use serde_json::json;
use std::{path::PathBuf, thread};
use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindowBuilder,
};

// Module for the previous Mocu commands
mod commands;

// Pi process management module
mod pi_process;

use pi_process::{PiProcess, PiState};

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

/// Find the index.mjs file in development mode.
///
/// Depending on whether Tauri is run from the project root or from the
/// src-tauri directory, the current directory may differ; therefore several
/// paths are checked.
fn find_pi_script() -> Result<PathBuf, String> {
    let current_directory = std::env::current_dir()
        .map_err(|error| format!("Failed to read current directory: {error}"))?;

    let candidates = [
        // If the current directory is the project root:
        // E:\mocube\mocu\pi-sidecar\index.mjs
        current_directory.join("pi-sidecar").join("index.mjs"),

        // If the current directory is src-tauri:
        // E:\mocube\mocu\src-tauri\..\pi-sidecar\index.mjs
        current_directory
            .join("..")
            .join("pi-sidecar")
            .join("index.mjs"),

        // Another possible case
        current_directory
            .join("..")
            .join("..")
            .join("pi-sidecar")
            .join("index.mjs"),
    ];

    for candidate in candidates {
        if candidate.is_file() {
            return candidate.canonicalize().map_err(|error| {
                format!(
                    "Failed to resolve Pi script path '{}': {error}",
                    candidate.display()
                )
            });
        }
    }

    Err(format!(
        concat!(
            "Pi script was not found.\n",
            "Current directory: {}\n",
            "Expected file: pi-sidecar/index.mjs"
        ),
        current_directory.display()
    ))
}

/// Start the Pi process.
///
/// This command is usually called once from the frontend.
/// If Pi is already running, it does nothing.
#[tauri::command]
fn start_pi(
    app: AppHandle,
    state: State<'_, PiState>,
) -> Result<(), String> {
    let mut process = state
        .0
        .lock()
        .map_err(|error| format!("Failed to lock Pi state: {error}"))?;

    // Prevents multiple concurrent processes.
    if process.is_some() {
        return Ok(());
    }

    let script_path = find_pi_script()?;

    println!(
        "[mocu] Starting Pi sidecar from: {}",
        script_path.display()
    );

    let pi_process = PiProcess::start(app, script_path)?;

    *process = Some(pi_process);

    Ok(())
}

/// Send a user message to Pi.
#[tauri::command]
fn prompt_pi(
    state: State<'_, PiState>,
    request_id: String,
    message: String,
) -> Result<(), String> {
    let trimmed_message = message.trim();

    if trimmed_message.is_empty() {
        return Err("Message cannot be empty.".to_string());
    }

    if request_id.trim().is_empty() {
        return Err("Request ID cannot be empty.".to_string());
    }

    let mut process = state
        .0
        .lock()
        .map_err(|error| format!("Failed to lock Pi state: {error}"))?;

    let process = process
        .as_mut()
        .ok_or_else(|| "Pi is not running. Call start_pi first.".to_string())?;

    process.send(json!({
        "type": "prompt",
        "requestId": request_id,
        "message": trimmed_message
    }))
}

/// Check the connection between Tauri and Pi.
#[tauri::command]
fn ping_pi(
    state: State<'_, PiState>,
    request_id: String,
) -> Result<(), String> {
    if request_id.trim().is_empty() {
        return Err("Request ID cannot be empty.".to_string());
    }

    let mut process = state
        .0
        .lock()
        .map_err(|error| format!("Failed to lock Pi state: {error}"))?;

    let process = process
        .as_mut()
        .ok_or_else(|| "Pi is not running. Call start_pi first.".to_string())?;

    process.send(json!({
        "type": "ping",
        "requestId": request_id
    }))
}

/// Stop the Pi process.
///
/// When PiProcess becomes None, the Drop method in pi_process.rs runs
/// and the Node process is closed as well.
#[tauri::command]
fn stop_pi(state: State<'_, PiState>) -> Result<(), String> {
    let mut process = state
        .0
        .lock()
        .map_err(|error| format!("Failed to lock Pi state: {error}"))?;

    *process = None;

    println!("[mocu] Pi sidecar stopped.");

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Mocu plugins
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::new().build())

        // Register the global Pi process state
        .manage(PiState::default())

        // Register all Tauri commands
        .invoke_handler(tauri::generate_handler![
            greet,
            commands::desktop::capture_desktop,
            start_pi,
            prompt_pi,
            ping_pi,
            stop_pi
        ])

        .setup(|app| {
            // Build the tray menu items
            let settings_item = MenuItem::with_id(
                app,
                "settings",
                "Settings",
                true,
                None::<&str>,
            )?;

            let quit_item = MenuItem::with_id(
                app,
                "quit",
                "Quit",
                true,
                None::<&str>,
            )?;

            let menu = Menu::with_items(
                app,
                &[&settings_item, &quit_item],
            )?;

            // Get the app's default icon
            let icon = app
                .default_window_icon()
                .cloned()
                .expect("Default window icon is not configured");

            // Build the System Tray
            let _tray = TrayIconBuilder::new()
                .icon(icon)
                .menu(&menu)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "settings" => {
                        if let Some(settings_window) =
                            app.get_webview_window("settings")
                        {
                            let _ = settings_window.show();
                            let _ = settings_window.set_focus();
                        } else {
                            match WebviewWindowBuilder::new(
                                app,
                                "settings",
                                WebviewUrl::App("/#settings".into()),
                            )
                            .title("Mocu Settings")
                            .inner_size(420.0, 520.0)
                            .resizable(false)
                            .decorations(true)
                            .always_on_top(true)
                            .build()
                            {
                                Ok(_) => {}
                                Err(error) => {
                                    eprintln!(
                                        "[mocu] Failed to create settings window: {error}"
                                    );
                                }
                            }
                        }
                    }

                    "quit" => {
                        app.exit(0);
                    }

                    _ => {}
                })
                .build(app)?;

            // Listen for keyboard key presses in a separate thread
            let keyboard_app_handle = app.handle().clone();

            thread::spawn(move || {
                if let Err(error) = listen(move |event| {
                    if let EventType::KeyPress(_) = event.event_type {
                        let _ = keyboard_app_handle.emit("user_typing", ());
                    }
                }) {
                    eprintln!(
                        "[mocu] Error listening to keyboard: {error:?}"
                    );
                }
            });

            Ok(())
        })

        .run(tauri::generate_context!())
        .expect("error while running Tauri application");
}