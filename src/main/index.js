const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, shell, dialog, screen, globalShortcut, powerMonitor } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const os = require('os');

const config = require('./config.js');
const probe = require('./probe.js');
const runner = require('./runner.js');
const NativeInput = require('./native-input.js');
const telemetry = require('./telemetry-plugins.js');

runner.setLoopStateListener((keyId, isRunning, context) => {
  broadcast('macro:loopState', { keyId, isRunning, context });
  broadcast('device:repaint', {});
});

telemetry.setPomodoroListener((snap, phaseCompleted) => {
  broadcast('telemetry:update', { pomodoro: snap });
  if (phaseCompleted) {
    notify(snap.phase === 'break' ? '🍅 番茄专注完成！开始 5 分钟休息' : '☕ 休息结束！开始新一轮专注');
  }
});

const LOG_DIR = path.join(__dirname, '..', '..', 'logs');
try { fs.mkdirSync(LOG_DIR, { recursive: true }); } catch (e) { /* ignore */ }
const LOG_FILE = path.join(LOG_DIR, 'main.log');
const MAX_LOG_BYTES = 2 * 1024 * 1024;
let logBuffer = '';
let logFlushTimer = null;

function flushLogsSync() {
  if (!logBuffer) return;
  const toWrite = logBuffer;
  logBuffer = '';
  try {
    if (fs.existsSync(LOG_FILE)) {
      const st = fs.statSync(LOG_FILE);
      if (st.size > MAX_LOG_BYTES) {
        try { fs.renameSync(LOG_FILE, LOG_FILE + '.old'); } catch (_) {}
      }
    }
    fs.appendFileSync(LOG_FILE, toWrite, 'utf8');
  } catch (e) { /* ignore */ }
}

function log(...args) {
  const line = `[${new Date().toISOString()}] ${args.map((a) => (a && a.stack) || String(a)).join(' ')}\n`;
  logBuffer += line;
  if (!logFlushTimer) {
    logFlushTimer = setTimeout(() => {
      logFlushTimer = null;
      const chunk = logBuffer;
      logBuffer = '';
      if (!chunk) return;
      fs.appendFile(LOG_FILE, chunk, 'utf8', () => {});
    }, 150);
  }
}
process.on('uncaughtException', (e) => { log('UNCAUGHT', e); flushLogsSync(); });
process.on('unhandledRejection', (e) => { log('UNHANDLED', e); });

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
const mainKeyDebounceMap = new Map();

// ------------------------------------------------------------ 智能前台感知状态栈 (Runtime Page Stack)
// manualBasePageId 记录用户手动选择的基准页面（持久化到磁盘的真实意愿页）
// autoActiveRootPageId 记录当前由 Auto-Profile 触发的根页面 ID（支持用户在其下钻取多级子页后仍能精准退回）
let manualBasePageId = null;
let autoActiveRootPageId = null;
let lastFgSignature = '';

function isPageDescendantOrSame(cfg, targetPageId, ancestorPageId) {
  if (!cfg || !targetPageId || !ancestorPageId) return false;
  if (targetPageId === ancestorPageId) return true;
  const visited = new Set();
  let cur = cfg.pages.find((p) => p.id === targetPageId);
  while (cur && cur.parent && !visited.has(cur.id)) {
    visited.add(cur.id);
    if (cur.parent === ancestorPageId) return true;
    cur = cfg.pages.find((p) => p.id === cur.parent);
  }
  return false;
}

