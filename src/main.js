const { app, BrowserWindow, Menu, Tray, dialog, ipcMain, nativeImage, net, screen } = require('electron');
const fs = require('fs');
const path = require('path');
const { Sessions, NEEDS_USER_STATES } = require('./sessions');
const Animals = require('./animals');
const { trayIcon } = require('./tray-icon');
const { focusSession } = require('./focus');
const autostart = require('./autostart');
const { uninstall } = require('./uninstall');
const { ensureHooks } = require('./hooks');
const { WtTabs } = require('./wt-tabs');
const { Updater } = require('./updater');

// The hen lives in a small transparent window that the renderer moves around (also across
// displays); it is big enough for the bubble and the hover panel above the hen.
const WIN_W = 360;
const WIN_H = 440;

// Walk sheets of the farm animals ("LPC style farm animals" by Daniel Eddeland, see assets/CREDITS.md)
const ANIMAL_DIR = path.join(__dirname, '..', 'assets', 'lpc');

let win = null;
let tray = null;
let sheets = null; // animal id → PNG bytes
let hookStatus = null; // result of ensureHooks() at start
const sessions = new Sessions();
const wtTabs = new WtTabs();
const updater = new Updater({ app, net, quit: () => app.quit() });
const settings = {};

const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');

function loadSettings() {
  try {
    Object.assign(settings, JSON.parse(fs.readFileSync(settingsFile(), 'utf8')));
  } catch {
    // first start or unreadable file: keep defaults
  }
}

function saveSettings() {
  try {
    fs.writeFileSync(settingsFile(), JSON.stringify(settings, null, 2));
  } catch {
    // not critical
  }
}

// Set FARMIES_DEBUG=1 to log window moves and errors to <userData>/debug.log (the start test,
// scripts/smoke.js, fails on lines starting with "error").
function debugLog(...args) {
  if (!process.env.FARMIES_DEBUG) return;
  fs.appendFileSync(path.join(app.getPath('userData'), 'debug.log'), `${args.join(' ')}\n`);
}
if (process.env.FARMIES_DEBUG) process.on('uncaughtException', (e) => debugLog('error main', e.stack || e));

function sendDisplays() {
  const displays = screen.getAllDisplays().map((d) => ({ id: d.id, bounds: d.bounds, workArea: d.workArea }));
  debugLog('displays', JSON.stringify(displays));
  // position: where the animal was before the last quit (update, restart), used once at start
  win?.webContents.send('displays', {
    displays,
    primary: screen.getPrimaryDisplay().id,
    win: [WIN_W, WIN_H],
    position: settings.position,
  });
}

function moveWindow(x, y) {
  if (!win) return;
  // setBounds keeps the size stable when moving between displays with different scaling
  win.setBounds({ x: Math.round(x), y: Math.round(y), width: WIN_W, height: WIN_H });
  debugLog('move', Math.round(x), Math.round(y), JSON.stringify(win.getBounds()));
}

function keepOnTop() {
  if (!win) return;
  win.setAlwaysOnTop(true, 'screen-saver');
}

function createWindow() {
  win = new BrowserWindow({
    show: false,
    transparent: true,
    frame: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: false,
    alwaysOnTop: true,
    backgroundColor: '#00000000',
    webPreferences: { preload: path.join(__dirname, 'preload.js') },
  });
  const { workArea } = screen.getPrimaryDisplay();
  moveWindow(workArea.x + workArea.width / 2 - WIN_W / 2, workArea.y + workArea.height - WIN_H);
  keepOnTop();
  // once only: without skipTransformProcessType every call hides the window and dock for a moment
  // (the app is a UI element already: LSUIElement, dock.hide)
  if (process.platform === 'darwin') {
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
  }
  // Click-through everywhere except where the renderer reports the buddy/bubble/panel.
  win.setIgnoreMouseEvents(true, { forward: true });
  if (process.env.FARMIES_DEBUG) {
    win.webContents.on('console-message', (e, level, message) => {
      // Electron passes the details as event properties (older versions as arguments)
      if ((e.level ?? level) === 'error' || level === 3) debugLog('error renderer', e.message ?? message);
    });
    win.webContents.on('render-process-gone', (_e, d) => debugLog('error renderer gone', d.reason));
    win.webContents.on('preload-error', (_e, file, err) => debugLog('error preload', file, err.stack || err));
  }
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.once('ready-to-show', () => win.showInactive());
}

const currentAnimal = () => (Animals.ANIMALS[settings.animal] ? settings.animal : Animals.DEFAULT_ANIMAL);

// Size setting: screen pixels per sprite pixel
const SIZES = [
  [2, 'Klein'],
  [2.5, 'Mittel'],
  [3, 'Groß'],
  [4, 'Riesig'],
];
const DEFAULT_SCALE = 2.5;
const currentScale = () => (SIZES.some(([s]) => s === settings.scale) ? settings.scale : DEFAULT_SCALE);

