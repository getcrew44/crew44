#!/usr/bin/env node
// Signs the .app produced by `electron-builder --dir --mac`, wraps it in
// a signed DMG via macOS-builtin `hdiutil`, and (when SKIP_NOTARIZE isn't
// set) notarizes + staples it via `xcrun notarytool` using a keychain
// profile.
//
// Why not let electron-builder do all this:
//   - electron-builder's @electron/osx-sign signs ~2x as many files as
//     this script, doubling per-file TSA timestamp round trips. Painful
//     on China networks (and slow even on US ones).
//   - electron-builder's dmg-builder downloads dmgbuild bundles from
//     GitHub-hosted CDNs, which are unreliable from China. hdiutil ships
//     with macOS; no network needed.
//   - notarytool with a keychain profile is what worked in the bespoke
//     dist.cjs flow before the electron-builder migration.
//
// Flags:
//   --skip-sign       Don't sign anything. Implies --skip-notarize.
//   --skip-notarize   Sign but don't notarize. Useful for local builds
//                     when you don't want to wait on Apple's notary.
//
// Env:
//   APPLE_SIGNING_IDENTITY (or CSC_NAME / CSC_IDENTITY)
//                     Developer ID Application identity. Find with
//                     `security find-identity -p codesigning -v`.
//   NOTARY_PROFILE    Keychain profile name for xcrun notarytool.
//                     Defaults to `crew44-notarize`. Create one with:
//                     `xcrun notarytool store-credentials NOTARY_PROFILE`
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const args = new Set(process.argv.slice(2));
const SKIP_SIGN = args.has('--skip-sign');
const SKIP_NOTARIZE = args.has('--skip-notarize') || SKIP_SIGN;

const IDENTITY = process.env.APPLE_SIGNING_IDENTITY || process.env.CSC_IDENTITY || process.env.CSC_NAME;
const NOTARY_PROFILE = process.env.NOTARY_PROFILE || 'crew44-notarize';

if (!SKIP_SIGN && !IDENTITY) {
  console.error('APPLE_SIGNING_IDENTITY (or CSC_IDENTITY / CSC_NAME) must be set to a Developer ID Application identity.');
  console.error('  Find yours with: security find-identity -p codesigning -v');
  console.error('  Or pass --skip-sign to produce an unsigned DMG.');
  process.exit(1);
}

const repoRoot = path.resolve(__dirname, '..', '..');
const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
const productName = pkg.productName || pkg.name;
const version = pkg.version;
const releaseDir = path.join(repoRoot, 'release');
const appRoot = path.join(releaseDir, 'mac-arm64');
const targetApp = path.join(appRoot, `${productName}.app`);
const entitlements = path.join(repoRoot, 'electron', 'build', 'entitlements.mac.plist');

if (!fs.existsSync(targetApp)) {
  console.error(`Expected .app at ${targetApp}`);
  console.error('Run electron-builder --dir --mac first (the npm scripts do this for you).');
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
  const argv = ['--force', '--timestamp', '--options', 'runtime', '--sign', IDENTITY];
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

function signApp() {
  const contents = path.join(targetApp, 'Contents');
  console.log(`Signing nested binaries and bundles under ${contents}`);
  signTree(contents, entitlements);

  console.log(`Signing outer app ${targetApp}`);
  sign(targetApp, { entitlements });

  console.log('Verifying signature');
  run('codesign', ['--verify', '--deep', '--strict', '--verbose=2', targetApp]);
}

function makeDmg() {
  const stagingDir = path.join(appRoot, 'dmg-staging');
  const dmgPath = path.join(releaseDir, `${productName}-${version}-arm64.dmg`);

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

  // notarytool emits JSON on stdout on success and Swift error text on
  // stderr on transport failures (S3 upload timeout from poor networks,
  // expired credentials, Apple service outage). Don't try to JSON-parse
  // the latter — surface it as-is so the failure mode is legible.
  const stdout = (result.stdout || '').trim();
  if (!stdout.startsWith('{')) {
    console.error('\nnotarytool did not return JSON. Common causes:');
    console.error('  - Network timeout uploading the DMG to Apple/AWS S3');
    console.error('  - Keychain profile missing or expired (re-create with');
    console.error(`    \`xcrun notarytool store-credentials ${NOTARY_PROFILE}\`)`);
    console.error('  - Apple notary service outage');
    console.error(`\nThe signed DMG is still at: ${dmgPath}`);
    console.error('Retry with: NOTARY_PROFILE=' + NOTARY_PROFILE + ' npm run dist:mac');
    console.error('Or skip notarization for now: npm run dist:mac:unsigned');
    process.exit(1);
  }

  let parsed;
  try {
    parsed = JSON.parse(stdout);
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

if (!SKIP_SIGN) signApp();

const dmgPath = makeDmg();
console.log(`Wrote ${dmgPath}`);

if (!SKIP_SIGN) {
  sign(dmgPath);
}

if (!SKIP_NOTARIZE) notarize(dmgPath);

console.log(`\nDone. Distributable: ${dmgPath}`);
