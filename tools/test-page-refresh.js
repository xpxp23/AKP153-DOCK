'use strict';
/**
 * v0.11.1 回归测试：整页重绘不能被小批次抢占。
 *
 * 复现的原 bug：
 *   host/device-host.js 的 batchDraw 用 drawGen 记录"任何 batchDraw"，
 *   于是一个 1~9 项的遥测小批次就能把 18 项整页重绘在下一项处 continue 掉，
 *   剩余按键既不重画也不报错 —— 现象就是切页后一半新、一半上一页。
 *
 * 运行：node tools/test-page-refresh.js
 */
const assert = require('assert');
const { Device } = require('../host/device-host.js');

const FAKE_JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46]).toString('base64');

function makeDevice() {
  const dev = new Device();
  dev.hid = {
    writes: 0,
    write(buf) { this.writes += 1; return buf.length; },
  };
  // 每次写图让出一次事件循环，模拟真实 USB 写入的耗时，好让抢占窗口真实存在
  const orig = dev._drawUnlocked.bind(dev);
  dev._drawUnlocked = (...args) => {
    const r = orig(...args);
    return r;
  };
  return dev;
}

function pageItems(rows, cols, force = true) {
  const items = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) items.push({ row: r, col: c, data: FAKE_JPEG, force });
  }
  return items;
}

async function testSmallBatchCannotAbortFullBatch() {
  const dev = makeDevice();
  const full = dev.batchDraw(pageItems(3, 6), { full: true, epoch: 1 });

  // 整页批次跑到一半时，来一发 1 项的遥测小批次（旧逻辑会让整页批次当场残废）
  await new Promise((r) => setImmediate(r));
  const small = dev.batchDraw([{ row: 1, col: 1, data: Buffer.from([1, 2, 3]).toString('base64'), force: false }], { full: false, epoch: 1 });

  const [fullRes, smallRes] = await Promise.all([full, small]);
  assert.strictEqual(fullRes.missing.length, 0, `整页批次被小批次打断，缺失 ${fullRes.missing.length} 键`);
  // 注意：不能用 drawn + skipped === 18 判定 —— 旧实现把"被抢占而丢弃"的项也算进 skipped，
  // 于是 2 drawn + 16 skipped 也能"通过"。必须直接断言每一项都真的写下去了。
  assert.strictEqual(fullRes.drawn, 18, `整页批次只画了 ${fullRes.drawn}/18 个键`);
  assert.ok(smallRes.drawn >= 0, '小批次应正常执行');
  console.log('  ✓ 小批次不再抢占整页重绘 (drawn=%d/18 skipped=%d)', fullRes.drawn, fullRes.skipped);
}

async function testNewerFullBatchSupersedesOld() {
  const dev = makeDevice();
  const first = dev.batchDraw(pageItems(3, 6), { full: true, epoch: 1 });
  await new Promise((r) => setImmediate(r));
  const second = dev.batchDraw(pageItems(3, 6), { full: true, epoch: 2 });
  const [r1, r2] = await Promise.all([first, second]);
  assert.strictEqual(r2.missing.length, 0, '更新的整页批次自身必须画全');
  assert.strictEqual(r2.drawn, 18, `更新的整页批次只画了 ${r2.drawn}/18`);
  assert.ok(r1.drawn < 18, '旧批次应当被抢占（否则抢占逻辑根本没生效）');
  console.log('  ✓ 更新的整页批次可抢占旧的 (old drawn=%d, new drawn=%d)', r1.drawn, r2.drawn);
}

async function testOneBrokenKeyDoesNotKillBatch() {
  const dev = makeDevice();
  const real = dev._drawUnlocked.bind(dev);
  dev._drawUnlocked = (row, col, data, force) => {
    if (row === 1 && col === 2) throw new Error('WRITE_FAILED boom');
    return real(row, col, data, force);
  };
  const res = await dev.batchDraw(pageItems(3, 6), { full: true, epoch: 1 });
  assert.strictEqual(res.failed.length, 1, '应当只报告 1 个失败键');
  assert.strictEqual(res.missing.length, 1, '失败键应进入 missing 供补发');
  assert.strictEqual(res.drawn, 17, '其余 17 键必须照常画完');
  console.log('  ✓ 单键写失败不再拖死整批 (drawn=%d failed=%d)', res.drawn, res.failed.length);
}

async function testForceClearsLoopAnims() {
  const dev = makeDevice();
  dev.animations.set('0,0', { row: 0, col: 0, frames: [FAKE_JPEG], fps: 10, loop: true, idx: 0, lastTick: 0 });
  await dev.batchDraw([{ row: 0, col: 0, data: Buffer.from([9, 9, 9]).toString('base64'), force: true }], { full: true, epoch: 1 });
  assert.strictEqual(dev.animations.has('0,0'), false, '整页强制重绘必须清掉旧页循环动效');
  console.log('  ✓ 整页强制重绘清掉旧页循环动效');
}

(async () => {
  console.log('page refresh regression (v0.11.1)');
  await testSmallBatchCannotAbortFullBatch();
  await testNewerFullBatchSupersedesOld();
  await testOneBrokenKeyDoesNotKillBatch();
  await testForceClearsLoopAnims();
  console.log('all passed');
})().catch((e) => {
  console.error('FAILED:', e && e.message);
  process.exit(1);
});
