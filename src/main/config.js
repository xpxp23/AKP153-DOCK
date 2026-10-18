'use strict';
const fs = require('fs');
const path = require('path');

const FILE = process.env.AKP153_CONFIG
  ? path.resolve(process.env.AKP153_CONFIG)
  : path.join(__dirname, '..', '..', 'config.json');

const clone = (o) => JSON.parse(JSON.stringify(o));

const DEFAULT_STRIPS = {
  '0': { type: 'clock', label: '', color: '#263238' },
  '1': { type: 'text', label: '', color: '#1a237e' },
  '2': { type: 'page', label: '', color: '#263238' },
};

const DEFAULT_GRADIENT = {
  enabled: false,
  from: '#1565c0',
  to: '#6a1b9a',
  angle: 135,
};

const DEFAULTS = {
  version: 2,
  brightness: 80,
  rotate: 'ccw',
  idleSleepMinutes: 5,
  sleepMode: 'zeros-last',
  openAtLogin: true,
  theme: 'light',
  window: null,
  // 交互偏好与系统行为
  // 'smart': 智能单键任务栏模式(启动/置顶/最小化切换+真实状态监控) | 'graceful': 优雅关闭双态(WM_CLOSE) | 'dual': 强退双态(taskkill) | 'single': 普通单动作
  appDropMode: 'dual',
  keyDebounceMs: 100,        // 物理按键连击防抖与冷却时间 (ms)
  closeToTray: true,         // 点击窗口关闭按钮时最小化到托盘
  autoSwitchPage: true,      // 按前台活动应用或窗口标题正则自动切换关联页面 (Auto-Profile Switching)
  weatherCity: 'Auto',       // 动态天气组件默认城市
  pomodoroMinutes: 25,       // 番茄钟默认专注分钟数
  hudEnabled: true,          // 全屏游戏/后台切页、调音量、启停宏时顶部毛玻璃 HUD 胶囊提示
  currentProfile: 'office',  // 当前激活的顶层 Profile ID
  profiles: [],              // 多套顶层配置文件 (办公/直播/剪辑/游戏模式)
  pages: [],
  currentPage: null,
  pageSnapshots: [],
  library: [],
};

