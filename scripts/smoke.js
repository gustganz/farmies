#!/usr/bin/env node
// Start test of the packaged app (after electron-builder, also with --dir): starts it with
// FARMIES_DEBUG, waits for its snapshot and checks that it runs, draws the animal, logs no errors
// and set up the Claude Code hooks (macOS/Linux; on Windows they need WSL). Runs on GitHub Actions
// (macOS, Windows), where there is nobody to look:
//   node scripts/smoke.js [--package] [out.png]
// The snapshot (animal with the hover panel) is copied to out.png (default dist/smoke-<platform>.png).
// --package: the same with this checkout as small update package (src/app-package.js, version
// 99.0.0) in the app's data folder: the app must start the package instead of its built-in code.
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const png = require('./png');
const appPackage = require('../src/app-package');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const args = process.argv.slice(2);
const withPackage = args.includes('--package');
const PACKAGE_VERSION = '99.0.0';
const out = args.find((a) => !a.startsWith('--')) || path.join(DIST, `smoke-${process.platform}${withPackage ? '-package' : ''}.png`);
const TIMEOUT_MS = 60000;

function executable() {
  if (process.platform === 'win32') return path.join(DIST, 'win-unpacked', 'Farmies.exe');
  if (process.platform === 'darwin') {
    // dist/mac-arm64/Farmies.app or dist/mac/Farmies.app; the one for this machine first
    const dirs = fs.readdirSync(DIST).filter((d) => /^mac/.test(d)).sort((a) => (a.includes(process.arch) ? -1 : 1));
    if (!dirs.length) throw new Error('no macOS build in dist/');
    return path.join(DIST, dirs[0], 'Farmies.app', 'Contents', 'MacOS', 'Farmies');
  }
  return path.join(DIST, 'linux-unpacked', 'farmies');
}

function userData() {
  if (process.platform === 'win32') return path.join(process.env.APPDATA, 'Farmies');
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Application Support', 'Farmies');
  return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'Farmies');
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  const exe = executable();
  const data = userData();
  const capture = path.join(data, 'capture.png');
  const log = path.join(data, 'debug.log');
  fs.rmSync(capture, { force: true });
  fs.rmSync(log, { force: true });
  const packages = appPackage.packagesDir(data);
  fs.rmSync(packages, { recursive: true, force: true });
  if (withPackage) {
    const { data: gz } = appPackage.pack(ROOT, require('electron/package.json').version, PACKAGE_VERSION);
    fs.mkdirSync(packages, { recursive: true });
    appPackage.unpack(gz, path.join(packages, PACKAGE_VERSION));
  }

  console.log(`starting ${exe}`);
  const app = spawn(exe, [], { env: { ...process.env, FARMIES_DEBUG: '1' }, stdio: 'inherit' });
  let exited = null;
  app.on('exit', (code) => (exited = code));

  const problems = [];
  const start = Date.now();
  while (!fs.existsSync(capture) && exited === null && Date.now() - start < TIMEOUT_MS) await sleep(500);
  await sleep(3000); // a few more seconds of running (hooks are set up in the background)

  if (exited !== null) problems.push(`app exited with code ${exited}`);
  if (!fs.existsSync(capture)) {
    problems.push(`no snapshot after ${TIMEOUT_MS / 1000}s`);
  } else {
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.copyFileSync(capture, out);
    const img = png.decode(fs.readFileSync(capture));
    let drawn = 0;
    for (let i = 3; i < img.data.length; i += 4) if (img.data[i] > 127) drawn++;
    console.log(`snapshot ${img.w}x${img.h}, ${drawn} drawn pixels → ${out}`);
    if (drawn < 500) problems.push('snapshot is (nearly) empty: the animal was not drawn');
  }

  const lines = fs.existsSync(log) ? fs.readFileSync(log, 'utf8').split('\n') : [];
  problems.push(...lines.filter((l) => l.startsWith('error')));
  if (withPackage) {
    if (!lines.includes(`boot package ${PACKAGE_VERSION}`)) problems.push('the update package was not started');
    if (fs.existsSync(path.join(packages, PACKAGE_VERSION, '.tries'))) problems.push('the package start was not counted as good');
  } else if (lines.some((l) => l.startsWith('boot package'))) {
    problems.push('started a package although there is none');
  }
  const hooks = lines.find((l) => l.startsWith('hooks '));
  console.log(hooks || 'no hook status logged');
  if (process.platform !== 'win32') {
    const hook = path.join(os.homedir(), '.farmies', 'hook.sh');
    if (!fs.existsSync(hook)) problems.push('~/.farmies/hook.sh missing');
    else if (fs.readFileSync(hook, 'utf8').includes('\r')) problems.push('~/.farmies/hook.sh has CRLF line ends');
    const settings = path.join(os.homedir(), '.claude', 'settings.json');
    if (!fs.existsSync(settings) || !fs.readFileSync(settings, 'utf8').includes('.farmies/hook.sh')) {
      problems.push('hooks missing in ~/.claude/settings.json');
    }
  }

  if (exited === null) app.kill();
  if (withPackage) {
    await sleep(1000);
    fs.rmSync(packages, { recursive: true, force: true });
  }
  if (problems.length) {
    console.error(`start test FAILED:\n- ${problems.join('\n- ')}`);
    process.exit(1);
  }
  console.log('start test passed');
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
