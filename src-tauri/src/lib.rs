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

use extension_host::manager::ExtensionManager;

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
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

        // Register the extension manager state
        .manage(ExtensionManager::default())

        // Register all Tauri commands
        .invoke_handler(tauri::generate_handler![
            greet,
            commands::desktop::capture_desktop,
            extension_host::extension_execute,
            extension_host::extension_respond,
            extension_host::extension_stop
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
                &[&settings_item, &open_chat_item, &quit_item],
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

                    "open_chat" => {
                    if let Some(chat_window) = app.get_webview_window("chat") {
                        let _ = chat_window.maximize();
                        let _ = chat_window.show();
                        let _ = chat_window.set_focus();
                    } else {
                        match WebviewWindowBuilder::new(
                            app,
                            "chat",
                            WebviewUrl::App("/#chat".into()),
                        )
                        .title("Mocu Chat")
                        .resizable(true)
                        .decorations(true)
                        .build()
                        {
                            Ok(chat_window) => {
                                let _ = chat_window.maximize();
                            }
                            Err(error) => {
                                eprintln!(
                                    "[mocu] Failed to create chat window: {error}"
                                );
                            }
                        }
                    }
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

        .build(tauri::generate_context!())
        .expect("error while building Tauri application")
        .run(|app_handle, event| {
            // On shutdown, terminate every extension process cleanly.
            if let tauri::RunEvent::Exit = event {
                use tauri::Manager;
                app_handle.state::<ExtensionManager>().stop_all();
            }
        });
}