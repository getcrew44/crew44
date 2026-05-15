const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');
const { execFileSync, spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const net = require('net');
const os = require('os');
const path = require('path');

const isDev = Boolean(process.env.CREW44_RENDERER_URL);
const appName = 'Crew44';
const appIcon = path.join(__dirname, 'assets', 'crew44.icns');
const bundledDaemon = path.join(__dirname, '..', 'bin', process.platform === 'win32' ? 'crew44-daemon.exe' : 'crew44-daemon');
const configuredBackendUrl = (process.env.CREW44_BACKEND_URL || process.env.CREW44_BASE_URL || '').replace(/\/$/, '');
const configuredRpcUrl = process.env.CREW44_RPC_URL || '';
const configuredAuthToken = process.env.AUTH_TOKEN || process.env.CREW44_AUTH_TOKEN || process.env.CREW44_API_TOKEN || '';
const preferredPort = Number(process.env.CREW44_DAEMON_PORT || process.env.PORT || 18766);
const cliPathEntries = [
  '/opt/homebrew/bin',
  '/opt/homebrew/sbin',
  '/usr/local/bin',
  '/usr/local/sbin',
  path.join(os.homedir(), '.local/bin'),
  path.join(os.homedir(), 'bin'),
  '/usr/bin',
  '/bin',
  '/usr/sbin',
  '/sbin',
];

let mainWindow;
let daemonProcess;
let backendUrl = configuredBackendUrl;
let rpcUrl = configuredRpcUrl;
let authToken = configuredAuthToken;

app.setName(appName);

repairProcessPath();

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
  console.log(`[crew44] preferred daemon port ${preferredPort || '(invalid)'} is unavailable; using ${port}`);
  return port;
}

function withDaemonEnv(overrides) {
  const env = { ...process.env, ...overrides };
  if (process.platform === 'win32') return env;

  const entries = [
    ...(env.PATH || '').split(path.delimiter),
    ...cliPathEntries,
  ].filter(Boolean);
  env.PATH = [...new Set(entries)].join(path.delimiter);
  return env;
}

