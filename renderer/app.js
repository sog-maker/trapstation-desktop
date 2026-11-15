// Renderer: converter (left), device column (screen mirror, banks, parameter view), file list (bottom).
import { convertMono } from "./convert.js";
import { uploadSamples } from "../web/fm1smp.js";
import { Updater } from "../web/fm1ota.js";
import { Mirror } from "./mirror.js";
import { snapshot, endSession, readSampleRegion, readObjects, slotBytes, withSlot, writeObject, POOLS, GB_SLOTS, GB_PMAGIC, SOBJ_LEN } from "./banks.js";
import { parseVital, toFm1 } from "./vital.js";
import { FACTORY } from "./factory_params.js";
import { renderEditor } from "./editor.js";
import { parseJam } from "./jam.js";
import { clipOf, smf, smfScene, sceneTicks } from "./clips.js";
import { openClipEditor } from "./clipeditor.js";

let lastJam = null;   // the last read arrangement (jam), for the clip view and the clip export

// local edits survive a restart (this PC only; nothing is written to the FM-1)
function saveEdits() { try { localStorage.setItem("trap-edits", JSON.stringify(edits)); } catch (_) { /* no storage */ } }
function loadEdits() { try { const s = localStorage.getItem("trap-edits"); if (s) Object.assign(edits, JSON.parse(s)); } catch (_) { /* no storage */ } }
import { parseImage, buildImage, SMP_CAP } from "../web/smpimg.js";
import { PNAMES } from "./params.js";
import { PLABEL } from "./labels.js";

const $ = (id) => document.getElementById(id);
const files = [];           // { name, rate, seconds, bytes, img, syx }
let selected = null;        // file row
let link = null;            // open FM-1 link (null when disconnected)
let pools = null;           // 6 x 16 slots from the last snapshot
let objects = null;         // the 3 sound objects as bytes (for backup and write)
let pool = 0, slot = null;  // selected pool tab and slot
let edits = {};             // local parameter edits "pool:slot" -> values (not written to the device)

const setStatus = (t) => { $("status").textContent = t; };
const setMirror = (t) => { $("mstat").textContent = t; };

// ---------- converter ----------
function renderFiles() {
  const list = $("list");
  list.innerHTML = "";
  $("empty").style.display = files.length ? "none" : "block";
  files.forEach((f, i) => {
    const tr = document.createElement("tr");
    tr.draggable = true;
    if (selected === i) tr.classList.add("sel");
    tr.innerHTML = `<td>${f.name}</td><td>${f.rate} Hz</td><td>${f.seconds.toFixed(2)} s</td><td>${f.bytes}</td>`;
    tr.onclick = () => { selected = i; renderFiles(); };
    tr.ondragstart = (e) => { e.dataTransfer.setData("text/plain", "file:" + i); selected = i; };
    list.appendChild(tr);
  });
  $("sendBtn").disabled = selected === null;
  $("save").disabled = selected === null;
}

// any audio file: ffmpeg decodes the original to mono 44.1 kHz; the SYX comes from that. An Opus copy goes to the archive in the background.
async function addAudio(file) {
  $("conv").textContent = "Converting…";
  try {
    const path = window.bridge.pathOf(file);
    const name = file.name.replace(/\.[^.]+$/, "");
    // step 1: original -> Opus (kept in Opus-Archiv); step 2: that Opus -> mono 44.1 kHz -> SYX
    $("conv").textContent = "Step 1/2: creating Opus…";
    const opusPath = await window.bridge.opus(path, name);
    $("conv").textContent = "Step 2/2: creating SYX from the Opus file…";
    const raw = new Uint8Array(await window.bridge.decode(opusPath));
    const mono = new Float32Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
    const r = convertMono(mono, 44100, name);
    r.source = opusPath;
    files.push(r);
    selected = files.length - 1;
    $("conv").textContent = `${r.name}: ${r.seconds.toFixed(2)} s bei ${r.rate} Hz · aus ${opusPath}`;
    renderFiles();
  } catch (e) {
    $("conv").textContent = "Error: " + e.message;
  }
}

