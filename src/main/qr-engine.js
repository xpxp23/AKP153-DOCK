'use strict';
/**
 * AKP153 二维码智能解码引擎 (v0.8.0)
 * 支持：剪贴板优先秒解 -> 交互式半透明屏幕框选 -> 全屏扫描 -> 自动静默区白边增强识别 -> 自动回写剪贴板并触发原生提示音
 */
const { clipboard, desktopCapturer, screen, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const jsQR = require('jsqr');
const NativeInput = require('./native-input');

/**
 * 为 RGBA 图像矩阵四周补白边（Quiet Zone），解决紧贴深色背景或截图裁切过紧导致 jsQR 无法定位 Finder Pattern 的问题
 */
function padRgbaWithWhite(rgba, width, height, pad = 16) {
  const nw = width + pad * 2;
  const nh = height + pad * 2;
  const out = new Uint8ClampedArray(nw * nh * 4);
  out.fill(255);
  for (let y = 0; y < height; y++) {
    const srcOff = y * width * 4;
    const dstOff = ((y + pad) * nw + pad) * 4;
    out.set(rgba.subarray(srcOff, srcOff + width * 4), dstOff);
  }
  return { data: out, width: nw, height: nh };
}

/**
 * 将 Electron nativeImage 转换为 RGBA 像素矩阵并用 jsQR 进行多策略解码
 */
function decodeNativeImage(nativeImg) {
  if (!nativeImg || nativeImg.isEmpty()) return null;
  const size = nativeImg.getSize();
  if (size.width < 10 || size.height < 10) return null;

  // 1. 优先尝试极速 raw bitmap (Windows 上通常为 32 位 BGRA)
  try {
    const buf = nativeImg.toBitmap();
    const len = buf.length;
    const rgba = new Uint8ClampedArray(len);
    for (let i = 0; i < len; i += 4) {
      rgba[i] = buf[i + 2];     // R
      rgba[i + 1] = buf[i + 1]; // G
      rgba[i + 2] = buf[i];     // B
      rgba[i + 3] = buf[i + 3]; // A
    }
    const res = jsQR(rgba, size.width, size.height, { inversionAttempts: 'attemptBoth' });
    if (res && res.data) return res.data;

    // 1b. 若框选紧贴二维码边缘，自动补充 16px 白色静默区再试一次
    if (size.width <= 1200 && size.height <= 1200) {
      const padded = padRgbaWithWhite(rgba, size.width, size.height, 16);
      const resPad = jsQR(padded.data, padded.width, padded.height, { inversionAttempts: 'attemptBoth' });
      if (resPad && resPad.data) return resPad.data;
    }
  } catch (_) {}

  // 2. 备用兜底：通过 jpeg-js 标准解码
  try {
    const jpeg = require('jpeg-js');
    const raw = jpeg.decode(nativeImg.toJPEG(95), { useTArray: true });
    const res = jsQR(raw.data, raw.width, raw.height, { inversionAttempts: 'attemptBoth' });
    if (res && res.data) return res.data;
  } catch (_) {}

  return null;
}

/**
 * 检查系统剪贴板是否有图片，若有且存在二维码直接解码返回
 */
function decodeClipboard() {
  try {
    const img = clipboard.readImage();
    if (!img || img.isEmpty()) return null;
    return decodeNativeImage(img);
  } catch (_) {
    return null;
  }
}

let activeOverlay = null;

/**
 * 唤起半透明遮罩进行区域框选截图并解码
 */
async function interactiveSnip() {
  if (activeOverlay) {
    try { activeOverlay.close(); } catch (_) {}
    activeOverlay = null;
  }

  const cursorPt = screen.getCursorScreenPoint();
  const display = screen.getDisplayNearestPoint(cursorPt);
  const scale = display.scaleFactor || 1;
  const captureW = Math.round(display.bounds.width * scale);
  const captureH = Math.round(display.bounds.height * scale);

  let fullScreenshot = null;
  try {
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: captureW, height: captureH }
    });
    let matched = sources.find((s) => String(s.display_id) === String(display.id));
    if (!matched) matched = sources[0];
    if (matched && matched.thumbnail) fullScreenshot = matched.thumbnail;
  } catch (err) {
    // 截屏异常
  }

  return new Promise((resolve) => {
    let settled = false;
    const finish = (val) => {
      if (settled) return;
      settled = true;
      ipcMain.removeListener('snip:selected', onSelected);
      ipcMain.removeListener('snip:fullscreen', onFullscreen);
      ipcMain.removeListener('snip:cancel', onCancel);
      if (activeOverlay) {
        try { activeOverlay.close(); } catch (_) {}
        activeOverlay = null;
      }
      resolve(val);
    };

    const onSelected = (e, { x, y, width, height }) => {
      if (!fullScreenshot) return finish(null);
      try {
        const cropX = Math.max(0, Math.min(captureW - 1, Math.round(x * scale)));
        const cropY = Math.max(0, Math.min(captureH - 1, Math.round(y * scale)));
        const cropW = Math.max(1, Math.min(captureW - cropX, Math.round(width * scale)));
        const cropH = Math.max(1, Math.min(captureH - cropY, Math.round(height * scale)));
        const cropped = fullScreenshot.crop({ x: cropX, y: cropY, width: cropW, height: cropH });
        const text = decodeNativeImage(cropped);
        finish(text);
      } catch (err) {
        finish(null);
      }
    };

    const onFullscreen = () => {
      if (!fullScreenshot) return finish(null);
      const text = decodeNativeImage(fullScreenshot);
      finish(text);
    };

    const onCancel = () => {
      finish(null);
    };

    ipcMain.once('snip:selected', onSelected);
    ipcMain.once('snip:fullscreen', onFullscreen);
    ipcMain.once('snip:cancel', onCancel);

    activeOverlay = new BrowserWindow({
      x: display.bounds.x,
      y: display.bounds.y,
      width: display.bounds.width,
      height: display.bounds.height,
      transparent: true,
      frame: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      movable: false,
      hasShadow: false,
      enableLargerThanScreen: true,
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false
      }
    });

    activeOverlay.loadFile(path.join(__dirname, '..', 'renderer', 'snip-overlay.html'));

    activeOverlay.on('closed', () => {
      finish(null);
    });
  });
}

function playBeep(success) {
  try {
    if (success && shell && typeof shell.beep === 'function') {
      shell.beep();
      return;
    }
    NativeInput.beep(!!success).catch(() => {});
  } catch (_) {}
}

/**
 * 核心对外入口：三合一智能解码流水线
 */
async function runDecode() {
  // 第 1 步：优先检测剪贴板
  const clipText = decodeClipboard();
  if (clipText) {
    clipboard.writeText(clipText);
    playBeep(true);
    return { ok: true, text: clipText, source: 'clipboard' };
  }

  // 第 2 步：剪贴板无图，唤起交互式框选
  const snipRes = await interactiveSnip();
  if (snipRes === null) {
    return { ok: false, error: 'CANCELLED' };
  }
  if (snipRes) {
    clipboard.writeText(snipRes);
    playBeep(true);
    return { ok: true, text: snipRes, source: 'screen' };
  }

  playBeep(false);
  return { ok: false, error: 'NO_QR_FOUND' };
}

module.exports = {
  decodeNativeImage,
  decodeClipboard,
  interactiveSnip,
  runDecode
};
