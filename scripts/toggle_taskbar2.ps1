$signature = @"
using System;
using System.Runtime.InteropServices;

public static class TaskbarApi
{
    [StructLayout(LayoutKind.Sequential)]
    public struct APPBARDATA
    {
        public int cbSize;
        public IntPtr hWnd;
        public uint uCallbackMessage;
        public uint uEdge;
        public RECT rc;
        public int lParam;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct RECT
    {
        public int left, top, right, bottom;
    }

    [DllImport("user32.dll", SetLastError=true)]
    public static extern IntPtr FindWindow(string lpClassName, string lpWindowName);

    [DllImport("shell32.dll", SetLastError=true)]
    public static extern UIntPtr SHAppBarMessage(uint dwMessage, ref APPBARDATA pData);

    [DllImport("user32.dll", SetLastError=true)]
    public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

    // AppBar messages
    public const uint ABM_GETSTATE = 0x00000004;
    public const uint ABM_SETSTATE = 0x0000000A;

    // AppBar states
    public const int ABS_AUTOHIDE = 0x00000001;
    public const int ABS_ALWAYSONTOP = 0x00000002;

    // ShowWindow
    public const int SW_HIDE = 0;
    public const int SW_SHOW = 5;
}
"@

Add-Type -TypeDefinition $signature -ErrorAction SilentlyContinue | Out-Null

$taskbar = [TaskbarApi]::FindWindow("Shell_TrayWnd", $null)
if ($taskbar -eq [IntPtr]::Zero) { exit 0 }

# Read current AppBar state
$data = New-Object TaskbarApi+APPBARDATA
$data.cbSize = [Runtime.InteropServices.Marshal]::SizeOf([TaskbarApi+APPBARDATA])
$data.hWnd = $taskbar

$state = [TaskbarApi]::SHAppBarMessage([TaskbarApi]::ABM_GETSTATE, [ref]$data).ToUInt64()

# Toggle auto-hide on/off
$newState = 0
if (($state -band [TaskbarApi]::ABS_AUTOHIDE) -ne 0) {
    # turn autohide off (normal taskbar behavior)
    $newState = [TaskbarApi]::ABS_ALWAYSONTOP
    [TaskbarApi]::ShowWindow($taskbar, [TaskbarApi]::SW_SHOW) | Out-Null
} else {
    # turn autohide on (reclaims work area so maximize fills screen)
    $newState = [TaskbarApi]::ABS_AUTOHIDE
}

$data.lParam = $newState
[TaskbarApi]::SHAppBarMessage([TaskbarApi]::ABM_SETSTATE, [ref]$data) | Out-Null

# Nudge Explorer/taskbar to apply immediately
[TaskbarApi]::ShowWindow($taskbar, [TaskbarApi]::SW_HIDE) | Out-Null
Start-Sleep -Milliseconds 50
[TaskbarApi]::ShowWindow($taskbar, [TaskbarApi]::SW_SHOW) | Out-Null