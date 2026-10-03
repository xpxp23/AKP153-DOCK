'use strict';
/**
 * native-input.js - 原生 1ms 零延迟键鼠与窗口驱动桥接
 *
 * 采用常驻子进程管道通信，将所有输入与窗口操作的延迟压缩至 0.1~1ms。
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const BIN_PATH = path.join(__dirname, '..', '..', 'bin', 'akp-input.exe');

let daemonProc = null;
let pendingResolvers = [];

function ensureDaemon() {
  if (daemonProc && !daemonProc.killed) return daemonProc;
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
      buffer = lines.pop(); // 保留未成行的片段

      for (const line of lines) {
        const trimmed = line.trim();
        if (pendingResolvers.length > 0) {
          const resolve = pendingResolvers.shift();
          resolve(trimmed);
        }
      }
    });

    daemonProc.on('error', () => { daemonProc = null; });
    daemonProc.on('exit', () => { daemonProc = null; });
    daemonProc.unref();
    return daemonProc;
  } catch (e) {
    daemonProc = null;
    return null;
  }
}

/**
 * 向常驻输入引擎发送一条指令并等待执行确认 (0.1ms)
 */
function sendCmd(cmdStr) {
  return new Promise((resolve) => {
    const daemon = ensureDaemon();
    if (daemon && daemon.stdin && daemon.stdin.writable) {
      pendingResolvers.push(resolve);
      daemon.stdin.write(cmdStr.trim() + '\n');
    } else {
      // 降级为单次调用
      try {
        const { execSync } = require('child_process');
        const out = execSync(`"${BIN_PATH}" ${cmdStr}`, {
          encoding: 'utf8',
          windowsHide: true,
          timeout: 2000,
        });
        resolve(out.trim());
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

  mouseMove: (x, y, relative = false) => {
    return sendCmd(`mouse_move ${x} ${y} ${relative ? 'rel' : 'abs'}`);
  },

  mouseDrag: (fromX, fromY, toX, toY) => {
    return sendCmd(`mouse_drag ${fromX} ${fromY} ${toX} ${toY}`);
  },

  mouseWheel: (delta = 120) => {
    return sendCmd(`mouse_wheel ${delta}`);
  },

  sendText: (text) => {
    if (!text) return Promise.resolve('OK');
    return sendCmd(`text ${text}`);
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
      return { ok: true, name: res.slice(3).trim() };
    }
    return { ok: false, error: res.replace(/^ERR\s*/, '') };
  },

  stop: () => {
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
