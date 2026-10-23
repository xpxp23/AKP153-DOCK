'use strict';
/**
 * Runs whatever a button points at. (v0.9)
 * Action types: app | file | folder | url | command | ps1 | hotkey | volume | media | multi | qr_decode | widget | window_toggle
 */
const { spawn, spawnSync, execFile } = require('child_process');
let shell = null;
try { ({ shell } = require('electron')); } catch (_) {}
const path = require('path');
const probe = require('./probe');
const NativeInput = require('./native-input');
const telemetry = require('./telemetry-plugins');

const EXT_EXEC = new Set(['.exe', '.bat', '.cmd', '.com', '.msi', '.ps1']);
const EXT_SCRIPT = new Set(['.bat', '.cmd', '.ps1', '.vbs', '.py', '.sh']);
const FOCUSABLE = new Set(['.exe', '.lnk']);

const PS_TIMEOUT = 8000;
const resolvedNameCache = new Map();   // target -> process name (no extension)
const runningStateCache = new Map();   // lowerProcName -> { running: bool, ts: number }
const RUNNING_CACHE_TTL = 600;

function looksLikeUrl(s) {
  return /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(String(s || '').trim());
}

function exists(p) {
  try { return require('fs').existsSync(p); } catch (e) { return false; }
}

function isScriptTarget(target) {
  const ext = path.extname(String(target || '').trim()).toLowerCase();
  return EXT_SCRIPT.has(ext);
}

/**
 * 解析命令行参数字符串，保留双引号与单引号包裹的带空格路径
 */
function splitArgs(argStr) {
  const s = String(argStr || '').trim();
  if (!s) return [];
  const out = [];
  let cur = '';
  let quote = null;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quote) {
      if (ch === quote) {
        quote = null;
      } else {
        cur += ch;
      }
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (/\s/.test(ch)) {
      if (cur.length > 0) {
        out.push(cur);
        cur = '';
      }
    } else {
      cur += ch;
    }
  }
  if (cur.length > 0) out.push(cur);
  return out;
}

