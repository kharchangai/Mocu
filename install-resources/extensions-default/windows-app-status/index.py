"""Check whether an application is running on Windows using only the standard library."""

from __future__ import annotations

import ctypes
import os
import sys
import unicodedata
from ctypes import wintypes
from typing import Any

# The extension SDK is bundled with this extension, not installed globally.
_EXTENSION_DIR = os.path.dirname(os.path.abspath(__file__))
_VENDOR_DIR = os.path.join(_EXTENSION_DIR, "vendor")
if _VENDOR_DIR not in sys.path:
    sys.path.insert(0, _VENDOR_DIR)

from mocu_extension_sdk import create_extension


extension = create_extension()


class PROCESSENTRY32W(ctypes.Structure):
    _fields_ = [
        ("dwSize", wintypes.DWORD),
        ("cntUsage", wintypes.DWORD),
        ("th32ProcessID", wintypes.DWORD),
        ("th32DefaultHeapID", ctypes.c_size_t),
        ("th32ModuleID", wintypes.DWORD),
        ("cntThreads", wintypes.DWORD),
        ("th32ParentProcessID", wintypes.DWORD),
        ("pcPriClassBase", wintypes.LONG),
        ("dwFlags", wintypes.DWORD),
        ("szExeFile", wintypes.WCHAR * 260),
    ]


def _normalize(value: str) -> str:
    normalized = unicodedata.normalize("NFKC", value).casefold().strip()
    if normalized.endswith(".exe"):
        normalized = normalized[:-4]
    return normalized


def _get_visible_window_titles() -> dict[int, list[str]]:
    user32 = ctypes.WinDLL("user32", use_last_error=True)
    titles_by_pid: dict[int, list[str]] = {}
    enum_windows_proc = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)

    user32.IsWindowVisible.argtypes = [wintypes.HWND]
    user32.IsWindowVisible.restype = wintypes.BOOL
    user32.GetWindowTextLengthW.argtypes = [wintypes.HWND]
    user32.GetWindowTextLengthW.restype = ctypes.c_int
    user32.GetWindowTextW.argtypes = [wintypes.HWND, wintypes.LPWSTR, ctypes.c_int]
    user32.GetWindowTextW.restype = ctypes.c_int
    user32.GetWindowThreadProcessId.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.DWORD)]
    user32.GetWindowThreadProcessId.restype = wintypes.DWORD

    def collect_window(hwnd: int, _lparam: int) -> bool:
        if not user32.IsWindowVisible(hwnd):
            return True
        length = user32.GetWindowTextLengthW(hwnd)
        if length <= 0:
            return True
        title_buffer = ctypes.create_unicode_buffer(length + 1)
        if not user32.GetWindowTextW(hwnd, title_buffer, len(title_buffer)):
            return True
        process_id = wintypes.DWORD()
        user32.GetWindowThreadProcessId(hwnd, ctypes.byref(process_id))
        title = title_buffer.value.strip()
        if title:
            titles_by_pid.setdefault(process_id.value, []).append(title)
        return True

    callback = enum_windows_proc(collect_window)
    user32.EnumWindows.argtypes = [enum_windows_proc, wintypes.LPARAM]
    user32.EnumWindows.restype = wintypes.BOOL
    if not user32.EnumWindows(callback, 0):
        raise ctypes.WinError(ctypes.get_last_error())
    return titles_by_pid


