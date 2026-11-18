// Whether Claude Code sessions still run. A session that ends without the SessionEnd hook (terminal
// tab or window closed, WSL shut down, the machine restarted) leaves its state file behind; without
// this check it stayed in the panel for a day and a click on it did nothing.
const { execFile } = require('child_process');

// Commands of a Claude Code process (native binary or the npm version)
const CLAUDE_COMM = /^(claude|node)$/i;

// ps with a fixed locale and time zone, like the hook, so start times compare as text. The mark
// at the end tells an answer ("none of them runs", ps exit code 1) from a failure to ask.
const MARK = 'farmies-ps-done';
const psScript = (pids) => `ps -o pid=,lstart=,comm= -p ${pids.join(',')}; echo ${MARK}`;

/** ps output (pid, lstart in five words, command) → Map pid → { start, comm } */
function parsePs(out) {
  const procs = new Map();
  for (const line of String(out || '').split('\n')) {
    const words = line.trim().split(/\s+/);
    if (words.length < 7 || !/^\d+$/.test(words[0])) continue;
    const comm = words.slice(6).join(' ');
    procs.set(Number(words[0]), { start: words.slice(1, 6).join(' '), comm: comm.split('/').pop() });
  }
  return procs;
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
 * pid and start time; older state files only the hook's ancestors, the first two of which are the
 * shell running the hook command and Claude.
 */
function isGone(s, procs) {
  if (s.cpid) {
    const p = procs.get(s.cpid);
    if (!p) return true;
    return Boolean(s.cstart) && p.start !== s.cstart.replace(/\s+/g, ' ').trim();
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
  const checkable = list.filter((s) => pidsOf(s).length && (platform !== 'win32' || s.distro));
  if (!checkable.length) return [];
  const gone = [];
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
    if (out === null) return [];
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

module.exports = { goneSessions, isGone, parsePs, parseRunning };
