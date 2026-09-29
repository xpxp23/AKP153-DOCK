'use strict';
/* global api */

const KEY_COLS = 5;   // pressable columns
const ROWS = 3;
const TOTAL_COLS = 6; // last column = display strips

let cfg = null;
let selected = null;  // {row, col}
let clipboardKey = null; // { ...spec } 复制/剪切/粘贴剪贴板
let currentIconCategory = 'all';
let currentCustomSubCategory = '全部';
let ipContextTarget = null;
const DEFAULT_CUSTOM_CATEGORIES = ['全部', '常用', '办公开发', '游戏娱乐', '影音多媒体', '系统工具'];
const iconCache = new Map();
const activeLoopKeyIds = new Set();

if (typeof api !== 'undefined' && api.on) {
  api.on('macro:loopState', (payload) => {
    if (!payload) return;
    const { keyId, isRunning, context } = payload;
    const rc = context ? `${context.row},${context.col}` : (keyId && keyId.includes(':') ? keyId.split(':')[1] : keyId);
    if (isRunning) {
      if (keyId) activeLoopKeyIds.add(keyId);
      if (rc) activeLoopKeyIds.add(rc);
    } else {
      if (keyId) activeLoopKeyIds.delete(keyId);
      if (rc) activeLoopKeyIds.delete(rc);
    }
    refreshGrid();
    if (context && context.row !== undefined && context.col !== undefined) {
      pushKey(context.row, context.col);
    }
  });
}

const $ = (id) => document.getElementById(id);

const ACTION_TEMPLATES = [
  { id: '', name: '⚡ 常用快捷动作模板…' },
  {
    id: 'vol_up', name: '🔊 音量增大',
    spec: {
      type: 'command', label: '音量 +',
      target: 'powershell -ExecutionPolicy Bypass -WindowStyle Hidden -Command "(New-Object -ComObject WScript.Shell).SendKeys([char]175)"',
      color: '#1565c0', iconName: '音量+'
    }
  },
  {
    id: 'vol_down', name: '🔉 音量减小',
    spec: {
      type: 'command', label: '音量 -',
      target: 'powershell -ExecutionPolicy Bypass -WindowStyle Hidden -Command "(New-Object -ComObject WScript.Shell).SendKeys([char]174)"',
      color: '#1565c0', iconName: '音量-'
    }
  },
  {
    id: 'vol_mute', name: '🔇 静音 / 恢复',
    spec: {
      type: 'command', label: '静音',
      target: 'powershell -ExecutionPolicy Bypass -WindowStyle Hidden -Command "(New-Object -ComObject WScript.Shell).SendKeys([char]173)"',
      color: '#c62828', iconName: '静音'
    }
  },
  {
    id: 'media_play', name: '⏯️ 播放 / 暂停',
    spec: {
      type: 'command', label: '播放/暂停',
      target: 'powershell -ExecutionPolicy Bypass -WindowStyle Hidden -Command "(New-Object -ComObject WScript.Shell).SendKeys([char]179)"',
      color: '#2e7d32', iconName: '播放/暂停'
    }
  },
  {
    id: 'media_next', name: '⏭️ 下一首',
    spec: {
      type: 'command', label: '下一曲',
      target: 'powershell -ExecutionPolicy Bypass -WindowStyle Hidden -Command "(New-Object -ComObject WScript.Shell).SendKeys([char]176)"',
      color: '#00838f', iconName: '下一曲'
    }
  },
  {
    id: 'media_prev', name: '⏮️ 上一首',
    spec: {
      type: 'command', label: '上一曲',
      target: 'powershell -ExecutionPolicy Bypass -WindowStyle Hidden -Command "(New-Object -ComObject WScript.Shell).SendKeys([char]177)"',
      color: '#00838f', iconName: '上一曲'
    }
  },
  {
    id: 'sys_lock', name: '🔒 一键锁屏',
    spec: {
      type: 'command', label: '锁屏',
      target: 'rundll32.exe user32.dll,LockWorkStation',
      color: '#d32f2f', iconName: '锁屏'
    }
  },
  {
    id: 'sys_snip', name: '✂️ 截图工具',
    spec: {
      type: 'command', label: '截图',
      target: 'explorer.exe ms-screenclip:',
      color: '#e65100', iconName: '截图/裁剪'
    }
  },
  {
    id: 'sys_taskmgr', name: '📊 任务管理器',
    spec: {
      type: 'command', label: '任务管理',
      target: 'taskmgr.exe',
      color: '#455a64', iconName: '任务管理'
    }
  },
  {
    id: 'sys_desktop', name: '🖥️ 显示桌面',
    spec: {
      type: 'command', label: '桌面',
      target: 'powershell -ExecutionPolicy Bypass -WindowStyle Hidden -Command "(New-Object -ComObject Shell.Application).MinimizeAll()"',
      color: '#37474f', iconName: '显示器/桌面'
    }
  },
  {
    id: 'tool_qr', name: '📷 一键扫码 / 二维码解码',
    spec: {
      type: 'qr_decode', label: '扫码解码',
      target: 'qr_decode',
      color: '#00838f', iconName: '二维码/扫码'
    }
  }
];


// ---------------------------------------------------------------- page tree

/* 页面树：一个键可以设成「切页」（下一页 / 上一页 / 跳到某页 / 回上级 / 回主页）。
 * 子页（parent 非空）的右下角会自动长出一个「返回」键，退出后你原来放在
 * 那个角上的按键恢复显示 —— 位置永远一样，闭眼也按得到。
 * 编辑器与设备永远显示同一页：你在改哪一页，设备上就是哪一页。 */

const BACK = { row: 2, col: 4 };

function curPage() {
  if (!cfg || !cfg.pages || !cfg.pages.length) {
    return { id: 'none', name: '', parent: null, buttons: {}, strips: {}, gradient: { enabled: false, from: '#1565c0', to: '#6a1b9a', angle: 135 } };
  }
  const p = cfg.pages.find((p) => p.id === cfg.currentPage) || cfg.pages[0];
  if (!p.gradient) {
    p.gradient = { enabled: false, from: '#1565c0', to: '#6a1b9a', angle: 135 };
  }
  return p;
}
function pageButtons() { return curPage().buttons; }
function pageStrips() { return curPage().strips; }
function childPages(id) { return (cfg.pages || []).filter((p) => p.parent === id); }
function pageById(id) { return (cfg.pages || []).find((p) => p.id === id) || null; }

/** Depth-first, top level first - this is the order 下一页/上一页 walks. */
function pageTree() {
  const out = [];
  const walk = (parent, depth) => {
    for (const p of (cfg.pages || []).filter((x) => x.parent === parent)) {
      out.push({ page: p, depth });
      walk(p.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

function isBackCell(row, col) {
  return !!(curPage().parent && row === BACK.row && col === BACK.col);
}

/** What the device should draw on the automatic back key. */
function backSpec() {
  return { type: 'back', label: '返回', color: '#37474f', textColor: '#ffffff', fontSize: 17 };
}

// ------------------------------------------------------------------- helpers

function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), 3200);
}

function contrast(hex) {
  const h = (hex || '#37474f').replace('#', '');
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 > 140 ? '#1f2430' : '#ffffff';
}

function glyphFor(type) {
  switch (type) {
    case 'multi':
    case 'macro': return '🎛️';
    case 'app': return '▶';
    case 'hotkey': return '⌨';
    case 'folder': return '📁';
    case 'file': return '📄';
    case 'url': return '🌐';
    case 'command': return '⌘';
    case 'ps1': return 'PS';
    case 'page': return '↦';
    case 'back': return '←';
    case 'qr_decode':
    case 'qr': return '📷';
    default: return '';
  }
}

/** The type select used to show raw values (`app`, `ps1`...) - unreadable in an
 *  otherwise Chinese UI. */
const TYPE_NAMES = {
  multi: '🎛️ 复合动作 (多操作宏 / 键鼠编排)',
  app: '应用程序 / 快捷方式',
  hotkey: '虚拟快捷键 / 组合键宏',
  folder: '文件夹',
  url: '网址',
  command: '命令行',
  ps1: 'PowerShell 脚本',
  file: '其它文件（用默认程序打开）',
  page: '切换页面（下一页 / 跳转 / 返回上级）',
  qr_decode: '📷 屏幕/剪贴板二维码解码',
};
const TYPE_SHORT = {
  multi: '宏', app: '应用', hotkey: '快捷键', folder: '文件夹', url: '网址',
  command: '命令', ps1: '脚本', file: '文件', page: '切页', qr_decode: '扫码',
};

/** Collapsible inspector sections keep their state across re-renders. */
let secOpen = { action: true, look: false, more: false };
const clone = (o) => JSON.parse(JSON.stringify(o));

// ------------------------------------------------------- device image render

function drawBase(ctx, size, spec) {
  if (spec.color2) {
    const g = ctx.createLinearGradient(0, 0, 0, size);
    g.addColorStop(0, spec.color || '#37474f');
    g.addColorStop(1, spec.color2);
    ctx.fillStyle = g;
  } else {
    ctx.fillStyle = spec.color || '#37474f';
  }
  ctx.fillRect(0, 0, size, size);
}

async function loadImage(src) {
  if (iconCache.has(src)) return iconCache.get(src);
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => { iconCache.set(src, img); resolve(img); };
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

let cachedGradientKey = '';
let cachedGradientCanvas = null;

function getGlobalGradientCanvas(gradient) {
  if (!gradient || !gradient.enabled) return null;
  const key = `${gradient.from}_${gradient.to}_${gradient.angle}`;
  if (cachedGradientCanvas && cachedGradientKey === key) return cachedGradientCanvas;

  const w = TOTAL_COLS * 96; // 6 * 96 = 576 (覆盖包含副屏的全部 6 列)
  const h = ROWS * 96;       // 3 * 96 = 288
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');

  const angle = (Number(gradient.angle) || 0) % 360;
  const rad = ((angle - 90) * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const L = Math.abs(w * cos) + Math.abs(h * sin);
  const cx = w / 2;
  const cy = h / 2;
  const x0 = cx - (L / 2) * cos;
  const y0 = cy - (L / 2) * sin;
  const x1 = cx + (L / 2) * cos;
  const y1 = cy + (L / 2) * sin;

  const g = ctx.createLinearGradient(x0, y0, x1, y1);
  g.addColorStop(0, gradient.from || '#1565c0');
  g.addColorStop(1, gradient.to || '#6a1b9a');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);

  cachedGradientKey = key;
  cachedGradientCanvas = c;
  return c;
}

function sampleGradientContrast(grad, row, col) {
  const master = getGlobalGradientCanvas(grad);
  if (!master) return '#ffffff';
  try {
    const ctx = master.getContext('2d');
    const p = ctx.getImageData(col * 96 + 48, row * 96 + 48, 1, 1).data;
    const bri = (p[0] * 299 + p[1] * 587 + p[2] * 114) / 1000;
    return bri > 140 ? '#1f2430' : '#ffffff';
  } catch (e) {
    return '#ffffff';
  }
}

/**
 * 智能自动换行与字号自适应
 * @param {CanvasRenderingContext2D} ctx
 * @param {string} text 待排版文本
 * @param {number} maxW 最大宽度
 * @param {number} maxLines 最多容纳行数
 * @param {number} baseFontSize 基准字号
 * @param {string} fontFamily 字体族
 */
function wrapAndFitText(ctx, text, maxW, maxLines, baseFontSize, fontFamily) {
  if (!text) return { lines: [], fontSize: baseFontSize };
  const rawParas = String(text).split('\n');

  function splitParaIntoLines(para, fSize) {
    ctx.font = `${fSize}px ${fontFamily}`;
    if (!para) return [''];
    if (ctx.measureText(para).width <= maxW) return [para];

    const out = [];
    let cur = '';
    for (let i = 0; i < para.length; i++) {
      const ch = para[i];
      const test = cur + ch;
      if (ctx.measureText(test).width <= maxW) {
        cur = test;
      } else {
        if (cur) out.push(cur);
        cur = ch;
      }
    }
    if (cur) out.push(cur);
    return out;
  }

  let fs = baseFontSize;
  const minFs = Math.max(8, Math.round(baseFontSize * 0.65));

  let lines = [];
  while (fs >= minFs) {
    lines = [];
    for (const p of rawParas) {
      lines.push(...splitParaIntoLines(p, fs));
    }
    if (lines.length <= maxLines) break;
    fs -= 1;
  }

  if (lines.length > maxLines) {
    lines = lines.slice(0, maxLines);
    ctx.font = `${fs}px ${fontFamily}`;
    let last = lines[maxLines - 1];
    while (last.length > 0 && ctx.measureText(last + '…').width > maxW) {
      last = last.slice(0, -1);
    }
    lines[maxLines - 1] = last ? last + '…' : '…';
  }

  return { lines, fontSize: fs };
}

/**
 * Draw one key. Style knobs (all optional, with sane defaults):
 *   color / color2   background (color2 turns it into a vertical gradient)
 *   textColor        label colour, auto-contrast when omitted
 *   fontSize         label size as a percentage of the tile (default 17)
 *   iconScale        icon box as a percentage of the tile (default 62)
 *   labelPos         'bottom' | 'center' | 'top'
 *   badge            overlay badge text (✓, ✕, 1, A, etc.)
 */
const BADGE_TOGGLE_PRESETS = [
  { name: '🟢 运行中 / 无', s1: { text: '', bg: '#546e7a', color: '#ffffff' }, s2: { text: '运行中', bg: '#107c41', color: '#ffffff' } },
  { name: '🟢 运行中 / ⚪ 未运行', s1: { text: '未运行', bg: '#546e7a', color: '#ffffff' }, s2: { text: '运行中', bg: '#107c41', color: '#ffffff' } },
  { name: '🟢 ON / 🔴 OFF', s1: { text: 'ON', bg: '#107c41', color: '#ffffff' }, s2: { text: 'OFF', bg: '#e53935', color: '#ffffff' } },
  { name: '🟢 开 / 🔴 关', s1: { text: '开', bg: '#107c41', color: '#ffffff' }, s2: { text: '关', bg: '#e53935', color: '#ffffff' } },
  { name: '🔴 REC / ⚪ IDLE', s1: { text: 'REC', bg: '#e53935', color: '#ffffff' }, s2: { text: 'IDLE', bg: '#546e7a', color: '#ffffff' } },
  { name: '🟢 MIC / 🔴 MUTE', s1: { text: 'MIC', bg: '#107c41', color: '#ffffff' }, s2: { text: 'MUTE', bg: '#d32f2f', color: '#ffffff' } },
  { name: '🔵 1 / 🟣 2', s1: { text: '1', bg: '#1976d2', color: '#ffffff' }, s2: { text: '2', bg: '#7b1fa2', color: '#ffffff' } },
];

function getActiveBadge(spec) {
  if (!spec) return null;
  if (spec.badgeToggle) {
    const s1 = spec.badgeState1 || { text: 'ON', bg: '#107c41', color: '#ffffff' };
    const s2 = spec.badgeState2 || { text: 'OFF', bg: '#e53935', color: '#ffffff' };
    const stateIdx = (spec._activeState !== undefined) ? spec._activeState : (spec.badgeInitialState || 0);
    const sObj = stateIdx === 1 ? s2 : s1;
    const text = String(sObj.text || '').trim();
    if (!text) return null;
    return {
      text,
      bg: sObj.bg || (stateIdx === 1 ? '#e53935' : '#107c41'),
      color: sObj.color || '#ffffff',
      state: stateIdx,
      isToggle: true,
    };
  }
  const text = String(spec.badge || '').trim();
  if (!text) return null;
  return {
    text,
    bg: spec.badgeBg || '#e53935',
    color: spec.badgeColor || '#ffffff',
    state: 0,
    isToggle: false,
  };
}

async function paintKey(spec, size, keyPos) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');

  const page = curPage();
  const grad = page && page.gradient;
  let sampledFg = null;

  // 贯通 6 列整板渐变（包括副屏 col: 5）
  if (keyPos && grad && grad.enabled && (!spec || !spec.customColor)) {
    const master = getGlobalGradientCanvas(grad);
    if (master) {
      const sx = keyPos.col * 96;
      const sy = keyPos.row * 96;
      ctx.drawImage(master, sx, sy, 96, 96, 0, 0, size, size);
      try {
        const mctx = master.getContext('2d');
        const p = mctx.getImageData(sx + 48, sy + 48, 1, 1).data;
        const bri = (p[0] * 299 + p[1] * 587 + p[2] * 114) / 1000;
        sampledFg = bri > 140 ? '#1f2430' : '#ffffff';
      } catch (e) {}
    } else {
      drawBase(ctx, size, spec);
    }
  } else {
    drawBase(ctx, size, spec);
  }

  const label = spec.label || '';
  const fg = spec.textColor || sampledFg || contrast(spec.color);
  const pos = spec.labelPos || 'bottom';
  const fs = Math.max(8, Math.round((size * (Number(spec.fontSize) || 17)) / 100));
  const iconBox = (size * (Number(spec.iconScale) || 62)) / 100;

  let iconTop = size * 0.07;
  if (!label) iconTop = (size - iconBox) / 2;
  else if (pos === 'top') iconTop = size * 0.08 + fs * 1.25;
  else if (pos === 'center') iconTop = size * 0.03;

  if (spec.icon) {
    const img = await loadImage(spec.icon);
    if (img) {
      const s = Math.min(iconBox / img.width, iconBox / img.height);
      const w = img.width * s, h = img.height * s;
      ctx.drawImage(img, (size - w) / 2, iconTop + (iconBox - h) / 2, w, h);
    }
  } else if (spec.type && spec.type !== 'text') {
    ctx.fillStyle = fg;
    ctx.font = `${Math.round(iconBox * 0.72)}px "Microsoft YaHei", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(glyphFor(spec.type), size / 2, iconTop + iconBox / 2);
  }

  // 自定义角标徽章（静态徽章或动态双态 Toggle 徽章）
  const activeBadge = getActiveBadge(spec);
  if (activeBadge && activeBadge.text) {
    const badgeText = activeBadge.text;
    ctx.save();
    const bh = Math.max(14, Math.round(size * 0.20));
    ctx.font = `bold ${Math.round(bh * 0.72)}px "Segoe UI", "Microsoft YaHei", sans-serif`;
    const textWidth = ctx.measureText ? ctx.measureText(badgeText).width : (badgeText.length * bh * 0.65);
    const bw = Math.max(bh, Math.round(textWidth + 8));
    const bx = size - bw - size * 0.05;
    const by = size * 0.05;
    ctx.shadowColor = 'rgba(0,0,0,0.4)';
    ctx.shadowBlur = 4;
    ctx.fillStyle = activeBadge.bg || '#e53935';
    ctx.beginPath();
    if (ctx.roundRect) {
      ctx.roundRect(bx, by, bw, bh, bh / 2);
    } else {
      ctx.rect(bx, by, bw, bh);
    }
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.fillStyle = activeBadge.color || '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(badgeText, bx + bw / 2, by + bh / 2 + 0.5);
    ctx.restore();
  }

  // 宏循环活跃状态：硬件按键边框高亮 + RUN 徽章
  const isLoopRunning = keyPos && (
    activeLoopKeyIds.has(`${keyPos.row},${keyPos.col}`) ||
    (page && activeLoopKeyIds.has(`${page.id}:${keyPos.row},${keyPos.col}`))
  );
  if (isLoopRunning) {
    ctx.save();
    ctx.strokeStyle = '#00e676';
    ctx.lineWidth = Math.max(3, Math.round(size * 0.06));
    ctx.strokeRect(ctx.lineWidth / 2, ctx.lineWidth / 2, size - ctx.lineWidth, size - ctx.lineWidth);

    const bh = Math.max(14, Math.round(size * 0.20));
    const badgeText = '⟳ RUN';
    const bw = Math.max(bh, Math.round(badgeText.length * bh * 0.55 + 8));
    const bx = size * 0.05;
    const by = size * 0.05;
    ctx.fillStyle = '#00c853';
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(bx, by, bw, bh, bh / 2);
    else ctx.rect(bx, by, bw, bh);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.font = `bold ${Math.round(bh * 0.65)}px "Segoe UI", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(badgeText, bx + bw / 2, by + bh / 2 + 0.5);
    ctx.restore();
  }

  if (label) {
    const maxW = size * 0.86;
    const maxLines = (pos === 'center' || !spec.icon) ? 4 : 2;
    const { lines, fontSize: fittedFs } = wrapAndFitText(
      ctx,
      label,
      maxW,
      maxLines,
      fs,
      '"Microsoft YaHei", sans-serif'
    );
    ctx.fillStyle = fg;
    ctx.font = `${fittedFs}px "Microsoft YaHei", sans-serif`;
    ctx.textAlign = 'center';
    const lh = fittedFs * 1.15;
    if (pos === 'top') {
      ctx.textBaseline = 'top';
      lines.forEach((ln, i) => ctx.fillText(ln, size / 2, size * 0.08 + (i + 1) * lh));
    } else if (pos === 'center') {
      ctx.textBaseline = 'middle';
      const total = lines.length * lh;
      lines.forEach((ln, i) => ctx.fillText(ln, size / 2, (size - total) / 2 + lh / 2 + i * lh));
    } else {
      // 底部基线边距提升至 size * 0.13，硬件物理透镜透光黄金区，彻底消灭底部裁切
      ctx.textBaseline = 'bottom';
      lines.forEach((ln, i) => ctx.fillText(ln, size / 2, size - size * 0.13 - (lines.length - 1 - i) * lh));
    }
  }
  return c;
}

function rotateCanvas(src, mode) {
  if (mode === 'none') return src;
  const s = src.width;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const ctx = c.getContext('2d');
  if (mode === 'ccw') {           // 90° counter-clockwise
    ctx.translate(0, s);
    ctx.rotate(-Math.PI / 2);
  } else {                        // 90° clockwise
    ctx.translate(s, 0);
    ctx.rotate(Math.PI / 2);
  }
  ctx.drawImage(src, 0, 0);
  return c;
}

function toJpegUnder(canvas, maxBytes) {
  for (let q = 0.92; q >= 0.35; q -= 0.06) {
    const dataUrl = canvas.toDataURL('image/jpeg', q);
    const bytes = Math.floor((dataUrl.length - 'data:image/jpeg;base64,'.length) * 0.75);
    if (bytes <= maxBytes) return dataUrl;
  }
  return canvas.toDataURL('image/jpeg', 0.3);
}

// Preview mode: when opened as a plain HTML file (no Electron preload) we
// render a sample layout so the UI can be inspected without the device.
const DEMO = typeof api === 'undefined';

async function pushKey(row, col) {
  if (!cfg || DEMO) return;
  const spec = isBackCell(row, col) ? backSpec() : pageButtons()[row + ',' + col];
  const size = col === 5 ? 80 : 96;
  const blank = { color: '#20262e', label: '' };
  const c = await paintKey(spec || blank, size, { row, col });
  const rotated = rotateCanvas(c, $('rotate').value);
  const dataUrl = toJpegUnder(rotated, 10240);
  await api.deviceDraw({ row, col, data: dataUrl.split(',')[1] });
}

/** 显示屏上的页码/页名。顶层页显示「第 N/M 页」，子页显示「子页 · 名字」。 */
function pageStripLabel() {
  const p = curPage();
  const name = String(p.name || '').slice(0, 10);
  if (p.parent) return `子页\n${name}`;
  const tops = (cfg.pages || []).filter((x) => !x.parent);
  const n = tops.findIndex((x) => x.id === p.id) + 1;
  return `第 ${n}/${tops.length} 页\n${name}`;
}

async function pushStrip(row) {
  if (!cfg || DEMO) return;
  const spec = pageStrips()[String(row)] || { type: 'text', label: '', color: '#263238' };
  const size = 80;
  let s = Object.assign({}, spec);
  if (s.type === 'clock') {
    const d = new Date();
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    const wd = ['日', '一', '二', '三', '四', '五', '六'][d.getDay()];
    s = Object.assign({}, s, { label: `${hh}:${mm}\n周${wd}` });
  } else if (s.type === 'page') {
    s = Object.assign({}, s, { label: pageStripLabel() });
  } else if (s.type === 'cpu') {
    let cpu = 0;
    try {
      const stats = await api.systemStats();
      if (stats && stats.cpu !== undefined) cpu = stats.cpu;
    } catch (_) {}
    s = Object.assign({}, s, { label: `CPU\n${cpu}%` });
  } else if (s.type === 'mem') {
    let mem = 0, used = '';
    try {
      const stats = await api.systemStats();
      if (stats) { mem = stats.mem; used = stats.memUsedGb; }
    } catch (_) {}
    s = Object.assign({}, s, { label: `内存 ${mem}%\n${used ? used + 'G' : ''}` });
  } else if (s.type === 'sys') {
    let cpu = 0, mem = 0;
    try {
      const stats = await api.systemStats();
      if (stats) { cpu = stats.cpu; mem = stats.mem; }
    } catch (_) {}
    s = Object.assign({}, s, { label: `C:${cpu}%\nM:${mem}%` });
  }
  const c = await paintKey(s, size, { row, col: 5 });
  const rotated = rotateCanvas(c, $('rotate').value);
  const dataUrl = toJpegUnder(rotated, 10240);
  await api.deviceDraw({ row, col: 5, data: dataUrl.split(',')[1] });
}

async function repaintAllKeys() {
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < KEY_COLS; col++) await pushKey(row, col);
  }
}

async function repaintAll() {
  await repaintAllKeys();
  for (let row = 0; row < ROWS; row++) await pushStrip(row);
}

/** Pressing an unconfigured key: flash "未配置" on that key of the device. */
async function flashUnconfigured(row, col) {
  if (DEMO || col === 5) return;
  const size = 96;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#8e2323';
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 22px "Microsoft YaHei", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('未配置', size / 2, size / 2);
  const dataUrl = toJpegUnder(rotateCanvas(c, $('rotate').value), 10240);
  await api.deviceDraw({ row, col, data: dataUrl.split(',')[1] });
  setTimeout(() => pushKey(row, col), 1100);
}

