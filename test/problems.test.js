// Problem dialogs and their prefilled GitHub issues (src/problems.js).
const { test } = require('node:test');
const assert = require('node:assert');
const { issueUrl, windowNotFound, extensionInstallFailed } = require('../src/problems');

const s = { term: 'cursor', distro: 'Ubuntu', pids: [3, 2, 1] };

test('problems: issue link carries title and body, cut to fit into a URL', () => {
  const url = issueUrl('Titel ä', 'Zeile 1\nZeile 2');
  assert.ok(url.startsWith('https://github.com/gustganz/farmies/issues/new?title=Titel%20%C3%A4&body='));
  assert.strictEqual(new URL(url).searchParams.get('body'), 'Zeile 1\nZeile 2');
  const long = issueUrl('x', 'y'.repeat(50000));
  assert.ok(long.length <= 7000);
  assert.ok(new URL(long).searchParams.get('body').endsWith('…'));
});

test('problems: window not found asks for a reload while a window runs the old extension', () => {
  const p = windowNotFound(s, [{ pid: 0 }, { pid: 0, shells: [5], version: '0.3.1' }], '0.1.18');
  assert.match(p.message, /Cursor-Fenster bitte einmal neu laden/);
  assert.strictEqual(p.issue, undefined);
});

test('problems: window not found with current extensions offers an issue', () => {
  const p = windowNotFound(s, [{ pid: 0, shells: [5], version: '0.3.1' }], '0.1.18');
  assert.match(p.message, /findet das Cursor-Fenster/);
  assert.match(p.issue.body, /Farmies: 0\.1\.18/);
  assert.match(p.issue.body, /Versionen: 0\.3\.1/);
  assert.match(windowNotFound(s, [], '0.1.18').issue.body, /meldet: 0$/m);
});

test('problems: failed extension install reports what the installer printed', () => {
  const p = extensionInstallFailed([{ editor: '.cursor-server', output: 'Error: boom' }], '0.1.18');
  assert.match(p.issue.title, /\.cursor-server/);
  assert.match(p.issue.body, /```\nError: boom\n```/);
});
