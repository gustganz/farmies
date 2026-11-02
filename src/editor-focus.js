// VS Code family: what the companion extension reports about each editor window (one file per
// window, see extension/extension.js): the shell pid of the terminal the user is in, the shell pids
// of all its terminals, and its workspace (name as in the window title, folder).
const fs = require('fs');
const path = require('path');

function editorWindows(home) {
  if (!home) return [];
  const dir = path.join(home, '.farmies', 'editor-focus');
  let files;
  try {
    files = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const windows = [];
  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    try {
      windows.push(JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')));
    } catch {
      // being written
    }
  }
  return windows;
}

function focusedTerminalPids(home) {
  const pids = new Set();
  for (const w of editorWindows(home)) {
    const pid = Number(w.pid);
    if (pid) pids.add(pid);
  }
  return pids;
}

// Remote windows are named "folder [WSL: Ubuntu]"; the window title surely contains the folder part.
const titleName = (name) => String(name || '').replace(/\s*\[[^\]]*\]\s*$/, '');

/**
 * The editor window whose terminal runs the session (pids: the session's process ancestors), as
 * { name, folder }, or null (extension missing or too old). A session may work in another folder
 * than the window's workspace, so its own folder does not say which window it is in.
 */
function editorWindowFor(home, pids) {
  if (!pids || !pids.length) return null;
  const wanted = new Set(pids.map(Number));
  for (const w of editorWindows(home)) {
    if (!Array.isArray(w.shells) || !w.shells.some((pid) => wanted.has(Number(pid)))) continue;
    const name = titleName(w.name);
    const folder = typeof w.folder === 'string' ? w.folder : '';
    if (name || folder) return { name: name || path.posix.basename(folder), folder };
  }
  return null;
}

module.exports = { editorWindows, focusedTerminalPids, editorWindowFor };
