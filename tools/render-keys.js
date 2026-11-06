// 把「真机将要收到的按键画面」逐格渲染成 PNG 并拼成一张对照图。
// 用来在没有实物相机的情况下验证 paintKey 的满格/cover/圆角/描边改动。
//
//   node_modules/.bin/electron tools/render-keys.js [输出目录]
//
// 原理：以 DEMO 模式加载真实 index.html（无 preload），再把 config.json 注入全局 cfg，
// 直接调用渲染层同一个 paintKey()，所以像素结果和推给设备的完全一致。
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const OUT = process.argv[2] || path.join(__dirname, '..', 'logs', 'key-render');
const HTML = path.join(__dirname, '..', 'src', 'renderer', 'index.html');
const CFG = path.join(__dirname, '..', 'config.json');

app.disableHardwareAcceleration();
app.on('window-all-closed', () => {});

function writeDataUrl(file, dataUrl) {
  const b64 = String(dataUrl).split(',')[1] || '';
  fs.writeFileSync(file, Buffer.from(b64, 'base64'));
}

app.whenReady().then(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const win = new BrowserWindow({
    width: 1280, height: 860, show: true, opacity: 0, skipTaskbar: true,
    webPreferences: { offscreen: false, backgroundThrottling: false },
  });
  await win.loadFile(HTML);
  await new Promise((r) => setTimeout(r, 1500));

  const raw = JSON.parse(fs.readFileSync(CFG, 'utf8'));

  // 复刻 src/main/config.js 的 @icon: 水合逻辑 —— 少了这一步所有图标都会是空的
  const store = raw.iconStore || {};
  const hydrate = (obj) => {
    if (!obj || typeof obj !== 'object') return;
    for (const k of ['icon', 'icon2']) {
      if (typeof obj[k] === 'string' && obj[k].startsWith('@icon:')) {
        const ref = obj[k].slice(6);
        if (store[ref]) obj[k] = store[ref];
      }
    }
    if (obj.action2 && typeof obj.action2 === 'object') hydrate(obj.action2);
  };

  // 只把渲染需要的字段递进去，避免 800KB+ 的图标库拖慢 evaluate
  const pages = raw.pages.map((p) => {
    for (const b of Object.values(p.buttons || {})) hydrate(b);
    return {
      id: p.id, name: p.name, parent: p.parent, gradient: p.gradient,
      buttons: p.buttons, strips: p.strips, stripPanorama: p.stripPanorama,
    };
  });
  const injected = {
    ...raw,
    pages,
    currentProfile: raw.currentProfile,
  };

  const shots = await win.webContents.executeJavaScript(`
    (async () => {
      cfg = ${JSON.stringify(injected)};
      const out = [];
      const ROWS = 3, KEY_COLS = 5;
      for (const page of cfg.pages) {
        if (!page.buttons || !Object.keys(page.buttons).length) continue;
        cfg.currentPage = page.id;
        const cells = [];
        for (let r = 0; r < ROWS; r++) {
          for (let c = 0; c < KEY_COLS; c++) {
            const spec = page.buttons[r + ',' + c];
            const blank = { color: '#20262e', label: '' };
            const cv = await paintKey(spec || blank, 96, { row: r, col: c });
            cells.push({ r, c, spec: spec || null, png: cv.toDataURL('image/png') });
          }
        }
        out.push({ pageId: page.id, pageName: page.name, cells });
      }
      return out;
    })()
  `, true);

  const manifest = [];
  for (const page of shots) {
    const dir = path.join(OUT, page.pageId);
    fs.mkdirSync(dir, { recursive: true });
    for (const cell of page.cells) {
      const file = path.join(dir, `r${cell.r}c${cell.c}.png`);
      writeDataUrl(file, cell.png);
      manifest.push({
        page: page.pageName,
        row: cell.r,
        col: cell.c,
        label: cell.spec && cell.spec.label,
        iconScale: cell.spec && cell.spec.iconScale,
        hasIcon: !!(cell.spec && cell.spec.icon),
        textIcon: !!(cell.spec && cell.spec.textIconConfig),
        file,
      });
    }
  }

  // 每页拼一张 5×3 对照图（格子间留 10px 黑缝，模拟真机面板）
  const montage = await win.webContents.executeJavaScript(`
    (async () => {
      const shots = ${JSON.stringify(shots.map((p) => ({ pageId: p.pageId, cells: p.cells.map((c) => ({ r: c.r, c: c.c, png: c.png })) })))};
      const out = [];
      for (const p of shots) {
        const S = 96, G = 10, PAD = 10;
        const W = PAD * 2 + 5 * S + 4 * G;
        const H = PAD * 2 + 3 * S + 2 * G;
        const cv = document.createElement('canvas');
        cv.width = W; cv.height = H;
        const ctx = cv.getContext('2d');
        ctx.fillStyle = '#0b0d10'; ctx.fillRect(0, 0, W, H);
        for (const cell of p.cells) {
          const img = new Image();
          await new Promise((res) => { img.onload = res; img.onerror = res; img.src = cell.png; });
          ctx.drawImage(img, PAD + cell.c * (S + G), PAD + cell.r * (S + G), S, S);
        }
        out.push({ pageId: p.pageId, png: cv.toDataURL('image/png') });
      }
      return out;
    })()
  `, true);
  for (const m of montage) writeDataUrl(path.join(OUT, `page-${m.pageId}.png`), m.png);

  fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 1));
  console.log(`rendered ${manifest.length} keys -> ${OUT}`);
  app.quit();
}).catch((e) => {
  console.error('render failed:', e && e.stack || e);
  app.quit();
  process.exitCode = 1;
});
