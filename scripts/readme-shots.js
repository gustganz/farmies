#!/usr/bin/env node
// Renders the README pictures from the real renderer (src/renderer) with invented sessions, so no
// real project or customer name ever ends up in a picture:
//   node scripts/readme-shots.js [out-dir]     (default docs/img)
// Needs Playwright with Chromium (not a dependency of the app: `npx playwright` or a global install)
// and ffmpeg for the animated hero GIF.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { chromium } = require('playwright');
const Animals = require('../src/animals');

const ROOT = path.join(__dirname, '..');
const OUT = path.resolve(process.argv[2] || path.join(ROOT, 'docs', 'img'));
const RENDERER = `file://${path.join(ROOT, 'src', 'renderer', 'index.html')}`;
const MONTH = 5; // June: the greenest meadow
const BACKDROP = 'linear-gradient(180deg, #8fb8de 0%, #b9d4ea 55%, #dfe9f1 100%)';

const sheets = Object.fromEntries(
  Object.entries(Animals.ANIMALS).map(([id, a]) => [id, fs.readFileSync(path.join(ROOT, 'assets', 'lpc', a.sheet)).toString('base64')]),
);

// Invented sessions only. Fields as src/sessions.js sends them to the renderer.
const min = 60 * 1000;
const S = (id, project, state, ago, term, task, branch, step, detail = '') => ({
  id, project, state, ts: Date.now() - ago * min, term, task, title: '', branch, step, detail,
});
const HERD = [
  S('1', 'wetter-app', 'error', 2, 'terminal', 'Regenradar auf der Startseite einbauen', 'radar', '', 'API-Limit erreicht'),
  S('2', 'rezeptbuch', 'attention', 0, 'vscode', 'Zutatenliste als PDF exportieren', 'pdf-export', '', 'npm run build'),
  S('3', 'gartenplaner', 'question', 5, 'terminal', 'Beete im Plan verschiebbar machen', 'drag-beete', '', 'Raster 10 oder 20 cm?'),
  S('4', 'pixel-blog', 'done', 12, 'cursor', 'Artikel über Pixel-Art korrigieren', 'main', '', '12 Tippfehler korrigiert.'),
  S('5', 'lesezeichen', 'working', 0, 'terminal', 'Suche nach Tags filtern', 'tag-suche', 'Edit · src/suche.js'),
  S('6', 'fotoalbum', 'working', 1, 'terminal', 'Bilder nach Datum gruppieren', 'gruppen', 'Bash · npm test'),
  S('7', 'dotfiles', 'idle', 120, 'terminal', 'zsh-Prompt aufräumen', 'main', ''),
  S('8', 'notizen', 'idle', 180, 'vscode', 'Wochennotizen zusammenfassen', 'main', ''),
];

// buddyApi stub: what src/preload.js offers, fed with the data above instead of IPC
function stub({ sessions, animal, scale, width, height, month }) {
  // fixed "randomness": the animal walks and turns around every few seconds
  Math.random = () => 0.3;
  const bytes = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const getMonth = Date.prototype.getMonth;
  Date.prototype.getMonth = function () {
    return month ?? getMonth.call(this);
  };
  const cbs = {};
  const on = (name) => (cb) => (cbs[name] = cb);
  window.buddyApi = {
    ready: () =>
      setTimeout(() => {
        const bounds = { x: 0, y: 0, width, height };
        cbs.displays({ displays: [{ id: 1, bounds, workArea: bounds }], primary: 1, win: [width, height], position: null });
        cbs.sprites({ sheets: Object.fromEntries(Object.entries(window.SHEETS).map(([k, v]) => [k, bytes(v)])), animal, scale });
        cbs.sessions(sessions);
        cbs.update(null);
      }),
    setInteractive() {},
    focusSession() {},
    dismissAll() {},
    installUpdate() {},
    showMenu() {},
    savePosition() {},
    moveWindow() {},
    onUpdate: on('update'),
    onSessions: on('sessions'),
    onSprites: on('sprites'),
    onAnimal: on('animal'),
    onScale: on('scale'),
    onDisplays: on('displays'),
    onDebugPanel: on('debugPanel'),
  };
  window.debugPanel = () => cbs.debugPanel();
}

