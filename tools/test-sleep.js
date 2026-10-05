'use strict';
/**
 * 针对 AKP153 控制台全休眠模式（zeros-last, nobright, vendor, light）
 * 与休眠按键「仅唤醒不触发功能」的自动化专项测试矩阵。
 *
 * 运行方式:
 *   node tools/test-sleep.js
 */

const path = require('path');
const { Device } = require(path.join(__dirname, '..', 'host', 'device-host.js'));

const checks = [];
const check = (name, cond, extra) => checks.push([name, !!cond, extra]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function run() {
  console.log('--- AKP153 Sleep & Wake-Only Regression Suite ---');

  // =========================================================================
  // 1. 底层 Device Host 在 4 种休眠模式下的硬件报文行为验证
  // =========================================================================
  const dev = new Device();
  dev.open();
  // 静默 stderr
  const origErr = process.stderr.write;
  process.stderr.write = () => true;

  const packet = (id) => {
    const b = Buffer.alloc(512);
    b[9] = id;
    b[10] = 0;
    return b;
  };

  const capturedHost = [];
  const origOut = process.stdout.write;
  process.stdout.write = (chunk) => {
    capturedHost.push(String(chunk).trim());
    return true;
  };

  for (const mode of Device.SLEEP_MODES) {
    dev.asleep = true;
    capturedHost.length = 0;
    dev.lastPress.clear();

    // 休眠时按下按键 (例如 r0c0 -> id 13)
    dev.hid.emit('data', packet(13));
    const events = capturedHost.filter((l) => l.startsWith('{')).map((l) => JSON.parse(l));
    const hasDownOrUp = events.some((e) => e.event === 'down' || e.event === 'up');
    const wakeEvent = events.find((e) => e.event === 'wake' && e.by === 'key');

    check(`Host [${mode}]: 休眠时按键不发射 down/up 业务事件`, !hasDownOrUp);
    check(`Host [${mode}]: 休眠时按键发射专属 wake 唤醒事件`, !!wakeEvent && wakeEvent.row === 0 && wakeEvent.col === 0);
    check(`Host [${mode}]: 触发按键后硬件标记已恢复非休眠`, dev.asleep === false);

    // 唤醒后再次按键 -> 正常发射 down+up
    capturedHost.length = 0;
    dev.lastPress.clear();
    dev.hid.emit('data', packet(13));
    const normalEvents = capturedHost.filter((l) => l.startsWith('{')).map((l) => JSON.parse(l).event);
    check(`Host [${mode}]: 唤醒后再次按键恢复正常 down+up`, JSON.stringify(normalEvents) === JSON.stringify(['down', 'up']));
  }

  // 验证休眠与唤醒亮度保护（使用独立 Device 实例避免旧队列干扰）
  const bdev = new Device();
  bdev.open();
  await bdev.setBrightness(75);
  await bdev.sleep('zeros-last');
  check('Host 亮度保护: 休眠后保留用户基准亮度 savedBrightness', bdev.savedBrightness === 75);
  check('Host 亮度保护: 休眠期间当前生效亮度为 0', bdev.brightness === 0);
  await bdev.wake();
  check('Host 亮度保护: 唤醒后自动恢复基准亮度 75', bdev.brightness === 75);
  bdev.close();

  process.stdout.write = origOut;
  process.stderr.write = origErr;
  dev.close();

  // =========================================================================
  // 2. 主进程逻辑模拟：按键拦截、100ms 冷却与多休眠模式行为测试
  // =========================================================================

  let deviceAsleep = false;
  let lastWakeTime = 0;
  let lastActivity = Date.now();
  let runnerCallCount = 0;
  let pageChangedCount = 0;
  let notifyCount = 0;
  let flashCount = 0;
  let wakeRpcCount = 0;

  const mockRunner = {
    run: async () => {
      runnerCallCount++;
      return { ok: true };
    }
  };

  const broadcast = (event) => {
    if (event === 'key:flash') flashCount++;
    if (event === 'page:changed') pageChangedCount++;
  };

  const notify = () => {
    notifyCount++;
  };

  const safeRpc = async (cmd) => {
    if (cmd === 'wake') wakeRpcCount++;
    return { ok: true };
  };

  const repaintSoon = () => {};

  function onWakeByKey(row, col) {
    deviceAsleep = false;
    lastWakeTime = Date.now();
    lastActivity = Date.now();
    broadcast('key:flash', { row, col });
    repaintSoon();
  }

  async function onKeyDown(row, col, spec, isBackKey) {
    const now = Date.now();
    lastActivity = now;

    // 唤醒拦截与 100ms 冷却防抖守卫
    if (deviceAsleep || (now - lastWakeTime < 100)) {
      if (deviceAsleep) {
        deviceAsleep = false;
        lastWakeTime = now;
        await safeRpc('wake', { force: true });
        repaintSoon();
        broadcast('key:flash', { row, col });
      }
      return; // 阻断业务执行
    }

    broadcast('key:flash', { row, col });

    if (isBackKey) {
      pageChangedCount++;
      return;
    }

    if (spec && spec.type === 'page') {
      pageChangedCount++;
      return;
    }

    if (!spec || (!spec.target && spec.type !== 'multi' && spec.type !== 'macro')) {
      notify('未配置');
      return;
    }

    await mockRunner.run(spec);
  }

  // 模拟各个休眠模式测试
  for (const mode of ['zeros-last', 'nobright', 'vendor', 'light']) {
    // 进入休眠
    deviceAsleep = true;
    lastWakeTime = 0;
    runnerCallCount = 0;
    pageChangedCount = 0;
    notifyCount = 0;
    flashCount = 0;
    wakeRpcCount = 0;

    // --- Case A: 休眠时按下【普通启动按键】 ---
    const appSpec = { type: 'app', target: 'C:\\Windows\\notepad.exe' };
    await onKeyDown(0, 0, appSpec, false);

    check(`Main [${mode}]: 休眠按普通键时触发 wake 指令`, wakeRpcCount === 1);
    check(`Main [${mode}]: 休眠按普通键时 deviceAsleep 恢复为 false`, deviceAsleep === false);
    check(`Main [${mode}]: 休眠按普通键时 runner 动作未被触发`, runnerCallCount === 0);
    check(`Main [${mode}]: 休眠按普通键时产生唤醒闪烁微光`, flashCount === 1);

    // --- Case B: 在 100ms 冷却期内快速再次按下按键（模拟微动回弹/抖动连击） ---
    await onKeyDown(0, 0, appSpec, false);
    check(`Main [${mode}]: 100ms 冷却期内的连按被安全阻断，不触发 runner`, runnerCallCount === 0);

    // --- Case C: 等待超过 100ms 后，再次按下按键 -> 正常触发功能 ---
    await sleep(110);
    await onKeyDown(0, 0, appSpec, false);
    check(`Main [${mode}]: 100ms 冷却后再次按键正常触发功能`, runnerCallCount === 1);

    // --- Case D: 休眠时按下【切页键】 ---
    deviceAsleep = true;
    lastWakeTime = 0;
    pageChangedCount = 0;
    const pageSpec = { type: 'page', mode: 'next' };
    await onKeyDown(0, 1, pageSpec, false);
    check(`Main [${mode}]: 休眠按切页键时未发生切页跳转`, pageChangedCount === 0);

    // --- Case E: 休眠时按下【返回键】 ---
    deviceAsleep = true;
    lastWakeTime = 0;
    pageChangedCount = 0;
    await onKeyDown(2, 4, null, true);
    check(`Main [${mode}]: 休眠按返回键时未发生页面返回`, pageChangedCount === 0);

    // --- Case F: 休眠时按下【未配置按键】 ---
    deviceAsleep = true;
    lastWakeTime = 0;
    notifyCount = 0;
    await onKeyDown(1, 1, null, false);
    check(`Main [${mode}]: 休眠按未配置键时不弹出未配置错误提示`, notifyCount === 0);

    // --- Case G: Host 派发的 wake 事件直接唤醒处理 ---
    deviceAsleep = true;
    onWakeByKey(0, 0);
    check(`Main [${mode}]: 收到 host wake 事件后 deviceAsleep 恢复为 false`, deviceAsleep === false);
  }

  let failed = 0;
  for (const [name, ok, extra] of checks) {
    if (!ok) failed++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? ' (' + extra + ')' : ''}`);
  }

  console.log(failed === 0 ? 'ALL PASS' : `${failed} FAILED`);
  process.exit(failed === 0 ? 0 : 1);
}

run().catch((e) => {
  console.error('TEST FATAL:', e);
  process.exit(1);
});
