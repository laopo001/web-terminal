param([Parameter(Mandatory=$true)][string]$Output, [int]$ProcessId = 0)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
Add-Type @'
using System;
using System.Runtime.InteropServices;
public class WebTerminalCapture {
  [StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left, Top, Right, Bottom; }
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hwnd, out Rect rect);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr hwnd, IntPtr hdc, uint flags);
}
'@
$windows = @(Get-Process Code | Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle -like '*vscode-smoke-workspace*' })
if ($ProcessId -gt 0) {
  $target = Get-CimInstance Win32_Process -Filter "ProcessId = $ProcessId"
  if ($target.CommandLine -notlike '*web-terminal-vscode-smoke-profile*') { throw 'Process is not owned by this smoke test' }
  $windows = @(Get-Process -Id $ProcessId)
}
if ($windows.Count -ne 1) { throw 'Cannot uniquely identify the smoke test window' }
$rect = New-Object WebTerminalCapture+Rect
[void][WebTerminalCapture]::GetWindowRect($windows[0].MainWindowHandle, [ref]$rect)
$bitmap = New-Object System.Drawing.Bitmap(($rect.Right-$rect.Left), ($rect.Bottom-$rect.Top))
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$hdc = $graphics.GetHdc()
try { if (-not [WebTerminalCapture]::PrintWindow($windows[0].MainWindowHandle, $hdc, 2)) { throw 'PrintWindow failed' } }
finally { $graphics.ReleaseHdc($hdc); $graphics.Dispose() }
try { $bitmap.Save($Output, [System.Drawing.Imaging.ImageFormat]::Png) }
finally { $bitmap.Dispose() }
