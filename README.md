<p align="center">
  <img src="renderer/assets/trapstation-logo.png" alt="Trap Station" width="200">
</p>

<p align="center"><b>Trap Station Desktop</b><br>
the computer side of <a href="https://github.com/sog-maker/trapstation-os">TRAPSTATION OS</a> on the M-VAVE FM-1:
a sound editor for the FM6 engine, samples, a live screen, and your jam as an Ableton Live project</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-0.2.1-c62d39" alt="Version 0.2.1">
  <img src="https://img.shields.io/badge/firmware-TRAPSTATION%20OS%201.1.0.1-c62d39" alt="For TRAPSTATION OS 1.1.0.1">
  <img src="https://img.shields.io/badge/platform-Windows%2010%20%7C%2011-555" alt="Windows 10 and 11">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-GPL--3.0--only-blue.svg" alt="License: GPL-3.0-only"></a>
</p>

<p align="center">The firmware, its installer and its user guide:
<a href="https://github.com/sog-maker/trapstation-os">sog-maker/trapstation-os</a> ·
install TRAPSTATION OS in the browser: <a href="https://sog-maker.github.io/trapstation-os/">the online installer</a></p>

## What's new in 0.2.1

TRAPSTATION OS 1.1.0.1 stores the last jam packed, so it no longer fills up (`LAST JAM FULL` in 1.1.0.0). 0.2.1 reads
that new jam: the arrangement, the Ableton export and reading the FM6 sounds work with 1.1.0.1. Jams of 1.1.0.0 and
1.0.0.0 are read as before.

## What's new in 0.2.0

TRAPSTATION OS 1.1.0.0 replaced the four-operator FM SYN with **FM6**, a six-operator FM engine, and rebuilt its keys,
bells, organs, pads and leads on it. The app is reworked around that:

- **A sound editor for FM6.** Every factory preset as the firmware loads it, with the device's twelve pages: ROUTING,
  OP TONE, OP LEVEL · OP RATES, OP LEVELS, KEY SCALE · LFO MOTION, LFO DEPTH, PITCH ENV · COLOR, DELAY, REVERB, the six
  operators and the picture of the algorithm. Drums, 808 and MONO sounds get their own controls, with the device's
  names and ranges.
- **You hear what you edit.** The editor plays through the firmware's own sound engine, built for the computer. A
  change is heard at once, on a held note too.
- **Play it from the FM-1.** Connect the FM-1 and its keys play the sound on the editor; the keys light up on the
  FM-1 drawn around the mirrored screen. Without a device the computer keys A W S E D F … play.
- **My sounds.** Keep edited copies on the computer, import DX7 voices and 32-voice banks (`.syx`), export a voice as
  a DX7 file, and read the FM6 sounds of your six tracks from the FM-1.
- **One page.** Banks on the left, the FM-1 in the middle with arrangement, converter and sampler below it, the editor
  on the right. A click enlarges the FM-1 and its screen.
- **Ableton export for 1.1 jams.** FM6 tracks are rendered with their own sound.

## What it does

| | |
| --- | --- |
| **Sound editor** | the 40 factory presets of TRAPSTATION OS 1.1.0.0 (22 of them FM6) and your own sounds, heard while you edit |
| **DX7 files** | import of single voices and 32-voice banks (`.syx`), export of a voice |
| **Device view** | the FM-1 with its screen, live; its keys play the sound on the editor |
| **Converter** | WAV, MP3, FLAC, OGG, M4A, AIFF and more into sample data for the FM-1 (an Opus copy is kept in the archive) |
| **Sampler S01–S32** | puts converted samples onto the FM-1; the sample memory is read first, so the samples already there stay |
| **Arrangement** | the four scenes with the tracks that play in them; double-click a clip for the piano roll or the drum sequencer |
| **Ableton export** | an Ableton Live project (`.als`), one MIDI track per track and the clips at their scene positions; or one MIDI file per scene |

## Status of this build

**Version 0.2.1, for TRAPSTATION OS 1.1.0.1** (identity `FM-1_511`; 1.1.0.0 works too). The factory sounds in the app are those of
1.1.0.0. With 1.0.0.0 on the FM-1 the converter, sampler, screen, arrangement and export still work; the editor then
shows sounds that device does not have.

**Works with the device**

- Reading and writing the sample memory (S01–S32), with the other samples kept
- The live screen, and the FM-1's keys playing the editor's sound
- Reading the last jam: the scenes, the clips, and the FM6 sounds of the six tracks
- The Ableton export of jams made with 1.1.0.1, 1.1.0.0 and 1.0.0.0

**Only in the app, not written to the device**

- Sounds edited in the editor, your own sounds and imported DX7 voices: they stay on the computer. TRAPSTATION OS
  1.1.0.0 keeps an FM6 sound with the jam and has no transfer for single sounds yet
- Editing clips in the arrangement, the piano roll and the drum sequencer: they change the Ableton export only. The
  firmware stores one pattern per track, not one per scene

**Good to know**

