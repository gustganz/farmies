# Farmies hook for Claude Code on native Windows (Claude started in PowerShell, cmd, Windows
# Terminal, an editor terminal; not WSL, that is farmies-hook.sh). Called by Claude Code hooks as
#   powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File hook.ps1 <EventName>
# with the hook JSON on stdin; the command works in Git Bash and PowerShell, whichever Claude uses.
# Writes one small JSON file per session into ~\.farmies\sessions (latest event wins), like the sh
# hook. Never fails: whatever goes wrong, the exit code is 0 (exit code 2 would block Claude).
# Windows PowerShell 5.1 compatible, ASCII only (5.1 reads scripts without BOM as ANSI).
param([string]$Name = '')

$ErrorActionPreference = 'Stop'

# A text shortened for the hover panel to 300 characters, never ending in half a surrogate pair.
function Clip($text) {
  $t = [string]$text
  if ($t.Length -gt 300) { $t = $t.Substring(0, 300) }
  if ($t.Length -and [char]::IsHighSurrogate($t[$t.Length - 1])) { $t = $t.Substring(0, $t.Length - 1) }
  return $t
}

# What a tool call does, for the panel: "Edit - src\app.js", "Bash - npm test"
function ToolStep($data, $cwd) {
  $tool = [string]$data.tool_name
  $target = ''
  $ti = $data.tool_input
  if ($ti) {
    foreach ($key in 'file_path', 'command', 'pattern', 'url', 'query', 'description') {
      $v = $ti.$key
      if ($v -is [string] -and $v) { $target = $v; break }
    }
  }
  if ($cwd -and $target.StartsWith("$cwd\", [StringComparison]::OrdinalIgnoreCase)) { $target = $target.Substring($cwd.Length + 1) }
  if ($target) { return Clip "$tool $([char]0x00B7) $target" }
  return Clip $tool
}

# commands that keep running until stopped: servers, watchers, followed logs (as in the sh hook)
$ServerRe = '(^|[^a-zA-Z])serve|[:\s"](dev|start|preview|watch|up)([\s":]|$)|--watch|watch\s|nodemon|http\.server|runserver|tail\s+-[a-zA-Z]*[fF]|docker[\s-]+compose\s+up'
# background tasks that are subscriptions, not work: they never end by themselves
$SubscriptionRe = '^live updates for|re-armed on session resume'

# Claude ended its turn but background work is still running (see farmies-hook.sh): handed over to
# the user when Claude asked something (whatever still runs), or when only shells run that never end
# by themselves (a dev server).
function HandedOver($tasks, $lastMessage) {
  if (([string]$lastMessage -replace '(\\n|[\s*_`)])+$', '').EndsWith('?')) { return $true }
  foreach ($t in $tasks) { if (-not ($t.command -is [string])) { return $false } }
  foreach ($t in $tasks) { if (('"' + $t.command + '"') -notmatch $ServerRe) { return $false } }
  return $true
}

# Hosts a session can run in, by the process name of an ancestor (first match wins).
$Hosts = @{
  'cursor' = 'cursor'; 'code' = 'vscode'; 'code - insiders' = 'vscode-insiders'; 'windsurf' = 'windsurf'
  'windowsterminal' = 'wt'
}
$JetBrains = 'idea64', 'phpstorm64', 'webstorm64', 'pycharm64', 'goland64', 'rider64', 'clion64', 'rubymine64', 'datagrip64', 'rustrover64'
# Wrappers between Claude and this hook: the shell Claude runs the hook command in.
$Wrappers = 'powershell', 'pwsh', 'cmd', 'bash', 'sh', 'dash', 'zsh', 'env', 'conhost'

# Where the session runs (see detect_context in farmies-hook.sh):
#   term: cursor | vscode | vscode-insiders | windsurf | jetbrains | wt | console
#   pids: the hook's ancestors (editor terminals are matched by their shell pid)
#   cpid, cstart: Claude's own pid and start time (FILETIME, UTC), to see whether it still runs
#   hwnd: the first ancestor with a window (a classic console window, the terminal, the editor)
function DetectContext($state, $cwd) {
  $procs = @{}
  foreach ($p in Get-CimInstance Win32_Process -Property ProcessId, ParentProcessId, Name) {
    $procs[[int]$p.ProcessId] = $p
  }
  $chain = @()
  $id = [int]$procs[[int]$PID].ParentProcessId
  for ($i = 0; $i -lt 12 -and $id -gt 4 -and $procs.ContainsKey($id); $i++) {
    $chain += $id
    $id = [int]$procs[$id].ParentProcessId
  }
  $term = ''
  $cpid = 0
  foreach ($id in $chain) {
    $n = [IO.Path]::GetFileNameWithoutExtension([string]$procs[$id].Name).ToLowerInvariant()
    if (-not $cpid -and $Wrappers -notcontains $n) { $cpid = $id }
    if (-not $term) {
      if ($Hosts.ContainsKey($n)) { $term = $Hosts[$n] }
      elseif ($JetBrains -contains $n) { $term = 'jetbrains' }
    }
  }
  if (-not $term) {
    if ($env:TERMINAL_EMULATOR -eq 'JetBrains-JediTerm') { $term = 'jetbrains' }
    elseif ($env:TERM_PROGRAM -eq 'vscode') { $term = 'vscode' }
    elseif ($env:WT_SESSION) { $term = 'wt' }
    else { $term = 'console' }
  }
  $state.term = $term
  $state.pids = ($chain -join ' ')
  $state.cpid = [string]$cpid
  $hwnd = 0
  if ($chain.Count) {
    $byId = @{}
    foreach ($p in Get-Process -Id $chain -ErrorAction SilentlyContinue) { $byId[$p.Id] = $p }
    if ($cpid -and $byId.ContainsKey($cpid)) {
      try { $state.cstart = [string]$byId[$cpid].StartTime.ToFileTimeUtc() } catch { }
    }
    foreach ($id in $chain) {
      if ($byId.ContainsKey($id) -and $byId[$id].MainWindowHandle -ne [IntPtr]::Zero) { $hwnd = $byId[$id].MainWindowHandle.ToInt64(); break }
    }
  }
  $state.hwnd = [string]$hwnd

  $state.folder = $cwd
  $state.branch = ''
  # git writes to stderr outside a repository, which Windows PowerShell turns into errors
  $ErrorActionPreference = 'SilentlyContinue'
  if ($cwd -and (Get-Command git.exe -ErrorAction SilentlyContinue)) {
    $top = & git.exe -C $cwd rev-parse --show-toplevel 2>$null
    if ($LASTEXITCODE -eq 0 -and $top) { $state.folder = ([string]$top).Trim().Replace('/', '\') }
    $b = & git.exe -C $cwd branch --show-current 2>$null
    if ($LASTEXITCODE -eq 0 -and $b) { $state.branch = ([string]$b).Trim() }
  }
}

# Context detection is a nicety: when it fails, the state is still written.
function TryDetect($state, $cwd) {
  try { DetectContext $state $cwd } catch { }
}

function WriteJson($path, $obj) {
  $tmp = Join-Path ([IO.Path]::GetDirectoryName($path)) ('.' + [IO.Path]::GetFileName($path) + '.tmp')
  $json = $obj | ConvertTo-Json -Compress -Depth 3
  [IO.File]::WriteAllText($tmp, $json + "`n", (New-Object Text.UTF8Encoding $false))
  Move-Item -LiteralPath $tmp -Destination $path -Force
}

try {
  $stdin = [Console]::OpenStandardInput()
  $buf = New-Object IO.MemoryStream
  $stdin.CopyTo($buf)
  $data = [Text.Encoding]::UTF8.GetString($buf.ToArray()) | ConvertFrom-Json

  $sid = [string]$data.session_id -replace '[^A-Za-z0-9_-]', ''
  if (-not $sid) { exit 0 }
  $userHome = $env:USERPROFILE
  if (-not $userHome) { $userHome = [Environment]::GetFolderPath('UserProfile') }
  $dir = Join-Path $userHome '.farmies\sessions'
  $attnDir = Join-Path $userHome '.farmies\attn'
  $file = Join-Path $dir "$sid.json"
  $attn = Join-Path $attnDir $sid
  $cwd = [string]$data.cwd

  $prev = $null
  if (Test-Path -LiteralPath $file) {
    try { $prev = [IO.File]::ReadAllText($file) | ConvertFrom-Json } catch { }
  }
  # Context for the hover panel, kept from the previous state file (see farmies-hook.sh)
  $state = [ordered]@{
    session_id = $sid; event = $Name; cwd = $cwd; folder = $cwd; message = ''; type = ''; term = ''; app = ''; tty = ''
    pids = ''; cpid = ''; cstart = ''; distro = ''; transcript = [string]$data.transcript_path; branch = ''
    task = ''; title = ''; detail = ''; bg = ''; agents = ''; reply = ''; step = ''; hwnd = ''; ts = 0
  }
  if ($prev) {
    $state.task = [string]$prev.task
    $state.title = [string]$prev.title
    $state.step = [string]$prev.step
  }
  $now = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()

  # PreToolUse is only registered for AskUserQuestion: Claude asks the user a question.
  if ($Name -eq 'PreToolUse') { $Name = 'Question' }
  # a failed or denied tool call also means the session went on
  if ($Name -eq 'PostToolUseFailure') { $Name = 'PostToolUse' }
  if ($Name -eq 'Stop') {
    # subscriptions that only wait for events from outside (live updates of an artifact, re-armed on
    # every resume) are not work Claude waits for
    # and neither is Claude Code's own housekeeping (auto mode setup scan, memory consolidation, memory save)
    $tasks = @($data.background_tasks | Where-Object {
        $_ -and ([string]$_.description -notmatch $SubscriptionRe) -and ('auto-mode scan', 'dream', 'memory save' -notcontains [string]$_.type)
      })
    if ($tasks.Count) {
      $state.bg = [string]$tasks.Count
      $first = $tasks[0]
      if (HandedOver $tasks $data.last_assistant_message) {
        # Claude asked the user, or only shells keep running: done, the running shells are just noted
        $shells = @($tasks | Where-Object { $_.command -is [string] })
        $state.bg = if ($shells.Count) { [string]$shells.Count } else { '' }
        if ($shells.Count) { $state.step = Clip $shells[0].command }
      } else {
        $Name = 'Background'
        # the ids of the subagents among them: the app sees from their transcripts whether they still work
        $state.agents = (@($tasks | Where-Object { [string]$_.type -eq 'subagent' } | ForEach-Object { [string]$_.id }) -join ' ')
        $state.reply = Clip $data.last_assistant_message
        $d = [string]$first.command
        if (-not $d) { $d = [string]$first.description }
        $state.detail = Clip $d
      }
    }
  }
  $state.event = $Name
  # A subagent's tool call (background agents work on after the turn ended) does not end a wait for
  # the user: the main session's question, result or request stays.
  if ($Name -eq 'PostToolUse' -and $data.agent_id -and $prev -and
    ('Stop', 'Question', 'Notification', 'PermissionRequest', 'StopFailure' -contains [string]$prev.event)) { exit 0 }

  switch ($Name) {
    { 'Notification', 'PermissionRequest', 'Stop', 'Question', 'StopFailure' -contains $_ } {
      # A question may also trigger a notification or permission request; keep it a question.
      if ($Name -eq 'Notification' -or $Name -eq 'PermissionRequest') {
        if ((Test-Path -LiteralPath $attn) -and ([IO.File]::ReadAllText($attn).Trim() -eq 'Question')) { exit 0 }
      }
      $ntype = [string]$data.notification_type
      # Only notifications that wait for the user count (idle_prompt follows every Stop).
      if ($Name -eq 'Notification') {
        if ($ntype) {
          if ('permission_prompt', 'elicitation_dialog', 'elicitation_url_dialog', 'agent_needs_input' -notcontains $ntype) { exit 0 }
        } elseif (([string]$data.message).Contains('waiting for your input')) { exit 0 }
      }
      $state.type = $ntype
      switch ($Name) {
        'PermissionRequest' { $state.detail = ToolStep $data $cwd }
        'Question' {
          $q = $data.tool_input.questions
          $text = if ($q) { [string]@($q)[0].question } else { [string]$data.question }
          $state.detail = Clip $text
        }
        'Stop' { $state.detail = Clip $data.last_assistant_message }
        'StopFailure' {
          $e = [string]$data.error
          if (-not $e) { $e = [string]$data.message }
          $state.detail = Clip $e
        }
        'Notification' {
          # a permission request usually comes first and says more than the notification
          if ($prev -and $prev.event -eq 'PermissionRequest') { $state.detail = [string]$prev.detail }
          else { $state.detail = Clip $data.message }
        }
      }
      TryDetect $state $cwd
      $state.ts = $now
      New-Item -ItemType Directory -Force -Path $dir, $attnDir | Out-Null
      WriteJson $file $state
      [IO.File]::WriteAllText($attn, "$Name`n")
    }
    { 'UserPromptSubmit', 'PostToolUse' -contains $_ } {
      if (Test-Path -LiteralPath $attn) {
        Remove-Item -LiteralPath $attn -Force
      } elseif ($Name -eq 'PostToolUse' -and $prev -and $prev.event -eq 'PostToolUse' -and ($now - [long]$prev.ts) -lt 60) {
        # PostToolUse fires for every tool call: a "still working" heartbeat once a minute is enough,
        # in between only the step is updated (no context detection)
        $prev.step = ToolStep $data $cwd
        WriteJson $file $prev
        exit 0
      }
      if ($Name -eq 'UserPromptSubmit') {
        # background work that ended wakes the session with a notification instead of a prompt
        $prompt = [string]$data.prompt
        if (-not $prompt.StartsWith('<task-notification>')) { $state.task = Clip $prompt }
        if ($data.session_title) { $state.title = Clip $data.session_title }
        $state.step = ''
      } else {
        $state.step = ToolStep $data $cwd
      }
      TryDetect $state $cwd
      $state.ts = $now
      New-Item -ItemType Directory -Force -Path $dir | Out-Null
      WriteJson $file $state
    }
    { 'Background', 'SessionStart' -contains $_ } {
      if ($Name -eq 'SessionStart' -and $data.session_title) { $state.title = Clip $data.session_title }
      TryDetect $state $cwd
      $state.ts = $now
      New-Item -ItemType Directory -Force -Path $dir | Out-Null
      WriteJson $file $state
    }
    'SessionEnd' {
      foreach ($ext in 'json', 'tab', 'restore', 'restored') { Remove-Item -LiteralPath (Join-Path $dir "$sid.$ext") -Force -ErrorAction SilentlyContinue }
      Remove-Item -LiteralPath $attn -Force -ErrorAction SilentlyContinue
    }
  }
} catch {
  # never block or disturb Claude
}
exit 0
