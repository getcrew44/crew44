const path = require("path");
const { getDefaultConfig } = require("expo/metro-config");

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "../..");
const mobileNodeModules = path.join(projectRoot, "node_modules");
const workspaceNodeModules = path.join(workspaceRoot, "node_modules");

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  mobileNodeModules,
  workspaceNodeModules
];
config.resolver.extraNodeModules = {
  react: path.join(workspaceNodeModules, "react"),
  "react-dom": path.join(workspaceNodeModules, "react-dom"),
  "react-native": path.join(mobileNodeModules, "react-native"),
  "react/jsx-runtime": path.join(workspaceNodeModules, "react", "jsx-runtime.js"),
  "react/jsx-dev-runtime": path.join(workspaceNodeModules, "react", "jsx-dev-runtime.js")
};

module.exports = config;
