// Windows Terminal: learns which tab belongs to which Claude session and restores the tab title.
// The hook briefly puts "(!) <project> #<session id prefix>" into the title of its tab; when that
// shows up here, the tab (UI Automation runtime id) is remembered for the session and the title the
// tab had before is handed back to the hook ("<id>.restore"), which writes it to the terminal.
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { DIR } = require('./sessions');

const MARKER = /^\(!\) .* #([A-Za-z0-9_-]{4})$/;

// PowerShell cannot read scripts from inside app.asar (they are unpacked next to it).
const scriptPath = (name) =>
  path.join(__dirname, name).replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);

class WtTabs {
  constructor() {
    this.plainTitles = new Map(); // tab id → last title without marker
    this.focusedTab = null; // id of the tab the user is in (selected, window in the foreground)
    this.proc = null;
    this.stopped = false;
  }

  start() {
    if (process.platform !== 'win32' || this.stopped) return;
    this.proc = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath('wt-watch.ps1'), '-ParentPid', String(process.pid)],
      { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] },
    );
    readline.createInterface({ input: this.proc.stdout }).on('line', (line) => {
      try {
        this.onTabs(JSON.parse(line));
      } catch {
        // incomplete or unexpected output: ignore
      }
    });
    this.proc.on('error', () => {});
    this.proc.on('exit', () => {
      this.focusedTab = null;
      setTimeout(() => this.start(), 5000);
    });
  }

  stop() {
    this.stopped = true;
    this.proc?.kill();
  }

  onTabs(tabs) {
    this.focusedTab = tabs.find((t) => t.focused)?.id || null;
    for (const tab of tabs) {
      const match = MARKER.exec(tab.title);
      if (!match) {
        this.plainTitles.set(tab.id, tab.title);
        continue;
      }
      // look at the files directly: the session list is only refreshed once a second
      let file;
      try {
        file = fs.readdirSync(DIR).find((f) => f.startsWith(match[1]) && f.endsWith('.json'));
      } catch {
        continue;
      }
      if (!file) continue;
      const sessionId = file.slice(0, -'.json'.length);
      fs.writeFileSync(path.join(DIR, `${sessionId}.tab`), JSON.stringify({ id: tab.id, hwnd: tab.hwnd }));
      const previous = this.plainTitles.get(tab.id) || tab.title.replace(/^\(!\) (.*) #.{4}$/, '$1');
      fs.writeFileSync(path.join(DIR, `${sessionId}.restore`), previous);
    }
  }

  /** Whether the user is in the tab of this session. */
  isFocused(sessionId) {
    return Boolean(this.focusedTab) && this.tabFor(sessionId) === this.focusedTab;
  }

  /** Tab id of a session, if known (kept in a file, so it survives app restarts). */
  tabFor(sessionId) {
    try {
      return JSON.parse(fs.readFileSync(path.join(DIR, `${sessionId}.tab`), 'utf8')).id;
    } catch {
      return null;
    }
  }
}

module.exports = { WtTabs, scriptPath };
