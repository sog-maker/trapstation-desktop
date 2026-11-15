#!/usr/bin/env python3
"""Trapstation backup (TRAPSTATION-Sicherung-*.json) -> one WAV per track per kit.

Kit sounds come from the GBK3 kit objects (engine = used, params stored as value - 64). The pattern and
the globals come from the last jam (JAM1 stream, objects 9 + 17). Each track is rendered by the firmware's
own sequencer (tools/render_scenes.c, emulator core): steps, swing, gate, ties, ratchets, rolls,
probability and conditions all run as on the device. The 4 scenes play once each, in order; the scene
masks decide which track sounds in a scene.

Usage (WSL):  python3 kit_to_wav.py BACKUP.json OUTDIR
"""
import base64
import json
import os
import struct
import subprocess
import sys
import tempfile


PCOUNT = 111                                  # P_COUNT (core.h); the kit's np
P_SLEN, P_SDIV, P_SSWING, P_SGATE = 29, 30, 31, 32
P_APROB, P_MUTE, P_SQNT = 22, 40, 94
# fields of a kit that are not sound: the jam's values are used for them (gb_store.c: the step-note data,
# the marker in P_MUTE, and the pattern's own settings)
NOT_SOUND = (P_SLEN, P_SDIV, P_SSWING, P_SGATE, P_APROB, P_MUTE, P_SQNT)
KIT_BYTES = 1272                              # one kit of a GBK3 object (3 kits per object)
ENGINE_NAME = {1: "DIGITAL", 2: "ANALOG", 3: "SAMPLER", 4: "MONO"}
if getattr(sys, "frozen", False):                      # the .exe: the renderer is bundled next to it
    RENDER = os.path.join(sys._MEIPASS, "render_scenes.exe")
else:
    RENDER = os.path.join(os.path.dirname(os.path.abspath(__file__)), "render_scenes.exe")
STEP_BYTES = 12                               # sizeof(step_t)


def i16(b, i):
    return struct.unpack_from("<h", b, i)[0]


def u16(b, i):
    return struct.unpack_from("<H", b, i)[0]


