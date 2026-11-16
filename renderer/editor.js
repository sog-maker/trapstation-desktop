// The sound editor. FMSYN sounds are FM6 voices: the layout follows the device's FM6 pages (Design A): an operator
// rail, the routing of the algorithm, and the twelve pages COLOR DELAY REVERB / ROUTING OP TONE OP LEVEL /
// OP RATES OP LEVELS KEY SCALE / LFO MOTION LFO DEPTH PITCH ENV, each with the device's own parameter names.
// The other machines (drums, 808, mono) get their firmware parameters with the device's labels and ranges.
// Every change goes to onValue(kind, id, value): kind "f" = FM6 voice, "p" = track parameter, "g" = shared FX.
import { OP, V, opBase, routing, freqText, LFO_WAVES, CURVES, breakNote, maxOf, minOf } from "./fm6.js";
import { MACHINE, FX_GLOBAL } from "./factory.js";
import { PNAMES } from "./params.js";

const NS = "http://www.w3.org/2000/svg";
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const P = (name) => PNAMES.indexOf(name);

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}
function svg(tag, attrs, parent) {
  const e = document.createElementNS(NS, tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(e);
  return e;
}

// One control: label, slider, and a number field (or a list for named values).
// o: { label, min, max, get(), set(v), names (value - min -> text), offset (shown = stored + offset), log, unit }
function control(o) {
  const wrap = el("div", "ctl");
  const head = el("div", "ctl-head");
  head.appendChild(el("span", "ctl-label", o.label));
  const note = el("span", "ctl-note");
  head.appendChild(note);
  wrap.appendChild(head);
  const row = el("div", "ctl-row");
  const range = document.createElement("input");
  range.type = "range";
  const off = o.offset || 0;
  const toPos = (v) => (o.log ? Math.round(1000 * Math.log(v / o.min) / Math.log(o.max / o.min)) : v);
  const fromPos = (x) => (o.log ? Math.round(o.min * Math.pow(o.max / o.min, x / 1000)) : x);
  range.min = o.log ? 0 : o.min; range.max = o.log ? 1000 : o.max; range.step = 1;
  let field;
  if (o.names) {
    field = document.createElement("select");
    o.names.forEach((n, i) => { const op = el("option", null, n); op.value = o.min + i; field.appendChild(op); });
  } else {
    field = document.createElement("input");
    field.type = "number"; field.min = o.min + off; field.max = o.max + off;
  }
  const show = (v) => {
    range.value = toPos(v);
    field.value = o.names ? v : v + off;
    note.textContent = o.note ? o.note(v) : (o.unit || "");
  };
  const set = (v) => {
    v = clamp(Math.round(Number(v) || 0), o.min, o.max);
    o.set(v);
    show(v);
  };
  range.oninput = () => set(fromPos(Number(range.value)));
  field.onchange = () => set(o.names ? Number(field.value) : Number(field.value) - off);
  range.ondblclick = () => { if (o.def !== undefined) set(o.def); };
  show(clamp(o.get(), o.min, o.max));
  row.appendChild(range); row.appendChild(field);
  wrap.appendChild(row);
  return wrap;
}

function card(title, tag) {
  const c = el("div", "pg");
  const h = el("div", "pg-head");
  h.appendChild(el("span", "pg-title", title));
  if (tag) h.appendChild(el("span", "pg-tag", tag));
  c.appendChild(h);
  const body = el("div", "pg-body");
  c.appendChild(body);
  return { card: c, body, head: h };
}

// ---------- graphs ----------
// rate / level envelope (the device's OP RATES / OP LEVELS / PITCH ENV drawing): four segments, their widths
// from the rates, starting from level 4; a hold marks where the key is released
function envGraph(v, base, pitch) {
  const W = 300, H = 120, x0 = 12, x1 = W - 12, top = 12, bot = H - 14;
  const s = svg("svg", { viewBox: `0 0 ${W} ${H}`, class: "graph" });
  for (let g = 1; g < 4; g++) svg("line", { x1: x0, x2: x1, y1: top + (bot - top) * g / 4, y2: top + (bot - top) * g / 4, class: "grid" }, s);
  const lv = (k) => bot - clamp(v[base + 4 + k], 0, 99) * (bot - top) / 99;
  const dur = [0, 1, 2, 3].map((k) => 8 + 99 - clamp(v[base + k], 0, 99));
  const hold = 40, total = dur.reduce((a, b) => a + b, 0) + hold;
  const sx = (t) => x0 + t * (x1 - x0) / total;
  let t = 0;
  const pts = [[x0, lv(3)]];
  for (let k = 0; k < 3; k++) { t += dur[k]; pts.push([sx(t), lv(k)]); }
  t += hold; pts.push([sx(t), lv(2)]);
  const rel = sx(t);
  t += dur[3]; pts.push([sx(t), lv(3)]);
  if (pitch) svg("line", { x1: x0, x2: x1, y1: bot - 50 * (bot - top) / 99, y2: bot - 50 * (bot - top) / 99, class: "grid mid" }, s);
  svg("line", { x1: rel, x2: rel, y1: top, y2: bot, class: "grid rel" }, s);
  if (!pitch) svg("polygon", { points: pts.map((p) => p.join(",")).join(" ") + ` ${x1},${bot} ${x0},${bot}`, class: "env-fill" }, s);
  svg("polyline", { points: pts.map((p) => p.join(",")).join(" "), class: "env-line" }, s);
  pts.slice(1).forEach((p, i) => { if (i !== 3) svg("rect", { x: p[0] - 2, y: p[1] - 2, width: 4, height: 4, class: "env-dot" }, s); });
  const txt = svg("text", { x: rel + 3, y: top + 8, class: "gtext" }, s);
  txt.textContent = "KEY OFF";
  return s;
}

// the six output levels as bars (the device's OP LEVEL drawing); a click selects the operator
function levelGraph(v, sel, onSelect) {
  const W = 300, H = 120;
  const s = svg("svg", { viewBox: `0 0 ${W} ${H}`, class: "graph" });
  const ops = routing(v[V.ALG]);
  for (let n = 1; n <= 6; n++) {
    const x = 18 + (n - 1) * 46, h = clamp(v[opBase(n) + OP.OL], 0, 99) * 84 / 99;
    svg("rect", { x, y: 10, width: 34, height: 84, class: "bar-bg" }, s);
    svg("rect", { x, y: 94 - h, width: 34, height: h, class: "bar" + (n === sel ? " sel" : ops[n - 1].carrier ? " car" : "") }, s);
    const t = svg("text", { x: x + 17, y: 110, class: "gtext mid" + (n === sel ? " sel" : "") }, s);
    t.textContent = n;
    const hit = svg("rect", { x: x - 6, y: 0, width: 46, height: H, class: "hit" }, s);
    hit.onclick = () => onSelect(n);
  }
  return s;
}

// the algorithm as the device's ROUTING page draws it: carriers in the bottom row, their modulators above
function routingGraph(v, sel, onSelect) {
  const W = 300, H = 120;
  const s = svg("svg", { viewBox: `0 0 ${W} ${H}`, class: "graph" });
  const ops = routing(v[V.ALG]);
  const max = Math.max(...ops.map((o) => o.depth));
  const counts = {}, seen = {}, pos = {};
  ops.forEach((o) => { counts[o.depth] = (counts[o.depth] || 0) + 1; });
  // the device walks operator 6 first
  [...ops].reverse().forEach((o) => {
    seen[o.depth] = (seen[o.depth] || 0) + 1;
    pos[o.op] = { x: 20 + seen[o.depth] * (W - 40) / (counts[o.depth] + 1), y: 20 + (max - o.depth) * (max ? 66 / max : 0) + (max ? 0 : 33) };
  });
  svg("line", { x1: 14, x2: W - 14, y1: H - 10, y2: H - 10, class: "out" }, s);
  ops.forEach((o) => {
    const a = pos[o.op];
    o.from.forEach((m) => svg("line", { x1: pos[m].x, y1: pos[m].y, x2: a.x, y2: a.y, class: "wire" }, s));
    if (o.carrier) svg("line", { x1: a.x, y1: a.y, x2: a.x, y2: H - 10, class: "wire out" }, s);
  });
  ops.forEach((o) => {
    const a = pos[o.op];
    if (o.feedback) svg("path", { d: `M${a.x + 11},${a.y - 4} h9 v-12 h-20 v8`, class: "wire fb" }, s);
    const g = svg("g", { class: "node" + (o.op === sel ? " sel" : "") + (o.carrier ? " car" : "") }, s);
    svg("rect", { x: a.x - 11, y: a.y - 8, width: 22, height: 16, rx: 2 }, g);
    const t = svg("text", { x: a.x, y: a.y + 4 }, g);
    t.textContent = o.op;
    g.onclick = () => onSelect(o.op);
  });
  return s;
}

// one cycle of the LFO's wave, repeated by its speed (display only)
function lfoGraph(v) {
  const W = 300, H = 120, mid = 60, amp = 42;
  const s = svg("svg", { viewBox: `0 0 ${W} ${H}`, class: "graph" });
  svg("line", { x1: 12, x2: W - 12, y1: mid, y2: mid, class: "grid" }, s);
  const cycles = 1.5 + v[V.LFS] / 14, wave = v[V.LFW];
  let held = 0, last = -1;
  const pts = [];
  for (let x = 0; x <= 276; x++) {
    const ph = (x / 276 * cycles) % 1;
    let y;
    if (wave === 0) y = ph < 0.5 ? -1 + 4 * ph : 3 - 4 * ph;
    else if (wave === 1) y = 1 - 2 * ph;
    else if (wave === 2) y = -1 + 2 * ph;
    else if (wave === 3) y = ph < 0.5 ? 1 : -1;
    else if (wave === 4) y = Math.sin(2 * Math.PI * ph);
    else { const c = Math.floor(x / 276 * cycles); if (c !== last) { last = c; held = Math.sin(c * 12.9898) * 43758.5453 % 1; } y = held * 2 - Math.sign(held); }
    // the delay fades the LFO in
    const fade = v[V.LFD] ? Math.min(1, x / (276 * v[V.LFD] / 140)) : 1;
    pts.push(`${12 + x},${(mid - y * amp * fade).toFixed(1)}`);
  }
  svg("polyline", { points: pts.join(" "), class: "env-line" }, s);
  return s;
}

// classic envelope for the other machines: attack, decay to the sustain level, release
function adsrGraph(values, idx) {
  const [a, d, sv, r] = idx.map((i) => clamp(values[i], 0, 127) / 127);
  const W = 300, H = 90, x1 = 10 + a * 80, x2 = x1 + 8 + d * 80, x3 = x2 + 36, x4 = Math.min(x3 + 8 + r * 80, W - 10);
  const sy = H - 10 - sv * (H - 20);
  const s = svg("svg", { viewBox: `0 0 ${W} ${H}`, class: "graph small" });
  const pts = [[10, H - 10], [x1, 10], [x2, sy], [x3, sy], [x4, H - 10]];
  svg("polygon", { points: pts.map((p) => p.join(",")).join(" "), class: "env-fill" }, s);
  svg("polyline", { points: pts.map((p) => p.join(",")).join(" "), class: "env-line" }, s);
  return s;
}

// ---------- the FM6 editor ----------
const GROUPS = ["SHAPE", "ENV", "LFO", "FX"];
const ui = { op: 1, group: "SHAPE" };   // kept while the app runs, like the device keeps its operator

function fm6Editor(host, sound, cb) {
  const v = sound.fm6, p = sound.p, g = sound.g;
  const setF = (id) => (val) => { v[id] = val; cb.onValue("f", id, val); refresh(); };
  const setP = (id) => (val) => { p[id] = val; cb.onValue("p", id, val); };
  const setG = (k) => (val) => { g[k] = val; cb.onValue("g", k, val); };
  const f = (label, id, extra) => control({ label, min: minOf(id), max: maxOf(id), get: () => v[id], set: setF(id), ...extra });
  const pc = (label, name) => { const id = P(name); return control({ label, min: 0, max: 127, get: () => p[id], set: setP(id) }); };
  const gc = (label, k) => control({ label, min: 0, max: FX_GLOBAL[k].max, get: () => g[k], set: setG(k), def: FX_GLOBAL[k].def });

  // operator rail
  const rail = el("div", "rail");
  // the three displays
  const disp = el("div", "disp");
  const boxes = ["ROUTING", "ENVELOPE", "LEVELS"].map((t) => {
    const b = el("div", "disp-box");
    const h = el("div", "disp-title", t);
    const gh = el("div", "disp-graph");
    b.appendChild(h); b.appendChild(gh);
    disp.appendChild(b);
    return { h, gh };
  });
  const select = (n) => { ui.op = n; build(); };
  function refresh() {
    const ops = routing(v[V.ALG]);
    rail.innerHTML = "";
    for (let n = 1; n <= 6; n++) {
      const b = el("button", "rail-op" + (n === ui.op ? " sel" : ""));
      const o = ops[n - 1];
      b.appendChild(el("span", "rail-n", "OP" + n));
      b.appendChild(el("span", "rail-kind" + (o.carrier ? " car" : ""), o.carrier ? "CARRIER" : "MOD"));
      b.appendChild(el("span", "rail-f", freqText(v, n)));
      const m = el("span", "rail-m");
      const fill = el("i");
      fill.style.width = (v[opBase(n) + OP.OL] / 99 * 100) + "%";
      m.appendChild(fill); b.appendChild(m);
      b.onclick = () => select(n);
      rail.appendChild(b);
    }
    boxes[0].h.textContent = `ROUTING · ALGO ${v[V.ALG] + 1} · FEEDBACK ${v[V.FB]}`;
    boxes[0].gh.replaceChildren(routingGraph(v, ui.op, select));
    boxes[1].h.textContent = `ENVELOPE · OP${ui.op}`;
    boxes[1].gh.replaceChildren(envGraph(v, opBase(ui.op), false));
    boxes[2].h.textContent = "OPERATOR LEVELS";
    boxes[2].gh.replaceChildren(levelGraph(v, ui.op, select));
    extra.forEach((fn) => fn());
  }
  let extra = [];

  const tabs = el("div", "grp-tabs");
  const pages = el("div", "pages");
  function build() {
    extra = [];
    tabs.innerHTML = "";
    GROUPS.forEach((name) => {
      const b = el("button", name === ui.group ? "on" : "", name);
      b.onclick = () => { ui.group = name; build(); };
      tabs.appendChild(b);
    });
    pages.innerHTML = "";
    const b = opBase(ui.op), tag = "OP" + ui.op;
    const add = (title, t, items) => { const c = card(title, t); items.forEach((i) => c.body.appendChild(i)); pages.appendChild(c.card); return c; };
    if (ui.group === "SHAPE") {
      add("ROUTING", "VOICE", [
        f("ALGO", V.ALG, { offset: 1 }),
        f("FEEDBACK", V.FB),
        f("TRANS", V.TRNSP, { offset: -24, unit: "semitones", def: 24 }),
        f("OSC SYN", V.OKS, { names: ["OFF", "ON"] })]);
      add("OP TONE", tag, [
        f("COARSE", b + OP.FC, { note: () => freqText(v, ui.op) }),
        f("FINE", b + OP.FF, { note: () => freqText(v, ui.op) }),
        f("FIXED", b + OP.MODE, { names: ["RATIO", "FIXED HZ"] }),
        f("DETUNE", b + OP.DET, { offset: -7, def: 7 })]);
      add("OP LEVEL", tag, [
        f("LEVEL", b + OP.OL),
        f("VEL SEN", b + OP.KVS),
        f("AM SENS", b + OP.AMS),
        f("RATE SC", b + OP.RS)]);
    } else if (ui.group === "ENV") {
      add("OP RATES", tag, [0, 1, 2, 3].map((k) => f("RATE " + (k + 1), b + OP.R1 + k)));
      add("OP LEVELS", tag, [0, 1, 2, 3].map((k) => f("LEVEL " + (k + 1), b + OP.L1 + k)));
      add("KEY SCALE", tag, [
        f("B POINT", b + OP.BP, { note: (x) => breakNote(x) }),
        f("L DEPTH", b + OP.LD),
        f("R DEPTH", b + OP.RD),
        f("L CURVE", b + OP.LC, { names: CURVES }),
        f("R CURVE", b + OP.RC, { names: CURVES })]);
    } else if (ui.group === "LFO") {
      const m = add("LFO MOTION", "VOICE", [
        f("SPEED", V.LFS),
        f("WAVE", V.LFW, { names: LFO_WAVES }),
        f("DELAY", V.LFD),
        f("LFO SYN", V.LKS, { names: ["OFF", "ON"] })]);
      const lg = el("div", "pg-graph");
      m.card.insertBefore(lg, m.body);
      extra.push(() => lg.replaceChildren(lfoGraph(v)));
      add("LFO DEPTH", "VOICE", [
        f("PITCH MOD", V.LPMD),
        f("AMP MOD", V.LAMD),
        f("PIT SEN", V.LPMS)]);
      const pe = add("PITCH ENV", "VOICE", [
        ...[0, 1, 2, 3].map((k) => f("P RATE " + (k + 1), V.PR1 + k)),
        ...[0, 1, 2, 3].map((k) => f("P LEVEL " + (k + 1), V.PL1 + k, { def: 50 }))]);
      pe.card.classList.add("wide");
      const pg = el("div", "pg-graph");
      pe.card.insertBefore(pg, pe.body);
      extra.push(() => pg.replaceChildren(envGraph(v, V.PR1, true)));
    } else {
      add("COLOR", "TRACK", [
        f("DRIVE", V.DRIVE, { unit: "%" }),
        f("CUTOFF", V.CUTOFF, { log: true, unit: "Hz", def: 20000 }),
        f("OUTPUT", V.OUTPUT, { unit: "%" }),
        pc("CHO", "CHOR")]);
      add("DELAY", "SHARED", [gc("TIME", 0), gc("FDBK", 1), gc("TONE", 2), pc("DLY", "DLY")]);
      add("REVERB", "SHARED", [gc("TIME", 3), gc("DAMP", 4), gc("GRIT", 5), pc("REV", "REV")]);
      pages.appendChild(el("div", "ed-hint", "DELAY and REVERB settings (TIME, FDBK, TONE, DAMP, GRIT) are shared by all tracks on the device; CHO, DLY and REV are this track's sends."));
    }
    refresh();
  }

  host.appendChild(rail);
  host.appendChild(disp);
  host.appendChild(tabs);
  host.appendChild(pages);
  build();
}

// ---------- the other machines ----------
const MGROUPS = [
  ["ENGINE", ["E0", "E1", "E2", "E3", "E4", "E5", "E6"]],
  ["ENVELOPE", ["ATK", "DEC", "SUS", "REL"]],
  ["MIX", ["LEVEL", "PAN", "LN0", "LN1", "LN2", "TRANS", "GLIDE", "DETUNE", "SPRD"]],
  ["FILTER", ["FM1_ATK", "FM1_DEC", "FM1_SUS", "FM1_REL", "FTYPE"]],
  ["FILTER ENV", ["FM2_ATK", "FM2_DEC", "FM2_SUS", "FM2_REL", "FM2_LEVEL"]],
  ["SENDS", ["DIST", "CHOR", "DLY", "REV"]],
  ["INSERT", ["ITYPE", "IA", "IB", "IC", "IMIX"]],
  ["LFO", ["LRATE", "LWAVE", "LPHASE", "LFADE", "LD_PIT", "LD_FLT", "LD_SHP", "LD_AMP"]],
];

function machineEditor(host, sound, cb) {
  const p = sound.p, g = sound.g, desc = MACHINE[sound.machine] || [];
  const shown = new Set([P("E7"), P("MUTE")]);
  const one = (id) => {
    const d = desc[id] || { label: PNAMES[id], min: -64, max: 127 };
    shown.add(id);
    if (!d.label || d.label === "-") return null;
    return control({ label: d.label, min: d.min, max: d.max, names: d.names, get: () => p[id],
      set: (val) => { p[id] = val; cb.onValue("p", id, val); refresh(); } });
  };
  const pages = el("div", "pages");
  let envHost = null;
  const refresh = () => { if (envHost) envHost.replaceChildren(adsrGraph(p, ["ATK", "DEC", "SUS", "REL"].map(P))); };
  for (const [title, names] of MGROUPS) {
    const items = names.map((n) => one(P(n))).filter(Boolean);
    if (!items.length) continue;
    const c = card(title, title === "ENGINE" ? sound.machine : "");
    if (title === "ENVELOPE") { envHost = el("div", "pg-graph"); c.card.insertBefore(envHost, c.body); }
    items.forEach((i) => c.body.appendChild(i));
    pages.appendChild(c.card);
  }
  const gc = (label, k) => control({ label, min: 0, max: FX_GLOBAL[k].max, get: () => g[k], set: (val) => { g[k] = val; cb.onValue("g", k, val); }, def: FX_GLOBAL[k].def });
  const fx = card("DELAY · REVERB", "SHARED");
  [gc("DELAY TIME", 0), gc("DELAY FDBK", 1), gc("DELAY TONE", 2), gc("REVERB TIME", 3), gc("REVERB DAMP", 4), gc("REVERB GRIT", 5)].forEach((i) => fx.body.appendChild(i));
  pages.appendChild(fx.card);
  host.appendChild(pages);
  // the parameters without a panel of their own (arp, scale, sequencer, modulation slots): listed, so nothing is hidden
  const more = el("details", "more");
  more.appendChild(el("summary", null, "More parameters"));
  const grid = el("div", "pages");
  const rest = card("OTHER", "");
  rest.card.classList.add("full");
  PNAMES.forEach((n, id) => { if (!shown.has(id)) { const c = one(id); if (c) rest.body.appendChild(c); } });
  grid.appendChild(rest.card);
  more.appendChild(grid);
  host.appendChild(more);
  refresh();
}

// sound: { machine, p (track parameters), g (shared FX), fm6 (FMSYN only) }; cb.onValue(kind, id, value)
export function renderEditor(host, sound, cb) {
  host.innerHTML = "";
  host.className = "editor";
  if (sound.fm6) fm6Editor(host, sound, cb);
  else machineEditor(host, sound, cb);
}
