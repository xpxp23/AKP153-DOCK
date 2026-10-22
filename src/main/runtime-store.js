'use strict';
/**
 * Unidirectional Data Flow Engine: SpecStore & RuntimeStateStore (v0.10.6)
 *
 * 核心设计目标：
 * 1. 彻底分离「静态持久化配置 (SpecStore)」与「运行时动态状态树 (RuntimeStateStore)」。
 * 2. 任何进程存活监控、前台窗口状态、系统音量/静音、SMTC 媒体播放状态、插件遥测更新只写入 RuntimeStateStore，
 *    绝不直接污染或依赖会被 config.save() 覆盖的静态 Spec 对象。
 * 3. 提供前后端同构的纯函数 computeRenderModel(spec, runtimeState, globalState)，
 *    生成包含最终标题、背景色、图标、右上角状态角标、音量动态 Glyph、图层编排数据与 Dirty-Rect 视觉哈希 (visualHash) 的唯一 RenderModel，
 *    同时驱动 UI 网格预览与硬件 LCD 推流，从根源上杜绝拓展坞与驱动显示不一致的问题。
 */

const EventEmitter = require('events');

class RuntimeStateStore extends EventEmitter {
  constructor() {
    super();
    // 按键级运行时状态: Map<string ("pageId:row,col"), KeyRuntimeState>
    this.keyStates = new Map();
    // 侧屏级运行时状态: Map<string ("pageId:slot"), StripRuntimeState>
    this.stripStates = new Map();
    // 全局共享上下文状态 (音量、静音、前台进程、SMTC 媒体、系统遥测、插件缓存)
    this.globalState = {
      audio: { level: 60, isMute: false, updatedAt: 0 },
      foreground: { processName: '', title: '', pid: 0, updatedAt: 0 },
      runningProcs: [],
      media: { title: '', artist: '', status: 'Stopped', updatedAt: 0 },
      telemetry: {},
      pluginRenderCache: {}, // pluginId::instanceKey -> { data, updatedAt, intervalMs }
      hardwareModel: 'akp153',
      activeTransition: null,
    };
    // Dirty-Rect 差量哈希表: Map<string ("pageId:row,col" | "strip:pageId:slot"), string (visualHash)>
    this.lastVisualHashes = new Map();
  }

  _cellId(pageId, row, col) {
    return `${pageId || 'default'}:${row},${col}`;
  }

