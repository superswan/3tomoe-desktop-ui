#!/usr/bin/env python3
"""
threetop - Live system metrics for overlay widgets.
"""

import time
import subprocess
import re
import ctypes
import shutil
import csv
import io
from ctypes import wintypes
from typing import Optional, Tuple
from pathlib import Path

try:
    import psutil
    _psutil_error = None
except Exception as exc:
    psutil = None
    _psutil_error = str(exc)

from threefetch import get_system_info


_last_static = None
_last_static_at = 0.0
_static_ttl = 20.0
_last_cpu_times: Optional[Tuple[int, int]] = None
_last_tasklist_at = 0.0
_last_tasklist_cpu_times = {}


def _safe_float(value):
    try:
        return float(value)
    except Exception:
        return None


def _resolve_nvidia_smi():
    path = shutil.which('nvidia-smi')
    if path:
        return path
    candidates = [
        r'C:\Program Files\NVIDIA Corporation\NVSMI\nvidia-smi.exe',
        r'C:\Windows\System32\nvidia-smi.exe'
    ]
    for candidate in candidates:
        if Path(candidate).exists():
            return candidate
    return None


class _FILETIME(ctypes.Structure):
    _fields_ = [
        ('dwLowDateTime', wintypes.DWORD),
        ('dwHighDateTime', wintypes.DWORD)
    ]


class _MEMORYSTATUSEX(ctypes.Structure):
    _fields_ = [
        ('dwLength', wintypes.DWORD),
        ('dwMemoryLoad', wintypes.DWORD),
        ('ullTotalPhys', ctypes.c_ulonglong),
        ('ullAvailPhys', ctypes.c_ulonglong),
        ('ullTotalPageFile', ctypes.c_ulonglong),
        ('ullAvailPageFile', ctypes.c_ulonglong),
        ('ullTotalVirtual', ctypes.c_ulonglong),
        ('ullAvailVirtual', ctypes.c_ulonglong),
        ('ullAvailExtendedVirtual', ctypes.c_ulonglong)
    ]


def _filetime_to_int(value):
    return (value.dwHighDateTime << 32) + value.dwLowDateTime


def _extract_gpu_adapter_index(name):
    if not name:
        return None
    match = re.search(r'phys_(\d+)', name, re.IGNORECASE)
    if match:
        try:
            return int(match.group(1))
        except Exception:
            return None
    return None


def _get_gpu_usage():
    # Best-effort GPU utilization from Windows performance counters.
    # Returns total percent and per-adapter list when available.
    try:
        output = subprocess.check_output(
            [
                'wmic',
                'path',
                'Win32_PerfFormattedData_GPUPerformanceCounters_GPUEngine',
                'get',
                'Name,UtilizationPercentage',
                '/format:csv'
            ],
            stderr=subprocess.DEVNULL,
            text=True,
            timeout=1.2
        )
    except Exception:
        return _get_gpu_usage_nvidia_smi()

    total = 0.0
    found = False
    adapters = {}
    for raw in output.splitlines():
        line = raw.strip()
        if not line or line.startswith('Node,'):
            continue
        parts = [part.strip() for part in line.split(',')]
        if len(parts) < 3:
            continue
        name = parts[1]
        value = _safe_float(parts[2])
        if value is None:
            continue
        # Prefer 3D engines to avoid copy/video noise where possible.
        if 'engtype_3D' not in name and 'engtype_3d' not in name:
            continue
        total += value
        found = True
        idx = _extract_gpu_adapter_index(name)
        key = idx if idx is not None else name
        adapters[key] = adapters.get(key, 0.0) + value

    if found:
        adapter_list = []
        for key, value in sorted(adapters.items(), key=lambda item: (item[0] if isinstance(item[0], int) else 999, str(item[0]))):
            adapter_list.append({
                'index': key if isinstance(key, int) else None,
                'percent': max(0.0, min(100.0, value))
            })

        return max(0.0, min(100.0, total)), adapter_list

    return _get_gpu_usage_nvidia_smi()


def _parse_wmic_values(text):
    values = []
    for match in re.findall(r'(-?\d+)', text or ''):
        value = _safe_float(match)
        if value is None:
            continue
        values.append(value)
    return values


