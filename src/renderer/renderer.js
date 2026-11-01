/* global Animals, Bubbles, buddyApi */
'use strict';

let scale = 2.5; // screen pixels per sprite pixel (size setting, see setScale)
const WALK_SPEED = 28; // px per second
const GLIDE_SPEED = 70; // px per second downwards with spread wings
const GRAVITY = 2000; // px per second² for drops
const GLIDE_MIN_HEIGHT = 150; // dropped from higher up than this: animals that can fly glide
const GLIDE_FALL_LAST = 60; // the last px above the ground are a normal fall again
const DRAG_THRESHOLD = 5; // px of movement before a press becomes a drag
const HOP_HEIGHT = 2; // sprite px the animal hops while a session waits for you
const PANEL_GAP = 36; // space between animal and panel
const FRAME_MS = { walk: 140, sleep: 1000, flap: 100, kick: 120, fall: 70, glide: 400 };
// Swinging while carried: a damped spring towards a tilt against the pointer's movement.
const SWING = { perSpeed: 0.04, max: 35, stiffness: 60, damping: 7 };

const buddyEl = document.getElementById('buddy');
const bubblesEl = document.getElementById('bubbles');
let bubbleEls = [];
const panelEl = document.getElementById('panel');
const zzzEl = document.getElementById('zzz');
const ctx = buddyEl.getContext('2d');
buddyEl.width = 32;
buddyEl.height = 32;

let animal = null; // Animals.build result, frames as canvases
let sheets = {}; // animal id → PNG bytes of its walk sheet
let sessions = [];
let appUpdate = null; // available Farmies update (see src/updater.js)
let displays = [];
let primaryId = null;
let winSize = [320, 320];
let lastWin = [null, null];
let hover = false;
let hideTimer = null;
let interactive = false;
let drag = null;

// Animal position in screen coordinates: x = left edge, y = feet (bottom edge).
// Modes: walk, sit, alert, sleep (on the ground) · held, fall, glide (in the air).
const hen = { x: 0, y: 0, vx: 0, vy: 0, dir: -1, mode: 'sit', until: 0, hop: 0, displayId: null, placed: false };
// swing (degrees) while carried and right after; pointer speed in px/s
const swing = { angle: 0, speed: 0, pointerSpeed: 0 };

// screen px per sprite px: the size setting times the animal's size (large animals are drawn
// with more detail)
const px = () => scale * (animal ? animal.size : 1);
const henW = () => buddyEl.width * px();
const henH = () => buddyEl.height * px();
const clamp = (v, min, max) => Math.max(min, Math.min(v, max));
const inAir = () => ['held', 'fall', 'glide'].includes(hen.mode);

// --- sprites -----------------------------------------------------------------------------------

async function decodePng(bytes) {
  const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const c = canvas.getContext('2d');
  c.drawImage(bitmap, 0, 0);
  bitmap.close();
  return { w: canvas.width, h: canvas.height, data: c.getImageData(0, 0, canvas.width, canvas.height).data };
}

function toCanvas(frame) {
  const canvas = document.createElement('canvas');
  canvas.width = frame.w;
  canvas.height = frame.h;
  canvas.getContext('2d').putImageData(new ImageData(frame.data, frame.w, frame.h), 0, 0);
  return canvas;
}

async function setAnimal(id) {
  if (!sheets[id]) id = Animals.DEFAULT_ANIMAL;
  const built = Animals.build(id, await decodePng(sheets[id]));
  const canvases = (v) => (Array.isArray(v) ? v.map(toCanvas) : toCanvas(v));
  const side = (poses) => Object.fromEntries(Object.entries(poses).map(([k, v]) => [k, canvases(v)]));
  animal = {
    ...built,
    frames: {
      left: side(built.frames.left),
      right: side(built.frames.right),
      front: toCanvas(built.frames.front),
      held: built.frames.held.map(toCanvas),
    },
  };
  buddyEl.width = built.w;
  buddyEl.height = built.h;
  setScale(scale);
}

/** Size setting: screen pixels per sprite pixel. */
function setScale(value) {
  scale = value;
  buddyEl.style.width = `${henW()}px`;
  buddyEl.style.height = `${henH()}px`;
}

function setSprites(data) {
  sheets = data.sheets;
  scale = data.scale || scale;
  setAnimal(data.animal);
}

// --- displays ----------------------------------------------------------------------------------