const drop = $("drop");
drop.onclick = () => $("file").click();
$("file").onchange = (e) => { if (e.target.files[0]) addAudio(e.target.files[0]); };
drop.ondragover = (e) => { e.preventDefault(); drop.classList.add("over"); };
drop.ondragleave = () => drop.classList.remove("over");
drop.ondrop = (e) => { e.preventDefault(); drop.classList.remove("over"); if (e.dataTransfer.files[0]) addAudio(e.dataTransfer.files[0]); };

$("save").onclick = () => {
  const f = files[selected];
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([f.syx], { type: "application/octet-stream" }));
  a.download = f.name + ".syx";
  a.click();
};

// sample upload replaces the whole sample memory; release the device link first (uploader opens its own)
// ---------- samples S01..S32 ----------
let sampleList = null;      // chunks on the FM-1 (null = not read yet)

function renderMemory() {
  const bar = $("membar"), fill = $("memfill"), txt = $("memtxt");
  if (!sampleList) { fill.style.width = "0"; txt.textContent = "Memory: not read"; bar.classList.remove("full"); return; }
  const used = sampleList.reduce((a, c) => a + c.data.length, 0), pct = used / SMP_CAP * 100;
  fill.style.width = Math.min(100, pct) + "%";
  txt.textContent = `Memory: ${used} of ${SMP_CAP} bytes used (${pct.toFixed(0)} %) · ${sampleList.length} of 32 samples`;
  bar.classList.toggle("full", pct > 90);
}

function renderSamples() {
  const box = $("sslots");
  box.innerHTML = "";
  renderMemory();
  for (let s = 0; s < 32; s++) {
    const c = sampleList && sampleList[s];
    const d = document.createElement("div");
    d.className = "slot" + (c ? " used" : "");
    d.innerHTML = `<div class="n">S${String(s + 1).padStart(2, "0")}</div>${c ? c.name : "frei"}`;
    if (c) {
      const x = document.createElement("button");
      x.className = "x"; x.textContent = "✕"; x.title = "Remove sample";
      x.onclick = (e) => { e.stopPropagation(); removeSample(s); };
      d.prepend(x);
    }
    d.ondragover = (e) => { e.preventDefault(); d.classList.add("over"); };
    d.ondragleave = () => d.classList.remove("over");
    d.ondrop = (e) => {
      e.preventDefault(); d.classList.remove("over");
      const raw = e.dataTransfer.getData("text/plain");
      if (raw.startsWith("file:")) insertSample(Number(raw.slice(5)), s);
    };
    box.appendChild(d);
  }
}

// reads the sample region (keeps the link open for the next step)
async function readSamples() {
  if (!link) await connect();
  if (!link) return null;
  await screen.pause();
  const region = await readSampleRegion(link, setStatus);
  const have = parseImage(region);
  const hv = new DataView(region.buffer, region.byteOffset, region.byteLength);
  const emptyTable = hv.getUint32(0, true) === 0x324D5346 && hv.getUint16(6, true) === 0;   // valid table, 0 samples
  if (!have.length && !emptyTable && region.some((b) => b !== 0xFF && b !== 0)) {
    const v = hv;
    const magic = v.getUint32(0, true).toString(16), ver = v.getUint16(4, true), n = v.getUint16(6, true), dlen = v.getUint32(8, true);
    throw new Error(`Sample memory is not readable (magic 0x${magic}, version ${ver}, ${n} samples, data ${dlen} bytes, length ${region.length}). Upload cancelled, nothing changed.`);
  }
  sampleList = have;
  screen.resume();
  renderSamples();
  return have;
}
$("samp").onclick = async () => {
  try { const h = await readSamples(); if (h) setStatus(`${h.length} Samples auf der FM-1.`); }
  catch (e) { setStatus("Error: " + e.message); }
};