/** 扫码结果瞬态硬件反馈：成功显示绿底 ✓ 已复制，失败显示红底 ✕ 未识别，并可向副屏推送文本 */
async function flashKeyResult(row, col, success, text) {
  if (DEMO || col === 5) return;
  const size = 96;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');

  // 底色与边框
  ctx.fillStyle = success ? '#1b5e20' : '#8e2323';
  ctx.fillRect(0, 0, size, size);
  ctx.strokeStyle = success ? '#00e676' : '#ff5252';
  ctx.lineWidth = 4;
  ctx.strokeRect(2, 2, size - 4, size - 4);

  // 大符号
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 36px "Segoe UI", "Microsoft YaHei", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(success ? '✓' : '✕', size / 2, size * 0.38);

  // 说明文字
  ctx.font = 'bold 15px "Microsoft YaHei", sans-serif';
  ctx.fillText(success ? '已复制' : '未识别', size / 2, size * 0.76);

  const dataUrl = toJpegUnder(rotateCanvas(c, $('rotate').value), 10240);
  await api.deviceDraw({ row, col, data: dataUrl.split(',')[1] });

  // 若成功且有文本，向副屏 3 (底部 strip 2) 临时展示
  if (success && text) {
    const stripSize = 80;
    const sc = document.createElement('canvas');
    sc.width = sc.height = stripSize;
    const sctx = sc.getContext('2d');
    sctx.fillStyle = '#004d40';
    sctx.fillRect(0, 0, stripSize, stripSize);
    sctx.strokeStyle = '#00e5ff';
    sctx.lineWidth = 2;
    sctx.strokeRect(1, 1, stripSize - 2, stripSize - 2);

    sctx.fillStyle = '#80deea';
    sctx.font = 'bold 12px "Microsoft YaHei", sans-serif';
    sctx.textAlign = 'center';
    sctx.fillText('扫码成功', stripSize / 2, 18);

    sctx.fillStyle = '#ffffff';
    sctx.font = '11px Consolas, monospace';
    const clean = text.replace(/https?:\/\//, '');
    sctx.fillText(clean.slice(0, 8), stripSize / 2, 36);
    if (clean.length > 8) sctx.fillText(clean.slice(8, 16), stripSize / 2, 52);
    if (clean.length > 16) sctx.fillText(clean.slice(16, 24), stripSize / 2, 68);

    const sData = toJpegUnder(rotateCanvas(sc, $('rotate').value), 10240);
    await api.deviceDraw({ row: 2, col: 5, data: sData.split(',')[1] });

    setTimeout(() => pushStrip(2), 3500);
  }

  setTimeout(() => pushKey(row, col), 1600);
}

async function repaintStrips() {
  for (let row = 0; row < ROWS; row++) await pushStrip(row);
}

// ----------------------------------------------------------------- grid build

let dragFrom = null;   // {row,col} of a cell being dragged, for reordering

function buildGrid() {
  const grid = $('grid');
  grid.innerHTML = '';
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < TOTAL_COLS; col++) {
      const cell = document.createElement('div');
      cell.className = 'cell' + (col === 5 ? ' display' : '');
      cell.dataset.row = row;
      cell.dataset.col = col;

      cell.addEventListener('click', () => {
        hideContextMenu();
        select(row, col);
      });

      // 右键上下文菜单
      cell.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        select(row, col);
        showContextMenu(e.clientX, e.clientY, row, col);
      });

      if (col !== 5) {
        cell.draggable = true;
        cell.addEventListener('dragstart', (e) => {
          if (isBackCell(row, col) || !pageButtons()[row + ',' + col]) { e.preventDefault(); return; }
          dragFrom = { row, col };
          cell.classList.add('dragging');
          document.body.classList.add('dragging-key');
          e.dataTransfer.effectAllowed = 'copyMove';
          e.dataTransfer.setData('text/plain', row + ',' + col);
          e.dataTransfer.setData('application/akp153-cell', row + ',' + col);
        });
        cell.addEventListener('dragend', () => {
          cell.classList.remove('dragging');
          document.body.classList.remove('dragging-key');
          dragFrom = null;
        });
      }

      cell.addEventListener('dragover', (e) => {
        if (isBackCell(row, col)) return;
        e.preventDefault();
        const occupied = col !== 5 && !!pageButtons()[row + ',' + col];
        const swap = !!dragFrom && occupied && !dragLib;
        cell.classList.add(swap ? 'dragswap' : 'dragover');
      });
      cell.addEventListener('dragleave', () => {
        cell.classList.remove('dragover', 'dragswap');
      });
      cell.addEventListener('drop', (e) => {
        e.preventDefault();
        cell.classList.remove('dragover', 'dragswap');
        handleDrop(row, col, e);
      });
      grid.appendChild(cell);
    }
  }
  refreshGrid();
}

/** A drop is a library item, an internal move (reorder) or new content. */
async function handleDrop(row, col, e) {
  const internal = dragFrom;
  const fromLib = dragLib;
  dragFrom = null;
  dragLib = null;

  if (fromLib) {
    if (col === 5) { toast('显示屏不能放按键'); return; }
    const entry = (cfg.library || []).find((x) => x.id === fromLib);
    if (!entry) return;
    pageButtons()[row + ',' + col] = clone(entry.spec);
    await saveConfig();
    select(row, col);
    await pushKey(row, col);
    toast(`已把「${entry.name}」放到 r${row}c${col}`);
    return;
  }
  if (internal) {
    await swapCells(internal, { row, col });
    return;
  }
  await onDrop(row, col, e);
}

async function swapCells(a, b) {
  if (a.row === b.row && a.col === b.col) return;
  if (a.col === 5 || b.col === 5) return;   // strips are not part of the key grid
  const ka = a.row + ',' + a.col;
  const kb = b.row + ',' + b.col;
  const va = pageButtons()[ka];
  const vb = pageButtons()[kb];
  if (vb) pageButtons()[ka] = vb; else delete pageButtons()[ka];
  if (va) pageButtons()[kb] = va; else delete pageButtons()[kb];
  await saveConfig();
  selected = b;
  refreshGrid();
  renderInspector();
  await pushKey(a.row, a.col);
  await pushKey(b.row, b.col);
}

function refreshGrid() {
  const page = curPage();
  const grad = page.gradient;

  document.querySelectorAll('#grid .cell').forEach((cell) => {
    const row = +cell.dataset.row, col = +cell.dataset.col;
    const isSel = !!selected && selected.row === row && selected.col === col;
    cell.classList.toggle('selected', isSel);
    cell.innerHTML = '';
    cell.style.background = '';
    cell.style.color = '';

    // 副屏 (Col 5)
    if (col === 5) {
      const s = pageStrips()[String(row)] || { type: 'text', label: '', color: '#263238' };
      const txt = s.type === 'clock' ? '时钟'
        : s.type === 'page' ? pageStripLabel().replace('\n', ' · ')
        : s.type === 'cpu' ? '💻 CPU 监控'
        : s.type === 'mem' ? '📊 内存监控'
        : s.type === 'sys' ? '📈 态势仪表'
        : (s.label || '（空）');
      const gl = s.type === 'cpu' ? '💻'
        : s.type === 'mem' ? '📊'
        : s.type === 'sys' ? '📈'
        : s.type === 'clock' ? '⏰'
        : '▢';
      cell.classList.add('display');
      cell.classList.remove('filled');

      // 若整板渐变开启且未自定义单色，无缝切片第 6 列
      const isStripGrad = grad && grad.enabled && !s.customColor;
      cell.classList.toggle('grad-cell', !!isStripGrad);

      if (isStripGrad) {
        cell.style.backgroundImage = `linear-gradient(${grad.angle}deg, ${grad.from}, ${grad.to})`;
        cell.style.backgroundSize = '600% 300%';
        cell.style.backgroundPosition = `${col * 20}% ${row * 50}%`;
        cell.style.backgroundColor = '';
        cell.style.color = sampleGradientContrast(grad, row, col);
      } else {
        cell.style.backgroundImage = '';
        cell.style.backgroundSize = '';
        cell.style.backgroundPosition = '';
        cell.style.background = s.color || '#263238';
        cell.style.color = contrast(s.color);
      }

      cell.appendChild(el('span', 'glyph', gl));
      cell.appendChild(el('span', 'cap', String(txt).replace(/\n/g, '/')));
      cell.appendChild(el('span', 'badge', `屏 ${row + 1}`));
      return;
    }

    // 子页自动返回键
    if (isBackCell(row, col)) {
      cell.classList.remove('filled');
      cell.classList.add('back');
      cell.style.background = '#37474f';
      cell.style.color = '#ffffff';
      cell.appendChild(el('span', 'glyph', '←'));
      cell.appendChild(el('span', 'cap', '返回'));
      cell.appendChild(el('span', 'badge', '自动'));
      return;
    }
    cell.classList.remove('back');

    const spec = pageButtons()[row + ',' + col];
    const isGrad = grad && grad.enabled && (!spec || !spec.customColor);

    cell.classList.toggle('filled', !!spec);
    cell.classList.toggle('grad-cell', !!isGrad);

    if (isGrad) {
      cell.style.backgroundImage = `linear-gradient(${grad.angle}deg, ${grad.from}, ${grad.to})`;
      cell.style.backgroundSize = '600% 300%';
      cell.style.backgroundPosition = `${col * 20}% ${row * 50}%`;
      cell.style.backgroundColor = '';
    } else if (spec) {
      cell.style.backgroundImage = spec.color2
        ? `linear-gradient(180deg, ${spec.color || '#37474f'}, ${spec.color2})`
        : '';
      cell.style.backgroundSize = '';
      cell.style.backgroundPosition = '';
      cell.style.backgroundColor = spec.color || '#37474f';
    } else {
      cell.style.backgroundImage = '';
      cell.style.backgroundSize = '';
      cell.style.backgroundPosition = '';
      cell.style.backgroundColor = '';
    }

    if (!spec) {
      cell.appendChild(el('span', 'plus', '＋'));
      return;
    }

    if (spec.textColor) {
      cell.style.color = spec.textColor;
    } else if (isGrad) {
      cell.style.color = sampleGradientContrast(grad, row, col);
    } else {
      cell.style.color = contrast(spec.color);
    }

    // 图标或默认类型字形
    if (spec.icon) {
      const img = document.createElement('img');
      img.className = 'thumb';
      img.src = spec.icon;
      cell.appendChild(img);
    } else {
      cell.appendChild(el('span', 'glyph', glyphFor(spec.type)));
    }

    // 角标微标 (Badge Overlay，静态或动态双态)
    const activeBadge = getActiveBadge(spec);
    if (activeBadge && activeBadge.text) {
      const bEl = el('span', 'badge-overlay', activeBadge.text);
      if (activeBadge.bg) bEl.style.backgroundColor = activeBadge.bg;
      if (activeBadge.color) bEl.style.color = activeBadge.color;
      if (activeBadge.isToggle) bEl.classList.add('badge-toggle');
      cell.appendChild(bEl);
    }

    const isLoopRunning = activeLoopKeyIds.has(`${row},${col}`) ||
      (page && activeLoopKeyIds.has(`${page.id}:${row},${col}`));
    cell.classList.toggle('loop-running', !!isLoopRunning);
    if (isLoopRunning) {
      const runTag = el('span', 'badge-overlay', '⟳ RUN');
      runTag.style.backgroundColor = '#00c853';
      runTag.style.color = '#ffffff';
      runTag.style.left = '4px';
      runTag.style.right = 'auto';
      cell.appendChild(runTag);
    }

    cell.appendChild(el('span', 'cap', spec.label || ''));
    cell.appendChild(el('span', 'tag', `r${row}c${col}`));
    if (TYPE_SHORT[spec.type]) cell.appendChild(el('span', 'badge', TYPE_SHORT[spec.type]));

    const x = document.createElement('button');
    x.className = 'clear';
    x.textContent = '×';
    x.onclick = (e) => { e.stopPropagation(); removeKey(row, col); };
    cell.appendChild(x);
  });
}

function el(tag, cls, text) {
  const n = document.createElement(tag);
  n.className = cls;
  n.textContent = text;
  return n;
}

// ------------------------------------------------------------------- editing

function applyAppDualStateDefaults(spec, cls, targetPath) {
  if (!cls || cls.type !== 'app') return;
  const rawTarget = targetPath || (spec && spec.target) || '';
  const procName = cls.processName || (rawTarget ? rawTarget.replace(/\\/g, '/').split('/').pop().replace(/\.[^.]+$/, '') : '');
  if (procName) {
    spec.toggleAction = true;
    spec.action2 = {
      type: 'command',
      target: `taskkill /F /IM ${procName}.exe`,
      args: ''
    };
    spec.badgeToggle = true;
    spec.badgeState1 = { text: '', bg: '#546e7a' };
    spec.badgeState2 = { text: '运行中', bg: '#107c41' };
  }
}

async function onDrop(row, col, e) {
  if (isBackCell(row, col)) {
    toast('这是子页右下角的自动返回键 —— 退出子页后你原来放在这里的按键会恢复');
    return;
  }
  const dt = e.dataTransfer;
  let target = null;
  let kind = null;

  if (dt.files && dt.files.length) {
    const f = dt.files[0];
    // File.path was removed in Electron 32 - ask the preload for the real path.
    target = api.pathForFile(f) || '';
    if (!target) {
      toast('没拿到文件路径（' + f.name + '）—— 试试从资源管理器拖，而不是从浏览器里拖');
      return;
    }
    kind = 'path';
  } else {
    const text = (dt.getData('text/uri-list') || dt.getData('text') || '').trim();
    if (text) { target = text; kind = 'text'; }
  }
  if (!target) return;

  let spec;
  if (kind === 'text' && /^https?:\/\//i.test(target)) {
    spec = { type: 'url', label: new URL(target).hostname.replace(/^www\./, ''), target, icon: '', color: '#0277bd' };
  } else if (kind === 'text') {
    spec = { type: 'command', label: target.slice(0, 12), target, args: '', icon: '', color: '#4e342e' };
  } else {
    const cls = await api.actionClassify(target);
    const abs = cls.abs || target;
    // Never save a path we cannot resolve - that is how the app directory ended
    // up as the target for every dropped file.
    if (!cls.exists) {
      toast('路径不存在：' + abs);
      return;
    }
    spec = { type: cls.type, label: cls.label, target: abs, args: '', icon: '', color: colorFor(cls.type) };
    const icon = await api.iconExtract(abs);
    if (icon) spec.icon = icon;
    applyAppDualStateDefaults(spec, cls, abs);
  }

  pageButtons()[row + ',' + col] = spec;
  await saveConfig();
  select(row, col);
  await pushKey(row, col);
}

function colorFor(type) {
  switch (type) {
    case 'app': return '#1565c0';
    case 'hotkey': return '#107c41';
    case 'folder': return '#ef6c00';
    case 'url': return '#0277bd';
    case 'command': return '#4e342e';
    case 'ps1': return '#6a1b9a';
    case 'page': return '#455a64';
    default: return '#37474f';
  }
}

/** 页面动作的默认外观 + 名称。 */
const PAGE_MODES = [
  ['next', '下一页'],
  ['prev', '上一页'],
  ['goto', '跳到指定页'],
  ['up', '返回上级'],
  ['home', '回到主页面'],
];

const PAGE_MODE_INFOS = [
  { id: 'next', icon: '⏭️', name: '下一页', desc: '按顺序循环切换至下一页' },
  { id: 'prev', icon: '⏮️', name: '上一页', desc: '按顺序返回至上一张页面' },
  { id: 'goto', icon: '🎯', name: '跳到指定页', desc: '直接跳转至指定子页或页面' },
  { id: 'up',   icon: '⤴️', name: '返回上级', desc: '从当前子页面返回父级页面' },
  { id: 'home', icon: '🏠', name: '回到主页面', desc: '无论当前在哪，一键回主页' },
];

function pageActionLabel(spec) {
  const mode = spec.mode || 'next';
  if (mode === 'goto') {
    const p = pageById(spec.pageId);
    return p ? p.name : '（目标页已删）';
  }
  const m = PAGE_MODES.find(([v]) => v === mode);
  return m ? m[1] : '下一页';
}

function makePageSpec(mode, pageId) {
  const spec = {
    type: 'page', mode: mode || 'next', pageId: pageId || '',
    label: '', args: '', icon: '', color: colorFor('page'),
  };
  spec.label = pageActionLabel(spec);
  return spec;
}

/** 选「切页」模式 + 目标页（现代化卡片流交互式弹窗）。 */
function askPageAction(current) {
  return new Promise((resolve) => {
    let mode = (current && current.mode) || 'next';
    const target = (current && current.pageId) || '';
    const pages = pageTree().map(({ page, depth }) =>
      `<option value="${page.id}" ${target === page.id ? 'selected' : ''}>${'　'.repeat(depth)}${depth ? '↳ ' : ''}${escapeHtml(page.name)}</option>`).join('');

    const wrap = document.createElement('div');
    wrap.className = 'modal';
    wrap.innerHTML = `
      <div class="page-modal-box">
        <input id="_pmMode" type="hidden" value="${mode}" />
        <div class="page-modal-head">
          <div class="page-modal-title"><span>📄</span><span>设置翻页按键动作</span></div>
          <div class="page-modal-subtitle">点击此键时在 AKP153 控制台页面间平滑切换</div>
        </div>

        <div class="page-mode-grid" id="_pmModeGrid">
          ${PAGE_MODE_INFOS.map(m => `
            <div class="page-mode-card ${mode === m.id ? 'active' : ''}" data-mode="${m.id}">
              <span class="pm-icon">${m.icon}</span>
              <div class="pm-info">
                <span class="pm-title">${m.name}</span>
                <span class="pm-desc">${m.desc}</span>
              </div>
            </div>
          `).join('')}
        </div>

        <div class="page-target-wrap" id="_pmWrap" style="${mode === 'goto' ? '' : 'display:none;'}">
          <label style="font-size: 12px; font-weight: 600; color: var(--fg); display: flex; align-items: center; gap: 4px;">
            <span>🎯</span><span>选择目标跳转页面：</span>
          </label>
          <select id="_pmPage" class="page-select-styled">${pages}</select>
        </div>

        <div class="btnrow" style="margin-top: 6px; justify-content: flex-end; gap: 8px;">
          <button type="button" class="ghost" id="_pmCancel">取消</button>
          <button type="button" class="primary" id="_pmOk" style="min-width: 90px;">✓ 确定保存</button>
        </div>
      </div>
    `;
    document.body.appendChild(wrap);

    const cards = wrap.querySelectorAll('.page-mode-card');
    const iptMode = wrap.querySelector('#_pmMode');
    const wrapTarget = wrap.querySelector('#_pmWrap');
    const tgt = wrap.querySelector('#_pmPage');

    cards.forEach((card) => {
      card.addEventListener('click', () => {
        mode = card.dataset.mode;
        if (iptMode) iptMode.value = mode;
        cards.forEach((c) => c.classList.toggle('active', c === card));
        wrapTarget.style.display = mode === 'goto' ? '' : 'none';
      });
      card.addEventListener('dblclick', () => {
        const finalMode = (iptMode && iptMode.value) || mode;
        done({ mode: finalMode, pageId: tgt.value });
      });
    });

    const done = (v) => { wrap.remove(); resolve(v); };
    wrap.querySelector('#_pmOk').onclick = () => {
      const finalMode = (iptMode && iptMode.value) || mode;
      done({ mode: finalMode, pageId: tgt.value });
    };
    wrap.querySelector('#_pmCancel').onclick = () => done(null);
    wrap.addEventListener('click', (e) => { if (e.target === wrap) done(null); });
  });
}

/** Yes/no modal - window.confirm is unavailable in Electron renderers. */
function askConfirm(title, body) {
  return new Promise((resolve) => {
    const wrap = document.createElement('div');
    wrap.className = 'modal';
    wrap.innerHTML = `<div class="modalbox">
      <h3>${escapeHtml(title)}</h3>
      <p class="muted" style="margin:0 0 14px">${escapeHtml(body)}</p>
      <div class="btnrow">
        <button class="primary" id="_cOk">确定</button>
        <button class="ghost" id="_cCancel">取消</button>
      </div>
    </div>`;
    document.body.appendChild(wrap);
    const done = (v) => { wrap.remove(); resolve(v); };
    wrap.querySelector('#_cOk').onclick = () => done(true);
    wrap.querySelector('#_cCancel').onclick = () => done(false);
    wrap.addEventListener('click', (e) => { if (e.target === wrap) done(false); });
  });
}

async function removeKey(row, col) {
  delete pageButtons()[row + ',' + col];
  await saveConfig();
  if (selected && selected.row === row && selected.col === col) selected = null;
  refreshGrid();
  renderInspector();
  await pushKey(row, col);
}

function select(row, col) {
  selected = (row != null && col != null) ? { row, col } : null;
  refreshGrid();
  renderInspector();
}

async function repaintSelected() {
  if (!selected) return;
  if (selected.col === 5) await pushStrip(selected.row);
  else await pushKey(selected.row, selected.col);
}

/** Preview mode (no preload) has no main process to talk to. Everything that
 *  would persist must go through here, otherwise a plain edit in preview throws
 *  and the panel silently stops re-rendering. */
function saveConfig() {
  if (DEMO) return Promise.resolve(true);
  return api.configSave(cfg);
}

async function commit(repaint) {
  if (selected && selected.col !== 5) {
    const s = pageButtons()[selected.row + ',' + selected.col];
    if (s && s.badgeToggle) {
      const ab = getActiveBadge(s);
      if (ab) {
        s.badge = ab.text;
        s.badgeBg = ab.bg;
        s.badgeColor = ab.color;
      }
    }
  }
  await saveConfig();
  refreshGrid();
  if (repaint) await repaintSelected();
}

let currentInspTab = 'action';

function updateInspTabs() {
  const tabAction = $('tabAction');
  const tabStyle = $('tabStyle');
  if (tabAction && tabStyle) {
    if (currentInspTab === 'action') {
      tabAction.classList.add('active');
      tabStyle.classList.remove('active');
    } else {
      tabAction.classList.remove('active');
      tabStyle.classList.add('active');
    }
  }
  const secAction = document.querySelector('#inspector details[data-sec="action"]');
  const secStyle = document.querySelector('#inspector details[data-sec="look"]');
  if (secAction && secStyle) {
    if (currentInspTab === 'action') {
      secAction.style.display = 'block';
      secAction.open = true;
      secStyle.style.display = 'none';
    } else {
      secAction.style.display = 'none';
      secStyle.style.display = 'block';
      secStyle.open = true;
    }
  }
}

function initInspTabs() {
  const tabAction = $('tabAction');
  const tabStyle = $('tabStyle');
  if (tabAction) tabAction.onclick = () => { currentInspTab = 'action'; updateInspTabs(); };
  if (tabStyle) tabStyle.onclick = () => { currentInspTab = 'style'; updateInspTabs(); };
}

// ------------------------------------------------------------- 宏编辑器辅助逻辑

function getActionIcon(type) {
  switch (type) {
    case 'open':
    case 'app': return '🚀';
    case 'cmd':
    case 'command': return '⚡';
    case 'hotkey': return '⌨️';
    case 'text': return '✍️';
    case 'delay': return '⏱️';
    case 'mouse_click': return '🖱️';
    case 'mouse_move': return '🖱️';
    case 'mouse_drag': return '🖲️';
    case 'mouse_wheel': return '🎡';
    case 'window_rect': return '📐';
    case 'media': return '🔊';
    default: return '▶';
  }
}

function getActionTypeName(type) {
  switch (type) {
    case 'open':
    case 'app': return '启动程序 / 打开';
    case 'cmd':
    case 'command': return '执行命令行';
    case 'hotkey': return '模拟快捷键';
    case 'text': return '键盘输入文本';
    case 'delay': return '等待延迟';
    case 'mouse_click': return '鼠标点击';
    case 'mouse_move': return '鼠标平移';
    case 'mouse_drag': return '鼠标拖拽';
    case 'mouse_wheel': return '鼠标滚轮';
    case 'window_rect': return '固定窗口尺寸位置';
    case 'media': return '多媒体控制';
    default: return type || '动作';
  }
}

function startCoordinatePicker(btnEl, onPicked) {
  let count = 3;
  btnEl.disabled = true;
  const originalText = btnEl.textContent;
  btnEl.textContent = `⏳ ${count} 秒后采样...`;

  const timer = setInterval(async () => {
    count--;
    if (count > 0) {
      btnEl.textContent = `⏳ ${count} 秒后采样...`;
    } else {
      clearInterval(timer);
      btnEl.textContent = '🎯 正在读取...';
      try {
        const pt = await api.macroGetCursor();
        if (pt && pt.x !== undefined && pt.y !== undefined) {
          onPicked(pt.x, pt.y);
          toast(`已拾取坐标：X=${pt.x}, Y=${pt.y}`);
        } else {
          toast('未能获取坐标');
        }
      } catch (err) {
        toast('拾取坐标失败：' + (err && err.message));
      } finally {
        btnEl.disabled = false;
        btnEl.textContent = originalText;
      }
    }
  }, 1000);
}

// -------------------------------------------------------- 免冲突快捷键构建器与录制器
const HOTKEY_PRESETS = [
  { hk: 'Alt+Shift+F10', lbl: 'IDEA 运行配置' },
  { hk: 'Win+D', lbl: '显示桌面' },
  { hk: 'Alt+F4', lbl: '关闭窗口' },
  { hk: 'Ctrl+Shift+Esc', lbl: '任务管理器' },
  { hk: 'Win+E', lbl: '此电脑' },
  { hk: 'Win+L', lbl: '一键锁屏' },
  { hk: 'Win+V', lbl: '剪贴板' },
  { hk: 'Ctrl+Alt+A', lbl: '屏幕截图' },
  { hk: 'Ctrl+C', lbl: '复制' },
  { hk: 'Ctrl+V', lbl: '粘贴' },
  { hk: 'Ctrl+Z', lbl: '撤销' },
];

const HOTKEY_KEY_CATEGORIES = [
  {
    id: 'f',
    name: 'F 功能键',
    keys: ['F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12'],
  },
  {
    id: 'common',
    name: '常用按键',
    keys: ['Enter', 'Esc', 'Tab', 'Space', 'Backspace', 'Delete'],
  },
  {
    id: 'nav',
    name: '导航/编辑',
    keys: ['Up', 'Down', 'Left', 'Right', 'Home', 'End', 'PgUp', 'PgDn', 'PrtScn', 'Insert'],
  },
  {
    id: 'alpha',
    name: '字母 A~Z',
    keys: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split(''),
  },
  {
    id: 'num',
    name: '数字 0~9',
    keys: '0123456789'.split(''),
  },
];

