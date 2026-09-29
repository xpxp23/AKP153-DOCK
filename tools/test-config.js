// config.js 的单元测试 —— 不依赖 Electron，用副本配置跑（AKP153_CONFIG）。
//
//   npm run test:config
//
// 重点守住两件事：
//   1. v1 扁平配置能迁移成页面树，按键一个不丢
//   2. changedOnDisk() 必须能分清「我们自己写的」和「外部改的」
//      —— 这条曾经写错（用时间窗猜），导致每次用户操作后 4 秒必然误报一次
//      "配置已从文件重新导入"，并全屏重画把按键卡住几秒。
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const DIR = path.join(__dirname, '..', '_t');
fs.mkdirSync(DIR, { recursive: true });
const FILE = path.join(DIR, 'config.json');
process.env.AKP153_CONFIG = FILE;

const out = [];
const put = (s) => { out.push(s); console.log(s); };
let failed = 0;
function check(name, cond, extra) {
  if (!cond) failed++;
  put(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '   ' + extra : ''}`);
}

// 用一个全新的 config.js 实例（每次 require 都要清缓存）
function freshModule() {
  delete require.cache[require.resolve('../src/main/config.js')];
  return require('../src/main/config.js');
}

// ---------------------------------------------------------------- 1) 迁移 --
const V1 = {
  version: 1,
  brightness: 65,
  idleSleepMinutes: 5,
  sleepMode: 'nobright',
  openAtLogin: true,
  buttons: {
    '0,0': { type: 'app', label: '记事本', target: 'C:\\Windows\\notepad.exe', args: '', icon: '', color: '#1565c0' },
    '1,1': { type: 'folder', label: '下载', target: 'D:\\Downloads', args: '', icon: '', color: '#ef6c00' },
    '2,4': { type: 'url', label: 'B站', target: 'https://bilibili.com', args: '', icon: '', color: '#0277bd' },
  },
  strips: { '0': { type: 'clock', label: '', color: '#263238' } },
  library: [{ id: 'L1', name: '旧条目', spec: { type: 'app', label: 'x', target: 'C:\\x.exe' } }],
};
fs.writeFileSync(FILE, JSON.stringify(V1, null, 2), 'utf8');

let config = freshModule();
let cfg = config.load();

check('v1 -> v2 迁移成 1 页', cfg.pages.length === 1, `pages=${cfg.pages.length}`);
check('迁移保留了全部按键', Object.keys(cfg.pages[0].buttons).length === 3);
check('迁移后顶层 buttons 已移除', cfg.buttons === undefined && cfg.strips === undefined);
check('迁移保留原设置', cfg.brightness === 65 && cfg.sleepMode === 'nobright');
check('currentPage 指向第一页', cfg.currentPage === cfg.pages[0].id);
check('库里没有 tags 的旧条目补成空数组', Array.isArray(cfg.library[0].tags));
check('老配置里的 page 动作会补默认 mode',
  (() => {
    const c = config.load();
    c.pages[0].buttons['2,4'] = { type: 'page', label: '切页' };
    config.save(c);
    const c2 = freshModule().load();
    return c2.pages[0].buttons['2,4'].mode === 'next';
  })());

// --------------------------------------------------- 2) changedOnDisk ----
config = freshModule();
cfg = config.load();
config.save(cfg);
check('自己 save() 之后 changedOnDisk() 为 false', config.changedOnDisk() === false);

// 模拟外部改动（例如 Agent 跑 config-cli）
const ext = JSON.parse(fs.readFileSync(FILE, 'utf8'));
ext.pages[0].name = '被外部改过的名字';
fs.writeFileSync(FILE, JSON.stringify(ext, null, 2), 'utf8');
check('外部改了内容 -> changedOnDisk() 为 true', config.changedOnDisk() === true);

config.invalidate();
const reloaded = config.load();
check('重载后拿到外部改动', reloaded.pages[0].name === '被外部改过的名字');
check('重载之后 changedOnDisk() 回到 false', config.changedOnDisk() === false);

// 外部原样重写（内容没变）不该被当成改动
const same = fs.readFileSync(FILE, 'utf8');
fs.writeFileSync(FILE, same, 'utf8');
check('外部原样重写 -> 仍然 false（不触发无意义重画）', config.changedOnDisk() === false);

// 时间窗守卫的老 bug 回归：save 之后等一会儿再检查，仍然必须是 false
config.save(config.load());
const t0 = Date.now();
while (Date.now() - t0 < 1200) { /* 故意等过原来的 900ms 时间窗 */ }
check('save 之后等 1.2 秒，changedOnDisk() 仍为 false（旧的时间窗守卫会在这里误报）',
  config.changedOnDisk() === false);

// -------------------------------------------------- 3) 页面树上/下层级 ----
config = freshModule();
cfg = config.load();
const p1 = cfg.pages[0];
const sub = { id: 'psub', name: '娱乐', parent: p1.id, buttons: {}, strips: {} };
const top2 = { id: 'ptop2', name: '媒体', parent: null, buttons: {}, strips: {} };
cfg.pages.push(sub, top2);
config.save(cfg);

const tree = config.pageTree();
check('pageTree 深度优先且带 depth',
  tree.map((t) => t.depth).join(',') === '0,1,0', tree.map((t) => `${t.page.name}(${t.depth})`).join(' '));
check('childPages 找出子页', config.childPages(p1.id).length === 1);

// -------------------------------------------------- 4) 原子性 / 不死锁 ---
check('save 是原子写（不留 .tmp）', !fs.existsSync(FILE + '.tmp'));
const json = JSON.parse(fs.readFileSync(FILE, 'utf8'));
check('落盘的是 v2 结构', json.version === 2 && Array.isArray(json.pages));
check('页面自动补全整板渐变默认值', json.pages[0].gradient && json.pages[0].gradient.enabled === false);

// -------------------------------------------------- 5) set-gradient CLI ---
const cli = path.join(__dirname, 'config-cli.js');
const ret = spawnSync(process.execPath, [cli, 'set-gradient', '--from', '#112233', '--to', '#445566', '--angle', '90'], {
  env: Object.assign({}, process.env, { AKP153_CONFIG: FILE }),
  encoding: 'utf8',
});
const updated = freshModule().load();
const g = updated.pages[0].gradient;
check('cli set-gradient 正常落盘', g && g.enabled === true && g.from === '#112233' && g.to === '#445566' && g.angle === 90);

// ------------------------------------------------------------- 收尾 ------
try { fs.rmSync(DIR, { recursive: true, force: true }); } catch (e) {}

put(failed ? `FAILED: ${failed}` : 'ALL PASS');
const LOG = path.join(__dirname, '..', 'logs', 'config-test.log');
fs.mkdirSync(path.dirname(LOG), { recursive: true });
fs.writeFileSync(LOG, out.join('\n') + '\n', 'utf8');
process.exit(failed ? 1 : 0);
