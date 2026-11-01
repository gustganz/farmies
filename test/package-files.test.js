const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const patterns = require('../package.json').build.files;
const packaged = (file) => patterns.some((p) => (p.endsWith('/**') ? file.startsWith(p.slice(0, -2)) : file === p));

// everything the app loads from outside src/ must be in the package (build.files)
test('files the app loads are packaged', () => {
  const missing = [];
  for (const name of fs.readdirSync(path.join(ROOT, 'src')).filter((n) => n.endsWith('.js'))) {
    const code = fs.readFileSync(path.join(ROOT, 'src', name), 'utf8');
    const refs = [
      ...[...code.matchAll(/require\('(\.\.\/[^']+)'\)/g)].map((m) => m[1]),
      ...[...code.matchAll(/path\.join\(__dirname, '\.\.', ((?:'[^']+'(?:, )?)+)\)/g)].map((m) => `../${m[1].replace(/'/g, '').split(', ').join('/')}`),
    ];
    for (const ref of refs) {
      const file = path.relative(ROOT, path.join(ROOT, 'src', ref)).split(path.sep).join('/');
      if (!packaged(file)) missing.push(`${file} (src/${name})`);
    }
  }
  assert.deepStrictEqual(missing, []);
});
