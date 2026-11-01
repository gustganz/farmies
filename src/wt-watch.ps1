# Prints the tabs of all Windows Terminal windows as one JSON line whenever they change:
#   [{"id":"<UIA runtime id>","title":"...","hwnd":123}, ...]
# Exits when the parent process (the buddy app) is gone.
param([int]$ParentPid = 0, [int]$IntervalMs = 700)

Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$AE = [System.Windows.Automation.AutomationElement]
$Scope = [System.Windows.Automation.TreeScope]
$winCond = New-Object System.Windows.Automation.PropertyCondition($AE::ClassNameProperty, 'CASCADIA_HOSTING_WINDOW_CLASS')
$tabCond = New-Object System.Windows.Automation.PropertyCondition($AE::ControlTypeProperty, [System.Windows.Automation.ControlType]::TabItem)

$last = ''
while ($true) {
  if ($ParentPid -and -not (Get-Process -Id $ParentPid -ErrorAction SilentlyContinue)) { exit 0 }
  $tabs = @()
  try {
    foreach ($w in $AE::RootElement.FindAll($Scope::Children, $winCond)) {
      $hwnd = $w.Current.NativeWindowHandle
      foreach ($t in $w.FindAll($Scope::Descendants, $tabCond)) {
        $tabs += [pscustomobject]@{ id = ($t.GetRuntimeId() -join '.'); title = $t.Current.Name; hwnd = $hwnd }
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
