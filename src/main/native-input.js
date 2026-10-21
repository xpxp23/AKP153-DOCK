'use strict';
/**
 * native-input.js - 原生 1ms 零延迟键鼠、窗口、进程探测、图标提取、屏幕取色与音频驱动桥接 (v0.9)
 *
 * 采用常驻子进程管道通信，将所有输入与窗口操作的延迟压缩至 0.1~1ms。
 * 具备：
 * 1. 自动按需编译更新：若检测到 native-input.cs 比 bin/akp-input.exe 更新，自动调用系统 .NET csc.exe 重编译；
 * 2. 异步流水号 + FIFO 双模守卫：支持 @id 异步乱序回调（耗时鼠标平滑移动或宏录制绝不阻塞音量/窗口查询），同时向下兼容旧版二进制；
 * 3. 安全参数隔离与多行清洗：降级模式采用 spawnSync 参数数组传递，彻底杜绝 cmd 命令行注入。
 * 4. HWND 级窗口状态探测与一键唤醒/最小化切换支持。
 */
const { spawn, spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { EventEmitter } = require('events');

const evtBus = new EventEmitter();
let lastWatchProcsCsv = '';

const BIN_PATH = path.join(__dirname, '..', '..', 'bin', 'akp-input.exe');
const SHA_PATH = path.join(__dirname, '..', '..', 'bin', 'akp-input.cs.sha1');
const CS_PATH = path.join(__dirname, 'native-input.cs');

let daemonProc = null;
let pendingQueue = []; // [{ id, resolve, timer }]
let reqSeq = 0;
let supportsIdPrefix = true;
let compileChecked = false;

/**
 * 若在 Windows 环境下发现 native-input.cs 源码哈希或时间戳发生变更，自动调用内置 .NET Framework csc.exe 重编译
 */
function ensureCompiledBinary() {
  if (compileChecked) return;
  compileChecked = true;
  if (process.platform !== 'win32') return;
  if (!fs.existsSync(CS_PATH)) return;

  try {
    const csBuf = fs.readFileSync(CS_PATH);
    const csHash = crypto.createHash('sha1').update(csBuf).digest('hex');
    let savedHash = '';
    if (fs.existsSync(SHA_PATH)) {
      try { savedHash = fs.readFileSync(SHA_PATH, 'utf8').trim(); } catch (_) {}
    }

    let needBuild = !fs.existsSync(BIN_PATH) || (savedHash !== csHash);
    if (!needBuild) {
      const csStat = fs.statSync(CS_PATH);
      const binStat = fs.statSync(BIN_PATH);
      if (csStat.mtimeMs > binStat.mtimeMs) needBuild = true;
    }
    if (!needBuild) return;

    const cscCandidates = [
      path.join(process.env.WINDIR || 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe'),
      path.join(process.env.WINDIR || 'C:\\Windows', 'Microsoft.NET', 'Framework', 'v4.0.30319', 'csc.exe'),
    ];
    const csc = cscCandidates.find((p) => fs.existsSync(p));
    if (!csc) return;

    fs.mkdirSync(path.dirname(BIN_PATH), { recursive: true });
    const tmpOut = BIN_PATH + '.new.exe';
    const r = spawnSync(csc, [
      '/nologo', '/optimize+', '/target:exe',
      '/r:System.Drawing.dll', '/r:System.Windows.Forms.dll',
      `/out:${tmpOut}`, CS_PATH,
    ], {
      windowsHide: true,
      timeout: 10000,
    });
    if (r.status === 0 && fs.existsSync(tmpOut)) {
      try {
        fs.renameSync(tmpOut, BIN_PATH);
        fs.writeFileSync(SHA_PATH, csHash, 'utf8');
      } catch (_) {
        try { fs.unlinkSync(tmpOut); } catch (e) {}
      }
    }
  } catch (_) {}
}

function flushPending(reason) {
  while (pendingQueue.length > 0) {
    const item = pendingQueue.shift();
    clearTimeout(item.timer);
    try { item.resolve(reason || 'ERR DAEMON_CLOSED'); } catch (_) {}
  }
}

function ensureDaemon() {
  if (daemonProc && !daemonProc.killed) return daemonProc;
  ensureCompiledBinary();
  if (!fs.existsSync(BIN_PATH)) return null;

  try {
    daemonProc = spawn(BIN_PATH, ['--daemon'], {
      stdio: ['pipe', 'pipe', 'ignore'],
      windowsHide: true,
    });

    let buffer = '';
    daemonProc.stdout.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      const lines = buffer.split('\n');
      buffer = lines.pop();

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        if (trimmed.startsWith('@evt ')) {
          const rawEvt = trimmed.slice(5);
          const spIdx = rawEvt.indexOf(' ');
          const evtType = (spIdx > 0 ? rawEvt.slice(0, spIdx) : rawEvt).trim();
          const evtPayload = spIdx > 0 ? rawEvt.slice(spIdx + 1) : '';
          if (evtType === 'fg') {
            const p = evtPayload.split('|');
            evtBus.emit('fg', {
              processName: (p[0] || '').trim(),
              pid: parseInt(p[1], 10) || 0,
              title: p.slice(2).join('|').trim(),
            });
          } else if (evtType === 'volume') {
            const p = evtPayload.trim().split(/\s+/);
            evtBus.emit('volume', {
              ok: true,
              level: Math.max(0, Math.min(100, parseInt(p[0], 10) || 0)),
              isMute: p[1] === '1',
            });
          } else if (evtType === 'media') {
            evtBus.emit('media', evtPayload);
          } else if (evtType === 'procs') {
            evtBus.emit('procs', evtPayload);
          } else if (evtType === 'audio_device') {
            evtBus.emit('audio_device', { deviceId: evtPayload });
          } else if (evtType === 'shutdown') {
            evtBus.emit('shutdown', { mode: evtPayload || '1' });
          }
          continue;
        }

        if (trimmed.startsWith('@')) {
          const sp = trimmed.indexOf(' ');
          if (sp > 1) {
            const respId = parseInt(trimmed.slice(1, sp), 10);
            const payload = trimmed.slice(sp + 1).trim();
            const idx = pendingQueue.findIndex((x) => x.id === respId);
            if (idx >= 0) {
              const item = pendingQueue.splice(idx, 1)[0];
              clearTimeout(item.timer);
              item.resolve(payload);
              continue;
            }
          }
        }

        if (trimmed.startsWith('ERR Unknown op: @') && pendingQueue.length > 0) {
          supportsIdPrefix = false;
          const item = pendingQueue.shift();
          clearTimeout(item.timer);
          sendCmd(item.rawCmd, item.timeoutMs).then(item.resolve);
          continue;
        }

        if (pendingQueue.length > 0) {
          const item = pendingQueue.shift();
          clearTimeout(item.timer);
          item.resolve(trimmed);
        }
      }
    });

    daemonProc.on('error', () => {
      daemonProc = null;
      flushPending('ERR DAEMON_ERROR');
    });
    daemonProc.on('exit', () => {
      daemonProc = null;
      flushPending('ERR DAEMON_EXITED');
    });
    daemonProc.unref();
    return daemonProc;
  } catch (e) {
    daemonProc = null;
    flushPending('ERR DAEMON_SPAWN_FAILED');
    return null;
  }
}

