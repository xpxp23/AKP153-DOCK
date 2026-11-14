'use strict';
/**
 * Isomorphic Headless Canvas Renderer (v0.12.0)
 *
 * 核心能力：
 * 1. 当主窗口隐藏至系统托盘（或开启「托盘无头省电模式」挂起渲染器）时，由主进程直接消费
 *    `runtime-store.js` 的 `computeRenderModel` / `computeStripRenderModel` 生成硬件帧。
 * 2. 双模光栅化管线：
 *    - 优先调用 C# 原生守护进程 `akp-input.exe` 的 GDI+ ClearType 硬件磁贴合成器 (`NativeInput.renderTileJpeg`)，支持完整中文字体、平滑渐变、角标与折线图。
 *    - 内置 Node 侧 `nativeImage` + `jpeg-js` 纯软件 RGBA 光栅化引擎兜底（支持图标缩放叠加、渐变底色、趋势折线、进度条、状态角标与旋转编码），确保跨环境 100% 零依赖可用。
 */

const jpeg = require('jpeg-js');
let nativeImage = null;
try { ({ nativeImage } = require('electron')); } catch (_) {}

const { computeRenderModel, computeStripRenderModel } = require('./runtime-store.js');

const MINI_GLYPHS = {
  '0': [0x0E, 0x11, 0x13, 0x15, 0x19, 0x11, 0x0E],
  '1': [0x04, 0x0C, 0x04, 0x04, 0x04, 0x04, 0x0E],
  '2': [0x0E, 0x11, 0x01, 0x06, 0x08, 0x10, 0x1F],
  '3': [0x1F, 0x02, 0x04, 0x06, 0x01, 0x11, 0x0E],
  '4': [0x02, 0x06, 0x0A, 0x12, 0x1F, 0x02, 0x02],
  '5': [0x1F, 0x10, 0x1E, 0x01, 0x01, 0x11, 0x0E],
  '6': [0x06, 0x08, 0x10, 0x1E, 0x11, 0x11, 0x0E],
  '7': [0x1F, 0x01, 0x02, 0x04, 0x08, 0x08, 0x08],
  '8': [0x0E, 0x11, 0x11, 0x0E, 0x11, 0x11, 0x0E],
  '9': [0x0E, 0x11, 0x11, 0x0F, 0x01, 0x02, 0x0C],
  '%': [0x18, 0x19, 0x02, 0x04, 0x08, 0x13, 0x03],
  ':': [0x00, 0x04, 0x04, 0x00, 0x04, 0x04, 0x00],
  '.': [0x00, 0x00, 0x00, 0x00, 0x00, 0x06, 0x06],
  '/': [0x01, 0x02, 0x02, 0x04, 0x08, 0x08, 0x10],
  '-': [0x00, 0x00, 0x00, 0x1F, 0x00, 0x00, 0x00],
  'C': [0x0E, 0x11, 0x10, 0x10, 0x10, 0x11, 0x0E],
  'P': [0x1E, 0x11, 0x11, 0x1E, 0x10, 0x10, 0x10],
  'U': [0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0E],
  'G': [0x0E, 0x11, 0x10, 0x17, 0x11, 0x11, 0x0F],
  'M': [0x11, 0x1B, 0x15, 0x15, 0x11, 0x11, 0x11],
  'E': [0x1F, 0x10, 0x10, 0x1E, 0x10, 0x10, 0x1F],
  'K': [0x11, 0x12, 0x14, 0x18, 0x14, 0x12, 0x11],
  'B': [0x1E, 0x11, 0x11, 0x1E, 0x11, 0x11, 0x1E],
  'S': [0x0F, 0x10, 0x10, 0x0E, 0x01, 0x01, 0x1E],
  'O': [0x0E, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0E],
  'N': [0x11, 0x19, 0x15, 0x13, 0x11, 0x11, 0x11],
  'T': [0x1F, 0x04, 0x04, 0x04, 0x04, 0x04, 0x04],
  'V': [0x11, 0x11, 0x11, 0x11, 0x11, 0x0A, 0x04],
  'R': [0x1E, 0x11, 0x11, 0x1E, 0x14, 0x12, 0x11],
  'A': [0x0E, 0x11, 0x11, 0x1F, 0x11, 0x11, 0x11],
};