function normalizeKeyName(k) {
  if (!k) return '';
  const raw = String(k).trim();
  const lk = raw.toLowerCase();
  const map = {
    'esc': 'Esc', 'escape': 'Esc',
    'enter': 'Enter', 'return': 'Enter',
    'tab': 'Tab', 'space': 'Space',
    'backspace': 'Backspace', 'delete': 'Delete', 'del': 'Delete',
    'insert': 'Insert', 'ins': 'Insert',
    'home': 'Home', 'end': 'End',
    'pageup': 'PgUp', 'pgup': 'PgUp',
    'pagedown': 'PgDn', 'pgdn': 'PgDn',
    'arrowup': 'Up', 'up': 'Up',
    'arrowdown': 'Down', 'down': 'Down',
    'arrowleft': 'Left', 'left': 'Left',
    'arrowright': 'Right', 'right': 'Right',
    'prtscn': 'PrtScn', 'printscreen': 'PrtScn',
  };
  if (map[lk]) return map[lk];
  if (/^f([1-9]|1[0-9]|2[0-4])$/i.test(lk)) return lk.toUpperCase();
  if (raw.length === 1) return raw.toUpperCase();
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

function parseHotkey(str) {
  const raw = String(str || '').trim();
  if (!raw) return { ctrl: false, alt: false, shift: false, win: false, key: '' };
  const parts = raw.split('+').map(s => s.trim()).filter(Boolean);
  let ctrl = false, alt = false, shift = false, win = false;
  let key = '';
  for (const p of parts) {
    const pl = p.toLowerCase();
    if (pl === 'ctrl' || pl === 'control') ctrl = true;
    else if (pl === 'alt') alt = true;
    else if (pl === 'shift') shift = true;
    else if (pl === 'win' || pl === 'meta' || pl === 'super') win = true;
    else key = p;
  }
  return { ctrl, alt, shift, win, key: normalizeKeyName(key) };
}

function buildHotkey({ ctrl, alt, shift, win, key }) {
  const mods = [];
  if (ctrl) mods.push('Ctrl');
  if (alt) mods.push('Alt');
  if (shift) mods.push('Shift');
  if (win) mods.push('Win');
  const normKey = normalizeKeyName(key);
  if (!normKey) return mods.join('+');
  return mods.concat([normKey]).join('+');
}

function mapEventKey(e) {
  const code = e.code || '';
  if (/^Key([A-Z])$/i.test(code)) return code.replace(/^Key/i, '').toUpperCase();
  if (/^Digit([0-9])$/i.test(code)) return code.replace(/^Digit/i, '');
  if (/^F([1-9]|1[0-9]|2[0-4])$/i.test(code)) return code.toUpperCase();
  if (/^Numpad([0-9])$/i.test(code)) return 'Num' + code.replace(/^Numpad/i, '');
  const codeMap = {
    'ArrowLeft': 'Left', 'ArrowRight': 'Right', 'ArrowUp': 'Up', 'ArrowDown': 'Down',
    'Enter': 'Enter', 'NumpadEnter': 'Enter', 'Escape': 'Esc', 'Tab': 'Tab',
    'Space': 'Space', 'Backspace': 'Backspace', 'Delete': 'Delete', 'Insert': 'Insert',
    'Home': 'Home', 'End': 'End', 'PageUp': 'PgUp', 'PageDown': 'PgDn',
    'PrintScreen': 'PrtScn', 'Minus': '-', 'Equal': '=',
    'BracketLeft': '[', 'BracketRight': ']', 'Backslash': '\\',
    'Semicolon': ';', 'Quote': '\'', 'Comma': ',', 'Period': '.', 'Slash': '/',
  };
  if (codeMap[code]) return codeMap[code];
  return normalizeKeyName(e.key);
}

let activeHkRecorder = null;

function stopCurrentHkRecorder(finalValue) {
  if (activeHkRecorder) {
    activeHkRecorder.stop(finalValue);
    activeHkRecorder = null;
  }
}

function renderHotkeyBuilderHtml(idPrefix, currentVal, options = {}) {
  const val = String(currentVal || '').trim();
  const parsed = parseHotkey(val);
  const macroAttr = options.isMacro ? `data-macro-idx="${options.idx}"` : '';
  const inputClass = options.isMacro ? 'm-field hotkey-input' : 'hotkey-input';
  const dataField = options.isMacro ? 'data-field="target"' : '';
  const dataIdx = options.isMacro ? `data-idx="${options.idx}"` : '';

  return `
    <div class="hotkey-builder-wrap" id="${idPrefix}-wrap" ${macroAttr}>
      <div class="hotkey-top-row">
        <input id="${idPrefix}" class="${inputClass}" ${dataField} ${dataIdx} value="${escapeAttr(val)}" placeholder="例如 Alt+Shift+F10 或 Ctrl+C" autocomplete="off" />
        <button type="button" class="hk-btn-record" id="${idPrefix}-rec-btn" title="点击后直接在键盘上敲击组合键录制">🔴 录制</button>
        <button type="button" class="hk-btn-palette" id="${idPrefix}-pal-btn" title="免敲击物理键盘，鼠标点选修饰键与按键组合（100% 免疫系统/软件冲突）">⌨️ 免冲突点选</button>
      </div>

      <div class="hk-palette-panel" id="${idPrefix}-pal-panel" style="display: none;">
        <div class="hk-sec-title">
          <span>⚡ 修饰键多选（可自由勾选叠加）：</span>
          <span style="margin-left: auto; font-size: 10px; color: var(--accent); font-weight: normal;">零键盘敲击 · 绝不触发后台软件</span>
        </div>
        <div class="hk-mod-row">
          <button type="button" class="hk-mod-pill ${parsed.ctrl ? 'active' : ''}" data-mod="ctrl">Ctrl</button>
          <button type="button" class="hk-mod-pill ${parsed.alt ? 'active' : ''}" data-mod="alt">Alt</button>
          <button type="button" class="hk-mod-pill ${parsed.shift ? 'active' : ''}" data-mod="shift">Shift</button>
          <button type="button" class="hk-mod-pill ${parsed.win ? 'active' : ''}" data-mod="win">Win</button>
        </div>

        <div class="hk-cat-tabs" id="${idPrefix}-cat-tabs">
          ${HOTKEY_KEY_CATEGORIES.map((cat, i) => `
            <button type="button" class="hk-cat-tab ${i === 0 ? 'active' : ''}" data-cat="${cat.id}">${cat.name}</button>
          `).join('')}
        </div>

        <div class="hk-key-grid" id="${idPrefix}-key-grid">
          ${HOTKEY_KEY_CATEGORIES[0].keys.map(k => `
            <button type="button" class="hk-key-pill" data-key="${k}">${k}</button>
          `).join('')}
        </div>

        <div class="hk-builder-hint">
          <span>💡 提示：先点选修饰键（如 Alt+Shift），再点功能键（如 F10）即可直接套用</span>
        </div>
      </div>

      <div class="hotkey-preset-tags" style="margin-top: 2px;">
        ${HOTKEY_PRESETS.map(p => `
          <span class="hotkey-tag" data-hk="${p.hk}" data-lbl="${p.lbl}">${p.hk} (${p.lbl})</span>
        `).join('')}
      </div>
    </div>
  `;
}

function bindHotkeyBuilder(rootEl, idPrefix, onChange) {
  const root = rootEl || document;
  const ipt = root.querySelector ? (root.querySelector(`#${idPrefix}`) || $(idPrefix)) : $(idPrefix);
  if (!ipt) return;
  const wrap = root.querySelector ? (root.querySelector(`#${idPrefix}-wrap`) || $(`${idPrefix}-wrap`)) : $(`${idPrefix}-wrap`);
  const recBtn = root.querySelector ? (root.querySelector(`#${idPrefix}-rec-btn`) || $(`${idPrefix}-rec-btn`)) : $(`${idPrefix}-rec-btn`);
  const palBtn = root.querySelector ? (root.querySelector(`#${idPrefix}-pal-btn`) || $(`${idPrefix}-pal-btn`)) : $(`${idPrefix}-pal-btn`);
  const palPanel = root.querySelector ? (root.querySelector(`#${idPrefix}-pal-panel`) || $(`${idPrefix}-pal-panel`)) : $(`${idPrefix}-pal-panel`);
  const catTabs = root.querySelector ? (root.querySelector(`#${idPrefix}-cat-tabs`) || $(`${idPrefix}-cat-tabs`)) : $(`${idPrefix}-cat-tabs`);
  const keyGrid = root.querySelector ? (root.querySelector(`#${idPrefix}-key-grid`) || $(`${idPrefix}-key-grid`)) : $(`${idPrefix}-key-grid`);

  const syncPillsFromValue = (val) => {
    if (!palPanel) return;
    const p = parseHotkey(val);
    palPanel.querySelectorAll('.hk-mod-pill').forEach(pill => {
      const m = pill.dataset.mod;
      pill.classList.toggle('active', !!p[m]);
    });
  };

  const getActiveModifiers = () => {
    if (!palPanel) return { ctrl: false, alt: false, shift: false, win: false };
    const pills = palPanel.querySelectorAll('.hk-mod-pill');
    let ctrl = false, alt = false, shift = false, win = false;
    pills.forEach(p => {
      if (p.classList.contains('active')) {
        const m = p.dataset.mod;
        if (m === 'ctrl') ctrl = true;
        if (m === 'alt') alt = true;
        if (m === 'shift') shift = true;
        if (m === 'win') win = true;
      }
    });
    return { ctrl, alt, shift, win };
  };

  // 1. 输入框直接改动
  ipt.addEventListener('change', () => {
    const norm = buildHotkey(parseHotkey(ipt.value.trim()));
    ipt.value = norm;
    syncPillsFromValue(norm);
    if (onChange) onChange(norm);
  });

  // 2. 交互式物理键盘录制（带沙箱捕获与冒泡阻断）
  if (recBtn) {
    recBtn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      if (activeHkRecorder && activeHkRecorder.idPrefix === idPrefix) {
        stopCurrentHkRecorder(null);
        return;
      }
      stopCurrentHkRecorder(null);

      const oldVal = ipt.value;
      recBtn.classList.add('recording');
      recBtn.textContent = '⏹️ 录制中... (Esc 取消)';
      ipt.classList.add('recording');
      ipt.placeholder = '请在键盘上按下快捷键组合...';
      ipt.focus();

      const onKeyDown = (e) => {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();

        // 纯 Escape 键取消
        if (e.key === 'Escape' && !e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey) {
          stopCurrentHkRecorder(null);
          return;
        }

        const ctrl = e.ctrlKey;
        const alt = e.altKey;
        const shift = e.shiftKey;
        const win = e.metaKey;

        // 若当前只按下了修饰键本身
        if (['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) {
          const modPreview = buildHotkey({ ctrl, alt, shift, win, key: '' });
          ipt.value = modPreview ? (modPreview + '+…') : '';
          return;
        }

        // 捕获到了主按键
        const key = mapEventKey(e);
        if (key) {
          const combo = buildHotkey({ ctrl, alt, shift, win, key });
          stopCurrentHkRecorder(combo);
        }
      };

      const stop = (finalVal) => {
        window.removeEventListener('keydown', onKeyDown, { capture: true });
        recBtn.classList.remove('recording');
        recBtn.textContent = '🔴 录制';
        ipt.classList.remove('recording');
        ipt.placeholder = '例如 Alt+Shift+F10 或 Ctrl+C';
        if (finalVal !== null && finalVal !== undefined) {
          ipt.value = finalVal;
          syncPillsFromValue(finalVal);
          if (onChange) onChange(finalVal);
          toast('已成功录制快捷键：' + finalVal);
        } else {
          ipt.value = oldVal;
          syncPillsFromValue(oldVal);
        }
      };

      activeHkRecorder = { idPrefix, stop };
      window.addEventListener('keydown', onKeyDown, { capture: true });
    });
  }

  // 3. 点选构建器折叠与展开
  if (palBtn && palPanel) {
    palBtn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      const isOpen = palPanel.style.display !== 'none';
      palPanel.style.display = isOpen ? 'none' : 'flex';
      palBtn.classList.toggle('active', !isOpen);
      if (!isOpen) {
        syncPillsFromValue(ipt.value);
      }
    });
  }

  // 4. 修饰键胶囊切换
  if (palPanel) {
    palPanel.querySelectorAll('.hk-mod-pill').forEach(pill => {
      pill.addEventListener('click', (ev) => {
        ev.stopPropagation();
        pill.classList.toggle('active');
        const mods = getActiveModifiers();
        const curParsed = parseHotkey(ipt.value);
        const combo = buildHotkey({ ...mods, key: curParsed.key });
        ipt.value = combo;
        if (onChange) onChange(combo);
      });
    });
  }

  // 5. 分类标签页切换
  if (catTabs && keyGrid) {
    catTabs.querySelectorAll('.hk-cat-tab').forEach(tab => {
      tab.addEventListener('click', (ev) => {
        ev.stopPropagation();
        catTabs.querySelectorAll('.hk-cat-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        const catId = tab.dataset.cat;
        const catObj = HOTKEY_KEY_CATEGORIES.find(c => c.id === catId) || HOTKEY_KEY_CATEGORIES[0];
        keyGrid.innerHTML = catObj.keys.map(k => `
          <button type="button" class="hk-key-pill" data-key="${k}">${k}</button>
        `).join('');
        bindKeyPills();
      });
    });
  }

  // 6. 按键点选
  const bindKeyPills = () => {
    if (!keyGrid) return;
    keyGrid.querySelectorAll('.hk-key-pill').forEach(btn => {
      btn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const key = btn.dataset.key;
        const mods = getActiveModifiers();
        const combo = buildHotkey({ ...mods, key });
        ipt.value = combo;
        if (onChange) onChange(combo);
        btn.style.transform = 'scale(0.9)';
        setTimeout(() => { btn.style.transform = ''; }, 100);
      });
    });
  };
  bindKeyPills();

  // 7. 高频快捷标签点选
  if (wrap) {
    wrap.querySelectorAll('.hotkey-tag').forEach(tag => {
      tag.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const hk = tag.dataset.hk;
        ipt.value = hk;
        syncPillsFromValue(hk);
        if (onChange) onChange(hk);
      });
    });
  }
}

function renderActionCardHtml(act, idx, total) {
  const t = act.type || 'app';
  let bodyHtml = '';

  if (t === 'app' || t === 'open' || t === 'url' || t === 'file' || t === 'folder') {
    bodyHtml = `
      <div class="macro-inline-row">
        <input class="m-field" data-field="target" data-idx="${idx}" value="${escapeAttr(act.target || '')}" placeholder="程序名、.exe、路径或网址 (支持 steam, leigod 等自动寻径)" />
        <button type="button" class="ghost tiny" data-act-pick="file" data-idx="${idx}" title="浏览本地文件">📁 浏览</button>
      </div>
      <input class="m-field" data-field="args" data-idx="${idx}" value="${escapeAttr(act.args || '')}" placeholder="启动参数 (可选)" />
    `;
  } else if (t === 'cmd' || t === 'command' || t === 'ps1') {
    bodyHtml = `
      <textarea class="m-field" data-field="target" data-idx="${idx}" rows="2" placeholder="输入要在后台静默执行的命令">${escapeHtml(act.target || '')}</textarea>
    `;
  } else if (t === 'hotkey') {
    const val = act.target || act.combo || act.hotkey || '';
    bodyHtml = `
      <div style="margin-top: 4px;">
        ${renderHotkeyBuilderHtml(`m-hk-${idx}`, val, { isMacro: true, idx })}
      </div>
    `;
  } else if (t === 'text') {
    bodyHtml = `
      <textarea class="m-field" data-field="text" data-idx="${idx}" rows="2" placeholder="输入要模拟键盘输入的文本（支持中文及 Unicode）">${escapeHtml(act.text || '')}</textarea>
    `;
  } else if (t === 'delay') {
    bodyHtml = `
      <div class="macro-inline-row">
        <label>等待延迟：</label>
        <input type="number" class="m-field" data-field="ms" data-idx="${idx}" min="1" max="60000" step="50" value="${act.ms !== undefined ? act.ms : 500}" style="width: 80px;" /> ms
        <div style="display:flex; gap:4px; margin-left:auto;">
          <button type="button" class="ghost tiny m-quick-delay" data-idx="${idx}" data-val="100">+100ms</button>
          <button type="button" class="ghost tiny m-quick-delay" data-idx="${idx}" data-val="500">+500ms</button>
          <button type="button" class="ghost tiny m-quick-delay" data-idx="${idx}" data-val="1000">+1s</button>
        </div>
      </div>
    `;
  } else if (t === 'mouse_click') {
    bodyHtml = `
      <div class="macro-inline-row">
        <label>按键：</label>
        <select class="m-field" data-field="button" data-idx="${idx}" style="flex: 1;">
          <option value="left" ${act.button === 'left' || !act.button ? 'selected' : ''}>左键 (Left)</option>
          <option value="right" ${act.button === 'right' ? 'selected' : ''}>右键 (Right)</option>
          <option value="middle" ${act.button === 'middle' ? 'selected' : ''}>中键 (Middle)</option>
        </select>
        <label style="margin-left: 6px; display: flex; align-items: center; gap: 4px; font-size: 12px; cursor: pointer;">
          <input type="checkbox" class="m-field-chk" data-field="double" data-idx="${idx}" ${act.double ? 'checked' : ''} /> 双击
        </label>
      </div>
      <div class="macro-inline-row" style="margin-top: 4px;">
        <span style="font-size: 11px; color: var(--muted); min-width: 32px;">坐标:</span>
        <input type="number" class="m-field" data-field="x" data-idx="${idx}" value="${act.x !== undefined ? act.x : ''}" placeholder="X (原位)" style="flex: 1; min-width: 0;" />
        <input type="number" class="m-field" data-field="y" data-idx="${idx}" value="${act.y !== undefined ? act.y : ''}" placeholder="Y (原位)" style="flex: 1; min-width: 0;" />
      </div>
      <button type="button" class="ghost tiny m-pick-coord" data-idx="${idx}" data-fields="x,y" style="width: 100%; margin-top: 4px;">🎯 倒计时 3 秒拾取坐标</button>
      <span class="muted small" style="display:block; margin-top:2px;">（X/Y 留空则在当前鼠标位置原位点击）</span>
    `;
  } else if (t === 'mouse_move') {
    bodyHtml = `
      <div class="macro-inline-row">
        <span style="font-size: 11px; color: var(--muted); min-width: 32px;">目标:</span>
        <input type="number" class="m-field" data-field="x" data-idx="${idx}" value="${act.x !== undefined ? act.x : 0}" placeholder="X 坐标" style="flex: 1; min-width: 0;" />
        <input type="number" class="m-field" data-field="y" data-idx="${idx}" value="${act.y !== undefined ? act.y : 0}" placeholder="Y 坐标" style="flex: 1; min-width: 0;" />
      </div>
      <button type="button" class="ghost tiny m-pick-coord" data-idx="${idx}" data-fields="x,y" style="width: 100%; margin-top: 4px;">🎯 倒计时 3 秒拾取坐标</button>
      <div class="macro-inline-row" style="margin-top: 4px;">
        <label>平滑移动：</label>
        <input type="number" class="m-field" data-field="duration" data-idx="${idx}" min="0" max="5000" step="50" value="${act.duration || 0}" style="width: 75px;" /> ms
        <span class="muted small" style="margin-left: auto;">(0为瞬间瞬移)</span>
      </div>
    `;
  } else if (t === 'mouse_drag') {
    bodyHtml = `
      <div class="macro-inline-row">
        <span style="font-size: 11px; color: var(--muted); min-width: 32px;">起点:</span>
        <input type="number" class="m-field" data-field="x1" data-idx="${idx}" value="${act.x1 !== undefined ? act.x1 : 0}" placeholder="X1" style="flex: 1; min-width: 0;" />
        <input type="number" class="m-field" data-field="y1" data-idx="${idx}" value="${act.y1 !== undefined ? act.y1 : 0}" placeholder="Y1" style="flex: 1; min-width: 0;" />
        <button type="button" class="ghost tiny m-pick-coord" data-idx="${idx}" data-fields="x1,y1">🎯 拾取起点</button>
      </div>
      <div class="macro-inline-row" style="margin-top: 4px;">
        <span style="font-size: 11px; color: var(--muted); min-width: 32px;">终点:</span>
        <input type="number" class="m-field" data-field="x2" data-idx="${idx}" value="${act.x2 !== undefined ? act.x2 : 0}" placeholder="X2" style="flex: 1; min-width: 0;" />
        <input type="number" class="m-field" data-field="y2" data-idx="${idx}" value="${act.y2 !== undefined ? act.y2 : 0}" placeholder="Y2" style="flex: 1; min-width: 0;" />
        <button type="button" class="ghost tiny m-pick-coord" data-idx="${idx}" data-fields="x2,y2">🎯 拾取终点</button>
      </div>
      <div class="macro-inline-row" style="margin-top: 4px;">
        <label>拖拽耗时：</label>
        <input type="number" class="m-field" data-field="duration" data-idx="${idx}" min="50" max="10000" step="50" value="${act.duration || 300}" style="width: 75px;" /> ms
      </div>
    `;
  } else if (t === 'mouse_wheel') {
    bodyHtml = `
      <div class="macro-inline-row">
        <label>滚动步长：</label>
        <input type="number" class="m-field" data-field="delta" data-idx="${idx}" step="120" value="${act.delta || -120}" style="width: 80px;" />
        <button type="button" class="ghost tiny m-wheel-set" data-idx="${idx}" data-val="120">向上 +120</button>
        <button type="button" class="ghost tiny m-wheel-set" data-idx="${idx}" data-val="-120">向下 -120</button>
      </div>
    `;
  } else if (t === 'window_rect') {
    bodyHtml = `
      <div class="macro-inline-row">
        <label>目标窗口：</label>
        <input class="m-field" data-field="target" data-idx="${idx}" value="${escapeAttr(act.target || '')}" placeholder="窗口标题包含或进程名 (例如 Steam, leigod)" />
      </div>
      <div class="macro-rect-grid" style="margin-top: 6px;">
        <div class="macro-num-field">
          <span class="m-lbl">X 坐标</span>
          <input type="number" class="m-field" data-field="x" data-idx="${idx}" value="${act.x !== undefined ? act.x : 0}" />
        </div>
        <div class="macro-num-field">
          <span class="m-lbl">Y 坐标</span>
          <input type="number" class="m-field" data-field="y" data-idx="${idx}" value="${act.y !== undefined ? act.y : 0}" />
        </div>
        <div class="macro-num-field">
          <span class="m-lbl">宽度 W</span>
          <input type="number" class="m-field" data-field="w" data-idx="${idx}" value="${act.w !== undefined ? act.w : 1280}" />
        </div>
        <div class="macro-num-field">
          <span class="m-lbl">高度 H</span>
          <input type="number" class="m-field" data-field="h" data-idx="${idx}" value="${act.h !== undefined ? act.h : 720}" />
        </div>
      </div>
      <div class="btn-win-preset-row">
        <button type="button" class="ghost tiny m-win-preset" data-idx="${idx}" data-x="0" data-y="0" data-w="960" data-h="1040">🖥️ 左半屏</button>
        <button type="button" class="ghost tiny m-win-preset" data-idx="${idx}" data-x="960" data-y="0" data-w="960" data-h="1040">🖥️ 右半屏</button>
        <button type="button" class="ghost tiny m-win-preset" data-idx="${idx}" data-x="0" data-y="0" data-w="1920" data-h="1080">🖥️ 全屏 1080p</button>
        <button type="button" class="ghost tiny m-win-preset" data-idx="${idx}" data-x="320" data-y="180" data-w="1280" data-h="720">🖥️ 居中 720p</button>
      </div>
    `;
  } else if (t === 'media') {
    bodyHtml = `
      <div class="macro-inline-row">
        <label>多媒体操作：</label>
        <select class="m-field" data-field="cmd" data-idx="${idx}">
          <option value="play_pause" ${act.cmd === 'play_pause' || !act.cmd ? 'selected' : ''}>⏯️ 播放 / 暂停</option>
          <option value="next" ${act.cmd === 'next' ? 'selected' : ''}>⏭️ 下一曲</option>
          <option value="prev" ${act.cmd === 'prev' ? 'selected' : ''}>⏮️ 上一曲</option>
          <option value="vol_up" ${act.cmd === 'vol_up' ? 'selected' : ''}>🔊 音量 +</option>
          <option value="vol_down" ${act.cmd === 'vol_down' ? 'selected' : ''}>🔉 音量 -</option>
          <option value="mute" ${act.cmd === 'mute' ? 'selected' : ''}>🔇 静音切换</option>
        </select>
      </div>
    `;
  }

  return `
    <div class="macro-card" data-idx="${idx}">
      <div class="macro-card-head">
        <div class="macro-card-title">
          <span class="badge" style="background: var(--line);">${idx + 1}</span>
          <span>${getActionIcon(t)} ${getActionTypeName(t)}</span>
        </div>
        <div class="macro-card-tools">
          <button type="button" class="ghost tiny" data-act-tool="up" data-idx="${idx}" ${idx === 0 ? 'disabled' : ''} title="上移">▲</button>
          <button type="button" class="ghost tiny" data-act-tool="down" data-idx="${idx}" ${idx === total - 1 ? 'disabled' : ''} title="下移">▼</button>
          <button type="button" class="ghost tiny" data-act-tool="clone" data-idx="${idx}" title="复制">📋</button>
          <button type="button" class="ghost tiny danger" data-act-tool="del" data-idx="${idx}" title="删除">×</button>
        </div>
      </div>
      <div class="macro-card-body">
        ${bodyHtml}
      </div>
    </div>
  `;
}

