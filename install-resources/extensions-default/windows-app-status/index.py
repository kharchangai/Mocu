from __future__ import annotations

import ctypes
import json
import os
import random
import shutil
import subprocess
import sys
import time
import unicodedata
from ctypes import wintypes
from typing import Any

_EXTENSION_DIR = os.path.dirname(os.path.abspath(__file__))
_VENDOR_DIR = os.path.join(_EXTENSION_DIR, "vendor")
if _VENDOR_DIR not in sys.path:
    sys.path.insert(0, _VENDOR_DIR)
from mocu_extension_sdk import create_extension

extension = create_extension()


class PROCESSENTRY32W(ctypes.Structure):
    _fields_ = [("dwSize", wintypes.DWORD), ("cntUsage", wintypes.DWORD), ("th32ProcessID", wintypes.DWORD),
                ("th32DefaultHeapID", ctypes.c_size_t), ("th32ModuleID", wintypes.DWORD),
                ("cntThreads", wintypes.DWORD), ("th32ParentProcessID", wintypes.DWORD),
                ("pcPriClassBase", wintypes.LONG), ("dwFlags", wintypes.DWORD), ("szExeFile", wintypes.WCHAR * 260)]


def _normalize(value: str) -> str:
    value = unicodedata.normalize("NFKC", value).casefold().strip()
    return value[:-4] if value.endswith(".exe") else value


def _get_visible_window_titles() -> dict[int, list[str]]:
    user32 = ctypes.WinDLL("user32", use_last_error=True)
    titles: dict[int, list[str]] = {}
    proc = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
    user32.IsWindowVisible.argtypes = [wintypes.HWND]
    user32.GetWindowTextLengthW.argtypes = [wintypes.HWND]; user32.GetWindowTextLengthW.restype = ctypes.c_int
    user32.GetWindowTextW.argtypes = [wintypes.HWND, wintypes.LPWSTR, ctypes.c_int]
    user32.GetWindowThreadProcessId.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.DWORD)]
    def collect(hwnd: int, _param: int) -> bool:
        if not user32.IsWindowVisible(hwnd): return True
        size = user32.GetWindowTextLengthW(hwnd)
        if size <= 0: return True
        text = ctypes.create_unicode_buffer(size + 1)
        if user32.GetWindowTextW(hwnd, text, len(text)):
            pid = wintypes.DWORD(); user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
            titles.setdefault(pid.value, []).append(text.value.strip())
        return True
    callback = proc(collect); user32.EnumWindows.argtypes = [proc, wintypes.LPARAM]; user32.EnumWindows.restype = wintypes.BOOL
    if not user32.EnumWindows(callback, 0): raise ctypes.WinError(ctypes.get_last_error())
    return titles


def _find_matching_processes(query: str) -> list[dict[str, Any]]:
    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel.CreateToolhelp32Snapshot.argtypes = [wintypes.DWORD, wintypes.DWORD]; kernel.CreateToolhelp32Snapshot.restype = wintypes.HANDLE
    kernel.Process32FirstW.argtypes = [wintypes.HANDLE, ctypes.POINTER(PROCESSENTRY32W)]; kernel.Process32NextW.argtypes = [wintypes.HANDLE, ctypes.POINTER(PROCESSENTRY32W)]
    kernel.CloseHandle.argtypes = [wintypes.HANDLE]
    snapshot = kernel.CreateToolhelp32Snapshot(2, 0)
    if snapshot == ctypes.c_void_p(-1).value: raise ctypes.WinError(ctypes.get_last_error())
    by_pid = _get_visible_window_titles(); result=[]; entry=PROCESSENTRY32W(); entry.dwSize=ctypes.sizeof(entry)
    try:
        has = kernel.Process32FirstW(snapshot, ctypes.byref(entry))
        while has:
            name=entry.szExeFile; matches=[t for t in by_pid.get(entry.th32ProcessID,[]) if query in _normalize(t)]
            if query in _normalize(os.path.splitext(name)[0]) or matches: result.append({"processName":name,"pid":entry.th32ProcessID,"windowTitles":matches})
            has=kernel.Process32NextW(snapshot,ctypes.byref(entry))
    finally: kernel.CloseHandle(snapshot)
    return result


def _enumerate_visible_windows() -> list[dict[str, Any]]:
    user=ctypes.WinDLL("user32",use_last_error=True); windows=[]; proc=ctypes.WINFUNCTYPE(wintypes.BOOL,wintypes.HWND,wintypes.LPARAM)
    user.IsWindowVisible.argtypes=[wintypes.HWND]; user.GetWindowTextLengthW.argtypes=[wintypes.HWND]; user.GetWindowTextLengthW.restype=ctypes.c_int
    user.GetWindowTextW.argtypes=[wintypes.HWND,wintypes.LPWSTR,ctypes.c_int]; user.GetWindowThreadProcessId.argtypes=[wintypes.HWND,ctypes.POINTER(wintypes.DWORD)]
    def collect(hwnd: int,_param: int)->bool:
        if not user.IsWindowVisible(hwnd): return True
        size=user.GetWindowTextLengthW(hwnd)
        if size<=0:return True
        title=ctypes.create_unicode_buffer(size+1)
        if user.GetWindowTextW(hwnd,title,len(title)):
            pid=wintypes.DWORD();user.GetWindowThreadProcessId(hwnd,ctypes.byref(pid));windows.append({"hwnd":int(hwnd),"pid":pid.value,"title":title.value.strip()})
        return True
    callback=proc(collect);user.EnumWindows.argtypes=[proc,wintypes.LPARAM];user.EnumWindows.restype=wintypes.BOOL
    if not user.EnumWindows(callback,0):raise ctypes.WinError(ctypes.get_last_error())
    return windows