- **Keep your FM6 sounds:** on the FM-1, kits and sound slots keep a track's FM6 preset, not the changes made on the
  FM6 pages; those live in the last jam only. After a session, click **Read FM-1 tracks** before you load another kit or
  change the jam, and the sounds stay in My sounds on the computer
- In the Ableton export an FM SYN track plays the jam's own FM6 sound in every kit, because kits do not hold FM6 sounds
- DRIVE, CUTOFF and OUTPUT are TRAPSTATION's own: a DX7 file does not carry them. "Export" keeps a sound with all its
  values
- While you play the FM-1's keys, the FM-1 plays its own track sound too

**Not in this build yet**

- Installing or updating the firmware, backups of the whole device and the factory reset: use the
  [online installer](https://sog-maker.github.io/trapstation-os/) for those
- SLICE settings of a sample: kept with the last jam on the device, not shown in the app
- macOS and Linux

Every function of this build has been tested on a FM-1 with TRAPSTATION OS 1.1.0.1: the arrangement, the piano roll,
reading the FM6 sounds and the Ableton export of a full jam (six tracks of 64 steps) in the new format, and the FM-1's
keys playing the editor's sound. If something does not work
for you, open an [issue](https://github.com/sog-maker/trapstation-desktop/issues) with what you did and what the app
said.

## Download

From the [latest release](https://github.com/sog-maker/trapstation-desktop/releases/latest):

- `Trap.Station.Setup.0.2.1.exe`: the installer (Windows may warn that it is not signed: More info > Run anyway)
- `Trap.Station-0.2.1-win.zip`: the program without installing, for `scripts/install.ps1` (below)

## Requirements

- Windows 10 or 11
- TRAPSTATION OS 1.1.0.1 on the FM-1 ([install it here](https://sog-maker.github.io/trapstation-os/))
- [ffmpeg](https://ffmpeg.org/) with libopus, on the `PATH`, for the converter
- Python 3.10 or newer (standard library only), for the Ableton export
- A USB data cable, the FM-1 straight into the computer, other music apps closed

## Run from source

```bash
npm install
npm start
```

## Build the installer

```bash
npm run dist
```

This creates `dist/Trap Station Setup 0.2.1.exe` (an installer) and `dist/Trap Station-0.2.1-win.zip`. The Ableton
tools go along as extra resources next to the program.

## Rebuild the sound engine

The editor's engine, the factory sounds and the export's renderer are built from the firmware's sources. After a
firmware change, with a TRAPSTATION OS tree that has been built once (WSL, Emscripten, and zig as the Windows
compiler):

```bash
sh preview/build.sh /path/to/trapstation-os
```

```bash
node preview/gen_factory.mjs
```

```bash
sh ableton/src/build.sh /path/to/trapstation-os
```

## Install with PowerShell

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install.ps1 -Zip ".\dist\Trap Station-0.2.1-win.zip"
```

The script unpacks the program to `%LOCALAPPDATA%\Programs\Trap Station` and adds a Start menu and a desktop shortcut.

## Where files are stored

- Device backups and the Opus archive go to the app's user data folder (from source: `Sicherungen/` and `Opus-Archiv/`
  in the project folder).
- The Ableton export uses the `ableton/` folder; set `TRAP_ABLETON_DIR` for another one.

## Safety

This build writes to the device in one place only: the sample memory, when you add or remove a sample. The sample
memory is read first, so the other samples stay. The editor does not write to the FM-1.

## Limits

- The Ableton export uses the template's drum rack for the MIDI tracks; the other tracks come without an instrument.
- Phaser and bitcrush are not part of the firmware, so they are not in the app.

## License

GPL-3.0-only, see [LICENSE](LICENSE).

- The modules in `web/` (sample upload, update transfer, sample memory image) come from
  [TRAPSTATION OS](https://github.com/sog-maker/trapstation-os), based on BBL JAM BOX (Blair) and Felucca (Leo Kuroshita,
  Hügelton Instruments); their copyright notices are kept.
- `renderer/preview/preview.wasm` is a build of the TRAPSTATION OS firmware with its FM6 engine (source:
  `preview/preview.c` and the firmware at tag `v1.1.0.0`). The FM6 core is msfa, the synthesis core of Dexed (Google Inc., Pascal
  Gauthier; integer C port by Leo Kuroshita), under Apache-2.0: see `renderer/preview/Apache-2.0-msfa.txt` and
  `renderer/preview/ORIGIN-fm6.md`.
- `ableton/render_scenes_fm6.exe` is the scene renderer built with the FM6 engine; its source is
  `ableton/src/render_scenes.c` with the firmware at tag `v1.1.0.0`.
- The FM-1 drawn around the screen follows the layout of the firmware's browser emulator (Felucca, Leo Kuroshita).
- `ableton/render_scenes.exe` is a host build of the TRAPSTATION OS sequencer and engines. Its source is
  `tools/render_scenes.c` with `web/emu/felucca_web.c` in [TRAPSTATION OS](https://github.com/sog-maker/trapstation-os)
  (see its `docs/developer`).
