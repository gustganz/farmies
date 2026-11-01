// Seasonal meadow at the bottom of the hover panel: ground and props change every month, and now
// and then one of the month's two animals comes into the bottom right corner and stays there until
// the pointer comes close. Pure canvas, 1 meadow pixel = 2 css px. UMD: renderer and node (tests).
(function (root) {
  'use strict';

  const W = 152; // logical width (304 css px)
  const H = 36; // logical height incl. the 3 rows of grass tips on top
  const S = 2; // flowers and animals: one art pixel = 2x2 meadow pixels (like the farm animal's scale)
  const EDGE = 3;
  const GROUND_Y = H - 3; // animals stand on this row
  const ZONE = 46; // bottom right corner (meadow px): props and the resting visitor; the text keeps it free

  // ---- months: ground colours, text colours, flowers -------------------------------------------
  // ground = meadow, blade/tip = grass edge, tuft = texture, text/muted = text on the meadow
  const MONTHS = [
    /* Jan */ { name: 'Jänner', ground: '#e6ecef', blade: '#e6ecef', tip: '#c7d3da', tuft: '#cfd9df', text: '#2b2118', muted: '#5d6b75', flowers: ['snowman', 'tree'], snow: true },
    /* Feb */ { name: 'Februar', ground: '#dfe6e0', blade: '#dfe6e0', tip: '#9db58a', tuft: '#b9cbb0', text: '#2b2118', muted: '#56664c', flowers: ['snowmanMelt', 'snowdrop'], snow: true },
    /* Mär */ { name: 'März', ground: '#5f9a3a', blade: '#5f9a3a', tip: '#8fc45a', tuft: '#6fae46', text: '#f5f3e1', muted: '#d7ebbd', flowers: ['hatCarrot', 'crocus'] },
    /* Apr */ { name: 'April', ground: '#4f8f34', blade: '#4f8f34', tip: '#86c158', tuft: '#5fa03f', text: '#f5f3e1', muted: '#d2e8b8', flowers: ['umbrella', 'tulipRed'] },
    /* Mai */ { name: 'Mai', ground: '#4a8a30', blade: '#4a8a30', tip: '#7fbd52', tuft: '#5a9c3c', text: '#f5f3e1', muted: '#d2e8b8', flowers: ['bike', 'dandelion'] },
    /* Jun */ { name: 'Juni', ground: '#3f7d2b', blade: '#3f7d2b', tip: '#6fae43', tuft: '#4a8c33', text: '#f5f3e1', muted: '#cfe3b4', flowers: ['sunYoung', 'poppy'] },
    /* Jul */ { name: 'Juli', ground: '#467a29', blade: '#467a29', tip: '#7aa83f', tuft: '#53893a', text: '#f5f3e1', muted: '#d8e6b0', flowers: ['sunBud', 'daisy'] },
    /* Aug */ { name: 'August', ground: '#6a7d2d', blade: '#6a7d2d', tip: '#b3a64a', tuft: '#7a8c36', text: '#f5f3e1', muted: '#ece3b5', flowers: ['sunBloom', 'hay'] },
    /* Sep */ { name: 'September', ground: '#64692c', blade: '#64692c', tip: '#a39a45', tuft: '#727835', text: '#f5f3e1', muted: '#e6dfb2', flowers: ['lantern', 'chestnut'] },
    /* Okt */ { name: 'Oktober', ground: '#6e5426', blade: '#6e5426', tip: '#b77a2c', tuft: '#7f6230', text: '#f5f3e1', muted: '#f0d9ae', flowers: ['pumpkinFace', 'mushroom'] },
    /* Nov */ { name: 'November', ground: '#54473a', blade: '#54473a', tip: '#7b6a52', tuft: '#5f5143', text: '#f5f3e1', muted: '#dccfba', flowers: ['mapleLeaf', 'mushroom'] },
    /* Dez */ { name: 'Dezember', ground: '#e8eef1', blade: '#e8eef1', tip: '#cbd6dc', tuft: '#d5dee3', text: '#2b2118', muted: '#5d6b75', flowers: ['snowball', 'treeGifts'], snow: true },
  ];

  // 12 animals in a circle: month m has animals m and m+1, so every month keeps one from the
  // month before and brings one new (December: squirrel and robin, January: robin and mouse).
  const CYCLE = ['robin', 'mouse', 'hare', 'ladybug', 'worm', 'bee', 'butterfly', 'grasshopper', 'dragonfly', 'snail', 'hedgehog', 'squirrel'];
  const animalsOf = (month) => [CYCLE[month], CYCLE[(month + 1) % 12]];

  // ---- pixel art -------------------------------------------------------------------------------
  const STEM = '#2f6a22';
  const FLOWERS = {
    snowdrop: { rows: ['..s..', '..sw.', '..www', '..ww.', '..s..', '..s..', '.ss..'], c: { s: STEM, w: '#ffffff' } },
    crocus: { rows: ['.p.p.', '.ppp.', '.pyp.', '..p..', '..s..', '.ss..', '..s..'], c: { p: '#9b6ad6', y: '#f2c94c', s: STEM } },
    tulipRed: { rows: ['r.r.r', 'rrrrr', '.rrr.', '..s..', '.ss..', '..s..', '..s..'], c: { r: '#d9302a', s: STEM } },
    tulipYellow: { rows: ['y.y.y', 'yyyyy', '.yyy.', '..s..', '..ss.', '..s..', '..s..'], c: { y: '#f2c94c', s: STEM } },
    daisy: { rows: ['.w.w.', 'wwyww', '.w.w.', '..s..', '.ss..', '..s..'], c: { w: '#ffffff', y: '#f2c94c', s: STEM } },
    dandelion: { rows: ['.yyy.', 'yyyyy', '.yyy.', '..s..', '..ss.', '..s..', '..s..'], c: { y: '#f6d02f', s: STEM } },
    poppy: { rows: ['.rrr.', 'rrkrr', '.rrr.', '..s..', '..s..', '.ss..', '..s..'], c: { r: '#e0352b', k: '#1d1a14', s: STEM } },
    cornflower: { rows: ['b.b.b', '.bbb.', 'b.b.b', '..s..', '..ss.', '..s..'], c: { b: '#3d6fe0', s: STEM } },
    sunflower: { rows: ['.yyy.', 'yybyy', 'ybbby', 'yybyy', '.yyy.', '..s..', '.ss..', '..s..', '..s..'], c: { y: '#f6c12f', b: '#6b3f1d', s: STEM } },
    wheat: { rows: ['..y..', '.yy..', '..yy.', '.yy..', '..yy.', '..s..', '..s..', '..s..'], c: { y: '#e2bd5a', s: '#8e8a3a' } },
    chamomile: { rows: ['.w.w.', 'wwyww', '.wyw.', '..s..', '..s..', '.ss..'], c: { w: '#ffffff', y: '#f2c94c', s: STEM } },
    aster: { rows: ['p.p.p', '.pyp.', 'p.p.p', '..s..', '.ss..', '..s..'], c: { p: '#a77be0', y: '#f2c94c', s: '#4d6a2a' } },
    leaf: { rows: ['..o..', '.ooo.', 'ooooo', '.o.o.'], c: { o: '#e08a2a' } },
    leafRed: { rows: ['.r...', 'rrr..', '.rrr.', '..r..'], c: { r: '#c8452a' } },
    leafBrown: { rows: ['..b..', '.bbb.', 'bbbbb', '..b..'], c: { b: '#a0754a' } },
    mushroom: { rows: ['.rrr.', 'rwrrr', 'rrrwr', '..w..', '..w..'], c: { r: '#d0362a', w: '#f3ead6' } },
    hellebore: { rows: ['.w.w.', 'wwyww', '.www.', '..s..', '.ss..'], c: { w: '#ffffff', y: '#e9c64b', s: STEM } },
    // Christmas tree, December with presents underneath
    tree: { s: 1, rows: [
      '......Y......',
      '.....YYY.....',
      '......g......',
      '.....ggG.....',
      '....gggGG....',
      '...ggggggG...',
      '....gggGG....',
      '...ggggggG...',
      '..gggggggGG..',
      '.ggggggggggG.',
      '...ggggggG...',
      '..gggggggGG..',
      '.gggggggggGG.',
      'ggggggggggGGG',
      '.....ttt.....',
    ], c: { Y: '#f6d02f', g: '#2f7a3a', G: '#1f5a2a', r: '#e0352b', b: '#3d6fe0', y: '#f6c12f', t: '#6b4a2a', k: '#3a2a1a', w: '#f1ece2', p: '#a77be0', d: '#a82418', e: '#2a4fa8' } },
    treeGifts: { s: 1, rows: [
      '..........Y..........',
      '.........YYY.........',
      '..........g..........',
      '.........ggG.........',
      '........gggGG........',
      '.......ggggggG.......',
      '........gggGG........',
      '.......ggggggG.......',
      '......gggggggGG......',
      '..y.y..ggggggggG.....',
      '...y...ggggggG.......',
      '.rryrrdggggggGGbbwbe.',
      '.yyyyydgggggggGwwwwe.',
      '.rryrrdgggggggGbbwbe.',
      '.rryrrd..ttt...bbwbe.',
    ], c: { Y: '#f6d02f', g: '#2f7a3a', G: '#1f5a2a', r: '#e0352b', b: '#3d6fe0', y: '#f6c12f', t: '#6b4a2a', k: '#3a2a1a', w: '#f1ece2', p: '#a77be0', d: '#a82418', e: '#2a4fa8' } },

    // ---- the corner's story through the year (small: max. 7 rows) ----
    snowman: { rows: ['..kkk..', '.kkkkk.', '.wkwkw.', '.wwwwoo', '.rrrrr.', 'wwwkwwg', '.wwwwg.'], c: { k: '#2b2118', w: '#ffffff', g: '#b9c4cb', o: '#e8742a', r: '#d9302a' } },
    snowmanMelt: { rows: ['.......', '.......', '...kkk.', '.wkwkwo', '.rrrrr.', 'gwwwwgg'], c: { k: '#2b2118', w: '#ffffff', g: '#b9c4cb', o: '#e8742a', r: '#d9302a' } },
    hatCarrot: { rows: ['.kk....', 'kkkk.oo'], c: { k: '#2b2118', o: '#e8742a' } },
    // peeks in from the right edge: its frame runs out of the picture
    bike: { s: 1, peek: true, rows: [
      '...bpyb.kffkk.......',
      '..wwwwww.f..........',
      '..wdwdww.fffffffffff',
      '..wwwwww.f..........',
      '....ttttkff.........',
      '...trrrrft.ff.......',
      '..tr.s..frt..ff.....',
      '.tr..s.fs.rt...f....',
      '.trss.sf..rt....ff..',
      '.tr..shs..rt......ff',
      '.tr..ss.ssrt........',
      '.tr.s..s..rt........',
      '..tr...s.rt.........',
      '...trrrrrt..........',
      '....ttttt...........',
    ], c: {'t':  '#2b2118',  'r':  '#c9c9c9',  's':  '#a8a8a8',  'h':  '#5a5a5a',  'f':  '#2f6fd0',  'k':  '#3a2a1a',  'y':  '#f6c12f',  'b':  '#e84393',  'p':  '#ffffff',  'w':  '#c99a5a',  'd':  '#8a6236'} },
    sunYoung: { s: 1, rows: [
      '..GGG..',
      '.GgggG.',
      '..GgG..',
      '...s...',
      '.oo.s..',
      'olllos.',
      '.ooos..',
      '...s...',
      '...soo.',
      '...sllo',
      '...soo.',
      '...s...',
    ], c: {'s':  '#2e5a1a',  'l':  '#8fd05a',  'o':  '#2f5f1c',  'g':  '#8fd05a',  'G':  '#2e5a1a'} },
    sunBud: { s: 1, rows: [
      '..YyY..',
      '.YGgGY.',
      '.yGGGy.',
      '..YyY..',
      '...s...',
      '.oo.s..',
      'olllos.',
      '.ooos..',
      '...s...',
      '...soo.',
      '...sllo',
      '...soo.',
      '...s...',
    ], c: {'y':  '#f6c12f',  'Y':  '#d99a16',  's':  '#2e5a1a',  'l':  '#8fd05a',  'o':  '#2f5f1c',  'g':  '#8fd05a',  'G':  '#2e5a1a'} },
    sunBloom: { s: 1, rows: [
      '..YyyyY..',
      '.yyybyyy.',
      'yyybbbyyy',
      'Yybbbbbyy',
      'yyybbbyyY',
      '.yyybyyy.',
      '..YyyyY..',
      '....s....',
      '.oo.s....',
      'olllos...',
      '.ooos....',
      '....s.oo.',
      '....sollo',
      '....s.oo.',
      '....s....',
    ], c: {'y':  '#f6c12f',  'Y':  '#d99a16',  'b':  '#6b3f1d',  's':  '#2e5a1a',  'l':  '#8fd05a',  'o':  '#2f5f1c'} },
    umbrella: { s: 1, rows: [
      '.......k.......',
      '....rrrwrrr....',
      '..rrrwwrwwrrr..',
      '.rrrwwrrrwwrrr.',
      'rrrrwrrrrrwrrrr',
      'RrRrRrRkRrRrRrR',
      '.......k.......',
      '.......k.......',
      '.......k.......',
      '.......k.......',
      '.......k.......',
      '.......k..k....',
      '........kk.....',
    ], c: {'k':  '#3a2a1a',  'r':  '#d9302a',  'R':  '#a82418',  'w':  '#f1ece2'} },
    hay: { s: 1, rows: [
      '...kkkkkkkkkkkkkk.',
      '..khyyhyyyybbyyyyk',
      '.khyyyyyhyyybbyyyk',
      'kooooooooooobbdddk',
      'koyooyoooyoobbdodk',
      'kooyooooyooobbdddk',
      'koooyooyooobbbdodk',
      'koyoooooooyobbdddk',
      'kooooyoooooobbdodk',
      '.kkkkkkkkkkkkkkkk.',
    ], c: { k: '#5a3412', y: '#f2c44a', h: '#ffe39a', o: '#dc9a2c', d: '#a8641e', b: '#6b3414' } },
    lantern: { s: 1, rows: [
      '...kkk...',
      '..k...k..',
      '..k...k..',
      '...kmk...',
      '..kmMmk..',
      '.kmMmmmk.',
      '.kogggok.',
      '.kgffFgk.',
      '.kgfFfgk.',
      '.kogffok.',
      '.kmmmmmk.',
      '..kmMmk..',
      '.kkkkkkk.',
    ], c: { k: '#2b1a10', m: '#7a3f22', M: '#a85a32', o: '#c05a1a', g: '#e8902a', f: '#ffc95a', F: '#fff2c0' } },
    chestnut: { s: 1, rows: [
      '..h.h.h........',
      '.hHhHhHh..kk...',
      'hHHHHHHHhkcck..',
      '.HwwwwwHkcclcck',
      '..HHHHHkccclcCk',
      '.......kcccccCk',
      '.......kccccCCk',
      '........kbbbbk.',
      '.........kkkk..',
    ], c: { h: '#7a9a32', H: '#4f6a1a', w: '#e8e0b8', k: '#3a1a0a', c: '#8a4220', l: '#c07848', C: '#5a2812', b: '#d8c49a' } },
    pumpkinFace: { rows: ['...sl..', '.OoOoO.', 'OoyoyoO', 'OoooooO', 'OoyyyoO', '.OoOoO.'], c: { s: '#5a4a1d', l: '#5c9a3a', o: '#e8862a', O: '#b8601a', y: '#ffd76a' } },
    // drawn 1:1 (s: 1), finer than the other props; tilted to the right, lying on the ground
    mapleLeaf: { s: 1, rows: [
      '...........k.....',
      '....k..kk.kdk....',
      '...kdkkodkodk....',
      '...kdooooovdkk...',
      '....kovoovvoodk..',
      '.kkkkovoovoodk...',
      'kddoooovovoodkkk.',
      '.kkdooovvovvvoddk',
      '...kooovvvvoodkk.',
      '..kdddovoooodk...',
      '...kkkovdooodk...',
      '.....kvvkdodddk..',
      '......vk.kdkkkdk.',
      '.....vv...k...k..',
      '.....v...........',
    ], c: { k: '#6b3414', o: '#c8682a', d: '#a8501e', v: '#7a3a16' } },
    leafPile: { rows: ['..o.r.', 'robboo', 'obrrob'], c: { o: '#d9822a', r: '#b5452a', b: '#8a5a2a' } },
    snowball: { rows: ['.wwg.', 'wwwwg', 'wwwgg', '.ggg.'], c: { w: '#ffffff', g: '#b9c4cb' } },
  };

  // A new Farmies version: a hanging sign (like an inn's) in the corner instead of the month's props,
  // swinging gently on its chains. Drawn 1:1 (finer than the props). Clicking it installs the update.
  const NEW_TEXT = ['#..#.###.#...#', '##.#.#...#...#', '#.##.###.#.#.#', '#..#.#...#.#.#', '#..#.###..#.#.'];
  const SIGN = {
    c: { o: '#3b2414', w: '#e8c48a', h: '#f7dfb0', r: '#b8401a', p: '#8a5a2b', k: '#c9c3b2' },
    // post on the right with the arm on top
    gallows: [
      'oooooooooooooooooooooooo',
      'ppppppppppppppppppppppop',
      'oooooooooooooooooooooopo',
      ...Array.from({ length: 13 }, () => '.....................opo'),
    ],
    // the board, hanging from the arm on two chains (x 0 and 15); it starts 2 px left of the arm, so
    // it never swings into the post
    board: [
      'oooooooooooooooooooo',
      'ohhhhhhhhhhhhhhhhhho',
      ...NEW_TEXT.map((r) => `oww${r.replace(/#/g, 'r').replace(/\./g, 'w')}wwo`),
      'owwwwwwwwwwwwwwwwwwo',
      'oooooooooooooooooooo',
    ],
    chains: [0, 15],
    boardX: -2,
    boardY: 5,
  };
  SIGN.rows = SIGN.gallows;
  const SIGN_BOX = { x: W - 4 - SIGN.gallows[0].length, y: H - 2 - SIGN.gallows.length, w: SIGN.gallows[0].length, h: SIGN.gallows.length };
  const SIGN_HIT = { x: SIGN_BOX.x - 5, y: SIGN_BOX.y, w: SIGN_BOX.w + 5, h: SIGN_BOX.h }; // incl. the board swinging out
  // swing: board and chains swing like a pendulum from the hooks on the arm. The further down, the
  // further out: chains lean, the side edges lean (pixel stairs), the letters go along as one block.
  // Values: how far the bottom edge is out, in pixels.
  const SWING = [0, 1, 2, 3, 3, 2, 1, 0, -1, -2, -3, -3, -2, -1];
  const SWING_STEP = 0.2; // s per step

  function drawSign(ctx, time) {
    const { x, y } = SIGN_BOX;
    SIGN.gallows.forEach((line, dy) => [...line].forEach((ch, dx) => {
      if (!SIGN.c[ch]) return;
      ctx.fillStyle = SIGN.c[ch];
      ctx.fillRect(x + dx, y + dy, 1, 1);
    }));
    const out = SWING[Math.floor(time / SWING_STEP) % SWING.length];
    const part = (f) => Math.sign(out) * Math.round(Math.abs(out) * f);
    const bh = SIGN.board.length;
    // offset of a board row: top edge a third, letters two thirds, bottom edge the whole way
    const offset = (row) => (row < 2 ? part(1 / 3) : row < bh - 2 ? part(2 / 3) : out);
    const top = y + SIGN.boardY;
    SIGN.board.forEach((line, row) => [...line].forEach((ch, col) => {
      if (!SIGN.c[ch]) return;
      ctx.fillStyle = SIGN.c[ch];
      ctx.fillRect(x + SIGN.boardX + col + offset(row), top + row, 1, 1);
    }));
    // chains: from the hook on the arm down to the board's top edge, leaning with it
    ctx.fillStyle = SIGN.c.k;
    for (const cx of SIGN.chains) {
      for (let cy = y + 3; cy < top; cy++) ctx.fillRect(x + cx + (cy === y + 3 ? 0 : part(1 / 3)), cy, 1, 1);
    }
  }

  // animals: two frames each, facing left (they come from the right); s: 1 = drawn 1:1 in meadow
  // pixels (finer), otherwise 2x2
  const ANIMALS = {
    bee: { label: 'Biene', frames: [['.ww.', 'kyky', 'ykyk'], ['....', 'kyky', 'wkyw']], c: { w: '#dff1ff', y: '#f6c12f', k: '#1d1a14' }, move: 'fly' },
    butterfly: { label: 'Schmetterling', frames: [['pp.pp', 'pokop', '.pkp.', '..k..'], ['.....', '.pkp.', '.pkp.', '..k..']], c: { p: '#e84393', o: '#f6c12f', k: '#1d1a14' }, move: 'flutter' },
    ladybug: {
      label: 'Marienkäfer',
      s: 1,
      frames: [
      [
        '....rrrr...',
        '..rrhrrkrr.',
        '.kkrrrrrrrr',
        'kwkrkkrrkkr',
        'kkkrkkrrkkr',
        '.kkrrrrkrrr',
        '..rrkrrrrr.',
        '..k..k..k..',
      ],
      [
        '....rrrr...',
        '..rrhrrkrr.',
        '.kkrrrrrrrr',
        'kwkrkkrrkkr',
        'kkkrkkrrkkr',
        '.kkrrrrkrrr',
        '..rrkrrrrr.',
        '.k..k..k...',
      ],
      ],
      c: { r: '#d9302a', h: '#ef5a48', k: '#1d1a14', w: '#f1ece2' },
      move: 'crawl',
    },
    hare: {
      label: 'Hase',
      s: 1,
      frames: [
      [
        '...bb.bb........',
        '...bp.bp........',
        '...bb.bb........',
        '..bbbbbb........',
        '.bkbbbbbbbbbb...',
        'pbbbbbbbbbbbbbw.',
        '.wbbbbbbbbbbbbww',
        '..bbbbdbbbbbbbw.',
        '..bd..dd...bdd..',
        '.dd...dd..ddd...',
      ],
      [
        '..bb.bb.........',
        '..bp.bp.........',
        '...bb.bb........',
        '..bbbbbb........',
        '.bkbbbbbbbbbb...',
        'pbbbbbbbbbbbbbw.',
        '.wbbbbbbbbbbbbww',
        '..bbbbdbbbbbbb..',
        '.dd...d..ddd....',
        'dd.....d.dd.....',
      ],
      ],
      c: { b: '#b49a78', d: '#8f7658', w: '#f1ece2', k: '#1d1a14', p: '#e9a3ab' },
      move: 'hop',
    },
    hedgehog: {
      label: 'Igel',
      s: 1,
      frames: [
      [
        '.....s.s.s.....',
        '....sdsssdss...',
        '...ssssdsssds..',
        '..fssdsssdsssd.',
        '.ffkssssdsssss.',
        'pfffwwwwwwwwwss',
        '..ff.f.....f.f.',
      ],
      [
        '.....s.s.s.....',
        '....sdsssdss...',
        '...ssssdsssds..',
        '..fssdsssdsssd.',
        '.ffkssssdsssss.',
        'pfffwwwwwwwwwss',
        '...f.f....f.f..',
      ],
      ],
      c: { s: '#6b4a2e', d: '#4a301c', f: '#e8cfae', k: '#1d1a14', p: '#3a2a1a', w: '#efe6d6' },
      move: 'walk',
    },
    snail: {
      label: 'Schnecke',
      s: 1,
      frames: [
      [
        'y.y..........',
        '.y.y...ssss..',
        '.yyy..sooooo.',
        'ykyy.sossssos',
        'yyyy.sosoosos',
        '.yyy.soosssos',
        '.yyyyysooooy.',
        'yyyyyyyyyyyyy',
      ],
      [
        '.y.y.........',
        '.y.y...ssss..',
        '.yyy..sooooo.',
        'ykyy.sossssos',
        'yyyy.sosoosos',
        '.yyy.soosssos',
        '.yyyyysooooy.',
        '.yyyyyyyyyyyy',
      ],
      ],
      c: { y: '#e8b030', d: '#b98a20', s: '#c8862e', o: '#8a5a1a', k: '#1d1a14' },
      move: 'creep',
    },
    robin: {
      label: 'Rotkehlchen',
      s: 1,
      frames: [
      [
        '...bbbb.....',
        '..bbbbbb....',
        '.brkrbbbb...',
        'krrrrrbbll..',
        '.rrrrrrbbll.',
        '.rrrrrlllbbb',
        '..wrrrlllbbb',
        '..wwwwwllb..',
        '...wwwww....',
        '....y.y.....',
        '...yy.yy....',
      ],
      [
        '............',
        '...bbbb.....',
        '..bbbbbb....',
        '.brkrbbbb...',
        'krrrrrbblll.',
        '.rrrrrrbblbb',
        '..wrrrllllbb',
        '..wwwwwllb..',
        '...wwwww....',
        '....y.y.....',
        '...yy.yy....',
      ],
      ],
      c: { b: '#7a5a3a', l: '#a07a4c', r: '#e0602e', w: '#f1ece2', k: '#1d1a14', y: '#4a3a2a', o: '#c9a06a' },
      move: 'hopfly',
    },
    worm: { label: 'Regenwurm', frames: [['.......', 'p.pp.pp', 'pp..pp.'], ['.......', '.ppp.pp', 'p...pp.']], c: { p: '#d9837a' }, move: 'creep' },
    grasshopper: {
      label: 'Grashüpfer',
      s: 1,
      frames: [
      [
        '..l.............',
        '...l.......bb...',
        '....l.....b..b..',
        '..ggggggggb...b.',
        '.gkgllllllllgdb.',
        'ggggggggggggdddd',
        '.dgdddddddddd.b.',
        '..b.b..b.....b..',
        '.b..b...b.....b.',
      ],
      [
        '...l............',
        '...l........bb..',
        '....l......b..b.',
        '..ggggggggb....b',
        '.gkgllllllllgdb.',
        'ggggggggggggdddd',
        '.dgdddddddddd.b.',
        '.b..b.b......b..',
        'b...b..b.....b..',
      ],
      ],
      c: { g: '#6fae3a', l: '#9ed05a', d: '#3f7a24', k: '#1d1a14', b: '#7a6a3a' },
      move: 'hop',
    },
    dragonfly: {
      label: 'Libelle',
      s: 1,
      frames: [
      [
        '...vvvvv.vvvvv......',
        '..vwwwwwvwwwwwv.....',
        '.kygggggggggggggdddd',
        '..vwwwwwvwwwwwv.....',
        '...vvvvv.vvvvv......',
      ],
      [
        '....................',
        '.....vvvv.vvvv......',
        '.kygggggggggggggdddd',
        '..vwwwwwvwwwwwv.....',
        '.vwwwwwv.vwwwwwv....',
      ],
      ],
      c: { w: '#e3f1f6', v: '#b9d6e0', g: '#2f8a5a', d: '#1f5a3c', k: '#1d1a14', y: '#c9a24a' },
      move: 'fly',
    },
    squirrel: {
      label: 'Eichhörnchen',
      s: 1,
      frames: [
      [
        '..r.........tt..',
        '.rr........tttt.',
        '.rrrr.....tttdt.',
        'krkrr.....ttdtt.',
        'rrrrrr....tdtt..',
        '.wwrrrr..ttdt...',
        '..wwrrrrrtdt....',
        '..wwrrrrrrt.....',
        '...wrrrrdd......',
        '..rr..rrdd......',
      ],
      [
        '..r..........tt.',
        '.rr.........tttt',
        '.rrrr......tttdt',
        'krkrr......ttdtt',
        'rrrrrr.....tdtt.',
        '.wwrrrr...tdt...',
        '..wwrrrrrtdt....',
        '..wwrrrrrrt.....',
        '...wrrrrdd......',
        '.rr...rrdd......',
      ],
      ],
      c: { r: '#c8642a', d: '#9a4a1e', w: '#f1ece2', k: '#1d1a14', t: '#e07a3a' },
      move: 'hop',
    },
    mouse: {
      label: 'Maus',
      s: 1,
      frames: [
      [
        '.....gg.........',
        '....gppg........',
        '...gggggggg.....',
        '..gkgggggggg....',
        '.ggggggggggggg..',
        'pggggwwwgggggd..',
        '...dd......dd.tt',
        '...............t',
      ],
      [
        '.....gg.........',
        '....gppg........',
        '...gggggggg.....',
        '..gkgggggggg....',
        '.ggggggggggggg..',
        'pggggwwwgggggd.t',
        '....dd....dd..t.',
        '................',
      ],
      ],
      c: { g: '#9a948e', d: '#77716b', p: '#e9a3ab', k: '#1d1a14', t: '#d99aa0', w: '#c9c3bc' },
      move: 'scurry',
    },
  };

  // where the visitor rests, and where the flowers stand (bottom right corner)
  const REST_X = W - ZONE + 1; // the visitor rests at the zone's left edge

  function hash(n) {
    let x = Math.sin(n * 12.9898) * 43758.5453;
    return x - Math.floor(x);
  }

  function put(ctx, rows, colors, x, y, flip = false, S = 2) {
    rows.forEach((line, dy) => [...line].forEach((ch, dx) => {
      const c = colors[ch];
      if (!c) return;
      ctx.fillStyle = c;
      ctx.fillRect(Math.round(x) + (flip ? line.length - 1 - dx : dx) * S, Math.round(y) + dy * S, S, S);
    }));
  }

  function drawGround(ctx, month, sign = false, time = 0) {
    const m = MONTHS[month];
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = m.ground;
    ctx.fillRect(0, EDGE, W, H - EDGE);
    // grass tips along the top edge, same pattern every month
    for (let x = 0; x < W; x++) {
      const h = hash(x + 1) < 0.35 ? 3 : hash(x + 99) < 0.55 ? 2 : 1;
      for (let k = 0; k < h; k++) {
        ctx.fillStyle = k === h - 1 ? m.tip : m.blade;
        ctx.fillRect(x, EDGE - 1 - k + 1, 1, 1);
      }
    }
    // texture: small tufts
    ctx.fillStyle = m.tuft;
    for (let i = 0; i < 40; i++) {
      const x = Math.floor(hash(i + 300) * W);
      const y = EDGE + 3 + Math.floor(hash(i + 700) * (H - EDGE - 5));
      ctx.fillRect(x, y, 1, 1);
      ctx.fillRect(x + 1, y - 1, 1, 1);
    }
    if (m.snow) {
      ctx.fillStyle = '#ffffff';
      for (let i = 0; i < 18; i++) ctx.fillRect(Math.floor(hash(i + 900) * W), EDGE + 2 + Math.floor(hash(i + 950) * (H - EDGE - 4)), 1, 1);
    }
    if (sign) {
      drawSign(ctx, time);
      return;
    }
    // flowers, bottom right
    // the story prop stands in the corner, the small ones to its left
    let x = W - 4;
    const LIFT = [3, 1, 0]; // logical px: the corner piece sits a bit higher, not all on one line
    m.flowers.forEach((f, i) => {
      const fl = FLOWERS[f];
      const s = fl.s || S;
      const rows = fl.rows.slice(0, Math.floor(15 / s)); // at most 15 meadow px high
      x = fl.peek ? W - rows[0].length * s : x - rows[0].length * s;
      put(ctx, rows, fl.c, x, GROUND_Y + 1 - rows.length * s - (fl.peek ? 0 : LIFT[i]), false, s);
      x -= 3;
    });
  }

  function drawAnimal(ctx, a) {
    if (!a || a.phase === 'away') return;
    const sp = ANIMALS[a.kind];
    const rows = sp.frames[a.frame % 2];
    const s = sp.s || S;
    put(ctx, rows, sp.c, a.x, a.y - rows.length * s + 1, a.flip, s);
  }

  /**
   * The meadow's visitor: now and then an animal of the season comes into the bottom right corner
   * and stays there until the pointer comes close. The renderer calls step() every frame (also while
   * the panel is hidden, so the time runs on) and draw() while the meadow is visible.
   * opts: { month, minDelay, maxDelay (s, between two visitors), firstDelay (s, after the start) }
   */
  class Meadow {
    constructor(opts = {}) {
      this.month = opts.month ?? new Date().getMonth();
      this.minDelay = opts.minDelay ?? 3600; // a new visitor every 1 to 3 hours
      this.maxDelay = opts.maxDelay ?? 10800;
      this.a = { phase: 'away', wait: opts.firstDelay ?? 120 + Math.random() * 480 };
      this.mouse = null;
      this.sign = false; // a new version: the hanging sign stands in the corner
      this.time = 0;
    }

    /** Whether a point (meadow pixels) is on the signpost. */
    onSign(x, y) {
      return this.sign && x >= SIGN_HIT.x && x < SIGN_HIT.x + SIGN_HIT.w && y >= SIGN_HIT.y && y < SIGN_HIT.y + SIGN_HIT.h;
    }

    /** Pointer position in meadow pixels, or null when it left. */
    pointer(x, y) {
      this.mouse = x === null || x === undefined ? null : { x, y };
    }

    setMonth(m) {
      if (m === this.month) return;
      this.month = m;
      this.a = { phase: 'away', wait: 60 };
    }

    draw(ctx) {
      drawGround(ctx, this.month, this.sign, this.time);
      drawAnimal(ctx, this.a);
    }

    arrive() {
      const kinds = animalsOf(this.month);
      const kind = kinds[Math.floor(Math.random() * kinds.length)];
      const move = ANIMALS[kind].move;
      const flying = ['fly', 'flutter'].includes(move);
      const fromLeft = Math.random() < 0.5;
      this.a = { kind, move, phase: 'arriving', fromLeft, x: fromLeft ? -16 : W + 4, y: flying ? 10 : GROUND_Y, t: 0, frame: 0, flip: fromLeft, restY: flying ? GROUND_Y - 8 : GROUND_Y };
    }

    step(dt) {
      this.time += dt;
      const a = this.a;
      if (a.phase === 'away') {
        a.wait -= dt;
        if (a.wait <= 0) this.arrive();
        return;
      }
      a.t += dt;
      const SPEED = { fly: 26, flutter: 18, crawl: 6, hop: 28, walk: 9, creep: 2.5, hopfly: 22, scurry: 45 };
      const v = SPEED[a.move];
      if (a.phase === 'arriving') {
        a.x += (a.fromLeft ? 1 : -1) * v * dt;
        const far = Math.abs(a.x - REST_X);
        if (a.move === 'fly') a.y = a.restY - 4 + Math.sin(a.t * 6) * 2 - Math.min(10, far * 0.1);
        if (a.move === 'flutter') a.y = a.restY - 3 + Math.sin(a.t * 3) * 3 - Math.min(10, far * 0.1);
        if (a.move === 'hop' || a.move === 'hopfly') a.y = GROUND_Y - Math.abs(Math.sin(a.t * 5)) * 5;
        a.frame = Math.floor(a.t * (a.move === 'creep' ? 1 : 6));
        if (a.fromLeft ? a.x >= REST_X : a.x <= REST_X) {
          a.x = REST_X;
          a.flip = false;
          a.y = a.restY;
          a.phase = 'resting';
          a.t = 0;
        }
        return;
      }
      if (a.phase === 'resting') {
        // small signs of life: wings, sniffing, now and then
        const slow = { fly: 0.8, flutter: 0.5, crawl: 0.4, hop: 0.3, walk: 0.5, creep: 0, hopfly: 0.4, scurry: 0.6 }[a.move];
        a.frame = Math.floor(a.t * slow) % 2;
        if (a.move === 'fly' || a.move === 'flutter') a.y = a.restY + (Math.floor(a.t * 1.5) % 2);
        const m = this.mouse;
        if (m && Math.hypot(m.x - (a.x + 6), m.y - (a.y - 4)) < 26) {
          a.phase = 'leaving';
          a.t = 0;
          a.flip = true; // turn and go back out to the right
        }
        return;
      }
      if (a.phase === 'leaving') {
        const fast = { fly: 2, flutter: 1.6, crawl: 1.4, hop: 1.6, walk: 1.8, creep: 1.2, hopfly: 2, scurry: 1.6 }[a.move];
        a.x += v * fast * dt;
        if (a.move === 'fly' || a.move === 'flutter' || (a.move === 'hopfly' && a.t > 0.3) || (a.move === 'crawl' && a.t > 0.6)) {
          a.y -= v * 0.6 * dt; // takes off (the ladybug opens its wings after a few steps)
        } else if (a.move === 'hop' || a.move === 'hopfly') {
          a.y = GROUND_Y - Math.abs(Math.sin(a.t * 7)) * 6;
        }
        a.frame = Math.floor(a.t * 8);
        if (a.x > W + 8 || a.y < -8) {
          this.a = { phase: 'away', wait: this.minDelay + Math.random() * (this.maxDelay - this.minDelay) };
        }
      }
    }
  }

  // static frame for screenshots: the animal resting in the corner
  function renderStatic(canvas, month, kind, x = REST_X) {
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    drawGround(ctx, month);
    (Array.isArray(kind) ? kind : [kind]).filter(Boolean).forEach((k, i) => {
      const flying = ['fly', 'flutter'].includes(ANIMALS[k].move);
      drawAnimal(ctx, { kind: k, phase: 'resting', x: x - i * 22, y: flying ? GROUND_Y - 8 : GROUND_Y, frame: 0 });
    });
  }

  const api = { W, H, ZONE, REST_X, SIGN, SIGN_BOX, MONTHS, CYCLE, animalsOf, ANIMALS, FLOWERS, Meadow, drawGround, renderStatic };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Meadow = api;
})(this);
