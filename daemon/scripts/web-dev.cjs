const { spawn } = require('child_process');
const http = require('http');
const path = require('path');

const root = path.resolve(__dirname, '..', '..');
const daemonDir = path.join(root, 'daemon');
const frontendPort = process.env.CREWAI_FRONTEND_PORT || '3000';
const backendUrl = process.env.CREWAI_BACKEND_URL || process.env.CREWAI_BASE_URL || 'http://127.0.0.1:8080';
const viteBin = path.join(root, 'node_modules', '.bin', process.platform === 'win32' ? 'vite.cmd' : 'vite');

function spawnLogged(command, args, options = {}) {
  return spawn(command, args, {
    cwd: root,
    env: process.env,
    stdio: 'inherit',
    ...options,
  });
}

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

async function main() {
  const daemon = spawnLogged('go', ['run', './cmd/crewai-daemon'], { cwd: daemonDir });

  const cleanup = () => {
    if (!daemon.killed) daemon.kill();
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
    await waitFor(`${backendUrl}/health`);
    const vite = spawnLogged(viteBin, ['--host', '127.0.0.1', '--port', frontendPort], {
      env: { ...process.env, CREWAI_BACKEND_URL: backendUrl },
    });
    vite.on('exit', code => {
      cleanup();
      process.exit(code ?? 0);
    });
    daemon.on('exit', code => {
      process.exit(code ?? 0);
    });
  } catch (err) {
    cleanup();
    console.error(`Failed to start web dev stack: ${err.message}`);
    process.exit(1);
  }
}

main();
