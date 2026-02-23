#!/usr/bin/env python3
"""
3 Tomoe Desktop UI Controller

Serves the frontend and provides local API endpoints for OS interaction.

Endpoints:
  GET  /                         -> UI (index.html)
  GET  /api/health               -> basic status
  GET  /api/weather              -> current weather (Open-Meteo)
  GET  /api/applications         -> applications list from config.json
  GET  /api/execute-app?cmd=...  -> launch configured application
  POST /api/execute-app          -> launch configured application (JSON {"cmd": "..."})

Environment:
  TOMOE_PORT (default: 5055)
  TOMOE_UI_DIR (default: ./3tomoe-desktop-ui)
  TOMOE_ALLOW_UNCONFIGURED (default: false)

  WEATHER_LAT / WEATHER_LON (defaults if query params omitted)
  WEATHER_UNITS (fahrenheit|celsius)
  WEATHER_LABEL (optional location label)
  WEATHER_CACHE_TTL (seconds, default: 600)
"""

import json
import mimetypes
import os
import hashlib
import subprocess
import time
import ctypes
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib import parse as urlparse
from urllib import request as urlrequest

from threefetch import get_system_info
from threetop import get_system_live, psutil, _psutil_error

BASE_DIR = Path(__file__).resolve().parent
UI_DIR = Path(os.environ.get("TOMOE_UI_DIR") or BASE_DIR).resolve()
CONFIG_PATH = UI_DIR / 'config.json'
ENV_LOG_DIR = os.environ.get('TOMOE_LOG_DIR')
if ENV_LOG_DIR:
    LOG_DIR = Path(ENV_LOG_DIR).resolve()
elif BASE_DIR.name == '3tomoe-desktop-ui':
    temp_base = os.environ.get('TEMP') or os.environ.get('TMP')
    if temp_base:
        LOG_DIR = (Path(temp_base) / '3tomoe').resolve()
    else:
        LOG_DIR = (BASE_DIR.parent / 'logs' / '3tomoe').resolve()
else:
    LOG_DIR = (BASE_DIR / 'logs').resolve()
LOG_PATH = LOG_DIR / '3tomoe.log'

ALLOW_UNCONFIGURED = os.environ.get('TOMOE_ALLOW_UNCONFIGURED', '').strip().lower() in ('1', 'true', 'yes')

WEATHER_CACHE = {}
WEATHER_CACHE_TTL = int(os.environ.get('WEATHER_CACHE_TTL', '600'))

START_MENU_ROOTS = [
    Path(r'C:\ProgramData\Microsoft\Windows\Start Menu'),
    Path(r'C:\ProgramData\Microsoft\Windows\Start Menu\Programs'),
    Path(os.path.expandvars(r'%APPDATA%\Microsoft\Windows\Start Menu')),
    Path(os.path.expandvars(r'%APPDATA%\Microsoft\Windows\Start Menu\Programs')),
]
START_MENU_EXTENSIONS = {'.lnk', '.url', '.exe', '.bat', '.cmd', '.msc', '.appref-ms'}
START_MENU_CACHE = {'entries': [], 'stamp': ''}
START_MENU_ICON_CACHE = {}
APP_ICON_DIR = UI_DIR / 'static' / 'image' / 'app'

LOG_DIR.mkdir(parents=True, exist_ok=True)


def log_event(message):
    if not message:
        return
    timestamp = time.strftime('%Y-%m-%d %H:%M:%S')
    line = f'[{timestamp}] {message}\n'
    try:
        with LOG_PATH.open('a', encoding='utf-8') as log_file:
            log_file.write(line)
    except Exception:
        return


def load_config():
    if not CONFIG_PATH.exists():
        return {}
    try:
        return json.loads(CONFIG_PATH.read_text(encoding='utf-8'))
    except Exception:
        return {}


def _start_menu_stamp():
    parts = []
    for root in START_MENU_ROOTS:
        if not root.exists():
            continue
        try:
            parts.append(f'{root}:{int(root.stat().st_mtime_ns)}')
            for path in root.rglob('*'):
                if not path.is_file():
                    continue
                suffix = path.suffix.lower()
                if suffix not in START_MENU_EXTENSIONS:
                    continue
                stat = path.stat()
                parts.append(f'{path}:{int(stat.st_mtime_ns)}:{int(stat.st_size)}')
        except Exception:
            continue
    if not parts:
        return ''
    digest = hashlib.sha1('\n'.join(parts).encode('utf-8', errors='ignore')).hexdigest()
    return digest


def _normalize_app_name(stem):
    text = (stem or '').replace('_', ' ').replace('-', ' ').strip()
    return ' '.join(text.split())


# Names containing any of these words are filtered out of Start Menu results.
_START_MENU_FILTER_WORDS = {'uninstall', 'changelog', 'release notes', 'readme'}


