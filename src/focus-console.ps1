# Native Windows sessions (Claude Code started in PowerShell, cmd, ...): finds the window or Windows
# Terminal tab of the console Claude (process $ProcessId) runs in and brings it to the front.
# Attaches to that console: a classic console window is focused directly; in Windows Terminal (also
# when it took over as the default terminal) the console title briefly becomes $Marker, which shows
# as the tab's title, so the tab can be found by UI Automation. The title is put back afterwards.
# Prints "tab <UIA runtime id>" when it found the tab. -MarkOnly: only learn the tab, focus nothing.
# Falls back to the window $Hwnd (the first ancestor window the hook found). Exit code 0 if found.
param([int]$ProcessId = 0, [string]$Marker = '', [long]$Hwnd = 0, [switch]$MarkOnly, [int]$WaitMs = 1500)

Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class BuddyCon {
  [DllImport("kernel32.dll")] public static extern bool FreeConsole();
  [DllImport("kernel32.dll", SetLastError = true)] public static extern bool AttachConsole(uint pid);
  [DllImport("kernel32.dll")] public static extern IntPtr GetConsoleWindow();
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] public static extern uint GetConsoleTitle(StringBuilder s, uint n);
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] public static extern bool SetConsoleTitle(string s);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
}
"@

function Show-BuddyWindow([IntPtr]$h) {
  if ([BuddyCon]::IsIconic($h)) { [BuddyCon]::ShowWindow($h, 9) | Out-Null }
  [BuddyCon]::SetForegroundWindow($h) | Out-Null
}

function Use-Fallback {
  if (-not $MarkOnly -and $Hwnd -and [BuddyCon]::IsWindowVisible([IntPtr]$Hwnd)) {
    Show-BuddyWindow ([IntPtr]$Hwnd)
    exit 0
  }
  exit 1
}

if (-not $ProcessId) { Use-Fallback }
[BuddyCon]::FreeConsole() | Out-Null
if (-not [BuddyCon]::AttachConsole([uint32]$ProcessId)) { Use-Fallback } # gone, or elevated

# a classic console window (conhost): that is the session's own window
$cw = [BuddyCon]::GetConsoleWindow()
if ($cw -ne [IntPtr]::Zero) {
  $cls = New-Object System.Text.StringBuilder 256
  [BuddyCon]::GetClassName($cw, $cls, 256) | Out-Null
  if ($cls.ToString() -eq 'ConsoleWindowClass' -and [BuddyCon]::IsWindowVisible($cw)) {
    [BuddyCon]::FreeConsole() | Out-Null
    if ($MarkOnly) { exit 1 }
    Show-BuddyWindow $cw
    exit 0
  }
}
if (-not $Marker) { [BuddyCon]::FreeConsole() | Out-Null; Use-Fallback }

$AE = [System.Windows.Automation.AutomationElement]
$Scope = [System.Windows.Automation.TreeScope]
$winCond = New-Object System.Windows.Automation.PropertyCondition($AE::ClassNameProperty, 'CASCADIA_HOSTING_WINDOW_CLASS')
$tabCond = New-Object System.Windows.Automation.PropertyCondition($AE::ControlTypeProperty, [System.Windows.Automation.ControlType]::TabItem)

$old = New-Object System.Text.StringBuilder 1024
[BuddyCon]::GetConsoleTitle($old, 1024) | Out-Null
[BuddyCon]::SetConsoleTitle($Marker) | Out-Null
$found = $null
$foundWin = $null
$deadline = (Get-Date).AddMilliseconds($WaitMs)
try {
  while (-not $found -and (Get-Date) -lt $deadline) {
    Start-Sleep -Milliseconds 100
    try {
      foreach ($w in $AE::RootElement.FindAll($Scope::Children, $winCond)) {
        foreach ($tab in $w.FindAll($Scope::Descendants, $tabCond)) {
          if ($tab.Current.Name.Contains($Marker)) { $found = $tab; $foundWin = $w; break }
        }
        if ($found) { break }
      }
    } catch {
      # windows/tabs may disappear while we look at them
    }
  }
} finally {
  [BuddyCon]::SetConsoleTitle($old.ToString()) | Out-Null
  [BuddyCon]::FreeConsole() | Out-Null
}

if (-not $found) { Use-Fallback }
[Console]::Out.WriteLine('tab ' + ($found.GetRuntimeId() -join '.'))
if ($MarkOnly) { exit 0 }
Show-BuddyWindow ([IntPtr]$foundWin.Current.NativeWindowHandle)
$found.GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern).Select()
exit 0
