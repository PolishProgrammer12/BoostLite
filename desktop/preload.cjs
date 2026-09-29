const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('boostLiteDesktop', Object.freeze({
  isDesktop: true,
  appVersion: '0.1.0',
  platform: process.platform,
  getMetrics: () => ipcRenderer.invoke('system:metrics'),
  getActivity: () => ipcRenderer.invoke('system:activity'),
  getProcesses: () => ipcRenderer.invoke('system:processes'),
  getSystemInfo: () => ipcRenderer.invoke('system:info'),
  getStartupApps: () => ipcRenderer.invoke('system:startup'),
}))
