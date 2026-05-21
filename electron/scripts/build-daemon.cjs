#!/usr/bin/env node
// Builds the Go daemon for the current host (no args) or cross-compiles
// to a named target (`mac`, `win`, `linux`). Used by `npm run build:daemon`
// and the per-platform `dist:*` scripts.
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..', '..');
const target = process.argv[2];
const goosByTarget = { mac: 'darwin', win: 'windows', linux: 'linux' };
const goos = target ? goosByTarget[target] : null;
if (target && !goos) {
  console.error(`Unknown target "${target}". Expected one of: mac, win, linux.`);
  process.exit(1);
}

const hostGoos = process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'darwin' : 'linux';
const effectiveGoos = goos || hostGoos;
const ext = effectiveGoos === 'windows' ? '.exe' : '';
const outDir = path.join(repoRoot, 'bin');
const outFile = path.join(outDir, `crew44-daemon${ext}`);

fs.mkdirSync(outDir, { recursive: true });

const env = { ...process.env };
if (goos) {
  env.GOOS = goos;
  env.GOARCH = process.env.GOARCH || 'amd64';
  env.CGO_ENABLED = '0';
}

console.log(`Building daemon (${effectiveGoos}/${env.GOARCH || 'host'}) → ${outFile}`);
execFileSync('go', ['build', '-o', outFile, './cmd/crew44-daemon'], {
  cwd: path.join(repoRoot, 'daemon'),
  env,
  stdio: 'inherit',
});
