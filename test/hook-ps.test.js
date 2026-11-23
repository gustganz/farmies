// The native Windows hook (hook/farmies-hook.ps1) and the console focus script, run for real with a
// temporary USERPROFILE. Needs Windows PowerShell: runs on Windows only (CI, start job), skipped elsewhere.
const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { ensureNativeHooks } = require('../src/hooks');
const { goneNative } = require('../src/alive');

const skip = process.platform !== 'win32' && 'needs Windows PowerShell';
const ROOT = path.join(__dirname, '..');
const PS = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File'];

function setup() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'farmies hook ü-'));
  const sid = 'abc123';
  const env = { ...process.env, USERPROFILE: home };
  const input = (extra) => JSON.stringify({ session_id: sid, cwd: home, transcript_path: path.join(home, 't.jsonl'), ...extra });
  const hook = (event, extra = {}) => {
    const r = spawnSync('powershell.exe', [...PS, path.join(ROOT, 'hook', 'farmies-hook.ps1'), event], { env, input: input(extra) });
    assert.strictEqual(r.status, 0, String(r.stderr));
    return r;
  };
  const file = path.join(home, '.farmies', 'sessions', `${sid}.json`);
  const state = () => JSON.parse(fs.readFileSync(file, 'utf8'));
  return { home, sid, env, input, hook, file, state };
}

test('ps hook: state file with context, Windows paths and Claude (here: node) as cpid', { skip }, () => {
  const { home, hook, state } = setup();
  hook('UserPromptSubmit', { prompt: 'Fix the büg "now"', session_title: 'Bug fix' });
  let s = state();
  assert.strictEqual(s.event, 'UserPromptSubmit');
  assert.strictEqual(s.cwd, home);
  assert.strictEqual(s.transcript, path.join(home, 't.jsonl'));
  assert.strictEqual(s.task, 'Fix the büg "now"');
  assert.strictEqual(s.title, 'Bug fix');
  assert.strictEqual(s.distro, '');
  // the hook's parent: this test process, the first ancestor that is no shell
  assert.strictEqual(Number(s.cpid), process.pid);
  assert.match(s.cstart, /^\d+$/);
  assert.ok(s.pids.split(' ').map(Number).includes(process.pid));
  assert.ok(s.term);
  hook('Stop', { last_assistant_message: 'Done. All tests pass.' });
  s = state();
  assert.strictEqual(s.event, 'Stop');
  assert.strictEqual(s.detail, 'Done. All tests pass.');
  assert.strictEqual(s.task, 'Fix the büg "now"', 'kept');
});

test('ps hook: informational notifications keep the state, waiting ones count', { skip }, () => {
  const { hook, state } = setup();
  hook('Stop');
  hook('Notification', { notification_type: 'idle_prompt', message: 'x' });
  hook('Notification', { message: 'Claude is waiting for your input' });
  assert.strictEqual(state().event, 'Stop');
  hook('UserPromptSubmit');
  hook('PermissionRequest', { tool_name: 'Bash', tool_input: { command: 'npm test' } });
  assert.strictEqual(state().detail, 'Bash · npm test');
  hook('Notification', { notification_type: 'permission_prompt', message: 'Claude needs your permission' });
  assert.strictEqual(state().event, 'Notification');
  assert.strictEqual(state().detail, 'Bash · npm test', 'the permission request says more');
});

test('ps hook: a question stays a question; PostToolUse heartbeat once a minute', { skip }, () => {
  const { hook, file, state } = setup();
  hook('PreToolUse', { tool_name: 'AskUserQuestion', tool_input: { questions: [{ question: 'Which one?' }] } });
  assert.strictEqual(state().event, 'Question');
  assert.strictEqual(state().detail, 'Which one?');
  hook('Notification', { notification_type: 'permission_prompt', message: 'x' });
  assert.strictEqual(state().event, 'Question');
  hook('PostToolUse', { tool_name: 'AskUserQuestion' });
  assert.strictEqual(state().event, 'PostToolUse');
  const ts = state().ts;
  hook('PostToolUse', { tool_name: 'Read', tool_input: { file_path: path.join(state().cwd, 'src', 'a.js') } });
  assert.strictEqual(state().ts, ts);
  assert.strictEqual(state().step, `Read · ${path.join('src', 'a.js')}`);
  const old = state();
  old.ts -= 61;
  fs.writeFileSync(file, JSON.stringify(old));
  hook('PostToolUse', { tool_name: 'Bash', tool_input: { command: 'ls' } });
  assert.ok(state().ts > old.ts);
});

