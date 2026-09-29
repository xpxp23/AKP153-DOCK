#!/usr/bin/env node
'use strict';
/**
 * config-cli —— 让 Agent（或你）用一条命令配置按键，而不是手改 config.json。
 *
 *   node tools/config-cli.js show
 *   node tools/config-cli.js set r0c0 --type app --target "F:\Program Files\QOwnNotes\QOwnNotes.exe"
 *   node tools/config-cli.js set r2c1 --type page --mode next
 *   node tools/config-cli.js set-page 主页面 --from patch.json
 *   node tools/config-cli.js strip 2 --type page
 *   node tools/config-cli.js lib-add r0c0 --name "QOwnNotes" --tags 笔记,常用
 *
 * 所有写操作都会走 config.js 的原子保存（tmp + rename）。
 * 应用在跑也不用重启：主进程监听着 config.json，改完 1 秒内自动重载并重画设备。
 *
 * 加 --json 输出机器可读结果（给 Agent 用）。
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const config = require(path.join(ROOT, 'src', 'main', 'config.js'));

// ------------------------------------------------------------------ args

const argv = process.argv.slice(2);
const JSON_OUT = argv.includes('--json');
const CMD = argv.find((a) => !a.startsWith('-'));

function flags() {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { out._.push(a); continue; }
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) out[key] = true;
    else { out[key] = next; i++; }
  }
  return out;
}

/** r0c0 / 0,0 / r2c4 -> "0,0" */
function cellKey(v) {
  if (!v) return null;
  const m = /^r(\d)c(\d)$/.exec(String(v).trim());
  if (m) return m[1] + ',' + m[2];
  const m2 = /^(\d)\s*,\s*(\d)$/.exec(String(v).trim());
  if (m2) return m2[1] + ',' + m2[2];
  return null;
}

const TYPES = ['app', 'folder', 'url', 'command', 'ps1', 'file', 'page', 'hotkey', 'multi', 'macro', 'qr_decode'];
const PAGE_MODES = ['next', 'prev', 'goto', 'up', 'home'];
const STRIP_TYPES = ['clock', 'text', 'page', 'cpu', 'mem', 'sys'];

const COLOR_FOR = {
  app: '#1565c0', folder: '#ef6c00', url: '#0277bd', command: '#4e342e',
  ps1: '#6a1b9a', page: '#455a64', file: '#37474f', hotkey: '#107c41',
  multi: '#1b5e20', macro: '#1b5e20', qr_decode: '#00838f',
};

// ------------------------------------------------------------------ output

const log = [];
function say(s) { log.push(s); if (!JSON_OUT) console.log(s); }
function done(extra) {
  if (JSON_OUT) console.log(JSON.stringify(Object.assign({ ok: true, log }, extra || {}), null, 2));
}
function die(msg, extra) {
  if (JSON_OUT) console.log(JSON.stringify(Object.assign({ ok: false, error: msg, log }, extra || {}), null, 2));
  else console.error('错误：' + msg);
  process.exit(1);
}

// ------------------------------------------------------------------ helpers

function findPage(ref) {
  if (!ref) return config.currentPage();
  const cfg = config.load();
  return cfg.pages.find((p) => p.id === ref || p.name === ref) || null;
}

function resolvePageRef(ref) {
  const p = findPage(ref);
  return p ? p.id : null;
}