def _get_cpu_percent_windows():
    global _last_cpu_times
    try:
        idle = _FILETIME()
        kernel = _FILETIME()
        user = _FILETIME()
        if not ctypes.windll.kernel32.GetSystemTimes(ctypes.byref(idle), ctypes.byref(kernel), ctypes.byref(user)):
            return None
        idle_int = _filetime_to_int(idle)
        kernel_int = _filetime_to_int(kernel)
        user_int = _filetime_to_int(user)
        total_int = kernel_int + user_int
    except Exception:
        return None

    if _last_cpu_times is None:
        _last_cpu_times = (idle_int, total_int)
        return None

    last = _last_cpu_times
    if last is None:
        return None
    last_idle, last_total = last
    delta_total = total_int - last_total
    delta_idle = idle_int - last_idle
    _last_cpu_times = (idle_int, total_int)
    if delta_total <= 0:
        return None
    usage = (delta_total - delta_idle) / float(delta_total) * 100.0
    return max(0.0, min(100.0, usage))


def _get_cpu_percent_fallback():
    windows_cpu = _get_cpu_percent_windows()
    if windows_cpu is None:
        time.sleep(0.05)
        windows_cpu = _get_cpu_percent_windows()
    if windows_cpu is not None:
        return windows_cpu
    try:
        output = subprocess.check_output(
            ['wmic', 'cpu', 'get', 'LoadPercentage', '/value'],
            stderr=subprocess.DEVNULL,
            text=True,
            timeout=1.2
        )
    except Exception:
        return None

    values = _parse_wmic_values(output)
    if not values:
        return None
    return max(0.0, min(100.0, sum(values) / len(values)))


def _get_mem_percent_fallback():
    try:
        output = subprocess.check_output(
            ['wmic', 'OS', 'get', 'FreePhysicalMemory,TotalVisibleMemorySize', '/value'],
            stderr=subprocess.DEVNULL,
            text=True,
            timeout=1.2
        )
    except Exception:
        return None

    free = None
    total = None
    for line in (output or '').splitlines():
        if '=' not in line:
            continue
        key, value = line.split('=', 1)
        key = key.strip().lower()
        value = value.strip()
        if key == 'freephysicalmemory':
            free = _safe_float(value)
        elif key == 'totalvisiblememorysize':
            total = _safe_float(value)

    if free is None or total is None or total <= 0:
        return None

    used = max(0.0, total - free)
    return max(0.0, min(100.0, (used / total) * 100.0))


def _get_mem_breakdown():
    if psutil is not None:
        try:
            vm = psutil.virtual_memory()
            total = float(vm.total)
            available = float(vm.available)
            cached = getattr(vm, 'cached', None)
            if cached is None:
                cached = getattr(vm, 'standby', None)
            cached = float(cached) if cached is not None else 0.0
            used = max(0.0, total - available)
            free = max(0.0, available - cached)
            if total <= 0:
                return None
            return {
                'totalBytes': total,
                'usedBytes': used,
                'cacheBytes': cached,
                'freeBytes': free,
                'usedPercent': (used / total) * 100.0,
                'cachePercent': (cached / total) * 100.0,
                'freePercent': (free / total) * 100.0,
            }
        except Exception:
            return None

    try:
        mem = _MEMORYSTATUSEX()
        mem.dwLength = ctypes.sizeof(_MEMORYSTATUSEX)
        if not ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(mem)):
            return None
        total = float(mem.ullTotalPhys)
        available = float(mem.ullAvailPhys)
        used = max(0.0, total - available)
        if total <= 0:
            return None
        return {
            'totalBytes': total,
            'usedBytes': used,
            'cacheBytes': 0.0,
            'freeBytes': available,
            'usedPercent': (used / total) * 100.0,
            'cachePercent': 0.0,
            'freePercent': (available / total) * 100.0,
        }
    except Exception:
        return None

    try:
        output = subprocess.check_output(
            ['wmic', 'OS', 'get', 'FreePhysicalMemory,TotalVisibleMemorySize', '/value'],
            stderr=subprocess.DEVNULL,
            text=True,
            timeout=1.2
        )
    except Exception:
        return None

    free = None
    total = None
    for line in (output or '').splitlines():
        if '=' not in line:
            continue
        key, value = line.split('=', 1)
        key = key.strip().lower()
        value = value.strip()
        if key == 'freephysicalmemory':
            free = _safe_float(value)
        elif key == 'totalvisiblememorysize':
            total = _safe_float(value)

    if free is None or total is None or total <= 0:
        return None

    total_bytes = total * 1024.0
    free_bytes = free * 1024.0
    used_bytes = max(0.0, total_bytes - free_bytes)
    return {
        'totalBytes': total_bytes,
        'usedBytes': used_bytes,
        'cacheBytes': 0.0,
        'freeBytes': free_bytes,
        'usedPercent': (used_bytes / total_bytes) * 100.0,
        'cachePercent': 0.0,
        'freePercent': (free_bytes / total_bytes) * 100.0,
    }


