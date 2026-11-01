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
