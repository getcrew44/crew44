#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { ensureDevApp } = require('./app.cjs');

const args = new Set(process.argv.slice(2));
const SKIP_NOTARIZE = args.has('--skip-notarize');
const SKIP_SIGN = args.has('--skip-sign');

const IDENTITY = process.env.APPLE_SIGNING_IDENTITY || process.env.CSC_IDENTITY;
const NOTARY_PROFILE = process.env.NOTARY_PROFILE || 'crew44-notarize';

if (!SKIP_SIGN && !IDENTITY) {
  console.error('APPLE_SIGNING_IDENTITY (or CSC_IDENTITY) must be set to a Developer ID Application identity.');
  console.error('  Find yours with: security find-identity -p codesigning -v');
  process.exit(1);
}

function run(cmd, argv, opts = {}) {
  const result = spawnSync(cmd, argv, { stdio: 'inherit', ...opts });
  if (result.status !== 0) {
    throw new Error(`${cmd} ${argv.join(' ')} exited with status ${result.status}`);
  }
  return result;
}

function sign(target, { entitlements = null } = {}) {
  const argv = [
    '--force',
    '--timestamp',
    '--options', 'runtime',
    '--sign', IDENTITY,
  ];
  if (entitlements) argv.push('--entitlements', entitlements);
  argv.push(target);
  run('codesign', argv);
}

const MACHO_MAGIC = new Set([0xfeedface, 0xfeedfacf, 0xcefaedfe, 0xcffaedfe, 0xcafebabe, 0xbebafeca]);

function isMachO(filePath) {
  try {
    const fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(4);
    const bytesRead = fs.readSync(fd, buf, 0, 4, 0);
    fs.closeSync(fd);
    if (bytesRead < 4) return false;
    return MACHO_MAGIC.has(buf.readUInt32BE(0));
  } catch {
    return false;
  }
}

function signTree(dir, entitlements) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      signTree(full, entitlements);
      if (full.endsWith('.app')) {
        sign(full, { entitlements });
      } else if (full.endsWith('.framework')) {
        sign(full);
      }
    } else if (entry.isFile() && isMachO(full)) {
      sign(full);
    }
  }
}

function signApp(targetApp) {
  const entitlements = path.join(__dirname, '..', 'build', 'entitlements.mac.plist');
  const contents = path.join(targetApp, 'Contents');

  console.log(`Signing nested binaries and bundles under ${contents}`);
  signTree(contents, entitlements);

  console.log(`Signing outer app ${targetApp}`);
  sign(targetApp, { entitlements });

  console.log('Verifying signature');
  run('codesign', ['--verify', '--deep', '--strict', '--verbose=2', targetApp]);
}

function makeDmg({ targetApp, appRoot, productName, version }) {
  const stagingDir = path.join(appRoot, 'dmg-staging');
  const dmgPath = path.join(appRoot, `${productName}-${version}-arm64.dmg`);

  fs.rmSync(stagingDir, { recursive: true, force: true });
  fs.mkdirSync(stagingDir, { recursive: true });

  const stagedApp = path.join(stagingDir, path.basename(targetApp));
  fs.cpSync(targetApp, stagedApp, { recursive: true, verbatimSymlinks: true });
  fs.symlinkSync('/Applications', path.join(stagingDir, 'Applications'));

  fs.rmSync(dmgPath, { force: true });
  console.log(`Creating ${dmgPath}`);
  run('hdiutil', [
    'create',
    '-volname', `${productName} ${version}`,
    '-srcfolder', stagingDir,
    '-ov',
    '-format', 'UDZO',
    dmgPath,
  ]);

  fs.rmSync(stagingDir, { recursive: true, force: true });
  return dmgPath;
}

function notarize(dmgPath) {
  console.log(`Submitting ${dmgPath} to notarytool (profile ${NOTARY_PROFILE})`);
  const result = spawnSync('xcrun', [
    'notarytool', 'submit', dmgPath,
    '--keychain-profile', NOTARY_PROFILE,
    '--wait',
    '--output-format', 'json',
  ], { encoding: 'utf8' });

  process.stdout.write(result.stdout || '');
  process.stderr.write(result.stderr || '');

  let parsed;
  try {
    parsed = JSON.parse(result.stdout);
  } catch (err) {
    throw new Error(`Could not parse notarytool output: ${err.message}`);
  }

  if (parsed.status !== 'Accepted') {
    console.error(`\nNotarization status: ${parsed.status}`);
    console.error(`Submission id: ${parsed.id}`);
    console.error(`Fetch the failure log with:`);
    console.error(`  xcrun notarytool log ${parsed.id} --keychain-profile ${NOTARY_PROFILE}`);
    process.exit(1);
  }

  console.log(`Stapling ${dmgPath}`);
  run('xcrun', ['stapler', 'staple', dmgPath]);
  run('xcrun', ['stapler', 'validate', dmgPath]);
}

function main() {
  const app = ensureDevApp();
  console.log(`Built ${app.productName} ${app.version} at ${app.targetApp}`);

  if (!SKIP_SIGN) signApp(app.targetApp);

  const dmgPath = makeDmg(app);
  console.log(`Wrote ${dmgPath}`);

  if (!SKIP_SIGN) {
    sign(dmgPath);
  }

  if (!SKIP_NOTARIZE && !SKIP_SIGN) notarize(dmgPath);

  console.log(`\nDone. Distributable: ${dmgPath}`);
}

main();
