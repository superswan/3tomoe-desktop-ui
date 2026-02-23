#!/usr/bin/env python3
"""
threefetch - System Information Grabber for 3 Tomoe Desktop UI
Extracts CPU, GPU, memory, disk, and OS information on Windows.
"""

import ctypes
import getpass
import os
import platform
import re
import shutil
import socket
import string
import struct
import subprocess
import winreg

try:
    import psutil
except Exception:
    psutil = None

try:
    import win32com.client as win32com_client
except Exception:
    win32com_client = None

try:
    import comtypes.client as comtypes_client
except Exception:
    comtypes_client = None


def format_size(bytes_value):
    if bytes_value is None:
        return ''
    size_gib = bytes_value / (1024 ** 3)
    if size_gib >= 1024:
        return f"{size_gib / 1024:.2f} TiB"
    return f"{size_gib:.2f} GiB"


def format_uptime(seconds):
    if seconds is None:
        return ''
    seconds = int(seconds)
    days, remainder = divmod(seconds, 86400)
    hours, remainder = divmod(remainder, 3600)
    minutes, _ = divmod(remainder, 60)
    parts = []
    if days:
        parts.append(f"{days}d")
    if hours:
        parts.append(f"{hours}h")
    parts.append(f"{minutes}m")
    return ' '.join(parts)


def safe_wmic(args):
    try:
        return subprocess.check_output(['wmic'] + args, stderr=subprocess.DEVNULL, text=True)
    except Exception:
        return ''


def parse_wmic_values(output):
    lines = [line.strip() for line in output.splitlines() if line.strip()]
    if len(lines) <= 1:
        return []
    return lines[1:]


def parse_wmic_table(output):
    lines = [line.strip() for line in output.splitlines() if line.strip()]
    if len(lines) < 2:
        return []
    headers = re.split(r'\s{2,}', lines[0].strip())
    rows = []
    for line in lines[1:]:
        values = re.split(r'\s{2,}', line.strip())
        row = {}
        for idx, header in enumerate(headers):
            if idx < len(values):
                row[header] = values[idx]
        rows.append(row)
    return rows


def wmi_query(namespace, query, fields):
    if win32com_client:
        try:
            locator = win32com_client.Dispatch('WbemScripting.SWbemLocator')
            service = locator.ConnectServer('.', namespace)
            results = []
            for item in service.ExecQuery(query):
                row = {}
                for field in fields:
                    try:
                        row[field] = getattr(item, field)
                    except Exception:
                        row[field] = None
                results.append(row)
            if results:
                return results
        except Exception:
            pass
    if comtypes_client:
        try:
            locator = comtypes_client.CreateObject('WbemScripting.SWbemLocator')
            service = locator.ConnectServer('.', namespace)
            results = []
            for item in service.ExecQuery(query):
                row = {}
                for field in fields:
                    try:
                        row[field] = getattr(item, field)
                    except Exception:
                        row[field] = None
                results.append(row)
            return results
        except Exception:
            return []
    return []


def read_reg_value(root, path, name):
    try:
        with winreg.OpenKey(root, path) as key:
            value, _ = winreg.QueryValueEx(key, name)
            return value
    except Exception:
        return None


def count_bits(mask):
    return bin(mask).count('1')


def get_registry_cpu_info():
    path = r'HARDWARE\DESCRIPTION\System\CentralProcessor\0'
    return {
        'name': read_reg_value(winreg.HKEY_LOCAL_MACHINE, path, 'ProcessorNameString'),
        'identifier': read_reg_value(winreg.HKEY_LOCAL_MACHINE, path, 'Identifier'),
        'mhz': read_reg_value(winreg.HKEY_LOCAL_MACHINE, path, '~MHz')
    }