function displayAt(px, py) {
  const inside = displays.find(
    (d) => px >= d.bounds.x && px < d.bounds.x + d.bounds.width && py >= d.bounds.y && py < d.bounds.y + d.bounds.height,
  );
  if (inside) return inside;
  let best = displays[0];
  let bestDist = Infinity;
  for (const d of displays) {
    const dx = Math.max(d.bounds.x - px, 0, px - (d.bounds.x + d.bounds.width));
    const dy = Math.max(d.bounds.y - py, 0, py - (d.bounds.y + d.bounds.height));
    if (dx * dx + dy * dy < bestDist) {
      bestDist = dx * dx + dy * dy;
      best = d;
    }
  }
  return best;
}

const currentDisplay = () =>
  displays.find((d) => d.id === hen.displayId) || displayAt(hen.x + henW() / 2, hen.y - henH() / 2);
const groundOf = (d) => d.workArea.y + d.workArea.height;
const minX = (d) => d.workArea.x;
const maxX = (d) => d.workArea.x + d.workArea.width - henW();

function setDisplays(info) {
  displays = info.displays;
  primaryId = info.primary;
  winSize = info.win;
  if (!hen.placed) {
    // back where it was before the last quit, if that display is still there
    const saved = info.position;
    const d = displays.find((x) => x.id === saved?.displayId) || displays.find((x) => x.id === primaryId) || displays[0];
    hen.x = d.id === saved?.displayId ? saved.x : d.workArea.x + d.workArea.width / 2 - henW() / 2;
    if (saved?.dir) hen.dir = saved.dir;
    hen.placed = true;
    land(d);
  } else if (!inAir()) {
    land(currentDisplay()); // display removed or resized: back onto a ground
  }
}

// remember where the animal is (on the ground), so it is there again after a restart or update
let savedPos = '';
function savePosition() {
  if (!hen.placed || inAir()) return;
  const pos = { displayId: hen.displayId, x: Math.round(hen.x), dir: hen.dir };
  if (JSON.stringify(pos) === savedPos) return;
  savedPos = JSON.stringify(pos);
  buddyApi.savePosition(pos);
}
setInterval(savePosition, 10000);

function land(d) {
  hen.displayId = d.id;
  hen.y = groundOf(d);
  hen.x = clamp(hen.x, minX(d), maxX(d));
  hen.vx = 0;
  hen.vy = 0;
  hen.mode = 'sit';
  hen.until = performance.now() + 1200;
}

// --- behaviour ---------------------------------------------------------------------------------

// States in which a session waits for the user, most urgent first.
const URGENCY = ['error', 'attention', 'question', 'done'];
const LABELS = {
  error: 'Abgebrochen – Fehler',
  attention: 'Freigabe nötig',
  question: 'Frage an dich',
  done: 'Fertig',
  working: 'Arbeitet …',
  idle: 'Bereit',
};
const pending = () =>
  sessions.filter((s) => URGENCY.includes(s.state)).sort((a, b) => URGENCY.indexOf(a.state) - URGENCY.indexOf(b.state));
const busy = () => sessions.some((s) => s.state === 'working');
const sleeping = () => !pending().length && !busy();

function chooseMode(now) {
  if (Math.random() < 0.6) {
    hen.mode = 'walk';
    if (Math.random() < 0.4) hen.dir *= -1;
  } else {
    hen.mode = 'sit';
  }
  hen.until = now + 2000 + Math.random() * 5000;
}

function drop() {
  const d = displayAt(hen.x + henW() / 2, hen.y - henH() / 2);
  hen.displayId = d.id;
  hen.x = clamp(hen.x, minX(d), maxX(d));
  const height = groundOf(d) - hen.y;
  if (height <= 4) {
    land(d);
  } else if (height > GLIDE_MIN_HEIGHT && animal.canFly) {
    hen.mode = 'glide';
    hen.vy = GLIDE_SPEED;
    hen.vx = hen.dir * 25;
  } else {
    hen.mode = 'fall';
    hen.vy = 0;
  }
}

function updateSwing(dt) {
  const target = hen.mode === 'held' ? clamp(-swing.pointerSpeed * SWING.perSpeed, -SWING.max, SWING.max) : 0;
  swing.speed += ((target - swing.angle) * SWING.stiffness - swing.speed * SWING.damping) * dt;
  swing.angle += swing.speed * dt;
  swing.pointerSpeed *= Math.exp(-dt * 8); // no pointer moves: the push fades
  if (hen.mode !== 'held' && !inAir()) swing.angle = swing.speed = 0;
}

