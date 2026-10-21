'use strict';
const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('api', {
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
  deviceBatchDraw: (items) => ipcRenderer.invoke('device:batchDraw', items),
  deviceBrightness: (v) => ipcRenderer.invoke('device:brightness', v),
  deviceSetDebounce: (ms) => ipcRenderer.invoke('device:setDebounce', ms),
  deviceSetLongPressMs: (ms) => ipcRenderer.invoke('device:setLongPressMs', ms),
  deviceStartAnim: (payload) => ipcRenderer.invoke('device:startAnim', payload),
  deviceStopAnim: (payload) => ipcRenderer.invoke('device:stopAnim', payload),
  deviceClearAnims: () => ipcRenderer.invoke('device:clearAnims'),
  contextBarGet: () => ipcRenderer.invoke('contextbar:get'),
  triggerPhysicalKey: (row, col, isLongPress = false) => ipcRenderer.invoke('key:triggerPhysical', { row, col, isLongPress }),
  deviceSleep: () => ipcRenderer.invoke('device:sleep'),
  deviceWake: () => ipcRenderer.invoke('device:wake'),
  deviceReconnect: () => ipcRenderer.invoke('device:reconnect'),
  hostStatus: () => ipcRenderer.invoke('host:status'),

  actionRun: (spec, ctx) => ipcRenderer.invoke('action:run', spec, ctx),
  runAction: (spec, ctx) => ipcRenderer.invoke('action:run', spec, ctx),
  actionClassify: (p) => ipcRenderer.invoke('action:classify', p),

  iconExtract: (p) => ipcRenderer.invoke('icon:extract', p),
  readImage: async (p) => {
    const dataUrl = await ipcRenderer.invoke('icon:extract', p);
    return dataUrl ? { ok: true, dataUrl } : { ok: false, dataUrl: null };
  },
  dialogPick: (opts) => ipcRenderer.invoke('dialog:pick', opts),

  setLogin: (v) => ipcRenderer.invoke('app:setLogin', v),
  fetchFavicon: (url) => ipcRenderer.invoke('app:fetchFavicon', url),

  windowHide: () => ipcRenderer.invoke('window:hide'),
  windowMinimize: () => ipcRenderer.invoke('window:minimize'),
  windowMaximize: () => ipcRenderer.invoke('window:maximize'),
  windowClose: () => ipcRenderer.invoke('window:close'),
  windowIsMaximized: () => ipcRenderer.invoke('window:isMaximized'),
  systemStats: (opts) => ipcRenderer.invoke('system:stats', opts),
  telemetryGet: (opts) => ipcRenderer.invoke('telemetry:get', opts),
  pomodoroAction: (act, minutes) => ipcRenderer.invoke('pomodoro:action', (act && typeof act === 'object') ? act : { act, minutes }),
  pomodoroControl: (act, minutes) => ipcRenderer.invoke('pomodoro:action', (act && typeof act === 'object') ? act : { act, minutes }),
  pluginsList: () => ipcRenderer.invoke('plugins:list'),
  pluginsReload: () => ipcRenderer.invoke('plugins:reload'),
  pluginsMarket: () => ipcRenderer.invoke('plugins:market'),
  pluginsInstall: (pluginId) => ipcRenderer.invoke('plugins:install', pluginId),
  pluginsEvaluate: (pluginId, pluginConfig) => ipcRenderer.invoke('plugins:evaluate', { pluginId, pluginConfig }),
  pluginsTrigger: (pluginId, args) => ipcRenderer.invoke('plugins:trigger', { pluginId, args }),
  pageManualSwitch: (pageId) => ipcRenderer.invoke('page:manualSwitch', pageId),
  profileSwitch: (ref) => ipcRenderer.invoke('profile:switch', ref),
  profileCreate: (opts) => ipcRenderer.invoke('profile:create', opts),
  profileRename: (id, name, icon, accent) => ipcRenderer.invoke('profile:rename', { id, name, icon, accent }),
  profileDelete: (id) => ipcRenderer.invoke('profile:delete', id),
  hudShow: (payload) => ipcRenderer.invoke('hud:show', payload),

  libraryExport: (a) => ipcRenderer.invoke('library:export', a),
  libraryImport: () => ipcRenderer.invoke('library:import'),

  audioGetVolume: () => ipcRenderer.invoke('audio:getVolume'),
  audioSetVolume: (lvl) => ipcRenderer.invoke('audio:setVolume', lvl),
  audioStepVolume: (delta, osd) => ipcRenderer.invoke('audio:stepVolume', delta, osd),
  audioToggleMute: (osd) => ipcRenderer.invoke('audio:toggleMute', osd),
  audioGetDevices: () => ipcRenderer.invoke('audio:getDevices'),
  audioSwitchDevice: (target) => ipcRenderer.invoke('audio:switchDevice', target),
  audioGetPeak: () => ipcRenderer.invoke('audio:getPeak'),
  audioListAppSessions: () => ipcRenderer.invoke('audio:listAppSessions'),
  audioGetAppAudio: (target) => ipcRenderer.invoke('audio:getAppAudio', target),
  audioSetAppVolume: (target, level) => ipcRenderer.invoke('audio:setAppVolume', { target, level }),
  audioStepAppVolume: (target, delta) => ipcRenderer.invoke('audio:stepAppVolume', { target, delta }),
  audioToggleAppMute: (target, mode) => ipcRenderer.invoke('audio:toggleAppMute', { target, mode }),

  macroGetCursor: () => ipcRenderer.invoke('macro:getCursor'),
  macroGetPixel: (x, y) => ipcRenderer.invoke('macro:getPixel', { x, y }),
  pixelGetColor: async (x, y) => {
    const res = await ipcRenderer.invoke('macro:getPixel', { x, y });
    return (res && res.color) ? res.color : '#00e676';
  },
  macroRecordStart: (maxMs) => {
    const ms = (maxMs && typeof maxMs === 'object')
      ? ((Number(maxMs.maxMs) || (Number(maxMs.maxSec) * 1000)) || 15000)
      : (Number(maxMs) || 15000);
    return ipcRenderer.invoke('macro:recordStart', ms);
  },
  macroRecordStop: () => ipcRenderer.invoke('macro:recordStop'),
  macroStopAll: () => ipcRenderer.invoke('macro:stopAll'),
  macroStopKey: (a, b, c) => ipcRenderer.invoke(
    'macro:stopKey',
    (a && typeof a === 'object') ? a : { pageId: a, row: b, col: c }
  ),
  macroStopPage: (pageId) => ipcRenderer.invoke('macro:stopPage', pageId),
  macroActiveLoops: () => ipcRenderer.invoke('macro:activeLoops'),

  on: (channel, cb) => {
    const allowed = [
      'host:status', 'device:repaint', 'device:repaint-strips', 'key:flash',
      'key:unconfigured', 'toast', 'page:changed', 'config:external',
      'window:max-changed', 'macro:loopState', 'key:result', 'key:toggleState',
      'device:key-state', 'audio:state', 'app:runningStates', 'device:sleep-state',
      'login:changed', 'telemetry:update', 'telemetry:data', 'pomodoro:tick',
      'macro:recordState', 'profile:changed', 'window:visibility', 'contextbar:changed'
    ];
    if (!allowed.includes(channel)) return () => {};
    const handler = (e, payload) => cb(payload);
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.removeListener(channel, handler);
  },
});
