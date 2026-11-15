// Reads the JAM1 stream (autosave 9 + jam 17) the way ableton/kit_to_wav.py parse_jam does, read only.
// Gives the six tracks (engine, params, pattern steps) and the four scene masks: bit t of a mask = track t sounds in that scene
// (firmware seq.c: ph_masks[scene] ^= 1 << track).

const i16 = (b, i) => { const v = b[i] | (b[i + 1] << 8); return v & 0x8000 ? v - 0x10000 : v; };
const u16 = (b, i) => b[i] | (b[i + 1] << 8);

export function parseJam(obj9, obj17) {
  const a = new Uint8Array(obj9.length - 4 + obj17.length - 4);
  a.set(obj9.subarray(4), 0);
  a.set(obj17.subarray(4), obj9.length - 4);
  const jam = a;
  const magic = (jam[0] | (jam[1] << 8) | (jam[2] << 16) | (jam[3] << 24)) >>> 0;
  if (magic !== 0x314D414A) throw new Error("kein JAM1-Stream");
  let i = 4;
  const ng = jam[i + 3];
  i += 4;
  const G = [];
  for (let k = 0; k < ng; k++) G.push(i16(jam, i + 2 * k));
  i += 2 * ng;
  for (let r = 0; r < 2; r++) i += 2 + u16(jam, i);           // pm_mac, fxl blocks
  i += 2 + 4 * jam[i];                                          // motion: count, on, events
  const np = jam[i], ssz = jam[i + 1];
  i += 2;
  const tracks = [];
  for (let t = 0; t < 6; t++) {
    const eng = jam[i];
    i += 1;
    const params = [];
    for (let k = 0; k < np; k++) params.push(i16(jam, i + 2 * k));
    i += 2 * np;
    const n = jam[i];
    i += 1;
    const steps = {};
    for (let s = 0; s < n; s++) {
      const at = jam[i];
      steps[at] = jam.slice(i + 1, i + 1 + ssz);
      i += 1 + ssz;
    }
    tracks.push({ eng, params, steps });
  }
  const nKeys = jam[i];
  i += 1;
  for (let k = 0; k < nKeys; k++) { const c = jam[i + 1]; i += 2 + 3 * c; }
  for (let r = 0; r < 4; r++) i += 2 + u16(jam, i);            // acid, lastc+lastn, chord_cfg, tape_cfg
  const sz = u16(jam, i);
  const ph = [];
  for (let k = 0; k < sz / 2; k++) ph.push(i16(jam, i + 2 + 2 * k));
  return { G, tracks, masks: ph.slice(2, 6), np, ssz };
}
