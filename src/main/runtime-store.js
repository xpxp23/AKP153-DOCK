'use strict';
/**
 * Unidirectional Data Flow & Isomorphic Headless Render Engine: SpecStore & RuntimeStateStore (v0.12.0)
 *
 * 核心设计目标：
 * 1. 彻底分离「静态持久化配置 (SpecStore)」与「运行时动态状态树 (RuntimeStateStore)」。
 * 2. 任何进程存活监控、前台窗口状态、系统音量/静音、SMTC 媒体播放状态、插件遥测更新只写入 RuntimeStateStore，
 *    绝不直接污染或依赖会被 config.save() 覆盖的静态 Spec 对象。
 * 3. 提供前后端 100% 同构的纯函数 computeBadgeModel / computeRenderModel / computeStripRenderModel，
 *    统一 4 态窗口角标（运行中 / 后台可见 / 最小化 / 托盘 / 待机）与音量动态角标，
 *    同时驱动前端 DOM 网格、Canvas 渲染器与后台托盘无头渲染引擎 (Headless Renderer)。
 */

const EventEmitter = require('events');

class RuntimeStateStore extends EventEmitter {
  constructor() {
    super();
    this.keyStates = new Map();
    this.stripStates = new Map();
    this.globalState = {
      audio: { level: 60, volume: 60, isMute: false, updatedAt: 0 },
      foreground: { processName: '', title: '', pid: 0, updatedAt: 0 },
      runningProcs: [],
      media: { title: '暂无媒体播放', artist: '等待音频源…', status: 'Stopped', playing: false, updatedAt: 0 },
      telemetry: {},
      sysStats: { cpu: 18, mem: 45, memUsedGb: '7.2', memTotalGb: '16.0', cpuHistory: [18, 22, 19, 24] },
      pluginRenderCache: {},
      hardwareModel: 'akp153',
      activeTransition: null,
      headlessStats: { active: false, framesRendered: 0, lastRenderAt: 0, savedIpcCount: 0 },
    };
    this.lastVisualHashes = new Map();
  }

  _cellId(pageId, row, col) {
    return `${pageId || 'default'}:${row},${col}`;
  }

  getKeyState(pageId, row, col) {
    const id = this._cellId(pageId, row, col);
    if (!this.keyStates.has(id)) {
      this.keyStates.set(id, {
        activeState: 0,
        windowSubState: 'not_running',
        graceUntil: 0,
        everSeenRunning: false,
        lastTriggeredAt: 0,
        customBadge: null,
      });
    }
    return this.keyStates.get(id);
  }

  setKeyState(pageId, row, col, patch) {
    const cur = this.getKeyState(pageId, row, col);
    let changed = false;
    for (const [k, v] of Object.entries(patch || {})) {
      if (cur[k] !== v) {
        cur[k] = v;
        changed = true;
      }
    }
    if (changed) {
      this.emit('keyStateChanged', {
        pageId,
        row: Number(row),
        col: Number(col),
        state: Object.assign({}, cur),
      });
    }
    return { changed, state: cur };
  }

  getPageKeyStatesSnapshot(pageId) {
    const prefix = `${pageId || 'default'}:`;
    const out = {};
    for (const [k, v] of this.keyStates.entries()) {
      if (k.startsWith(prefix)) {
        const posKey = k.slice(prefix.length);
        out[posKey] = {
          activeState: v.activeState || 0,
          windowSubState: v.windowSubState || 'not_running',
          graceUntil: v.graceUntil || 0,
          everSeenRunning: !!v.everSeenRunning,
        };
      }
    }
    return out;
  }

  attachRuntimeToPage(page) {
    const btnMap = page && (page.buttons || page.keys);
    if (!page || !btnMap) return page;
    for (const [posKey, spec] of Object.entries(btnMap)) {
      if (!spec) continue;
      const [r, c] = posKey.split(',').map(Number);
      const st = this.getKeyState(page.id, r, c);
      spec._activeState = st.activeState || 0;
      spec._windowSubState = st.windowSubState || 'not_running';
      spec._graceUntil = st.graceUntil || 0;
      spec._everSeenRunning = !!st.everSeenRunning;
    }
    return page;
  }

  updateGlobalState(section, payload) {
    if (!section || !payload) return false;
    const prev = this.globalState[section] || {};
    const next = Object.assign({}, prev, payload, { updatedAt: Date.now() });
    if (section === 'audio') {
      if (next.level !== undefined && next.volume === undefined) next.volume = next.level;
      if (next.volume !== undefined && next.level === undefined) next.level = next.volume;
    }
    this.globalState[section] = next;
    this.emit('globalStateChanged', { section, data: next });
    return true;
  }

