// Runs hook/farmies-hook.sh (sh) with a temporary HOME and checks the state file it writes.
const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const HOOK = path.join(__dirname, '..', 'hook', 'farmies-hook.sh');

function setup() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'farmies-hook-'));
  const sid = 'abc123';
  const hook = (event, extra = {}) =>
    execFileSync('sh', [HOOK, event], {
      env: { PATH: process.env.PATH, HOME: home },
      input: JSON.stringify({ session_id: sid, cwd: home, transcript_path: `${home}/t.jsonl`, ...extra }),
    });
  const file = path.join(home, '.farmies', 'sessions', `${sid}.json`);
  const state = () => JSON.parse(fs.readFileSync(file, 'utf8'));
  return { home, hook, file, state };
}

test('hook: idle and other informational notifications keep the state (a finished session stays done)', () => {
  const { hook, state } = setup();
  hook('Stop');
  for (const type of ['idle_prompt', 'auth_success', 'elicitation_complete', 'agent_completed']) {
    hook('Notification', { notification_type: type, message: 'x' });
    assert.strictEqual(state().event, 'Stop', type);
  }
  // older Claude Code without notification_type
  hook('Notification', { message: 'Claude is waiting for your input' });
  assert.strictEqual(state().event, 'Stop');
});

test('hook: notifications that wait for the user count', () => {
  for (const type of ['permission_prompt', 'elicitation_dialog']) {
    const { hook, state } = setup();
    hook('UserPromptSubmit');
    hook('Notification', { notification_type: type, message: 'Claude needs your permission' });
    assert.strictEqual(state().event, 'Notification', type);
    assert.strictEqual(state().type, type);
  }
  const { hook, state } = setup();
  hook('UserPromptSubmit');
  hook('Notification', { message: 'Claude needs your permission to use Bash' });
  assert.strictEqual(state().event, 'Notification');
});

test('hook: PostToolUse heartbeat at most once a minute, by the ts it wrote itself', () => {
  const { hook, file, state } = setup();
  hook('UserPromptSubmit');
  hook('PostToolUse');
  assert.strictEqual(state().event, 'PostToolUse');
  const now = state().ts;
  hook('PostToolUse');
  assert.strictEqual(state().ts, now);
  // a minute old by its own clock, whatever the file time says
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(`"ts":${now}`, `"ts":${now - 61}`));
  hook('PostToolUse');
  assert.ok(state().ts >= now);
});

test('hook: context for the hover panel (task, title, branch, step, detail)', () => {
  const { home, hook, state } = setup();
  execFileSync('git', ['init', '-q', '-b', 'feature/x', home]);
  hook('UserPromptSubmit', { prompt: 'Fix the "export" button\nin Safari', session_title: 'Safari export' });
  assert.strictEqual(state().task, 'Fix the "export" button\nin Safari');
  assert.strictEqual(state().title, 'Safari export');
  assert.strictEqual(state().branch, 'feature/x');
  assert.strictEqual(state().step, '');

  hook('PostToolUse', { tool_name: 'Edit', tool_input: { file_path: `${home}/src/app.js`, old_string: 'a' } });
  assert.strictEqual(state().step, 'Edit · src/app.js');
  // within the heartbeat minute only the step changes (same ts), the rest stays
  const ts = state().ts;
  hook('PostToolUse', { tool_name: 'Bash', tool_input: { command: 'npm test', description: 'Run tests' } });
  assert.strictEqual(state().step, 'Bash · npm test');
  assert.strictEqual(state().ts, ts);
  assert.strictEqual(state().task, 'Fix the "export" button\nin Safari');

  hook('PermissionRequest', { tool_name: 'Bash', tool_input: { command: 'git push' } });
  assert.strictEqual(state().detail, 'Bash · git push');
  hook('Notification', { notification_type: 'permission_prompt', message: 'Claude needs your permission to use Bash' });
  assert.strictEqual(state().detail, 'Bash · git push');

  hook('Stop', { last_assistant_message: 'Done. The button works now.' });
  assert.strictEqual(state().event, 'Stop');
  assert.strictEqual(state().detail, 'Done. The button works now.');
  assert.strictEqual(state().task, 'Fix the "export" button\nin Safari');
  assert.strictEqual(state().title, 'Safari export');
  assert.strictEqual(state().step, 'Bash · npm test');
});