function setAnimal(id) {
  settings.animal = id;
  saveSettings();
  win?.webContents.send('animal', id);
  updateTray();
}

function setScale(value) {
  settings.scale = value;
  saveSettings();
  win?.webContents.send('scale', value);
  updateTray();
}

// macOS: the app never becomes active by itself (menu bar app), so its dialogs would open behind
// other windows
function showMessageBox(options) {
  if (process.platform === 'darwin') app.focus({ steal: true });
  return dialog.showMessageBox(options);
}

function showAbout() {
  showMessageBox({
    type: 'info',
    title: 'Über Farmies',
    message: `Farmies ${app.getVersion()}`,
    detail:
      'Zeigt dir, wenn eine Claude-Code-Session dich braucht.\n\n' +
      'Tiere: „LPC style farm animals“ von Daniel Eddeland, CC-BY 3.0\n' +
      'https://opengameart.org/content/lpc-style-farm-animals\n\n' +
      'Schriften: Pixelify Sans und Silkscreen, SIL Open Font License',
  });
}

function updateTray() {
  const pending = pendingCount();
  const hookInfo = hookStatus && !hookStatus.ok ? ` · Hooks: ${hookStatus.reason}` : '';
  tray.setToolTip((pending ? `Farmies – ${pending} wartet auf dich` : 'Farmies') + hookInfo);
  tray.setContextMenu(buildMenu(pending));
}

/** The menu of the tray icon, also shown on a right click on the animal. */
function buildMenu(pending) {
  const update = updater.update;
  // Items are left out rather than hidden: Windows still draws hidden items as empty space.
  const updateItems = update
    ? [
        {
          label:
            update.status === 'downloading'
              ? `Update auf ${update.version} wird geladen … ${update.progress} %`
              : `Update auf ${update.version} installieren`,
          enabled: update.status !== 'downloading',
          click: () => updater.install(),
        },
      ]
    : [];
  return Menu.buildFromTemplate([
    // heading: name and version
    { label: `Farmies ${app.getVersion()}`, enabled: false },
    ...updateItems,
    { label: 'Nach Updates suchen', click: checkForUpdates },
    { type: 'separator' },
    {
      label: 'Tier',
      submenu: Object.entries(Animals.ANIMALS).map(([id, a]) => ({
        label: a.label,
        type: 'radio',
        checked: currentAnimal() === id,
        click: () => setAnimal(id),
      })),
    },
    {
      label: 'Größe',
      submenu: SIZES.map(([value, label]) => ({
        label,
        type: 'radio',
        checked: currentScale() === value,
        click: () => setScale(value),
      })),
    },
    { type: 'separator' },
    { label: 'Alle als gesehen markieren', enabled: pending > 0, click: () => sessions.dismissAll() },
    {
      label: 'Ausblenden',
      type: 'checkbox',
      checked: !win?.isVisible(),
      click: (item) => {
        if (item.checked) win.hide();
        else win.showInactive();
      },
    },
    { type: 'separator' },
    ...(autostart.supported()
      ? [
          {
            label: 'Beim Login starten',
            type: 'checkbox',
            checked: autostart.isEnabled(),
            click: (item) => {
              settings.autostart = item.checked;
              saveSettings();
              autostart.setEnabled(item.checked);
            },
          },
          { type: 'separator' },
        ]
      : []),
    { label: 'Über Farmies', click: showAbout },
    { label: 'Deinstallieren…', click: confirmUninstall },
    { label: 'Beenden', click: () => app.quit() },
  ]);
}

const pendingCount = () => sessions.list.filter((s) => NEEDS_USER_STATES.includes(s.state)).length;

// "Nach Updates suchen" in the menu: like the regular check, but always with an answer
async function checkForUpdates() {
  let update;
  try {
    update = await updater.check();
  } catch (e) {
    showMessageBox({ type: 'warning', title: 'Farmies', message: 'Update-Prüfung fehlgeschlagen', detail: e.message });
    return;
  }
  if (!update) {
    showMessageBox({ type: 'info', title: 'Farmies', message: `Farmies ${app.getVersion()} ist aktuell.` });
    return;
  }
  const { response } = await showMessageBox({
    type: 'info',
    title: 'Farmies',
    message: `Farmies ${update.version} ist da (du hast ${app.getVersion()}).`,
    detail: update.installable
      ? 'Installieren lädt das Update, tauscht die App aus und startet sie neu.'
      : 'Öffnet die Download-Seite.',
    buttons: ['Installieren', 'Später'],
    defaultId: 0,
    cancelId: 1,
  });
  if (response === 0) updater.install();
}

