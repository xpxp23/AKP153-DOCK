'use strict';
/**
 * Unit test for input decoding - no key pressing required.
 *
 *   node tools/test-input.js
 *
 * node-hid's HID object is an EventEmitter, so we can inject a synthetic input
 * report and check the events the host emits.
 *
 * Regression guard: the device sends ONE report per press with data[10] === 0.
 * Reading that byte as "0 = up" made every press a release and no action ever
 * ran, even though the device was reporting perfectly.
 */
const path = require('path');
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
dev.open();

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

process.stdout.write = realWrite;
process.stderr.write = realErr;
realWrite(lines.join('\n') + '\n' + (failed === 0 ? 'ALL PASS\n' : failed + ' FAILED\n'));

dev.close();

process.exit(failed === 0 ? 0 : 1);