// puts file i at sample position pos (0-based): the others keep their order, same name replaces, then upload all
async function insertSample(i, pos = null) {
  const f = files[i];
  try {
    setStatus("Lese vorhandene Samples…");
    const have = await readSamples();
    if (!have) { setStatus("No FM-1 connected. Click Connect first."); return; }
    const list = have.filter((c) => c.name !== f.chunk.name);
    const at = pos === null ? list.length : Math.min(pos, list.length);
    list.splice(at, 0, f.chunk);
    if (list.length > 32) { setStatus("Schon 32 Samples auf der FM-1. Erst eines entfernen."); return; }
    const used = list.reduce((a, c) => a + c.data.length, 0);
    if (used > SMP_CAP) {
      const free = Math.max(0, SMP_CAP - (used - f.chunk.data.length));
      setStatus(`Memory full: no space for ${f.name} (needs ${f.chunk.data.length} bytes, ${free} free of ${SMP_CAP}). Nothing was changed.`);
      return;
    }
    const img = buildImage(list);
    await disconnect();
    setStatus(`Sende ${f.name} als S${String(at + 1).padStart(2, "0")} (${list.length} Samples insgesamt)…`);
    const msg = await uploadSamples(img, setStatus);
    sampleList = list;
    renderSamples();
    setStatus(`${msg} · ${f.name} liegt auf S${String(at + 1).padStart(2, "0")}, ${have.length} vorhandene Samples blieben erhalten.`);
  } catch (e) {
    setStatus("Error: " + e.message);
  }
}
// removes sample at position s: uploads the list without it, the others keep their order
async function removeSample(s) {
  try {
    const have = await readSamples();
    if (!have) { setStatus("No FM-1 connected."); return; }
    const c = have[s];
    if (!c) return;
    if (!window.confirm(`Remove sample “${c.name}” (S${String(s + 1).padStart(2, "0")}) from the FM-1? The others stay.`)) return;
    const list = have.filter((_, k) => k !== s);
    const img = buildImage(list);
    await disconnect();
    setStatus(`Entferne ${c.name}…`);
    const msg = await uploadSamples(img, setStatus);
    sampleList = list;
    renderSamples();
    setStatus(`${msg} · ${c.name} removed, ${list.length} samples left.`);
  } catch (e) {
    setStatus("Error: " + e.message);
  }
}

// the file list's send button: append at the end
function sendSample(i) { return insertSample(i, null); }
$("sendBtn").onclick = () => selected !== null && sendSample(selected);

// ---------- device ----------
const screen = new Mirror($("screen"), setMirror);

async function connect() {
  if (link) return;
  if (!navigator.requestMIDIAccess) { setMirror("No WebMIDI in this environment."); return; }
  setMirror("Suche die FM-1…");
  try {
    const access = await navigator.requestMIDIAccess({ sysex: true });
    const found = await new Updater(access).find((id) => !/^ota-/i.test(id.model));
    if (!found) { setMirror("No FM-1 found. Check the USB cable and close other music apps."); return; }
    link = found.link;
    screen.start(link);
    $("snap").disabled = false; $("disc").disabled = false;
    setMirror("Connected to " + found.name + ". Mirror running.");
  } catch (e) {
    setMirror("Error: " + e.message);
  }
}

async function disconnect() {
  if (!link) return;
  screen.stop();
  link.close();
  link = null;
  $("snap").disabled = true; $("disc").disabled = true;
  setMirror("Getrennt.");
}

// read the banks once (playback stops during the read): the mirror pauses so both don't read one queue
async function refreshBanks() {
  if (!link) return;
  await screen.pause();
  try {
    setMirror("Reading banks…");
    const snap = await snapshot(link, setMirror);
    pools = snap.pools;
    objects = snap.objects;
    const used = pools.flat().filter(Boolean).length;
    setMirror(`Banks read (${new Date().toLocaleTimeString("en-GB")}): ${used} of ${POOLS.length * GB_SLOTS} slots used.`);
    renderBanks();
  } catch (e) {
    endSession(link);                       // leave the FM-1's backup mode, or it stays on "Backup reading"
    setMirror("Error reading: " + e.message);
  } finally {
    screen.resume();
  }
}

