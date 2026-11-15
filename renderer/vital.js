// Vital preset (.vital, plain JSON) -> FM-1 parameter suggestion. An approximation, not an exact translation:
// every value that is a guess is listed in `notes`, so the editor can show it and the user can change it.
// Vital's scales are read from the file's own values (0..1 normalised, cutoff in MIDI-note-like units); the
// cutoff scale is an assumption and is marked as such.
import { PNAMES } from "./params.js";

const idx = (name) => PNAMES.indexOf(name);
const clampFm = (v) => Math.max(-64, Math.min(127, Math.round(v)));
const norm127 = (x) => clampFm(x * 127);            // 0..1 -> 0..127 (stored value range -64..127)

export function parseVital(text) {
  const j = JSON.parse(text);
  if (!j.settings) throw new Error("Not a Vital file (settings missing)");
  return j;
}

// the analysis: which source drives what, from the file itself
export function analyse(j) {
  const s = j.settings;
  const oscOn = [1, 2, 3].filter((n) => s[`osc_${n}_on`] > 0.5);
  const sampleOn = s.sample_on > 0.5 && (s.sample_level || 0) > 0;
  return {
    name: j.preset_name || "",
    author: j.author || "",
    style: j.preset_style || "",
    oscillators: oscOn,
    wavetable: oscOn.length > 0,
    unisonVoices: s.osc_1_unison_voices || 1,
    sample: sampleOn,
    filter: s.filter_1_on > 0.5,
    distortion: s.distortion_on > 0.5 ? { drive: s.distortion_drive, type: s.distortion_type } : null,
    reverb: s.reverb_on > 0.5, delay: s.delay_on > 0.5, chorus: s.chorus_on > 0.5,
    polyphony: s.polyphony || 1,
  };
}

// engine suggestion: a sample dominates, otherwise the wavetable/subtractive part becomes DIGITAL (the FM-1's filter synth)
export function pickEngine(a) {
  if (a.sample) return "SAMPLER";
  if (a.wavetable) return "DIGITAL";
  return "FM";
}

// the suggestion: 111 values (stored order = PNAMES), with a note for every guess
export function toFm1(j) {
  const s = j.settings, a = analyse(j), notes = [];
  const v = new Array(PNAMES.length).fill(0);
  const set = (name, val, note) => { const i = idx(name); if (i >= 0) { v[i] = clampFm(val); if (note) notes.push(`${name}: ${note}`); } };

  // amplitude envelope (env_1 drives the voice in the usual Vital setup): times are normalised 0..1 in the file
  set("ATK", norm127(s.env_1_attack), "env_1 attack, 0..1 scaled linearly (not a time in ms)");
  set("DEC", norm127(s.env_1_decay), "env_1 decay, scaled linearly");
  set("SUS", norm127(s.env_1_sustain), "env_1 sustain, 0..1");
  set("REL", norm127(s.env_1_release), "env_1 release, scaled linearly");

  // filter (only when the FM-1 DIGITAL engine is picked): cutoff scale is an assumption (MIDI-note-like 0..136)
  if (a.filter) {
    set("FM1_ATK", (s.filter_1_cutoff / 136) * 127, "filter cutoff: scale assumed (value / 136); check by ear");
    set("FM1_DEC", norm127(s.filter_1_resonance), "filter resonance 0..1");
  }
  if (a.distortion) set("DIST", norm127(Math.min(1, s.distortion_drive / 10)), "distortion drive, scaled by /10 (assumed)");
  if (a.reverb) set("REV", norm127(0.3), "reverb on; the mix is not read here, a fixed 30 % is a guess");
  if (a.delay) notes.push("delay on: not mapped (FM-1 delay is a global FX, set it by hand)");
  if (a.chorus) notes.push("chorus on: not mapped (no FM-1 equivalent in this table)");
  if (a.unisonVoices > 1) notes.push(`unison ${a.unisonVoices} voices: the FM-1 plays one voice per part; detune is not mapped`);

  const engine = pickEngine(a);
  if (a.wavetable) notes.push("wavetable: the FM-1 has no wavetable oscillator; the engine is an approximation");
  if (a.sample) notes.push("embedded sample: the sampler route plays the original audio, use it instead of the synth values");
  return { name: a.name, author: a.author, engine, values: v, notes, analysis: a };
}
