// Brings the window and tab of a Claude Code session to the front, whatever it runs in:
// editors (Cursor, VS Code, Windsurf: window + integrated terminal via the companion extension),
// JetBrains IDEs (window), Windows Terminal (tab), macOS Terminal/iTerm (tab), other macOS apps.
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { scriptPath } = require('./wt-tabs');
const { hookHome } = require('./hooks');

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

const powershell = (script, args) =>
  run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath(script), ...args]);

// Asks the companion extension in the editor to show the terminal whose shell belongs to the
// session (see extension/extension.js).
function requestEditorTerminal(s) {
  const home = hookHome();
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

async function focusWindows(s, tabId) {
  const folder = s.folder || s.cwd;
  const editor = EDITORS[s.term];
  if (editor) {
    requestEditorTerminal(s);
    if (await powershell('focus-window.ps1', ['-Exe', editor.exe, '-Title', s.project])) return true;
    // window not found by title: let the editor open/focus the folder
    const args = s.distro ? ['--folder-uri', `vscode-remote://wsl+${s.distro}${folder}`] : [folder];
    return run(editor.cli, args.map((a) => `"${a}"`), { shell: true });
  }
  if (s.term === 'jetbrains') return powershell('focus-window.ps1', ['-Exe', JETBRAINS_EXES, '-Title', s.project]);
  // Windows Terminal (also the fallback): the tab id wt-tabs.js learned, else the title marker
  // "(!) <project> #<session id prefix>" (see hook/farmies-hook.sh)
  return powershell('focus-wt.ps1', ['-TabId', tabId || '', '-Marker', `(!) ${s.project} #${s.id.slice(0, 4)}`, '-Fallback', `(!) ${s.project}`]);
}

async function focusMac(s) {
  const folder = s.folder || s.cwd;
  const editor = EDITORS[s.term];
  if (editor) {
    requestEditorTerminal(s);
    return run('open', ['-b', s.app || editor.bundle, folder]);
  }
  const tty = s.tty.replace(/[^a-z0-9]/gi, '');
  if (s.term === 'apple-terminal' && tty) return run('osascript', ['-e', appleTerminalScript(`/dev/${tty}`)]);
  if (s.term === 'iterm' && tty) return run('osascript', ['-e', itermScript(`/dev/${tty}`)]);
  if (s.term === 'jetbrains' && s.app) return run('open', ['-b', s.app, folder]);
  if (s.app) return run('open', ['-b', s.app]);
  return run('open', ['-a', 'Terminal']);
}

function focusSession(s, tabId) {
  if (process.platform === 'win32') return focusWindows(s, tabId);
  if (process.platform === 'darwin') return focusMac(s);
  return Promise.resolve(false);
}

module.exports = { focusSession, EDITORS };