/** Extract a file's icon into a base64 PNG data URL (needs .NET, ~0.6s). */
function iconFor(file) {
  const os = require('os');
  const tmp = path.join(os.tmpdir(), 'akp153-icon-' + Date.now() + '.png');
  const ps = [
    'Add-Type -AssemblyName System.Drawing',
    `$i = [System.Drawing.Icon]::ExtractAssociatedIcon(${JSON.stringify(file)})`,
    'if ($i -ne $null) {',
    `  $b = $i.ToBitmap()`,
    `  $c = New-Object System.Drawing.Bitmap 32,32`,
    '  $g = [System.Drawing.Graphics]::FromImage($c)',
    '  $g.InterpolationMode = "HighQualityBicubic"',
    `  $g.DrawImage($b, 0, 0, 32, 32)`,
    `  $c.Save(${JSON.stringify(tmp)}, [System.Drawing.Imaging.ImageFormat]::Png)`,
    '}',
  ].join('\n');
  const b64 = Buffer.from(ps, 'utf16le').toString('base64');
  const r = require('child_process').spawnSync('powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', b64],
    { windowsHide: true, timeout: 20000 });
  try {
    const buf = fs.readFileSync(tmp);
    fs.unlinkSync(tmp);
    if (r.status !== 0 || !buf.length) return '';
    return 'data:image/png;base64,' + buf.toString('base64');
  } catch (e) {
    return '';
  }
}

function buildSpec(f, opts) {
  const o = opts || {};
  const type = String(f.type || 'app').toLowerCase();
  if (!TYPES.includes(type)) die(`--type 只能是 ${TYPES.join(' / ')}`);
  const spec = {
    type,
    label: f.label || '',
    target: f.target || '',
    args: f.args || '',
    icon: '',
    color: f.color || COLOR_FOR[type] || '#37474f',
  };

  if (type === 'page') {
    const mode = String(f.mode || 'next').toLowerCase();
    if (!PAGE_MODES.includes(mode)) die(`--mode 只能是 ${PAGE_MODES.join(' / ')}`);
    spec.mode = mode;
    spec.pageId = mode === 'goto' ? (resolvePageRef(f.to || f.pageId) || '') : '';
    if (mode === 'goto' && !spec.pageId) die(`--mode goto 需要 --to <页面名或id>`);
    delete spec.target;
    spec.target = '';
    spec.label = spec.label || ({
      next: '下一页', prev: '上一页', up: '返回上级', home: '主页面',
    }[mode] || (findPage(spec.pageId) || {}).name || '切页');
  } else if (type === 'hotkey') {
    spec.hotkey = f.hotkey || f.target || 'Win+D';
    spec.target = spec.hotkey;
    if (!spec.label) spec.label = spec.hotkey;
  } else if (type === 'multi' || type === 'macro') {
    spec.type = 'multi';
    if (!spec.label) spec.label = f.label || '复合宏';
    let actions = [];
    if (f.actions) {
      if (typeof f.actions === 'string') {
        const trimmed = f.actions.trim();
        if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
          try { actions = JSON.parse(trimmed); } catch (e) { die('解析 --actions JSON 失败: ' + e.message); }
        } else if (fs.existsSync(trimmed)) {
          try { actions = JSON.parse(fs.readFileSync(trimmed, 'utf8')); } catch (e) { die('读取 actions 文件失败: ' + e.message); }
        } else {
          actions = trimmed.split(',').map((t) => ({ type: 'app', target: t.trim() }));
        }
      } else if (Array.isArray(f.actions)) {
        actions = f.actions;
      }
    }
    if (!Array.isArray(actions) && typeof actions === 'object') actions = [actions];
    spec.actions = actions;
    if (f.loop || f['loop-mode']) {
      spec.loop = {
        mode: f['loop-mode'] || (f.loop === true ? 'toggle' : String(f.loop)),
        times: Number(f['loop-times']) || 5,
        interval: Number(f['loop-interval']) || 50
      };
    } else {
      spec.loop = spec.loop || { mode: 'once', interval: 50 };
    }
  } else if (type === 'qr_decode') {
    spec.target = 'qr_decode';
    if (!spec.label) spec.label = '扫码解码';
  } else {
    if (!spec.target) die('这个类型需要 --target（程序路径 / 文件夹 / 网址 / 命令行）');
    if (!spec.label) {
      spec.label = type === 'url'
        ? spec.target.replace(/^https?:\/\//, '').replace(/\/.*$/, '').slice(0, 20)
        : path.basename(spec.target, path.extname(spec.target)).slice(0, 20);
    }
  }

  if (f.badge !== undefined) spec.badge = String(f.badge);
  if (f['badge-bg'] !== undefined) spec.badgeBg = String(f['badge-bg']);
  if (f['badge-color'] !== undefined) spec.badgeColor = String(f['badge-color']);
  if (f['custom-color'] !== undefined) spec.customColor = !!f['custom-color'];
  if (f.color2 !== undefined) spec.color2 = String(f.color2);
  if (f['font-size'] !== undefined) spec.fontSize = Number(f['font-size']);
  if (f['icon-scale'] !== undefined) spec.iconScale = Number(f['icon-scale']);
  if (f['label-pos'] !== undefined) spec.labelPos = String(f['label-pos']);

  // 图标：显式 --icon-file 优先，否则对 exe/lnk 自动抽取（和界面里拖文件的行为一致），
  // 用 --no-icons 关掉。
  const autoIcon = o.icons !== false && spec.target && /\.(exe|lnk|ico)$/i.test(spec.target)
    && fs.existsSync(spec.target);
  const iconSrc = f['icon-file'] || (autoIcon ? spec.target : '');
  if (iconSrc) {
    const ic = iconFor(iconSrc);
    if (ic) { spec.icon = ic; say(`  icon: 从 ${iconSrc} 提取`); }
    else if (f['icon-file']) say('  icon: 提取失败（用默认符号代替）');
  }
  return spec;
}

