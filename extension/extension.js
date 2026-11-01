// Farmies companion: shows the integrated terminal a Claude Code session runs in.
// The buddy app writes ~/.farmies/focus-request.json ({ ts, pids }) into the environment the
// terminals run in (WSL or this machine); `pids` are the session's process ancestors. Every editor
// window checks its terminals; the one whose shell is among them shows itself.
// Only changes of the file count (no clock comparison: the WSL clock may drift from Windows).
const vscode = require('vscode');
const fs = require('fs');
const os = require('os');
const path = require('path');

const REQUEST = path.join(os.homedir(), '.farmies', 'focus-request.json');

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
}

function deactivate() {}

module.exports = { activate, deactivate };