def _build_start_menu_index(force=False):
    stamp = _start_menu_stamp()
    if not force and stamp and stamp == START_MENU_CACHE.get('stamp'):
        return START_MENU_CACHE.get('entries', [])

    entries = []
    seen_paths = set()
    seen_names = set()
    for root in START_MENU_ROOTS:
        if not root.exists():
            continue
        try:
            for path in root.rglob('*'):
                if not path.is_file():
                    continue
                suffix = path.suffix.lower()
                if suffix not in START_MENU_EXTENSIONS:
                    continue
                norm_path = str(path).lower()
                if norm_path in seen_paths:
                    continue
                seen_paths.add(norm_path)
                name = _normalize_app_name(path.stem)
                if not name:
                    continue
                # Filter out uninstall, changelog, etc.
                name_lower = name.lower()
                if any(word in name_lower for word in _START_MENU_FILTER_WORDS):
                    continue
                # Deduplicate by name (keep first occurrence)
                if name_lower in seen_names:
                    continue
                seen_names.add(name_lower)
                entry_id = hashlib.sha1(norm_path.encode('utf-8', errors='ignore')).hexdigest()[:16]
                entries.append({
                    'id': entry_id,
                    'name': name,
                    'path': str(path),
                    'command': f'startmenu://{entry_id}',
                    'search': f"{name} {path.name}".lower()
                })
        except Exception:
            continue

    entries.sort(key=lambda item: item.get('name', '').lower())
    START_MENU_CACHE['entries'] = entries
    START_MENU_CACHE['stamp'] = stamp
    return entries


def _search_start_menu(query, limit=8):
    entries = _build_start_menu_index()
    q = (query or '').strip().lower()
    if not q:
        return entries[:max(1, min(30, limit))]

    scored = []
    for entry in entries:
        name = entry.get('name', '').lower()
        hay = entry.get('search', '')
        tokens = [part for part in name.replace('-', ' ').replace('_', ' ').split() if part]

        if name == q:
            score = 0
        elif name.startswith(q):
            score = 1
        elif any(token == q for token in tokens):
            score = 2
        elif any(token.startswith(q) for token in tokens):
            score = 3
        elif len(q) >= 4 and q in name:
            score = 4
        elif len(q) < 4 and q in hay:
            score = 5
        else:
            continue
        scored.append((score, len(name), name, entry))

    scored.sort(key=lambda item: (item[0], item[1], item[2]))
    return [item[3] for item in scored[:max(1, min(30, limit))]]


def _get_start_menu_entry(entry_id):
    if not entry_id:
        return None
    entries = _build_start_menu_index()
    for entry in entries:
        if entry.get('id') == entry_id:
            return entry
    return None


_SHELL_ICON_CS = None

def _ensure_shell_icon_cs():
    """Write ShellIcon.cs helper to a temp file once, reuse across calls."""
    global _SHELL_ICON_CS
    if _SHELL_ICON_CS and os.path.exists(_SHELL_ICON_CS):
        return _SHELL_ICON_CS
    import tempfile
    cs_src = (
        'using System;\n'
        'using System.Runtime.InteropServices;\n'
        'public class ShellIcon {\n'
        '  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]\n'
        '  public struct SHFILEINFO {\n'
        '    public IntPtr hIcon;\n'
        '    public int iIcon;\n'
        '    public uint dwAttributes;\n'
        '    [MarshalAs(UnmanagedType.ByValTStr, SizeConst=260)]\n'
        '    public string szDisplayName;\n'
        '    [MarshalAs(UnmanagedType.ByValTStr, SizeConst=80)]\n'
        '    public string szTypeName;\n'
        '  }\n'
        '  [DllImport("shell32.dll", CharSet=CharSet.Unicode)]\n'
        '  public static extern IntPtr SHGetFileInfo(string pszPath, uint dwFileAttributes, ref SHFILEINFO psfi, uint cbFileInfo, uint uFlags);\n'
        '  [DllImport("shell32.dll", EntryPoint="#727")]\n'
        '  public static extern int SHGetImageList(int iImageList, ref Guid riid, ref IntPtr ppv);\n'
        '  [DllImport("comctl32.dll", SetLastError=true)]\n'
        '  public static extern IntPtr ImageList_GetIcon(IntPtr himl, int i, int flags);\n'
        '  [DllImport("user32.dll", SetLastError=true)]\n'
        '  public static extern bool DestroyIcon(IntPtr hIcon);\n'
        '  public const uint SHGFI_SYSICONINDEX = 0x4000;\n'
        '  public const int SHIL_JUMBO = 4;\n'
        '  public const int SHIL_EXTRALARGE = 2;\n'
        '  public static readonly Guid IID_IImageList = new Guid("46EB5926-582E-4017-9FDF-E8998DAA0950");\n'
        '}\n'
    )
    fd, tmp_path = tempfile.mkstemp(suffix='.cs', prefix='shellicon_')
    try:
        os.write(fd, cs_src.encode('utf-8'))
    finally:
        os.close(fd)
    _SHELL_ICON_CS = tmp_path
    return tmp_path


