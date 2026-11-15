// Read-only snapshot of the groovebox sound objects (bk_usb.c backup session: BEGIN mode 0, STAT, READ, END).
// The session stops playback and ends after 10 s without a request, so the app reads on demand only.
// Layout: firmware/src/gb_store.c (gb_sobj_t: magic u32, np u16, kind u16, 32 x gb_snd_t {used, np, int8 p[P_COUNT]}).
import { pack7, unpack7 } from "../web/fm1ota.js";
import { crc32 } from "../web/smpimg.js";
import { PNAMES } from "./params.js";

export const OBJ_GB0 = 10;             // storage.c: OBJ_SETTINGS 0, OBJ_PROJECT0 1, OBJ_UPRESET0 5, OBJ_FM6BANK 7, OBJ_UPFM6 8, OBJ_AUTOSAVE 9, OBJ_GB0 10
export const SOBJ_IDS = [OBJ_GB0, OBJ_GB0 + 1, OBJ_GB0 + 2];
export const GB_SLOTS = 16;
export const GB_PMAGIC = 0x33534247;   // "GBS3"
export const POOLS = ["KICK", "SNARE", "CYMBAL", "PERC", "SYNTH", "SAMPLE"];   // engines.c gb_pool, 16 slots each
export const SND_LEN = 2 + PNAMES.length;
export const SOBJ_LEN = 8 + 2 * GB_SLOTS * SND_LEN;   // 3624 bytes

const BK = { BEGIN: 0x50, STAT: 0x51, READ: 0x52, PUT: 0x53, COMMIT: 0x54, END: 0x55 };
const CHUNK = 512;
const BK_SMP = 0x40;                  // bk_usb.c: the sample region's id

function frame(cmd, body) {
  const n = body.length;
  const m = [0x00, 0x59, cmd, n & 255, (n >> 8) & 255, (n >> 16) & 255, ...body];
  let s = 0; for (const b of body) s += b;
  m.push((~s) & 255);
  return [0xF0, ...pack7(m), 0xF7];
}
const u32le = (v) => [v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255];
const rd32 = (d, i) => (d[i] | d[i + 1] << 8 | d[i + 2] << 16 | d[i + 3] << 24) >>> 0;

// one request, its reply body (null on timeout); replies carry the request's cmd
async function ask(link, cmd, body, ms = 1500) {
  link.drain();
  if (!link.send(frame(cmd, body))) throw new Error("The FM-1 is no longer connected.");
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const p = await link.read(end - Date.now());
    if (!p) break;
    if (p[0] !== 0xF0 || p[p.length - 1] !== 0xF7) continue;
    const d = unpack7(p.slice(1, -1));
    if (d.length >= 7 && d[0] === 0 && d[1] === 0x59 && d[2] === cmd && d.length === d[3] + d[4] * 256 + d[5] * 65536 + 7) {
      return d.slice(6, d.length - 1);
    }
  }
  return null;
}

