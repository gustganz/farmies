#!/usr/bin/env node
// Renders all poses of all animals into one PNG for checking the look (no display needed):
//   node scripts/preview-animals.js [out.png]
// Per animal one row: walk (4), idle, lie, sleep (2), held (2, front view), glide (chicken), front, walk right.
// The red pixel marks the bubble anchor (head) of each pose.
const fs = require('fs');
const path = require('path');
const png = require('./png');
const Animals = require('../src/animals');

const SCALE = 3;
const GAP = 4;
const out = process.argv[2] || 'animals-preview.png';

const rows = Object.keys(Animals.ANIMALS).map((id) => {
  const sheet = png.decode(fs.readFileSync(path.join(__dirname, '..', 'assets', 'lpc', Animals.ANIMALS[id].sheet)));
  const a = Animals.build(id, sheet);
  const { left, right, front } = a.frames;
  const anchors = a.anchors;
  return [
    ...left.walk.map((f) => [f, anchors.left]),
    [left.idle, anchors.left],
    [left.lie, anchors.lieLeft],
    ...left.sleep.map((f) => [f, anchors.sleepLeft]),
    ...a.frames.held.slice(0, 2).map((f) => [f, anchors.held]),
    ...left.glide.slice(0, 1).map((f) => [f, anchors.left]),
    [front, anchors.front],
    [right.walk[0], anchors.right],
  ];
});

const cellW = Math.max(...rows.flat().map(([f]) => f.w)) + GAP;
const cellH = Math.max(...rows.flat().map(([f]) => f.h)) + GAP;
const cols = Math.max(...rows.map((r) => r.length));
const W = cols * cellW * SCALE;
const H = rows.length * cellH * SCALE;
const img = { w: W, h: H, data: new Uint8ClampedArray(W * H * 4) };
img.data.fill(255);
const put = (x, y, c) => {
  for (let dy = 0; dy < SCALE; dy++) for (let dx = 0; dx < SCALE; dx++) img.data.set(c, ((y * SCALE + dy) * W + x * SCALE + dx) * 4);
};
rows.forEach((row, r) =>
  row.forEach(([f, anchor], c) => {
    const ox = c * cellW;
    const oy = r * cellH + (cellH - GAP - f.h);
    for (let y = 0; y < f.h; y++) {
      for (let x = 0; x < f.w; x++) {
        const o = (y * f.w + x) * 4;
        if (f.data[o + 3] > 127) put(ox + x, oy + y, [f.data[o], f.data[o + 1], f.data[o + 2], 255]);
        else put(ox + x, oy + y, [235, 235, 235, 255]);
      }
    }
    put(ox + anchor.x, oy + anchor.y - 1, [255, 0, 0, 255]);
  }),
);
fs.writeFileSync(out, png.encode(img));
console.log(`${out}: ${rows.length} animals`);
