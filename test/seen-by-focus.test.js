// Bubbles marked as seen when the user stays in the session's tab (src/seen-by-focus.js).
const { test } = require('node:test');
const assert = require('node:assert');
const { SeenByFocus, SEEN_MS } = require('../src/seen-by-focus');

const s = { id: 'a', ts: 1000 };

test('seen by focus: 5 seconds in the tab, also when the focus was there all along', () => {
  assert.strictEqual(SEEN_MS, 5000);
  const seen = new SeenByFocus();
  let focused = false;
  const at = (t) => seen.update([s], () => focused, t);
  assert.deepStrictEqual(at(0), []);
  focused = true;
  assert.deepStrictEqual(at(1000), []);
  assert.deepStrictEqual(at(1000 + SEEN_MS - 1), []);
  assert.deepStrictEqual(at(1000 + SEEN_MS), ['a']);

  const along = new SeenByFocus();
  assert.deepStrictEqual(along.update([s], () => true, 0), []);
  assert.deepStrictEqual(along.update([s], () => true, SEEN_MS), ['a']);
});

test('seen by focus: a new bubble of the session starts over, the focus has to stay', () => {
  const seen = new SeenByFocus();
  let focused = false;
  seen.update([s], () => focused, 0);
  focused = true;
  seen.update([s], () => focused, 1000);
  focused = false;
  seen.update([s], () => focused, 1000 + SEEN_MS - 1); // left too early
  focused = true;
  seen.update([s], () => focused, 20000);
  assert.deepStrictEqual(seen.update([s], () => focused, 20000 + SEEN_MS - 1), []);
  // the session finished again: a new event, the time starts over
  const next = { id: 'a', ts: 2000 };
  assert.deepStrictEqual(seen.update([next], () => true, 30000), []);
  assert.deepStrictEqual(seen.update([next], () => true, 30000 + SEEN_MS - 1), []);
  assert.deepStrictEqual(seen.update([next], () => true, 30000 + SEEN_MS), ['a']);
});
