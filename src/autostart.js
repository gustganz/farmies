// Start the buddy when the user logs in (Windows: Run registry key, macOS: LaunchAgent).
const { app } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

const LABEL = 'com.gustganz.farmies';

// Unpackaged (npm start / run-windows.sh) the Electron binary needs the app directory as argument.
const launchArgs = () => (app.isPackaged ? [] : [app.getAppPath()]);
// The portable Windows exe unpacks itself to a temp folder: autostart must point to the exe itself.
const executable = () => process.env.PORTABLE_EXECUTABLE_FILE || process.execPath;
const plistPath = () => path.join(os.homedir(), 'Library', 'LaunchAgents', `${LABEL}.plist`);
const xml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function supported() {
  return process.platform === 'win32' || process.platform === 'darwin';
}

function isEnabled() {
  if (process.platform === 'darwin') return fs.existsSync(plistPath());
  if (process.platform === 'win32') {
    return app.getLoginItemSettings({ path: executable(), args: launchArgs() }).openAtLogin;
  }
  return false;
}

function setEnabled(on) {
  if (process.platform === 'win32') {
    app.setLoginItemSettings({ openAtLogin: on, path: executable(), args: launchArgs() });
  } else if (process.platform === 'darwin') {
    if (!on) {
      fs.rmSync(plistPath(), { force: true });
      return;
    }
    const args = [executable(), ...launchArgs()].map((a) => `<string>${xml(a)}</string>`).join('');
    fs.mkdirSync(path.dirname(plistPath()), { recursive: true });
    fs.writeFileSync(
      plistPath(),
      `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key><array>${args}</array>
  <key>RunAtLoad</key><true/>
</dict>
</plist>
`,
    );
  }
}

module.exports = { supported, isEnabled, setEnabled };
