'use strict';
// 화면(renderer)과 메인 프로세스 사이의 다리. 화면 쪽에는 window.halla 만 노출됩니다.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('halla', {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (data) => ipcRenderer.invoke('settings:save', data),
  clearApiKey: () => ipcRenderer.invoke('settings:clear-key'),
  listModels: () => ipcRenderer.invoke('models:list'),
  generate: (form) => ipcRenderer.invoke('article:generate', form),
  copyText: (text) => ipcRenderer.invoke('clipboard:write', String(text)),
  openExternal: (url) => ipcRenderer.invoke('shell:open-external', String(url)),
  onOpenSettings: (callback) => ipcRenderer.on('ui:open-settings', () => callback())
});
