"""Schreibt eine Live-Datei (.als) aus den gerenderten Kit-WAVs, auf Basis des Templates (template.als).

Drum Rack: Pads 1-6 laden Kit 1, Track 1-6. Audio-Spuren 2-7: pro Kit-Track eine Spur, Kits 1-6 nacheinander
als Arrangement-Clips. Keine MIDI-Spuren. Tempo und alle anderen Einstellungen des Templates bleiben.
"""
import copy, gzip, os, sys, wave
import xml.etree.ElementTree as ET

POSITIONAL = {"ClipSlot", "MultiSamplePart", "Scene", "WarpMarker", "BranchSourceContext",
              "AbletonDefaultPresetRef", "TrackSendHolder", "MidiEditorLaneModel", "AutomationLane"}
TEMPLATE_BPM = 120.0


def template_path():
    if getattr(sys, "frozen", False):
        return os.path.join(sys._MEIPASS, "template.als")
    return os.path.join(os.path.dirname(os.path.abspath(__file__)), "template.als")


def _renumber(el, counter):
    for node in el.iter():
        if "Id" in node.attrib and node.tag not in POSITIONAL:
            node.set("Id", str(counter[0]))
            counter[0] += 1


def _set_file(el, path, rel):
    for fr in el.iter("FileRef"):
        fr.find("RelativePath").set("Value", rel)
        fr.find("Path").set("Value", path)
        fr.find("Type").set("Value", "1")


def _wav_info(path):
    with wave.open(path) as w:
        return w.getnframes(), w.getframerate()


def build(wav_dir, out_path, kits=6):
    out_dir = os.path.dirname(os.path.abspath(out_path))
    root = ET.fromstring(gzip.open(template_path()).read().decode("utf-8"))
    counter = [int(root.find(".//NextPointeeId").get("Value"))]

    part0 = next(root.iter("MultiSamplePart"))
    clip0 = copy.deepcopy(next(root.iter("AudioClip")))
    drum = next(mt for mt in root.iter("MidiTrack") if mt.find("Name/EffectiveName").get("Value") == "1-Drum Rack")
    simplers = list(drum.iter("OriginalSimpler"))
    audio_tracks = list(root.iter("AudioTrack"))

    # the kits to use: a count (1..n) or a list of kit numbers
    kit_ids = list(range(1, kits + 1)) if isinstance(kits, int) else list(kits)
    # Pads 1-6: the first chosen kit, Track 1-6
    for i, simp in enumerate(simplers[:6]):
        wav = os.path.join(wav_dir, f"Kit{kit_ids[0]}_Track{i + 1}.wav")
        parts = simp.find(".//MultiSampleMap/SampleParts")
        for old in list(parts):
            parts.remove(old)
        part = copy.deepcopy(part0)
        part.find("Name").set("Value", os.path.basename(wav))
        frames, _ = _wav_info(wav)
        part.find("SampleEnd").set("Value", str(frames))
        _set_file(part, os.path.abspath(wav), os.path.relpath(wav, out_dir).replace("\\", "/"))
        _renumber(part, counter)
        parts.append(part)

    # Audio-Spuren 2-7: Kit-Track t auf Spur t+1, Kits 1..kits nacheinander
    for t in range(6):
        tr = audio_tracks[t]
        name = tr.find("Name/EffectiveName")
        name.set("Value", f"{t + 2}-Audio")
        tr.find("Name/MemorizedFirstClipName").set("Value", "")
        events = tr.find("DeviceChain/MainSequencer/Sample/ArrangerAutomation/Events")
        for old in list(events):
            events.remove(old)
        position = 0.0
        for kit in kit_ids:
            wav = os.path.join(wav_dir, f"Kit{kit}_Track{t + 1}.wav")
            frames, rate = _wav_info(wav)
            beats = (frames / rate) * TEMPLATE_BPM / 60.0
            clip = copy.deepcopy(clip0)
            clip.set("Time", f"{position:.6f}")
            clip.find("Name").set("Value", os.path.basename(wav))
            clip.find("CurrentStart").set("Value", "0")
            clip.find("CurrentEnd").set("Value", f"{beats:.6f}")
            _set_file(clip, os.path.abspath(wav), os.path.relpath(wav, out_dir).replace("\\", "/"))
            _renumber(clip, counter)
            events.append(clip)
            position += beats

    root.find(".//NextPointeeId").set("Value", str(counter[0] + 1))
    with gzip.open(out_path, "wb") as f:
        f.write(ET.tostring(root, encoding="utf-8", xml_declaration=True))
    return out_path

