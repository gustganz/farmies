#!/bin/sh
# Copies the app from WSL to the Windows filesystem, installs dependencies and starts it.
# Running it again restarts the app with the updated code.
set -e

here=$(cd "$(dirname "$0")/.." && pwd)
localappdata=$(wslpath "$(cmd.exe /c 'echo %LOCALAPPDATA%' 2>/dev/null | tr -d '\r')")
target="$localappdata/farmies/app"

mkdir -p "$target"
rsync -a --delete --exclude node_modules --exclude .git --exclude dist "$here/" "$target/"

# cmd.exe needs a Windows working directory. No quotes in the command line:
# WSL escapes them as \" which cmd.exe does not understand.
cd "$target"
cmd.exe /c npm install --no-audit --no-fund --loglevel=error --no-update-notifier
# Electron's postinstall download sometimes fails silently on Windows (file locked); retry it.
if [ ! -f node_modules/electron/dist/electron.exe ]; then
  (cd node_modules/electron && cmd.exe /c node install.js)
fi
# Detach, otherwise WSL keeps this shell attached until Electron exits.
setsid cmd.exe /c start node_modules\\electron\\dist\\electron.exe . </dev/null >/dev/null 2>&1 &