function buildPresetProfilePages(presetKey) {
  if (presetKey === 'stream') {
    return [{
      id: 'stream_main',
      name: '直播导播台',
      parent: null,
      autoApp: 'obs64.exe',
      autoTitle: 'OBS',
      gradient: { enabled: true, from: '#311042', to: '#0f172a', angle: 135 },
      buttons: {
        '0,0': { type: 'hotkey', label: '主画面景', hotkey: 'Ctrl+Alt+F1', target: 'Ctrl+Alt+F1', color: '#7c3aed', badge: 'SCENE 1', pluginConfig: {} },
        '0,1': { type: 'hotkey', label: '游戏全屏', hotkey: 'Ctrl+Alt+F2', target: 'Ctrl+Alt+F2', color: '#6d28d9', badge: 'SCENE 2', pluginConfig: {} },
        '0,2': { type: 'hotkey', label: '中场休息', hotkey: 'Ctrl+Alt+F3', target: 'Ctrl+Alt+F3', color: '#4c1d95', badge: 'BRB', pluginConfig: {} },
        '0,3': { type: 'hotkey', label: '开播/下播', hotkey: 'Ctrl+Alt+S', target: 'Ctrl+Alt+S', color: '#be123c', toggleAction: true, badge: 'LIVE', badge2: 'OFF', color2: '#15803d', action2: { type: 'hotkey', target: 'Ctrl+Alt+S' }, pluginConfig: {} },
        '0,4': { type: 'volume', action: 'switch_device', label: '切换声卡', target: '', color: '#0e7490', badge: 'AUDIO', pluginConfig: {} },
        '1,0': { type: 'volume', action: 'mute', step: 5, label: '麦克静音', color: '#991b1b', pluginConfig: {} },
        '1,1': { type: 'volume', action: 'down', step: 5, label: '音量 -5%', color: '#1e293b', pluginConfig: {} },
        '1,2': { type: 'volume', action: 'up', step: 5, label: '音量 +5%', color: '#1e293b', pluginConfig: {} },
        '1,3': { type: 'media', cmd: 'play_pause', label: '背景乐', color: '#4338ca', pluginConfig: {} },
        '1,4': { type: 'widget', widgetKind: 'pomodoro', action: 'pomodoro_toggle', label: '直播计时', color: '#0f766e', pluginConfig: {} },
        '2,4': { type: 'profile', mode: 'next', label: '切换模式', color: '#7e22ce', badge: 'PROFILE', pluginConfig: {} },
      },
      strips: clone(DEFAULT_STRIPS),
    }];
  }
  if (presetKey === 'edit') {
    return [{
      id: 'edit_main',
      name: '非编剪辑台',
      parent: null,
      autoApp: 'Adobe Premiere Pro.exe|Resolve.exe|JianyingPro.exe',
      autoTitle: 'Premiere|DaVinci Resolve|剪映',
      gradient: { enabled: true, from: '#3b1d06', to: '#0f172a', angle: 135 },
      buttons: {
        '0,0': { type: 'hotkey', label: '剃刀分割', hotkey: 'Ctrl+B', target: 'Ctrl+B', color: '#d97706', badge: 'SPLIT', pluginConfig: {} },
        '0,1': { type: 'hotkey', label: '波纹删除', hotkey: 'Shift+Delete', target: 'Shift+Delete', color: '#b91c1c', badge: 'DEL', pluginConfig: {} },
        '0,2': { type: 'hotkey', label: '标记入点', hotkey: 'I', target: 'I', color: '#0284c7', badge: 'IN', pluginConfig: {} },
        '0,3': { type: 'hotkey', label: '标记出点', hotkey: 'O', target: 'O', color: '#0284c7', badge: 'OUT', pluginConfig: {} },
        '0,4': { type: 'hotkey', label: '导出渲染', hotkey: 'Ctrl+M', target: 'Ctrl+M', color: '#15803d', badge: 'EXPORT', pluginConfig: {} },
        '1,0': { type: 'hotkey', label: '撤销', hotkey: 'Ctrl+Z', target: 'Ctrl+Z', color: '#334155', pluginConfig: {} },
        '1,1': { type: 'hotkey', label: '重做', hotkey: 'Ctrl+Shift+Z', target: 'Ctrl+Shift+Z', color: '#334155', pluginConfig: {} },
        '2,4': { type: 'profile', mode: 'next', label: '切换模式', color: '#b45309', badge: 'PROFILE', pluginConfig: {} },
      },
      strips: clone(DEFAULT_STRIPS),
    }];
  }
  if (presetKey === 'gaming') {
    return [{
      id: 'gaming_main',
      name: '游戏战术板',
      parent: null,
      autoApp: '',
      autoTitle: '',
      gradient: { enabled: true, from: '#064e3b', to: '#0f172a', angle: 135 },
      buttons: {
        '0,0': { type: 'hotkey', label: '即时回放', hotkey: 'Alt+F10', target: 'Alt+F10', color: '#059669', badge: 'REPLAY', pluginConfig: {} },
        '0,1': { type: 'hotkey', label: '录制开关', hotkey: 'Alt+F9', target: 'Alt+F9', color: '#047857', badge: 'REC', pluginConfig: {} },
        '0,2': { type: 'hotkey', label: '语音闭麦', hotkey: 'Ctrl+Shift+M', target: 'Ctrl+Shift+M', color: '#be123c', badge: 'MUTE', pluginConfig: {} },
        '0,3': { type: 'volume', action: 'switch_device', label: '耳机/音箱', target: '', color: '#0e7490', badge: 'AUDIO', pluginConfig: {} },
        '0,4': { type: 'widget', widgetKind: 'gpu', action: 'refresh', label: '显卡监控', color: '#065f46', pluginConfig: {} },
        '2,4': { type: 'profile', mode: 'next', label: '切换模式', color: '#059669', badge: 'PROFILE', pluginConfig: {} },
      },
      strips: clone(DEFAULT_STRIPS),
    }];
  }
  return [{
    id: 'p1',
    name: '主页面',
    parent: null,
    autoApp: '',
    autoTitle: '',
    gradient: clone(DEFAULT_GRADIENT),
    buttons: {},
    strips: clone(DEFAULT_STRIPS),
  }];
}

function buildDefaultProfiles(officePages, officeCurrentPage) {
  const baseOffice = Array.isArray(officePages) && officePages.length ? clone(officePages) : buildPresetProfilePages('office');
  const baseCur = officeCurrentPage || baseOffice[0].id;
  return [
    { id: 'office', name: '办公模式', icon: '💼', accent: '#3b82f6', pages: baseOffice, currentPage: baseCur },
    { id: 'stream', name: '直播模式', icon: '📡', accent: '#a855f7', pages: buildPresetProfilePages('stream'), currentPage: 'stream_main' },
    { id: 'edit',   name: '剪辑模式', icon: '🎬', accent: '#f59e0b', pages: buildPresetProfilePages('edit'),   currentPage: 'edit_main' },
    { id: 'gaming', name: '游戏模式', icon: '🎮', accent: '#10b981', pages: buildPresetProfilePages('gaming'), currentPage: 'gaming_main' },
  ];
}

