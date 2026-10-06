use rdev::{listen, EventType};
use std::thread;
use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Emitter, Manager, WebviewUrl, WebviewWindowBuilder,
};

// Module for the previous Mocu commands
mod commands;

// Extension host module (manages Node.js / Python extension processes)
mod extension_host;

// MCP stdio host (manages local MCP server child processes)
mod mcp_stdio;


// Install resources
mod install_resources;

use extension_host::manager::ExtensionManager;
use mcp_stdio::McpStdioHost;

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeStatus {
    node_installed: bool,
    node_version: Option<String>,
    python_installed: bool,
    python_version: Option<String>,
}

fn command_version(program: &str, args: &[&str]) -> Option<String> {
    let output = std::process::Command::new(program).args(args).output().ok()?;
    if !output.status.success() {
        return None;
    }

    let version = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if version.is_empty() { None } else { Some(version) }
}

#[tauri::command]
fn check_system_runtimes() -> RuntimeStatus {
    let node_version = command_version("node", &["--version"]);

    #[cfg(target_os = "windows")]
    let python_version = command_version("python", &["--version"])
        .or_else(|| command_version("py", &["-3", "--version"]));

    #[cfg(not(target_os = "windows"))]
    let python_version = command_version("python3", &["--version"])
        .or_else(|| command_version("python", &["--version"]));

    RuntimeStatus {
        node_installed: node_version.is_some(),
        node_version,
        python_installed: python_version.is_some(),
        python_version,
    }
}

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

/*
 * Toggles the Mocu avatar (cube) window from the frontend.
 *
 * If the avatar window is visible it is hidden, otherwise it is
 * shown and focused. Returns the resulting visibility so the mini
 * cube button can reflect the new state.
 *
 * The cube window is created hidden at startup. If it was closed,
 * it is rebuilt with the same transparent overlay configuration.
 */
#[tauri::command]
fn toggle_mocu(app: tauri::AppHandle) -> bool {
    if let Some(mocu_window) = app.get_webview_window("mocu") {
        let is_visible = mocu_window
            .is_visible()
            .unwrap_or(false);

        if is_visible {
            let _ = mocu_window.hide();
            return false;
        }

        let _ = mocu_window.show();
        let _ = mocu_window.set_focus();
        return true;
    }

    let _ = WebviewWindowBuilder::new(
        &app,
        "mocu",
        WebviewUrl::App("/#mocu".into()),
    )
    .title("Mocu")
    .inner_size(250.0, 280.0)
    .decorations(false)
    .transparent(true)
    .always_on_top(true)
    .resizable(false)
    .shadow(false)
    .visible(true)
    .build();

    true
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        // Mocu plugins
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::new().build())

        .plugin(tauri_plugin_http::init())

        .plugin(tauri_plugin_sql::Builder::default().build())
        // Register the extension manager state
        .manage(ExtensionManager::default())

        // Register the MCP stdio process host state
        .manage(McpStdioHost::default())

        // Register all Tauri commands
        .invoke_handler(tauri::generate_handler![
            greet,
            toggle_mocu,
            check_system_runtimes,
            commands::desktop::capture_desktop,
            extension_host::extension_execute,
            extension_host::extension_respond,
            extension_host::extension_stop,
            extension_host::extension_job_status,
            extension_host::extension_job_take,
            mcp_stdio::mcp_stdio_start,
            mcp_stdio::mcp_stdio_send,
            mcp_stdio::mcp_stdio_stderr,
            mcp_stdio::mcp_stdio_stop
        ])

        .setup(|app| {
            install_resources::initialize(app.handle())?;

            // Build the tray menu items
            let open_chat_item = MenuItem::with_id(
                app,
                "open_chat",
                "Open Chat",
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
                &[&open_chat_item, &quit_item],
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
                    "open_chat" => {
                        /*
                         * The chat window is the main window. Closing it
                         * only hides it (so the tray stays functional),
                         * so normally it always exists here. If it was
                         * somehow destroyed, rebuild it.
                         */
                        if let Some(chat_window) = app.get_webview_window("main") {
                            let _ = chat_window.unminimize();
                            let _ = chat_window.show();
                            let _ = chat_window.set_focus();
                        } else {
                            match WebviewWindowBuilder::new(
                                app,
                                "main",
                                WebviewUrl::App("/".into()),
                            )
                            .title("mocu")
                            .inner_size(1100.0, 760.0)
                            .min_inner_size(720.0, 520.0)
                            .resizable(true)
                            .decorations(true)
                            .maximized(true)
                            .build()
                            {
                                Ok(_) => {}
                                Err(error) => {
                                    eprintln!(
                                        "[mocu] Failed to recreate chat window: {error}"
                                    );
                                }
                            }
                        }
                    }

                    "quit" => {
                        /*
                         * Full app exit: stops all extension processes
                         * through the RunEvent::Exit handler below.
                         */
                        app.exit(0);
                    }

                    _ => {}
                })
                .build(app)?;

            /*
             * The Mocu avatar (cube) window. It starts hidden so the
 * user sees the chat window first. The mini cube button inside
             * the chat page reveals this window via the `show_mocu`
             * command.
             */
            if let Err(error) = WebviewWindowBuilder::new(
                app,
                "mocu",
                WebviewUrl::App("/#mocu".into()),
            )
            .title("Mocu")
            .inner_size(250.0, 280.0)
            .decorations(false)
            .transparent(true)
            .always_on_top(true)
            .resizable(false)
            .shadow(false)
            .visible(false)
            .build()
            {
                eprintln!("[mocu] Failed to create mocu avatar window: {error}");
            }

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

        .build(tauri::generate_context!())
        .expect("error while building Tauri application")
        .run(|app_handle, event| {
            use tauri::Manager;

            match event {
                // On shutdown, terminate every extension process cleanly.
                tauri::RunEvent::Exit => {
                    app_handle
                        .state::<ExtensionManager>()
                        .stop_all();

                    // Kill every running MCP server process on shutdown so
                    // no orphaned children survive the app.
                    app_handle
                        .state::<McpStdioHost>()
                        .stop_all();
                }

                /*
                 * Closing the chat (main) window only hides it so the
                 * tray icon keeps working: "Open Chat" can always
                 * re-show it and "Quit" performs the real exit.
                 */
                tauri::RunEvent::WindowEvent {
                    label,
                    event: window_event,
                    ..
                } => {
                    if label == "main" {
                        if let tauri::WindowEvent::CloseRequested { api, .. } =
                            window_event
                        {
                            if let Some(window) =
                                app_handle.get_webview_window("main")
                            {
                                let _ = window.hide();
                            }

                            api.prevent_close();
                        }
                    }
                }

                _ => {}
            }
        });
}