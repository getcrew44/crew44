const { spawn } = require('child_process');
const { ensureDevApp } = require('./electron-app.cjs');

function main() {
  const app = ensureDevApp();

  const child = spawn(app.executable, [], {
    cwd: app.root,
    env: process.env,
    stdio: 'inherit',
  });

  child.on('exit', code => {
    process.exit(code ?? 0);
  });
}

main();