def _start_menu_icon_data(path):
    key = str(path or '').lower()
    if not key:
        return None
    if key in START_MENU_ICON_CACHE:
        return START_MENU_ICON_CACHE[key]
    if os.name != 'nt':
        START_MENU_ICON_CACHE[key] = None
        return None

    cs_path = _ensure_shell_icon_cs()
    # PowerShell single-quoted strings treat backslashes literally
    cs_path_ps = cs_path

    # Extract high-res icon via Shell32 SHIL_JUMBO (256x256) with fallback
    # to ExtractAssociatedIcon. The C# P/Invoke type is compiled from a
    # temp .cs file to avoid PowerShell quoting issues.
    script = (
        "$ErrorActionPreference='Stop';"
        "Add-Type -AssemblyName System.Drawing;"
        "Add-Type -Path '" + cs_path_ps + "';"
        "$src=$env:TOMOE_ICON_PATH;"
        "if(-not $src -or -not (Test-Path $src)){exit 0};"
        "$ext=[System.IO.Path]::GetExtension($src).ToLowerInvariant();"
        "if($ext -eq '.lnk'){"
        " $sh=New-Object -ComObject WScript.Shell;"
        " $sc=$sh.CreateShortcut($src);"
        " $target=''; if($sc.TargetPath){$target=$sc.TargetPath};"
        " $iconFile=''; if($sc.IconLocation){$parts=$sc.IconLocation.Split(','); $iconFile=$parts[0].Trim()};"
        " if($target -and (Test-Path $target)){$src=$target}"
        " if($iconFile -and (Test-Path $iconFile) -and ([System.IO.Path]::GetExtension($iconFile).ToLowerInvariant() -ne '.lnk')){$src=$iconFile}"
        "}"
        "if(-not (Test-Path $src)){exit 0};"
        # Try jumbo icon extraction
        "$srcBmp=$null;"
        "try {"
        " $shfi=New-Object ShellIcon+SHFILEINFO;"
        " $cbSize=[System.Runtime.InteropServices.Marshal]::SizeOf($shfi);"
        " $hr=[ShellIcon]::SHGetFileInfo($src,0,[ref]$shfi,[uint32]$cbSize,[ShellIcon]::SHGFI_SYSICONINDEX);"
        " if($hr -ne [IntPtr]::Zero -and $shfi.iIcon -ge 0){"
        "  $imgListPtr=[IntPtr]::Zero;"
        "  $guid=[ShellIcon]::IID_IImageList;"
        "  $gotList=[ShellIcon]::SHGetImageList([ShellIcon]::SHIL_JUMBO,[ref]$guid,[ref]$imgListPtr);"
        "  if($gotList -ne 0 -or $imgListPtr -eq [IntPtr]::Zero){"
        "   $imgListPtr=[IntPtr]::Zero;"
        "   $gotList=[ShellIcon]::SHGetImageList([ShellIcon]::SHIL_EXTRALARGE,[ref]$guid,[ref]$imgListPtr);"
        "  }"
        "  if($gotList -eq 0 -and $imgListPtr -ne [IntPtr]::Zero){"
        "   $hIcon=[ShellIcon]::ImageList_GetIcon($imgListPtr,$shfi.iIcon,0);"
        "   if($hIcon -ne [IntPtr]::Zero){"
        "    $ico=[System.Drawing.Icon]::FromHandle($hIcon);"
        "    $srcBmp=$ico.ToBitmap();"
        "    [ShellIcon]::DestroyIcon($hIcon) | Out-Null;"
        "   }"
        "  }"
        " }"
        "} catch {}"
        # Fallback to ExtractAssociatedIcon
        "if($null -eq $srcBmp){"
        " $icon=[System.Drawing.Icon]::ExtractAssociatedIcon($src);"
        " if($null -eq $icon){exit 0};"
        " $srcBmp=$icon.ToBitmap();"
        "}"
        # Crop transparent padding
        "$minX=$srcBmp.Width; $minY=$srcBmp.Height; $maxX=-1; $maxY=-1;"
        "for($y=0; $y -lt $srcBmp.Height; $y++){"
        " for($x=0; $x -lt $srcBmp.Width; $x++){"
        "  $p=$srcBmp.GetPixel($x,$y);"
        "  if($p.A -gt 8){"
        "   if($x -lt $minX){$minX=$x}; if($y -lt $minY){$minY=$y};"
        "   if($x -gt $maxX){$maxX=$x}; if($y -gt $maxY){$maxY=$y};"
        "  }"
        " }"
        "}"
        "$srcRect=New-Object System.Drawing.Rectangle 0,0,$srcBmp.Width,$srcBmp.Height;"
        "if($maxX -ge $minX -and $maxY -ge $minY){"
        " $srcRect=New-Object System.Drawing.Rectangle $minX,$minY,($maxX-$minX+1),($maxY-$minY+1);"
        "}"
        # Output at native size if already large, otherwise scale to 128
        "$outSize=128;"
        "if($srcBmp.Width -ge 128 -and $srcBmp.Height -ge 128){$outSize=$srcBmp.Width};"
        "if($outSize -gt 256){$outSize=256};"
        "$bmp=New-Object System.Drawing.Bitmap $outSize,$outSize;"
        "$g=[System.Drawing.Graphics]::FromImage($bmp);"
        "$g.InterpolationMode=[System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic;"
        "$g.SmoothingMode=[System.Drawing.Drawing2D.SmoothingMode]::HighQuality;"
        "$g.PixelOffsetMode=[System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality;"
        "$g.CompositingQuality=[System.Drawing.Drawing2D.CompositingQuality]::HighQuality;"
        "$g.Clear([System.Drawing.Color]::Transparent);"
        "$g.DrawImage($srcBmp,(New-Object System.Drawing.Rectangle 0,0,$outSize,$outSize),$srcRect,[System.Drawing.GraphicsUnit]::Pixel);"
        "$g.Dispose();"
        "$ms=New-Object System.IO.MemoryStream;"
        "$bmp.Save($ms,[System.Drawing.Imaging.ImageFormat]::Png);"
        "[Convert]::ToBase64String($ms.ToArray())"
    )
    try:
        env = os.environ.copy()
        env['TOMOE_ICON_PATH'] = str(path)
        result = subprocess.run(
            ['powershell', '-NoProfile', '-Command', script],
            capture_output=True,
            text=True,
            timeout=8,
            env=env
        )
        data = (result.stdout or '').strip()
        if data:
            icon_data = f'data:image/png;base64,{data}'
            START_MENU_ICON_CACHE[key] = icon_data
            return icon_data
        # Log stderr for debugging
        err = (result.stderr or '').strip()
        if err:
            print(f'[RunIcon] PS stderr: {err[:200]}')
    except Exception as exc:
        print(f'[RunIcon] exception: {exc}')
    START_MENU_ICON_CACHE[key] = None
    return None