def get_cpuid_brand():
    def get_cpuid_func():
        for lib_name in ('msvcrt', 'ucrtbase'):
            try:
                lib = ctypes.CDLL(lib_name)
                func = lib.__cpuidex
                func.argtypes = [ctypes.POINTER(ctypes.c_int), ctypes.c_int, ctypes.c_int]
                return func
            except Exception:
                continue
        return None

    func = get_cpuid_func()
    if not func:
        return ''

    brand = b''
    for code in (0x80000002, 0x80000003, 0x80000004):
        regs = (ctypes.c_int * 4)()
        func(regs, code, 0)
        brand += struct.pack('4i', *regs)
    return brand.split(b'\0')[0].decode('ascii', errors='ignore').strip()


def get_cpu_counts():
    physical = 0
    logical = 0
    try:
        RelationProcessorCore = 0
        size = ctypes.c_ulong(0)
        kernel32 = ctypes.windll.kernel32
        kernel32.GetLogicalProcessorInformationEx(RelationProcessorCore, None, ctypes.byref(size))
        if size.value:
            buf = ctypes.create_string_buffer(size.value)
            if kernel32.GetLogicalProcessorInformationEx(RelationProcessorCore, buf, ctypes.byref(size)):
                offset = 0
                while offset < size.value:
                    rel, entry_size = struct.unpack_from('II', buf, offset)
                    if rel == RelationProcessorCore:
                        physical += 1
                        group_count = struct.unpack_from('H', buf, offset + 30)[0]
                        gm_offset = offset + 32
                        for idx in range(group_count):
                            mask = struct.unpack_from('Q', buf, gm_offset + idx * 16)[0]
                            logical += count_bits(mask)
                    offset += entry_size
    except Exception:
        pass
    if not physical or not logical:
        if psutil:
            physical = physical or (psutil.cpu_count(logical=False) or 0)
            logical = logical or (psutil.cpu_count(logical=True) or 0)
    return physical, logical


def get_cpu_power_info(logical_count):
    try:
        class PROCESSOR_POWER_INFORMATION(ctypes.Structure):
            _fields_ = [
                ('Number', ctypes.c_ulong),
                ('MaxMhz', ctypes.c_ulong),
                ('CurrentMhz', ctypes.c_ulong),
                ('MhzLimit', ctypes.c_ulong),
                ('MaxIdleState', ctypes.c_ulong),
                ('CurrentIdleState', ctypes.c_ulong)
            ]

        powrprof = ctypes.WinDLL('powrprof')
        info = (PROCESSOR_POWER_INFORMATION * logical_count)()
        res = powrprof.CallNtPowerInformation(11, None, 0, ctypes.byref(info), ctypes.sizeof(info))
        if res != 0:
            return None, None
        max_mhz = max((item.MaxMhz for item in info), default=0)
        current_mhz = max((item.CurrentMhz for item in info), default=0)
        return max_mhz, current_mhz
    except Exception:
        return None, None


def get_cpu_temperature():
    rows = wmi_query('root\\WMI', 'SELECT CurrentTemperature FROM MSAcpi_ThermalZoneTemperature', ['CurrentTemperature'])
    temps = []
    for row in rows:
        raw = row.get('CurrentTemperature')
        if raw is None:
            continue
        try:
            temp_c = (float(raw) / 10.0) - 273.15
            temps.append(temp_c)
        except Exception:
            continue
    if temps:
        return f"{round(max(temps))}C"
    return ''


def get_display_devices():
    class DISPLAY_DEVICEW(ctypes.Structure):
        _fields_ = [
            ('cb', ctypes.c_ulong),
            ('DeviceName', ctypes.c_wchar * 32),
            ('DeviceString', ctypes.c_wchar * 128),
            ('StateFlags', ctypes.c_ulong),
            ('DeviceID', ctypes.c_wchar * 128),
            ('DeviceKey', ctypes.c_wchar * 128)
        ]

    devices = []
    i = 0
    while True:
        dev = DISPLAY_DEVICEW()
        dev.cb = ctypes.sizeof(DISPLAY_DEVICEW)
        if not ctypes.windll.user32.EnumDisplayDevicesW(None, i, ctypes.byref(dev), 0):
            break
        if dev.DeviceString and dev.DeviceString not in devices:
            devices.append(dev.DeviceString)
        i += 1
    return devices


