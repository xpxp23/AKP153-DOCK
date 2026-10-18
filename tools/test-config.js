// config.js 的单元测试 —— 不依赖 Electron，用副本配置跑（AKP153_CONFIG）。
//
//   npm run test:config
//
// 重点守住：
//   1. v1 扁平配置能迁移成页面树，按键一个不丢
//   2. changedOnDisk() 必须能分清「我们自己写的」和「外部改的」
//   3. 旧版 Key Studio 扁平双态字段 (act2Type/act2Target) 自动迁移为标准 action2 对象
//   4. 旧版 library 中的整页快照 (kind:'page') 自动解耦迁移至 pageSnapshots
//   5. CLI 支持 volume、auto-app、整板渐变与快照管理
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
    '0,0': { type: 'app', label: '记事本', target: 'C:\\Windows\\notepad.exe', args: '', icon: '', color: '#1565c0', toggleAction: true, act2Type: 'command', act2Target: 'taskkill /F /IM notepad.exe' },
    '1,1': { type: 'folder', label: '下载', target: 'D:\\Downloads', args: '', icon: '', color: '#ef6c00' },
    '2,4': { type: 'url', label: 'B站', target: 'https://bilibili.com', args: '', icon: '', color: '#0277bd' },
  },
  strips: { '0': { type: 'clock', label: '', color: '#263238' } },
  library: [
    { id: 'L1', name: '旧条目', spec: { type: 'app', label: 'x', target: 'C:\\x.exe', toggleAction: true, act2Type: 'hotkey', act2Target: 'Alt+F4' } },
    { id: 'L_page1', name: '旧版整页', kind: 'page', page: { buttons: { '0,0': { type: 'url', target: 'https://example.com' } }, strips: {} } },
  ],
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
check('页面按键的旧版 act2Type/act2Target 自动迁移为标准 action2 对象',
  cfg.pages[0].buttons['0,0'].action2 && cfg.pages[0].buttons['0,0'].action2.target === 'taskkill /F /IM notepad.exe' && cfg.pages[0].buttons['0,0'].act2Target === undefined);
check('按键库条目的旧版 act2Type/act2Target 自动迁移为标准 action2 对象',
  cfg.library[0].spec.action2 && cfg.library[0].spec.action2.type === 'hotkey' && cfg.library[0].spec.action2.target === 'Alt+F4');
check('旧版 library 中的整页快照自动解耦迁移至 pageSnapshots',
  cfg.library.length === 1 && Array.isArray(cfg.pageSnapshots) && cfg.pageSnapshots.length === 1 && cfg.pageSnapshots[0].name === '旧版整页');
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

const ext = JSON.parse(fs.readFileSync(FILE, 'utf8'));
ext.pages[0].name = '被外部改过的名字';
fs.writeFileSync(FILE, JSON.stringify(ext, null, 2), 'utf8');
check('外部改了内容 -> changedOnDisk() 为 true', config.changedOnDisk() === true);

config.invalidate();
const reloaded = config.load();
check('重载后拿到外部改动', reloaded.pages[0].name === '被外部改过的名字');
check('重载之后 changedOnDisk() 回到 false', config.changedOnDisk() === false);

const same = fs.readFileSync(FILE, 'utf8');
fs.writeFileSync(FILE, same, 'utf8');
check('外部原样重写 -> 仍然 false（不触发无意义重画）', config.changedOnDisk() === false);

