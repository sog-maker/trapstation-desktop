// The FM6 voice as the firmware keeps it (firmware/src/eng_trap_fm6.c, fm6_format.c): 155 voice bytes in the
// DX7's order (operator 6 first, 21 bytes each; then 19 voice bytes; then the 10-character name), followed by the
// three colour values DRIVE, CUTOFF, OUTPUT. Also the DX7 SysEx forms (one voice, 32-voice bank) for import/export.

export const OP = { R1: 0, R2: 1, R3: 2, R4: 3, L1: 4, L2: 5, L3: 6, L4: 7, BP: 8, LD: 9, RD: 10, LC: 11, RC: 12,
  RS: 13, AMS: 14, KVS: 15, OL: 16, MODE: 17, FC: 18, FF: 19, DET: 20 };
export const V = { PR1: 126, PL1: 130, ALG: 134, FB: 135, OKS: 136, LFS: 137, LFD: 138, LPMD: 139, LAMD: 140,
  LKS: 141, LFW: 142, LPMS: 143, TRNSP: 144, NAME: 145, DRIVE: 155, CUTOFF: 156, OUTPUT: 157 };
export const VOICE_LEN = 155, FM6_LEN = 158;

// operator n (1..6) -> the first of its 21 bytes
export const opBase = (n) => (6 - n) * 21;

const OPMAX = [99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 3, 3, 7, 3, 7, 99, 1, 31, 99, 14];
const VMAX = [99, 99, 99, 99, 99, 99, 99, 99, 31, 7, 1, 99, 99, 99, 99, 1, 5, 7, 48];
export function maxOf(i) {
  if (i < 126) return OPMAX[i % 21];
  if (i < 145) return VMAX[i - 126];
  if (i < 155) return 126;
  return i === V.CUTOFF ? 20000 : 100;
}
export const minOf = (i) => (i === V.CUTOFF ? 40 : i >= 145 && i < 155 ? 32 : 0);

// every value inside its range, a broken name character becomes a space (fm6_sanitize)
export function sanitize(v) {
  const out = v.slice(0, FM6_LEN);
  for (let i = 0; i < FM6_LEN; i++) {
    const x = Math.round(Number(out[i]) || 0);
    out[i] = i >= 145 && i < 155 ? (x < 32 || x > 126 ? 32 : x) : Math.max(minOf(i), Math.min(maxOf(i), x));
  }
  return out;
}

export const nameOf = (v) => String.fromCharCode(...v.slice(V.NAME, V.NAME + 10)).trim();
export function setName(v, name) {
  const s = (name || "").toUpperCase().replace(/[^\x20-\x7E]/g, " ").padEnd(10, " ").slice(0, 10);
  for (let i = 0; i < 10; i++) v[V.NAME + i] = s.charCodeAt(i);
}