def _find_matching_processes(query: str) -> list[dict[str, Any]]:
    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel32.CreateToolhelp32Snapshot.argtypes = [wintypes.DWORD, wintypes.DWORD]
    kernel32.CreateToolhelp32Snapshot.restype = wintypes.HANDLE
    kernel32.Process32FirstW.argtypes = [wintypes.HANDLE, ctypes.POINTER(PROCESSENTRY32W)]
    kernel32.Process32FirstW.restype = wintypes.BOOL
    kernel32.Process32NextW.argtypes = [wintypes.HANDLE, ctypes.POINTER(PROCESSENTRY32W)]
    kernel32.Process32NextW.restype = wintypes.BOOL
    kernel32.CloseHandle.argtypes = [wintypes.HANDLE]
    kernel32.CloseHandle.restype = wintypes.BOOL

    snapshot = kernel32.CreateToolhelp32Snapshot(0x00000002, 0)
    invalid_handle = ctypes.c_void_p(-1).value
    if snapshot == invalid_handle:
        raise ctypes.WinError(ctypes.get_last_error())

    titles_by_pid = _get_visible_window_titles()
    matches: list[dict[str, Any]] = []
    entry = PROCESSENTRY32W()
    entry.dwSize = ctypes.sizeof(PROCESSENTRY32W)

    try:
        has_process = kernel32.Process32FirstW(snapshot, ctypes.byref(entry))
        while has_process:
            process_name = entry.szExeFile
            window_titles = titles_by_pid.get(entry.th32ProcessID, [])
            normalized_process_name = _normalize(os.path.splitext(process_name)[0])
            matching_titles = [title for title in window_titles if query in _normalize(title)]

            if query in normalized_process_name or matching_titles:
                matches.append(
                    {
                        "processName": process_name,
                        "pid": entry.th32ProcessID,
                        "windowTitles": matching_titles,
                    }
                )
            has_process = kernel32.Process32NextW(snapshot, ctypes.byref(entry))
    finally:
        kernel32.CloseHandle(snapshot)

    return matches


def _enumerate_visible_windows() -> list[dict[str, Any]]:
    """Return visible, titled top-level windows with their owning process IDs."""
    user32 = ctypes.WinDLL("user32", use_last_error=True)
    windows: list[dict[str, Any]] = []
    enum_windows_proc = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)

    user32.IsWindowVisible.argtypes = [wintypes.HWND]
    user32.IsWindowVisible.restype = wintypes.BOOL
    user32.GetWindowTextLengthW.argtypes = [wintypes.HWND]
    user32.GetWindowTextLengthW.restype = ctypes.c_int
    user32.GetWindowTextW.argtypes = [wintypes.HWND, wintypes.LPWSTR, ctypes.c_int]
    user32.GetWindowTextW.restype = ctypes.c_int
    user32.GetWindowThreadProcessId.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.DWORD)]
    user32.GetWindowThreadProcessId.restype = wintypes.DWORD

    def collect_window(hwnd: int, _lparam: int) -> bool:
        if not user32.IsWindowVisible(hwnd):
            return True
        length = user32.GetWindowTextLengthW(hwnd)
        if length <= 0:
            return True
        title_buffer = ctypes.create_unicode_buffer(length + 1)
        if not user32.GetWindowTextW(hwnd, title_buffer, len(title_buffer)):
            return True
        process_id = wintypes.DWORD()
        user32.GetWindowThreadProcessId(hwnd, ctypes.byref(process_id))
        title = title_buffer.value.strip()
        if title:
            windows.append({"hwnd": int(hwnd), "pid": process_id.value, "title": title})
        return True

    callback = enum_windows_proc(collect_window)
    user32.EnumWindows.argtypes = [enum_windows_proc, wintypes.LPARAM]
    user32.EnumWindows.restype = wintypes.BOOL
    if not user32.EnumWindows(callback, 0):
        raise ctypes.WinError(ctypes.get_last_error())
    return windows


def _find_matching_window_targets(query: str) -> list[dict[str, Any]]:
    """Match titled windows to processes, preferring exact executable-name matches."""
    processes = _find_matching_processes(query)
    process_by_pid = {item["pid"]: item for item in processes}
    targets = []
    for window in _enumerate_visible_windows():
        process = process_by_pid.get(window["pid"])
        if process:
            targets.append({**window, "processName": process["processName"]})

    targets.sort(
        key=lambda item: (
            _normalize(os.path.splitext(item["processName"])[0]) != query,
            _normalize(item["title"]) != query,
            len(item["title"]),
        )
    )
    return targets



def _png_chunk(chunk_type: bytes, data: bytes) -> bytes:
    import binascii
    import struct

    body = chunk_type + data
    return struct.pack(">I", len(data)) + body + struct.pack(">I", binascii.crc32(body) & 0xFFFFFFFF)


