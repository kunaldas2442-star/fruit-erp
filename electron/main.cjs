let electronModule;
try {
  electronModule = require("electron");
} catch {
  // If electron is not installed or unavailable
}

if (!electronModule || typeof electronModule !== "object" || !electronModule.app || typeof electronModule.app.getPath !== "function") {
  console.error("[Klyia FreshERP Desktop Guard]");
  console.error("  electron/main.cjs was invoked directly in a standard Node.js server environment.");
  console.error("  This file is strictly for Electron desktop runtime.");
  console.error("  For Hostinger and Web production, start 'dist/server.cjs' (or run 'npm start').");
  process.exit(1);
}

const { app, BrowserWindow, shell, ipcMain, dialog, Menu } = electronModule;
const path = require("path");
const fs = require("fs");
const http = require("http");
const net = require("net");

// Determine persistent Windows AppData location
const userDataPath = path.join(app.getPath("userData"), "KlyiaFreshERP_Data");
const uploadsPath = path.join(userDataPath, "uploads");
const backupsPath = path.join(userDataPath, "backups");

try {
  if (!fs.existsSync(userDataPath)) fs.mkdirSync(userDataPath, { recursive: true });
  if (!fs.existsSync(uploadsPath)) fs.mkdirSync(uploadsPath, { recursive: true });
  if (!fs.existsSync(backupsPath)) fs.mkdirSync(backupsPath, { recursive: true });
} catch (err) {
  console.error("[FreshERP Desktop] Directory setup error:", err);
}

// Pass persistent directory to backend process
process.env.FRESH_ERP_DATA_DIR = userDataPath;
process.env.APPDATA_PERSISTENT = "true";
process.env.FRESH_ERP_DESKTOP = "true";

let mainWindow = null;
const DEFAULT_PORT = 3000;
let activePort = DEFAULT_PORT;
let serverInstance = null;

// Check if a specific TCP port is free on 127.0.0.1
function checkPortAvailable(port, host = "127.0.0.1") {
  return new Promise((resolve) => {
    const tester = net.createServer();
    tester.once("error", () => resolve(false));
    tester.once("listening", () => {
      tester.close(() => resolve(true));
    });
    tester.listen(port, host);
  });
}

// Automatically detect available port if 3000 is occupied
async function findAvailablePort(preferredPort = 3000) {
  if (await checkPortAvailable(preferredPort)) {
    return preferredPort;
  }
  for (let p = preferredPort + 1; p <= preferredPort + 30; p++) {
    if (await checkPortAvailable(p)) {
      console.log(`[FreshERP Desktop] Port ${preferredPort} busy, using fallback port ${p}`);
      return p;
    }
  }
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.listen(0, "127.0.0.1", () => {
      const p = s.address().port;
      s.close(() => resolve(p));
    });
    s.on("error", reject);
  });
}

// Locate sql-wasm.wasm across dev, production, unpacked, and resources folders
function findSqlWasmPath() {
  const candidates = [
    path.join(app.getAppPath(), "dist", "sql-wasm.wasm"),
    path.join(process.resourcesPath, "dist", "sql-wasm.wasm"),
    path.join(process.resourcesPath, "sql-wasm.wasm"),
    path.join(process.resourcesPath, "app.asar.unpacked", "dist", "sql-wasm.wasm"),
    path.join(__dirname, "..", "dist", "sql-wasm.wasm"),
    path.join(__dirname, "dist", "sql-wasm.wasm"),
    path.join(process.cwd(), "dist", "sql-wasm.wasm"),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) {
      return c;
    }
  }
  return null;
}

// Locate server.cjs across packaged and dev locations
function findServerModulePath() {
  const candidates = [
    path.join(app.getAppPath(), "dist", "server.cjs"),
    path.join(__dirname, "..", "dist", "server.cjs"),
    path.join(__dirname, "dist", "server.cjs"),
    path.join(process.resourcesPath, "app.asar", "dist", "server.cjs"),
    path.join(process.resourcesPath, "app", "dist", "server.cjs"),
    path.join(process.resourcesPath, "dist", "server.cjs"),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) {
      return c;
    }
  }
  return null;
}

// Function to check if local server is responsive
function checkServerReady(port, retries = 60, delayMs = 300) {
  return new Promise((resolve, reject) => {
    let attempts = 0;

    const tryConnect = () => {
      attempts++;
      const req = http.get(`http://127.0.0.1:${port}/api/health`, (res) => {
        if (res.statusCode === 200) {
          return resolve(true);
        }
        if (attempts >= retries) {
          return reject(new Error("Server responded with non-200 status"));
        }
        setTimeout(tryConnect, delayMs);
      });

      req.on("error", () => {
        if (attempts >= retries) {
          return reject(new Error("Server failed to respond within timeout"));
        }
        setTimeout(tryConnect, delayMs);
      });

      req.setTimeout(1000, () => {
        req.destroy();
      });
    };

    tryConnect();
  });
}

