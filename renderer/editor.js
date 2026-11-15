// Sound editor in the Trapstation look (design cards / mockups): operator rows with an envelope graph, effect cards
// with sliders. Values are the firmware's own parameters (params.c aliases: FLT_* = FM1_*, FE_* = FM2_* in MONO/8BAS).
// Nothing here writes to the device; onChange only changes the local value.

const NS = "http://www.w3.org/2000/svg";
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

// one slider + number field bound to values[i]
function control(label, name, i, values, onChange, enabled = true) {
  const wrap = el("div", "ctl" + (enabled ? "" : " off"));
  wrap.appendChild(el("div", "ctl-label", label));
  const row = el("div", "ctl-row");
  const range = document.createElement("input");
  range.type = "range"; range.min = -64; range.max = 127; range.value = values[i]; range.disabled = !enabled;
  const num = document.createElement("input");
  num.type = "number"; num.min = -64; num.max = 127; num.value = values[i]; num.disabled = !enabled;
  const set = (v) => { v = clamp(Math.round(Number(v) || 0), -64, 127); values[i] = v; range.value = v; num.value = v; onChange(name, v); };
  range.oninput = () => set(range.value);
  num.onchange = () => set(num.value);
  row.appendChild(range); row.appendChild(num);
  wrap.appendChild(row);
  return wrap;
}

// envelope graph: attack to 1, decay to sustain, release to 0 (display only, values 0..127 scaled)
function envelope(values, idx) {
  const [a, d, s, r] = idx.map((i) => clamp(values[i], 0, 127) / 127);
  const W = 240, H = 64, x1 = 6 + a * 70, x2 = x1 + 8 + d * 70, x3 = x2 + 30, x4 = x3 + 8 + r * 70;
  const sy = H - 6 - s * (H - 12);
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.setAttribute("class", "env");
  const pts = [[6, H - 6], [x1, 6], [x2, sy], [x3, sy], [Math.min(x4, W - 6), H - 6]];
  const poly = document.createElementNS(NS, "polygon");
  poly.setAttribute("points", pts.map((p) => p.join(",")).join(" ") + ` ${Math.min(x4, W - 6)},${H} 6,${H}`);
  poly.setAttribute("class", "env-fill");
  svg.appendChild(poly);
  const line = document.createElementNS(NS, "polyline");
  line.setAttribute("points", pts.map((p) => p.join(",")).join(" "));
  line.setAttribute("class", "env-line");
  svg.appendChild(line);
  return svg;
}

// the operator section (FMSYN): four operator rows, each with its envelope and its values
function operators(values, onChange, container) {
  const sec = el("section", "panel");
  sec.appendChild(sectionHead("Operators"));
  for (let o = 1; o <= 4; o++) {
    const row = el("div", "op");
    const head = el("div", "op-head");
    head.appendChild(el("span", "op-num", String(o)));
    head.appendChild(el("span", "badge " + (o % 2 ? "carrier" : "modulator"), o % 2 ? "CARRIER" : "MODULATOR"));
    row.appendChild(head);
    const idx = [`FM${o}_ATK`, `FM${o}_DEC`, `FM${o}_SUS`, `FM${o}_REL`, `FM${o}_LEVEL`].map((n) => PN.indexOf(n));
    if (idx.some((i) => i < 0)) continue;
    const body = el("div", "op-body");
    body.appendChild(envelope(values, idx.slice(0, 4)));
    const grid = el("div", "op-grid");
    ["ATK", "DEC", "SUS", "REL", "LEVEL"].forEach((lab, k) => grid.appendChild(control(lab, `FM${o}_${lab}`, idx[k], values, onChange)));
    body.appendChild(grid);
    row.appendChild(body);
    sec.appendChild(row);
  }
  container.appendChild(sec);
}

// effect cards: the mockup's eight cards, each filled with the firmware parameters it has (others greyed out)
function effects(values, machine, onChange, container) {
  const sec = el("section", "panel");
  sec.appendChild(sectionHead("Effects"));
  const grid = el("div", "fx-grid");
  const isFM = machine === "FMSYN";
  const P = (n) => PN.indexOf(n);
  const card = (title, fields, note) => {
    const c = el("div", "fx-card");
    const h = el("div", "fx-head");
    h.appendChild(el("span", "fx-title", title));
    c.appendChild(h);
    fields.forEach(([lab, name, enabled]) => {
      const i = P(name);
      if (i >= 0) c.appendChild(control(lab, name, i, values, onChange, enabled !== false));
    });
    if (note) c.appendChild(el("div", "fx-note", note));
    grid.appendChild(c);
  };
  const cutOk = !isFM;
  // the filter exists only in MONO / 8BAS (its values sit on the FM1 slots); FMSYN has no filter card
  if (cutOk) card("FILTER", [["CUTOFF", "FM1_ATK"], ["RESONANCE", "FM1_DEC"], ["DRIVE", "FM1_SUS"], ["KEYTRACK", "FM1_REL"]]);
  card("HALL", [["MIX", "REV", true]]);
  card("DELAY", [["MIX", "DLY", true]]);
  card("DISTORTION", [["DRIVE", "DIST", true]]);
  card("CHORUS", [["MIX", "CHOR", true]]);
  card("INSERT", [["TYPE", "ITYPE", true], ["A", "IA", true], ["B", "IB", true], ["C", "IC", true], ["MIX", "IMIX", true]]);
  sec.appendChild(grid);
  container.appendChild(sec);
}

function sectionHead(title) {
  const h = el("div", "sec-head");
  h.appendChild(el("span", "sec-icon", "◆"));
  h.appendChild(el("span", "sec-title", title));
  return h;
}

let PN = [];
// the whole editor for one preset
export function renderEditor(container, values, machine, names, onChange) {
  PN = names;
  container.innerHTML = "";
  container.className = "editor";
  if (machine === "FMSYN") operators(values, onChange, container);
  effects(values, machine, onChange, container);
  // the parameters the design has no panel for: listed so nothing is hidden
  const rest = el("section", "panel");
  rest.appendChild(sectionHead("More parameters"));
  const grid = el("div", "rest-grid");
  const shown = new Set(["FM1_ATK", "FM1_DEC", "FM1_SUS", "FM1_REL", "FM1_LEVEL", "FM2_ATK", "FM2_DEC", "FM2_SUS", "FM2_REL", "FM2_LEVEL",
    "FM3_ATK", "FM3_DEC", "FM3_SUS", "FM3_REL", "FM3_LEVEL", "FM4_ATK", "FM4_DEC", "FM4_SUS", "FM4_REL", "FM4_LEVEL",
    "DIST", "CHOR", "DLY", "REV", "ITYPE", "IA", "IB", "IC", "IMIX"]);
  names.forEach((n, i) => { if (!shown.has(n)) grid.appendChild(control(n, n, i, values, onChange)); });
  rest.appendChild(grid);
  container.appendChild(rest);
}
