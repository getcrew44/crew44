const { contextBridge, ipcRenderer } = require('electron');

const backendArg = process.argv.find(arg => arg.startsWith('--crewai-backend-url='));
const backendUrl = backendArg ? backendArg.replace('--crewai-backend-url=', '') : '';

contextBridge.exposeInMainWorld('electronAPI', {
  backendUrl,
  openFolderDialog: () => ipcRenderer.invoke('dialog:open-folder'),
});