def _write_png(path: str, width: int, height: int, bgra: bytes) -> None:
    """Write a top-down 32-bit BGRA buffer as a PNG using only the standard library."""
    import struct
    import zlib

    if width <= 0 or height <= 0 or len(bgra) != width * height * 4:
        raise ValueError("The captured window image has invalid dimensions or pixel data.")

    raw = bytearray()
    row_size = width * 4
    for y in range(height):
        raw.append(0)  # PNG filter: None
        row = bgra[y * row_size:(y + 1) * row_size]
        for x in range(width):
            pixel = x * 4
            raw.extend((row[pixel + 2], row[pixel + 1], row[pixel]))

    header = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    png = b"\x89PNG\r\n\x1a\n" + _png_chunk(b"IHDR", header)
    png += _png_chunk(b"IDAT", zlib.compress(bytes(raw)))
    png += _png_chunk(b"IEND", b"")
    with open(path, "xb") as image_file:
        image_file.write(png)


def _set_physical_pixel_dpi_context(user32: Any) -> tuple[Any, Any] | None:
    """Make window bounds physical pixels while capturing, then restore the caller's DPI mode."""
    try:
        set_context = user32.SetThreadDpiAwarenessContext
    except AttributeError:
        return None
    set_context.argtypes = [wintypes.HANDLE]
    set_context.restype = wintypes.HANDLE
    previous_context = set_context(ctypes.c_void_p(-4))  # PER_MONITOR_AWARE_V2
    if not previous_context:
        raise ctypes.WinError(ctypes.get_last_error())
    return set_context, previous_context