def _find_matching_window_targets(query: str) -> list[dict[str, Any]]:
    processes={p["pid"]:p for p in _find_matching_processes(query)}
    targets=[{**w,"processName":processes[w["pid"]]["processName"]} for w in _enumerate_visible_windows() if w["pid"] in processes]
    targets.sort(key=lambda x:(_normalize(os.path.splitext(x["processName"])[0])!=query,_normalize(x["title"])!=query,len(x["title"])))
    return targets


_UIA_INSPECT_SCRIPT = r"""
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
try {
 Add-Type -AssemblyName UIAutomationClient; Add-Type -AssemblyName UIAutomationTypes
 $payload=[Console]::In.ReadToEnd()|ConvertFrom-Json
 $root=[System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]([long]$payload.hwnd))
 if($null -eq $root){throw 'Windows UI Automation could not access the selected window.'}
 $window=$root.Current;$rootRect=$window.BoundingRectangle
 $desc=$root.FindAll([System.Windows.Automation.TreeScope]::Descendants,[System.Windows.Automation.Automation]::ControlViewCondition)
 $items=New-Object 'System.Collections.Generic.List[object]';$truncated=$false
 foreach($element in $desc){try{
  $c=$element.Current;if($c.IsOffscreen){continue};$r=$c.BoundingRectangle;if($r.IsEmpty -or $r.Width -le 0 -or $r.Height -le 0){continue}
  $name=[string]$c.Name;$aid=[string]$c.AutomationId;$click=$false
  foreach($p in @([System.Windows.Automation.InvokePattern]::Pattern,[System.Windows.Automation.SelectionItemPattern]::Pattern,[System.Windows.Automation.TogglePattern]::Pattern,[System.Windows.Automation.ExpandCollapsePattern]::Pattern)){try{$null=$element.GetCurrentPattern($p);$click=$true;break}catch{}}
  $type=$false;try{$v=$element.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern);$type=-not $v.Current.IsReadOnly}catch{}
  if([string]::IsNullOrWhiteSpace($name) -and [string]::IsNullOrWhiteSpace($aid) -and -not $click -and -not $type -and -not $c.IsKeyboardFocusable){continue}
  if($items.Count -ge [int]$payload.maxElements){$truncated=$true;break}
  $items.Add([ordered]@{id=$items.Count+1;name=$name;automationId=$aid;controlType=[string]$c.ControlType.ProgrammaticName;className=[string]$c.ClassName;enabled=[bool]$c.IsEnabled;keyboardFocusable=[bool]$c.IsKeyboardFocusable;clickable=$click;typeable=$type;bounds=[ordered]@{x=[int][Math]::Round($r.Left);y=[int][Math]::Round($r.Top);width=[int][Math]::Round($r.Width);height=[int][Math]::Round($r.Height);centerX=[int][Math]::Round($r.Left+$r.Width/2);centerY=[int][Math]::Round($r.Top+$r.Height/2)}})
 }catch{}}
 $result=[ordered]@{window=[ordered]@{title=[string]$window.Name;processId=[int]$window.ProcessId;bounds=[ordered]@{x=[int][Math]::Round($rootRect.Left);y=[int][Math]::Round($rootRect.Top);width=[int][Math]::Round($rootRect.Width);height=[int][Math]::Round($rootRect.Height)}};elements=@($items.ToArray());elementCount=$items.Count;truncated=$truncated;coordinateSystem='physical virtual-desktop screen pixels; bounds center is a suggested mouse target'}
 [Console]::Out.WriteLine((ConvertTo-Json -InputObject $result -Depth 8 -Compress))
}catch{[Console]::Error.WriteLine($_.Exception.Message);exit 1}
"""


def _inspect_window_accessibility(hwnd: int,max_elements: int)->dict[str,Any]:
    powershell=shutil.which("powershell.exe") or shutil.which("powershell")
    if not powershell:raise RuntimeError("Windows PowerShell is required for UI Automation inspection.")
    try:result=subprocess.run([powershell,"-NoLogo","-NoProfile","-NonInteractive","-ExecutionPolicy","Bypass","-Command",_UIA_INSPECT_SCRIPT],input=json.dumps({"hwnd":hwnd,"maxElements":max_elements}),capture_output=True,text=True,encoding="utf-8",errors="replace",timeout=30,creationflags=getattr(subprocess,"CREATE_NO_WINDOW",0),check=False)
    except subprocess.TimeoutExpired as exc:raise RuntimeError("Windows UI Automation timed out while inspecting this application.") from exc
    if result.returncode:raise RuntimeError(f"Windows UI Automation failed: {(result.stderr.strip() or result.stdout.strip())[:1200]}")
    try:data=json.loads(result.stdout)
    except json.JSONDecodeError as exc:raise RuntimeError("Windows UI Automation returned invalid JSON.") from exc
    if not isinstance(data,dict) or not isinstance(data.get("elements"),list):raise RuntimeError("Windows UI Automation returned an unexpected result.")
    return data