function matchProcessRule(procName, autoAppStr) {
  if (!procName || !autoAppStr) return false;
  const rules = String(autoAppStr)
    .split(/[,;，；\s]+/)
    .map((s) => s.trim().toLowerCase().replace(/\.exe$/i, ''))
    .filter(Boolean);
  for (const r of rules) {
    if (r.includes('*')) {
      const re = new RegExp('^' + r.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$', 'i');
      if (re.test(procName)) return true;
    } else if (procName === r) {
      return true;
    }
  }
  return false;
}

function matchTitleRule(winTitle, autoTitleStr) {
  if (!winTitle || !autoTitleStr) return false;
  const raw = String(autoTitleStr).trim();
  if (!raw) return false;
  try {
    if (raw.startsWith('/') && raw.lastIndexOf('/') > 0) {
      const lastSlash = raw.lastIndexOf('/');
      const pattern = raw.slice(1, lastSlash);
      const flags = raw.slice(lastSlash + 1) || 'i';
      return new RegExp(pattern, flags).test(winTitle);
    }
    const re = new RegExp(raw, 'i');
    return re.test(winTitle);
  } catch (_) {
    return winTitle.toLowerCase().includes(raw.toLowerCase());
  }
}

// ------------------------------------------------------------ device host rpc

function hostScript() {
  return path.join(__dirname, '..', '..', 'host', 'device-host.js');
}

function spawnHost() {
  const candidates = [
    process.env.AKP153_NODE,
    'node',
    'C:\\Program Files\\nodejs\\node.exe',
    process.execPath,
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
          if (msg.path) NativeInput.setDevicePath(msg.path);
          hostError = null;
          deviceAsleep = !!msg.asleep;
          broadcast('host:status', { ready: true, device: true, error: null });
          if (!deviceAsleep) repaintSoon(true);
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
  if (win && !win.isDestroyed() && win.webContents) {
    win.webContents.send(channel, payload);
  }
}

function notify(msg) {
  log('notify:', msg);
  broadcast('toast', { message: msg });
}

async function safeRpc(cmd, args) {
  try { return await rpc(cmd, args); } catch (e) { return { ok: false, error: e.message }; }
}

function repaintSoon(force = false) {
  broadcast('device:repaint', { force: !!force });
  if (win && !win.isDestroyed() && win.webContents && win.webContents.isLoading()) {
    setTimeout(() => broadcast('device:repaint', { force: !!force }), 900);
  }
}

async function doSleep(force = false) {
  if (deviceAsleep && !force) return;
  deviceAsleep = true;
  broadcast('device:sleep-state', { asleep: true });
  const r = await safeRpc('sleep', { mode: config.load().sleepMode || 'zeros-last', force: !!force });
  log('sleep:', JSON.stringify((r && r.report) || r));
  return r;
}

async function doWake() {
  const r = await safeRpc('wake', { brightness: config.load().brightness, force: true });
  deviceAsleep = false;
  lastWakeTime = Date.now();
  lastActivity = Date.now();
  broadcast('device:sleep-state', { asleep: false });
  log('wake:', JSON.stringify(r));
  repaintSoon(true);
  return r;
}

let isQuitting = false;
let mainHwndStr = null;
async function prepareExitAndSleep() {
  if (isQuitting) return;
  isQuitting = true;
  runner.stopAllMacros();
  log('prepareExitAndSleep: 正在关闭并休眠 AKP153 控制台硬件...');
  flushLogsSync();
  try {
    let hostBlackoutOk = false;
    if (host && hostReady) {
      // 优先通过已持有 HID 句柄的 device-host 下发 blackout 并关闭句柄，避免双进程并发争抢同一 USB 端点
      const res = await safeRpc('sleep', { mode: 'blackout', force: true });
      await safeRpc('close', {});
      hostBlackoutOk = !!(res && res.ok);
    }

    if (process.platform === 'win32' && !hostBlackoutOk) {
      try {
        await NativeInput.blackoutHardware();
      } catch (e) {
        log('NativeInput.blackoutHardware 异常:', e);
      }
    }
  } catch (err) {
    log('prepareExitAndSleep 硬件休眠失败:', err);
  } finally {
    flushLogsSync();
    if (process.platform === 'win32') {
      try { await NativeInput.shutdownUnblock(mainHwndStr || 0); } catch (_) {}
    }
    try { NativeInput.stop(); } catch (_) {}
    if (host) {
      try { host.kill(); } catch (e) {}
      host = null;
    }
    app.exit(0);
  }
}

async function openDevice(hard) {
  const cfg = config.load();
  const r = await safeRpc('open', { debounceMs: cfg.keyDebounceMs || 100 });
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
  if (r && r.info && r.info.path) {
    NativeInput.setDevicePath(r.info.path);
  }
  log('device opened OK' + (hard ? ' (hard reset)' : ''));
  if (hard) {
    await safeRpc('reset', { brightness: cfg.brightness });
  } else {
    await safeRpc('wake', { brightness: cfg.brightness, force: true });
  }
  await safeRpc('brightness', { value: cfg.brightness });
  await safeRpc('setDebounce', { value: cfg.keyDebounceMs || 100 });
  hostError = null;
  deviceAsleep = false;
  broadcast('host:status', { ready: true, device: true, error: null });
  repaintSoon(true);
  return true;
}

// -------------------------------------------------------------- key handling

const BACK_ROW = 2, BACK_COL = 4;

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

async function goToPage(id, why, isAutoSwitch = false) {
  const cfg = config.load();
  if (!id) return false;
  const target = cfg.pages.find((p) => p.id === id);
  if (!target) return false;

  if (!isAutoSwitch) {
    if (autoActiveRootPageId && isPageDescendantOrSame(cfg, id, autoActiveRootPageId)) {
      // 用户在自动切入的页面内进一步钻取其子页，保留 autoActiveRootPageId 栈底以便离开软件后还原
    } else {
      manualBasePageId = id;
      autoActiveRootPageId = null;
    }
  }

  if (cfg.currentPage === id) return true;
  cfg.currentPage = id;
  if (!isAutoSwitch) {
    config.save(cfg);
  }
  log(`page -> 「${target.name}」${target.parent ? ' (子页)' : ''}${why ? '  via ' + why : ''}`);
  broadcast('page:changed', { pageId: id, isAutoSwitch });
  return true;
}

async function onWakeByKey(row, col) {
  deviceAsleep = false;
  lastWakeTime = Date.now();
  lastActivity = Date.now();
  broadcast('device:sleep-state', { asleep: false });
  broadcast('key:flash', { row, col });
  const cfg = config.load();
  await safeRpc('wake', { brightness: cfg.brightness, force: true });
  repaintSoon(true);
  log(`device woke up by key r${row}c${col} (wake only, restored brightness=${cfg.brightness})`);
}

function findSpanMasterInRow(page, row, col) {
  if (!page || !page.buttons) return null;
  for (let c = 0; c < col; c++) {
    const candidate = page.buttons[row + ',' + c];
    if (candidate) {
      const span = Math.max(1, Math.min(5 - c, Number(candidate.spanCols) || 1));
      if (c + span > col) {
        return { masterCol: c, spanCols: span, spanOffset: col - c, spec: candidate };
      }
    }
  }
  return null;
}

async function resolveButtonProcessName(spec) {
  if (!spec) return '';
  if (spec.watchProcess && String(spec.watchProcess).trim()) {
    return String(spec.watchProcess).trim().replace(/\.exe$/i, '');
  }
  if (!spec.target) return '';
  try {
    const probed = await probe.probeAppAsync(spec.target);
    return (await runner.processNameFor(probed)) || '';
  } catch (_) {
    return '';
  }
}

function resolveEffectiveSyncMode(spec) {
  if (!spec) return 'manual';
  const explicit = String(spec.toggleSyncMode || 'auto').toLowerCase();
  const act2 = spec.action2 || (spec.act2Target ? { type: spec.act2Type || 'command', target: spec.act2Target } : null);
  const act2Target = String((act2 && act2.target) || '').toLowerCase();
  if (explicit === 'window' || (act2 && (act2.type === 'window_toggle' || act2Target.startsWith('window_toggle:') || act2Target.startsWith('smart_window:')))) {
    return 'window';
  }
  if (explicit === 'manual') return 'manual';
  if (explicit === 'process') return 'process';
  // auto mode:
  if (spec.type !== 'app' || !spec.target) return 'manual';
  if (runner.isScriptTarget(spec.target)) return 'manual';
  if (spec._downgradedToManual) return 'manual';
  return 'auto';
}

async function onKeyDown(row, col) {
  const now = Date.now();
  lastActivity = now;

  const cfgNow = config.load();
  const debounceMs = (cfgNow.keyDebounceMs !== undefined) ? Number(cfgNow.keyDebounceMs) : 100;
  const wakeGuardMs = 180;

  if (deviceAsleep || (now - lastWakeTime < wakeGuardMs)) {
    if (deviceAsleep) {
      deviceAsleep = false;
      lastWakeTime = now;
      broadcast('device:sleep-state', { asleep: false });
      await safeRpc('wake', { brightness: cfgNow.brightness, force: true });
      repaintSoon(true);
      broadcast('key:flash', { row, col });
      log(`key r${row}c${col} pressed while asleep -> woke panel, action suppressed`);
    } else {
      log(`key r${row}c${col} suppressed (within ${wakeGuardMs}ms wake guard)`);
    }
    return;
  }

  // 同键连击物理防抖守卫（与设置面板 keyDebounceMs 实时联动）
  const posKey = `${row},${col}`;
  const prevPress = mainKeyDebounceMap.get(posKey) || 0;
  if (now - prevPress < debounceMs) {
    log(`key r${row}c${col} debounced (${now - prevPress}ms < ${debounceMs}ms)`);
    return;
  }
  mainKeyDebounceMap.set(posKey, now);

  const page = config.currentPage();
  broadcast('key:flash', { row, col });

  if (page.parent && row === BACK_ROW && col === BACK_COL) {
    log(`key r${row}c${col} -> 返回上级 (from 「${page.name}」)`);
    await goToPage(page.parent, 'back key');
    return;
  }

  let effectiveRow = row;
  let effectiveCol = col;
  let spanOffset = 0;
  let spanCols = 1;
  let spec = page.buttons[row + ',' + col];

  // 支持跨格联合画布 (Multi-Key Span Widget 2x1 / 3x1)：从属格按键自动路由至主格
  const spanMaster = findSpanMasterInRow(page, row, col);
  if (spanMaster) {
    effectiveCol = spanMaster.masterCol;
    spanOffset = spanMaster.spanOffset;
    spanCols = spanMaster.spanCols;
    spec = spanMaster.spec;
  } else if (spec && Number(spec.spanCols) > 1) {
    spanCols = Math.max(1, Math.min(5 - col, Number(spec.spanCols) || 1));
  }

  const isMulti = spec && (spec.type === 'multi' || spec.type === 'macro');
  const isQr = spec && (spec.type === 'qr_decode' || spec.type === 'qr');
  const isVolume = spec && (spec.type === 'volume' || spec.type === 'audio');
  const isMedia = spec && (spec.type === 'media');
  const isPage = spec && (spec.type === 'page');
  const isWidget = spec && (spec.type === 'widget');
  const isWinToggle = spec && (spec.type === 'window_toggle');
  if (!spec || (!spec.target && !spec.hotkey && !isMulti && !isQr && !isVolume && !isMedia && !isPage && !isWidget && !isWinToggle)) {
    log(`key r${row}c${col} pressed - NOT CONFIGURED`);
    broadcast('key:unconfigured', { row, col });
    notify(`r${row}c${col} 这个键还没配置 —— 在窗口里把程序拖到对应格子`);
    return;
  }

  let actionToRun = spec;
  const isDualMode = Boolean(spec.toggleAction || (spec.badgeToggle && !isVolume));

  if (isDualMode) {
    let curState = spec._activeState !== undefined ? spec._activeState : (spec.badgeInitialState || 0);
    const syncMode = resolveEffectiveSyncMode(spec);
    const act2 = spec.action2 || (spec.act2Target ? { type: spec.act2Type || 'command', target: spec.act2Target, args: spec.act2Args || '' } : null);
    const hasAction2 = spec.toggleAction && act2 && (
      act2.target || act2.hotkey ||
      act2.type === 'volume' || act2.type === 'audio' ||
      act2.type === 'media' || act2.type === 'multi' ||
      act2.type === 'macro' || act2.type === 'qr_decode' ||
      act2.type === 'page' || act2.type === 'widget' || act2.type === 'window_toggle'
    );

    if (syncMode === 'window') {
      // HWND 窗口句柄级任务栏双态模式：未启动则启动 -> 后台/最小化则置顶激活 -> 已在前台则最小化隐藏
      const procName = await resolveButtonProcessName(spec);
      const winState = procName ? await NativeInput.queryWindowState(procName) : 'NOT_RUNNING';
      if (winState === 'NOT_RUNNING') {
        actionToRun = spec;
        spec._activeState = 1;
        spec._windowSubState = 'focused';
        spec._graceUntil = Date.now() + 7000;
        spec._everSeenRunning = false;
      } else {
        actionToRun = hasAction2 ? act2 : { type: 'window_toggle', target: procName, watchProcess: procName };
        spec._activeState = 1;
        spec._windowSubState = (winState === 'FOREGROUND') ? 'minimized' : 'focused';
      }
      broadcast('key:toggleState', {
        pageId: page.id,
        row: effectiveRow,
        col: effectiveCol,
        activeState: spec._activeState,
        windowSubState: spec._windowSubState,
      });
    } else {
      // 'auto' | 'process' | 'manual'
      const inGrace = spec._graceUntil && Date.now() < spec._graceUntil;
      if ((syncMode === 'process' || syncMode === 'auto') && spec.toggleAction && !inGrace) {
        const procName = await resolveButtonProcessName(spec);
        if (procName) {
          const alive = await runner.isRunningAsync(procName);
          if (alive) {
            spec._everSeenRunning = true;
            curState = 1;
          } else if (syncMode === 'process' || spec._everSeenRunning) {
            curState = 0;
          }
        }
      }

      if (hasAction2 && curState === 1) {
        actionToRun = act2;
      }
      const nextState = (curState === 1 ? 0 : 1);
      spec._activeState = nextState;
      if (nextState === 1) {
        spec._graceUntil = Date.now() + 7000;
      } else {
        spec._graceUntil = 0;
      }
      broadcast('key:toggleState', {
        pageId: page.id,
        row: effectiveRow,
        col: effectiveCol,
        activeState: nextState,
      });
    }
  }

  if (actionToRun && actionToRun.type === 'page') {
    const target = resolvePageAction(actionToRun, page);
    if (!target) {
      log(`key r${row}c${col} -> page ${actionToRun.mode} 无可用目标`);
      notify('这个切页键现在没有可去的页面');
      return;
    }
    await goToPage(target, `key r${row}c${col} (${actionToRun.mode})`);
    return;
  }

  const actMulti = actionToRun && (actionToRun.type === 'multi' || actionToRun.type === 'macro');
  log(`key r${row}c${col} -> ${actionToRun.type} ${actMulti ? 'Macro (' + ((actionToRun.actions && actionToRun.actions.length) || 0) + ' actions)' : (actionToRun.target || actionToRun.hotkey || actionToRun.widgetKind || actionToRun.widgetType || '')}`);
  const res = await runner.run(actionToRun, { row: effectiveRow, col: effectiveCol, pageId: page.id, spanOffset, spanCols });
  const what = res.ok ? 'ok' + (res.action ? ` (${res.action})` : '') : 'FAILED ' + res.error;
  log(`  result: ${what}`);
  if (res && ((res.action && (res.action.startsWith('volume') || res.action.startsWith('audio') || res.action.startsWith('media') || res.action.startsWith('widget'))) || (actionToRun && (actionToRun.type === 'volume' || actionToRun.type === 'audio' || actionToRun.type === 'media' || actionToRun.type === 'widget')))) {
    broadcast('device:repaint-strips', { row: effectiveRow, col: effectiveCol });
    if (res.level !== undefined || res.isMute !== undefined) {
      broadcast('audio:state', res);
    }
  }
  if (isQr || (actionToRun && (actionToRun.type === 'qr_decode' || actionToRun.type === 'qr'))) {
    if (res.error !== 'CANCELLED') {
      broadcast('key:result', { row: effectiveRow, col: effectiveCol, success: !!res.ok, text: res.text || '' });
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
  if (idleTimer) {
    clearInterval(idleTimer);
    idleTimer = null;
  }
  const cfg = config.load();
  const minutes = Number(cfg.idleSleepMinutes || 0);
  if (!minutes || minutes <= 0) return;
  idleTimer = setInterval(() => {
    if (deviceAsleep) return;
    const idleMs = Date.now() - lastActivity;
    if (idleMs > minutes * 60 * 1000) {
      doSleep();
      lastActivity = Date.now();
    }
  }, 15000);
}

/**
 * 后台智能态势引擎 (v0.9)：
 * 1. 前台窗口感知自动切页 (支持进程名精确/通配匹配 + 窗口标题正则匹配 + 多层级子页记忆栈)
 * 2. 当前页应用程序真实进程存活与 HWND 前后台状态同步（智能识别瞬态脚本与启动器，绝不误重置手动状态）
 */
let isPollingState = false;
async function pollForegroundAndProcessState() {
  if (deviceAsleep || isPollingState) return;
  isPollingState = true;
  try {
    const cfg = config.load();
    if (!cfg || !Array.isArray(cfg.pages)) return;

    if (!manualBasePageId || !cfg.pages.some((p) => p.id === manualBasePageId)) {
      manualBasePageId = cfg.currentPage || (cfg.pages[0] && cfg.pages[0].id);
    }

    let currentFgProc = '';
    const hasAutoRules = cfg.pages.some((p) => (p.autoApp && p.autoApp.trim()) || (p.autoTitle && p.autoTitle.trim()));
    try {
      const fg = await NativeInput.getForegroundWindow();
      currentFgProc = fg && fg.processName ? fg.processName.toLowerCase().replace(/\.exe$/i, '') : '';
      const winTitle = (fg && fg.title) ? fg.title.trim() : '';

      if (cfg.autoSwitchPage !== false && hasAutoRules) {
        const isSelfOrShell = !currentFgProc || currentFgProc === 'electron' || currentFgProc === 'akp153 控制台' || currentFgProc === 'akp-input' || currentFgProc === 'searchhost' || currentFgProc === 'shellexperiencehost';
        const sig = `${currentFgProc}|${winTitle}`;

        if (!isSelfOrShell && sig !== lastFgSignature) {
          lastFgSignature = sig;
          const matchedPage = cfg.pages.find((p) => {
            const hasApp = !!(p.autoApp && p.autoApp.trim());
            const hasTitle = !!(p.autoTitle && p.autoTitle.trim());
            if (!hasApp && !hasTitle) return false;
            const appOk = !hasApp || matchProcessRule(currentFgProc, p.autoApp);
            const titleOk = !hasTitle || matchTitleRule(winTitle, p.autoTitle);
            return appOk && titleOk;
          });

          if (matchedPage) {
            if (!autoActiveRootPageId) {
              manualBasePageId = cfg.currentPage;
            }
            if (autoActiveRootPageId !== matchedPage.id && !isPageDescendantOrSame(cfg, cfg.currentPage, matchedPage.id)) {
              autoActiveRootPageId = matchedPage.id;
              await goToPage(matchedPage.id, `auto-switch (${currentFgProc})`, true);
            } else {
              autoActiveRootPageId = matchedPage.id;
            }
          } else if (autoActiveRootPageId && isPageDescendantOrSame(cfg, cfg.currentPage, autoActiveRootPageId)) {
            const restoreId = (manualBasePageId && cfg.pages.some((p) => p.id === manualBasePageId))
              ? manualBasePageId
              : cfg.pages[0].id;
            autoActiveRootPageId = null;
            await goToPage(restoreId, `auto-restore (left ${currentFgProc})`, true);
          }
        }
      }
    } catch (_) {}

    // 2. 批量同步当前页面上需要跟随进程/窗口状态的双态按键
    try {
      const page = config.currentPage();
      if (!page || !page.buttons) return;
      const entries = [];
      for (const [k, spec] of Object.entries(page.buttons)) {
        if (!spec || spec.type !== 'app') continue;
        if (!spec.toggleAction && !spec.badgeToggle) continue;
        const syncMode = resolveEffectiveSyncMode(spec);
        // 纯手动乒乓模式，或者仅开启了动态角标但未开启双态动作且未强制指定进程同步时，绝不覆盖用户手动状态
        if (syncMode === 'manual') continue;
        if (!spec.toggleAction && spec.toggleSyncMode !== 'process' && spec.toggleSyncMode !== 'window') continue;

        const procName = await resolveButtonProcessName(spec);
        if (!procName) continue;
        entries.push({ k, spec, syncMode, procName: procName.replace(/\.exe$/i, '').toLowerCase() });
      }
      if (entries.length > 0) {
        const nowMs = Date.now();
        const runningSet = await runner.checkProcessesRunning(entries.map((e) => e.procName));
        for (const { k, spec, syncMode, procName } of entries) {
          const [row, col] = k.split(',').map(Number);
          const isAlive = runningSet.has(procName);
          const curState = spec._activeState !== undefined ? spec._activeState : (spec.badgeInitialState || 0);

          if (isAlive) {
            spec._everSeenRunning = true;
          } else {
            // 若刚按下启动尚在 7 秒宽限期内，不重置状态
            if (spec._graceUntil && nowMs < spec._graceUntil) {
              continue;
            }
            // 在智能混合模式 (auto) 下，如果宽限期过后该程序从来没有在进程列表中驻留过，
            // 说明它是瞬态脚本、批处理或启动器，自动降级为手动切换模式，保留形态 2！
            if (syncMode === 'auto' && curState === 1 && !spec._everSeenRunning) {
              spec._downgradedToManual = true;
              continue;
            }
          }

          const realState = isAlive ? 1 : 0;
          const nextWinSub = isAlive
            ? (currentFgProc === procName ? 'focused' : 'minimized')
            : 'stopped';
          const winSubChanged = (syncMode === 'window') && (spec._windowSubState !== nextWinSub);

          if (realState !== curState || winSubChanged) {
            spec._activeState = realState;
            spec._windowSubState = nextWinSub;
            broadcast('key:toggleState', {
              pageId: page.id,
              row,
              col,
              activeState: realState,
              windowSubState: nextWinSub,
            });
          }
        }
      }
    } catch (_) {}
  } finally {
    isPollingState = false;
  }
}

// ------------------------------------------------------------------- window

const WIN_DEFAULT = { width: 1180, height: 820 };
const WIN_MIN = { width: 1000, height: 660 };

function restoreBounds() {
  const saved = config.load().window;
  const b = Object.assign({}, WIN_DEFAULT);
  if (saved && Number(saved.width) >= WIN_MIN.width && Number(saved.height) >= WIN_MIN.height) {
    b.width = Math.round(saved.width);
    b.height = Math.round(saved.height);
    if (Number.isInteger(saved.x) && Number.isInteger(saved.y)) {
      const vis = screen.getAllDisplays().some((d) => {
        const w = d.workArea;
        return saved.x < w.x + w.width - 100 && saved.x + b.width > w.x + 100
          && saved.y >= w.y && saved.y < w.y + w.height - 80;
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
      backgroundThrottling: false,
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

  win.on('close', (e) => {
    if (isQuitting) return;
    e.preventDefault();
    const cfg = config.load();
    if (cfg.closeToTray === false) {
      prepareExitAndSleep();
    } else {
      win.hide();
    }
  });
  win.on('closed', () => { win = null; });
  win.on('hide', () => {});

  if (process.platform === 'win32') {
    try {
      const handleBuf = win.getNativeWindowHandle();
      if (handleBuf && handleBuf.length > 0) {
        mainHwndStr = handleBuf.length === 8 ? handleBuf.readBigInt64LE(0).toString() : handleBuf.readInt32LE(0).toString();
      }
      win.hookWindowMessage(0x0011, async () => {
        log('收到 WM_QUERYENDSESSION 关机请求...');
        await prepareExitAndSleep();
      });
      win.hookWindowMessage(0x0016, async () => {
        log('收到 WM_ENDSESSION 关机确认...');
        await prepareExitAndSleep();
      });
    } catch (e) {
      log('hookWindowMessage 异常:', e);
    }
  }

  win.webContents.on('before-input-event', (e, input) => {
    if (input.type === 'keyDown' && input.key === 'F12') {
      win.webContents.toggleDevTools();
      e.preventDefault();
    }
  });
}

function rebuildTrayMenu() {
  if (!tray) return;
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
        broadcast('login:changed', { openAtLogin: !!item.checked });
      },
    },
    { label: '打开配置文件', click: () => shell.openPath(config.FILE) },
    { label: '关于', click: () => showWindow() },
    { type: 'separator' },
    { label: '退出', click: () => { prepareExitAndSleep(); } },
  ]);
  tray.setContextMenu(menu);
}

function createTray() {
  const iconPath = path.join(__dirname, '..', '..', 'assets', 'tray.png');
  tray = new Tray(nativeImage.createFromPath(iconPath));
  tray.setToolTip('AKP153 控制台');
  rebuildTrayMenu();
  tray.on('double-click', () => showWindow());
}

function showWindow() {
  if (!win || win.isDestroyed()) createWindow();
  win.show();
  win.focus();
}

// --------------------------------------------------------------------- ipc

ipcMain.handle('config:load', () => config.load());
ipcMain.handle('config:save', (e, cfg) => {
  const res = config.save(cfg);
  resetIdleTimer();
  return res;
});
ipcMain.handle('config:get', (e, key) => config.get(key));

ipcMain.handle('page:manualSwitch', (e, pageId) => {
  if (pageId) {
    manualBasePageId = pageId;
    autoActiveRootPageId = null;
  }
  return { ok: true };
});

const drawStats = { ok: 0, fail: 0, skipped: 0, lastError: null };

ipcMain.handle('device:draw', async (e, a) => {
  if (deviceAsleep) return { ok: true, drawn: false, skipped: true };
  const r = await safeRpc('draw', a);
  if (r && r.ok === false) {
    drawStats.fail++;
    drawStats.lastError = r.error;
    log(`draw FAILED r${a.row}c${a.col}: ${r.error}`);
  } else if (r && r.skipped) {
    drawStats.skipped++;
  } else {
    drawStats.ok++;
  }
  return r;
});

ipcMain.handle('device:batchDraw', async (e, items) => {
  if (deviceAsleep) return { ok: true, drawn: 0, skipped: (items && items.length) || 0 };
  const r = await safeRpc('batchDraw', { items });
  if (r && r.ok === false) {
    drawStats.fail++;
    drawStats.lastError = r.error;
  } else if (r) {
    drawStats.ok += Number(r.drawn) || 0;
    drawStats.skipped += Number(r.skipped) || 0;
  }
  return r;
});

ipcMain.handle('device:brightness', (e, v) => safeRpc('brightness', { value: v }));
ipcMain.handle('device:setDebounce', (e, ms) => safeRpc('setDebounce', { value: ms }));
ipcMain.handle('device:sleep', () => doSleep());
ipcMain.handle('device:wake', () => doWake());
ipcMain.handle('device:reconnect', () => openDevice(true));
ipcMain.handle('host:status', () => ({
  ready: hostReady,
  device: !hostError,
  error: hostError,
  draws: Object.assign({}, drawStats),
}));

ipcMain.handle('action:run', async (e, spec, ctx = {}) => {
  const curPage = config.currentPage();
  if (curPage && curPage.buttons && ctx && ctx.row !== undefined && ctx.col !== undefined) {
    const btn = curPage.buttons[ctx.row + ',' + ctx.col];
    if (btn && ctx.activeState !== undefined) {
      btn._activeState = ctx.activeState;
      if (ctx.activeState === 1) btn._graceUntil = Date.now() + 7000;
    }
  }
  if (spec && spec.type === 'page') {
    const page = config.currentPage();
    const target = resolvePageAction(spec, page);
    if (!target) return { ok: false, error: '当前翻页动作没有可跳转的目标页面' };
    await goToPage(target, `ui-test (${spec.mode || 'next'})`);
    return { ok: true, action: 'page', pageId: target };
  }
  const page = config.currentPage();
  const res = await runner.run(spec, { pageId: page && page.id });
  if (res && ((res.action && (res.action.startsWith('volume') || res.action.startsWith('audio') || res.action.startsWith('media') || res.action.startsWith('widget'))) || (spec && (spec.type === 'volume' || spec.type === 'audio' || spec.type === 'widget')))) {
    let audioPayload = res;
    if (res.level === undefined && res.volume === undefined && spec && (spec.type === 'volume' || spec.type === 'audio')) {
      try {
        const curVol = await NativeInput.getVolume();
        if (curVol && curVol.level !== undefined) audioPayload = Object.assign({}, res, curVol);
      } catch (_) {}
    }
    broadcast('device:repaint-strips', {});
    if (audioPayload && (audioPayload.level !== undefined || audioPayload.isMute !== undefined)) {
      broadcast('audio:state', audioPayload);
    }
  }
  return res;
});
ipcMain.handle('action:classify', (e, p) => runner.classify(p));

ipcMain.handle('audio:getVolume', async () => NativeInput.getVolume());
ipcMain.handle('audio:setVolume', async (e, lvl) => {
  const res = await NativeInput.setVolume(lvl);
  broadcast('device:repaint-strips', {});
  broadcast('audio:state', res);
  return res;
});
ipcMain.handle('audio:stepVolume', async (e, delta, osd) => {
  const res = await NativeInput.stepVolume(delta, osd);
  broadcast('device:repaint-strips', {});
  broadcast('audio:state', res);
  return res;
});
ipcMain.handle('audio:toggleMute', async (e, osd) => {
  const res = await NativeInput.toggleMute(osd);
  broadcast('device:repaint-strips', {});
  broadcast('audio:state', res);
  return res;
});
ipcMain.handle('audio:getDevices', async () => NativeInput.getAudioDevices());
ipcMain.handle('audio:switchDevice', async (e, target) => {
  const res = await NativeInput.switchAudioDevice(target);
  broadcast('device:repaint-strips', {});
  broadcast('audio:state', res);
  return res;
});

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

async function extractIconFromResource(filePath, iconIndex = 0) {
  // 1. 优先走常驻 C# 守护进程 1ms 内存流提取，免除拉起 PowerShell 与磁盘临时文件
  try {
    const natUrl = await NativeInput.extractIcon(filePath, iconIndex);
    if (natUrl) return natUrl;
  } catch (_) {}

  // 2. 兜底回退 PowerShell
  return new Promise((resolve) => {
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
    let settled = false;
    const finish = (val) => {
      if (settled) return;
      settled = true;
      resolve(val);
    };
    let child;
    try {
      child = spawn('powershell.exe',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', b64],
        { windowsHide: true, stdio: 'ignore' });
    } catch (_) {
      return finish(null);
    }
    const timer = setTimeout(() => {
      try { child.kill(); } catch (_) {}
      finish(null);
    }, 6000);

    child.on('error', () => { clearTimeout(timer); finish(null); });
    child.on('close', () => {
      clearTimeout(timer);
      try {
        if (fs.existsSync(tmp)) {
          const buf = fs.readFileSync(tmp);
          try { fs.unlinkSync(tmp); } catch (_) {}
          if (buf.length > 0) {
            return finish('data:image/png;base64,' + buf.toString('base64'));
          }
        }
      } catch (_) {}
      finish(null);
    });
  });
}

let prevCpus = null;
let lastCpuTime = 0;
let lastCpuPct = 0;

function getCpuUsage() {
  const now = Date.now();
  if (prevCpus && (now - lastCpuTime) < 1000) {
    return lastCpuPct;
  }
  const cpus = os.cpus();
  lastCpuTime = now;
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
  if (totalDiff <= 0) return lastCpuPct;
  lastCpuPct = Math.max(0, Math.min(100, Math.round((1 - idleDiff / totalDiff) * 100)));
  return lastCpuPct;
}

function toSafeDataUrl(nat, maxDim = 512) {
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

  if (ext === '.svg' && fs.existsSync(p)) {
    try {
      const svgRaw = fs.readFileSync(p, 'utf8');
      return 'data:image/svg+xml;utf8,' + encodeURIComponent(svgRaw);
    } catch (_) {}
  }

  if (['.ico', '.png', '.jpg', '.jpeg', '.webp', '.bmp'].includes(ext) && fs.existsSync(p)) {
    try {
      const nat = nativeImage.createFromPath(p);
      const url = toSafeDataUrl(nat, 512);
      if (url) return url;
    } catch (_) {}
  }

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
              const url = toSafeDataUrl(nat, 512);
              if (url) return url;
            } catch (_) {}
          }
          if (iconExt === '.dll' || details.iconIndex) {
            const resIcon = await extractIconFromResource(iconPath, details.iconIndex || 0);
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
                  const url = toSafeDataUrl(nat, 512);
                  if (url) return url;
                } catch (_) {}
              }
              if (iconExt === '.dll' || iconIndex !== 0) {
                const resIcon = await extractIconFromResource(iconPath, iconIndex);
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

  try {
    const img = await app.getFileIcon(p, { size: 'large' });
    if (img && !img.isEmpty()) return img.toDataURL();
  } catch (err) {}

  return null;
}

ipcMain.handle('icon:extract', async (e, p) => {
  try {
    return await extractIcon(p);
  } catch (err) {
    return null;
  }
});

const cpuHistory = [18, 22, 25, 21, 28, 24, 30, 26, 22, 25, 27, 24];
const memHistory = [48, 49, 49, 50, 50, 51, 50, 50, 51, 51, 52, 52];

ipcMain.handle('system:stats', async (e, opts = {}) => {
  const cpu = getCpuUsage();
  const total = os.totalmem();
  const free = os.freemem();
  const used = total - free;
  const mem = Math.round((used / total) * 100);
  const memUsedGb = (used / (1024 ** 3)).toFixed(1);
  const memTotalGb = (total / (1024 ** 3)).toFixed(1);
  cpuHistory.push(cpu);
  if (cpuHistory.length > 24) cpuHistory.shift();
  memHistory.push(mem);
  if (memHistory.length > 24) memHistory.shift();

  let volume = 50;
  let isMute = false;
  try {
    const v = await NativeInput.getVolume();
    if (v && v.ok) { volume = v.level; isMute = v.isMute; }
  } catch (_) {}
  const cfg = config.load();
  const reqTypes = (opts && Array.isArray(opts.types)) ? opts.types : ['gpu', 'net', 'weather', 'pomodoro', 'obs', 'media_now', 'plugin'];
  const extTelemetry = await telemetry.gatherTelemetry({
    types: reqTypes,
    pluginIds: opts && opts.pluginIds,
    weatherCity: (opts && opts.weatherCity) || cfg.weatherCity || 'Auto',
  });
  return Object.assign({
    cpu,
    mem,
    memUsedGb,
    memTotalGb,
    cpuHistory: cpuHistory.slice(),
    memHistory: memHistory.slice(),
    volume,
    isMute,
  }, extTelemetry);
});

ipcMain.handle('telemetry:get', async (e, opts) => {
  const cfg = config.load();
  return await telemetry.gatherTelemetry(Object.assign({ weatherCity: cfg.weatherCity || 'Auto' }, opts || {}));
});

ipcMain.handle('pomodoro:action', (e, payload = {}) => {
  const act = (typeof payload === 'string') ? payload : payload.act;
  const minutes = (payload && typeof payload === 'object') ? payload.minutes : undefined;
  const snap = telemetry.controlPomodoro(act, minutes);
  broadcast('telemetry:update', { pomodoro: snap });
  return snap;
});

ipcMain.handle('plugins:list', () => {
  return telemetry.listAvailablePlugins(true);
});

ipcMain.handle('plugins:reload', () => {
  return telemetry.listAvailablePlugins(true);
});

ipcMain.handle('plugins:market', () => {
  return telemetry.listMarketplacePlugins();
});

ipcMain.handle('plugins:trigger', async (e, { pluginId, args } = {}) => {
  return await telemetry.triggerPluginPress(pluginId, args);
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

ipcMain.handle('macro:getPixel', async (e, { x, y } = {}) => {
  const pt = (x !== undefined && y !== undefined) ? { x, y } : await runner.NativeInput.getCursor();
  const px = await runner.NativeInput.getPixelColor(pt.x, pt.y);
  return { ok: !!(px && px.ok), x: pt.x, y: pt.y, color: (px && px.color) || '#ffffff' };
});

ipcMain.handle('macro:recordStart', async (e, maxMs = 15000) => {
  broadcast('macro:recordState', { recording: true });
  const res = await runner.NativeInput.recordMacro(maxMs);
  broadcast('macro:recordState', { recording: false });
  return res;
});

ipcMain.handle('macro:recordStop', async () => {
  return await runner.NativeInput.stopMacroRecord();
});

ipcMain.handle('macro:stopAll', () => {
  runner.stopAllMacros();
  notify('⚠️ 已中止所有正在运行的宏');
  return { ok: true };
});

ipcMain.handle('macro:stopKey', (e, payload = {}) => {
  const { pageId, row, col } = (payload && typeof payload === 'object') ? payload : {};
  runner.stopMacroForKey(pageId, row, col);
  return { ok: true };
});

ipcMain.handle('macro:stopPage', (e, pageId) => {
  runner.stopMacrosForPage(pageId);
  return { ok: true };
});

ipcMain.handle('macro:activeLoops', () => {
  return Array.from(runner.activeLoops.keys());
});

const REG_RUN = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';
function runRegAsync(args) {
  return new Promise((resolve) => {
    try {
      const child = spawn('reg.exe', args, { windowsHide: true, stdio: 'ignore' });
      child.on('error', () => resolve(false));
      child.on('close', (code) => resolve(code === 0));
    } catch (_) {
      resolve(false);
    }
  });
}

async function setStartupRegistry(enable) {
  await runRegAsync(['delete', REG_RUN, '/v', 'electron.app.Electron', '/f']);

  const keyName = 'AKP153-Dock';
  if (!enable) {
    await runRegAsync(['delete', REG_RUN, '/v', keyName, '/f']);
    return;
  }

  let cmd = '';
  if (app.isPackaged) {
    cmd = `"${process.execPath}" --startup`;
  } else {
    const rootDir = path.resolve(__dirname, '..', '..');
    cmd = `"${process.execPath}" "${rootDir}" --startup`;
  }
  const ok = await runRegAsync(['add', REG_RUN, '/v', keyName, '/t', 'REG_SZ', '/d', cmd, '/f']);
  if (ok) log('Set startup registry:', keyName, cmd);
}

ipcMain.handle('app:setLogin', async (e, v) => {
  config.set('openAtLogin', !!v);
  await setStartupRegistry(!!v);
  rebuildTrayMenu();
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
    prepareExitAndSleep();
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

async function fetchFaviconForUrl(inputUrl) {
  let target = String(inputUrl || '').trim();
  if (!target) return { ok: false, error: '网址不能为空' };
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(target)) {
    target = 'https://' + target.replace(/^\/+/, '');
  }

  let hostName = '';
  let origin = '';
  try {
    const parsed = new URL(target);
    hostName = parsed.hostname;
    origin = parsed.origin;
  } catch (err) {
    return { ok: false, error: '无效网址格式' };
  }

  const { net } = require('electron');

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
        if (dataUrl) return { ok: true, dataUrl, iconData: dataUrl, source: 'html' };
      }
    }
  } catch (_) {}

  try {
    const rootIco = await fetchBuffer(`${origin}/favicon.ico`, 3000);
    const dataUrl = bufferToDataUrl(rootIco);
    if (dataUrl) return { ok: true, dataUrl, iconData: dataUrl, source: 'root' };
  } catch (_) {}

  const mirrors = [
    `https://api.iowen.cn/favicon/${hostName}.png`,
    `https://icons.duckduckgo.com/ip3/${hostName}.ico`,
    `https://icon.horse/icon/${hostName}`,
  ];
  for (const mirrorUrl of mirrors) {
    try {
      const mirrorBuf = await fetchBuffer(mirrorUrl, 3000);
      const dataUrl = bufferToDataUrl(mirrorBuf);
      if (dataUrl) return { ok: true, dataUrl, iconData: dataUrl, source: 'mirror' };
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
    if (!parsed || (!parsed.pages && !parsed.buttons && !parsed.version)) {
      return { ok: false, error: '该文件不包含有效的 AKP153 控制台配置！' };
    }
    runner.stopAllMacros();
    config.save(parsed);
    const normalized = config.load();
    manualBasePageId = normalized.currentPage;
    autoActiveRootPageId = null;
    resetIdleTimer();
    log('config backup imported from', res.filePaths[0]);
    broadcast('config:external', normalized);
    repaintSoon(true);
    return { ok: true, path: res.filePaths[0], data: normalized };
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
    runner.stopAllMacros();
    const def = JSON.parse(JSON.stringify(config.DEFAULTS));
    def.pages = [{
      id: 'p1',
      name: '常用生产力',
      parent: null,
      buttons: {},
      strips: JSON.parse(JSON.stringify(config.DEFAULT_STRIPS)),
    }];
    def.currentPage = 'p1';
    manualBasePageId = 'p1';
    autoActiveRootPageId = null;
    config.save(def);
    resetIdleTimer();
    broadcast('config:external', def);
    repaintSoon(true);
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

function watchConfig() {
  const check = () => {
    let changed = false;
    try { changed = config.changedOnDisk(); } catch (e) { return; }
    if (!changed) return;
    try {
      config.invalidate();
      const cfg = config.load();
      manualBasePageId = cfg.currentPage;
      autoActiveRootPageId = null;
      resetIdleTimer();
      const page = config.currentPage();
      log(`config.json 被外部修改 -> 已重载（当前页「${page.name}」）`);
      broadcast('config:external', { pageId: cfg.currentPage });
      broadcast('device:repaint', { force: true });
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
    Menu.setApplicationMenu(null);

    log('app ready, startup=' + STARTUP);
    createTray();
    createWindow();
    if (!STARTUP) showWindow();
    spawnHost();
    resetIdleTimer();
    watchConfig();
    if (config.load().openAtLogin) {
      setStartupRegistry(true);
    }
    setInterval(() => {
      if (!deviceAsleep) broadcast('device:repaint-strips', {});
    }, 30000);

    setInterval(() => {
      pollForegroundAndProcessState();
    }, 2000);

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

  if (powerMonitor) {
    powerMonitor.on('shutdown', async (e) => {
      log('powerMonitor: 捕获到系统关机信号，正在进入休眠灭屏...');
      try { e.preventDefault(); } catch (_) {}
      await prepareExitAndSleep();
    });

    powerMonitor.on('suspend', async () => {
      log('powerMonitor: 捕获到系统待机休眠信号，熄灭 AKP153 控制台...');
      await doSleep();
    });

    powerMonitor.on('resume', async () => {
      log('powerMonitor: 捕获到系统唤醒恢复信号，唤醒 AKP153 控制台...');
      await doWake();
    });
  }

  app.on('window-all-closed', (e) => { e.preventDefault(); });
  app.on('before-quit', (e) => {
    if (!isQuitting && host && hostReady) {
      try { e.preventDefault(); } catch (_) {}
      prepareExitAndSleep();
    }
  });
}
