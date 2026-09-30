const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, shell, dialog, screen, globalShortcut } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn, spawnSync } = require('child_process');
const os = require('os');

const config = require('./config.js');
const runner = require('./runner.js');

runner.setLoopStateListener((keyId, isRunning, context) => {
  broadcast('macro:loopState', { keyId, isRunning, context });
  broadcast('device:repaint', {});
});

// Anything that would otherwise vanish into nowhere gets written here.
const LOG_DIR = path.join(__dirname, '..', '..', 'logs');
try { require('fs').mkdirSync(LOG_DIR, { recursive: true }); } catch (e) { /* ignore */ }
const LOG_FILE = path.join(LOG_DIR, 'main.log');
function log(...args) {
  const line = `[${new Date().toISOString()}] ${args.map((a) => (a && a.stack) || String(a)).join(' ')}\n`;
  try { require('fs').appendFileSync(LOG_FILE, line, 'utf8'); } catch (e) { /* ignore */ }
}
process.on('uncaughtException', (e) => log('UNCAUGHT', e));
process.on('unhandledRejection', (e) => log('UNHANDLED', e));

// Launched with --startup (autologin): boot straight to the tray, no window.
const STARTUP = process.argv.includes('--startup');

let tray = null;
let win = null;
let host = null;
let hostReady = false;
let hostError = null;
let rpcId = 0;
const pending = new Map();
let idleTimer = null;
let lastActivity = Date.now();
let deviceAsleep = false;
let lastWakeTime = 0;


// ------------------------------------------------------------ device host rpc

function hostScript() {
  return path.join(__dirname, '..', '..', 'host', 'device-host.js');
}

function spawnHost() {
  const candidates = [
    process.env.AKP153_NODE,
    'node',
    'C:\\Program Files\\nodejs\\node.exe',
    process.execPath, // Fallback to Electron's built-in Node.js runtime
  ].filter(Boolean);

  let idx = 0;
  const tryNext = () => {
    if (idx >= candidates.length) {
      hostError = 'NODE_NOT_FOUND';
      notify('未找到可用 Node 运行环境，无法驱动设备');
      return;
    }
    const exe = candidates[idx++];
    let child;
    try {
      const isElectron = exe === process.execPath || exe.toLowerCase().endsWith('electron.exe');
      const env = isElectron ? Object.assign({}, process.env, { ELECTRON_RUN_AS_NODE: '1' }) : process.env;
      child = spawn(exe, [hostScript()], { env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    } catch (e) {
      tryNext();
      return;
    }
    child.on('error', () => { tryNext(); });
    child.on('exit', () => {
      hostReady = false;
      if (host === child) {
        host = null;
        broadcast('host:status', { ready: false, error: 'HOST_EXITED' });
        setTimeout(spawnHost, 2000);
      }
    });

    let buf = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      buf += chunk;
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        let msg;
        try { msg = JSON.parse(line); } catch (e) { continue; }
        if (msg.event === 'ready') {
          host = child;
          hostReady = true;
          hostError = null;
          log('device host ready');
          broadcast('host:status', { ready: true });
          openDevice();
        } else if (msg.event === 'down') {
          onKeyDown(msg.row, msg.col);
        } else if (msg.event === 'wake') {
          onWakeByKey(msg.row, msg.col);
        } else if (msg.event === 'lost') {
          log('device lost:', msg.message);
          hostError = 'DEVICE_LOST';
          broadcast('host:status', { ready: true, device: false, error: 'DEVICE_LOST' });
        } else if (msg.event === 'opened') {
          log('device reopened by watchdog:', msg.path, 'asleep=' + !!msg.asleep);
          hostError = null;
          deviceAsleep = !!msg.asleep;
          broadcast('host:status', { ready: true, device: true, error: null });
          if (!deviceAsleep) repaintSoon();
        } else if (msg.event === 'error') {
          broadcast('host:status', { ready: hostReady, error: msg.message });
        } else if (msg.id !== undefined) {
          const res = pending.get(msg.id);
          if (res) { pending.delete(msg.id); msg.ok ? res.resolve(msg) : res.reject(new Error(msg.error)); }
        }
      }
    });
    child.stderr.on('data', (d) => log('host stderr:', String(d).trim()));
  };
  tryNext();
}

function rpc(cmd, args) {
  return new Promise((resolve, reject) => {
    if (!host || !hostReady) return reject(new Error('HOST_NOT_READY'));
    const id = ++rpcId;
    pending.set(id, { resolve, reject });
    host.stdin.write(JSON.stringify(Object.assign({ id, cmd }, args || {})) + '\n');
    setTimeout(() => {
      if (pending.has(id)) { pending.delete(id); reject(new Error('TIMEOUT')); }
    }, 8000);
  });
}

function broadcast(channel, payload) {
  if (win && win.webContents) win.webContents.send(channel, payload);
}

function notify(msg) {
  log('notify:', msg);
  broadcast('toast', { message: msg });
}

async function safeRpc(cmd, args) {
  try { return await rpc(cmd, args); } catch (e) { return { ok: false, error: e.message }; }
}

// The renderer may still be loading (or mid-repaint) when we learn the device
// is ready, so ask for a few repaints instead of just one.
function repaintSoon() {
  broadcast('device:repaint', {});
  setTimeout(() => broadcast('device:repaint', {}), 1200);
  setTimeout(() => broadcast('device:repaint', {}), 4000);
}