function renderMacroEditorHtml(spec) {
  const actions = Array.isArray(spec.actions) ? spec.actions : [];
  const loop = spec.loop || { mode: 'once', interval: 50 };

  return `
    <div class="macro-box">
      <div class="macro-loop-box">
        <div class="macro-loop-row">
          <label style="font-weight: 600; color: var(--fg);">🔁 宏执行模式：</label>
          <select id="m-loop-mode" style="width: auto; flex: 1;">
            <option value="once" ${loop.mode === 'once' ? 'selected' : ''}>🎯 单次运行（拍击一次执行一轮）</option>
            <option value="toggle" ${loop.mode === 'toggle' ? 'selected' : ''}>🔁 开关循环（拍击开始循环，再拍停止）</option>
            <option value="times" ${loop.mode === 'times' ? 'selected' : ''}>🔢 指定次数（循环运行 N 次）</option>
          </select>
        </div>
        <div class="macro-loop-row" id="m-loop-times-row" style="${loop.mode === 'times' ? '' : 'display:none;'}">
          <label>循环次数：</label>
          <input type="number" id="m-loop-times" min="1" max="9999" value="${loop.times || 5}" style="width: 80px;" /> 次
        </div>
        <div class="macro-loop-row">
          <label>轮次间歇延迟：</label>
          <input type="number" id="m-loop-interval" min="20" max="60000" step="10" value="${loop.interval || 50}" style="width: 80px;" /> ms
          <span class="muted small" style="margin-left:auto;">(防卡死阈值: 20ms)</span>
        </div>
        <div class="btnrow" style="margin-top: 4px;">
          <button type="button" class="ghost tiny" id="m-btn-test-run" style="flex:1;">▶ 运行测试宏</button>
          <button type="button" class="ghost tiny danger" id="m-btn-stop-all" style="flex:1;">⏹ 停止所有宏</button>
        </div>
      </div>

      <div class="macro-action-list" id="m-action-list">
        ${actions.map((act, idx) => renderActionCardHtml(act, idx, actions.length)).join('')}
        ${actions.length === 0 ? '<p class="muted" style="text-align: center; padding: 14px 0; background: var(--card); border: 1px dashed var(--line); border-radius: 8px;">动作队列暂为空，请点击下方按钮添加动作步骤 ⬇️</p>' : ''}
      </div>

      <div style="margin-top: 6px;">
        <label style="font-size: 11px; color: var(--muted); margin-bottom: 4px; display: block;">➕ 添加动作步骤：</label>
        <div class="macro-add-toolbar">
          <button type="button" class="ghost" data-add="open">🚀 启动程序/打开</button>
          <button type="button" class="ghost" data-add="delay">⏱️ 等待延迟</button>
          <button type="button" class="ghost" data-add="mouse_click">🖱️ 鼠标点击</button>
          <button type="button" class="ghost" data-add="hotkey">⌨️ 模拟快捷键</button>
          <button type="button" class="ghost" data-add="text">✍️ 键盘输入文本</button>
          <button type="button" class="ghost" data-add="window_rect">📐 窗口尺寸归一化</button>
          <button type="button" class="ghost" data-add="mouse_move">🖱️ 鼠标平移</button>
          <button type="button" class="ghost" data-add="mouse_drag">🖲️ 鼠标拖拽</button>
          <button type="button" class="ghost" data-add="mouse_wheel">🎡 鼠标滚轮</button>
          <button type="button" class="ghost" data-add="cmd">⚡ 命令行 (Cmd/PS)</button>
          <button type="button" class="ghost" data-add="media">🔊 多媒体控制</button>
        </div>
      </div>
    </div>
  `;
}

function wireMacroEditor(box, spec) {
  spec.actions = spec.actions || [];
  spec.loop = spec.loop || { mode: 'once', interval: 50 };

  const modeSel = box.querySelector('#m-loop-mode');
  const timesRow = box.querySelector('#m-loop-times-row');
  const timesInput = box.querySelector('#m-loop-times');
  const intervalInput = box.querySelector('#m-loop-interval');

  if (modeSel) {
    modeSel.addEventListener('change', async () => {
      spec.loop.mode = modeSel.value;
      if (timesRow) timesRow.style.display = spec.loop.mode === 'times' ? '' : 'none';
      await commit(true);
    });
  }
  if (timesInput) {
    timesInput.addEventListener('change', async () => {
      spec.loop.times = Number(timesInput.value) || 5;
      await commit(true);
    });
  }
  if (intervalInput) {
    intervalInput.addEventListener('change', async () => {
      spec.loop.interval = Math.max(20, Number(intervalInput.value) || 50);
      await commit(true);
    });
  }

  const btnRun = box.querySelector('#m-btn-test-run');
  if (btnRun) {
    btnRun.onclick = async () => {
      if (typeof api !== 'undefined' && api.actionRun) {
        toast('正在测试执行宏动作序列…');
        await api.actionRun(spec);
      }
    };
  }
  const btnStop = box.querySelector('#m-btn-stop-all');
  if (btnStop) {
    btnStop.onclick = async () => {
      if (typeof api !== 'undefined' && api.macroStopAll) {
        await api.macroStopAll();
        toast('已发送紧急停止信号');
      }
    };
  }

  box.querySelectorAll('.m-field').forEach((inp) => {
    inp.addEventListener('change', async () => {
      const idx = Number(inp.dataset.idx);
      const fld = inp.dataset.field;
      if (spec.actions[idx]) {
        spec.actions[idx][fld] = inp.type === 'number' ? (inp.value === '' ? '' : Number(inp.value)) : inp.value;
        await commit(true);
      }
    });
  });

  box.querySelectorAll('.m-field-chk').forEach((chk) => {
    chk.addEventListener('change', async () => {
      const idx = Number(chk.dataset.idx);
      const fld = chk.dataset.field;
      if (spec.actions[idx]) {
        spec.actions[idx][fld] = chk.checked;
        await commit(true);
      }
    });
  });

  box.querySelectorAll('.hotkey-builder-wrap[data-macro-idx]').forEach((wrap) => {
    const idx = Number(wrap.dataset.macroIdx);
    bindHotkeyBuilder(wrap, `m-hk-${idx}`, async (val) => {
      if (spec.actions && spec.actions[idx]) {
        spec.actions[idx].target = val;
        spec.actions[idx].combo = val;
        await commit(true);
      }
    });
  });

  box.querySelectorAll('[data-act-tool]').forEach((btn) => {
    btn.onclick = async () => {
      const tool = btn.dataset.actTool;
      const idx = Number(btn.dataset.idx);
      if (tool === 'up' && idx > 0) {
        const tmp = spec.actions[idx - 1];
        spec.actions[idx - 1] = spec.actions[idx];
        spec.actions[idx] = tmp;
      } else if (tool === 'down' && idx < spec.actions.length - 1) {
        const tmp = spec.actions[idx + 1];
        spec.actions[idx + 1] = spec.actions[idx];
        spec.actions[idx] = tmp;
      } else if (tool === 'clone') {
        spec.actions.splice(idx + 1, 0, clone(spec.actions[idx]));
      } else if (tool === 'del') {
        spec.actions.splice(idx, 1);
      }
      await commit(true);
      renderInspector();
    };
  });

  box.querySelectorAll('[data-add]').forEach((btn) => {
    btn.onclick = async () => {
      const type = btn.dataset.add;
      let newAct = { type };
      if (type === 'open') newAct = { type: 'app', target: '', args: '' };
      else if (type === 'delay') newAct = { type: 'delay', ms: 500 };
      else if (type === 'mouse_click') newAct = { type: 'mouse_click', button: 'left', double: false };
      else if (type === 'mouse_move') newAct = { type: 'mouse_move', x: 0, y: 0, duration: 0 };
      else if (type === 'mouse_drag') newAct = { type: 'mouse_drag', x1: 0, y1: 0, x2: 200, y2: 200, duration: 300 };
      else if (type === 'mouse_wheel') newAct = { type: 'mouse_wheel', delta: -120 };
      else if (type === 'hotkey') newAct = { type: 'hotkey', target: 'Ctrl+C' };
      else if (type === 'text') newAct = { type: 'text', text: '' };
      else if (type === 'window_rect') newAct = { type: 'window_rect', target: '', x: 0, y: 0, w: 1280, h: 720 };
      else if (type === 'cmd') newAct = { type: 'command', target: '' };
      else if (type === 'media') newAct = { type: 'media', cmd: 'play_pause' };
      spec.actions.push(newAct);
      await commit(true);
      renderInspector();
    };
  });

  box.querySelectorAll('.m-pick-coord').forEach((btn) => {
    btn.onclick = () => {
      const idx = Number(btn.dataset.idx);
      const fields = btn.dataset.fields.split(',');
      startCoordinatePicker(btn, async (x, y) => {
        if (spec.actions[idx]) {
          if (fields.length === 2) {
            spec.actions[idx][fields[0]] = x;
            spec.actions[idx][fields[1]] = y;
          }
          await commit(true);
          renderInspector();
        }
      });
    };
  });

  box.querySelectorAll('[data-act-pick="file"]').forEach((btn) => {
    btn.onclick = async () => {
      const idx = Number(btn.dataset.idx);
      if (typeof api !== 'undefined' && api.dialogPick) {
        const r = await api.dialogPick({ properties: ['openFile'] });
        if (r && r.filePaths && r.filePaths[0]) {
          spec.actions[idx].target = r.filePaths[0];
          await commit(true);
          renderInspector();
        }
      }
    };
  });

  box.querySelectorAll('.m-quick-hk').forEach((tag) => {
    tag.onclick = async () => {
      const idx = Number(tag.dataset.idx);
      if (spec.actions[idx]) {
        spec.actions[idx].target = tag.dataset.hk;
        await commit(true);
        renderInspector();
      }
    };
  });

  box.querySelectorAll('.m-quick-delay').forEach((btn) => {
    btn.onclick = async () => {
      const idx = Number(btn.dataset.idx);
      if (spec.actions[idx]) {
        spec.actions[idx].ms = (Number(spec.actions[idx].ms) || 0) + Number(btn.dataset.val);
        await commit(true);
        renderInspector();
      }
    };
  });

  box.querySelectorAll('.m-wheel-set').forEach((btn) => {
    btn.onclick = async () => {
      const idx = Number(btn.dataset.idx);
      if (spec.actions[idx]) {
        spec.actions[idx].delta = Number(btn.dataset.val);
        await commit(true);
        renderInspector();
      }
    };
  });

  box.querySelectorAll('.m-win-preset').forEach((btn) => {
    btn.onclick = async () => {
      const idx = Number(btn.dataset.idx);
      if (spec.actions[idx]) {
        spec.actions[idx].x = Number(btn.dataset.x);
        spec.actions[idx].y = Number(btn.dataset.y);
        spec.actions[idx].w = Number(btn.dataset.w);
        spec.actions[idx].h = Number(btn.dataset.h);
        await commit(true);
        renderInspector();
      }
    };
  });
}

