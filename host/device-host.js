'use strict';
/**
 * AKP153 / Multi-Model StreamDock Device Host (v0.12.0)
 *
 * 架构升级亮点 (v0.12.0)：
 *   1. 双通道优先级调度锁 (Dual-Lane Priority Scheduler)：
 *      - 高优通道 (High-Priority Lane)：负责 wake/sleep、亮度控制、单键状态即时重绘与按压回弹帧。
 *      - 批量通道 (Bulk Preemptible Lane)：负责 18 键整页重绘与后台遥测，每写完 1 颗按键自动让出总线并优先排空高优通道，
 *        彻底消灭「唤醒或后台遥测刷屏期间按键无反馈/卡顿 500ms」的队头阻塞。
 *   2. 智能唤醒首按直通 (Wake-On-Key Pass-Through)：
 *      - 支持在黑屏休眠态下按任意键瞬间点亮屏幕并同步透传触发该键绑定的动作，告别「唤醒吃掉第一下、必须按两次」。
 *   3. USB 选择性挂起防休眠心跳 (CMD.CONNECT Keep-Alive Heartbeat)：
 *      - 后台静置时每 18 秒自动发送轻量级 CONNECT 报文保活 USB HID 链路，杜绝操作系统或底座固件总线深睡导致首按丢包。
 */

const path = require('path');
const {
  getHardwareProfile,
  detectHardwareProfileByUsb,
  posToDeviceIndex,
} = require(path.join(__dirname, '..', 'src', 'main', 'hardware-profiles.js'));

let HID = null;
try {
  HID = require('node-hid');
} catch (_) {
  // Handled gracefully in open() / watchdog if node-hid is not installed yet
}

const CANDIDATES = [
  { vendorId: 0x5548, productId: 0x6674, profileId: 'akp153' }, // AJAZZ AKP-153
  { vendorId: 0x5548, productId: 0x6670, profileId: 'akp153' }, // AKP153E / HSV293S
  { vendorId: 0x0300, productId: 0x1010, profileId: 'akp153' }, // alternate id seen in the wild
  { vendorId: 0x0300, productId: 0x1020, profileId: 'akp153' },
  { vendorId: 0x0300, productId: 0x3004, profileId: 'akp153' },
  { vendorId: 0x6603, productId: 0x1005, profileId: 'akp153' },
  { vendorId: 0x0300, productId: 0x1011, profileId: 'akp03' },  // AJAZZ AKP03 (knob model)
  { vendorId: 0x0300, productId: 0x1030, profileId: 'akp03' },
  { vendorId: 0x5548, productId: 0x6672, profileId: 'akp03' },
  { vendorId: 0x0300, productId: 0x1001, profileId: 'streamdock_15' },
  { vendorId: 0x5548, productId: 0x0001, profileId: 'streamdock_15' },
];

const PREFIX = Buffer.from([67, 82, 84, 0, 0]); // "CRT\0\0"

const PACKET = 512;
const PKT = PACKET + 1;

const CMD = {
  DIS: [68, 73, 83],                       // wake panel
  STP: [83, 84, 80],                       // commit / refresh
  HAN: [72, 65, 78],                       // screen sleep
  CONNECT: [67, 79, 78, 78, 69, 67, 84],   // heartbeat
  CLEAR_ALL: [67, 76, 69, 0, 0, 0, 255],   // "CLE" \0 \0 \0 0xff
};

const RECONNECT_MS = 2000;
const HEARTBEAT_INTERVAL_MS = 18000;

function buttonId(row, col, profileId = 'akp153') {
  return posToDeviceIndex(row, col, profileId);
}

function stripId(row) {
  return 16 + row;
}

function resolution(col) {
  return col === 5 ? 80 : 96;
}

function gamma(pct) {
  const t = Math.max(0, Math.min(100, Math.round(Number(pct) || 0)));
  return Math.round(100 * Math.pow(t / 100, 0.75));
}

