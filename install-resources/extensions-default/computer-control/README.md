# Computer Control — Mocu Extension

Control Windows applications and the desktop: manage app windows, capture screenshots, and use mouse/keyboard input.

## Commands

- `check_app_open`: checks for a process/window by app name.
- `control_app`: opens, minimizes, maximizes, or gracefully closes an app window.
- `screenshot_app`: captures only one app window as PNG. Do not use it to find desktop coordinates; its image is not the primary-monitor screenshot workflow.
- `find_screen_coordinates`: delegates the task to the saved **Screen Coordinate Finder** agent, which uses Mocu's full-primary-monitor `desktop_vision_action` image and exact screenshot/monitor bounds. Input examples: `{"target":"Search box"}` for coordinates only, `{"target":"Confirm button","action":"click"}` to request a click, or `{"request":"Find the dialog's search box and return coordinates"}` for a complete instruction. The agent returns English JSON. It only acts when requested and when the target is clear.
- `desktop_input`: performs Windows desktop mouse/keyboard actions. Use physical virtual-desktop pixel coordinates, which may include negative origins for monitors located left/above the primary display. A `click` should include both `x` and `y`, e.g. `{"action":"click","button":"left","x":500,"y":300}`. Other actions include `move`, `scroll`, `press_key`, `hotkey`, and `type_text`. `type_text` sends exact Unicode text in one ordered batch, independent of the active keyboard layout. The extension configures Mocu JSON-RPC stdin/stdout as UTF-8 explicitly, avoiding corruption under non-UTF-8 Windows system code pages; it does not guess or rewrite the text.

## Accurate screen coordinates

For locating UI elements, use `find_screen_coordinates`. It invokes the user's saved **Screen Coordinate Finder** agent through Mocu's `agents.invoke` API. The agent uses Mocu's `desktop_vision_action` for a full-primary-monitor screenshot and receives screenshot pixel size plus monitor desktop-coordinate origin and dimensions. This avoids trying to derive desktop coordinates from `screenshot_app`, which captures a window image and is not suitable for desktop coordinate mapping.

The agent maps screenshot pixels `(sx, sy)` to desktop mouse coordinates using:

```text
x = monitorOriginX + round(sx * monitorWidth / screenshotWidth)
y = monitorOriginY + round(sy * monitorHeight / screenshotHeight)
```

When an action is requested, the agent uses `desktop_input` with the mapped physical pixel coordinates and reports its result. For coordinates-only requests it does not interact. If the target is missing or ambiguous, it must not guess. The `find_screen_coordinates` command requires the saved agent named exactly `Screen Coordinate Finder`; if absent, create it in Mocu. It also requires the extension to have its declared `agents.invoke` permission authorized by Mocu.

The image is one full monitor, not the entire multi-monitor desktop. Mouse bounds are desktop-wide. Windows can block input to elevated apps, and the intended window should have focus.

## Install

Install this extension in Mocu's Extensions page. Select it for a chat or enable it on an agent. To use image-based coordinates, the Mocu vision model must also be configured.

The Python SDK is bundled under `vendor/mocu_extension_sdk`; no third-party Python packages are required.