  setPluginRenderResult(instanceKey, data, intervalMs = 2500) {
    this.globalState.pluginRenderCache[instanceKey] = {
      data,
      intervalMs: Number(intervalMs) || 2500,
      updatedAt: Date.now(),
    };
  }

  getPluginRenderResult(instanceKey) {
    const item = this.globalState.pluginRenderCache[instanceKey];
    return item ? item.data : null;
  }

  checkAndMarkDirty(targetKey, visualHash) {
    const prev = this.lastVisualHashes.get(targetKey);
    if (prev === visualHash) return false;
    this.lastVisualHashes.set(targetKey, visualHash);
    return true;
  }

  invalidateDirtyCache(pageId = null) {
    if (!pageId) {
      this.lastVisualHashes.clear();
      return;
    }
    for (const k of Array.from(this.lastVisualHashes.keys())) {
      if (k.includes(pageId)) this.lastVisualHashes.delete(k);
    }
  }
}

function computeBadgeModel(spec, keyRuntime = {}, globalState = {}) {
  if (!spec) return null;
  const activeState = typeof keyRuntime.activeState === 'number'
    ? keyRuntime.activeState
    : (spec._activeState !== undefined ? Number(spec._activeState) : (Number(spec.badgeInitialState) || 0));
  const windowSubState = keyRuntime.windowSubState || spec._windowSubState || 'not_running';
  const audio = (globalState && globalState.audio) || { level: 50, volume: 50, isMute: false };

  if (spec.type === 'volume' || spec.type === 'audio') {
    if (spec.action === 'mute') {
      const isMute = !!audio.isMute;
      const s1 = spec.badgeState1 || { text: '🔊', bg: '#107c41', color: '#ffffff' };
      const s2 = spec.badgeState2 || { text: '🔇', bg: '#e53935', color: '#ffffff' };
      const sObj = isMute ? s2 : s1;
      const txt = String(sObj.text !== undefined ? sObj.text : (isMute ? '🔇' : '🔊')).trim();
      if (!txt) return null;
      return {
        text: txt,
        bg: sObj.bg || (isMute ? '#e53935' : '#107c41'),
        color: sObj.color || '#ffffff',
        state: isMute ? 1 : 0,
        stateTag: isMute ? 'mute' : 'unmute',
        isToggle: true,
      };
    }
    if ((spec.action === 'up' || spec.action === 'down' || spec.action === 'set') && !spec.badge && !spec.badgeToggle) {
      const vol = audio.volume !== undefined ? audio.volume : (audio.level !== undefined ? audio.level : 50);
      const isMute = !!audio.isMute;
      return {
        text: isMute ? 'MUTE' : `${vol}%`,
        bg: isMute ? '#d32f2f' : '#1565c0',
        color: '#ffffff',
        state: 0,
        stateTag: 'volume',
        isToggle: false,
      };
    }
  }

  const hasExplicitStateBadges = Boolean(
    spec.badgeToggle ||
    spec.badgeState1 ||
    spec.badgeState2 ||
    spec.badge2 ||
    (spec.toggleAction && spec.type === 'app')
  );

  if (hasExplicitStateBadges) {
    const syncMode = spec.toggleSyncMode || spec.appMonitorMode || 'auto';
    if (activeState === 1 && syncMode === 'window') {
      if (windowSubState === 'tray_hidden') {
        return { text: '托盘', bg: '#9333ea', color: '#ffffff', state: 1, stateTag: 'tray_hidden', isToggle: true };
      }
      if (windowSubState === 'minimized') {
        return { text: '最小化', bg: '#d97706', color: '#ffffff', state: 1, stateTag: 'minimized', isToggle: true };
      }
      if (windowSubState === 'background') {
        const sBg = spec.badgeStateBg || null;
        return {
          text: (sBg && sBg.text) ? String(sBg.text).trim() : '后台可见',
          bg: (sBg && sBg.bg) || '#0284c7',
          color: (sBg && sBg.color) || '#ffffff',
          state: 1,
          stateTag: 'background',
          isToggle: true,
        };
      }
    }

    const s1 = Object.assign(
      {
        text: spec.type === 'app' ? '待机' : (spec.badge || ''),
        bg: spec.badgeBg || '#546e7a',
        color: spec.badgeColor || '#ffffff',
      },
      spec.badgeState1 || {}
    );
    const s2 = Object.assign(
      {
        text: spec.badge2 || (spec.type === 'app' ? '运行中' : 'ON'),
        bg: spec.color2 || '#107c41',
        color: '#ffffff',
      },
      spec.badgeState2 || {}
    );

    const chosen = activeState === 1 ? s2 : s1;
    const text = String(chosen.text !== undefined ? chosen.text : '').trim();
    if (!text) return null;
    return {
      text,
      bg: chosen.bg || (activeState === 1 ? '#107c41' : '#546e7a'),
      color: chosen.color || '#ffffff',
      state: activeState,
      stateTag: activeState === 1 ? 'state2' : 'state1',
      isToggle: true,
    };
  }

  const fallbackText = String(spec.badge || '').trim();
  if (!fallbackText) return null;
  return {
    text: fallbackText,
    bg: spec.badgeBg || '#e53935',
    color: spec.badgeColor || '#ffffff',
    state: 0,
    stateTag: 'static',
    isToggle: false,
  };
}

