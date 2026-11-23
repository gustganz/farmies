// State of a session from its state file (src/sessions.js).
const { test } = require('node:test');
const assert = require('node:assert');
const { Sessions, clearedBySeeing } = require('../src/sessions');

test('sessions: event time from the file, not the hook clock (WSL clock may lag behind Windows)', () => {
  const sessions = new Sessions();
  const lagging = Math.floor(Date.now() / 1000) - 10 * 60; // WSL clock 10 min behind
  const working = sessions.toSession({ session_id: 'a', event: 'PostToolUse', ts: lagging }, Date.now());
  assert.strictEqual(working.state, 'working');

  // marked as seen, then the session finishes: the new bubble shows although the hook clock lags
  sessions.dismissed.set('b', Date.now() - 1000);
  const done = sessions.toSession({ session_id: 'b', event: 'Stop', ts: lagging }, Date.now());
  assert.strictEqual(done.state, 'done');
  const seen = sessions.toSession({ session_id: 'b', event: 'Stop', ts: lagging }, Date.now() - 2000);
  assert.strictEqual(seen.state, 'idle');
});

test('sessions: context texts are one short line, the result its first sentence', () => {
  const { oneLine, firstSentence } = require('../src/sessions');
  assert.strictEqual(oneLine('Fix the\n  button '), 'Fix the button');
  assert.strictEqual(oneLine('cut ä\uFFFD'), 'cut ä');
  const long = oneLine('x'.repeat(200));
  assert.strictEqual(long.length, 80);
  assert.ok(long.endsWith('…'));
  assert.strictEqual(firstSentence('**Fertig.** Der Button geht wieder. Tests grün.'), 'Fertig.');
  assert.strictEqual(firstSentence('Ich habe `src/app.js` geändert: der Export geht. Mehr.'), 'Ich habe src/app.js geändert: der Export geht.');
  assert.strictEqual(firstSentence('Version 1.2 ist da'), 'Version 1.2 ist da');

  const sessions = new Sessions();
  const s = sessions.toSession({ session_id: 'a', event: 'Stop', task: 'Fix\nit', detail: 'Done. More.', branch: 'main', step: 'Edit · a.js' });
  assert.deepStrictEqual([s.task, s.detail, s.branch, s.step, s.title], ['Fix it', 'Done.', 'main', 'Edit · a.js', '']);
});

test('sessions: done or failed counts as handled once the user went on in the session', () => {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'farmies-sessions-'));
  const transcript = path.join(dir, 't.jsonl');
  const ts = Math.floor(Date.now() / 1000) - 60; // finished a minute ago (hook clock)
  const at = (s) => new Date((ts + s) * 1000).toISOString();
  const write = (...entries) => {
    fs.writeFileSync(transcript, entries.map((e) => JSON.stringify(e)).join('\n') + '\n');
    fs.utimesSync(transcript, new Date(), new Date());
  };
  const state = (event = 'Stop') => new Sessions().toSession({ session_id: 'a', event, ts, transcript }, ts * 1000).state;

  // the turn itself, then only Claude Code's own entries after it: still done
  write(
    { type: 'user', timestamp: at(-30), message: { role: 'user', content: 'fix it' } },
    { type: 'assistant', timestamp: at(-1), message: { role: 'assistant', content: 'Done.' } },
    { type: 'system', subtype: 'stop_hook_summary', timestamp: at(1) },
    { type: 'summary', summary: 'Fix it' },
  );
  assert.strictEqual(state(), 'done');
  assert.strictEqual(state('StopFailure'), 'error');

  // a new prompt, an answer or a slash command after it: handled, even without a hook
  const after = [
    { type: 'user', timestamp: at(20), message: { role: 'user', content: 'and now the tests' } },
    { type: 'system', subtype: 'local_command', timestamp: at(20), content: '<command-name>/model</command-name>' },
  ];
  for (const entry of after) {
    write({ type: 'assistant', timestamp: at(-1), message: {} }, entry, { type: 'summary', summary: 'x' });
    assert.strictEqual(state(), 'idle', entry.type);
    assert.strictEqual(state('StopFailure'), 'idle', entry.type);
  }

  // a line still being written at the end does not hide the message before it
  fs.appendFileSync(transcript, '{"type":"assistant","timest');
  assert.strictEqual(state(), 'idle');

  // only the end of a long transcript is read
  const { lastMessageTime } = require('../src/sessions');
  const big = { type: 'user', timestamp: at(-100), message: { content: 'x'.repeat(400 * 1024) } };
  write(big, { type: 'user', timestamp: at(30), message: {} });
  assert.strictEqual(lastMessageTime(transcript), Date.parse(at(30)));
  assert.strictEqual(lastMessageTime(path.join(dir, 'missing.jsonl')), 0);
});