function renderInspector() {
  stopCurrentHkRecorder(null);
  const box = $('inspector');
  const title = $('inspectorTitle');
  const inspTabs = $('inspTabs');

  if (!selected) {
    if (inspTabs) inspTabs.hidden = true;
    title.textContent = '页面设置 · 整板渐变';
    return renderPageInspector(box);
  }
  if (selected.col === 5) {
    if (inspTabs) inspTabs.hidden = true;
    title.textContent = `显示屏 ${selected.row + 1}`;
    return renderStripInspector(box);
  }

  title.textContent = `按键 r${selected.row}c${selected.col}`;

  if (isBackCell(selected.row, selected.col)) {
    if (inspTabs) inspTabs.hidden = true;
    box.className = 'inspector';
    box.innerHTML = `
      <p class="muted"><b>这是子页的自动返回键。</b></p>
      <p class="muted">子页（文件夹）的右下角一定长着它，按一下就回到上一级 ——
      位置永远一样，闭眼也按得到。你不用配它，也不能覆盖它。</p>
      <p class="path">当前页：「${escapeHtml(curPage().name)}」是子页${
        pageById(curPage().parent) ? '，上级是「' + escapeHtml(pageById(curPage().parent).name) + '」' : ''}。</p>
      <div class="btnrow"><button class="ghost" id="i-goup">现在回到上一级</button></div>`;
    $('i-goup').onclick = () => goToPage(curPage().parent);
    return;
  }

  const key = selected.row + ',' + selected.col;
  const spec = pageButtons()[key];
  if (!spec) {
    if (inspTabs) inspTabs.hidden = true;
    box.className = 'inspector empty';
    box.innerHTML = `<p class="muted">r${selected.row}c${selected.col} 还是空的 —— 拖个文件进来，或者：</p>
      <div class="btnrow">
        <button class="ghost" id="i-pickapp">选择程序 / 文件…</button>
        <button class="ghost" id="i-pickdir">选择文件夹…</button>
      </div>
      <div class="btnrow">
        <button class="ghost" id="i-quickurl">填网址…</button>
        <button class="ghost" id="i-quickcmd">填命令…</button>
      </div>
      <div class="btnrow">
        <button class="ghost" id="i-quickmacro">🎛️ 设为复合宏…</button>
        <button class="ghost" id="i-quickhotkey">设为快捷键…</button>
        <button class="ghost" id="i-page">设为翻页键…</button>
      </div>`;
    $('i-pickapp').onclick = () => pickInto({ properties: ['openFile'] });
    $('i-pickdir').onclick = () => pickInto({ properties: ['openDirectory'] });
    $('i-quickurl').onclick = () => quickSet('url');
    $('i-quickcmd').onclick = () => quickSet('command');
    $('i-quickmacro').onclick = () => {
      pageButtons()[selected.row + ',' + selected.col] = {
        type: 'multi', label: '新宏动作', color: '#1b5e20',
        actions: [],
        loop: { mode: 'once', interval: 50 }
      };
      commit(true);
      renderInspector();
    };
    $('i-quickhotkey').onclick = () => {
      pageButtons()[selected.row + ',' + selected.col] = {
        type: 'hotkey', label: '显示桌面', hotkey: 'Win+D', target: 'Win+D', color: '#107c41', icon: '', args: ''
      };
      commit(true);
      renderInspector();
    };
    $('i-page').onclick = async () => {
      const r = await askPageAction(null);
      if (!r) return;
      pageButtons()[selected.row + ',' + selected.col] = makePageSpec(r.mode, r.pageId);
      await commit(true);
      renderInspector();
    };
    return;
  }

  if (inspTabs) inspTabs.hidden = false;

  const curBadge = getActiveBadge(spec);
  const curBadgeState = (spec._activeState !== undefined) ? spec._activeState : (spec.badgeInitialState || 0);

  const t = (id, val) => `<input id="${id}" value="${escapeAttr(val)}" />`;
  box.className = 'inspector';
  box.innerHTML = `
    <details class="sec" data-sec="action" ${secOpen.action ? 'open' : ''}>
      <summary>按键动作配置</summary>
      <div class="body">
        <div class="row"><label>显示名称（支持自动换行或回车折行）</label><textarea id="i-label">${escapeHtml(spec.label || '')}</textarea></div>

        <div class="row">
          <label>动作模式</label>
          <div class="color-capsule-group">
            <button type="button" id="i-toggle-act-single" class="color-capsule-pill ${!spec.toggleAction ? 'active' : ''}">🟢 单一动作</button>
            <button type="button" id="i-toggle-act-dual" class="color-capsule-pill ${spec.toggleAction ? 'active' : ''}">⚡ 双态独立动作</button>
          </div>
        </div>

        ${!spec.toggleAction ? `
          <div id="i-single-action-box">
            <div class="row"><label>快捷动作预设</label>
              <select id="i-quickpreset" class="quick-preset-select">
                ${ACTION_TEMPLATES.map((t) => `<option value="${t.id}">${t.name}</option>`).join('')}
              </select>
            </div>
            <div class="btnrow">
              <button class="ghost" id="i-pickapp">选择程序…</button>
              <button class="ghost" id="i-pickdir">选择文件夹…</button>
            </div>
            <div class="btnrow">
              <button class="ghost" id="i-pickurl">设为网址</button>
              <button class="ghost" id="i-pickcmd">设为命令</button>
            </div>
            <div class="btnrow">
              <button class="ghost" id="i-pickmacro">设为复合宏</button>
              <button class="ghost" id="i-pickhotkey">设为快捷键</button>
              <button class="ghost" id="i-page">${spec.type === 'page' ? '改翻页设置…' : '设为翻页键…'}</button>
            </div>
            ${spec.type === 'hotkey' ? `
              <div class="row">
                <label>快捷键组合（支持免冲突点选、录制或直接输入）</label>
                ${renderHotkeyBuilderHtml('i-hotkey', spec.hotkey || spec.target || '')}
              </div>
            ` : ''}
            <div class="row"><label>类型</label>
              <select id="i-type">
                ${Object.keys(TYPE_NAMES).map((x) =>
                  `<option value="${x}" ${spec.type === x ? 'selected' : ''}>${TYPE_NAMES[x]}</option>`).join('')}
              </select>
            </div>
            ${spec.type === 'multi' || spec.type === 'macro' ? `
              <div id="i-macro-editor-container">
                ${renderMacroEditorHtml(spec)}
              </div>
            ` : spec.type === 'page' ? `
              <div class="page-inspector-card">
                <div class="page-insp-head">
                  <span class="page-insp-label">${(PAGE_MODE_INFOS.find(m => m.id === (spec.mode || 'next')) || {}).icon || '📄'} ${escapeHtml(pageActionLabel(spec))}</span>
                  <span class="page-insp-badge">模式: ${escapeHtml(spec.mode || 'next')}</span>
                </div>
                <div style="font-size: 11px; color: var(--muted); margin-top: 2px;">快速切换翻页行为：</div>
                <div class="page-mode-pills">
                  ${PAGE_MODE_INFOS.map((m) => `
                    <button type="button" class="page-pill ${(spec.mode || 'next') === m.id ? 'active' : ''}" data-mode="${m.id}">
                      ${m.icon} ${m.name}
                    </button>
                  `).join('')}
                </div>
                ${(spec.mode === 'goto') ? `
                  <div class="page-target-wrap" style="margin-top: 6px;">
                    <label style="font-size: 11px; color: var(--muted); margin-bottom: 4px; display: block;">🎯 目标跳转页面：</label>
                    <select id="i-page-target-select" class="page-select-styled">
                      ${pageTree().map(({ page, depth }) => `
                        <option value="${page.id}" ${spec.pageId === page.id ? 'selected' : ''}>
                          ${'　'.repeat(depth)}${depth ? '↳ ' : ''}${escapeHtml(page.name)}
                        </option>
                      `).join('')}
                    </select>
                  </div>
                ` : ''}
                <p class="path" style="font-size: 11px; color: var(--muted); margin-top: 6px;">实际目标：切至「${escapeHtml(pageActionLabel(spec))}」</p>
                <button type="button" class="ghost tiny" id="i-page-open-modal" style="width: 100%; margin-top: 6px;">
                  ⚙️ 打开高级翻页配置器…
                </button>
              </div>
            ` : `
              <div class="row"><label>目标（程序 / 路径 / 网址 / 命令 / 快捷键）</label><textarea id="i-target">${escapeHtml(spec.target || '')}</textarea></div>
              <div class="row"><label>参数（可留空）</label>${t('i-args', spec.args || '')}</div>
              <p class="path">实际目标：${escapeHtml(spec.target || '(空)')}</p>
            `}
          </div>
          <div id="i-toggle-action2-box" style="display: none;"></div>
        ` : `
          <div id="i-single-action-box" style="display: none;"></div>
          <div id="i-toggle-action2-box" class="dual-action-container">
            <!-- 形态 1 卡片 -->
            <div class="dual-action-card state1-card">
              <div class="dual-action-head">
                <div class="dual-head-left">
                  <span class="dual-dot state1-dot"></span>
                  <span class="dual-title">形态 1 · 默认动作</span>
                </div>
                <span class="dual-tag tag-state1">默认态 (未运行)</span>
              </div>
              <div class="btnrow" style="margin-top: 6px;">
                <button class="ghost tiny" id="i-pickapp">选择程序…</button>
                <button class="ghost tiny" id="i-pickdir">选择文件夹…</button>
                <button class="ghost tiny" id="i-pickhotkey">设为快捷键</button>
                <button class="ghost tiny" id="i-pickcmd">设为命令</button>
              </div>
              ${spec.type === 'hotkey' ? `
                <div class="row" style="margin-top: 6px;">
                  <label style="font-size: 11px;">形态 1 快捷键组合</label>
                  ${renderHotkeyBuilderHtml('i-hotkey', spec.hotkey || spec.target || '')}
                </div>
              ` : ''}
              <div class="row" style="margin-top: 6px;"><label style="font-size: 11px;">形态 1 类型</label>
                <select id="i-type">
                  <option value="app" ${spec.type === 'app' ? 'selected' : ''}>应用程序 / 路径 (App)</option>
                  <option value="hotkey" ${spec.type === 'hotkey' ? 'selected' : ''}>虚拟快捷键 (Hotkey)</option>
                  <option value="command" ${spec.type === 'command' ? 'selected' : ''}>命令行 (CMD)</option>
                  <option value="url" ${spec.type === 'url' ? 'selected' : ''}>打开网址 (URL)</option>
                  <option value="folder" ${spec.type === 'folder' ? 'selected' : ''}>打开文件夹</option>
                  <option value="multi" ${spec.type === 'multi' ? 'selected' : ''}>复合宏动作</option>
                </select>
              </div>
              ${spec.type === 'multi' ? `
                <div id="i-macro-editor-container">
                  ${renderMacroEditorHtml(spec)}
                </div>
              ` : spec.type !== 'hotkey' ? `
                <div class="row"><label style="font-size: 11px;">形态 1 目标（程序/网址/命令）</label><textarea id="i-target" style="min-height: 48px;">${escapeHtml(spec.target || '')}</textarea></div>
                <div class="row"><label style="font-size: 11px;">参数（可留空）</label>${t('i-args', spec.args || '')}</div>
              ` : ''}
            </div>

            <!-- 互换动作条 -->
            <div class="dual-action-swap-bar">
              <div class="swap-line"></div>
              <button type="button" id="i-swap-actions" class="swap-action-btn" title="互换形态 1 与形态 2 的执行动作">
                <span class="swap-icon">🔁</span> 互换形态 1 与形态 2 动作
              </button>
              <div class="swap-line"></div>
            </div>
            <div class="swap-action-hint">纯动作互换 · 角标文字与颜色保持不变</div>

            <!-- 形态 2 卡片 -->
            <div class="dual-action-card state2-card">
              <div class="dual-action-head">
                <div class="dual-head-left">
                  <span class="dual-dot state2-dot"></span>
                  <span class="dual-title">形态 2 · 触发动作</span>
                </div>
                <span class="dual-tag tag-state2">触发态 (运行中)</span>
              </div>
              <div class="btnrow" style="margin-top: 6px;">
                <button class="ghost tiny" id="i-act2-pickkill" title="提取主进程名一键填充 taskkill 退出命令">⚡ 设为退出命令</button>
                <button class="ghost tiny" id="i-act2-pickapp">选择程序…</button>
                <button class="ghost tiny" id="i-act2-pickhk">设为快捷键</button>
                <button class="ghost tiny" id="i-act2-pickcmd">设为命令</button>
              </div>
              <div class="row" style="margin-top: 6px;">
                <label style="font-size: 11px;">形态 2 动作类型</label>
                <select id="i-toggle-action2-type">
                  <option value="command" ${((spec.action2 && spec.action2.type) === 'command' || (!spec.action2 && spec.type === 'app')) ? 'selected' : ''}>命令行 (CMD / taskkill)</option>
                  <option value="hotkey" ${(spec.action2 && spec.action2.type === 'hotkey') ? 'selected' : ''}>虚拟快捷键 (Hotkey)</option>
                  <option value="app" ${(spec.action2 && spec.action2.type === 'app') ? 'selected' : ''}>应用程序 / 路径 (App)</option>
                  <option value="url" ${(spec.action2 && spec.action2.type === 'url') ? 'selected' : ''}>打开网址 (URL)</option>
                </select>
              </div>
              <div class="row" id="i-toggle-action2-hotkey-row" style="${(spec.action2 && spec.action2.type === 'hotkey') ? '' : 'display: none;'}">
                <label style="font-size: 11px;">形态 2 快捷键组合</label>
                ${renderHotkeyBuilderHtml('i-toggle-action2-hk', (spec.action2 && (spec.action2.hotkey || spec.action2.target)) || '')}
              </div>
              <div class="row" id="i-toggle-action2-target-row" style="${(spec.action2 && spec.action2.type === 'hotkey') ? 'display: none;' : ''}">
                <label style="font-size: 11px;">形态 2 目标（命令行 / 程序 / 网址）</label>
                <textarea id="i-toggle-action2-target" style="min-height: 48px;">${escapeHtml((spec.action2 && spec.action2.target) || '')}</textarea>
              </div>
              <div class="row" id="i-toggle-action2-args-row" style="${(spec.action2 && spec.action2.type === 'app') ? '' : 'display: none;'}">
                <label style="font-size: 11px;">形态 2 参数（可留空）</label>
                <input id="i-toggle-action2-args" value="${escapeAttr((spec.action2 && spec.action2.args) || '')}" />
              </div>
            </div>
          </div>
        `}
      </div>
    </details>

    <details class="sec" data-sec="look" ${secOpen.look ? 'open' : ''}>
      <summary>外观、图标与角标</summary>
      <div class="body">
        <div class="icon-ctrl-box">
          <div class="icon-preview-wrap">
            ${spec.icon
              ? `<img src="${spec.icon}" class="icon-preview-img" />`
              : `<span class="icon-preview-glyph">${glyphFor(spec.type) || '无'}</span>`}
          </div>
          <div class="icon-btn-group">
            <button class="ghost" id="i-openiconpicker">🎨 矢量图标库…</button>
            <button class="ghost" id="i-iconfile">📁 本地文件…</button>
            ${spec.icon ? `<button class="ghost" id="i-cropicon">✂️ 裁剪微调</button>` : ''}
            <button class="ghost" id="i-saveicon">⭐ 存入图标库</button>
            ${spec.icon ? `<button class="ghost tiny danger" id="i-clr">清除图标</button>` : ''}
          </div>
        </div>

        <div class="row" style="margin-top: 10px;">
          <label>角标 / 状态微标（右上角微标，支持静态或双态切换）</label>
          <div class="color-capsule-group" style="margin-bottom: 8px;">
            <button type="button" id="i-badgemode-static" class="color-capsule-pill ${!spec.badgeToggle ? 'active' : ''}">📌 静态角标</button>
            <button type="button" id="i-badgemode-toggle" class="color-capsule-pill ${spec.badgeToggle ? 'active' : ''}">⚡ 动态双态 (Toggle)</button>
          </div>

          <!-- 静态角标区 -->
          <div id="i-badgesec-static" class="badge-ctrl-row" style="${spec.badgeToggle ? 'display: none;' : ''}">
            <div class="badge-presets" id="i-badgepresets">
              <button class="badge-pill ${!spec.badge ? 'active' : ''}" data-val="">无</button>
              <button class="badge-pill ${spec.badge === '✓' ? 'active' : ''}" data-val="✓">✓</button>
              <button class="badge-pill ${spec.badge === '✕' ? 'active' : ''}" data-val="✕">✕</button>
              <button class="badge-pill ${spec.badge === '➔' ? 'active' : ''}" data-val="➔">➔</button>
              <button class="badge-pill ${spec.badge === '1' ? 'active' : ''}" data-val="1">1</button>
              <button class="badge-pill ${spec.badge === '2' ? 'active' : ''}" data-val="2">2</button>
              <button class="badge-pill ${spec.badge === 'A' ? 'active' : ''}" data-val="A">A</button>
              <button class="badge-pill ${spec.badge === '●' ? 'active' : ''}" data-val="●">●</button>
            </div>
            <div class="badge-custom-row">
              <input id="i-badgetext" class="badge-input" maxlength="4" placeholder="自定义" value="${escapeAttr(spec.badge || '')}" />
              <input id="i-badgebg" type="color" class="badge-color" title="微标背景色" value="${spec.badgeBg || '#e53935'}" />
            </div>
          </div>

          <!-- 动态双态角标区 -->
          <div id="i-badgesec-toggle" class="badge-toggle-container" style="${!spec.badgeToggle ? 'display: none;' : ''}">
            <div class="badge-toggle-presets" id="i-toggle-presets">
              ${BADGE_TOGGLE_PRESETS.map((p, idx) => `
                <button type="button" class="badge-toggle-preset-pill" data-idx="${idx}">${p.name}</button>
              `).join('')}
            </div>
            <div class="badge-toggle-grid">
              <div class="badge-toggle-card ${curBadgeState === 0 ? 'active-state' : ''}">
                <div class="badge-toggle-card-head">
                  <span class="badge-toggle-dot" style="background: ${(spec.badgeState1 && spec.badgeState1.bg) || '#107c41'};"></span>
                  <span class="badge-toggle-title">状态 1 (默认态)</span>
                  ${curBadgeState === 0 ? '<span class="badge-current-tag">当前激活</span>' : ''}
                </div>
                <div class="badge-toggle-card-inputs">
                  <input id="i-toggle-s1-text" class="badge-input" maxlength="6" placeholder="文字" value="${escapeAttr((spec.badgeState1 && spec.badgeState1.text) || 'ON')}" />
                  <input id="i-toggle-s1-bg" type="color" class="badge-color" title="背景色" value="${(spec.badgeState1 && spec.badgeState1.bg) || '#107c41'}" />
                </div>
              </div>
              <div class="badge-toggle-card ${curBadgeState === 1 ? 'active-state' : ''}">
                <div class="badge-toggle-card-head">
                  <span class="badge-toggle-dot" style="background: ${(spec.badgeState2 && spec.badgeState2.bg) || '#e53935'};"></span>
                  <span class="badge-toggle-title">状态 2 (触发态)</span>
                  ${curBadgeState === 1 ? '<span class="badge-current-tag">当前激活</span>' : ''}
                </div>
                <div class="badge-toggle-card-inputs">
                  <input id="i-toggle-s2-text" class="badge-input" maxlength="6" placeholder="文字" value="${escapeAttr((spec.badgeState2 && spec.badgeState2.text) || 'OFF')}" />
                  <input id="i-toggle-s2-bg" type="color" class="badge-color" title="背景色" value="${(spec.badgeState2 && spec.badgeState2.bg) || '#e53935'}" />
                </div>
              </div>
            </div>
            <div class="badge-toggle-actions">
              <button type="button" class="ghost tiny badge-try-btn" id="i-toggle-try-btn">
                🔄 试切状态预览（当前：${(curBadge && curBadge.text) || (curBadgeState === 0 ? ((spec.badgeState1 && spec.badgeState1.text) || 'ON') : ((spec.badgeState2 && spec.badgeState2.text) || 'OFF'))}）
              </button>
            </div>
          </div>
        </div>

        ${curPage().gradient && curPage().gradient.enabled ? `
          <div class="row" style="margin: 12px 0 6px;">
            <label style="display:block; font-size:12px; color:var(--muted); margin-bottom:4px;">底色模式</label>
            <div class="color-capsule-group">
              <button type="button" id="i-colormode-grad" class="color-capsule-pill ${!spec.customColor ? 'active' : ''}">🌈 跟随整板流光</button>
              <button type="button" id="i-colormode-custom" class="color-capsule-pill ${spec.customColor ? 'active' : ''}">🎨 独立底色</button>
            </div>
            <input type="checkbox" id="i-customcolor" style="display:none;" ${spec.customColor ? 'checked' : ''} />
          </div>
        ` : ''}
        <div class="stylegrid" id="i-colorgroup" style="${curPage().gradient && curPage().gradient.enabled && !spec.customColor ? 'display: none;' : ''}">
          <span>底色</span><input id="i-color" type="color" value="${spec.color || '#37474f'}" />
          <span>渐变到</span><input id="i-color2" type="color" value="${spec.color2 || '#37474f'}" />
        </div>
        <div class="tc-capsule-row">
          <span class="tc-label">文字色</span>
          <div class="color-capsule-group" id="i-tc-group">
            <button type="button" id="i-tc-auto" class="color-capsule-pill ${!spec.textColor ? 'active' : ''}">⚡ 自动对比色</button>
            <button type="button" id="i-tc-custom" class="color-capsule-pill ${spec.textColor ? 'active' : ''}">🎨 自定义色彩</button>
          </div>
          <input type="checkbox" id="i-autofg" style="display:none;" ${spec.textColor ? '' : 'checked'} />
        </div>
        <div id="i-tc-color-row" class="tc-color-expanded" style="${!spec.textColor ? 'display: none;' : ''}">
          <span class="muted small">选择颜色</span>
          <div class="tc-picker-wrap">
            <input id="i-textcolor" type="color" value="${spec.textColor || '#ffffff'}" />
            <span id="i-textcolor-hex" class="tc-hex">${spec.textColor || '#ffffff'}</span>
            <div class="tc-quick-dots">
              <span class="tc-dot" data-color="#ffffff" style="background:#ffffff;" title="纯白"></span>
              <span class="tc-dot" data-color="#000000" style="background:#000000;" title="纯黑"></span>
              <span class="tc-dot" data-color="#00ffcc" style="background:#00ffcc;" title="荧光青"></span>
              <span class="tc-dot" data-color="#ffb703" style="background:#ffb703;" title="琥珀金"></span>
              <span class="tc-dot" data-color="#ff4d4f" style="background:#ff4d4f;" title="亮红"></span>
              <span class="tc-dot" data-color="#69b1ff" style="background:#69b1ff;" title="天蓝"></span>
            </div>
          </div>
        </div>
        <div class="stylegrid">
          <span>字号 <b id="v-font">${Number(spec.fontSize) || 17}</b>%</span>
          <input id="i-fontsize" type="range" min="8" max="40" value="${Number(spec.fontSize) || 17}" />
          <span>图标 <b id="v-icon">${Number(spec.iconScale) || 62}</b>%</span>
          <input id="i-iconscale" type="range" min="25" max="100" value="${Number(spec.iconScale) || 62}" />
          <span>文字位置</span>
          <select id="i-labelpos">
            ${[['bottom', '底部'], ['center', '居中'], ['top', '顶部']].map(([v, n]) =>
              `<option value="${v}" ${(spec.labelPos || 'bottom') === v ? 'selected' : ''}>${n}</option>`).join('')}
          </select>
        </div>
      </div>
    </details>

    <div class="insp-foot-actions">
      <button class="primary act-main" id="i-test" title="立即测试运行当前按键绑定的动作">
        <span class="btn-icon">▶</span> 测试运行
      </button>
      <button class="ghost act-sub" id="i-push" title="重画这个键到设备物理屏幕">
        <span class="btn-icon">↻</span> 重画
      </button>
      <button class="ghost act-sub" id="i-save" title="存进按键库方便后续复用">
        <span class="btn-icon">⭐</span> 入库
      </button>
      <button class="ghost danger act-del" id="i-del" title="清空/删除这个按键">
        <span class="btn-icon">🗑️</span>
      </button>
    </div>

  `;

  wireSections(box);

  const selPreset = $('i-quickpreset');
  if (selPreset) {
    selPreset.addEventListener('change', async () => {
      const pId = selPreset.value;
      if (!pId) return;
      const tpl = ACTION_TEMPLATES.find(x => x.id === pId);
      if (tpl && tpl.spec) {
        Object.assign(spec, tpl.spec);
        if (tpl.spec.iconName && typeof BUILTIN_ICONS !== 'undefined') {
          const ic = BUILTIN_ICONS.find(i => i.name === tpl.spec.iconName);
          if (ic) spec.icon = svgToDataUrl(ic.svg, '#ffffff');
        }
        await commit(true);
        renderInspector();
      }
    });
  }


  box.querySelectorAll('.page-pill').forEach((btn) => {
    btn.onclick = async () => {
      const mode = btn.dataset.mode;
      spec.mode = mode;
      if (mode === 'goto' && !spec.pageId) {
        spec.pageId = state.config.pages[0]?.id || 'root';
      }
      spec.label = (PAGE_MODE_INFOS.find((m) => m.id === mode) || {}).name || '翻页';
      await commit(true);
      renderInspector();
    };
  });
  const pageTargetSel = $('i-page-target-select');
  if (pageTargetSel) {
    pageTargetSel.onchange = async () => {
      spec.pageId = pageTargetSel.value;
      await commit(true);
    };
  }
  const btnPageOpenModal = $('i-page-open-modal');
  if (btnPageOpenModal) {
    btnPageOpenModal.onclick = async () => {
      const r = await askPageAction({ mode: spec.mode, pageId: spec.pageId });
      if (!r) return;
      spec.mode = r.mode;
      spec.pageId = r.pageId;
      spec.label = pageActionLabel(spec);
      await commit(true);
      renderInspector();
    };
  }

  const btnOpenPicker = $('i-openiconpicker');
  if (btnOpenPicker) btnOpenPicker.onclick = () => openIconPicker();

  const btnCrop = $('i-cropicon');
  if (btnCrop) {
    btnCrop.onclick = () => {
      if (!spec.icon) return;
      openCropper(spec.icon, async (cropped) => {
        spec.icon = cropped;
        await commit(true);
        renderInspector();
      });
    };
  }

  const btnSaveIcon = $('i-saveicon');
  if (btnSaveIcon) {
    btnSaveIcon.onclick = async () => {
      if (!spec.icon) { toast('当前按键没有设置图标'); return; }
      const name = await askText('存入自定义图标库', spec.label || '我的图标', '输入图标名称');
      if (!name) return;
      cfg.customIcons = cfg.customIcons || [];
      cfg.customIcons.push({
        id: 'ci_' + Date.now(),
        name: name.trim(),
        icon: spec.icon,
        badge: spec.badge || '',
        badgeBg: spec.badgeBg || '',
        badgeColor: spec.badgeColor || '',
      });
      await saveConfig();
      toast(`已存入自定义图标库：「${name.trim()}」`);
    };
  }

  const btnPickMacro = $('i-pickmacro');
  if (btnPickMacro) {
    btnPickMacro.onclick = () => {
      spec.type = 'multi';
      if (!Array.isArray(spec.actions)) {
        spec.actions = spec.target ? [{ type: 'app', target: spec.target, args: spec.args || '' }] : [];
      }
      if (!spec.loop) spec.loop = { mode: 'once', interval: 50 };
      if (!spec.color) spec.color = '#1b5e20';
      if (!spec.label) spec.label = '复合宏';
      commit(true);
      renderInspector();
    };
  }

  $('i-pickhotkey').onclick = () => {
    spec.type = 'hotkey';
    spec.hotkey = spec.hotkey || 'Win+D';
    spec.target = spec.hotkey;
    spec.color = '#107c41';
    if (!spec.label) spec.label = '显示桌面';
    commit(true);
    renderInspector();
  };

  const iptHotkey = $('i-hotkey');
  if (iptHotkey) {
    bindHotkeyBuilder(box, 'i-hotkey', async (val) => {
      spec.hotkey = val;
      spec.target = val;
      if (!spec.label || spec.label === '显示桌面' || spec.label === '快捷键') {
        const p = HOTKEY_PRESETS.find(x => x.hk.toLowerCase() === val.toLowerCase());
        spec.label = p ? p.lbl : val;
      }
      await commit(true);
      const iptLabel = $('i-label');
      if (iptLabel && spec.label) iptLabel.value = spec.label;
    });
  }

  // 静态角标控制
  box.querySelectorAll('#i-badgepresets .badge-pill').forEach((btn) => {
    btn.onclick = async () => {
      spec.badge = btn.dataset.val;
      await commit(true);
      renderInspector();
    };
  });
  const txtBadge = $('i-badgetext');
  if (txtBadge) {
    txtBadge.addEventListener('change', async () => {
      spec.badge = txtBadge.value.trim();
      await commit(true);
      renderInspector();
    });
  }
  const bgBadge = $('i-badgebg');
  if (bgBadge) {
    bgBadge.addEventListener('change', async () => {
      spec.badgeBg = bgBadge.value;
      await commit(true);
    });
  }

  // 动态双态角标模式切换
  const btnBadgeModeStatic = $('i-badgemode-static');
  const btnBadgeModeToggle = $('i-badgemode-toggle');
  if (btnBadgeModeStatic && btnBadgeModeToggle) {
    btnBadgeModeStatic.onclick = async () => {
      spec.badgeToggle = false;
      await commit(true);
      renderInspector();
    };
    btnBadgeModeToggle.onclick = async () => {
      spec.badgeToggle = true;
      if (!spec.badgeState1) spec.badgeState1 = { text: 'ON', bg: '#107c41', color: '#ffffff' };
      if (!spec.badgeState2) spec.badgeState2 = { text: 'OFF', bg: '#e53935', color: '#ffffff' };
      if (spec._activeState === undefined) spec._activeState = 0;
      await commit(true);
      renderInspector();
    };
  }

  // 双态角标快捷预设
  box.querySelectorAll('#i-toggle-presets .badge-toggle-preset-pill').forEach((btn) => {
    btn.onclick = async () => {
      const idx = Number(btn.dataset.idx);
      const p = BADGE_TOGGLE_PRESETS[idx];
      if (p) {
        spec.badgeState1 = Object.assign({}, p.s1);
        spec.badgeState2 = Object.assign({}, p.s2);
        await commit(true);
        renderInspector();
      }
    };
  });

  // 状态 1 / 状态 2 文字与色彩输入
  const s1Text = $('i-toggle-s1-text');
  if (s1Text) {
    s1Text.addEventListener('input', () => {
      if (!spec.badgeState1) spec.badgeState1 = {};
      spec.badgeState1.text = s1Text.value.trim();
      commit(true);
    });
  }
  const s1Bg = $('i-toggle-s1-bg');
  if (s1Bg) {
    s1Bg.addEventListener('input', () => {
      if (!spec.badgeState1) spec.badgeState1 = {};
      spec.badgeState1.bg = s1Bg.value;
      commit(true);
    });
  }

  const s2Text = $('i-toggle-s2-text');
  if (s2Text) {
    s2Text.addEventListener('input', () => {
      if (!spec.badgeState2) spec.badgeState2 = {};
      spec.badgeState2.text = s2Text.value.trim();
      commit(true);
    });
  }
  const s2Bg = $('i-toggle-s2-bg');
  if (s2Bg) {
    s2Bg.addEventListener('input', () => {
      if (!spec.badgeState2) spec.badgeState2 = {};
      spec.badgeState2.bg = s2Bg.value;
      commit(true);
    });
  }

  // 动态角标试切按钮
  const tryBtn = $('i-toggle-try-btn');
  if (tryBtn) {
    tryBtn.onclick = async () => {
      const cur = spec._activeState !== undefined ? spec._activeState : (spec.badgeInitialState || 0);
      spec._activeState = (cur === 1 ? 0 : 1);
      refreshGrid();
      await pushKey(selected.row, selected.col);
      renderInspector();
    };
  }

  // 动作模式胶囊切换
  const btnActSingle = $('i-toggle-act-single');
  const btnActDual = $('i-toggle-act-dual');
  if (btnActSingle && btnActDual) {
    btnActSingle.onclick = async () => {
      spec.toggleAction = false;
      await commit(false);
      renderInspector();
    };
    btnActDual.onclick = async () => {
      spec.toggleAction = true;
      if (!spec.action2) {
        let targetKill = '';
        if (spec.target) {
          const proc = spec.target.replace(/\\/g, '/').split('/').pop().replace(/\.[^.]+$/, '');
          if (proc) targetKill = `taskkill /F /IM ${proc}.exe`;
        }
        spec.action2 = { type: targetKill ? 'command' : 'hotkey', target: targetKill || 'Alt+F4', hotkey: targetKill ? '' : 'Alt+F4', args: '' };
      }
      if (!spec.badgeToggle) {
        spec.badgeToggle = true;
        spec.badgeState1 = spec.badgeState1 || { text: 'ON', bg: '#107c41' };
        spec.badgeState2 = spec.badgeState2 || { text: 'OFF', bg: '#e53935' };
      }
      await commit(false);
      renderInspector();
    };
  }

  // 一键互换形态 1 与形态 2 动作
  const btnSwap = $('i-swap-actions');
  if (btnSwap) {
    btnSwap.onclick = async () => {
      const s1 = {
        type: spec.type || 'app',
        target: spec.target || '',
        args: spec.args || '',
        hotkey: spec.hotkey || ''
      };
      const s2 = spec.action2 ? {
        type: spec.action2.type || 'command',
        target: spec.action2.target || '',
        args: spec.action2.args || '',
        hotkey: spec.action2.hotkey || ''
      } : {
        type: 'command',
        target: '',
        args: '',
        hotkey: ''
      };
      spec.type = s2.type;
      spec.target = s2.target;
      spec.args = s2.args;
      spec.hotkey = s2.hotkey;
      spec.action2 = {
        type: s1.type,
        target: s1.target,
        args: s1.args,
        hotkey: s1.hotkey
      };
      await commit(true);
      renderInspector();
      toast('已互换形态 1 与形态 2 的执行动作');
    };
  }

  // 状态 2 快捷辅助按钮
  const btnAct2Kill = $('i-act2-pickkill');
  if (btnAct2Kill) {
    btnAct2Kill.onclick = async () => {
      if (!spec.action2) spec.action2 = {};
      let proc = '';
      if (spec.target) {
        proc = spec.target.replace(/\\/g, '/').split('/').pop().replace(/\.[^.]+$/, '');
      }
      spec.action2.type = 'command';
      spec.action2.target = proc ? `taskkill /F /IM ${proc}.exe` : 'taskkill /F /IM app.exe';
      spec.action2.args = '';
      await commit(false);
      renderInspector();
      toast('已设为退出命令：' + spec.action2.target);
    };
  }
  const btnAct2App = $('i-act2-pickapp');
  if (btnAct2App) {
    btnAct2App.onclick = async () => {
      const p = await api.dialogPick({ properties: ['openFile'] });
      if (!p) return;
      const cls = await api.actionClassify(p);
      if (!spec.action2) spec.action2 = {};
      spec.action2.type = 'app';
      spec.action2.target = cls.abs || p;
      spec.action2.args = '';
      await commit(false);
      renderInspector();
    };
  }
  const btnAct2Hk = $('i-act2-pickhk');
  if (btnAct2Hk) {
    btnAct2Hk.onclick = async () => {
      if (!spec.action2) spec.action2 = {};
      spec.action2.type = 'hotkey';
      spec.action2.hotkey = 'Alt+F4';
      spec.action2.target = 'Alt+F4';
      await commit(false);
      renderInspector();
    };
  }
  const btnAct2Cmd = $('i-act2-pickcmd');
  if (btnAct2Cmd) {
    btnAct2Cmd.onclick = async () => {
      if (!spec.action2) spec.action2 = {};
      spec.action2.type = 'command';
      await commit(false);
      renderInspector();
    };
  }

  const selAct2Type = $('i-toggle-action2-type');
  if (selAct2Type) {
    selAct2Type.onchange = async () => {
      if (!spec.action2) spec.action2 = {};
      spec.action2.type = selAct2Type.value;
      await commit(false);
      renderInspector();
    };
  }
  const iptAct2Target = $('i-toggle-action2-target');
  if (iptAct2Target) {
    iptAct2Target.addEventListener('input', async () => {
      if (!spec.action2) spec.action2 = {};
      spec.action2.target = iptAct2Target.value;
      await commit(false);
    });
  }
  const iptAct2Args = $('i-toggle-action2-args');
  if (iptAct2Args) {
    iptAct2Args.addEventListener('input', async () => {
      if (!spec.action2) spec.action2 = {};
      spec.action2.args = iptAct2Args.value;
      await commit(false);
    });
  }
  const iptAct2Hk = $('i-toggle-action2-hk');
  if (iptAct2Hk) {
    bindHotkeyBuilder(box, 'i-toggle-action2-hk', async (val) => {
      if (!spec.action2) spec.action2 = {};
      spec.action2.type = 'hotkey';
      spec.action2.hotkey = val;
      spec.action2.target = val;
      await commit(false);
    });
  }

  const chkCustom = $('i-customcolor');
  const btnModeGrad = $('i-colormode-grad');
  const btnModeCustom = $('i-colormode-custom');

  const updateCapsules = (isCustom) => {
    if (btnModeGrad) btnModeGrad.classList.toggle('active', !isCustom);
    if (btnModeCustom) btnModeCustom.classList.toggle('active', !!isCustom);
  };

  if (chkCustom) {
    chkCustom.addEventListener('change', async () => {
      if (chkCustom.checked) {
        spec.customColor = true;
      } else {
        delete spec.customColor;
      }
      updateCapsules(spec.customColor);
      const cg = $('i-colorgroup');
      if (cg) cg.style.display = spec.customColor ? '' : 'none';
      await commit(true);
    });
  }

  if (btnModeGrad && btnModeCustom && chkCustom) {
    btnModeGrad.onclick = () => {
      if (!chkCustom.checked) return;
      chkCustom.checked = false;
      chkCustom.dispatchEvent(new Event('change'));
    };
    btnModeCustom.onclick = () => {
      if (chkCustom.checked) return;
      chkCustom.checked = true;
      chkCustom.dispatchEvent(new Event('change'));
    };
  }

  const bind = (id, field, ev, transform) => {
    const elm = $(id);
    if (!elm) return;
    elm.addEventListener(ev, async () => {
      spec[field] = transform ? transform(elm) : elm.value;
      await commit(ev === 'change');
    });
  };
  bind('i-label', 'label', 'change');
  bind('i-target', 'target', 'change');
  bind('i-args', 'args', 'change');
  bind('i-color', 'color', 'change');
  bind('i-color2', 'color2', 'change');
  bind('i-labelpos', 'labelPos', 'change');

  $('i-type').addEventListener('change', async () => {
    const v = $('i-type').value;
    if (v === 'page') {
      const r = await askPageAction(spec.type === 'page' ? spec : null);
      if (!r) { renderInspector(); return; }
      const fresh = pageButtons()[key];
      Object.keys(fresh).forEach((k) => delete fresh[k]);
      Object.assign(fresh, makePageSpec(r.mode, r.pageId));
    } else {
      spec.type = v;
      delete spec.mode;
      delete spec.pageId;
      if (v === 'hotkey') {
        spec.hotkey = spec.hotkey || 'Win+D';
        spec.target = spec.hotkey;
        spec.color = '#107c41';
        if (!spec.label) spec.label = '显示桌面';
      } else if (v === 'multi' || v === 'macro') {
        if (!Array.isArray(spec.actions)) {
          spec.actions = spec.target ? [{ type: 'app', target: spec.target, args: spec.args || '' }] : [];
        }
        if (!spec.loop) spec.loop = { mode: 'once', interval: 50 };
        if (!spec.color) spec.color = '#1b5e20';
        if (!spec.label) spec.label = '复合宏';
      }
    }
    await commit(true);
    renderInspector();
  });

  const slider = (id, field, out) => {
    const elm = $(id);
    elm.addEventListener('input', () => { spec[field] = Number(elm.value); $(out).textContent = elm.value; });
    elm.addEventListener('change', () => commit(true));
  };
  slider('i-fontsize', 'fontSize', 'v-font');
  slider('i-iconscale', 'iconScale', 'v-icon');

  const auto = $('i-autofg');
  const tc = $('i-textcolor');
  const tcHex = $('i-textcolor-hex');
  const tcRow = $('i-tc-color-row');
  const btnTcAuto = $('i-tc-auto');
  const btnTcCustom = $('i-tc-custom');

  const updateTcUI = (isAuto) => {
    auto.checked = isAuto;
    tc.disabled = isAuto;
    if (btnTcAuto) btnTcAuto.classList.toggle('active', isAuto);
    if (btnTcCustom) btnTcCustom.classList.toggle('active', !isAuto);
    if (tcRow) tcRow.style.display = isAuto ? 'none' : 'flex';
  };

  if (btnTcAuto) {
    btnTcAuto.onclick = async () => {
      updateTcUI(true);
      spec.textColor = '';
      await commit(true);
    };
  }
  if (btnTcCustom) {
    btnTcCustom.onclick = async () => {
      updateTcUI(false);
      spec.textColor = tc.value || '#ffffff';
      if (tcHex) tcHex.textContent = spec.textColor;
      await commit(true);
    };
  }
  auto.addEventListener('change', async () => {
    updateTcUI(auto.checked);
    spec.textColor = auto.checked ? '' : tc.value;
    await commit(true);
  });
  tc.addEventListener('input', () => {
    if (tcHex) tcHex.textContent = tc.value;
  });
  tc.addEventListener('change', async () => {
    spec.textColor = tc.value;
    if (tcHex) tcHex.textContent = tc.value;
    await commit(true);
  });
  box.querySelectorAll('.tc-dot').forEach((dot) => {
    dot.onclick = async () => {
      const c = dot.dataset.color;
      if (!c) return;
      tc.value = c;
      if (tcHex) tcHex.textContent = c;
      spec.textColor = c;
      updateTcUI(false);
      await commit(true);
    };
  });


  if ($('i-pickapp')) $('i-pickapp').onclick = () => pickInto({ properties: ['openFile'] });
  if ($('i-pickdir')) $('i-pickdir').onclick = () => pickInto({ properties: ['openDirectory'] });
  if ($('i-pickurl')) $('i-pickurl').onclick = () => quickSet('url');
  if ($('i-pickcmd')) $('i-pickcmd').onclick = () => quickSet('command');
  if ($('i-page')) $('i-page').onclick = async () => {
    const r = await askPageAction(spec.type === 'page' ? spec : null);
    if (!r) return;
    let fresh = pageButtons()[selected.row + ',' + selected.col];
    if (!fresh) { pageButtons()[selected.row + ',' + selected.col] = fresh = {}; }
    Object.keys(fresh).forEach((k) => delete fresh[k]);
    Object.assign(fresh, makePageSpec(r.mode, r.pageId));
    await commit(true);
    renderInspector();
  };
  $('i-test').onclick = async () => {
    let act = spec;
    if (spec.badgeToggle) {
      const cur = spec._activeState !== undefined ? spec._activeState : (spec.badgeInitialState || 0);
      if (spec.toggleAction && spec.action2 && (spec.action2.target || spec.action2.hotkey) && cur === 1) {
        act = spec.action2;
      }
      spec._activeState = (cur === 1 ? 0 : 1);
      refreshGrid();
      await pushKey(selected.row, selected.col);
      renderInspector();
    }
    const r = !DEMO ? await api.actionRun(act) : { ok: true };
    toast(r && r.ok ? '已启动' : '启动失败：' + (r && r.error));
  };
  $('i-push').onclick = () => repaintSelected();
  $('i-iconfile').onclick = async () => {
    const p = await api.dialogPick({ properties: ['openFile'] });
    if (!p) return;
    const ext = p.split('.').pop().toLowerCase();
    const isImg = ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'svg'].includes(ext);
    const icon = await api.iconExtract(p);
    if (!icon) { toast('这个文件取不到图标'); return; }
    if (isImg) {
      openCropper(icon, async (cropped) => {
        spec.icon = cropped;
        await commit(true);
        renderInspector();
      });
    } else {
      spec.icon = icon;
      await commit(true);
      renderInspector();
    }
  };
  const btnClr = $('i-clr');
  if (btnClr) btnClr.onclick = async () => { spec.icon = ''; await commit(true); renderInspector(); };
  $('i-save').onclick = () => libraryAdd(spec);
  $('i-del').onclick = () => removeKey(selected.row, selected.col);
  if (spec.type === 'multi' || spec.type === 'macro') {
    wireMacroEditor(box, spec);
  }
  updateInspTabs();
}

