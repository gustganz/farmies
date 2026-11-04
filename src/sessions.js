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
// A finished (or failed) session counts as handled once the transcript has a new message after it:
// the user went on in the session (a prompt, a slash command, an answer), even where no hook fires.
// Only the end of the transcript is read; entries are one JSON object per line.
const TRANSCRIPT_TAIL = 256 * 1024;
const SHOW_MAX_AGE = 24 * 3600 * 1000;
const DELETE_AGE = 7 * 24 * 3600 * 1000;
const POLL_MS = 1000;
// The hook refreshes a working session at least once a minute while tools run.
const WORKING_TIMEOUT = 5 * 60 * 1000;
// Claude ended its turn but waits for background work (a shell, agent or monitor): working until
// that work ends and wakes the session, which fires hooks again. No heartbeat meanwhile, so a long
// limit, only against sessions closed while waiting.
const BACKGROUND_TIMEOUT = 2 * 3600 * 1000;
// Hook events that mean the session waits for the user, and the resulting state.
const NEEDS_USER = {
  StopFailure: 'error',
  PermissionRequest: 'attention',
  Notification: 'attention',
  Question: 'question',
  Stop: 'done',
};
const NEEDS_USER_STATES = Object.values(NEEDS_USER);
// A question or permission request is an open dialog in Claude: its bubble stays until it is
// answered or cancelled there (transcript check below), not when the user merely saw it. Only the
// menu "Alle als gesehen markieren" clears it, e.g. after a terminal was closed hard.
const UNTIL_ANSWERED = ['question', 'attention'];
// Bubbles that seeing (focus) or clicking clears: done and error, where nothing waits in Claude.
const clearedBySeeing = (s) => NEEDS_USER_STATES.includes(s.state) && !UNTIL_ANSWERED.includes(s.state);

// Context texts for the hover panel: one line, at most this many characters.
const TEXT_MAX = 80;
function oneLine(text, max = TEXT_MAX) {
  const t = String(text || '')
    .replace(/\uFFFD+$/, '') // a multi-byte character cut by the hook
    .replace(/\s+/g, ' ')
    .trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}
