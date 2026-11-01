#!/bin/sh
# Installs the Farmies hook for the current user (run in WSL or on macOS).
set -e

here=$(cd "$(dirname "$0")/.." && pwd)
base="$HOME/.farmies"
mkdir -p "$base"
cp "$here/hook/farmies-hook.sh" "$base/hook.sh"
chmod +x "$base/hook.sh"

# In WSL the buddy app runs on Windows, so the session files go into the Windows home.
if grep -qi microsoft /proc/version 2>/dev/null; then
  winhome=$(wslpath "$(cmd.exe /c 'echo %USERPROFILE%' 2>/dev/null | tr -d '\r')")
  dir="$winhome/.farmies/sessions"
else
  dir="$HOME/.farmies/sessions"
fi
mkdir -p "$dir"
printf "BUDDY_DIR='%s'\n" "$dir" >"$base/config"
# Tells the app where the hooks live, so it can uninstall them.
printf '{"distro":"%s","home":"%s"}\n' "${WSL_DISTRO_NAME:-}" "$HOME" >"$(dirname "$dir")/install.json"

node "$here/scripts/merge-settings.js" "$HOME/.claude/settings.json" 'sh "$HOME/.farmies/hook.sh"'
echo "Session files: $dir"
echo "Restart running Claude Code sessions to activate the hooks."