function parseHexColor(hex, fallback = [30, 41, 59]) {
  const s = String(hex || '').trim().replace(/^#/, '');
  if (s.length === 3) {
    return [
      parseInt(s[0] + s[0], 16) || 0,
      parseInt(s[1] + s[1], 16) || 0,
      parseInt(s[2] + s[2], 16) || 0,
    ];
  }
  if (s.length >= 6) {
    return [
      parseInt(s.slice(0, 2), 16) || 0,
      parseInt(s.slice(2, 4), 16) || 0,
      parseInt(s.slice(4, 6), 16) || 0,
    ];
  }
  return fallback;
}

function createRgbaSurface(size, bgHex, bgHex2 = '') {
  const buf = Buffer.alloc(size * size * 4);
  const c1 = parseHexColor(bgHex, [30, 41, 59]);
  const c2 = bgHex2 ? parseHexColor(bgHex2, c1) : [
    Math.max(0, Math.round(c1[0] * 0.72)),
    Math.max(0, Math.round(c1[1] * 0.72)),
    Math.max(0, Math.round(c1[2] * 0.72)),
  ];
  for (let y = 0; y < size; y++) {
    const t = y / Math.max(1, size - 1);
    const r = Math.round(c1[0] + (c2[0] - c1[0]) * t);
    const g = Math.round(c1[1] + (c2[1] - c1[1]) * t);
    const b = Math.round(c1[2] + (c2[2] - c1[2]) * t);
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;
      buf[idx] = r;
      buf[idx + 1] = g;
      buf[idx + 2] = b;
      buf[idx + 3] = 255;
    }
  }
  return buf;
}

function fillRectRgba(buf, size, rx, ry, rw, rh, rgb, alpha = 1) {
  const x0 = Math.max(0, Math.round(rx));
  const y0 = Math.max(0, Math.round(ry));
  const x1 = Math.min(size, Math.round(rx + rw));
  const y1 = Math.min(size, Math.round(ry + rh));
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const idx = (y * size + x) * 4;
      if (alpha >= 0.99) {
        buf[idx] = rgb[0];
        buf[idx + 1] = rgb[1];
        buf[idx + 2] = rgb[2];
      } else {
        buf[idx] = Math.round(buf[idx] * (1 - alpha) + rgb[0] * alpha);
        buf[idx + 1] = Math.round(buf[idx + 1] * (1 - alpha) + rgb[1] * alpha);
        buf[idx + 2] = Math.round(buf[idx + 2] * (1 - alpha) + rgb[2] * alpha);
      }
    }
  }
}

function drawMiniText(buf, size, text, cx, cy, scale = 2, rgb = [255, 255, 255]) {
  const clean = String(text || '').toUpperCase().replace(/[^0-9%:.\/\-CPUGMEKBSONTVRA ]/g, '');
  if (!clean) return;
  const charW = 6 * scale;
  const totalW = clean.length * charW - scale;
  let startX = Math.round(cx - totalW / 2);
  const startY = Math.round(cy - (7 * scale) / 2);
  for (let i = 0; i < clean.length; i++) {
    const glyph = MINI_GLYPHS[clean[i]];
    if (glyph) {
      for (let r = 0; r < 7; r++) {
        const rowBits = glyph[r];
        for (let c = 0; c < 5; c++) {
          if ((rowBits >> (4 - c)) & 1) {
            fillRectRgba(buf, size, startX + c * scale, startY + r * scale, scale, scale, rgb, 1);
          }
        }
      }
    }
    startX += charW;
  }
}

function drawSparklineRgba(buf, size, history, x, y, w, h, rgb) {
  if (!Array.isArray(history) || history.length < 2) return;
  const vals = history.slice(-16).map((v) => Number(v) || 0);
  let min = Math.min(...vals);
  let max = Math.max(...vals);
  if (max - min < 1) { min -= 1; max += 1; }
  for (let px = 0; px < w; px++) {
    const pos = (px / Math.max(1, w - 1)) * (vals.length - 1);
    const i0 = Math.floor(pos);
    const i1 = Math.min(vals.length - 1, i0 + 1);
    const frac = pos - i0;
    const val = vals[i0] + (vals[i1] - vals[i0]) * frac;
    const py = Math.round(y + h - ((val - min) / (max - min)) * h);
    fillRectRgba(buf, size, x + px, py, 2, 2, rgb, 0.95);
    if (py + 2 < y + h) {
      fillRectRgba(buf, size, x + px, py + 2, 1, (y + h) - (py + 2), rgb, 0.22);
    }
  }
}

