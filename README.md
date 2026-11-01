# Farmies

Pixel-Bauernhoftiere (Huhn, Kuh, Schwein, Schaf, Lama), die am unteren Bildschirmrand herumlaufen und
Bescheid geben, wenn eine Claude-Code-Session dich braucht. Standard ist das Huhn, umschalten im Tray unter *Tier*.

- **Sprechblasen**, nur wenn eine Session dich braucht: bis zu 5 im Bogen über dem Kopf, die dringendste in
  der Mitte, jede mit Spitze zum Kopf; bei mehr Sessions „+N“ (ab 10: ∞).
  - rotes **`✗`**: mit Fehler abgebrochen (API-Fehler, Limit)
  - rotes **`!`**: Freigabe nötig
  - blaues **`?`**: Claude stellt dir eine Frage
  - grünes **`✓`**: fertig, wartet auf deinen nächsten Prompt
- **Verhalten**: wartet etwas auf dich und arbeitet keine Session mehr, bleibt das Tier stehen, schaut dich an
  und hüpft. Arbeitet noch eine andere Session, läuft es hüpfend weiter, die Blasen wandern mit. Ist gar nichts
  los, legt es sich hin und schläft (Zzz).
- **Packen & fallen lassen**: Tier mit der Maus greifen (Frontansicht, strampelt; das Huhn flattert) und es
  schaukelt beim Schwenken nach. Loslassen, auch auf einem anderen Bildschirm: es landet am unteren Rand;
  das Huhn segelt aus größerer Höhe mit ausgebreiteten Flügeln herunter.
- **Hover**: Liste der Sessions (Projekt, was ansteht, seit wann). Befehle oder Inhalte werden nicht gespeichert.
- **Klick** auf eine Blase oder einen Eintrag: holt genau diese Session nach vorne.
  - Windows Terminal: der richtige Tab (die App lernt ihn über eine kurze Markierung im Tab-Titel)
  - Cursor, VS Code, Windsurf: das Fenster und dort das Terminal der Session (Begleit-Erweiterung, wird
    automatisch installiert); JetBrains: das Fenster
  - macOS: Terminal.app und iTerm über das TTY, sonst die App der Session
- **Tray-Icon** (Bauernhaus): Tier, Größe, alle als gesehen markieren, ausblenden, „Beim Login starten“,
  über Farmies, deinstallieren, beenden.
- **Autostart**: ab dem ersten Start aktiv. Windows: Registry `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`
  (Eintrag `com.gustganz.farmies`), macOS: `~/Library/LaunchAgents/com.gustganz.farmies.plist`. Abschalten über das Tray-Menü.

## Aufbau

- `hook/farmies-hook.sh` läuft als Claude-Code-Hook (WSL/macOS) und schreibt pro Session eine
  Statusdatei nach `~/.farmies/sessions/` (unter WSL ins Windows-Home).
- `src/` ist die Electron-App: liest die Statusdateien und zeigt das Tier in einem kleinen transparenten,
  immer obenliegenden Fenster, das mit ihm über die Bildschirme wandert.
- `src/animals.js` erzeugt alle Posen aus den Lauf-Animationen der Vorlage (Liegen mit geschlossenen
  Augen, Strampeln, beim Huhn Flattern und Segeln); `src/bubbles.js` die Sprechblasen und ihren Bogen.
- Vorschau ohne Display: `node scripts/preview-animals.js` (alle Posen) und
  `node scripts/preview-bubbles.js <anzahl>` (alle Tiere mit Blasen, wie die App sie platziert).

## Benutzen (fertige Pakete)

Die App richtet bei **jedem Start** selbst ein, was fehlt: Hook-Skript, Konfiguration und die Hooks in
`~/.claude/settings.json` (unter Windows in der Standard-WSL-Distribution über `\\wsl.localhost`).
Laufende Claude-Code-Sessions übernehmen neue Hooks meist sofort, sonst neu starten. Probleme stehen im
Tooltip des Tray-Icons.

- **Windows**: `Farmies-<version>-portable.exe` irgendwo hinlegen und starten. Sie entpackt sich bei
  jedem Start selbst (dauert ein paar Sekunden); der Autostart zeigt auf die `.exe`.
- **macOS (signiert, auf einem Mac gebaut)**: `.dmg` öffnen, „Farmies“ nach *Programme* ziehen,
  beim ersten Start Rechtsklick → *Öffnen* (ad-hoc-signiert, nicht notarisiert).
- **macOS (unsigniertes ZIP, unter Windows/WSL gebaut)**: `…-mac-arm64-unsigned.zip` (Apple Silicon) bzw.
  `…-mac-x64-unsigned.zip` (Intel) entpacken, App nach *Programme* ziehen und einmal im Terminal freischalten:

  ```sh
  xattr -cr "/Applications/Farmies.app"
  codesign --force --deep -s - "/Applications/Farmies.app"
  ```

## Entwicklung

Grafiken: „LPC style farm animals“ von Daniel Eddeland (CC-BY 3.0), liegen in `assets/lpc/`.
Schriften: Pixelify Sans und Silkscreen (OFL), kommen per `npm install`. Details: [assets/CREDITS.md](assets/CREDITS.md).

App starten:

- **Windows (aus WSL)**: `sh scripts/run-windows.sh`: kopiert die App nach
  `%LOCALAPPDATA%\farmies\app`, installiert Electron und startet sie. Erneut ausführen = Neustart mit neuem Code.
- **macOS**: `npm install && npm start`

Hooks ohne App einrichten (optional): `sh scripts/install-hook.sh` (in WSL bzw. auf dem Mac).

Pakete bauen (`dist/`):

- **Windows**: auf Windows `npm install && npm run dist:win` → portable `.exe`
- **macOS**: auf einem Mac `npm install && npm run dist:mac` → universelles `.dmg` + `.zip` (ad-hoc-signiert)
- **macOS unsigniert** (unter Linux/WSL): `npm run dist:mac-unsigned` → ZIPs für arm64 und x64;
  braucht `build/icon.icns` (`npm run icon`) und `zip`

Debug: mit `FARMIES_DEBUG=1` schreibt die App Fensterbewegungen und den Hook-Status nach
`<userData>/debug.log` und eine Aufnahme der Oberfläche nach `<userData>/capture.png`.

## Entfernen

Tray-Icon → **Deinstallieren…** entfernt die Integration, die App selbst bleibt:

- den Autostart
- die Farmies-Hooks aus `~/.claude/settings.json`; andere Hooks bleiben, Backup unter
  `settings.json.bak-farmies-uninstall`
- `~/.farmies` (Hook-Skript, Statusdateien); unter WSL über `\\wsl.localhost\<distro>\…`

Startet man die App danach wieder, richtet sie Hooks und Autostart neu ein.

## Credits

Tiere: „LPC style farm animals“ von Daniel Eddeland, [CC-BY 3.0](https://creativecommons.org/licenses/by/3.0/),
<https://opengameart.org/content/lpc-style-farm-animals>. Siehe [assets/CREDITS.md](assets/CREDITS.md).
