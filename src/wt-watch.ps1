# Prints the tabs of all Windows Terminal windows as one JSON line whenever they change:
#   [{"id":"<UIA runtime id>","title":"...","hwnd":123,"focused":true}, ...]
# focused: the tab is the selected one of the window in the foreground (the user is in it).
# Exits when the parent process (the buddy app) is gone.
param([int]$ParentPid = 0, [int]$IntervalMs = 700)

Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class BuddyFg {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
}
'@
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$AE = [System.Windows.Automation.AutomationElement]
$Scope = [System.Windows.Automation.TreeScope]
$winCond = New-Object System.Windows.Automation.PropertyCondition($AE::ClassNameProperty, 'CASCADIA_HOSTING_WINDOW_CLASS')
$tabCond = New-Object System.Windows.Automation.PropertyCondition($AE::ControlTypeProperty, [System.Windows.Automation.ControlType]::TabItem)

$last = ''
while ($true) {
  if ($ParentPid -and -not (Get-Process -Id $ParentPid -ErrorAction SilentlyContinue)) { exit 0 }
  $tabs = @()
  $fg = [BuddyFg]::GetForegroundWindow().ToInt64()
  try {
    foreach ($w in $AE::RootElement.FindAll($Scope::Children, $winCond)) {
      $hwnd = $w.Current.NativeWindowHandle
      foreach ($t in $w.FindAll($Scope::Descendants, $tabCond)) {
        $focused = $false
        if ($hwnd -eq $fg) {
          $sel = $null
          if ($t.TryGetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern, [ref]$sel)) { $focused = $sel.Current.IsSelected }
        }
        $tabs += [pscustomobject]@{ id = ($t.GetRuntimeId() -join '.'); title = $t.Current.Name; hwnd = $hwnd; focused = $focused }
      }
    }
  } catch {
    # windows/tabs may disappear while we look at them; try again next round
  }
  $json = ConvertTo-Json -Compress -InputObject @($tabs)
  if ($json -ne $last) {
    [Console]::Out.WriteLine($json)
    [Console]::Out.Flush()
    $last = $json
  }
  Start-Sleep -Milliseconds $IntervalMs
}