// banks A..E as the FM-1 shows them: factory presets, read-only; a click shows the preset's parameters
let abe = "A", abeSlot = null;
function renderABE() {
  const tabs = $("abetabs"), box = $("abeslots");
  tabs.innerHTML = ""; box.innerHTML = "";
  for (const k of Object.keys(FACTORY)) {
    const b = document.createElement("button");
    b.textContent = k;
    if (k === abe) b.classList.add("on");
    b.onclick = () => { abe = k; abeSlot = null; renderABE(); renderFactoryParams(); };
    tabs.appendChild(b);
  }
  FACTORY[abe].forEach((s, i) => {
    const d = document.createElement("div");
    d.className = "slot" + (abeSlot === i ? " sel" : "");
    d.innerHTML = `<div class="n">${abe}${i + 1}</div>${s.name}`;
    d.onclick = () => { abeSlot = i; renderABE(); renderFactoryParams(); };
    box.appendChild(d);
  });
}

// the selected preset's parameters: only the values the recipe sets, with their names
function renderFactoryParams() {
  const box = $("params");
  box.innerHTML = "";
  if (abeSlot === null) { box.innerHTML = `<div class="note">Choose a preset (${abe}1–${abe}8).</div>`; return; }
  const s = FACTORY[abe][abeSlot];
  const key = "factory:" + abe + abeSlot;
  if (!edits[key]) {                                    // the recipe's values, everything else 0
    const v = new Array(PNAMES.length).fill(0);
    for (const [name, val] of Object.entries(s.p)) { const i = PNAMES.indexOf(name); if (i >= 0) v[i] = val; }
    edits[key] = v;
  }
  const values = edits[key];
  // the editor in the design's look; every change is kept at once (local, saved on this PC)
  box.className = "editor-host";
  renderEditor(box, values, s.machine, PNAMES, (name, v) => {
    edits[key] = values;
    saveEdits();
    setMirror(`${abe}${abeSlot + 1} · ${s.name}: ${name} = ${v} (saved locally, not written to the FM-1)`);
  });
  return;
  const head = document.createElement("div");
  head.className = "note";
  head.style.gridColumn = "1 / -1";
  head.textContent = `${abe}${abeSlot + 1}: ${s.name} · Engine ${s.machine} · editable locally, not written to the FM-1`;
  box.appendChild(head);
  // The FM1..FM2 slots mean operators in FMSYN, and the filter (and its envelope) in the other engines (params.c aliases).
  const isFM = s.machine === "FMSYN";
  const OPS = ["FM1", "FM2", "FM3", "FM4"], OPNAMES = ["ATK", "DEC", "SUS", "REL", "LEVEL"];
  const FILTER = { FM1_ATK: "CUT", FM1_DEC: "RES", FM1_SUS: "DRV", FM1_REL: "KTR", FM2_ATK: "FE ATK", FM2_DEC: "FE DEC", FM2_SUS: "FE SUS", FM2_LEVEL: "FE AMT", FM2_REL: "FE REL" };
  const GROUPS = [];
  if (isFM) {
    GROUPS.push(["Operatoren", OPS.flatMap((o) => OPNAMES.map((n) => ({ name: o + "_" + n }))).filter((x) => PNAMES.includes(x.name))]);
  } else {
    GROUPS.push(["Filter", Object.keys(FILTER).map((n) => ({ name: n, label: FILTER[n] }))]);
  }
  GROUPS.push(["Envelope", ["ATK", "DEC", "SUS", "REL", "ESYNC"].map((n) => ({ name: n }))]);
  GROUPS.push(["Effects", ["DIST", "CHOR", "DLY", "REV", "SPRD", "IA", "IB", "IC", "IMIX", "ITYPE", "FTYPE"].map((n) => ({ name: n }))]);
  const seen = new Set();
  for (const [title, items] of GROUPS) {
    const h = document.createElement("div");
    h.className = "note";
    h.style.gridColumn = "1 / -1";
    h.style.color = "var(--red)";
    h.textContent = title;
    box.appendChild(h);
    for (const it of items) {
      const i = PNAMES.indexOf(it.name);
      if (i < 0 || seen.has(i)) continue;
      seen.add(i);
      box.appendChild(paramField(it.name, i, values, key, it.label));
    }
  }
  const restEl = document.createElement("div");
  restEl.className = "note";
  restEl.style.gridColumn = "1 / -1";
  restEl.textContent = "Weitere Parameter";
  box.appendChild(restEl);
  PNAMES.forEach((name, i) => { if (!seen.has(i)) box.appendChild(paramField(name, i, values, key)); });
}