async function doSleep() {
  const r = await safeRpc('sleep', { mode: config.load().sleepMode || 'vendor' });
  deviceAsleep = true;
  log('sleep:', JSON.stringify((r && r.report) || r));
  return r;
}

async function doWake() {
  const r = await safeRpc('wake', { brightness: config.load().brightness, force: true });
  deviceAsleep = false;
  lastWakeTime = Date.now();
  lastActivity = Date.now();
  log('wake:', JSON.stringify(r));
  repaintSoon();
  return r;
}


async function openDevice(hard) {
  const r = await safeRpc('open', {});
  if (r && r.ok === false) {
    if (r.error === 'DEVICE_BUSY') {
      hostError = 'DEVICE_BUSY';
      notify('设备被占用 —— 请先完全退出 Companion（托盘图标右键退出），然后点这里重连');
    } else if (r.error === 'DEVICE_NOT_FOUND') {
      hostError = 'DEVICE_NOT_FOUND';
      notify('没找到 AKP153 —— 检查 USB 连接');
    } else {
      hostError = r.error;
      notify('设备打开失败：' + r.error);
    }
    broadcast('host:status', { ready: true, device: false, error: hostError });
    return false;
  }
  log('device opened OK' + (hard ? ' (hard reset)' : ''));
  const cfg = config.load();
  // Force the wake sequence: a previous owner may have left the panel asleep,
  // in which case writes land in LCD RAM but the screen stays dark.
  if (hard) {
    // Re-plug can leave the panel powered up but blank - do a full sleep/wake
    // cycle so the controller re-initialises its LCD pipeline.
    await safeRpc('reset', { brightness: cfg.brightness });
  } else {
    await safeRpc('wake', { brightness: cfg.brightness, force: true });
  }
  await safeRpc('brightness', { value: cfg.brightness });
  hostError = null;
  deviceAsleep = false;
  broadcast('host:status', { ready: true, device: true, error: null });
  repaintSoon();
  return true;
}

// -------------------------------------------------------------- key handling

/** Sub pages grow an automatic back key in the bottom-right corner, so you can
 *  always leave a folder with the same muscle memory. Any key configured there
 *  is temporarily shadowed and comes back when you leave the sub page. */
const BACK_ROW = 2, BACK_COL = 4;

function pageById(id) {
  return config.load().pages.find((p) => p.id === id) || null;
}

/** Resolve a `{type:'page', mode}` action to a target page id, or null.
 *
 *  下一页 / 上一页 walk TOP-LEVEL pages only. Walking the whole depth-first
 *  tree would make "next page" dive into a folder, which is not what anyone
 *  means by page turning - sub pages are entered through their own key. */
function resolvePageAction(spec, page) {
  const cfg = config.load();
  const tops = cfg.pages.filter((p) => !p.parent);
  const idx = tops.findIndex((p) => p.id === page.id);
  switch (spec.mode) {
    case 'next': return idx >= 0 && idx + 1 < tops.length ? tops[idx + 1].id : null;
    case 'prev': return idx > 0 ? tops[idx - 1].id : null;
    case 'up': return page.parent || null;
    case 'home': return tops.length ? tops[0].id : null;
    case 'goto': return cfg.pages.some((p) => p.id === spec.pageId) ? spec.pageId : null;
    default: return null;
  }
}

async function goToPage(id, why) {
  const cfg = config.load();
  if (!id) return false;
  const target = cfg.pages.find((p) => p.id === id);
  if (!target) return false;
  if (cfg.currentPage === id) return true;
  cfg.currentPage = id;
  config.save(cfg);
  log(`page -> 「${target.name}」${target.parent ? ' (子页)' : ''}${why ? '  via ' + why : ''}`);
  // The renderer owns drawing; it reloads config and repaints everything.
  broadcast('page:changed', { pageId: id });
  return true;
}

function onWakeByKey(row, col) {
  deviceAsleep = false;
  lastWakeTime = Date.now();
  lastActivity = Date.now();
  broadcast('key:flash', { row, col });
  repaintSoon();
  log(`device woke up by key r${row}c${col} (wake only)`);
}

