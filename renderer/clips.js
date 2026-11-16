// Arrangement clips: one clip = one track in one scene (its mask bit set). Read only.
// Step record (firmware core.h step_t, 12 bytes): note[0..3], n, time, flags, vel, hit, acc, probability, roll.
// time: 0 NOTE, 1 TIE, 2 REST, 3 LOCK (core.h enum). Steps per quarter note from the division (fx.c div_samples).
// Drum-type tracks (engine code above 4 in this file's assumption): the hit bits, one lane = note 36 + lane (GM, assumed).
import { PNAMES } from "./params.js";

const PPQ = 480;
export const SLEN = PNAMES.indexOf("SLEN"), SDIV = PNAMES.indexOf("SDIV");

export function stepsPerBeat(div) {
  if (div < 6) return [1, 2, 4, 8, 3, 6][div];
  if (div < 10) return 1 / (1 << (div - 5));
  return 16;
}

export const isDrum = (eng) => eng > 4;

// the clip's notes: { tick, dur, note, vel } in ticks, scene-local (tick 0 = scene start)
export function clipNotes(track, bpmStepsLen, perStep) {
  const notes = [];
  const L = bpmStepsLen;
  const steps = track.steps;
  for (let a = 0; a < L; a++) {
    const st = steps[a];
    if (!st) continue;
    const t0 = Math.round(a * perStep);
    if (isDrum(track.eng)) {
      for (let l = 0; l < 8; l++) {
        if ((st[8] >> l) & 1) {
          const accent = (st[9] >> l) & 1;
          notes.push({ tick: t0, dur: Math.max(1, Math.round(perStep)), note: 36 + l, vel: accent ? 127 : (st[7] || 100) });
        }
      }
      continue;
    }
    if (st[5] !== 0 || st[4] === 0) continue;               // only NOTE steps start a note
    let len = 1, b = a + 1;
    while (b < L && steps[b] && steps[b][5] === 1) { len++; b++; }   // TIE steps extend the note
    notes.push({ tick: t0, dur: Math.max(1, Math.round(len * perStep)), note: st[0], vel: st[7] || 100 });
  }
  return notes;
}

// one clip: the track's content over the scene length (SLEN steps of its division)
export function clipOf(jam, t, s) {
  const tr = jam.tracks[t];
  const L = Math.max(1, Math.min(64, tr.params[SLEN] || 16));
  const perStep = PPQ / stepsPerBeat(tr.params[SDIV] & 0xFF);
  const on = ((jam.masks[s] >> t) & 1) === 1;
  return { scene: s, track: t, on, drum: isDrum(tr.eng), steps: L, lengthTicks: Math.round(L * perStep), notes: on ? clipNotes(tr, L, perStep) : [] };
}

// one scene in ticks: the longest track's pattern (the same rule as the kit export's scene_length_ms)
export function sceneTicks(jam) {
  let best = 0;
  for (const tr of jam.tracks) {
    const L = Math.max(1, Math.min(64, tr.params[SLEN] || 16));
    best = Math.max(best, L * PPQ / stepsPerBeat(tr.params[SDIV] & 0xFF));
  }
  return Math.round(best);
}

// one scene as a Standard MIDI File, format 1: one MIDI track per jam track (tracks = [{ notes }]), tempo from the jam
export function smfScene(tracks, lengthTicks, bpm) {
  const vlq = (v) => { const out = [v & 127]; v >>= 7; while (v) { out.unshift((v & 127) | 128); v >>= 7; } return out; };
  const chunk = (body) => [0x4D, 0x54, 0x72, 0x6B, (body.length >>> 24) & 255, (body.length >>> 16) & 255, (body.length >>> 8) & 255, body.length & 255, ...body];
  // the tempo has a track of its own (format 1 convention): Ableton takes it as the conductor, not as one of the six tracks
  const us = Math.round(60000000 / (bpm || 120));
  const chunks = [chunk([...vlq(0), 0xFF, 0x51, 0x03, (us >> 16) & 255, (us >> 8) & 255, us & 255, ...vlq(0), 0xFF, 0x2F, 0x00])];
  for (const tr of tracks) {
    const ev = [];
    for (const n of tr.notes) {
      ev.push({ tick: n.tick, order: 1, bytes: [0x90, n.note & 127, n.vel & 127] });
      ev.push({ tick: n.tick + n.dur, order: 0, bytes: [0x80, n.note & 127, 0] });
    }
    ev.sort((a, b) => a.tick - b.tick || a.order - b.order);
    const body = [];
    if (tr.name) { const nm = [...tr.name].map((c) => c.charCodeAt(0) & 127); body.push(...vlq(0), 0xFF, 0x03, nm.length, ...nm); }   // track name: Ableton shows it
    let last = 0;
    for (const e of ev) { body.push(...vlq(e.tick - last), ...e.bytes); last = e.tick; }
    body.push(...vlq(Math.max(0, lengthTicks - last)), 0xFF, 0x2F, 0x00);
    chunks.push(chunk(body));
  }
  const ntrk = chunks.length;
  const hdr = [0x4D, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 1, (ntrk >> 8) & 255, ntrk & 255, (PPQ >> 8) & 255, PPQ & 255];
  return new Uint8Array([...hdr, ...chunks.flat()]);
}

// Standard MIDI File, format 0, one track, tempo from the jam's BPM
export function smf(notes, lengthTicks, bpm) {
  const ev = [];
  for (const n of notes) {
    ev.push({ tick: n.tick, order: 1, bytes: [0x90, n.note & 127, n.vel & 127] });
    ev.push({ tick: n.tick + n.dur, order: 0, bytes: [0x80, n.note & 127, 0] });
  }
  ev.sort((a, b) => a.tick - b.tick || a.order - b.order);
  const body = [];
  const vlq = (v) => { const out = [v & 127]; v >>= 7; while (v) { out.unshift((v & 127) | 128); v >>= 7; } return out; };
  const us = Math.round(60000000 / (bpm || 120));
  body.push(...vlq(0), 0xFF, 0x51, 0x03, (us >> 16) & 255, (us >> 8) & 255, us & 255);
  let last = 0;
  for (const e of ev) { body.push(...vlq(e.tick - last), ...e.bytes); last = e.tick; }
  body.push(...vlq(Math.max(0, lengthTicks - last)), 0xFF, 0x2F, 0x00);
  const hdr = [0x4D, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, (PPQ >> 8) & 255, PPQ & 255];
  const trk = [0x4D, 0x54, 0x72, 0x6B, (body.length >>> 24) & 255, (body.length >>> 16) & 255, (body.length >>> 8) & 255, body.length & 255];
  return new Uint8Array([...hdr, ...trk, ...body]);
}