def _start_menu_icon_url(entry):
    if not isinstance(entry, dict):
        return None
    entry_id = str(entry.get('id') or '').strip()
    if not entry_id:
        return None
    APP_ICON_DIR.mkdir(parents=True, exist_ok=True)
    icon_file = APP_ICON_DIR / f'{entry_id}.png'
    source = str(entry.get('path') or '')
    try:
        src_mtime = int(Path(source).stat().st_mtime_ns) if source else 0
        out_mtime = int(icon_file.stat().st_mtime_ns) if icon_file.exists() else 0
        if out_mtime >= src_mtime and icon_file.exists():
            return f'/static/image/app/{entry_id}.png'
    except Exception:
        pass

    icon_data = _start_menu_icon_data(source)
    if not icon_data:
        return None
    try:
        b64 = icon_data.split(',', 1)[1] if ',' in icon_data else icon_data
        import base64
        icon_file.write_bytes(base64.b64decode(b64))
        print(f'[RunIcon] cache write {entry_id} -> {icon_file}')
        return f'/static/image/app/{entry_id}.png'
    except Exception:
        print(f'[RunIcon] cache write failed {entry_id}')
        return None


def _list_windows(limit=64, query=''):
    if os.name != 'nt':
        return []

    # Use EnumWindows via ctypes for comprehensive window enumeration
    # This catches ALL visible top-level windows, not just MainWindowHandle
    try:
        return _list_windows_native(limit, query)
    except Exception:
        pass

    # Fallback to PowerShell Get-Process approach
    return _list_windows_ps(limit, query)


def _list_windows_native(limit=64, query=''):
    """Enumerate all visible top-level windows via Win32 EnumWindows."""
    user32 = ctypes.windll.user32
    kernel32 = ctypes.windll.kernel32

    EnumWindows = user32.EnumWindows
    IsWindowVisible = user32.IsWindowVisible
    GetWindowTextW = user32.GetWindowTextW
    GetWindowTextLengthW = user32.GetWindowTextLengthW
    GetWindowThreadProcessId = user32.GetWindowThreadProcessId
    GetWindowLongW = user32.GetWindowLongW
    GetWindow = user32.GetWindow
    GetShellWindow = user32.GetShellWindow

    GW_OWNER = 4
    GWL_EXSTYLE = -20
    WS_EX_TOOLWINDOW = 0x00000080
    WS_EX_APPWINDOW = 0x00040000
    WS_EX_NOACTIVATE = 0x08000000

    WNDENUMPROC = ctypes.WINFUNCTYPE(ctypes.c_bool, ctypes.c_void_p, ctypes.c_void_p)

    shell_hwnd = GetShellWindow()
    results = []

    # Get process name from PID
    pid_to_name = {}
    if psutil:
        try:
            for proc in psutil.process_iter(['pid', 'name']):
                try:
                    pid_to_name[proc.info['pid']] = proc.info['name'].replace('.exe', '')
                except Exception:
                    continue
        except Exception:
            pass

    def _get_process_name_fallback(pid):
        """Fallback: open process handle and query image name."""
        try:
            PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
            handle = kernel32.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, False, pid)
            if not handle:
                return ''
            try:
                buf = ctypes.create_unicode_buffer(260)
                size = ctypes.c_ulong(260)
                if kernel32.QueryFullProcessImageNameW(handle, 0, buf, ctypes.byref(size)):
                    name = os.path.basename(buf.value)
                    return name.replace('.exe', '') if name else ''
            finally:
                kernel32.CloseHandle(handle)
        except Exception:
            pass
        return ''

    def enum_callback(hwnd, _lparam):
        try:
            # Skip invisible windows
            if not IsWindowVisible(hwnd):
                return True
            # Skip shell window
            if hwnd == shell_hwnd:
                return True

            # Alt-Tab visibility rules:
            # A window is in alt-tab if:
            #   - It has WS_EX_APPWINDOW, OR
            #   - It has no owner AND is not WS_EX_TOOLWINDOW
            ex_style = GetWindowLongW(hwnd, GWL_EXSTYLE)
            is_app_window = bool(ex_style & WS_EX_APPWINDOW)
            is_tool_window = bool(ex_style & WS_EX_TOOLWINDOW)
            is_noactivate = bool(ex_style & WS_EX_NOACTIVATE)
            owner = GetWindow(hwnd, GW_OWNER)

            if not is_app_window:
                if is_tool_window or owner:
                    return True
            if is_noactivate and not is_app_window:
                return True

            # Get title
            length = GetWindowTextLengthW(hwnd)
            if length <= 0:
                return True
            buf = ctypes.create_unicode_buffer(length + 1)
            GetWindowTextW(hwnd, buf, length + 1)
            title = buf.value.strip()
            if not title:
                return True

            # Get PID
            pid = ctypes.c_ulong(0)
            GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
            pid_val = pid.value

            # Get process name
            process_name = pid_to_name.get(pid_val, '')
            if not process_name:
                process_name = _get_process_name_fallback(pid_val)

            results.append({
                'hwnd': str(int(hwnd) if hwnd else '0'),
                'pid': pid_val,
                'title': title,
                'process': process_name
            })
        except Exception:
            pass
        return True

    EnumWindows(WNDENUMPROC(enum_callback), None)

    q = (query or '').strip().lower()
    if q:
        results = [
            item for item in results
            if q in item['title'].lower() or q in item['process'].lower()
        ]

    results.sort(key=lambda entry: (entry.get('title') or '').lower())
    return results[:max(1, min(500, int(limit)))]