// one editable field; the change stays in edits (local)
function paramField(name, i, values, key, label) {
  const l = document.createElement("label");
  l.innerHTML = `<span>${label || PLABEL[name] || name}</span>`;
  const inp = document.createElement("input");
  inp.type = "number"; inp.min = -64; inp.max = 127; inp.value = values[i];
  inp.onchange = () => {
    const v = Math.max(-64, Math.min(127, Number(inp.value) || 0));
    values[i] = v;
    edits[key] = values;
    setMirror(`Changed locally: ${name} = ${v}`);
  };
  l.appendChild(inp);
  return l;
}

function renderBanks() {
  renderABE();
  renderFactoryParams();
  return;   // the sound-pool view (Gruppen-Sounds) is hidden: not needed next to the sample loader
  const tabs = $("pools");
  tabs.innerHTML = "";
  POOLS.forEach((name, i) => {
    const b = document.createElement("button");
    b.textContent = name;
    if (i === pool) b.classList.add("on");
    b.onclick = () => { pool = i; slot = null; renderBanks(); };
    tabs.appendChild(b);
  });
  const box = $("slots");
  box.innerHTML = "";
  for (let s = 0; s < GB_SLOTS; s++) {
    const cell = pools ? pools[pool][s] : null;
    const d = document.createElement("div");
    d.className = "slot" + (cell ? " used" : "") + (slot === s ? " sel" : "");
    d.innerHTML = `<div class="n">${String(s + 1).padStart(2, "0")}</div>${cell ? "gesetzt" : "frei"}`;
    d.onclick = () => { slot = s; renderBanks(); renderParams(); };
    d.ondragover = (e) => { e.preventDefault(); d.classList.add("over"); };
    d.ondragleave = () => d.classList.remove("over");
    d.ondrop = (e) => {
      e.preventDefault(); d.classList.remove("over");
      const f = e.dataTransfer.files[0];
      if (f && /\.vital$/i.test(f.name)) { slot = s; importVital(f, pool, s); }
      else setMirror("Vital presets (.vital) go on a sound slot. Samples belong on S01–S32.");
    };
    box.appendChild(d);
  }
  renderParams();
}

// parameter view for the selected slot; edits stay local
function renderParams() {
  const box = $("params");
  box.innerHTML = "";
  const key = pool + ":" + slot;
  const hasEdit = slot !== null && edits[key];
  if (slot === null || (!hasEdit && (!pools || !pools[pool][slot]))) {
    box.innerHTML = `<div class="note">${slot === null ? "Choose a slot." : "Slot is free. Load a Vital preset here."}</div>`;
    return;
  }
  const values = edits[key] || pools[pool][slot].values;
  PNAMES.forEach((name, j) => {
    const l = document.createElement("label");
    l.innerHTML = `<span>${PLABEL[name] || name}</span>`;
    const inp = document.createElement("input");
    inp.type = "number"; inp.min = -64; inp.max = 127; inp.value = values[j];
    inp.onchange = () => {
      const cur = (edits[key] || pools[pool][slot].values).slice();
      cur[j] = Math.max(-64, Math.min(127, Number(inp.value) || 0));
      edits[key] = cur;
      setMirror("Change only local: " + name + " = " + cur[j] + " (not written to the FM-1).");
    };
    l.appendChild(inp);
    box.appendChild(l);
  });
}