def _capture_window_png(hwnd_value: int, path: str) -> tuple[int, int]:
    """Capture the selected window at full physical-pixel dimensions; never capture the desktop."""
    import struct

    class RECT(ctypes.Structure):
        _fields_ = [("left", wintypes.LONG), ("top", wintypes.LONG),
                    ("right", wintypes.LONG), ("bottom", wintypes.LONG)]

    class BITMAPINFOHEADER(ctypes.Structure):
        _fields_ = [
            ("biSize", wintypes.DWORD), ("biWidth", wintypes.LONG),
            ("biHeight", wintypes.LONG), ("biPlanes", wintypes.WORD),
            ("biBitCount", wintypes.WORD), ("biCompression", wintypes.DWORD),
            ("biSizeImage", wintypes.DWORD), ("biXPelsPerMeter", wintypes.LONG),
            ("biYPelsPerMeter", wintypes.LONG), ("biClrUsed", wintypes.DWORD),
            ("biClrImportant", wintypes.DWORD),
        ]

    class RGBQUAD(ctypes.Structure):
        _fields_ = [("rgbBlue", ctypes.c_ubyte), ("rgbGreen", ctypes.c_ubyte),
                    ("rgbRed", ctypes.c_ubyte), ("rgbReserved", ctypes.c_ubyte)]

    class BITMAPINFO(ctypes.Structure):
        _fields_ = [("bmiHeader", BITMAPINFOHEADER), ("bmiColors", RGBQUAD * 1)]

    user32 = ctypes.WinDLL("user32", use_last_error=True)
    gdi32 = ctypes.WinDLL("gdi32", use_last_error=True)
    hwnd = wintypes.HWND(hwnd_value)
    user32.IsWindow.argtypes = [wintypes.HWND]
    user32.IsWindow.restype = wintypes.BOOL
    user32.IsIconic.argtypes = [wintypes.HWND]
    user32.IsIconic.restype = wintypes.BOOL
    user32.GetWindowRect.argtypes = [wintypes.HWND, ctypes.POINTER(RECT)]
    user32.GetWindowRect.restype = wintypes.BOOL
    user32.GetWindowDC.argtypes = [wintypes.HWND]
    user32.GetWindowDC.restype = wintypes.HDC
    user32.ReleaseDC.argtypes = [wintypes.HWND, wintypes.HDC]
    user32.ReleaseDC.restype = ctypes.c_int
    user32.PrintWindow.argtypes = [wintypes.HWND, wintypes.HDC, wintypes.UINT]
    user32.PrintWindow.restype = wintypes.BOOL
    gdi32.CreateCompatibleDC.argtypes = [wintypes.HDC]
    gdi32.CreateCompatibleDC.restype = wintypes.HDC
    gdi32.CreateDIBSection.argtypes = [
        wintypes.HDC, ctypes.POINTER(BITMAPINFO), wintypes.UINT,
        ctypes.POINTER(ctypes.c_void_p), wintypes.HANDLE, wintypes.DWORD,
    ]
    gdi32.CreateDIBSection.restype = ctypes.c_void_p
    gdi32.SelectObject.argtypes = [wintypes.HDC, ctypes.c_void_p]
    gdi32.SelectObject.restype = ctypes.c_void_p
    gdi32.DeleteObject.argtypes = [ctypes.c_void_p]
    gdi32.DeleteObject.restype = wintypes.BOOL
    gdi32.DeleteDC.argtypes = [wintypes.HDC]
    gdi32.DeleteDC.restype = wintypes.BOOL

    dpi_context = _set_physical_pixel_dpi_context(user32)
    try:
        if not user32.IsWindow(hwnd):
            raise OSError("The selected application window no longer exists.")
        if user32.IsIconic(hwnd):
            raise OSError("The selected application window is minimized; restore it before taking a screenshot.")
        rect = RECT()
        if not user32.GetWindowRect(hwnd, ctypes.byref(rect)):
            raise ctypes.WinError(ctypes.get_last_error())
        width, height = rect.right - rect.left, rect.bottom - rect.top
        if width <= 0 or height <= 0 or width > 12000 or height > 12000 or width * height > 50_000_000:
            raise ValueError("The selected application window has invalid or excessively large dimensions.")

        info = BITMAPINFO()
        info.bmiHeader.biSize = ctypes.sizeof(BITMAPINFOHEADER)
        info.bmiHeader.biWidth = width
        info.bmiHeader.biHeight = -height
        info.bmiHeader.biPlanes = 1
        info.bmiHeader.biBitCount = 32
        info.bmiHeader.biCompression = 0
        info.bmiHeader.biSizeImage = width * height * 4
        window_dc = user32.GetWindowDC(hwnd)
        if not window_dc:
            raise ctypes.WinError(ctypes.get_last_error())
        memory_dc = bitmap = old_bitmap = None
        try:
            memory_dc = gdi32.CreateCompatibleDC(window_dc)
            if not memory_dc:
                raise ctypes.WinError(ctypes.get_last_error())
            pixel_pointer = ctypes.c_void_p()
            bitmap = gdi32.CreateDIBSection(
                window_dc, ctypes.byref(info), 0, ctypes.byref(pixel_pointer), None, 0
            )
            if not bitmap or not pixel_pointer.value:
                raise ctypes.WinError(ctypes.get_last_error())
            old_bitmap = gdi32.SelectObject(memory_dc, bitmap)
            if not old_bitmap or old_bitmap == ctypes.c_void_p(-1).value:
                raise ctypes.WinError(ctypes.get_last_error())
            # Render only this window; deliberately no screen/desktop BitBlt fallback.
            if not user32.PrintWindow(hwnd, memory_dc, 0x00000002):
                raise OSError("Windows could not render this application's window for capture.")
            pixels = ctypes.string_at(pixel_pointer.value, width * height * 4)
        finally:
            if memory_dc and old_bitmap:
                gdi32.SelectObject(memory_dc, old_bitmap)
            if bitmap:
                gdi32.DeleteObject(bitmap)
            if memory_dc:
                gdi32.DeleteDC(memory_dc)
            user32.ReleaseDC(hwnd, window_dc)
        _write_png(path, width, height, pixels)
        return width, height
    finally:
        if dpi_context:
            set_context, previous_context = dpi_context
            if not set_context(previous_context):
                raise ctypes.WinError(ctypes.get_last_error())


def _screenshot_path(requested_path: Any) -> str:
    import time

    pictures = os.path.join(os.path.expanduser("~"), "Pictures")
    if requested_path is None or requested_path == "":
        folder = os.path.join(pictures, "Windows App Status")
        filename = f"screenshot_{time.strftime('%Y%m%d_%H%M%S')}_{time.time_ns() % 1_000_000_000:09d}.png"
        path = os.path.join(folder, filename)
    elif isinstance(requested_path, str) and requested_path.strip():
        path = os.path.expandvars(os.path.expanduser(requested_path.strip()))
        if not os.path.isabs(path):
            path = os.path.join(pictures, path)
        if not path.casefold().endswith(".png"):
            raise ValueError("Screenshot output path must end with .png.")
        path = os.path.abspath(path)
    else:
        raise ValueError("outputPath must be a non-empty path string when provided.")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    return path