def add_midi(als_path, data_path):
    """One MIDI track per jam track, its clips at their scene positions, the notes inside the clips.
    data_path: JSON {"scene_beats": float, "tracks": [{"name", "clips": [{"scene", "length", "notes": [{"beat", "dur", "note", "vel"}]}]}]}.
    The track is a copy of the template's MIDI track (its instrument stays), the clip a copy of the template's MIDI clip."""
    import json
    data = json.load(open(data_path, encoding="utf-8"))
    root = ET.fromstring(gzip.open(als_path).read().decode("utf-8"))
    counter = [int(root.find(".//NextPointeeId").get("Value"))]
    base = next(root.iter("MidiTrack"))
    clip_t = copy.deepcopy(next(root.iter("MidiClip")))
    tracks = root.find(".//Tracks")
    scene_beats = float(data["scene_beats"])
    for tr in data["tracks"]:
        nt = copy.deepcopy(base)
        # the drum rack is not copied: each branch carries sends, and a copy adds more send knobs than the set has returns
        dev = nt.find("DeviceChain/DeviceChain/Devices")
        if dev is not None:
            for ch in list(dev):
                dev.remove(ch)
        nt.find("Name/EffectiveName").set("Value", tr["name"])
        events = next(nt.iter("ArrangerAutomation")).find("Events")
        for old in list(events):
            events.remove(old)
        nid = 1
        for clip in tr["clips"]:
            c = copy.deepcopy(clip_t)
            c.set("Time", f"{clip['scene'] * scene_beats:.6f}")
            length = float(clip["length"])
            c.find("CurrentStart").set("Value", "0")
            c.find("CurrentEnd").set("Value", f"{length:.6f}")
            loop = c.find("Loop")
            loop.find("LoopStart").set("Value", "0")
            loop.find("LoopEnd").set("Value", f"{length:.6f}")
            loop.find("OutMarker").set("Value", f"{length:.6f}")
            c.find("Name").set("Value", f"Szene {clip['scene'] + 1}")
            kts = c.find("Notes/KeyTracks")
            for ch in list(kts):
                kts.remove(ch)
            by = {}
            for n in clip["notes"]:
                by.setdefault(int(n["note"]), []).append(n)
            for pitch in sorted(by):
                kt = ET.SubElement(kts, "KeyTrack", Id="0")
                nts = ET.SubElement(kt, "Notes")
                for n in sorted(by[pitch], key=lambda x: x["beat"]):
                    ET.SubElement(nts, "MidiNoteEvent", Time=f"{n['beat']:.6f}", Duration=f"{n['dur']:.6f}",
                                  Velocity=str(int(n["vel"])), OffVelocity="64", NoteId=str(nid))
                    nid += 1
                ET.SubElement(kt, "MidiKey", Value=str(pitch))
            _renumber(c, counter)
            events.append(c)
        _renumber(nt, counter)
        # Ableton keeps the return tracks after all normal tracks: the new track goes in front of the first return
        first_ret = next((i for i, t in enumerate(list(tracks)) if t.tag == "ReturnTrack"), None)
        if first_ret is None:
            tracks.append(nt)
        else:
            tracks.insert(first_ret, nt)
    root.find(".//NextPointeeId").set("Value", str(counter[0] + 1))
    with gzip.open(als_path, "wb") as f:
        f.write(ET.tostring(root, encoding="utf-8", xml_declaration=True))
    return als_path