async function onKeyDown(row, col) {
  const now = Date.now();
  lastActivity = now;

  // Pressing a key while asleep should only light the panel back up, never execute actions.
  // We also enforce a cooldown window to prevent rapid chatter/chatter double-triggering.
  const cfgNow = config.load();
  const cooldown = (cfgNow.keyDebounceMs !== undefined) ? cfgNow.keyDebounceMs : 100;
  if (deviceAsleep || (now - lastWakeTime < cooldown)) {
    if (deviceAsleep) {
      deviceAsleep = false;
      lastWakeTime = now;
      await safeRpc('wake', { brightness: cfgNow.brightness, force: true });
      repaintSoon();
      broadcast('key:flash', { row, col });
      log(`key r${row}c${col} pressed while asleep -> woke panel, action suppressed`);
    } else {
      log(`key r${row}c${col} suppressed (within ${cooldown}ms wake cooldown)`);
    }
    return;
  }

  const page = config.currentPage();
  broadcast('key:flash', { row, col });


  // automatic back key on sub pages - checked before the normal lookup so it
  // cannot be shadowed by whatever the user parked in that corner
  if (page.parent && row === BACK_ROW && col === BACK_COL) {
    log(`key r${row}c${col} -> 返回上级 (from 「${page.name}」)`);
    await goToPage(page.parent, 'back key');
    return;
  }

  const spec = page.buttons[row + ',' + col];

  // Page switching is handled here, not in runner.js: the runner runs things,
  // it has no business knowing about pages. This must come before the
  // "not configured" check - page actions carry no target on purpose.
  if (spec && spec.type === 'page') {
    const target = resolvePageAction(spec, page);
    if (!target) {
      log(`key r${row}c${col} -> page ${spec.mode} 无可用目标`);
      notify('这个切页键现在没有可去的页面');
      return;
    }
    await goToPage(target, `key r${row}c${col} (${spec.mode})`);
    return;
  }

  const isMulti = spec && (spec.type === 'multi' || spec.type === 'macro');
  const isQr = spec && (spec.type === 'qr_decode' || spec.type === 'qr');
  if (!spec || (!spec.target && !spec.hotkey && !isMulti && !isQr)) {
    log(`key r${row}c${col} pressed - NOT CONFIGURED`);
    // Show it on the device too: the user is looking at the panel, not the PC.
    broadcast('key:unconfigured', { row, col });
    notify(`r${row}c${col} 这个键还没配置 —— 在窗口里把程序拖到对应格子`);
    return;
  }

  let actionToRun = spec;
  if (spec.badgeToggle) {
    const curState = spec._activeState !== undefined ? spec._activeState : (spec.badgeInitialState || 0);
    if (spec.toggleAction && spec.action2 && (spec.action2.target || spec.action2.hotkey) && curState === 1) {
      actionToRun = spec.action2;
    }
    const nextState = (curState === 1 ? 0 : 1);
    spec._activeState = nextState;
    broadcast('key:toggleState', { pageId: page.id, row, col, activeState: nextState });
  }

  const actMulti = actionToRun && (actionToRun.type === 'multi' || actionToRun.type === 'macro');
  log(`key r${row}c${col} -> ${actionToRun.type} ${actMulti ? 'Macro (' + ((actionToRun.actions && actionToRun.actions.length) || 0) + ' actions)' : (actionToRun.target || actionToRun.hotkey || '')}`);
  const res = await runner.run(actionToRun, { row, col, pageId: page.id });
  const what = res.ok ? 'ok' + (res.action ? ` (${res.action})` : '') : 'FAILED ' + res.error;
  log(`  result: ${what}`);
  if (isQr) {
    if (res.error !== 'CANCELLED') {
      broadcast('key:result', { row, col, success: !!res.ok, text: res.text || '' });
      if (res.ok) {
        notify('已解码并写入剪贴板：' + (res.text && res.text.length > 40 ? res.text.slice(0, 40) + '...' : (res.text || '')));
      } else {
        notify('未检测到有效二维码');
      }
    }
  } else if (!res.ok && res.error !== 'BUSY') {
    notify('启动失败：' + res.error);
  }
}

function resetIdleTimer() {
  if (idleTimer) clearInterval(idleTimer);
  const cfg = config.load();
  const minutes = Number(cfg.idleSleepMinutes || 0);
  if (!minutes) return;
  idleTimer = setInterval(() => {
    const idleMs = Date.now() - lastActivity;
    if (idleMs > minutes * 60 * 1000) {
      doSleep();
      lastActivity = Date.now(); // avoid hammering
    }
  }, 20000);
}

// ------------------------------------------------------------------- window

// ------------------------------------------------------------------- window

/** The layout needs >=1000px: the device panel alone is 6 columns wide and the
 *  inspector must keep ~340px or it collapses into a sliver (that was the
 *  original "UI is unusable" bug - window was 900px, layout needed 1048px). */
const WIN_DEFAULT = { width: 1160, height: 800 };
const WIN_MIN = { width: 1000, height: 660 };

function restoreBounds() {
  const saved = config.load().window;
  const b = Object.assign({}, WIN_DEFAULT);
  if (saved && Number(saved.width) >= WIN_MIN.width && Number(saved.height) >= WIN_MIN.height) {
    b.width = Math.round(saved.width);
    b.height = Math.round(saved.height);
    // Only restore x/y if the window would still be visible on some display.
    if (Number.isInteger(saved.x) && Number.isInteger(saved.y)) {
      const vis = screen.getAllDisplays().some((d) => {
        const w = d.workArea;
        return saved.x < w.x + w.width - 80 && saved.x + b.width > w.x + 80
          && saved.y >= w.y - 8 && saved.y < w.y + w.height - 60;
      });
      if (vis) { b.x = saved.x; b.y = saved.y; }
    }
  }
  return b;
}

function createWindow() {
  const iconPath = path.join(__dirname, '..', '..', 'assets', 'icon.png');
  win = new BrowserWindow(Object.assign(restoreBounds(), {
    minWidth: WIN_MIN.width,
    minHeight: WIN_MIN.height,
    show: false,
    frame: false,
    icon: iconPath,
    backgroundColor: '#eef1f5',
    title: 'AKP153 控制台',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  }));
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  win.on('maximize', () => broadcast('window:max-changed', { maximized: true }));
  win.on('unmaximize', () => broadcast('window:max-changed', { maximized: false }));

  let boundsTimer = null;
  const rememberBounds = () => {
    clearTimeout(boundsTimer);
    boundsTimer = setTimeout(() => {
      if (!win || win.isDestroyed() || win.isMinimized() || win.isMaximized()) return;
      config.set('window', win.getBounds());
    }, 700);
  };
  win.on('resize', rememberBounds);
  win.on('move', rememberBounds);
  win.on('closed', () => { win = null; });
  win.on('hide', () => { /* keep running */ });

  // Removing the application menu also removed its Ctrl+Shift+I accelerator.
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type === 'keyDown' && input.key === 'F12') {
      win.webContents.toggleDevTools();
      e.preventDefault();
    }
  });
}

