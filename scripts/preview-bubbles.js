#!/usr/bin/env node
// Renders every animal with speech bubbles, using the app's bubble layout (src/bubbles.js), for
// checking where the bubbles sit (no display needed):
//   node scripts/preview-bubbles.js [count] [out.png]
// One row per animal; columns: walking left, walking right, standing (looking at you), held up.
const fs = require('fs');
const path = require('path');
const png = require('./png');
const Animals = require('../src/animals');
const Bubbles = require('../src/bubbles');

const count = Number(process.argv[2] || 1);
const out = process.argv[3] || `bubbles-preview-${count}.png`;
const SCALE = 2.5; // app default
const CELL_W = 260;
const CELL_H = 240;
const STATES = ['error', 'attention', 'question', 'done', 'done', 'attention', 'done'];

const hex = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16)).concat(255);
const sessions = Array.from({ length: count }, (_, i) => ({ id: `s${i}`, state: STATES[i % STATES.length] }));
const plan = Bubbles.plan(sessions);

const animals = Object.keys(Animals.ANIMALS).map((id) =>
  Animals.build(id, png.decode(fs.readFileSync(path.join(__dirname, '..', 'assets', 'lpc', Animals.ANIMALS[id].sheet)))),
);
const scenes = (a) => [
  [a.frames.left.walk[1], a.anchors.left],
  [a.frames.right.walk[1], a.anchors.right],
  [a.frames.front, a.anchors.front],
  [a.frames.held[0], a.anchors.held],
];

const W = CELL_W * 4;
const H = CELL_H * animals.length;
const img = { w: W, h: H, data: new Uint8ClampedArray(W * H * 4) };
img.data.fill(255);
const put = (x, y, c) => {
  x = Math.round(x);
  y = Math.round(y);
  if (x >= 0 && y >= 0 && x < W && y < H) img.data.set(c, (y * W + x) * 4);
};
const rect = (x, y, w, h, c) => {
  for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) put(x + xx, y + yy, c);
};
const art = (rows, colors, x, y) =>
  rows.forEach((line, ry) => [...line].forEach((ch, rx) => colors[ch] && rect(x + rx * Bubbles.PIXEL, y + ry * Bubbles.PIXEL, Bubbles.PIXEL, Bubbles.PIXEL, colors[ch])));

animals.forEach((a, r) => {
  scenes(a).forEach(([frame, head], c) => {
    const cx = c * CELL_W;
    const ground = (r + 1) * CELL_H - 10;
    rect(cx, ground, CELL_W - 4, 1, [140, 180, 110, 255]);
    // the animal, centred in the cell, feet on the ground line
    const k = SCALE * a.size; // as in the app: size setting times the animal's size
    const lx = Math.round(cx + CELL_W / 2 - (frame.w * k) / 2);
    const top = ground - Math.round(frame.h * k);
    for (let y = 0; y < Math.round(frame.h * k); y++) {
      for (let x = 0; x < Math.round(frame.w * k); x++) {
        const o = (Math.floor(y / k) * frame.w + Math.floor(x / k)) * 4;
        if (frame.data[o + 3] > 127) put(lx + x, top + y, [frame.data[o], frame.data[o + 1], frame.data[o + 2], 255]);
      }
    }
    // bubbles, as the app places them (positions relative to the window bottom = ground line)
    const hx = lx - cx + head.x * k + k / 2;
    const positions = Bubbles.place(plan.length, hx, (frame.h - head.top) * k);
    // draw back to front: the middle bubble lies on top
    [...plan.keys()].reverse().forEach((i) => {
      const b = plan[i];
      const bx = cx + positions[i].left;
      const by = ground - positions[i].bottom - Bubbles.HEIGHT;
      const ink = hex(Bubbles.INK);
      rect(bx, by - 2, Bubbles.WIDTH, 2, ink);
      rect(bx, by + Bubbles.HEIGHT, Bubbles.WIDTH, 2, ink);
      rect(bx - 2, by, 2, Bubbles.HEIGHT, ink);
      rect(bx + Bubbles.WIDTH, by, 2, Bubbles.HEIGHT, ink);
      rect(bx, by, Bubbles.WIDTH, Bubbles.HEIGHT, hex(Bubbles.PAPER));
      const gw = b.rows[0].length * Bubbles.PIXEL;
      const gh = b.rows.length * Bubbles.PIXEL;
      art(b.rows, { '#': hex(b.color) }, bx + (Bubbles.WIDTH - gw) / 2, by + (Bubbles.HEIGHT - gh) / 2);
      art(Bubbles.TAILS[b.tail], { '#': ink, P: hex(Bubbles.PAPER) }, bx + Bubbles.TAIL_X[b.tail], by + Bubbles.HEIGHT);
    });
  });
});
fs.writeFileSync(out, png.encode(img));
console.log(`${out}: ${animals.length} animals, ${count} session(s)`);
