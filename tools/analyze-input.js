// 从 logs/main.log 里把按键报文还原成时序，用来判断设备能否区分短按/长按。
//
//   npm run log:input              看全部按键的时序
//   npm run log:input -- 13        只看某个键（13 = r0c0，键号公式 13-3*列+行）
//
// 判读方法：
//   按住 2 秒后，同一个键如果出现「两条报文、间隔约 2000ms」-> 第二条是抬起报文，
//     长按可以做（间隔 = 按压时长）。
//   如果不管按多久，同一键的两条报文间隔都固定在几十毫秒 -> 那是抖动/回显，
//     设备不上报抬起，长按做不了。
const fs = require('fs');
const path = require('path');

const LOG = path.join(__dirname, '..', 'logs', 'main.log');
const only = process.argv.slice(2).find((a) => /^\d+$/.test(a));

const RX = /^\[(\d{4}-\d{2}-\d{2}T[\d:.]+Z)\]\s+host stderr:\s+\[input\]\s+len=(\d+)\s+id=(\d+)\s+state=(\d+)\s+mapped=(\w+)/;

let raw;
try {
  raw = fs.readFileSync(LOG, 'utf8');
} catch (e) {
  console.log('读不到 ' + LOG + '（先运行应用并按几次键）');
  process.exit(1);
}

const events = [];
for (const line of raw.split(/\r?\n/)) {
  const m = RX.exec(line);
  if (!m) continue;
  events.push({ t: Date.parse(m[1]), id: Number(m[3]), state: Number(m[4]) });
}

console.log(`共解析到 ${events.length} 条按键报文（${LOG}）`);
if (!events.length) {
  console.log('没有报文。先运行应用、按几次键，再跑这个工具。');
  process.exit(0);
}

const byId = new Map();
for (const e of events) {
  if (!byId.has(e.id)) byId.set(e.id, []);
  byId.get(e.id).push(e);
}

const r0c0 = 13;
const posOf = (id) => {
  for (let r = 0; r < 3; r++) for (let c = 0; c < 5; c++) if (13 - 3 * c + r === id) return `r${r}c${c}`;
  return id === 16 ? 'Strip1' : id === 17 ? 'Strip2' : id === 18 ? 'Strip3' : `#${id}`;
};

// 一个「按压」= 同一 id 的连续报文，间隔 < 300ms 算同一串
const BURST_GAP = 300;
const summary = [];

for (const [id, list] of [...byId].sort((a, b) => a[0] - b[0])) {
  if (only && id !== only) continue;
  const bursts = [];
  let cur = null;
  for (const e of list) {
    if (cur && e.t - cur.end <= BURST_GAP) {
      cur.end = e.t;
      cur.n++;
      cur.gaps.push(e.t - cur.last);
      cur.last = e.t;
    } else {
      cur = { start: e.t, end: e.t, last: e.t, n: 1, gaps: [] };
      bursts.push(cur);
    }
  }
  console.log('');
  console.log(`id=${id}  ${posOf(id)}   报文 ${list.length} 条，${bursts.length} 次按压`);
  bursts.forEach((b, i) => {
    const dur = b.end - b.start;
    const gapTxt = b.gaps.length ? `  报文间隔 ${b.gaps.join('/')}ms` : '';
    console.log(`  第${i + 1}次  ${new Date(b.start).toLocaleTimeString('zh-CN', { hour12: false })}.${String(b.start % 1000).padStart(3, '0')}  ${b.n} 条  持续 ${dur}ms${gapTxt}`);
  });
  summary.push({ id, bursts: bursts.length, maxDur: Math.max(...bursts.map((b) => b.end - b.start)), n: list.length });
}

console.log('');
console.log('=== 汇总 ===');
console.log('键号  位置    按键次数  单次最多报文数  同一串最长持续');
for (const s of summary) {
  console.log(`${String(s.id).padStart(4)}  ${posOf(s.id).padEnd(7)} ${String(s.bursts).padStart(6)}  ${String(s.n).padStart(12)}  ${String(s.maxDur + 'ms').padStart(14)}`);
}
console.log('');
console.log('判读：如果「同一串最长持续」明显 ≥ 你按住的时间（比如按了 2000ms 这里也接近 2000ms），');
console.log('      说明设备会上报抬起，长按可实现；如果全都只有几十毫秒，说明不上报，长按做不了。');
