'use strict';
const { contextBridge, ipcRenderer } = require('electron');

// language data for i18n-runtime.js (read once, synchronously, before the page renders)
contextBridge.exposeInMainWorld('__I18N', ipcRenderer.sendSync('launcher:i18n'));

contextBridge.exposeInMainWorld('launcher', {
    getState: () => ipcRenderer.invoke('launcher:get-state'),
    onState: (cb) => ipcRenderer.on('state', (e, s) => cb(s)),
    toggle: (key) => ipcRenderer.invoke('launcher:toggle', key),
    update: (key, patch) => ipcRenderer.invoke('launcher:update', key, patch),
    layout: (key, on) => ipcRenderer.invoke('launcher:layout', key, on),
    server: (patch) => ipcRenderer.invoke('launcher:server', patch),
    openFolder: (which) => ipcRenderer.invoke('launcher:open-folder', which),
    copy: (text) => ipcRenderer.invoke('launcher:copy', text),
    openUrl: (url) => ipcRenderer.invoke('launcher:open-url', url),
    reloadDisplays: () => ipcRenderer.invoke('launcher:reload-displays'),
    setLanguage: (code) => ipcRenderer.invoke('launcher:language', code)
});
