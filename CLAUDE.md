# Farmies

Electron desktop app (Windows via WSL, macOS): pixel farm animals walk along the bottom of the screen
and show speech bubbles when a Claude Code session needs the user. Owner: Gust (German speaking).
User-facing text (UI, README) is German; code, comments and commit messages are English.
Feature overview, usage and release steps: README.md.

## How it fits together

- `hook/farmies-hook.sh`: Claude Code hook (sh, runs in WSL/macOS). Writes one JSON state file per
  session into `~/.farmies/sessions/` (under WSL: the *Windows* home, path from `~/.farmies/config`).
  Also detects the terminal/editor of the session and marks Windows Terminal tab titles.
- `src/main.js`: Electron main process: transparent always-on-top window, tray menu (same menu on
  right click on the animal), IPC. `src/renderer/`: behaviour (walk, sleep, drag & drop, swing),
  bubbles, hover panel.
- `src/sessions.js`: reads the state files → states error/attention/question/done/working/idle.
  A question counts as handled once the session transcript changed after it (cancelling fires no hook).
- `src/hooks.js` + `src/hook-settings.js`: on every start, installs hook.sh and adds/updates the hooks in
  `~/.claude/settings.json` (WSL default distro via `\\wsl.localhost`). Hook commands end in `|| true`:
  a hook must never block Claude (exit code 2 blocks prompts).
- `src/focus.js`, `*.ps1`, `src/wt-tabs.js`, `extension/`: clicking a bubble focuses the session's
  window/tab (Windows Terminal tab via UI Automation, VS Code/Cursor/Windsurf terminal via the companion
  extension, macOS via AppleScript).
- `src/animals.js` (+ `src/poses.js`, lying poses as palette rows): builds every pose from the LPC walk
  sheets in pure JS. `src/bubbles.js`: bubble glyphs and arc layout. Both are UMD (renderer + node).
- `src/updater.js` + `src/releases.js`: GitHub Releases updater (hourly + menu "Nach Updates suchen").

## Working without Windows, Mac or a display

- `npm ci && npm test`: unit tests (node:test, `test/`), run anywhere.
- Look at graphics as PNGs: `node scripts/preview-animals.js out.png`, `node scripts/preview-bubbles.js 3u out.png`.
  Check every visual change this way before calling it done.
- Real app runs only in CI: `.github/workflows/ci.yml` builds and start-tests the packaged app on macOS
  and Windows on every push (`scripts/smoke.js`, snapshot PNG attached as artifact:
  `gh run download <id>`). Push your branch and check the run when you changed app code.
- `scripts/run-windows.sh` only works on Gust's WSL machine.

## Releases

Bump `version` in package.json, commit, `git tag vX.Y.Z && git push origin main vX.Y.Z`. The release
workflow builds, start-tests and publishes; installed apps update themselves. Publishing is public:
only release when Gust asks for it.

## Rules learned the hard way

- Never rename release assets (`Farmies-<v>-portable.exe`, `Farmies-<v>-mac-<arch>.zip`): installed
  versions look for these names. Keep the updater able to update from older versions.
- Every file the app loads must be in `build.files` (package.json); a test checks relative requires.
  PowerShell scripts must stay in `asarUnpack`.
- Shell scripts need LF line ends (`.gitattributes`; CRLF hooks broke all Claude sessions once).
- Windows: a detached PowerShell has no console and silently does nothing; start it via `cmd /c start`.
  Hidden tray menu items still take space: leave them out instead.
- Assets: only the LPC farm animals (CC-BY 3.0, credits in `assets/CREDITS.md` and the About dialog)
  and OFL fonts. Do not add assets whose license forbids redistribution in a public repo.
- Keep it minimal: no frameworks, no new dependencies without a reason.

## Commits

`[TASK] short lowercase description` (or `[BUGFIX]`), blank line, short English explanation. No ticket
number, no Co-Authored-By trailer. Commit and push only when asked.
No pull requests: test on a separate branch (CI start tests), then push to main after Gust's OK.

## Open points

- macOS beyond the start test is untested by hand (click focusing, autostart, update swap).
- Claude Code *plugin panel* in Cursor/VS Code: bubbles should work, a click only brings the window
  (the companion extension only knows terminals). Gust has neither a Mac nor the plugin to test.
