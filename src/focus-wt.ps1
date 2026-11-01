# Focuses a Windows Terminal tab: the one with UI Automation runtime id $TabId (see wt-tabs.js),
# else the one whose title contains $Marker (or $Fallback).
# Falls back to bringing the first Windows Terminal window to the front.
param([string]$TabId = '', [string]$Marker = '', [string]$Fallback = '')

Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class BuddyWin {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
}
"@

$AE = [System.Windows.Automation.AutomationElement]
$Scope = [System.Windows.Automation.TreeScope]
$winCond = New-Object System.Windows.Automation.PropertyCondition($AE::ClassNameProperty, 'CASCADIA_HOSTING_WINDOW_CLASS')
$tabCond = New-Object System.Windows.Automation.PropertyCondition($AE::ControlTypeProperty, [System.Windows.Automation.ControlType]::TabItem)
$windows = $AE::RootElement.FindAll($Scope::Children, $winCond)

function Show-BuddyWindow($w) {
  $h = [IntPtr]$w.Current.NativeWindowHandle
  if ([BuddyWin]::IsIconic($h)) { [BuddyWin]::ShowWindow($h, 9) | Out-Null }
  [BuddyWin]::SetForegroundWindow($h) | Out-Null
}

function Select-BuddyTab($w, $tab) {
  Show-BuddyWindow $w
  $tab.GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern).Select()
  exit 0
}

if ($TabId) {
  foreach ($w in $windows) {
    foreach ($tab in $w.FindAll($Scope::Descendants, $tabCond)) {
      if (($tab.GetRuntimeId() -join '.') -eq $TabId) { Select-BuddyTab $w $tab }
    }
  }
}

foreach ($needle in @($Marker, $Fallback)) {
  if (-not $needle) { continue }
  foreach ($w in $windows) {
    foreach ($tab in $w.FindAll($Scope::Descendants, $tabCond)) {
      if ($tab.Current.Name.Contains($needle)) {
        Show-BuddyWindow $w
        $tab.GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern).Select()
        exit 0
      }
    }
  }
}

if ($windows.Count -gt 0) {
  Show-BuddyWindow $windows[0]
  exit 0
}
exit 1