// the 32 algorithms (fm6_core.c FM6_ALG): per operator, the sixth first: in bus (bits 4-5), out bus (bits 0-1,
// 0 = the output: a carrier), add into the bus (bit 2), feedback (bit 6)
export const ALG = [
  [0xc1, 0x11, 0x11, 0x14, 0x01, 0x14], [0x01, 0x11, 0x11, 0x14, 0xc1, 0x14], [0xc1, 0x11, 0x14, 0x01, 0x11, 0x14],
  [0xc1, 0x11, 0x94, 0x01, 0x11, 0x14], [0xc1, 0x14, 0x01, 0x14, 0x01, 0x14], [0xc1, 0x94, 0x01, 0x14, 0x01, 0x14],
  [0xc1, 0x11, 0x05, 0x14, 0x01, 0x14], [0x01, 0x11, 0xc5, 0x14, 0x01, 0x14], [0x01, 0x11, 0x05, 0x14, 0xc1, 0x14],
  [0x01, 0x05, 0x14, 0xc1, 0x11, 0x14], [0xc1, 0x05, 0x14, 0x01, 0x11, 0x14], [0x01, 0x05, 0x05, 0x14, 0xc1, 0x14],
  [0xc1, 0x05, 0x05, 0x14, 0x01, 0x14], [0xc1, 0x05, 0x11, 0x14, 0x01, 0x14], [0x01, 0x05, 0x11, 0x14, 0xc1, 0x14],
  [0xc1, 0x11, 0x02, 0x25, 0x05, 0x14], [0x01, 0x11, 0x02, 0x25, 0xc5, 0x14], [0x01, 0x11, 0x11, 0xc5, 0x05, 0x14],
  [0xc1, 0x14, 0x14, 0x01, 0x11, 0x14], [0x01, 0x05, 0x14, 0xc1, 0x14, 0x14], [0x01, 0x14, 0x14, 0xc1, 0x14, 0x14],
  [0xc1, 0x14, 0x14, 0x14, 0x01, 0x14], [0xc1, 0x14, 0x14, 0x01, 0x14, 0x04], [0xc1, 0x14, 0x14, 0x14, 0x04, 0x04],
  [0xc1, 0x14, 0x14, 0x04, 0x04, 0x04], [0xc1, 0x05, 0x14, 0x01, 0x14, 0x04], [0x01, 0x05, 0x14, 0xc1, 0x14, 0x04],
  [0x04, 0xc1, 0x11, 0x14, 0x01, 0x14], [0xc1, 0x14, 0x01, 0x14, 0x04, 0x04], [0x04, 0xc1, 0x11, 0x14, 0x04, 0x04],
  [0xc1, 0x14, 0x04, 0x04, 0x04, 0x04], [0xc4, 0x04, 0x04, 0x04, 0x04, 0x04]];

// the routing of algorithm a (0..31), the way the device's ROUTING page works it out (trap_fm6_ui.c):
// per operator 1..6: carrier, feedback, the operators that modulate it, and its row (0 = the carriers)
export function routing(a) {
  const alg = ALG[a & 31], bus = [0, 0, 0], edge = [0, 0, 0, 0, 0, 0], depth = [0, 0, 0, 0, 0, 0];
  for (let k = 0; k < 6; k++) {
    const inb = (alg[k] >> 4) & 3, out = alg[k] & 3;
    edge[k] = inb ? bus[inb] : 0;
    if (alg[k] & 4) bus[out] |= 1 << k; else bus[out] = 1 << k;
  }
  for (let k = 5; k >= 0; k--) for (let j = 0; j < k; j++) if (edge[k] & (1 << j)) { if (depth[j] <= depth[k]) depth[j] = depth[k] + 1; }
  const ops = [];
  for (let n = 1; n <= 6; n++) {
    const k = 6 - n, from = [];
    for (let j = 0; j < k; j++) if (edge[k] & (1 << j)) from.push(6 - j);
    ops.push({ op: n, carrier: !(alg[k] & 3), feedback: !!(alg[k] & 0x40), from, depth: depth[k] });
  }
  return ops;
}

// what an operator's frequency settings mean: a ratio of the note, or a fixed frequency in Hz
export function freqText(v, n) {
  const b = opBase(n), c = v[b + OP.FC], f = v[b + OP.FF];
  if (v[b + OP.MODE]) {
    const hz = Math.pow(10, c & 3) * Math.exp(Math.LN10 * f / 100);
    return (hz >= 100 ? hz.toFixed(0) : hz.toFixed(2)) + " Hz";
  }
  return "× " + ((c ? c : 0.5) * (1 + f / 100)).toFixed(2);
}

export const LFO_WAVES = ["TRIANGLE", "SAW DOWN", "SAW UP", "SQUARE", "SINE", "S & HOLD"];
export const CURVES = ["−LIN", "−EXP", "+EXP", "+LIN"];
const NOTES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
// the level scaling's break point: 0 = A-1 ... 39 = C3 ... 99 = C8
export const breakNote = (bp) => { const m = bp + 21; return NOTES[m % 12] + (Math.floor(m / 12) - 2); };

