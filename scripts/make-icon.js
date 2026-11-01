#!/usr/bin/env node
// Creates build/icon.png (512x512) and build/icon.icns from the chicken (standing, facing left),
// scaled up pixel-exact. Plain node, no image tools needed:
//   node scripts/make-icon.js
const fs = require('fs');
const path = require('path');
const png = require('./png');
const Animals = require('../src/animals');

const ROOT = path.join(__dirname, '..');
const SIZE = 512;

const sheet = png.decode(fs.readFileSync(path.join(ROOT, 'assets', 'lpc', Animals.ANIMALS.chicken.sheet)));
const chicken = Animals.build('chicken', sheet).frames.left.idle;
const box = Animals.bbox([chicken]);
const cw = box.x1 - box.x0 + 1;
const ch = box.y1 - box.y0 + 1;
const scale = Math.floor((SIZE * 0.9) / Math.max(cw, ch));
const offX = Math.floor((SIZE - cw * scale) / 2);
const offY = Math.floor((SIZE - ch * scale) / 2);

const out = { w: SIZE, h: SIZE, data: new Uint8ClampedArray(SIZE * SIZE * 4) };
for (let y = 0; y < ch * scale; y++) {
  for (let x = 0; x < cw * scale; x++) {
    const s = ((box.y0 + Math.floor(y / scale)) * chicken.w + box.x0 + Math.floor(x / scale)) * 4;
    out.data.set(chicken.data.subarray(s, s + 4), ((offY + y) * SIZE + offX + x) * 4);
  }
}
const icon = png.encode(out);

// .icns with a single 512x512 PNG entry ("ic09")
const entry = Buffer.alloc(8);
entry.write('ic09', 0, 'ascii');
entry.writeUInt32BE(icon.length + 8, 4);
const header = Buffer.alloc(8);
header.write('icns', 0, 'ascii');
header.writeUInt32BE(icon.length + 16, 4);

const dir = path.join(ROOT, 'build');
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, 'icon.png'), icon);
fs.writeFileSync(path.join(dir, 'icon.icns'), Buffer.concat([header, entry, icon]));
console.log(`build/icon.png, build/icon.icns (${cw}x${ch} sprite, scale ${scale})`);
