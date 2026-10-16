'use strict';
/**
 * Runs whatever a button points at.
 * Action types: app | file | folder | url | command | ps1 | hotkey | volume | media | multi | qr_decode
 */
const { spawn, spawnSync } = require('child_process');
const { shell } = require('electron');
const path = require('path');
const probe = require('./probe');
const NativeInput = require('./native-input');

const EXT_EXEC = new Set(['.exe', '.bat', '.cmd', '.com', '.msi', '.ps1']);

/** Targets we try to *focus* (or smart-toggle) before launching. Single-instance apps
 *  (QOwnNotes, WeChat DevTools, VS Code, most Electron apps) silently drop a
 *  second launch, so without this a key press looks like it did nothing. */
const FOCUSABLE = new Set(['.exe', '.lnk']);

const PS_TIMEOUT = 8000;
const resolvedNameCache = new Map();   // target -> process name (no extension)

function looksLikeUrl(s) {
  return /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(String(s || '').trim());
}

function exists(p) {
  try { return require('fs').existsSync(p); } catch (e) { return false; }
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

/**
 * Spawn a process that must not show anything.
 * NEVER pass `detached: true` here on Windows.
 */
function spawnQuiet(file, args, opts) {
  const child = spawn(file, args, Object.assign({ stdio: 'ignore', windowsHide: true }, opts || {}));
  child.on('error', () => { /* reported through the caller's return value where possible */ });
  child.unref();
  return child;
}

/**
 * Spawn a GUI desktop application that should be visible to the user.
 */
function spawnApp(file, args, opts) {
  const child = spawn(file, args || [], Object.assign({
    stdio: 'ignore',
    windowsHide: false,
    detached: true,
  }, opts || {}));
  child.on('error', () => { /* ignored */ });
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
    child.stderr.on('data', () => { /* noise */ });
    child.on('error', () => { clearTimeout(timer); finish(''); });
    child.on('close', () => { clearTimeout(timer); finish(out); });
  });
}

