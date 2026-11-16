// Reads the JAM1 / JAM6 / JAM7 stream (autosave 9 + jam 17) the way ableton/kit_to_wav.py parse_jam does, read only.
// Gives the six tracks (engine, params, pattern steps) and the four scene masks: bit t of a mask = track t sounds in that scene
// (firmware seq.c: ph_masks[scene] ^= 1 << track).
// JAM1: firmware 1.0.0.0. JAM6: 1.1.0.0 (the same stream, the six FM6 voices at the end). JAM7: 1.1.0.1 and later (the
// big blocks packed, see unpack; at the end only the FM6 tracks' voices, 155 bytes + DRIVE, CUTOFF, OUTPUT each).

const FM6_LEN = 158;       // eng_trap_fm6.c tf6_edit: 155 voice bytes + DRIVE, CUTOFF, OUTPUT
export const ENGI_FM6 = 5; // core.h
const JAM1 = 0x314D414A, JAM6 = 0x364D414A, JAM7 = 0x374D414A;

const i16 = (b, i) => { const v = b[i] | (b[i + 1] << 8); return v & 0x8000 ? v - 0x10000 : v; };
const u16 = (b, i) => b[i] | (b[i + 1] << 8);

export function parseJam(obj9, obj17) {
  // the second object continues the first only when both carry the same generation number (gb_store.c jam_load)
  const gen = (o) => (o[0] | (o[1] << 8) | (o[2] << 16) | (o[3] << 24)) >>> 0;
  const two = obj17 && obj17.length >= 4 && gen(obj17) === gen(obj9);
  const a = new Uint8Array(obj9.length - 4 + (two ? obj17.length - 4 : 0));
  a.set(obj9.subarray(4), 0);
  if (two) a.set(obj17.subarray(4), obj9.length - 4);
  const jam = a;
  const magic = (jam[0] | (jam[1] << 8) | (jam[2] << 16) | (jam[3] << 24)) >>> 0;
  if (magic !== JAM1 && magic !== JAM6 && magic !== JAM7) throw new Error("not a JAM1, JAM6 or JAM7 stream");
  const pk = magic === JAM7;
  const fm6Format = magic !== JAM1;
  let i = 4;
  // JAM7: a block in pieces of 16 bytes, each a mask of its bytes that are not 0, then those bytes (gb_store.c jam_wb)
  const block = (len) => {
    if (!pk) { const b = jam.slice(i, i + len); i += len; return b; }
    const b = new Uint8Array(len);
    for (let o = 0; o < len; o += 16) {
      const e = Math.min(16, len - o), m = u16(jam, i);
      i += 2;
      for (let k = 0; k < e; k++) if (m & (1 << k)) b[o + k] = jam[i++];
    }
    return b;
  };
  const ng = jam[i + 3];
  i += 4;
  const G = [];
  for (let k = 0; k < ng; k++) G.push(i16(jam, i + 2 * k));
  i += 2 * ng;
  for (let r = 0; r < 2; r++) { const n = u16(jam, i); i += 2; block(n); }   // pm_mac, fxl blocks
  i += 2 + 4 * jam[i];                                          // motion: count, on, events
  const np = jam[i], ssz = jam[i + 1] & 0x7f;
  i += 2;
  const tracks = [];
  for (let t = 0; t < 6; t++) {
    const eng = jam[i];
    i += 1;
    const pb = block(2 * np);
    const params = [];
    for (let k = 0; k < np; k++) params.push(i16(pb, 2 * k));
    const n = jam[i];
    i += 1;
    const steps = {};
    for (let s = 0; s < n; s++) {
      const at = jam[i];
      i += 1;
      steps[at] = block(ssz);
    }
    tracks.push({ eng, params, steps });
  }
  const nKeys = jam[i];
  i += 1;
  for (let k = 0; k < nKeys; k++) { const c = jam[i + 1]; i += 2 + 3 * c; }
  { const n = u16(jam, i); i += 2; block(n); }                 // acid
  for (let r = 0; r < 3; r++) i += 2 + u16(jam, i);            // lastc+lastn, chord_cfg, tape_cfg
  const sz = u16(jam, i);
  const ph = [];
  for (let k = 0; k < sz / 2; k++) ph.push(i16(jam, i + 2 + 2 * k));
  i += 2 + sz;
  let fm6 = null;
  if (magic === JAM6) {
    // after the scene block come sized blocks; the one of 6 x 158 values holds the FM6 voices of the six tracks
    let k = i;
    while (k + 2 <= jam.length) {
      const n = u16(jam, k);
      if (n === 6 * FM6_LEN * 2 && k + 2 + n <= jam.length) {
        fm6 = [];
        for (let t = 0; t < 6; t++) {
          const v = [];
          for (let j = 0; j < FM6_LEN; j++) v.push(i16(jam, k + 2 + 2 * (t * FM6_LEN + j)));
          fm6.push(v);
        }
        break;
      }
      k += 2 + n;
    }
  } else if (pk) {
    // the generator block and the slices (packed), then the FM6 block: a track mask, each FM6 track's voice
    for (let r = 0; r < 2; r++) { const n = u16(jam, i); i += 2; block(n); }
    const n = u16(jam, i);
    i += 2;
    if (n >= 1 && i + n <= jam.length) {
      const mask = jam[i++];
      fm6 = [null, null, null, null, null, null];
      for (let t = 0; t < 6; t++) {
        if (!(mask & (1 << t))) continue;
        const v = Array.from(jam.subarray(i, i + 155));
        i += 155;
        for (let j = 0; j < 3; j++, i += 2) v.push(i16(jam, i));
        fm6[t] = v;
      }
      if (!fm6.some((v) => v)) fm6 = null;
    }
  }
  return { G, tracks, masks: ph.slice(2, 6), np, ssz, fm6Format, fm6 };
}