def _list_windows_ps(limit=64, query=''):
    """Fallback: list windows via PowerShell Get-Process."""
    script = (
        "$ErrorActionPreference='Stop';"
        "$items=Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle -and $_.MainWindowTitle.Trim().Length -gt 0 } | "
        "ForEach-Object { [PSCustomObject]@{ hwnd=[string]$_.MainWindowHandle; pid=[int]$_.Id; title=$_.MainWindowTitle; process=$_.ProcessName } };"
        "$items | ConvertTo-Json -Compress"
    )

    try:
        result = subprocess.run(
            ['powershell', '-NoProfile', '-Command', script],
            capture_output=True,
            text=False,
            timeout=2.5
        )
        raw = (result.stdout or b'').decode('utf-8', errors='ignore').strip()
        if not raw:
            return []
        parsed = json.loads(raw)
        items = parsed if isinstance(parsed, list) else [parsed]
    except Exception:
        return []

    q = (query or '').strip().lower()

    def _sanitize_text(value):
        text = str(value or '').strip()
        if not text:
            return ''
        return ' '.join(text.split())

    normalized = []
    for item in items:
        if not isinstance(item, dict):
            continue
        title = _sanitize_text(item.get('title'))
        if not title:
            continue
        process_name = _sanitize_text(item.get('process'))
        if q:
            hay = f'{title} {process_name}'.lower()
            if q not in hay:
                continue
        normalized.append({
            'hwnd': str(item.get('hwnd') or ''),
            'pid': item.get('pid'),
            'title': title,
            'process': process_name
        })

    normalized.sort(key=lambda entry: (entry.get('title') or '').lower())
    return normalized[:max(1, min(500, int(limit)))]


def _focus_window(hwnd):
    if os.name != 'nt':
        return False

    try:
        hwnd_int = int(str(hwnd or '').strip(), 0)
    except Exception:
        return False
    if hwnd_int <= 0:
        return False

    user32 = ctypes.windll.user32
    SW_RESTORE = 9
    try:
        hwnd_ptr = ctypes.c_void_p(hwnd_int)
        user32.IsIconic.argtypes = [ctypes.c_void_p]
        user32.IsIconic.restype = ctypes.c_bool
        user32.ShowWindow.argtypes = [ctypes.c_void_p, ctypes.c_int]
        user32.ShowWindow.restype = ctypes.c_bool
        user32.SetForegroundWindow.argtypes = [ctypes.c_void_p]
        user32.SetForegroundWindow.restype = ctypes.c_bool
        if user32.IsIconic(hwnd_ptr):
            user32.ShowWindow(hwnd_ptr, SW_RESTORE)
        return bool(user32.SetForegroundWindow(hwnd_ptr))
    except Exception:
        return False


def _focus_window_by_pid(pid):
    if os.name != 'nt':
        return False

    try:
        pid_int = int(pid)
    except Exception:
        return False
    if pid_int <= 0:
        return False

    script = (
        "$ErrorActionPreference='Stop';"
        "Add-Type -AssemblyName Microsoft.VisualBasic;"
        "$ok=[Microsoft.VisualBasic.Interaction]::AppActivate(%d);"
        "if($ok){'1'}else{'0'}"
    ) % pid_int

    try:
        result = subprocess.run(
            ['powershell', '-NoProfile', '-Command', script],
            capture_output=True,
            text=False,
            timeout=2.0
        )
        return (result.stdout or b'').decode('utf-8', errors='ignore').strip() == '1'
    except Exception:
        return False


def parse_float(value):
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def normalize_units(value):
    units = (value or '').strip().lower()
    if units in ('c', 'celsius', 'metric'):
        return 'celsius'
    return 'fahrenheit'