// reads the three sound objects; onProgress(text). -> { objects: [{id, bytes, crc}], pools }
// starts a backup session, first ending any old one; three tries (the FM-1 may still be leaving its last session)
export async function beginBackup(link) {
  endSession(link);
  await new Promise((r) => setTimeout(r, 300));
  for (let t = 0; t < 3; t++) {
    const b = await ask(link, BK.BEGIN, [0], 1500);
    if (b) return b;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("The FM-1 does not answer the backup request. Disconnect, connect again, then read again.");
}

// reads any storage objects by id (read only); an empty object is an error for the export
export async function readObjects(link, ids, onProgress = () => {}) {
  await beginBackup(link);
  const out = {};
  for (const id of ids) {
    onProgress(`Reading object ${id}…`);
    const st = await ask(link, BK.STAT, [id]);
    if (!st || st[0] !== 0) throw new Error(`Object ${id}: no data (rc ${st ? st[0] : "–"}).`);
    const len = rd32(st, 2), crc = rd32(st, 6);
    const bytes = new Uint8Array(len);
    for (let off = 0; off < len; off += CHUNK) {
      const n = Math.min(CHUNK, len - off);
      const r = await ask(link, BK.READ, [id, ...u32le(off), n & 255, n >> 8]);
      if (!r || r[0] !== 0) throw new Error(`Object ${id}: reading at ${off} failed.`);
      bytes.set(r.slice(6, 6 + n), off);
    }
    if (crc32(bytes) !== crc) throw new Error(`Object ${id}: CRC mismatch.`);
    out[id] = bytes;
  }
  await ask(link, BK.END, []);
  return out;
}

// the whole sample region as the device holds it (BK_SMP 0x40), for keeping the other samples on an upload
export async function readSampleRegion(link, onProgress = () => {}) {
  await beginBackup(link);
  const st = await ask(link, BK.STAT, [BK_SMP]);
  if (!st || st[0] !== 0) throw new Error("Sample memory not readable (rc " + (st ? st[0] : "–") + ").");
  const len = rd32(st, 2);
  const region = new Uint8Array(len);
  for (let off = 0; off < len; off += CHUNK) {
    const n = Math.min(CHUNK, len - off);
    if (off % (CHUNK * 64) === 0) onProgress(`Reading samples… ${Math.round(off / len * 100)}%`);
    const r = await ask(link, BK.READ, [BK_SMP, ...u32le(off), n & 255, n >> 8]);
    if (!r || r[0] !== 0) throw new Error("Sample memory: reading at " + off + " failed.");
    region.set(r.slice(6, 6 + n), off);
  }
  await ask(link, BK.END, []);
  return region;
}

export async function snapshot(link, onProgress = () => {}) {
  const b = await beginBackup(link);
  const out = [];
  for (let k = 0; k < SOBJ_IDS.length; k++) {
    const id = SOBJ_IDS[k];
    onProgress(`Reading group sounds ${k + 1}/${SOBJ_IDS.length}…`);
    const st = await ask(link, BK.STAT, [id]);
    if (st && st[0] === 2) { out.push({ id, bytes: null, crc: 0 }); continue; }   // rc 2: nothing saved in this object (empty)
    if (!st || st[0] !== 0) throw new Error(`Object ${id}: no answer (rc ${st ? st[0] : "–"}).`);
    const len = rd32(st, 2), crc = rd32(st, 6);
    const bytes = new Uint8Array(len);
    for (let off = 0; off < len; off += CHUNK) {
      const n = Math.min(CHUNK, len - off);
      const r = await ask(link, BK.READ, [id, ...u32le(off), n & 255, n >> 8]);
      if (!r || r[0] !== 0) throw new Error(`Object ${id}: reading at ${off} failed.`);
      bytes.set(r.slice(6, 6 + n), off);
    }
    if (crc32(bytes) !== crc) throw new Error(`Object ${id}: CRC mismatch.`);
    out.push({ id, bytes, crc });
  }
  await ask(link, BK.END, []);
  return { objects: out, pools: parse(out) };
}

// ---------- write (restore): only after the user's approval; the caller makes the backup first ----------
export const ENGINE_USED = { DIGITAL: 1, ANALOG: 2, SAMPLER: 3 };   // gb_store.c gb_snd_t.used

// the 113 bytes of one slot: used, np (P_COUNT), then P_COUNT values stored as value - 64
export function slotBytes(values, engine) {
  const b = new Uint8Array(SND_LEN);
  b[0] = ENGINE_USED[engine] || 1;
  b[1] = PNAMES.length;
  for (let j = 0; j < PNAMES.length; j++) {
    const v = Math.max(-64, Math.min(127, Math.round(values[j] || 0)));
    b[2 + j] = (v - 64) & 255;
  }
  return b;
}

// the slot's place in a sound object: pool p -> object p >> 1, half p & 1 (gb_store.c line 268)
export function slotOffset(pool, slot) {
  const half = pool & 1;
  return 8 + (half * GB_SLOTS + slot) * SND_LEN;
}

// a copy of the object with one slot replaced; the other slots stay byte-identical
export function withSlot(objBytes, pool, slot, slotData) {
  const out = new Uint8Array(objBytes);
  out.set(slotData, slotOffset(pool, slot));
  return out;
}

// writes one whole object back (PUT blocks, COMMIT with CRC); the FM-1 restarts after END
export async function writeObject(link, id, bytes, onProgress = () => {}) {
  const b = await ask(link, BK.BEGIN, [1], 1500);
  if (!b || b[0] !== 0) throw new Error("The write session was not accepted (rc " + (b ? b[0] : "–") + ").");
  for (let off = 0; off < bytes.length; off += CHUNK) {
    const n = Math.min(CHUNK, bytes.length - off);
    onProgress(`Writing ${Math.round(off / bytes.length * 100)} %…`);
    const r = await ask(link, BK.PUT, [id, ...u32le(off), ...bytes.subarray(off, off + n)], 3000);
    if (!r || r[0] !== 0) throw new Error(`PUT at ${off} failed (rc ${r ? r[0] : "–"}).`);
  }
  const c = await ask(link, BK.COMMIT, [id, ...u32le(bytes.length), ...u32le(crc32(bytes))], 3000);
  if (!c || c[0] !== 0) throw new Error(`COMMIT failed (rc ${c ? c[0] : "–"}): the CRC was not accepted.`);
  await ask(link, BK.END, [], 1500);
  return true;
}

// ends a backup session the FM-1 may still hold (after an error), without waiting for a reply
export function endSession(link) {
  try { link.send(frame(BK.END, [])); } catch (_) { /* link gone */ }
}

// the 6 pools x 16 slots: machine m -> object m >> 1, slot half m & 1 (gb_store.c line 268)
export function parse(objects) {
  const pools = POOLS.map(() => Array.from({ length: GB_SLOTS }, () => null));
  for (const o of objects) {
    if (!o.bytes) continue;                          // empty object: all its slots stay frees
    const v = new DataView(o.bytes.buffer, o.bytes.byteOffset, o.bytes.byteLength);
    if (v.getUint32(0, true) !== GB_PMAGIC) continue;
    const base = (SOBJ_IDS.indexOf(o.id)) * 2;
    for (let half = 0; half < 2; half++) {
      for (let s = 0; s < GB_SLOTS; s++) {
        const at = 8 + (half * GB_SLOTS + s) * SND_LEN;
        const used = o.bytes[at], np = o.bytes[at + 1];
        const values = Array.from({ length: PNAMES.length }, (_, j) => (o.bytes[at + 2 + j] << 24 >> 24) + 64);
        pools[base + half][s] = used ? { used, np, values } : null;
      }
    }
  }
  return pools;
}
