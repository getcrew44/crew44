const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getBackendConfig: () => ipcRenderer.invoke('backend:get-config'),
  openFolderDialog: () => ipcRenderer.invoke('dialog:open-folder'),
  createBlankProjectFolder: (name) => ipcRenderer.invoke('project:create-blank-folder', name),
  showInFinder: (folderPath) => ipcRenderer.invoke('shell:show-in-folder', folderPath),
});