function update(now, dt) {
  const d = currentDisplay();
  if (!d) return;
  updateSwing(dt);

  if (hen.mode === 'held') return; // position follows the pointer
  if (hen.mode === 'fall' || hen.mode === 'glide') {
    // the last bit after gliding is a normal (faster) fall
    if (hen.mode === 'glide' && groundOf(d) - hen.y < GLIDE_FALL_LAST) hen.mode = 'fall';
    if (hen.mode === 'fall') hen.vy += GRAVITY * dt;
    hen.y += hen.vy * dt;
    hen.x = clamp(hen.x + hen.vx * dt, minX(d), maxX(d));
    if (hen.y >= groundOf(d)) land(d);
    return;
  }

  // Something waits for you: if no other session is busy, stand and look at you; otherwise keep
  // walking about (hopping, with the bubbles). Nothing going on at all: sleep.
  const waiting = pending().length > 0;
  if (!hover) {
    if (waiting && !busy()) hen.mode = 'alert';
    else if (!waiting && sleeping()) hen.mode = 'sleep';
    else if (hen.mode === 'alert' || hen.mode === 'sleep' || now > hen.until) chooseMode(now);
  }

  hen.hop = 0;
  if (hover) return; // stand still so the user can click
  if (hen.mode === 'walk') {
    hen.x += hen.dir * WALK_SPEED * dt;
    if (hen.x <= minX(d)) hen.dir = 1;
    if (hen.x >= maxX(d)) hen.dir = -1;
    hen.x = clamp(hen.x, minX(d), maxX(d));
  }
  if (waiting && hen.mode !== 'sleep') {
    const phase = (now % 1600) / 1600;
    if (phase < 0.25) hen.hop = Math.round(Math.sin((phase / 0.25) * Math.PI) * HOP_HEIGHT) * scale;
  }
}

function frameFor(now) {
  const side = animal.frames[hen.dir > 0 ? 'right' : 'left'];
  const cycle = (frames, ms) => frames[Math.floor(now / ms) % frames.length];
  switch (hen.mode) {
    case 'held': // front view; the chicken flaps, all kick their legs
      return cycle(animal.frames.held, animal.canFly ? FRAME_MS.flap : FRAME_MS.kick);
    case 'fall':
      return cycle(animal.frames.held, FRAME_MS.fall);
    case 'glide':
      return cycle(side.glide, FRAME_MS.glide);
    case 'sleep':
      return cycle(side.sleep, FRAME_MS.sleep);
    case 'alert': // turns to look at you
      return animal.frames.front;
    case 'walk':
      return hover ? side.idle : cycle(side.walk, FRAME_MS.walk);
    default:
      return side.idle;
  }
}

/** Head of the current pose in sprite pixels: where the bubbles point to. */
function headAnchor() {
  if (hen.mode === 'held' || hen.mode === 'fall') return animal.anchors.held;
  if (hen.mode === 'alert') return animal.anchors.front;
  const right = hen.dir > 0;
  if (hen.mode === 'sleep') return animal.anchors[right ? 'sleepRight' : 'sleepLeft'];
  return animal.anchors[right ? 'right' : 'left'];
}

// --- layout ------------------------------------------------------------------------------------

function windowPos() {
  let wx = hen.x + henW() / 2 - winSize[0] / 2;
  const wy = hen.y - winSize[1];
  if (!inAir()) {
    // on the ground keep the window (and the panel) on the hen's display
    const d = currentDisplay();
    wx = clamp(wx, d.workArea.x, d.workArea.x + d.workArea.width - winSize[0]);
  }
  return [Math.round(wx), Math.round(wy)];
}

function layout() {
  const [wx, wy] = windowPos();
  if (wx !== lastWin[0] || wy !== lastWin[1]) {
    lastWin = [wx, wy];
    buddyApi.moveWindow(wx, wy);
  }

  const lx = Math.round(hen.x - wx);
  // swinging (while carried) around the top centre, where it hangs from the pointer
  buddyEl.style.transform = `translate(${lx}px, ${-hen.hop}px) rotate(${swing.angle.toFixed(1)}deg)`;

  // head on screen: x centre, and its top as distance from the window bottom
  const head = headAnchor();
  const hx = lx + head.x * px() + px() / 2;
  const top = (buddyEl.height - head.top) * px(); // highest point of the animal
  const widths = bubbleEls.map((b) => b.offsetWidth);
  Bubbles.place(bubbleEls.length, hx, top + hen.hop, widths).forEach((pos, i) => {
    bubbleEls[i].style.left = `${pos.left}px`;
    bubbleEls[i].style.bottom = `${pos.bottom}px`;
  });

  zzzEl.classList.toggle('hidden', hen.mode !== 'sleep');
  zzzEl.style.left = `${Math.round(hx + (hen.dir > 0 ? -40 : 8))}px`;
  zzzEl.style.bottom = `${top - 4}px`;

  if (!panelEl.classList.contains('hidden')) {
    const w = panelEl.offsetWidth;
    panelEl.style.left = `${Math.round(clamp(hx - w / 2, 8, winSize[0] - w - 8))}px`;
    panelEl.style.bottom = `${top + PANEL_GAP}px`;
  }
}

