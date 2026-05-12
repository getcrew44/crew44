const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const path = require('path');

const isDev = Boolean(process.env.CREWAI_RENDERER_URL);
const appName = 'CrewAI Desktop';
const appIcon = path.join(__dirname, 'assets', 'crewai.icns');
const backendUrl = (
  process.env.CREWAI_BACKEND_URL ||
  process.env.CREWAI_BASE_URL ||
  'http://127.0.0.1:8080'
).replace(/\/$/, '');

let mainWindow;

app.setName(appName);

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 960,
    minHeight: 640,
    title: appName,
    icon: appIcon,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#FAF5E8',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      additionalArguments: isDev ? [] : [`--crewai-backend-url=${backendUrl}`],
    },
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  if (isDev) {
    mainWindow.loadURL(process.env.CREWAI_RENDERER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }
}

ipcMain.handle('dialog:open-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory', 'createDirectory'],
  });
  return {
    canceled: result.canceled,
    filePaths: result.filePaths,
  };
});

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
