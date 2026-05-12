const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');
const { spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const net = require('net');
const path = require('path');

const isDev = Boolean(process.env.CREWAI_RENDERER_URL);
const appName = 'CrewAI Desktop';
const appIcon = path.join(__dirname, 'assets', 'crewai.icns');
const bundledDaemon = path.join(__dirname, '..', 'bin', process.platform === 'win32' ? 'crewai-daemon.exe' : 'crewai-daemon');
const configuredBackendUrl = (process.env.CREWAI_BACKEND_URL || process.env.CREWAI_BASE_URL || '').replace(/\/$/, '');
const configuredAuthToken = process.env.AUTH_TOKEN || process.env.CREWAI_AUTH_TOKEN || process.env.CREWAI_API_TOKEN || '';
const preferredPort = Number(process.env.CREWAI_DAEMON_PORT || process.env.PORT || 18766);

let mainWindow;
let daemonProcess;
let backendUrl = configuredBackendUrl;
let authToken = configuredAuthToken;

app.setName(appName);

function makeAuthToken() {
  return crypto.randomBytes(32).toString('base64url');
}

function tryListen(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.listen(port, '127.0.0.1', () => {
      server.close(() => resolve(true));
    });
  });
}

function findOpenPort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
}

async function choosePort() {
  if (Number.isInteger(preferredPort) && preferredPort > 0 && await tryListen(preferredPort)) {
    return preferredPort;
  }

  const port = await findOpenPort();
  console.log(`[crewai] preferred daemon port ${preferredPort || '(invalid)'} is unavailable; using ${port}`);
  return port;
}

function waitForHealth(url, retries = 80) {
  return new Promise((resolve, reject) => {
    const healthUrl = `${url}/health`;

    const attempt = () => {
      const req = http.get(healthUrl, res => {
        res.resume();
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve();
          return;
        }
        retry(new Error(`health returned ${res.statusCode}`));
      });

      req.on('error', retry);
      req.setTimeout(1000, () => req.destroy(new Error('health timeout')));
    };

    const retry = err => {
      if (retries <= 0) {
        reject(err);
        return;
      }
      retries -= 1;
      setTimeout(attempt, 250);
    };

    attempt();
  });
}

async function ensureBackend() {
  if (backendUrl) {
    await waitForHealth(backendUrl);
    return;
  }

  if (!fs.existsSync(bundledDaemon)) {
    backendUrl = 'http://127.0.0.1:8080';
    authToken = configuredAuthToken;
    console.log(`[crewai] bundled daemon missing at ${bundledDaemon}; using ${backendUrl}`);
    await waitForHealth(backendUrl);
    return;
  }

  const port = await choosePort();
  backendUrl = `http://127.0.0.1:${port}`;
  authToken = configuredAuthToken || makeAuthToken();

  daemonProcess = spawn(bundledDaemon, [], {
    env: {
      ...process.env,
      HOST: '127.0.0.1',
      PORT: String(port),
      AUTH_TOKEN: authToken,
    },
    stdio: ['ignore', 'ignore', 'pipe'],
  });

  daemonProcess.stderr.on('data', chunk => {
    console.error(`[crewai-daemon] ${String(chunk).trimEnd()}`);
  });

  daemonProcess.on('exit', (code, signal) => {
    if (code !== 0 && signal !== 'SIGTERM') {
      console.error(`[crewai] daemon exited code=${code} signal=${signal}`);
    }
    daemonProcess = null;
  });

  console.log(`[crewai] daemon starting at ${backendUrl}`);
  await waitForHealth(backendUrl);
  console.log(`[crewai] daemon ready at ${backendUrl}`);
}

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

ipcMain.handle('backend:get-config', async () => ({
  url: isDev && configuredBackendUrl ? configuredBackendUrl : backendUrl,
  token: authToken,
}));

ipcMain.handle('dialog:open-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory', 'createDirectory'],
  });
  return {
    canceled: result.canceled,
    filePaths: result.filePaths,
  };
});

ipcMain.handle('shell:show-in-folder', async (_event, folderPath) => {
  if (!folderPath || typeof folderPath !== 'string') return false;
  await shell.openPath(folderPath);
  return true;
});

app.whenReady().then(async () => {
  await ensureBackend();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('before-quit', () => {
  if (daemonProcess && !daemonProcess.killed) {
    daemonProcess.kill();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