async function scene(browser, opts) {
  const page = await browser.newPage({ viewport: { width: opts.width, height: opts.height }, deviceScaleFactor: 1 });
  await page.addInitScript(`window.SHEETS = ${JSON.stringify(sheets)};`);
  await page.addInitScript(stub, { month: MONTH, scale: 2.5, animal: 'chicken', ...opts });
  await page.goto(RENDERER);
  await page.addStyleTag({ content: `html, body { background: ${BACKDROP}; }` });
  await page.waitForTimeout(1500);
  return page;
}

// Background of the hero GIF: a pixel landscape (own drawing) with the barn of the tray icon,
// hazy so it reads as far away. Runs in the page; sizes in canvas pixels (PX screen px each).
function landscape({ barn, colors, w, h, px }) {
  const c = document.createElement('canvas');
  c.id = 'landscape';
  c.width = w;
  c.height = h;
  c.style.cssText = `position: absolute; left: 0; bottom: 0; width: ${w * px}px; height: ${h * px}px; image-rendering: pixelated;`;
  const g = c.getContext('2d');
  const put = (x, y, col) => {
    g.fillStyle = col;
    g.fillRect(Math.round(x), Math.round(y), 1, 1);
  };
  const rect = (x, y, rw, rh, col) => {
    g.fillStyle = col;
    g.fillRect(x, y, rw, rh);
  };
  const disc = (cx, cy, r, col) => {
    for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) if (x * x + y * y <= r * r + r * 0.6) put(cx + x, cy + y, col);
  };
  const haze = (rgb, t) => `rgb(${rgb.map((v, i) => Math.round(v + ([196, 219, 238][i] - v) * t)).join(',')})`;

  // sky in pixel bands, lighter towards the horizon
  const SKY = ['#7fb0de', '#88b6e0', '#92bde3', '#9dc4e6', '#a9cbe9', '#b5d2ec', '#c0d9ee'];
  SKY.forEach((col, i) => rect(0, Math.floor((i * h) / SKY.length), w, Math.ceil(h / SKY.length), col));

  // sun with a soft ring
  disc(122, 14, 9, '#fbe9a6');
  disc(122, 14, 7, '#f8d64e');
  disc(121, 13, 4, '#fde98a');

  // clouds: a few overlapping discs with a flat, slightly shaded bottom
  const cloud = (x, y, s) => {
    [[0, 0, 4], [5, -2, 5], [11, 0, 4], [15, 1, 3]].forEach(([dx, dy, r]) => disc(x + dx * s, y + dy * s, r * s, '#ffffff'));
    rect(x - 4 * s, y + 2 * s, 23 * s, 2 * s, '#e3eef7');
  };
  cloud(22, 12, 1);
  cloud(178, 10, 1);
  cloud(262, 20, 0.7);

  // far hills
  const hill = (base, amp, len, phase, col) => {
    for (let x = 0; x < w; x++) {
      const top = Math.round(base - amp * Math.sin((x / len) * Math.PI * 2 + phase));
      rect(x, top, 1, h - top, col);
    }
  };
  hill(40, 4, 170, 0.6, haze([118, 168, 92], 0.45));
  hill(46, 3, 120, 2.2, haze([128, 176, 84], 0.3));

  // fields: patchwork bands with furrows
  const FIELDS = [
    [0, 70, [214, 190, 98]], [70, 60, [150, 186, 86]], [130, 50, [196, 166, 92]], [180, 64, [136, 176, 82]], [244, 56, [218, 198, 112]],
  ];
  for (const [x0, fw, rgb] of FIELDS) {
    rect(x0, 51, fw, h - 51, haze(rgb, 0.2));
    for (let y = 53; y < h; y += 2) rect(x0, y, fw, 1, haze(rgb.map((v) => v * 0.86), 0.2)); // furrows
  }
  rect(0, 50, w, 1, haze([110, 150, 80], 0.3));

  // trees: round crowns on short trunks
  const tree = (x, base, r, t) => {
    rect(x - 1, base - r - 2, 2, r + 2, haze([110, 78, 48], t));
    disc(x, base - r - 3, r, haze([74, 132, 58], t));
    disc(x - 1, base - r - 4, r - 2, haze([96, 156, 70], t));
  };
  tree(14, 56, 6, 0.35);
  tree(96, 57, 7, 0.3);
  tree(108, 59, 5, 0.3);
  tree(172, 53, 5, 0.45);
  tree(286, 56, 7, 0.35);

  // the barn, bigger and hazy
  const BS = 3;
  const bx = 36;
  const by = 64 - barn.length * BS;
  barn.forEach((row, y) => [...row].forEach((ch, x) => colors[ch] && rect(bx + x * BS, by + y * BS, BS, BS, haze(colors[ch], 0.35))));

  // fence in front of it all
  const WOOD = '#c99a62';
  const DARK = '#8a6438';
  rect(0, h - 9, w, 1, WOOD);
  rect(0, h - 8, w, 1, DARK);
  rect(0, h - 5, w, 1, WOOD);
  rect(0, h - 4, w, 1, DARK);
  for (let x = 3; x < w; x += 14) {
    rect(x, h - 12, 2, 12, WOOD);
    rect(x + 1, h - 12, 1, 12, DARK);
    put(x, h - 13, WOOD);
  }
  document.body.prepend(c);
}