let last = performance.now();
function tick(now) {
  requestAnimationFrame(tick);
  if (!animal || !displays.length) return;
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  update(now, dt);
  ctx.clearRect(0, 0, buddyEl.width, buddyEl.height);
  ctx.drawImage(frameFor(now), 0, 0);
  layout();
}

// --- panel & bubble ----------------------------------------------------------------------------

function ago(ts) {
  const sec = Math.max(0, (Date.now() - ts) / 1000);
  if (sec < 60) return 'gerade eben';
  if (sec < 3600) return `vor ${Math.floor(sec / 60)} Min`;
  return `vor ${Math.floor(sec / 3600)} Std`;
}

const describe = (s) => LABELS[s.state] || LABELS.idle;

/**
 * Pixel art from rows of characters; `colors` maps characters to colours. Drawn 1:1 into a
 * canvas and scaled with nearest neighbour, so it stays crisp at any display scaling.
 */
function pixelArt(cls, rows, colors) {
  const canvas = document.createElement('canvas');
  canvas.className = cls;
  canvas.width = rows[0].length;
  canvas.height = rows.length;
  const g = canvas.getContext('2d');
  rows.forEach((line, y) =>
    [...line].forEach((c, x) => {
      if (!colors[c]) return;
      g.fillStyle = colors[c];
      g.fillRect(x, y, 1, 1);
    }),
  );
  canvas.style.width = `${canvas.width * Bubbles.PIXEL}px`;
  canvas.style.height = `${canvas.height * Bubbles.PIXEL}px`;
  return canvas;
}

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function row(s) {
  const r = el('div', 'row');
  r.append(el('span', `dot ${s.state}`));
  const text = el('div', 'text');
  text.append(el('div', 'project', s.project), el('div', 'message', describe(s)));
  r.append(text, el('span', 'ago', ago(s.ts)));
  r.addEventListener('click', () => buddyApi.focusSession(s.id));
  return r;
}

// the update entry on top of the panel
function updateRow() {
  const r = el('div', 'row update-row');
  r.append(el('span', 'dot update'));
  const text = el('div', 'text');
  const message =
    appUpdate.status === 'downloading'
      ? `Wird geladen … ${appUpdate.progress} %`
      : appUpdate.status === 'error'
        ? `Fehlgeschlagen (${appUpdate.error}), nochmal klicken`
        : appUpdate.installable
          ? 'Klicken zum Installieren'
          : 'Klicken öffnet die Download-Seite';
  text.append(el('div', 'project', `Farmies ${appUpdate.version} ist da`), el('div', 'message', message));
  r.append(text);
  r.addEventListener('click', () => buddyApi.installUpdate());
  return r;
}

function renderPanel() {
  const p = pending();
  panelEl.replaceChildren();
  if (appUpdate) panelEl.append(updateRow());
  if (p.length) {
    panelEl.append(el('div', 'title', p.length === 1 ? '1 Session wartet auf dich' : `${p.length} Sessions warten auf dich`));
    p.forEach((s) => panelEl.append(row(s)));
    const footer = el('div', 'footer');
    const btn = el('button', '', 'Alle als gesehen markieren');
    btn.addEventListener('click', () => buddyApi.dismissAll());
    footer.append(btn);
    panelEl.append(footer);
  } else {
    const working = sessions.filter((s) => s.state === 'working');
    const title = working.length ? `Alles ruhig · ${working.length} arbeitet` : 'Alles ruhig · alle schlafen';
    panelEl.append(el('div', 'title', title));
    sessions.forEach((s) => panelEl.append(row(s)));
  }
}

// One bubble per waiting session (most urgent first); the last one shows "+N" if there are more.
function renderBubbles() {
  bubbleEls = Bubbles.plan(pending(), appUpdate).map((b, i) => {
    const bubble = el('div', `bubble interactive${b.state ? ` state-${b.state}` : ''}`);
    bubble.style.width = `${b.width}px`;
    const tail = pixelArt(`tail tail-${b.tail}`, Bubbles.TAILS[b.tail], { '#': Bubbles.INK, P: Bubbles.PAPER });
    tail.style.left = `${Bubbles.tailX(b.tail, b.width)}px`;
    bubble.append(pixelArt('glyph', b.rows, { '#': b.color }), tail);
    if (b.session) bubble.addEventListener('click', () => buddyApi.focusSession(b.session.id));
    if (b.update) bubble.addEventListener('click', () => buddyApi.installUpdate());
    bubble.style.zIndex = String(Bubbles.MAX_BUBBLES - i); // middle bubble in front
    bubble.style.animationDelay = `${i * 0.15}s`;
    return bubble;
  });
  bubblesEl.replaceChildren(...bubbleEls);
}

