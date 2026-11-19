const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { addHooks, removeHooks } = require('../src/hook-settings');

const CMD = 'sh "$HOME/.farmies/hook.sh"';
const tmpFile = (content) => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'farmies-test-')), 'settings.json');
  if (content) fs.writeFileSync(file, JSON.stringify(content));
  return file;
};
const commands = (file) =>
  Object.values(JSON.parse(fs.readFileSync(file, 'utf8')).hooks).flatMap((groups) => groups.flatMap((g) => g.hooks.map((h) => h.command)));

test('adds every hook so that it can never block Claude', () => {
  const file = tmpFile();
  assert.ok(addHooks(file, CMD) > 0);
  const cmds = commands(file);
  assert.ok(cmds.includes(`${CMD} UserPromptSubmit || true`));
  assert.ok(cmds.every((c) => c.endsWith(' || true')));
  assert.strictEqual(addHooks(file, CMD), 0, 'second run changes nothing');
});

test('updates outdated Farmies commands, keeps other hooks', () => {
  const file = tmpFile({
    hooks: {
      Stop: [{ hooks: [{ type: 'command', command: `${CMD} Stop` }, { type: 'command', command: 'echo other' }] }],
    },
  });
  addHooks(file, CMD);
  const cmds = commands(file);
  assert.ok(cmds.includes(`${CMD} Stop || true`));
  assert.ok(!cmds.includes(`${CMD} Stop`));
  assert.ok(cmds.includes('echo other'));
  assert.strictEqual(cmds.filter((c) => / Stop( |$)/.test(c)).length, 1, 'no duplicate');
});

test('removeHooks removes only Farmies hooks', () => {
  const file = tmpFile({ hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo other' }] }] } });
  addHooks(file, CMD);
  assert.ok(removeHooks(file) > 0);
  assert.deepStrictEqual(commands(file), ['echo other']);
});

test('native Windows hooks: no "|| true" (Windows PowerShell cannot parse it), own timeout', () => {
  const file = tmpFile();
  const cmd = 'powershell.exe -NoProfile -File "C:/Users/x/.farmies/hook.ps1"';
  addHooks(file, cmd, { orTrue: false, timeout: 15 });
  const settings = JSON.parse(fs.readFileSync(file, 'utf8'));
  const hooks = Object.values(settings.hooks).flatMap((groups) => groups.flatMap((g) => g.hooks));
  assert.ok(hooks.every((h) => !h.command.includes('||') && h.timeout === 15));
  assert.ok(commands(file).includes(`${cmd} Stop`));
  assert.strictEqual(addHooks(file, cmd, { orTrue: false, timeout: 15 }), 0, 'second run changes nothing');
});
