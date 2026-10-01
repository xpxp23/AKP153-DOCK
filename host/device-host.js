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
 * Commands:  open | close | draw | clear | brightness | sleep | wake | ping | status
 * Events:    ready | opened | lost | error | down | up
 */

const HID = require('node-hid');

const CANDIDATES = [
  { vendorId: 0x5548, productId: 0x6674 }, // AJAZZ AKP-153
  { vendorId: 0x0300, productId: 0x1010 }, // alternate id seen in the wild
];

const PREFIX = Buffer.from([67, 82, 84, 0, 0]); // "CRT\0\0"

// AKP153 inherits packetSize:512 from the "Stream Dock HSV 293S" base model in
// Companion's driver - it does NOT override it. Every HID write must therefore
// be [0] + payload padded to 513 bytes. Using 1024 makes the device silently
// drop everything (no error, just a dead screen).
const PACKET = 512;
const PKT = PACKET + 1;

// Command opcodes. These are FIXED-LENGTH records - a wrong length is silently
// ignored by the device, which is how the "screen is lit but very dim and
// brightness does nothing" bug happened. Keep the byte counts exact.
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
// "LIG"  + 0x00 0x00 + value    -> panel brightness     (6 bytes)
// "LBLIG"+ value                -> LED ring brightness  (6 bytes)
// "CLE"  + 0x00 0x00 0x00 + id  -> clear one key        (7 bytes)

const RECONNECT_MS = 2000;

