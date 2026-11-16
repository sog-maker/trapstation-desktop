# The sound engine of the editor

`preview.wasm` is TRAPSTATION OS 1.1.0.0 built for the browser: `preview/preview.c` of this repository with the
firmware's sources (https://github.com/sog-maker/trapstation-os, tag `v1.1.0.0`), compiled by `preview/build.sh`.

Its FM6 synthesis core is msfa, the core of Dexed: Copyright 2012 Google Inc., Copyright 2016-2025 Pascal Gauthier,
in the integer C port by Leo Kuroshita (@kurogedelic), Hügelton Instruments, under the Apache License 2.0
(`Apache-2.0-msfa.txt` next to this file). The rest of the firmware is GPL-3.0-only.
