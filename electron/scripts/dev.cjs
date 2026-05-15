const { spawn } = require('child_process');
const http = require('http');
const path = require('path');

const frontendPort = process.env.CREW44_FRONTEND_PORT || '3000';
const rendererUrl = process.env.CREW44_RENDERER_URL || `http://127.0.0.1:${frontendPort}`;
const cwd = path.resolve(__dirname, '..', '..');
const viteBin = path.join(cwd, 'node_modules', '.bin', process.platform === 'win32' ? 'vite.cmd' : 'vite');

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
    const electron = spawnLogged(process.execPath, [path.join(cwd, 'electron', 'scripts', 'run.cjs')], {
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