function createTray() {
  const iconPath = path.join(__dirname, '..', '..', 'assets', 'tray.png');
  tray = new Tray(nativeImage.createFromPath(iconPath));
  tray.setToolTip('AKP153 控制台');
  const menu = Menu.buildFromTemplate([
    { label: '打开配置', click: () => showWindow() },
    { label: '重连设备（插拔 USB 后用这个）', click: () => openDevice(true) },
    { type: 'separator' },
    { label: '休眠屏幕', click: () => doSleep() },
    { label: '唤醒屏幕', click: () => doWake() },
    { type: 'separator' },
    {
      label: '开机自启',
      type: 'checkbox',
      checked: !!config.load().openAtLogin,
      click: (item) => {
        config.set('openAtLogin', item.checked);
        setStartupRegistry(item.checked);
      },
    },
    { label: '打开配置文件', click: () => shell.openPath(config.FILE) },
    { label: '关于', click: () => showWindow() },
    { type: 'separator' },
    { label: '退出', click: () => { if (host) try { host.kill(); } catch (e) {} app.quit(); } },
  ]);
  tray.setContextMenu(menu);
  tray.on('double-click', () => showWindow());
}

function showWindow() {
  if (!win) createWindow();
  win.show();
  win.focus();
}

// --------------------------------------------------------------------- ipc

ipcMain.handle('config:load', () => config.load());
ipcMain.handle('config:save', (e, cfg) => config.save(cfg));
ipcMain.handle('config:get', (e, key) => config.get(key));

const drawStats = { ok: 0, fail: 0, lastError: null };

ipcMain.handle('device:draw', async (e, a) => {
  const r = await safeRpc('draw', a);
  if (r && r.ok === false) {
    drawStats.fail++;
    drawStats.lastError = r.error;
    log(`draw FAILED r${a.row}c${a.col}: ${r.error}`);
  } else {
    drawStats.ok++;
  }
  return r;
});
ipcMain.handle('device:brightness', (e, v) => safeRpc('brightness', { value: v }));
ipcMain.handle('device:sleep', () => doSleep());
ipcMain.handle('device:wake', () => doWake());
ipcMain.handle('device:reconnect', () => openDevice(true));
ipcMain.handle('host:status', () => ({
  ready: hostReady,
  device: !hostError,
  error: hostError,
  draws: Object.assign({}, drawStats),
}));

ipcMain.handle('action:run', (e, spec) => runner.run(spec));
ipcMain.handle('action:classify', (e, p) => runner.classify(p));

function expandEnv(str) {
  if (!str) return '';
  return str.replace(/%([^%]+)%/g, (_, n) => process.env[n] || process.env[n.toUpperCase()] || `%${n}%`);
}

function decodeIni(buf) {
  if (!buf || !buf.length) return '';
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
    return buf.slice(2).toString('utf16le');
  }
  if (buf.length >= 4 && (buf[1] === 0x00 || buf[3] === 0x00)) {
    return buf.toString('utf16le');
  }
  const utf8 = buf.toString('utf8');
  if (utf8.includes('Icon') || utf8.includes('[.ShellClassInfo]')) {
    return utf8;
  }
  return buf.toString('latin1');
}

function extractIconFromResource(filePath, iconIndex = 0) {
  const tmp = path.join(os.tmpdir(), `akp153-res-${Date.now()}-${Math.random().toString(36).slice(2)}.png`);
  const psScript = `
Add-Type -TypeDefinition @"
using System;
using System.Drawing;
using System.Runtime.InteropServices;

public class ResIconExtractor {
    [DllImport("shell32.dll", CharSet = CharSet.Auto)]
    public static extern int ExtractIconEx(string szFileName, int nIconIndex, IntPtr[] phiconLarge, IntPtr[] phiconSmall, int nIcons);

    [DllImport("user32.dll", SetLastError = true)]
    public static extern bool DestroyIcon(IntPtr hIcon);

    public static Bitmap Extract(string file, int index) {
        IntPtr[] large = new IntPtr[1];
        int count = ExtractIconEx(file, index, large, null, 1);
        if (count > 0 && large[0] != IntPtr.Zero) {
            Icon ico = Icon.FromHandle(large[0]);
            Bitmap bmp = ico.ToBitmap();
            DestroyIcon(large[0]);
            return bmp;
        }
        return null;
    }
}
"@ -ReferencedAssemblies System.Drawing

$file = ${JSON.stringify(filePath)}
$idx = ${parseInt(iconIndex, 10) || 0}
$out = ${JSON.stringify(tmp)}

$bmp = [ResIconExtractor]::Extract($file, $idx)
if ($bmp -ne $null) {
    $bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
}
`;

  const b64 = Buffer.from(psScript, 'utf16le').toString('base64');
  spawnSync('powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', b64],
    { windowsHide: true, timeout: 6000 });

  try {
    if (fs.existsSync(tmp)) {
      const buf = fs.readFileSync(tmp);
      fs.unlinkSync(tmp);
      if (buf.length > 0) {
        return 'data:image/png;base64,' + buf.toString('base64');
      }
    }
  } catch (e) {}
  return null;
}