def get_registry_gpu_info():
    class_guid = '{4d36e968-e325-11ce-bfc1-08002be10318}'
    base_path = f'SYSTEM\\CurrentControlSet\\Control\\Class\\{class_guid}'
    entries = []
    try:
        with winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, base_path) as base:
            index = 0
            while True:
                try:
                    subkey_name = winreg.EnumKey(base, index)
                except OSError:
                    break
                index += 1
                try:
                    with winreg.OpenKey(base, subkey_name) as subkey:
                        desc = read_reg_value(winreg.HKEY_LOCAL_MACHINE, base_path + '\\' + subkey_name, 'DriverDesc')
                        provider = read_reg_value(winreg.HKEY_LOCAL_MACHINE, base_path + '\\' + subkey_name, 'ProviderName')
                        version = read_reg_value(winreg.HKEY_LOCAL_MACHINE, base_path + '\\' + subkey_name, 'DriverVersion')
                        if desc:
                            entries.append({'name': desc, 'provider': provider, 'driver': version})
                except Exception:
                    continue
    except Exception:
        return []
    return entries


def get_directx_video_id():
    value = read_reg_value(winreg.HKEY_LOCAL_MACHINE, r'SOFTWARE\\Microsoft\\DirectX', 'VideoID')
    if value:
        return str(value)
    return ''


def get_uptime_seconds():
    try:
        if os.name == 'nt':
            return ctypes.windll.kernel32.GetTickCount64() / 1000.0
    except Exception:
        return None
    return None


def get_memory_summary():
    try:
        class MEMORYSTATUSEX(ctypes.Structure):
            _fields_ = [
                ('dwLength', ctypes.c_ulong),
                ('dwMemoryLoad', ctypes.c_ulong),
                ('ullTotalPhys', ctypes.c_ulonglong),
                ('ullAvailPhys', ctypes.c_ulonglong),
                ('ullTotalPageFile', ctypes.c_ulonglong),
                ('ullAvailPageFile', ctypes.c_ulonglong),
                ('ullTotalVirtual', ctypes.c_ulonglong),
                ('ullAvailVirtual', ctypes.c_ulonglong),
                ('ullAvailExtendedVirtual', ctypes.c_ulonglong)
            ]

        stat = MEMORYSTATUSEX()
        stat.dwLength = ctypes.sizeof(MEMORYSTATUSEX)
        if not ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(stat)):
            return ''
        total = stat.ullTotalPhys
        avail = stat.ullAvailPhys
        used = total - avail
        pct = int(round((used / total) * 100)) if total else 0
        return f"{format_size(used)} / {format_size(total)} ({pct}%)"
    except Exception:
        return ''


def get_display_info():
    try:
        width = ctypes.windll.user32.GetSystemMetrics(0)
        height = ctypes.windll.user32.GetSystemMetrics(1)
        freq = None
        class DEVMODEW(ctypes.Structure):
            _fields_ = [
                ('dmDeviceName', ctypes.c_wchar * 32),
                ('dmSpecVersion', ctypes.c_ushort),
                ('dmDriverVersion', ctypes.c_ushort),
                ('dmSize', ctypes.c_ushort),
                ('dmDriverExtra', ctypes.c_ushort),
                ('dmFields', ctypes.c_ulong),
                ('dmOrientation', ctypes.c_short),
                ('dmPaperSize', ctypes.c_short),
                ('dmPaperLength', ctypes.c_short),
                ('dmPaperWidth', ctypes.c_short),
                ('dmScale', ctypes.c_short),
                ('dmCopies', ctypes.c_short),
                ('dmDefaultSource', ctypes.c_short),
                ('dmPrintQuality', ctypes.c_short),
                ('dmColor', ctypes.c_short),
                ('dmDuplex', ctypes.c_short),
                ('dmYResolution', ctypes.c_short),
                ('dmTTOption', ctypes.c_short),
                ('dmCollate', ctypes.c_short),
                ('dmFormName', ctypes.c_wchar * 32),
                ('dmLogPixels', ctypes.c_ushort),
                ('dmBitsPerPel', ctypes.c_ulong),
                ('dmPelsWidth', ctypes.c_ulong),
                ('dmPelsHeight', ctypes.c_ulong),
                ('dmDisplayFlags', ctypes.c_ulong),
                ('dmDisplayFrequency', ctypes.c_ulong)
            ]

        devmode = DEVMODEW()
        devmode.dmSize = ctypes.sizeof(DEVMODEW)
        if ctypes.windll.user32.EnumDisplaySettingsW(None, -1, ctypes.byref(devmode)):
            freq = devmode.dmDisplayFrequency
        if freq and freq > 1:
            return f"{width}x{height} @ {freq}Hz"
        return f"{width}x{height}"
    except Exception:
        return ''


