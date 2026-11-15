# Trap Station Desktop

Desktop-App für die Trap-Station-Firmware auf dem M-VAVE FM-1.

- **Konverter:** Audiodateien (WAV, MP3, FLAC, OGG, M4A, AIFF …) werden in Sample-Daten für die Trap Station umgewandelt. Als Zwischenschritt entsteht eine Opus-Kopie im Archiv.
- **Sampler S01–S32:** Samples aus dem Konverter auf die Trap Station laden. Der Sample-Speicher wird vorher gelesen, bestehende Samples bleiben erhalten.
- **Bänke A–E:** Die Werkspresets der Trap Station mit ihren Parametern, nur zum Ansehen und Bearbeiten in der App.
- **Geräteansicht:** Der Bildschirm der Trap Station wird gespiegelt.
- **Arrangement:** Vier Szenen mit den Tracks, die darin laufen. Doppelklick auf einen Clip öffnet Piano Roll oder Drum-Sequencer.
- **Ableton-Export:** Eine Projektdatei (`.als`) mit einer MIDI-Spur pro Track und den Clips an ihren Szenenpositionen. Außerdem eine MIDI-Datei pro Szene zum Ziehen nach Ableton.

Die Bearbeitung in der App schreibt nichts auf das Gerät. Das Gerät speichert pro Track nur ein Pattern, daher gelten Clip-Änderungen nur für den Export.

## Voraussetzungen

- Windows 10 oder 11
- Trap-Station-Firmware auf dem FM-1 (Stand 0.9.9.x)
- Chromium-basierter Browser ist **nicht** nötig, die App bringt Electron mit
- Für die Konvertierung: [ffmpeg](https://ffmpeg.org/) mit libopus, im `PATH`
- Für den Ableton-Export: Python 3.10 oder neuer (nur Standardbibliothek)

## Start

```bash
npm install
npm start
```

## Installer bauen

```bash
npm run dist
```

Erzeugt ein Windows-Paket in `dist/`. Die Ableton-Tools liegen als Zusatzdateien neben dem Programm.

## Speicherorte

- Geräte-Sicherungen und das Opus-Archiv liegen im Benutzerordner der App, bei der Entwicklung im Projektordner (`Sicherungen/`, `Opus-Archiv/`).
- Der Ableton-Export nutzt `ableton/` im Projekt. Mit der Variable `TRAP_ABLETON_DIR` kann ein anderer Ordner gewählt werden.

## Sicherheit

Vor jedem Schreiben auf das Gerät wird das betroffene Objekt gesichert. Das Schreiben ist nur für Samples und Bänke vorgesehen; dafür braucht es eine ausdrückliche Bestätigung in der App.

## Grenzen

- Die Werte eines importierten Presets sind Näherungen. Die Umrechnung hört man am Gerät nach.
- Der Ableton-Export nutzt als Drum-Rack das Rack aus der Vorlage. Die MIDI-Spuren sind ohne Instrument, du legst in Ableton ein Instrument auf.
- Phaser und Bitcrush sind in der Firmware nicht vorhanden und deshalb nicht in der App.

## Lizenz

GPL-3.0-only, siehe [LICENSE](LICENSE).

Die Module im Ordner `web/` (Sample-Upload, OTA-Übertragung, Speicherabbild) stammen aus dem Trap-Station-Projekt auf Basis von BBL JAM BOX (Blair) und Felucca (Leo Kuroshita, Hügelton Instruments). Die Urheberangaben in den Dateien bleiben erhalten.
