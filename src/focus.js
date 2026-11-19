// Brings the window and tab of a Claude Code session to the front, whatever it runs in:
// editors (Cursor, VS Code, Windsurf: window + integrated terminal via the companion extension),
// JetBrains IDEs (window), Windows Terminal (tab), Windows consoles (PowerShell, cmd: the console
// Claude runs in), macOS Terminal/iTerm (tab), other macOS apps.
const { spawn, execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const { scriptPath } = require('./wt-tabs');
const { sessionHome, isNative } = require('./hooks');
const { DIR } = require('./sessions');
const { editorWindows, editorWindowFor } = require('./editor-focus');

// VS Code family: Windows process, CLI, macOS bundle id
const EDITORS = {
  cursor: { exe: 'Cursor.exe', cli: 'cursor', bundle: 'com.todesktop.230313mzl4w4u92' },
  vscode: { exe: 'Code.exe', cli: 'code', bundle: 'com.microsoft.VSCode' },
  'vscode-insiders': { exe: 'Code - Insiders.exe', cli: 'code-insiders', bundle: 'com.microsoft.VSCodeInsiders' },
  windsurf: { exe: 'Windsurf.exe', cli: 'windsurf', bundle: 'com.exafunction.windsurf' },
};
const JETBRAINS_EXES = ['idea64', 'phpstorm64', 'webstorm64', 'pycharm64', 'goland64', 'rider64', 'clion64', 'rubymine64', 'datagrip64', 'rustrover64']
  .map((n) => `${n}.exe`)
  .join(',');

function run(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { windowsHide: true, stdio: 'ignore', ...opts });
    child.on('error', () => resolve(false));
    child.on('exit', (code) => resolve(code === 0));
  });
}

const PS_ARGS = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File'];
const powershell = (script, args) => run('powershell.exe', [...PS_ARGS, scriptPath(script), ...args]);

// The title marker of a session's tab (also what wt-tabs.js looks for)
const marker = (s) => `(!) ${s.project} #${s.id.slice(0, 4)}`;

/**
 * Native Windows sessions in a console (Windows Terminal, classic console window): see
 * focus-console.ps1. Remembers the tab it finds, like wt-tabs.js does for WSL sessions (for the next
 * click and for seeing a bubble by focus). Resolves true if found.
 */
function focusConsole(s, markOnly = false) {
  const args = ['-ProcessId', String(s.cpid || 0), '-Marker', marker(s), '-Hwnd', String(s.hwnd || 0)];
  if (markOnly) args.push('-MarkOnly');
  return new Promise((resolve) => {
    execFile('powershell.exe', [...PS_ARGS, scriptPath('focus-console.ps1'), ...args], { windowsHide: true, timeout: 15000 }, (err, stdout) => {
      const tab = /^tab ([\d.]+)\s*$/m.exec(String(stdout || ''));
      if (tab) {
        try {
          fs.writeFileSync(path.join(DIR, `${s.id}.tab`), JSON.stringify({ id: tab[1] }));
        } catch {
          // found anyway
        }
      }
      resolve(!err);
    });
  });
}

// Native sessions whose tab was looked for already (once per session and app run)
const tabLooked = new Set();
/**
 * Native Windows sessions in Windows Terminal: learns the session's tab in the background (the tab
 * title shows the marker for a moment), so a bubble can count as seen when the user is in that tab.
 * WSL sessions do this in the hook (farmies-hook.sh).
 */
function learnTab(s, tabId) {
  if (!isNative(s) || EDITORS[s.term] || s.term === 'jetbrains' || !s.cpid || tabId || tabLooked.has(s.id)) return;
  tabLooked.add(s.id);
  focusConsole(s, true);
}

// Asks the companion extension in the editor to show the terminal whose shell belongs to the
// session (see extension/extension.js).
function requestEditorTerminal(s) {
  const home = sessionHome(s);
  if (!home || !s.pids.length) return;
  try {
    fs.writeFileSync(path.join(home, '.farmies', 'focus-request.json'), JSON.stringify({ ts: Date.now(), pids: s.pids }));
  } catch {
    // the window still gets focused
  }
}

