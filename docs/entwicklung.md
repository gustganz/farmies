# Farmies entwickeln

## Aufbau

- `hook/farmies-hook.sh` läuft als Claude-Code-Hook (WSL/macOS) und schreibt pro Session eine
  Statusdatei nach `~/.farmies/sessions/` (unter WSL ins Windows-Home). Für die Wiese im Hover-Panel
  speichert er kurze Auszüge (letzter Prompt, letzter Tool-Aufruf, letzte Antwort, je max. 300 Zeichen);
  nichts davon verlässt den Rechner.
- `src/` ist die Electron-App: liest die Statusdateien und zeigt das Tier in einem kleinen transparenten,
  immer obenliegenden Fenster, das mit ihm über die Bildschirme wandert.
- `src/animals.js` erzeugt alle Posen aus den Lauf-Animationen der Vorlage; `src/bubbles.js` die
  Sprechblasen und ihren Bogen; `src/meadow.js` die Wiese, die jeden Monat anders aussieht.
- Klick auf eine Blase holt die Session nach vorne: Windows Terminal (richtiger Tab), Cursor, VS Code,
  Windsurf (Begleit-Erweiterung in `extension/`, wird automatisch installiert), JetBrains (Fenster),
  macOS (Terminal.app und iTerm über das TTY, sonst die App). Editor-Fenster werden über die
  Shell-PIDs ihrer Terminals gefunden, die die Erweiterung meldet, nicht über den Ordner der Session:
  Claude kann in einem anderen Ordner laufen als dem Workspace des Fensters.
- Eine Blase gilt als gesehen, wenn der User im Tab/Terminal der Session bleibt (`src/seen-by-focus.js`):
  5 s, wenn der Fokus nach der Blase dorthin kam, 60 s, wenn er die ganze Zeit dort war. Windows
  Terminal: `wt-watch.ps1` meldet den ausgewählten Tab des Vordergrundfensters; VS Code-Familie: die
  Erweiterung schreibt `~/.farmies/editor-focus/<pid>.json` (Shell-PID des aktiven Terminals, alle
  Terminal-Shells, Workspace-Name und -Ordner).
- Updates: die App schaut kurz nach dem Start und dann stündlich nach einem neuen GitHub-Release
  (`src/updater.js`). Autostart: Windows `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`
  (`com.gustganz.farmies`), macOS `~/Library/LaunchAgents/com.gustganz.farmies.plist`.

## Starten und testen

- **Windows (aus WSL)**: `sh scripts/run-windows.sh` kopiert die App nach `%LOCALAPPDATA%\farmies\app`,
  installiert Electron und startet sie. Erneut ausführen = Neustart mit neuem Code.
- **macOS**: `npm install && npm start`
- Hooks ohne App einrichten (optional): `sh scripts/install-hook.sh`
- Tests (ohne Windows/Mac/Display): `npm test`
- Vorschau ohne Display: `node scripts/preview-animals.js` (alle Posen),
  `node scripts/preview-bubbles.js <anzahl>` (Tiere mit Blasen)
- Bilder fürs README: `node scripts/readme-shots.js` (braucht Playwright mit Chromium und ffmpeg).
  Nur erfundene Session-Namen verwenden, keine echten Projekte.
- Debug: mit `FARMIES_DEBUG=1` schreibt die App Fensterbewegungen und den Hook-Status nach
  `<userData>/debug.log` und eine Aufnahme der Oberfläche nach `<userData>/capture.png`.

Bei jedem Push laufen auf GitHub (`.github/workflows/ci.yml`) die Tests und ein Starttest der gebauten
App auf macOS und Windows (`scripts/smoke.js`); ein Bildschirmfoto hängt am Lauf.

## Release

1. `version` in `package.json` erhöhen, committen
2. nach `main` pushen

Gibt es zur Version noch kein Release, legt `.github/workflows/release.yml` es samt Tag `v<version>` an,
lässt die Tests laufen und hängt `Farmies-<version>-portable.exe` und
`Farmies-<version>-mac-{arm64,x64}.zip` an. Installierte Apps finden es von selbst.

Pakete lokal bauen (`dist/`):

- **Windows**: `npm install && npm run dist:win`
- **macOS**: `npm install && npm run dist:mac` (ad-hoc-signiert)
- **macOS unsigniert** (Linux/WSL): `npm run dist:mac-unsigned` (braucht `npm run icon` und `zip`)

## Noch offen

Nicht von Hand getestet: macOS außer dem Starttest (Klick-Fokussieren, Autostart, Update) und das
Claude-Plugin in Cursor/VS Code (Blasen sollten kommen, ein Klick holt aber nur das Fenster).