function hexColorDistance(hex1, hex2) {
  const c1 = String(hex1 || '').replace(/^#/, '');
  const c2 = String(hex2 || '').replace(/^#/, '');
  if (c1.length !== 6 || c2.length !== 6) return 999;
  const r1 = parseInt(c1.slice(0, 2), 16) || 0;
  const g1 = parseInt(c1.slice(2, 4), 16) || 0;
  const b1 = parseInt(c1.slice(4, 6), 16) || 0;
  const r2 = parseInt(c2.slice(0, 2), 16) || 0;
  const g2 = parseInt(c2.slice(2, 4), 16) || 0;
  const b2 = parseInt(c2.slice(4, 6), 16) || 0;
  return Math.max(Math.abs(r1 - r2), Math.abs(g1 - g2), Math.abs(b1 - b2));
}

let lastVolTime = 0;
let volStreak = 0;
function computeVolStep(baseStep) {
  const now = Date.now();
  if (now - lastVolTime < 380) {
    volStreak++;
  } else {
    volStreak = 0;
  }
  lastVolTime = now;
  if (volStreak >= 5) return Math.min(25, baseStep * 3);
  if (volStreak >= 3) return Math.min(15, Math.round(baseStep * 2));
  if (volStreak >= 1) return Math.min(10, Math.round(baseStep * 1.5));
  return baseStep;
}

function spawnQuiet(file, args, opts) {
  const child = spawn(file, args, Object.assign({ stdio: 'ignore', windowsHide: true }, opts || {}));
  child.on('error', () => {});
  child.unref();
  return child;
}

function spawnApp(file, args, opts) {
  const child = spawn(file, args || [], Object.assign({
    stdio: 'ignore',
    windowsHide: false,
    detached: true,
  }, opts || {}));
  child.on('error', () => {});
  child.unref();
  return child;
}

const PS_PRELUDE = "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8\n"
  + "$OutputEncoding=[Console]::OutputEncoding\n";

function runPowerShell(script, timeout) {
  return new Promise((resolve) => {
    const b64 = Buffer.from(PS_PRELUDE + script, 'utf16le').toString('base64');
    let out = '';
    let settled = false;
    let child;
    const finish = (v) => { if (!settled) { settled = true; resolve(v); } };
    try {
      child = spawn('powershell.exe',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', b64],
        { windowsHide: true });
    } catch (e) {
      return finish('');
    }
    const timer = setTimeout(() => { try { child.kill(); } catch (e) {} finish(''); }, timeout || PS_TIMEOUT);
    child.stdout.on('data', (d) => { out += d.toString('utf8'); });
    child.stderr.on('data', () => {});
    child.on('error', () => { clearTimeout(timer); finish(''); });
    child.on('close', () => { clearTimeout(timer); finish(out); });
  });
}

const psQuote = (s) => "'" + String(s).replace(/'/g, "''") + "'";

async function processNameFor(target) {
  if (!target) return '';
  const ext = path.extname(target).toLowerCase();
  if (ext !== '.lnk' && ext !== '.url') {
    return path.basename(target, path.extname(target));
  }
  if (resolvedNameCache.has(target)) return resolvedNameCache.get(target);

  try {
    const details = shell && shell.readShortcutLink(target);
    if (details && details.target) {
      const exp = probe.expandPath(details.target);
      if (exp && path.extname(exp)) {
        const n = path.basename(exp, path.extname(exp));
        resolvedNameCache.set(target, n);
        return n;
      }
    }
  } catch (_) {}

  const out = await runPowerShell(`
$ErrorActionPreference='SilentlyContinue'
$sh = New-Object -ComObject WScript.Shell
$t = $sh.CreateShortcut(${psQuote(target)}).TargetPath
Write-Output ('AKP_TARGET=' + $t)
`);
  const m = out.match(/AKP_TARGET=(.+)/);
  let name = '';
  if (m) {
    const t = m[1].trim();
    if (t && path.extname(t)) name = path.basename(t, path.extname(t));
  }
  resolvedNameCache.set(target, name);
  return name;
}

function isRunning(name) {
  if (!name) return false;
  const clean = name.replace(/\.exe$/i, '').toLowerCase();
  const cached = runningStateCache.get(clean);
  if (cached && (Date.now() - cached.ts) < RUNNING_CACHE_TTL) {
    return cached.running;
  }
  try {
    const r = spawnSync('tasklist',
      ['/FI', `IMAGENAME eq ${clean}.exe`, '/NH', '/FO', 'CSV'],
      { encoding: 'latin1', windowsHide: true, timeout: 4000 });
    const alive = String(r.stdout || '').toLowerCase().includes((clean + '.exe').toLowerCase());
    runningStateCache.set(clean, { running: alive, ts: Date.now() });
    return alive;
  } catch (e) {
    return false;
  }
}

function queryTasklistCsvAsync() {
  return new Promise((resolve) => {
    try {
      execFile('tasklist', ['/NH', '/FO', 'CSV'], { encoding: 'latin1', windowsHide: true, timeout: 3500 }, (err, stdout) => {
        if (err || !stdout) return resolve(null);
        const aliveSet = new Set();
        const lines = String(stdout).split(/\r?\n/);
        for (const ln of lines) {
          const m = ln.match(/^"([^"]+)"/);
          if (m && m[1]) {
            aliveSet.add(m[1].replace(/\.exe$/i, '').toLowerCase());
          }
        }
        resolve(aliveSet);
      });
    } catch (_) {
      resolve(null);
    }
  });
}

async function isRunningAsync(name) {
  if (!name) return false;
  const clean = name.replace(/\.exe$/i, '').toLowerCase();
  const cached = runningStateCache.get(clean);
  if (cached && (Date.now() - cached.ts) < RUNNING_CACHE_TTL) {
    return cached.running;
  }
  try {
    const set = await NativeInput.checkProcesses([clean]);
    if (set !== null) {
      const alive = set.has(clean);
      runningStateCache.set(clean, { running: alive, ts: Date.now() });
      return alive;
    }
  } catch (_) {}
  const csvSet = await queryTasklistCsvAsync();
  if (csvSet) {
    const alive = csvSet.has(clean);
    runningStateCache.set(clean, { running: alive, ts: Date.now() });
    return alive;
  }
  return false;
}

async function checkProcessesRunning(names) {
  const list = Array.from(new Set(
    (Array.isArray(names) ? names : [])
      .map((n) => String(n || '').replace(/\.exe$/i, '').toLowerCase())
      .filter(Boolean)
  ));
  if (list.length === 0) return new Set();
  try {
    const set = await NativeInput.checkProcesses(list);
    if (set !== null) {
      const now = Date.now();
      for (const n of list) {
        runningStateCache.set(n, { running: set.has(n), ts: now });
      }
      return set;
    }
  } catch (_) {}

  const csvSet = await queryTasklistCsvAsync();
  const fallbackSet = new Set();
  const now = Date.now();
  if (csvSet) {
    for (const n of list) {
      const alive = csvSet.has(n);
      runningStateCache.set(n, { running: alive, ts: now });
      if (alive) fallbackSet.add(n);
    }
  }
  return fallbackSet;
}

async function activateWindow(name, allowMinimize = false) {
  if (!name) return null;

  try {
    const nat = await NativeInput.activateOrToggleWindow(name, allowMinimize);
    if (nat && nat.ok) {
      const clean = name.replace(/\.exe$/i, '').toLowerCase();
      runningStateCache.set(clean, { running: true, ts: Date.now() });
      return nat.state === 'MINIMIZED' ? 'minimized' : 'focused';
    }
    if (nat && (nat.state === 'NOT_RUNNING' || nat.state === 'TRAY_HIDDEN' || nat.state === 'NOWINDOW')) {
      return null;
    }
  } catch (_) {}

  const out = await runPowerShell(`
$ErrorActionPreference='SilentlyContinue'
$name = ${psQuote(name.replace(/\.exe$/i, ''))}
$allowMin = ${allowMinimize ? '$true' : '$false'}
$proc = $null
for ($i = 0; $i -lt 2 -and -not $proc; $i++) {
  $allMatch = @(Get-Process -Name $name -ErrorAction SilentlyContinue)
  if ($allMatch.Count -eq 0) { break }
  $proc = $allMatch | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
  if (-not $proc -and $i -eq 0) { Start-Sleep -Milliseconds 120 }
}
if (-not $proc) { Write-Output 'AKP_RESULT=nowindow'; exit 0 }

$hwnd = [System.IntPtr]$proc.MainWindowHandle
if ($hwnd -ne [System.IntPtr]::Zero) {
  $win32 = @'
using System;
using System.Runtime.InteropServices;
public class WinApiHelper {
    [DllImport("user32.dll")]
    public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);
    [DllImport("user32.dll")]
    public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")]
    public static extern bool IsIconic(IntPtr hWnd);
    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();
}
'@
  Add-Type -TypeDefinition $win32
  $fg = [WinApiHelper]::GetForegroundWindow()
  if ($allowMin -and ($fg -eq $hwnd) -and -not [WinApiHelper]::IsIconic($hwnd)) {
    [WinApiHelper]::ShowWindowAsync($hwnd, 6) | Out-Null
    Write-Output 'AKP_RESULT=minimized'
    exit 0
  }
  if ([WinApiHelper]::IsIconic($hwnd)) {
    [WinApiHelper]::ShowWindowAsync($hwnd, 9) | Out-Null
  }
  [WinApiHelper]::SetForegroundWindow($hwnd) | Out-Null
}

$ok = (New-Object -ComObject WScript.Shell).AppActivate([int]$proc.Id)
if ($ok) { Write-Output 'AKP_RESULT=focused' } else { Write-Output 'AKP_RESULT=nowindow' }
`);
  if (/AKP_RESULT=minimized/.test(out)) return 'minimized';
  if (/AKP_RESULT=focused/.test(out)) return 'focused';
  return null;
}

async function focusExisting(target, allowMinimize = false, watchProcess = '') {
  try {
    const customProc = String(watchProcess || '').trim().replace(/\.exe$/i, '');
    if (customProc) {
      const winRes = await activateWindow(customProc, allowMinimize);
      if (winRes) return winRes;
    }
    const name = await processNameFor(target);
    if (!name || !(await isRunningAsync(name))) return null;
    return await activateWindow(name, allowMinimize);
  } catch (e) {
    return null;
  }
}

function runShell(line) {
  const child = spawn(line, {
    shell: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  child.on('error', () => {});
  child.unref();
  return child;
}

const activeLoops = new Map(); // keyId -> { stop: false, context }
const busyKeys = new Set();
let onLoopStateCallback = null;

function setLoopStateListener(fn) {
  onLoopStateCallback = fn;
}

function stopAllMacros() {
  for (const [k, token] of activeLoops.entries()) {
    token.stop = true;
    if (onLoopStateCallback) onLoopStateCallback(k, false, token.context);
  }
  activeLoops.clear();
}

function stopMacroForKey(pageId, row, col) {
  if (pageId && typeof pageId === 'object') {
    row = pageId.row;
    col = pageId.col;
    pageId = pageId.pageId;
  }
  if (row === undefined || col === undefined) return false;
  const targetKey = `${pageId || ''}:${row},${col}`;
  const shortKey = `${row},${col}`;
  let stopped = false;
  for (const [k, token] of activeLoops.entries()) {
    if (k === targetKey || k === shortKey || k.endsWith(`:${shortKey}`)) {
      token.stop = true;
      activeLoops.delete(k);
      if (onLoopStateCallback) onLoopStateCallback(k, false, token.context || { pageId, row, col });
      stopped = true;
    }
  }
  return stopped;
}

function stopMacrosForPage(pageId) {
  if (!pageId) return;
  const prefix = `${pageId}:`;
  for (const [k, token] of activeLoops.entries()) {
    if (k.startsWith(prefix)) {
      token.stop = true;
      activeLoops.delete(k);
      if (onLoopStateCallback) onLoopStateCallback(k, false, token.context);
    }
  }
}

/**
 * 执行复合宏中的单步动作或条件分支指令
 * 返回 { ok: true, control?: 'continue' | 'skip_next' | 'abort' }
 */
async function interruptibleDelay(ms, shouldStop) {
  const total = Math.max(10, Math.min(60000, Number(ms) || 50));
  const end = Date.now() + total;
  while (Date.now() < end) {
    if (shouldStop && shouldStop()) return;
    const rem = end - Date.now();
    await new Promise((r) => setTimeout(r, Math.min(25, Math.max(1, rem))));
  }
}

async function runSingleAction(action, shouldStop) {
  if (!action || typeof action !== 'object') return { ok: true };
  if (shouldStop && shouldStop()) return { ok: false, control: 'abort' };
  const type = String(action.type || 'app').toLowerCase();

  switch (type) {
    case 'delay': {
      const ms = Math.max(10, Number(action.ms) || 50);
      await interruptibleDelay(ms, shouldStop);
      return { ok: true };
    }
    case 'if_color': {
      const x = Number(action.x) || 0;
      const y = Number(action.y) || 0;
      const w = Number(action.w) || 0;
      const h = Number(action.h) || 0;
      const targetColor = String(action.color || '#ffffff').trim();
      const tol = Math.max(0, Math.min(255, Number(action.tolerance !== undefined ? action.tolerance : 20)));
      const thenAct = String(action.thenAction || 'click_found').toLowerCase();

      let matched = false;
      let hitX = x;
      let hitY = y;

      if (w > 1 && h > 1) {
        const reg = await NativeInput.findColorInRegion(x, y, w, h, targetColor, tol);
        matched = !!(reg && reg.matched);
        if (matched) { hitX = reg.x; hitY = reg.y; }
      } else {
        const px = await NativeInput.getPixelColor(x, y);
        if (px && px.ok && px.color) {
          matched = hexColorDistance(px.color, targetColor) <= tol;
        }
      }

      if (matched) {
        if (thenAct === 'click' || thenAct === 'click_found') {
          await NativeInput.mouseClick(action.button || 'left', hitX, hitY);
          return { ok: true, matched: true, control: 'continue' };
        }
        if (thenAct === 'abort') {
          // "满足该颜色时立即停止整个宏"
          return { ok: true, matched: true, control: 'abort' };
        }
        return { ok: true, matched: true, control: 'continue' };
      } else {
        if (thenAct === 'continue') {
          // "满足则继续执行后续步骤，不满足则中止"
          return { ok: true, matched: false, control: 'abort' };
        }
        if (thenAct === 'skip_next') {
          return { ok: true, matched: false, control: 'skip_next' };
        }
        return { ok: true, matched: false, control: 'continue' };
      }
    }
    case 'if_process':
    case 'if_window': {
      const proc = String(action.target || '').trim();
      const expectMode = String(action.expect || (action.expectRunning === false ? 'stopped' : 'running')).toLowerCase();
      const thenAct = String(action.thenAction || 'continue').toLowerCase();
      let matched = false;
      if (expectMode === 'foreground' || expectMode === 'background' || expectMode === 'minimized' || expectMode === 'tray_hidden') {
        const wState = proc ? String(await NativeInput.queryWindowState(proc) || '').toUpperCase() : 'NOT_RUNNING';
        if (expectMode === 'foreground') matched = wState === 'FOREGROUND';
        else if (expectMode === 'background') matched = wState === 'VISIBLE_BACKGROUND' || wState === 'BACKGROUND';
        else if (expectMode === 'minimized') matched = wState === 'MINIMIZED';
        else if (expectMode === 'tray_hidden') matched = wState === 'TRAY_HIDDEN';
      } else {
        const alive = proc ? await isRunningAsync(proc) : false;
        matched = expectMode === 'stopped' ? !alive : alive;
      }
      if (thenAct === 'abort') {
        return { ok: true, matched, control: matched ? 'abort' : 'continue' };
      }
      if (matched) {
        return { ok: true, matched: true, control: 'continue' };
      }
      return { ok: true, matched: false, control: thenAct === 'skip_next' ? 'skip_next' : 'abort' };
    }
    case 'if_qr': {
      const qrEngine = require('./qr-engine');
      const res = await qrEngine.runDecode();
      const thenAct = String(action.thenAction || 'open').toLowerCase();
      if (res && res.ok && res.text) {
        if (thenAct === 'click') {
          const cx = Number(action.clickX);
          const cy = Number(action.clickY);
          if (!isNaN(cx) && !isNaN(cy)) {
            await NativeInput.mouseClick('left', cx, cy);
          }
        } else if (thenAct === 'open' || action.openUrl) {
          if (looksLikeUrl(res.text) && shell) {
            await shell.openExternal(res.text);
          } else {
            await NativeInput.sendText(res.text);
          }
        }
        return { ok: true, matched: true, text: res.text, control: 'continue' };
      }
      return {
        ok: true,
        matched: false,
        control: thenAct === 'skip_next' ? 'skip_next' : (thenAct === 'abort' ? 'abort' : 'continue'),
      };
    }
    case 'mouse_click': {
      const btn = action.double ? 'double' : (action.button || 'left');
      const rawX = action.x !== '' && action.x !== undefined && action.x !== null ? Number(action.x) : -1;
      const rawY = action.y !== '' && action.y !== undefined && action.y !== null ? Number(action.y) : -1;
      const usePos = !isNaN(rawX) && !isNaN(rawY) && rawX >= 0 && rawY >= 0;
      await NativeInput.mouseClick(btn, usePos ? rawX : -1, usePos ? rawY : -1);
      return { ok: true };
    }
    case 'mouse_move': {
      const x = Number(action.x) || 0;
      const y = Number(action.y) || 0;
      const duration = Math.max(0, Number(action.duration) || 0);
      await NativeInput.mouseMove(x, y, !!action.relative, duration);
      return { ok: true };
    }
    case 'mouse_drag': {
      const fx = Number(action.fromX !== undefined ? action.fromX : action.x1) || 0;
      const fy = Number(action.fromY !== undefined ? action.fromY : action.y1) || 0;
      const tx = Number(action.toX !== undefined ? action.toX : action.x2) || 0;
      const ty = Number(action.toY !== undefined ? action.toY : action.y2) || 0;
      const duration = Math.max(50, Number(action.duration) || 300);
      await NativeInput.mouseDrag(fx, fy, tx, ty, duration);
      return { ok: true };
    }
    case 'mouse_wheel': {
      const delta = Number(action.delta) || 120;
      await NativeInput.mouseWheel(delta);
      return { ok: true };
    }
    case 'text': {
      const txt = String(action.content !== undefined ? action.content : (action.text || ''));
      await NativeInput.sendText(txt);
      return { ok: true };
    }
    case 'window_rect': {
      const x = Number(action.x) || 0;
      const y = Number(action.y) || 0;
      const w = Number(action.w) || 1280;
      const h = Number(action.h) || 720;
      const tgt = String(action.target || '');
      await NativeInput.setWindowRect(x, y, w, h, tgt);
      return { ok: true };
    }
    case 'media': {
      const cmd = String(action.cmd || action.action || 'play_pause').toLowerCase();
      if (cmd.includes('up')) {
        await NativeInput.stepVolume(computeVolStep(parseInt(action.step, 10) || 5));
      } else if (cmd.includes('down')) {
        await NativeInput.stepVolume(-computeVolStep(parseInt(action.step, 10) || 5));
      } else if (cmd.includes('mute')) {
        await NativeInput.toggleMute();
      } else if (cmd.includes('switch')) {
        await NativeInput.switchAudioDevice(String(action.target || '').trim());
      } else {
        await NativeInput.sendMedia(cmd);
      }
      return { ok: true };
    }
    case 'volume':
    case 'audio': {
      const act = String(action.action || action.cmd || action.mode || 'up').toLowerCase();
      const baseStep = Math.max(1, parseInt(action.step, 10) || 5);
      if (act.includes('up')) {
        await NativeInput.stepVolume(computeVolStep(baseStep));
      } else if (act.includes('down')) {
        await NativeInput.stepVolume(-computeVolStep(baseStep));
      } else if (act.includes('mute')) {
        await NativeInput.toggleMute();
      } else if (act.includes('set')) {
        await NativeInput.setVolume(parseInt(action.level || action.target || 50, 10));
      } else if (act.includes('switch')) {
        await NativeInput.switchAudioDevice(String(action.target || '').trim());
      }
      return { ok: true };
    }
    case 'hotkey': {
      const combo = String(action.combo || action.target || action.hotkey || '');
      if (combo) await sendHotkey(combo);
      return { ok: true };
    }
    case 'cmd':
    case 'command': {
      return await run(Object.assign({}, action, { type: 'command' }));
    }
    case 'open': {
      return await run(Object.assign({}, action, { type: 'app' }));
    }
    case 'app':
    case 'file':
    case 'folder':
    case 'url':
    case 'ps1':
    default: {
      return await run(action);
    }
  }
}

async function executeNodeFlowOnce(nodeFlow, shouldStop) {
  if (!nodeFlow || !Array.isArray(nodeFlow.nodes) || !nodeFlow.nodes.length) return;
  const nodeMap = new Map(nodeFlow.nodes.map((n) => [String(n.id), n]));
  let cur = nodeFlow.nodes.find((n) => n.kind === 'start') || nodeFlow.nodes[0];
  let steps = 0;
  while (cur && steps < 160) {
    if (shouldStop && shouldStop()) break;
    steps++;
    if (cur.kind === 'start') {
      cur = cur.next ? nodeMap.get(String(cur.next)) : null;
      continue;
    }
    const res = await runSingleAction(cur.action || cur, shouldStop);
    if (cur.kind === 'condition' || (cur.action && String(cur.action.type || '').startsWith('if_'))) {
      const branchId = (res && res.matched) ? cur.nextTrue : cur.nextFalse;
      cur = branchId ? nodeMap.get(String(branchId)) : null;
    } else {
      if (res && res.control === 'abort') break;
      cur = cur.next ? nodeMap.get(String(cur.next)) : null;
    }
  }
}

async function executeActionListOnce(actions, shouldStop, nodeFlow = null) {
  if (nodeFlow && Array.isArray(nodeFlow.nodes) && nodeFlow.nodes.length > 0 && nodeFlow.enabled) {
    await executeNodeFlowOnce(nodeFlow, shouldStop);
    return;
  }
  for (let idx = 0; idx < actions.length; idx++) {
    if (shouldStop && shouldStop()) break;
    const act = actions[idx];
    try {
      const stepRes = await runSingleAction(act, shouldStop);
      if (stepRes && stepRes.control === 'abort') break;
      if (stepRes && stepRes.control === 'skip_next') idx++;
    } catch (_) {}
  }
}

async function runMacro(spec, context) {
  const actions = Array.isArray(spec.actions) ? spec.actions : [];
  if (!actions.length) return { ok: false, error: 'NO_ACTIONS' };

  const keyId = context ? `${context.pageId || ''}:${context.row},${context.col}` : '';
  const loopCfg = (typeof spec.loop === 'object' && spec.loop) ? spec.loop : (spec.loop ? { mode: 'toggle' } : { mode: 'once' });
  const isLoopToggle = loopCfg.mode === 'toggle';

  if (keyId && activeLoops.has(keyId)) {
    const token = activeLoops.get(keyId);
    token.stop = true;
    activeLoops.delete(keyId);
    if (onLoopStateCallback) onLoopStateCallback(keyId, false, context);
    return { ok: true, action: 'loop_stopped' };
  }

  if (keyId && busyKeys.has(keyId)) {
    return { ok: false, error: 'BUSY' };
  }

  if (isLoopToggle && keyId) {
    const token = { stop: false, context };
    activeLoops.set(keyId, token);
    if (onLoopStateCallback) onLoopStateCallback(keyId, true, context);

    (async () => {
      const minInterval = Math.max(50, Number(spec.loopInterval || loopCfg.interval) || 50);
      try {
        while (!token.stop) {
          await executeActionListOnce(actions, () => token.stop, spec.nodeFlow);
          if (token.stop) break;
          await new Promise((r) => setTimeout(r, minInterval));
        }
      } catch (err) {
        console.error('Macro loop error:', err);
      } finally {
        activeLoops.delete(keyId);
        if (onLoopStateCallback) onLoopStateCallback(keyId, false, context);
      }
    })();

    return { ok: true, action: 'loop_started' };
  }

  const token = { stop: false, context };
  if (keyId) {
    busyKeys.add(keyId);
    activeLoops.set(keyId, token);
    if (onLoopStateCallback) onLoopStateCallback(keyId, true, context);
  }
  try {
    const times = (loopCfg.mode === 'times' && Number(loopCfg.times) > 0) ? Number(loopCfg.times) : 1;
    const interval = Math.max(20, Number(spec.loopInterval || loopCfg.interval) || 50);

    for (let i = 0; i < times; i++) {
      if (token.stop) break;
      await executeActionListOnce(actions, () => token.stop, spec.nodeFlow);
      if (i < times - 1 && !token.stop) {
        await interruptibleDelay(interval, () => token.stop);
      }
    }
    return { ok: true, action: token.stop ? 'loop_stopped' : 'macro_completed' };
  } finally {
    if (keyId) {
      busyKeys.delete(keyId);
      if (activeLoops.get(keyId) === token) {
        activeLoops.delete(keyId);
        if (onLoopStateCallback) onLoopStateCallback(keyId, false, context);
      }
    }
  }
}

async function run(spec, context, options = {}) {
  if (!spec) return { ok: false, error: 'EMPTY' };
  const type = String(spec.type || 'app').toLowerCase();

  if (type === 'multi' || type === 'macro') {
    return await runMacro(spec, context);
  }

  if (type === 'qr_decode' || type === 'qr') {
    const qrEngine = require('./qr-engine');
    const res = await qrEngine.runDecode();
    return Object.assign({ action: 'qr_decode' }, res);
  }

  if (type === 'widget') {
    const wKind = String(spec.widgetKind || spec.widgetType || spec.subType || spec.target || 'pomodoro').toLowerCase();
    const act = String(spec.action || 'refresh').toLowerCase();
    const spanCols = Math.max(1, Number((context && context.spanCols) || spec.spanCols) || 1);
    const spanOffset = Math.max(0, Number(context && context.spanOffset) || 0);

    // 跨格宽屏联屏按键分区智能动作：
    // 例如 3 格宽屏音乐播放器：左键上一曲、中键播放/暂停、右键下一曲
    if (wKind === 'media_now' && spanCols >= 2) {
      if (spanCols === 3) {
        const subCmd = spanOffset === 0 ? 'prev' : (spanOffset === 2 ? 'next' : 'play_pause');
        await NativeInput.sendMedia(subCmd);
        return { ok: true, action: 'widget_media_' + subCmd };
      } else if (spanCols === 2) {
        const subCmd = spanOffset === 1 ? 'next' : 'play_pause';
        await NativeInput.sendMedia(subCmd);
        return { ok: true, action: 'widget_media_' + subCmd };
      }
    }
    if (wKind === 'pomodoro' && spanCols >= 2 && spanOffset > 0) {
      const subAct = (spanCols === 3 && spanOffset === 1) ? 'skip' : 'reset';
      const snap = telemetry.controlPomodoro(subAct, spec.minutes || 25);
      return { ok: true, action: 'widget_pomodoro', pomodoro: snap };
    }

    if (act === 'open_taskmgr') {
      spawnQuiet('taskmgr.exe', []);
      return { ok: true, action: 'widget_taskmgr' };
    }
    if (wKind === 'pomodoro' || act.startsWith('pomodoro_')) {
      const pAct = act.replace(/^pomodoro_/, '') || 'toggle';
      const snap = telemetry.controlPomodoro(pAct, spec.minutes || 25);
      return { ok: true, action: 'widget_pomodoro', pomodoro: snap };
    }
    if (wKind === 'media_now' || act.startsWith('media_')) {
      const mCmd = act.replace(/^media_/, '') || 'play_pause';
      await NativeInput.sendMedia(mCmd);
      return { ok: true, action: 'widget_media' };
    }
    if (wKind === 'obs') {
      const combo = spec.hotkey || '';
      if (combo) await sendHotkey(combo);
      else await focusExisting('obs64.exe', false);
      return { ok: true, action: 'widget_obs' };
    }
    if (wKind === 'plugin' || act === 'plugin_click') {
      const pid = spec.pluginId || 'uptime_greeting';
      const pRes = await telemetry.triggerPluginPress(pid, spec.args, spec.pluginConfig || {}, context || {});
      return Object.assign({ ok: true, action: 'widget_plugin' }, pRes || {});
    }
    return { ok: true, action: 'widget_refresh' };
  }

  if (type === 'window_toggle') {
    const rawProc = String(spec.watchProcess || spec.target || '').trim();
    const procName = rawProc.includes('\\') || rawProc.includes('/')
      ? await processNameFor(await probe.probeAppAsync(rawProc))
      : rawProc.replace(/\.exe$/i, '');
    if (!procName) return { ok: false, error: '未指定目标窗口进程名' };
    const winRes = await activateWindow(procName, true);
    if (winRes) {
      return { ok: true, action: 'window_' + winRes, windowState: winRes };
    }
    if (spec.launchTarget || (spec.target && (spec.target.includes('\\') || spec.target.includes('/')))) {
      return await run(Object.assign({}, spec, { type: 'app', target: spec.launchTarget || spec.target }));
    }
    return { ok: false, error: '目标程序尚未运行：' + procName };
  }

  if (type === 'plugin_action') {
    const pid = spec.pluginId || spec.target || 'obs_studio';
    const pRes = await telemetry.triggerPluginPress(pid, { action: spec.action || spec.cmd, pluginConfig: spec.pluginConfig || {} }, spec.pluginConfig || {}, context || {});
    return Object.assign({ ok: true, action: 'plugin_action' }, pRes || {});
  }

  if (type === 'app_volume' || ((type === 'volume' || type === 'audio') && String(spec.action || '').toLowerCase().startsWith('app_'))) {
    const rawAct = String(spec.action || 'app_mute').toLowerCase().replace(/^app_/, '');
    const appTarget = String(spec.appTarget || spec.target || '@foreground').trim() || '@foreground';
    const baseStep = Math.max(1, parseInt(spec.step, 10) || 10);
    if (rawAct.includes('up')) {
      const res = await NativeInput.stepAppAudioVolume(appTarget, baseStep);
      return Object.assign({ ok: true, action: 'app_volume_up', appTarget }, res);
    }
    if (rawAct.includes('down')) {
      const res = await NativeInput.stepAppAudioVolume(appTarget, -baseStep);
      return Object.assign({ ok: true, action: 'app_volume_down', appTarget }, res);
    }
    if (rawAct.includes('set')) {
      const lvl = Math.max(0, Math.min(100, parseInt(spec.level !== undefined ? spec.level : 50, 10)));
      const res = await NativeInput.setAppAudioVolume(appTarget, lvl);
      return Object.assign({ ok: true, action: 'app_volume_set', appTarget, level: lvl }, res);
    }
    const res = await NativeInput.toggleAppAudioMute(appTarget, 'toggle');
    return Object.assign({ ok: true, action: 'app_volume_mute', appTarget }, res);
  }

  if (type === 'volume' || type === 'audio') {
    const act = String(spec.action || spec.subType || spec.mode || spec.target || 'up').toLowerCase();
    const baseStep = Math.max(1, parseInt(spec.step, 10) || 5);
    if (act.includes('up')) {
      const step = computeVolStep(baseStep);
      const res = await NativeInput.stepVolume(step);
      return Object.assign({ ok: true, action: 'volume_up', step }, res);
    }
    if (act.includes('down')) {
      const step = computeVolStep(baseStep);
      const res = await NativeInput.stepVolume(-step);
      return Object.assign({ ok: true, action: 'volume_down', step }, res);
    }
    if (act.includes('mute')) {
      const res = await NativeInput.toggleMute();
      return Object.assign({ ok: true, action: 'volume_mute' }, res);
    }
    if (act.includes('set')) {
      const lvl = Math.max(0, Math.min(100, parseInt(spec.level || spec.target || 50, 10)));
      const res = await NativeInput.setVolume(lvl);
      return Object.assign({ ok: true, action: 'volume_set', level: lvl }, res);
    }
    if (act.includes('switch') || act.includes('device')) {
      const targetDev = String(spec.target || spec.device || '').trim();
      const res = await NativeInput.switchAudioDevice(targetDev);
      return Object.assign({ ok: true, action: 'audio_device_switched' }, res);
    }
    const step = computeVolStep(baseStep);
    const res = await NativeInput.stepVolume(step);
    return Object.assign({ ok: true, action: 'volume_up', step }, res);
  }

  if (type === 'media') {
    const VALID_MEDIA = ['play_pause', 'next', 'prev', 'mute', 'vol_up', 'vol_down', 'stop'];
    const rawTargetCmd = String(spec.target || '').trim().toLowerCase();
    const rawActionCmd = String(spec.action || '').trim().toLowerCase();
    const rawSpecCmd = String(spec.cmd || '').trim().toLowerCase();
    // 修复形态 2 默认写入 cmd: 'play_pause' 覆盖 target 输入 'next'/'prev' 的问题
    const cmd = (rawTargetCmd && VALID_MEDIA.some((k) => rawTargetCmd.includes(k)))
      ? rawTargetCmd
      : (rawActionCmd || rawSpecCmd || rawTargetCmd || 'play_pause');
    await NativeInput.sendMedia(cmd);
    return { ok: true, action: 'media_' + cmd };
  }

  const rawTarget = String(spec.target || spec.hotkey || '');
  if (!rawTarget) return { ok: false, error: 'EMPTY' };

  let target = probe.expandPath(rawTarget);
  if (type === 'app') {
    target = await probe.probeAppAsync(rawTarget);
  }

  try {
    switch (type) {
      case 'url': {
        let u = target;
        if (!looksLikeUrl(u)) u = 'https://' + u.replace(/^\/+/, '');
        await shell.openExternal(u);
        return { ok: true };
      }
      case 'command': {
        const rawCmd = String(target || '').trim();
        const lowerCmd = rawCmd.toLowerCase();
        if (lowerCmd.startsWith('wm_close:')) {
          const procName = rawCmd.slice('wm_close:'.length).trim();
          const closed = await NativeInput.closeWindowGracefully(procName);
          if (!closed || !closed.ok) {
            runShell(`taskkill /IM "${procName.replace(/\.exe$/i, '')}.exe"`);
          }
          return { ok: true, action: 'graceful_close' };
        }
        if (lowerCmd.startsWith('window_toggle:') || lowerCmd.startsWith('smart_window:')) {
          const procName = rawCmd.replace(/^(window_toggle|smart_window):/i, '').trim().replace(/\.exe$/i, '');
          const winRes = await activateWindow(procName, true);
          return { ok: true, action: 'window_' + (winRes || 'none'), windowState: winRes || 'none' };
        }
        if (rawCmd.includes('[char]175')) {
          const step = computeVolStep(5);
          const res = await NativeInput.stepVolume(step);
          return Object.assign({ ok: true, action: 'volume_up', step }, res);
        }
        if (rawCmd.includes('[char]174')) {
          const step = computeVolStep(5);
          const res = await NativeInput.stepVolume(-step);
          return Object.assign({ ok: true, action: 'volume_down', step }, res);
        }
        if (rawCmd.includes('[char]173')) {
          const res = await NativeInput.toggleMute();
          return Object.assign({ ok: true, action: 'volume_mute' }, res);
        }
        if (rawCmd.includes('[char]179')) {
          await NativeInput.sendMedia('play_pause');
          return { ok: true, action: 'media_play_pause' };
        }
        if (rawCmd.includes('[char]176')) {
          await NativeInput.sendMedia('next');
          return { ok: true, action: 'media_next' };
        }
        if (rawCmd.includes('[char]177')) {
          await NativeInput.sendMedia('prev');
          return { ok: true, action: 'media_prev' };
        }
        runShell(target);
        return { ok: true };
      }
      case 'ps1': {
        if (!exists(target)) return { ok: false, error: '找不到脚本：' + target };
        const extraArgs = splitArgs(spec.args);
        spawnQuiet('powershell.exe',
          ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', target].concat(extraArgs));
        return { ok: true };
      }
      case 'hotkey': {
        const combo = String(spec.hotkey || spec.target || '').trim();
        if (!combo) return { ok: false, error: 'EMPTY_HOTKEY' };
        await sendHotkey(combo);
        return { ok: true, action: 'hotkey', combo };
      }
      case 'app':
      case 'file':
      case 'folder':
      default: {
        const ext = path.extname(target).toLowerCase();
        if (looksLikeUrl(target)) { await shell.openExternal(target); return { ok: true }; }
        if (!exists(target)) return { ok: false, error: '找不到文件或文件夹：' + target };

        if (ext === '.ps1') {
          const extraArgs = splitArgs(spec.args);
          spawnQuiet('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', target].concat(extraArgs));
          return { ok: true };
        }

        const wantsArgs = !!(spec.args && String(spec.args).trim());

        if (FOCUSABLE.has(ext) && !wantsArgs && !(options && options.bypassFocusExisting)) {
          // 仅当显式开启窗口模式 (toggleSyncMode === "window") 或显式指定 smartToggle === true 时才将前台窗口最小化
          const allowMinimize = Boolean((spec.toggleAction && spec.toggleSyncMode === 'window') || spec.smartToggle === true);
          const focusResult = await focusExisting(target, allowMinimize, spec.watchProcess);
          if (focusResult) return { ok: true, action: focusResult };
        }

        if (EXT_EXEC.has(ext) && wantsArgs) {
          const args = splitArgs(spec.args);
          spawnApp(target, args, {
            cwd: spec.cwd || path.dirname(target),
          });
          return { ok: true, action: 'spawn' };
        }

        const err = await shell.openPath(target);
        return err ? { ok: false, error: err } : { ok: true, action: 'launched' };
      }
    }
  } catch (e) {
    return { ok: false, error: String(e && e.message) };
  }
}

function escapeSendKeysChar(k) {
  return String(k).replace(/([+^%~(){}])/g, '{$1}');
}

async function sendHotkey(combo) {
  const norm = String(combo || '').trim();
  if (!norm) return;

  const lower = norm.toLowerCase().replace(/\s+/g, '');
  if (lower === 'volume_up' || lower === 'volumeup' || lower === 'volup' || lower === 'audiovolumeup') {
    return await NativeInput.stepVolume(computeVolStep(5));
  }
  if (lower === 'volume_down' || lower === 'volumedown' || lower === 'voldown' || lower === 'audiovolumedown') {
    return await NativeInput.stepVolume(-computeVolStep(5));
  }
  if (lower === 'volume_mute' || lower === 'volumemute' || lower === 'volmute' || lower === 'audiovolumemute') {
    return await NativeInput.toggleMute();
  }
  if (lower === 'media_play_pause' || lower === 'mediaplaypause' || lower === 'play_pause') {
    return await NativeInput.sendMedia('play_pause');
  }
  if (lower === 'media_next_track' || lower === 'medianexttrack' || lower === 'media_next') {
    return await NativeInput.sendMedia('next');
  }
  if (lower === 'media_prev_track' || lower === 'mediaprevtrack' || lower === 'media_prev') {
    return await NativeInput.sendMedia('prev');
  }
  if (lower === 'win+l') {
    spawnQuiet('rundll32.exe', ['user32.dll,LockWorkStation']);
    return;
  }
  if (lower === 'win+e') {
    spawnQuiet('explorer.exe', []);
    return;
  }
  if (lower === 'ctrl+shift+esc') {
    spawnQuiet('taskmgr.exe', []);
    return;
  }

  try {
    const nat = await NativeInput.sendHotkey(norm);
    if (nat && nat.ok) return;
  } catch (_) {}

  if (lower === 'win+d') {
    spawnQuiet('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', '(New-Object -ComObject Shell.Application).ToggleDesktop()']);
    return;
  }
  if (lower === 'win+r') {
    spawnQuiet('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', '(New-Object -ComObject Shell.Application).FileRun()']);
    return;
  }
  if (lower === 'win+m') {
    spawnQuiet('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', '(New-Object -ComObject Shell.Application).MinimizeAll()']);
    return;
  }
  if (lower === 'win+shift+m') {
    spawnQuiet('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', '(New-Object -ComObject Shell.Application).UndoMinimizeALL()']);
    return;
  }

  let prefix = '';
  const parts = norm.split('+').map(s => s.trim());
  let mainKey = '';
  for (const p of parts) {
    const pl = p.toLowerCase();
    if (pl === 'ctrl' || pl === 'control') prefix += '^';
    else if (pl === 'alt') prefix += '%';
    else if (pl === 'shift') prefix += '+';
    else mainKey = p;
  }

  let mappedKey = mainKey.toLowerCase();
  const specialMap = {
    'f1': '{F1}', 'f2': '{F2}', 'f3': '{F3}', 'f4': '{F4}', 'f5': '{F5}', 'f6': '{F6}',
    'f7': '{F7}', 'f8': '{F8}', 'f9': '{F9}', 'f10': '{F10}', 'f11': '{F11}', 'f12': '{F12}',
    'enter': '{ENTER}', 'return': '{ENTER}', 'esc': '{ESC}', 'escape': '{ESC}',
    'tab': '{TAB}', 'backspace': '{BACKSPACE}', 'delete': '{DELETE}', 'del': '{DELETE}',
    'insert': '{INSERT}', 'home': '{HOME}', 'end': '{END}', 'pageup': '{PGUP}', 'pgup': '{PGUP}',
    'pagedown': '{PGDN}', 'pgdn': '{PGDN}', 'up': '{UP}', 'down': '{DOWN}', 'left': '{LEFT}', 'right': '{RIGHT}',
    'space': ' ', 'prtscn': '{PRTSC}', 'printscreen': '{PRTSC}',
  };
  if (specialMap[mappedKey]) {
    mappedKey = specialMap[mappedKey];
  } else if (mappedKey.length === 1) {
    mappedKey = escapeSendKeysChar(mappedKey.toLowerCase());
  } else {
    mappedKey = escapeSendKeysChar(mappedKey);
  }

  const sendKeyStr = prefix + mappedKey;
  await runPowerShell(`(New-Object -ComObject WScript.Shell).SendKeys(${psQuote(sendKeyStr)})`, 3000);
}