def _shell_execute(target: str) -> int:
    """Ask the Windows shell to open a path, shortcut, URL, or registered app name."""
    shell32 = ctypes.WinDLL("shell32", use_last_error=True)
    shell32.ShellExecuteW.argtypes = [
        wintypes.HWND, wintypes.LPCWSTR, wintypes.LPCWSTR,
        wintypes.LPCWSTR, wintypes.LPCWSTR, ctypes.c_int,
    ]
    shell32.ShellExecuteW.restype = ctypes.c_void_p
    return int(shell32.ShellExecuteW(None, "open", target, None, None, 1) or 0)


def _find_application_launch_targets(app_name: str) -> list[str]:
    """Resolve friendly app names through Start Menu shortcuts and uninstall metadata."""
    query = _normalize(app_name)
    ranked_targets: list[tuple[int, int, str]] = []

    # Start Menu shortcut names are usually the display names users know (e.g. "Google Chrome").
    start_menu_roots = (
        os.path.join(os.environ.get("APPDATA", ""), "Microsoft", "Windows", "Start Menu", "Programs"),
        os.path.join(os.environ.get("PROGRAMDATA", ""), "Microsoft", "Windows", "Start Menu", "Programs"),
    )
    for root in start_menu_roots:
        if not root or not os.path.isdir(root):
            continue
        for directory, _subdirs, files in os.walk(root):
            for filename in files:
                if not filename.casefold().endswith(".lnk"):
                    continue
                shortcut_name = _normalize(os.path.splitext(filename)[0])
                if shortcut_name == query:
                    ranked_targets.append((0, len(shortcut_name), os.path.join(directory, filename)))
                elif len(query) >= 3 and (query in shortcut_name or shortcut_name in query):
                    ranked_targets.append((1, len(shortcut_name), os.path.join(directory, filename)))

    # Some installed apps have no Start Menu shortcut, but publish their friendly name and
    # executable path under the Windows uninstall registry keys (DisplayName/DisplayIcon).
    try:
        import winreg

        uninstall_key = r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall"
        views = (0, winreg.KEY_WOW64_64KEY, winreg.KEY_WOW64_32KEY)
        for hive in (winreg.HKEY_CURRENT_USER, winreg.HKEY_LOCAL_MACHINE):
            for view in views:
                try:
                    root_key = winreg.OpenKey(hive, uninstall_key, 0, winreg.KEY_READ | view)
                except OSError:
                    continue
                with root_key:
                    index = 0
                    while True:
                        try:
                            subkey_name = winreg.EnumKey(root_key, index)
                        except OSError:
                            break
                        index += 1
                        try:
                            with winreg.OpenKey(root_key, subkey_name) as app_key:
                                display_name = winreg.QueryValueEx(app_key, "DisplayName")[0]
                                display_icon = winreg.QueryValueEx(app_key, "DisplayIcon")[0]
                        except OSError:
                            continue
                        if not isinstance(display_name, str) or not isinstance(display_icon, str):
                            continue
                        normalized_display = _normalize(display_name)
                        if normalized_display == query:
                            rank = 0
                        elif len(query) >= 3 and (query in normalized_display or normalized_display in query):
                            rank = 1
                        else:
                            continue

                        icon_path = display_icon.strip()
                        if icon_path.startswith('"'):
                            icon_path = icon_path[1:].split('"', 1)[0]
                        elif "," in icon_path:
                            icon_path = icon_path.rsplit(",", 1)[0].strip()
                        executable_ext = os.path.splitext(icon_path)[1].casefold()
                        if os.path.isfile(icon_path) and executable_ext in {".exe", ".com", ".bat", ".cmd"}:
                            ranked_targets.append((rank, len(normalized_display), icon_path))
    except (ImportError, OSError):
        pass

    ranked_targets.sort(key=lambda item: (item[0], item[1], item[2].casefold()))
    # Preserve order while removing duplicate targets found in multiple registry views.
    targets: list[str] = []
    seen: set[str] = set()
    for _rank, _length, target in ranked_targets:
        normalized_target = os.path.normcase(os.path.abspath(target))
        if normalized_target not in seen:
            seen.add(normalized_target)
            targets.append(target)
    return targets