// Start backend Express server inside Electron
function startBackendServer() {
  try {
    const wasmPath = findSqlWasmPath();
    if (wasmPath) {
      process.env.SQL_WASM_PATH = wasmPath;
      console.log(`[FreshERP Desktop] Located SQLite WASM at: ${wasmPath}`);
    }

    const serverModulePath = findServerModulePath();

    if (serverModulePath) {
      console.log(`[FreshERP Desktop] Booting local backend from: ${serverModulePath}`);
      serverInstance = require(serverModulePath);
    } else {
      console.log("[FreshERP Desktop] Server module path not found directly, using dev server connection");
    }
  } catch (err) {
    console.error("[FreshERP Desktop] Error launching embedded server:", err);
  }
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1366,
    height: 850,
    minWidth: 1024,
    minHeight: 700,
    title: "Klyia FreshERP - Wholesale Management System",
    backgroundColor: "#f8fafc",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
    },
    show: false, // Show only when fully loaded to prevent white screen
  });

  // Native application menu
  const menuTemplate = [
    {
      label: "File",
      submenu: [
        {
          label: "Open Data Folder",
          click: () => {
            shell.openPath(userDataPath);
          },
        },
        { type: "separator" },
        {
          label: "Print Invoice / Report",
          accelerator: "CmdOrCtrl+P",
          click: () => {
            if (mainWindow) mainWindow.webContents.print();
          },
        },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    {
      label: "Database",
      submenu: [
        {
          label: "Show SQLite Database File",
          click: () => {
            const dbFile = path.join(userDataPath, "fresherp.db");
            if (fs.existsSync(dbFile)) {
              shell.showItemInFolder(dbFile);
            } else {
              shell.openPath(userDataPath);
            }
          },
        },
        {
          label: "Open Backups Folder",
          click: () => {
            shell.openPath(backupsPath);
          },
        },
      ],
    },
    {
      label: "Help",
      submenu: [
        {
          label: "About FreshERP",
          click: () => {
            dialog.showMessageBox(mainWindow, {
              type: "info",
              title: "About Klyia FreshERP",
              message: "Klyia FreshERP v2.4",
              detail: `Offline Wholesale Fruit Trading & Digital Khata Management System.\n\nData Location:\n${userDataPath}\n\nLocal Database: SQLite 3\nHost: 127.0.0.1\nPort: ${activePort}`,
              buttons: ["OK"],
            });
          },
        },
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(menuTemplate);
  Menu.setApplicationMenu(menu);

  // Load URL once backend is healthy
  const targetUrl = `http://127.0.0.1:${activePort}`;
  console.log(`[FreshERP Desktop] Loading interface from ${targetUrl}...`);

  mainWindow.loadURL(targetUrl);

  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
    mainWindow.focus();
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    // External links open in default web browser
    if (url.startsWith("http:") || url.startsWith("https:")) {
      shell.openExternal(url);
      return { action: "deny" };
    }
    return { action: "allow" };
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

// Register IPC handlers for desktop capabilities
ipcMain.handle("get-app-info", () => {
  return {
    version: app.getVersion() || "2.4.0",
    platform: process.platform,
    userDataDir: userDataPath,
    backupsDir: backupsPath,
    uploadsDir: uploadsPath,
    port: activePort,
  };
});

ipcMain.handle("open-data-folder", async () => {
  await shell.openPath(userDataPath);
  return true;
});

ipcMain.handle("open-backups-folder", async () => {
  await shell.openPath(backupsPath);
  return true;
});

ipcMain.handle("backup-export-dialog", async (_event, defaultFilename) => {
  if (!mainWindow) return null;
  const result = await dialog.showSaveDialog(mainWindow, {
    title: "Export FreshERP Database Backup",
    defaultPath: path.join(app.getPath("downloads"), defaultFilename || "fresherp_backup.db"),
    filters: [
      { name: "SQLite Database", extensions: ["db", "sqlite"] },
      { name: "All Files", extensions: ["*"] },
    ],
  });
  return result.filePath || null;
});

ipcMain.handle("backup-import-dialog", async () => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Select FreshERP Backup to Restore",
    filters: [
      { name: "FreshERP Backups", extensions: ["db", "json"] },
      { name: "All Files", extensions: ["*"] },
    ],
    properties: ["openFile"],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

ipcMain.handle("print-current-page", async () => {
  if (!mainWindow) return false;
  mainWindow.webContents.print({ silent: false, printBackground: true });
  return true;
});

let isShuttingDown = false;
function performGracefulShutdown() {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log("[FreshERP Desktop] Performing graceful shutdown and flushing SQLite database to disk...");
  try {
    if (serverInstance && typeof serverInstance.flushToDisk === "function") {
      serverInstance.flushToDisk();
    }
  } catch (e) {
    console.error("[FreshERP Desktop] Error in serverInstance.flushToDisk:", e);
  }

  try {
    const req = http.request({
      hostname: "127.0.0.1",
      port: activePort,
      path: "/api/system/flush",
      method: "POST",
      timeout: 1000,
    });
    req.on("error", () => {});
    req.end();
  } catch {}
}

// App Lifecycle
app.whenReady().then(async () => {
  try {
    activePort = await findAvailablePort(DEFAULT_PORT);
    process.env.PORT = String(activePort);
    process.env.HOST = "127.0.0.1";
    console.log(`[FreshERP Desktop] Initializing on host 127.0.0.1:${activePort}...`);
  } catch (err) {
    console.error("[FreshERP Desktop] Port allocation error:", err);
    activePort = DEFAULT_PORT;
  }

  startBackendServer();

  try {
    // Wait until local server is responsive
    await checkServerReady(activePort, 60, 250);
  } catch (err) {
    console.error("[FreshERP Desktop] Health probe timeout:", err);
    dialog.showErrorBox(
      "Startup Failed - Klyia FreshERP",
      "Klyia FreshERP could not start its local database/server.\n\nPlease restart the application.\n\nYour existing data has not been deleted."
    );
    app.quit();
    return;
  }

  createMainWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on("before-quit", () => {
  performGracefulShutdown();
});

app.on("window-all-closed", () => {
  performGracefulShutdown();
  if (process.platform !== "darwin") {
    app.quit();
  }
});