// ---------- DX7 SysEx ----------
const checksum = (d) => { let s = 0; for (const b of d) s += b; return (128 - (s & 127)) & 127; };

// one packed 128-byte bank record -> the 155 voice bytes (fm6_unpack)
export function unpack(b) {
  const v = new Array(VOICE_LEN).fill(0);
  for (let k = 0; k < 6; k++) {
    const o = k * 17, d = k * 21;
    for (let i = 0; i < 11; i++) v[d + i] = b[o + i] & 0x7F;
    v[d + OP.LC] = b[o + 11] & 3;
    v[d + OP.RC] = (b[o + 11] >> 2) & 3;
    v[d + OP.RS] = b[o + 12] & 7;
    v[d + OP.DET] = (b[o + 12] >> 3) & 15;
    v[d + OP.AMS] = b[o + 13] & 3;
    v[d + OP.KVS] = (b[o + 13] >> 2) & 7;
    v[d + OP.OL] = b[o + 14] & 0x7F;
    v[d + OP.MODE] = b[o + 15] & 1;
    v[d + OP.FC] = (b[o + 15] >> 1) & 31;
    v[d + OP.FF] = b[o + 16] & 0x7F;
  }
  for (let i = 0; i < 9; i++) v[126 + i] = b[102 + i] & 0x7F;
  v[V.ALG] &= 31;
  v[V.FB] = b[111] & 7;
  v[V.OKS] = (b[111] >> 3) & 1;
  for (let i = 0; i < 4; i++) v[V.LFS + i] = b[112 + i] & 0x7F;
  v[V.LKS] = b[116] & 1;
  v[V.LFW] = (b[116] >> 1) & 7;
  v[V.LPMS] = (b[116] >> 4) & 7;
  v[V.TRNSP] = b[117] & 0x7F;
  for (let i = 0; i < 10; i++) v[V.NAME + i] = b[118 + i] & 0x7F;
  return v;
}

// a .syx file -> [{ name, voice (155 values) }]: one voice (163 bytes) or a 32-voice bank (4104 bytes).
// Length, type and checksum are checked; values outside their range are counted, then limited.
export function parseSyx(bytes) {
  const d = bytes;
  const head = (f, hi, lo) => d[0] === 0xF0 && d[1] === 0x43 && (d[2] & 0xF0) === 0 && d[3] === f && d[4] === hi && d[5] === lo;
  let raw;
  if (d.length === 163 && head(0, 1, 0x1B)) {
    if (checksum(d.subarray(6, 161)) !== d[161]) throw new Error("the checksum of the voice does not match");
    raw = [Array.from(d.subarray(6, 161))];
  } else if (d.length === 4104 && head(9, 0x20, 0)) {
    if (checksum(d.subarray(6, 4102)) !== d[4102]) throw new Error("the checksum of the bank does not match");
    raw = [];
    for (let k = 0; k < 32; k++) raw.push(unpack(d.subarray(6 + k * 128, 6 + (k + 1) * 128)));
  } else {
    throw new Error("not a DX7 voice (163 bytes) or 32-voice bank (4104 bytes)");
  }
  return raw.map((v) => {
    let fixed = 0;
    for (let i = 0; i < 145; i++) if (v[i] > maxOf(i)) fixed++;
    const voice = sanitize([...v, 0, 20000, 100]).slice(0, VOICE_LEN);
    return { name: nameOf(voice) || "UNNAMED", voice, fixed };
  });
}

// the 155 voice bytes -> a single-voice DX7 SysEx message (163 bytes)
export function toSyx(v) {
  const body = sanitize([...v.slice(0, VOICE_LEN), 0, 20000, 100]).slice(0, VOICE_LEN);
  return new Uint8Array([0xF0, 0x43, 0x00, 0x00, 0x01, 0x1B, ...body, checksum(body), 0xF7]);
}