async function confirmUninstall() {
  const { response } = await showMessageBox({
    type: 'question',
    title: 'Farmies deinstallieren',
    message: 'Farmies deinstallieren?',
    detail:
      'Entfernt den Autostart, die Farmies-Hooks aus ~/.claude/settings.json (Backup wird angelegt) ' +
      'und ~/.farmies (Hook-Skript, Statusdateien). Die App selbst bleibt erhalten. ' +
      'Danach wird die App beendet. Startest du sie wieder, richtet sie Hooks und Autostart neu ein.',
    buttons: ['Deinstallieren', 'Abbrechen'],
    defaultId: 1,
    cancelId: 1,
  });
  if (response !== 0) return;

  const problems = [];
  try {
    if (autostart.supported()) autostart.setEnabled(false);
  } catch (e) {
    problems.push(`Autostart: ${e.message}`);
  }
  let result = null;
  try {
    result = uninstall();
  } catch (e) {
    problems.push(`Hooks: ${e.message}`);
  }

  const lines = [];
  if (result) lines.push(`${result.removedHooks} Hook(s) entfernt aus ${result.settingsFile}.`);
  lines.push(...problems);
  lines.push('Laufende Claude-Code-Sessions neu starten, damit die Hooks nicht mehr geladen sind.');
  await showMessageBox({
    type: problems.length ? 'warning' : 'info',
    title: 'Farmies',
    message: problems.length ? 'Deinstallation mit Problemen' : 'Farmies wurde deinstalliert',
    detail: lines.join('\n'),
  });
  app.quit();
}

// Stable app id, used e.g. as the name of the Windows autostart registry entry.
app.setAppUserModelId('com.gustganz.farmies');

// The newest start wins: a running instance exits when another one starts (so updated code is
// picked up), and the new instance waits until the old one has released the lock.
app.on('second-instance', () => app.exit(0));

async function acquireLock() {
  for (let i = 0; i < 40; i++) {
    if (app.requestSingleInstanceLock()) return true;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return false;
}

acquireLock().then((locked) => {
  if (!locked) {
    app.quit();
    return;
  }

  app.whenReady().then(() => {
    if (process.platform === 'darwin') app.dock.hide();
    try {
      sheets = Object.fromEntries(
        Object.entries(Animals.ANIMALS).map(([id, a]) => [id, fs.readFileSync(path.join(ANIMAL_DIR, a.sheet))]),
      );
    } catch (e) {
      dialog.showErrorBox('Farmies', `Grafiken fehlen in ${ANIMAL_DIR}:\n${e.message}`);
      app.quit();
      return;
    }

    loadSettings();
    if (autostart.supported()) {
      // On by default; re-applied on every start so a moved app path stays correct.
      if (settings.autostart === undefined) {
        settings.autostart = true;
        saveSettings();
      }
      autostart.setEnabled(settings.autostart);
    }

    createWindow();
    tray = new Tray(trayIcon(nativeImage));
    updateTray();

    sessions.on('change', (list) => {
      win?.webContents.send('sessions', list);
      updateTray();
    });
    sessions.start();
    wtTabs.start(); // Windows Terminal: which tab belongs to which session

    updater.on('change', (u) => {
      win?.webContents.send('update', u);
      updateTray();
    });
    updater.start();

    // set up / repair the Claude Code hooks on every start
    ensureHooks().then((status) => {
      hookStatus = status;
      debugLog('hooks', JSON.stringify(status));
      updateTray();
    });

    ipcMain.on('ready', () => {
      sendDisplays();
      const bytes = Object.fromEntries(Object.entries(sheets).map(([id, b]) => [id, new Uint8Array(b)]));
      win.webContents.send('sprites', { sheets: bytes, animal: currentAnimal(), scale: currentScale() });
      win.webContents.send('sessions', sessions.list);
      win.webContents.send('update', updater.update);
      if (process.env.FARMIES_DEBUG) {
        // snapshot of the rendered page (with the hover panel open) for checking the look
        setTimeout(() => win.webContents.send('debug-panel'), 3000);
        setTimeout(async () => {
          const img = await win.webContents.capturePage();
          fs.writeFileSync(path.join(app.getPath('userData'), 'capture.png'), img.toPNG());
        }, 4000);
      }
    });
    ipcMain.on('interactive', (_e, on) => win.setIgnoreMouseEvents(!on, { forward: true }));
    ipcMain.on('move-window', (_e, x, y) => moveWindow(x, y));
    ipcMain.on('focus-session', (_e, id) => {
      const s = sessions.get(id);
      if (!s) return;
      sessions.dismiss(id);
      focusSession(s, wtTabs.tabFor(s.id));
    });
    ipcMain.on('dismiss-all', () => sessions.dismissAll());
    ipcMain.on('install-update', () => updater.install());
    ipcMain.on('show-menu', () => buildMenu(pendingCount()).popup({ window: win }));
    ipcMain.on('position', (_e, position) => {
      settings.position = position;
      saveSettings();
    });

    screen.on('display-metrics-changed', sendDisplays);
    screen.on('display-added', sendDisplays);
    screen.on('display-removed', sendDisplays);
    // Other topmost windows (taskbar, popups) can push us back; reclaim the top regularly.
    setInterval(keepOnTop, 5000);
  });

  app.on('window-all-closed', () => app.quit());
  app.on('will-quit', () => wtTabs.stop());
});