def get_os_info():
    rows = wmi_query('root\\cimv2', 'SELECT Caption, Version FROM Win32_OperatingSystem', ['Caption', 'Version'])
    if rows:
        caption = (rows[0].get('Caption') or '').strip()
        version = (rows[0].get('Version') or '').strip()
        return f"{caption} {version}".strip()
    output = safe_wmic(['os', 'get', 'Caption,Version'])
    rows = parse_wmic_table(output)
    if rows:
        caption = rows[0].get('Caption', '').strip()
        version = rows[0].get('Version', '').strip()
        return f"{caption} {version}".strip()
    return platform.platform()


def get_host_info():
    bios_path = r'HARDWARE\\DESCRIPTION\\System\\BIOS'
    product = read_reg_value(winreg.HKEY_LOCAL_MACHINE, bios_path, 'SystemProductName')
    serial = read_reg_value(winreg.HKEY_LOCAL_MACHINE, bios_path, 'SystemSerialNumber')
    product = str(product).strip() if product else ''
    serial = str(serial).strip() if serial else ''
    if serial and product:
        return f"{serial} ({product})"
    if serial:
        return serial
    if product:
        return product

    prod_rows = wmi_query(
        'root\\cimv2',
        'SELECT Vendor, Name, Version, IdentifyingNumber, UUID, SKUNumber, Family FROM Win32_ComputerSystemProduct',
        ['Vendor', 'Name', 'Version', 'IdentifyingNumber', 'UUID', 'SKUNumber', 'Family']
    )
    bios_rows = wmi_query('root\\cimv2', 'SELECT SerialNumber FROM Win32_BIOS', ['SerialNumber'])

    product_id = (prod_rows[0].get('Name') if prod_rows else '') or ''
    product_name = (prod_rows[0].get('Version') if prod_rows else '') or ''
    serial = (prod_rows[0].get('IdentifyingNumber') if prod_rows else '') or ''
    if not serial:
        serial = (bios_rows[0].get('SerialNumber') if bios_rows else '') or ''

    product_id = str(product_id).strip()
    product_name = str(product_name).strip()
    product = product_name or product_id
    serial = str(serial).strip()
    if serial and product:
        return f"{serial} ({product})"
    if serial:
        return serial
    if product:
        return product

    output = safe_wmic(['computersystem', 'get', 'Manufacturer,Model'])
    rows = parse_wmic_table(output)
    if rows:
        manufacturer = rows[0].get('Manufacturer', '').strip()
        model = rows[0].get('Model', '').strip()
        return f"{manufacturer} {model}".strip()
    return platform.node()


def get_cpu_info():
    registry = get_registry_cpu_info()
    wmi_rows = wmi_query('root\\cimv2', 'SELECT Name, Manufacturer, NumberOfCores, NumberOfLogicalProcessors, MaxClockSpeed, ProcessorId FROM Win32_Processor', ['Name', 'Manufacturer', 'NumberOfCores', 'NumberOfLogicalProcessors', 'MaxClockSpeed', 'ProcessorId'])
    wmi = wmi_rows[0] if wmi_rows else {}

    name = get_cpuid_brand() or registry.get('name') or (wmi.get('Name') if wmi else '') or ''
    physical, logical = get_cpu_counts()
    if not physical:
        cores_value = wmi.get('NumberOfCores') if wmi else None
        if cores_value is not None:
            try:
                physical = int(cores_value)
            except Exception:
                physical = 0
    if not logical:
        logical_value = wmi.get('NumberOfLogicalProcessors') if wmi else None
        if logical_value is not None:
            try:
                logical = int(logical_value)
            except Exception:
                logical = 0
    if not logical and psutil:
        logical = psutil.cpu_count(logical=True) or 0

    label = str(name).strip() if name else platform.processor()
    sub = f"{physical}C/{logical}T" if (physical or logical) else ''
    return {
        'name': label,
        'sub': sub
    }


