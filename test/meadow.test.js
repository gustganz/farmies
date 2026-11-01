// Seasonal meadow of the hover panel (src/meadow.js).
const { test } = require('node:test');
const assert = require('node:assert');
const M = require('../src/meadow');

test('meadow: every month brings one new animal and keeps one from the month before', () => {
  assert.strictEqual(M.MONTHS.length, 12);
  assert.strictEqual(new Set(M.CYCLE).size, 12);
  for (let m = 0; m < 12; m++) {
    const [a, b] = M.animalsOf(m);
    assert.notStrictEqual(a, b);
    assert.strictEqual(M.animalsOf((m + 1) % 12)[0], b, `month ${m + 1}`);
  }
});

test('meadow: art is well-formed and small enough for the corner', () => {
  for (const [name, f] of Object.entries(M.FLOWERS)) {
    assert.ok(f.rows.every((r) => r.length === f.rows[0].length), name);
    assert.ok([...f.rows.join('')].every((c) => c === '.' || f.c[c]), `${name}: colour missing`);
  }
  for (const m of M.MONTHS) {
    const width = m.flowers.reduce((w, f) => w + M.FLOWERS[f].rows[0].length * 2 + 3, 0);
    assert.ok(width <= M.ZONE, `${m.name}: props wider than the corner`);
    assert.ok(m.flowers.every((f) => M.FLOWERS[f].rows.length <= 7), m.name);
  }
  for (const [name, a] of Object.entries(M.ANIMALS)) {
    for (const fr of a.frames) assert.ok(fr.every((r) => r.length === fr[0].length), name);
  }
});

test('meadow: a visitor comes, rests in the corner and leaves when the pointer comes close', () => {
  const meadow = new M.Meadow({ month: 6, firstDelay: 1, minDelay: 3600, maxDelay: 10800 });
  meadow.step(2);
  assert.strictEqual(meadow.a.phase, 'arriving');
  assert.ok(M.animalsOf(6).includes(meadow.a.kind));
  for (let i = 0; i < 2000 && meadow.a.phase === 'arriving'; i++) meadow.step(0.1);
  assert.strictEqual(meadow.a.phase, 'resting');
  assert.strictEqual(meadow.a.x, M.REST_X);
  meadow.step(60);
  assert.strictEqual(meadow.a.phase, 'resting'); // stays as long as nobody comes
  meadow.pointer(M.REST_X + 6, meadow.a.y - 4);
  meadow.step(0.1);
  assert.strictEqual(meadow.a.phase, 'leaving');
  for (let i = 0; i < 2000 && meadow.a.phase === 'leaving'; i++) meadow.step(0.1);
  assert.strictEqual(meadow.a.phase, 'away');
  assert.ok(meadow.a.wait >= 3600 && meadow.a.wait <= 10800);
});
