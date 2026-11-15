// Electron shell. Serves the renderer and web/ modules over localhost, because ES modules don't load from file://.
const { app, BrowserWindow, session, ipcMain, dialog, nativeImage } = require("electron");
const os = require("os");

// the drag icon (a 1 x 1 PNG; the file name is what the target shows)
const DRAG_ICON = nativeImage.createFromDataURL("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=");

// scene MIDI files are written to a temp folder, so they can be dragged out of the app
ipcMain.handle("fs:temp", async (_e, name, bytes) => {
  const dir = path.join(os.tmpdir(), "Trapstation");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, path.basename(name));
  fs.writeFileSync(file, Buffer.from(bytes));
  return file;
});

// starts a native drag of a file (Ableton accepts it as MIDI)
ipcMain.on("drag:start", (e, file) => {
  e.sender.startDrag({ file, icon: DRAG_ICON });
});
const http = require("http");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const ROOT = __dirname;
// data the user creates (backups, Opus archive) goes to the user folder: the installed program folder is read-only
const dataDir = () => (app.isPackaged ? app.getPath("userData") : ROOT);
const archiveDir = () => path.join(dataDir(), "Opus-Archiv");

// runs ffmpeg; resolves with stdout (or rejects with its error text)
function ffmpeg(args, wantOutput) {
  return new Promise((resolve, reject) => {
    const p = spawn("ffmpeg", ["-v", "error", ...args]);
    const out = [];
    let err = "";
    if (wantOutput) p.stdout.on("data", (c) => out.push(c));
    p.stderr.on("data", (c) => { err += c; });
    p.on("error", (e) => reject(new Error("ffmpeg not found: " + e.message)));
    p.on("close", (code) => (code === 0 ? resolve(Buffer.concat(out)) : reject(new Error(err.trim() || "ffmpeg error " + code))));
  });
}

ipcMain.handle("ff:decode", async (_e, input) => {
  // any audio file -> raw Float32, mono, 44100 Hz
  const buf = await ffmpeg(["-i", input, "-f", "f32le", "-ac", "1", "-ar", "44100", "pipe:1"], true);
  return new Uint8Array(buf);
});

// Ableton export: the existing kit converter (kit_to_wav.py: scene WAVs) and als_builder.build (the .als)
// the Ableton export tools (kit_to_wav.py, als_builder.py, template.als): set TRAP_ABLETON_DIR, or keep them in ./ableton
const abletonDir = () => process.env.TRAP_ABLETON_DIR || (app.isPackaged ? path.join(process.resourcesPath, "ableton") : path.join(ROOT, "ableton"));
function run(cmd, args, cwd) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { cwd });
    let out = "", err = "";
    p.stdout.on("data", (c) => { out += c; });
    p.stderr.on("data", (c) => { err += c; });
    p.on("error", (e) => reject(new Error(cmd + " not found: " + e.message)));
    p.on("close", (code) => (code === 0 ? resolve(out) : reject(new Error((out + err).trim().slice(-400) || cmd + " error " + code))));
  });
}
// the user picks the target folder (no fixed export path)
ipcMain.handle("dlg:folder", async (e) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  const r = await dialog.showOpenDialog(win, { title: "Zielordner fÃ¼r den Ableton export", properties: ["openDirectory", "createDirectory"] });
  return r.canceled || !r.filePaths[0] ? null : r.filePaths[0];
});

// clip MIDI files into <outDir>\Clips (the file names come from the app; nothing else is written)
ipcMain.handle("ex:clips", async (_e, outDir, files) => {
  const dir = path.join(outDir, "Clips");
  fs.mkdirSync(dir, { recursive: true });
  for (const f of files) fs.writeFileSync(path.join(dir, path.basename(f.name)), Buffer.from(f.bytes));
  return dir;
});

// puts the MIDI tracks (one per track, clips at their scene positions) into the built .als
ipcMain.handle("ex:addmidi", async (_e, alsPath, clipDir) => {
  const data = path.join(clipDir, "midi-daten.json");
  await run("python", ["-c", "import sys, als_builder as a; a.add_midi(sys.argv[1], sys.argv[2])", alsPath, data], abletonDir());
  return alsPath;
});

ipcMain.handle("ex:ableton", async (_e, src, outDir, kits) => {
  // kits: the chosen kit numbers, e.g. [1, 3]
  const csv = kits.join(",");
  fs.mkdirSync(outDir, { recursive: true });
  await run("python", ["kit_to_wav.py", src, outDir, csv], abletonDir());
  const als = path.join(outDir, "Trapstation-Kits.als");
  await run("python", ["-c", "import sys, als_builder as a; a.build(sys.argv[1], sys.argv[2], [int(x) for x in sys.argv[3].split(',')])", outDir, als, csv], abletonDir());
  return als;
});

// backups before any write to the FM-1: saved next to the project, never overwritten
ipcMain.handle("fs:backup", async (_e, name, data) => {
  const dir = path.join(dataDir(), "Sicherungen");
  fs.mkdirSync(dir, { recursive: true });
  let file = path.join(dir, name), k = 1;
  while (fs.existsSync(file)) file = path.join(dir, name.replace(/\.bin$/, `_${k++}.bin`));
  fs.writeFileSync(file, Buffer.from(data));
  return file;
});

ipcMain.handle("ff:opus", async (_e, input, name) => {
  // background archive copy: Opus, 96 kbit/s, only kept on this PC (not used for the SYX)
  fs.mkdirSync(archiveDir(), { recursive: true });
  const out = path.join(archiveDir(), name + ".opus");
  await ffmpeg(["-y", "-i", input, "-c:a", "libopus", "-b:a", "96k", out], false);
  return out;
});
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".syx": "application/octet-stream" };

function serve() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      const url = decodeURIComponent(req.url.split("?")[0]);
      const rel = url === "/" ? "renderer/index.html" : url.slice(1);
      const file = path.normalize(path.join(ROOT, rel));
      if (!file.startsWith(ROOT)) { res.writeHead(403).end(); return; }
      fs.readFile(file, (err, buf) => {
        if (err) { res.writeHead(404).end(); return; }
        res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream" });
        res.end(buf);
      });
    });
    srv.listen(0, "127.0.0.1", () => resolve(srv));
  });
}

app.whenReady().then(async () => {
  // allow WebMIDI with SysEx for this app only
  session.defaultSession.setPermissionRequestHandler((wc, perm, cb) => cb(perm === "midi" || perm === "midiSysex"));
  session.defaultSession.setPermissionCheckHandler((wc, perm) => perm === "midi" || perm === "midiSysex");
  const srv = await serve();
  const win = new BrowserWindow({
    width: 1280, height: 800, title: "Trap Station", backgroundColor: "#000",
    icon: path.join(ROOT, "renderer", "assets", "trapstation.ico"),
    webPreferences: { preload: path.join(ROOT, "preload.js"), contextIsolation: true },
  });
  win.loadURL(`http://127.0.0.1:${srv.address().port}/`);
  app.on("window-all-closed", () => { srv.close(); app.quit(); });
});
