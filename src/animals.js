// Farm animals from "LPC style farm animals" by Daniel Eddeland (CC-BY 3.0, see assets/CREDITS.md).
// Builds all animation frames from an animal's walk sheet (rows: up, left, down, right; 4 frames
// each). Frames for walking right are mirrored from walking left. Derived poses:
//   idle (standing), lie (lying down) and sleep (eyes closed, breathing; both from src/poses.js),
//   front (looking at you; the chicken's is hand-drawn in src/poses.js), held (front view, legs
//   kicking; the chicken also flaps), glide (chicken only: wings spread, comb and tail fluttering).
// Pure functions on RGBA frames { w, h, data }; shared by the renderer (script tag) and node (tests).
(function (root) {
  'use strict';

  // lying and standing poses, see src/poses.js
  const { LYING, STANDING, FRONT } = typeof module !== 'undefined' && module.exports ? require('./poses') : root.Poses;
  const ROW = { up: 0, left: 1, down: 2, right: 3 };

  // frame: size of a frame in the sheet; size: display size relative to the chicken's pixels;
  // walkOrder: sheet columns of the walk cycle (the llama's sheet runs backwards: its feet slid
  // forward while on the ground).
  // The large animals are drawn at double detail in the sheets; shown at 0.75 they are clearly
  // bigger than the chicken without dwarfing it (halve: true would scale them down to its pixels).
  const ANIMALS = {
    chicken: { label: 'Huhn', sheet: 'chicken_walk.png', frame: 32, size: 1, canFly: true },
    cow: { label: 'Kuh', sheet: 'cow_walk.png', frame: 128, size: 0.75 },
    pig: { label: 'Schwein', sheet: 'pig_walk.png', frame: 128, size: 0.75 },
    sheep: { label: 'Schaf', sheet: 'sheep_walk.png', frame: 128, size: 0.75 },
    llama: { label: 'Lama', sheet: 'llama_walk.png', frame: 128, size: 0.75, walkOrder: [3, 2, 1, 0] },
  };
  const DEFAULT_ANIMAL = 'chicken';

  // Chicken extras, in coordinates of a left-facing 32x32 frame.
  const CHICKEN = {
    foldedWing: [8, 13, 22, 20], // the folded wing's oval, removed when the wings are spread
    wingRoot: [12, 14], // bottom-left pixel of the spread wing (side view)
    combTip: [3, 3, 11, 6], // flutters while gliding
    tailTip: [25, 7, 31, 10],
  };
  // front view wings (procedural, see wingEllipse): angle in degrees from horizontal (positive =
  // raised), length/thickness in pixels of a 32px frame, shoulder: offset to the front view's
  // shoulder row (src/poses.js), inset: root moved in from the body's widest edge
  const FRONT_WINGS = {
    up: { angle: 50, length: 12, thickness: 6, shoulder: 0 },
    out: { angle: 5, length: 12, thickness: 6, shoulder: 1 },
  };

  // raised wings, '#' outline, 'e' feather, 'f' light shade, 'd' dark shade (palette of the chicken)
  const WING_COLORS = { c: [58, 55, 55, 255], e: [239, 233, 231, 255], f: [183, 179, 178, 255], d: [130, 124, 124, 255] };
  // side view, spread for gliding: rises from the back, primary feathers fingered at the tip
  const WING_SPREAD = [
    '...........c.c.c',
    '..........cecece',
    '.........ceeeeec',
    '.......cceeeeefc',
    '.....cceeeeeefc.',
    '....ceeeeeeffc..',
    '...ceeeeeeffdc..',
    '..ceeeeeffddc...',
    '.ceeeeffddcc....',
    'ceeeffddcc......',
    'cffddccc........',
    '.cccc...........',
  ];

  // --- frame helpers ---------------------------------------------------------------------------

  const blank = (w, h) => ({ w, h, data: new Uint8ClampedArray(w * h * 4) });
  const idx = (f, x, y) => (y * f.w + x) * 4;
  const inside = (f, x, y) => x >= 0 && y >= 0 && x < f.w && y < f.h;
  const opaque = (f, x, y) => inside(f, x, y) && f.data[idx(f, x, y) + 3] > 127;
  const rgb = (f, x, y) => Array.from(f.data.subarray(idx(f, x, y), idx(f, x, y) + 4));
  const lum = ([r, g, b]) => 0.299 * r + 0.587 * g + 0.114 * b;
  const clone = (f) => ({ w: f.w, h: f.h, data: new Uint8ClampedArray(f.data) });
  const set = (f, x, y, c) => inside(f, x, y) && f.data.set(c, idx(f, x, y));
  const clear = (f, x, y) => inside(f, x, y) && f.data.fill(0, idx(f, x, y), idx(f, x, y) + 4);

  function sub(sheet, size, col, row) {
    const f = blank(size, size);
    for (let y = 0; y < size; y++) {
      const s = ((row * size + y) * sheet.w + col * size) * 4;
      f.data.set(sheet.data.subarray(s, s + size * 4), y * size * 4);
    }
    return f;
  }

  // 2x2 blocks → 1 pixel: opaque if at least 2 opaque pixels, then the most frequent colour, ties
  // go to the darker one (keeps the dark outlines of pixel art).
  function halve(f) {
    const out = blank(f.w >> 1, f.h >> 1);
    for (let y = 0; y < out.h; y++) {
      for (let x = 0; x < out.w; x++) {
        const px = [];
        for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) if (opaque(f, x * 2 + dx, y * 2 + dy)) px.push(rgb(f, x * 2 + dx, y * 2 + dy));
        if (px.length < 2) continue;
        const counts = new Map();
        for (const c of px) {
          const k = c.join(',');
          counts.set(k, { c, n: (counts.get(k)?.n || 0) + 1 });
        }
        const best = [...counts.values()].sort((a, b) => b.n - a.n || lum(a.c) - lum(b.c))[0];
        set(out, x, y, [best.c[0], best.c[1], best.c[2], 255]);
      }
    }
    return out;
  }

  function mirror(f) {
    const out = blank(f.w, f.h);
    for (let y = 0; y < f.h; y++) for (let x = 0; x < f.w; x++) out.data.set(f.data.subarray(idx(f, x, y), idx(f, x, y) + 4), idx(out, f.w - 1 - x, y));
    return out;
  }

  function bbox(frames) {
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -1;
    let y1 = -1;
    for (const f of frames) {
      for (let y = 0; y < f.h; y++) {
        for (let x = 0; x < f.w; x++) {
          if (!opaque(f, x, y)) continue;
          x0 = Math.min(x0, x);
          y0 = Math.min(y0, y);
          x1 = Math.max(x1, x);
          y1 = Math.max(y1, y);
        }
      }
    }
    return { x0, y0, x1, y1 };
  }

  // crop to `box`, leaving `pad` free pixels on each side (room for wings, kicking legs)
  function crop(f, box, pad) {
    const out = blank(box.x1 - box.x0 + 1 + pad * 2, box.y1 - box.y0 + 1 + pad);
    for (let y = box.y0; y <= box.y1; y++) {
      for (let x = box.x0; x <= box.x1; x++) {
        if (opaque(f, x, y)) set(out, x - box.x0 + pad, y - box.y0 + pad, rgb(f, x, y));
      }
    }
    return out;
  }

  function margin(f, px) {
    const out = blank(f.w + px * 2, f.h + px);
    paste(out, f, px, px);
    return out;
  }

  function shiftY(f, dy) {
    const out = blank(f.w, f.h);
    paste(out, f, 0, dy);
    return out;
  }

  function paste(dst, src, dx, dy, keep = () => true) {
    for (let y = 0; y < src.h; y++) {
      for (let x = 0; x < src.w; x++) if (opaque(src, x, y) && keep(x, y)) set(dst, x + dx, y + dy, rgb(src, x, y));
    }
  }

  // --- analysis (on a left-facing standing frame) ----------------------------------------------

  const rowWidth = (f, y) => [...Array(f.w).keys()].filter((x) => opaque(f, x, y)).length;

  function bottomRow(f) {
    for (let y = f.h - 1; y >= 0; y--) if (rowWidth(f, y) > 0) return y;
    return f.h - 1;
  }

  /** First row of the legs: the narrow rows at the bottom. */
  function legTop(f) {
    const widths = [...Array(f.h).keys()].map((y) => rowWidth(f, y));
    const max = Math.max(...widths);
    let y = bottomRow(f);
    while (y > 0 && widths[y] < max * 0.35) y--;
    return y + 1;
  }

  const hexColor = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)).concat(255);

  /**
   * Breathing while asleep, the second frame: the chest (`chest`, frame coordinates) swells forward
   * by a pixel, or else the back (behind the head, the upper part of the body) sinks by a pixel; the
   * head stays.
   */
  function breathe(f, chest) {
    if (chest) {
      const [x0, y0, x1, y1] = chest;
      const out = clone(f);
      paste(out, f, -1, 0, (x, y) => x >= x0 && x <= x1 && y >= y0 && y <= y1);
      return out;
    }
    const box = bbox([f]);
    const backX = box.x0 + Math.round((box.x1 - box.x0) * 0.35);
    let backTop = box.y1;
    for (let x = backX; x <= box.x1; x++) for (let y = box.y0; y < backTop; y++) if (opaque(f, x, y)) backTop = y;
    const lower = backTop + Math.round((box.y1 - backTop) * 0.4);
    const out = blank(f.w, f.h);
    paste(out, f, 0, 0, (x, y) => x < backX || y >= lower);
    paste(out, f, 0, 1, (x, y) => x >= backX && y < lower);
    return out;
  }

  /** Head of a left-facing frame: top of the front third → { x, y } (centre x, top y). */
  function head(f) {
    const box = bbox([f]);
    const front = box.x0 + Math.max(2, Math.round((box.x1 - box.x0) / 3));
    for (let y = box.y0; y <= box.y1; y++) {
      const xs = [];
      for (let x = box.x0; x <= front; x++) if (opaque(f, x, y)) xs.push(x);
      if (xs.length) {
        // centre of the head: average over its top rows
        const rows = [];
        for (let yy = y; yy < Math.min(y + 4, box.y1); yy++) for (let x = box.x0; x <= front; x++) if (opaque(f, x, yy)) rows.push(x);
        return { x: Math.round(rows.reduce((a, b) => a + b, 0) / rows.length), y };
      }
    }
    return { x: box.x0, y: box.y0 };
  }

  // Removes the folded wing (chicken): within its oval, the wing's lines and shading become the
  // body's: white on the back, light grey further down, the belly band at its bottom edge. Breast,
  // belly and tail shading outside the oval stay as drawn.
  function removeFoldedWing(f, [x0, y0, x1, y1]) {
    const out = clone(f);
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        if (!opaque(f, x, y)) continue;
        const l = lum(rgb(f, x, y));
        if (y <= y0 + 3) {
          if (l < 200) set(out, x, y, WING_COLORS.e);
        } else if (y < y1) {
          if (l < 150) set(out, x, y, WING_COLORS.f);
        } else if (l < 100 && x >= x0 + 3 && x <= x1 - 2) {
          set(out, x, y, WING_COLORS.d);
        }
      }
    }
    return out;
  }

  // Removes the folded wings' inner edges in the front view (chicken, wings spread).
  function removeFrontWingEdges(f, columns, [y0, y1]) {
    const out = clone(f);
    for (const [x0, x1] of columns) {
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          if (opaque(f, x, y) && lum(rgb(f, x, y)) < 150) set(out, x, y, WING_COLORS.e);
        }
      }
    }
    return out;
  }

  function shift(f, [x0, y0, x1, y1], dx) {
    const out = clone(f);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) clear(out, x, y);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (opaque(f, x, y)) set(out, x + dx, y, rgb(f, x, y));
    return out;
  }

  function drawPixmap(f, map, left, bottom) {
    const top = bottom - map.length + 1;
    map.forEach((line, y) => [...line].forEach((ch, x) => WING_COLORS[ch] && set(f, left + x, top + y, WING_COLORS[ch])));
  }

  // legs: 4-connected groups of opaque pixels in the leg rows
  function legGroups(f, top) {
    const label = new Int32Array(f.w * f.h).fill(-1);
    const groups = [];
    for (let y = top; y < f.h; y++) {
      for (let x = 0; x < f.w; x++) {
        if (!opaque(f, x, y) || label[y * f.w + x] >= 0) continue;
        const pixels = [];
        const stack = [[x, y]];
        label[y * f.w + x] = groups.length;
        while (stack.length) {
          const [cx, cy] = stack.pop();
          pixels.push([cx, cy]);
          for (const [nx, ny] of [[cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]]) {
            if (ny < top || !opaque(f, nx, ny) || label[ny * f.w + nx] >= 0) continue;
            label[ny * f.w + nx] = groups.length;
            stack.push([nx, ny]);
          }
        }
        groups.push(pixels);
      }
    }
    return groups;
  }

  // legs kicking: leg groups (left to right) moved by alternating [dx, dy] offsets; a leg pulled up
  // disappears partly behind the body, so it looks drawn in
  function kick(f, top, offsets) {
    const out = blank(f.w, f.h);
    const groups = legGroups(f, top).sort((a, b) => Math.min(...a.map((p) => p[0])) - Math.min(...b.map((p) => p[0])));
    groups.forEach((pixels, i) => {
      const [dx, dy] = offsets[i % offsets.length];
      for (const [x, y] of pixels) set(out, x + dx, y + dy, rgb(f, x, y));
    });
    // body over the legs' tops
    paste(out, f, 0, 0, (x, y) => y < top);
    return out;
  }

  /**
   * A wing as an ellipse from the root (rx, ry) outwards (side -1 = to the left, +1 = right),
   * raised by `angle` degrees: outline, white upper side, grey underside, and the primary feathers
   * fingered (notched outline) at the outer end.
   */
  function wingEllipse(f, rx, ry, side, { angle, length, thickness }) {
    const before = clone(f);
    const body = (x, y) => opaque(before, x, y);
    const a = length / 2;
    const b = thickness / 2;
    const rad = (angle * Math.PI) / 180;
    const dir = [side * Math.cos(rad), -Math.sin(rad)]; // along the wing, outwards
    const nrm = [-dir[1] * side, dir[0] * side]; // across, pointing to the underside
    const cx = rx + dir[0] * a;
    const cy = ry + dir[1] * a;
    const local = (x, y) => {
      const dx = x - cx;
      const dy = y - cy;
      return [dx * dir[0] + dy * dir[1], dx * nrm[0] + dy * nrm[1]];
    };
    const inside = (x, y) => {
      const [u, v] = local(x, y);
      return (u / a) ** 2 + (v / b) ** 2 <= 1;
    };
    const r = Math.ceil(a + 1);
    for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
      for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
        if (!inside(x, y)) continue;
        const [u, v] = local(x, y);
        const edge = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([ex, ey]) => !inside(x + ex, y + ey));
        // at the root (over the body) the wing blends in: no outline, and the body's outline under
        // it is covered by feathers
        if (edge && !body(x, y)) {
          // fingered tip: gaps in the outline on the underside of the outer third
          if (u > a / 3 && v > 0 && (Math.round(u) & 1)) continue;
          set(f, x, y, WING_COLORS.c);
        } else {
          set(f, x, y, v > b * 0.25 ? WING_COLORS.f : WING_COLORS.e);
        }
      }
    }
  }

  // front view wings at the body's edges, left and right (mirror images)
  function drawFrontWings(f, wing, [lx, rx], shoulderY, k) {
    const w = { ...wing, length: wing.length * k, thickness: wing.thickness * k };
    const inset = wing.inset || 0; // root moved in towards the middle (the body is narrower up top)
    wingEllipse(f, lx + 1 + inset, shoulderY, -1, w);
    wingEllipse(f, rx - 1 - inset, shoulderY, 1, w);
  }

  // --- build ---------------------------------------------------------------------------------------

  /**
   * sheet: decoded walk sheet { w, h, data }. Returns
   * { id, label, canFly, size, w, h, frames: { left, right, front, held[] }, anchors }
   * where frames.left/right = { walk[], idle, sleep[], glide[] } (side views), front is the front
   * view and held its kicking/flapping variants; anchors give the head (bubble target) per pose in
   * frame pixels: { left, right, front, sleepLeft, sleepRight } (held uses front).
   */
  function build(id, sheet) {
    const a = ANIMALS[id];
    const size = a.frame;
    // frames get a margin, so wings and kicking legs can reach beyond the sheet's frame
    const MARGIN = Math.round(size / 3);
    const take = (col, row) => margin(a.halve ? halve(sub(sheet, size, col, row)) : sub(sheet, size, col, row), MARGIN);
    const m = (v) => v + MARGIN; // sheet frame coordinates → frame with margin
    let walk = (a.walkOrder || [0, 1, 2, 3]).map((c) => take(c, ROW.left));
    // all poses stand on the same ground line: the feet when walking (the sheet's rows are not
    // aligned, e.g. the front view sits lower)
    const ground = Math.max(...walk.map(bottomRow));
    // front view: hand-drawn (src/poses.js), or the sheet's, moved down to the ground line
    const drawn = FRONT[id];
    let front;
    let frontTop;
    let frontAt = (x, y) => [x, y]; // drawn front view's coordinates → frame
    if (drawn) {
      front = blank(walk[0].w, walk[0].h);
      const top = ground - drawn.rows.length + 1;
      frontAt = (x, y) => [m(drawn.x) + x, top + y];
      drawn.rows.forEach((line, y) =>
        [...line].forEach((ch, x) => ch !== '.' && set(front, ...frontAt(x, y), hexColor(drawn.palette[ch]))),
      );
      frontTop = frontAt(0, drawn.legs)[1];
    } else {
      front = take(0, ROW.down);
      front = shiftY(front, ground - bottomRow(front));
      frontTop = legTop(front);
    }

    // standing: the first walk frame, or hand-drawn straight legs (src/poses.js)
    const standing = STANDING[id];
    let stand = walk[0];
    if (standing) {
      stand = take(standing.frame, ROW.left);
      for (let y = m(standing.y); y < stand.h; y++) for (let x = 0; x < stand.w; x++) clear(stand, x, y);
      standing.rows.forEach((line, y) =>
        [...line].forEach((ch, x) => ch !== '.' && set(stand, m(standing.x + x), m(standing.y + y), hexColor(standing.palette[ch]))),
      );
    }

    // Lying: lying down (awake), then asleep and breathing (src/poses.js), on the uncropped frame.
    const lying = LYING[id];
    const standX = bbox([stand]).x0;
    const pose = (rows) => {
      const f = blank(stand.w, stand.h);
      rows.forEach((line, y) =>
        [...line].forEach((ch, x) => {
          if (ch !== '.') set(f, standX + lying.dx + x, ground - rows.length + 1 + y, hexColor(lying.palette[ch]));
        }),
      );
      return f;
    };
    const lie = pose(lying.lie);
    const asleep = pose(lying.sleep);
    const top = ground - lying.sleep.length + 1;
    const chest = lying.chest && [lying.chest[0] + standX + lying.dx, lying.chest[1] + top, lying.chest[2] + standX + lying.dx, lying.chest[3] + top];
    const sleep = [asleep, breathe(asleep, chest)];

    // Held up: front view, legs kicking (pulled in by turns); the chicken also flaps its wings.
    const detail = a.halve || size === 32 ? 1 : 2; // sheet pixels per chicken-sized pixel
    const KICKS = [
      [[0, -2], [1, 0]],
      [[-1, 0], [0, -2]],
    ].map((k) => k.map(([dx, dy]) => [dx * detail, dy * detail]));
    let held = KICKS.map((k) => kick(front, frontTop, k));
    let glide = [];
    if (a.canFly) {
      const s = (v) => m(Math.round((v * size) / 32)); // chicken coordinates → this frame
      // wings at the body's outer edges, from the shoulder row
      const { columns, rows } = drawn.wingEdges;
      const shoulderY = frontAt(0, drawn.shoulders)[1];
      const shoulders = [frontAt(0, 0)[0], frontAt(drawn.rows[0].length - 1, 0)[0]];
      const open = (f) =>
        removeFrontWingEdges(
          f,
          columns.map(([x0, x1]) => [frontAt(x0, 0)[0], frontAt(x1, 0)[0]]),
          rows.map((y) => frontAt(0, y)[1]),
        );
      held = [FRONT_WINGS.up, FRONT_WINGS.out, FRONT_WINGS.up, FRONT_WINGS.out].map((wing, i) => {
        const f = open(held[i % held.length]);
        drawFrontWings(f, wing, shoulders, shoulderY + wing.shoulder, size / 32);
        return f;
      });
      // gliding sideways: wings spread, folded wing painted over, comb and tail fluttering
      const wingless = removeFoldedWing(stand, CHICKEN.foldedWing.map(s));
      const withWing = (body, lift) => {
        const f = clone(body);
        drawPixmap(f, WING_SPREAD, s(CHICKEN.wingRoot[0]), s(CHICKEN.wingRoot[1]) - lift);
        return f;
      };
      const fluttering = shift(shift(wingless, CHICKEN.combTip.map(s), 1), CHICKEN.tailTip.map(s), 1);
      glide = [withWing(wingless, 0), withWing(fluttering, 1)];
    }

    // common crop for all frames, with room for wings and kicking legs
    const all = [...walk, stand, front, lie, ...sleep, ...held, ...glide];
    const box = bbox(all);
    const pad = 2;
    const cut = (f) => crop(f, box, pad);
    const at = (p) => ({ x: p.x - box.x0 + pad, y: p.y - box.y0 + pad });

    walk = walk.map(cut);
    const left = { walk, idle: cut(stand), lie: cut(lie), sleep: sleep.map(cut), glide: glide.map(cut) };
    const right = Object.fromEntries(
      Object.entries(left).map(([k, v]) => [k, Array.isArray(v) ? v.map(mirror) : mirror(v)]),
    );
    front = cut(front);
    held = held.map(cut);

    const w = walk[0].w;
    // anchor: head centre x, head top y, and the pose's top row (bubbles stay above all of it)
    const topOf = (frames) => bbox(frames).y0;
    const headLeft = { ...at(head(stand)), top: topOf(walk) };
    const headSleep = { ...at(head(asleep)), top: topOf(left.sleep) };
    const headLie = { ...at(head(lie)), top: topOf([left.lie]) };
    const frontBox = bbox([front]);
    const headFront = { x: Math.round((frontBox.x0 + frontBox.x1) / 2), y: frontBox.y0, top: frontBox.y0 };
    const mirrorX = (p) => ({ ...p, x: w - 1 - p.x });
    return {
      id,
      label: a.label,
      canFly: !!a.canFly,
      size: a.size || 1,
      w,
      h: walk[0].h,
      frames: { left, right, front, held },
      anchors: {
        left: headLeft,
        right: mirrorX(headLeft),
        sleepLeft: headSleep,
        sleepRight: mirrorX(headSleep),
        lieLeft: headLie,
        lieRight: mirrorX(headLie),
        front: headFront,
        held: { ...headFront, top: topOf(held) },
      },
    };
  }

  const api = { ANIMALS, DEFAULT_ANIMAL, FRONT_WINGS, build, halve, mirror, legTop, head, bbox };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Animals = api;
})(this);
