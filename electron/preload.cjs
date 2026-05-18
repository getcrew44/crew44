const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getBackendConfig: () => ipcRenderer.invoke('backend:get-config'),
  openFolderDialog: () => ipcRenderer.invoke('dialog:open-folder'),
  openFileDialog: () => ipcRenderer.invoke('dialog:open-files'),
  createBlankProjectFolder: (name) => ipcRenderer.invoke('project:create-blank-folder', name),
  showInFinder: (folderPath) => ipcRenderer.invoke('shell:show-in-folder', folderPath),
  revealInFinder: (filePath) => ipcRenderer.invoke('shell:reveal-in-finder', filePath),
  getPathForFile: (file) => webUtils.getPathForFile(file),
  getPathInfo: (paths) => ipcRenderer.invoke('paths:info', paths),
  getComputerName: () => ipcRenderer.invoke('system:computer-name'),
  readFileDataURL: (filePath) => ipcRenderer.invoke('files:read-data-url', filePath),
  zoomWindow: () => ipcRenderer.invoke('window:zoom'),
});