// Hero GIF: the chicken walks away from the barn and back, so the last frame leads into the first.
// Time is driven by Playwright's fake clock: one loop = LOOP_MS, a whole number of walk cycles
// (4 frames x 140 ms) and hops (1600 ms); half of it each way, so it ends where it started.
const LOOP_MS = 11200;
const FRAME_MS = 80;
async function hero(browser) {
  const W = 600;
  const H = 160;
  const GROUND = 14; // grass strip below the animal
  const sessions = [HERD[0], HERD[2], HERD[3], HERD[4]];
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  const start = new Date(2026, MONTH, 15, 10).getTime();
  await page.clock.install({ time: start });
  await page.clock.pauseAt(start + 100); // time only moves with runFor
  await page.addInitScript(`window.SHEETS = ${JSON.stringify(sheets)};`);
  await page.addInitScript(stub, { month: MONTH, scale: 3, animal: 'chicken', sessions, width: W, height: H - GROUND });
  await page.goto(RENDERER);
  await page.addStyleTag({
    content: `html { background: linear-gradient(180deg, #4f8a35 0 3px, #6aa443 3px 100%); }
      body { position: relative; height: calc(100% - ${GROUND}px); background: transparent; }`,
  });
  const { BARN, COLORS } = require('../src/tray-icon');
  await page.evaluate(landscape, { barn: BARN, colors: COLORS, w: W / 2, h: (H - GROUND) / 2, px: 2 });
  for (let i = 0; i < 40 && !(await page.evaluate(() => typeof animal !== 'undefined' && !!animal)); i++) {
    await page.clock.runFor(50);
    await page.waitForTimeout(50);
  }
  // walk, turning around every half loop (instead of the random choice of src/renderer)
  await page.evaluate((half) => {
    window.chooseMode = (now) => {
      hen.mode = 'walk';
      hen.dir *= -1;
      hen.until = now + half;
    };
  }, LOOP_MS / 2);
  // past the first sit; start the loop exactly at a turn
  await page.clock.runFor(1500);
  const turn = await page.evaluate(() => hen.until - performance.now());
  await page.clock.runFor(Math.ceil(turn) + 1);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'farmies-hero-'));
  const frames = LOOP_MS / FRAME_MS;
  for (let i = 0; i < frames; i++) {
    await page.screenshot({ path: path.join(dir, `f${String(i).padStart(3, '0')}.png`), animations: 'disabled' });
    await page.clock.runFor(FRAME_MS);
  }
  await page.close();
  const gif = path.join(OUT, 'hero.gif');
  execFileSync('ffmpeg', [
    '-y', '-loglevel', 'error', '-framerate', String(1000 / FRAME_MS), '-i', path.join(dir, 'f%03d.png'),
    '-vf', 'split[a][b];[a]palettegen=max_colors=64:stats_mode=full[p];[b][p]paletteuse=dither=none', '-loop', '0', gif,
  ]);
  fs.rmSync(dir, { recursive: true });
  console.log(gif);
}

async function panel(browser) {
  const page = await scene(browser, { sessions: HERD, width: 420, height: 600 });
  const clip = { x: 0, y: 160, width: 420, height: 440 };
  await page.evaluate(() => window.debugPanel());
  await page.waitForTimeout(500);
  await page.hover('.tag:has-text("gartenplaner")');
  await page.waitForTimeout(500);
  const file = path.join(OUT, 'panel.png');
  await page.screenshot({ path: file, clip });
  await page.close();
  console.log(file);
}

