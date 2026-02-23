#!/usr/bin/env python3
"""
3 Tomoe Config Manager
A lightweight web-based CMS for managing config.json and presets
"""

import json
import os
import hashlib
import subprocess
from datetime import datetime
from pathlib import Path

from flask import Flask, jsonify, request, send_from_directory
from werkzeug.utils import secure_filename
from flask_cors import CORS

app = Flask(__name__)
CORS(app)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
CONFIG_FILE = os.path.join(BASE_DIR, 'config.json')
PRESETS_DIR = os.path.join(BASE_DIR, 'presets')
LOGO_DIR = os.path.join(BASE_DIR, 'static', 'image')
START_MENU_ROOTS = [
    Path(r'C:\ProgramData\Microsoft\Windows\Start Menu'),
    Path(r'C:\ProgramData\Microsoft\Windows\Start Menu\Programs')
]
START_MENU_EXTENSIONS = {'.lnk', '.url', '.exe', '.bat', '.cmd', '.msc', '.appref-ms'}
START_MENU_CACHE = {'entries': [], 'stamp': ''}
START_MENU_ICON_CACHE = {}
APP_ICON_DIR = os.path.join(BASE_DIR, 'static', 'image', 'app')


def _start_menu_stamp():
    parts = []
    for root in START_MENU_ROOTS:
        if not root.exists():
            continue
        try:
            parts.append(f'{root}:{int(root.stat().st_mtime_ns)}')
            for path in root.rglob('*'):
                if not path.is_file() or path.suffix.lower() not in START_MENU_EXTENSIONS:
                    continue
                stat = path.stat()
                parts.append(f'{path}:{int(stat.st_mtime_ns)}:{int(stat.st_size)}')
        except Exception:
            continue
    if not parts:
        return ''
    return hashlib.sha1('\n'.join(parts).encode('utf-8', errors='ignore')).hexdigest()


def _normalize_app_name(stem):
    text = (stem or '').replace('_', ' ').replace('-', ' ').strip()
    return ' '.join(text.split())


