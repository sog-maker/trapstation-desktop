// SPDX-License-Identifier: GPL-3.0-only
// The FM-1 drawn around the mirrored screen: body, knobs, buttons and the 27 keys, after the layout of the
// firmware's browser emulator (TRAPSTATION OS web/emu/index.html, "wide"). A drawing only: nothing here is a control.
// The keys light while their note sounds.
const NS = "http://www.w3.org/2000/svg";
const W = 1000, H = 624, SCREEN = [292, 44, 256];
const KNOBS = [["MASTER", 105, 100, 24], ["SELECT", 215, 100, 24], ["PRESETS", 105, 205, 24], ["ALGORITHM", 215, 205, 24],
  ["KNOB 1", 610, 100, 22], ["KNOB 2", 714, 100, 22], ["KNOB 3", 818, 100, 22], ["KNOB 4", 922, 100, 22]];
const TRAYS = [[50, 250, 220, 50], [568, 160, 400, 140]];
const OCT = [[60, 258, 90, 34, "OCT-"], [170, 258, 90, 34, "OCT+"]];
const GRID = [582, 174, 54, 48, 63, 62], KEYBED = [36, 332, 928, 256];
const ROW1 = ["FX", "SCL", "ENV", "LFO", "EDIT", "GLO"], ROW2 = ["HOME", "SAVE", "ARP", "SEQ", "PLAY", "REC"];
// the 27 keys F3..G5: key k = k semitones above F3
const WHITE = [0, 2, 4, 6, 7, 9, 11, 12, 14, 16, 18, 19, 21, 23, 24, 26];
const BLACK = [1, 3, 5, 8, 10, 13, 15, 17, 20, 22, 25];
const BLACK_AFTER = [0, 1, 2, 4, 5, 7, 8, 9, 11, 12, 14];
const F3 = 53;

function el(tag, attrs, parent) {
  const e = document.createElementNS(NS, tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  parent.appendChild(e);
  return e;
}
function label(parent, x, y, s, size, ink) {
  const t = el("text", { x, y, "text-anchor": "middle", "font-size": size, class: "fm1-label" }, parent);
  if (ink) t.setAttribute("fill", ink);
  t.textContent = s;
}

// svg: the panel drawing; canvas: the mirror's canvas, placed on the drawn screen
export function buildFrame(svg, canvas) {
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.innerHTML = "";
  el("rect", { x: 4, y: 4, width: W - 8, height: H - 8, rx: 40, class: "fm1-body" }, svg);
  for (const [x, y, w, h] of TRAYS) el("rect", { x, y, width: w, height: h, rx: 14, class: "fm1-tray" }, svg);
  const [sx, sy, ss] = SCREEN, inset = ss / 32;
  el("rect", { x: sx, y: sy, width: ss, height: ss, rx: 18, fill: "#0b0b0c" }, svg);
  Object.assign(canvas.style, { left: `${(sx + inset) / W * 100}%`, top: `${(sy + inset) / H * 100}%`,
    width: `${(ss - 2 * inset) / W * 100}%`, height: `${(ss - 2 * inset) / H * 100}%` });
  for (const [n, x, y, r] of KNOBS) {
    el("circle", { cx: x, cy: y, r: r + 5, class: "fm1-tray" }, svg);
    el("circle", { cx: x, cy: y, r, class: "fm1-part" }, svg);
    if (n === "MASTER") el("line", { x1: x, y1: y - r + 5, x2: x, y2: y - r + 14, class: "fm1-ind" }, svg);
    label(svg, x, y - r - 12, n, 15);
  }
  const button = (x, y, w, h, n, sub) => {
    el("rect", { x, y, width: w, height: h, rx: 8, class: "fm1-part" }, svg);
    const ink = n === "REC" ? "#ff453a" : null;
    if (sub) { label(svg, x + w / 2, y + h / 2 - 2, n, 10.8, ink); label(svg, x + w / 2, y + h / 2 + 11, sub, 9.9); }
    else label(svg, x + w / 2, y + h / 2 + 4.5, n, 12.6, ink);
  };
  for (const [x, y, w, h, n] of OCT) button(x, y, w, h, n);
  const [gx, gy, gw, gh, dx, dy] = GRID;
  for (let i = 0; i < 6; i++) {
    button(gx + i * dx, gy, gw, gh, ROW1[i]);
    button(gx + i * dx, gy + dy, gw, gh, ROW2[i], ROW2[i] === "PLAY" ? "STOP" : "");
  }
  const [x0, y0, w, h] = KEYBED;
  el("rect", { x: x0, y: y0, width: w, height: h, rx: 18, class: "fm1-tray" }, svg);
  const pitch = (w - 24) / 16, kw = pitch * 0.78, kh = h * 0.425, sw = Math.max(3, kw * 0.14);
  const keys = [];
  const key = (cx, cy, k) => {
    const g = el("g", { class: "fm1-key" }, svg), y = cy - kh / 2;
    el("rect", { x: cx - kw / 2, y, width: kw, height: kh, rx: kw / 2, class: "fm1-face" }, g);
    el("rect", { x: cx - sw / 2, y: y + kw * 0.4, width: sw, height: kh - kw * 0.8, rx: sw / 2, class: "fm1-slit" }, g);
    keys[k] = g;
  };
  WHITE.forEach((k, i) => key(x0 + 12 + (i + 0.5) * pitch, y0 + h * 0.75, k));
  BLACK_AFTER.forEach((a, j) => key(x0 + 12 + (a + 1) * pitch, y0 + h * 0.25, BLACK[j]));

  const count = new Array(27).fill(0);
  // a note outside F3..G5 lights the key of the same name (the device's octave buttons move the range)
  const fold = (note) => { let k = note - F3; while (k < 0) k += 12; while (k > 26) k -= 12; return k; };
  return {
    key(note, on) {
      const k = fold(note);
      count[k] = Math.max(0, count[k] + (on ? 1 : -1));
      keys[k].classList.toggle("lit", count[k] > 0);
    },
    clear() { count.fill(0); keys.forEach((g) => g.classList.remove("lit")); },
  };
}