function blitDataUrlIcon(buf, size, dataUrl, iconScalePct = 62, offsetX = 0, offsetY = -4) {
  if (!nativeImage || !dataUrl || !String(dataUrl).startsWith('data:image/')) return false;
  try {
    const img = nativeImage.createFromDataURL(dataUrl);
    if (!img || img.isEmpty()) return false;
    const targetDim = Math.max(20, Math.min(size - 8, Math.round((size * (Number(iconScalePct) || 62)) / 100)));
    const resized = img.resize({ width: targetDim, height: targetDim, quality: 'good' });
    const bmp = resized.toBitmap();
    const rSize = resized.getSize();
    const ox = Math.round((size - rSize.width) / 2 + (Number(offsetX) || 0));
    const oy = Math.round((size - rSize.height) / 2 + (Number(offsetY) || 0));
    for (let y = 0; y < rSize.height; y++) {
      const dy = oy + y;
      if (dy < 0 || dy >= size) continue;
      for (let x = 0; x < rSize.width; x++) {
        const dx = ox + x;
        if (dx < 0 || dx >= size) continue;
        const sIdx = (y * rSize.width + x) * 4;
        const a = bmp[sIdx + 3] / 255;
        if (a <= 0.02) continue;
        const b = bmp[sIdx];
        const g = bmp[sIdx + 1];
        const r = bmp[sIdx + 2];
        const dIdx = (dy * size + dx) * 4;
        buf[dIdx] = Math.round(buf[dIdx] * (1 - a) + r * a);
        buf[dIdx + 1] = Math.round(buf[dIdx + 1] * (1 - a) + g * a);
        buf[dIdx + 2] = Math.round(buf[dIdx + 2] * (1 - a) + b * a);
      }
    }
    return true;
  } catch (_) {
    return false;
  }
}

function rotateRgbaBuffer(src, size, rotMode = 'ccw') {
  if (!rotMode || rotMode === 'none') return src;
  const dst = Buffer.alloc(src.length);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let nx = x, ny = y;
      if (rotMode === 'ccw') {
        nx = y;
        ny = size - 1 - x;
      } else if (rotMode === 'cw') {
        nx = size - 1 - y;
        ny = x;
      } else if (rotMode === '180') {
        nx = size - 1 - x;
        ny = size - 1 - y;
      }
      const sIdx = (y * size + x) * 4;
      const dIdx = (ny * size + nx) * 4;
      dst[dIdx] = src[sIdx];
      dst[dIdx + 1] = src[sIdx + 1];
      dst[dIdx + 2] = src[sIdx + 2];
      dst[dIdx + 3] = 255;
    }
  }
  return dst;
}

async function renderKeyModelToJpegBase64(model, size = 96, rotMode = 'ccw', NativeInput = null) {
  if (NativeInput && typeof NativeInput.renderTileJpeg === 'function') {
    try {
      const b64 = await NativeInput.renderTileJpeg({
        size,
        rotMode,
        bgColor: model.bgColor || '#1e293b',
        bgColor2: model.color2 || '',
        title: model.hideTitle ? '' : (model.title || ''),
        bigText: model.dynamicGlyph || '',
        badgeText: (model.badge && model.badge.text) || '',
        badgeBg: (model.badge && model.badge.bg) || '#107c41',
        iconDataUrl: model.icon || '',
        iconScale: model.iconScale || 62,
        progressPct: -1,
      });
      if (b64 && b64.length > 64) return b64;
    } catch (_) {}
  }

  const rgba = createRgbaSurface(size, model.bgColor || '#1e293b', model.color2 || '');
  if (model.icon) {
    blitDataUrlIcon(rgba, size, model.icon, model.iconScale || 62, model.offsetX || 0, model.hideTitle ? 0 : -6);
  }
  if (model.badge && model.badge.text) {
    const bRgb = parseHexColor(model.badge.bg, [16, 124, 65]);
    fillRectRgba(rgba, size, size - 36, 4, 32, 14, bRgb, 0.95);
    drawMiniText(rgba, size, model.badge.text, size - 20, 11, 1, [255, 255, 255]);
  }
  const rotated = rotateRgbaBuffer(rgba, size, rotMode);
  const encoded = jpeg.encode({ data: rotated, width: size, height: size }, 90);
  return encoded.data.toString('base64');
}

