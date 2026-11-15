// Clip editor on a grid: piano roll for melodic clips, drum sequencer (8 lanes) for drum clips.
// Grid = one 16th note (120 ticks at PPQ 480). Click an empty cell: add a note of one 16th. Click a note: remove it.
// Drag the right edge of a note: change its length. Nothing is written to the device; onSave gets the notes.

const TICKS16 = 120;          // 16th note at PPQ 480
const CELL_W = 22, CELL_H = 14;
const PIANO_LO = 36, PIANO_HI = 84;   // C2..C6
const DRUM_LO = 36, DRUM_N = 8;       // lanes = GM 36..43

export function openClipEditor(host, { notes, lengthTicks, drum, title, onSave, onCancel }) {
  const cols = Math.max(1, Math.round(lengthTicks / TICKS16));
  const rowsN = drum ? DRUM_N : PIANO_HI - PIANO_LO + 1;
  const rowNote = (r) => (drum ? DRUM_LO + (DRUM_N - 1 - r) : PIANO_HI - r);   // top row = highest pitch / lane 7
  const rowOf = (note) => (drum ? DRUM_N - 1 - (note - DRUM_LO) : PIANO_HI - note);
  const list = notes.map((n) => ({ ...n }));

  host.innerHTML = "";
  const head = document.createElement("div");
  head.className = "ce-head";
  head.textContent = title;
  host.appendChild(head);

  const wrap = document.createElement("div");
  wrap.className = "ce-wrap";
  const labels = document.createElement("div");
  labels.className = "ce-labels";
  labels.style.height = rowsN * CELL_H + "px";
  for (let r = 0; r < rowsN; r++) {
    const l = document.createElement("div");
    l.className = "ce-label" + (drum ? " drum" : "");
    l.style.height = CELL_H + "px";
    const n = rowNote(r);
    l.textContent = drum ? `Lane ${n - DRUM_LO + 1}` : (n % 12 === 0 ? `C${Math.floor(n / 12) - 1}` : (n % 12 === 4 || n % 12 === 7 || n % 12 === 9 || n % 12 === 2 || n % 12 === 11 ? "" : ""));
    labels.appendChild(l);
  }
  const canvas = document.createElement("canvas");
  canvas.width = cols * CELL_W;
  canvas.height = rowsN * CELL_H;
  canvas.className = "ce-canvas";
  wrap.appendChild(labels);
  const scroll = document.createElement("div");
  scroll.className = "ce-scroll";
  scroll.appendChild(canvas);
  wrap.appendChild(scroll);
  host.appendChild(wrap);

  const ctx = canvas.getContext("2d");
  const draw = () => {
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    for (let r = 0; r < rowsN; r++) {
      const n = rowNote(r), black = !drum && [1, 3, 6, 8, 10].includes(n % 12);
      ctx.fillStyle = black ? "#101214" : "#16181A";
      ctx.fillRect(0, r * CELL_H, canvas.width, CELL_H);
    }
    for (let c = 0; c < cols; c++) {
      ctx.fillStyle = c % 4 === 0 ? "#4A4F54" : "#2A2E31";
      ctx.fillRect(c * CELL_W, 0, 1, canvas.height);
    }
    for (let r = 0; r <= rowsN; r++) { ctx.fillStyle = "#2A2E31"; ctx.fillRect(0, r * CELL_H, canvas.width, 1); }
    for (const n of list) {
      const r = rowOf(n.note);
      if (r < 0 || r >= rowsN) continue;
      const x = Math.round(n.tick / TICKS16) * CELL_W, w = Math.max(CELL_W - 2, Math.round(n.dur / TICKS16) * CELL_W - 2);
      const a = Math.max(0.35, n.vel / 127);
      ctx.fillStyle = `rgba(255,42,42,${a})`;
      ctx.fillRect(x + 1, r * CELL_H + 1, w, CELL_H - 2);
      ctx.fillStyle = "#FDCF3D";
      ctx.fillRect(x + w - 1, r * CELL_H + 1, 2, CELL_H - 2);   // right edge: drag to change the length
    }
  };

  const at = (ev) => {
    const b = canvas.getBoundingClientRect();
    return { c: Math.floor((ev.clientX - b.left) / CELL_W), r: Math.floor((ev.clientY - b.top) / CELL_H) };
  };
  const hit = (c, r) => list.find((n) => rowOf(n.note) === r && Math.round(n.tick / TICKS16) <= c && c < Math.round(n.tick / TICKS16) + Math.max(1, Math.round(n.dur / TICKS16)));

  let drag = null;
  canvas.onmousedown = (ev) => {
    const { c, r } = at(ev);
    if (c < 0 || r < 0 || c >= cols || r >= rowsN) return;
    const n = hit(c, r);
    if (n) {
      const endX = (Math.round(n.tick / TICKS16) + Math.max(1, Math.round(n.dur / TICKS16))) * CELL_W;
      const x = ev.clientX - canvas.getBoundingClientRect().left;
      if (Math.abs(x - endX) < 8) { drag = { n }; return; }   // the right edge: resize
      list.splice(list.indexOf(n), 1);                       // the body: remove
    } else {
      list.push({ tick: c * TICKS16, dur: TICKS16, note: rowNote(r), vel: 100 });
    }
    draw();
  };
  canvas.onmousemove = (ev) => {
    if (!drag) return;
    const { c } = at(ev);
    const start = Math.round(drag.n.tick / TICKS16);
    drag.n.dur = Math.max(TICKS16, (Math.max(start + 1, Math.min(cols, c + 1)) - start) * TICKS16);
    draw();
  };
  window.addEventListener("mouseup", () => { drag = null; });

  const bar = document.createElement("div");
  bar.className = "ce-bar";
  const info = document.createElement("span");
  info.textContent = `${cols} 16ths · ${list.length} ${drum ? "hits" : "notes"} · Click: add/remove · drag the edge: length`;
  const save = document.createElement("button");
  save.textContent = "Apply";
  save.className = "primary";
  save.onclick = () => onSave(list.map((n) => ({ ...n })));
  const cancel = document.createElement("button");
  cancel.textContent = "Cancel";
  cancel.onclick = () => onCancel && onCancel();
  bar.appendChild(info);
  bar.appendChild(cancel);
  bar.appendChild(save);
  host.appendChild(bar);
  draw();
}