function repairProcessPath() {
  if (process.platform === 'win32') return;

  const shellPath = process.env.SHELL || '/bin/zsh';
  const marker = '__CREW44_LOGIN_SHELL_PATH__';
  let loginShellPath = '';

  try {
    const output = execFileSync(shellPath, ['-ilc', `printf '${marker}%s' "$PATH"`], {
      encoding: 'utf8',
      timeout: 3000,
      env: process.env,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const markerIndex = output.lastIndexOf(marker);
    if (markerIndex >= 0) {
      loginShellPath = output.slice(markerIndex + marker.length).trim();
    }
  } catch (err) {
    console.warn(`[crew44] could not recover login shell PATH via ${shellPath}: ${err.message}`);
  }

  const entries = [
    ...loginShellPath.split(path.delimiter),
    ...(process.env.PATH || '').split(path.delimiter),
    ...cliPathEntries,
  ].filter(Boolean);
  process.env.PATH = [...new Set(entries)].join(path.delimiter);
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

function rpcUrlForBackend(url) {
  const parsed = new URL(url);
  parsed.protocol = parsed.protocol === 'https:' ? 'wss:' : 'ws:';
  parsed.pathname = '/rpc';
  parsed.search = '';
  parsed.hash = '';
  return parsed.toString();
}

async function ensureBackend() {
  if (backendUrl) {
    rpcUrl = rpcUrl || rpcUrlForBackend(backendUrl);
    await waitForHealth(backendUrl);
    return;
  }

  if (!fs.existsSync(bundledDaemon)) {
    backendUrl = 'http://127.0.0.1:8080';
    rpcUrl = configuredRpcUrl || rpcUrlForBackend(backendUrl);
    authToken = configuredAuthToken;
    console.log(`[crew44] bundled daemon missing at ${bundledDaemon}; using ${backendUrl}`);
    await waitForHealth(backendUrl);
    return;
  }

  const port = await choosePort();
  backendUrl = `http://127.0.0.1:${port}`;
  rpcUrl = configuredRpcUrl || rpcUrlForBackend(backendUrl);
  authToken = configuredAuthToken || makeAuthToken();

  daemonProcess = spawn(bundledDaemon, [], {
    env: withDaemonEnv({
      HOST: '127.0.0.1',
      PORT: String(port),
      AUTH_TOKEN: authToken,
    }),
    stdio: ['ignore', 'ignore', 'pipe'],
  });

  daemonProcess.stderr.on('data', chunk => {
    console.error(`[crew44-daemon] ${String(chunk).trimEnd()}`);
  });

  daemonProcess.on('exit', (code, signal) => {
    if (code !== 0 && signal !== 'SIGTERM') {
      console.error(`[crew44] daemon exited code=${code} signal=${signal}`);
    }
    daemonProcess = null;
  });

  console.log(`[crew44] daemon starting at ${backendUrl}`);
  await waitForHealth(backendUrl);
  console.log(`[crew44] daemon ready at ${backendUrl}`);
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
    mainWindow.loadURL(process.env.CREW44_RENDERER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }
}

function sanitizeProjectFolderName(name) {
  const cleaned = String(name || '')
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/[. ]+$/g, '');
  return cleaned || 'Untitled Project';
}

async function uniqueProjectFolderPath(baseDir, name) {
  const first = path.join(baseDir, name);
  if (!fs.existsSync(first)) return first;

  for (let i = 2; i < 1000; i += 1) {
    const candidate = path.join(baseDir, `${name}-${i}`);
    if (!fs.existsSync(candidate)) return candidate;
  }
  throw new Error('Could not allocate a unique project folder name');
}

ipcMain.handle('backend:get-config', async () => ({
  url: isDev && configuredBackendUrl ? configuredBackendUrl : backendUrl,
  healthUrl: `${isDev && configuredBackendUrl ? configuredBackendUrl : backendUrl}/health`,
  rpcUrl: isDev && configuredRpcUrl ? configuredRpcUrl : rpcUrl,
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

ipcMain.handle('dialog:open-files', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile', 'multiSelections'],
  });
  return {
    canceled: result.canceled,
    filePaths: result.filePaths,
  };
});

ipcMain.handle('project:create-blank-folder', async (_event, name) => {
  const documentsDir = app.getPath('documents');
  const crew44Dir = path.join(documentsDir, 'Crew44');
  const folderName = sanitizeProjectFolderName(name);
  const projectDir = await uniqueProjectFolderPath(crew44Dir, folderName);
  await fs.promises.mkdir(projectDir, { recursive: true });
  return { path: projectDir };
});

ipcMain.handle('shell:show-in-folder', async (_event, folderPath) => {
  if (!folderPath || typeof folderPath !== 'string') return false;
  await shell.openPath(folderPath);
  return true;
});

ipcMain.handle('system:computer-name', async () => {
  if (process.platform === 'darwin') {
    try {
      const name = execFileSync('/usr/sbin/scutil', ['--get', 'ComputerName'], {
        encoding: 'utf8',
        timeout: 1000,
      }).trim();
      if (name) return name;
    } catch {}
  }
  return os.hostname().replace(/\.local$/, '');
});

ipcMain.handle('files:read-data-url', async (_event, filePath) => {
  if (!filePath || typeof filePath !== 'string') return '';
  const data = await fs.promises.readFile(filePath);
  const ext = path.extname(filePath).slice(1).toLowerCase();
  const mimeByExt = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    gif: 'image/gif',
    webp: 'image/webp',
    bmp: 'image/bmp',
    svg: 'image/svg+xml',
  };
  const mime = mimeByExt[ext] || 'application/octet-stream';
  return `data:${mime};base64,${data.toString('base64')}`;
});

ipcMain.handle('paths:info', async (_event, paths) => {
  const list = Array.isArray(paths) ? paths : [];
  return Promise.all(list.map(async (filePath) => {
    if (!filePath || typeof filePath !== 'string') {
      return { path: '', name: '', isDirectory: false };
    }

    try {
      const stat = await fs.promises.stat(filePath);
      return {
        path: filePath,
        name: path.basename(filePath),
        isDirectory: stat.isDirectory(),
      };
    } catch {
      return { path: filePath, name: path.basename(filePath), isDirectory: false };
    }
  }));
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
