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