test('sessions: questions and permission requests stay until answered, seeing clears only done/error', () => {
  const sessions = new Sessions();
  const now = Date.now();
  const state = (event) => sessions.toSession({ session_id: 'q', event, ts: Math.floor(now / 1000) }, now);
  assert.strictEqual(clearedBySeeing(state('Question')), false);
  assert.strictEqual(clearedBySeeing(state('PermissionRequest')), false);
  assert.strictEqual(clearedBySeeing(state('Notification')), false);
  assert.strictEqual(clearedBySeeing(state('Stop')), true);
  assert.strictEqual(clearedBySeeing(state('StopFailure')), true);
  assert.strictEqual(clearedBySeeing(state('PostToolUse')), false); // working: no bubble
});

test('sessions: waiting for background work counts as working, after 5 minutes it asks', () => {
  const sessions = new Sessions();
  const now = Date.now();
  const s = sessions.toSession({ session_id: 'a', event: 'Background', bg: '2', detail: 'npm test', ts: now / 1000 }, now);
  assert.strictEqual(s.state, 'working');
  assert.strictEqual(s.background, 2);
  assert.strictEqual(s.detail, 'npm test');
  assert.strictEqual(sessions.toSession({ session_id: 'a', event: 'Stop', ts: now / 1000 }, now).background, 0);

  // still running 5 minutes after the turn ended: "schon fertig?", cleared by seeing like done
  const late = () => sessions.toSession({ session_id: 'a', event: 'Background' }, now - 6 * 60 * 1000);
  assert.strictEqual(late().state, 'overdue');
  assert.ok(clearedBySeeing(late()));
  // seen or clicked: it rests and does not ask again (no back and forth)
  sessions.dismissed.set('a', now - 1000);
  assert.strictEqual(late().state, 'idle');
  assert.strictEqual(late().background, 1);
});

test('sessions: background agents count only while their transcripts change', () => {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'farmies-agents-'));
  const transcript = path.join(dir, 's1.jsonl');
  fs.writeFileSync(transcript, '');
  const sub = path.join(dir, 's1', 'subagents');
  fs.mkdirSync(path.join(sub, 'nested'), { recursive: true });
  const agent = (id, minutesAgo, where = sub) => {
    const f = path.join(where, `agent-${id}.jsonl`);
    fs.writeFileSync(f, '{}\n');
    const t = new Date(Date.now() - minutesAgo * 60 * 1000);
    fs.utimesSync(f, t, t);
  };
  const sessions = new Sessions();
  const now = Date.now();
  const d = { session_id: 's1', event: 'Background', bg: '2', agents: 'a1 a2', detail: 'Design 3 variants', reply: 'Pushed. **More** text.', transcript, ts: Math.floor(now / 1000) };

  // two agents Claude Code still lists, finished long ago: the turn is done, with Claude's reply
  agent('a1', 60);
  agent('a2', 50, path.join(sub, 'nested'));
  let s = sessions.toSession(d, now);
  assert.strictEqual(s.state, 'done');
  assert.strictEqual(s.background, 0);
  assert.strictEqual(s.detail, 'Pushed.');
  // a recently finished agent that is not listed does not keep it working
  agent('old', 0);
  assert.strictEqual(sessions.toSession(d, now).state, 'done');

  // one of them works: working, and no "schon fertig?" while it does, even after 5 minutes
  agent('a2', 1, path.join(sub, 'nested'));
  s = sessions.toSession(d, now);
  assert.strictEqual(s.state, 'working');
  assert.strictEqual(s.background, 2);
  assert.strictEqual(sessions.toSession({ ...d, ts: d.ts - 600 }, now - 10 * 60 * 1000).state, 'working');

  // a quiet agent next to a shell: only the shell counts
  agent('a2', 60, path.join(sub, 'nested'));
  s = sessions.toSession({ ...d, bg: '2', agents: 'a1' }, now);
  assert.strictEqual(s.state, 'working');
  assert.strictEqual(s.background, 1);

  // transcripts not found: as before (working, after 5 minutes it asks)
  assert.strictEqual(sessions.toSession({ ...d, agents: 'x1 x2' }, now).state, 'working');
  assert.strictEqual(sessions.toSession({ ...d, agents: 'x1 x2' }, now - 6 * 60 * 1000).state, 'overdue');
});

