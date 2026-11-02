// VS Code family: the shell pids of the terminals the user is in, as reported by the companion
// extension (one file per editor window, see extension/extension.js).
const fs = require('fs');
const path = require('path');

function focusedTerminalPids(home) {
  const pids = new Set();
  if (!home) return pids;
  const dir = path.join(home, '.farmies', 'editor-focus');
  let files;
  try {
    files = fs.readdirSync(dir);
  } catch {
    return pids;
  }
  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    try {
      const pid = Number(JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')).pid);
      if (pid) pids.add(pid);
    } catch {
      // being written
    }
  }
  return pids;
}

module.exports = { focusedTerminalPids };