test('hook: questions and errors as detail, long values cut without breaking the JSON', () => {
  const { hook, state } = setup();
  hook('PreToolUse', { tool_name: 'AskUserQuestion', tool_input: { questions: [{ question: 'Which colour?', header: 'C' }] } });
  assert.strictEqual(state().event, 'Question');
  assert.strictEqual(state().detail, 'Which colour?');
  hook('StopFailure', { error: 'rate_limit' });
  assert.strictEqual(state().detail, 'rate_limit');
  // cut right inside escape sequences: the state file still parses
  for (let n = 290; n < 302; n++) {
    hook('UserPromptSubmit', { prompt: `${'x'.repeat(n)}\\\\"\u0001ä${'y'.repeat(20)}` });
    assert.ok(state().task.startsWith('xxx'), String(n));
  }
});

test('hook: a turn that ends while background work runs is not done (background_tasks)', () => {
  const { home, hook, file, state } = setup();
  hook('UserPromptSubmit', { prompt: 'Run the build' });
  // an empty list (or none, older Claude Code) is a normal end
  hook('Stop', { last_assistant_message: 'Done.', background_tasks: [], session_crons: [] });
  assert.strictEqual(state().event, 'Stop');
  hook('Stop', { last_assistant_message: 'Done.' });
  assert.strictEqual(state().event, 'Stop');

  hook('UserPromptSubmit', { prompt: 'Run the build' });
  // the field's name inside the message does not count
  hook('Stop', { last_assistant_message: 'see "background_tasks":[{"id":"x"}]', background_tasks: [] });
  assert.strictEqual(state().event, 'Stop');
  hook('UserPromptSubmit', { prompt: 'Run the build' });
  hook('Stop', {
    last_assistant_message: 'Waiting for the build.',
    background_tasks: [
      { id: 'b1', type: 'shell', status: 'running', description: 'Build "app"', command: 'npm run build' },
      { id: 'a2', type: 'subagent', status: 'running', description: 'Review', agent_type: 'Explore' },
    ],
    session_crons: [],
  });
  assert.strictEqual(state().event, 'Background');
  assert.strictEqual(state().detail, 'npm run build');
  assert.strictEqual(state().bg, '2');
  assert.strictEqual(state().task, 'Run the build');
  // not a session waiting for the user: no marker for the tab title
  assert.ok(!fs.existsSync(path.join(home, '.farmies', 'attn', 'abc123')));
  // a subagent has no command
  hook('Stop', { background_tasks: [{ id: 'a2', type: 'subagent', status: 'running', description: 'Review "x"' }] });
  assert.strictEqual(state().detail, 'Review "x"');
  assert.strictEqual(state().bg, '1');

  // a shell that keeps running by itself (a server) is not waited for: done, the shell noted
  const shell = (command) => ({ id: 's1', type: 'shell', status: 'running', description: 'x', command });
  hook('Stop', { last_assistant_message: 'Runs on http://localhost:8080/.', background_tasks: [shell('npx pnpm docs:build && npx pnpm docs:serve')] });
  assert.strictEqual(state().event, 'Stop');
  assert.strictEqual(state().bg, '1');
  assert.strictEqual(state().step, 'npx pnpm docs:build && npx pnpm docs:serve');
  assert.strictEqual(state().detail, 'Runs on http://localhost:8080/.');
  for (const c of ['npm run dev', 'npm start', 'python3 -m http.server 8000', 'tail -f app.log', 'vite --watch']) {
    hook('Stop', { last_assistant_message: 'Running.', background_tasks: [shell(c)] });
    assert.strictEqual(state().event, 'Stop', c);
  }
  // Claude asks the user: done, even when it is a build
  hook('Stop', { last_assistant_message: 'The build runs. Shall I commit?\n', background_tasks: [shell('npm run build')] });
  assert.strictEqual(state().event, 'Stop');
  hook('Stop', { last_assistant_message: 'Waiting for the build.', background_tasks: [shell('npm run build')] });
  assert.strictEqual(state().event, 'Background');
  // a subagent is always waited for, also next to a server and after a question
  hook('Stop', {
    last_assistant_message: 'Shall I?',
    background_tasks: [shell('npm run dev'), { id: 'a2', type: 'subagent', status: 'running', description: 'Review' }],
  });
  assert.strictEqual(state().event, 'Background');

  // the finished work wakes the session with a notification: working again, the task stays
  hook('UserPromptSubmit', { prompt: '<task-notification>\n<task-id>b1</task-id>\n</task-notification>' });
  assert.strictEqual(state().event, 'UserPromptSubmit');
  assert.strictEqual(state().task, 'Run the build');
  assert.ok(fs.existsSync(file));
});
