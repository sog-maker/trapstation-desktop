// The editor's sound: starts the audition engine (renderer/preview: the firmware as WebAssembly in an AudioWorklet)
// and passes sounds, edits and notes to it. Local only: nothing here reaches the FM-1.

let ctx = null, node = null, ready = false, starting = null;
let current = null;                 // the last sound sent, sent again when the engine becomes ready
const listeners = { meter: () => {}, state: () => {} };

export const audioOn = () => ready;
export function onMeter(fn) { listeners.meter = fn; }
export function onState(fn) { listeners.state = fn; }

const send = (m) => { if (ready) node.port.postMessage(m); };

export function startAudio() {
  if (ready) return Promise.resolve(true);
  if (starting) return starting;
  starting = (async () => {
    try {
      listeners.state("Loading the sound engine…");
      const res = await fetch("renderer/preview/preview.wasm");
      if (!res.ok) throw new Error("preview.wasm is missing");
      const wasm = await res.arrayBuffer();
      ctx = new AudioContext({ latencyHint: "interactive" });
      await ctx.resume();
      await ctx.audioWorklet.addModule("renderer/preview/worklet.js");
      node = new AudioWorkletNode(ctx, "trap-preview", { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2] });
      const up = new Promise((resolve, reject) => {
        node.port.onmessage = ({ data: m }) => {
          if (m.type === "ready") { ready = true; resolve(m); }
          if (m.type === "error") { listeners.state("Sound engine: " + m.message); reject(new Error(m.message)); }
          if (m.type === "meter") listeners.meter(m.peak);
        };
      });
      node.connect(ctx.destination);
      node.port.postMessage({ type: "load", wasm }, [wasm]);
      const m = await up;
      listeners.state(`Sound on · the firmware's own engine · ${m.rate / 1000} kHz`);
      if (current) send(current);
      return true;
    } catch (e) {
      listeners.state("No sound: " + e.message);
      if (ctx) { try { await ctx.close(); } catch (_) { /* already closed */ } }
      ctx = node = null; ready = false;
      return false;
    } finally {
      starting = null;
    }
  })();
  return starting;
}

// the whole sound: factory preset (bank 0..4, slot 0..7) plus the edited values
export function setSound(bank, slot, p, fm6, g) {
  current = { type: "sound", bank, slot, p: p ? Array.from(p) : null, fm6: fm6 ? Array.from(fm6) : null, g: g ? Array.from(g) : null };
  send(current);
}
// one edited value: kind "p" (track parameter), "f" (FM6 voice), "g" (shared delay / reverb)
export function setValue(kind, id, value) {
  if (current) {
    const arr = kind === "p" ? current.p : kind === "f" ? current.fm6 : current.g;
    if (arr) arr[id] = value;
  }
  send({ type: kind, id, value });
}
export const noteOn = (note, velocity) => send({ type: "note", note, velocity, on: true });
export const noteOff = (note) => send({ type: "note", note, velocity: 0, on: false });
export const panic = () => send({ type: "panic" });
export const setGain = (v) => send({ type: "gain", value: v });