function computeRenderModel(spec, keyRuntime = {}, globalState = {}) {
  if (!spec) {
    return {
      empty: true,
      visualHash: 'empty',
    };
  }

  const activeState = typeof keyRuntime.activeState === 'number'
    ? keyRuntime.activeState
    : (spec._activeState !== undefined ? Number(spec._activeState) : (Number(spec.badgeInitialState) || 0));
  const windowSubState = keyRuntime.windowSubState || spec._windowSubState || 'not_running';
  const isState2 = !!spec.toggleAction && activeState === 1;

  const title = isState2 && spec.label2 ? String(spec.label2) : String(spec.label || '');
  const bgColor = isState2 && spec.color2
    ? spec.color2
    : (spec.color || '#1e293b');
  const icon = isState2 && spec.icon2 ? spec.icon2 : (spec.icon || '');

  let dynamicGlyph = spec.glyph || '';
  if (!dynamicGlyph && (spec.type === 'volume' || spec.type === 'audio')) {
    const isMute = !!(globalState && globalState.audio && globalState.audio.isMute);
    if (spec.action === 'down') dynamicGlyph = '🔉';
    else if (spec.action === 'mute') dynamicGlyph = isMute ? '🔇' : '🔊';
    else if (spec.action === 'switch_output' || spec.action === 'switch_device') dynamicGlyph = '🎧';
    else if (spec.action === 'app_mute' || spec.action === 'app_up' || spec.action === 'app_down' || spec.action === 'set') dynamicGlyph = '🎚️';
    else dynamicGlyph = isMute ? '🔇' : '🔊';
  }

  const badge = computeBadgeModel(spec, { activeState, windowSubState }, globalState);
  const widgetLayers = Array.isArray(spec.widgetLayers) ? spec.widgetLayers : null;
  const refreshIntervalMs = Math.max(150, Math.min(600000, Number(spec.refreshIntervalMs) || 2500));

  const model = {
    empty: false,
    type: spec.type || 'none',
    title,
    bgColor,
    color2: spec.color2 || '',
    customColor: !!spec.customColor,
    icon,
    dynamicGlyph,
    badge,
    activeState,
    stateIdx: activeState,
    windowSubState,
    winSub: windowSubState,
    spanCols: Math.max(1, Math.min(5, Number(spec.spanCols || spec.colSpan) || 1)),
    colSpan: Math.max(1, Math.min(5, Number(spec.spanCols || spec.colSpan) || 1)),
    fontSize: Number(spec.fontSize) || 17,
    textColor: spec.textColor || '#ffffff',
    textAlign: spec.textAlign || 'center',
    labelPos: spec.labelPos || spec.titlePos || 'bottom',
    titlePos: spec.labelPos || spec.titlePos || 'bottom',
    hideTitle: !!spec.hideTitle,
    iconScale: Number(spec.iconScale) || ((spec.textIconConfig && spec.textIconConfig.fullBleed) ? 100 : (spec.icon ? (/^data:image\/svg\+xml/i.test(spec.icon) ? 72 : 84) : 62)),
    offsetX: Number(spec.offsetX) || 0,
    offsetY: Number(spec.offsetY) || 0,
    bgGradient: spec.bgGradient || '',
    widgetKind: spec.widgetKind || '',
    pluginId: spec.pluginId || '',
    widgetLayers,
    refreshIntervalMs,
    spec,
  };

  const iconSig = icon ? `${icon.length}:${icon.slice(0, 24)}:${icon.slice(-16)}` : '';
  const badgeSig = badge ? `${badge.text}|${badge.bg}|${badge.color}` : '';
  const layerSig = widgetLayers ? JSON.stringify(widgetLayers) : '';
  const textIconSig = spec.textIconConfig ? JSON.stringify(spec.textIconConfig) : '';

  model.visualHash = [
    model.type,
    model.title,
    model.bgColor,
    model.color2,
    model.customColor ? 1 : 0,
    iconSig,
    model.dynamicGlyph,
    badgeSig,
    model.activeState,
    model.windowSubState,
    model.colSpan,
    model.fontSize,
    model.textColor,
    model.textAlign,
    model.titlePos,
    model.hideTitle ? 1 : 0,
    model.iconScale,
    model.offsetX,
    model.offsetY,
    model.bgGradient,
    model.widgetKind,
    model.pluginId,
    spec.holdPageId || '',
    spec.animFps || 0,
    textIconSig,
    layerSig,
  ].join('§');

  return model;
}