class Device {
  constructor() {
    this.hid = null;
    this.info = null;
    this.profileId = 'akp153';
    this.hardwareProfile = getHardwareProfile('akp153');
    this.asleep = false;
    this.broken = false;
    this.brightness = 80;
    this.savedBrightness = 80;
    this.debounceMs = 80;
    this.wakePassThrough = true; // 唤醒首按直通：休眠时按键既点亮屏幕又立即触发按键动作
    this.lastSleepMode = 'zeros-last';
    this.queue = Promise.resolve();
    this.highPriorityQueue = []; // [{ fn, resolve, reject }]
    this._drainingHigh = false;
    this.lastWriteAt = 0;
    this.lastHighDrawAt = new Map(); // "${row},${col}" -> timestamp
    this.watchdog = null;
    this.heartbeatTimer = null;
    this.stopped = false;   // set by the 'close' command to stop self-healing
    this.lastPress = new Map();
    this.activeDownKeys = new Set(); // tracks state===1 keys on button-mode hardware
    this.lastFrames = new Map(); // "${row},${col}" -> jpegBase64 (Frame Diff Cache)
    this.animations = new Map(); // "${row},${col}" -> { frames, fps, loop, idx, lastTick }
    this.animTimer = null;
    this._animBusy = false;
    this._abortDraw = false;
    this.fullBatchSeq = 0;
    this.fullBatchEpoch = 0;
    this._pktBuf = Buffer.alloc(PKT);
  }

  get isOpen() {
    return !!this.hid && !this.broken;
  }

  setHardwareProfile(profileId) {
    const prof = getHardwareProfile(profileId);
    this.profileId = prof.id;
    this.hardwareProfile = prof;
    return prof;
  }

  setDebounce(ms) {
    const val = Number(ms);
    if (!Number.isNaN(val) && val >= 15 && val <= 1000) {
      this.debounceMs = Math.round(val);
    }
    return this.debounceMs;
  }

  setWakePassThrough(enable) {
    this.wakePassThrough = enable !== false;
    return this.wakePassThrough;
  }

  lockHigh(fn) {
    return new Promise((resolve, reject) => {
      this.highPriorityQueue.push({ fn, resolve, reject });
      if (!this._drainingHigh) {
        this.lock(() => this._drainHighPriority());
      }
    });
  }

  async _drainHighPriority() {
    if (this._drainingHigh) return;
    this._drainingHigh = true;
    try {
      while (this.highPriorityQueue.length > 0) {
        const item = this.highPriorityQueue.shift();
        try {
          const res = await item.fn();
          item.resolve(res);
        } catch (err) {
          item.reject(err);
        }
      }
    } finally {
      this._drainingHigh = false;
    }
  }

  lock(fn) {
    const next = this.queue.then(async () => {
      await this._drainHighPriority();
      return await fn();
    }, async () => {
      await this._drainHighPriority();
      return await fn();
    });
    this.queue = next.catch(() => {});
    return next;
  }

  startAnim(row, col, frames, fps = 10, loop = true) {
    if (!Array.isArray(frames) || frames.length === 0) return false;
    const key = `${row},${col}`;
    const isTransient = loop === false && frames.length <= 4;
    const maxFps = isTransient ? 20 : 12;
    const clampedFps = Math.max(2, Math.min(maxFps, Number(fps) || 10));
    this.animations.set(key, {
      row: Number(row),
      col: Number(col),
      frames,
      fps: clampedFps,
      intervalMs: Math.round(1000 / clampedFps),
      loop: loop !== false,
      idx: 0,
      lastTick: 0,
      isTransient,
    });
    if (isTransient && this.isOpen && !this.asleep && frames[0]) {
      const anim = this.animations.get(key);
      if (anim) {
        anim.lastTick = Date.now();
        anim.idx = 1;
        this.lockHigh(async () => {
          if (!this.asleep && this.isOpen) {
            this._drawUnlocked(Number(row), Number(col), frames[0], false);
          }
        }).catch(() => {});
      }
    }
    this._ensureAnimLoop();
    return true;
  }

