use std::{collections::HashMap, sync::Mutex, thread, time::Duration};

use serde::{Deserialize, Serialize};
use tauri::{
    AppHandle, Manager, PhysicalPosition, Position, State, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder,
};
use uuid::Uuid;

const MAX_TEXT_LENGTH: usize = 5_000;
const MAX_HTML_LENGTH: usize = 100_000;
const MAX_JS_LENGTH: usize = 100_000;
const MAX_ICON_LENGTH: usize = 1_500_000;
const MAX_SOUND_LENGTH: usize = 12_000_000;

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopNotification {
    pub title: Option<String>,
    pub body: Option<String>,
    pub icon: Option<String>,
    pub html: Option<String>,
    pub css: Option<String>,
    pub javascript: Option<String>,
    pub sound: Option<String>,
    #[serde(default = "default_position")]
    pub position: String,
    pub monitor_index: Option<usize>,
    pub x: Option<i32>,
    pub y: Option<i32>,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub duration_ms: Option<u64>,
}

fn default_position() -> String {
    "top-right".to_string()
}

fn is_icon_only(input: &DesktopNotification) -> bool {
    input.title.as_deref().unwrap_or_default().trim().is_empty()
        && input.body.as_deref().unwrap_or_default().trim().is_empty()
        && input.html.as_deref().unwrap_or_default().trim().is_empty()
        && input
            .icon
            .as_deref()
            .is_some_and(|icon| !icon.trim().is_empty())
}

fn notification_window_size(
    width: Option<u32>,
    height: Option<u32>,
    icon_only: bool,
) -> (u32, u32) {
    let minimum = if icon_only { 32 } else { 250 };
    let default_width = if icon_only { 48 } else { 400 };
    let default_height = if icon_only { 48 } else { 180 };
    (
        width.unwrap_or(default_width).clamp(minimum, 900),
        height.unwrap_or(default_height).clamp(minimum, 700),
    )
}

#[derive(Default)]
pub struct DesktopNotificationState {
    pending: Mutex<HashMap<String, DesktopNotification>>,
    ready: Mutex<HashMap<String, std::sync::mpsc::SyncSender<Result<(), String>>>>,
}

fn validate_payload(payload: &DesktopNotification) -> Result<(), String> {
    let title = payload.title.as_deref().unwrap_or_default();
    let body = payload.body.as_deref().unwrap_or_default();
    if title.trim().is_empty()
        && body.trim().is_empty()
        && payload
            .html
            .as_deref()
            .unwrap_or_default()
            .trim()
            .is_empty()
        && payload
            .icon
            .as_deref()
            .unwrap_or_default()
            .trim()
            .is_empty()
    {
        return Err(
            "A desktop notification needs a title, body, icon, or custom HTML.".to_string(),
        );
    }
    if title.len() > 1_000 || body.len() > MAX_TEXT_LENGTH {
        return Err("Notification title or body exceeds the allowed length.".to_string());
    }
    if payload
        .html
        .as_ref()
        .is_some_and(|value| value.len() > MAX_HTML_LENGTH)
        || payload
            .css
            .as_ref()
            .is_some_and(|value| value.len() > MAX_HTML_LENGTH)
        || payload
            .javascript
            .as_ref()
            .is_some_and(|value| value.len() > MAX_JS_LENGTH)
    {
        return Err(
            "Notification HTML, CSS, or JavaScript exceeds the 100,000 byte limit.".to_string(),
        );
    }
    if let Some(icon) = payload.icon.as_deref() {
        if icon.len() > MAX_ICON_LENGTH || !icon.starts_with("data:image/") {
            return Err(
                "Notification icons must be image data URLs no larger than 1.5 MB.".to_string(),
            );
        }
    }
    if let Some(sound) = payload.sound.as_deref() {
        if sound.len() > MAX_SOUND_LENGTH || !sound.starts_with("data:audio/") {
            return Err(
                "Notification sounds must be audio data URLs no larger than 12 MB.".to_string(),
            );
        }
    }
    if payload
        .duration_ms
        .is_some_and(|duration| duration > 86_400_000)
    {
        return Err("Notification durationMs cannot exceed one day.".to_string());
    }
    let position = payload.position.as_str();
    if !matches!(
        position,
        "top-left"
            | "top-center"
            | "top-right"
            | "center"
            | "bottom-left"
            | "bottom-center"
            | "bottom-right"
            | "custom"
    ) {
        return Err("Unsupported notification position.".to_string());
    }
    if position == "custom" && (payload.x.is_none() || payload.y.is_none()) {
        return Err(
            "Custom notification placement requires desktop x and y coordinates.".to_string(),
        );
    }
    Ok(())
}