let cache = null;
let lastRaw = null;      // the exact file text we last read or wrote

const DEFAULT_FILE = path.join(__dirname, '..', '..', 'config.default.json');

function readRaw() {
  try {
    if (fs.existsSync(FILE)) return fs.readFileSync(FILE, 'utf8');
    if (fs.existsSync(DEFAULT_FILE)) {
      const def = fs.readFileSync(DEFAULT_FILE, 'utf8');
      try { fs.writeFileSync(FILE, def, 'utf8'); } catch (_) {}
      return def;
    }
  } catch (e) { return null; }
  return null;
}

function newPageId() {
  return 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
}

function normalizeTags(v) {
  if (Array.isArray(v)) return v.map((t) => String(t).trim()).filter(Boolean);
  if (typeof v === 'string') return v.split(/[,，\s]+/).map((t) => t.trim()).filter(Boolean);
  return [];
}

/**
 * Normalize & migrate any raw config object (v1 or v2) into a valid v2 config structure.
 */
function normalize(rawObj) {
  const target = Object.assign({}, DEFAULTS, (rawObj && typeof rawObj === 'object') ? rawObj : {});

  if (!['ccw', 'cw', 'none'].includes(target.rotate)) {
    target.rotate = 'ccw';
  }

  // --- migrate the flat single-page layout (v1: top-level buttons/strips) ---
  if (!Array.isArray(target.pages) || !target.pages.length) {
    target.pages = [{
      id: 'p1',
      name: '主页面',
      parent: null,
      buttons: target.buttons || {},
      strips: target.strips || clone(DEFAULT_STRIPS),
    }];
  }
  delete target.buttons;
  delete target.strips;

  for (const p of target.pages) {
    if (!p.id) p.id = newPageId();
    if (!p.name) p.name = '未命名页';
    if (p.parent === undefined) p.parent = null;
    if (typeof p.autoApp !== 'string') p.autoApp = '';
    if (typeof p.autoTitle !== 'string') p.autoTitle = '';
    p.buttons = (p.buttons && typeof p.buttons === 'object') ? p.buttons : {};
    p.strips = Object.assign(clone(DEFAULT_STRIPS), p.strips || {});
    p.gradient = Object.assign(
      clone(DEFAULT_GRADIENT),
      (p.gradient && typeof p.gradient === 'object') ? p.gradient : {}
    );
    for (const st of Object.values(p.strips)) {
      if (st && typeof st === 'object') {
        st.pluginConfig = (st.pluginConfig && typeof st.pluginConfig === 'object') ? Object.assign({}, st.pluginConfig) : {};
      }
    }
    for (const s of Object.values(p.buttons)) {
      if (!s || typeof s !== 'object') continue;
      if (s.type === 'page' && !s.mode) s.mode = 'next';
      if (s.type === 'profile' && !s.mode) s.mode = s.profileId ? 'goto' : 'next';
      s.pluginConfig = (s.pluginConfig && typeof s.pluginConfig === 'object') ? Object.assign({}, s.pluginConfig) : {};
      if (s && s.toggleAction && !s.action2 && (s.act2Target || s.act2Type)) {
        s.action2 = {
          type: s.act2Type || 'command',
          target: s.act2Target || '',
          args: s.act2Args || '',
        };
        delete s.act2Type;
        delete s.act2Target;
        delete s.act2Args;
      }
    }
  }
  // a page whose parent vanished becomes a top-level page
  const ids = new Set(target.pages.map((p) => p.id));
  for (const p of target.pages) if (p.parent && !ids.has(p.parent)) p.parent = null;

  if (!target.pages.some((p) => p.id === target.currentPage)) {
    target.currentPage = target.pages[0].id;
  }
  if (!Array.isArray(target.pageSnapshots)) target.pageSnapshots = [];
  if (!Array.isArray(target.library)) target.library = [];

  // Normalize library entries & migrate any legacy page snapshots into pageSnapshots
  const cleanLib = [];
  for (const e of target.library) {
    if (!e) continue;
    if (!e.id) e.id = 'L' + Math.random().toString(36).slice(2, 10);
    if (!Array.isArray(e.tags)) e.tags = normalizeTags(e.tags || e.tag);
    if (typeof e.name !== 'string') e.name = (e.spec && e.spec.label) || '未命名';
    if (e.kind === 'page' || (!e.spec && e.page)) {
      const snapId = e.id.startsWith('PS_') ? e.id : ('PS_' + e.id.replace(/^L/, ''));
      if (!target.pageSnapshots.some((s) => s.id === snapId)) {
        target.pageSnapshots.push({
          id: snapId,
          name: e.name || '整页快照',
          tags: e.tags,
          savedAt: e.savedAt || new Date().toISOString(),
          page: e.page || { buttons: {}, strips: {} },
        });
      }
    } else {
      if (e.spec && e.spec.toggleAction && !e.spec.action2 && (e.spec.act2Target || e.spec.act2Type)) {
        e.spec.action2 = {
          type: e.spec.act2Type || 'command',
          target: e.spec.act2Target || '',
          args: e.spec.act2Args || '',
        };
        delete e.spec.act2Type;
        delete e.spec.act2Target;
        delete e.spec.act2Args;
      }
      cleanLib.push(e);
    }
  }
  target.library = cleanLib;
  if (typeof target.hudEnabled !== 'boolean') target.hudEnabled = true;

  // Normalize multi-profiles and keep active profile synchronized with top-level pages/currentPage
  if (!Array.isArray(target.profiles) || !target.profiles.length) {
    target.profiles = buildDefaultProfiles(target.pages, target.currentPage);
    target.currentProfile = 'office';
  } else {
    for (let i = 0; i < target.profiles.length; i++) {
      const prof = target.profiles[i];
      if (!prof.id) prof.id = 'prof_' + (i + 1);
      if (!prof.name) prof.name = '模式 ' + (i + 1);
      if (!prof.icon) prof.icon = '🗂️';
      if (!prof.accent) prof.accent = '#3b82f6';
      if (!Array.isArray(prof.pages) || !prof.pages.length) {
        prof.pages = clone(target.pages);
      }
      if (!prof.currentPage || !prof.pages.some((pg) => pg.id === prof.currentPage)) {
        prof.currentPage = prof.pages[0].id;
      }
    }
  }
  if (!target.currentProfile || !target.profiles.some((p) => p.id === target.currentProfile)) {
    target.currentProfile = target.profiles[0].id;
  }
  const activeProf = target.profiles.find((p) => p.id === target.currentProfile);
  if (activeProf) {
    activeProf.pages = clone(target.pages);
    activeProf.currentPage = target.currentPage;
  }

  target.version = DEFAULTS.version;
  return target;
}