  stopAnim(row, col, restoreFrame = null) {
    const key = `${row},${col}`;
    this.animations.delete(key);
    if (this.animations.size === 0 && this.animTimer) {
      clearInterval(this.animTimer);
      this.animTimer = null;
    }
    if (restoreFrame && this.isOpen && !this.asleep) {
      this.draw(Number(row), Number(col), restoreFrame, true).catch(() => {});
    }
    return true;
  }

  clearAnims() {
    this.animations.clear();
    if (this.animTimer) {
      clearInterval(this.animTimer);
      this.animTimer = null;
    }
  }

  _ensureAnimLoop() {
    if (this.animTimer) return;
    this.animTimer = setInterval(async () => {
      if (this._animBusy || this.asleep || !this.isOpen || this._abortDraw || this.animations.size === 0) {
        if (this.animations.size === 0 && this.animTimer) {
          clearInterval(this.animTimer);
          this.animTimer = null;
        }
        return;
      }
      const now = Date.now();
      const due = [];
      const activeLoopCount = Array.from(this.animations.values()).filter((a) => a.loop).length;
      const budgetLoadFactor = activeLoopCount > 3 ? (1 + (activeLoopCount - 3) * 0.22) : 1;
      for (const [key, anim] of this.animations.entries()) {
        const effectiveInterval = anim.loop ? Math.round(anim.intervalMs * budgetLoadFactor) : anim.intervalMs;
        if (now - anim.lastTick >= effectiveInterval) {
          anim.lastTick = now;
          const frameData = anim.frames[anim.idx];
          if (frameData && due.length < 4) {
            due.push({ row: anim.row, col: anim.col, data: frameData, force: false, isTransient: !!anim.isTransient });
          }
          anim.idx++;
          if (anim.idx >= anim.frames.length) {
            if (anim.loop) {
              anim.idx = 0;
            } else {
              this.animations.delete(key);
            }
          }
        }
      }
      if (due.length > 0) {
        this._animBusy = true;
        try {
          const hasTransient = due.some((d) => d.isTransient);
          const runnerFn = async () => {
            for (const it of due) {
              if (this.asleep || this._abortDraw || !this.isOpen) break;
              this._drawUnlocked(it.row, it.col, it.data, false);
            }
          };
          if (hasTransient) await this.lockHigh(runnerFn);
          else await this.lock(runnerFn);
        } catch (_) {
        } finally {
          this._animBusy = false;
        }
      }
    }, 40);
    if (this.animTimer.unref) this.animTimer.unref();
  }

  close() {
    this.activeDownKeys.clear();
    this.clearAnims();
    this.lastFrames.clear();
    this.lastHighDrawAt.clear();
    if (this.hid) {
      try { this.hid.removeAllListeners('data'); } catch (e) { /* ignore */ }
      try { this.hid.removeAllListeners('error'); } catch (e) { /* ignore */ }
      try { this.hid.close(); } catch (e) { /* ignore */ }
      this.hid = null;
    }
    this.info = null;
  }

  open() {
    this.close();
    this.broken = false;
    this.stopped = false;

    if (!HID) throw new Error('NODE_HID_MISSING');
    const all = HID.devices();
    const matches = [];
    for (const c of CANDIDATES) {
      for (const d of all) {
        if (d.vendorId === c.vendorId && d.productId === c.productId && d.path) {
          matches.push({ dev: d, candidateProfileId: c.profileId });
        }
      }
    }
    if (matches.length === 0) throw new Error('DEVICE_NOT_FOUND');

    let lastErr = null;
    for (const item of matches) {
      const d = item.dev;
      try {
        const h = new HID.HID(d.path);
        this.hid = h;
        this.info = d;
        const detected = detectHardwareProfileByUsb(d.vendorId, d.productId, d.product || '');
        this.setHardwareProfile(detected ? detected.id : (item.candidateProfileId || 'akp153'));
        this.attach();
        this.startHeartbeat();
        return d;
      } catch (e) {
        lastErr = e;
      }
    }
    if (lastErr && /busy|access|denied|EBUSY/i.test(String(lastErr.message))) {
      throw new Error('DEVICE_BUSY');
    }
    throw new Error('OPEN_FAILED: ' + (lastErr && lastErr.message));
  }

