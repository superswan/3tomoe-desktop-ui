$signature = @"
using System;
using System.Runtime.InteropServices;
public static class KeyboardApi {
  [DllImport("user32.dll")]
  public static extern void keybd_event(byte bVk, byte bScan, int dwFlags, int dwExtraInfo);
}
"@

Add-Type -TypeDefinition $signature -ErrorAction SilentlyContinue | Out-Null

$keyUp = 0x2

[KeyboardApi]::keybd_event(0x5B, 0, 0, 0)      # Win
[KeyboardApi]::keybd_event(0x11, 0, 0, 0)      # Ctrl
[KeyboardApi]::keybd_event(0x10, 0, 0, 0)      # Shift
[KeyboardApi]::keybd_event(0x42, 0, 0, 0)      # B

[KeyboardApi]::keybd_event(0x42, 0, $keyUp, 0)
[KeyboardApi]::keybd_event(0x10, 0, $keyUp, 0)
[KeyboardApi]::keybd_event(0x11, 0, $keyUp, 0)
[KeyboardApi]::keybd_event(0x5B, 0, $keyUp, 0)
