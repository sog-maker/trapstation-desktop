// SPDX-License-Identifier: GPL-3.0-only
// The editor's audition engine in an AudioWorklet: preview.wasm (the firmware, track 1) renders 128-sample blocks
// at its own 44.1 kHz; this adapts them to the output rate by linear interpolation. Edits arrive as messages and
// are heard in the next block, held notes included.
class TrapPreview extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ex = null; this.index = 128; this.phase = 0; this.al = this.ar = this.bl = this.br = 0;
    this.gain = 0.8; this.target = 0.8; this.peak = 0; this.frames = 0;
    this.port.onmessage = async ({ data: m }) => {
      try {
        if (m.type === "load") {
          const { instance } = await WebAssembly.instantiate(m.wasm, {});
          this.ex = instance.exports; this.ex._initialize?.(); this.ex.pv_init();
          this.rate = this.ex.web_sample_rate();
          this.flush();
          this.port.postMessage({ type: "ready", rate: this.rate, outputRate: sampleRate });
          return;
        }
        const e = this.ex;
        if (!e) return;
        if (m.type === "sound") {
          // the factory preset first (it sets the machine), then the edited values on top
          e.pv_load(m.bank, m.slot);
          if (m.p) m.p.forEach((v, i) => e.pv_param_set(i, v));
          if (m.fm6 && e.pv_is_fm6()) m.fm6.forEach((v, i) => { if (i < 145 || i >= 155) e.pv_fm6_set(i, v); });
          if (m.g) m.g.forEach((v, k) => e.pv_global_set(k, v));
          this.flush();
        }
        if (m.type === "p") e.pv_param_set(m.id, m.value);
        if (m.type === "f") e.pv_fm6_set(m.id, m.value);
        if (m.type === "g") e.pv_global_set(m.id, m.value);
        if (m.type === "note") e.pv_note(m.note, m.velocity, m.on ? 1 : 0);
        if (m.type === "panic") { e.pv_panic(); this.flush(); }
        if (m.type === "gain") this.target = Math.max(0, Math.min(1.5, Number(m.value) || 0));
      } catch (err) { this.port.postMessage({ type: "error", message: String(err) }); }
    };
  }
  flush() { this.index = 128; this.phase = 0; this.al = this.ar = this.bl = this.br = 0; }
  advance() {
    if (this.index >= 128) {
      this.ex.pv_render(); this.index = 0;
      // the memory may have grown: take the views fresh
      this.left = new Float32Array(this.ex.memory.buffer, this.ex.pv_out_l(), 128);
      this.right = new Float32Array(this.ex.memory.buffer, this.ex.pv_out_r(), 128);
    }
    const i = this.index++;
    this.al = this.bl; this.ar = this.br; this.bl = this.left[i]; this.br = this.right[i];
  }
  process(inputs, outputs) {
    const [l, r] = outputs[0];
    if (!this.ex || !l) return true;
    for (let i = 0; i < l.length; i++) {
      this.gain += (this.target - this.gain) * 0.002;
      // the device's mix leaves headroom for six tracks; one track alone is lifted for listening
      const x = (this.al + (this.bl - this.al) * this.phase) * this.gain * 4;
      const y = (this.ar + (this.br - this.ar) * this.phase) * this.gain * 4;
      this.peak = Math.max(this.peak, Math.abs(x), Math.abs(y));
      l[i] = Math.max(-1, Math.min(1, x));
      if (r) r[i] = Math.max(-1, Math.min(1, y));
      this.phase += this.rate / sampleRate;
      while (this.phase >= 1) { this.advance(); this.phase--; }
    }
    this.frames += l.length;
    if (this.frames >= sampleRate / 15) { this.port.postMessage({ type: "meter", peak: this.peak }); this.peak = 0; this.frames = 0; }
    return true;
  }
}
registerProcessor("trap-preview", TrapPreview);