def parse_jam(obj9, obj17):
    """JAM1 stream: globals, the six tracks (engine, params, steps), the scene masks."""
    jam = obj9[4:] + obj17[4:]
    if struct.unpack_from("<I", jam, 0)[0] != 0x314D414A:
        raise ValueError("no JAM1 stream")
    i = 4
    ng = jam[i + 3]
    i += 4
    G = [i16(jam, i + 2 * k) for k in range(ng)]
    i += 2 * ng
    for _ in range(2):                        # pm_mac, fxl blocks
        i += 2 + u16(jam, i)
    i += 2 + 4 * jam[i]                       # motion: count, on, events (4 bytes each)
    np_, ssz = jam[i], jam[i + 1]
    i += 2
    tracks = []
    for _ in range(6):
        eng = jam[i]
        i += 1
        params = [i16(jam, i + 2 * k) for k in range(np_)]
        i += 2 * np_
        n = jam[i]
        i += 1
        steps = {}
        for _ in range(n):
            at = jam[i]
            steps[at] = bytes(jam[i + 1:i + 1 + ssz])
            i += 1 + ssz
        tracks.append({"eng": eng, "params": params, "steps": steps})
    n_keys = jam[i]
    i += 1
    for _ in range(n_keys):
        c = jam[i + 1]
        i += 2 + 3 * c
    for _ in range(4):                        # acid, lastc+lastn, chord_cfg, tape_cfg
        i += 2 + u16(jam, i)
    sz = u16(jam, i)
    ph = [i16(jam, i + 2 + 2 * k) for k in range(sz // 2)]
    return {"G": G, "tracks": tracks, "masks": ph[2:6]}


def parse_kits(obj13, obj14):
    """GBK3 kit objects: 8-byte header, 3 kits per object. Returns 6 kits of 6 tracks."""
    kits = []
    for obj in (obj13, obj14):
        for k in range(3):
            kb = obj[8 + k * KIT_BYTES: 8 + (k + 1) * KIT_BYTES]
            tracks = []
            for t in range(6):
                pos = 4 + t * (2 + PCOUNT)
                raw = kb[pos + 2: pos + 2 + PCOUNT]
                vals = [(b - 256 if b > 127 else b) + 64 for b in raw]
                tracks.append({"used": kb[pos], "params": vals})
            kits.append(tracks)
    return kits


def division_ms(div, beat_ms):
    """fx.c div_samples: N_SDIV index -> step length in ms (beat = quarter note)."""
    if div < 6:
        return beat_ms / (1, 2, 4, 8, 3, 6)[div]
    if div < 10:
        return beat_ms * (1 << (div - 5))
    return beat_ms / 16


def write_spec(path, jam, kit, audible, scene_ms, total_ms, samples_path):
    lines = [f"samples {samples_path}"]
    for i, v in enumerate(jam["G"]):
        lines.append(f"g {i} {v}")
    for t in range(6):
        used = kit[t]["used"]
        lines.append(f"track {t + 1} {ENGINE_NAME.get(used, 'DIGITAL')}")
        params = list(kit[t]["params"])
        for i in NOT_SOUND:
            params[i] = jam["tracks"][t]["params"][i]
        for i, v in enumerate(params):
            lines.append(f"p {t + 1} {i} {v}")
        for at, raw in sorted(jam["tracks"][t]["steps"].items()):
            lines.append(f"step {t + 1} {at} {raw.hex()}")
    lines.append("masks " + " ".join(str(m) for m in jam["masks"]))
    lines.append(f"scene_ms {scene_ms:.3f}")
    lines.append(f"audible {audible}")
    lines.append(f"total_ms {total_ms:.3f}")
    with open(path, "w") as f:
        f.write("\n".join(lines) + "\n")


def scene_length_ms(jam, beat_ms):
    """One scene: the longest track's pattern (LEN steps of its DIV)."""
    best = 0.0
    for tr in jam["tracks"]:
        L = max(1, min(64, tr["params"][P_SLEN]))
        best = max(best, L * division_ms(tr["params"][P_SDIV] & 0xFF, beat_ms))
    return best


def ask_paths():
    """No arguments (double click): ask for the backup and the output folder."""
    src = input("Sicherung (TRAPSTATION-Sicherung-*.json): ").strip().strip('"')
    default = os.path.join(os.path.dirname(src), "Trapstation-Renders", os.path.splitext(os.path.basename(src))[0])
    out = input(f"Ausgabeordner [{default}]: ").strip().strip('"') or default
    return src, out


def main():
    if len(sys.argv) >= 3:
        src, out_dir = sys.argv[1], sys.argv[2]
    else:
        src, out_dir = ask_paths()
    d = json.load(open(src, encoding="utf-8"))
    obj = {int(k): base64.b64decode(v) for k, v in d["objects"].items()}
    jam = parse_jam(obj[9], obj[17])
    kits = parse_kits(obj[13], obj[14])
    beat_ms = 60000.0 / jam["G"][0]           # G_BPM
    scene_ms = scene_length_ms(jam, beat_ms)
    total_ms = 4 * scene_ms + 1000.0
    os.makedirs(out_dir, exist_ok=True)
    tmp = tempfile.mkdtemp()
    samples_path = os.path.join(tmp, "samples.bin")       # the FSM2 image: table block, then the data
    with open(samples_path, "wb") as f:
        f.write(base64.b64decode(d["samples"]))
    wanted = [int(x) for x in sys.argv[3].split(",")] if len(sys.argv) > 3 and sys.argv[3] else None   # optional kit list "1,3"
    for ki, kit in enumerate(kits, start=1):
        if wanted and ki not in wanted:
            continue
        for t in range(6):
            spec = os.path.join(tmp, f"k{ki}t{t + 1}.txt")
            write_spec(spec, jam, kit, t + 1, scene_ms, total_ms, samples_path)
            name = f"Kit{ki}_Track{t + 1}.wav"
            out = os.path.join(out_dir, name)
            subprocess.run([RENDER, spec, out], check=True)
            print(f"{name}: {total_ms / 1000:.2f} s, engine {ENGINE_NAME.get(kit[t]['used'], '-')}")


if __name__ == "__main__":
    try:
        main()
        print("Done.")
    except Exception as e:                    # keep the window open on errors
        print("Error:", e)
    if len(sys.argv) < 3:
        input("Press Enter to close ...")