  startHeartbeat() {
    if (this.heartbeatTimer) return;
    this.heartbeatTimer = setInterval(() => {
      if (this.stopped || !this.isOpen || this.asleep || this._animBusy || this._drainingHigh) return;
      const idleMs = Date.now() - (this.lastWriteAt || 0);
      if (idleMs >= 15000) {
        this.cmd(CMD.CONNECT).catch(() => {});
      }
    }, HEARTBEAT_INTERVAL_MS);
    if (this.heartbeatTimer.unref) this.heartbeatTimer.unref();
  }

  attach() {
    const hid = this.hid;
    hid.on('error', (err) => {
      const message = String((err && err.message) || err);
      this.broken = true;
      this.lastFrames.clear();
      emit({ event: 'lost', message });
    });
    hid.on('data', (data) => {
      if (!data || data.length < 10) return;
      const id = data[9];
      const state = data.length > 10 ? data[10] : 0;
      if (!id) return;

      const prof = this.hardwareProfile || getHardwareProfile(this.profileId);

      // 1. 优先识别旋钮编码器报文 (如 AKP03 左旋/右旋/按下)
      if (prof.protocol && prof.protocol.supportsEncoderEvent && prof.protocol.encoderMap && prof.protocol.encoderMap[id]) {
        const enc = prof.protocol.encoderMap[id];
        if (this.asleep) {
          this.asleep = false;
          const wakeB = this.savedBrightness || this.brightness || 80;
          this.wake(wakeB, true).catch(() => {});
          emit({ event: 'wake', by: 'encoder', knob: enc.knob, dir: enc.dir, passThrough: !!this.wakePassThrough });
          if (this.wakePassThrough) {
            emit({ event: 'encoder', knob: enc.knob, dir: enc.dir, rawCode: id, profileId: prof.id, fromWake: true });
          }
          return;
        }
        emit({
          event: 'encoder',
          knob: enc.knob,
          dir: enc.dir,
          rawCode: id,
          profileId: prof.id,
        });
        return;
      }

      // 2. 识别网格按键坐标
      let pos = null;
      const rows = prof.grid.rows;
      const cols = prof.grid.cols;
      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
          if (buttonId(row, col, prof.id) === id) {
            pos = { row, col };
            break;
          }
        }
        if (pos) break;
      }
      process.stderr.write(`[input] len=${data.length} id=${id} state=${state} mapped=${!!pos} model=${prof.id}\n`);
      if (!pos) return;

      const key = pos.row + ',' + pos.col;
      const now = Date.now();
      const threshold = Math.max(15, Number(this.debounceMs) || 80);

      // 休眠态下按键唤醒：立即高优恢复背光，并根据 wakePassThrough 决定是否直通触发该键动作
      if (this.asleep) {
        if (state === 0 && this.activeDownKeys.has(key)) {
          this.activeDownKeys.delete(key);
          return;
        }
        process.stderr.write(`[input] key press while asleep at r${pos.row}c${pos.col} -> wake (passThrough=${this.wakePassThrough})\n`);
        this.asleep = false;
        this.lastPress.set(key, now);
        this.activeDownKeys.clear();
        const wakeB = this.savedBrightness || this.brightness || 80;
        this.wake(wakeB, true).catch(() => {});
        emit({ event: 'wake', by: 'key', row: pos.row, col: pos.col, passThrough: !!this.wakePassThrough });
        if (this.wakePassThrough) {
          emit({ event: 'down', row: pos.row, col: pos.col, profileId: prof.id, fromWake: true });
          if (state !== 1) {
            emit({ event: 'up', row: pos.row, col: pos.col, profileId: prof.id, fromWake: true });
          } else {
            this.activeDownKeys.add(key);
          }
        }
        return;
      }

      if (state === 1) {
        if (now - (this.lastPress.get(key) || 0) < threshold) return;
        this.lastPress.set(key, now);
        this.activeDownKeys.add(key);
        emit({ event: 'down', row: pos.row, col: pos.col, profileId: prof.id });
        return;
      }

      if (state === 0 && this.activeDownKeys.has(key)) {
        this.activeDownKeys.delete(key);
        emit({ event: 'up', row: pos.row, col: pos.col, profileId: prof.id });
        return;
      }

      if (now - (this.lastPress.get(key) || 0) < threshold) return;
      this.lastPress.set(key, now);

      emit({ event: 'down', row: pos.row, col: pos.col, profileId: prof.id });
      emit({ event: 'up', row: pos.row, col: pos.col, profileId: prof.id });
    });
  }

  pad(buf) {
    if (buf.length === PKT) return buf;
    const out = Buffer.alloc(PKT);
    buf.copy(out, 0, 0, Math.min(buf.length, PKT));
    return out;
  }

  writeRaw(buf) {
    if (this.broken || !this.hid) throw new Error('NOT_OPEN');
    if (buf.length !== PKT) throw new Error('BAD_PACKET_SIZE ' + buf.length + ' != ' + PKT);
    let n;
    try {
      n = this.hid.write(buf);
      this.lastWriteAt = Date.now();
    } catch (e) {
      this.broken = true;
      this.lastFrames.clear();
      throw new Error('WRITE_FAILED ' + ((e && e.message) || e));
    }
    if (typeof n === 'number' && n < buf.length) {
      this.broken = true;
      this.lastFrames.clear();
      throw new Error('SHORT_WRITE ' + n + '/' + buf.length);
    }
    return n;
  }

  cmd(bytes) {
    return this.lockHigh(async () => {
      return this.writeRaw(this.pad(Buffer.concat([Buffer.from([0]), PREFIX, Buffer.from(bytes)])));
    });
  }

  async setBrightness(pct) {
    const val = Number(pct);
    this.brightness = val;
    if (val > 0) {
      this.savedBrightness = val;
    }
    await this.cmd([76, 73, 71, 0, 0, gamma(val)]);
  }

  async setLedBrightness(pct) {
    const val = Number(pct);
    await this.cmd([76, 66, 76, 73, 71, gamma(val)]);
  }

  _drawUnlocked(row, col, jpegBase64, force = false) {
    if (this.asleep) {
      return { drawn: false, skipped: true };
    }
    const id = col === 5 ? stripId(row) : buttonId(row, col, this.profileId);
    if (id === null) throw new Error('BAD_POSITION');
    if (!jpegBase64) throw new Error('EMPTY_IMAGE');

    const frameKey = `${row},${col}`;
    if (!force && this.lastFrames.get(frameKey) === jpegBase64) {
      return { drawn: false, skipped: true };
    }

    const img = Buffer.from(jpegBase64, 'base64');
    const total = img.length;
    if (total === 0) throw new Error('EMPTY_IMAGE');

    const bat = Buffer.concat([
      Buffer.from([0]), PREFIX,
      Buffer.from([66, 65, 84, (total >> 24) & 255, (total >> 16) & 255, (total >> 8) & 255, total & 255, id]),
    ]);
    this.writeRaw(this.pad(bat));
    const pkt = this._pktBuf;
    for (let off = 0; off < total; off += PACKET) {
      const chunk = img.subarray(off, off + PACKET);
      pkt[0] = 0;
      chunk.copy(pkt, 1);
      if (chunk.length < PACKET) {
        pkt.fill(0, 1 + chunk.length);
      }
      this.writeRaw(pkt);
    }
    this.writeRaw(this.pad(Buffer.concat([Buffer.from([0]), PREFIX, Buffer.from(CMD.STP)])));
    this.lastFrames.set(frameKey, jpegBase64);
    return { drawn: true, skipped: false };
  }

  async draw(row, col, jpegBase64, force = false) {
    if (this.asleep) {
      const now = Date.now();
      if (now - (this.lastSkipLog || 0) > 5000) {
        this.lastSkipLog = now;
        process.stderr.write(`[draw] SKIPPED r${row}c${col} - panel is asleep\n`);
      }
      return { drawn: false, skipped: true };
    }
    const id = col === 5 ? stripId(row) : buttonId(row, col, this.profileId);
    if (id === null) throw new Error('BAD_POSITION');
    if (!jpegBase64) throw new Error('EMPTY_IMAGE');

    const frameKey = `${row},${col}`;
    const existingAnim = this.animations.get(frameKey);
    if (existingAnim && (force || !existingAnim.loop)) {
      this.animations.delete(frameKey);
    }

    if (!force && this.lastFrames.get(frameKey) === jpegBase64) {
      return { drawn: false, skipped: true };
    }

    const drawTs = Date.now();
    this.lastHighDrawAt.set(frameKey, drawTs);
    return this.lockHigh(async () => {
      return this._drawUnlocked(row, col, jpegBase64, force);
    });
  }

  async batchDraw(items, opts = {}) {
    const list = Array.isArray(items) ? items : [];
    const full = !!opts.full && list.length > 1;
    const epoch = Number(opts.epoch) || 0;
    if (this.asleep) {
      return {
        drawn: 0,
        skipped: list.length,
        failed: [],
        missing: list.filter(Boolean).map((it) => ({ row: it.row, col: it.col })),
        aborted: true,
      };
    }
    if (list.length === 0) return { drawn: 0, skipped: 0, failed: [], missing: [], aborted: false };

    const batchEnqueuedAt = Date.now();
    let mySeq = this.fullBatchSeq;
    if (full) {
      this.fullBatchSeq += 1;
      mySeq = this.fullBatchSeq;
      this.fullBatchEpoch = Math.max(this.fullBatchEpoch, epoch);
    }

    return this.lock(async () => {
      let drawn = 0;
      let skipped = 0;
      const failed = [];
      const missing = [];
      let idx = 0;
      for (const it of list) {
        if (this.highPriorityQueue.length > 0) {
          await this._drainHighPriority();
        }
        const superseded = full && this.fullBatchSeq !== mySeq;
        if (!it) { skipped++; continue; }
        if (this.asleep || this._abortDraw || superseded) {
          missing.push({ row: it.row, col: it.col });
          continue;
        }
        const frameKey = `${it.row},${it.col}`;
        const lastHighTs = this.lastHighDrawAt.get(frameKey) || 0;
        if (!full && lastHighTs > batchEnqueuedAt) {
          skipped++;
          continue;
        }
        if (it.force) {
          this.animations.delete(frameKey);
        } else {
          const existingAnim = this.animations.get(frameKey);
          if (existingAnim && !existingAnim.loop) {
            this.animations.delete(frameKey);
          }
        }
        try {
          const r = this._drawUnlocked(it.row, it.col, it.data, !!it.force);
          if (r && r.drawn) drawn++;
          else skipped++;
        } catch (err) {
          failed.push({ row: it.row, col: it.col, error: (err && err.message) || String(err) });
          missing.push({ row: it.row, col: it.col });
        }

        idx++;
        if (idx < list.length) {
          await new Promise((resolve) => setImmediate(resolve));
        }
      }
      return { drawn, skipped, failed, missing, aborted: missing.length > 0 };
    });
  }

  async clearScreen() {
    this.lastFrames.clear();
    await this.cmd(CMD.CLEAR_ALL);
  }

  async clearKey(id) {
    this.lastFrames.clear();
    await this.cmd([67, 76, 69, 0, 0, 0, id]);
  }

  static SLEEP_MODES = ['zeros-last', 'blackout', 'vendor', 'nobright', 'light'];

  async sleep(mode, force) {
    const m = Device.SLEEP_MODES.includes(mode) ? mode : (this.lastSleepMode || 'zeros-last');
    if (m !== 'blackout') {
      this.lastSleepMode = m;
    }
    if (this.asleep && m !== 'blackout' && !force) {
      return ['mode=' + m, 'already_asleep=ok'];
    }
    if (!this.isOpen) {
      try { this.open(); } catch (e) { /* emergency reconnect */ }
    }
    const report = [];
    const step = async (name, fn) => {
      try { await fn(); report.push(name + '=ok'); }
      catch (e) { report.push(name + '=FAIL:' + e.message); }
    };

    const wasAlreadyAsleep = this.asleep;
    if (this.brightness > 0) {
      this.savedBrightness = this.brightness;
    }
    this.asleep = true;
    this._abortDraw = true;
    this.activeDownKeys.clear();
    this.clearAnims();
    this.lastFrames.clear();
    const waitHw = (ms) => new Promise((r) => setTimeout(r, ms));
    if (m === 'blackout') {
      if (!wasAlreadyAsleep) {
        await step('CLEAR_ALL', () => this.clearScreen());
        await waitHw(30);
      }
      await step('LBLIG0', () => this.setLedBrightness(0));
      await waitHw(15);
      await step('LIG0', () => this.setBrightness(0));
      await waitHw(15);
      await step('HAN', () => this.cmd(CMD.HAN));
      await waitHw(20);
    } else if (m === 'zeros-last') {
      await step('LBLIG0', () => this.setLedBrightness(0));
      await step('LIG0', () => this.setBrightness(0));
      await step('HAN', () => this.cmd(CMD.HAN));
    } else if (m === 'vendor') {
      await step('LBLIG0[76,66,76,73,71,0]', () => this.setLedBrightness(0));
      await step(`LIG0[76,73,71,0,0,${gamma(0)}]`, () => this.setBrightness(0));
      await step('HAN[72,65,78]', () => this.cmd(CMD.HAN));
    } else if (m === 'nobright') {
      await step('HAN[72,65,78]', () => this.cmd(CMD.HAN));
    } else {
      await step('LIG0', () => this.setBrightness(0));
      await step('LBLIG0', () => this.setLedBrightness(0));
    }
    report.unshift('mode=' + m);
    return report;
  }

  async wake(brightness, force) {
    const was = this.asleep;
    this.asleep = false;
    this._abortDraw = false;
    this.lastFrames.clear();
    if (!was && !force) return false;
    let b = brightness == null ? this.savedBrightness : Number(brightness);
    if (!b || b <= 0) b = this.savedBrightness || 80;
    this.brightness = b;
    this.savedBrightness = b;
    await this.cmd(CMD.DIS).catch(() => {});
    await this.setBrightness(b).catch(() => {});
    await this.setLedBrightness(b).catch(() => {});
    return true;
  }

  async reset(brightness) {
    this.asleep = false;
    this.lastFrames.clear();
    const b = brightness == null ? this.brightness : brightness;
    await this.cmd(CMD.DIS).catch(() => {});
    await this.cmd(CMD.HAN).catch(() => {});
    await new Promise((r) => setTimeout(r, 200));
    await this.cmd(CMD.DIS).catch(() => {});
    await this.setBrightness(b).catch(() => {});
    await this.setLedBrightness(b).catch(() => {});
    return true;
  }

  startWatchdog() {
    if (this.watchdog) return;
    this.watchdog = setInterval(async () => {
      if (this.stopped || !HID) return;
      if (this.isOpen) return;

      const wasAsleep = this.asleep;
      try {
        this.open();
        this.openFailReported = false;
        if (wasAsleep) {
          await this.sleep(this.lastSleepMode, true);
        } else {
          await this.wake(this.brightness, true);
        }
        emit({
          event: 'opened',
          path: this.info && this.info.path,
          product: this.info && this.info.product,
          profileId: this.profileId,
          asleep: !!wasAsleep,
        });
      } catch (e) {
        if (!this.openFailReported) {
          this.openFailReported = true;
          emit({ event: 'open-failed', message: String((e && e.message) || e) });
        }
      }
    }, RECONNECT_MS);
  }
}