def _build_start_menu_index(force=False):
    stamp = _start_menu_stamp()
    if not force and stamp and stamp == START_MENU_CACHE.get('stamp'):
        return START_MENU_CACHE.get('entries', [])

    entries = []
    seen = set()
    for root in START_MENU_ROOTS:
        if not root.exists():
            continue
        try:
            for path in root.rglob('*'):
                if not path.is_file() or path.suffix.lower() not in START_MENU_EXTENSIONS:
                    continue
                p = str(path)
                key = p.lower()
                if key in seen:
                    continue
                seen.add(key)
                name = _normalize_app_name(path.stem)
                if not name:
                    continue
                entry_id = hashlib.sha1(key.encode('utf-8', errors='ignore')).hexdigest()[:16]
                entries.append({
                    'id': entry_id,
                    'name': name,
                    'path': p,
                    'command': f'startmenu://{entry_id}',
                    'search': f'{name} {path.name}'.lower()
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


def _start_menu_icon_data(path):
    key = str(path or '').lower()
    if not key:
        return None
    if key in START_MENU_ICON_CACHE:
        return START_MENU_ICON_CACHE[key]
    if os.name != 'nt':
        START_MENU_ICON_CACHE[key] = None
        return None

    script = (
        "$ErrorActionPreference='Stop';"
        "Add-Type -AssemblyName System.Drawing;"
        "$src=$env:TOMOE_ICON_PATH;"
        "if(-not $src -or -not (Test-Path $src)){exit 0};"
        "$ext=[System.IO.Path]::GetExtension($src).ToLowerInvariant();"
        "if($ext -eq '.lnk'){"
        " $sh=New-Object -ComObject WScript.Shell;"
        " $sc=$sh.CreateShortcut($src);"
        " $target=''; if($sc.TargetPath){$target=$sc.TargetPath};"
        " $iconFile=''; if($sc.IconLocation){$iconFile=$sc.IconLocation.Split(',')[0]};"
        " if($target -and (Test-Path $target)){$src=$target}"
        " if($iconFile -and (Test-Path $iconFile) -and ([System.IO.Path]::GetExtension($iconFile).ToLowerInvariant() -ne '.lnk')){$src=$iconFile}"
        "}"
        "if(-not (Test-Path $src)){exit 0};"
        "$icon=[System.Drawing.Icon]::ExtractAssociatedIcon($src);"
        "if($null -eq $icon){exit 0};"
        "$srcBmp=$icon.ToBitmap();"
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
        "$bmp=New-Object System.Drawing.Bitmap 256,256;"
        "$g=[System.Drawing.Graphics]::FromImage($bmp);"
        "$g.InterpolationMode=[System.Drawing.Drawing2D.InterpolationMode]::NearestNeighbor;"
        "$g.SmoothingMode=[System.Drawing.Drawing2D.SmoothingMode]::None;"
        "$g.PixelOffsetMode=[System.Drawing.Drawing2D.PixelOffsetMode]::Half;"
        "$g.Clear([System.Drawing.Color]::Transparent);"
        "$g.DrawImage($srcBmp,(New-Object System.Drawing.Rectangle 0,0,256,256),$srcRect,[System.Drawing.GraphicsUnit]::Pixel);"
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
            timeout=2.5,
            env=env
        )
        data = (result.stdout or '').strip()
        if data:
            payload = f'data:image/png;base64,{data}'
            START_MENU_ICON_CACHE[key] = payload
            return payload
    except Exception:
        pass
    START_MENU_ICON_CACHE[key] = None
    return None


def _start_menu_icon_url(entry):
    if not isinstance(entry, dict):
        return None
    entry_id = str(entry.get('id') or '').strip()
    if not entry_id:
        return None

    os.makedirs(APP_ICON_DIR, exist_ok=True)
    icon_path = os.path.join(APP_ICON_DIR, f'{entry_id}.png')
    source = str(entry.get('path') or '')
    try:
        src_mtime = int(os.path.getmtime(source) * 1_000_000_000) if source and os.path.exists(source) else 0
        out_mtime = int(os.path.getmtime(icon_path) * 1_000_000_000) if os.path.exists(icon_path) else 0
        if os.path.exists(icon_path) and out_mtime >= src_mtime:
            return f'/static/image/app/{entry_id}.png'
    except Exception:
        pass

    icon_data = _start_menu_icon_data(source)
    if not icon_data:
        return None
    try:
        import base64
        b64 = icon_data.split(',', 1)[1] if ',' in icon_data else icon_data
        with open(icon_path, 'wb') as f:
            f.write(base64.b64decode(b64))
        print(f'[RunIcon] cache write {entry_id} -> {icon_path}')
        return f'/static/image/app/{entry_id}.png'
    except Exception:
        print(f'[RunIcon] cache write failed {entry_id}')
        return None

def load_config():
    """Load config.json from disk"""
    try:
        with open(CONFIG_FILE, 'r') as f:
            return json.load(f)
    except FileNotFoundError:
        # Return default config if file doesn't exist
        pass
    except json.JSONDecodeError as e:
        print(f"Warning: Invalid JSON in config file: {e}")
    
    # Return default config
    return {
        "devMode": True,
        "defaultPreset": "default",
        "showAbout": True,
        "resourceLinksAlign": "right",
        "resourceLinksFooter": True,
        "accountForWindowsVersionInfo": False,
        "presets": [],
        "menu": [],
        "applications": [],
        "logo": "3 TOMOE",
        "tagline": "Project Archive",
        "about": "Creative development lab",
        "homeImage": "",
        "homeImageOpacity": 0.75,
        "homeImageFit": "cover",
        "homeImageCropX": 50,
        "homeImageCropY": 50,
        "homeImageZoom": 1.0,
        "background": {},
        "backgroundLibrary": [],
        "defaultBackground": "",
        "developerPanelSettings": {},
        "runAnyCommand": False,
        "allowedRunCommands": [],
        "quickMenu": {
            "items": [
                {
                    "id": "restart_explorer",
                    "title": "Restart Explorer",
                    "command": "powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File \"scripts\\restart_explorer.ps1\"",
                    "enabled": True
                },
                {
                    "id": "reset_gpu_driver",
                    "title": "Reset GPU Driver",
                    "command": "powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File \"scripts\\reset_gpu_driver.ps1\"",
                    "enabled": True
                },
                {
                    "id": "minimize_all_windows",
                    "title": "Minimize All Windows",
                    "command": "powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File \"scripts\\minimize_all_windows.ps1\"",
                    "enabled": True
                },
                {
                    "id": "close_all_windows",
                    "title": "Close All Windows",
                    "command": "powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File \"scripts\\close_all_windows.ps1\"",
                    "enabled": True,
                    "confirm": True,
                    "confirmText": "Close all windows? Unsaved work may be lost."
                },
                {
                    "id": "toggle_taskbar",
                    "title": "Toggle Taskbar",
                    "command": "powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File \"scripts\\toggle_taskbar.ps1\"",
                    "enabled": True
                },
                {
                    "id": "task_manager",
                    "title": "Task Manager",
                    "command": "powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File \"scripts\\open_task_manager.ps1\"",
                    "enabled": True
                }
            ]
        },
        "weather": {
            "apiBase": "http://localhost:5055",
            "latitude": None,
            "longitude": None,
            "units": "fahrenheit",
            "label": "",
            "useLocationNames": False
        }
    }

def save_config(config):
    """Save config.json to disk"""
    try:
        with open(CONFIG_FILE, 'w') as f:
            json.dump(config, f, indent=2)
        return True
    except Exception as e:
        return {"error": str(e)}

_config_stamp_override = {"stamp": None, "until": 0, "muted_stamp": None}

def _read_config_stamp_raw():
    try:
        stat = os.stat(CONFIG_FILE)
        return f"{int(stat.st_mtime)}-{stat.st_size}"
    except FileNotFoundError:
        return "missing"
    except Exception:
        return "error"

def get_config_stamp():
    # If the current file stamp matches the latest dev-settings-only write,
    # keep returning the pre-write stamp so the live reload poller does not
    # refresh for developer-panel tweaks.
    current = _read_config_stamp_raw()
    if _config_stamp_override["stamp"]:
        if _config_stamp_override.get("muted_stamp") == current:
            return _config_stamp_override["stamp"]
        _config_stamp_override["stamp"] = None
        _config_stamp_override["until"] = 0
        _config_stamp_override["muted_stamp"] = None
    return current

# API Routes

@app.route('/api/config', methods=['GET'])
def get_config():
    """Get current config"""
    config = load_config()
    return jsonify(config)


@app.route('/api/config-hash', methods=['GET'])
def get_config_hash():
    """Get config file stamp for live reload"""
    return jsonify({"stamp": get_config_stamp()})

@app.route('/api/config', methods=['POST'])
def update_config():
    """Update entire config"""
    config = request.json
    result = save_config(config)
    if result is True:
        return jsonify({"success": True, "message": "Config saved"})
    return jsonify(result), 500

@app.route('/api/config/site', methods=['PATCH'])
def update_site_info():
    """Update site info (logo, tagline, about, version, buildDate, siteUrl, copyright, showAbout, devMode, defaultPreset, logoImage, logoInvert, resourceLinksAlign, resourceLinksFooter, accountForWindowsVersionInfo, homeImageOpacity, homeImageFit, homeImageCropX, homeImageCropY, homeImageZoom, weather)"""
    config = load_config()
    data = request.json
    
    if 'logo' in data:
        config['logo'] = data['logo']
    if 'tagline' in data:
        config['tagline'] = data['tagline']
    if 'about' in data:
        config['about'] = data['about']
    if 'version' in data:
        config['version'] = data['version']
    if 'buildDate' in data:
        config['buildDate'] = data['buildDate']
    if 'siteUrl' in data:
        config['siteUrl'] = data['siteUrl']
    if 'copyright' in data:
        config['copyright'] = data['copyright']
    if 'showAbout' in data:
        config['showAbout'] = data['showAbout']
    if 'devMode' in data:
        config['devMode'] = data['devMode']
    if 'defaultPreset' in data:
        config['defaultPreset'] = data['defaultPreset']
        # Copy preset contents to default.json
        if data['defaultPreset']:
            try:
                preset_file = next((p['file'] for p in config.get('presets', []) if p['id'] == data['defaultPreset']), None)
                if preset_file:
                    src_path = os.path.join(BASE_DIR, preset_file)
                    dst_path = os.path.join(PRESETS_DIR, 'default.json')
                    if os.path.exists(src_path):
                        with open(src_path, 'r') as f:
                            preset_data = json.load(f)
                        with open(dst_path, 'w') as f:
                            json.dump(preset_data, f, indent=2)
            except Exception as e:
                print(f"Error copying preset to default.json: {e}")
    if 'logoImage' in data:
        config['logoImage'] = data['logoImage']
    if 'logoInvert' in data:
        config['logoInvert'] = data['logoInvert']
    if 'resourceLinksAlign' in data:
        config['resourceLinksAlign'] = data['resourceLinksAlign']
    if 'resourceLinksFooter' in data:
        config['resourceLinksFooter'] = data['resourceLinksFooter']
    if 'accountForWindowsVersionInfo' in data:
        config['accountForWindowsVersionInfo'] = data['accountForWindowsVersionInfo']
    if 'homeImage' in data:
        config['homeImage'] = data['homeImage']
    if 'homeImageOpacity' in data:
        config['homeImageOpacity'] = data['homeImageOpacity']
    if 'homeImageFit' in data:
        config['homeImageFit'] = data['homeImageFit']
    if 'homeImageCropX' in data:
        config['homeImageCropX'] = data['homeImageCropX']
    if 'homeImageCropY' in data:
        config['homeImageCropY'] = data['homeImageCropY']
    if 'homeImageZoom' in data:
        config['homeImageZoom'] = data['homeImageZoom']
    if 'weather' in data and isinstance(data['weather'], dict):
        weather = config.get('weather', {}) if isinstance(config.get('weather'), dict) else {}
        weather_data = data['weather']
        if 'apiBase' in weather_data:
            weather['apiBase'] = weather_data['apiBase']
        if 'latitude' in weather_data:
            weather['latitude'] = weather_data['latitude']
        if 'longitude' in weather_data:
            weather['longitude'] = weather_data['longitude']
        if 'units' in weather_data:
            weather['units'] = weather_data['units']
        if 'label' in weather_data:
            weather['label'] = weather_data['label']
        if 'useLocationNames' in weather_data:
            weather['useLocationNames'] = bool(weather_data['useLocationNames'])
        config['weather'] = weather
    if 'runAnyCommand' in data:
        config['runAnyCommand'] = bool(data['runAnyCommand'])
    if 'allowedRunCommands' in data:
        allowed = data['allowedRunCommands']
        if isinstance(allowed, list):
            config['allowedRunCommands'] = [str(cmd).strip() for cmd in allowed if str(cmd).strip()]
    if 'developerPanelSettings' in data:
        dev_settings = data['developerPanelSettings']
        if dev_settings is None:
            if 'developerPanelSettings' in config:
                del config['developerPanelSettings']
        elif isinstance(dev_settings, dict):
            config['developerPanelSettings'] = dev_settings
    if 'quickMenu' in data and isinstance(data['quickMenu'], dict):
        quick_menu = config.get('quickMenu', {}) if isinstance(config.get('quickMenu'), dict) else {}
        quick_data = data['quickMenu']
        if 'items' in quick_data and isinstance(quick_data['items'], list):
            normalized = []
            for item in quick_data['items']:
                if not isinstance(item, dict):
                    continue
                item_id = str(item.get('id', '')).strip()
                title = str(item.get('title', '')).strip()
                if not item_id:
                    continue
                normalized.append({
                    'id': item_id,
                    'title': title or item_id,
                    'command': str(item.get('command', '')).strip(),
                    'enabled': bool(item.get('enabled', True)),
                    'confirm': bool(item.get('confirm', False)),
                    'confirmText': str(item.get('confirmText', '')).strip()
                })
            quick_menu['items'] = normalized
        config['quickMenu'] = quick_menu
    if 'background' in data and isinstance(data['background'], dict):
        bg = config.get('background', {}) if isinstance(config.get('background'), dict) else {}
        bg_data = data['background']
        if 'src' in bg_data:
            bg['src'] = bg_data['src']
        if 'fit' in bg_data:
            bg['fit'] = bg_data['fit']
        if 'position' in bg_data:
            bg['position'] = bg_data['position']
        if 'opacity' in bg_data:
            bg['opacity'] = bg_data['opacity']
        if 'blur' in bg_data:
            bg['blur'] = bg_data['blur']
        if 'scale' in bg_data:
            bg['scale'] = bg_data['scale']
        if 'headerPosition' in bg_data:
            bg['headerPosition'] = bg_data['headerPosition']
        if 'videoLoop' in bg_data:
            bg['videoLoop'] = bg_data['videoLoop']
        if 'videoMuted' in bg_data:
            bg['videoMuted'] = bg_data['videoMuted']
        if 'videoAutoplay' in bg_data:
            bg['videoAutoplay'] = bg_data['videoAutoplay']
        config['background'] = bg
    
    # If only developerPanelSettings changed, freeze the config stamp so the
    # live reload poller doesn't trigger a full page refresh (avoids glitchy
    # reloads when opening menus over widgets or adjusting dev panel sliders).
    dev_only_keys = {'developerPanelSettings'}
    freeze_for_dev_only = bool(data and set(data.keys()) <= dev_only_keys)
    stamp_before_save = get_config_stamp() if freeze_for_dev_only else None

    result = save_config(config)
    if result is True:
        if freeze_for_dev_only:
            _config_stamp_override["stamp"] = stamp_before_save
            _config_stamp_override["muted_stamp"] = _read_config_stamp_raw()
            _config_stamp_override["until"] = 0
        return jsonify({"success": True, "config": config})
    return jsonify(result), 500

@app.route('/api/menu', methods=['GET'])
def get_menu():
    """Get all menu items"""
    config = load_config()
    return jsonify(config.get('menu', []))

@app.route('/api/menu', methods=['POST'])
def add_menu_item():
    """Add a new menu item"""
    config = load_config()
    item = request.json
    
    if 'menu' not in config:
        config['menu'] = []
    
    # Generate ID if not provided
    if 'id' not in item:
        item['id'] = f"menu_{len(config['menu'])}_{int(datetime.now().timestamp())}"
    
    config['menu'].append(item)
    
    result = save_config(config)
    if result is True:
        return jsonify({"success": True, "item": item})
    return jsonify(result), 500

@app.route('/api/menu/<item_id>', methods=['PUT'])
def update_menu_item(item_id):
    """Update a menu item"""
    config = load_config()
    data = request.json
    
    menu = config.get('menu', [])
    for i, item in enumerate(menu):
        if item.get('id') == item_id or str(i) == item_id:
            menu[i] = {**item, **data}
            result = save_config(config)
            if result is True:
                return jsonify({"success": True, "item": menu[i]})
            return jsonify(result), 500
    
    return jsonify({"error": "Menu item not found"}), 404

@app.route('/api/menu/<item_id>', methods=['DELETE'])
def delete_menu_item(item_id):
    """Delete a menu item"""
    config = load_config()
    menu = config.get('menu', [])
    
    for i, item in enumerate(menu):
        if item.get('id') == item_id or str(i) == item_id:
            deleted = menu.pop(i)
            result = save_config(config)
            if result is True:
                return jsonify({"success": True, "deleted": deleted})
            return jsonify(result), 500
    
    return jsonify({"error": "Menu item not found"}), 404

@app.route('/api/menu/reorder', methods=['POST'])
def reorder_menu():
    """Reorder menu items"""
    config = load_config()
    data = request.json
    new_order = data.get('order', [])  # List of menu item IDs in new order
    
    menu = config.get('menu', [])
    menu_dict = {p.get('id', str(i)): p for i, p in enumerate(menu)}
    
    config['menu'] = [menu_dict[pid] for pid in new_order if pid in menu_dict]
    
    result = save_config(config)
    if result is True:
        return jsonify({"success": True})
    return jsonify(result), 500

@app.route('/api/applications', methods=['GET'])
def get_applications():
    """Get all applications"""
    config = load_config()
    return jsonify(config.get('applications', []))

@app.route('/api/applications', methods=['POST'])
def add_application():
    """Add a new application"""
    config = load_config()
    app_item = request.json
    
    if 'applications' not in config:
        config['applications'] = []
    
    # Generate ID if not provided
    if 'id' not in app_item:
        app_item['id'] = f"app_{len(config['applications'])}_{int(datetime.now().timestamp())}"
    
    config['applications'].append(app_item)
    
    result = save_config(config)
    if result is True:
        return jsonify({"success": True, "application": app_item})
    return jsonify(result), 500

@app.route('/api/applications/<app_id>', methods=['PUT'])
def update_application(app_id):
    """Update an application"""
    config = load_config()
    data = request.json
    
    applications = config.get('applications', [])
    for i, app in enumerate(applications):
        if app.get('id') == app_id or str(i) == app_id:
            applications[i] = {**app, **data}
            result = save_config(config)
            if result is True:
                return jsonify({"success": True, "application": applications[i]})
            return jsonify(result), 500
    
    return jsonify({"error": "Application not found"}), 404

@app.route('/api/applications/<app_id>', methods=['DELETE'])
def delete_application(app_id):
    """Delete an application"""
    config = load_config()
    applications = config.get('applications', [])
    
    for i, app in enumerate(applications):
        if app.get('id') == app_id or str(i) == app_id:
            deleted = applications.pop(i)
            result = save_config(config)
            if result is True:
                return jsonify({"success": True, "deleted": deleted})
            return jsonify(result), 500
    
    return jsonify({"error": "Application not found"}), 404

@app.route('/api/applications/reorder', methods=['POST'])
def reorder_applications():
    """Reorder applications"""
    config = load_config()
    data = request.json
    new_order = data.get('order', [])  # List of application IDs in new order
    
    applications = config.get('applications', [])
    apps_dict = {p.get('id', str(i)): p for i, p in enumerate(applications)}
    
    config['applications'] = [apps_dict[pid] for pid in new_order if pid in apps_dict]
    
    result = save_config(config)
    if result is True:
        return jsonify({"success": True})
    return jsonify(result), 500

@app.route('/api/presets/reorder', methods=['POST'])
def reorder_presets():
    """Reorder preset mappings"""
    config = load_config()
    data = request.json
    new_order = data.get('order', [])  # List of preset IDs in new order
    
    presets = config.get('presets', [])
    presets_dict = {p['id']: p for p in presets}
    
    config['presets'] = [presets_dict[pid] for pid in new_order if pid in presets_dict]
    
    result = save_config(config)
    if result is True:
        return jsonify({"success": True})
    return jsonify(result), 500

@app.route('/api/presets', methods=['GET'])
def get_presets():
    """Get all preset mappings from config"""
    config = load_config()
    return jsonify(config.get('presets', []))

@app.route('/api/presets', methods=['POST'])
def add_preset_mapping():
    """Add a preset mapping to config"""
    config = load_config()
    data = request.json
    
    if 'presets' not in config:
        config['presets'] = []
    
    preset_entry = {
        "id": data.get('id'),
        "name": data.get('name'),
        "file": data.get('file', f"presets/{data.get('id')}.json")
    }
    
    # Check if preset already exists
    existing = next((p for p in config['presets'] if p['id'] == preset_entry['id']), None)
    if existing:
        existing.update(preset_entry)
    else:
        config['presets'].append(preset_entry)
    
    result = save_config(config)
    if result is True:
        return jsonify({"success": True, "preset": preset_entry})
    return jsonify(result), 500

@app.route('/api/presets/<preset_id>', methods=['PUT'])
def update_preset_mapping(preset_id):
    """Update a preset mapping in config (rename)"""
    config = load_config()
    data = request.json
    
    presets = config.get('presets', [])
    for i, preset in enumerate(presets):
        if preset.get('id') == preset_id:
            if 'name' in data:
                presets[i]['name'] = data['name']
            result = save_config(config)
            if result is True:
                return jsonify({"success": True, "preset": presets[i]})
            return jsonify(result), 500
    
    return jsonify({"error": "Preset not found"}), 404

@app.route('/api/presets/<preset_id>', methods=['DELETE'])
def delete_preset_mapping(preset_id):
    """Remove a preset mapping and its preset file when safe."""
    config = load_config()
    presets = config.get('presets', [])
    if not isinstance(presets, list):
        presets = []

    target = next((p for p in presets if p.get('id') == preset_id), None)
    if not target:
        return jsonify({"error": "Preset not found"}), 404

    remaining = [p for p in presets if p.get('id') != preset_id]
    config['presets'] = remaining

    result = save_config(config)
    if result is not True:
        return jsonify(result), 500

    file_deleted = False
    file_kept_reason = ''
    raw_file = str(target.get('file') or '').strip().replace('\\', '/')
    file_basename = os.path.basename(raw_file)

    if not file_basename:
        file_kept_reason = 'No preset file path on mapping'
    elif not file_basename.lower().endswith('.json'):
        file_kept_reason = 'Mapped file is not a JSON preset file'
    else:
        safe_name = secure_filename(file_basename)
        if not safe_name or safe_name != file_basename:
            file_kept_reason = 'Mapped filename is not safe to delete'
        else:
            normalized_target = f'presets/{file_basename}'
            still_referenced = any(
                str(p.get('file') or '').strip().replace('\\', '/') == normalized_target
                for p in remaining
            )

            if still_referenced:
                file_kept_reason = 'Preset file is still referenced by another mapping'
            else:
                file_path = os.path.join(PRESETS_DIR, file_basename)
                if os.path.exists(file_path):
                    try:
                        os.remove(file_path)
                        file_deleted = True
                    except Exception:
                        file_kept_reason = 'Failed to delete preset file from disk'
                else:
                    file_kept_reason = 'Preset file was already missing'

    return jsonify({
        "success": True,
        "fileDeleted": file_deleted,
        "fileKeptReason": file_kept_reason
    })

@app.route('/api/preset-files', methods=['GET'])
def list_preset_files():
    """List all preset files in presets/ directory"""
    try:
        files = []
        if os.path.exists(PRESETS_DIR):
            for filename in os.listdir(PRESETS_DIR):
                if filename.endswith('.json'):
                    filepath = os.path.join(PRESETS_DIR, filename)
                    with open(filepath, 'r') as f:
                        try:
                            data = json.load(f)
                            files.append({
                                "filename": filename,
                                "name": data.get('name', filename),
                                "id": filename.replace('.json', '')
                            })
                        except:
                            files.append({
                                "filename": filename,
                                "name": filename,
                                "id": filename.replace('.json', '')
                            })
        return jsonify(files)
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/preset-files/<filename>', methods=['GET'])
def get_preset_file(filename):
    """Get a preset file's contents"""
    try:
        filepath = os.path.join(PRESETS_DIR, filename)
        with open(filepath, 'r') as f:
            return jsonify(json.load(f))
    except FileNotFoundError:
        return jsonify({"error": "File not found"}), 404
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/preset-files/<filename>', methods=['PUT'])
def update_preset_file(filename):
    """Update or create a preset file"""
    try:
        if not os.path.exists(PRESETS_DIR):
            os.makedirs(PRESETS_DIR)
        
        filepath = os.path.join(PRESETS_DIR, filename)
        data = request.json
        
        with open(filepath, 'w') as f:
            json.dump(data, f, indent=2)
        
        # Also update config.json mapping
        config = load_config()
        preset_id = filename.replace('.json', '')
        preset_name = data.get('name', preset_id)
        
        existing = next((p for p in config.get('presets', []) if p['id'] == preset_id), None)
        if not existing:
            if 'presets' not in config:
                config['presets'] = []
            config['presets'].append({
                "id": preset_id,
                "name": preset_name,
                "file": f"presets/{filename}"
            })
            save_config(config)
        
        return jsonify({"success": True})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/preset-files/<filename>', methods=['DELETE'])
def delete_preset_file(filename):
    """Delete a preset file"""
    try:
        filepath = os.path.join(PRESETS_DIR, filename)
        if os.path.exists(filepath):
            os.remove(filepath)
            
            # Also remove from config
            config = load_config()
            preset_id = filename.replace('.json', '')
            config['presets'] = [p for p in config.get('presets', []) if p['id'] != preset_id]
            save_config(config)
            
            return jsonify({"success": True})
        return jsonify({"error": "File not found"}), 404
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/execute-app', methods=['GET'])
def execute_app():
    """Execute an application command"""
    try:
        cmd = request.args.get('cmd', '')
        if not cmd:
            return jsonify({"error": "No command provided"}), 400

        if cmd.startswith('startmenu://'):
            entry_id = cmd.split('startmenu://', 1)[1].strip()
            entry = _get_start_menu_entry(entry_id)
            if not entry:
                return jsonify({"error": "Application not found in Start Menu index"}), 404
            cmd = f'"{entry.get("path")}"'
            app_config = {'name': entry.get('name')}
        else:
            app_config = None
        
        # Get the application config to find full command info
        config = load_config()
        applications = config.get('applications', [])
        if app_config is None:
            app_config = next((a for a in applications if a.get('command') == cmd), None)

        run_any = config.get('runAnyCommand', False)
        allowed = config.get('allowedRunCommands', [])
        allowed_set = {str(item).strip() for item in allowed if str(item).strip()}
        allowed_set.update({str(a.get('command')).strip() for a in applications if a.get('command')})

        if not run_any and app_config is None and cmd not in allowed_set:
            return jsonify({"error": "Command not allowed"}), 403
        
        if app_config:
            # Use subprocess to execute the command
            try:
                # Execute the command without blocking
                if os.name == 'nt':
                    subprocess.Popen(
                        f'cmd /c start "" {cmd}',
                        shell=True,
                        stdout=subprocess.DEVNULL,
                        stderr=subprocess.DEVNULL
                    )
                else:
                    subprocess.Popen(
                        cmd,
                        shell=True,
                        stdout=subprocess.DEVNULL,
                        stderr=subprocess.DEVNULL
                    )
                return jsonify({"success": True, "message": f"Launched: {cmd}"})
            except Exception as e:
                return jsonify({"error": f"Failed to execute: {str(e)}"}), 500
        else:
            # If not found in config, still try to execute as a fallback
            if os.name == 'nt':
                subprocess.Popen(
                    f'cmd /c start "" {cmd}',
                    shell=True,
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL
                )
            else:
                subprocess.Popen(
                    cmd,
                    shell=True,
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL
                )
            return jsonify({"success": True, "message": f"Launched: {cmd}"})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route('/api/start-menu-apps', methods=['GET'])
def start_menu_apps():
    """Search Start Menu shortcuts for run autocomplete"""
    try:
        q = (request.args.get('q') or '').strip()
        try:
            limit = int(request.args.get('limit', 8))
        except Exception:
            limit = 8
        limit = max(1, min(30, limit))
        with_icons = str(request.args.get('icons', '1')).strip() != '0'

        matches = _search_start_menu(q, limit)
        items = []
        for idx, entry in enumerate(matches):
            payload = {
                'id': entry.get('id'),
                'name': entry.get('name'),
                'command': entry.get('command')
            }
            if with_icons and idx < 8:
                icon_url = _start_menu_icon_url(entry)
                if icon_url:
                    payload['iconUrl'] = icon_url
            items.append(payload)

        return jsonify({'items': items})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# Static file serving

@app.route('/')
def index():
    """Serve the main page"""
    return send_from_directory(BASE_DIR, 'index.html')

@app.route('/<path:filename>')
def static_files(filename):
    """Serve static files"""
    return send_from_directory(BASE_DIR, filename)

@app.route('/presets/<path:filename>')
def preset_files(filename):
    """Serve preset files"""
    return send_from_directory(PRESETS_DIR, filename)

@app.route('/api/upload-logo', methods=['POST'])
def upload_logo():
    """Upload logo image"""
    try:
        if 'logo' not in request.files:
            return jsonify({"error": "No file provided"}), 400
        
        file = request.files['logo']
        filename = file.filename or ''
        if filename == '':
            return jsonify({"error": "No file selected"}), 400
        
        # Validate file type
        allowed_extensions = {'png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'}
        if '.' not in filename or filename.rsplit('.', 1)[1].lower() not in allowed_extensions:
            return jsonify({"error": "Invalid file type. Allowed: png, jpg, jpeg, gif, webp, svg"}), 400
        
        # Create logo directory if it doesn't exist
        if not os.path.exists(LOGO_DIR):
            os.makedirs(LOGO_DIR)
        
        # Save file with secure filename
        filename = secure_filename(filename)
        filepath = os.path.join(LOGO_DIR, filename)
        file.save(filepath)
        
        # Update config with logo path
        config = load_config()
        config['logoImage'] = f'static/image/{filename}'
        save_config(config)
        
        return jsonify({"success": True, "path": config['logoImage']})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/upload-home-image', methods=['POST'])
def upload_home_image():
    """Upload home featured image"""
    try:
        if 'homeImage' not in request.files:
            return jsonify({"error": "No file provided"}), 400
        
        file = request.files['homeImage']
        filename = file.filename or ''
        if filename == '':
            return jsonify({"error": "No file selected"}), 400
        
        # Validate file type
        allowed_extensions = {'png', 'jpg', 'jpeg', 'gif', 'webp'}
        if '.' not in filename or filename.rsplit('.', 1)[1].lower() not in allowed_extensions:
            return jsonify({"error": "Invalid file type. Allowed: png, jpg, jpeg, gif, webp"}), 400
        
        # Create home image directory if it doesn't exist
        HOME_IMAGE_DIR = os.path.join(BASE_DIR, 'static', 'image')
        if not os.path.exists(HOME_IMAGE_DIR):
            os.makedirs(HOME_IMAGE_DIR)
        
        # Save file with secure filename
        filename = secure_filename(filename)
        filepath = os.path.join(HOME_IMAGE_DIR, filename)
        file.save(filepath)
        
# Update config with home image path
        config = load_config()
        config['homeImage'] = f'static/image/{filename}'
        save_config(config)
        
        return jsonify({"success": True, "path": config['homeImage']})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/upload-background', methods=['POST'])
def upload_background():
    """Upload background media (image or video)"""
    try:
        if 'background' not in request.files:
            return jsonify({"error": "No file provided"}), 400
        
        file = request.files['background']
        filename = file.filename or ''
        if filename == '':
            return jsonify({"error": "No file selected"}), 400
        
        # Determine file type and allowed extensions
        image_extensions = {'png', 'jpg', 'jpeg', 'gif', 'webp'}
        video_extensions = {'mp4', 'webm', 'mov', 'avi'}
        allowed_extensions = image_extensions | video_extensions
        
        if '.' not in filename or filename.rsplit('.', 1)[1].lower() not in allowed_extensions:
            return jsonify({"error": "Invalid file type. Allowed: png, jpg, jpeg, gif, webp, mp4, webm, mov, avi"}), 400
        
        # Create background directory if it doesn't exist
        BG_DIR = os.path.join(BASE_DIR, 'static', 'background')
        if not os.path.exists(BG_DIR):
            os.makedirs(BG_DIR)
        
        # Save file with secure filename
        filename = secure_filename(filename)
        filepath = os.path.join(BG_DIR, filename)
        file.save(filepath)
        
        # Update config with background path
        config = load_config()
        if 'background' not in config:
            config['background'] = {}
        config['background']['src'] = f'static/background/{filename}'
        save_config(config)
        
        return jsonify({"success": True, "path": config['background']['src']})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


def _resolve_background_file_path(path_value):
    if not isinstance(path_value, str):
        return None

    normalized_path = path_value.strip().replace('\\', '/')
    if not normalized_path.startswith('static/background/'):
        return None

    filename = os.path.basename(normalized_path)
    if not filename:
        return None

    safe_name = secure_filename(filename)
    if not safe_name or safe_name != filename:
        return None

    background_dir = os.path.abspath(os.path.join(BASE_DIR, 'static', 'background'))
    file_path = os.path.abspath(os.path.join(background_dir, filename))

    try:
        if os.path.commonpath([background_dir, file_path]) != background_dir:
            return None
    except ValueError:
        return None

    return file_path, f'static/background/{filename}'


@app.route('/api/background-file', methods=['DELETE'])
def delete_background_file():
    """Delete a background media file from static/background."""
    try:
        data = request.get_json(silent=True) or {}
        resolved = _resolve_background_file_path(data.get('path'))
        if not resolved:
            return jsonify({"error": "Invalid background file path"}), 400

        file_path, normalized_src = resolved
        config = load_config()
        library = config.get('backgroundLibrary')
        if not isinstance(library, list):
            library = []

        used_in_library = any(
            isinstance(entry, dict)
            and str(entry.get('image') or entry.get('src') or entry.get('video') or '').replace('\\', '/') == normalized_src
            for entry in library
        )
        if used_in_library:
            return jsonify({"error": "Background file is still referenced in backgroundLibrary"}), 409

        deleted = False
        if os.path.exists(file_path):
            os.remove(file_path)
            deleted = True

        return jsonify({"success": True, "deleted": deleted})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/upload-background-library', methods=['POST'])
def upload_background_library():
    """Upload background media to library (image or video)"""
    try:
        if 'background' not in request.files:
            return jsonify({"error": "No file provided"}), 400

        file = request.files['background']
        filename = file.filename or ''
        if filename == '':
            return jsonify({"error": "No file selected"}), 400

        image_extensions = {'png', 'jpg', 'jpeg', 'gif', 'webp'}
        video_extensions = {'mp4', 'webm', 'mov', 'avi'}
        allowed_extensions = image_extensions | video_extensions

        if '.' not in filename or filename.rsplit('.', 1)[1].lower() not in allowed_extensions:
            return jsonify({"error": "Invalid file type. Allowed: png, jpg, jpeg, gif, webp, mp4, webm, mov, avi"}), 400

        BG_DIR = os.path.join(BASE_DIR, 'static', 'background')
        if not os.path.exists(BG_DIR):
            os.makedirs(BG_DIR)

        filename = secure_filename(filename)
        filepath = os.path.join(BG_DIR, filename)
        file.save(filepath)

        return jsonify({"success": True, "path": f'static/background/{filename}'})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/admin')
def admin():
    """Serve the web-based config editor"""
    return send_from_directory(BASE_DIR, 'admin.html')

def _build_reloader_files():
    files = [CONFIG_FILE]
    try:
        if os.path.isdir(PRESETS_DIR):
            for path in Path(PRESETS_DIR).glob('*.json'):
                files.append(str(path))
    except Exception:
        pass
    return files

if __name__ == '__main__':
    print("=" * 60)
    print("3 Tomoe Config Manager")
    print("=" * 60)
    print(f"\nServer starting on http://localhost:5000")
    print(f"\nMain site: http://localhost:5000/")
    print(f"Admin panel: http://localhost:5000/admin")
    print(f"\nAPI endpoints:")
    print(f"  GET/POST  /api/config")
    print(f"  GET       /api/menu")
    print(f"  GET       /api/presets")
    print(f"  PUT       /api/presets/<id>  (rename)")
    print(f"  GET       /api/applications")
    print(f"  GET       /api/preset-files")
    print("\nPress Ctrl+C to stop")
    print("=" * 60 + "\n")
    
    reloader_files = _build_reloader_files()
    app.run(
        host='0.0.0.0',
        port=5000,
        debug=True,
        use_reloader=True,
        reloader_type='stat',
        extra_files=reloader_files,
        exclude_patterns=[
            '*/static/image/app/*',
            '*/logs/*',
            '*/logs/**/*'
        ]
    )