class _MOUSEINPUT(ctypes.Structure):_fields_=[("dx",wintypes.LONG),("dy",wintypes.LONG),("mouseData",wintypes.DWORD),("dwFlags",wintypes.DWORD),("time",wintypes.DWORD),("dwExtraInfo",ctypes.c_size_t)]
class _KEYBDINPUT(ctypes.Structure):_fields_=[("wVk",wintypes.WORD),("wScan",wintypes.WORD),("dwFlags",wintypes.DWORD),("time",wintypes.DWORD),("dwExtraInfo",ctypes.c_size_t)]
class _INPUTUNION(ctypes.Union):_fields_=[("mi",_MOUSEINPUT),("ki",_KEYBDINPUT)]
class _INPUT(ctypes.Structure):_fields_=[("type",wintypes.DWORD),("payload",_INPUTUNION)]


def _mouse_event(dx:int=0,dy:int=0,data:int=0,flags:int=0)->_INPUT:
    event=_INPUT();event.type=0;event.payload.mi=_MOUSEINPUT(dx,dy,data&0xffffffff,flags,0,0);return event

def _keyboard_event(vk:int,flags:int=0,scan:int=0)->_INPUT:
    event=_INPUT();event.type=1;event.payload.ki=_KEYBDINPUT(vk,scan,flags,0,0);return event

def _send_desktop_inputs(events:list[_INPUT])->None:
    if not events:return
    user=ctypes.WinDLL("user32",use_last_error=True);user.SendInput.argtypes=[wintypes.UINT,ctypes.POINTER(_INPUT),ctypes.c_int];user.SendInput.restype=wintypes.UINT
    array=(_INPUT*len(events))(*events);sent=user.SendInput(len(events),array,ctypes.sizeof(_INPUT))
    if sent!=len(events):raise OSError(f"Windows accepted {sent} of {len(events)} input events (error {ctypes.get_last_error()}). The target app may run with higher privileges.")

def _enable_physical_dpi_awareness()->None:
    user=ctypes.WinDLL("user32",use_last_error=True)
    try:set_context=user.SetThreadDpiAwarenessContext
    except AttributeError as exc:raise RuntimeError("Physical-pixel mouse control requires Windows 10 or later.") from exc
    set_context.argtypes=[wintypes.HANDLE];set_context.restype=wintypes.HANDLE
    if not set_context(ctypes.c_void_p(-4)):raise ctypes.WinError(ctypes.get_last_error())

def _mouse_move_event(x:Any,y:Any)->tuple[_INPUT,tuple[int,int]]:
    if isinstance(x,bool) or not isinstance(x,int) or isinstance(y,bool) or not isinstance(y,int):raise ValueError("Mouse coordinates x and y must be integers in physical screen pixels.")
    _enable_physical_dpi_awareness();user=ctypes.WinDLL("user32",use_last_error=True);user.GetSystemMetrics.argtypes=[ctypes.c_int];user.GetSystemMetrics.restype=ctypes.c_int
    left,top=user.GetSystemMetrics(76),user.GetSystemMetrics(77);width,height=user.GetSystemMetrics(78),user.GetSystemMetrics(79)
    if width<=0 or height<=0 or not(left<=x<left+width and top<=y<top+height):raise ValueError(f"Physical-pixel coordinates must be inside virtual desktop ({left},{top}) to ({left+width-1},{top+height-1}).")
    ax=round((x-left)*65535/max(width-1,1));ay=round((y-top)*65535/max(height-1,1))
    return _mouse_event(ax,ay,flags=0x0001|0x8000|0x4000),(x,y)

class _POINT(ctypes.Structure):_fields_=[("x",wintypes.LONG),("y",wintypes.LONG)]

