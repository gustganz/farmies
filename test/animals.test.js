const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const png = require('../scripts/png');
const Animals = require('../src/animals');

const bottom = (f) => {
  for (let y = f.h - 1; y >= 0; y--) for (let x = 0; x < f.w; x++) if (f.data[(y * f.w + x) * 4 + 3] > 127) return y;
  return -1;
};
const opaque = (f, x, y) => x >= 0 && y >= 0 && x < f.w && y < f.h && f.data[(y * f.w + x) * 4 + 3] > 127;
// the anchor is the head's top centre (between ears or horns it may be transparent itself)
const nearAnimal = (f, p) => [-3, -2, -1, 0, 1, 2, 3].some((dx) => [0, 1, 2, 3].some((dy) => opaque(f, p.x + dx, p.y + dy)));

for (const id of Object.keys(Animals.ANIMALS)) {
  test(`${id}: lying poses stand on the ground, heads are anchored`, () => {
    const sheet = png.decode(fs.readFileSync(path.join(__dirname, '..', 'assets', 'lpc', Animals.ANIMALS[id].sheet)));
    const a = Animals.build(id, sheet);
    const { left, right } = a.frames;
    const ground = Math.max(...left.walk.map(bottom)); // the lowest feet while walking
    for (const f of [left.lie, ...left.sleep, right.lie, ...right.sleep]) {
      assert.strictEqual(f.w, a.w);
      assert.strictEqual(bottom(f), ground);
    }
    assert.notDeepStrictEqual(left.sleep[0].data, left.sleep[1].data, 'breathing');
    for (const [name, frame] of [['lieLeft', left.lie], ['sleepLeft', left.sleep[0]], ['lieRight', right.lie], ['sleepRight', right.sleep[0]]]) {
      const p = a.anchors[name];
      assert.ok(nearAnimal(frame, p), `${name} on the animal`);
      assert.ok(p.top <= p.y);
    }
  });
}
