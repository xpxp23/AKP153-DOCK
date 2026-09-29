#!/usr/bin/env node
'use strict';
/**
 * 「这台机器最近在用哪些软件？」—— 三个数据源合并排序。
 *
 *   node tools/recent-apps.js [--top 12] [--json]
 *
 *   A) UserAssist   HKCU\...\Explorer\UserAssist  —— 真正的**打开次数**（值名是 ROT13 的路径）
 *   B) Prefetch     C:\Windows\Prefetch\*.pf      —— **最后运行时间**（文件 mtime 就是运行时刻）
 *   C) 任务栏固定    User Pinned\TaskBar\*.lnk     —— 用户亲手钉的，强信号
 *   再用开始菜单和各处 .lnk 把 exe 名解析成完整路径。
 *
 * 用途：让 Agent 知道该把哪些软件放进 AKP153 的按键库，而不是靠猜。
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const RAW = path.join(ROOT, 'logs', 'recent-apps-raw.json');
const argv = process.argv.slice(2);
const JSON_OUT = argv.includes('--json');
const topN = Number((argv.find((a) => a.startsWith('--top=')) || '').split('=')[1])
  || Number(argv[argv.indexOf('--top') + 1]) || 12;

// ---------------------------------------------------------------- 采集 ----

const PS = `
$ErrorActionPreference='SilentlyContinue'
$sh = New-Object -ComObject WScript.Shell
$res = @{ userAssist=@(); lnks=@(); appPaths=@() }

# A) UserAssist —— 打开次数
Get-ChildItem 'HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Explorer\\UserAssist' |
  ForEach-Object {
    $k = Get-Item (Join-Path $_.PSPath 'Count')
    if ($k) {
      foreach ($n in $k.GetValueNames()) {
        $v = $k.GetValue($n)
        if ($v -is [byte[]] -and $v.Length -ge 16) {
          $res.userAssist += [pscustomobject]@{
            name  = $n
            count = [BitConverter]::ToInt32($v, 4)
            ft    = [BitConverter]::ToInt64($v, 8)
          }
        }
      }
    }
  }

# C) 任务栏固定 + 开始菜单快捷方式 —— 解析出真实路径
$dirs = @(
  (Join-Path $env:APPDATA 'Microsoft\\Internet Explorer\\Quick Launch\\User Pinned\\TaskBar'),
  (Join-Path $env:APPDATA 'Microsoft\\Windows\\Start Menu\\Programs'),
  (Join-Path $env:ProgramData 'Microsoft\\Windows\\Start Menu\\Programs'),
  (Join-Path $env:APPDATA 'Microsoft\\Windows\\Start Menu\\Programs\\Startup')
)
foreach ($d in $dirs) {
  Get-ChildItem -Path $d -Filter *.lnk -Recurse | ForEach-Object {
    $t = $sh.CreateShortcut($_.FullName).TargetPath
    if ($t) {
      $res.lnks += [pscustomobject]@{
        name   = $_.BaseName
        target = $t
        pinned = ($_.FullName -like '*User Pinned*')
      }
    }
  }
}

# App Paths —— exe 名 -> 完整路径
$roots = @('HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths',
           'HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\App Paths')
foreach ($r in $roots) {
  Get-ChildItem $r | ForEach-Object {
    $p = (Get-Item $_.PSPath).GetValue('')
    if ($p) { $res.appPaths += [pscustomobject]@{ exe = $_.PSChildName; path = $p } }
  }
}

$res | ConvertTo-Json -Depth 4 -Compress | Set-Content -Path ${JSON.stringify(RAW)} -Encoding UTF8
`;

const b64 = Buffer.from(PS, 'utf16le').toString('base64');
const r = spawnSync('powershell.exe',
  ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', b64],
  { windowsHide: true, timeout: 90000, encoding: 'utf8' });
if (r.status !== 0) {
  console.error('采集失败：' + String(r.stderr || '').slice(0, 400));
  process.exit(1);
}

let raw;
try {
  // PowerShell 5.1 的 Set-Content -Encoding UTF8 会写 BOM，JSON.parse 不认
  raw = JSON.parse(fs.readFileSync(RAW, 'utf8').replace(/^\uFEFF/, ''));
} catch (e) {
  console.error('读不到采集结果：' + e.message);
  process.exit(1);
}
for (const k of ['userAssist', 'lnks', 'appPaths']) {
  if (!Array.isArray(raw[k])) raw[k] = raw[k] ? [raw[k]] : [];
}

// ------------------------------------------------------------ 归一化 -----

/** UserAssist 的值名是 ROT13 的完整路径（连盘符也是）。 */
function rot13(s) {
  return s.replace(/[a-zA-Z]/g, (c) => {
    const b = c <= 'Z' ? 65 : 97;
    return String.fromCharCode((c.charCodeAt(0) - b + 13) % 26 + b);
  });
}