  getKeyState(pageId, row, col) {
    const id = this._cellId(pageId, row, col);
    if (!this.keyStates.has(id)) {
      this.keyStates.set(id, {
        activeState: 0,          // 0: 状态1 (待机/默认), 1: 状态2 (运行中/激活)
        windowSubState: 'not_running', // 'not_running' | 'background' | 'foreground'
        graceUntil: 0,           // 启动或最小化过渡宽限期时间戳
        everSeenRunning: false,  // 是否已捕获到进程启动
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

  /**
   * 导出指定页面的全部按键运行时状态快照（用于切页、重载配置或渲染进程初始化时一次性同步）
   */
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

  /**
   * 将主进程或配置加载后的运行时状态合并回页面 keys 对象（兼容现有渲染器读取 _activeState / _windowSubState）
   */
  attachRuntimeToPage(page) {
    if (!page || !page.keys) return page;
    for (const [posKey, spec] of Object.entries(page.keys)) {
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
    this.globalState[section] = Object.assign({}, prev, payload, { updatedAt: Date.now() });
    this.emit('globalStateChanged', { section, data: this.globalState[section] });
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

  /**
   * Dirty-Rect 差量判定：比对当前格子的 visualHash 与上一次推送给硬件的哈希
   * 若一致则无需重复编码 JPEG 与发送 HID 报文
   */
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

/**
 * 纯函数：统一计算按键的双态/动态角标 (Badge)
 * 严格遵循单向数据流优先级，彻底杜绝空角标状态回退到被污染的静态 spec.badge
 */
function computeBadgeModel(spec, keyRuntime = {}, globalState = {}) {
  if (!spec) return null;
  const activeState = typeof keyRuntime.activeState === 'number'
    ? keyRuntime.activeState
    : (Number(spec._activeState) || 0);
  const windowSubState = keyRuntime.windowSubState || spec._windowSubState || 'not_running';

  // 兼容旧版预设字段 (如 badge2 / color2 或定义了 badgeState1/2 但漏写 badgeToggle)
  const hasExplicitStateBadges = !!(
    spec.badgeToggle ||
    (spec.badgeState1 && typeof spec.badgeState1 === 'object') ||
    (spec.badgeState2 && typeof spec.badgeState2 === 'object') ||
    typeof spec.badge2 === 'string'
  );

  // 1. 针对开启了进程/窗口监控的 app 按键或双态按键
  const isMonitoredApp = spec.type === 'app' && (spec.appMonitor || spec.toggleAction);
  const isToggleKey = !!spec.toggleAction || isMonitoredApp;

  if (isToggleKey && hasExplicitStateBadges) {
    // 特殊子态：当监控模式为 window (窗口前台感知) 且进程已运行但处于后台最小化/非焦点时
    if (
      spec.type === 'app' &&
      (spec.appMonitorMode || 'window') === 'window' &&
      windowSubState === 'background'
    ) {
      const sBg = spec.badgeStateBg || null;
      const bgText = sBg && typeof sBg.text === 'string' ? sBg.text.trim() : '后台';
      if (!bgText) return null;
      return {
        text: bgText,
        bg: (sBg && sBg.bg) || '#d97706',
        color: (sBg && sBg.color) || '#ffffff',
        stateTag: 'background',
      };
    }

    const s1 = Object.assign(
      {
        text: spec.type === 'app' ? '待机' : (spec.badge || ''),
        bg: spec.badgeBg || '#475569',
        color: spec.badgeColor || '#ffffff',
      },
      spec.badgeState1 || {}
    );
    const s2 = Object.assign(
      {
        text: spec.badge2 || (spec.type === 'app' ? '运行中' : 'ON'),
        bg: spec.color2 || '#10b981',
        color: '#ffffff',
      },
      spec.badgeState2 || {}
    );

    const chosen = activeState === 1 ? s2 : s1;
    const text = String(chosen.text !== undefined ? chosen.text : '').trim();
    // 关键修复：当双态角标某一状态明确设为空字符串 ""（如“🟢 运行中 / 无”预设下的待机态）时，
    // 直接返回 null（不显示角标），严禁向下穿透读取静态 spec.badge！
    if (!text) return null;
    return {
      text,
      bg: chosen.bg || (activeState === 1 ? '#10b981' : '#475569'),
      color: chosen.color || '#ffffff',
      stateTag: activeState === 1 ? 'state2' : 'state1',
    };
  }

  // 2. 针对系统静音切换键 (volume + action === 'mute') 的实时联动角标
  if (spec.type === 'volume' && spec.action === 'mute' && globalState.audio) {
    const isMute = !!globalState.audio.isMute;
    if (hasExplicitStateBadges) {
      const s1 = spec.badgeState1 || { text: '发音', bg: '#1565c0', color: '#ffffff' };
      const s2 = spec.badgeState2 || { text: '静音', bg: '#c62828', color: '#ffffff' };
      const chosen = isMute ? s2 : s1;
      const txt = String(chosen.text || '').trim();
      return txt ? { text: txt, bg: chosen.bg || '#1565c0', color: chosen.color || '#ffffff', stateTag: isMute ? 'mute' : 'unmute' } : null;
    }
  }

  // 3. 针对普通双态按键（未配置自定义 badgeState1/2，但开启了 toggleAction）
  if (spec.toggleAction && !hasExplicitStateBadges) {
    if (spec.type === 'app') {
      if ((spec.appMonitorMode || 'window') === 'window' && windowSubState === 'background') {
        return { text: '后台', bg: '#d97706', color: '#ffffff', stateTag: 'background' };
      }
      return activeState === 1
        ? { text: '运行中', bg: '#10b981', color: '#ffffff', stateTag: 'state2' }
        : { text: '待机', bg: '#475569', color: '#ffffff', stateTag: 'state1' };
    }
  }

  // 4. 静态单态角标
  if (spec.badgeToggle === false && spec.badge) {
    const staticText = String(spec.badge || '').trim();
    if (!staticText) return null;
    return {
      text: staticText,
      bg: spec.badgeBg || '#ef4444',
      color: spec.badgeColor || '#ffffff',
      stateTag: 'static',
    };
  }

  const fallbackText = String(spec.badge || '').trim();
  if (!fallbackText) return null;
  return {
    text: fallbackText,
    bg: spec.badgeBg || '#ef4444',
    color: spec.badgeColor || '#ffffff',
    stateTag: 'static',
  };
}

/**
 * 纯函数：计算按键的完整视觉渲染模型 (RenderModel)
 * 供驱动 DOM 网格、Canvas 渲染器与 Offscreen/Worker 管线共同消费
 */
function computeRenderModel(spec, keyRuntime = {}, globalState = {}) {
  if (!spec) {
    return {
      empty: true,
      visualHash: 'empty',
    };
  }

  const activeState = typeof keyRuntime.activeState === 'number'
    ? keyRuntime.activeState
    : (Number(spec._activeState) || 0);
  const windowSubState = keyRuntime.windowSubState || spec._windowSubState || 'not_running';
  const isState2 = !!spec.toggleAction && activeState === 1;

  const title = isState2 && spec.label2 ? String(spec.label2) : String(spec.label || '');
  const bgColor = isState2 && spec.color2
    ? spec.color2
    : (spec.color || '#1e293b');
  const icon = isState2 && spec.icon2 ? spec.icon2 : (spec.icon || '');

  // 统一动态 Glyph（修复原先驱动网格 volume 写死 🔊 而硬件根据静音状态显示 🔇 的割裂问题）
  let dynamicGlyph = spec.glyph || '';
  if (!dynamicGlyph && spec.type === 'volume') {
    const isMute = !!(globalState.audio && globalState.audio.isMute);
    if (spec.action === 'down') dynamicGlyph = '🔉';
    else if (spec.action === 'mute') dynamicGlyph = isMute ? '🔇' : '🔊';
    else if (spec.action === 'switch_output') dynamicGlyph = '🎧';
    else if (spec.action === 'app_mute' || spec.action === 'app_up' || spec.action === 'app_down') dynamicGlyph = '🎚️';
    else dynamicGlyph = isMute ? '🔇' : '🔊';
  }

  const badge = computeBadgeModel(spec, { activeState, windowSubState }, globalState);

  // 可视化小组件图层编排数据 (Widget Studio Layers)
  const widgetLayers = Array.isArray(spec.widgetLayers) ? spec.widgetLayers : null;
  const refreshIntervalMs = Math.max(150, Math.min(600000, Number(spec.refreshIntervalMs) || 2500));

  const model = {
    empty: false,
    type: spec.type || 'none',
    title,
    bgColor,
    icon,
    dynamicGlyph,
    badge,
    activeState,
    windowSubState,
    colSpan: Math.max(1, Math.min(5, Number(spec.colSpan) || 1)),
    fontSize: Number(spec.fontSize) || 14,
    textColor: spec.textColor || '#ffffff',
    textAlign: spec.textAlign || 'center',
    titlePos: spec.titlePos || 'bottom',
    hideTitle: !!spec.hideTitle,
    iconScale: Number(spec.iconScale) || 100,
    offsetX: Number(spec.offsetX) || 0,
    offsetY: Number(spec.offsetY) || 0,
    bgGradient: spec.bgGradient || '',
    widgetKind: spec.widgetKind || '',
    pluginId: spec.pluginId || '',
    widgetLayers,
    refreshIntervalMs,
  };

  // 计算轻量级确定性签名，用于 Dirty-Rect 差量刷新判定
  const iconSig = icon ? `${icon.length}:${icon.slice(0, 24)}:${icon.slice(-16)}` : '';
  const badgeSig = badge ? `${badge.text}|${badge.bg}|${badge.color}` : '';
  const layerSig = widgetLayers ? JSON.stringify(widgetLayers) : '';
  model.visualHash = [
    model.type,
    model.title,
    model.bgColor,
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
    layerSig,
  ].join('§');

  return model;
}

module.exports = {
  RuntimeStateStore,
  computeBadgeModel,
  computeRenderModel,
};