test('ps hook: background work: agents are waited for, a dev server is handed over', { skip }, () => {
  const { hook, state } = setup();
  hook('Stop', { background_tasks: [{ id: 'a', status: 'running', description: 'Explore code' }] });
  assert.strictEqual(state().event, 'Background');
  assert.strictEqual(state().detail, 'Explore code');
  hook('Stop', { background_tasks: [{ id: 'b', status: 'running', command: 'npm run dev' }], last_assistant_message: 'Server runs.' });
  assert.strictEqual(state().event, 'Stop');
  assert.strictEqual(state().bg, '1');
  assert.strictEqual(state().step, 'npm run dev');
  hook('Stop', { background_tasks: [{ id: 'c', status: 'running', command: 'npm test' }], last_assistant_message: 'Running.' });
  assert.strictEqual(state().event, 'Background');
  hook('Stop', { background_tasks: [{ id: 'c', status: 'running', command: 'npm test' }], last_assistant_message: 'Shall I go on?' });
  assert.strictEqual(state().event, 'Stop');
  // Claude asks the user: done also while an agent runs; only shells are noted
  hook('Stop', { background_tasks: [{ id: 'a', status: 'running', description: 'Explore code' }], last_assistant_message: 'Add the PDF?' });
  assert.strictEqual(state().event, 'Stop');
  assert.strictEqual(state().bg, '');
  // subagent ids and the reply are recorded; an agent's tool call does not end a wait for the user
  hook('Stop', { background_tasks: [{ id: 'a1', type: 'subagent', status: 'running', description: 'x' }, { id: 'b', status: 'running', command: 'npm test' }], last_assistant_message: 'Pushed.' });
  assert.strictEqual(state().agents, 'a1');
  assert.strictEqual(state().reply, 'Pushed.');
  hook('Stop', { background_tasks: [{ id: 'a1', type: 'subagent', status: 'running', description: 'x' }], last_assistant_message: 'Add it?' });
  hook('PostToolUse', { agent_id: 'a1', tool_name: 'Bash', tool_input: { command: 'ls' } });
  assert.strictEqual(state().event, 'Stop');
  // Claude Code's own housekeeping is not work
  hook('Stop', { background_tasks: [{ id: 'h', type: 'auto-mode scan', status: 'running', description: 'x' }], last_assistant_message: 'Pushed.' });
  assert.strictEqual(state().event, 'Stop');
  // live updates of an artifact: a subscription, not work
  const live = { id: 'w', type: 'monitor', status: 'running', description: 'live updates for artifact https://claude.ai/artifact/x (re-armed on session resume)' };
  hook('Stop', { background_tasks: [live], last_assistant_message: 'Pushed.' });
  assert.strictEqual(state().event, 'Stop');
  hook('Stop', { background_tasks: [live, { id: 'a', status: 'running', description: 'Explore code' }] });
  assert.strictEqual(state().event, 'Background');
  assert.strictEqual(state().bg, '1');
});

test('ps hook: SessionEnd removes the files; broken input never fails', { skip }, () => {
  const { home, env, hook, file } = setup();
  hook('Stop');
  assert.ok(fs.existsSync(file));
  hook('SessionEnd');
  assert.ok(!fs.existsSync(file));
  const r = spawnSync('powershell.exe', [...PS, path.join(ROOT, 'hook', 'farmies-hook.ps1'), 'Stop'], { env, input: '{not json' });
  assert.strictEqual(r.status, 0);
  assert.deepStrictEqual(fs.readdirSync(path.join(home, '.farmies', 'sessions')), []);
});

// The command in settings.json: Claude runs it in Git Bash, or in PowerShell without Git Bash.
test('ps hook: the installed command works in Git Bash and in PowerShell', { skip }, () => {
  const { home, env, input, state } = setup();
  ensureNativeHooks(home);
  const settings = JSON.parse(fs.readFileSync(path.join(home, '.claude', 'settings.json'), 'utf8'));
  const command = settings.hooks.Stop[0].hooks[0].command;
  assert.match(command, /^powershell\.exe .*hook\.ps1" Stop$/);
  assert.ok(!command.includes('||'), 'no "|| true": a syntax error in Windows PowerShell');
  const bash = ['C:\\Program Files\\Git\\bin\\bash.exe'].find((b) => fs.existsSync(b));
  const shells = [['powershell.exe', ['-NoProfile', '-Command', command]]];
  if (bash) shells.push([bash, ['-c', command]]);
  for (const [shell, args] of shells) {
    fs.rmSync(path.join(home, '.farmies', 'sessions'), { recursive: true, force: true });
    execFileSync(shell, args, { env, input: input({ last_assistant_message: shell }) });
    assert.strictEqual(state().event, 'Stop', shell);
    assert.strictEqual(state().detail, shell);
  }
  assert.ok(bash, 'Git Bash found (CI)');
});

test('alive: native sessions are checked with Get-Process', { skip }, async () => {
  const { hook, state } = setup();
  hook('Stop');
  const s = { id: 'abc123', distro: '', cpid: Number(state().cpid), cstart: state().cstart };
  assert.deepStrictEqual(await goneNative([s]), [], 'this process runs');
  const other = { ...s, cstart: '1' };
  const ended = { ...s, cpid: 4000001 };
  assert.deepStrictEqual(await goneNative([s, other, ended]), [other, ended]);
});

test('focus-console.ps1 runs (no console to find here: exit 1, no errors)', { skip }, () => {
  const script = path.join(ROOT, 'src', 'focus-console.ps1');
  for (const args of [['-ProcessId', '4000001'], ['-ProcessId', String(process.pid), '-Marker', '(!) x #abcd', '-MarkOnly', '-WaitMs', '300']]) {
    const r = spawnSync('powershell.exe', [...PS, script, ...args], { windowsHide: true });
    assert.strictEqual(String(r.stderr).trim(), '', args.join(' '));
    assert.ok(r.status === 0 || r.status === 1, `exit ${r.status}`);
  }
});