def map_weather_code(code, is_day):
    is_day = bool(is_day)
    if code == 0:
        return 'Clear', 'clear_day' if is_day else 'clear_night'
    if code == 1:
        return 'Mostly Clear', 'mostly_sunny' if is_day else 'partly_cloudy_night'
    if code == 2:
        return 'Partly Cloudy', 'partly_cloudy_day' if is_day else 'partly_cloudy_night'
    if code == 3:
        return 'Overcast', 'overcast' if is_day else 'overcast_night'
    if code in (45, 48):
        return 'Fog', 'fog'
    if code in (51, 53, 55):
        return 'Drizzle', 'showers_day' if is_day else 'showers_night'
    if code in (56, 57):
        return 'Freezing Drizzle', 'freezing_rain'
    if code in (61, 63):
        return 'Rain', 'rain' if is_day else 'rain_night'
    if code == 65:
        return 'Heavy Rain', 'heavy_rain'
    if code in (66, 67):
        return 'Freezing Rain', 'freezing_rain'
    if code in (71, 73):
        return 'Snow', 'snow' if is_day else 'snow_night'
    if code == 75:
        return 'Heavy Snow', 'heavy_snow' if is_day else 'heavy_snow_night'
    if code == 77:
        return 'Snow Grains', 'snow' if is_day else 'snow_night'
    if code in (80, 81):
        return 'Showers', 'showers_day' if is_day else 'showers_night'
    if code == 82:
        return 'Heavy Showers', 'rain_day' if is_day else 'rain_night'
    if code == 85:
        return 'Snow Showers', 'snow_showers_day' if is_day else 'snow_night'
    if code == 86:
        return 'Heavy Snow', 'heavy_snow' if is_day else 'heavy_snow_night'
    if code == 95:
        return 'Thunderstorm', 'thunderstorm' if is_day else 'thunder_night'
    if code in (96, 99):
        return 'Thunder + Hail', 'hail_day' if is_day else 'hail'
    return 'Unknown', 'cloudy' if is_day else 'cloudy_night'


def fetch_open_meteo_weather(lat, lon, units):
    units = normalize_units(units)
    wind_units = 'mph' if units == 'fahrenheit' else 'kmh'
    params = {
        'latitude': lat,
        'longitude': lon,
        'current_weather': 'true',
        'temperature_unit': units,
        'windspeed_unit': wind_units,
        'timezone': 'auto'
    }
    url = 'https://api.open-meteo.com/v1/forecast?' + urlparse.urlencode(params)
    with urlrequest.urlopen(url, timeout=10) as response:
        payload = json.loads(response.read().decode('utf-8'))

    current = payload.get('current_weather')
    if not current:
        raise ValueError('Missing current_weather data')

    condition, icon_key = map_weather_code(current.get('weathercode'), current.get('is_day', 1))
    return {
        'temperature': current.get('temperature'),
        'windspeed': current.get('windspeed'),
        'weathercode': current.get('weathercode'),
        'isDay': bool(current.get('is_day', 1)),
        'condition': condition,
        'iconKey': icon_key,
        'units': units,
        'observedAt': current.get('time'),
        'source': 'open-meteo'
    }


def json_response(handler, status, data):
    payload = json.dumps(data).encode('utf-8')
    handler.send_response(status)
    handler.send_header('Content-Type', 'application/json')
    handler.send_header('Access-Control-Allow-Origin', '*')
    handler.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    handler.send_header('Access-Control-Allow-Headers', 'Content-Type')
    handler.send_header('Content-Length', str(len(payload)))
    handler.end_headers()
    try:
        handler.wfile.write(payload)
    except (BrokenPipeError, ConnectionAbortedError):
        return


def file_response(handler, file_path):
    try:
        data = file_path.read_bytes()
    except FileNotFoundError:
        handler.send_error(404, 'File not found')
        return
    except Exception:
        handler.send_error(500, 'File read failed')
        return

    content_type, _ = mimetypes.guess_type(str(file_path))
    if not content_type:
        content_type = 'application/octet-stream'

    handler.send_response(200)
    handler.send_header('Content-Type', content_type)
    handler.send_header('Content-Length', str(len(data)))
    handler.end_headers()
    handler.wfile.write(data)


def resolve_static_path(request_path):
    if request_path == '/':
        return UI_DIR / 'index.html'
    rel = request_path.lstrip('/')
    candidate = (UI_DIR / rel).resolve()
    if UI_DIR in candidate.parents or candidate == UI_DIR:
        return candidate
    return None


def get_applications():
    config = load_config()
    return config.get('applications', []) if isinstance(config, dict) else []


def read_log_lines(limit=120):
    try:
        limit = int(limit)
    except (TypeError, ValueError):
        limit = 120
    limit = max(1, min(limit, 500))
    if not LOG_PATH.exists():
        return []
    try:
        content = LOG_PATH.read_text(encoding='utf-8')
    except Exception:
        return []
    lines = [line for line in content.splitlines() if line.strip()]
    return lines[-limit:]


def find_application(cmd):
    for app in get_applications():
        if app.get('command') == cmd:
            return app
    return None


def get_run_preferences():
    config = load_config()
    if not isinstance(config, dict):
        return False, set()
    run_any = bool(config.get('runAnyCommand', False))
    allowed = config.get('allowedRunCommands', [])
    allowed_set = {str(item).strip() for item in allowed if str(item).strip()}
    for app in config.get('applications', []) or []:
        cmd = app.get('command')
        if cmd:
            allowed_set.add(str(cmd).strip())
    quick_menu = config.get('quickMenu', {})
    if isinstance(quick_menu, dict):
        for item in quick_menu.get('items', []) or []:
            if not isinstance(item, dict):
                continue
            if item.get('enabled', True) is False:
                continue
            cmd = item.get('command')
            if cmd:
                allowed_set.add(str(cmd).strip())

    utility_commands = {
        'rundll32.exe user32.dll,LockWorkStation',
        'powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "scripts\\sign_out.ps1"',
        'powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "scripts\\shutdown_now.ps1"',
        'powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "scripts\\restart_now.ps1"',
        'powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "scripts\\restart_advanced_startup.ps1"'
    }
    allowed_set.update(utility_commands)

    return run_any, allowed_set