let prevCpus = null;
function getCpuUsage() {
  const cpus = os.cpus();
  if (!prevCpus) {
    prevCpus = cpus;
    return 0;
  }
  let idleDiff = 0, totalDiff = 0;
  for (let i = 0; i < cpus.length; i++) {
    const prev = prevCpus[i].times;
    const curr = cpus[i].times;
    const prevTotal = prev.user + prev.nice + prev.sys + prev.idle + prev.irq;
    const currTotal = curr.user + curr.nice + curr.sys + curr.idle + curr.irq;
    idleDiff += curr.idle - prev.idle;
    totalDiff += currTotal - prevTotal;
  }
  prevCpus = cpus;
  if (totalDiff <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((1 - idleDiff / totalDiff) * 100)));
}

function toSafeDataUrl(nat, maxDim = 1440) {
  if (!nat || nat.isEmpty()) return null;
  const sz = nat.getSize();
  const m = Math.max(sz.width, sz.height);
  if (m > maxDim) {
    const ratio = maxDim / m;
    nat = nat.resize({
      width: Math.max(1, Math.round(sz.width * ratio)),
      height: Math.max(1, Math.round(sz.height * ratio)),
      quality: 'better',
    });
  }
  return nat.toDataURL();
}

async function extractIcon(targetPath) {
  if (!targetPath || typeof targetPath !== 'string') return null;
  const p = path.resolve(targetPath);
  const ext = path.extname(p).toLowerCase();

  // 如果直接是图片/图标文件，优先用 nativeImage 原汁原味加载（超大图自动智能预降采样至 1440px 防卡顿）
  if (['.ico', '.png', '.jpg', '.jpeg', '.webp', '.bmp'].includes(ext) && fs.existsSync(p)) {
    try {
      const nat = nativeImage.createFromPath(p);
      const url = toSafeDataUrl(nat, 1440);
      if (url) return url;
    } catch (_) {}
  }

  // 1. 如果是快捷方式 .lnk，读取真实目标或快捷方式专属图标
  if (ext === '.lnk') {
    try {
      const details = shell.readShortcutLink(p);
      if (details.icon) {
        const iconPath = expandEnv(details.icon);
        if (fs.existsSync(iconPath)) {
          const iconExt = path.extname(iconPath).toLowerCase();
          if (['.ico', '.png', '.jpg', '.jpeg', '.webp'].includes(iconExt)) {
            try {
              const nat = nativeImage.createFromPath(iconPath);
              const url = toSafeDataUrl(nat, 1440);
              if (url) return url;
            } catch (_) {}
          }
          if (iconExt === '.dll' || details.iconIndex) {
            const resIcon = extractIconFromResource(iconPath, details.iconIndex || 0);
            if (resIcon) return resIcon;
          }
          try {
            const img = await app.getFileIcon(iconPath, { size: 'large' });
            if (img && !img.isEmpty()) return img.toDataURL();
          } catch (_) {}
        }
      }
      if (details.target) {
        const tgt = expandEnv(details.target);
        if (fs.existsSync(tgt)) {
          try {
            const img = await app.getFileIcon(tgt, { size: 'large' });
            if (img && !img.isEmpty()) return img.toDataURL();
          } catch (_) {}
        }
      }
    } catch (e) {
      log('readShortcutLink failed for', p, e && e.message);
    }
  }

  // 2. 如果是文件夹，检测是否被用户修改过图标（desktop.ini）
  try {
    const st = fs.statSync(p);
    if (st.isDirectory()) {
      const iniPath = path.join(p, 'desktop.ini');
      if (fs.existsSync(iniPath)) {
        try {
          const rawBuf = fs.readFileSync(iniPath);
          const content = decodeIni(rawBuf);
          let iconPath = '';
          let iconIndex = 0;

          const mRes = content.match(/IconResource\s*=\s*([^\r\n]+)/i);
          if (mRes) {
            const line = mRes[1].trim();
            const commaIdx = line.lastIndexOf(',');
            if (commaIdx > 0) {
              iconPath = line.slice(0, commaIdx).trim().replace(/^["']|["']$/g, '');
              iconIndex = parseInt(line.slice(commaIdx + 1).trim(), 10) || 0;
            } else {
              iconPath = line.replace(/^["']|["']$/g, '');
            }
          } else {
            const mFile = content.match(/IconFile\s*=\s*([^\r\n]+)/i);
            if (mFile) {
              iconPath = mFile[1].trim().replace(/^["']|["']$/g, '');
              const mIdx = content.match(/IconIndex\s*=\s*([-\d]+)/i);
              if (mIdx) iconIndex = parseInt(mIdx[1], 10) || 0;
            }
          }

          if (iconPath) {
            iconPath = expandEnv(iconPath);
            if (!path.isAbsolute(iconPath)) {
              iconPath = path.resolve(p, iconPath);
            }
            if (fs.existsSync(iconPath)) {
              const iconExt = path.extname(iconPath).toLowerCase();
              if (['.ico', '.png', '.jpg', '.jpeg', '.webp'].includes(iconExt)) {
                try {
                  const nat = nativeImage.createFromPath(iconPath);
                  const url = toSafeDataUrl(nat, 1440);
                  if (url) return url;
                } catch (_) {}
              }
              if (iconExt === '.dll' || iconIndex !== 0) {
                const resIcon = extractIconFromResource(iconPath, iconIndex);
                if (resIcon) return resIcon;
              }
              try {
                const img = await app.getFileIcon(iconPath, { size: 'large' });
                if (img && !img.isEmpty()) return img.toDataURL();
              } catch (_) {}
            }
          }
        } catch (e) {
          log('desktop.ini parse failed for', p, e && e.message);
        }
      }
    }
  } catch (_) {}

  // 3. 原生 getFileIcon 兜底
  try {
    const img = await app.getFileIcon(p, { size: 'large' });
    if (img && !img.isEmpty()) return img.toDataURL();
  } catch (err) {
    // ignore
  }

  return null;
}

ipcMain.handle('icon:extract', async (e, p) => {
  try {
    return await extractIcon(p);
  } catch (err) {
    return null;
  }
});

ipcMain.handle('system:stats', () => {
  const cpu = getCpuUsage();
  const total = os.totalmem();
  const free = os.freemem();
  const used = total - free;
  const mem = Math.round((used / total) * 100);
  const memUsedGb = (used / (1024 ** 3)).toFixed(1);
  const memTotalGb = (total / (1024 ** 3)).toFixed(1);
  return { cpu, mem, memUsedGb, memTotalGb };
});

ipcMain.handle('dialog:pick', async (e, opts) => {
  if (!win) return null;
  const opt = opts || { properties: ['openFile'] };
  const res = await dialog.showOpenDialog(win, opt);
  if (res.canceled) return null;
  const isMulti = opt.multiple || (opt.properties && opt.properties.includes('multiSelections'));
  return isMulti ? res.filePaths : res.filePaths[0];
});

ipcMain.handle('macro:getCursor', async () => {
  return await runner.NativeInput.getCursor();
});

ipcMain.handle('macro:stopAll', () => {
  runner.stopAllMacros();
  notify('⚠️ 已中止所有正在运行的宏');
  return { ok: true };
});

ipcMain.handle('macro:activeLoops', () => {
  return Array.from(runner.activeLoops.keys());
});


const REG_RUN = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';
function setStartupRegistry(enable) {
  try {
    spawnSync('reg.exe', ['delete', REG_RUN, '/v', 'electron.app.Electron', '/f'], { windowsHide: true });
  } catch (_) {}

  const keyName = 'AKP153-Dock';
  if (!enable) {
    try {
      spawnSync('reg.exe', ['delete', REG_RUN, '/v', keyName, '/f'], { windowsHide: true });
    } catch (_) {}
    return;
  }

  let cmd = '';
  if (app.isPackaged) {
    cmd = `"${process.execPath}" --startup`;
  } else {
    const rootDir = path.resolve(__dirname, '..', '..');
    cmd = `"${process.execPath}" "${rootDir}" --startup`;
  }
  try {
    spawnSync('reg.exe', ['add', REG_RUN, '/v', keyName, '/t', 'REG_SZ', '/d', cmd, '/f'], { windowsHide: true });
    log('Set startup registry:', keyName, cmd);
  } catch (err) {
    log('Failed to set registry startup:', err && err.message);
  }
}

ipcMain.handle('app:setLogin', (e, v) => {
  config.set('openAtLogin', !!v);
  setStartupRegistry(!!v);
  return true;
});

ipcMain.handle('window:hide', () => { if (win) win.hide(); });
ipcMain.handle('window:minimize', () => { if (win) win.minimize(); });
ipcMain.handle('window:maximize', () => {
  if (!win) return false;
  if (win.isMaximized()) {
    win.unmaximize();
    return false;
  } else {
    win.maximize();
    return true;
  }
});
ipcMain.handle('window:close', () => {
  const cfg = config.load();
  if (cfg.closeToTray === false) {
    app.exit(0);
  } else {
    if (win) win.hide();
  }
});
ipcMain.handle('window:isMaximized', () => (win ? win.isMaximized() : false));

ipcMain.handle('app:openExternal', (e, url) => {
  if (url && (url.startsWith('https://') || url.startsWith('http://'))) {
    shell.openExternal(url);
  }
});

/**
 * 抓取指定网址的高清网站 Favicon 并转换为 96x96 PNG Base64
 * 三级容灾探测策略：
 * 1. 抓取站点 HTML，正则匹配 <link rel="apple-touch-icon" ...> 或 <link rel="icon" ...>
 * 2. 抓取站点根路径 /favicon.ico
 * 3. 备用降级调用高可用镜像 (iowen / duckduckgo / icon.horse)
 */
async function fetchFaviconForUrl(inputUrl) {
  let target = String(inputUrl || '').trim();
  if (!target) return { ok: false, error: '网址不能为空' };
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(target)) {
    target = 'https://' + target.replace(/^\/+/, '');
  }

  let host = '';
  let origin = '';
  try {
    const parsed = new URL(target);
    host = parsed.hostname;
    origin = parsed.origin;
  } catch (err) {
    return { ok: false, error: '无效网址格式' };
  }

  const { net, nativeImage } = require('electron');

  const fetchBuffer = (url, timeoutMs = 4000) => {
    return new Promise((resolve) => {
      let settled = false;
      const done = (val) => { if (!settled) { settled = true; resolve(val); } };
      const timer = setTimeout(() => done(null), timeoutMs);
      try {
        const req = net.request({ url, method: 'GET', redirect: 'follow' });
        req.on('response', (res) => {
          if (res.statusCode < 200 || res.statusCode >= 400) return done(null);
          const chunks = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () => {
            clearTimeout(timer);
            done(Buffer.concat(chunks));
          });
          res.on('error', () => done(null));
        });
        req.on('error', () => done(null));
        req.end();
      } catch (_) {
        done(null);
      }
    });
  };

  const bufferToDataUrl = (buf) => {
    if (!buf || buf.length < 8) return null;
    try {
      const img = nativeImage.createFromBuffer(buf);
      if (img.isEmpty()) return null;
      const resized = img.resize({ width: 96, height: 96, quality: 'best' });
      return resized.toDataURL();
    } catch (_) {
      return null;
    }
  };

  // 1. 第一级：抓取页面 HTML 寻找 <link rel="..."> 高清图标
  try {
    const htmlBuf = await fetchBuffer(target, 3500);
    if (htmlBuf) {
      const html = htmlBuf.toString('utf8', 0, Math.min(htmlBuf.length, 65536));
      let iconHref = '';
      const mTouch = html.match(/<link[^>]+rel=["'][^"']*apple-touch-icon[^"']*["'][^>]+href=["']([^"']+)["']/i) ||
                     html.match(/<link[^>]+href=["']([^"']+)["'][^>]+rel=["'][^"']*apple-touch-icon[^"']*["']/i);
      if (mTouch && mTouch[1]) {
        iconHref = mTouch[1];
      } else {
        const mIcon = html.match(/<link[^>]+rel=["'][^"']*(?:shortcut )?icon[^"']*["'][^>]+href=["']([^"']+)["']/i) ||
                      html.match(/<link[^>]+href=["']([^"']+)["'][^>]+rel=["'][^"']*(?:shortcut )?icon[^"']*["']/i);
        if (mIcon && mIcon[1]) iconHref = mIcon[1];
      }

      if (iconHref) {
        let absIconUrl = '';
        if (/^https?:\/\//i.test(iconHref)) absIconUrl = iconHref;
        else if (iconHref.startsWith('//')) absIconUrl = 'https:' + iconHref;
        else if (iconHref.startsWith('/')) absIconUrl = origin + iconHref;
        else absIconUrl = origin + '/' + iconHref;

        const imgBuf = await fetchBuffer(absIconUrl, 3500);
        const dataUrl = bufferToDataUrl(imgBuf);
        if (dataUrl) return { ok: true, dataUrl, source: 'html' };
      }
    }
  } catch (_) {}

  // 2. 第二级：站点根目录 /favicon.ico
  try {
    const rootIco = await fetchBuffer(`${origin}/favicon.ico`, 3000);
    const dataUrl = bufferToDataUrl(rootIco);
    if (dataUrl) return { ok: true, dataUrl, source: 'root' };
  } catch (_) {}

  // 3. 第三级：高可用镜像解析源
  const mirrors = [
    `https://api.iowen.cn/favicon/${host}.png`,
    `https://icons.duckduckgo.com/ip3/${host}.ico`,
    `https://icon.horse/icon/${host}`,
  ];
  for (const mirrorUrl of mirrors) {
    try {
      const mirrorBuf = await fetchBuffer(mirrorUrl, 3000);
      const dataUrl = bufferToDataUrl(mirrorBuf);
      if (dataUrl) return { ok: true, dataUrl, source: 'mirror' };
    } catch (_) {}
  }

  return { ok: false, error: '未能探测到该网站图标' };
}

ipcMain.handle('app:fetchFavicon', async (e, url) => fetchFaviconForUrl(url));

// ------------------------------------------------------------ config backup & management

ipcMain.handle('config:export', async () => {
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const suggested = `akp153-backup-${ts}.json`;
  const res = await dialog.showSaveDialog(win, {
    title: '导出整机完整配置备份',
    defaultPath: path.join(app.getPath('documents'), suggested),
    filters: [{ name: 'JSON 备份文件', extensions: ['json'] }],
  });
  if (res.canceled || !res.filePath) return { ok: false, canceled: true };
  try {
    const raw = fs.readFileSync(config.FILE, 'utf8');
    fs.writeFileSync(res.filePath, raw, 'utf8');
    log('config backup exported ->', res.filePath);
    return { ok: true, path: res.filePath };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('config:import', async () => {
  const res = await dialog.showOpenDialog(win, {
    title: '导入并恢复配置备份',
    properties: ['openFile'],
    filters: [{ name: 'JSON 备份文件', extensions: ['json'] }],
  });
  if (res.canceled || !res.filePaths[0]) return { ok: false, canceled: true };
  try {
    const text = fs.readFileSync(res.filePaths[0], 'utf8');
    const parsed = JSON.parse(text);
    if (!parsed || (!parsed.pages && !parsed.version)) {
      return { ok: false, error: '该文件不包含有效的 AKP153 控制台配置！' };
    }
    config.save(parsed);
    log('config backup imported from', res.filePaths[0]);
    broadcast('config:external', parsed);
    repaintSoon();
    return { ok: true, path: res.filePaths[0], data: parsed };
  } catch (err) {
    return { ok: false, error: '无法解析备份文件：' + err.message };
  }
});

ipcMain.handle('config:openFolder', async () => {
  try {
    shell.showItemInFolder(config.FILE);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('config:reset', async () => {
  try {
    const def = JSON.parse(JSON.stringify(config.DEFAULTS));
    def.pages = [{
      id: 'p1',
      name: '常用生产力',
      parent: null,
      buttons: {},
      strips: JSON.parse(JSON.stringify(config.DEFAULT_STRIPS)),
    }];
    def.currentPage = 'p1';
    config.save(def);
    broadcast('config:external', def);
    repaintSoon();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// ------------------------------------------------------------ library files

ipcMain.handle('library:export', async (e, a) => {
  const suggested = (a && a.name) || 'akp153-library.json';
  const res = await dialog.showSaveDialog(win, {
    title: '导出按键库',
    defaultPath: path.join(app.getPath('documents'), suggested),
    filters: [{ name: 'JSON', extensions: ['json'] }],
  });
  if (res.canceled || !res.filePath) return { ok: false, canceled: true };
  try {
    fs.writeFileSync(res.filePath, a.json, 'utf8');
    log('library exported ->', res.filePath);
    return { ok: true, path: res.filePath };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('library:import', async () => {
  const res = await dialog.showOpenDialog(win, {
    title: '导入按键库',
    properties: ['openFile'],
    filters: [{ name: 'JSON', extensions: ['json'] }],
  });
  if (res.canceled || !res.filePaths[0]) return { ok: false, canceled: true };
  try {
    const json = JSON.parse(fs.readFileSync(res.filePaths[0], 'utf8'));
    log('library import from', res.filePaths[0]);
    return { ok: true, path: res.filePaths[0], data: json };
  } catch (err) {
    return { ok: false, error: '这个文件不是合法的 JSON：' + err.message };
  }
});

// --------------------------------------------------- config file watching

/**
 * An agent (or you, in a text editor) may rewrite config.json directly.
 * Reload it and redraw, so the device follows along without a restart.
 *
 * Detection is by CONTENT, not by time: config.changedOnDisk() compares the file
 * against the text we last read/wrote.
 *
 * Do NOT go back to "ignore events that arrive soon after our own save" - that
 * heuristic silently broke: the 4s fallback poll would see the mtime our own
 * save() produced, find that >900ms had already passed, and fire a bogus reload
 * every time the user touched anything. Each bogus reload pushes all 18 key
 * images over HID, which makes the panel feel unresponsive for seconds.
 */
function watchConfig() {
  const check = () => {
    let changed = false;
    try { changed = config.changedOnDisk(); } catch (e) { return; }
    if (!changed) return;
    try {
      config.invalidate();
      const cfg = config.load();
      const page = config.currentPage();
      log(`config.json 被外部修改 -> 已重载（当前页「${page.name}」）`);
      broadcast('config:external', { pageId: cfg.currentPage });
      broadcast('device:repaint', {});
    } catch (e) {
      log('外部配置重载失败（文件可能只写了一半）:', e.message);
    }
  };

  const debounce = () => {
    clearTimeout(watchConfig._t);
    watchConfig._t = setTimeout(check, 350);
  };

  try {
    fs.watch(config.FILE, { persistent: false }, debounce);
    // fs.watch on Windows occasionally misses the rename save() performs, so
    // poll as a safety net. Content comparison keeps this silent in the normal
    // case, so polling every 4s costs nothing.
    setInterval(check, 4000);
  } catch (e) {
    log('无法监听 config.json：', e.message);
  }
}

// --------------------------------------------------------------------- boot

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => showWindow());

  app.whenReady().then(() => {
    // Electron installs an English File/Edit/View/Window/Help menu bar by
    // default, which looked wrong sitting on top of an otherwise Chinese UI.
    // We only ever needed the tray menu, so drop the application menu entirely.
    Menu.setApplicationMenu(null);

    log('app ready, startup=' + STARTUP);
    createTray();
    createWindow();
    if (!STARTUP) showWindow();   // autostart -> tray only, manual launch -> show UI
    spawnHost();
    resetIdleTimer();
    watchConfig();
    if (config.load().openAtLogin) {
      setStartupRegistry(true);
    }
    // draw the clock strip on a slow tick (cheap: one 80x80 image).
    // Skipped while asleep - pushing image data at a sleeping panel can
    // partially re-light the backlight.
    setInterval(() => {
      if (!deviceAsleep) broadcast('device:repaint-strips', {});
    }, 30000);

    // 三重安全急停熔断快捷键
    try {
      globalShortcut.register('Ctrl+Alt+Escape', () => {
        log('EMERGENCY STOP by Ctrl+Alt+Escape');
        runner.stopAllMacros();
        notify('⚠️ 已紧急中止所有正在运行的宏');
      });
      globalShortcut.register('Pause', () => {
        log('EMERGENCY STOP by Pause');
        runner.stopAllMacros();
        notify('⚠️ 已紧急中止所有正在运行的宏');
      });
    } catch (_) {}
  });

  app.on('window-all-closed', (e) => { e.preventDefault(); }); // tray app
  app.on('before-quit', () => { if (host) try { host.kill(); } catch (e) {} });
}
