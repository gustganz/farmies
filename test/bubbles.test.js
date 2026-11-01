const test = require('node:test');
const assert = require('node:assert');
const Bubbles = require('../src/bubbles');

const sessions = (n) => Array.from({ length: n }, (_, i) => ({ id: `s${i}`, state: 'question' }));

test('one bubble per session, "+N" when more than fit', () => {
  assert.strictEqual(Bubbles.plan(sessions(3)).length, 3);
  const plan = Bubbles.plan(sessions(7));
  assert.strictEqual(plan.length, Bubbles.MAX_BUBBLES);
  assert.ok(!plan[4].session, 'last one is "+N"');
  assert.deepStrictEqual(
    plan.map((b) => b.tail),
    ['down', 'left', 'right', 'left', 'right'],
  );
});

test('an update always gets the last bubble', () => {
  const update = { status: 'available' };
  assert.deepStrictEqual(
    Bubbles.plan([], update).map((b) => [b.update, b.width]),
    [[true, Bubbles.UPDATE.width]],
  );
  const full = Bubbles.plan(sessions(9), update);
  assert.strictEqual(full.length, Bubbles.MAX_BUBBLES);
  assert.ok(full[4].update);
  assert.ok(!full[3].session && !full[3].update, '"+N" before it');
  assert.strictEqual(Bubbles.plan(sessions(4), update).filter((b) => b.session).length, 4);
});

test('downloading shows the percentage', () => {
  const [b] = Bubbles.plan([], { status: 'downloading', progress: 42 });
  assert.notDeepStrictEqual(b.rows, Bubbles.UPDATE.rows);
  assert.strictEqual(b.rows.length, 5);
});

test('place: centred over the head, wide bubbles further out', () => {
  const [middle] = Bubbles.place(1, 100, 50);
  assert.strictEqual(middle.left, 100 - Bubbles.WIDTH / 2);
  const normal = Bubbles.place(2, 100, 50);
  const wide = Bubbles.place(2, 100, 50, [Bubbles.WIDTH, Bubbles.UPDATE.width]);
  assert.ok(wide[1].left > normal[1].left - (Bubbles.UPDATE.width - Bubbles.WIDTH) / 2);
  assert.strictEqual(wide[0].left, normal[0].left);
});

test('tailX: the down tail is centred', () => {
  assert.strictEqual(Bubbles.tailX('down'), 8);
  assert.strictEqual(Bubbles.tailX('down', 34), 13);
  assert.strictEqual(Bubbles.tailX('right', 24), 14);
});
