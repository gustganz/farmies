# Brings a top-level window of one of the given processes to the front, preferring one whose
# title contains $Title. Exit code 0 if a window was focused.
param([string]$Exe = '', [string]$Title = '')

Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class BuddyWin {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr l);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
}
"@

$names = $Exe.Split(',') | ForEach-Object { [IO.Path]::GetFileNameWithoutExtension($_.Trim()) } | Where-Object { $_ }
$pids = @(Get-Process -Name $names -ErrorAction SilentlyContinue | ForEach-Object { [uint32]$_.Id })
if (-not $pids) { exit 1 }

$script:matching = $null
$script:any = $null
[BuddyWin]::EnumWindows({
    param($h, $l)
    $p = [uint32]0
    [BuddyWin]::GetWindowThreadProcessId($h, [ref]$p) | Out-Null
    if ($pids -contains $p -and [BuddyWin]::IsWindowVisible($h)) {
      $sb = New-Object System.Text.StringBuilder 512
      [BuddyWin]::GetWindowText($h, $sb, 512) | Out-Null
      $text = $sb.ToString()
      if ($text) {
        if (-not $script:any) { $script:any = $h }
        if ($Title -and -not $script:matching -and $text.Contains($Title)) { $script:matching = $h }
      }
    }
    return $true
  }, [IntPtr]::Zero) | Out-Null

$target = if ($script:matching) { $script:matching } elseif (-not $Title) { $script:any } else { $null }
if (-not $target) { exit 1 }
if ([BuddyWin]::IsIconic($target)) { [BuddyWin]::ShowWindow($target, 9) | Out-Null }
[BuddyWin]::SetForegroundWindow($target) | Out-Null
exit 0