// AKP153 grid: 6 columns x 3 rows.
//   columns 0..4, rows 0..2  -> 15 physical buttons
//   column 5                 -> 3 display strips (not pressable)
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
    this.queue = Promise.resolve();
    this.watchdog = null;
    this.stopped = false;   // set by the 'close' command to stop self-healing
    this.lastPress = new Map();
  }

  get isOpen() {
    return !!this.hid && !this.broken;
  }

  // All writes go through one sequential chain - parallel HID writes corrupt frames.
  lock(fn) {
    const next = this.queue.then(fn, fn);
    this.queue = next.catch(() => {});
    return next;
  }

  close() {
    if (this.hid) {
      try { this.hid.removeAllListeners('data'); } catch (e) { /* ignore */ }
      try { this.hid.removeAllListeners('error'); } catch (e) { /* ignore */ }
      try { this.hid.close(); } catch (e) { /* ignore */ }
      this.hid = null;
    }
    this.info = null;
  }

  /**
   * (Re)open the device. Always drops any previous handle first - after a USB
   * re-plug the old handle is dead and Windows may hand out a NEW path, so
   * reusing or skipping re-enumeration leaves us writing into the void.
   */
  open() {
    this.close();
    this.broken = false;
    this.stopped = false;

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
      // A dead handle (unplugged / re-enumerated) must be dropped immediately,
      // otherwise every later write "succeeds" into the void.
      this.broken = true;
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
      // stderr is forwarded into the app's log - this is the only way to tell
      // "device sent nothing" apart from "we failed to act on it".
      process.stderr.write(`[input] len=${data.length} id=${id} state=${state} mapped=${!!pos}\n`);
      if (!pos) return;

      // AKP153's inputs are type "push", not "button".
      //
      // The vendor driver branches on this: type "button" uses the state byte
      // (0 = up, non-zero = down), while type "push" emits a single event per
      // report and IGNORES the state byte. On this device data[10] is always 0,
      // so treating it as "up" swallowed every press - not a single action ever
      // ran even though the device was reporting fine.
      //
      // One report == one complete press, so synthesise down+up.
      // The debounce is belt-and-braces against press/release chatter.
      const key = pos.row + ',' + pos.col;
      const now = Date.now();
      if (now - (this.lastPress.get(key) || 0) < 120) return;
      this.lastPress.set(key, now);

      if (this.asleep) {
        process.stderr.write(`[input] key press while asleep at r${pos.row}c${pos.col} -> wake only\n`);
        this.asleep = false;
        this.lastPress.delete(key);
        this.wake(this.brightness, true).catch(() => {});
        emit({ event: 'wake', by: 'key', row: pos.row, col: pos.col });
        return;
      }

      emit({ event: 'down', row: pos.row, col: pos.col });
      emit({ event: 'up', row: pos.row, col: pos.col });
    });

  }

  pad(buf) {
    return Buffer.concat([buf], PKT);
  }

  /**
   * Write exactly PKT bytes and verify the transport accepted them.
   * A wrong packet size makes the device silently ignore everything, so this
   * check turns "dead screen" into a loud error.
   */
  writeRaw(buf) {
    if (this.broken || !this.hid) throw new Error('NOT_OPEN');
    if (buf.length !== PKT) throw new Error('BAD_PACKET_SIZE ' + buf.length + ' != ' + PKT);
    let n;
    try {
      n = this.hid.write(buf);
    } catch (e) {
      // A failed write means the handle is dead (unplugged / re-enumerated).
      // Flag it so the watchdog reopens instead of retrying into the void
      // forever - this is exactly how "已连接但黑屏" happened.
      this.broken = true;
      throw new Error('WRITE_FAILED ' + ((e && e.message) || e));
    }
    if (typeof n === 'number' && n < buf.length) {
      this.broken = true;
      throw new Error('SHORT_WRITE ' + n + '/' + buf.length);
    }
    return n;
  }

  cmd(bytes) {
    return this.lock(async () => {
      return this.writeRaw(this.pad(Buffer.concat([Buffer.from([0]), PREFIX, Buffer.from(bytes)])));
    });
  }

  /** LCD panel brightness. Command is "LIG" + 0x00 0x00 + value (6 bytes). */
  async setBrightness(pct) {
    this.brightness = Number(pct);
    await this.cmd([76, 73, 71, 0, 0, gamma(pct)]);
  }

  /** LED ring brightness. Command is "LBLIG" + value (6 bytes). */
  async setLedBrightness(pct) {
    await this.cmd([76, 66, 76, 73, 71, gamma(pct)]);
  }

  async draw(row, col, jpegBase64) {
    // Pushing image data at a sleeping panel can partially re-light the
    // backlight, which looks like "it dimmed to 1 instead of turning off".
    // While asleep we only accept the wake command.
    if (this.asleep) {
      // Log it (throttled): a draw landing on a sleeping panel partially
      // re-lights the backlight, which looks like "sleep only dimmed it".
      const now = Date.now();
      if (now - (this.lastSkipLog || 0) > 5000) {
        this.lastSkipLog = now;
        process.stderr.write(`[draw] SKIPPED r${row}c${col} - panel is asleep\n`);
      }
      return false;
    }
    const id = col === 5 ? stripId(row) : buttonId(row, col);
    if (id === null) throw new Error('BAD_POSITION');
    const img = Buffer.from(jpegBase64, 'base64');
    const total = img.length;
    if (total === 0) throw new Error('EMPTY_IMAGE');

    return this.lock(async () => {
      const bat = Buffer.concat([
        Buffer.from([0]), PREFIX,
        Buffer.from([66, 65, 84, (total >> 24) & 255, (total >> 16) & 255, (total >> 8) & 255, total & 255, id]),
      ]);
      this.writeRaw(this.pad(bat));
      for (let off = 0; off < total; off += PACKET) {
        const chunk = img.subarray(off, off + PACKET);
        this.writeRaw(this.pad(Buffer.concat([Buffer.from([0]), chunk])));
      }
      this.writeRaw(this.pad(Buffer.concat([Buffer.from([0]), PREFIX, Buffer.from(CMD.STP)])));
      return true;
    });
  }

  /** "CLE\0\0\0\xff" - clears the whole panel (kills the on-chip LCD RAM). */
  async clearScreen() {
    await this.cmd(CMD.CLEAR_ALL);
  }

  /** Clear a single key by its device id. */
  async clearKey(id) {
    await this.cmd([67, 76, 69, 0, 0, 0, id]);
  }

  /**
   * True hardware sleep: HAN + sleep cut the backlight and LCD power.
   * Deliberately does NOT send CLE - that would wipe the LCD RAM and the
   * panel would come back as black squares.
   */
  /**
   * Sleep sequence. The exact byte order matters and differs between
   * firmwares, so it is selectable - see host/sniff-sleep.js to test which one
   * actually cuts the backlight on a given unit.
   *
   *   vendor     HAN, sleep, LBLIG 0, LIG 0   (what Companion's driver does)
   *   nobright   HAN, sleep                    (no brightness writes after)
   *   zeros-last LBLIG 0, LIG 0, HAN, sleep    (panel off last)
   *   light      LIG 0, LBLIG 0                (brightness only)
   */
  static SLEEP_MODES = ['vendor', 'nobright', 'zeros-last', 'light'];

  async sleep(mode) {
    const m = Device.SLEEP_MODES.includes(mode) ? mode : 'vendor';
    const report = [];
    const step = async (name, fn) => {
      try { await fn(); report.push(name + '=ok'); }
      catch (e) { report.push(name + '=FAIL:' + e.message); }
    };

    this.asleep = true;
    if (m === 'vendor') {
      await step('HAN[72,65,78]', () => this.cmd(CMD.HAN));
      await step('sleep[115,108,101,101,112]', () => this.cmd(CMD.SLEEP));
      await step('LBLIG0[76,66,76,73,71,0]', () => this.setLedBrightness(0));
      await step(`LIG0[76,73,71,0,0,${gamma(0)}]`, () => this.setBrightness(0));
    } else if (m === 'nobright') {
      await step('HAN[72,65,78]', () => this.cmd(CMD.HAN));
      await step('sleep[115,108,101,101,112]', () => this.cmd(CMD.SLEEP));
    } else if (m === 'zeros-last') {
      await step('LBLIG0', () => this.setLedBrightness(0));
      await step('LIG0', () => this.setBrightness(0));
      await step('HAN', () => this.cmd(CMD.HAN));
      await step('sleep', () => this.cmd(CMD.SLEEP));
    } else {
      await step('LIG0', () => this.setBrightness(0));
      await step('LBLIG0', () => this.setLedBrightness(0));
    }
    report.unshift('mode=' + m);
    return report;
  }

  /**
   * force: always run the sequence, even if we think we're awake.
   * Needed on connect - a previous owner (Companion's idle timer) may have
   * left the panel powered down, and the device keeps that state after the
   * owner quits.
   */
  async wake(brightness, force) {
    const was = this.asleep;
    this.asleep = false;
    if (!was && !force) return false;
    const b = brightness == null ? this.brightness : brightness;
    await this.cmd(CMD.DIS).catch(() => {});
    await this.cmd(CMD.WAKE).catch(() => {});
    await this.setBrightness(b).catch(() => {});
    await this.setLedBrightness(b).catch(() => {});
    return true;
  }

  /**
   * Reboot the panel: clear + wake + brightness. Used when a re-plug leaves the
   * device powered on but displaying nothing.
   */
  async reset(brightness) {
    this.asleep = false;
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

  /**
   * Self-healing: if the handle is dead (USB re-plug, power blip), keep trying
   * to reopen and re-wake, then tell the UI to repaint.
   */
  startWatchdog() {
    if (this.watchdog) return;
    this.watchdog = setInterval(async () => {
      if (this.stopped) return;
      // Check the device is still really there. While asleep we send no writes
      // at all (draws are suppressed), so a dead handle produces no error to
      // notice - we would sit forever on a stale handle and never receive
      // another input report. Comparing the live HID path catches unplug,
      // re-enumeration and silent handle death.
      let present = false;
      try {
        present = HID.devices().some((d) => d.path === (this.info && this.info.path));
      } catch (e) {
        present = false;
      }
      if (this.isOpen && present) return;

      const wasAsleep = this.asleep;
      try {
        this.open();
        // Reopening resets the panel; restore the state we were in.
        if (wasAsleep) {
          await this.sleep();
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

// ---------------------------------------------------------------- rpc plumbing

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
        const info = device.open();
        return reply(id, { info: { path: info.path, product: info.product, manufacturer: info.manufacturer } });
      } catch (e) {
        // Opening failed (unplugged / still busy) - the watchdog will keep
        // retrying in the background, so report and let it do its job.
        return fail(id, e.message);
      }
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
    case 'draw':
      if (!device.isOpen) return fail(id, 'NOT_OPEN');
      await device.draw(msg.row, msg.col, msg.data);
      return reply(id, {});
    case 'clear':
      await device.clearScreen();
      return reply(id, {});
    case 'sleep':
      return reply(id, { report: await device.sleep(msg.mode) });
    case 'wake':
      await device.wake(msg.brightness, !!msg.force);
      return reply(id, {});
    case 'status':
      return reply(id, { open: device.isOpen, asleep: device.asleep, brightness: device.brightness });
    default:
      return fail(id, 'UNKNOWN_CMD ' + cmd);
  }
}

// expose helpers for CLI probing / tests
module.exports = { Device, buttonId, stripId, resolution, gamma, CANDIDATES, CMD, PACKET };

// Only start the stdio RPC loop when run directly - otherwise requiring this
// module (e.g. from a probe script) would hijack stdin and print stray events.
if (require.main === module) {
  // Always run the self-healing loop: it also covers the case where the very
  // first open failed (device busy / not yet enumerated).
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

  process.on('SIGINT', () => { device.close(); process.exit(0); });

  emit({ event: 'ready', pid: process.pid, node: process.version });
}