/** <details> state must survive the innerHTML rebuild on every edit. */
function wireSections(box) {
  box.querySelectorAll('details.sec').forEach((d) => {
    d.addEventListener('toggle', () => { secOpen[d.dataset.sec] = d.open; });
  });
}

const GRADIENT_PRESETS = [
  { name: '暗夜蓝金', from: '#141e30', to: '#243b55', angle: 135 },
  { name: '赛博霓虹', from: '#8a2387', to: '#e94057', angle: 90 },
  { name: '深海极光', from: '#000428', to: '#004e92', angle: 135 },
  { name: '极光翠绿', from: '#0f2027', to: '#203a43', angle: 135 },
  { name: '落日暖橘', from: '#ff4e50', to: '#f9d423', angle: 45 },
];

function renderPageInspector(box) {
  const p = curPage();
  if (!p.gradient) {
    p.gradient = { enabled: false, from: '#1565c0', to: '#6a1b9a', angle: 135 };
  }
  const g = p.gradient;
  box.className = 'inspector';
  box.innerHTML = `
    <details class="sec" data-sec="page-grad" open>
      <summary>页面外观 · 整板无缝渐变</summary>
      <div class="body">
        <div class="switch-card" id="g-enable-card">
          <div class="switch-card-info">
            <span class="switch-card-title">整板无缝渐变流光</span>
            <span class="switch-card-desc">跨越 15 键 + 3 块副屏无缝连贯渲染</span>
          </div>
          <label class="switch" onclick="event.stopPropagation()">
            <input type="checkbox" id="g-enable" ${g.enabled ? 'checked' : ''} />
            <span class="switch-slider"></span>
          </label>
        </div>

        <div id="g-controls" style="${g.enabled ? '' : 'opacity: 0.45; pointer-events: none;'}">
          <div class="stylegrid" style="margin-bottom: 12px;">
            <span>起点色</span>
            <input id="g-from" type="color" value="${g.from || '#1565c0'}" />
            <span>终点色</span>
            <input id="g-to" type="color" value="${g.to || '#6a1b9a'}" />
            <span>角度 <b id="g-angle-val">${Number(g.angle) || 0}</b>°</span>
            <input id="g-angle" type="range" min="0" max="360" step="5" value="${Number(g.angle) || 0}" />
          </div>

          <div class="row">
            <label>常用方向快捷设定</label>
            <div class="btnrow" style="margin-bottom: 10px; flex-wrap: wrap;">
              <button class="ghost tiny g-dir" data-angle="90">水平 90°</button>
              <button class="ghost tiny g-dir" data-angle="180">垂直 180°</button>
              <button class="ghost tiny g-dir" data-angle="135">对角 135°</button>
              <button class="ghost tiny g-dir" data-angle="45">反角 45°</button>
            </div>
          </div>

          <div class="row">
            <label>推荐精选主题色卡</label>
            <div class="preset-grid" id="g-presets"></div>
          </div>
        </div>

        <p class="muted" style="margin-top: 14px; font-size: 11px; line-height: 1.4;">
          💡 开启后，整块 15 键面板将作为一张无缝连贯的大画布绘制渐变。若个别按键需要独立颜色强调，可在该按键外观中勾选「独立自定义底色」。
        </p>
      </div>
    </details>

    <div class="btnrow">
      <button class="ghost" id="g-repaint-all">重画全部 15 键</button>
    </div>
  `;

  wireSections(box);

  const preBox = box.querySelector('#g-presets');
  for (const pre of GRADIENT_PRESETS) {
    const btn = document.createElement('button');
    btn.className = 'preset-pill';
    btn.innerHTML = `
      <span class="preset-swatch" style="background: linear-gradient(${pre.angle}deg, ${pre.from}, ${pre.to});"></span>
      <span class="preset-name">${pre.name}</span>
    `;
    btn.onclick = async () => {
      g.enabled = true;
      g.from = pre.from;
      g.to = pre.to;
      g.angle = pre.angle;
      cachedGradientKey = '';
      await commit(false);
      renderPageInspector(box);
      if (!DEMO) await repaintAllKeys();
    };
    preBox.appendChild(btn);
  }

  const syncControls = () => {
    box.querySelector('#g-controls').style.opacity = g.enabled ? '' : '0.45';
    box.querySelector('#g-controls').style.pointerEvents = g.enabled ? '' : 'none';
  };

  const cardEnable = box.querySelector('#g-enable-card');
  const chkEnable = box.querySelector('#g-enable');
  if (cardEnable && chkEnable) {
    cardEnable.onclick = (e) => {
      if (e.target === chkEnable || e.target.closest('.switch')) return;
      chkEnable.checked = !chkEnable.checked;
      chkEnable.dispatchEvent(new Event('change'));
    };
  }

  box.querySelector('#g-enable').onchange = async (e) => {
    g.enabled = e.target.checked;
    cachedGradientKey = '';
    syncControls();
    await commit(false);
    if (!DEMO) await repaintAllKeys();
  };

  const angleInput = box.querySelector('#g-angle');
  const angleVal = box.querySelector('#g-angle-val');
  angleInput.oninput = () => { angleVal.textContent = angleInput.value; };
  angleInput.onchange = async () => {
    g.angle = Number(angleInput.value);
    cachedGradientKey = '';
    await commit(false);
    if (!DEMO) await repaintAllKeys();
  };

  box.querySelectorAll('.g-dir').forEach((btn) => {
    btn.onclick = async () => {
      const a = Number(btn.dataset.angle);
      g.angle = a;
      angleInput.value = a;
      angleVal.textContent = a;
      cachedGradientKey = '';
      await commit(false);
      if (!DEMO) await repaintAllKeys();
    };
  });

  box.querySelector('#g-from').onchange = async (e) => {
    g.from = e.target.value;
    cachedGradientKey = '';
    await commit(false);
    if (!DEMO) await repaintAllKeys();
  };

  box.querySelector('#g-to').onchange = async (e) => {
    g.to = e.target.value;
    cachedGradientKey = '';
    await commit(false);
    if (!DEMO) await repaintAllKeys();
  };

  box.querySelector('#g-repaint-all').onclick = () => repaintAllKeys();
}

function renderStripInspector(box) {
  const row = selected.row;
  const s = pageStrips()[String(row)] || { type: 'text', label: '', color: '#263238' };
  const page = curPage();
  const grad = page && page.gradient;
  box.className = 'inspector';
  box.innerHTML = `
    <details class="sec" data-sec="action" ${secOpen.action ? 'open' : ''}>
      <summary>显示内容</summary>
      <div class="body">
        <div class="row">
          <select id="s-type">
            <option value="clock" ${s.type === 'clock' ? 'selected' : ''}>时钟（自动刷新）</option>
            <option value="text" ${s.type === 'text' ? 'selected' : ''}>自定义文字</option>
            <option value="page" ${s.type === 'page' ? 'selected' : ''}>页码 + 页名（随翻页自动更新）</option>
            <option value="cpu" ${s.type === 'cpu' ? 'selected' : ''}>💻 CPU 占用率（实时动态监控）</option>
            <option value="mem" ${s.type === 'mem' ? 'selected' : ''}>📊 内存占用率（实时动态监控）</option>
            <option value="sys" ${s.type === 'sys' ? 'selected' : ''}>📈 系统态势仪表（CPU + 内存组合）</option>
          </select>
        </div>
        <div class="row"><label>文字（回车换行，时钟模式下忽略）</label>
          <textarea id="s-label">${escapeHtml(s.label || '')}</textarea></div>
      </div>
    </details>
    <details class="sec" data-sec="look" ${secOpen.look ? 'open' : ''}>
      <summary>外观与底色</summary>
      <div class="body">
        ${grad && grad.enabled ? `
          <div class="row" style="margin-bottom: 8px;">
            <label style="display:block; font-size:12px; color:var(--muted); margin-bottom:4px;">底色模式</label>
            <div class="color-capsule-group">
              <button type="button" id="s-colormode-grad" class="color-capsule-pill ${!s.customColor ? 'active' : ''}">🌈 跟随整板流光</button>
              <button type="button" id="s-colormode-custom" class="color-capsule-pill ${s.customColor ? 'active' : ''}">🎨 独立底色</button>
            </div>
            <input type="checkbox" id="s-customcolor" style="display:none;" ${s.customColor ? 'checked' : ''} />
          </div>
        ` : ''}
        <div class="stylegrid" id="s-colorgroup" style="${grad && grad.enabled && !s.customColor ? 'display: none;' : ''}">
          <span>底色</span><input id="s-color" type="color" value="${s.color || '#263238'}" />
        </div>
        <div class="stylegrid">
          <span>字号 <b id="v-sfont">${Number(s.fontSize) || 20}</b>%</span>
          <input id="s-fontsize" type="range" min="10" max="45" value="${Number(s.fontSize) || 20}" />
        </div>
      </div>
    </details>
    <div class="btnrow" style="margin-top: 14px;">
      <button class="ghost" id="s-push">重画这块屏</button>
      <button class="ghost" id="s-save">存进按键库</button>
    </div>
  `;
  wireSections(box);
  const el = (id) => $(id);
  el('s-type').addEventListener('change', async () => {
    pageStrips()[String(row)] = Object.assign({}, s, { type: el('s-type').value });
    await commit(true);
    renderInspector();
  });
  el('s-label').addEventListener('change', async () => {
    pageStrips()[String(row)] = Object.assign({}, s, { label: el('s-label').value });
    await commit(true);
  });
  const chkCustom = el('s-customcolor');
  const btnModeGrad = el('s-colormode-grad');
  const btnModeCustom = el('s-colormode-custom');

  const updateCapsules = (isCustom) => {
    if (btnModeGrad) btnModeGrad.classList.toggle('active', !isCustom);
    if (btnModeCustom) btnModeCustom.classList.toggle('active', !!isCustom);
  };

  if (chkCustom) {
    chkCustom.addEventListener('change', async () => {
      if (chkCustom.checked) {
        s.customColor = true;
      } else {
        delete s.customColor;
      }
      updateCapsules(s.customColor);
      const cg = el('s-colorgroup');
      if (cg) cg.style.display = s.customColor ? '' : 'none';
      pageStrips()[String(row)] = s;
      await commit(true);
    });
  }

  if (btnModeGrad && btnModeCustom && chkCustom) {
    btnModeGrad.onclick = () => {
      if (!chkCustom.checked) return;
      chkCustom.checked = false;
      chkCustom.dispatchEvent(new Event('change'));
    };
    btnModeCustom.onclick = () => {
      if (chkCustom.checked) return;
      chkCustom.checked = true;
      chkCustom.dispatchEvent(new Event('change'));
    };
  }
  el('s-color').addEventListener('change', async () => {
    pageStrips()[String(row)] = Object.assign({}, s, { color: el('s-color').value });
    await commit(true);
  });
  el('s-fontsize').addEventListener('input', () => { el('v-sfont').textContent = el('s-fontsize').value; });
  el('s-fontsize').addEventListener('change', async () => {
    pageStrips()[String(row)] = Object.assign({}, s, { fontSize: Number(el('s-fontsize').value) });
    await commit(true);
  });
  el('s-push').onclick = () => pushStrip(row);
  el('s-save').onclick = () => libraryAdd(s);
}

/** Pick a file/folder into the currently selected cell (creating the spec). */
async function pickInto(opts) {
  if (!selected || selected.col === 5) return;
  const p = await api.dialogPick(opts);
  if (!p) return;
  const cls = await api.actionClassify(p);
  const icon = await api.iconExtract(p);
  const spec = {
    type: cls.type, label: cls.label, target: cls.abs || p,
    args: '', icon: icon || '', color: colorFor(cls.type),
  };
  applyAppDualStateDefaults(spec, cls, p);
  pageButtons()[selected.row + ',' + selected.col] = spec;
  await commit(true);
  renderInspector();
}

/** Modal text prompt (window.prompt is disabled in Electron renderers). */
function askText(title, value, placeholder) {
  return new Promise((resolve) => {
    const wrap = document.createElement('div');
    wrap.className = 'modal';
    wrap.innerHTML = `<div class="modalbox">
      <h3>${escapeHtml(title)}</h3>
      <input id="_askInput" value="${escapeAttr(value || '')}" placeholder="${escapeAttr(placeholder || '')}" />
      <div class="btnrow">
        <button class="primary" id="_askOk">确定</button>
        <button class="ghost" id="_askCancel">取消</button>
      </div>
    </div>`;
    document.body.appendChild(wrap);
    const input = wrap.querySelector('#_askInput');
    input.focus();
    input.select();
    const done = (v) => { wrap.remove(); resolve(v); };
    wrap.querySelector('#_askOk').onclick = () => done(input.value);
    wrap.querySelector('#_askCancel').onclick = () => done(null);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') done(input.value);
      if (e.key === 'Escape') done(null);
    });
  });
}