const tellApp = (app, body) => `tell application "${app}"\n${body}\n  activate\nend tell`;

function appleTerminalScript(tty) {
  return tellApp(
    'Terminal',
    `  repeat with w in windows
    repeat with t in tabs of w
      if tty of t is "${tty}" then
        set selected of t to true
        set index of w to 1
        activate
        return
      end if
    end repeat
  end repeat`,
  );
}

function itermScript(tty) {
  return tellApp(
    'iTerm2',
    `  repeat with w in windows
    repeat with t in tabs of w
      repeat with s in sessions of t
        if tty of s is "${tty}" then
          select w
          tell t to select
          tell s to select
          activate
          return
        end if
      end repeat
    end repeat
  end repeat`,
  );
}

// Editors: the window that holds the session's terminal, as the companion extension reports it.
// Without it the session's own folder names the window, which is wrong when Claude was started in
// another folder than the window's workspace. Opening that folder would start a new window, so
// then the click says it found nothing (result { windows }, see problems.js) instead.
async function focusWindows(s, tabId) {
  const editor = EDITORS[s.term];
  if (editor) {
    requestEditorTerminal(s);
    const win = editorWindowFor(sessionHome(s), s.pids);
    if (win) {
      if (await powershell('focus-window.ps1', ['-Exe', editor.exe, '-Title', win.name])) return true;
      // title not as expected: the folder is open in that window, so the editor focuses it
      if (win.folder) return run(editor.cli, editorFolderArgs(s, win.folder), { shell: true });
    } else if (await powershell('focus-window.ps1', ['-Exe', editor.exe, '-Title', s.project])) {
      return true;
    }
    return { windows: editorWindows(sessionHome(s)) };
  }
  if (s.term === 'jetbrains') return powershell('focus-window.ps1', ['-Exe', JETBRAINS_EXES, '-Title', s.project]);
  if (isNative(s)) {
    // the tab found before, else the console Claude runs in
    if (tabId && (await powershell('focus-wt.ps1', ['-TabId', tabId, '-Exact']))) return true;
    return focusConsole(s);
  }
  // Windows Terminal (also the fallback): the tab id wt-tabs.js learned, else the title marker
  // "(!) <project> #<session id prefix>" (see hook/farmies-hook.sh)
  return powershell('focus-wt.ps1', ['-TabId', tabId || '', '-Marker', marker(s), '-Fallback', `(!) ${s.project}`]);
}

const editorFolderArgs = (s, folder) =>
  (s.distro ? ['--folder-uri', `vscode-remote://wsl+${s.distro}${folder}`] : [folder]).map((a) => `"${a}"`);

async function focusMac(s) {
  const folder = s.folder || s.cwd;
  const editor = EDITORS[s.term];
  if (editor) {
    requestEditorTerminal(s);
    const win = editorWindowFor(sessionHome(s), s.pids);
    return run('open', ['-b', s.app || editor.bundle, (win && win.folder) || folder]);
  }
  const tty = s.tty.replace(/[^a-z0-9]/gi, '');
  if (s.term === 'apple-terminal' && tty) return run('osascript', ['-e', appleTerminalScript(`/dev/${tty}`)]);
  if (s.term === 'iterm' && tty) return run('osascript', ['-e', itermScript(`/dev/${tty}`)]);
  if (s.term === 'jetbrains' && s.app) return run('open', ['-b', s.app, folder]);
  if (s.app) return run('open', ['-b', s.app]);
  return run('open', ['-a', 'Terminal']);
}

/** true if focused; { windows } if the session's editor window was not found. */
function focusSession(s, tabId) {
  if (process.platform === 'win32') return focusWindows(s, tabId);
  if (process.platform === 'darwin') return focusMac(s);
  return Promise.resolve(false);
}

module.exports = { focusSession, learnTab, EDITORS };