function load() {
  if (cache) return cache;
  const raw = readRaw();
  lastRaw = raw;
  let saved = {};
  if (raw) {
    try {
      saved = JSON.parse(raw);
    } catch (e) {
      // Self-healing recovery: preserve corrupted file and recover from .bak
      try {
        if (raw.trim().length > 0) {
          fs.writeFileSync(`${FILE}.corrupted.${Date.now()}.json`, raw, 'utf8');
        }
      } catch (_) {}
      const bakFile = FILE + '.bak';
      if (fs.existsSync(bakFile)) {
        try {
          const bakRaw = fs.readFileSync(bakFile, 'utf8');
          saved = JSON.parse(bakRaw);
          fs.writeFileSync(FILE, bakRaw, 'utf8');
          lastRaw = bakRaw;
        } catch (_) {
          saved = {};
        }
      }
    }
  }

  cache = normalize(saved);
  return cache;
}

/** Drop the in-memory copy so the next load() re-reads the file. */
function invalidate() {
  cache = null;
}

/**
 * Has the file been changed by somebody other than us?
 */
function changedOnDisk() {
  const raw = readRaw();
  if (raw == null) return false;
  if (lastRaw != null && raw === lastRaw) return false;
  return true;
}

/** The page the device and the editor are both showing. */
function currentPage() {
  const cfg = load();
  return cfg.pages.find((p) => p.id === cfg.currentPage) || cfg.pages[0];
}

/** Pages that can be reached from `id`: its children, or the top level for null. */
function childPages(id) {
  return load().pages.filter((p) => p.parent === id);
}