def launch_command(cmd):
    try:
        flags = getattr(subprocess, 'CREATE_NEW_PROCESS_GROUP', 0)
        if os.name == 'nt':
            subprocess.Popen(f'cmd /c start "" {cmd}', shell=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, creationflags=flags)
        else:
            subprocess.Popen(cmd, shell=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, creationflags=flags)
        return True, None
    except Exception as exc:
        return False, str(exc)


class TomoeHandler(BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'
    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

    def do_GET(self):
        parsed = urlparse.urlparse(self.path)
        if parsed.path.startswith('/api/'):
            self.handle_api_get(parsed)
            return
        self.send_error(404, 'Not found')

    def do_POST(self):
        parsed = urlparse.urlparse(self.path)
        if parsed.path == '/api/execute-app':
            self.handle_execute_app_post()
            return
        if parsed.path == '/api/windows/focus':
            self.handle_focus_window_post()
            return
        self.send_error(404, 'Not found')

    def handle_api_get(self, parsed):
        if parsed.path == '/api/health':
            json_response(self, 200, {'ok': True})
            return
        if parsed.path == '/api/weather':
            self.handle_weather(parsed.query)
            return
        if parsed.path == '/api/system-info':
            json_response(self, 200, get_system_info())
            return
        if parsed.path == '/api/system-live-stream':
            self.handle_system_live_stream(parsed)
            return
        if parsed.path == '/api/system-live':
            params = urlparse.parse_qs(parsed.query)
            limit_raw = params.get('limit', ['8'])[0]
            try:
                limit = int(limit_raw)
                if limit > 0:
                    limit = max(1, min(5000, limit))
                else:
                    limit = 0
            except Exception:
                limit = 8
            payload = get_system_live(limit=limit)
            if self.headers.get('X-3T-DEBUG') == '1':
                payload = dict(payload)
                payload['__debug'] = {
                    'cwd': str(Path.cwd()),
                    'uiDir': str(UI_DIR),
                    'psutilAvailable': bool(psutil),
                    'psutilError': _psutil_error,
                    'path': os.environ.get('PATH', ''),
                }
            json_response(self, 200, payload)
            return
        if parsed.path == '/api/applications':
            apps = get_applications()
            log_event(f'Applications requested ({len(apps)} available)')
            json_response(self, 200, apps)
            return
        if parsed.path == '/api/execute-app':
            self.handle_execute_app_get(parsed.query)
            return
        if parsed.path == '/api/start-menu-apps':
            self.handle_start_menu_apps(parsed.query)
            return
        if parsed.path == '/api/windows':
            self.handle_windows(parsed.query)
            return
        if parsed.path == '/api/logs':
            params = urlparse.parse_qs(parsed.query)
            limit = params.get('limit', [120])[0]
            json_response(self, 200, {'lines': read_log_lines(limit)})
            return
        json_response(self, 404, {'error': 'Not found'})

    def handle_system_live_stream(self, parsed):
        params = urlparse.parse_qs(parsed.query)
        limit_raw = params.get('limit', ['8'])[0]
        interval_raw = params.get('interval', ['500'])[0]
        try:
            limit = int(limit_raw)
            if limit > 0:
                limit = max(1, min(5000, limit))
            else:
                limit = 0
        except Exception:
            limit = 8

        try:
            interval_ms = max(500, min(15000, int(interval_raw)))
        except Exception:
            interval_ms = 3000

        self.send_response(200)
        self.send_header('Content-Type', 'text/event-stream')
        self.send_header('Cache-Control', 'no-cache')
        self.send_header('Connection', 'keep-alive')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

        while True:
            payload = get_system_live(limit=limit)
            data = json.dumps(payload, separators=(',', ':'))
            try:
                self.wfile.write(f"data: {data}\n\n".encode('utf-8'))
                self.wfile.flush()
            except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
                break
            time.sleep(interval_ms / 1000.0)

    def handle_weather(self, query):
        params = urlparse.parse_qs(query)
        config = load_config()
        weather_cfg = config.get('weather', {}) if isinstance(config, dict) else {}

        lat = parse_float(params.get('lat', [None])[0])
        lon = parse_float(params.get('lon', [None])[0])

        if lat is None:
            lat = parse_float(weather_cfg.get('latitude'))
        if lat is None:
            lat = parse_float(weather_cfg.get('lat'))
        if lon is None:
            lon = parse_float(weather_cfg.get('longitude'))
        if lon is None:
            lon = parse_float(weather_cfg.get('lon'))

        if lat is None or lon is None:
            log_event('Weather request failed (missing latitude/longitude)')
            json_response(self, 400, {
                'error': 'Missing latitude/longitude. Provide lat/lon query params or set WEATHER_LAT/WEATHER_LON.'
            })
            return

        units = normalize_units(params.get('units', [None])[0] or weather_cfg.get('units'))
        label = params.get('label', [None])[0] or weather_cfg.get('label') or ''

        cache_key = f'{lat:.4f},{lon:.4f},{units}'
        now = time.time()
        cached = WEATHER_CACHE.get(cache_key)
        if cached and (now - cached['timestamp'] < WEATHER_CACHE_TTL):
            data = dict(cached['data'])
            if label:
                data['location'] = label
            log_event(f'Weather served from cache (lat={lat:.4f}, lon={lon:.4f}, units={units})')
            json_response(self, 200, data)
            return

        try:
            log_event(f'Updating weather (lat={lat:.4f}, lon={lon:.4f}, units={units})')
            data = fetch_open_meteo_weather(lat, lon, units)
        except Exception as exc:
            log_event(f'Weather request failed ({exc})')
            json_response(self, 502, {'error': f'Weather fetch failed: {exc}'})
            return

        if label:
            data['location'] = label

        WEATHER_CACHE[cache_key] = {'timestamp': now, 'data': data}
        temp = data.get('temperature')
        condition = data.get('condition') or 'Unknown'
        units_label = 'F' if units == 'fahrenheit' else 'C'
        if isinstance(temp, (int, float)):
            log_event(f'Weather updated (lat={lat:.4f}, lon={lon:.4f}, {condition}, {round(temp)}{units_label})')
        else:
            log_event(f'Weather updated (lat={lat:.4f}, lon={lon:.4f}, {condition})')
        json_response(self, 200, data)

    def handle_execute_app_get(self, query):
        params = urlparse.parse_qs(query)
        cmd = (params.get('cmd', [''])[0] or '').strip()
        self.execute_command(cmd)

    def handle_execute_app_post(self):
        length = int(self.headers.get('Content-Length', '0'))
        if length <= 0:
            json_response(self, 400, {'error': 'Missing request body'})
            return
        try:
            payload = json.loads(self.rfile.read(length).decode('utf-8'))
        except Exception:
            json_response(self, 400, {'error': 'Invalid JSON payload'})
            return
        cmd = (payload.get('cmd') or '').strip()
        self.execute_command(cmd)

    def handle_start_menu_apps(self, query):
        params = urlparse.parse_qs(query)
        q = (params.get('q', [''])[0] or '').strip()
        try:
            limit = int(params.get('limit', ['8'])[0])
        except Exception:
            limit = 8
        limit = max(1, min(30, limit))
        with_icons = (params.get('icons', ['1'])[0] or '1').strip() != '0'

        matches = _search_start_menu(q, limit)
        items = []
        for index, entry in enumerate(matches):
            payload = {
                'id': entry.get('id'),
                'name': entry.get('name'),
                'command': entry.get('command')
            }
            if with_icons and index < 8:
                icon_url = _start_menu_icon_url(entry)
                if icon_url:
                    payload['iconUrl'] = icon_url
            items.append(payload)
        json_response(self, 200, {'items': items})

    def handle_windows(self, query):
        params = urlparse.parse_qs(query)
        q = (params.get('q', [''])[0] or '').strip()
        try:
            limit = int(params.get('limit', ['64'])[0])
        except Exception:
            limit = 64
        items = _list_windows(limit=limit, query=q)
        json_response(self, 200, {'items': items})

    def handle_focus_window_post(self):
        length = int(self.headers.get('Content-Length', '0'))
        if length <= 0:
            json_response(self, 400, {'error': 'Missing request body'})
            return

        try:
            payload = json.loads(self.rfile.read(length).decode('utf-8'))
        except Exception:
            json_response(self, 400, {'error': 'Invalid JSON payload'})
            return

        hwnd = payload.get('hwnd') if isinstance(payload, dict) else None
        pid = payload.get('pid') if isinstance(payload, dict) else None
        if hwnd is None:
            json_response(self, 400, {'error': 'Missing hwnd'})
            return

        if _focus_window(hwnd) or (pid is not None and _focus_window_by_pid(pid)):
            json_response(self, 200, {'success': True})
            return

        json_response(self, 500, {'error': 'Failed to focus window'})

    def execute_command(self, cmd):
        if not cmd:
            log_event('Launch blocked (no command provided)')
            json_response(self, 400, {'error': 'No command provided'})
            return

        start_menu_entry = None
        if cmd.startswith('startmenu://'):
            entry_id = cmd.split('startmenu://', 1)[1].strip()
            start_menu_entry = _get_start_menu_entry(entry_id)
            if not start_menu_entry:
                json_response(self, 404, {'error': 'Application not found in Start Menu index'})
                return
            cmd = f'"{start_menu_entry.get("path")}"'

        app = find_application(cmd)
        run_any, allowed_set = get_run_preferences()
        if not start_menu_entry and not app and not (ALLOW_UNCONFIGURED or run_any or cmd in allowed_set):
            log_event('Launch blocked (command not allowed)')
            json_response(self, 403, {'error': 'Command not allowed'})
            return

        ok, err = launch_command(cmd)
        if not ok:
            log_event(f'Launch failed ({err})')
            json_response(self, 500, {'error': f'Failed to execute: {err}'})
            return

        app_name = app.get('name') if isinstance(app, dict) else None
        if not app_name and start_menu_entry:
            app_name = start_menu_entry.get('name')
        if app_name:
            log_event(f'Launch app ({app_name})')
        else:
            log_event('Launch app (unconfigured)')
        json_response(self, 200, {'success': True, 'message': f'Launched: {cmd}'})

    def log_message(self, format, *args):
        return


def main():
    if not UI_DIR.exists():
        raise SystemExit(f'UI directory not found: {UI_DIR}')

    port = int(os.environ.get('TOMOE_PORT', '5055'))
    server = ThreadingHTTPServer(('0.0.0.0', port), TomoeHandler)
    print(f'3 Tomoe running on http://localhost:{port}')
    print(f'UI root: {UI_DIR}')
    log_event(f'Server started on http://localhost:{port}')
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == '__main__':
    main()
