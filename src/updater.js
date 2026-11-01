// Updates from GitHub Releases: checks for a newer release, downloads its file for this platform and
// swaps the app after it has quit (a small detached script), then starts the new version.
// Settings, dismissed sessions and the animal's position live outside the app, so they survive.
//   Windows (portable exe): the new exe goes next to the old one, the old one is deleted.
//   macOS: the zip is unpacked, signed ad hoc and replaces the .app bundle.
const { EventEmitter } = require('events');
const { execFile, spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { LATEST_URL, updateFrom } = require('./releases');

const FIRST_CHECK_MS = 15 * 1000;
const CHECK_INTERVAL_MS = 3600 * 1000;

const run = (cmd, args) =>
  new Promise((resolve, reject) =>
    execFile(cmd, args, (err, _out, stderr) => (err ? reject(new Error(stderr.trim() || err.message)) : resolve())),
  );

/**
 * PowerShell: wait until the app (pid) has quit, put the downloaded file in place (same file name
 * as the old exe: it was downloaded next to it), start the new exe, delete the old one.
 */
function windowsScript(pid, oldExe, newExe, downloaded) {
  const q = (s) => `'${s.replace(/'/g, "''")}'`;
  return [
    `Wait-Process -Id ${pid} -ErrorAction SilentlyContinue`,
    // the portable launcher may still hold the old exe for a moment
    `$replace = { param($from, $to) for ($i = 0; $i -lt 60; $i++) { try { if ($from) { Move-Item -Force -LiteralPath $from -Destination $to -ErrorAction Stop } else { Remove-Item -Force -LiteralPath $to -ErrorAction Stop }; break } catch { Start-Sleep -Seconds 1 } } }`,
    downloaded !== newExe ? `& $replace ${q(downloaded)} ${q(newExe)}` : '',
    `Start-Process -FilePath ${q(newExe)}`,
    oldExe !== newExe ? `& $replace $null ${q(oldExe)}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * How to start the script so it outlives the app: a detached PowerShell has no console and exits
 * without running anything, so `cmd start` opens it with its own (hidden) console.
 */
function windowsLaunch(script) {
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  return ['cmd.exe', ['/d', '/c', 'start', '""', '/min', 'powershell.exe', '-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-EncodedCommand', encoded]];
}

/** sh: wait until the app has quit, swap the bundles (old one back on failure), start it. */
const MAC_SCRIPT = `
while kill -0 "$1" 2>/dev/null; do sleep 0.2; done
if mv "$2" "$2.farmies-old"; then
  if mv "$3" "$2"; then rm -rf "$2.farmies-old"; else mv "$2.farmies-old" "$2"; fi
fi
rm -rf "$4"
open "$2"
`;

class Updater extends EventEmitter {
  /** app, net: from electron; quit: ends the app (after the swap script has started) */
  constructor({ app, net, quit }) {
    super();
    this.app = app;
    this.net = net;
    this.quit = quit;
    // { version, page, asset, status: 'available'|'downloading'|'error', progress, error }
    this.update = null;
  }

  start() {
    setTimeout(() => this.checkQuietly(), FIRST_CHECK_MS);
    setInterval(() => this.checkQuietly(), CHECK_INTERVAL_MS);
  }

  /** → the available update or null; throws if GitHub could not be asked (offline, rate limit). */
  async check() {
    if (this.update && this.update.status === 'downloading') return this.update;
    const res = await this.net.fetch(LATEST_URL, { headers: { Accept: 'application/vnd.github+json' } });
    if (res.status === 404) return null; // no release yet
    if (!res.ok) throw new Error(`GitHub antwortet mit HTTP ${res.status}`);
    const found = updateFrom(await res.json(), this.app.getVersion(), process.platform, process.arch);
    if (!found) {
      if (this.update) this.set(null);
    } else if (!this.update || this.update.version !== found.version) {
      // unpackaged (development) or no file for this platform: the click opens the release page
      this.set({ ...found, installable: !!found.asset && this.app.isPackaged, status: 'available', progress: 0 });
    }
    return this.update;
  }

  /** Regular checks: problems are ignored, the next check tries again. */
  checkQuietly() {
    this.check().catch(() => {});
  }

  set(update) {
    this.update = update;
    this.emit('change', update);
  }

  /** Downloads and applies the update; without a fitting file (or unpackaged) opens the release page. */
  async install() {
    const u = this.update;
    if (!u || u.status === 'downloading') return;
    if (!u.asset || !this.app.isPackaged) {
      require('electron').shell.openExternal(u.page);
      return;
    }
    this.set({ ...u, status: 'downloading', progress: 0, error: null });
    try {
      if (process.platform === 'win32') await this.installWindows(u);
      else if (process.platform === 'darwin') await this.installMac(u);
      else throw new Error('Plattform nicht unterstützt');
      this.quit();
    } catch (e) {
      this.set({ ...this.update, status: 'error', error: e.message });
    }
  }

  async download(asset, file) {
    const res = await this.net.fetch(asset.url);
    if (!res.ok) throw new Error(`Download: HTTP ${res.status}`);
    const total = Number(res.headers.get('content-length')) || asset.size || 0;
    const part = `${file}.download`;
    const out = fs.createWriteStream(part);
    let done = 0;
    let shown = -1;
    try {
      for await (const chunk of res.body) {
        if (!out.write(chunk)) await new Promise((resolve) => out.once('drain', resolve));
        done += chunk.length;
        const progress = total ? Math.floor((done / total) * 100) : 0;
        if (progress !== shown) {
          shown = progress;
          this.set({ ...this.update, progress });
        }
      }
      await new Promise((resolve, reject) => out.end((err) => (err ? reject(err) : resolve())));
    } catch (e) {
      out.destroy();
      fs.rmSync(part, { force: true });
      throw e;
    }
    if (total && done !== total) throw new Error('Download unvollständig');
    fs.renameSync(part, file);
  }

  async installWindows(u) {
    // the portable exe unpacks itself to a temp folder; this is the exe the user started
    const oldExe = process.env.PORTABLE_EXECUTABLE_FILE;
    if (!oldExe) throw new Error('Nur die portable .exe kann sich selbst aktualisieren');
    const newExe = path.join(path.dirname(oldExe), u.asset.name);
    const downloaded = newExe === oldExe ? `${newExe}.new` : newExe;
    await this.download(u.asset, downloaded);
    const script = windowsScript(process.pid, oldExe, newExe, downloaded);
    const [cmd, args] = windowsLaunch(script);
    spawn(cmd, args, { detached: true, stdio: 'ignore', windowsHide: true }).unref();
  }

  async installMac(u) {
    // …/Farmies.app/Contents/MacOS/Farmies → …/Farmies.app
    const bundle = path.resolve(process.execPath, '..', '..', '..');
    if (!bundle.endsWith('.app')) throw new Error(`Unerwarteter App-Pfad: ${bundle}`);
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'farmies-update-'));
    const zip = path.join(tmp, u.asset.name);
    await this.download(u.asset, zip);
    const unpacked = path.join(tmp, 'app');
    await run('/usr/bin/ditto', ['-x', '-k', zip, unpacked]);
    const newApp = path.join(unpacked, fs.readdirSync(unpacked).find((n) => n.endsWith('.app')) || 'Farmies.app');
    if (!fs.existsSync(newApp)) throw new Error('Keine App im Update-Archiv');
    // not notarized: ad-hoc signature so it runs on Apple Silicon, no quarantine flag
    await run('/usr/bin/xattr', ['-cr', newApp]).catch(() => {});
    await run('/usr/bin/codesign', ['--force', '--deep', '-s', '-', newApp]);
    spawn('/bin/sh', ['-c', MAC_SCRIPT, 'sh', String(process.pid), bundle, newApp, tmp], {
      detached: true,
      stdio: 'ignore',
    }).unref();
  }
}

module.exports = { Updater, windowsScript, windowsLaunch, MAC_SCRIPT };
