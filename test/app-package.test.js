const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const pkg = require('../src/app-package');

const ROOT = path.join(__dirname, '..');
const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'farmies-test-'));
const gz = (files) => zlib.gzipSync(JSON.stringify({ files: Object.fromEntries(Object.entries(files).map(([k, v]) => [k, Buffer.from(v).toString('base64')])) }));

/** a package dir as the updater leaves it */
function fakePackage(userData, version, electron = '45.2.1') {
  const dir = path.join(pkg.packagesDir(userData), version);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, pkg.MANIFEST), JSON.stringify({ version, electron }));
  return dir;
}

test('pack → unpack gives the app files with the package version', () => {
  const dir = tmpDir();
  const { name, data } = pkg.pack(ROOT, '45.2.1', '9.9.9', { skipMissing: true });
  assert.strictEqual(name, 'Farmies-9.9.9-app-electron-45.2.1.json.gz');
  assert.match(name, pkg.ASSET);
  assert.ok(data.length < 1024 * 1024, `package is ${data.length} bytes`);
  const out = path.join(dir, '9.9.9');
  pkg.unpack(data, out);
  for (const f of ['src/main.js', 'src/renderer/index.html', 'hook/farmies-hook.sh', 'assets/CREDITS.md']) {
    assert.ok(fs.readFileSync(path.join(out, f)).equals(fs.readFileSync(path.join(ROOT, f))), f);
  }
  // fonts the renderer loads from node_modules
  const css = fs.readFileSync(path.join(ROOT, 'src/renderer/style.css'), 'utf8');
  for (const [, ref] of css.matchAll(/url\('(\.\.\/\.\.\/node_modules\/[^']+)'\)/g)) {
    assert.ok(fs.existsSync(path.join(out, 'src/renderer', ref)), ref);
  }
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(out, 'package.json'), 'utf8')).version, '9.9.9');
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(out, pkg.MANIFEST), 'utf8')), { version: '9.9.9', electron: '45.2.1' });
  assert.ok(!fs.existsSync(`${out}.unpacking`));
  fs.rmSync(dir, { recursive: true });
});

test('unpack refuses paths outside the package and incomplete packages', () => {
  const dir = tmpDir();
  const ok = { [pkg.MANIFEST]: '{}', 'src/main.js': '' };
  assert.throws(() => pkg.unpack(gz({ ...ok, '../evil.js': 'x' }), path.join(dir, 'p')), /ungültiger Pfad/);
  assert.ok(!fs.existsSync(path.join(dir, 'evil.js')));
  assert.throws(() => pkg.unpack(gz({ 'src/main.js': '' }), path.join(dir, 'p')), /unvollständig/);
  assert.ok(!fs.existsSync(path.join(dir, 'p')));
  fs.rmSync(dir, { recursive: true });
});

test('choose: newest package newer than the built-in code for this Electron, removes the rest', () => {
  const userData = tmpDir();
  assert.strictEqual(pkg.choose(userData, '0.1.0', '45.2.1'), null, 'no packages folder');
  fakePackage(userData, '0.1.0'); // not newer than built-in
  fakePackage(userData, '0.1.2');
  const best = fakePackage(userData, '0.1.10');
  fakePackage(userData, '0.2.0', '46.0.0'); // other Electron
  fakePackage(userData, '0.3.0');
  pkg.markBad(userData, '0.3.0');
  assert.deepStrictEqual(pkg.choose(userData, '0.1.0', '45.2.1'), { dir: best, version: '0.1.10' });
  assert.deepStrictEqual(fs.readdirSync(pkg.packagesDir(userData)).sort(), ['0.1.10', 'bad.json']);
  // a built-in version as new as the package (full update): the package goes
  assert.strictEqual(pkg.choose(userData, '0.1.10', '45.2.1'), null);
  assert.deepStrictEqual(fs.readdirSync(pkg.packagesDir(userData)), ['bad.json']);
  fs.rmSync(userData, { recursive: true });
});

test('countStart: a package is given up after three starts without a drawn window', () => {
  const userData = tmpDir();
  const dir = fakePackage(userData, '0.2.0');
  assert.ok(pkg.countStart(dir));
  pkg.started(dir);
  assert.ok(pkg.countStart(dir) && pkg.countStart(dir) && pkg.countStart(dir));
  assert.strictEqual(pkg.countStart(dir), false);
  assert.ok(!pkg.isBad(userData, '0.2.0'));
  pkg.markBad(userData, '0.2.0');
  assert.ok(pkg.isBad(userData, '0.2.0'));
  fs.rmSync(userData, { recursive: true });
});
