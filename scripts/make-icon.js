#!/usr/bin/env node
// Creates build/icon.png (512x512) and build/icon.icns from the farm house of the tray icon,
// scaled up pixel-exact. Plain node, no image tools needed:
//   node scripts/make-icon.js
const fs = require('fs');
const path = require('path');
const png = require('./png');
const { BARN, COLORS } = require('../src/tray-icon');

const ROOT = path.join(__dirname, '..');
const SIZE = 512;

// bounding box of the drawn pixels
const xs = BARN.flatMap((row) => [...row].map((c, x) => (c === '.' ? null : x)).filter((x) => x !== null));
const x0 = Math.min(...xs);
const cw = Math.max(...xs) - x0 + 1;
const ch = BARN.length;
const scale = Math.floor((SIZE * 0.9) / Math.max(cw, ch));
const offX = Math.floor((SIZE - cw * scale) / 2);
const offY = Math.floor((SIZE - ch * scale) / 2);

const out = { w: SIZE, h: SIZE, data: new Uint8ClampedArray(SIZE * SIZE * 4) };
for (let y = 0; y < ch * scale; y++) {
  for (let x = 0; x < cw * scale; x++) {
    const color = COLORS[BARN[Math.floor(y / scale)][x0 + Math.floor(x / scale)]];
    if (color) out.data.set([...color, 255], ((offY + y) * SIZE + offX + x) * 4);
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
console.log(`build/icon.png, build/icon.icns (${cw}x${ch} pixel art, scale ${scale})`);
