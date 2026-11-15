# Trap Station Desktop

Desktop app for the Trap Station firmware on the M-VAVE FM-1.

- **Converter:** Audio files (WAV, MP3, FLAC, OGG, M4A, AIFF and more) are converted into sample data for the Trap Station. An Opus copy is kept in the archive as an intermediate step.
- **Sampler S01–S32:** Load samples from the converter onto the Trap Station. The sample memory is read first, so existing samples stay.
- **Banks A–E:** The factory presets of the Trap Station with their parameters, for viewing and editing in the app only.
- **Device view:** The screen of the Trap Station is mirrored live.
- **Arrangement:** Four scenes with the tracks that play in them. Double-click a clip to open the piano roll or the drum sequencer.
- **Ableton export:** An Ableton project (`.als`) with one MIDI track per track and the clips at their scene positions. Also one MIDI file per scene, which you can drag into Ableton.

Editing in the app does not write to the device. The Trap Station stores only one pattern per track, so clip changes apply to the Ableton export only.

## Requirements

- Windows 10 or 11
- Trap Station firmware on the FM-1 (0.9.9.x)
- [ffmpeg](https://ffmpeg.org/) with libopus, on the `PATH`, for the converter
- Python 3.10 or newer (standard library only), for the Ableton export

## Run from source

```bash
npm install
npm start
```

## Build the installer

```bash
npm run dist
```

This creates a Windows package in `dist/`. The Ableton tools are included as extra resources next to the program.

## Install with PowerShell

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install.ps1 -Zip ".\dist\Trap Station-0.1.0-win.zip"
```

The script unpacks the program to `%LOCALAPPDATA%\Programs\Trap Station` and creates a Start menu shortcut and a desktop shortcut.

## Where files are stored

- Device backups and the Opus archive are stored in the user data folder of the app. When run from source, they go to `Sicherungen/` and `Opus-Archiv/` in the project folder.
- The Ableton export uses the `ableton/` folder. Set `TRAP_ABLETON_DIR` to use another folder.

## Safety

Before any write to the device, the affected object is backed up. Writing is limited to samples and banks and requires an explicit confirmation in the app.

## Limits

- The values of an imported preset are approximations. Listen to the result on the device.
- The Ableton export uses the drum rack from the template for the MIDI tracks. The tracks are created without an instrument, so add an instrument in Ableton.
- Phaser and Bitcrush are not part of the firmware and are therefore not in the app.

## License

GPL-3.0-only, see [LICENSE](LICENSE).

The modules in `web/` (sample upload, OTA transfer, sample memory image) come from the Trap Station project, based on BBL JAM BOX (Blair) and Felucca (Leo Kuroshita, Hügelton Instruments). The copyright notices in those files are kept.
