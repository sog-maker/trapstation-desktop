// The editor view: factory banks A–E, the user's own sounds, the editor itself, and the playing of the sound
// through the firmware's own engine. Edits are kept on this PC (localStorage); nothing here writes to the FM-1.
import { FACTORY, FX_GLOBAL } from "./factory.js";
import { renderEditor } from "./editor.js";
import { parseSyx, toSyx, sanitize, nameOf, setName, V, FM6_LEN } from "./fm6.js";
import { ENGI_FM6 } from "./jam.js";
import * as audio from "./audio.js";

const $ = (id) => document.getElementById(id);
const BANKS = Object.keys(FACTORY);
const GDEF = FX_GLOBAL.map((x) => x.def);
// DX7 voices bring no colour values: a neutral start (no drive, open filter, the factory voices' usual level)
const COLOR_DEF = [0, 20000, 75];
// imported voices play on the FMSYN machine: A1's track settings, with the sends closed
const FM_BASE = { bank: 0, slot: 0 };

let edits = {};        // "A0" -> { p, fm6, g }: the edited copy of a factory preset
let mine = [];         // [{ name, bank, slot, machine, p, fm6, g }]: the user's own sounds
let sel = { kind: "factory", bank: 0, slot: 0 };
let device = null;     // { readProject(), lightKey(note, on), clearKeys() } from app.js

function load() {
  try { edits = JSON.parse(localStorage.getItem("trap-edits-v2") || "{}"); } catch (_) { edits = {}; }
  try { mine = JSON.parse(localStorage.getItem("trap-sounds") || "[]"); } catch (_) { mine = []; }
  if (!Array.isArray(mine)) mine = [];
}
function save() {
  try {
    localStorage.setItem("trap-edits-v2", JSON.stringify(edits));
    localStorage.setItem("trap-sounds", JSON.stringify(mine));
  } catch (_) { /* no storage */ }
}
const status = (t) => { $("edstat").textContent = t; };

const factoryOf = (bank, slot) => FACTORY[BANKS[bank]][slot];
const copyOf = (f) => ({ p: f.p.slice(), fm6: f.fm6 ? f.fm6.slice() : undefined, g: GDEF.slice() });
const keyOf = (bank, slot) => BANKS[bank] + slot;

// the sound on the editor: the values it shows and changes
function current() {
  if (sel.kind === "mine") {
    const m = mine[sel.index];
    return m ? { ...m, base: { bank: m.bank, slot: m.slot }, own: true } : null;
  }
  const f = factoryOf(sel.bank, sel.slot), k = keyOf(sel.bank, sel.slot);
  const e = edits[k] || copyOf(f);
  return { name: f.name, machine: f.machine, p: e.p, fm6: e.fm6, g: e.g, base: { bank: sel.bank, slot: sel.slot }, own: false, edited: !!edits[k], store: e, key: k };
}

function sendToEngine() {
  const s = current();
  if (s) audio.setSound(s.base.bank, s.base.slot, s.p, s.fm6, s.g);
}

// ---------- left column: banks and the user's sounds ----------
function renderBrowser() {
  const tabs = $("abetabs"), box = $("abeslots");
  tabs.innerHTML = ""; box.innerHTML = "";
  const bank = sel.kind === "factory" ? sel.bank : -1;
  let shownBank = renderBrowser.bank ?? 0;
  if (bank >= 0) shownBank = bank;
  renderBrowser.bank = shownBank;
  BANKS.forEach((k, i) => {
    const b = document.createElement("button");
    b.textContent = k;
    if (i === shownBank) b.classList.add("on");
    b.onclick = () => { renderBrowser.bank = i; choose({ kind: "factory", bank: i, slot: 0 }); };
    tabs.appendChild(b);
  });
  FACTORY[BANKS[shownBank]].forEach((s, i) => {
    const d = document.createElement("div");
    const on = sel.kind === "factory" && sel.bank === shownBank && sel.slot === i;
    d.className = "slot used" + (on ? " sel" : "") + (s.fm6 ? " fm" : "");
    const n = document.createElement("div");
    n.className = "n";
    n.textContent = BANKS[shownBank] + (i + 1) + (edits[keyOf(shownBank, i)] ? " •" : "");
    d.appendChild(n);
    d.appendChild(document.createTextNode(s.name));
    const t = document.createElement("div");
    t.className = "mach"; t.textContent = s.fm6 ? "FM6" : s.machine;
    d.appendChild(t);
    d.onclick = () => choose({ kind: "factory", bank: shownBank, slot: i });
    box.appendChild(d);
  });

  const list = $("minelist");
  list.innerHTML = "";
  $("mineempty").style.display = mine.length ? "none" : "block";
  mine.forEach((m, i) => {
    const row = document.createElement("div");
    row.className = "mine" + (sel.kind === "mine" && sel.index === i ? " sel" : "");
    const name = document.createElement("span");
    name.className = "mine-n"; name.textContent = m.name;
    const tag = document.createElement("span");
    tag.className = "mach"; tag.textContent = m.fm6 ? "FM6" : m.machine;
    const x = document.createElement("button");
    x.className = "x"; x.textContent = "✕"; x.title = "Delete this sound";
    x.onclick = (e) => {
      e.stopPropagation();
      if (!window.confirm(`Delete “${m.name}” from your sounds? This cannot be undone.`)) return;
      mine.splice(i, 1);
      if (sel.kind === "mine") sel = sel.index === i ? { kind: "factory", bank: 0, slot: 0 } : { kind: "mine", index: sel.index > i ? sel.index - 1 : sel.index };
      save(); renderAll();
    };
    row.appendChild(name); row.appendChild(tag); row.appendChild(x);
    row.onclick = () => choose({ kind: "mine", index: i });
    list.appendChild(row);
  });
}