function sendCmd(cmdStr, timeoutMs = 4000) {
  const sanitized = String(cmdStr || '').replace(/\r\n/g, '\\n').replace(/[\r\n]/g, '\\n').trim();
  if (!sanitized) return Promise.resolve('OK');

  return new Promise((resolve) => {
    const daemon = ensureDaemon();
    if (daemon && daemon.stdin && daemon.stdin.writable) {
      const id = ++reqSeq;
      const entry = {
        id,
        rawCmd: sanitized,
        timeoutMs,
        resolve,
        timer: setTimeout(() => {
          const idx = pendingQueue.indexOf(entry);
          if (idx >= 0) pendingQueue.splice(idx, 1);
          resolve('ERR TIMEOUT');
        }, timeoutMs),
      };
      pendingQueue.push(entry);
      try {
        const wireLine = supportsIdPrefix ? `@${id} ${sanitized}\n` : `${sanitized}\n`;
        daemon.stdin.write(wireLine);
      } catch (e) {
        const idx = pendingQueue.indexOf(entry);
        if (idx >= 0) pendingQueue.splice(idx, 1);
        clearTimeout(entry.timer);
        resolve('ERR WRITE_FAILED');
      }
    } else {
      try {
        const r = spawnSync(BIN_PATH, [sanitized], {
          encoding: 'utf8',
          windowsHide: true,
          timeout: 2000,
        });
        if (r.error) {
          resolve('ERR ' + r.error.message);
        } else {
          resolve(String(r.stdout || '').trim() || 'OK');
        }
      } catch (e) {
        resolve('ERR ' + e.message);
      }
    }
  });
}