async function quickSet(kind) {
  if (!selected || selected.col === 5) return;
  const key = selected.row + ',' + selected.col;
  const existing = pageButtons()[key];
  const seed = existing && existing.type === kind ? existing.target : '';
  const value = await askText(
    kind === 'url' ? '输入网址' : '输入命令行',
    seed,
    kind === 'url' ? 'https://example.com' : 'notepad 或 cmd /c echo hi'
  );
  if (value == null) return;
  const v = String(value).trim();
  if (!v) return;
  pageButtons()[key] = {
    type: kind,
    label: kind === 'url' ? v.replace(/^https?:\/\//, '').replace(/\/.*$/, '').slice(0, 20) : v.slice(0, 12),
    target: v,
    args: '', icon: '', color: colorFor(kind),
  };
  await commit(true);
  renderInspector();
}

function escapeHtml(s) { return String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }
function escapeAttr(s) { return escapeHtml(s).replace(/"/g, '&quot;'); }

// ------------------------------------------------------------------- library

/* 「按键库」= 把调好的一个键存起来，随时取回任意格子 / 任意页。
 * 数据：config.library = [{id, name, tags:[], savedAt, spec}]
 *   - 分类用**标签**而不是文件夹：一个键可以同时属于「开发」和「常用」，
 *     不用为了两处可见而存两份，切分类也不用进进出出。
 *   - 抽屉是"小态"（随手取一个），「展开」是大面板（搜索 + 标签 + 批量操作）。
 *   - 可以单独导出成 library.json，按标签导出。 */

let dragLib = null;      // id of a library entry being dragged onto a cell
let libQuery = '';
let libTag = '';

const libEntries = () => (cfg && cfg.library) || [];

function normTags(v) {
  if (Array.isArray(v)) return v.map((t) => String(t).trim()).filter(Boolean);
  if (typeof v === 'string') return v.split(/[,，\s]+/).map((t) => t.trim()).filter(Boolean);
  return [];
}

/** 整页快照：存的是一整页（15 个键 + 3 块屏），而不是单个键。 */
const isPageEntry = (e) => !!e && (e.kind === 'page' || (!e.spec && !!e.page));

function libMatches(e) {
  if (libTag && !(e.tags || []).includes(libTag)) return false;
  const q = libQuery.trim().toLowerCase();
  if (!q) return true;
  return [e.name, e.spec && e.spec.target, e.spec && e.spec.type,
    isPageEntry(e) ? '整页 页面' : '', (e.tags || []).join(' ')]
    .filter(Boolean).join(' ').toLowerCase().includes(q);
}

/** 6×3 迷你预览，让整页快照在库里一眼能认出来。 */
function libMiniGrid(page) {
  const g = document.createElement('div');
  g.className = 'minigrid';
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 6; col++) {
      const c = document.createElement('i');
      if (col === 5) {
        const s = (page.strips || {})[String(row)];
        c.style.background = (s && s.color) || '#263238';
      } else {
        const b = (page.buttons || {})[row + ',' + col];
        if (b) c.style.background = b.color || '#37474f';
        else c.classList.add('empty');
      }
      g.appendChild(c);
    }
  }
  return g;
}

function libAllTags() {
  const m = new Map();
  for (const e of libEntries()) for (const t of (e.tags || [])) m.set(t, (m.get(t) || 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

function libSwatch(entry, cls) {
  if (isPageEntry(entry)) return libMiniGrid(entry.page || {});
  const sw = document.createElement('div');
  sw.className = cls;
  sw.style.background = entry.spec.color || '#37474f';
  sw.style.color = contrast(entry.spec.color);
  if (entry.spec.icon) {
    const im = document.createElement('img');
    im.src = entry.spec.icon;
    sw.appendChild(im);
  } else {
    sw.textContent = glyphFor(entry.spec.type);
  }
  return sw;
}

/** 库条目拖到格子上时用（库 -> 面板）。 */
function libDropSpec(entry) {
  return clone(entry.spec);
}

function libSave() {
  if (DEMO) { renderLibrary(); renderLibPanel(); return Promise.resolve(); }
  return api.configSave(cfg).then(() => { renderLibrary(); renderLibPanel(); });
}

/** Small tile used in the drawer. */
function libItemEl(entry) {
  const it = document.createElement('div');
  it.className = 'libitem' + (isPageEntry(entry) ? ' ispage' : '');
  // 整页快照拖不上单个格子 —— 它是整页，只能建成新页或覆盖当前页
  it.draggable = !isPageEntry(entry);
  const what = isPageEntry(entry)
    ? `整页快照 · ${Object.keys((entry.page || {}).buttons || {}).length} 个按键`
    : entry.spec.target || '';
  it.title = `${entry.name}\n${what}\n标签：${(entry.tags || []).join(' / ') || '无'}`;
  it.appendChild(libSwatch(entry, 'sw'));
  it.appendChild(el('span', 'nm', entry.name));

  const del = document.createElement('button');
  del.className = 'del';
  del.textContent = '×';
  del.title = '从库里删掉';
  del.onclick = (e) => { e.stopPropagation(); libraryRemove(entry.id); };
  it.appendChild(del);

  it.onclick = () => (isPageEntry(entry) ? libraryApplyPage(entry) : libraryApply(entry));
  it.addEventListener('dragstart', (e) => {
    dragLib = entry.id;
    e.dataTransfer.effectAllowed = 'copy';
    e.dataTransfer.setData('text/plain', 'lib:' + entry.id);
  });
  it.addEventListener('dragend', () => { dragLib = null; });
  return it;
}

/** Big card used in the expanded panel. */
function libCardEl(entry) {
  const page = isPageEntry(entry);
  const c = document.createElement('div');
  c.className = 'libcard' + (page ? ' ispage' : '');
  c.draggable = !page;
  c.appendChild(libSwatch(entry, 'sw'));
  c.appendChild(el('div', 'nm', entry.name));
  const tg = (entry.tags || []).join(' · ');
  c.appendChild(el('div', 'tg', tg || '未分类'));
  const sub = el('div', 'tg', page
    ? `整页 · ${Object.keys((entry.page || {}).buttons || {}).length} 键`
    : (entry.spec.type === 'multi' || entry.spec.type === 'macro'
      ? `复合宏 · ${(entry.spec.actions || []).length} 个步骤`
      : (entry.spec.target || (entry.spec.type === 'page' ? pageActionLabel(entry.spec) : ''))));
  sub.title = page ? '整页快照' : (entry.spec.type === 'multi' ? `复合宏 (${(entry.spec.actions || []).length} 动作)` : (entry.spec.target || ''));
  c.appendChild(sub);

  const ops = document.createElement('div');
  ops.className = 'ops';
  const mk = (text, cls, fn) => {
    const b = document.createElement('button');
    b.textContent = text;
    if (cls) b.className = cls;
    b.onclick = (e) => { e.stopPropagation(); fn(); };
    return b;
  };
  if (page) {
    ops.appendChild(mk('建成新页', 'wide', () => libraryApplyPage(entry, 'new')));
    ops.appendChild(mk('覆盖当前页', 'wide', () => libraryApplyPage(entry, 'overwrite')));
  } else {
    ops.appendChild(mk('放到格子', null, () => libraryApply(entry)));
    ops.appendChild(mk('用当前格覆盖', null, () => libraryUpdate(entry)));
  }
  ops.appendChild(mk('改名', null, () => libraryRename(entry)));
  ops.appendChild(mk('标签', null, () => libraryEditTags(entry)));
  ops.appendChild(mk('删除', 'dz wide', () => libraryRemove(entry.id)));
  c.appendChild(ops);

  c.onclick = () => (page ? libraryApplyPage(entry) : libraryApply(entry));
  c.addEventListener('dragstart', (e) => {
    dragLib = entry.id;
    e.dataTransfer.effectAllowed = 'copy';
    e.dataTransfer.setData('text/plain', 'lib:' + entry.id);
  });
  c.addEventListener('dragend', () => { dragLib = null; });
  return c;
}

function renderLibrary() {
  const box = $('library');
  if (!box) return;
  $('libraryCount').textContent = String(libEntries().length);
  box.innerHTML = '';
  const list = libEntries().filter(libMatches);
  if (!libEntries().length) {
    box.appendChild(el('p', 'lib-empty',
      '库是空的。在右边把某个键调好之后点「存进按键库」，以后就能拖回任意格子 —— 换页、重装、换机器都不会丢。'));
    return;
  }
  if (!list.length) {
    box.appendChild(el('p', 'lib-empty', '没有匹配的条目。'));
    return;
  }
  for (const e of list) box.appendChild(libItemEl(e));
}

function renderLibPanel() {
  const panel = $('libPanel');
  if (!panel || panel.hidden) return;

  const tags = libAllTags();
  const bar = $('libTags');
  bar.innerHTML = '';
  const mkTag = (label, value, count) => {
    const b = document.createElement('button');
    b.className = 'libtag' + (libTag === value ? ' on' : '');
    b.textContent = label;
    if (count != null) b.appendChild(el('i', '', String(count)));
    b.onclick = () => { libTag = libTag === value ? '' : value; renderLibPanel(); renderLibrary(); };
    return b;
  };
  bar.appendChild(mkTag('全部', '', libEntries().length));
  for (const [t, n] of tags) bar.appendChild(mkTag(t, t, n));

  const grid = $('libGrid');
  grid.innerHTML = '';
  const list = libEntries().filter(libMatches);
  if (!list.length) {
    grid.appendChild(el('p', 'lib-empty', libEntries().length ? '没有匹配的条目。' : '库还是空的 —— 先在右边把某个键配好，再点「存进按键库」。'));
  }
  for (const e of list) grid.appendChild(libCardEl(e));
  $('libHint').textContent = `共 ${libEntries().length} 条，显示 ${list.length} 条`
    + (libTag ? ` · 标签「${libTag}」` : '');
}

function setDrawer(open) {
  const d = $('drawer');
  if (d) d.classList.toggle('open', !!open);
}

function openLibPanel(open) {
  const p = $('libPanel');
  if (!p) return;
  p.hidden = !open;
  if (open) { $('libSearch2').value = libQuery; renderLibPanel(); }
}

// ------------------------------------------------------------------ library ops

function libraryAdd(spec) {
  if (!spec || (!spec.target && spec.type !== 'page' && spec.type !== 'multi' && spec.type !== 'macro' && !spec.label && !spec.icon)) {
    toast('这个键还没配任何内容，无法存入库'); return;
  }
  const name = String(spec.label || (spec.type === 'page' ? pageActionLabel(spec) : TYPE_SHORT[spec.type]) || '按键')
    .split('\n')[0].slice(0, 24);
  cfg.library = cfg.library || [];
  cfg.library.unshift({
    id: 'L' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
    name,
    tags: normTags(libTag && libTag !== '' ? libTag : ''),   // 存进正在筛选的标签，省一次编辑
    savedAt: new Date().toISOString(),
    spec: clone(spec),
  });
  libSave().then(() => setDrawer(true));
  toast('已存进按键库：' + name + (libTag ? `（标签 ${libTag}）` : ''));
}

async function libraryApply(entry) {
  if (!selected || selected.col === 5) { toast('先在左边点一个格子，再点库里的条目'); return; }
  pageButtons()[selected.row + ',' + selected.col] = clone(entry.spec);
  await commit(true);
  renderInspector();
  toast(`已把「${entry.name}」放到 r${selected.row}c${selected.col}`);
}

async function libraryRemove(id) {
  const e = libEntries().find((x) => x.id === id);
  if (!e) return;
  if (!(await askConfirm('从库里删除', `「${e.name}」会从按键库移除，已放到格子上的不受影响。`))) return;
  cfg.library = libEntries().filter((x) => x.id !== id);
  await libSave();
}

async function libraryRename(entry) {
  const name = await askText('库条目的名字', entry.name);
  if (name == null || !name.trim()) return;
  entry.name = name.trim().slice(0, 24);
  await libSave();
}

async function libraryEditTags(entry) {
  const v = await askText(
    `标签（空格或逗号分隔）`,
    (entry.tags || []).join(' '),
    '例如：开发 常用 视频'
  );
  if (v == null) return;
  entry.tags = normTags(v);
  await libSave();
}

/** 把当前整页（15 个键 + 3 块屏）存进库 —— 换页/重装都能一键还原。 */
function libraryAddPage() {
  const p = curPage();
  if (!Object.keys(p.buttons).length) { toast('这一页是空的，没什么可存'); return; }
  cfg.library = cfg.library || [];
  cfg.library.unshift({
    id: 'L' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
    name: String(p.name).slice(0, 24),
    kind: 'page',
    tags: normTags(libTag && libTag !== '' ? libTag : ''),
    savedAt: new Date().toISOString(),
    page: { buttons: clone(p.buttons), strips: clone(p.strips) },
  });
  libSave().then(() => setDrawer(true));
  toast(`已把整页「${p.name}」存入按键库（${Object.keys(p.buttons).length} 个键）`);
}

/** 整页快照怎么用：'new' 建成新页 / 'overwrite' 覆盖当前页 / 不传就问一句。 */
async function libraryApplyPage(entry, mode) {
  const snap = entry.page || { buttons: {}, strips: {} };
  let how = mode;
  if (!how) {
    const ok = await askConfirm('整页快照',
      `把「${entry.name}」覆盖到当前页「${curPage().name}」？确定=覆盖，取消=建成一个新页`);
    how = ok ? 'overwrite' : 'new';
  }
  if (how === 'overwrite') {
    const p = curPage();
    p.buttons = clone(snap.buttons || {});
    p.strips = clone(snap.strips || {});
    selected = null;
    await persistAll();
    toast(`已用「${entry.name}」覆盖当前页`);
    return;
  }
  const name = await askText('用这个快照建一个新页', entry.name);
  if (name == null || !name.trim()) return;
  const id = newPageId();
  cfg.pages.push({
    id, name: name.trim(), parent: null,
    buttons: clone(snap.buttons || {}), strips: clone(snap.strips || {}),
  });
  cfg.currentPage = id;
  selected = null;
  await persistAll();
  toast(`已建成新页「${name.trim()}」`);
}

/** 用当前选中的格子覆盖库里这一条 —— 调好了再更新，不用删了重建。 */
async function libraryUpdate(entry) {
  if (!selected || selected.col === 5) { toast('先在左边点一个格子（就是你调好的那个）'); return; }
  const spec = pageButtons()[selected.row + ',' + selected.col];
  if (!spec) { toast('选中的格子是空的，没有可覆盖的内容'); return; }
  if (!(await askConfirm('覆盖库条目', `用 r${selected.row}c${selected.col} 当前的配置覆盖库里的「${entry.name}」？`))) return;
  entry.spec = clone(spec);
  entry.savedAt = new Date().toISOString();
  await libSave();
  toast(`已更新「${entry.name}」`);
}

async function libraryExport(onlyTag) {
  if (DEMO) { toast('预览模式下不能导出'); return; }
  const list = onlyTag ? libEntries().filter((e) => (e.tags || []).includes(onlyTag)) : libEntries();
  if (!list.length) { toast('没有可导出的条目'); return; }
  const name = onlyTag ? `akp153-library-${onlyTag}.json` : 'akp153-library.json';
  const json = JSON.stringify({ type: 'akp153-library', version: 1, exportedAt: new Date().toISOString(), entries: list }, null, 2);
  const r = await api.libraryExport({ json, name });
  if (r && r.ok) toast('已导出到 ' + r.path);
  else if (r && !r.canceled) toast('导出失败：' + (r.error || '未知错误'));
}

async function libraryImport() {
  if (DEMO) { toast('预览模式下不能导入'); return; }
  const r = await api.libraryImport();
  if (!r || r.canceled) return;
  if (!r.ok) { toast(r.error); return; }
  const data = r.data;
  const list = Array.isArray(data) ? data : (data && data.entries);
  if (!Array.isArray(list)) { toast('这个文件里没有 entries 数组'); return; }
  const have = new Set(libEntries().map((e) => e.id));
  let added = 0;
  for (const e of list) {
    if (!e || !e.spec) continue;
    const id = (e.id && !have.has(e.id)) ? e.id : 'L' + Math.random().toString(36).slice(2, 10);
    have.add(id);
    cfg.library.push({
      id,
      name: String(e.name || e.spec.label || '导入条目').slice(0, 24),
      tags: normTags(e.tags),
      savedAt: e.savedAt || new Date().toISOString(),
      spec: e.spec,
    });
    added++;
  }
  await libSave();
  toast(`导入了 ${added} 条`);
}

function setDrawer(open) {
  const d = $('drawer');
  if (d) d.classList.toggle('open', !!open);
}

// ---------------------------------------------------------------- page bar

function newPageId() {
  return 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
}

/** Save + redraw tabs / grid / inspector / device in one go. */
async function persistAll() {
  if (!DEMO) await saveConfig();
  renderPageTabs();
  buildGrid();
  renderInspector();
  if (!DEMO) await repaintAll();
}

async function goToPage(id) {
  if (!id || id === cfg.currentPage || !pageById(id)) return;
  cfg.currentPage = id;
  selected = null;
  await persistAll();
}

function renderPageTabs() {
  const box = $('pageTabs');
  if (!box) return;
  box.innerHTML = '';
  for (const { page, depth } of pageTree()) {
    const t = document.createElement('button');
    t.className = 'ptab' + (page.id === cfg.currentPage ? ' on' : '');
    if (depth) t.style.marginLeft = (depth * 10) + 'px';
    t.textContent = (depth ? '↳ ' : '') + page.name;
    t.title = depth ? '子页（进它时右下角会自动出现返回键）' : '顶层页';
    t.onclick = () => goToPage(page.id);
    box.appendChild(t);
  }
  $('pageDel').disabled = pageTree().length <= 1;
}

async function pageAddTop() {
  const n = pageTree().filter((t) => !t.page.parent).length + 1;
  const name = await askText('新建顶层页', `第 ${n} 页`, '例如：娱乐、开发、素材');
  if (name == null || !name.trim()) return;
  const id = newPageId();
  cfg.pages.push({ id, name: name.trim(), parent: null, buttons: {}, strips: {} });
  cfg.currentPage = id;
  selected = null;
  await persistAll();
}

async function pageAddChild() {
  const parent = curPage();
  const name = await askText('新建子页', '新子页', '例如：娱乐、开发、素材');
  if (name == null || !name.trim()) return;
  const id = newPageId();
  cfg.pages.push({ id, name: name.trim(), parent: parent.id, buttons: {}, strips: {} });
  cfg.currentPage = id;
  selected = null;
  await persistAll();
  toast(`子页「${name.trim()}」已建好 —— 右下角会自动出现返回键`);
}

async function pageRename() {
  const p = curPage();
  const name = await askText('页面改名', p.name);
  if (name == null || !name.trim()) return;
  p.name = name.trim();
  await persistAll();
}

async function pageDuplicate() {
  const p = curPage();
  const name = await askText('复制本页', p.name + ' 副本');
  if (name == null || !name.trim()) return;
  const id = newPageId();
  cfg.pages.push({
    id, name: name.trim(), parent: p.parent,
    buttons: clone(p.buttons), strips: clone(p.strips),
  });
  cfg.currentPage = id;
  selected = null;
  await persistAll();
}

async function pageDelete() {
  const p = curPage();
  if (cfg.pages.length <= 1) { toast('至少要留一页'); return; }
  const kids = [];
  const collect = (id) => { for (const c of childPages(id)) { kids.push(c); collect(c.id); } };
  collect(p.id);
  const msg = kids.length
    ? `「${p.name}」下面还有 ${kids.length} 个子页，会一起删掉，且不能撤销。`
    : `会删掉「${p.name}」以及里面的所有按键，不能撤销。`;
  if (!(await askConfirm('删除页面', msg))) return;
  const doomed = new Set([p.id, ...kids.map((k) => k.id)]);
  cfg.pages = cfg.pages.filter((x) => !doomed.has(x.id));
  cfg.currentPage = (p.parent && pageById(p.parent)) ? p.parent : cfg.pages[0].id;
  selected = null;
  await persistAll();
  toast('页面已删除');
}

// ------------------------------------------------------------ context menu

let cmTarget = null; // { row, col }

function showContextMenu(x, y, row, col) {
  const cm = $('contextMenu');
  if (!cm) return;
  cmTarget = { row, col };
  const isBack = isBackCell(row, col);
  const spec = (col === 5) ? pageStrips()[String(row)] : pageButtons()[row + ',' + col];

  $('cmCopy').disabled = !spec || isBack;
  $('cmCut').disabled = !spec || isBack || col === 5;
  $('cmPaste').disabled = !clipboardKey || isBack || col === 5;
  $('cmSaveLib').disabled = !spec || isBack;
  $('cmClear').disabled = !spec || isBack || col === 5;

  const w = 180, h = 180;
  const px = Math.min(x, window.innerWidth - w - 10);
  const py = Math.min(y, window.innerHeight - h - 10);
  cm.style.left = px + 'px';
  cm.style.top = py + 'px';
  cm.hidden = false;
}

function hideContextMenu() {
  const cm = $('contextMenu');
  if (cm) cm.hidden = true;
  cmTarget = null;
}

function initContextMenu() {
  $('cmCopy').onclick = () => {
    if (!cmTarget) return;
    const { row, col } = cmTarget;
    const spec = (col === 5) ? pageStrips()[String(row)] : pageButtons()[row + ',' + col];
    if (spec) {
      clipboardKey = clone(spec);
      toast(`已复制按键配置（Ctrl+V 粘贴到其他格子）`);
    }
    hideContextMenu();
  };

  $('cmCut').onclick = async () => {
    if (!cmTarget || cmTarget.col === 5) return;
    const { row, col } = cmTarget;
    const spec = pageButtons()[row + ',' + col];
    if (spec) {
      clipboardKey = clone(spec);
      await removeKey(row, col);
      toast(`已剪切按键配置`);
    }
    hideContextMenu();
  };

  $('cmPaste').onclick = async () => {
    if (!cmTarget || cmTarget.col === 5 || !clipboardKey) return;
    const { row, col } = cmTarget;
    if (isBackCell(row, col)) return;
    pageButtons()[row + ',' + col] = clone(clipboardKey);
    await commit(true);
    select(row, col);
    toast(`已粘贴到 r${row}c${col}`);
    hideContextMenu();
  };

  $('cmSaveLib').onclick = () => {
    if (!cmTarget) return;
    const { row, col } = cmTarget;
    const spec = (col === 5) ? pageStrips()[String(row)] : pageButtons()[row + ',' + col];
    if (spec) libraryAdd(spec);
    hideContextMenu();
  };

  $('cmClear').onclick = async () => {
    if (!cmTarget || cmTarget.col === 5) return;
    const { row, col } = cmTarget;
    await removeKey(row, col);
    toast(`已清空格子`);
    hideContextMenu();
  };

  document.addEventListener('click', (e) => {
    if (!e.target.closest('#contextMenu')) hideContextMenu();
  });
}

// ------------------------------------------------------------ icon picker

function getCustomSubCategories() {
  const set = new Set(DEFAULT_CUSTOM_CATEGORIES);
  const list = (cfg && cfg.customIcons) || [];
  for (const item of list) {
    if (item.category && item.category !== '全部') set.add(item.category);
    if (Array.isArray(item.tags)) {
      item.tags.forEach(t => { if (t && t !== '全部') set.add(t); });
    }
  }
  return Array.from(set);
}

function openIconPicker() {
  if (!selected || selected.col === 5) {
    toast('先点选一个按键格子');
    return;
  }
  const modal = $('iconPickerModal');
  if (!modal) return;
  modal.hidden = false;
  $('ipSearch').value = '';
  renderIconPicker();
  $('ipSearch').focus();
}

function closeIconPicker() {
  const modal = $('iconPickerModal');
  if (modal) modal.hidden = true;
  hideIpContextMenu();
}

function hideIpContextMenu() {
  const cm = $('ipContextMenu');
  if (cm) cm.hidden = true;
  ipContextTarget = null;
}

function openIpContextMenu(x, y, iconItem) {
  const cm = $('ipContextMenu');
  if (!cm) return;
  ipContextTarget = iconItem;
  cm.hidden = false;
  
  const w = 180;
  const h = 180;
  const maxX = window.innerWidth - w - 8;
  const maxY = window.innerHeight - h - 8;
  cm.style.left = `${Math.min(x, maxX)}px`;
  cm.style.top = `${Math.min(y, maxY)}px`;
}

function initIpContextMenu() {
  const cm = $('ipContextMenu');
  if (!cm) return;

  $('ipCmApply').onclick = async () => {
    if (!ipContextTarget || !selected || selected.col === 5) return;
    const spec = pageButtons()[selected.row + ',' + selected.col];
    if (spec) {
      spec.icon = ipContextTarget.icon;
      if (ipContextTarget.badge) {
        spec.badge = ipContextTarget.badge;
        if (ipContextTarget.badgeBg) spec.badgeBg = ipContextTarget.badgeBg;
        if (ipContextTarget.badgeColor) spec.badgeColor = ipContextTarget.badgeColor;
      }
      await commit(true);
      renderInspector();
      toast(`已套用图标：「${ipContextTarget.name}」`);
      closeIconPicker();
    }
    hideIpContextMenu();
  };

  $('ipCmRename').onclick = async () => {
    if (!ipContextTarget) return;
    const target = ipContextTarget;
    hideIpContextMenu();
    const newName = await askText('重命名图标', target.name, '输入新图标名称');
    if (!newName || !newName.trim() || newName.trim() === target.name) return;
    target.name = newName.trim();
    await saveConfig();
    renderIconPicker();
    toast(`已重命名为：「${target.name}」`);
  };

  $('ipCmCategory').onclick = async () => {
    if (!ipContextTarget) return;
    const target = ipContextTarget;
    hideIpContextMenu();
    const currentCat = target.category || '常用';
    const newCat = await askText('修改图标分类', currentCat, '输入分类名称（例如：常用、办公、游戏、工具）');
    if (!newCat || !newCat.trim()) return;
    target.category = newCat.trim();
    await saveConfig();
    renderIconPicker();
    toast(`已归入分类：「${target.category}」`);
  };

  $('ipCmCopy').onclick = async () => {
    if (!ipContextTarget) return;
    const target = ipContextTarget;
    hideIpContextMenu();
    try {
      await navigator.clipboard.writeText(target.icon || '');
      toast('已复制 Base64 图标数据到剪贴板');
    } catch (_) {
      toast('复制失败');
    }
  };

  $('ipCmDelete').onclick = async () => {
    if (!ipContextTarget) return;
    const target = ipContextTarget;
    hideIpContextMenu();
    cfg.customIcons = (cfg.customIcons || []).filter(x => x.id !== target.id);
    await saveConfig();
    renderIconPicker();
    toast(`已删除图标：「${target.name}」`);
  };

  document.addEventListener('click', (e) => {
    if (!e.target.closest('#ipContextMenu')) hideIpContextMenu();
  });
}

function renderIconPicker() {
  const tagsBox = $('ipTags');
  const subTagsBox = $('ipSubTags');
  const gridBox = $('ipGrid');
  if (!tagsBox || !gridBox || typeof BUILTIN_ICONS === 'undefined') return;

  tagsBox.innerHTML = '';
  for (const cat of ICON_CATEGORIES) {
    const btn = document.createElement('button');
    btn.className = 'ip-tag' + (cat.id === currentIconCategory ? ' active' : '');
    btn.textContent = cat.name;
    btn.onclick = () => {
      currentIconCategory = cat.id;
      renderIconPicker();
    };
    tagsBox.appendChild(btn);
  }

  const customList = (cfg && cfg.customIcons) || [];

  if (currentIconCategory === 'custom') {
    if (subTagsBox) {
      subTagsBox.hidden = false;
      subTagsBox.innerHTML = '';
      const subCats = getCustomSubCategories();
      for (const sc of subCats) {
        const count = sc === '全部'
          ? customList.length
          : customList.filter(item => (item.category || '常用') === sc || (Array.isArray(item.tags) && item.tags.includes(sc))).length;
        const btn = document.createElement('button');
        btn.className = 'ip-subtag' + (sc === currentCustomSubCategory ? ' active' : '');
        btn.textContent = `${sc} (${count})`;
        btn.onclick = () => {
          currentCustomSubCategory = sc;
          renderIconPicker();
        };
        subTagsBox.appendChild(btn);
      }
      const btnAddCat = document.createElement('button');
      btnAddCat.className = 'ip-subtag';
      btnAddCat.style.borderStyle = 'dashed';
      btnAddCat.textContent = '＋ 新建分类';
      btnAddCat.onclick = async () => {
        const catName = await askText('新建图标分类', '', '输入新分类名称（例如：浏览器、音视频、Adobe）');
        if (!catName || !catName.trim()) return;
        currentCustomSubCategory = catName.trim();
        renderIconPicker();
      };
      subTagsBox.appendChild(btnAddCat);
    }
  } else {
    if (subTagsBox) subTagsBox.hidden = true;
  }

  const q = ($('ipSearch').value || '').trim().toLowerCase();
  gridBox.innerHTML = '';

  if (currentIconCategory === 'custom') {
    let filtered = customList;
    if (currentCustomSubCategory !== '全部') {
      filtered = filtered.filter(item => (item.category || '常用') === currentCustomSubCategory || (Array.isArray(item.tags) && item.tags.includes(currentCustomSubCategory)));
    }
    if (q) {
      filtered = filtered.filter(item => {
        const matchName = item.name && item.name.toLowerCase().includes(q);
        const matchCat = item.category && item.category.toLowerCase().includes(q);
        const matchTags = Array.isArray(item.tags) && item.tags.some(t => t.toLowerCase().includes(q));
        return matchName || matchCat || matchTags;
      });
    }

    if (!filtered.length) {
      gridBox.innerHTML = `
        <div style="grid-column:1/-1;text-align:center;padding:32px 16px;">
          <p class="muted" style="margin:0 0 8px;font-size:14px;">当前分类暂无图标</p>
          <span style="font-size:12px;color:var(--muted);">
            点击右上角「📁 批量导入…」可批量导入本地图片/程序；<br>
            或在按键设置中点选「⭐ 存入图标库」保存当前按键图标。
          </span>
        </div>
      `;
      return;
    }

    for (const cIcon of filtered) {
      const item = document.createElement('div');
      item.className = 'ip-item';
      const catLabel = cIcon.category || '常用';
      item.title = `${cIcon.name} (${catLabel}) - 右击查看更多操作`;
      item.innerHTML = `
        <div class="ip-icon-preview">
          <img src="${cIcon.icon}" style="max-width:100%;max-height:100%;object-fit:contain;" />
        </div>
        <span class="ip-icon-name">${escapeHtml(cIcon.name)}</span>
        <span class="ip-badge-cat">${escapeHtml(catLabel)}</span>
        <button class="ip-del-btn" title="删除此图标">✕</button>
      `;
      item.oncontextmenu = (e) => {
        e.preventDefault();
        e.stopPropagation();
        openIpContextMenu(e.clientX, e.clientY, cIcon);
      };
      const delBtn = item.querySelector('.ip-del-btn');
      delBtn.onclick = async (e) => {
        e.stopPropagation();
        cfg.customIcons = (cfg.customIcons || []).filter(x => x.id !== cIcon.id);
        await saveConfig();
        renderIconPicker();
        toast(`已删除「${cIcon.name}」`);
      };
      item.onclick = async () => {
        if (!selected || selected.col === 5) return;
        const spec = pageButtons()[selected.row + ',' + selected.col];
        if (spec) {
          spec.icon = cIcon.icon;
          if (cIcon.badge) {
            spec.badge = cIcon.badge;
            if (cIcon.badgeBg) spec.badgeBg = cIcon.badgeBg;
            if (cIcon.badgeColor) spec.badgeColor = cIcon.badgeColor;
          }
          await commit(true);
          renderInspector();
          toast(`已套用自定义图标：${cIcon.name}`);
          closeIconPicker();
        }
      };
      gridBox.appendChild(item);
    }
    return;
  }

  if (currentIconCategory === 'all' && customList.length) {
    const matchedCustom = customList.filter(item => !q || item.name.toLowerCase().includes(q) || (item.category && item.category.toLowerCase().includes(q)));
    for (const cIcon of matchedCustom) {
      const item = document.createElement('div');
      item.className = 'ip-item';
      item.title = `${cIcon.name} (我的收藏) - 右击管理`;
      item.innerHTML = `
        <div class="ip-icon-preview">
          <img src="${cIcon.icon}" style="max-width:100%;max-height:100%;object-fit:contain;" />
        </div>
        <span class="ip-icon-name">🌟 ${escapeHtml(cIcon.name)}</span>
        <span class="ip-badge-cat">${escapeHtml(cIcon.category || '收藏')}</span>
      `;
      item.oncontextmenu = (e) => {
        e.preventDefault();
        e.stopPropagation();
        openIpContextMenu(e.clientX, e.clientY, cIcon);
      };
      item.onclick = async () => {
        if (!selected || selected.col === 5) return;
        const spec = pageButtons()[selected.row + ',' + selected.col];
        if (spec) {
          spec.icon = cIcon.icon;
          if (cIcon.badge) {
            spec.badge = cIcon.badge;
            if (cIcon.badgeBg) spec.badgeBg = cIcon.badgeBg;
            if (cIcon.badgeColor) spec.badgeColor = cIcon.badgeColor;
          }
          await commit(true);
          renderInspector();
          toast(`已套用自定义图标：${cIcon.name}`);
          closeIconPicker();
        }
      };
      gridBox.appendChild(item);
    }
  }

  const list = BUILTIN_ICONS.filter((item) => {
    if (currentIconCategory !== 'all' && item.category !== currentIconCategory) return false;
    if (q && !item.name.toLowerCase().includes(q)) return false;
    return true;
  });

  if (!list.length && (currentIconCategory !== 'all' || !customList.some(item => !q || item.name.toLowerCase().includes(q)))) {
    gridBox.innerHTML = '<p class="muted" style="grid-column:1/-1;text-align:center;padding:24px;">没有匹配的图标</p>';
    return;
  }

  for (const icon of list) {
    const item = document.createElement('div');
    item.className = 'ip-item';
    item.title = icon.name;
    item.innerHTML = `
      <div class="ip-icon-preview">${icon.svg}</div>
      <span class="ip-icon-name">${icon.name}</span>
    `;
    item.onclick = async () => {
      if (!selected || selected.col === 5) return;
      const spec = pageButtons()[selected.row + ',' + selected.col];
      if (spec) {
        spec.icon = svgToDataUrl(icon.svg, '#ffffff');
        await commit(true);
        renderInspector();
        toast(`已应用图标：${icon.name}`);
        closeIconPicker();
      }
    };
    gridBox.appendChild(item);
  }
}

function initIconPicker() {
  $('ipClose').onclick = closeIconPicker;
  $('ipSearch').addEventListener('input', renderIconPicker);
  $('iconPickerModal').addEventListener('click', (e) => {
    if (e.target === $('iconPickerModal')) closeIconPicker();
  });

  initIpContextMenu();

  const btnBatchImport = $('ipBatchImport');
  if (btnBatchImport) {
    btnBatchImport.onclick = async () => {
      const res = await api.dialogPick({
        multiple: true,
        properties: ['openFile', 'multiSelections'],
        filters: [
          { name: '图标与图像/应用程序', extensions: ['png', 'jpg', 'jpeg', 'webp', 'svg', 'ico', 'exe', 'lnk'] }
        ]
      });
      if (!res) return;
      const filePaths = Array.isArray(res) ? res : [res];
      if (!filePaths.length) return;

      cfg.customIcons = cfg.customIcons || [];
      const targetCat = (currentCustomSubCategory === '全部') ? '常用' : currentCustomSubCategory;
      let count = 0;
      toast(`正在批量处理 ${filePaths.length} 个文件…`);

      for (const fp of filePaths) {
        try {
          const iconData = await api.iconExtract(fp);
          if (!iconData) continue;
          const base = fp.split(/[\\/]/).pop();
          const name = base.replace(/\.[^.]+$/, '');
          cfg.customIcons.push({
            id: 'ci_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
            name: name || '图标',
            icon: iconData,
            category: targetCat,
            tags: [],
            badge: '',
            badgeBg: '',
            badgeColor: '',
            addedAt: Date.now()
          });
          count++;
        } catch (err) {
          console.warn('Batch import error for', fp, err);
        }
      }

      if (count > 0) {
        await saveConfig();
        currentIconCategory = 'custom';
        renderIconPicker();
        toast(`成功批量导入 ${count} 个图标到「${targetCat}」分类！`);
      } else {
        toast('未提取到有效图标');
      }
    };
  }

  const btnSaveCurrent = $('ipSaveCurrent');
  if (btnSaveCurrent) {
    btnSaveCurrent.onclick = async () => {
      if (!selected || selected.col === 5) {
        toast('先点选一个按键');
        return;
      }
      const spec = pageButtons()[selected.row + ',' + selected.col];
      if (!spec || !spec.icon) {
        toast('选中的按键没有设置图标');
        return;
      }
      const name = await askText('存入自定义图标库', spec.label || '我的图标', '输入图标名称');
      if (!name) return;
      cfg.customIcons = cfg.customIcons || [];
      const targetCat = (currentCustomSubCategory === '全部') ? '常用' : currentCustomSubCategory;
      cfg.customIcons.push({
        id: 'ci_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
        name: name.trim(),
        icon: spec.icon,
        category: targetCat,
        tags: [],
        badge: spec.badge || '',
        badgeBg: spec.badgeBg || '',
        badgeColor: spec.badgeColor || '',
        addedAt: Date.now()
      });
      await saveConfig();
      toast(`已存入自定义图标库「${targetCat}」分类：「${name.trim()}」`);
      currentIconCategory = 'custom';
      renderIconPicker();
    };
  }
}


// ------------------------------------------------------------ image cropper

let cropperState = {
  active: false,
  image: null,
  rotation: 0,        // 0, 90, 180, 270
  relativeZoom: 1.0,  // 1.0 = 100%
  baseScale: 1.0,     // scale at relativeZoom = 1.0
  coverScale: 1.0,    // scale to cover the 210x210 mask
  fitScale: 1.0,      // scale to fit inside 210x210 mask
  scale: 1.0,         // actual scale = baseScale * relativeZoom
  x: 140,             // center X on 280x280 canvas
  y: 140,             // center Y on 280x280 canvas
  dragging: false,
  startX: 0,
  startY: 0,
  onConfirm: null,
};

function computeCropperScales() {
  if (!cropperState.image) return;
  const img = cropperState.image;
  const isRot90 = (cropperState.rotation % 180 !== 0);
  const effW = isRot90 ? img.height : img.width;
  const effH = isRot90 ? img.width : img.height;
  const maskSize = 210;

  cropperState.coverScale = maskSize / Math.min(effW, effH);
  cropperState.fitScale = maskSize / Math.max(effW, effH);
  cropperState.baseScale = cropperState.coverScale;
  cropperState.scale = cropperState.baseScale * cropperState.relativeZoom;
}

function openCropper(imageSrc, onConfirm) {
  const modal = $('cropperModal');
  if (!modal) {
    if (onConfirm) onConfirm(imageSrc);
    return;
  }
  const img = new Image();
  img.onload = () => {
    cropperState.image = img;
    cropperState.onConfirm = onConfirm;
    cropperState.active = true;
    cropperState.rotation = 0;
    cropperState.relativeZoom = 1.0;
    cropperState.x = 140;
    cropperState.y = 140;

    computeCropperScales();

    const zoomInput = $('cropZoom');
    if (zoomInput) {
      zoomInput.value = '1.0';
      $('cropZoomVal').textContent = '100%';
    }

    modal.hidden = false;
    renderCropper();
  };
  img.src = imageSrc;
}

function closeCropper() {
  const modal = $('cropperModal');
  if (modal) modal.hidden = true;
  cropperState.active = false;
  cropperState.image = null;
  cropperState.onConfirm = null;
}

function setRelativeZoom(newZoom, cx = 140, cy = 140) {
  newZoom = Math.max(0.2, Math.min(4.0, newZoom));
  const oldScale = cropperState.scale;
  cropperState.relativeZoom = newZoom;
  cropperState.scale = cropperState.baseScale * newZoom;

  if (oldScale > 0) {
    const ratio = cropperState.scale / oldScale;
    cropperState.x = cx - (cx - cropperState.x) * ratio;
    cropperState.y = cy - (cy - cropperState.y) * ratio;
  }

  const zoomInput = $('cropZoom');
  if (zoomInput) {
    zoomInput.value = newZoom.toFixed(2);
    $('cropZoomVal').textContent = Math.round(newZoom * 100) + '%';
  }
  renderCropper();
}

function renderCropper() {
  const canvas = $('cropCanvas');
  if (!canvas || !cropperState.image) return;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, 280, 280);

  // Outer dark background
  ctx.fillStyle = '#14171a';
  ctx.fillRect(0, 0, 280, 280);

  // Inside mask transparency checkerboard (210x210 centered at 140,140 => bounds: [35, 35, 210, 210])
  ctx.save();
  ctx.beginPath();
  if (ctx.roundRect) {
    ctx.roundRect(35, 35, 210, 210, 28);
  } else {
    ctx.rect(35, 35, 210, 210);
  }
  ctx.clip();

  const checkSize = 10;
  for (let y = 35; y < 245; y += checkSize) {
    for (let x = 35; x < 245; x += checkSize) {
      ctx.fillStyle = ((Math.floor(x / checkSize) + Math.floor(y / checkSize)) % 2 === 0) ? '#22272e' : '#1c2128';
      ctx.fillRect(x, y, checkSize, checkSize);
    }
  }

  // Draw the image rotated and scaled around (cropperState.x, cropperState.y)
  ctx.save();
  ctx.translate(cropperState.x, cropperState.y);
  ctx.rotate((cropperState.rotation * Math.PI) / 180);
  ctx.scale(cropperState.scale, cropperState.scale);
  ctx.drawImage(cropperState.image, -cropperState.image.width / 2, -cropperState.image.height / 2);
  ctx.restore();

  ctx.restore(); // end clip
}

function initCropper() {
  const canvas = $('cropCanvas');
  const modal = $('cropperModal');
  if (!canvas || !modal) return;

  canvas.addEventListener('mousedown', (e) => {
    cropperState.dragging = true;
    cropperState.startX = e.clientX - cropperState.x;
    cropperState.startY = e.clientY - cropperState.y;
  });

  window.addEventListener('mousemove', (e) => {
    if (!cropperState.dragging) return;
    cropperState.x = e.clientX - cropperState.startX;
    cropperState.y = e.clientY - cropperState.startY;
    renderCropper();
  });

  window.addEventListener('mouseup', () => {
    cropperState.dragging = false;
  });

  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    const delta = e.deltaY < 0 ? 0.08 : -0.08;
    setRelativeZoom(cropperState.relativeZoom + delta, cx, cy);
  }, { passive: false });

  const zoomInput = $('cropZoom');
  if (zoomInput) {
    zoomInput.addEventListener('input', () => {
      setRelativeZoom(Number(zoomInput.value), 140, 140);
    });
  }

  // 快捷操作按钮
  const btnFit = $('cropFit');
  if (btnFit) {
    btnFit.onclick = () => {
      if (!cropperState.image) return;
      computeCropperScales();
      const fitRelative = cropperState.fitScale / cropperState.baseScale;
      cropperState.x = 140;
      cropperState.y = 140;
      setRelativeZoom(fitRelative, 140, 140);
    };
  }

  const btnCover = $('cropCover');
  if (btnCover) {
    btnCover.onclick = () => {
      if (!cropperState.image) return;
      computeCropperScales();
      cropperState.x = 140;
      cropperState.y = 140;
      setRelativeZoom(1.0, 140, 140);
    };
  }

  const btnRotate = $('cropRotate');
  if (btnRotate) {
    btnRotate.onclick = () => {
      if (!cropperState.image) return;
      cropperState.rotation = (cropperState.rotation + 90) % 360;
      computeCropperScales();
      renderCropper();
    };
  }

  const btnReset = $('cropReset');
  if (btnReset) {
    btnReset.onclick = () => {
      if (!cropperState.image) return;
      cropperState.rotation = 0;
      cropperState.x = 140;
      cropperState.y = 140;
      computeCropperScales();
      setRelativeZoom(1.0, 140, 140);
    };
  }

  $('cropClose').onclick = closeCropper;
  $('cropCancel').onclick = closeCropper;

  $('cropOk').onclick = () => {
    if (!cropperState.image || !cropperState.onConfirm) {
      closeCropper();
      return;
    }
    const outCanvas = document.createElement('canvas');
    outCanvas.width = 192;
    outCanvas.height = 192;
    const outCtx = outCanvas.getContext('2d');
    outCtx.clearRect(0, 0, 192, 192);
    outCtx.imageSmoothingEnabled = true;
    outCtx.imageSmoothingQuality = 'high';

    const exportRatio = 192 / 210;
    outCtx.save();
    outCtx.translate(96, 96);
    outCtx.translate((cropperState.x - 140) * exportRatio, (cropperState.y - 140) * exportRatio);
    outCtx.rotate((cropperState.rotation * Math.PI) / 180);
    const exportScale = cropperState.scale * exportRatio;
    outCtx.scale(exportScale, exportScale);
    outCtx.drawImage(cropperState.image, -cropperState.image.width / 2, -cropperState.image.height / 2);
    outCtx.restore();

    // 导出高保真带透明通道的 PNG（体积通常仅 15KB~35KB）
    const croppedDataUrl = outCanvas.toDataURL('image/png');
    const cb = cropperState.onConfirm;
    closeCropper();
    cb(croppedDataUrl);
  };
}

// ------------------------------------------------------------ keyboard shortcuts

function initKeyboardShortcuts() {
  document.addEventListener('keydown', async (e) => {
    const tag = e.target.tagName ? e.target.tagName.toLowerCase() : '';
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return;

    if (e.key === 'Escape') {
      hideContextMenu();
      closeIconPicker();
      closeCropper();
      if (selected) select(null);
      return;
    }

    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
      e.preventDefault();
      if (!selected) { select(0, 0); return; }
      let { row, col } = selected;
      if (e.key === 'ArrowUp') row = Math.max(0, row - 1);
      if (e.key === 'ArrowDown') row = Math.min(ROWS - 1, row + 1);
      if (e.key === 'ArrowLeft') col = Math.max(0, col - 1);
      if (e.key === 'ArrowRight') col = Math.min(TOTAL_COLS - 1, col + 1);
      select(row, col);
      return;
    }

    if ((e.ctrlKey || e.metaKey) && (e.key === 'c' || e.key === 'C')) {
      if (!selected) return;
      const spec = (selected.col === 5) ? pageStrips()[String(selected.row)] : pageButtons()[selected.row + ',' + selected.col];
      if (spec) {
        clipboardKey = clone(spec);
        toast(`已复制按键配置`);
      }
      return;
    }

    if ((e.ctrlKey || e.metaKey) && (e.key === 'v' || e.key === 'V')) {
      if (!selected || selected.col === 5 || !clipboardKey) return;
      if (isBackCell(selected.row, selected.col)) return;
      pageButtons()[selected.row + ',' + selected.col] = clone(clipboardKey);
      await commit(true);
      renderInspector();
      toast(`已粘贴到 r${selected.row}c${selected.col}`);
      return;
    }

    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (!selected || selected.col === 5) return;
      if (isBackCell(selected.row, selected.col)) return;
      const spec = pageButtons()[selected.row + ',' + selected.col];
      if (spec) {
        await removeKey(selected.row, selected.col);
        toast(`已清空格子`);
      }
      return;
    }
  });
}

