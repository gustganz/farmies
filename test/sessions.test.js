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
