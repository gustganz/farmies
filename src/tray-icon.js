// Tray icon: a small red farm house (own pixel art), the same for every animal.
const BARN = [
  '.......#........',
  '......###.......',
  '.....##R##......',
  '....##RRR##.....',
  '...##RRRRR##....',
  '..##RWW#WWR##...',
  '.##RRWW#WWRR##..',
  '##RRRRRRRRRRR##.',
  '.#RRRRRRRRRRR#..',
  '.#RRRRRRRRRRR#..',
  '.#RRRoooooRRR#..',
  '.#RRRoO#OoRRR#..',
  '.#RRRoO#OoRRR#..',
  '.#RRRoO#OoRRR#..',
  '.#RRRoO#OoRRR#..',
  '.#############..',
];
const COLORS = {
  '#': [60, 60, 64], // roof, outline, window bars
  R: [200, 68, 47], // walls
  W: [242, 242, 238], // window panes
  O: [224, 145, 60], // door
  o: [168, 90, 30], // door frame
};
const SIZES = [16, 24, 32, 48];

// BGRA bitmap of the barn scaled to `size` (nearest neighbour)
function bitmap(size) {
  const n = BARN.length;
  const buf = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const color = COLORS[BARN[Math.floor((y * n) / size)][Math.floor((x * n) / size)]];
      if (!color) continue;
      const o = (y * size + x) * 4;
      buf[o] = color[2];
      buf[o + 1] = color[1];
      buf[o + 2] = color[0];
      buf[o + 3] = 255;
    }
  }
  return buf;
}

/** nativeImage with sharp versions for the common display scalings (16px base). */
function trayIcon(nativeImage) {
  const image = nativeImage.createEmpty();
  for (const size of SIZES) {
    image.addRepresentation({ scaleFactor: size / 16, width: size, height: size, buffer: bitmap(size) });
  }
  return image;
}

module.exports = { trayIcon, BARN, COLORS };