#[tauri::command]
pub async fn show_desktop_notification(
    app: AppHandle,
    state: State<'_, DesktopNotificationState>,
    input: DesktopNotification,
) -> Result<String, String> {
    validate_payload(&input)?;

    let id = Uuid::new_v4().to_string();
    let label = format!("notification-{id}");
    let (ready_tx, ready_rx) = std::sync::mpsc::sync_channel(1);
    state
        .pending
        .lock()
        .map_err(|_| "Notification state is unavailable.".to_string())?
        .insert(label.clone(), input.clone());
    state
        .ready
        .lock()
        .map_err(|_| "Notification readiness state is unavailable.".to_string())?
        .insert(label.clone(), ready_tx);

    let (width, height) = notification_window_size(input.width, input.height, is_icon_only(&input));
    let (create_tx, create_rx) = std::sync::mpsc::sync_channel(1);
    let (page_tx, page_rx) = std::sync::mpsc::sync_channel(1);
    let window_app = app.clone();
    let window_label = label.clone();
    let window_input = input.clone();
    let schedule_result = app.run_on_main_thread(move || {
        let result = (|| -> Result<(), String> {
            let page_loaded = page_tx;
            let window = WebviewWindowBuilder::new(
                &window_app,
                &window_label,
                WebviewUrl::App("/#notification".into()),
            )
            .on_page_load(move |window, payload| {
                if payload.event() == tauri::webview::PageLoadEvent::Finished {
                    let shown = window
                        .set_always_on_top(true)
                        .map_err(|error| {
                            format!("Could not keep notification above other windows: {error}")
                        })
                        .and_then(|_| {
                            window.show().map_err(|error| {
                                format!("Could not show desktop notification window: {error}")
                            })
                        });
                    let _ = page_loaded.send(shown);
                }
            })
            .title(window_input.title.as_deref().unwrap_or("Mocu notification"))
            .inner_size(width as f64, height as f64)
            .decorations(false)
            .transparent(true)
            .always_on_top(true)
            .skip_taskbar(true)
            .resizable(false)
            .shadow(false)
            .focused(false)
            .visible(false)
            .build()
            .map_err(|error| format!("Could not create desktop notification window: {error}"))?;

            if let Err(error) = position_window(&window_app, &window, &window_input, width, height)
            {
                let _ = window.close();
                return Err(error);
            }
            Ok(())
        })();
        let _ = create_tx.send(result);
    });

    if let Err(error) = schedule_result {
        if let Ok(mut pending) = state.pending.lock() {
            pending.remove(&label);
        }
        if let Ok(mut ready) = state.ready.lock() {
            ready.remove(&label);
        }
        return Err(format!(
            "Could not schedule desktop notification window: {error}"
        ));
    }

    let created_result = tauri::async_runtime::spawn_blocking(move || {
        create_rx.recv_timeout(Duration::from_secs(10))
    })
    .await;
    let created = match created_result {
        Ok(Ok(result)) => result,
        Ok(Err(_)) => Err("Timed out while creating the desktop notification window.".to_string()),
        Err(error) => Err(format!("Desktop notification task failed: {error}")),
    };

    if let Err(error) = created {
        if let Some(window) = app.get_webview_window(&label) {
            let _ = window.close();
        }
        if let Ok(mut pending) = state.pending.lock() {
            pending.remove(&label);
        }
        if let Ok(mut ready) = state.ready.lock() {
            ready.remove(&label);
        }
        return Err(error);
    }

    let page_result =
        tauri::async_runtime::spawn_blocking(move || page_rx.recv_timeout(Duration::from_secs(15)))
            .await;
    let page_result = match page_result {
        Ok(Ok(result)) => result,
        Ok(Err(_)) => Err(
            "Timed out waiting for the desktop notification UI to load and display.".to_string(),
        ),
        Err(error) => Err(format!(
            "Desktop notification page-load task failed: {error}"
        )),
    };

    if let Err(error) = page_result {
        if let Some(window) = app.get_webview_window(&label) {
            let _ = window.close();
        }
        if let Ok(mut pending) = state.pending.lock() {
            pending.remove(&label);
        }
        if let Ok(mut ready) = state.ready.lock() {
            ready.remove(&label);
        }
        return Err(error);
    }

    let render_result = tauri::async_runtime::spawn_blocking(move || {
        ready_rx.recv_timeout(Duration::from_secs(15))
    })
    .await;
    let render_result = match render_result {
        Ok(Ok(result)) => result,
        Ok(Err(_)) => {
            Err("Timed out waiting for the notification UI to render its content.".to_string())
        }
        Err(error) => Err(format!("Desktop notification render task failed: {error}")),
    };
    if let Err(error) = render_result {
        if let Some(window) = app.get_webview_window(&label) {
            let _ = window.close();
        }
        if let Ok(mut pending) = state.pending.lock() {
            pending.remove(&label);
        }
        if let Ok(mut ready) = state.ready.lock() {
            ready.remove(&label);
        }
        return Err(error);
    }

    // If the page never loads or React fails to mount, close the child window
    // rather than leaving an invisible or blank notification behind.
    let fallback_ms = input
        .duration_ms
        .filter(|duration| *duration > 0)
        .unwrap_or(15_000);
    let close_visible_on_timeout = input.duration_ms != Some(0);
    let timeout_app = app.clone();
    let timeout_label = label.clone();
    thread::spawn(move || {
        thread::sleep(Duration::from_millis(fallback_ms.max(1_000)));
        if let Some(window) = timeout_app.get_webview_window(&timeout_label) {
            let visible = window.is_visible().unwrap_or(false);
            if !visible || close_visible_on_timeout {
                let _ = window.close();
                if let Some(state) = timeout_app.try_state::<DesktopNotificationState>() {
                    if let Ok(mut pending) = state.pending.lock() {
                        pending.remove(&timeout_label);
                    }
                    if let Ok(mut ready) = state.ready.lock() {
                        ready.remove(&timeout_label);
                    }
                }
            }
        }
    });

    Ok(label)
}

