// WAV one-shot -> Trapstation sample image + SYX frames. Port of tools/sample_to_syx.py (and web/smpimg.js).
import { buildImage, ulawEnc, SMP_CAP, SMP_RATES, SMP_TABLE, SMP_REGION, crc32 } from "../web/smpimg.js";
import { pack7 } from "../web/fm1ota.js";

export function readRiff(buf) {
  const dv = new DataView(buf), td = new TextDecoder("ascii");
  if (td.decode(new Uint8Array(buf, 0, 4)) !== "RIFF" || td.decode(new Uint8Array(buf, 8, 4)) !== "WAVE") throw new Error("Not a RIFF/WAVE file");
  let pos = 12, fmt = null, data = null;
  while (pos + 8 <= buf.byteLength) {
    const id = td.decode(new Uint8Array(buf, pos, 4)), size = dv.getUint32(pos + 4, true);
    const start = pos + 8, end = Math.min(start + size, buf.byteLength);
    if (id === "fmt ") {
      let tag = dv.getUint16(start, true);
      if (tag === 0xFFFE) tag = dv.getUint16(start + 24, true);
      fmt = { tag, ch: dv.getUint16(start + 2, true), sr: dv.getUint32(start + 4, true), bits: dv.getUint16(start + 14, true) };
    } else if (id === "data") data = [start, end];
    pos += 8 + size + (size & 1);
  }
  if (!fmt || !data) throw new Error("WAV without fmt or data chunk");
  const { tag, ch, sr, bits } = fmt, [s0, s1] = data;
  const n = Math.floor((s1 - s0) / (bits / 8)), vals = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const o = s0 + i * (bits / 8);
    if (tag === 3 && bits === 32) vals[i] = dv.getFloat32(o, true);
    else if (tag === 3 && bits === 64) vals[i] = dv.getFloat64(o, true);
    else if (bits === 16) vals[i] = dv.getInt16(o, true) / 32768;
    else if (bits === 8) vals[i] = (buf[o] - 128) / 128;
    else if (bits === 24) { let v = buf.byteLength && (new Uint8Array(buf)[o] | new Uint8Array(buf)[o + 1] << 8 | new Uint8Array(buf)[o + 2] << 16); if (v & 0x800000) v -= 0x1000000; vals[i] = v / 8388608; }
    else if (bits === 32) vals[i] = dv.getInt32(o, true) / 2147483648;
    else throw new Error("Unsupported bit depth: " + bits);
  }
  const frames = Math.floor(n / ch), mono = new Float32Array(frames);
  for (let f = 0; f < frames; f++) { let a = 0; for (let c = 0; c < ch; c++) a += vals[f * ch + c]; mono[f] = a / ch; }
  return { mono, sr };
}

export function makeChunk(mono, srcRate, rate, name) {
  const ratio = srcRate / rate, n = Math.floor(mono.length / ratio);
  if (n < 64) throw new Error("Sample too short (under 64 samples)");
  const f = new Float32Array(n);
  let pk = 0.0001;
  for (let j = 0; j < n; j++) {
    const i0 = Math.floor(j * ratio), i1 = Math.max(i0 + 1, Math.floor((j + 1) * ratio));
    let acc = 0; for (let i = i0; i < i1; i++) acc += mono[i] || 0;
    f[j] = acc / (i1 - i0); pk = Math.max(pk, Math.abs(f[j]));
  }
  const g = 0.97 / pk, data = new Uint8Array(n);
  for (let k = 0; k < n; k++) data[k] = ulawEnc(Math.round(Math.max(-1, Math.min(1, f[k] * g)) * 32767));
  return { name, rate, data };
}

// any decoded mono signal (Float32Array, -1..1) at sr -> the same result as convertWav
export function convertMono(mono, sr, name) {
  const rate = pickRate(mono.length, sr);
  if (!rate) throw new Error(`Too long for the sample memory (max. ${(SMP_CAP / 11025).toFixed(1)} s at 11025 Hz)`);
  const chunk = makeChunk(mono, sr, rate, name.toUpperCase().slice(0, 12));
  const img = buildImage([chunk]);
  return { name: chunk.name, rate, seconds: chunk.data.length / rate, bytes: chunk.data.length, chunk, img, syx: toSyx(img, chunk.data.length) };
}

// highest rate that fits the sample memory; null when even the lowest does not
export function pickRate(len, sr) {
  for (const r of [...SMP_RATES].sort((a, b) => b - a)) if (Math.floor(len * r / sr) <= SMP_CAP) return r;
  return null;
}

export function convertWav(buf, name) {
  const { mono, sr } = readRiff(buf);
  const rate = pickRate(mono.length, sr);
  if (!rate) throw new Error(`Too long for the sample memory (max. ${(SMP_CAP / 11025).toFixed(1)} s at 11025 Hz)`);
  const chunk = makeChunk(mono, sr, rate, name.toUpperCase().slice(0, 12));
  const img = buildImage([chunk]);
  return { name: chunk.name, rate, seconds: chunk.data.length / rate, bytes: chunk.data.length, chunk, img, syx: toSyx(img, chunk.data.length) };
}

// SYX = the SMP request sequence (smp_usb.c): BEGIN, WRITE blocks (data first, table last), END
const frame = (cmd, body) => {
  let s = 0; for (const b of body) s += b;
  const m = [0x00, 0x59, cmd, body.length & 255, (body.length >> 8) & 255, (body.length >> 16) & 255, ...body, (~s) & 255];
  return [0xF0, ...pack7(m), 0xF7];
};
export function toSyx(img, used) {
  const sec = 4096, nSec = Math.min(Math.ceil((SMP_TABLE + used) / sec), SMP_REGION / sec);
  const order = []; for (let s = SMP_TABLE / sec; s < nSec; s++) order.push(s); order.push(0);
  const out = [...frame(0x60, [])];
  for (const s of order) for (let o = 0; o < sec; o += 512) {
    const off = s * sec + o;
    out.push(...frame(0x62, [off & 255, (off >>> 8) & 255, (off >>> 16) & 255, (off >>> 24) & 255, ...img.subarray(off, off + 512)]));
  }
  out.push(...frame(0x63, []));
  return new Uint8Array(out);
}
export { crc32 };