config.save(config.load());
const t0 = Date.now();
while (Date.now() - t0 < 1200) { /* 故意等过原来的 900ms 时间窗 */ }
check('save 之后等 1.2 秒，changedOnDisk() 仍为 false',
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
check('页面自动补全整板渐变默认值与 autoApp 字段',
  json.pages[0].gradient && json.pages[0].gradient.enabled === false && typeof json.pages[0].autoApp === 'string');

// -------------------------------------------------- 5) CLI 回归测试 ---
const cli = path.join(__dirname, 'config-cli.js');
const runCli = (args) => spawnSync(process.execPath, [cli, ...args], {
  env: Object.assign({}, process.env, { AKP153_CONFIG: FILE }),
  encoding: 'utf8',
});

runCli(['set-gradient', '--from', '#112233', '--to', '#445566', '--angle', '90', '--auto-app', 'Code.exe']);
let updated = freshModule().load();
const g = updated.pages[0].gradient;
check('cli set-gradient 与 --auto-app 正常落盘',
  g && g.enabled === true && g.from === '#112233' && g.to === '#445566' && g.angle === 90 && updated.pages[0].autoApp === 'Code.exe');

runCli(['set', 'r1c2', '--type', 'volume', '--action', 'up', '--step', '8']);
updated = freshModule().load();
const volBtn = updated.pages[0].buttons['1,2'];
check('cli 支持配置 volume 音量按键', volBtn && volBtn.type === 'volume' && volBtn.action === 'up' && volBtn.step === 8);

runCli(['strip', '2', '--type', 'volume']);
updated = freshModule().load();
check('cli 支持配置 volume 声学监听副屏', updated.pages[0].strips['2'].type === 'volume');

runCli(['lib-page', '被外部改过的名字', '--name', 'CLI测试快照']);
updated = freshModule().load();
check('cli lib-page 写入独立 pageSnapshots 数组',
  updated.pageSnapshots.some((s) => s.name === 'CLI测试快照'));


runCli(['set-gradient', '--auto-title', 'Bilibili|Figma']);
updated = freshModule().load();
check('cli 支持配置 --auto-title 窗口标题正则匹配', updated.pages[0].autoTitle === 'Bilibili|Figma');

runCli(['set', 'r0c4', '--type', 'widget', '--kind', 'pomodoro']);
updated = freshModule().load();
check('cli 支持配置 widget 动态组件按键 (pomodoro)',
  updated.pages[0].buttons['0,4'] && updated.pages[0].buttons['0,4'].type === 'widget' && updated.pages[0].buttons['0,4'].widgetKind === 'pomodoro');

runCli(['strip', '1', '--type', 'gpu']);
updated = freshModule().load();
check('cli 支持配置 gpu (NVML) 动态监控副屏', updated.pages[0].strips['1'].type === 'gpu');

// -------------------------------------------------- 6) v0.9.5 自愈备份 / 多套 Profile / pluginConfig ---
check('save 自动维护 .bak 备份文件', fs.existsSync(FILE + '.bak'));
fs.writeFileSync(FILE, '{corrupted_json_syntax', 'utf8');
const healed = freshModule().load();
check('config.json 损坏时自动从 .bak 自愈恢复且不丢数据',
  healed.pages[0].name === '被外部改过的名字' && healed.pages.length === 3);

runCli(['set', 'r0c4', '--type', 'widget', '--kind', 'plugin:stock_crypto_ticker', '--plugin-config', '{"symbol":"TSLA","colorScheme":"us"}']);
updated = freshModule().load();
check('cli 支持配置 widget 动态插件与 --plugin-config 参数持久化',
  updated.pages[0].buttons['0,4'] &&
  updated.pages[0].buttons['0,4'].pluginConfig &&
  updated.pages[0].buttons['0,4'].pluginConfig.symbol === 'TSLA');

runCli(['profile-switch', 'stream']);
updated = freshModule().load();
check('cli profile-switch 切换至直播模式并替换整机页面树',
  updated.currentProfile === 'stream' && updated.pages[0].id === 'stream_main');

runCli(['profile-switch', 'office']);
updated = freshModule().load();
check('cli profile-switch 切回办公模式后完整保留此前编辑的 3 个页面',
  updated.currentProfile === 'office' && updated.pages.length === 3 && updated.pages[0].name === '被外部改过的名字');

// ------------------------------------------------------------- 收尾 ------
try { fs.rmSync(DIR, { recursive: true, force: true }); } catch (e) {}

put(failed ? `FAILED: ${failed}` : 'ALL PASS');
const LOG = path.join(__dirname, '..', 'logs', 'config-test.log');
fs.mkdirSync(path.dirname(LOG), { recursive: true });
fs.writeFileSync(LOG, out.join('\n') + '\n', 'utf8');
process.exit(failed ? 1 : 0);
