'use strict';
/**
 * native-input.js - 原生 1ms 零延迟键鼠、窗口、进程探测与音频驱动桥接
 *
 * 采用常驻子进程管道通信，将所有输入与窗口操作的延迟压缩至 0.1~1ms。
 * 具备：
 * 1. 自动按需编译更新：若检测到 native-input.cs 比 bin/akp-input.exe 更新，自动调用系统 .NET csc.exe 重编译；
 * 2. 异步流水号 + FIFO 双模守卫：支持 @id 异步乱序回调（耗时鼠标平滑移动绝不阻塞音量/窗口查询），同时向下兼容旧版二进制；
 * 3. 安全参数隔离与多行清洗：降级模式采用 spawnSync 参数数组传递，彻底杜绝 cmd 命令行注入。
 */
const { spawn, spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const BIN_PATH = path.join(__dirname, '..', '..', 'bin', 'akp-input.exe');
const CS_PATH = path.join(__dirname, 'native-input.cs');

let daemonProc = null;
let pendingQueue = []; // [{ id, resolve, timer }]
let reqSeq = 0;
let supportsIdPrefix = true; // 自动协商：若发现旧版二进制未编译支持 @id，则自动无缝回退
let compileChecked = false;

/**
 * 若在 Windows 环境下发现 native-input.cs 源码比 akp-input.exe 更新，自动调用内置 .NET Framework csc.exe 编译
 */
function ensureCompiledBinary() {
  if (compileChecked) return;
  compileChecked = true;
  if (process.platform !== 'win32') return;
  if (!fs.existsSync(CS_PATH)) return;

  try {
    let needBuild = !fs.existsSync(BIN_PATH);
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
    const r = spawnSync(csc, ['/nologo', '/optimize+', '/target:exe', `/out:${tmpOut}`, CS_PATH], {
      windowsHide: true,
      timeout: 8000,
    });
    if (r.status === 0 && fs.existsSync(tmpOut)) {
      try {
        fs.renameSync(tmpOut, BIN_PATH);
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

        // 优先匹配 @<id> 异步完成回调
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

        // 若收到旧版二进制对 @id 的未知指令报错，自动降级为无前缀模式并重发
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

/**
 * 向常驻输入引擎发送一条单行指令并等待执行确认 (0.1~1ms)，具备超时与防换行截断保护
 */
function sendCmd(cmdStr, timeoutMs = 4000) {
  // 清洗任何意外的换行符，防止单条指令被拆成多行污染管道队列
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
      // 安全降级：使用 spawnSync 参数数组传递，杜绝 shell 字符串拼接导致的命令注入
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

const NativeInput = {
  getCursor: async () => {
    const res = await sendCmd('get_cursor');
    if (res.startsWith('OK ')) {
      const parts = res.slice(3).split(',');
      return { x: parseInt(parts[0], 10) || 0, y: parseInt(parts[1], 10) || 0 };
    }
    return { x: 0, y: 0 };
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

  /**
   * 毫秒级批量查询进程是否存活（耗时 ~0.5ms，彻底替代阻塞主进程的 spawnSync('tasklist')）
   * @param {string[]} names 进程名数组
   * @returns {Promise<Set<string>>} 正在运行的进程名集合（小写、无 .exe 后缀）
   */
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
    return null; // null 表示守护进程不支持该指令，由调用方降级
  },

  activateOrToggleWindow: async (procName, allowMinimize = false) => {
    if (!procName) return { ok: false, state: 'EMPTY' };
    const res = await sendCmd(`win_activate ${procName} ${allowMinimize ? '1' : '0'}`);
    if (res.startsWith('OK ')) {
      const state = res.slice(3).trim();
      return { ok: state === 'FOCUSED' || state === 'MINIMIZED', state };
    }
    return { ok: false, state: 'UNSUPPORTED', raw: res };
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
    return sendCmd(`media ${cmd}`);
  },

  // 音频与音量原生控制接口 (0.1ms WASAPI CoreAudio)
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

  setDevicePath: (path) => {
    if (!path) return Promise.resolve('OK');
    return sendCmd(`set_device_path ${path}`);
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
