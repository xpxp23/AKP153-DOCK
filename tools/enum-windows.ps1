param([Parameter(Mandatory=$true)][string]$Out)
# Enumerate visible top-level windows -> "<process>|<title>" lines, UTF-8.
Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public class WinEnum {
  public delegate bool Proc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(Proc f, IntPtr l);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern int GetWindowTextLength(IntPtr h);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern int GetWindowThreadProcessId(IntPtr h, out int pid);
}
"@
$sb  = New-Object System.Text.StringBuilder 512
$acc = New-Object System.Collections.ArrayList
$cb  = [WinEnum+Proc]{
  param($h, $l)
  if ([WinEnum]::IsWindowVisible($h)) {
    $len = [WinEnum]::GetWindowTextLength($h)
    if ($len -gt 0) {
      [void]$sb.Clear()
      [void][WinEnum]::GetWindowText($h, $sb, 512)
      $pid2 = 0
      [void][WinEnum]::GetWindowThreadProcessId($h, [ref]$pid2)
      $p = (Get-Process -Id $pid2 -ErrorAction SilentlyContinue).ProcessName
      [void]$acc.Add("$p|$($sb.ToString())")
    }
  }
  return $true
}
[void][WinEnum]::EnumWindows($cb, [IntPtr]::Zero)
$acc | Sort-Object | Set-Content -Path $Out -Encoding UTF8
