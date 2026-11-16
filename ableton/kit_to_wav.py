#!/usr/bin/env python3
"""Trapstation backup (TRAPSTATION-Sicherung-*.json) -> one WAV per track per kit.

Kit sounds come from the GBK3 kit objects (engine = used, params stored as value - 64). The pattern and
the globals come from the last jam (JAM1 or JAM6 stream, objects 9 + 17). Each track is rendered by the firmware's
own sequencer (tools/render_scenes.c, emulator core): steps, swing, gate, ties, ratchets, rolls,
probability and conditions all run as on the device. The 4 scenes play once each, in order; the scene
masks decide which track sounds in a scene.

A project of the FM6 firmware (JAM6) is rendered by render_scenes_fm6.exe. Its FMSYN tracks are FM6 voices,
which live in the project and not in a kit: such a track plays the project's own voice in every kit.

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
ENGINE_NAME = {1: "DIGITAL", 2: "ANALOG", 3: "SAMPLER", 4: "MONO", 5: "FM6"}
ENGI_FM6 = 5                                  # core.h
FM6_LEN = 158                                 # eng_trap_fm6.c tf6_edit: 155 voice bytes + DRIVE, CUTOFF, OUTPUT
JAM1, JAM6, JAM7 = 0x314D414A, 0x364D414A, 0x374D414A
# the renderers are bundled next to this file (or inside the .exe): one per firmware engine set
HERE = sys._MEIPASS if getattr(sys, "frozen", False) else os.path.dirname(os.path.abspath(__file__))
RENDER = os.path.join(HERE, "render_scenes.exe")            # firmware 1.0.0.0 (JAM1)
RENDER_FM6 = os.path.join(HERE, "render_scenes_fm6.exe")    # FM6 firmware (JAM6)
STEP_BYTES = 12                               # sizeof(step_t)


def i16(b, i):
    return struct.unpack_from("<h", b, i)[0]


def u16(b, i):
    return struct.unpack_from("<H", b, i)[0]


def parse_jam(obj9, obj17):
    """JAM1 / JAM6 / JAM7 stream: globals, the six tracks (engine, params, steps), the scene masks, the FM6 voices.

    JAM7 (firmware 1.1.0.1 and later): the big blocks packed in pieces of 16 bytes, each a mask of its bytes that are
    not 0, then those bytes (gb_store.c jam_wb); at the end only the FM6 tracks' voices."""
    # the second object continues the first only when both carry the same generation number (gb_store.c)
    jam = obj9[4:] + (obj17[4:] if obj17[:4] == obj9[:4] else b"")
    magic = struct.unpack_from("<I", jam, 0)[0]
    if magic not in (JAM1, JAM6, JAM7):
        raise ValueError("no JAM1, JAM6 or JAM7 stream")
    pk = magic == JAM7
    pos = [4]

    def block(length):
        i = pos[0]
        if not pk:
            pos[0] = i + length
            return bytes(jam[i:i + length])
        out = bytearray(length)
        for o in range(0, length, 16):
            e = min(16, length - o)
            m = u16(jam, i)
            i += 2
            for k in range(e):
                if m & (1 << k):
                    out[o + k] = jam[i]
                    i += 1
        pos[0] = i
        return bytes(out)

    i = 4
    ng = jam[i + 3]
    i += 4
    G = [i16(jam, i + 2 * k) for k in range(ng)]
    i += 2 * ng
    for _ in range(2):                        # pm_mac, fxl blocks
        n = u16(jam, i)
        pos[0] = i + 2
        block(n)
        i = pos[0]
    i += 2 + 4 * jam[i]                       # motion: count, on, events (4 bytes each)
    np_, ssz = jam[i], jam[i + 1] & 0x7F
    i += 2
    tracks = []
    for _ in range(6):
        eng = jam[i]
        pos[0] = i + 1
        pb = block(2 * np_)
        i = pos[0]
        params = [i16(pb, 2 * k) for k in range(np_)]
        n = jam[i]
        i += 1
        steps = {}
        for _ in range(n):
            at = jam[i]
            pos[0] = i + 1
            steps[at] = block(ssz)
            i = pos[0]
        tracks.append({"eng": eng, "params": params, "steps": steps})
    n_keys = jam[i]
    i += 1
    for _ in range(n_keys):
        c = jam[i + 1]
        i += 2 + 3 * c
    n = u16(jam, i)                           # acid
    pos[0] = i + 2
    block(n)
    i = pos[0]
    for _ in range(3):                        # lastc+lastn, chord_cfg, tape_cfg
        i += 2 + u16(jam, i)
    sz = u16(jam, i)
    ph = [i16(jam, i + 2 + 2 * k) for k in range(sz // 2)]
    i += 2 + sz
    fm6 = None
    if magic == JAM6:
        # sized blocks follow; the one of 6 x 158 values holds the FM6 voices of the six tracks
        k = i
        while k + 2 <= len(jam):
            n = u16(jam, k)
            if n == 6 * FM6_LEN * 2 and k + 2 + n <= len(jam):
                fm6 = [[i16(jam, k + 2 + 2 * (t * FM6_LEN + j)) for j in range(FM6_LEN)] for t in range(6)]
                break
            k += 2 + n
    elif pk:
        # the generator block and the slices (packed), then a track mask and each FM6 track's voice
        for _ in range(2):
            n = u16(jam, i)
            pos[0] = i + 2
            block(n)
            i = pos[0]
        n = u16(jam, i)
        i += 2
        if n >= 1 and i + n <= len(jam):
            mask = jam[i]
            i += 1
            fm6 = [None] * 6
            for t in range(6):
                if not mask & (1 << t):
                    continue
                v = list(jam[i:i + 155])
                i += 155
                v += [i16(jam, i + 2 * j) for j in range(3)]
                i += 6
                fm6[t] = v
            if not any(fm6):
                fm6 = None
    return {"G": G, "tracks": tracks, "masks": ph[2:6], "fm6_format": magic != JAM1, "fm6": fm6}


def parse_kits(obj13, obj14):
    """GBK3 kit objects: 8-byte header, 3 kits per object. Returns 6 kits of 6 tracks; None for an object not saved."""
    kits = []
    for obj in (obj13, obj14):
        for k in range(3):
            if obj is None:
                kits.append(None)
                continue
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
        if track_is_fm6(jam, t):
            # an FM6 voice is not in a kit: the project's own track, parameters and voice
            lines.append(f"track {t + 1} FM6")
            params = list(jam["tracks"][t]["params"])[:PCOUNT]
            for i, v in enumerate(jam["fm6"][t]):
                lines.append(f"f {t + 1} {i} {v}")
        else:
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


def track_is_fm6(jam, t):
    return bool(jam.get("fm6")) and jam["fm6"][t] is not None and jam["tracks"][t]["eng"] == ENGI_FM6


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
    render = RENDER_FM6 if jam["fm6_format"] else RENDER
    if not os.path.exists(render):
        raise FileNotFoundError(f"the renderer is missing: {render}")
    kits = parse_kits(obj.get(13), obj.get(14))
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
        if kit is None or (wanted and ki not in wanted):
            continue
        for t in range(6):
            spec = os.path.join(tmp, f"k{ki}t{t + 1}.txt")
            write_spec(spec, jam, kit, t + 1, scene_ms, total_ms, samples_path)
            name = f"Kit{ki}_Track{t + 1}.wav"
            out = os.path.join(out_dir, name)
            subprocess.run([render, spec, out], check=True)
            engine = "FM6 (project voice)" if track_is_fm6(jam, t) else ENGINE_NAME.get(kit[t]["used"], "-")
            print(f"{name}: {total_ms / 1000:.2f} s, engine {engine}")


if __name__ == "__main__":
    try:
        main()
        print("Done.")
    except Exception as e:                    # keep the window open on errors
        print("Error:", e)
        if len(sys.argv) >= 3:                # called by the app: report the failure
            sys.exit(1)
    if len(sys.argv) < 3:
        input("Press Enter to close ...")
