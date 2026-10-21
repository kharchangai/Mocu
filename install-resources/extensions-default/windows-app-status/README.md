# Windows App Status — Mocu Extension

Checks whether an application is running on Windows, can control its windows, and can save a screenshot of only a selected application's window. Screenshot capture uses the Windows API and Python standard library; no third-party Python packages are required.

## Commands

### `check_app_open`

- **Input:** A program name as a string, such as `Chrome` or `Notepad`, or an object with a `name`, `program`, or `app` field.
- **Output:** Whether a matching process is running, matching process names and PIDs, and matching visible window titles.

### `control_app`

- **Input:** An object with `action` and application name. The name can be provided as `name`, `program`, or `app`.
- **Supported actions:** `open`, `minimize`, `maximize`, `close`.
- **Examples:** `{"action":"open","name":"Google Chrome"}`, `{"action":"open","name":"notepad.exe"}`, `{"action":"minimize","name":"Chrome"}`, `{"action":"maximize","name":"Notepad"}`, `{"action":"close","name":"Chrome"}`.
- **Behavior:** `open` accepts an executable/path or a friendly app name. For friendly names, it looks for matching Start Menu shortcuts and registered Windows app display names before asking the Windows Shell to open the original name. For example, `{"action":"open","name":"Google Chrome"}` can launch Chrome even when its executable is `chrome.exe`. The other actions target the best-matching visible window (preferring an exact executable-name match). `close` sends a graceful close request; it does not forcibly terminate the process. If multiple windows match, only the selected window is controlled.

### `screenshot_app`

- **Input:** A program name as a string, such as `Chrome` or `Notepad`, or an object with a `name`, `program`, or `app` field. An optional `outputPath`/`path` can specify a PNG destination.
- **Output:** A PNG path, the full current window dimensions in physical pixels, the selected window details, and confirmation that the window was minimized after capture. By default saves to `Pictures\\Windows App Status`.
- **Privacy and window state:** Captures only the selected top-level application window using `PrintWindow`; it does not capture the desktop or other applications. If the window is minimized, it is temporarily restored before capture. After a successful capture the app window is minimized; on capture failure its previous minimized state is restored. Capture can vary for protected or GPU-rendered app content.

Example: `{"name":"Notepad"}` or `{"name":"Chrome","outputPath":"C:\\Users\\me\\Pictures\\chrome.png"}`.

The search is case-insensitive and matches executable names or visible window titles. This extension controls Windows desktop applications only. On non-Windows systems, commands report that they are unsupported.

## Install

In Mocu, open **Extensions** and install this extension from its folder. Select or enable it for a chat, then ask Mocu to check or control an application.

The Python SDK is bundled in `vendor/mocu_extension_sdk`, so the extension does not depend on an SDK installed elsewhere.
