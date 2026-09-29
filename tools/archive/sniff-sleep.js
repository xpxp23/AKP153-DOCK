'use strict';
/**
 * Sleep-mode comparison. Cycles through every sleep sequence and pauses so you
 * can watch the panel, then tells you which one actually cut the backlight.
 *
 *   node host/sniff-sleep.js
 *
 * Results -> logs/sleep-test.log
 */
const fs = require('fs');
const path = require('path');
const { Device, Device: D } = require('./device-host.js');

const LOG = path.join(__dirname, '..', 'logs', 'sleep-test.log');
const lines = [];
const put = (s) => { lines.push(s); console.log(s); };

const DESC = {
  vendor: 'HAN + sleep + LBLIG 0 + LIG 0   ← 厂商驱动的顺序（默认）',
  nobright: 'HAN + sleep                      ← 之后不发任何亮度指令',
  'zeros-last': 'LBLIG 0 + LIG 0 + HAN + sleep   ← 先归零，最后断电',
  light: 'LIG 0 + LBLIG 0                  ← 只降亮度，不执行 HAN/sleep',
};

const dev = new Device();
const info = dev.open();
put('opened: ' + info.path);
put('');
put('==================== 休眠方案对比 ====================');
put('每个方案会：唤醒 → 等 1.5 秒 → 执行休眠 → 停 4 秒让你观察');
put('请留意：哪一个方案让屏幕【彻底黑掉】（不是变暗、不是微微发亮）');
put('=====================================================');
put('');

const results = [];

(async () => {
  for (const mode of D.SLEEP_MODES) {
    put(`-------- 方案【${mode}】 --------`);
    put('  ' + DESC[mode]);
    put('  >> 现在唤醒，屏幕亮起…');
    await dev.wake(90, true);
    await new Promise((r) => setTimeout(r, 1500));

    const report = await dev.sleep(mode);
    put('  执行: ' + report.join(' , '));
    put(`  >> 已执行【${mode}】，请观察 4 秒 —— 屏幕是【彻底黑】还是【微亮】？`);
    await new Promise((r) => setTimeout(r, 4000));

    // leave it awake for the next round
    await dev.wake(90, true);
    await new Promise((r) => setTimeout(r, 800));
    results.push(mode);
    put('');
  }

  put('=============== 结束 ===============');
  put('测试过的方案：' + results.join(' / '));
  put('请告诉助手：哪个方案让屏幕【彻底黑掉】。');
  put('然后在上方「休眠方式」下拉里选它即可。');
  put('（如果全都不彻底黑，就把这份日志发给助手。）');

  fs.mkdirSync(path.dirname(LOG), { recursive: true });
  fs.writeFileSync(LOG, lines.join('\n') + '\n', 'utf8');
  dev.close();
  process.exit(0);
})().catch((e) => {
  put('FAILED: ' + e.message);
  fs.mkdirSync(path.dirname(LOG), { recursive: true });
  fs.writeFileSync(LOG, lines.join('\n') + '\n', 'utf8');
  process.exit(1);
});
