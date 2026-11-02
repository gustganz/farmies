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
    const width = m.flowers.reduce((w, f) => w + M.FLOWERS[f].rows[0].length * (M.FLOWERS[f].s || 2) + 3, 0);
    assert.ok(width <= M.ZONE, `${m.name}: props wider than the corner`);
    assert.ok(m.flowers.every((f) => M.FLOWERS[f].rows.length * (M.FLOWERS[f].s || 2) <= 15), m.name);
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
  assert.strictEqual(meadow.a.x, meadow.a.restX);
  meadow.step(60);
  assert.strictEqual(meadow.a.phase, 'resting'); // stays as long as nobody comes
  meadow.pointer(meadow.a.x + 6, meadow.a.y - 4);
  meadow.step(0.1);
  assert.strictEqual(meadow.a.phase, 'leaving');
  for (let i = 0; i < 2000 && meadow.a.phase === 'leaving'; i++) meadow.step(0.1);
  assert.strictEqual(meadow.a.phase, 'away');
  assert.ok(meadow.a.wait >= 3600 && meadow.a.wait <= 10800);
});

test('meadow: the update signpost fits the corner and is clickable only while shown', () => {
  const { SIGN, SIGN_BOX } = M;
  assert.ok(SIGN.rows.every((r) => r.length === SIGN.rows[0].length));
  assert.ok(SIGN_BOX.w <= M.ZONE && SIGN_BOX.y >= 3);
  const meadow = new M.Meadow({ month: 0 });
  const mid = [SIGN_BOX.x + 10, SIGN_BOX.y + 4];
  assert.strictEqual(meadow.onSign(...mid), false);
  meadow.sign = true;
  assert.strictEqual(meadow.onSign(...mid), true);
  assert.strictEqual(meadow.onSign(10, 10), false);
});

test('prop animations keep the prop size and run over a long time', () => {
  for (const [name, anim] of Object.entries(M.ANIM)) {
    const fl = M.FLOWERS[name];
    assert.ok(fl, name);
    let changed = 0;
    for (let t = 0; t < 120; t += 0.05) {
      const fr = anim(t, fl);
      if (!fr) continue;
      changed++;
      if (fr.rows) {
        assert.equal(fr.rows.length, fl.rows.length, name);
        for (const r of fr.rows) assert.equal(r.length, fl.rows[0].length, `${name}: ${r}`);
      }
      for (const [x, y] of fr.extra || []) assert.ok(x >= -3 && x < fl.rows[0].length + 3 && y >= -3 && y < fl.rows.length, name);
    }
    assert.ok(changed > 0, `${name} never moves`);
  }
});

// a visitor of the given kind, already arrived and resting
function visitor(month, kind) {
  const meadow = new M.Meadow({ month });
  do meadow.arrive(); while (meadow.a.kind !== kind);
  for (let i = 0; i < 4000 && meadow.a.phase === 'arriving'; i++) meadow.step(0.05);
  assert.strictEqual(meadow.a.phase, 'resting', kind);
  return meadow;
}

test('meadow: bee, butterfly and dragonfly land on a blossom or the lantern', () => {
  for (const [month, kind] of [[4, 'bee'], [5, 'butterfly'], [7, 'dragonfly'], [8, 'dragonfly']]) {
    const meadow = visitor(month, kind);
    const p = meadow.a.perch;
    assert.ok(p, `${kind} in month ${month + 1}`);
    assert.strictEqual(meadow.a.y, p.y);
    assert.ok(meadow.a.x >= p.x - 20 && meadow.a.x <= p.x + p.w);
  }
});

test('meadow: the hare in March takes the carrot nose, which comes back once it is gone', () => {
  const meadow = visitor(2, 'hare');
  for (let i = 0; i < 600 && !meadow.carrotGone; i++) meadow.step(0.05);
  assert.ok(meadow.carrotGone);
  for (let i = 0; i < 600 && meadow.a.task !== 'done'; i++) meadow.step(0.05);
  assert.strictEqual(meadow.a.task, 'done');
  assert.strictEqual(meadow.a.x, M.REST_X);
  meadow.pointer(meadow.a.x + 6, meadow.a.y - 4);
  for (let i = 0; i < 2000 && meadow.a.phase !== 'away'; i++) meadow.step(0.05);
  assert.strictEqual(meadow.a.phase, 'away');
  assert.strictEqual(meadow.carrotGone, false);
});

test('meadow: the hedgehog in November hides under the leaf and takes it along', () => {
  const meadow = visitor(10, 'hedgehog');
  const leaf = M.layout(10).find((p) => p.f === 'mapleLeaf');
  assert.ok(meadow.a.leaf);
  assert.ok(meadow.a.x >= leaf.x && meadow.a.x <= leaf.x + leaf.w);
  meadow.pointer(meadow.a.x + 6, meadow.a.y - 4);
  meadow.step(0.05);
  assert.strictEqual(meadow.a.phase, 'leaving');
  for (let i = 0; i < 2000 && meadow.a.phase !== 'away'; i++) meadow.step(0.05);
  assert.strictEqual(meadow.a.phase, 'away');
  assert.ok(meadow.time < meadow.leafBack); // the leaf is gone for a while
  meadow.step(31);
  assert.ok(meadow.time >= meadow.leafBack);
  assert.strictEqual(visitor(9, 'hedgehog').a.leaf, undefined); // October: no leaf to hide under
});