def _move_pointer_smoothly(x:Any,y:Any)->tuple[int,int]:
    _mouse_move_event(x,y);target=(x,y);user=ctypes.WinDLL("user32",use_last_error=True)
    user.GetCursorPos.argtypes=[ctypes.POINTER(_POINT)];user.GetCursorPos.restype=wintypes.BOOL;user.GetSystemMetrics.argtypes=[ctypes.c_int];user.GetSystemMetrics.restype=ctypes.c_int
    left,top=user.GetSystemMetrics(76),user.GetSystemMetrics(77);right=left+user.GetSystemMetrics(78)-1;bottom=top+user.GetSystemMetrics(79)-1
    start=_POINT()
    if not user.GetCursorPos(ctypes.byref(start)):raise ctypes.WinError(ctypes.get_last_error())
    sx,sy=start.x,start.y;distance=((x-sx)**2+(y-sy)**2)**0.5
    if distance<1:return target
    steps=max(12,min(80,int(distance/12)));duration=min(1.4,0.25+distance/1600);px,py=-(y-sy)/distance,(x-sx)/distance;curve=random.uniform(-1,1)*min(24,distance*0.06)
    c1=(sx+(x-sx)*0.28+px*curve,sy+(y-sy)*0.28+py*curve);c2=(sx+(x-sx)*0.72+px*curve*random.uniform(0.4,1.2),sy+(y-sy)*0.72+py*curve*random.uniform(0.4,1.2))
    for step in range(1,steps+1):
        t=step/steps;e=t*t*(3-2*t);inv=1-e
        if step==steps:mx,my=target
        else:mx=round(inv**3*sx+3*inv**2*e*c1[0]+3*inv*e**2*c2[0]+e**3*x);my=round(inv**3*sy+3*inv**2*e*c1[1]+3*inv*e**2*c2[1]+e**3*y)
        event,_=_mouse_move_event(max(left,min(right,mx)),max(top,min(bottom,my)));_send_desktop_inputs([event])
        if step<steps:time.sleep(duration/steps*random.uniform(0.8,1.2))
    return target

def _resolve_virtual_key(key:Any)->int:
    if not isinstance(key,str) or not key.strip():raise ValueError("Provide a key name, such as Enter, Escape, A, or F5.")
    name=key.strip().casefold().replace(" ","").replace("_","")
    aliases={"enter":13,"return":13,"tab":9,"esc":27,"escape":27,"backspace":8,"delete":46,"del":46,"insert":45,"ins":45,"home":36,"end":35,"pageup":33,"pagedown":34,"up":38,"arrowup":38,"down":40,"arrowdown":40,"left":37,"arrowleft":37,"right":39,"arrowright":39,"space":32,"shift":16,"ctrl":17,"control":17,"alt":18,"win":91,"windows":91,"meta":91,"capslock":20,"numlock":144,"scrolllock":145,"printscreen":44,"pause":19,"menu":93,"semicolon":186,"equals":187,"comma":188,"minus":189,"period":190,"slash":191,"backtick":192,"leftbracket":219,"backslash":220,"rightbracket":221,"quote":222}
    if name in aliases:return aliases[name]
    if len(name)==1 and name.isascii() and name.isalnum():return ord(name.upper())
    if name.startswith("f") and name[1:].isdigit() and 1<=int(name[1:])<=24:return 0x70+int(name[1:])-1
    raise ValueError(f"Unsupported key name {key!r}. Use a named key, A-Z, 0-9, or F1-F24.")

@extension.command("desktop_input")
def desktop_input(input:Any,context:dict[str,Any],config:dict[str,Any])->dict[str,Any]:
    """Move/click/scroll the desktop mouse or send keyboard input on Windows."""
    if not isinstance(input,dict):raise ValueError("Provide an object with an action and relevant mouse or keyboard fields.")
    action=input.get("action") or input.get("operation")
    if not isinstance(action,str) or action.strip().casefold() not in {"move","click","scroll","press_key","hotkey","type_text"}:raise ValueError("Action must be move, click, scroll, press_key, hotkey, or type_text.")
    action=action.strip().casefold()
    if sys.platform!="win32":return {"supported":False,"success":False,"action":action,"message":"Desktop mouse and keyboard input is supported on Windows only."}
    if action=="move":
        pos=_move_pointer_smoothly(input.get("x"),input.get("y"));return {"supported":True,"success":True,"action":action,"position":{"x":pos[0],"y":pos[1]},"message":f"Moved pointer to physical pixels ({pos[0]}, {pos[1]})."}
    if action=="click":
        button=input.get("button","left");flags={"left":(2,4),"right":(8,16),"middle":(32,64)}
        if not isinstance(button,str) or button.strip().casefold() not in flags:raise ValueError("button must be left, right, or middle.")
        button=button.strip().casefold();count=input.get("count",1)
        if isinstance(count,bool) or not isinstance(count,int) or not 1<=count<=10:raise ValueError("count must be an integer from 1 to 10.")
        pos=None
        if "x" in input or "y" in input:
            if "x" not in input or "y" not in input:raise ValueError("Provide both x and y before clicking.")
            pos=_move_pointer_smoothly(input["x"],input["y"]);time.sleep(random.uniform(0.08,0.18))
        down,up=flags[button]
        for i in range(count):
            _send_desktop_inputs([_mouse_event(flags=down)]);time.sleep(random.uniform(0.055,0.12));_send_desktop_inputs([_mouse_event(flags=up)])
            if i+1<count:time.sleep(random.uniform(0.09,0.17))
        result={"supported":True,"success":True,"action":action,"button":button,"count":count,"message":f"Clicked {button} button {count} time(s)."}
        if pos:result["position"]={"x":pos[0],"y":pos[1]}
        return result
    if action=="scroll":
        delta=input.get("delta",120);direction=input.get("direction","vertical")
        if isinstance(delta,bool) or not isinstance(delta,int) or delta==0 or abs(delta)>1200:raise ValueError("delta must be a non-zero integer from -1200 to 1200.")
        if not isinstance(direction,str) or direction.strip().casefold() not in {"vertical","horizontal"}:raise ValueError("direction must be vertical or horizontal.")
        pos=None
        if "x" in input or "y" in input:
            if "x" not in input or "y" not in input:raise ValueError("Provide both x and y before scrolling.")
            pos=_move_pointer_smoothly(input["x"],input["y"])
        _send_desktop_inputs([_mouse_event(data=delta,flags=0x0800 if direction.strip().casefold()=="vertical" else 0x1000)])
        result={"supported":True,"success":True,"action":action,"direction":direction.strip().casefold(),"delta":delta,"message":f"Scrolled {direction.strip().casefold()} by {delta} wheel units."}
        if pos:result["position"]={"x":pos[0],"y":pos[1]}
        return result
    if action=="press_key":
        key=input.get("key");vk=_resolve_virtual_key(key);_send_desktop_inputs([_keyboard_event(vk),_keyboard_event(vk,2)])
        return {"supported":True,"success":True,"action":action,"key":key,"message":f"Pressed key {key!r}."}
    if action=="hotkey":
        keys=input.get("keys")
        if not isinstance(keys,list) or not 1<=len(keys)<=8:raise ValueError("keys must be a list of 1 to 8 key names.")
        vks=[_resolve_virtual_key(k) for k in keys]
        if len(set(vks))!=len(vks):raise ValueError("Hotkeys must not contain duplicate keys.")
        _send_desktop_inputs([*[_keyboard_event(v) for v in vks],*[_keyboard_event(v,2) for v in reversed(vks)]])
        return {"supported":True,"success":True,"action":action,"keys":keys,"message":f"Sent {'+'.join(map(str,keys))} shortcut."}
    text=input.get("text")
    if not isinstance(text,str) or not text:raise ValueError("text must be a non-empty string.")
    if len(text)>5000:raise ValueError("text is limited to 5000 characters per request.")
    for i,char in enumerate(text):
        encoded=char.encode("utf-16-le");units=[int.from_bytes(encoded[j:j+2],"little") for j in range(0,len(encoded),2)];events=[]
        for unit in units:events.extend((_keyboard_event(0,4,unit),_keyboard_event(0,6,unit)))
        _send_desktop_inputs(events)
        if i+1<len(text):
            delay=random.uniform(0.045,0.105)
            if char in ".,!?:;\n":delay+=random.uniform(0.12,0.28)
            elif char.isspace():delay+=random.uniform(0.015,0.045)
            time.sleep(delay)
    return {"supported":True,"success":True,"action":action,"characters":len(text),"message":f"Typed {len(text)} character(s) into the focused application."}