function computeStripRenderModel(stripSpec, row, globalState = {}, pageLabel = '1/1') {
  const s = stripSpec || { type: row === 0 ? 'clock' : (row === 2 ? 'page' : 'none'), color: '#263238' };
  const t = s.type || 'none';
  const sys = (globalState && globalState.sysStats) || { cpu: 20, mem: 45, memUsedGb: '7.2' };
  const tel = (globalState && globalState.telemetry) || {};
  const audio = (globalState && globalState.audio) || { level: 50, isMute: false };
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const mo = String(now.getMonth() + 1).padStart(2, '0');
  const da = String(now.getDate()).padStart(2, '0');
  const wd = ['日', '一', '二', '三', '四', '五', '六'][now.getDay()];
  const dateStr = `${mo}-${da} 周${wd}`;

  let topText = s.label || '';
  let mainText = '';
  let subText = '';
  let accent = '#80deea';
  let progressPct = -1;
  let history = null;

  if (t === 'clock') {
    topText = dateStr;
    mainText = `${hh}:${mm}`;
    subText = '';
    accent = '#80deea';
  } else if (t === 'cpu') {
    topText = 'CPU 负载';
    mainText = `${Math.round(Number(sys.cpu) || 0)}%`;
    subText = '核心处理器';
    progressPct = Math.round(Number(sys.cpu) || 0);
    history = sys.cpuHistory || null;
    accent = progressPct > 80 ? '#ef4444' : '#38bdf8';
  } else if (t === 'mem') {
    topText = '内存占用';
    mainText = `${Math.round(Number(sys.mem) || 0)}%`;
    subText = `${sys.memUsedGb || '0.0'} GB`;
    progressPct = Math.round(Number(sys.mem) || 0);
    accent = '#a855f7';
  } else if (t === 'sys') {
    topText = `CPU ${Math.round(Number(sys.cpu) || 0)}%`;
    mainText = `MEM ${Math.round(Number(sys.mem) || 0)}%`;
    subText = `${sys.memUsedGb || '0'}G Used`;
    progressPct = Math.round(Number(sys.cpu) || 0);
    accent = '#10b981';
  } else if (t === 'net' || (t === 'widget' && s.widgetKind === 'net')) {
    const net = tel.net || { rxText: '0 KB/s', txText: '0 KB/s', history: [] };
    topText = '实时网速';
    mainText = `↓ ${net.rxText || '0 KB/s'}`;
    subText = `↑ ${net.txText || '0 KB/s'}`;
    history = net.history || null;
    accent = '#06b6d4';
  } else if (t === 'gpu' || (t === 'widget' && s.widgetKind === 'gpu')) {
    const gpu = tel.gpu || { load: 24, temp: 45, memPct: 30, history: [] };
    topText = `GPU ${gpu.temp || 45}°C`;
    mainText = `${gpu.load || 0}%`;
    subText = `VRAM ${gpu.memPct || 0}%`;
    progressPct = gpu.load || 0;
    history = gpu.history || null;
    accent = '#10b981';
  } else if (t === 'pomodoro' || (t === 'widget' && s.widgetKind === 'pomodoro')) {
    const p = tel.pomodoro || { formatted: '25:00', phaseText: '专注', progressPct: 0 };
    topText = `🍅 ${p.phaseText || '专注'}`;
    mainText = p.formatted || p.timeText || '25:00';
    subText = p.running ? '计时中' : '已暂停';
    progressPct = p.progressPct || 0;
    accent = '#f43f5e';
  } else if (t === 'volume' || t === 'audio') {
    const lvl = audio.volume !== undefined ? audio.volume : (audio.level || 0);
    topText = audio.isMute ? '已静音' : '主音量';
    mainText = audio.isMute ? 'MUTE' : `${lvl}%`;
    subText = 'WASAPI';
    progressPct = audio.isMute ? 0 : lvl;
    accent = audio.isMute ? '#ef4444' : '#3b82f6';
  } else if (t === 'page') {
    topText = '当前页码';
    mainText = pageLabel || '1/1';
    subText = s.label || '页面导航';
    accent = '#64748b';
  } else {
    mainText = s.label || '';
  }

  const visualHash = [
    t, s.color || '#263238', topText, mainText, subText, progressPct,
    history ? history.slice(-6).join(',') : '',
  ].join('|');

  return {
    row,
    type: t,
    bgColor: s.color || '#1e293b',
    topText,
    mainText,
    subText,
    accent,
    progressPct,
    history,
    visualHash,
  };
}

module.exports = {
  RuntimeStateStore,
  computeBadgeModel,
  computeRenderModel,
  computeStripRenderModel,
};