def _parse_memory_summary(summary):
    if not summary:
        return None
    match = re.search(r'\((\d+(?:\.\d+)?)%\)', str(summary))
    if not match:
        return None
    try:
        return float(match.group(1))
    except Exception:
        return None


def _get_gpu_usage_nvidia_smi():
    cmd = _resolve_nvidia_smi()
    if not cmd:
        return None, []
    try:
        output = subprocess.check_output(
            [cmd, '--query-gpu=utilization.gpu', '--format=csv,noheader,nounits'],
            stderr=subprocess.DEVNULL,
            text=True,
            timeout=1.2
        )
    except Exception:
        return None, []

    values = []
    for line in (output or '').splitlines():
        value = _safe_float(line.strip())
        if value is None:
            continue
        values.append(max(0.0, min(100.0, value)))

    if not values:
        return None, []

    total = sum(values) / len(values)
    adapters = [{'index': idx, 'percent': value} for idx, value in enumerate(values)]
    return total, adapters


def _get_gpu_usage_nvidia_smi_text():
    cmd = _resolve_nvidia_smi()
    if not cmd:
        return None
    try:
        output = subprocess.check_output(
            [cmd, '--query-gpu=utilization.gpu', '--format=csv,noheader,nounits'],
            stderr=subprocess.DEVNULL,
            text=True,
            timeout=1.2
        )
    except Exception:
        return None

    values = []
    for line in (output or '').splitlines():
        value = _safe_float(line.strip())
        if value is None:
            continue
        values.append(max(0.0, min(100.0, value)))

    if not values:
        return None
    return sum(values) / len(values)


def _get_top_processes(limit=8):
    if psutil is None:
        return _get_top_processes_tasklist(limit)

    rows = []
    procs = []
    for proc in psutil.process_iter(['pid', 'name', 'username', 'cmdline', 'memory_percent']):
        try:
            proc.cpu_percent(interval=None)
            procs.append(proc)
        except Exception:
            continue

    if not procs:
        return []

    time.sleep(0.05)

    total_mem_bytes = None
    try:
        vm = psutil.virtual_memory()
        total_mem_bytes = float(vm.total)
    except Exception:
        total_mem_bytes = None

    for proc in procs:
        try:
            info = proc.as_dict(attrs=['pid', 'name', 'username', 'cmdline', 'memory_percent'], ad_value='')

            try:
                cpu = proc.cpu_percent(interval=None)
            except Exception:
                cpu = 0.0

            mem = _safe_float(info.get('memory_percent'))
            if mem is None:
                try:
                    mem = proc.memory_percent()
                except Exception:
                    mem = None

            rss = None
            try:
                rss = proc.memory_info().rss
            except Exception:
                rss = None

            if mem is None and rss is not None and total_mem_bytes and total_mem_bytes > 0:
                mem = (float(rss) / total_mem_bytes) * 100.0

            username = str(info.get('username') or '').strip()
            if '\\' in username:
                username = username.split('\\')[-1]
            if not username:
                username = '--'

            cmdline = info.get('cmdline')
            if isinstance(cmdline, list):
                command = ' '.join(cmdline).strip()
            else:
                command = str(cmdline or '').strip()
            if not command:
                command = info.get('name') or ''

            rows.append({
                'pid': info.get('pid'),
                'user': username[:18],
                'name': (info.get('name') or '')[:28],
                'command': command[:120],
                'cpuPercent': _safe_float(cpu) or 0.0,
                'memPercent': _safe_float(mem) or 0.0,
                'rssBytes': rss
            })
        except Exception:
            continue

    rows.sort(key=lambda item: (item.get('cpuPercent', 0.0), item.get('memPercent', 0.0)), reverse=True)
    try:
        parsed_limit = int(limit)
    except Exception:
        parsed_limit = 8
    if parsed_limit <= 0:
        return rows
    trimmed = rows[:max(1, parsed_limit)]
    if trimmed:
        return trimmed
    return _get_top_processes_tasklist(limit)