function choose(s) {
  sel = s;
  audio.panic();
  renderAll();
}

// ---------- centre: title bar and editor ----------
function renderHead(s) {
  const name = $("edname");
  name.value = s.name;
  name.disabled = !s.own;
  name.title = s.own ? "The name of your sound" : "Factory names are fixed. “Save as my sound” makes a copy you can name.";
  $("edmach").textContent = s.fm6 ? "FMSYN · FM6" : s.machine;
  $("edwhere").textContent = s.own ? "MY SOUND" : `FACTORY ${BANKS[sel.bank]}${sel.slot + 1}${s.edited ? " · EDITED" : ""}`;
  $("edwhere").classList.toggle("gold", !!(s.own || s.edited));
  $("edreset").disabled = s.own || !s.edited;
  $("edsyx").disabled = !s.fm6;
}

function renderAll() {
  renderBrowser();
  const s = current();
  if (!s) { sel = { kind: "factory", bank: 0, slot: 0 }; return renderAll(); }
  renderHead(s);
  renderEditor($("params"), s, {
    onValue: (kind, id, value) => {
      if (!s.own && !edits[s.key]) {            // the first change of a factory preset starts its edited copy
        edits[s.key] = s.store;
        s.edited = true;
        renderHead(s);
        renderBrowser();
      }
      save();
      audio.setValue(kind, id, value);
    },
  });
  sendToEngine();
}

// ---------- actions ----------
function saveAsMine() {
  const s = current();
  const copy = { name: s.own ? s.name + " 2" : s.name + " EDIT", bank: s.base.bank, slot: s.base.slot, machine: s.machine,
    p: s.p.slice(), fm6: s.fm6 ? s.fm6.slice() : undefined, g: s.g.slice() };
  if (copy.fm6) setName(copy.fm6, copy.name);
  mine.push(copy);
  sel = { kind: "mine", index: mine.length - 1 };
  save(); renderAll();
  status(`Saved as “${copy.name}” in your sounds. Change the name in the title field.`);
  $("edname").focus(); $("edname").select();
}

function resetFactory() {
  const s = current();
  if (s.own || !s.edited) return;
  if (!window.confirm(`Discard your changes to ${s.name} and go back to the factory sound?`)) return;
  delete edits[s.key];
  save(); audio.panic(); renderAll();
  status(`${s.name}: factory sound restored.`);
}