def _png_chunk(kind:bytes,data:bytes)->bytes:
    import struct,zlib
    body=kind+data;return struct.pack(">I",len(data))+body+struct.pack(">I",zlib.crc32(body)&0xffffffff)

def _write_png(path:str,width:int,height:int,bgra:bytes)->None:
    import struct,zlib
    if width<=0 or height<=0 or len(bgra)!=width*height*4:raise ValueError("Captured window image has invalid dimensions or pixel data.")
    raw=bytearray();stride=width*4
    for y in range(height):
        raw.append(0);row=bgra[y*stride:(y+1)*stride]
        for x in range(width):p=x*4;raw.extend((row[p+2],row[p+1],row[p]))
    data=b"\x89PNG\r\n\x1a\n"+_png_chunk(b"IHDR",struct.pack(">IIBBBBB",width,height,8,2,0,0,0))+_png_chunk(b"IDAT",zlib.compress(bytes(raw)))+_png_chunk(b"IEND",b"")
    with open(path,"xb") as f:f.write(data)

def _set_physical_pixel_dpi_context(user:Any)->tuple[Any,Any]|None:
    try:set_context=user.SetThreadDpiAwarenessContext
    except AttributeError:return None
    set_context.argtypes=[wintypes.HANDLE];set_context.restype=wintypes.HANDLE;previous=set_context(ctypes.c_void_p(-4))
    if not previous:raise ctypes.WinError(ctypes.get_last_error())
    return set_context,previous

