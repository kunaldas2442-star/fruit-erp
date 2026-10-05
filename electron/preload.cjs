const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  isElectron: true,
  platform: process.platform,
  getAppInfo: () => ipcRenderer.invoke("get-app-info"),
  openDataFolder: () => ipcRenderer.invoke("open-data-folder"),
  openBackupsFolder: () => ipcRenderer.invoke("open-backups-folder"),
  exportBackupDialog: (defaultFilename) => ipcRenderer.invoke("backup-export-dialog", defaultFilename),
  importBackupDialog: () => ipcRenderer.invoke("backup-import-dialog"),
  printPage: () => ipcRenderer.invoke("print-current-page"),
});
