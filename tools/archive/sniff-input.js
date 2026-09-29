'use strict';
/**
 * Raw input sniffer - the ground truth for "pressing keys does nothing".
 *
 *   node host/sniff-input.js [secondsPerPhase]
 *
 * Runs three phases and prints a clear prompt before each one, so a single run
 * tells us exactly where the problem is:
 *
 *   A) panel AWAKE      -> do presses arrive at all?
 *   B) panel ASLEEP     -> does a sleeping panel still report the first press?
 *   C) panel AWAKE again-> does it recover?
 *
 * Results also go to logs/input-sniff.log.
 */
const fs = require('fs');
const path = require('path');
const { Device, buttonId } = require('./device-host.js');

const per = Number(process.argv[2]) || 15;

const LOG = path.join(__dirname, '..', 'logs', 'input-sniff.log');
const lines = [];
const put = (s) => { lines.push(s); console.log(s); };
const rule = () => put('------------------------------------------------------------');

const dev = new Device();
const info = dev.open();
put('opened: ' + info.path);

let count = 0;
const marks = [];   // {t, id} - used by the long-press phase
dev.hid.on('data', (d) => {
  count++;
  const len = d ? d.length : 0;
  const hex = Buffer.from(d || []).slice(0, 16).toString('hex');
  let decoded = 'len<11';
  if (len >= 11) {
    // AKP153 inputs are type "push": ONE report = one complete press, and the
    // state byte (d[10]) is always 0 - it must not be read as down/up.
    const id = d[9], st = d[10];
    marks.push({ t: Date.now(), id });
    let pos = null;
    for (let r = 0; r < 3; r++) for (let c = 0; c < 5; c++) if (buttonId(r, c) === id) pos = { r, c };
    decoded = `id=${id} state=${st}(ignored) ` + (pos ? `=> r${pos.r}c${pos.c} PRESS` : '(unmapped id)');
  }
  put(`  #${count} ${decoded}  raw=${hex} len=${len}`);
});

async function phase(title, prep, seconds) {
  rule();
  put(`【${title}】`);
  await prep();
  const before = count;
  put(`>>> 现在开始按设备上的键，连续按 5~10 次，持续 ${seconds} 秒 <<<`);
  await new Promise((r) => setTimeout(r, seconds * 1000));
  const got = count - before;
  put(`【${title}】收到 ${got} 条输入报文`);
  return got;
}

(async () => {
  const a = await phase('A 屏幕点亮状态', () => dev.wake(80, true), per);
  const b = await phase('B 屏幕休眠状态', () => dev.sleep(), per);
  const c = await phase('C 重新点亮', () => dev.wake(80, true), per);

  // ---- D) 长按判定 -------------------------------------------------------
  // 关键问题：按住不放时，设备会不会继续上报？
  //   会  -> 报文持续时长 ≈ 按压时长，短按/长按可以做
  //   不会 -> 只有一条报文、没有抬起事件，"按了多久"永远拿不到，长按做不了
  rule();
  put('【D 长按判定】');
  await dev.wake(80, true);
  const before = count;
  const window_ = 9;
  put(`>>> 现在【按住任意一个键不要松手】，从 1 数到 5 再松手。`);
  put(`>>> 只按这一次，不要连点、不要换键、不要提前松手。`);
  await new Promise((r) => setTimeout(r, window_ * 1000));
  const got = count - before;
  const win = marks.slice(-got);
  const perKey = new Map();
  for (const m of win) perKey.set(m.id, (perKey.get(m.id) || 0) + 1);
  put(`【D 长按判定】${window_} 秒窗口内收到 ${got} 条报文`);
  for (const [id, n] of perKey) {
    const list = win.filter((m) => m.id === id);
    const span = list.length > 1 ? list[list.length - 1].t - list[0].t : 0;
    put(`  键 id=${id}: ${n} 条，首尾跨 ${span}ms`);
  }

  rule();
  put('结论：');
  put(`  A 点亮时  : ${a} 条`);
  put(`  B 休眠时  : ${b} 条`);
  put(`  C 重新点亮: ${c} 条`);
  put(`  D 长按    : ${got} 条（按住 5 秒）`);
  if (a === 0 && b === 0 && c === 0) {
    put('  => 设备完全不上报按键。这不是应用的问题，是设备/驱动层的问题。');
  } else if (a > 0 && b === 0) {
    put('  => 休眠时设备不上报按键。需要在休眠后由应用主动唤醒（不能用"按键唤醒"）。');
  } else if (a > 0) {
    put('  => 设备上报正常，问题在应用侧的解析/分发。');
  }
  if (got <= 2) {
    put('  => 【长按】按住 5 秒只收到 ' + got + ' 条报文：设备不上报按压时长，也不报抬起。');
    put('     结论：这块屏在硬件层无法区分短按/长按，该功能做不了。');
  } else {
    put('  => 【长按】按住期间持续有报文：可以用"报文是否还在来"判断按压时长，长按可做。');
  }

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