const device = new Device();

function emit(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n');
}

function reply(id, obj) {
  emit(Object.assign({ id, ok: true }, obj));
}
function fail(id, message) {
  emit({ id, ok: false, error: String(message) });
}

async function handle(msg) {
  const { id, cmd } = msg;
  switch (cmd) {
    case 'ping':
      return reply(id, { pong: true });
    case 'open': {
      try {
        if (msg.debounceMs !== undefined) device.setDebounce(msg.debounceMs);
        if (msg.wakePassThrough !== undefined) device.setWakePassThrough(msg.wakePassThrough);
        if (msg.profileId) device.setHardwareProfile(msg.profileId);
        const info = device.open();
        device.openFailReported = false;
        return reply(id, {
          info: {
            path: info.path,
            product: info.product,
            manufacturer: info.manufacturer,
            profileId: device.profileId,
          },
        });
      } catch (e) {
        return fail(id, e.message);
      }
    }
    case 'setHardwareProfile': {
      const prof = device.setHardwareProfile(msg.profileId || 'akp153');
      return reply(id, { profileId: prof.id, profile: prof });
    }
    case 'setDebounce': {
      const d = device.setDebounce(msg.value !== undefined ? msg.value : msg.debounceMs);
      return reply(id, { debounceMs: d });
    }
    case 'setWakePassThrough': {
      const w = device.setWakePassThrough(msg.value !== undefined ? msg.value : msg.wakePassThrough);
      return reply(id, { wakePassThrough: w });
    }
    case 'reset': {
      await device.reset(msg.brightness);
      return reply(id, {});
    }
    case 'close':
      device.stopped = true;
      device.close();
      return reply(id, {});
    case 'brightness':
      await device.setBrightness(msg.value);
      if (msg.led !== false) await device.setLedBrightness(msg.value);
      return reply(id, {});
    case 'draw': {
      if (!device.isOpen) return fail(id, 'NOT_OPEN');
      const res = await device.draw(msg.row, msg.col, msg.data, !!msg.force);
      return reply(id, res || {});
    }
    case 'batchDraw': {
      if (!device.isOpen) return fail(id, 'NOT_OPEN');
      const res = await device.batchDraw(msg.items, { full: !!msg.full, epoch: msg.epoch });
      return reply(id, res || { drawn: 0, skipped: 0, failed: [], missing: [] });
    }
    case 'clear':
      await device.clearScreen();
      return reply(id, {});
    case 'sleep':
      return reply(id, { report: await device.sleep(msg.mode, !!msg.force) });
    case 'wake':
      await device.wake(msg.brightness, !!msg.force);
      return reply(id, {});
    case 'startAnim': {
      const ok = device.startAnim(msg.row, msg.col, msg.frames, msg.fps, msg.loop);
      return reply(id, { started: ok });
    }
    case 'stopAnim': {
      device.stopAnim(msg.row, msg.col, msg.restoreFrame);
      return reply(id, { stopped: true });
    }
    case 'clearAnims': {
      device.clearAnims();
      return reply(id, { cleared: true });
    }
    case 'status':
      return reply(id, {
        open: device.isOpen,
        asleep: device.asleep,
        brightness: device.brightness,
        debounceMs: device.debounceMs,
        wakePassThrough: device.wakePassThrough,
        profileId: device.profileId,
        activeAnims: device.animations.size,
      });
    default:
      return fail(id, 'UNKNOWN_CMD ' + cmd);
  }
}

module.exports = { Device, buttonId, stripId, resolution, gamma, CANDIDATES, CMD, PACKET };

if (require.main === module) {
  device.startWatchdog();

  let buf = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => {
    buf += chunk;
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      let msg;
      try { msg = JSON.parse(line); } catch (e) { continue; }
      Promise.resolve()
        .then(() => handle(msg))
        .catch((e) => fail(msg.id, (e && e.message) || e));
    }
  });

  let shuttingDown = false;
  const gracefulShutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    device.stopped = true;
    try {
      if (device.isOpen) {
        await device.sleep('blackout', true);
      }
    } catch (_) {}
    device.close();
    process.exit(0);
  };
  process.on('SIGINT', gracefulShutdown);
  process.on('SIGTERM', gracefulShutdown);
  process.on('SIGHUP', gracefulShutdown);
  process.stdin.on('end', gracefulShutdown);
  process.stdin.on('close', gracefulShutdown);

  emit({ event: 'ready', pid: process.pid, node: process.version });
}