// all animals in a row, and the four bubbles with what they mean
async function overview(browser) {
  const page = await browser.newPage({ viewport: { width: 760, height: 200 }, deviceScaleFactor: 1 });
  const html = path.join(os.tmpdir(), `farmies-overview-${process.pid}.html`);
  fs.writeFileSync(html, `<!doctype html><html><head><meta charset="utf-8"><base href="${RENDERER}">
    <link rel="stylesheet" href="style.css">
    <style>
      html, body { background: ${BACKDROP}; overflow: visible; height: auto; }
      .row { display: flex; justify-content: space-around; align-items: flex-end; padding: 18px 12px 10px; }
      .cell { display: flex; flex-direction: column; align-items: center; gap: 8px; color: #2b2118; font: 700 16px 'Pixelify Sans'; }
      canvas { image-rendering: pixelated; }
    </style></head><body><div class="row" id="row"></div>
    <script src="../poses.js"></script><script src="../animals.js"></script><script src="../bubbles.js"></script></body></html>`);
  await page.goto(`file://${html}`);
  fs.rmSync(html);
  await page.addScriptTag({ content: `window.SHEETS = ${JSON.stringify(sheets)};` });
  const draw = async (what) =>
    page.evaluate(async (what) => {
      const row = document.getElementById('row');
      row.replaceChildren();
      const canvasOf = (frame, s) => {
        const c = document.createElement('canvas');
        c.width = frame.w;
        c.height = frame.h;
        c.getContext('2d').putImageData(new ImageData(frame.data, frame.w, frame.h), 0, 0);
        c.style.width = `${frame.w * s}px`;
        c.style.height = `${frame.h * s}px`;
        return c;
      };
      const cell = (node, label) => {
        const d = document.createElement('div');
        d.className = 'cell';
        const l = document.createElement('div');
        l.textContent = label;
        d.append(node, l);
        row.append(d);
      };
      if (what === 'animals') {
        const names = { chicken: 'Huhn', cow: 'Kuh', pig: 'Schwein', sheep: 'Schaf', llama: 'Lama' };
        for (const id of Object.keys(Animals.ANIMALS)) {
          const bytes = Uint8Array.from(atob(window.SHEETS[id]), (c) => c.charCodeAt(0));
          const bmp = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
          const oc = new OffscreenCanvas(bmp.width, bmp.height);
          oc.getContext('2d').drawImage(bmp, 0, 0);
          const sheet = { w: bmp.width, h: bmp.height, data: oc.getContext('2d').getImageData(0, 0, bmp.width, bmp.height).data };
          const a = Animals.build(id, sheet);
          cell(canvasOf(a.frames.right.idle, 3 * a.size), names[id]);
        }
      } else {
        const labels = { error: 'Fehler', attention: 'Freigabe nötig', question: 'Frage an dich', done: 'Fertig' };
        for (const state of ['error', 'attention', 'question', 'done']) {
          const g = Bubbles.GLYPHS[state];
          const b = document.createElement('div');
          b.className = `bubble state-${state}`;
          b.style.cssText = 'position: relative; transform: scale(2); margin: 18px 0 14px; animation: none;';
          const c = document.createElement('canvas');
          c.className = 'glyph';
          c.width = g.rows[0].length;
          c.height = g.rows.length;
          const x = c.getContext('2d');
          x.fillStyle = g.color;
          g.rows.forEach((r, y) => [...r].forEach((ch, i) => ch === '#' && x.fillRect(i, y, 1, 1)));
          c.style.width = `${c.width * Bubbles.PIXEL}px`;
          c.style.height = `${c.height * Bubbles.PIXEL}px`;
          b.append(c);
          cell(b, labels[state]);
        }
      }
    }, what);
  for (const what of ['animals', 'states']) {
    await draw(what);
    await page.waitForTimeout(300);
    const file = path.join(OUT, `${what === 'animals' ? 'tiere' : 'blasen'}.png`);
    await page.locator('#row').screenshot({ path: file });
    console.log(file);
  }
  await page.close();
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  try {
    await hero(browser);
    await panel(browser);
    await overview(browser);
  } finally {
    await browser.close();
  }
})();
