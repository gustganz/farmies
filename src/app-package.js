// Small updates: when a release keeps the Electron version, the app's own files (well under 1 MB)
// are enough. Each release carries them as Farmies-<v>-app-electron-<electron>.json.gz (gzipped
// JSON, path → base64); the updater unpacks it to <userData>/app/<v>/ and src/boot.js starts the
// newest fitting package instead of the code built into the exe/.app. Plain node (scripts, tests).
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ASSET = /^Farmies-(\d+\.\d+\.\d+)-app-electron-(.+)\.json\.gz$/;
const MANIFEST = 'farmies-package.json';
const MAX_TRIES = 3; // starts in a row without a drawn window, then the package is given up

const assetName = (version, electron) => `Farmies-${version}-app-electron-${electron}.json.gz`;
const packagesDir = (userData) => path.join(userData, 'app');

/** "a/**" → every file below a, other patterns: that one file (as in package.json build.files) */
function listFiles(root, patterns) {
  const out = [];
  const walk = (rel) => {
    const abs = path.join(root, rel);
    if (fs.statSync(abs).isDirectory()) for (const n of fs.readdirSync(abs).sort()) walk(`${rel}/${n}`);
    else out.push(rel);
  };
  for (const p of patterns) walk(p.endsWith('/**') ? p.slice(0, -3) : p);
  return out;
}

/**
 * The package of the app in root: the files of build.files plus the runtime dependencies (their
 * node_modules folders, like electron-builder). version overrides package.json (start test).
 */
function pack(root, electron, version) {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  if (version) pkg.version = version;
  const patterns = [...pkg.build.files, ...Object.keys(pkg.dependencies || {}).map((d) => `node_modules/${d}/**`)];
  const files = {};
  for (const rel of listFiles(root, patterns)) files[rel] = fs.readFileSync(path.join(root, rel)).toString('base64');
  files['package.json'] = Buffer.from(JSON.stringify(pkg, null, 2)).toString('base64');
  files[MANIFEST] = Buffer.from(JSON.stringify({ version: pkg.version, electron })).toString('base64');
  return { name: assetName(pkg.version, electron), data: zlib.gzipSync(JSON.stringify({ files }), { level: 9 }) };
}

/** Writes the package to dir (first next to it, then renamed, so a half-written one never starts). */
function unpack(data, dir) {
  const { files } = JSON.parse(zlib.gunzipSync(data).toString('utf8'));
  if (!files || !(MANIFEST in files) || !('src/main.js' in files)) throw new Error('Update-Paket unvollständig');
  const tmp = `${dir}.unpacking`;
  fs.rmSync(tmp, { recursive: true, force: true });
  for (const [rel, b64] of Object.entries(files)) {
    const abs = path.resolve(tmp, rel);
    if (!abs.startsWith(path.resolve(tmp) + path.sep)) throw new Error(`Update-Paket: ungültiger Pfad ${rel}`);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, Buffer.from(b64, 'base64'));
  }
  fs.rmSync(dir, { recursive: true, force: true });
  fs.renameSync(tmp, dir);
}

const readJson = (file) => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
};

/** A package that failed to start is not taken again (the next update of that version is a full one). */
const badFile = (userData) => path.join(packagesDir(userData), 'bad.json');
const isBad = (userData, version) => (readJson(badFile(userData)) || []).includes(version);
function markBad(userData, version) {
  const bad = new Set(readJson(badFile(userData)) || []);
  bad.add(version);
  fs.mkdirSync(packagesDir(userData), { recursive: true });
  fs.writeFileSync(badFile(userData), JSON.stringify([...bad]));
}

const newer = (a, b) => {
  const x = a.split('.').map(Number);
  const y = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
  return false;
};

/**
 * The package to start: the newest one newer than the built-in version, for this Electron, not
 * given up. Removes the others (older ones, other Electron, given up). → { dir, version } | null
 */
function choose(userData, builtIn, electron) {
  const base = packagesDir(userData);
  let names = [];
  try {
    names = fs.readdirSync(base);
  } catch {
    return null;
  }
  const fitting = [];
  for (const name of names) {
    const dir = path.join(base, name);
    if (name === 'bad.json') continue;
    const m = readJson(path.join(dir, MANIFEST));
    if (m && m.version === name && m.electron === electron && newer(name, builtIn) && !isBad(userData, name)) fitting.push(name);
    else fs.rmSync(dir, { recursive: true, force: true });
  }
  fitting.sort((a, b) => (newer(a, b) ? -1 : 1));
  for (const old of fitting.slice(1)) fs.rmSync(path.join(base, old), { recursive: true, force: true });
  return fitting.length ? { dir: path.join(base, fitting[0]), version: fitting[0] } : null;
}

/** Counts a start of the package; → false once it failed MAX_TRIES times in a row. */
function countStart(dir) {
  const file = path.join(dir, '.tries');
  const tries = (Number(readJson(file)) || 0) + 1;
  fs.writeFileSync(file, String(tries));
  return tries <= MAX_TRIES;
}
const started = (dir) => fs.rmSync(path.join(dir, '.tries'), { force: true });

module.exports = { ASSET, MANIFEST, assetName, packagesDir, listFiles, pack, unpack, isBad, markBad, choose, countStart, started };
