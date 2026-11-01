// Removes what the app (or install-hook.sh) set up: the hooks in ~/.claude/settings.json and
// ~/.farmies.
const fs = require('fs');
const path = require('path');
const { removeHooks } = require('./hook-settings');
const { BASE, hostPath } = require('./hooks');

/** Returns { removedHooks, settingsFile } or throws when the install location is unknown. */
function uninstall() {
  const infoFile = path.join(BASE, 'install.json');
  if (!fs.existsSync(infoFile)) {
    throw new Error(`${infoFile} fehlt – unbekannt, wo die Hooks installiert sind.`);
  }
  const info = JSON.parse(fs.readFileSync(infoFile, 'utf8'));
  const home = hostPath(info, info.home);
  const settingsFile = path.join(home, '.claude', 'settings.json');

  const removedHooks = removeHooks(settingsFile);
  fs.rmSync(path.join(home, '.farmies'), { recursive: true, force: true }); // hook script, config
  fs.rmSync(BASE, { recursive: true, force: true }); // session files, install.json
  return { removedHooks, settingsFile };
}

module.exports = { uninstall };
