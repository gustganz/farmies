// State of a session from its state file (src/sessions.js).
const { test } = require('node:test');
const assert = require('node:assert');
const { Sessions } = require('../src/sessions');

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
