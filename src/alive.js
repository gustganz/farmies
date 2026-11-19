// Whether Claude Code sessions still run. A session that ends without the SessionEnd hook (terminal
// tab or window closed, WSL shut down, the machine restarted) leaves its state file behind; without
// this check it stayed in the panel for a day and a click on it did nothing.
const { execFile } = require('child_process');

// Commands of a Claude Code process (native binary or the npm version)
const CLAUDE_COMM = /^(claude|node)$/i;

// ps with a fixed locale and time zone, like the hook, so start times compare as text. On Linux
// also the start time in clock ticks since boot from /proc ("T pid ticks" lines): unlike lstart it
// stays the same when the wall clock is set (WSL after sleep). The mark at the end tells an answer
// ("none of them runs", ps exit code 1) from a failure to ask.
const MARK = 'farmies-ps-done';
// No quotes in the script: it goes through wsl.exe's command line.
const psScript = (pids) =>
  `ps -o pid=,lstart=,comm= -p ${pids.join(',')}; ` +
  `for p in ${pids.join(' ')}; do test -r /proc/$p/stat && read -r l < /proc/$p/stat && set -- \${l##*) } && echo T $p \${20}; done; ` +
  `echo ${MARK}`;

/** ps output (pid, lstart in five words, command; "T pid ticks" lines) → Map pid → { start, comm, ticks? } */
function parsePs(out) {
  const procs = new Map();
  const ticks = new Map();
  for (const line of String(out || '').split('\n')) {
    const words = line.trim().split(/\s+/);
    if (words[0] === 'T' && /^\d+$/.test(words[1]) && /^\d+$/.test(words[2] || '')) {
      ticks.set(Number(words[1]), words[2]);
      continue;
    }
    if (words.length < 7 || !/^\d+$/.test(words[0])) continue;
    const comm = words.slice(6).join(' ');
    procs.set(Number(words[0]), { start: words.slice(1, 6).join(' '), comm: comm.split('/').pop() });
  }
  for (const [pid, t] of ticks) if (procs.has(pid)) procs.get(pid).ticks = t;
  return procs;
}

// Native Windows sessions (no distro): Claude's pid and start time as Windows FILETIME (UTC), the
// same value the PowerShell hook records. Prints "pid filetime" lines (filetime empty when access is
// denied, e.g. an elevated Claude) and the mark.
const winScript = (pids) =>
  `Get-Process -Id ${pids.join(',')} -ErrorAction SilentlyContinue | ForEach-Object { $t = ''; ` +
  `try { $t = $_.StartTime.ToFileTimeUtc() } catch { }; '{0} {1}' -f $_.Id, $t }; '${MARK}'`;

/** winScript output → Map pid → start ('' if unknown) */
function parseWin(out) {
  const procs = new Map();
  for (const line of String(out || '').split(/\r?\n/)) {
    const m = /^(\d+) ?(\d*)$/.exec(line.trim());
    if (m) procs.set(Number(m[1]), m[2]);
  }
  return procs;
}

/** Whether a native Windows session's Claude process is gone (procs: from parseWin). */
function isGoneWin(s, procs) {
  if (!procs.has(s.cpid)) return true;
  const start = procs.get(s.cpid);
  return Boolean(start && s.cstart && start !== String(s.cstart));
}

/** `wsl.exe -l --running -q` output (UTF-16) → names of the running distros */
function parseRunning(out) {
  const text = Buffer.isBuffer(out) ? out.toString('utf16le') : String(out || '');
  return new Set(
    text
      .replace(/\0/g, '')
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean),
  );
}

/** The pids worth asking ps about for a session: its Claude process, or (older hook) the first ancestors. */
function pidsOf(s) {
  const pids = s.cpid ? [s.cpid] : (s.pids || []).slice(0, 2);
  return pids.filter((p) => Number.isInteger(p) && p > 1);
}

/**
 * Whether the session's Claude process is gone (procs: what ps found). Newer hooks record Claude's
 * pid and start time (Linux: clock ticks since boot, macOS: ps lstart); older state files only the hook's ancestors, the first two of which are the
 * shell running the hook command and Claude.
 */
function isGone(s, procs) {
  if (s.cpid) {
    const p = procs.get(s.cpid);
    if (!p) return true;
    const start = String(s.cstart || '').replace(/\s+/g, ' ').trim();
    if (!start) return false;
    // Linux hooks record ticks since boot: exact, the pid belongs to another process if they differ
    if (/^\d+$/.test(start)) return p.ticks !== undefined && p.ticks !== start;
    // lstart (macOS, or a state file from v0.1.23): on Linux it shifts with the wall clock, so it
    // only counts where ps has no ticks to offer
    return p.ticks === undefined && p.start !== start;
  }
  const candidates = pidsOf(s);
  if (!candidates.length) return false; // nothing to go by
  return !candidates.some((pid) => procs.has(pid) && CLAUDE_COMM.test(procs.get(pid).comm));
}

function run(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    execFile(cmd, args, { windowsHide: true, timeout: 15000, ...opts }, (err, stdout) => resolve(err ? null : stdout));
  });
}

/**
 * The sessions (from Sessions.list) whose Claude process no longer runs. Sessions it cannot check
 * (no pids, ps or wsl.exe failing) count as running.
 */
async function goneSessions(list, platform = process.platform) {
  const gone = [];
  if (platform === 'win32') gone.push(...(await goneNative(list)));
  const checkable = list.filter((s) => pidsOf(s).length && (platform !== 'win32' || s.distro));
  if (!checkable.length) return gone;
  const byDistro = new Map();
  for (const s of checkable) {
    const key = platform === 'win32' ? s.distro : '';
    if (!byDistro.has(key)) byDistro.set(key, []);
    byDistro.get(key).push(s);
  }
  let running = null;
  if (platform === 'win32') {
    // asked without starting WSL: a distro that is not running has no sessions left
    const out = await run('wsl.exe', ['-l', '--running', '-q'], { encoding: 'buffer' });
    if (out === null) return gone;
    running = parseRunning(out);
  }
  for (const [distro, sessions] of byDistro) {
    if (running && !running.has(distro)) {
      gone.push(...sessions);
      continue;
    }
    const pids = [...new Set(sessions.flatMap(pidsOf))];
    // nothing but digits and fixed words go through wsl.exe
    const out =
      platform === 'win32'
        ? await run('wsl.exe', ['-d', distro, '-e', 'env', 'TZ=UTC0', 'LC_ALL=C', 'sh', '-c', psScript(pids)])
        : await run('sh', ['-c', psScript(pids)], { env: { ...process.env, TZ: 'UTC0', LC_ALL: 'C' } });
    if (out === null || !out.includes(MARK)) continue;
    const procs = parsePs(out);
    gone.push(...sessions.filter((s) => isGone(s, procs)));
  }
  return gone;
}

/** Native Windows sessions (Claude Code on Windows itself) whose Claude process is gone. */
async function goneNative(list, runPs = run) {
  const sessions = list.filter((s) => !s.distro && s.cpid > 4);
  if (!sessions.length) return [];
  const pids = [...new Set(sessions.map((s) => s.cpid))];
  // nothing but digits go into the script
  const out = await runPs('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', winScript(pids)]);
  if (out === null || !out.includes(MARK)) return [];
  const procs = parseWin(out);
  return sessions.filter((s) => isGoneWin(s, procs));
}

module.exports = { goneSessions, goneNative, isGone, isGoneWin, parsePs, parseWin, parseRunning };