def _capture_window_png(hwnd_value:int,path:str)->tuple[int,int]:
    class RECT(ctypes.Structure):_fields_=[("left",wintypes.LONG),("top",wintypes.LONG),("right",wintypes.LONG),("bottom",wintypes.LONG)]
    class HEADER(ctypes.Structure):_fields_=[("biSize",wintypes.DWORD),("biWidth",wintypes.LONG),("biHeight",wintypes.LONG),("biPlanes",wintypes.WORD),("biBitCount",wintypes.WORD),("biCompression",wintypes.DWORD),("biSizeImage",wintypes.DWORD),("biXPelsPerMeter",wintypes.LONG),("biYPelsPerMeter",wintypes.LONG),("biClrUsed",wintypes.DWORD),("biClrImportant",wintypes.DWORD)]
    class RGB(ctypes.Structure):_fields_=[("b",ctypes.c_ubyte),("g",ctypes.c_ubyte),("r",ctypes.c_ubyte),("a",ctypes.c_ubyte)]
    class INFO(ctypes.Structure):_fields_=[("bmiHeader",HEADER),("bmiColors",RGB*1)]
    user=ctypes.WinDLL("user32",use_last_error=True);gdi=ctypes.WinDLL("gdi32",use_last_error=True);hwnd=wintypes.HWND(hwnd_value)
    user.IsWindow.argtypes=[wintypes.HWND];user.IsIconic.argtypes=[wintypes.HWND];user.GetWindowRect.argtypes=[wintypes.HWND,ctypes.POINTER(RECT)];user.GetWindowDC.argtypes=[wintypes.HWND];user.GetWindowDC.restype=wintypes.HDC;user.ReleaseDC.argtypes=[wintypes.HWND,wintypes.HDC];user.PrintWindow.argtypes=[wintypes.HWND,wintypes.HDC,wintypes.UINT];user.PrintWindow.restype=wintypes.BOOL
    gdi.CreateCompatibleDC.argtypes=[wintypes.HDC];gdi.CreateCompatibleDC.restype=wintypes.HDC;gdi.CreateDIBSection.argtypes=[wintypes.HDC,ctypes.POINTER(INFO),wintypes.UINT,ctypes.POINTER(ctypes.c_void_p),wintypes.HANDLE,wintypes.DWORD];gdi.CreateDIBSection.restype=ctypes.c_void_p;gdi.SelectObject.argtypes=[wintypes.HDC,ctypes.c_void_p];gdi.SelectObject.restype=ctypes.c_void_p;gdi.DeleteObject.argtypes=[ctypes.c_void_p];gdi.DeleteDC.argtypes=[wintypes.HDC]
    dpi=_set_physical_pixel_dpi_context(user)
    try:
        if not user.IsWindow(hwnd):raise OSError("Selected application window no longer exists.")
        if user.IsIconic(hwnd):raise OSError("Selected window is minimized; restore it before capturing.")
        rect=RECT()
        if not user.GetWindowRect(hwnd,ctypes.byref(rect)):raise ctypes.WinError(ctypes.get_last_error())
        w,h=rect.right-rect.left,rect.bottom-rect.top
        if w<=0 or h<=0 or w>12000 or h>12000 or w*h>50_000_000:raise ValueError("Selected window has invalid or excessively large dimensions.")
        info=INFO();info.bmiHeader.biSize=ctypes.sizeof(HEADER);info.bmiHeader.biWidth=w;info.bmiHeader.biHeight=-h;info.bmiHeader.biPlanes=1;info.bmiHeader.biBitCount=32;info.bmiHeader.biCompression=0;info.bmiHeader.biSizeImage=w*h*4
        dc=user.GetWindowDC(hwnd)
        if not dc:raise ctypes.WinError(ctypes.get_last_error())
        mem=bitmap=old=None
        try:
            mem=gdi.CreateCompatibleDC(dc)
            if not mem:raise ctypes.WinError(ctypes.get_last_error())
            ptr=ctypes.c_void_p();bitmap=gdi.CreateDIBSection(dc,ctypes.byref(info),0,ctypes.byref(ptr),None,0)
            if not bitmap or not ptr.value:raise ctypes.WinError(ctypes.get_last_error())
            old=gdi.SelectObject(mem,bitmap)
            if not old or old==ctypes.c_void_p(-1).value:raise ctypes.WinError(ctypes.get_last_error())
            if not user.PrintWindow(hwnd,mem,2):raise OSError("Windows could not render this application window.")
            pixels=ctypes.string_at(ptr.value,w*h*4)
        finally:
            if mem and old:gdi.SelectObject(mem,old)
            if bitmap:gdi.DeleteObject(bitmap)
            if mem:gdi.DeleteDC(mem)
            user.ReleaseDC(hwnd,dc)
        _write_png(path,w,h,pixels);return w,h
    finally:
        if dpi:
            setter,previous=dpi
            if not setter(previous):raise ctypes.WinError(ctypes.get_last_error())

def _screenshot_path(requested:Any)->str:
    pictures=os.path.join(os.path.expanduser("~"),"Pictures")
    if requested is None or requested=="":folder=os.path.join(pictures,"Windows App Status");path=os.path.join(folder,f"screenshot_{time.strftime('%Y%m%d_%H%M%S')}_{time.time_ns()%1_000_000_000:09d}.png")
    elif isinstance(requested,str) and requested.strip():
        path=os.path.expandvars(os.path.expanduser(requested.strip()))
        if not os.path.isabs(path):path=os.path.join(pictures,path)
        if not path.casefold().endswith(".png"):raise ValueError("Screenshot output path must end with .png.")
        path=os.path.abspath(path)
    else:raise ValueError("outputPath must be a non-empty path string.")
    os.makedirs(os.path.dirname(path),exist_ok=True);return path

def _shell_execute(target:str)->int:
    shell=ctypes.WinDLL("shell32",use_last_error=True);shell.ShellExecuteW.argtypes=[wintypes.HWND,wintypes.LPCWSTR,wintypes.LPCWSTR,wintypes.LPCWSTR,wintypes.LPCWSTR,ctypes.c_int];shell.ShellExecuteW.restype=ctypes.c_void_p
    return int(shell.ShellExecuteW(None,"open",target,None,None,1) or 0)