function download(bytes, name, type) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([bytes], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
const fileName = (s) => s.name.trim().replace(/[^A-Za-z0-9 _-]/g, "").replace(/\s+/g, "-") || "sound";

function exportSyx() {
  const s = current();
  if (!s.fm6) return;
  const v = s.fm6.slice();
  setName(v, s.name);
  download(toSyx(v), fileName(s) + ".syx", "application/octet-stream");
  status(`${s.name}: exported as a DX7 voice. DRIVE, CUTOFF and OUTPUT are Trapstation's own and are not part of a DX7 file; “Export sound” keeps them.`);
}

function exportJson() {
  const s = current();
  const doc = { format: "trapstation-sound", version: 1, name: s.name, machine: s.machine, base: s.base, p: s.p, fm6: s.fm6 || null, g: s.g };
  download(JSON.stringify(doc, null, 1), fileName(s) + ".trapsound.json", "application/json");
  status(`${s.name}: exported with all its values.`);
}

function addVoices(voices, source) {
  const base = factoryOf(FM_BASE.bank, FM_BASE.slot);
  let fixed = 0;
  for (const x of voices) {
    const fm6 = sanitize([...x.voice, ...COLOR_DEF]);
    fixed += x.fixed ? 1 : 0;
    mine.push({ name: x.name, bank: FM_BASE.bank, slot: FM_BASE.slot, machine: base.machine, p: base.p.slice(), fm6, g: GDEF.slice() });
  }
  sel = { kind: "mine", index: mine.length - voices.length };
  save(); audio.panic(); renderAll();
  status(`${voices.length} voice${voices.length === 1 ? "" : "s"} from ${source} added to your sounds.` +
    (fixed ? ` ${fixed} had values outside the DX7's ranges; those were limited.` : ""));
}

async function importFile(file) {
  try {
    if (/\.json$/i.test(file.name)) {
      if (file.size > 65536) throw new Error("the file is too large for a sound");
      const d = JSON.parse(await file.text());
      const np = factoryOf(0, 0).p.length;
      const ints = (a, n) => Array.isArray(a) && a.length === n && a.every((x) => Number.isInteger(x) && x >= -32768 && x <= 32767);
      if (d.format !== "trapstation-sound" || d.version !== 1 || !ints(d.p, np) || !ints(d.g, GDEF.length) ||
          !d.base || !BANKS[d.base.bank] || !FACTORY[BANKS[d.base.bank]][d.base.slot] || (d.fm6 && !ints(d.fm6, FM6_LEN))) {
        throw new Error("not a Trapstation sound file");
      }
      const f = factoryOf(d.base.bank, d.base.slot);
      if (!!d.fm6 !== !!f.fm6) throw new Error("the file does not fit its machine");
      mine.push({ name: String(d.name || "SOUND").slice(0, 24), bank: d.base.bank, slot: d.base.slot, machine: f.machine,
        p: d.p.slice(), fm6: d.fm6 ? sanitize(d.fm6) : undefined, g: d.g.slice() });
      sel = { kind: "mine", index: mine.length - 1 };
      save(); audio.panic(); renderAll();
      status(`“${mine[sel.index].name}” added to your sounds.`);
      return;
    }
    if (file.size > 8192) throw new Error("too large for a DX7 voice or bank");
    addVoices(parseSyx(new Uint8Array(await file.arrayBuffer())), file.name);
  } catch (e) {
    status(`Import of ${file.name} failed: ${e.message}. Nothing was changed.`);
  }
}

// the FM6 voices of the six tracks from the FM-1's last project (read only)
async function readDevice() {
  if (!device) return;
  try {
    status("Reading the project from the FM-1…");
    const jam = await device.readProject();
    if (!jam) { status("No FM-1 connected."); return; }
    if (!jam.fm6) {
      status(jam.fm6Format ? "The project has no FM6 voices to read." : "This FM-1 runs a firmware without FM6 (its project is in the 1.0 format). Nothing to read.");
      return;
    }
    const base = factoryOf(FM_BASE.bank, FM_BASE.slot);
    const np = base.p.length;
    let n = 0, first = mine.length;
    jam.tracks.forEach((t, i) => {
      if (t.eng !== ENGI_FM6) return;
      const fm6 = sanitize(jam.fm6[i]);
      // the track's own parameters when the project stores as many as this app knows, else the FMSYN defaults
      const p = t.params.length === np ? t.params.slice() : base.p.slice();
      const g = GDEF.slice();
      mine.push({ name: `T${i + 1} ${nameOf(fm6) || "FM6"}`, bank: FM_BASE.bank, slot: FM_BASE.slot, machine: base.machine, p, fm6, g });
      n++;
    });
    if (!n) { status("No track of the project uses FMSYN."); return; }
    sel = { kind: "mine", index: first };
    save(); audio.panic(); renderAll();
    status(`${n} FM6 voice${n === 1 ? "" : "s"} read from the FM-1's tracks and added to your sounds (copies; the FM-1 was not changed).`);
  } catch (e) {
    status("Reading the project failed: " + e.message);
  }
}

// ---------- playing: the FM-1's own keys (app.js passes their MIDI notes on) and the computer keys ----------
const KEYS = ["KeyA", "KeyW", "KeyS", "KeyE", "KeyD", "KeyF", "KeyT", "KeyG", "KeyY", "KeyH", "KeyU", "KeyJ", "KeyK", "KeyO", "KeyL", "KeyP", "Semicolon"];
const held = new Map();     // key id -> note
let hold = false;

async function play(id, note, velocity, down) {
  if (down) {
    if (held.has(id)) return;
    held.set(id, note);
    if (!audio.audioOn()) {
      const ok = await audio.startAudio();
      audio.setGain(Number($("kbvol").value) / 100);
      renderAudio();
      if (!ok || !held.has(id)) return;        // no sound, or the key was let go while the engine started
    }
    audio.noteOn(note, velocity);
    if (device) device.lightKey(note, true);
  } else {
    if (!held.has(id)) return;
    held.delete(id);
    if (!hold) audio.noteOff(note);
    if (device) device.lightKey(note, false);
  }
}
function allOff() {
  held.clear();
  if (device) device.clearKeys();
  audio.panic();
}
// a note from the FM-1's keys (USB MIDI)
export function deviceNote(note, velocity, on) { play("m" + note, note, velocity || 100, on); }

function bindKeys() {
  const typing = (t) => t.tagName === "SELECT" || t.tagName === "TEXTAREA" || (t.tagName === "INPUT" && t.type !== "range");
  window.addEventListener("keydown", (e) => {
    if (e.repeat || e.ctrlKey || e.altKey || e.metaKey || typing(e.target) || document.querySelector(".modal:not([hidden])")) return;
    const i = KEYS.indexOf(e.code);
    if (i >= 0) { e.preventDefault(); play(e.code, Number($("kboct").value) + i, 100, true); }
  });
  window.addEventListener("keyup", (e) => { if (KEYS.includes(e.code) && held.has(e.code)) play(e.code, held.get(e.code), 0, false); });
  window.addEventListener("blur", allOff);
  $("kboct").onchange = allOff;
  $("kbhold").onclick = () => {
    hold = !hold;
    $("kbhold").classList.toggle("on", hold);
    if (!hold) allOff();
  };
  $("kbstop").onclick = allOff;
  $("kbvol").oninput = () => audio.setGain(Number($("kbvol").value) / 100);
}
function renderAudio() {
  $("kbaudio").textContent = audio.audioOn() ? "Sound on" : "Turn sound on";
  $("kbaudio").classList.toggle("on", audio.audioOn());
}
// the device was connected (a click): the engine can start, so the FM-1's keys sound at once
export async function soundOn() {
  await audio.startAudio();
  audio.setGain(Number($("kbvol").value) / 100);
  renderAudio();
}

// ---------- start ----------
export function initSoundView(dev) {
  device = dev;
  load();
  bindKeys();
  audio.onState((t) => { $("kbstate").textContent = t; });
  audio.onMeter((peak) => {
    // -48 dBFS .. 0 dBFS across the bar
    const db = peak > 0 ? 20 * Math.log10(peak) : -100;
    $("kbmeter").style.width = Math.max(0, Math.min(100, (db + 48) / 48 * 100)) + "%";
    $("kbmeter").classList.toggle("clip", peak >= 1);
  });
  $("kbaudio").onclick = soundOn;
  $("edsave").onclick = saveAsMine;
  $("edreset").onclick = resetFactory;
  $("edsyx").onclick = exportSyx;
  $("edjson").onclick = exportJson;
  $("edimport").onclick = () => $("edfile").click();
  $("edfile").onchange = async () => { const f = $("edfile").files[0]; $("edfile").value = ""; if (f) await importFile(f); };
  $("edread").onclick = readDevice;
  $("edname").onchange = () => {
    if (sel.kind !== "mine" || !mine[sel.index]) return;
    const m = mine[sel.index];
    m.name = $("edname").value.trim().slice(0, 24) || "SOUND";
    if (m.fm6) setName(m.fm6, m.name);
    save(); renderBrowser(); $("edname").value = m.name;
  };
  const drop = $("edmain");
  drop.ondragover = (e) => { if ([...e.dataTransfer.types].includes("Files")) e.preventDefault(); };
  drop.ondrop = (e) => { const f = e.dataTransfer.files[0]; if (f && /\.(syx|json)$/i.test(f.name)) { e.preventDefault(); importFile(f); } };
  renderAll();
  renderAudio();
}

// the device was disconnected: its held keys can no longer send their note-off
export function deviceGone() { allOff(); }