/** Top-level pages in order, then their children depth-first. */
function pageTree() {
  const cfg = load();
  const out = [];
  const walk = (parent, depth) => {
    for (const p of cfg.pages.filter((x) => x.parent === parent)) {
      out.push({ page: p, depth });
      walk(p.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

function syncActiveProfile(cfg) {
  if (!cfg || !Array.isArray(cfg.profiles) || !Array.isArray(cfg.pages)) return;
  const active = cfg.profiles.find((p) => p.id === cfg.currentProfile) || cfg.profiles[0];
  if (active) {
    active.pages = clone(cfg.pages);
    active.currentPage = cfg.currentPage;
  }
}

function save(cfg) {
  syncActiveProfile(cfg);
  const normalized = normalize(cfg);
  cache = normalized;
  const text = JSON.stringify(normalized, (key, value) => key.startsWith('_') ? undefined : value, 2);
  if (lastRaw !== null && text === lastRaw && fs.existsSync(FILE)) {
    try {
      if (!fs.existsSync(FILE + '.bak')) fs.writeFileSync(FILE + '.bak', text, 'utf8');
    } catch (_) {}
    return true;
  }
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, text, 'utf8');
  fs.renameSync(tmp, FILE);
  try {
    fs.writeFileSync(FILE + '.bak', text, 'utf8');
  } catch (_) {}
  lastRaw = text;          // remember exactly what we wrote - see changedOnDisk()
  return true;
}

function switchProfile(targetRef, customCfg) {
  const cfg = customCfg || load();
  syncActiveProfile(cfg);
  if (!Array.isArray(cfg.profiles) || !cfg.profiles.length) {
    cfg.profiles = buildDefaultProfiles(cfg.pages, cfg.currentPage);
  }
  let nextProf = cfg.profiles.find((p) => p.id === targetRef || p.name === targetRef);
  if (!nextProf && (targetRef === '__next__' || targetRef === 'next' || !targetRef)) {
    const idx = cfg.profiles.findIndex((p) => p.id === cfg.currentProfile);
    nextProf = cfg.profiles[(idx + 1) % cfg.profiles.length];
  }
  if (!nextProf && targetRef === 'prev') {
    const idx = Math.max(0, cfg.profiles.findIndex((p) => p.id === cfg.currentProfile));
    nextProf = cfg.profiles[(idx - 1 + cfg.profiles.length) % cfg.profiles.length];
  }
  if (!nextProf) return null;

  cfg.currentProfile = nextProf.id;
  cfg.pages = clone(nextProf.pages);
  cfg.currentPage = (nextProf.currentPage && cfg.pages.some((pg) => pg.id === nextProf.currentPage))
    ? nextProf.currentPage
    : cfg.pages[0].id;
  save(cfg);
  return nextProf;
}

function createProfile(opts = {}, customCfg) {
  const cfg = customCfg || load();
  syncActiveProfile(cfg);
  const id = 'prof_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  let pages;
  if (opts.cloneCurrent) {
    pages = clone(cfg.pages);
  } else if (opts.preset) {
    pages = buildPresetProfilePages(opts.preset);
  } else {
    pages = buildPresetProfilePages('office');
  }
  const newProf = {
    id,
    name: String(opts.name || '新模式').trim(),
    icon: opts.icon || '🗂️',
    accent: opts.accent || '#3b82f6',
    pages,
    currentPage: pages[0].id,
  };
  cfg.profiles.push(newProf);
  if (opts.switchNow !== false) {
    cfg.currentProfile = newProf.id;
    cfg.pages = clone(newProf.pages);
    cfg.currentPage = newProf.currentPage;
  }
  save(cfg);
  return newProf;
}

function renameProfile(profileId, newName, newIcon, newAccent, customCfg) {
  const cfg = customCfg || load();
  const prof = (cfg.profiles || []).find((p) => p.id === profileId || p.name === profileId);
  if (!prof) return null;
  if (newName && String(newName).trim()) prof.name = String(newName).trim();
  if (newIcon) prof.icon = newIcon;
  if (newAccent) prof.accent = newAccent;
  save(cfg);
  return prof;
}

function deleteProfile(profileId, customCfg) {
  const cfg = customCfg || load();
  if (!Array.isArray(cfg.profiles) || cfg.profiles.length <= 1) return false;
  const idx = cfg.profiles.findIndex((p) => p.id === profileId || p.name === profileId);
  if (idx < 0) return false;
  const wasActive = cfg.currentProfile === cfg.profiles[idx].id;
  cfg.profiles.splice(idx, 1);
  if (wasActive) {
    const first = cfg.profiles[0];
    cfg.currentProfile = first.id;
    cfg.pages = clone(first.pages);
    cfg.currentPage = first.currentPage || cfg.pages[0].id;
  }
  save(cfg);
  return true;
}

function get(key) {
  const cfg = load();
  return key ? cfg[key] : cfg;
}

function set(key, value) {
  const cfg = load();
  cfg[key] = value;
  save(cfg);
  return cfg;
}

module.exports = {
  load, save, get, set, normalize, DEFAULTS, FILE,
  currentPage, childPages, pageTree, newPageId, DEFAULT_STRIPS, DEFAULT_GRADIENT,
  invalidate, changedOnDisk, normalizeTags, readRaw,
  switchProfile, createProfile, renameProfile, deleteProfile, buildPresetProfilePages,
};
