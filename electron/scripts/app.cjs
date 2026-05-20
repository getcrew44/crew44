const fs = require('fs');
const path = require('path');

const productName = 'Crew44';
const root = path.resolve(__dirname, '..', '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const sourceApp = path.join(root, 'node_modules', 'electron', 'dist', 'Electron.app');
const appRoot = path.join(root, '.electron-app');
const targetApp = path.join(appRoot, `${productName}.app`);
const executable = path.join(targetApp, 'Contents', 'MacOS', 'Electron');
const plistPath = path.join(targetApp, 'Contents', 'Info.plist');
const iconSource = path.join(root, 'electron', 'assets', 'crew44.icns');
const iconTarget = path.join(targetApp, 'Contents', 'Resources', 'crew44.icns');
const resourcesApp = path.join(targetApp, 'Contents', 'Resources', 'app');

function getInstallElectronCommand() {
  const userAgent = process.env.npm_config_user_agent || '';
  if (userAgent.startsWith('pnpm/')) return 'pnpm exec install-electron --no';
  if (userAgent.startsWith('yarn/')) return 'yarn run install-electron --no';
  if (userAgent.startsWith('npm/')) return 'npx install-electron --no';

  if (fs.existsSync(path.join(root, 'pnpm-lock.yaml'))) return 'pnpm exec install-electron --no';
  if (fs.existsSync(path.join(root, 'yarn.lock'))) return 'yarn run install-electron --no';
  return 'npx install-electron --no';
}

function ensureElectronSourceApp() {
  if (fs.existsSync(sourceApp)) return;

  try {
    require('electron');
  } catch (err) {
    const installCommand = getInstallElectronCommand();
    throw new Error(
      `Electron.app is missing and Electron could not be installed automatically. ${err.message}\n` +
        `Run \`${installCommand}\` and try again.`
    );
  }

  if (!fs.existsSync(sourceApp)) {
    const installCommand = getInstallElectronCommand();
    throw new Error(`Electron.app is missing. Run \`${installCommand}\` and try again.`);
  }
}

function ensureDevApp() {
  ensureElectronSourceApp();

  fs.rmSync(targetApp, { recursive: true, force: true });
  fs.mkdirSync(appRoot, { recursive: true });
  fs.cpSync(sourceApp, targetApp, { recursive: true, verbatimSymlinks: true });
  if (fs.existsSync(iconSource)) {
    fs.copyFileSync(iconSource, iconTarget);
  }

  let plist = fs.readFileSync(plistPath, 'utf8');
  const replacements = {
    CFBundleDisplayName: productName,
    CFBundleName: productName,
    CFBundleIdentifier: 'com.crew44.desktop',
    CFBundleIconFile: 'crew44.icns',
    CFBundleShortVersionString: pkg.version,
    CFBundleVersion: pkg.version,
    NSHumanReadableCopyright: `Copyright © ${new Date().getFullYear()} Crew44`,
  };

  for (const [key, value] of Object.entries(replacements)) {
    const pattern = new RegExp(`(<key>${key}</key>\\s*<string>)([^<]*)(</string>)`);
    if (pattern.test(plist)) {
      plist = plist.replace(pattern, `$1${value}$3`);
    } else {
      plist = plist.replace('</dict>', `\t<key>${key}</key>\n\t<string>${value}</string>\n</dict>`);
    }
  }

  fs.writeFileSync(plistPath, plist);
  fs.rmSync(resourcesApp, { recursive: true, force: true });
  fs.mkdirSync(resourcesApp, { recursive: true });

  for (const entry of ['package.json', 'electron', 'dist']) {
    const source = path.join(root, entry);
    const target = path.join(resourcesApp, entry);
    if (!fs.existsSync(source)) continue;
    fs.cpSync(source, target, { recursive: true, verbatimSymlinks: true });
  }

  const daemonSource = path.join(root, 'bin', process.platform === 'win32' ? 'crew44-daemon.exe' : 'crew44-daemon');
  if (fs.existsSync(daemonSource)) {
    const daemonTargetDir = path.join(resourcesApp, 'bin');
    fs.mkdirSync(daemonTargetDir, { recursive: true });
    fs.copyFileSync(daemonSource, path.join(daemonTargetDir, path.basename(daemonSource)));
  }

  return {
    productName,
    root,
    targetApp,
    executable,
    version: pkg.version,
    appRoot,
  };
}

module.exports = {
  ensureDevApp,
};