function classify(p) {
  if (!p) return { type: 'app', label: '' };
  if (looksLikeUrl(p)) return { type: 'url', label: stripHost(p), abs: p, exists: true };
  const full = path.isAbsolute(p) ? p : path.resolve(p);
  const ext = path.extname(full).toLowerCase();
  let isDir = false;
  let present = false;
  try {
    const st = require('fs').statSync(full);
    isDir = st.isDirectory();
    present = true;
  } catch (e) { /* missing */ }

  const base = { abs: full, exists: present };
  if (isDir) return Object.assign(base, { type: 'folder', label: path.basename(full) || full });
  if (ext === '.lnk') {
    let absPath = full;
    let shortcutArgs = '';
    try {
      const details = shell && shell.readShortcutLink(full);
      if (details && details.target) {
        let tgt = probe.expandPath(details.target);
        if (exists(tgt)) {
          absPath = tgt;
          shortcutArgs = details.args || '';
        }
      }
    } catch (_) {}
    const procExt = path.extname(absPath).toLowerCase();
    const procName = path.basename(absPath, procExt);
    return Object.assign(base, {
      abs: absPath,
      originalLnk: full,
      args: shortcutArgs,
      type: 'app',
      label: path.basename(full, ext),
      processName: procName,
      isScript: EXT_SCRIPT.has(procExt),
    });
  }
  if (ext === '.url') {
    return Object.assign(base, { type: 'app', label: path.basename(full, ext), processName: '' });
  }
  if (ext === '.ps1') return Object.assign(base, { type: 'ps1', label: path.basename(full, ext), processName: path.basename(full, ext), isScript: true });
  const isExec = EXT_EXEC.has(ext);
  return Object.assign(base, {
    type: isExec ? 'app' : 'file',
    label: path.basename(full, ext) || full,
    processName: isExec ? path.basename(full, ext) : '',
    isScript: EXT_SCRIPT.has(ext),
  });
}

function stripHost(u) {
  try { return new URL(u).hostname.replace(/^www\./, ''); } catch (e) { return u.slice(0, 24); }
}

async function diagnose(target) {
  const t = String(target || '');
  const ext = path.extname(t).toLowerCase();
  const name = await processNameFor(t);
  const alive = await isRunningAsync(name);
  return {
    target: t,
    ext: ext,
    exists: exists(t),
    focusable: FOCUSABLE.has(ext),
    processName: name ? name + '.exe' : '(无法解析)',
    running: alive,
    willDo: FOCUSABLE.has(ext) && alive ? '唤起或切换已在运行的窗口' : '启动它',
  };
}

module.exports = {
  run,
  runSingleAction,
  splitArgs,
  stopAllMacros,
  stopMacroForKey,
  stopMacrosForPage,
  setLoopStateListener,
  activeLoops,
  NativeInput,
  probe,
  classify,
  looksLikeUrl,
  isScriptTarget,
  diagnose,
  isRunning,
  isRunningAsync,
  checkProcessesRunning,
  processNameFor,
  focusExisting,
  activateWindow,
};
