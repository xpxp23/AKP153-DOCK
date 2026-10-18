'use strict';
/**
 * AKP153 device host.
 *
 * Runs as a PLAIN NODE process (not inside Electron) so that:
 *   - node-hid's N-API prebuild is used directly (no electron-rebuild / VS build tools)
 *   - the device layer can be tested headlessly from the command line
 *   - a driver crash can never take down the UI
 *
 * Talks JSON-RPC over stdin/stdout, one JSON object per line.
 *
 * Commands:  open | close | draw | batchDraw | clear | brightness | setDebounce | sleep | wake | ping | status
 * Events:    ready | opened | lost | error | down | up | wake
 */

let HID = null;
try {
  HID = require('node-hid');
} catch (_) {
  // Handled gracefully in open() / watchdog if node-hid is not installed yet
}

const CANDIDATES = [
  { vendorId: 0x5548, productId: 0x6674 }, // AJAZZ AKP-153
  { vendorId: 0x0300, productId: 0x1010 }, // alternate id seen in the wild
];

const PREFIX = Buffer.from([67, 82, 84, 0, 0]); // "CRT\0\0"

const PACKET = 512;
const PKT = PACKET + 1;

const CMD = {
  DIS: [68, 73, 83],                       // wake panel
  WAKE: [119, 97, 107, 101],
  STP: [83, 84, 80],                       // commit / refresh
  HAN: [72, 65, 78],
  SLEEP: [115, 108, 101, 101, 112],
  CONNECT: [67, 79, 78, 78, 69, 67, 84],   // heartbeat (driver defines it, never calls it)
  CLEAR_ALL: [67, 76, 69, 0, 0, 0, 255],   // "CLE" \0 \0 \0 0xff
  DEVICE_CLOSE: [67, 76, 69, 0, 0, 68, 67],
};

const RECONNECT_MS = 2000;

