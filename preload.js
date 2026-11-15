// Bridge between the page and the main process (ffmpeg). Only these three calls are exposed.
const { contextBridge, ipcRenderer, webUtils } = require("electron");

contextBridge.exposeInMainWorld("bridge", {
  pathOf: (file) => webUtils.getPathForFile(file),
  decode: (path) => ipcRenderer.invoke("ff:decode", path),   // -> Float32 mono 44100 Hz bytes
  opus: (path, out) => ipcRenderer.invoke("ff:opus", path, out),
  backup: (name, bytes) => ipcRenderer.invoke("fs:backup", name, bytes),   // -> path of the saved backup file
  ableton: (src, outDir, kits) => ipcRenderer.invoke("ex:ableton", src, outDir, kits),  // -> path of the .als
  pickFolder: () => ipcRenderer.invoke("dlg:folder"),                       // -> chosen folder or null
  writeClips: (outDir, files) => ipcRenderer.invoke("ex:clips", outDir, files),   // -> the Clips folder
  addMidi: (alsPath, clipDir) => ipcRenderer.invoke("ex:addmidi", alsPath, clipDir), // -> the .als with the MIDI tracks
  tempFile: (name, bytes) => ipcRenderer.invoke("fs:temp", name, bytes),          // -> path of a temp file
  dragFile: (file) => ipcRenderer.send("drag:start", file),                      // native drag out of the app
});