const psQuote = (s) => "'" + String(s).replace(/'/g, "''") + "'";

/** Resolve a .lnk to its real target, then cache the process name. */
async function processNameFor(target) {
  const ext = path.extname(target).toLowerCase();
  if (ext !== '.lnk' && ext !== '.url') {
    return path.basename(target, path.extname(target));
  }
  if (resolvedNameCache.has(target)) return resolvedNameCache.get(target);

  try {
    const details = shell.readShortcutLink(target);
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

/** Is a process with this base name running? Cheap: tasklist, ~80ms, no shell. */
function isRunning(name) {
  if (!name) return false;
  try {
    const clean = name.replace(/\.exe$/i, '');
    const r = spawnSync('tasklist',
      ['/FI', `IMAGENAME eq ${clean}.exe`, '/NH', '/FO', 'CSV'],
      { encoding: 'latin1', windowsHide: true, timeout: 4000 });
    return String(r.stdout || '').toLowerCase().includes((clean + '.exe').toLowerCase());
  } catch (e) {
    return false;
  }
}

/**
 * Bring an existing instance's main window to the front (or toggle minimize if
 * allowMinimize is true and the window is already foreground).
 */
async function activateWindow(name, allowMinimize = false) {
  if (!name) return null;

  // 1. Try 0.5ms native C# daemon first
  try {
    const nat = await NativeInput.activateOrToggleWindow(name, allowMinimize);
    if (nat && nat.ok) {
      return nat.state === 'MINIMIZED' ? 'minimized' : 'focused';
    }
  } catch (_) {}

  // 2. Fallback to PowerShell (waits up to 2s if the process is still creating its main window)
  const out = await runPowerShell(`
$ErrorActionPreference='SilentlyContinue'
$name = ${psQuote(name.replace(/\.exe$/i, ''))}
$allowMin = ${allowMinimize ? '$true' : '$false'}
$proc = $null
for ($i = 0; $i -lt 8 -and -not $proc; $i++) {
  $proc = @(Get-Process) | Where-Object { $_.ProcessName -eq $name -and $_.MainWindowHandle -ne 0 } | Select-Object -First 1
  if (-not $proc) { Start-Sleep -Milliseconds 250 }
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

/**
 * Already running -> raise its window (or minimize if already foreground and allowMinimize=true) and stop.
 * Otherwise return null so the caller launches normally.
 */
async function focusExisting(target, allowMinimize = false) {
  try {
    const name = await processNameFor(target);
    if (!name || !isRunning(name)) return null;
    return await activateWindow(name, allowMinimize);
  } catch (e) {
    return null;
  }
}

/**
 * Run a raw command line through cmd.exe.
 */
function runShell(line) {
  const child = spawn(line, {
    shell: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  child.on('error', () => { /* fire and forget */ });
  child.unref();
  return child;
}

const activeLoops = new Map(); // keyId -> { stop: false }
const busyKeys = new Set();
let onLoopStateCallback = null;

function setLoopStateListener(fn) {
  onLoopStateCallback = fn;
}

function stopAllMacros() {
  for (const [k, token] of activeLoops.entries()) {
    token.stop = true;
    if (onLoopStateCallback) onLoopStateCallback(k, false);
  }
  activeLoops.clear();
}

async function runSingleAction(action) {
  if (!action || typeof action !== 'object') return { ok: true };
  const type = String(action.type || 'app').toLowerCase();

  switch (type) {
    case 'delay': {
      const ms = Math.max(10, Number(action.ms) || 50);
      await new Promise((r) => setTimeout(r, ms));
      return { ok: true };
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
    const token = { stop: false };
    activeLoops.set(keyId, token);
    if (onLoopStateCallback) onLoopStateCallback(keyId, true, context);

    (async () => {
      const minInterval = Math.max(50, Number(spec.loopInterval || loopCfg.interval) || 50);
      try {
        while (!token.stop) {
          for (const act of actions) {
            if (token.stop) break;
            try { await runSingleAction(act); } catch (_) {}
          }
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

  if (keyId) busyKeys.add(keyId);
  try {
    const times = (loopCfg.mode === 'times' && Number(loopCfg.times) > 0) ? Number(loopCfg.times) : 1;
    const interval = Math.max(20, Number(spec.loopInterval || loopCfg.interval) || 50);

    for (let i = 0; i < times; i++) {
      for (const act of actions) {
        try { await runSingleAction(act); } catch (_) {}
      }
      if (i < times - 1) {
        await new Promise((r) => setTimeout(r, interval));
      }
    }
    return { ok: true, action: 'macro_completed' };
  } finally {
    if (keyId) busyKeys.delete(keyId);
  }
}

async function run(spec, context) {
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
      return Object.assign({ ok: true, action: 'audio_switch' }, res);
    }
    const step = computeVolStep(baseStep);
    const res = await NativeInput.stepVolume(step);
    return Object.assign({ ok: true, action: 'volume_up', step }, res);
  }

  if (type === 'media') {
    const cmd = String(spec.cmd || spec.action || spec.target || 'play_pause').toLowerCase();
    await NativeInput.sendMedia(cmd);
    return { ok: true, action: 'media_' + cmd };
  }

  const rawTarget = String(spec.target || spec.hotkey || '');
  if (!rawTarget) return { ok: false, error: 'EMPTY' };

  let target = probe.expandPath(rawTarget);
  if (type === 'app') {
    target = probe.probeApp(rawTarget);
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
        if (rawCmd.toLowerCase().startsWith('wm_close:')) {
          const procName = rawCmd.slice('wm_close:'.length).trim();
          const closed = await NativeInput.closeWindowGracefully(procName);
          if (!closed || !closed.ok) {
            runShell(`taskkill /IM "${procName.replace(/\.exe$/i, '')}.exe"`);
          }
          return { ok: true, action: 'graceful_close' };
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
        spawnQuiet('powershell.exe',
          ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', target].concat(spec.args ? [spec.args] : []));
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
          spawnQuiet('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', target]);
          return { ok: true };
        }

        const wantsArgs = !!(spec.args && String(spec.args).trim());

        if (FOCUSABLE.has(ext) && !wantsArgs) {
          const allowMinimize = spec.smartToggle !== false;
          const focusResult = await focusExisting(target, allowMinimize);
          if (focusResult) return { ok: true, action: focusResult };
        }

        if (EXT_EXEC.has(ext) && wantsArgs) {
          const args = String(spec.args).split(/\s+/).filter(Boolean);
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
  if (lower === 'win+d') {
    spawnQuiet('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', '(New-Object -ComObject Shell.Application).ToggleDesktop()']);
    return;
  }
  if (lower === 'win+l') {
    spawnQuiet('rundll32.exe', ['user32.dll,LockWorkStation']);
    return;
  }
  if (lower === 'win+e') {
    spawnQuiet('explorer.exe', []);
    return;
  }
  if (lower === 'win+r') {
    spawnQuiet('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', '(New-Object -ComObject Shell.Application).FileRun()']);
    return;
  }
  if (lower === 'ctrl+shift+esc') {
    spawnQuiet('taskmgr.exe', []);
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

  // 1. 优先调用原生 0.5ms SendInput 引擎（免除 PowerShell 启动开销，彻底免疫 SendKeys 特殊字符与引号注入）
  try {
    const nat = await NativeInput.sendHotkey(norm);
    if (nat && nat.ok) return;
  } catch (_) {}

  // 2. 降级兜底（兼容未重新编译旧版 akp-input.exe 的环境）
  if (/win/i.test(norm)) {
    const parts = norm.split('+').map(s => s.trim().toLowerCase());
    const key = parts.find(p => p !== 'win' && p !== 'ctrl' && p !== 'alt' && p !== 'shift') || 'v';
    const vkMap = {
      'v': 0x56, 'tab': 0x09, 's': 0x53, 'a': 0x41, 'i': 0x49, 'x': 0x58, 'g': 0x47, 'h': 0x48,
      'k': 0x4B, 'p': 0x50, 'w': 0x57, 'z': 0x5A, 'prtscn': 0x2C, 'printscreen': 0x2C,
      'enter': 0x0D, 'return': 0x0D, 'esc': 0x1B, 'escape': 0x1B, 'space': 0x20,
      'backspace': 0x08, 'del': 0x2E, 'delete': 0x2E, 'insert': 0x2D,
      'home': 0x24, 'end': 0x23, 'pgup': 0x21, 'pageup': 0x21, 'pgdn': 0x22, 'pagedown': 0x22,
      'up': 0x26, 'down': 0x28, 'left': 0x25, 'right': 0x27,
      'f1': 0x70, 'f2': 0x71, 'f3': 0x72, 'f4': 0x73, 'f5': 0x74, 'f6': 0x75,
      'f7': 0x76, 'f8': 0x77, 'f9': 0x78, 'f10': 0x79, 'f11': 0x7A, 'f12': 0x7B,
      '0': 0x30, '1': 0x31, '2': 0x32, '3': 0x33, '4': 0x34, '5': 0x35, '6': 0x36, '7': 0x37, '8': 0x38, '9': 0x39,
    };
    const vk = vkMap[key] || (key.length === 1 ? key.toUpperCase().charCodeAt(0) : 0x56);
    const hasCtrl = parts.includes('ctrl');
    const hasAlt = parts.includes('alt');
    const hasShift = parts.includes('shift');

    const psCode = `
$w = Add-Type -MemberDefinition '[DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);' -Name 'WinKey' -Namespace 'AKP' -PassThru
${hasCtrl ? '$w::keybd_event(0x11, 0, 0, [UIntPtr]::Zero)' : ''}
${hasAlt ? '$w::keybd_event(0x12, 0, 0, [UIntPtr]::Zero)' : ''}
${hasShift ? '$w::keybd_event(0x10, 0, 0, [UIntPtr]::Zero)' : ''}
$w::keybd_event(0x5B, 0, 0, [UIntPtr]::Zero)
$w::keybd_event(${vk}, 0, 0, [UIntPtr]::Zero)
$w::keybd_event(${vk}, 0, 2, [UIntPtr]::Zero)
$w::keybd_event(0x5B, 0, 2, [UIntPtr]::Zero)
${hasShift ? '$w::keybd_event(0x10, 0, 2, [UIntPtr]::Zero)' : ''}
${hasAlt ? '$w::keybd_event(0x12, 0, 2, [UIntPtr]::Zero)' : ''}
${hasCtrl ? '$w::keybd_event(0x11, 0, 2, [UIntPtr]::Zero)' : ''}
`;
    await runPowerShell(psCode, 3000);
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

/** Classify a dropped path so the UI can pre-fill sensible defaults. */
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
      const details = shell.readShortcutLink(full);
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
    });
  }
  if (ext === '.url') {
    return Object.assign(base, { type: 'app', label: path.basename(full, ext), processName: '' });
  }
  if (ext === '.ps1') return Object.assign(base, { type: 'ps1', label: path.basename(full, ext), processName: path.basename(full, ext) });
  const isExec = EXT_EXEC.has(ext);
  return Object.assign(base, {
    type: isExec ? 'app' : 'file',
    label: path.basename(full, ext) || full,
    processName: isExec ? path.basename(full, ext) : '',
  });
}

function stripHost(u) {
  try { return new URL(u).hostname.replace(/^www\./, ''); } catch (e) { return u.slice(0, 24); }
}

async function diagnose(target) {
  const t = String(target || '');
  const ext = path.extname(t).toLowerCase();
  const name = await processNameFor(t);
  return {
    target: t,
    ext: ext,
    exists: exists(t),
    focusable: FOCUSABLE.has(ext),
    processName: name ? name + '.exe' : '(无法解析)',
    running: isRunning(name),
    willDo: FOCUSABLE.has(ext) && isRunning(name) ? '唤起或切换已在运行的窗口' : '启动它',
  };
}

module.exports = {
  run,
  runSingleAction,
  stopAllMacros,
  setLoopStateListener,
  activeLoops,
  NativeInput,
  probe,
  classify,
  looksLikeUrl,
  diagnose,
  isRunning,
  processNameFor,
};