async function renderStripModelToJpegBase64(stripModel, size = 80, rotMode = 'ccw', NativeInput = null) {
  if (NativeInput && typeof NativeInput.renderTileJpeg === 'function') {
    try {
      const b64 = await NativeInput.renderTileJpeg({
        size,
        rotMode,
        bgColor: stripModel.bgColor || '#1e293b',
        bgColor2: '',
        title: stripModel.subText || '',
        topText: stripModel.topText || '',
        bigText: stripModel.mainText || '',
        accentColor: stripModel.accent || '#38bdf8',
        progressPct: typeof stripModel.progressPct === 'number' ? stripModel.progressPct : -1,
        history: Array.isArray(stripModel.history) ? stripModel.history.slice(-16) : null,
      });
      if (b64 && b64.length > 64) return b64;
    } catch (_) {}
  }

  const rgba = createRgbaSurface(size, stripModel.bgColor || '#1e293b');
  const accentRgb = parseHexColor(stripModel.accent || '#38bdf8', [56, 189, 248]);
  if (Array.isArray(stripModel.history) && stripModel.history.length > 1) {
    drawSparklineRgba(rgba, size, stripModel.history, 6, Math.round(size * 0.52), size - 12, Math.round(size * 0.36), accentRgb);
  }
  if (stripModel.topText) {
    drawMiniText(rgba, size, stripModel.topText, size / 2, 13, 1, accentRgb);
  }
  if (stripModel.mainText) {
    drawMiniText(rgba, size, stripModel.mainText, size / 2, Math.round(size * 0.46), 2, [255, 255, 255]);
  }
  if (typeof stripModel.progressPct === 'number' && stripModel.progressPct >= 0) {
    const pw = size - 14;
    fillRectRgba(rgba, size, 7, size - 10, pw, 4, [255, 255, 255], 0.18);
    fillRectRgba(rgba, size, 7, size - 10, Math.round((pw * Math.max(3, Math.min(100, stripModel.progressPct))) / 100), 4, accentRgb, 0.95);
  }
  const rotated = rotateRgbaBuffer(rgba, size, rotMode);
  const encoded = jpeg.encode({ data: rotated, width: size, height: size }, 90);
  return encoded.data.toString('base64');
}

async function pushHeadlessDirtyFrames({ page, strips, runtimeStore, rotMode = 'ccw', NativeInput = null, sendDraw, sendBatchDraw, force = false }) {
  if (!page || !runtimeStore) return { drawn: 0 };
  const items = [];
  const buttons = page.buttons || {};

  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 5; c++) {
      const spec = buttons[`${r},${c}`];
      if (!spec) continue;
      const keyRt = runtimeStore.getKeyState(page.id, r, c);
      const model = computeRenderModel(spec, keyRt, runtimeStore.globalState);
      const hashKey = `${page.id}:${r},${c}`;
      if (force || runtimeStore.checkAndMarkDirty(hashKey, model.visualHash)) {
        const b64 = await renderKeyModelToJpegBase64(model, 96, rotMode, NativeInput);
        items.push({ row: r, col: c, data: b64, force: !!force });
      }
    }
  }

  const effectiveStrips = strips || page.strips || {};
  for (let r = 0; r < 3; r++) {
    const s = effectiveStrips[String(r)];
    const stripModel = computeStripRenderModel(s, r, runtimeStore.globalState, '1/1');
    const hashKey = `strip:${page.id}:${r}`;
    if (force || runtimeStore.checkAndMarkDirty(hashKey, stripModel.visualHash)) {
      const b64 = await renderStripModelToJpegBase64(stripModel, 80, rotMode, NativeInput);
      items.push({ row: r, col: 5, data: b64, force: !!force });
    }
  }

  if (items.length > 0) {
    runtimeStore.globalState.headlessStats.framesRendered += items.length;
    runtimeStore.globalState.headlessStats.lastRenderAt = Date.now();
    if (items.length === 1 && sendDraw) {
      await sendDraw(items[0]);
    } else if (sendBatchDraw) {
      await sendBatchDraw({ items, full: !!force, epoch: Date.now() });
    }
  } else {
    runtimeStore.globalState.headlessStats.savedIpcCount += 1;
  }
  return { drawn: items.length };
}

module.exports = {
  renderKeyModelToJpegBase64,
  renderStripModelToJpegBase64,
  pushHeadlessDirtyFrames,
};
