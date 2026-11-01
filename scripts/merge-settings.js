#!/usr/bin/env node
// Adds the Farmies hook to a Claude Code settings.json (idempotent, keeps a backup).
// Usage: merge-settings.js <settings.json> <hook command>
const { addHooks } = require('../src/hook-settings');

const [file, hookCmd] = process.argv.slice(2);
if (!file || !hookCmd) {
  console.error('usage: merge-settings.js <settings.json> <hook command>');
  process.exit(1);
}
const added = addHooks(file, hookCmd);
console.log(added ? `Added ${added} hook(s) to ${file}` : `Hooks already present in ${file}`);