@extension.command("control_app")
def control_app(input: Any, context: dict[str, Any], config: dict[str, Any]) -> dict[str, Any]:
    """Open an application or minimize, maximize, or gracefully close its best-matching window."""
    if not isinstance(input, dict):
        raise ValueError("Provide an object with an action and an application name.")

    action = input.get("action") or input.get("operation")
    app_name = input.get("name") or input.get("program") or input.get("app")
    if not isinstance(action, str) or action.strip().casefold() not in {
        "open", "minimize", "maximize", "close"
    }:
        raise ValueError("Action must be one of: open, minimize, maximize, close.")
    action = action.strip().casefold()
    if not isinstance(app_name, str) or not app_name.strip():
        raise ValueError("Provide an application name in the name, program, or app field.")
    app_name = app_name.strip()

    if sys.platform != "win32":
        return {
            "supported": False,
            "action": action,
            "query": app_name,
            "message": "This command is supported on Windows only.",
        }

    if action == "open":
        # Try a supplied executable/path first, then resolve a friendly display name to
        # its Start Menu shortcut or registered executable before falling back to Shell.
        launch_targets = []
        if os.path.exists(app_name):
            launch_targets.append(app_name)
        launch_targets.extend(_find_application_launch_targets(app_name))
        launch_targets.append(app_name)

        tried_targets: set[str] = set()
        last_result_code = 0
        for target in launch_targets:
            normalized_target = (
                os.path.normcase(os.path.abspath(target))
                if os.path.exists(target)
                else target.casefold()
            )
            if normalized_target in tried_targets:
                continue
            tried_targets.add(normalized_target)
            result_code = _shell_execute(target)
            if result_code > 32:
                return {
                    "supported": True,
                    "action": action,
                    "query": app_name,
                    "success": True,
                    "launchedTarget": target,
                    "message": f"Windows accepted the request to open {app_name}.",
                }
            last_result_code = result_code

        raise OSError(
            f"Windows could not find or open an application matching {app_name!r} "
            f"(ShellExecute code {last_result_code})."
        )

    query = _normalize(app_name)
    if not query:
        raise ValueError("The application name must contain at least one searchable character.")
    targets = _find_matching_window_targets(query)
    if not targets:
        return {
            "supported": True,
            "action": action,
            "query": app_name,
            "success": False,
            "matches": [],
            "message": f"No visible application window matching {app_name!r} was found.",
        }

    target = targets[0]
    user32 = ctypes.WinDLL("user32", use_last_error=True)
    hwnd = wintypes.HWND(target["hwnd"])
    if action in {"minimize", "maximize"}:
        user32.IsWindow.argtypes = [wintypes.HWND]
        user32.IsWindow.restype = wintypes.BOOL
        if not user32.IsWindow(hwnd):
            raise OSError("The selected application window no longer exists.")
        user32.ShowWindowAsync.argtypes = [wintypes.HWND, ctypes.c_int]
        user32.ShowWindowAsync.restype = wintypes.BOOL
        show_command = 6 if action == "minimize" else 3
        # This API's return value is the window's previous visibility, not success.
        user32.ShowWindowAsync(hwnd, show_command)
        message = f"Requested {action} for window {target['title']!r}."
    else:
        user32.PostMessageW.argtypes = [wintypes.HWND, wintypes.UINT, ctypes.c_size_t, ctypes.c_ssize_t]
        user32.PostMessageW.restype = wintypes.BOOL
        if not user32.PostMessageW(hwnd, 0x0010, 0, 0):  # WM_CLOSE
            raise ctypes.WinError(ctypes.get_last_error())
        message = f"Requested a graceful close for window {target['title']!r}."

    return {
        "supported": True,
        "action": action,
        "query": app_name,
        "success": True,
        "selectedWindow": {
            "processName": target["processName"],
            "pid": target["pid"],
            "title": target["title"],
        },
        "message": message,
    }