// ---------- Vital preset -> free sound slot ----------
// analyses the file, shows the suggestion in the parameter view, then (after confirmation) backs up the object and writes it
async function importVital(file, pool, slot) {
  let r;
  try {
    r = toFm1(parseVital(await file.text()));
  } catch (e) { setMirror("Vital file: " + e.message); return; }
  edits[pool + ":" + slot] = r.values;
  renderBanks();                                   // shows the slot's new parameters at once
  if (!link) await connect();                      // connect first if needed
  if (!link) { setMirror(`${r.name}: Values are at ${POOLS[pool]} ${slot + 1}, but nothing written: no FM-1 connected.`); return; }
  if (pools && pools[pool][slot]) { setMirror(`Slot ${slot + 1} ist belegt. Einen freien Choose a slot.`); return; }
  const ok = window.confirm(
    `Write “${r.name}” (engine ${r.engine}) to ${POOLS[pool]} slot ${slot + 1}?\n\n` +
    `The sound object is backed up first. Afterwards the FM-1 restarts. The other slots stay unchanged.`);
  if (!ok) { setMirror("Cancelled. Nothing written."); return; }
  try {
    screen.pause();
    await new Promise((res) => setTimeout(res, 250));
    setMirror("Reading the object for the backup…");
    const snap = await snapshot(link, setMirror);
    const obj = snap.objects[pool >> 1];
    // empty object: start from a blank one with the same header the firmware writes
    let bytes = obj.bytes;
    if (!bytes) {
      bytes = new Uint8Array(SOBJ_LEN);
      const dv = new DataView(bytes.buffer);
      dv.setUint32(0, GB_PMAGIC, true);
      dv.setUint16(4, 111, true);
    } else {
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const bak = await window.bridge.backup(`gruppen-sounds_obj${obj.id}_${stamp}.bin`, bytes);
      setMirror("Backup: " + bak);
    }
    const newBytes = withSlot(bytes, pool, slot, slotBytes(r.values, r.engine));
    setMirror("Schreibe…");
    await writeObject(link, obj.id, newBytes, setMirror);
    setMirror(`Geschrieben: „${r.name}“ auf ${POOLS[pool]} Slot ${slot + 1}. Die FM-1 startet neu. Bitte erneut verbinden.`);
  } catch (e) {
    setMirror("Error writing: " + e.message + " The FM-1 is disconnected.");
  } finally {
    // the FM-1 restarts after a write: close the link without overwriting the status text
    if (link) { screen.stop(); link.close(); link = null; }
    $("snap").disabled = true; $("disc").disabled = true;
  }
}


// ---------- Ableton export: reads autosave (9), kits (13, 14), jam (17) and the samples; then the existing converter ----------
const b64 = (u8) => { let s = ""; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000)); return btoa(s); };
// the kit dialog: returns the chosen kit numbers, or null on cancel
function askKits() {
  return new Promise((resolve) => {
    const dlg = $("kitdlg");
    const boxes = [...dlg.querySelectorAll("input[type=checkbox]")];
    boxes.forEach((b) => { b.checked = true; });
    dlg.hidden = false;
    const done = (val) => { dlg.hidden = true; cleanup(); resolve(val); };
    const ok = () => done(boxes.filter((b) => b.checked).map((b) => Number(b.value)));
    const cancel = () => done(null);
    const all = () => boxes.forEach((b) => { b.checked = true; });
    const cleanup = () => { $("kitok").onclick = null; $("kitcancel").onclick = null; $("kitall").onclick = null; };
    $("kitok").onclick = ok;
    $("kitcancel").onclick = cancel;
    $("kitall").onclick = all;
  });
}

