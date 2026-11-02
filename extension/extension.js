// Farmies companion: shows the integrated terminal a Claude Code session runs in, and tells the
// buddy app which terminal the user is in.
// The buddy app writes ~/.farmies/focus-request.json ({ ts, pids }) into the environment the
// terminals run in (WSL or this machine); `pids` are the session's process ancestors. Every editor
// window checks its terminals; the one whose shell is among them shows itself.
// Only changes of the file count (no clock comparison: the WSL clock may drift from Windows).
// Each window keeps ~/.farmies/editor-focus/<pid>.json up to date: { pid } of the active terminal's
// shell while the window has the focus, else { pid: 0 }. The app marks a bubble as seen when the
// user stays in that terminal (see src/seen-by-focus.js).
const vscode = require('vscode');
const fs = require('fs');
const os = require('os');
const path = require('path');

const REQUEST = path.join(os.homedir(), '.farmies', 'focus-request.json');
const FOCUS_DIR = path.join(os.homedir(), '.farmies', 'editor-focus');
const FOCUS_FILE = path.join(FOCUS_DIR, `${process.pid}.json`);

function activate(context) {
  const check = async (curr, prev) => {
    if (!curr.mtimeMs || curr.mtimeMs === prev.mtimeMs) return;
    let request;
    try {
      request = JSON.parse(fs.readFileSync(REQUEST, 'utf8'));
    } catch {
      return;
    }
    const pids = new Set((request.pids || []).map(Number));
    for (const terminal of vscode.window.terminals) {
      const pid = await terminal.processId;
      if (pid && pids.has(pid)) {
        terminal.show(false);
        return;
      }
    }
  };

  fs.watchFile(REQUEST, { interval: 300 }, check);
  context.subscriptions.push({ dispose: () => fs.unwatchFile(REQUEST, check) });

  let written = null;
  const report = async () => {
    const terminal = vscode.window.state.focused ? vscode.window.activeTerminal : undefined;
    const pid = (terminal && (await terminal.processId)) || 0;
    if (pid === written) return;
    try {
      fs.mkdirSync(FOCUS_DIR, { recursive: true });
      fs.writeFileSync(FOCUS_FILE, JSON.stringify({ pid }));
      written = pid;
    } catch {
      // not critical
    }
  };
  report();
  context.subscriptions.push(
    vscode.window.onDidChangeWindowState(report),
    vscode.window.onDidChangeActiveTerminal(report),
    vscode.window.onDidOpenTerminal(report),
  );
}

function deactivate() {
  try {
    fs.rmSync(FOCUS_FILE, { force: true });
  } catch {
    // gone already
  }
}

module.exports = { activate, deactivate };
