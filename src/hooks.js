// Makes sure the Claude Code hooks are set up; runs on every app start and only writes what is
// missing or outdated. Claude Code runs in WSL on Windows (default distro), else on this machine.
const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { addHooks } = require('./hook-settings');

// Session files and install.json; on Windows this is the Windows home, written to from WSL.
const BASE = path.join(os.homedir(), '.farmies');
const HOOK_SOURCE = path.join(__dirname, '..', 'hook', 'farmies-hook.sh');
// via sh, so the script needs no executable bit (files written over \\wsl.localhost may lack it)
const HOOK_CMD = 'sh "$HOME/.farmies/hook.sh"';

/** Path of a file in the environment Claude Code runs in (WSL distro or this machine). */
function hostPath(info, posixPath) {
  if (process.platform === 'win32' && info.distro) {
    return `\\\\wsl.localhost\\${info.distro}${posixPath.replace(/\//g, '\\')}`;
  }
  return posixPath;
}

/** C:\Users\x → /mnt/c/Users/x */
function toWslPath(winPath) {
  return winPath.replace(/^([A-Za-z]):/, (_, d) => `/mnt/${d.toLowerCase()}`).replace(/\\/g, '/');
}

function run(cmd, args, timeout = 30000) {
  return new Promise((resolve) => {
    execFile(cmd, args, { windowsHide: true, timeout }, (err, stdout) => resolve(err ? null : stdout));
  });
}

async function findTarget() {
  if (process.platform !== 'win32') return { distro: '', home: os.homedir() };
  const out = await run('wsl.exe', ['-e', 'sh', '-c', 'echo $WSL_DISTRO_NAME:$HOME']);
  const [distro, home] = (out || '').replace(/\0/g, '').trim().split(':');
  return distro && home ? { distro, home } : null;
}

function writeIfChanged(file, content) {
  if (fs.existsSync(file) && fs.readFileSync(file, 'utf8') === content) return;
  fs.writeFileSync(file, content);
  try {
    fs.chmodSync(file, 0o755);
  } catch {
    // not supported on every file system; the hook runs via sh anyway
  }
}

/** Home directory of the environment the hooks run in, as a path usable here (from install.json). */
function hookHome() {
  try {
    const info = JSON.parse(fs.readFileSync(path.join(BASE, 'install.json'), 'utf8'));
    return hostPath(info, info.home);
  } catch {
    return null;
  }
}

// Companion extension for the VS Code family (see extension/): installed into every editor found.
const EXT_ID = 'gustganz.farmies-terminal';
const EXT_VERSION = require('../extension/package.json').version;
const VSIX = path
  .join(__dirname, '..', 'extension', 'farmies-terminal.vsix')
  .replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);
// WSL: remote servers of the editors; macOS: local editors (extension dir, CLI)
const WSL_SERVERS = ['.cursor-server', '.vscode-server', '.vscode-server-insiders', '.windsurf-server'];
const MAC_EDITORS = [
  ['.cursor', '/Applications/Cursor.app/Contents/Resources/app/bin/cursor'],
  ['.vscode', '/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code'],
  ['.vscode-insiders', '/Applications/Visual Studio Code - Insiders.app/Contents/Resources/app/bin/code-insiders'],
  ['.windsurf', '/Applications/Windsurf.app/Contents/Resources/app/bin/windsurf'],
];

const hasExtension = (dir) => {
  try {
    return fs.readdirSync(dir).some((name) => name.startsWith(`${EXT_ID}-${EXT_VERSION}`));
  } catch {
    return false;
  }
};

/** Installs or updates the companion extension where it is missing. Returns the editors updated. */
async function ensureEditorExtension(target, home) {
  if (!fs.existsSync(VSIX)) return [];
  const done = [];
  if (process.platform === 'win32') {
    // the server CLI has to run inside WSL; the vsix is read from the Windows drive
    const script = path.join(home, '.farmies', 'install-extension.sh');
    writeIfChanged(
      script,
      '#!/bin/sh\n# Installs the Farmies companion extension into an editor server (written by the app).\n' +
        '# newest server: cli/servers/<build>/server/bin (current layout) or bin/<commit>/bin (older)\n' +
        'bin=$(ls -td "$HOME/$1"/cli/servers/*/server/bin/*-server "$HOME/$1"/bin/*/bin/*-server 2>/dev/null | head -n 1)\n' +
        '[ -n "$bin" ] && "$bin" --install-extension "$2" --force\n',
    );
    for (const server of WSL_SERVERS) {
      const extDir = path.join(home, server, 'extensions');
      if (!fs.existsSync(extDir) || hasExtension(extDir)) continue;
      const scriptInWsl = `${target.home}/.farmies/install-extension.sh`;
      if ((await run('wsl.exe', ['-d', target.distro, '-e', 'sh', scriptInWsl, server, toWslPath(VSIX)], 120000)) !== null) {
        done.push(server);
      }
    }
  } else {
    for (const [dir, cli] of MAC_EDITORS) {
      if (!fs.existsSync(cli) || hasExtension(path.join(os.homedir(), dir, 'extensions'))) continue;
      if ((await run(cli, ['--install-extension', VSIX, '--force'], 120000)) !== null) done.push(dir);
    }
  }
  return done;
}

/** Returns { ok, added, editors } or { ok: false, reason }. */
async function ensureHooks() {
  try {
    const target = await findTarget();
    if (!target) return { ok: false, reason: 'keine WSL-Distribution gefunden' };

    const home = hostPath(target, target.home);
    const hookDir = path.join(home, '.farmies');
    fs.mkdirSync(hookDir, { recursive: true });
    // a Windows checkout may have turned the line ends into CRLF, which sh cannot run
    writeIfChanged(path.join(hookDir, 'hook.sh'), fs.readFileSync(HOOK_SOURCE, 'utf8').replace(/\r\n/g, '\n'));

    const sessions = path.join(BASE, 'sessions');
    fs.mkdirSync(sessions, { recursive: true });
    const sessionsForHook = process.platform === 'win32' ? toWslPath(sessions) : sessions;
    writeIfChanged(path.join(hookDir, 'config'), `BUDDY_DIR='${sessionsForHook}'\n`);
    writeIfChanged(path.join(BASE, 'install.json'), `${JSON.stringify(target)}\n`);

    const added = addHooks(path.join(home, '.claude', 'settings.json'), HOOK_CMD);
    let editors = [];
    try {
      editors = await ensureEditorExtension(target, home);
    } catch {
      // without the extension the editor window is still focused, just not the terminal
    }
    return { ok: true, added, editors };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
}

module.exports = { ensureHooks, hookHome, hostPath, BASE };
