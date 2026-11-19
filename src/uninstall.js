// Removes what the app (or install-hook.sh) set up: the hooks in ~/.claude/settings.json and
// ~/.farmies (Windows: in WSL and in the Windows home).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { removeHooks } = require('./hook-settings');
const { BASE, hostPath } = require('./hooks');

/** Returns { removedHooks, settingsFile } or throws when the install location is unknown. */
function uninstall(platform = process.platform) {
  const infoFile = path.join(BASE, 'install.json');
  let removedHooks = 0;
  const settingsFiles = [];
  if (fs.existsSync(infoFile)) {
    const info = JSON.parse(fs.readFileSync(infoFile, 'utf8'));
    const home = hostPath(info, info.home);
    const settingsFile = path.join(home, '.claude', 'settings.json');
    removedHooks += removeHooks(settingsFile);
    settingsFiles.push(settingsFile);
    fs.rmSync(path.join(home, '.farmies'), { recursive: true, force: true }); // hook script, config
  } else if (platform !== 'win32') {
    throw new Error(`${infoFile} fehlt – unbekannt, wo die Hooks installiert sind.`);
  }
  if (platform === 'win32') {
    // Claude Code on Windows itself (hook.ps1 lies in BASE)
    const settingsFile = path.join(os.homedir(), '.claude', 'settings.json');
    removedHooks += removeHooks(settingsFile);
    settingsFiles.push(settingsFile);
  }
  fs.rmSync(BASE, { recursive: true, force: true }); // session files, install.json, hook.ps1
  return { removedHooks, settingsFile: settingsFiles.join(', ') };
}

module.exports = { uninstall };