/** Windows FILETIME(100ns since 1601) -> ms */
function ftToMs(ft) {
  const n = Number(ft);
  if (!n || n <= 0) return 0;
  return Math.round(n / 10000 - 11644473600000);
}

const exeMap = new Map();     // 小写 exe 名 -> 完整路径
const nameMap = new Map();    // 小写 exe 名 -> 好看的名字
for (const a of raw.appPaths) {
  if (a && a.exe && a.path) exeMap.set(a.exe.toLowerCase(), a.path.replace(/^"|"$/g, ''));
}
for (const l of raw.lnks) {
  if (!l || !l.target) continue;
  const base = path.basename(l.target).toLowerCase();
  if (!exeMap.has(base)) exeMap.set(base, l.target);
  if (!nameMap.has(base)) nameMap.set(base, l.name);
}

// Prefetch：文件 mtime = 最后运行时刻
const pf = new Map();         // 小写 exe 名 -> { last }
const PF_DIR = 'C:\\Windows\\Prefetch';
try {
  for (const f of fs.readdirSync(PF_DIR)) {
    const m = /^(.+)-[0-9A-F]{8}\.pf$/i.exec(f);
    if (!m) continue;
    const exe = m[1].toLowerCase();
    const st = fs.statSync(path.join(PF_DIR, f));
    const prev = pf.get(exe);
    if (!prev || st.mtimeMs > prev.last) pf.set(exe, { last: st.mtimeMs });
  }
} catch (e) { /* 没有权限就跳过 */ }

// -------------------------------------------------------------- 排序 -----

const pinnedSet = new Set(raw.lnks.filter((l) => l && l.pinned).map((l) => path.basename(l.target || '').toLowerCase()));

const skip = /^(?:unins|setup|install|update|crash|report|helper|werfault|bash|sh|git|node|python|stat|ls|wc|electron|conhost|cmd|powershell|pwsh|rundll32|mshta|wscript|cscript|tar|curl|ssh|scp)/i;

const byExe = new Map();
const now = Date.now();

for (const u of raw.userAssist) {
  const p = rot13(String(u.name || ''));
  if (!/\.exe$/i.test(p)) continue;
  const base = path.basename(p.replace(/[^\x20-\x7e\\/:]/g, (c) => c)).toLowerCase();
  if (!base) continue;
  const e = byExe.get(base) || { exe: base, runs: 0, last: 0 };
  e.runs = Math.max(e.runs, Number(u.count) || 0);
  e.last = Math.max(e.last, ftToMs(u.ft));
  byExe.set(base, e);
}

for (const [exe, v] of pf) {
  const e = byExe.get(exe) || { exe, runs: 0, last: 0 };
  e.last = Math.max(e.last, v.last);
  byExe.set(exe, e);
}

const list = [];
for (const [exe, e] of byExe) {
  const full = exeMap.get(exe) || '';
  const isPinned = pinnedSet.has(exe);
  if (!full) continue;                       // 没路径就没法配
  if (skip.test(exe)) continue;
  if (/[\\/](windows|system32|winsxs|syswow64)[\\/]/i.test(full)) continue;
  if (!fs.existsSync(full)) continue;
  const days = e.last ? (now - e.last) / 86400000 : 999;
  if (days > 180 && !isPinned) continue;     // 半年前的别算"最近常用"
  const score = (isPinned ? 100000 : 0) + e.runs * 100 + Math.max(0, 900 - days * 10);
  list.push({
    exe, name: nameMap.get(exe) || path.basename(full, path.extname(full)),
    target: full, runs: e.runs, lastUsed: e.last ? new Date(e.last).toISOString().slice(0, 10) : '',
    pinned: isPinned, daysAgo: Math.round(days), score,
  });
}

list.sort((a, b) => b.score - a.score);
const top = list.slice(0, topN);

// -------------------------------------------------------------- 输出 -----

if (JSON_OUT) {
  console.log(JSON.stringify({ ok: true, candidates: top, total: list.length }, null, 2));
} else {
  console.log(`候选 ${list.length} 个，按「固定 > 打开次数 > 最近使用」排序，前 ${top.length}：\n`);
  console.log('  #  名字                 打开  最后用   距今天  固定  路径');
  top.forEach((c, i) => {
    console.log(`  ${String(i + 1).padStart(2)}  ${c.name.slice(0, 18).padEnd(20)}`
      + `${String(c.runs).padStart(3)}  ${c.lastUsed.padEnd(10)}`
      + `${String(c.daysAgo).padStart(4)} 天  ${c.pinned ? ' 是 ' : '    '} ${c.target}`);
  });
}
