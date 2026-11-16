#!/bin/sh
# Builds renderer/preview/preview.wasm from the TRAPSTATION OS firmware sources (read only) with Emscripten.
# Usage (WSL):  sh preview/build.sh /path/to/trapstation-os
# The firmware tree must have its generated headers (build/gen, made by its own build).
set -e
FW="${1:?path of the trapstation-os tree}"
HERE="$(cd "$(dirname "$0")" && pwd)"
EMCC="${EMCC:-$HOME/emsdk/upstream/emscripten/emcc}"
OUT="$HERE/../renderer/preview"
mkdir -p "$OUT"
"$EMCC" -O2 -ffp-contract=off -fwrapv -std=gnu11 -Wno-unused-function -Wno-incompatible-pointer-types \
  -DFELUCCA_FM4=1 -DFELUCCA_SIMPLE=1 -DTRAP_FM6_TEST=1 -DTRAP_UX_TEST=1 \
  -I"$FW/build/gen" -I"$FW/firmware/src" -I"$FW/web/emu" -I"$FW/web/emu/shim" \
  --no-entry -sSTANDALONE_WASM -sSTACK_SIZE=1048576 -sINITIAL_MEMORY=33554432 -sFILESYSTEM=0 \
  -Wl,--export-dynamic -o "$OUT/preview.wasm" "$HERE/preview.c"
ls -l "$OUT/preview.wasm"
