const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("hadexModal", {
  onInit: (callback) => ipcRenderer.on("modal:init", (_event, data) => callback(data)),
  onTheme: (callback) => ipcRenderer.on("modal:theme", (_event, theme) => callback(theme)),
  respond: (result) => ipcRenderer.send("modal:response", !!result),
  resize: (size) => ipcRenderer.send("modal:resize", size)
});
