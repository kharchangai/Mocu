# Windows App Status — Mocu Extension

Windows app status, accessible UI inspection, application screenshots, and desktop-wide mouse/keyboard input.

## Commands

- `check_app_open`: checks for a process/window by app name.
- `control_app`: opens, minimizes, maximizes, or gracefully closes an app window.
- `screenshot_app`: captures only one app window as PNG and returns its path and dimensions. It is not a monitor capture; on success it minimizes that window. Use Mocu's `desktop_vision_action` for a full-primary-monitor screenshot.
- `inspect_app_ui`: uses Windows UI Automation to report visible accessible controls, labels, control types, enabled/clickable/typeable/focusable state, physical bounds, and suggested center coordinates. Custom controls the app does not expose may be absent. Input: `{"name":"Google Chrome","maxElements":1000}`.
- `desktop_input`: performs Windows desktop mouse/keyboard actions. Use physical virtual-desktop pixel coordinates, which may include negative origins for monitors located left/above the primary display. A `click` should include both `x` and `y`, e.g. `{"action":"click","button":"left","x":500,"y":300}`. Other actions include `move`, `scroll`, `press_key`, `hotkey`, and `type_text`.

## Accurate screen coordinates

`desktop_vision_action` captures the full primary monitor and sends that image to Mocu's configured vision model. The model receives the exact screenshot pixel dimensions and the primary monitor's desktop-coordinate origin and dimensions. To map a screenshot pixel `(sx, sy)` to desktop mouse coordinates, use:

```text
x = monitorOriginX + round(sx * monitorWidth / screenshotWidth)
y = monitorOriginY + round(sy * monitorHeight / screenshotHeight)
```

The Rust capture command selects the primary display explicitly and returns the image's actual pixel dimensions, virtual-desktop origin, display-reported dimensions and scale factor. `desktop_input` sets its calling thread to per-monitor physical-DPI awareness before reading mouse bounds and sending coordinates, so DPI virtualization does not mix logical coordinates with physical pixels.

The image is one full monitor, not the entire multi-monitor desktop. Mouse bounds are desktop-wide. The vision tool only analyzes and reports coordinates; the extension's `desktop_input` must perform any requested click. Windows can block input to elevated apps, and the intended window should have focus.

## Install

Install this extension in Mocu's Extensions page. Select it for a chat or enable it on an agent. To use image-based coordinates, the Mocu vision model must also be configured. UI Automation requires Windows PowerShell and app accessibility support.

The Python SDK is bundled under `vendor/mocu_extension_sdk`; no third-party Python packages are required.