fn position_window(
    app: &AppHandle,
    window: &WebviewWindow,
    input: &DesktopNotification,
    width: u32,
    height: u32,
) -> Result<(), String> {
    let monitors = app
        .available_monitors()
        .map_err(|error| format!("Could not enumerate displays: {error}"))?;
    if monitors.is_empty() {
        return Err("No displays are available for desktop notifications.".to_string());
    }
    let primary = app
        .primary_monitor()
        .map_err(|error| format!("Could not locate the primary display: {error}"))?;
    let primary_index = primary
        .as_ref()
        .and_then(|primary| {
            monitors
                .iter()
                .position(|monitor| monitor.position() == primary.position())
        })
        .unwrap_or(0);
    let monitor_index = input.monitor_index.unwrap_or(primary_index);
    let monitor = monitors.get(monitor_index).ok_or_else(|| {
        "Notification monitorIndex is outside the available display range.".to_string()
    })?;

    let position = if input.position == "custom" {
        PhysicalPosition::new(input.x.unwrap_or_default(), input.y.unwrap_or_default())
    } else {
        let work_area = monitor.work_area();
        let origin = PhysicalPosition::new(work_area.position.x, work_area.position.y);
        let size = work_area.size;
        let scale = monitor.scale_factor();
        let window_width = (f64::from(width) * scale).round() as i32;
        let window_height = (f64::from(height) * scale).round() as i32;
        let margin = (20.0 * scale).round() as i32;
        let centered_x = origin.x + ((size.width as i32 - window_width) / 2);
        let right_x = origin.x + size.width as i32 - window_width - margin;
        let top_y = origin.y + margin;
        let bottom_y = origin.y + size.height as i32 - window_height - margin;
        match input.position.as_str() {
            "top-left" => PhysicalPosition::new(origin.x + margin, top_y),
            "top-center" => PhysicalPosition::new(centered_x, top_y),
            "top-right" => PhysicalPosition::new(right_x, top_y),
            "center" => PhysicalPosition::new(
                centered_x,
                origin.y + ((size.height as i32 - window_height) / 2),
            ),
            "bottom-left" => PhysicalPosition::new(origin.x + margin, bottom_y),
            "bottom-center" => PhysicalPosition::new(centered_x, bottom_y),
            "bottom-right" => PhysicalPosition::new(right_x, bottom_y),
            _ => return Err("Unsupported notification position.".to_string()),
        }
    };
    window
        .set_position(Position::Physical(position))
        .map_err(|error| format!("Could not position desktop notification: {error}"))
}

#[tauri::command]
pub fn desktop_notification_take(
    window: WebviewWindow,
    state: State<'_, DesktopNotificationState>,
) -> Result<DesktopNotification, String> {
    let label = window.label();
    if !label.starts_with("notification-") {
        return Err("This window is not a desktop notification.".to_string());
    }
    state
        .pending
        .lock()
        .map_err(|_| "Notification state is unavailable.".to_string())?
        .remove(label)
        .ok_or_else(|| "The desktop notification payload has expired.".to_string())
}

#[tauri::command]
pub fn desktop_notification_ready(
    window: WebviewWindow,
    state: State<'_, DesktopNotificationState>,
    error: Option<String>,
) -> Result<(), String> {
    let label = window.label();
    if !label.starts_with("notification-") {
        return Err("This window is not a desktop notification.".to_string());
    }
    let sender = state
        .ready
        .lock()
        .map_err(|_| "Notification readiness state is unavailable.".to_string())?
        .remove(label)
        .ok_or_else(|| {
            "The desktop notification is no longer waiting for readiness.".to_string()
        })?;
    sender
        .send(match error {
            Some(message) => Err(message),
            None => Ok(()),
        })
        .map_err(|_| "The desktop notification request is no longer active.".to_string())
}

#[tauri::command]
pub fn close_desktop_notification(window: WebviewWindow) -> Result<(), String> {
    if !window.label().starts_with("notification-") {
        return Err("This window is not a desktop notification.".to_string());
    }
    window
        .close()
        .map_err(|error| format!("Could not close desktop notification: {error}"))
}
