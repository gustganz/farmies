// Speech bubbles: pixel glyphs, tails and their arc around the animal's head. Shared by the
// renderer (script tag) and node (preview script, tests), so the preview shows what the app does.
(function (root) {
  'use strict';

  // Bubbles sit on an arc around the head: most urgent in the middle, the others alternately right
  // and left, a bit lower each, slightly overlapping. Angles in degrees.
  const MAX_BUBBLES = 5;
  const ARC_RADIUS = 44; // horizontal
  const ARC_DROP = 24; // vertical radius: the outer bubbles sit at most 12px lower
  const ARC_ANGLES = [0, 30, -30, 60, -60];
  const WIDTH = 24; // see .bubble in style.css
  const HEIGHT = 22;
  const HEAD_GAP = 8; // between head top and the middle bubble's bottom (its tail is 6px)
  const PIXEL = 2; // screen px per glyph pixel
  const WIDE_SHIFT = 8; // extra outward shift of a wide bubble beside others

  const PAPER = '#f5f3e1';
  const INK = '#000000';
  const TEXT = '#2b2118';

  // '#' = one glyph pixel
  const GLYPHS = {
    attention: { color: '#c72626', rows: ['.##.', '.##.', '.##.', '.##.', '.##.', '....', '.##.'] },
    question: { color: '#2f6fd0', rows: ['.####.', '##..##', '....##', '...##.', '..##..', '......', '..##..'] },
    error: { color: '#c72626', rows: ['##...##', '.##.##.', '..###..', '.##.##.', '##...##'] },
    done: { color: '#3f8f2f', rows: ['......##', '.....##.', '##..##..', '.####...', '..##....'] },
  };

  // Tails ('#' outline, 'P' paper; the first row lies on the bubble border and opens it).
  // "left" points down-left (bubble right of the head), "right" down-right, "down" straight down.
  const TAILS = {
    down: ['.PP.', '#PP#', '.##.'],
    left: ['#PP#', '#P#.', '##..'],
    right: ['#PP#', '.#P#', '..##'],
  };

  // 3x5 pixel font for "+N"
  const DIGITS = {
    '+': ['...', '.#.', '###', '.#.', '...'],
    0: ['###', '#.#', '#.#', '#.#', '###'],
    1: ['.#.', '##.', '.#.', '.#.', '###'],
    2: ['###', '..#', '###', '#..', '###'],
    3: ['###', '..#', '.##', '..#', '###'],
    4: ['#.#', '#.#', '###', '..#', '..#'],
    5: ['###', '#..', '###', '..#', '###'],
    6: ['###', '#..', '###', '#.#', '###'],
    7: ['###', '..#', '..#', '.#.', '.#.'],
    8: ['###', '#.#', '###', '#.#', '###'],
    9: ['###', '#.#', '###', '..#', '###'],
  };
  // instead of "+N" when more than 9 further sessions wait
  const INFINITY = ['.##.##.', '#..#..#', '#..#..#', '.##.##.'];

  // A new Farmies version is available: a wider bubble saying "NEW" (while downloading: percent)
  const UPDATE = {
    color: '#d9730d',
    width: 34,
    rows: [
      '#..#.###.#...#',
      '##.#.#...#...#',
      '#.##.###.#.#.#',
      '#..#.#...#.#.#',
      '#..#.###..#.#.',
    ],
  };

  const tailFor = (i) => (ARC_ANGLES[i] > 0 ? 'left' : ARC_ANGLES[i] < 0 ? 'right' : 'down');
  const textRows = (text) => DIGITS['+'].map((_, y) => [...text].map((ch) => DIGITS[ch][y]).join('.'));
  // x of the tail's left edge in a bubble of `width` (see .tail-* in style.css)
  const tailX = (tail, width = WIDTH) => (tail === 'down' ? (width - 8) / 2 : tail === 'left' ? 2 : width - 2 - 8);

  /**
   * What to show for the waiting sessions (most urgent first): one bubble per session, the last
   * one "+N" (or ∞) if there are more than fit; an available update always gets the last bubble.
   * → [{ session?, update?, rows, color, tail, width, state? }]
   */
  function plan(sessions, update) {
    const slots = MAX_BUBBLES - (update ? 1 : 0);
    const shown = sessions.length > slots ? sessions.slice(0, slots - 1) : sessions;
    const bubbles = shown.map((s) => ({ session: s, state: s.state, rows: GLYPHS[s.state].rows, color: GLYPHS[s.state].color }));
    const extra = sessions.length - shown.length;
    if (extra > 0) bubbles.push({ rows: extra > 9 ? INFINITY : textRows(`+${extra}`), color: TEXT });
    if (update) {
      const downloading = update.status === 'downloading';
      bubbles.push({
        update: true,
        state: 'update',
        rows: downloading ? textRows(String(update.progress || 0)) : UPDATE.rows,
        color: UPDATE.color,
        width: UPDATE.width,
      });
    }
    return bubbles.map((b, i) => ({ width: WIDTH, ...b, tail: tailFor(i) }));
  }

  /**
   * Positions (left, bottom in px of the window) of `count` bubbles: centred over the head at x
   * `headX`, above `top`, the highest point of the animal (px above the window bottom), so the
   * outer bubbles never cover the body. The middle bubble's tail points down at the head.
   * `widths`: per bubble, if not the standard width.
   */
  function place(count, headX, top, widths = []) {
    const arc = ARC_ANGLES.slice(0, count).map((deg) => {
      const angle = (deg * Math.PI) / 180;
      return { dx: ARC_RADIUS * Math.sin(angle), dy: ARC_DROP * (1 - Math.cos(angle)) };
    });
    // lift the arc just enough that its lowest bubble keeps the gap
    const lift = HEAD_GAP + Math.max(0, ...arc.map((a) => a.dy));
    return arc.map(({ dx, dy }, i) => {
      // a wider bubble (behind its inner neighbour) moves outwards, so its text stays readable
      const extra = widths[i] > WIDTH ? (widths[i] - WIDTH) / 2 + WIDE_SHIFT : 0;
      return { dx: dx + Math.sign(dx) * extra, dy, width: widths[i] || WIDTH };
    }).map(({ dx, dy, width }) => ({
      left: Math.round((headX + dx - width / 2) / 2) * 2,
      bottom: Math.round((top + lift - dy) / 2) * 2,
    }));
  }

  const api = { MAX_BUBBLES, WIDTH, HEIGHT, PIXEL, PAPER, INK, TEXT, GLYPHS, TAILS, UPDATE, tailX, plan, place };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Bubbles = api;
})(this);
