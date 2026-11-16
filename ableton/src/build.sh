#!/bin/sh
# Builds the two scene renderers of the Ableton export from the TRAPSTATION OS firmware sources (read only).
# Usage (WSL):  sh ableton/src/build.sh /path/to/trapstation-os
# Needs the firmware tree's generated headers (build/gen) and zig as the Windows cross compiler
# (pip install ziglang; set CC to use another MinGW-w64 gcc).
set -e
FW="${1:?path of the trapstation-os tree}"
HERE="$(cd "$(dirname "$0")" && pwd)"
CC="${CC:-python3 -m ziglang cc -target x86_64-windows-gnu}"
FLAGS="-O1 -ffp-contract=off -fwrapv -w -DFELUCCA_FM4=1 -DFELUCCA_SIMPLE=1 -I$FW/build/gen -I$FW/firmware/src -I$FW/web/emu -I$FW/web/emu/shim"
$CC $FLAGS -DTRAP_FM6_TEST=1 -DTRAP_UX_TEST=1 -o "$HERE/../render_scenes_fm6.exe" "$HERE/render_scenes.c" -lm
ls -l "$HERE/../render_scenes_fm6.exe"
