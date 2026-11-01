const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("hadexBrowser", {
  setBounds: (bounds) => ipcRenderer.invoke("browser:set-bounds", bounds),
  navigate: (url) => ipcRenderer.invoke("browser:navigate", url),
  back: () => ipcRenderer.invoke("browser:back"),
  forward: () => ipcRenderer.invoke("browser:forward"),
  reload: () => ipcRenderer.invoke("browser:reload"),
  resetTab: (id) => ipcRenderer.invoke("browser:reset-tab", id),
  newTab: (url) => ipcRenderer.invoke("browser:new-tab", url),
  switchTab: (id) => ipcRenderer.invoke("browser:switch-tab", id),
  closeTab: (id) => ipcRenderer.invoke("browser:close-tab", id),
  onTabs: (callback) => ipcRenderer.on("browser:tabs", (_event, data) => callback(data)),
  onUrl: (callback) => ipcRenderer.on("browser:url", (_event, url) => callback(url)),
  onHistory: (callback) => ipcRenderer.on("browser:history", (_event, state) => callback(state)),
  onError: (callback) => ipcRenderer.on("browser:error", (_event, error) => callback(error)),
  setTheme: (theme) => ipcRenderer.invoke("app:set-theme", theme),
  loginGoogle: () => ipcRenderer.invoke("app:login-google"),
  logoutGoogle: () => ipcRenderer.invoke("app:logout-google"),
  checkLogins: () => ipcRenderer.invoke("app:check-logins"),
  executeNextStep: () => ipcRenderer.invoke("app:execute-next-step"),
  setViewMode: (mode) => ipcRenderer.invoke("app:set-view-mode", mode),
  showAlert: (options) => ipcRenderer.invoke("app:show-alert", options),
  showConfirm: (options) => ipcRenderer.invoke("app:show-confirm", options)
});
