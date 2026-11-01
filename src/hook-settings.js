// Adds/removes the Farmies hooks in a Claude Code settings.json.
const fs = require('fs');
const path = require('path');

const EVENTS = [
  'SessionStart',
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'PostToolUseFailure',
  'PermissionRequest',
  'Notification',
  'Stop',
  'StopFailure',
  'SessionEnd',
];
// Tool events: PreToolUse only for questions to the user, PostToolUse for every tool.
const MATCHERS = { PreToolUse: 'AskUserQuestion', PostToolUse: '*', PostToolUseFailure: '*' };
const MARKER = 'farmies';

function read(file) {
  if (!fs.existsSync(file)) return {};
  const raw = fs.readFileSync(file, 'utf8');
  return raw.trim() ? JSON.parse(raw) : {};
}

function write(file, settings, backupSuffix) {
  if (fs.existsSync(file)) fs.copyFileSync(file, `${file}.${backupSuffix}`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(settings, null, 2)}\n`);
}

// "|| true": whatever goes wrong in the hook, it never blocks Claude (exit code 2 would block a
// prompt or tool call)
const commandFor = (hookCmd, event) => `${hookCmd} ${event} || true`;

/**
 * Adds missing hooks and updates outdated Farmies commands. Returns the number added or changed;
 * writes only if needed.
 */
function addHooks(file, hookCmd) {
  const settings = read(file);
  settings.hooks = settings.hooks || {};
  let changed = 0;
  for (const event of EVENTS) {
    const command = commandFor(hookCmd, event);
    const groups = (settings.hooks[event] = settings.hooks[event] || []);
    const ours = groups.flatMap((g) => (g.hooks || []).filter((h) => String(h.command || '').includes(MARKER)));
    for (const h of ours) {
      if (h.command !== command) {
        h.command = command;
        changed++;
      }
    }
    if (ours.length) continue;
    const group = { hooks: [{ type: 'command', command, timeout: 5 }] };
    if (MATCHERS[event]) group.matcher = MATCHERS[event];
    groups.push(group);
    changed++;
  }
  if (changed) write(file, settings, 'bak-farmies');
  return changed;
}

/** Removes all hook commands mentioning farmies. Returns the number removed. */
function removeHooks(file) {
  const settings = read(file);
  if (!settings.hooks) return 0;
  let removed = 0;
  for (const [event, groups] of Object.entries(settings.hooks)) {
    const kept = [];
    for (const group of groups) {
      const hooks = (group.hooks || []).filter((h) => !String(h.command || '').includes(MARKER));
      removed += (group.hooks || []).length - hooks.length;
      if (hooks.length) kept.push({ ...group, hooks });
    }
    if (kept.length) settings.hooks[event] = kept;
    else delete settings.hooks[event];
  }
  if (!Object.keys(settings.hooks).length) delete settings.hooks;
  if (removed) write(file, settings, 'bak-farmies-uninstall');
  return removed;
}

module.exports = { addHooks, removeHooks };