// Claude's last message: its first sentence, without Markdown marks
function firstSentence(text) {
  const plain = String(text || '')
    .replace(/[*_`#>]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const m = plain.match(/^.+?[.!?](?=\s|$)/);
  return oneLine(m ? m[0] : plain);
}

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

// Time of the newest message at the end of a transcript (0: none or unreadable): from the user or
// Claude, or a slash command like /model (newer Claude Code logs those as system entries). Other
// system entries (hook summaries, turn times), summaries and titles are not someone going on.
function lastMessageTime(file) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const size = fs.fstatSync(fd).size;
    const length = Math.min(size, TRANSCRIPT_TAIL);
    const buf = Buffer.alloc(length);
    fs.readSync(fd, buf, 0, length, size - length);
    const lines = buf.toString('utf8').split('\n');
    if (length < size) lines.shift(); // cut in the middle
    for (let i = lines.length - 1; i >= 0; i--) {
      if (!lines[i].trim()) continue;
      let entry;
      try {
        entry = JSON.parse(lines[i]);
      } catch {
        continue; // being written
      }
      const message =
        entry.type === 'user' || entry.type === 'assistant' || (entry.type === 'system' && entry.subtype === 'local_command');
      if (!message) continue;
      const t = Date.parse(entry.timestamp);
      if (t) return t;
    }
  } catch {
    // gone or not reachable
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
  return 0;
}

class Sessions extends EventEmitter {
  constructor() {
    super();
    this.cache = new Map();
    this.dismissed = new Map();
    // transcript checks: "file|ts" → { mtime, found }
    this.messages = new Map();
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
      list.push(this.toSession(entry.data, entry.mtime));
    }
    list.sort((a, b) => b.ts - a.ts);

    const key = JSON.stringify(list);
    if (key !== this.lastKey) {
      this.lastKey = key;
      this.list = list;
      this.emit('change', list);
    }
  }

  /**
   * d: the state file's content, mtime: its modification time. The time of the event is taken from
   * the file, not from d.ts: under WSL the hook's clock (d.ts) may be minutes off the Windows clock
   * after sleep, while the file time on the Windows drive comes from Windows, like Date.now() here.
   */
  toSession(d, mtime = (Number(d.ts) || 0) * 1000) {
    const ts = mtime;
    // Needs the user: attention (permission) · question · error (stopped by an error) · done.
    // Otherwise: working (busy) or idle.
    let state = NEEDS_USER[d.event] || 'idle';
    if (state === 'idle' && ['UserPromptSubmit', 'PostToolUse'].includes(d.event) && Date.now() - ts < WORKING_TIMEOUT) {
      state = 'working';
    }
    if (d.event === 'Background' && Date.now() - ts < BACKGROUND_TIMEOUT) state = 'working';
    if (NEEDS_USER_STATES.includes(state) && (this.dismissed.get(d.session_id) || 0) >= ts) state = 'idle';
    // the transcript lives in WSL too: compared with the hook's own clock
    const hookTs = (Number(d.ts) || 0) * 1000;
    if ((state === 'question' || state === 'attention') && this.transcriptChangedSince(d, hookTs)) state = 'idle';
    if ((state === 'done' || state === 'error') && this.messageSince(d, hookTs)) state = 'idle';

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
      // context for the hover panel (from hook versions that write it)
      task: oneLine(d.task),
      title: oneLine(d.title),
      branch: oneLine(d.branch, 40),
      step: oneLine(d.step),
      detail: d.event === 'Stop' ? firstSentence(d.detail) : oneLine(d.detail),
      // background work Claude waits for (number of tasks), 0: none
      background: d.event === 'Background' ? Number(d.bg) || 1 : 0,
    };
  }

  // The session's transcript as a path the app can read, or ''.
  transcriptFile(d) {
    // older state files have no transcript path: Claude Code's scheme is
    // ~/.claude/projects/<cwd with / and . replaced by ->/<session id>.jsonl
    const home = installHome();
    const transcript =
      d.transcript || (home && d.cwd ? `${home}/.claude/projects/${d.cwd.replace(/[/.]/g, '-')}/${d.session_id}.jsonl` : '');
    if (!transcript) return '';
    // the hook runs in WSL on Windows: its paths are reached through \\wsl.localhost
    return process.platform === 'win32' && d.distro
      ? `\\\\wsl.localhost\\${d.distro}${transcript.replace(/\//g, '\\')}`
      : transcript;
  }

  transcriptChangedSince(d, ts) {
    const file = this.transcriptFile(d);
    if (!file) return false;
    try {
      return fs.statSync(file).mtimeMs > ts + TRANSCRIPT_GRACE;
    } catch {
      return false;
    }
  }

  /**
   * Whether the transcript has a user or assistant message written after ts (the hook's clock, like
   * the transcript's timestamps). Read only when the file changed; the answer is kept per file time.
   */
  messageSince(d, ts) {
    if (!this.transcriptChangedSince(d, ts)) return false;
    const file = this.transcriptFile(d);
    let mtime;
    try {
      mtime = fs.statSync(file).mtimeMs;
    } catch {
      return false;
    }
    const key = `${file}|${ts}`;
    const known = this.messages.get(key);
    if (known && known.mtime === mtime) return known.found;
    const found = lastMessageTime(file) > ts + TRANSCRIPT_GRACE;
    this.messages.set(key, { mtime, found });
    if (this.messages.size > 200) this.messages.delete(this.messages.keys().next().value);
    return found;
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

module.exports = { Sessions, DIR, NEEDS_USER_STATES, UNTIL_ANSWERED, clearedBySeeing, oneLine, firstSentence, lastMessageTime };