def _parse_tasklist_mem_to_bytes(value):
    cleaned = re.sub(r'[^0-9]', '', str(value or ''))
    if not cleaned:
        return None
    try:
        return int(cleaned) * 1024
    except Exception:
        return None


def _parse_tasklist_cpu_time_to_seconds(value):
    text = str(value or '').strip()
    match = re.match(r'^(\d+):(\d+):(\d+)$', text)
    if not match:
        return None
    try:
        h = int(match.group(1))
        m = int(match.group(2))
        s = int(match.group(3))
        return (h * 3600) + (m * 60) + s
    except Exception:
        return None


def _get_top_processes_tasklist(limit=8):
    global _last_tasklist_at, _last_tasklist_cpu_times
    try:
        output = subprocess.check_output(
            ['tasklist', '/V', '/FO', 'CSV', '/NH'],
            stderr=subprocess.DEVNULL,
            text=True,
            timeout=1.5
        )
    except Exception:
        return []

    now = time.time()
    elapsed = max(0.001, now - _last_tasklist_at) if _last_tasklist_at > 0 else None
    logical_cpus = max(1, int((psutil.cpu_count(logical=True) if psutil else 0) or 0))

    total_mem_bytes = None
    mem = _get_mem_breakdown()
    if mem:
        total_mem_bytes = _safe_float(mem.get('totalBytes'))

    current_cpu_times = {}
    rows = []
    reader = csv.reader(io.StringIO(output or ''))
    for parts in reader:
        if len(parts) < 8:
            continue
        name = (parts[0] or '').strip()
        pid_raw = (parts[1] or '').strip()
        mem_raw = (parts[4] or '').strip()
        user_raw = (parts[6] or '').strip()
        cpu_time_raw = (parts[7] or '').strip()
        try:
            pid = int(pid_raw)
        except Exception:
            continue

        rss = _parse_tasklist_mem_to_bytes(mem_raw)
        mem_percent = 0.0
        if rss is not None and total_mem_bytes and total_mem_bytes > 0:
            mem_percent = max(0.0, min(100.0, (float(rss) / float(total_mem_bytes)) * 100.0))

        cpu_percent = 0.0
        cpu_seconds = _parse_tasklist_cpu_time_to_seconds(cpu_time_raw)
        if cpu_seconds is not None:
            current_cpu_times[pid] = cpu_seconds
            if elapsed is not None:
                prev = _last_tasklist_cpu_times.get(pid)
                if prev is not None:
                    delta = max(0.0, float(cpu_seconds) - float(prev))
                    cpu_percent = max(0.0, min(100.0, (delta / (elapsed * logical_cpus)) * 100.0))

        username = user_raw if user_raw else '--'
        if username.lower() in {'n/a', 'na'}:
            username = '--'

        rows.append({
            'pid': pid,
            'user': username[:18],
            'name': name[:28],
            'command': name[:120],
            'cpuPercent': cpu_percent,
            'memPercent': mem_percent,
            'rssBytes': rss
        })

    _last_tasklist_cpu_times = current_cpu_times
    _last_tasklist_at = now

    rows.sort(key=lambda item: item.get('rssBytes') or 0, reverse=True)
    try:
        parsed_limit = int(limit)
    except Exception:
        parsed_limit = 8
    if parsed_limit <= 0:
        return rows
    return rows[:max(1, parsed_limit)]


def _get_static_info_cached():
    global _last_static, _last_static_at
    now = time.time()
    if _last_static is not None and (now - _last_static_at) < _static_ttl:
        return _last_static

    try:
        _last_static = get_system_info() or {}
        _last_static_at = now
    except Exception:
        _last_static = _last_static or {}

    return _last_static


