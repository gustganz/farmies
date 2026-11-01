const test = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Updater, windowsScript, MAC_SCRIPT } = require('../src/updater');

const release = (version, assets = []) => ({
  tag_name: `v${version}`,
  html_url: `https://github.com/gustganz/farmies/releases/tag/v${version}`,
  assets,
});
const fakeApp = (version, isPackaged = true) => ({ getVersion: () => version, isPackaged });
const fakeNet = (routes) => ({
  fetch: async (url) => (routes[url] ? routes[url]() : new Response('not found', { status: 404 })),
});
const LATEST = 'https://api.github.com/repos/gustganz/farmies/releases/latest';

test('check: announces a newer release once, clears it when gone', async () => {
  let latest = release('0.2.0');
  const u = new Updater({ app: fakeApp('0.1.0'), net: fakeNet({ [LATEST]: () => Response.json(latest) }) });
  const seen = [];
  u.on('change', (x) => seen.push(x && x.version));
  await u.check();
  await u.check();
  assert.deepStrictEqual(seen, ['0.2.0']);
  assert.strictEqual(u.update.installable, false, 'no file for this platform');
  latest = release('0.1.0');
  await u.check();
  assert.deepStrictEqual(seen, ['0.2.0', null]);
});

test('check: no release yet or offline changes nothing', async () => {
  const u = new Updater({ app: fakeApp('0.1.0'), net: fakeNet({}) });
  await u.check();
  assert.strictEqual(u.update, null);
  const offline = new Updater({ app: fakeApp('0.1.0'), net: { fetch: async () => { throw new Error('offline'); } } });
  await assert.rejects(offline.check(), /offline/);
  offline.checkQuietly(); // regular checks swallow it
  assert.strictEqual(offline.update, null);
});

test('download: writes the file and reports progress', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'farmies-test-'));
  const body = Buffer.alloc(200000, 7);
  const u = new Updater({ app: fakeApp('0.1.0'), net: fakeNet({ 'https://x/file': () => new Response(body) }) });
  u.update = { version: '0.2.0' };
  const progress = [];
  u.on('change', (x) => progress.push(x.progress));
  const file = path.join(dir, 'Farmies-0.2.0-portable.exe');
  await u.download({ url: 'https://x/file', size: body.length }, file);
  assert.ok(fs.readFileSync(file).equals(body));
  assert.ok(!fs.existsSync(`${file}.download`));
  assert.strictEqual(progress.at(-1), 100);
  fs.rmSync(dir, { recursive: true });
});

test('download: a failed request leaves nothing behind', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'farmies-test-'));
  const u = new Updater({ app: fakeApp('0.1.0'), net: fakeNet({}) });
  await assert.rejects(u.download({ url: 'https://x/missing' }, path.join(dir, 'f')), /HTTP 404/);
  assert.deepStrictEqual(fs.readdirSync(dir), []);
  fs.rmSync(dir, { recursive: true });
});

test('windowsScript: waits, starts the new exe, deletes the old one, quotes paths', () => {
  const s = windowsScript(42, "C:\\Users\\O'Brien\\Farmies-0.1.0-portable.exe", 'C:\\Users\\x\\Farmies-0.2.0-portable.exe', 'C:\\Users\\x\\Farmies-0.2.0-portable.exe');
  const lines = s.split('\n');
  assert.match(lines[0], /^Wait-Process -Id 42 /);
  assert.ok(lines.some((l) => l === "Start-Process -FilePath 'C:\\Users\\x\\Farmies-0.2.0-portable.exe'"));
  assert.ok(lines.at(-1).includes("'C:\\Users\\O''Brien\\Farmies-0.1.0-portable.exe'"));
  assert.ok(lines.findIndex((l) => l.startsWith('Start-Process')) > 0);
});

test('windowsScript: same file name moves the download over the old exe first', () => {
  const exe = 'C:\\x\\Farmies.exe';
  const lines = windowsScript(1, exe, exe, `${exe}.new`).split('\n');
  const move = lines.findIndex((l) => l.includes(`'${exe}.new'`));
  const start = lines.findIndex((l) => l.startsWith('Start-Process'));
  assert.ok(move > 0 && move < start);
  assert.strictEqual(start, lines.length - 1, 'old exe is not deleted');
});

test('MAC_SCRIPT swaps the bundle after the app quit and starts it', { skip: process.platform === 'win32' }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'farmies-test-'));
  const app = path.join(dir, 'Applications', 'Farmies.app');
  const tmp = path.join(dir, 'update');
  const fresh = path.join(tmp, 'app', 'Farmies.app');
  fs.mkdirSync(app, { recursive: true });
  fs.writeFileSync(path.join(app, 'version'), 'old');
  fs.mkdirSync(fresh, { recursive: true });
  fs.writeFileSync(path.join(fresh, 'version'), 'new');
  // stand-in for macOS `open`
  const bin = path.join(dir, 'bin');
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'open'), `#!/bin/sh\necho "$1" > "${dir}/opened"\n`, { mode: 0o755 });
  // pid 999999: not running, the script does not wait
  execFileSync('/bin/sh', ['-c', MAC_SCRIPT, 'sh', '999999', app, fresh, tmp], {
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
  });
  assert.strictEqual(fs.readFileSync(path.join(app, 'version'), 'utf8'), 'new');
  assert.ok(!fs.existsSync(`${app}.farmies-old`));
  assert.ok(!fs.existsSync(tmp));
  assert.strictEqual(fs.readFileSync(path.join(dir, 'opened'), 'utf8').trim(), app);
  fs.rmSync(dir, { recursive: true });
});

test('windowsLaunch: PowerShell gets its own console via cmd start (detached it would not run)', () => {
  const [cmd, args] = require('../src/updater').windowsLaunch('Write-Output 1');
  assert.strictEqual(cmd, 'cmd.exe');
  assert.deepStrictEqual(args.slice(0, 5), ['/d', '/c', 'start', '""', '/min']);
  assert.strictEqual(Buffer.from(args.at(-1), 'base64').toString('utf16le'), 'Write-Output 1');
});
