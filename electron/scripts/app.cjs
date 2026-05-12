const fs = require('fs');
const path = require('path');

const productName = 'CrewAI Desktop';
const root = path.resolve(__dirname, '..', '..');
const sourceApp = path.join(root, 'node_modules', 'electron', 'dist', 'Electron.app');
const appRoot = path.join(root, '.electron-app');
const targetApp = path.join(appRoot, `${productName}.app`);
const executable = path.join(targetApp, 'Contents', 'MacOS', 'Electron');
const plistPath = path.join(targetApp, 'Contents', 'Info.plist');
const iconSource = path.join(root, 'electron', 'assets', 'crewai.icns');
const iconTarget = path.join(targetApp, 'Contents', 'Resources', 'crewai.icns');
const resourcesApp = path.join(targetApp, 'Contents', 'Resources', 'app');

function ensureDevApp() {
  if (!fs.existsSync(sourceApp)) {
    throw new Error('Electron.app is missing. Run npm install.');
  }

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
    CFBundleIdentifier: 'com.crewai.desktop',
    CFBundleIconFile: 'crewai.icns',
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

  const daemonSource = path.join(root, 'bin', process.platform === 'win32' ? 'crewai-daemon.exe' : 'crewai-daemon');
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
  };
}

module.exports = {
  ensureDevApp,
};
