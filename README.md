<div align="center">

# 🐔 Farmies

**Ein kleines Pixel-Tier am Bildschirmrand, das dir Bescheid gibt,<br>wenn Claude Code auf dich wartet.**

<img src="docs/img/hero.gif" alt="Ein Huhn läuft vor einer kleinen Scheune hin und her, über dem Kopf Sprechblasen" width="600">

[![Neueste Version](https://img.shields.io/github/v/release/gustganz/farmies?label=Version&color=3f8f2f)](https://github.com/gustganz/farmies/releases/latest)
![Windows](https://img.shields.io/badge/Windows-0078d4?logo=windows&logoColor=white)
![macOS](https://img.shields.io/badge/macOS-000000?logo=apple&logoColor=white)

### [⬇️ Herunterladen](https://github.com/gustganz/farmies/releases/latest)

</div>

## Installieren

> Voraussetzung: [Claude Code](https://code.claude.com/docs) ist installiert
> (unter Windows in **WSL**).

**🪟 Windows**

1. Auf der [Download-Seite](https://github.com/gustganz/farmies/releases/latest) die Datei
   **`Farmies-…-portable.exe`** laden.
2. An einen festen Platz legen (z. B. *Dokumente*) und doppelklicken. Fertig.

<sub>Falls Windows „Der Computer wurde durch Windows geschützt“ meldet: *Weitere Informationen* → *Trotzdem ausführen*.</sub>

**🍎 macOS**

1. Auf der [Download-Seite](https://github.com/gustganz/farmies/releases/latest) die passende ZIP laden:
   **`…-mac-arm64.zip`** (Apple Silicon, M1 und neuer) oder **`…-mac-x64.zip`** (Intel).
2. Entpacken und **Farmies** in *Programme* ziehen.
3. Einmalig im Terminal freischalten (die App ist nicht notarisiert):

   ```sh
   xattr -cr /Applications/Farmies.app && codesign --force --deep -s - /Applications/Farmies.app
   ```

4. Farmies öffnen.

Das war's. Farmies richtet sich beim Start selbst ein, startet ab jetzt mit dem Rechner und
**aktualisiert sich von selbst**. Laufende Claude-Sessions bei Bedarf einmal neu starten.

## Was das Tier dir sagt

<p align="center"><img src="docs/img/blasen.png" alt="Vier Sprechblasen: Fehler, Freigabe nötig, Frage an dich, Fertig" width="720"></p>

Arbeitet Claude noch, läuft das Tier herum. Wartet etwas auf dich, hüpft es mit Sprechblasen.
Ist nichts los, legt es sich schlafen. 💤

## Alle Sessions auf einen Blick

<img src="docs/img/panel.png" alt="Panel mit allen Sessions und einer Wiese, die zeigt, was die Session gerade tut" width="300" align="right">

**Maus übers Tier:** alle Sessions mit ihrem Zustand. Unten auf der Wiese steht, woran die Session
gerade arbeitet.

**Klick** auf eine Blase oder Session holt genau dieses Fenster nach vorne, auch den richtigen Tab in
Windows Terminal oder das Terminal in VS Code und Cursor.

**Packen und fallen lassen:** Das Tier lässt sich mit der Maus herumtragen, auch auf einen anderen
Bildschirm.

**Rechtsklick** aufs Tier: Tier wählen, Größe, ausblenden, beenden.

Die Wiese ändert sich jeden Monat, und ab und zu schaut ein kleiner Besucher vorbei. 🐞

<br clear="right">

## Such dir dein Tier aus

<p align="center"><img src="docs/img/tiere.png" alt="Huhn, Kuh, Schwein, Schaf und Lama" width="720"></p>

## Gut zu wissen

- 🔒 Alles bleibt auf deinem Rechner. Farmies schickt nichts ins Internet, es schaut nur nach Updates.
- 🧹 **Entfernen:** Rechtsklick aufs Tier → *Deinstallieren…* entfernt Hooks und Autostart, danach die
  App löschen.
- 🛠️ Mitentwickeln: [docs/entwicklung.md](docs/entwicklung.md)

<sub>Tiere: „LPC style farm animals“ von Daniel Eddeland,
[CC-BY 3.0](https://creativecommons.org/licenses/by/3.0/)
([OpenGameArt](https://opengameart.org/content/lpc-style-farm-animals)).
Schriften: Pixelify Sans und Silkscreen (OFL). Details: [assets/CREDITS.md](assets/CREDITS.md).</sub>