async function exportAbleton() {
  try {
    // first the kits, then the folder; cancel stops before anything is read from the FM-1
    const kits = await askKits();
    if (!kits || !kits.length) { setMirror("Export cancelled: no kits selected."); return; }
    const outDir = await window.bridge.pickFolder();
    if (!outDir) { setMirror("Export cancelled: no target folder selected."); return; }
    if (!link) await connect();
    if (!link) { setMirror("No FM-1 connected."); return; }
    await screen.pause();
    const objs = await readObjects(link, [9, 13, 14, 17], setMirror);
    const samples = await readSampleRegion(link, setMirror);
    const doc = { objects: {}, samples: b64(samples) };
    for (const id of Object.keys(objs)) doc.objects[id] = b64(objs[id]);
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const src = await window.bridge.backup(`ableton-quelle_${stamp}.json`, new TextEncoder().encode(JSON.stringify(doc)));
    // one MIDI track per track: its clips of all four scenes, placed by scene position (edits from the clip view included)
    const jam = parseJam(objs[9], objs[17]);
    lastJam = jam;
    const files = trackFiles(jam);
    setMirror("Ableton export läuft (Kits werden gerendert)…");
    const als = await window.bridge.ableton(src, outDir, kits);
    // the same notes as JSON for the .als: one MIDI track per track, each clip at its scene position
    const per = sceneTicks(jam);
    const midi = { scene_beats: per / 480, tracks: [] };
    for (let t = 0; t < 6; t++) {
      const clips = [];
      for (let s = 0; s < 4; s++) {
        const c = clipOf(jam, t, s);
        if (!c.on) continue;
        clips.push({ scene: s, length: c.lengthTicks / 480, notes: clipNotesOf(s, t).map((n) => ({ beat: n.tick / 480, dur: n.dur / 480, note: n.note, vel: n.vel })) });
      }
      if (clips.length) midi.tracks.push({ name: `Track ${t + 1}`, clips });
    }
    const midiBytes = new TextEncoder().encode(JSON.stringify(midi));
    const clipDir = await window.bridge.writeClips(outDir, [...files, { name: "midi-daten.json", bytes: midiBytes }]);
    await window.bridge.addMidi(als, clipDir);
    setMirror(`Ableton export done (kits ${kits.join(", ")}): ${als} · ${midi.tracks.length} MIDI tracks in the project · files in ${clipDir}`);
  } catch (e) {
    setMirror("Error in the Ableton export: " + e.message);
  } finally {
    screen.resume();
  }
}
$("ableton").onclick = exportAbleton;

// ---------- arrangement viewer: the four scenes in export order (read only) ----------
function renderArrangement(j) {
  const box = $("arr");
  box.innerHTML = "";
  box.appendChild(Object.assign(document.createElement("div"), { className: "arr-h", textContent: "" }));
  for (let s = 0; s < 4; s++) {
    const h = Object.assign(document.createElement("div"), { className: "arr-h arr-drag", textContent: `Scene ${s + 1} ⇢`, title: "Drag: scene as MIDI into Ableton" });
    h.draggable = true;
    h.ondragstart = (e) => {
      e.preventDefault();
      if (scenePaths[s]) window.bridge.dragFile(scenePaths[s]);
      else setMirror("Scene not prepared yet. Read the arrangement again.");
    };
    box.appendChild(h);
  }
  j.tracks.forEach((tr, t) => {
    const steps = Object.keys(tr.steps).length;
    box.appendChild(Object.assign(document.createElement("div"), { className: "arr-l", textContent: `T${t + 1} · ${steps} Steps` }));
    for (let s = 0; s < 4; s++) {
      const on = (j.masks[s] >> t) & 1;
      const cell = Object.assign(document.createElement("div"), { className: "arr-c" + (on ? " on" : ""), title: on ? "Double-click: open clip" : "not used" });
      if (on) cell.ondblclick = () => openClip(s, t);
      box.appendChild(cell);
    }
  });
}

// ---------- clips: editable in the app (no write to the FM-1); the edits feed the MIDI export ----------
const clipEdits = {};   // "s:t" -> notes (replaces the read notes of that clip)
const clipNotesOf = (s, t) => clipEdits[s + ":" + t] || clipOf(lastJam, t, s).notes;

