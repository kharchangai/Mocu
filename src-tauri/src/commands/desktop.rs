use screenshots::Screen;
use base64::{prelude::BASE64_STANDARD, Engine};
use screenshots::image::ImageFormat;
use serde::Serialize;
use std::io::Cursor;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopCapture {
    image_data_url: String,
    screenshot_width: u32,
    screenshot_height: u32,
    monitor: MonitorBounds,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct MonitorBounds {
    /// Virtual-desktop coordinate origin reported for the primary display.
    x: i32,
    y: i32,
    /// Physical pixel bounds used by desktop mouse input.
    width: u32,
    height: u32,
    /// Display API dimensions and scale are included for diagnostics.
    reported_width: u32,
    reported_height: u32,
    scale_factor: f32,
    is_primary: bool,
}

#[tauri::command]
pub async fn capture_desktop() -> Result<DesktopCapture, String> {
    let screens = Screen::all().map_err(|e| e.to_string())?;
    if screens.is_empty() {
        return Err("No screens detected on this system.".to_string());
    }

    // Do not assume the first enumerated screen is the primary display.
    let primary_screen = screens
        .iter()
        .find(|screen| screen.display_info.is_primary)
        .ok_or_else(|| "Windows did not report a primary monitor.".to_string())?;
    let display = primary_screen.display_info;
    let image = primary_screen.capture().map_err(|e| e.to_string())?;
    let screenshot_width = image.width();
    let screenshot_height = image.height();

    let mut buffer = Vec::new();
    let mut cursor = Cursor::new(&mut buffer);
    image
        .write_to(&mut cursor, ImageFormat::Jpeg)
        .map_err(|e| e.to_string())?;
    let image_data_url = format!("data:image/jpeg;base64,{}", BASE64_STANDARD.encode(&buffer));

    Ok(DesktopCapture {
        image_data_url,
        screenshot_width,
        screenshot_height,
        monitor: MonitorBounds {
            x: (display.x as f32 * display.scale_factor).round() as i32,
            y: (display.y as f32 * display.scale_factor).round() as i32,
            width: screenshot_width,
            height: screenshot_height,
            reported_width: display.width,
            reported_height: display.height,
            scale_factor: display.scale_factor,
            is_primary: display.is_primary,
        },
    })
}
