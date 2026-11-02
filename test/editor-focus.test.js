// Finding the editor window of a session from what the companion extension reports (src/editor-focus.js).
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { focusedTerminalPids, editorWindowFor } = require('../src/editor-focus');

function home(windows) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'farmies-'));
  fs.mkdirSync(path.join(dir, '.farmies', 'editor-focus'), { recursive: true });
  windows.forEach((w, i) => fs.writeFileSync(path.join(dir, '.farmies', 'editor-focus', `${i}.json`), JSON.stringify(w)));
  return dir;
}

test('editor window: found by the shell of the session, not by its folder', () => {
  const h = home([
    { pid: 0, shells: [11, 12], name: 'other', folder: '/home/u/other' },
    { pid: 21, shells: [21], name: 'website [WSL: Ubuntu]', folder: '/home/u/website' },
  ]);
  // session started in /home/u/other from a terminal of the "website" window
  assert.deepStrictEqual(editorWindowFor(h, [500, 400, 21, 1]), { name: 'website', folder: '/home/u/website' });
  assert.deepStrictEqual(editorWindowFor(h, [12]), { name: 'other', folder: '/home/u/other' });
  assert.strictEqual(editorWindowFor(h, [99]), null);
  assert.strictEqual(editorWindowFor(h, []), null);
  assert.deepStrictEqual([...focusedTerminalPids(h)], [21]);
});

test('editor window: older extension (only pid) or no files give null', () => {
  assert.strictEqual(editorWindowFor(home([{ pid: 21 }]), [21]), null);
  assert.strictEqual(editorWindowFor(null, [21]), null);
  assert.strictEqual(editorWindowFor(path.join(os.tmpdir(), 'nope-farmies'), [21]), null);
});

test('editor window: without a workspace name the folder names it', () => {
  const h = home([{ pid: 0, shells: [5], name: '', folder: '/home/u/app' }]);
  assert.deepStrictEqual(editorWindowFor(h, [5]), { name: 'app', folder: '/home/u/app' });
});