def _find_application_launch_targets(app:str)->list[str]:
    query=_normalize(app);ranked=[];roots=(os.path.join(os.environ.get("APPDATA",""),"Microsoft","Windows","Start Menu","Programs"),os.path.join(os.environ.get("PROGRAMDATA",""),"Microsoft","Windows","Start Menu","Programs"))
    for root in roots:
        if not root or not os.path.isdir(root):continue
        for directory,_dirs,files in os.walk(root):
            for name in files:
                if not name.casefold().endswith(".lnk"):continue
                candidate=_normalize(os.path.splitext(name)[0])
                if candidate==query:ranked.append((0,len(candidate),os.path.join(directory,name)))
                elif len(query)>=3 and(query in candidate or candidate in query):ranked.append((1,len(candidate),os.path.join(directory,name)))
    try:
        import winreg
        key_path=r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall"
        for hive in(winreg.HKEY_CURRENT_USER,winreg.HKEY_LOCAL_MACHINE):
            for view in(0,winreg.KEY_WOW64_64KEY,winreg.KEY_WOW64_32KEY):
                try:key=winreg.OpenKey(hive,key_path,0,winreg.KEY_READ|view)
                except OSError:continue
                with key:
                    i=0
                    while True:
                        try:sub=winreg.EnumKey(key,i)
                        except OSError:break
                        i+=1
                        try:
                            with winreg.OpenKey(key,sub) as item:name=winreg.QueryValueEx(item,"DisplayName")[0];icon=winreg.QueryValueEx(item,"DisplayIcon")[0]
                        except OSError:continue
                        if not isinstance(name,str) or not isinstance(icon,str):continue
                        normalized=_normalize(name);rank=0 if normalized==query else 1 if len(query)>=3 and(query in normalized or normalized in query) else -1
                        if rank<0:continue
                        path=icon.strip()
                        if path.startswith('"'):path=path[1:].split('"',1)[0]
                        elif "," in path:path=path.rsplit(",",1)[0].strip()
                        if os.path.isfile(path) and os.path.splitext(path)[1].casefold() in{".exe",".com",".bat",".cmd"}:ranked.append((rank,len(normalized),path))
    except(ImportError,OSError):pass
    result=[];seen=set()
    for _r,_n,path in sorted(ranked,key=lambda x:(x[0],x[1],x[2].casefold())):
        key=os.path.normcase(os.path.abspath(path))
        if key not in seen:seen.add(key);result.append(path)
    return result

@extension.command("control_app")
def control_app(input:Any,context:dict[str,Any],config:dict[str,Any])->dict[str,Any]:
    """Open, minimize, maximize, or gracefully close a Windows application."""
    if not isinstance(input,dict):raise ValueError("Provide an object with an action and application name.")
    action=input.get("action")or input.get("operation");app=input.get("name")or input.get("program")or input.get("app")
    if not isinstance(action,str)or action.strip().casefold()not in{"open","minimize","maximize","close"}:raise ValueError("Action must be open, minimize, maximize, or close.")
    action=action.strip().casefold()
    if not isinstance(app,str)or not app.strip():raise ValueError("Provide an application name.")
    app=app.strip()
    if sys.platform!="win32":return{"supported":False,"action":action,"query":app,"message":"This command is supported on Windows only."}
    if action=="open":
        tried=set();last=0
        for target in(([app]if os.path.exists(app)else[])+_find_application_launch_targets(app)+[app]):
            key=os.path.normcase(os.path.abspath(target))if os.path.exists(target)else target.casefold()
            if key in tried:continue
            tried.add(key);code=_shell_execute(target)
            if code>32:return{"supported":True,"action":action,"query":app,"success":True,"launchedTarget":target,"message":f"Windows accepted the request to open {app}."}
            last=code
        raise OSError(f"Could not open {app!r} (ShellExecute code {last}).")
    query=_normalize(app)
    if not query:raise ValueError("Application name must contain searchable characters.")
    matches=_find_matching_window_targets(query)
    if not matches:return{"supported":True,"action":action,"query":app,"success":False,"matches":[],"message":f"No visible application window matching {app!r} was found."}
    target=matches[0];user=ctypes.WinDLL("user32",use_last_error=True);hwnd=wintypes.HWND(target["hwnd"])
    if action in{"minimize","maximize"}:
        user.IsWindow.argtypes=[wintypes.HWND];user.IsWindow.restype=wintypes.BOOL
        if not user.IsWindow(hwnd):raise OSError("Selected window no longer exists.")
        user.ShowWindowAsync.argtypes=[wintypes.HWND,ctypes.c_int];user.ShowWindowAsync(hwnd,6 if action=="minimize"else 3);message=f"Requested {action} for {target['title']!r}."
    else:
        user.PostMessageW.argtypes=[wintypes.HWND,wintypes.UINT,ctypes.c_size_t,ctypes.c_ssize_t];user.PostMessageW.restype=wintypes.BOOL
        if not user.PostMessageW(hwnd,0x10,0,0):raise ctypes.WinError(ctypes.get_last_error())
        message=f"Requested graceful close for {target['title']!r}."
    return{"supported":True,"action":action,"query":app,"success":True,"selectedWindow":{"processName":target["processName"],"pid":target["pid"],"title":target["title"]},"message":message}

