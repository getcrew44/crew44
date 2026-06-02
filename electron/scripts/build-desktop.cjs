#!/usr/bin/env node
const { execFileSync, spawnSync } = require('child_process');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..', '..');
const builderConfigPath = path.join(repoRoot, 'electron', 'electron-builder.yml');
const daemonBuildScript = path.join(repoRoot, 'electron', 'scripts', 'build-daemon.cjs');

const PLATFORM_FLAGS = {
  mac: '--mac',
  win: '--win',
  linux: '--linux',
};

const PLATFORM_TO_GO = {
  mac: 'mac',
  win: 'win',
  linux: 'linux',
};

const ARCH_TO_GO = {
  x64: 'amd64',
  arm64: 'arm64',
};

function hostPlatform() {
  if (process.platform === 'darwin') return 'mac';
  if (process.platform === 'win32') return 'win';
  return 'linux';
}

function hostArch() {
  if (process.arch === 'arm64') return 'arm64';
  return 'x64';
}

function parseArgs(argv) {
  const options = {
    platforms: [],
    archs: [],
    passthrough: [],
  };

  for (const arg of argv) {
    if (arg === '--') continue;
    if (arg === '--mac') {
      options.platforms.push('mac');
      continue;
    }
    if (arg === '--win') {
      options.platforms.push('win');
      continue;
    }
    if (arg === '--linux') {
      options.platforms.push('linux');
      continue;
    }
    if (arg === '--x64') {
      options.archs.push('x64');
      continue;
    }
    if (arg === '--arm64') {
      options.archs.push('arm64');
      continue;
    }
    options.passthrough.push(arg);
  }

  if (options.platforms.length === 0) options.platforms.push(hostPlatform());
  if (options.archs.length === 0) options.archs.push(hostArch());
  return options;
}

function unique(values) {
  return [...new Set(values)];
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    ...options,
  });

  if (result.error) {
    console.error(`[build-desktop] failed to spawn ${command}: ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

function buildRenderer() {
  const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  run(npmCmd, ['exec', '--', 'vite', 'build']);
}

function buildDaemon(platform, arch) {
  execFileSync('node', [daemonBuildScript, PLATFORM_TO_GO[platform], ARCH_TO_GO[arch]], {
    cwd: repoRoot,
    stdio: 'inherit',
  });
}

function builderArgsForTarget(platform, arch, passthrough, useScopedOutputDir) {
  const args = [
    'exec',
    '--',
    'electron-builder',
    '--config',
    builderConfigPath,
    PLATFORM_FLAGS[platform],
    `--${arch}`,
    ...passthrough,
  ];

  if (useScopedOutputDir) {
    args.push(`-c.directories.output=release/${platform}-${arch}`);
  }

  return args;
}

function main() {
  const parsed = parseArgs(process.argv.slice(2));
  const platforms = unique(parsed.platforms);
  const archs = unique(parsed.archs);
  const targets = platforms.flatMap(platform => archs.map(arch => ({ platform, arch })));
  const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';

  buildRenderer();

  const useScopedOutputDir = targets.length > 1;
  for (const target of targets) {
    console.log(`[build-desktop] packaging ${target.platform}/${target.arch}`);
    buildDaemon(target.platform, target.arch);
    run(npmCmd, builderArgsForTarget(target.platform, target.arch, parsed.passthrough, useScopedOutputDir));
  }
}

main();
