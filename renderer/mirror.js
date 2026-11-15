// FM-1 screen mirror over the update link (port of upstream web/mirror.html, firmware/src/mirror.c).
// The host asks with SysEx cmd 0x70 (body [1] = keep on, [0] = off; repeat about every second, the device stops
// after ~3 s without a request). The device answers with picture records (see feed()).
import { pack7, unpack7 } from "../web/fm1ota.js";

const CMD = 0x70;
const PAL = new Uint32Array(256);
for (let c = 0; c < 256; c++) {
  const r = Math.round((c >> 5) * 255 / 7), g = Math.round(((c >> 2) & 7) * 255 / 7), b = Math.round((c & 3) * 255 / 3);
  PAL[c] = 0xFF000000 | b << 16 | g << 8 | r;   // RGB 3-3-2 -> ABGR for ImageData
}

function frame(cmd, body) {
  const n = body.length;
  const m = [0x00, 0x59, cmd, n & 255, (n >> 8) & 255, (n >> 16) & 255, ...body];
  let s = 0; for (const b of body) s += b;
  m.push((~s) & 255);
  return [0xF0, ...pack7(m), 0xF7];
}

export class Mirror {
  constructor(canvas, onStatus) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.img = this.ctx.createImageData(240, 240);
    this.px = new Uint32Array(this.img.data.buffer);
    this.onStatus = onStatus || (() => {});
    this.link = null; this.timer = null; this.running = false; this.paused = false;
    this.seq = -1; this.st = { t: 0, h: [], x: 0, y: 0, w: 0, hh: 0, pos: 0, n: -1 };
    this.frames = 0;
  }

  // start on an open link (device.js); the loop reads the link's queue, so bank reads must pause the mirror first
  start(link) {
    this.link = link; this.running = true; this.paused = false;
    this.ask(1);
    this.timer = setInterval(() => this.ask(1), 1000);
    this.loop();
  }
  stop() {
    this.running = false;
    clearInterval(this.timer);
    if (this.link) this.ask(0);
    this.link = null;
  }
  // stop asking and wait until the read loop has let go of the link (so a bank read gets its own replies)
  async pause() {
    this.paused = true;
    clearInterval(this.timer); this.timer = null;
    this.ask(0);
    while (this.busy) await new Promise((r) => setTimeout(r, 20));
  }
  resume() {
    if (!this.running || !this.link) return;
    this.paused = false; this.ask(1);
    this.timer = setInterval(() => this.ask(1), 1000);
  }
  ask(on) { if (this.link) this.link.send(frame(CMD, [on])); }

  async loop() {
    while (this.running) {
      if (this.paused || !this.link) { await new Promise((r) => setTimeout(r, 100)); continue; }
      this.busy = true;
      const link = this.link;
      const p = link ? await link.read(200) : null;
      this.busy = false;
      if (!p || p[0] !== 0xF0) continue;
      this.onMsg(p);
    }
  }

  onMsg(p) {
    const d = p;
    if (d[d.length - 1] !== 0xF7) return;
    const u = unpack7(d.slice(1, -1));
    if (u.length < 8 || u[0] !== 0 || u[1] !== 0x59 || u[2] !== CMD || u.length !== u[3] + 7) return;
    let s = 0; for (let i = 6; i < u.length - 1; i++) s += u[i];
    if ((~s & 255) !== u[u.length - 1]) { this.restart(); return; }
    if (this.seq >= 0 && u[6] !== ((this.seq + 1) & 255)) this.restart();
    this.seq = u[6];
    for (let i = 7; i < u.length - 1; i++) this.feed(u[i]);
  }

  restart() { this.st.t = 0; this.seq = -1; this.ask(0); this.ask(1); }

  // picture records: 1 = rectangle, 2 = run list, 3 = clear, 4 = picture done (show it)
  feed(b) {
    const st = this.st, px = this.px;
    if (!st.t) {
      if (b === 3) { px.fill(PAL[0]); this.draw(); return; }
      if (b === 4) { this.draw(); return; }
      if (b === 1 || b === 2) { st.t = b; st.h = []; st.n = -1; st.pos = 0; return; }
      return;                                           // out of step: wait for the next start
    }
    if (st.h.length < 4) {
      st.h.push(b);
      if (st.h.length === 4) { st.x = st.h[0]; st.y = st.h[1]; st.w = st.h[2] || 240; st.hh = st.h[3] || 240; }
      return;
    }
    if (st.t === 1) {                                   // a rectangle of one colour
      const c = PAL[b];
      for (let j = 0; j < st.hh && st.y + j < 240; j++) {
        const o = (st.y + j) * 240 + st.x;
        px.fill(c, o, o + Math.min(st.w, 240 - st.x));
      }
      st.t = 0; return;
    }
    if (st.n < 0) { st.n = b; return; }                 // a run: its length, then its colour
    const c = PAL[b], end = st.w * st.hh;
    for (let k = 0; k < st.n && st.pos < end; k++, st.pos++) {
      const x = st.x + st.pos % st.w, y = st.y + ((st.pos / st.w) | 0);
      if (x < 240 && y < 240) px[y * 240 + x] = c;
    }
    st.n = -1;
    if (st.pos >= end) st.t = 0;
  }

  draw() {
    this.ctx.putImageData(this.img, 0, 0);
    this.frames++;
  }
}