// 进程列表短期缓存（避免 pollForegroundAndProcessState 与 telemetry 高频并发枚举）
let procTitlesCache = { ts: 0, key: '', data: {} };

const NativeInput = {
  getCursor: async () => {
    const res = await sendCmd('get_cursor');
    if (res.startsWith('OK ')) {
      const parts = res.slice(3).split(',');
      return { x: parseInt(parts[0], 10) || 0, y: parseInt(parts[1], 10) || 0 };
    }
    return { x: 0, y: 0 };
  },

  getPixelColor: async (x, y) => {
    const res = await sendCmd(`get_pixel ${Math.round(Number(x) || 0)} ${Math.round(Number(y) || 0)}`);
    if (res.startsWith('OK ')) {
      return { ok: true, color: res.slice(3).trim().toLowerCase() };
    }
    return { ok: false, color: '' };
  },

  findColorInRegion: async (x, y, w, h, hexColor, tolerance = 16) => {
    const cleanHex = String(hexColor || '#ffffff').trim();
    const res = await sendCmd(`find_color ${Math.round(x || 0)} ${Math.round(y || 0)} ${Math.round(w || 100)} ${Math.round(h || 100)} ${cleanHex} ${Math.round(tolerance || 16)}`);
    if (res.startsWith('OK ')) {
      const parts = res.slice(3).trim().split(/\s+/);
      const matched = parts[0] === '1';
      const [fx, fy] = (parts[1] || '-1,-1').split(',').map((n) => parseInt(n, 10));
      return { ok: true, matched, x: fx, y: fy, actualColor: parts[2] || '' };
    }
    return { ok: false, matched: false, x: -1, y: -1 };
  },

  extractIcon: async (filePath, iconIndex = 0) => {
    if (!filePath) return null;
    const res = await sendCmd(`extract_icon ${parseInt(iconIndex, 10) || 0} ${filePath}`, 3500);
    if (res.startsWith('OK data:image/')) {
      return res.slice(3).trim();
    }
    return null;
  },

  queryAppPath: async (exeName) => {
    if (!exeName) return null;
    const res = await sendCmd(`app_path ${exeName}`, 1500);
    if (res.startsWith('OK ')) {
      return res.slice(3).trim();
    }
    return null;
  },

  getNetworkStats: async () => {
    const res = await sendCmd('net_stats', 1500);
    if (res.startsWith('OK ')) {
      const [rx, tx] = res.slice(3).trim().split('|').map((v) => parseFloat(v) || 0);
      return { ok: true, rxKbps: rx, txKbps: tx };
    }
    return { ok: false, rxKbps: 0, txKbps: 0 };
  },

  getProcessWindowTitles: async (names) => {
    const list = (Array.isArray(names) ? names : [names]).map((s) => String(s || '').trim().toLowerCase()).filter(Boolean);
    if (!list.length) return {};
    const key = list.join(',');
    const now = Date.now();
    if (procTitlesCache.key === key && (now - procTitlesCache.ts) < 1200) {
      return procTitlesCache.data;
    }
    const res = await sendCmd(`proc_titles ${key}`, 1500);
    const out = {};
    if (res.startsWith('OK')) {
      const raw = res.slice(2).trim();
      if (raw) {
        for (const pair of raw.split(';;')) {
          const idx = pair.indexOf('|');
          if (idx > 0) {
            const pName = pair.slice(0, idx).trim().toLowerCase();
            const title = pair.slice(idx + 1).trim();
            if (pName && title && !out[pName]) out[pName] = title;
          }
        }
      }
    }
    procTitlesCache = { ts: now, key, data: out };
    return out;
  },

  beep: async (isSuccess = true) => {
    await sendCmd(`beep ${isSuccess ? 'ok' : 'err'}`, 1000);
  },

  recordMacro: async (maxDurationMs = 15000) => {
    const rawMs = (maxDurationMs && typeof maxDurationMs === 'object')
      ? ((Number(maxDurationMs.maxMs) || (Number(maxDurationMs.maxSec) * 1000)) || 15000)
      : maxDurationMs;
    const dur = Math.max(1000, Math.min(60000, parseInt(rawMs, 10) || 15000));
    const res = await sendCmd(`record_macro ${dur}`, dur + 3000);
    if (res.startsWith('OK')) {
      const raw = res.slice(2).trim();
      if (!raw) return { ok: true, actions: [] };
      const actions = [];
      for (const token of raw.split(';')) {
        if (!token) continue;
        const parts = token.split(':');
        const kind = parts[0];
        if (kind === 'delay') {
          actions.push({ type: 'delay', ms: Math.max(20, parseInt(parts[1], 10) || 100) });
        } else if (kind === 'mouse_click') {
          actions.push({
            type: 'mouse_click',
            button: parts[1] || 'left',
            x: parseInt(parts[2], 10) || 0,
            y: parseInt(parts[3], 10) || 0,
            double: false,
          });
        } else if (kind === 'hotkey') {
          const combo = parts.slice(1).join(':');
          if (combo) actions.push({ type: 'hotkey', target: combo, combo });
        }
      }
      return { ok: true, actions };
    }
    return { ok: false, actions: [], error: res };
  },

  stopMacroRecord: async () => {
    await sendCmd('stop_record', 1500);
    return { ok: true };
  },

  mouseClick: (button = 'left', x = -1, y = -1) => {
    return sendCmd(`mouse_click ${button} ${x} ${y}`);
  },

  mouseMove: (x, y, relative = false, duration = 0) => {
    const dur = Math.max(0, Math.min(10000, parseInt(duration, 10) || 0));
    if (dur > 0) {
      return sendCmd(`mouse_move ${x} ${y} ${relative ? 'rel' : 'abs'} ${dur}`, dur + 2000);
    }
    return sendCmd(`mouse_move ${x} ${y} ${relative ? 'rel' : 'abs'}`);
  },

  mouseDrag: (fromX, fromY, toX, toY, duration = 150) => {
    const dur = Math.max(50, Math.min(10000, parseInt(duration, 10) || 150));
    return sendCmd(`mouse_drag ${fromX} ${fromY} ${toX} ${toY} ${dur}`, dur + 2000);
  },

  mouseWheel: (delta = 120) => {
    return sendCmd(`mouse_wheel ${delta}`);
  },

  sendText: (text) => {
    if (!text) return Promise.resolve('OK');
    return sendCmd(`text ${text}`);
  },

  sendHotkey: async (combo) => {
    if (!combo) return { ok: false };
    const res = await sendCmd(`hotkey ${combo}`);
    return { ok: res.startsWith('OK'), raw: res };
  },

  getForegroundWindow: async () => {
    const res = await sendCmd('fg_window');
    if (res.startsWith('OK ')) {
      const raw = res.slice(3).trim();
      if (!raw) return null;
      const [processName, pidStr, ...titleParts] = raw.split('|');
      return {
        processName: processName || '',
        pid: parseInt(pidStr, 10) || 0,
        title: titleParts.join('|') || '',
      };
    }
    return null;
  },

  checkProcesses: async (names) => {
    const cleanList = Array.from(new Set(
      (Array.isArray(names) ? names : [names])
        .map((n) => String(n || '').trim().replace(/\.exe$/i, '').toLowerCase())
        .filter(Boolean)
    ));
    if (cleanList.length === 0) return new Set();
    const res = await sendCmd(`check_procs ${cleanList.join(',')}`);
    if (res.startsWith('OK')) {
      const raw = res.slice(2).trim();
      if (!raw) return new Set();
      return new Set(raw.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean));
    }
    return null;
  },

  activateOrToggleWindow: async (procName, allowMinimize = false) => {
    if (!procName) return { ok: false, state: 'EMPTY' };
    const clean = String(procName).trim().replace(/\.exe$/i, '');
    const res = await sendCmd(`win_activate ${clean} ${allowMinimize ? '1' : '0'}`);
    if (res.startsWith('OK ')) {
      const state = res.slice(3).trim();
      return { ok: state === 'FOCUSED' || state === 'MINIMIZED', state };
    }
    return { ok: false, state: 'UNSUPPORTED', raw: res };
  },

  queryWindowState: async (procName) => {
    if (!procName) return 'NOT_RUNNING';
    const clean = String(procName).trim().replace(/\.exe$/i, '').toLowerCase();
    const res = await sendCmd(`win_state ${clean}`);
    if (res.startsWith('OK ')) {
      return res.slice(3).trim();
    }
    // 兼容未重编译旧版二进制的无缝回退判断
    const set = await NativeInput.checkProcesses([clean]);
    if (!set || !set.has(clean)) return 'NOT_RUNNING';
    const fg = await NativeInput.getForegroundWindow();
    if (fg && fg.processName && fg.processName.toLowerCase().replace(/\.exe$/i, '') === clean) {
      return 'FOREGROUND';
    }
    return 'BACKGROUND';
  },

  closeWindowGracefully: async (procName) => {
    if (!procName) return { ok: false };
    const res = await sendCmd(`win_close ${procName}`);
    return { ok: res.startsWith('OK'), raw: res };
  },

  setWindowRect: (x, y, w, h, target = '') => {
    const t = target ? ` ${target}` : '';
    return sendCmd(`window_rect ${x} ${y} ${w} ${h}${t}`);
  },

  sendMedia: (cmd) => {
    const raw = String(cmd || 'play_pause').toLowerCase();
    const mapped = raw.includes('next') ? 'next'
      : raw.includes('prev') ? 'prev'
      : raw.includes('mute') ? 'mute'
      : raw.includes('vol_up') ? 'vol_up'
      : raw.includes('vol_down') ? 'vol_down'
      : 'play_pause';
    return sendCmd(`media ${mapped}`);
  },

  getVolume: async () => {
    const res = await sendCmd('vol_get');
    if (res.startsWith('OK ')) {
      const parts = res.slice(3).split(' ');
      const level = parseInt(parts[0], 10) || 0;
      const isMute = parts[1] ? parts[1].includes('MUTE:1') : false;
      return { ok: true, level, isMute };
    }
    return { ok: false, level: 0, isMute: false };
  },

  setVolume: async (level) => {
    const res = await sendCmd(`vol_set ${Math.max(0, Math.min(100, parseInt(level, 10) || 0))}`);
    if (res.startsWith('OK ')) {
      const parts = res.slice(3).split(' ');
      const newLevel = parseInt(parts[0], 10) || 0;
      const isMute = parts[1] ? parts[1].includes('MUTE:1') : false;
      return { ok: true, level: newLevel, isMute };
    }
    return { ok: false, level: 0, isMute: false };
  },

  stepVolume: async (delta, triggerOsd = true) => {
    const res = await sendCmd(`vol_step ${parseInt(delta, 10) || 0} ${triggerOsd ? '1' : '0'}`);
    if (res.startsWith('OK ')) {
      const parts = res.slice(3).split(' ');
      const newLevel = parseInt(parts[0], 10) || 0;
      const isMute = parts[1] ? parts[1].includes('MUTE:1') : false;
      return { ok: true, level: newLevel, isMute };
    }
    return { ok: false, level: 0, isMute: false };
  },

  toggleMute: async (triggerOsd = true) => {
    const res = await sendCmd(`vol_mute_toggle ${triggerOsd ? '1' : '0'}`);
    if (res.startsWith('OK ')) {
      const isMute = res.includes('MUTE:1');
      const parts = res.slice(3).split(' ');
      const level = parts[1] ? parseInt(parts[1], 10) : 0;
      return { ok: true, isMute, level };
    }
    return { ok: false, isMute: false, level: 0 };
  },

  getAudioDevices: async () => {
    const res = await sendCmd('audio_devices');
    if (res.startsWith('OK ')) {
      const raw = res.slice(3).trim();
      if (!raw) return [];
      const list = raw.split(';').map(item => {
        const parts = item.split('|');
        return {
          id: parts[0] || '',
          name: parts[1] || '音频设备',
          isDefault: parts[2] === '1'
        };
      });
      return list;
    }
    return [];
  },

  switchAudioDevice: async (target = '') => {
    const res = await sendCmd(`audio_switch ${target}`.trim());
    if (res.startsWith('OK ')) {
      const name = res.slice(3).trim();
      return { ok: true, name, device: name };
    }
    return { ok: false, error: res.replace(/^ERR\s*/, '') };
  },

  setDevicePath: (devPath) => {
    if (!devPath) return Promise.resolve('OK');
    return sendCmd(`set_device_path ${devPath}`);
  },

  blackoutHardware: () => {
    return sendCmd('blackout_hardware');
  },

  shutdownBlock: (hwndOrReason, reason) => {
    let hwnd = 0;
    let r = reason;
    if (typeof hwndOrReason === 'string' && isNaN(Number(hwndOrReason))) {
      r = hwndOrReason;
      hwnd = 0;
    } else if (hwndOrReason != null) {
      hwnd = hwndOrReason;
    }
    const finalReason = r || 'AKP153 控制台正在安全关闭并休眠屏幕...';
    return sendCmd(`shutdown_block ${hwnd} ${finalReason}`);
  },

  shutdownUnblock: (hwnd = 0) => {
    return sendCmd(`shutdown_unblock ${hwnd || 0}`);
  },

  on: (evt, listener) => {
    evtBus.on(evt, listener);
    ensureDaemon();
    return () => evtBus.removeListener(evt, listener);
  },

  off: (evt, listener) => {
    evtBus.removeListener(evt, listener);
  },

  watchProcesses: (names) => {
    const arr = Array.isArray(names) ? names : [names];
    const cleaned = Array.from(new Set(
      arr.map(n => String(n || '').trim().replace(/\.exe$/i, '').toLowerCase()).filter(Boolean)
    ));
    lastWatchProcsCsv = cleaned.join(',');
    return sendCmd(`watch_procs ${lastWatchProcsCsv}`);
  },

  ackHostBlackout: () => {
    return sendCmd('host_blackout_ack', 800);
  },

  setSleepState: (asleep) => {
    return sendCmd(`set_sleep_state ${asleep ? '1' : '0'}`, 800);
  },

  getAudioPeak: async () => {
    const res = await sendCmd('audio_peak', 1000);
    if (res.startsWith('OK ')) {
      const [masterPeak, micPeak] = res.slice(3).trim().split('|').map((v) => parseInt(v, 10) || 0);
      return { ok: true, masterPeak, micPeak };
    }
    return { ok: false, masterPeak: 0, micPeak: 0 };
  },

  listAppAudioSessions: async () => {
    const res = await sendCmd('app_audio_list', 1800);
    if (res.startsWith('OK')) {
      const raw = res.slice(2).trim();
      if (!raw) return [];
      return raw.split(';;').map((row) => {
        const [processName, title, pct, mute, peak] = row.split('|');
        return {
          processName: (processName || '').trim(),
          title: (title || processName || '').trim(),
          level: Math.max(0, Math.min(100, parseInt(pct, 10) || 0)),
          isMute: mute === '1',
          peak: Math.max(0, Math.min(100, parseInt(peak, 10) || 0)),
        };
      }).filter((x) => x.processName);
    }
    return [];
  },

  parseAppAudioResp: (res) => {
    if (typeof res === 'string' && res.startsWith('OK ')) {
      const parts = res.slice(3).trim().split(/\s+/);
      const processName = parts[0] || '';
      const level = Math.max(0, Math.min(100, parseInt(parts[1], 10) || 0));
      const isMute = res.includes('MUTE:1');
      const peakMatch = res.match(/PEAK:(\d+)/);
      const peak = peakMatch ? Math.max(0, Math.min(100, parseInt(peakMatch[1], 10) || 0)) : 0;
      return { ok: true, processName, level, isMute, peak };
    }
    return { ok: false, processName: '', level: 0, isMute: false, peak: 0, error: String(res || '') };
  },

  getAppAudio: async (target = '@foreground') => {
    const clean = String(target || '@foreground').trim().replace(/\s+/g, '') || '@foreground';
    const res = await sendCmd(`app_audio_get ${clean}`, 1500);
    return NativeInput.parseAppAudioResp(res);
  },

  setAppAudioVolume: async (target = '@foreground', level = 50) => {
    const clean = String(target || '@foreground').trim().replace(/\s+/g, '') || '@foreground';
    const lvl = Math.max(0, Math.min(100, parseInt(level, 10) || 0));
    const res = await sendCmd(`app_audio_set ${clean} ${lvl}`, 1500);
    return NativeInput.parseAppAudioResp(res);
  },

  stepAppAudioVolume: async (target = '@foreground', delta = 5) => {
    const clean = String(target || '@foreground').trim().replace(/\s+/g, '') || '@foreground';
    const d = Math.max(-100, Math.min(100, parseInt(delta, 10) || 5));
    const res = await sendCmd(`app_audio_step ${clean} ${d}`, 1500);
    return NativeInput.parseAppAudioResp(res);
  },

  toggleAppAudioMute: async (target = '@foreground', mode = 'toggle') => {
    const clean = String(target || '@foreground').trim().replace(/\s+/g, '') || '@foreground';
    const m = mode === true || mode === 1 || mode === '1' ? '1'
      : mode === false || mode === 0 || mode === '0' ? '0'
      : 'toggle';
    const res = await sendCmd(`app_audio_mute ${clean} ${m}`, 1500);
    return NativeInput.parseAppAudioResp(res);
  },

  stop: () => {
    flushPending('ERR DAEMON_STOPPED');
    if (daemonProc) {
      try {
        daemonProc.stdin.write('quit\n');
        daemonProc.kill();
      } catch (_) {}
      daemonProc = null;
    }
  }
};

module.exports = NativeInput;