function buttonId(row, col) {
  if (col >= 0 && col <= 4 && row >= 0 && row <= 2) return 13 - 3 * col + row;
  return null;
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
    this.asleep = false;
    this.broken = false;
    this.brightness = 80;
    this.savedBrightness = 80;
    this.debounceMs = 100;
    this.lastSleepMode = 'zeros-last';
    this.queue = Promise.resolve();
    this.watchdog = null;
    this.stopped = false;   // set by the 'close' command to stop self-healing
    this.lastPress = new Map();
    this.lastFrames = new Map(); // "${row},${col}" -> jpegBase64 (Frame Diff Cache)
    this._pktBuf = Buffer.alloc(PKT);
  }

  get isOpen() {
    return !!this.hid && !this.broken;
  }

  setDebounce(ms) {
    const val = Number(ms);
    if (!Number.isNaN(val) && val >= 20 && val <= 1000) {
      this.debounceMs = Math.round(val);
    }
    return this.debounceMs;
  }

  lock(fn) {
    const next = this.queue.then(fn, fn);
    this.queue = next.catch(() => {});
    return next;
  }

  close() {
    this.lastFrames.clear();
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
        if (d.vendorId === c.vendorId && d.productId === c.productId && d.path) matches.push(d);
      }
    }
    if (matches.length === 0) throw new Error('DEVICE_NOT_FOUND');

    let lastErr = null;
    for (const d of matches) {
      try {
        const h = new HID.HID(d.path);
        this.hid = h;
        this.info = d;
        this.attach();
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

  attach() {
    const hid = this.hid;
    hid.on('error', (err) => {
      const message = String((err && err.message) || err);
      this.broken = true;
      this.lastFrames.clear();
      emit({ event: 'lost', message });
    });
    hid.on('data', (data) => {
      if (!data || data.length < 11) return;
      const id = data[9];
      const state = data[10];
      let pos = null;
      for (let row = 0; row < 3; row++) {
        for (let col = 0; col < 5; col++) {
          if (buttonId(row, col) === id) pos = { row, col };
        }
      }
      process.stderr.write(`[input] len=${data.length} id=${id} state=${state} mapped=${!!pos}\n`);
      if (!pos) return;

      const key = pos.row + ',' + pos.col;
      const now = Date.now();
      const threshold = Math.max(20, Number(this.debounceMs) || 100);
      if (now - (this.lastPress.get(key) || 0) < threshold) return;
      this.lastPress.set(key, now);

      if (this.asleep) {
        process.stderr.write(`[input] key press while asleep at r${pos.row}c${pos.col} -> wake only\n`);
        this.asleep = false;
        this.lastPress.delete(key);
        const wakeB = this.savedBrightness || this.brightness || 80;
        this.wake(wakeB, true).catch(() => {});
        emit({ event: 'wake', by: 'key', row: pos.row, col: pos.col });
        return;
      }

      emit({ event: 'down', row: pos.row, col: pos.col });
      emit({ event: 'up', row: pos.row, col: pos.col });
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
    return this.lock(async () => {
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
    const id = col === 5 ? stripId(row) : buttonId(row, col);
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
    for (let off = 0; off < total; off += PACKET) {
      const chunk = img.subarray(off, off + PACKET);
      const pkt = Buffer.alloc(PKT);
      pkt[0] = 0;
      chunk.copy(pkt, 1);
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
    const id = col === 5 ? stripId(row) : buttonId(row, col);
    if (id === null) throw new Error('BAD_POSITION');
    if (!jpegBase64) throw new Error('EMPTY_IMAGE');

    const frameKey = `${row},${col}`;
    if (!force && this.lastFrames.get(frameKey) === jpegBase64) {
      return { drawn: false, skipped: true };
    }

    return this.lock(async () => {
      return this._drawUnlocked(row, col, jpegBase64, force);
    });
  }

  async batchDraw(items) {
    if (this.asleep) {
      return { drawn: 0, skipped: Array.isArray(items) ? items.length : 0 };
    }
    const list = Array.isArray(items) ? items : [];
    if (list.length === 0) return { drawn: 0, skipped: 0 };

    return this.lock(async () => {
      let drawn = 0;
      let skipped = 0;
      for (const it of list) {
        if (!it || this.asleep) {
          skipped++;
          continue;
        }
        const r = this._drawUnlocked(it.row, it.col, it.data, !!it.force);
        if (r && r.drawn) drawn++;
        else skipped++;
      }
      return { drawn, skipped };
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
    // 若面板已处于休眠状态，且非关机彻底灭屏 (blackout) 亦非强制重发，则立即幂等返回，
    // 严禁向休眠中的硬件重复发送 LIG 0 / LBLIG 0，避免单片机 PWM 背光电路产生瞬态频闪。
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
    this.lastFrames.clear();
    const waitHw = (ms) => new Promise((r) => setTimeout(r, ms));
    if (m === 'blackout') {
      // 若此前未处于深度休眠，先清屏并等待 45ms 让 MCU 完成 18 路帧缓冲擦除；
      // 若已处于休眠则跳过 CLEAR_ALL，避免唤醒外接带电拓展坞上的 LCD 控制器。
      if (!wasAlreadyAsleep) {
        await step('CLEAR_ALL', () => this.clearScreen());
        await waitHw(45);
      }
      await step('LBLIG0', () => this.setLedBrightness(0));
      await waitHw(20);
      await step('LIG0', () => this.setBrightness(0));
      await waitHw(20);
      await step('HAN', () => this.cmd(CMD.HAN));
      await waitHw(20);
      // 严禁在 sleep 后发送 CMD.DEVICE_CLOSE (CLE..DC)！
      // 在独立供电拓展坞/关机不断电主板上，CLE..DC 会使固件退出 sleep 重新点亮开机 Logo。
      await step('sleep', () => this.cmd(CMD.SLEEP));
      await waitHw(35);
    } else if (m === 'zeros-last') {
      await step('LBLIG0', () => this.setLedBrightness(0));
      await step('LIG0', () => this.setBrightness(0));
      await step('HAN', () => this.cmd(CMD.HAN));
      await step('sleep', () => this.cmd(CMD.SLEEP));
    } else if (m === 'vendor') {
      await step('HAN[72,65,78]', () => this.cmd(CMD.HAN));
      await step('sleep[115,108,101,101,112]', () => this.cmd(CMD.SLEEP));
      await step('LBLIG0[76,66,76,73,71,0]', () => this.setLedBrightness(0));
      await step(`LIG0[76,73,71,0,0,${gamma(0)}]`, () => this.setBrightness(0));
    } else if (m === 'nobright') {
      await step('HAN[72,65,78]', () => this.cmd(CMD.HAN));
      await step('sleep[115,108,101,101,112]', () => this.cmd(CMD.SLEEP));
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
    this.lastFrames.clear();
    if (!was && !force) return false;
    let b = brightness == null ? this.savedBrightness : Number(brightness);
    if (!b || b <= 0) b = this.savedBrightness || 80;
    this.brightness = b;
    this.savedBrightness = b;
    await this.cmd(CMD.DIS).catch(() => {});
    await this.cmd(CMD.WAKE).catch(() => {});
    await this.setBrightness(b).catch(() => {});
    await this.setLedBrightness(b).catch(() => {});
    return true;
  }

  async reset(brightness) {
    this.asleep = false;
    this.lastFrames.clear();
    const b = brightness == null ? this.brightness : brightness;
    await this.cmd(CMD.DIS).catch(() => {});
    await this.cmd(CMD.WAKE).catch(() => {});
    await this.cmd(CMD.HAN).catch(() => {});
    await this.cmd(CMD.SLEEP).catch(() => {});
    await new Promise((r) => setTimeout(r, 250));
    await this.cmd(CMD.DIS).catch(() => {});
    await this.cmd(CMD.WAKE).catch(() => {});
    await this.setBrightness(b).catch(() => {});
    await this.setLedBrightness(b).catch(() => {});
    return true;
  }

  startWatchdog() {
    if (this.watchdog) return;
    this.watchdog = setInterval(async () => {
      if (this.stopped || !HID) return;
      // 当设备已打开且未报错时无需每 2s 调用同步阻塞的 HID.devices() 枚举全系统 USB 总线；
      // 物理拔出时 node-hid 的 error 事件会毫秒级将 this.broken 置为 true。
      if (this.isOpen) return;

      const wasAsleep = this.asleep;
      try {
        this.open();
        if (wasAsleep) {
          await this.sleep(this.lastSleepMode, true);
        } else {
          await this.wake(this.brightness, true);
        }
        emit({ event: 'opened', path: this.info && this.info.path, asleep: !!wasAsleep });
      } catch (e) {
        /* still missing / busy - keep trying */
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
        const info = device.open();
        return reply(id, { info: { path: info.path, product: info.product, manufacturer: info.manufacturer } });
      } catch (e) {
        return fail(id, e.message);
      }
    }
    case 'setDebounce': {
      const d = device.setDebounce(msg.value !== undefined ? msg.value : msg.debounceMs);
      return reply(id, { debounceMs: d });
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
      const res = await device.batchDraw(msg.items);
      return reply(id, res || { drawn: 0, skipped: 0 });
    }
    case 'clear':
      await device.clearScreen();
      return reply(id, {});
    case 'sleep':
      return reply(id, { report: await device.sleep(msg.mode, !!msg.force) });
    case 'wake':
      await device.wake(msg.brightness, !!msg.force);
      return reply(id, {});
    case 'status':
      return reply(id, {
        open: device.isOpen,
        asleep: device.asleep,
        brightness: device.brightness,
        debounceMs: device.debounceMs,
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