def get_gpu_info():
    wmi_rows = wmi_query('root\\cimv2', 'SELECT Name, DriverVersion, PNPDeviceID FROM Win32_VideoController', ['Name', 'DriverVersion', 'PNPDeviceID'])
    entries = []
    for row in wmi_rows:
        name = row.get('Name') or ''
        driver = row.get('DriverVersion') or ''
        if not name:
            continue
        entries.append({'name': str(name).strip(), 'driver': str(driver).strip()})

    if not entries:
        reg_entries = get_registry_gpu_info()
        for entry in reg_entries:
            name = entry.get('name') or ''
            driver = entry.get('driver') or ''
            if not name:
                continue
            entries.append({'name': str(name).strip(), 'driver': str(driver).strip()})

    if not entries:
        devices = get_display_devices()
        for dev in devices:
            entries.append({'name': dev, 'driver': ''})

    return entries


def get_kernel_info():
    release = platform.release()
    version = platform.version()
    if release and version:
        return f"{release} {version}"
    return release or version


def get_local_ip():
    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        sock.connect(('8.8.8.8', 80))
        ip = sock.getsockname()[0]
        sock.close()
        if ip:
            return ip
    except Exception:
        pass
    try:
        return socket.gethostbyname(socket.gethostname())
    except Exception:
        return ''


def get_filesystem_type(drive):
    try:
        fs_name = ctypes.create_unicode_buffer(64)
        res = ctypes.windll.kernel32.GetVolumeInformationW(
            ctypes.c_wchar_p(drive), None, 0, None, None, None, fs_name, len(fs_name)
        )
        if res:
            return fs_name.value
    except Exception:
        return ''
    return ''


def get_drive_type(drive):
    try:
        return ctypes.windll.kernel32.GetDriveTypeW(ctypes.c_wchar_p(drive))
    except Exception:
        return 0


def get_disks_info():
    disks = []
    for letter in string.ascii_uppercase:
        drive = f"{letter}:\\"
        if not os.path.exists(drive):
            continue
        try:
            usage = shutil.disk_usage(drive)
        except Exception:
            continue
        total = usage.total
        used = total - usage.free
        pct = int(round((used / total) * 100)) if total else 0
        fs_type = get_filesystem_type(drive)
        drive_type = get_drive_type(drive)
        tag = ''
        if drive_type == 2:
            tag = 'EXT'
        elif drive_type == 4:
            tag = 'NET'
        disks.append({
            'vol': f"{letter}:",
            'used': format_size(used),
            'total': format_size(total),
            'pct': f"{pct}%",
            'fs': fs_type or '',
            'tag': tag
        })
    return disks


def get_system_info():
    user = getpass.getuser()
    hostname = socket.gethostname()
    user_host = f"{user}@{hostname}" if user and hostname else (hostname or user)
    uptime = format_uptime(get_uptime_seconds())
    def ensure(value):
        return value if value else 'Unavailable'
    disks = get_disks_info()
    return {
        'userHost': ensure(user_host),
        'os': ensure(get_os_info()),
        'host': ensure(get_host_info()),
        'kernel': ensure(get_kernel_info()),
        'uptime': ensure(uptime),
        'display': ensure(get_display_info()),
        'cpu': get_cpu_info(),
        'gpu': get_gpu_info(),
        'memory': ensure(get_memory_summary()),
        'disks': disks,
        'localIp': ensure(get_local_ip())
    }


if __name__ == '__main__':
    import json
    print(json.dumps(get_system_info(), indent=2))
