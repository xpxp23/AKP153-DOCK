'use strict';
/**
 * Unit test for input decoding & Frame Diff Cache - no physical hardware required.
 *
 *   node tools/test-input.js
 *
 * Uses a real device if plugged in, or a synthetic EventEmitter HID mock when
 * running headlessly / in CI without hardware.
 */
const path = require('path');
const { EventEmitter } = require('events');
const { Device, buttonId } = require(path.join(__dirname, '..', 'host', 'device-host.js'));

const captured = [];
const realWrite = process.stdout.write.bind(process.stdout);
process.stdout.write = (chunk) => {
  const s = String(chunk);
  captured.push(s.trim());
  return realWrite(chunk);
};

function packet(id, state) {
  const b = Buffer.alloc(512);
  b[9] = id;
  b[10] = state;
  return b;
}

const dev = new Device();
let writeCalls = 0;
try {
  dev.open();
} catch (e) {
  // No physical AKP153 connected: mount a synthetic HID EventEmitter
  const mockHid = new EventEmitter();
  mockHid.write = (buf) => {
    writeCalls++;
    return buf.length;
  };
  mockHid.close = () => {};
  dev.hid = mockHid;
  dev.broken = false;
  dev.attach();
}

// silence the per-packet stderr trace for this test
const realErr = process.stderr.write.bind(process.stderr);
process.stderr.write = () => true;

const checks = [
  ['r0c0 (id 13) state=0 -> down+up', packet(13, 0), ['down', 'up']],
  ['r2c4 (id 3)  state=0 -> down+up', packet(3, 0), ['down', 'up']],
  ['r1c0 (id 14) state=0 -> down+up', packet(14, 0), ['down', 'up']],
  ['unmapped id 99 -> nothing', packet(99, 0), []],
  ['short packet -> nothing', Buffer.alloc(5), []],
];

let failed = 0;
const lines = [];
for (const [name, buf, expect] of checks) {
  captured.length = 0;
  dev.lastPress.clear();
  dev.hid.emit('data', buf);
  const events = captured
    .filter((l) => l.startsWith('{'))
    .map((l) => JSON.parse(l).event)
    .filter((e) => e === 'down' || e === 'up');
  const ok = JSON.stringify(events) === JSON.stringify(expect);
  if (!ok) failed++;
  lines.push(`${ok ? 'PASS' : 'FAIL'}  ${name} -> got ${JSON.stringify(events)}`);
}

// debounce: hammering the same key must not double-fire
captured.length = 0;
dev.lastPress.clear();
dev.hid.emit('data', packet(13, 0));
dev.hid.emit('data', packet(13, 0));
dev.hid.emit('data', packet(13, 0));
const downs = captured.filter((l) => l.startsWith('{')).map((l) => JSON.parse(l)).filter((e) => e.event === 'down');
const dbOk = downs.length === 1;
if (!dbOk) failed++;
lines.push(`${dbOk ? 'PASS' : 'FAIL'}  debounce: 3 rapid reports -> ${downs.length} down event(s)`);

// 4 种休眠模式下按键仅唤醒测试
for (const mode of Device.SLEEP_MODES) {
  dev.asleep = true;
  captured.length = 0;
  dev.lastPress.clear();

  // 休眠状态下按键
  dev.hid.emit('data', packet(13, 0));
  const rawEvents = captured.filter((l) => l.startsWith('{')).map((l) => JSON.parse(l));
  const hasDownOrUp = rawEvents.some((e) => e.event === 'down' || e.event === 'up');
  const hasWake = rawEvents.some((e) => e.event === 'wake' && e.by === 'key' && e.row === 0 && e.col === 0);
  const wakeOk = !hasDownOrUp && hasWake && !dev.asleep;
  if (!wakeOk) failed++;
  lines.push(`${wakeOk ? 'PASS' : 'FAIL'}  sleep mode [${mode}]: key press wakes device without down/up`);

  // 唤醒后再次按键：恢复正常 down+up
  captured.length = 0;
  dev.lastPress.clear();
  dev.hid.emit('data', packet(13, 0));
  const awakeEvents = captured.filter((l) => l.startsWith('{')).map((l) => JSON.parse(l).event).filter((e) => e === 'down' || e === 'up');
  const awakeOk = JSON.stringify(awakeEvents) === JSON.stringify(['down', 'up']);
  if (!awakeOk) failed++;
  lines.push(`${awakeOk ? 'PASS' : 'FAIL'}  sleep mode [${mode}]: subsequent press after wake emits down+up`);
}

// Frame Diff Cache 测试
(async () => {
  dev.asleep = false;
  dev.lastFrames.clear();
  const sampleB64 = Buffer.from('fake-jpeg-payload-12345').toString('base64');
  const r1 = await dev.draw(0, 0, sampleB64, false);
  const r2 = await dev.draw(0, 0, sampleB64, false);
  const r3 = await dev.draw(0, 0, sampleB64, true);
  const diffOk = r1 && r1.drawn === true && r2 && r2.skipped === true && r3 && r3.drawn === true;
  if (!diffOk) failed++;
  lines.push(`${diffOk ? 'PASS' : 'FAIL'}  Frame Diff Cache: identical frame skipped unless force=true`);

  process.stdout.write = realWrite;
  process.stderr.write = realErr;
  realWrite(lines.join('\n') + '\n' + (failed === 0 ? 'ALL PASS\n' : failed + ' FAILED\n'));

  dev.close();
  process.exit(failed === 0 ? 0 : 1);
})();