function saveIt() {
  const cfg = config.load();
  config.save(cfg);
}

// ------------------------------------------------------------------ commands

const f = flags();

switch (CMD) {
  case 'show': {
    const cfg = config.load();
    const cur = config.currentPage();
    say(`配置文件：${config.FILE}`);
    say(`当前页：${cur.name}  (${cur.id})`);
    say(`页面（${config.pageTree().length}）：`);
    for (const { page, depth } of config.pageTree()) {
      const n = Object.keys(page.buttons).length;
      say(`  ${'  '.repeat(depth)}${depth ? '↳ ' : ''}${page.name}  [${page.id}]  ${n} 个按键`
        + (page.id === cfg.currentPage ? '   ← 当前' : ''));
    }
    say('');
    say(`「${cur.name}」的按键：`);
    const keysOf = (p) => Object.keys(p.buttons).sort()
      .map((k) => [k, p.buttons[k]]);
    if (!keysOf(cur).length) say('  （空）');
    for (const [k, s] of keysOf(cur)) {
      const where = s.type === 'page' ? `page/${s.mode}` : s.type;
      say(`  ${cellLabel(k)}  ${where.padEnd(12)} ${s.label || ''}  ${s.target || ''}`);
    }
    say('');
    say(`显示屏：`);
    for (const row of ['0', '1', '2']) {
      const s = cur.strips[row] || {};
      say(`  屏${Number(row) + 1}  ${s.type || 'text'}  ${(s.label || '').replace(/\n/g, ' / ')}`);
    }
    say('');
    const g = cur.gradient;
    if (g && g.enabled) {
      say(`整板渐变：已开启 (${g.from} -> ${g.to}, ${g.angle}°)`);
    } else {
      say('整板渐变：已关闭');
    }
    say('');
    say(`按键库：${(cfg.library || []).length} 条`);
    for (const e of cfg.library || []) say(`  ${e.id}  ${e.name}  [${(e.tags || []).join(',')}]`);
    done({ currentPage: cur.id, gradient: cur.gradient, pages: config.pageTree().map((t) => ({ id: t.page.id, name: t.page.name, depth: t.depth })) });
    break;
  }

  case 'set-gradient': {
    const page = findPage(f.page || f._[1]);
    if (!page) die('用法：set-gradient [<页面名>] [--from #xxx] [--to #yyy] [--angle 135] [--disable] [--enable]');
    page.gradient = Object.assign(
      { enabled: false, from: '#1565c0', to: '#6a1b9a', angle: 135 },
      page.gradient || {}
    );
    if (f.disable) page.gradient.enabled = false;
    else if (f.enable) page.gradient.enabled = true;
    else if (f.from || f.to || f.angle !== undefined) page.gradient.enabled = true;
    if (f.from) page.gradient.from = String(f.from);
    if (f.to) page.gradient.to = String(f.to);
    if (f.angle !== undefined) page.gradient.angle = Number(f.angle);
    saveIt();
    say(`已更新「${page.name}」的整板渐变：${page.gradient.enabled ? '已开启' : '已关闭'} (${page.gradient.from} -> ${page.gradient.to}, ${page.gradient.angle}°)`);
    done({ page: page.id, gradient: page.gradient });
    break;
  }

  case 'set': {
    const key = cellKey(f._[1]);
    if (!key) die('用法：set r0c0 --type app --target "C:\\x.exe" [--label 名字] [--page 页面]');
    const page = findPage(f.page);
    if (!page) die(`找不到页面「${f.page}」`);
    const spec = buildSpec(f, {});
    const isNew = !page.buttons[key];
    page.buttons[key] = spec;
    saveIt();
    say(`${isNew ? '新建' : '更新'} ${cellLabel(key)} @ ${page.name}：${spec.type} ${spec.label}`);
    if (page.parent && key === '2,4') {
      say('注意：这是**子页**的右下角，运行时会被自动「返回」键盖住。'
        + '（不会丢，退出子页就恢复；但这个键在子页里按不到。）');
    }
    done({ cell: cellLabel(key), page: page.id, spec, shadowedByBackKey: !!(page.parent && key === '2,4') });
    break;
  }

  case 'clear': {
    const key = cellKey(f._[1]);
    if (!key) die('用法：clear r0c0 [--page 页面]');
    const page = findPage(f.page);
    if (!page) die(`找不到页面「${f.page}」`);
    if (!page.buttons[key]) die(`${cellLabel(key)} 本来就是空的`);
    delete page.buttons[key];
    saveIt();
    say(`已清空 ${cellLabel(key)} @ ${page.name}`);
    done({ cell: cellLabel(key), page: page.id });
    break;
  }

  case 'set-page': {
    // 整页配置：--from patch.json（{"r0c0": {...}, ...}）或 --from -（stdin）
    const page = findPage(f.page || f._[1]);
    if (!page) die('用法：set-page <页面名> --from patch.json  [--replace]');
    if (!f.from) die('缺 --from <json文件>（或 --from - 从 stdin 读）');
    let raw;
    if (f.from === '-') {
      try { raw = fs.readFileSync(0, 'utf8'); } catch (e) { die('读 stdin 失败：' + e.message); }
    } else {
      try { raw = fs.readFileSync(f.from, 'utf8'); } catch (e) { die('读不到 ' + f.from + '：' + e.message); }
    }
    let patch;
    try { patch = JSON.parse(raw); } catch (e) { die('不是合法 JSON：' + e.message); }
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) die('JSON 顶层要是一个对象：{"r0c0": {...}, ...}');

    if (f.replace) { page.buttons = {}; say('已清空原页面（--replace）'); }
    let n = 0;
    for (const [k, v] of Object.entries(patch)) {
      const key = cellKey(k);
      if (!key) die(`键名不合法：${k}（要形如 r0c0）`);
      if (v === null) { delete page.buttons[key]; n++; continue; }
      if (typeof v !== 'object') die(`${k} 的值要是一个对象或 null`);
      const spec = Object.assign({ args: '', icon: '', color: COLOR_FOR[v.type] || '#37474f' }, v);
      if (spec.type === 'page' && !spec.mode) spec.mode = 'next';
      page.buttons[key] = spec;
      n++;
    }
    saveIt();
    say(`已写入 ${n} 个按键到「${page.name}」`);
    done({ page: page.id, written: n });
    break;
  }

  case 'add-page': {
    const name = f._[1] || f.name;
    if (!name) die('用法：add-page <名字> [--parent <页面>]');
    const cfg = config.load();
    let parent = null;
    if (f.parent) {
      parent = resolvePageRef(f.parent);
      if (!parent) die(`找不到父页面「${f.parent}」`);
    }
    const id = config.newPageId();
    cfg.pages.push({ id, name: String(name), parent, buttons: {}, strips: {} });
    cfg.currentPage = id;
    saveIt();
    say(`已新建${parent ? '子页' : '顶层页'}「${name}」[${id}]${parent ? '（进去后右下角自动是返回键）' : ''}`);
    done({ page: id, name, parent });
    break;
  }

  case 'rm-page': {
    const page = findPage(f._[1] || f.page);
    if (!page) die('用法：rm-page <页面名或id>');
    const cfg = config.load();
    if (cfg.pages.length <= 1) die('至少要留一页');
    const doomed = [page.id];
    const collect = (id) => { for (const c of config.childPages(id)) { doomed.push(c.id); collect(c.id); } };
    collect(page.id);
    cfg.pages = cfg.pages.filter((p) => !doomed.includes(p.id));
    if (doomed.includes(cfg.currentPage)) cfg.currentPage = page.parent || cfg.pages[0].id;
    saveIt();
    say(`已删除「${page.name}」以及 ${doomed.length - 1} 个子页`);
    done({ removed: doomed });
    break;
  }

  case 'use': {
    const id = resolvePageRef(f._[1] || f.page);
    if (!id) die('用法：use <页面名或id>');
    const cfg = config.load();
    cfg.currentPage = id;
    saveIt();
    say(`当前页已切到「${findPage(id).name}」`);
    done({ currentPage: id });
    break;
  }

  case 'rename-page': {
    const page = findPage(f._[1] || f.page);
    if (!page) die('用法：rename-page <页面> --to <新名字>');
    if (!f.to) die('缺 --to <新名字>');
    page.name = String(f.to);
    saveIt();
    say(`已改名为「${page.name}」`);
    done({ page: page.id, name: page.name });
    break;
  }

  case 'strip': {
    const n = String(f._[1] != null ? f._[1] : f.n);
    if (!['0', '1', '2'].includes(n)) die('用法：strip <0|1|2> --type clock|text|page [--label 文字] [--color #hex]');
    const page = findPage(f.page);
    if (!page) die(`找不到页面「${f.page}」`);
    const type = String(f.type || 'text').toLowerCase();
    if (!STRIP_TYPES.includes(type)) die(`--type 只能是 ${STRIP_TYPES.join(' / ')}`);
    page.strips[n] = Object.assign({}, page.strips[n], {
      type,
      label: f.label != null ? String(f.label) : (page.strips[n] || {}).label || '',
      color: f.color || (page.strips[n] || {}).color || '#263238',
    });
    saveIt();
    say(`屏${Number(n) + 1} @ ${page.name} -> ${type}`);
    done({ strip: Number(n), page: page.id });
    break;
  }

  case 'lib-list': {
    const cfg = config.load();
    const list = f.tag ? (cfg.library || []).filter((e) => (e.tags || []).includes(f.tag)) : (cfg.library || []);
    say(`按键库 ${list.length} 条${f.tag ? `（标签 ${f.tag}）` : ''}：`);
    for (const e of list) {
      const isPage = e.kind === 'page' || (!e.spec && e.page);
      const what = isPage
        ? '整页快照 · ' + Object.keys((e.page || {}).buttons || {}).length + ' 个键'
        : e.spec.type + ' ' + (e.spec.target || '');
      say('  ' + e.id + '  ' + e.name + '  [' + (e.tags || []).join(',') + ']  ' + what);
    }
    done({
      count: list.length,
      entries: list.map((e) => ({
        id: e.id, name: e.name, tags: e.tags,
        kind: (e.kind === 'page' || (!e.spec && e.page)) ? 'page' : 'key',
      })),
    });
    break;
  }

  case 'lib-add': {
    const key = cellKey(f._[1]);
    if (!key) die('用法：lib-add r0c0 [--name 名字] [--tags a,b] [--page 页面]');
    const page = findPage(f.page);
    if (!page) die(`找不到页面「${f.page}」`);
    const spec = page.buttons[key];
    if (!spec) die(`${cellLabel(key)} 是空的，没有可存的配置`);
    const cfg = config.load();
    cfg.library = cfg.library || [];
    const name = String(f.name || spec.label || cellLabel(key)).slice(0, 24);
    cfg.library.unshift({
      id: 'L' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
      name,
      tags: config.normalizeTags(f.tags || ''),
      savedAt: new Date().toISOString(),
      spec: JSON.parse(JSON.stringify(spec)),
    });
    saveIt();
    say(`已存入按键库：「${name}」`);
    done({ name, tags: config.normalizeTags(f.tags || '') });
    break;
  }

  case 'lib-put': {
    // 直接把一个软件/网址/命令存进库 —— 不需要先占一个格子。
    // （lib-add 是"把某个格子里已配好的东西存进库"，两者用途不同）
    const cfg = config.load();
    cfg.library = cfg.library || [];

    // 批量：--from lib.json  = [{name, tags, type, target, label?, color?}, ...]
    // 一次写完，避免逐个条目各写一次文件。
    if (f.from) {
      let raw;
      try {
        raw = f.from === '-' ? fs.readFileSync(0, 'utf8') : fs.readFileSync(f.from, 'utf8');
      } catch (e) { die('读不到 ' + f.from + '：' + e.message); }
      let list;
      try { list = JSON.parse(raw); } catch (e) { die('不是合法 JSON：' + e.message); }
      if (!Array.isArray(list)) die('顶层要是一个数组：[{name, tags, target}, ...]');
      let n = 0;
      const icons = f.icons !== false;      // 默认顺便抽图标；--no-icons 关掉
      for (const item of list) {
        if (!item || !item.target) { say(`  跳过（没有 target）：${JSON.stringify(item)}`); continue; }
        const one = Object.assign({}, f, item);
        const spec = buildSpec(one, { icons });
        const name = String(item.name || spec.label || spec.target).slice(0, 24);
        cfg.library.unshift({
          id: 'L' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5) + n,
          name,
          tags: config.normalizeTags(item.tags),
          savedAt: new Date().toISOString(),
          spec,
        });
        n++;
      }
      saveIt();
      say(`已批量存入按键库 ${n} 条`);
      done({ added: n });
      break;
    }

    const spec = buildSpec(f, {});
    const name = String(f.name || spec.label || spec.target).slice(0, 24);
    const tags = config.normalizeTags(f.tags || '');
    cfg.library.unshift({
      id: 'L' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
      name,
      tags,
      savedAt: new Date().toISOString(),
      spec,
    });
    saveIt();
    say(`已存入按键库：「${name}」${tags.length ? '  标签 ' + tags.join('/') : ''}`);
    done({ name, tags, spec });
    break;
  }

  case 'lib-page': {
    // 整页快照：把某一页（15 键 + 3 屏）存进库，以后能建成新页或覆盖回来
    const page = findPage(f._[1] || f.page);
    if (!page) die('用法：lib-page <页面名> [--name 另起个名] [--tags a,b]');
    if (!Object.keys(page.buttons).length) die(`「${page.name}」是空的，没什么可存`);
    const cfg = config.load();
    cfg.library = cfg.library || [];
    const name = String(f.name || page.name).slice(0, 24);
    cfg.library.unshift({
      id: 'L' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
      name, kind: 'page', tags: config.normalizeTags(f.tags || '整页'),
      savedAt: new Date().toISOString(),
      page: { buttons: JSON.parse(JSON.stringify(page.buttons)), strips: JSON.parse(JSON.stringify(page.strips)) },
    });
    saveIt();
    say(`已把整页「${page.name}」存入按键库（${Object.keys(page.buttons).length} 个键），库里叫「${name}」`);
    done({ name, keys: Object.keys(page.buttons).length });
    break;
  }

  case 'lib-restore': {
    // 把整页快照还原：--as new（建成新页）或 --as overwrite（覆盖指定页）
    const ref = f._[1] || f.name;
    if (!ref) die('用法：lib-restore <库条目名或id> --as new|overwrite [--page 页面]');
    const cfg = config.load();
    const e = (cfg.library || []).find((x) => x.id === ref || x.name === ref);
    if (!e) die(`库里没有「${ref}」`);
    if (e.kind !== 'page' && !e.page) die('这一条不是整页快照（它是单个按键）');
    const how = String(f.as || 'new').toLowerCase();
    if (how === 'overwrite') {
      const page = findPage(f.page);
      if (!page) die('缺 --page <页面名>');
      page.buttons = JSON.parse(JSON.stringify(e.page.buttons || {}));
      page.strips = JSON.parse(JSON.stringify(e.page.strips || {}));
      saveIt();
      say(`已用「${e.name}」覆盖「${page.name}」`);
      done({ mode: 'overwrite', page: page.id });
      break;
    }
    const id = config.newPageId();
    cfg.pages.push({
      id, name: String(f.name2 || e.name).slice(0, 24), parent: null,
      buttons: JSON.parse(JSON.stringify(e.page.buttons || {})),
      strips: JSON.parse(JSON.stringify(e.page.strips || {})),
    });
    cfg.currentPage = id;
    saveIt();
    say(`已用「${e.name}」建成新页`);
    done({ mode: 'new', page: id });
    break;
  }

  case 'lib-rm': {
    const ref = f._[1] || f.id || f.name;
    if (!ref) die('用法：lib-rm <id 或 名字>');
    const cfg = config.load();
    const before = (cfg.library || []).length;
    cfg.library = (cfg.library || []).filter((e) => e.id !== ref && e.name !== ref);
    if (cfg.library.length === before) die(`库里没有「${ref}」`);
    saveIt();
    say(`已从库里删掉 ${before - cfg.library.length} 条`);
    done({ removed: before - cfg.library.length });
    break;
  }

  case 'backup': {
    const dir = path.join(ROOT, 'backups');
    fs.mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const dst = path.join(dir, `config-${stamp}.json`);
    fs.copyFileSync(config.FILE, dst);
    say('已备份到 ' + dst);
    done({ path: dst });
    break;
  }

  default:
    console.log(`config-cli —— 配置 AKP153 的按键

  show                                    看全部页面/按键/库
  set <rXcY> --type <t> --target <路径>     配一个键
      --label 名字 --args 参数 --color #hex --icon-file <文件> --page <页面>
      --type page --mode next|prev|goto|up|home [--to <页面>]
  clear <rXcY> [--page <页面>]             清空一个键
  set-page <页面> --from <json|-> [--replace]   整页写入（{"r0c0": {...}}）
  add-page <名字> [--parent <页面>]         新建页 / 子页
  rm-page <页面>                           删除页（连带子页）
  rename-page <页面> --to <新名>
  use <页面>                               切换当前页
  set-gradient [<页面>] [--from #hex] [--to #hex] [--angle 度数] [--enable|--disable]
                                          设置当前页（或指定页）的整板渐变
  strip <0|1|2> --type clock|text|page [--label 文字] [--color #hex]
  lib-list [--tag <标签>]                  看按键库
  lib-add <rXcY> [--name 名字] [--tags a,b] 把某个格子里配好的东西存进库
  lib-put --type <t> --target <路径> [--name 名字] [--tags a,b] [--icon-file <文件>]
                                          直接把一个软件/网址存进库（不用先占格子）
  lib-page <页面> [--name 名字] [--tags a,b]  把整页存进库（整页快照）
  lib-restore <库条目> --as new|overwrite [--page 页面]  用整页快照还原
  lib-rm <id|名字>                         从库里删
  backup                                   备份 config.json

加 --json 输出机器可读结果。
改完不用重启应用：主进程监听着 config.json，约 1 秒内自动重载并重画设备。`);
    process.exit(CMD ? 1 : 0);
}

function cellLabel(key) {
  const [r, c] = key.split(',').map(Number);
  return `r${r}c${c}${c === 5 ? '（显示屏）' : ''}`;
}
