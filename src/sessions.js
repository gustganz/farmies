// Reads the per-session state files written by the Claude Code hook.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');

const DIR = path.join(os.homedir(), '.farmies', 'sessions');
// sessions marked as seen in the panel (id → time), kept across restarts and updates
const DISMISSED_FILE = path.join(os.homedir(), '.farmies', 'dismissed.json');
// A question or permission request counts as handled once the session's transcript changed after
// it (answering or cancelling in Claude; cancelling fires no hook). Grace for the entry Claude
// writes right around the request itself (the hook's time is in whole seconds).
const TRANSCRIPT_GRACE = 3000;
const SHOW_MAX_AGE = 24 * 3600 * 1000;
const DELETE_AGE = 7 * 24 * 3600 * 1000;
const POLL_MS = 1000;
// The hook refreshes a working session at least once a minute while tools run.
const WORKING_TIMEOUT = 5 * 60 * 1000;
// Hook events that mean the session waits for the user, and the resulting state.
const NEEDS_USER = {
  StopFailure: 'error',
  PermissionRequest: 'attention',
  Notification: 'attention',
  Question: 'question',
  Stop: 'done',
};
const NEEDS_USER_STATES = Object.values(NEEDS_USER);

// home of the environment the hooks run in (from install.json, written by src/hooks.js)
let home = null;
function installHome() {
  if (home === null) {
    try {
      home = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.farmies', 'install.json'), 'utf8')).home || '';
    } catch {
      return '';
    }
  }
  return home;
}

class Sessions extends EventEmitter {
  constructor() {
    super();
    this.cache = new Map();
    this.dismissed = new Map();
    try {
      this.dismissed = new Map(Object.entries(JSON.parse(fs.readFileSync(DISMISSED_FILE, 'utf8'))));
    } catch {
      // none yet
    }
    this.list = [];
    this.lastKey = '';
  }

  start() {
    fs.mkdirSync(DIR, { recursive: true });
    this.poll();
    setInterval(() => this.poll(), POLL_MS);
  }

  poll() {
    let files;
    try {
      files = fs.readdirSync(DIR);
    } catch {
      return;
    }
    const now = Date.now();
    const list = [];
    for (const file of files) {
      if (!file.endsWith('.json') || file.startsWith('.')) continue;
      const full = path.join(DIR, file);
      let stat;
      try {
        stat = fs.statSync(full);
      } catch {
        continue;
      }
      if (now - stat.mtimeMs > DELETE_AGE) {
        fs.rmSync(full, { force: true });
        continue;
      }
      if (now - stat.mtimeMs > SHOW_MAX_AGE) continue;

      let entry = this.cache.get(file);
      if (!entry || entry.mtime !== stat.mtimeMs) {
        try {
          entry = { mtime: stat.mtimeMs, data: JSON.parse(fs.readFileSync(full, 'utf8')) };
        } catch {
          continue; // partially written or invalid, retry next poll
        }
        this.cache.set(file, entry);
      }
      list.push(this.toSession(entry.data));
    }
    list.sort((a, b) => b.ts - a.ts);

    const key = JSON.stringify(list);
    if (key !== this.lastKey) {
      this.lastKey = key;
      this.list = list;
      this.emit('change', list);
    }
  }

  toSession(d) {
    const ts = (Number(d.ts) || 0) * 1000;
    // Needs the user: attention (permission) · question · error (stopped by an error) · done.
    // Otherwise: working (busy) or idle.
    let state = NEEDS_USER[d.event] || 'idle';
    if (state === 'idle' && ['UserPromptSubmit', 'PostToolUse'].includes(d.event) && Date.now() - ts < WORKING_TIMEOUT) {
      state = 'working';
    }
    if (NEEDS_USER_STATES.includes(state) && (this.dismissed.get(d.session_id) || 0) >= ts) state = 'idle';
    if ((state === 'question' || state === 'attention') && this.transcriptChangedSince(d, ts)) state = 'idle';

    const folder = d.folder || d.cwd || '';
    return {
      id: d.session_id,
      project: path.posix.basename(folder) || '?',
      cwd: d.cwd || '',
      folder,
      message: d.message || '',
      type: d.type || '',
      state,
      ts,
      term: d.term || 'unknown',
      app: d.app || '',
      tty: d.tty || '',
      pids: String(d.pids || '')
        .split(' ')
        .filter(Boolean)
        .map(Number),
      distro: d.distro || '',
    };
  }

  transcriptChangedSince(d, ts) {
    // older state files have no transcript path: Claude Code's scheme is
    // ~/.claude/projects/<cwd with / and . replaced by ->/<session id>.jsonl
    const home = installHome();
    const transcript =
      d.transcript || (home && d.cwd ? `${home}/.claude/projects/${d.cwd.replace(/[/.]/g, '-')}/${d.session_id}.jsonl` : '');
    if (!transcript) return false;
    d = { ...d, transcript };
    // the hook runs in WSL on Windows: its paths are reached through \\wsl.localhost
    const file =
      process.platform === 'win32' && d.distro
        ? `\\\\wsl.localhost\\${d.distro}${d.transcript.replace(/\//g, '\\')}`
        : d.transcript;
    try {
      return fs.statSync(file).mtimeMs > ts + TRANSCRIPT_GRACE;
    } catch {
      return false;
    }
  }

  get(id) {
    return this.list.find((s) => s.id === id);
  }

  saveDismissed() {
    // only for sessions that still exist
    const ids = new Set(this.list.map((s) => s.id));
    const kept = [...this.dismissed].filter(([id]) => ids.has(id));
    this.dismissed = new Map(kept);
    try {
      fs.writeFileSync(DISMISSED_FILE, JSON.stringify(Object.fromEntries(kept)));
    } catch {
      // not critical
    }
  }

  dismiss(id) {
    this.dismissed.set(id, Date.now());
    this.saveDismissed();
    this.poll();
  }

  dismissAll() {
    for (const s of this.list) this.dismissed.set(s.id, Date.now());
    this.saveDismissed();
    this.poll();
  }
}

module.exports = { Sessions, DIR, NEEDS_USER_STATES };