@extension.command("screenshot_app")
def screenshot_app(input:Any,context:dict[str,Any],config:dict[str,Any])->dict[str,Any]:
    """Capture a selected application window (not the desktop), then minimize it."""
    if isinstance(input,str):app,path=input,None
    elif isinstance(input,dict):app=input.get("name")or input.get("program")or input.get("app");path=input.get("outputPath")or input.get("path")
    else:app=path=None
    if not isinstance(app,str)or not app.strip():raise ValueError("Provide an application name.")
    app=app.strip()
    if sys.platform!="win32":return{"supported":False,"query":app,"success":False,"message":"Screenshot capture is supported on Windows only."}
    query=_normalize(app)
    if not query:raise ValueError("Application name must contain searchable characters.")
    targets=_find_matching_window_targets(query)
    if not targets:return{"supported":True,"query":app,"success":False,"matches":[],"message":f"No visible application window matching {app!r} was found."}
    target=targets[0];destination=_screenshot_path(path);user=ctypes.WinDLL("user32",use_last_error=True);hwnd=wintypes.HWND(target["hwnd"])
    user.IsIconic.argtypes=[wintypes.HWND];user.IsIconic.restype=wintypes.BOOL;user.ShowWindowAsync.argtypes=[wintypes.HWND,ctypes.c_int];was_minimized=bool(user.IsIconic(hwnd))
    if was_minimized:
        user.ShowWindowAsync(hwnd,9);deadline=time.monotonic()+3
        while user.IsIconic(hwnd)and time.monotonic()<deadline:time.sleep(.05)
        if user.IsIconic(hwnd):raise OSError("Could not restore the selected window for capture.")
        time.sleep(.25)
    captured=False;minimized=False
    try:width,height=_capture_window_png(target["hwnd"],destination);captured=True
    finally:
        if captured or was_minimized:
            user.ShowWindowAsync(hwnd,6);deadline=time.monotonic()+3
            while not user.IsIconic(hwnd)and time.monotonic()<deadline:time.sleep(.05)
            minimized=bool(user.IsIconic(hwnd))
        if captured and not minimized:raise OSError("Screenshot saved, but Windows could not minimize the window.")
    return{"supported":True,"success":True,"query":app,"screenshotPath":destination,"imageFormat":"PNG","width":width,"height":height,"windowMinimized":minimized,"capturedWindow":{"processName":target["processName"],"pid":target["pid"],"title":target["title"]},"message":f"Saved a full-size screenshot of only {target['title']!r}; minimized the app window. No desktop or other windows were captured."}

@extension.command("inspect_app_ui")
def inspect_app_ui(input:Any,context:dict[str,Any],config:dict[str,Any])->dict[str,Any]:
    """List visible accessible controls in a Windows app with physical screen bounds."""
    if isinstance(input,str):app,max_elements=input,1000
    elif isinstance(input,dict):app=input.get("name")or input.get("program")or input.get("app");max_elements=input.get("maxElements",1000)
    else:app,max_elements=None,1000
    if not isinstance(app,str)or not app.strip():raise ValueError("Provide an application name.")
    if isinstance(max_elements,bool)or not isinstance(max_elements,int)or not 1<=max_elements<=2000:raise ValueError("maxElements must be an integer from 1 to 2000.")
    app=app.strip()
    if sys.platform!="win32":return{"supported":False,"success":False,"query":app,"message":"UI Automation inspection is supported on Windows only."}
    query=_normalize(app)
    if not query:raise ValueError("Application name must contain searchable characters.")
    targets=_find_matching_window_targets(query)
    if not targets:return{"supported":True,"success":False,"query":app,"elements":[],"message":f"No visible application window matching {app!r} was found."}
    target=targets[0];result=_inspect_window_accessibility(target["hwnd"],max_elements)
    result.update({"supported":True,"success":True,"query":app,"selectedWindow":{"processName":target["processName"],"pid":target["pid"],"title":target["title"]},"message":f"Found {result['elementCount']} visible accessible UI element(s) in {target['title']!r}."+(" Results truncated; increase maxElements (up to 2000)."if result["truncated"]else"")})
    return result

@extension.command("check_app_open")
def check_app_open(input:Any,context:dict[str,Any],config:dict[str,Any])->dict[str,Any]:
    """Return whether an application appears in the Windows process list."""
    if isinstance(input,str):app=input
    elif isinstance(input,dict):app=input.get("name")or input.get("program")or input.get("app")
    else:app=None
    if not isinstance(app,str)or not app.strip():raise ValueError("Provide an application name.")
    app=app.strip()
    if sys.platform!="win32":return{"supported":False,"query":app,"isOpen":None,"matches":[],"message":"This command is supported on Windows only."}
    query=_normalize(app)
    if not query:raise ValueError("Application name must contain searchable characters.")
    matches=_find_matching_processes(query)
    return{"supported":True,"query":app,"isOpen":bool(matches),"matches":matches,"message":f"Found {len(matches)} matching process(es)."if matches else"No matching running process was found."}

if __name__=="__main__":extension.run()
