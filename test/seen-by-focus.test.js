// Bubbles marked as seen when the user stays in the session's tab (src/seen-by-focus.js).
const { test } = require('node:test');
const assert = require('node:assert');
const { SeenByFocus, SHORT_MS, LONG_MS } = require('../src/seen-by-focus');

const s = { id: 'a', ts: 1000 };

test('seen by focus: focus coming to the tab after the bubble counts after a short while', () => {
  const seen = new SeenByFocus();
  let focused = false;
  const at = (t) => seen.update([s], () => focused, t);
  assert.deepStrictEqual(at(0), []);
  focused = true;
  assert.deepStrictEqual(at(1000), []);
  assert.deepStrictEqual(at(1000 + SHORT_MS - 1), []);
  assert.deepStrictEqual(at(1000 + SHORT_MS), ['a']);
});

test('seen by focus: in the tab all along takes the long time, leaving and coming back the short one', () => {
  const seen = new SeenByFocus();
  let focused = true;
  const at = (t) => seen.update([s], () => focused, t);
  assert.deepStrictEqual(at(0), []);
  assert.deepStrictEqual(at(SHORT_MS + 1000), []);
  assert.deepStrictEqual(at(LONG_MS), ['a']);

  const again = new SeenByFocus();
  const at2 = (t) => again.update([s], () => focused, t);
  focused = true;
  at2(0);
  focused = false;
  at2(2000); // away for a moment
  focused = true;
  at2(3000);
  assert.deepStrictEqual(at2(3000 + SHORT_MS - 1), []);
  assert.deepStrictEqual(at2(3000 + SHORT_MS), ['a']);
});

test('seen by focus: a new bubble of the session starts over, the focus has to stay', () => {
  const seen = new SeenByFocus();
  let focused = false;
  seen.update([s], () => focused, 0);
  focused = true;
  seen.update([s], () => focused, 1000);
  focused = false;
  seen.update([s], () => focused, 1000 + SHORT_MS - 1); // left too early
  focused = true;
  seen.update([s], () => focused, 20000);
  assert.deepStrictEqual(seen.update([s], () => focused, 20000 + SHORT_MS - 1), []);
  // the session finished again: a new event, focus already there → long time
  const next = { id: 'a', ts: 2000 };
  assert.deepStrictEqual(seen.update([next], () => true, 30000), []);
  assert.deepStrictEqual(seen.update([next], () => true, 30000 + SHORT_MS), []);
  assert.deepStrictEqual(seen.update([next], () => true, 30000 + LONG_MS), ['a']);
});
