#!/usr/bin/env node
// Writes the small update package of this checkout (src/app-package.js) to dist/:
//   node scripts/app-package.js            → dist/Farmies-<v>-app-electron-<electron>.json.gz
// Needs the built extension (npm run ext). The release workflow uploads it with the other files.
const fs = require('fs');
const path = require('path');
const { pack } = require('../src/app-package');

const ROOT = path.join(__dirname, '..');
const electron = require('electron/package.json').version;
const { name, data } = pack(ROOT, electron);
fs.mkdirSync(path.join(ROOT, 'dist'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'dist', name), data);
console.log(`dist/${name} (${Math.round(data.length / 1024)} KB)`);
