$signature = @"
using System;
using System.Runtime.InteropServices;
public static class TaskbarApi {
  [DllImport("user32.dll", SetLastError=true)]
  public static extern IntPtr FindWindow(string lpClassName, string lpWindowName);

  [DllImport("user32.dll", SetLastError=true)]
  public static extern bool IsWindowVisible(IntPtr hWnd);

  [DllImport("user32.dll", SetLastError=true)]
  public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
}
"@

Add-Type -TypeDefinition $signature -ErrorAction SilentlyContinue | Out-Null

$taskbar = [TaskbarApi]::FindWindow("Shell_TrayWnd", $null)
if ($taskbar -eq [IntPtr]::Zero) {
  exit 0
}

if ([TaskbarApi]::IsWindowVisible($taskbar)) {
  [TaskbarApi]::ShowWindow($taskbar, 0) | Out-Null
}
else {
  [TaskbarApi]::ShowWindow($taskbar, 5) | Out-Null
}
