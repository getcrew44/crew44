const { spawn } = require('child_process');
const http = require('http');
const path = require('path');

const frontendPort = process.env.CREW44_FRONTEND_PORT || '3000';
const rendererUrl = process.env.CREW44_RENDERER_URL || `http://127.0.0.1:${frontendPort}`;
const cwd = path.resolve(__dirname, '..', '..');
const viteBin = path.join(cwd, 'node_modules', '.bin', process.platform === 'win32' ? 'vite.cmd' : 'vite');

function resolveElectronBin() {
  try {
    return require('electron');
  } catch (err) {
    console.error(
      'Electron binary not found at node_modules/electron/dist/.\n' +
      'The Electron npm package is installed, but its binary download did not finish.\n' +
      'Fix with:\n' +
      '  npm exec install-electron --no\n' +
      'If downloads are slow or blocked, copy .npmrc.example to .npmrc and run the install command again.\n' +
      `Original error: ${err.message}`
    );
    process.exit(1);
  }
}
const electronBin = resolveElectronBin();

function waitFor(url, retries = 80) {
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const req = http.get(url, res => {
        res.resume();
        resolve();
      });
      req.on('error', err => {
        if (retries <= 0) {
          reject(err);
          return;
        }
        retries -= 1;
        setTimeout(attempt, 250);
      });
      req.setTimeout(1000, () => req.destroy(new Error('timeout')));
    };
    attempt();
  });
}

function spawnLogged(command, args, env = {}) {
  return spawn(command, args, {
    cwd,
    env: { ...process.env, ...env },
    stdio: 'inherit',
  });
}

async function main() {
  const vite = spawnLogged(viteBin, ['--host', '127.0.0.1', '--port', frontendPort]);

  const cleanup = () => {
    if (!vite.killed) vite.kill();
  };

  process.on('SIGINT', () => {
    cleanup();
    process.exit(130);
  });
  process.on('SIGTERM', () => {
    cleanup();
    process.exit(143);
  });

  try {
    await waitFor(rendererUrl);
    const electron = spawnLogged(electronBin, [path.join(cwd, 'electron', 'main.cjs')], {
      CREW44_RENDERER_URL: rendererUrl,
    });
    electron.on('exit', code => {
      cleanup();
      process.exit(code ?? 0);
    });
  } catch (err) {
    cleanup();
    console.error(`Failed to start Electron dev app: ${err.message}`);
    process.exit(1);
  }
}

main();