@extension.command("screenshot_app")
def screenshot_app(input: Any, context: dict[str, Any], config: dict[str, Any]) -> dict[str, Any]:
    """Save a full-size screenshot of the selected application's window, then minimize it."""
    if isinstance(input, str):
        app_name = input
        requested_path = None
    elif isinstance(input, dict):
        app_name = input.get("name") or input.get("program") or input.get("app")
        requested_path = input.get("outputPath") or input.get("path")
    else:
        app_name = requested_path = None

    if not isinstance(app_name, str) or not app_name.strip():
        raise ValueError("Provide an application name as a string or in the name, program, or app field.")
    app_name = app_name.strip()
    if sys.platform != "win32":
        return {"supported": False, "query": app_name, "success": False,
                "message": "Screenshot capture is supported on Windows only."}

    query = _normalize(app_name)
    if not query:
        raise ValueError("The application name must contain at least one searchable character.")
    targets = _find_matching_window_targets(query)
    if not targets:
        return {"supported": True, "query": app_name, "success": False, "matches": [],
                "message": f"No visible application window matching {app_name!r} was found."}

    target = targets[0]
    path = _screenshot_path(requested_path)
    user32 = ctypes.WinDLL("user32", use_last_error=True)
    hwnd = wintypes.HWND(target["hwnd"])
    user32.IsIconic.argtypes = [wintypes.HWND]
    user32.IsIconic.restype = wintypes.BOOL
    user32.ShowWindowAsync.argtypes = [wintypes.HWND, ctypes.c_int]
    user32.ShowWindowAsync.restype = wintypes.BOOL
    import time

    was_minimized = bool(user32.IsIconic(hwnd))
    if was_minimized:
        user32.ShowWindowAsync(hwnd, 9)  # SW_RESTORE
        deadline = time.monotonic() + 3.0
        while user32.IsIconic(hwnd) and time.monotonic() < deadline:
            time.sleep(0.05)
        if user32.IsIconic(hwnd):
            raise OSError("Windows could not restore the selected window for screenshot capture.")
        time.sleep(0.25)

    capture_succeeded = False
    window_minimized = False
    try:
        width, height = _capture_window_png(target["hwnd"], path)
        capture_succeeded = True
    finally:
        # A successful capture always ends minimized; failures restore the prior minimized state.
        if capture_succeeded or was_minimized:
            user32.ShowWindowAsync(hwnd, 6)  # SW_MINIMIZE
            deadline = time.monotonic() + 3.0
            while not user32.IsIconic(hwnd) and time.monotonic() < deadline:
                time.sleep(0.05)
            window_minimized = bool(user32.IsIconic(hwnd))
        if capture_succeeded and not window_minimized:
            raise OSError("Screenshot was saved, but Windows could not minimize the selected application window.")

    return {
        "supported": True,
        "success": True,
        "query": app_name,
        "screenshotPath": path,
        "imageFormat": "PNG",
        "width": width,
        "height": height,
        "windowMinimized": window_minimized,
        "capturedWindow": {
            "processName": target["processName"],
            "pid": target["pid"],
            "title": target["title"],
        },
        "message": f"Saved a full-size screenshot of only {target['title']!r}; minimized the application window afterward. No desktop or other application windows were captured.",
    }


@extension.command("check_app_open")
def check_app_open(input: Any, context: dict[str, Any], config: dict[str, Any]) -> dict[str, Any]:
    """Return whether a named application appears in the Windows process list."""
    if isinstance(input, str):
        app_name = input
    elif isinstance(input, dict):
        app_name = input.get("name") or input.get("program") or input.get("app")
    else:
        app_name = None

    if not isinstance(app_name, str) or not app_name.strip():
        raise ValueError("Provide an application name as a string or in the name, program, or app field.")

    if sys.platform != "win32":
        return {
            "supported": False,
            "query": app_name.strip(),
            "isOpen": None,
            "matches": [],
            "message": "This command is supported on Windows only.",
        }

    query = _normalize(app_name)
    if not query:
        raise ValueError("The application name must contain at least one searchable character.")

    matches = _find_matching_processes(query)
    return {
        "supported": True,
        "query": app_name.strip(),
        "isOpen": bool(matches),
        "matches": matches,
        "message": (
            f"Found {len(matches)} matching process(es)."
            if matches
            else "No matching running process was found."
        ),
    }


if __name__ == "__main__":
    extension.run()