test('sessions: a turn stopped with Esc (no hook) is no longer working', () => {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const { isInterrupt } = require('../src/sessions');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'farmies-esc-'));
  const transcript = path.join(dir, 't.jsonl');
  const ts = Math.floor(Date.now() / 1000) - 60;
  const at = (s) => new Date((ts + s) * 1000).toISOString();
  const write = (...entries) => {
    fs.writeFileSync(transcript, entries.map((e) => JSON.stringify(e)).join('\n') + '\n');
    fs.utimesSync(transcript, new Date(), new Date());
  };
  const state = () => new Sessions().toSession({ session_id: 'a', event: 'PostToolUse', ts, transcript }, ts * 1000).state;
  write({ type: 'assistant', timestamp: at(10), message: { content: [{ type: 'text', text: 'Running the tests.' }] } });
  assert.strictEqual(state(), 'working');
  write({ type: 'user', timestamp: at(20), message: { content: [{ type: 'text', text: '[Request interrupted by user for tool use]' }] } });
  assert.strictEqual(state(), 'idle');
  write({ type: 'user', timestamp: at(20), message: { content: '[Request interrupted by user]' } });
  assert.strictEqual(state(), 'idle');
  assert.ok(!isInterrupt({ type: 'user', message: { content: 'go on' } }));
  // a long tool call without a hook: still working after 5 minutes
  const s = new Sessions().toSession({ session_id: 'b', event: 'PostToolUse', ts: Math.floor(Date.now() / 1000) }, Date.now() - 8 * 60 * 1000);
  assert.strictEqual(s.state, 'working');
});

test('sessions: done while a server keeps running is done, the shell is noted', () => {
  const sessions = new Sessions();
  const now = Date.now();
  const d = { session_id: 'a', event: 'Stop', bg: '1', step: 'pnpm docs:serve', ts: now / 1000 };
  const s = sessions.toSession(d, now - 60 * 60 * 1000);
  assert.strictEqual(s.state, 'done');
  assert.strictEqual(s.running, 1);
  assert.strictEqual(s.background, 0);
  sessions.dismissed.set('a', now);
  assert.strictEqual(sessions.toSession(d, now - 60 * 60 * 1000).state, 'idle');
  assert.strictEqual(sessions.toSession({ ...d, bg: '' }, now).running, 0);
});

test('sessions: the state files of sessions that ended without SessionEnd are removed', async () => {
  const { DIR, ALIVE_GRACE } = require('../src/sessions');
  const fs = require('fs');
  const path = require('path');
  fs.mkdirSync(DIR, { recursive: true });
  const old = new Date(Date.now() - ALIVE_GRACE - 1000);
  const write = (id, time) => {
    const file = path.join(DIR, `${id}.json`);
    fs.writeFileSync(file, JSON.stringify({ session_id: id, event: 'Stop', ts: Math.floor(Date.now() / 1000) }));
    fs.utimesSync(file, time, time);
    return file;
  };
  const ghost = write('farmies-test-ghost', old);
  const fresh = write('farmies-test-fresh', new Date());
  fs.writeFileSync(path.join(DIR, 'farmies-test-ghost.tab'), '{}');
  try {
    const sessions = new Sessions();
    sessions.poll();
    await sessions.removeGone(async (list) => list.filter((s) => s.id.startsWith('farmies-test-')));
    assert.strictEqual(fs.existsSync(ghost), false);
    assert.strictEqual(fs.existsSync(path.join(DIR, 'farmies-test-ghost.tab')), false);
    // just written: maybe a hook of a session that is starting
    assert.strictEqual(fs.existsSync(fresh), true);
    assert.strictEqual(sessions.get('farmies-test-ghost'), undefined);
  } finally {
    for (const f of [ghost, fresh]) fs.rmSync(f, { force: true });
  }
});

test('sessions: the project name from WSL/macOS and from native Windows paths', () => {
  const sessions = new Sessions();
  const project = (folder) => sessions.toSession({ session_id: 'a', event: 'Stop', folder }).project;
  assert.strictEqual(project('/home/gust/farmies'), 'farmies');
  assert.strictEqual(project('C:\\Users\\Gust\\Projekte\\farmies'), 'farmies');
  assert.strictEqual(project('C:\\Users\\Gust\\farmies\\'), 'farmies');
  assert.strictEqual(project(''), '?');
  assert.strictEqual(sessions.toSession({ session_id: 'a', event: 'Stop', hwnd: '1234' }).hwnd, 1234);
});