def get_system_live(limit=8):
    static = _get_static_info_cached() or {}

    gpu_from_nvidia = None
    if static.get('gpuPercent') is None:
        gpu_from_nvidia = _get_gpu_usage_nvidia_smi_text()
        if gpu_from_nvidia is not None:
            static['gpuPercent'] = gpu_from_nvidia

    cpu_percent = None
    cpu_cores = []
    if psutil is not None:
        try:
            raw_cores = psutil.cpu_percent(interval=None, percpu=True)
            cpu_cores = []
            for value in raw_cores:
                parsed = _safe_float(value)
                if parsed is None:
                    continue
                cpu_cores.append(parsed)
        except Exception:
            cpu_cores = []

    if cpu_cores:
        cpu_percent = sum(cpu_cores) / len(cpu_cores)

    if cpu_percent is None:
        cpu_percent = _get_cpu_percent_fallback()

    mem = _get_mem_breakdown()
    mem_percent = mem.get('usedPercent') if mem else None

    if mem_percent is None:
        mem_percent = _parse_memory_summary(static.get('memory'))
        if mem_percent is not None:
            free_percent = max(0.0, 100.0 - mem_percent)
            mem = {
                'totalBytes': None,
                'usedBytes': None,
                'cacheBytes': 0.0,
                'freeBytes': None,
                'usedPercent': mem_percent,
                'cachePercent': 0.0,
                'freePercent': free_percent,
            }

    if mem_percent is None:
        mem_percent = _get_mem_percent_fallback()
        if mem_percent is not None:
            free_percent = max(0.0, 100.0 - mem_percent)
            mem = {
                'totalBytes': None,
                'usedBytes': None,
                'cacheBytes': 0.0,
                'freeBytes': None,
                'usedPercent': mem_percent,
                'cachePercent': 0.0,
                'freePercent': free_percent,
            }

    gpu_total, gpu_adapters = _get_gpu_usage()
    if gpu_total is None and gpu_from_nvidia is not None:
        gpu_total = gpu_from_nvidia

    gpu_name = '--'
    gpu_info = static.get('gpu')
    if isinstance(gpu_info, list) and gpu_info:
        first = gpu_info[0]
        if isinstance(first, dict):
            gpu_name = first.get('name') or '--'
        else:
            gpu_name = str(first)
    elif isinstance(gpu_info, dict):
        gpu_name = gpu_info.get('name') or '--'
    elif gpu_info:
        gpu_name = str(gpu_info)

    cpu_name = '--'
    cpu_info = static.get('cpu')
    if isinstance(cpu_info, dict):
        cpu_name = cpu_info.get('name') or '--'
    elif cpu_info:
        cpu_name = str(cpu_info)

    gpu_names = []
    if isinstance(gpu_info, list) and gpu_info:
        for item in gpu_info:
            if isinstance(item, dict):
                gpu_names.append(item.get('name') or '--')
            else:
                gpu_names.append(str(item))
    elif isinstance(gpu_info, dict):
        gpu_names.append(gpu_info.get('name') or '--')
    elif gpu_info:
        gpu_names.append(str(gpu_info))

    adapters = []
    for adapter in gpu_adapters:
        idx = adapter.get('index')
        name = ''
        if isinstance(idx, int) and 0 <= idx < len(gpu_names):
            name = gpu_names[idx]
        elif len(gpu_names) == 1:
            name = gpu_names[0]
        adapters.append({
            'index': idx,
            'name': name,
            'percent': _safe_float(adapter.get('percent'))
        })

    return {
        'userHost': static.get('userHost') or '--',
        'os': static.get('os') or '--',
        'uptime': static.get('uptime') or '--',
        'cpuName': cpu_name,
        'gpuName': gpu_name,
        'memorySummary': static.get('memory') or '--',
        'cpuPercent': _safe_float(cpu_percent),
        'cpuTotal': _safe_float(cpu_percent),
        'cpuCores': cpu_cores,
        'memPercent': _safe_float(mem_percent),
        'mem': mem,
        'gpuPercent': _safe_float(gpu_total),
        'gpuTotal': _safe_float(gpu_total),
        'gpuAdapters': adapters,
        'topProcesses': _get_top_processes(limit=limit),
    }