function setHover(on) {
  if (on && !drag && !inAir()) {
    clearTimeout(hideTimer);
    hideTimer = null;
    if (!hover) {
      hover = true;
      renderPanel();
      panelEl.classList.remove('hidden');
    }
  } else if (hover && !hideTimer) {
    hideTimer = setTimeout(() => {
      hideTimer = null;
      hover = false;
      panelEl.classList.add('hidden');
    }, on ? 0 : 350);
  }
}

function setInteractive(on) {
  if (on === interactive) return;
  interactive = on;
  buddyApi.setInteractive(on);
}

// --- mouse -------------------------------------------------------------------------------------

window.addEventListener('mousemove', (e) => {
  if (drag) return; // keep receiving events while the hen is carried
  const target = document.elementFromPoint(e.clientX, e.clientY);
  const over = !!(target && target.closest('.interactive'));
  setInteractive(over);
  setHover(over);
});
document.addEventListener('mouseleave', () => {
  if (drag) return;
  setInteractive(false);
  setHover(false);
});

function onBuddyClick() {
  const p = pending();
  if (p.length === 1) buddyApi.focusSession(p[0].id);
}

buddyEl.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  buddyEl.setPointerCapture(e.pointerId);
  drag = { offX: e.screenX - hen.x, offY: e.screenY - hen.y, startX: e.screenX, startY: e.screenY, moved: false };
});

buddyEl.addEventListener('pointermove', (e) => {
  if (!drag) return;
  if (!drag.moved) {
    if (Math.hypot(e.screenX - drag.startX, e.screenY - drag.startY) < DRAG_THRESHOLD) return;
    drag.moved = true;
    hen.mode = 'held';
    hen.hop = 0;
    setHover(false);
  }
  if (e.movementX) hen.dir = e.movementX > 0 ? 1 : -1;
  // pointer speed (smoothed) pushes the swing
  const t = performance.now();
  if (drag.lastT && t > drag.lastT) {
    const speed = ((e.screenX - drag.lastX) / (t - drag.lastT)) * 1000;
    swing.pointerSpeed = swing.pointerSpeed * 0.5 + speed * 0.5;
  }
  drag.lastX = e.screenX;
  drag.lastT = t;
  hen.x = e.screenX - drag.offX;
  hen.y = e.screenY - drag.offY;
});

function endDrag() {
  if (!drag) return;
  const moved = drag.moved;
  drag = null;
  if (moved) drop();
  else onBuddyClick();
}
buddyEl.addEventListener('pointerup', endDrag);
// right click: the tray icon's menu
buddyEl.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  buddyApi.showMenu();
});
buddyEl.addEventListener('pointercancel', endDrag);

// --- wiring ------------------------------------------------------------------------------------

buddyApi.onDisplays(setDisplays);
buddyApi.onSprites((sprites) => setSprites(sprites));
buddyApi.onAnimal((id) => setAnimal(id));
buddyApi.onScale((value) => setScale(value));
buddyApi.onSessions((list) => {
  sessions = list;
  renderBubbles();
  if (hover) renderPanel();
});
buddyApi.onUpdate((u) => {
  appUpdate = u;
  renderBubbles();
  if (hover) renderPanel();
});
setInterval(() => hover && renderPanel(), 30000);

// Sleeping "z Z z": pixel letters with a light outline, so they read on any background.
const Z_SMALL = ['####', '..#.', '.#..', '####'];
const Z_BIG = ['#####', '...#.', '..#..', '.#...', '#####'];
function outlined(rows) {
  const h = rows.length + 2;
  const w = rows[0].length + 2;
  const at = (x, y) => rows[y - 1]?.[x - 1] === '#';
  return Array.from({ length: h }, (_, y) =>
    Array.from({ length: w }, (_, x) => {
      if (at(x, y)) return '#';
      return [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => at(x + dx, y + dy)) ? 'P' : '.';
    }).join(''),
  );
}
zzzEl.append(
  ...[Z_SMALL, Z_BIG, Z_SMALL].map((z) => pixelArt('', outlined(z), { '#': Bubbles.INK, P: Bubbles.PAPER })),
);

buddyApi.onDebugPanel(() => setHover(true)); // FARMIES_DEBUG snapshot only

buddyApi.ready();
requestAnimationFrame(tick);