// one MIDI file per scene (one MIDI track per track that plays in it), written to a temp folder for the drag out
const scenePaths = [null, null, null, null];
async function prepareScenes() {
  if (!lastJam) return;
  const per = sceneTicks(lastJam);
  for (let s = 0; s < 4; s++) {
    const tracks = [];
    for (let t = 0; t < 6; t++) {
      if (!clipOf(lastJam, t, s).on) continue;
      tracks.push({ notes: clipNotesOf(s, t) });
    }
    if (!tracks.length) { scenePaths[s] = null; continue; }
    const bytes = smfScene(tracks, per, lastJam.G[0]);
    scenePaths[s] = await window.bridge.tempFile(`Scene${s + 1}.mid`, bytes);
  }
}

// per track one MIDI track: all four scenes, each clip shifted to its scene position
function trackFiles(jam) {
  const per = sceneTicks(jam);
  const files = [];
  for (let t = 0; t < 6; t++) {
    const notes = [];
    let any = false;
    for (let s = 0; s < 4; s++) {
      const c = clipOf(jam, t, s);
      if (!c.on) continue;
      any = true;
      for (const n of clipNotesOf(s, t)) notes.push({ ...n, tick: n.tick + s * per });
    }
    if (any) files.push({ name: `Track${t + 1}.mid`, bytes: smf(notes, 4 * per, jam.G[0]) });
  }
  return files;
}

// clip editor (double click): the clip's notes, editable; Übernehmen keeps them for the export
let clipCur = null;
// Piano roll (melodic clips) or drum sequencer (drum clips), on a grid; Übernehmen stores the clip for the export
function openClip(s, t) {
  if (!lastJam) return;
  clipCur = { s, t };
  const c = clipOf(lastJam, t, s);
  $("clipdlg").hidden = false;
  openClipEditor($("clipbody"), {
    notes: clipNotesOf(s, t),
    lengthTicks: c.lengthTicks,
    drum: c.drum,
    title: `Scene ${s + 1} · Track ${t + 1} · ${c.drum ? "Drum-Sequencer" : "Piano Roll"} · ${c.steps} Steps`,
    onSave: async (list) => {
      clipEdits[s + ":" + t] = list;
      $("clipdlg").hidden = true;
      await prepareScenes();
      setMirror(`Clip saved (locally): scene ${s + 1}, track ${t + 1} · ${list.length} notes. Used in the export.`);
    },
    onCancel: () => { $("clipdlg").hidden = true; },
  });
}

async function readArrangement() {
  if (!link) await connect();
  if (!link) { setMirror("No FM-1 connected."); return; }
  await screen.pause();
  try {
    const objs = await readObjects(link, [9, 17], setMirror);
    lastJam = parseJam(objs[9], objs[17]);
    renderArrangement(lastJam);
    await prepareScenes();
    setMirror("Arrangement read. Scenes 1–4 go into the Ableton export this way.");
  } catch (e) {
    setMirror("Error in the arrangement: " + e.message);
  } finally {
    screen.resume();
  }
}
$("arrread").onclick = readArrangement;

$("connect").onclick = connect;
$("snap").onclick = refreshBanks;
$("disc").onclick = disconnect;
$("probe").onclick = async () => {
  if (!navigator.requestMIDIAccess) { setMirror("No WebMIDI in this environment."); return; }
  try {
    const access = await navigator.requestMIDIAccess({ sysex: true });
    const ins = [...access.inputs.values()].map((p) => p.name), outs = [...access.outputs.values()].map((p) => p.name);
    setMirror(`Inputs: ${ins.join(", ") || "none"} · Outputs: ${outs.join(", ") || "none"}`);
  } catch (e) { setMirror("Error: " + e.message); }
};

loadEdits();
setTimeout(() => $("splash").classList.add("gone"), 1400);
renderFiles();
renderBanks();
renderSamples();