// ------------------------------------------------------------- shell wiring

function bindShell() {
  const panel = $('settingsPanel');
  const gear = $('settingsBtn');
  gear.onclick = (e) => {
    e.stopPropagation();
    panel.hidden = !panel.hidden;
    gear.classList.toggle('on', !panel.hidden);
  };
  document.addEventListener('click', (e) => {
    if (panel.hidden) return;
    if (panel.contains(e.target) || gear.contains(e.target)) return;
    panel.hidden = true;
    gear.classList.remove('on');
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { panel.hidden = true; gear.classList.remove('on'); }
  });

  // 机身颜色（默认白色）。故意放在 bindShell 而不是 bindDevice，
  // 这样预览模式（无 preload）里也能切换、能截图。
  $('theme').value = (cfg.theme === 'dark') ? 'dark' : 'light';
  $('theme').addEventListener('change', async (e) => {
    cfg.theme = e.target.value;
    applyTheme();
    if (!DEMO) await saveConfig();
  });

  $('drawerToggle').onclick = () => setDrawer(!$('drawer').classList.contains('open'));
  $('inspHelp').onclick = showHelp;

  const onSearch = (e) => { libQuery = e.target.value; renderLibrary(); renderLibPanel(); };
  $('libSearch').addEventListener('input', onSearch);
  $('libSearch2').addEventListener('input', onSearch);
  $('libExpand').onclick = () => openLibPanel(true);
  $('libClose').onclick = () => openLibPanel(false);
  $('libPanel').addEventListener('click', (e) => { if (e.target === $('libPanel')) openLibPanel(false); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !$('libPanel').hidden) openLibPanel(false);
  });
  $('libImport').onclick = libraryImport;
  $('libExportAll').onclick = () => libraryExport('');
  $('libExportTag').onclick = () => {
    if (!libTag) { toast('先点一个标签再导出'); return; }
    libraryExport(libTag);
  };

  $('pageAddTop').onclick = pageAddTop;
  $('pageAddSub').onclick = pageAddChild;
  $('pageRename').onclick = pageRename;
  $('pageDup').onclick = pageDuplicate;
  $('pageSave').onclick = libraryAddPage;
  $('pageDel').onclick = pageDelete;

  const pGrad = $('pageGradientBtn');
  if (pGrad) pGrad.onclick = () => select(null);

  const stage = document.querySelector('.stage');
  if (stage) {
    stage.addEventListener('click', (e) => {
      if (e.target.closest('.cell')) return;
      select(null);
    });
  }

  // 把格子拖进按键库 = 存进库。抽屉整条（含折叠时的标题栏）和库大面板都是放置目标。
  // 只绑 #drawer 而不额外绑它内部的 #library，否则 drop 会冒泡两次、存两条。
  for (const id of ['drawer', 'libGrid']) {
    const zone = $(id);
    if (!zone) continue;
    zone.addEventListener('dragover', (e) => {
      const hasKey = !!dragFrom || (e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('application/akp153-cell'));
      if (!hasKey) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      zone.classList.add('drop');
    });
    zone.addEventListener('dragleave', (e) => {
      if (zone.contains(e.relatedTarget)) return;
      zone.classList.remove('drop');
    });
    zone.addEventListener('drop', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      zone.classList.remove('drop');
      let from = dragFrom;
      if (!from && e.dataTransfer) {
        const raw = e.dataTransfer.getData('application/akp153-cell') || e.dataTransfer.getData('text/plain');
        if (raw && raw.includes(',')) {
          const [r, c] = raw.split(',').map(Number);
          if (!isNaN(r) && !isNaN(c)) from = { row: r, col: c };
        }
      }
      dragFrom = null;
      dragLib = null;
      if (!from) return;
      const spec = pageButtons()[from.row + ',' + from.col];
      if (!spec) { toast('这个格子是空的，没东西可存'); return; }
      await libraryAdd(spec);
    });
  }
}

function applyTheme() {
  document.body.dataset.theme = (cfg && cfg.theme === 'dark') ? 'dark' : 'light';
}

function showHelp() {
  const wrap = document.createElement('div');
  wrap.className = 'modal';
  wrap.innerHTML = `<div class="modalbox">
    <h3>怎么用</h3>
    <ol style="margin:0 0 14px 18px;padding:0;font-size:13px;line-height:1.9">
      <li>把 <b>文件 / 文件夹 / 快捷方式 / 网址</b> 拖进任意格子</li>
      <li>点格子 → 右侧改名称、目标、<b>外观</b>（底色、渐变、字号、图标、文字位置）</li>
      <li>格子之间可以<b>互拖交换位置</b>；拖到空格子就是移动</li>
      <li>调好的键点「<b>存进按键库</b>」，之后能拖回任意格子和任意页</li>
      <li><b>页面</b>：上面一排页签，或按设备上的切页键翻页。<b>子页</b>＝文件夹，
          进去之后右下角会自动出现「返回」，出来自动恢复</li>
      <li>右列 3 块是<b>显示屏</b>，按不动，可设成时钟、自定义文字或<b>页码</b></li>
      <li>设备设置（亮度、休眠、方向、自启）在右上角 <b>⚙</b></li>
    </ol>
    <div class="btnrow"><button class="primary" id="_helpOk">知道了</button></div>
  </div>`;
  document.body.appendChild(wrap);
  const done = () => wrap.remove();
  wrap.querySelector('#_helpOk').onclick = done;
  wrap.addEventListener('click', (e) => { if (e.target === wrap) done(); });
}

// ----------------------------------------------------------------------- boot

function demoConfig() {
  return {
    version: 2, brightness: 80, idleSleepMinutes: 5, openAtLogin: true,
    currentPage: 'p1',
    pages: [
      {
        id: 'p1', name: '主页面', parent: null,
        buttons: {
          '0,0': { type: 'app', label: 'VS Code', target: 'C:\\Code.exe', args: '', icon: '', color: '#1565c0' },
          '0,1': { type: 'app', label: '终端', target: 'wt.exe', args: '', icon: '', color: '#37474f' },
          '0,2': { type: 'folder', label: '项目目录', target: 'E:\\项目', args: '', icon: '', color: '#ef6c00' },
          '0,3': { type: 'url', label: 'github.com', target: 'https://github.com', args: '', icon: '', color: '#0277bd' },
          '0,4': { type: 'ps1', label: '系统体检', target: 'Sys-Stats.ps1', args: '', icon: '', color: '#00838f' },
          '1,0': { type: 'command', label: '锁屏', target: 'rundll32.exe user32.dll,LockWorkStation', args: '', icon: '', color: '#c62828' },
          '2,0': { type: 'page', mode: 'goto', pageId: 'p3', label: '娱乐', args: '', icon: '', color: '#455a64' },
          '2,1': { type: 'page', mode: 'next', label: '下一页', args: '', icon: '', color: '#455a64' },
        },
        strips: {
          '0': { type: 'clock', label: '', color: '#263238' },
          '1': { type: 'text', label: 'AKP153\nDOCK', color: '#1a237e' },
          '2': { type: 'page', label: '', color: '#263238' },
        },
      },
      {
        id: 'p2', name: '媒体', parent: null,
        buttons: {
          '0,0': { type: 'app', label: '音乐', target: 'C:\\Music.exe', args: '', icon: '', color: '#6a1b9a' },
          '2,1': { type: 'page', mode: 'prev', label: '上一页', args: '', icon: '', color: '#455a64' },
        },
        strips: { '2': { type: 'page', label: '', color: '#263238' } },
      },
      {
        id: 'p3', name: '娱乐', parent: 'p1',
        buttons: {
          '0,0': { type: 'url', label: 'bilibili', target: 'https://bilibili.com', args: '', icon: '', color: '#0277bd' },
          '1,0': { type: 'page', mode: 'home', label: '主页面', args: '', icon: '', color: '#455a64' },
        },
        strips: { '2': { type: 'page', label: '', color: '#263238' } },
      },
    ],
    library: [
      { id: 'L1', name: 'VS Code', tags: ['开发', '常用'], spec: { type: 'app', label: 'VS Code', target: 'C:\\Code.exe', color: '#1565c0' } },
      { id: 'L2', name: '关屏', tags: ['系统'], spec: { type: 'ps1', label: '关屏', target: 'System-Action.ps1', color: '#1a237e' } },
      { id: 'L3', name: '区域截图', tags: ['常用'], spec: { type: 'command', label: '区域截图', target: 'ms-screenclip:', color: '#00838f' } },
      { id: 'L4', name: '下一页', tags: ['导航'], spec: { type: 'page', mode: 'next', label: '下一页', color: '#455a64' } },
      {
        id: 'L5', name: '主页面（整页）', kind: 'page', tags: ['整页'],
        page: {
          buttons: {
            '0,0': { type: 'app', label: 'VS Code', target: 'C:\\Code.exe', color: '#1565c0' },
            '1,1': { type: 'url', label: 'github', target: 'https://github.com', color: '#0277bd' },
          },
          strips: { '0': { type: 'clock', label: '', color: '#263238' } },
        },
      },
    ],
  };
}

/** Wires the device/settings controls. Only meaningful with a real preload. */
function bindDevice() {
  $('brightness').value = cfg.brightness;
  $('brightVal').textContent = cfg.brightness;
  $('idle').value = String(cfg.idleSleepMinutes || 0);
  $('login').checked = !!cfg.openAtLogin;
  $('sleepMode').value = cfg.sleepMode || 'zeros-last';

  $('brightness').addEventListener('input', async (e) => {
    const v = +e.target.value;
    $('brightVal').textContent = v;
    cfg.brightness = v;
    await saveConfig();
    await api.deviceBrightness(v);
  });
  $('idle').addEventListener('change', async (e) => {
    cfg.idleSleepMinutes = +e.target.value;
    await saveConfig();
  });
  $('rotate').addEventListener('change', () => repaintAll());
  $('sleepMode').addEventListener('change', async (e) => {
    cfg.sleepMode = e.target.value;
    await saveConfig();
    toast('休眠方式已切换，按一下「休眠屏幕」试试');
  });
  $('login').addEventListener('change', async (e) => {
    cfg.openAtLogin = e.target.checked;
    await saveConfig();
    await api.setLogin(e.target.checked);
  });

  $('reconnect').onclick = async () => { await api.deviceReconnect(); await repaintAll(); };
  $('repaint').onclick = () => repaintAll();
  $('sleep').onclick = () => api.deviceSleep();
  $('wake').onclick = async () => { await api.deviceWake(); await repaintAll(); };

  api.on('host:status', (s) => setStatus(s));
  api.on('device:repaint', () => repaintAll());
  api.on('device:repaint-strips', () => repaintStrips());
  api.on('toast', (t) => toast(t && t.message));
  api.on('key:flash', (k) => {
    const cell = document.querySelector(`.cell[data-row="${k.row}"][data-col="${k.col}"]`);
    if (!cell) return;
    cell.classList.add('flash');
    clearTimeout(cell._flash);
    cell._flash = setTimeout(() => cell.classList.remove('flash'), 240);
  });
  api.on('key:unconfigured', (k) => flashUnconfigured(k.row, k.col));
  api.on('key:result', (payload) => {
    if (payload) flashKeyResult(payload.row, payload.col, payload.success, payload.text);
  });
  api.on('key:toggleState', async ({ pageId, row, col, activeState }) => {
    if (!cfg || !cfg.pages) return;
    const p = (pageId && cfg.pages.find((x) => x.id === pageId)) || curPage();
    if (p && p.buttons) {
      const s = p.buttons[`${row},${col}`];
      if (s) {
        s._activeState = activeState;
      }
    }
    const current = curPage();
    if (!pageId || (current && current.id === pageId) || (p && current && p.id === current.id)) {
      refreshGrid();
      await pushKey(row, col);
      if (selected && selected.row === row && selected.col === col) {
        renderInspector();
      }
    }
  });

  // A key on the device switched pages (or a sub page's back key was pressed).
  // Config already holds the new page - reload and redraw everything.
  api.on('page:changed', async () => {
    cfg = await api.configLoad();
    selected = null;
    renderPageTabs();
    buildGrid();
    renderInspector();
    await repaintAll();
  });

  // config.json 被外部改过（Agent 或手工编辑）——主进程已重载，这里重新渲染。
  api.on('config:external', async () => {
    cfg = await api.configLoad();
    selected = null;
    applyTheme();
    $('theme').value = (cfg.theme === 'dark') ? 'dark' : 'light';
    renderPageTabs();
    buildGrid();
    renderInspector();
    renderLibrary();
    renderLibPanel();
    await repaintAll();
    toast('配置已从文件重新载入');
  });
}

function initWindowControls() {
  const winMin = $('winMin');
  const winMax = $('winMax');
  const winClose = $('winClose');
  const bar = $('bar');

  const updateMaxIcon = (maximized) => {
    if (winMax) {
      winMax.textContent = maximized ? '❐' : '▢';
      winMax.title = maximized ? '还原' : '最大化';
    }
  };

  if (!DEMO && window.api && api.windowMinimize) {
    if (winMin) winMin.onclick = () => api.windowMinimize();
    if (winMax) {
      winMax.onclick = async () => {
        const isMax = await api.windowMaximize();
        updateMaxIcon(isMax);
      };
    }
    if (winClose) winClose.onclick = () => api.windowClose();

    if (bar) {
      bar.addEventListener('dblclick', async (e) => {
        if (e.target.closest('button, input, select, .pill, #winControls, .actions')) return;
        const isMax = await api.windowMaximize();
        updateMaxIcon(isMax);
      });
    }

    api.on('window:max-changed', (d) => {
      updateMaxIcon(d && d.maximized);
    });

    if (api.windowIsMaximized) {
      api.windowIsMaximized().then(updateMaxIcon).catch(() => {});
    }
  } else {
    let demoMax = false;
    if (winMin) winMin.onclick = () => toast('最小化（预览模式）');
    if (winMax) {
      winMax.onclick = () => {
        demoMax = !demoMax;
        updateMaxIcon(demoMax);
        toast(demoMax ? '已最大化（预览模式）' : '已还原（预览模式）');
      };
    }
    if (winClose) winClose.onclick = () => toast('关闭并最小化到托盘（预览模式）');
  }
}

async function initConflictCheck() {
  if (DEMO || !window.api || !api.checkConflict) return;
  try {
    const res = await api.checkConflict();
    const alertBox = $('conflictAlert');
    const btnDisable = $('btnDisableConflict');
    if (alertBox) {
      alertBox.hidden = !res || !res.hasConflict;
    }
    if (btnDisable) {
      btnDisable.onclick = async () => {
        const disRes = await api.disableConflict();
        if (disRes && disRes.ok) {
          toast('已禁用原厂开机自启');
          if (alertBox) alertBox.hidden = true;
        } else {
          toast('禁用失败：' + (disRes && disRes.error));
        }
      };
    }
  } catch (_) {}
}

async function boot() {
  if (DEMO) {
    cfg = demoConfig();
  } else {
    cfg = await api.configLoad();
    if (!cfg.library) cfg.library = [];
    bindDevice();
  }

  buildGrid();
  bindShell();
  initInspTabs();
  initWindowControls();
  initConflictCheck();
  initContextMenu();
  initIconPicker();
  initCropper();
  initKeyboardShortcuts();
  applyTheme();
  setDrawer(false);
  renderLibrary();
  renderPageTabs();

  // 定期检测并刷新系统状态监控副屏（CPU / 内存）
  setInterval(async () => {
    if (DEMO || !cfg) return;
    const strips = pageStrips();
    let hasSys = false;
    for (const row of [0, 1, 2]) {
      const s = strips[String(row)];
      if (s && ['cpu', 'mem', 'sys'].includes(s.type)) {
        hasSys = true;
        await pushStrip(row);
      }
    }
    if (hasSys) refreshGrid();
  }, 3000);

  if (DEMO) {
    toast('预览模式 —— 这是示例布局。真机请运行「启动 AKP153 控制台.bat」');
    return;
  }

  setStatus(await api.hostStatus());
  await repaintAll();
}

function setStatus(s) {
  const el = $('status');
  if (!s) return;
  if (s.error === 'DEVICE_BUSY') {
    el.className = 'pill pill-err';
    el.textContent = '设备被 Companion 占用';
  } else if (s.error === 'DEVICE_LOST') {
    el.className = 'pill pill-warn';
    el.textContent = '设备已断开 · 自动重连中…';
  } else if (s.error) {
    el.className = 'pill pill-err';
    el.textContent = '设备异常：' + s.error;
  } else if (s.device) {
    const d = s.draws || {};
    const bad = d.fail || 0;
    el.className = 'pill ' + (bad ? 'pill-err' : 'pill-ok');
    el.textContent = bad ? `已连接 · 推图失败 ${bad}` : `已连接 · 推图 ${d.ok || 0}`;
    el.title = bad ? String(d.lastError || '') : '';
  } else {
    el.className = 'pill pill-warn';
    el.textContent = '连接中…';
  }
}

boot().catch((e) => toast('初始化失败：' + (e && e.message)));
