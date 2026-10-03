'use strict';
const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('api', {
  /**
   * Electron 32 removed `File.path`, so a dropped file's real location must be
   * looked up here in the preload (webUtils only exists outside the sandbox).
   * Without this, drag & drop silently yields a bare filename.
   */
  pathForFile: (file) => {
    try { return webUtils.getPathForFile(file); } catch (e) { return ''; }
  },

  configLoad: () => ipcRenderer.invoke('config:load'),
  configSave: (cfg) => ipcRenderer.invoke('config:save', cfg),
  configGet: (k) => ipcRenderer.invoke('config:get', k),
  configExport: () => ipcRenderer.invoke('config:export'),
  configImport: () => ipcRenderer.invoke('config:import'),
  configOpenFolder: () => ipcRenderer.invoke('config:openFolder'),
  configReset: () => ipcRenderer.invoke('config:reset'),
  openExternal: (url) => ipcRenderer.invoke('app:openExternal', url),

  deviceDraw: (a) => ipcRenderer.invoke('device:draw', a),
  deviceBrightness: (v) => ipcRenderer.invoke('device:brightness', v),
  deviceSleep: () => ipcRenderer.invoke('device:sleep'),
  deviceWake: () => ipcRenderer.invoke('device:wake'),
  deviceReconnect: () => ipcRenderer.invoke('device:reconnect'),
  hostStatus: () => ipcRenderer.invoke('host:status'),

  actionRun: (spec) => ipcRenderer.invoke('action:run', spec),
  actionClassify: (p) => ipcRenderer.invoke('action:classify', p),

  iconExtract: (p) => ipcRenderer.invoke('icon:extract', p),
  dialogPick: (opts) => ipcRenderer.invoke('dialog:pick', opts),

  setLogin: (v) => ipcRenderer.invoke('app:setLogin', v),
  fetchFavicon: (url) => ipcRenderer.invoke('app:fetchFavicon', url),

  windowHide: () => ipcRenderer.invoke('window:hide'),
  windowMinimize: () => ipcRenderer.invoke('window:minimize'),
  windowMaximize: () => ipcRenderer.invoke('window:maximize'),
  windowClose: () => ipcRenderer.invoke('window:close'),
  windowIsMaximized: () => ipcRenderer.invoke('window:isMaximized'),
  systemStats: () => ipcRenderer.invoke('system:stats'),

  libraryExport: (a) => ipcRenderer.invoke('library:export', a),
  libraryImport: () => ipcRenderer.invoke('library:import'),

  audioGetVolume: () => ipcRenderer.invoke('audio:getVolume'),
  audioSetVolume: (lvl) => ipcRenderer.invoke('audio:setVolume', lvl),
  audioStepVolume: (delta, osd) => ipcRenderer.invoke('audio:stepVolume', delta, osd),
  audioToggleMute: (osd) => ipcRenderer.invoke('audio:toggleMute', osd),
  audioGetDevices: () => ipcRenderer.invoke('audio:getDevices'),
  audioSwitchDevice: (target) => ipcRenderer.invoke('audio:switchDevice', target),

  macroGetCursor: () => ipcRenderer.invoke('macro:getCursor'),
  macroStopAll: () => ipcRenderer.invoke('macro:stopAll'),
  macroActiveLoops: () => ipcRenderer.invoke('macro:activeLoops'),

  on: (channel, cb) => {
    const allowed = ['host:status', 'device:repaint', 'device:repaint-strips', 'key:flash',
      'key:unconfigured', 'toast', 'page:changed', 'config:external', 'window:max-changed', 'macro:loopState', 'key:result', 'key:toggleState', 'audio:state'];
    if (!allowed.includes(channel)) return () => {};
    const handler = (e, payload) => cb(payload);
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.removeListener(channel, handler);
  },
});
