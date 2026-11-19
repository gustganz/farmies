// Sessions whose Claude process is gone (src/alive.js).
const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { goneSessions, isGone, parsePs, parseRunning } = require('../src/alive');

const START = 'Wed Nov 18 10:04:21 2026';

test('alive: ps output and running WSL distros are read', () => {
  const procs = parsePs(`  412 ${START} claude\n 9 Wed Nov 18  9:00:00 2026 /usr/bin/node\nfarmies-ps-done\n`);
  assert.deepStrictEqual(procs.get(412), { start: START, comm: 'claude' });
  assert.deepStrictEqual(procs.get(9), { start: 'Wed Nov 18 9:00:00 2026', comm: 'node' });
  assert.strictEqual(procs.size, 2);
  const running = parseRunning(Buffer.from('Ubuntu\r\ndocker-desktop\r\n', 'utf16le'));
  assert.deepStrictEqual([...running], ['Ubuntu', 'docker-desktop']);
});

test('alive: a session is gone when its Claude process ended or the pid now belongs to another', () => {
  const procs = parsePs(`412 ${START} claude\n500 ${START} bash\n`);
  assert.strictEqual(isGone({ cpid: 412, cstart: START, pids: [] }, procs), false);
  assert.strictEqual(isGone({ cpid: 412, cstart: 'Tue Nov 17 08:00:00 2026', pids: [] }, procs), true);
  assert.strictEqual(isGone({ cpid: 413, cstart: START, pids: [] }, procs), true);
  // older state files: the shell running the hook command, then Claude
  assert.strictEqual(isGone({ cpid: 0, pids: [411, 412, 500] }, procs), false);
  assert.strictEqual(isGone({ cpid: 0, pids: [399, 500, 1] }, procs), true);
  assert.strictEqual(isGone({ cpid: 0, pids: [] }, procs), false);
});

test('alive: on Linux the start time in ticks since boot decides, not lstart (it moves with the clock)', () => {
  // WSL after sleep: the wall clock was set, ps reports another lstart for the same process
  const procs = parsePs(`412 Wed Nov 18 10:09:57 2026 claude\nT 412 8770\n500 ${START} bash\nT 999 1\nfarmies-ps-done\n`);
  assert.strictEqual(procs.get(412).ticks, '8770');
  assert.strictEqual(procs.get(500).ticks, undefined);
  assert.strictEqual(procs.has(999), false);
  assert.strictEqual(isGone({ cpid: 412, cstart: '8770', pids: [] }, procs), false);
  assert.strictEqual(isGone({ cpid: 412, cstart: '8771', pids: [] }, procs), true);
  // state file from v0.1.23 (lstart) on Linux: the running pid is enough
  assert.strictEqual(isGone({ cpid: 412, cstart: START, pids: [] }, procs), false);
  // ticks recorded but none to compare (no /proc): the pid is enough
  assert.strictEqual(isGone({ cpid: 500, cstart: '8770', pids: [] }, procs), false);
});

test('alive: checked with ps on this machine', { skip: process.platform === 'win32' }, async () => {
  const start = (pid) =>
    execFileSync('ps', ['-o', 'lstart=', '-p', String(pid)], { env: { ...process.env, TZ: 'UTC0', LC_ALL: 'C' } })
      .toString()
      .trim();
  const ended = spawnSync('true').pid;
  const me = { id: 'me', cpid: process.pid, cstart: start(process.pid), pids: [] };
  const gone = { id: 'gone', cpid: ended, cstart: start(process.pid), pids: [] };
  const older = { id: 'older', cpid: 0, pids: [ended, process.pid] };
  const unknown = { id: 'unknown', cpid: 0, pids: [] };
  const result = await goneSessions([me, gone, older, unknown]);
  assert.deepStrictEqual(result.map((s) => s.id), ['gone']);
});

test('alive: the hook records Claude as the first ancestor that is not a shell', { skip: process.platform === 'win32' }, async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'farmies-alive-'));
  const hook = path.join(__dirname, '..', 'hook', 'farmies-hook.sh');
  // like Claude Code: the hook command runs in a shell started by the Claude process (here: node)
  execFileSync('sh', ['-c', `sh "${hook}" SessionStart || true`], {
    env: { PATH: process.env.PATH, HOME: home },
    input: JSON.stringify({ session_id: 's1', cwd: home }),
  });
  const d = JSON.parse(fs.readFileSync(path.join(home, '.farmies', 'sessions', 's1.json'), 'utf8'));
  assert.strictEqual(Number(d.cpid), process.pid);
  if (fs.existsSync('/proc/self/stat')) assert.match(d.cstart, /^\d+$/);
  const s = { id: 's1', cpid: Number(d.cpid), cstart: d.cstart, pids: [] };
  assert.deepStrictEqual(await goneSessions([s]), []);
  assert.deepStrictEqual((await goneSessions([{ ...s, cstart: d.cstart + '1' }])).map((x) => x.id), ['s1']);
});
