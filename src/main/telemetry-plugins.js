'use strict';
/**
 * telemetry-plugins.js - AKP153 动态数据源与轻量级 JS 插件引擎 (v0.8.0)
 *
 * 提供 6 大内置实时数据源与外部 JS 插件扩展能力：
 *   1. gpu       : GPU 核心负载、温度、显存占用 (NVIDIA SMI / 性能计数器异步无阻塞采样)
 *   2. net       : 实时网络上下行速率 (KB/s · MB/s)
 *   3. weather   : 实时城市天气与温度 (15分钟缓存 + 离线优雅降级)
 *   4. pomodoro  : 番茄钟专注倒计时状态机 (支持按键启停/重置/跳过 + 到点提示音)
 *   5. obs       : OBS Studio 推流/录制实时状态监控
 *   6. media_now : Spotify / 网易云音乐 / QQ音乐 当前播放曲目与艺术家实时提取
 *   7. plugin    : 自动加载 plugins/*.plugin.js 自定义轻量级插件
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const NativeInput = require('./native-input');

const PLUGINS_DIR = path.join(__dirname, '..', '..', 'plugins');

// ------------------------------------------------------------------ 1. GPU Telemetry
let gpuCache = {
  available: false,
  name: 'GPU',
  load: 0,
  temp: 0,
  memUsedMb: 0,
  memTotalMb: 0,
  memPct: 0,
  ts: 0,
};
let gpuPolling = false;

function sampleGpuAsync() {
  const now = Date.now();
  if (gpuPolling || (now - gpuCache.ts) < 2800) {
    return Promise.resolve(gpuCache);
  }
  gpuPolling = true;
  return new Promise((resolve) => {
    let out = '';
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      gpuPolling = false;
      gpuCache.ts = Date.now();
      resolve(gpuCache);
    };

    const smiCandidates = [
      'nvidia-smi',
      'C:\\Windows\\System32\\nvidia-smi.exe',
      'C:\\Program Files\\NVIDIA Corporation\\NVSMI\\nvidia-smi.exe',
    ];

    let child = null;
    try {
      child = spawn(smiCandidates[0], [
        '--query-gpu=utilization.gpu,temperature.gpu,memory.used,memory.total,name',
        '--format=csv,noheader,nounits',
      ], { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    } catch (_) {
      return done();
    }

    const timer = setTimeout(() => {
      try { child.kill(); } catch (_) {}
      done();
    }, 1800);

    child.stdout.on('data', (d) => { out += d.toString('utf8'); });
    child.on('error', () => { clearTimeout(timer); done(); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0 && out.trim()) {
        const line = out.trim().split(/\r?\n/)[0];
        const parts = line.split(',').map((s) => s.trim());
        if (parts.length >= 4) {
          const load = Math.max(0, Math.min(100, parseInt(parts[0], 10) || 0));
          const temp = Math.max(0, parseInt(parts[1], 10) || 0);
          const used = Math.max(0, parseInt(parts[2], 10) || 0);
          const total = Math.max(1, parseInt(parts[3], 10) || 1);
          const name = (parts[4] || 'NVIDIA GPU').replace(/^NVIDIA\s+/i, '').replace(/^GeForce\s+/i, '');
          gpuCache = {
            available: true,
            name,
            load,
            temp,
            memUsedMb: used,
            memTotalMb: total,
            memPct: Math.round((used / total) * 100),
            ts: Date.now(),
          };
        }
      }
      done();
    });
  });
}

// ------------------------------------------------------------------ 2. Network Speed
let linuxPrevRx = -1;
let linuxPrevTx = -1;
let linuxPrevTs = 0;
let netCache = { rxKbps: 0, txKbps: 0, rxText: '0 KB/s', txText: '0 KB/s', ts: 0 };

function formatRate(kbps) {
  const v = Math.max(0, Number(kbps) || 0);
  if (v >= 1024) return `${(v / 1024).toFixed(1)} MB/s`;
  if (v >= 10) return `${Math.round(v)} KB/s`;
  return `${v.toFixed(1)} KB/s`;
}

async function sampleNetSpeed() {
  const now = Date.now();
  if (now - netCache.ts < 1200) return netCache;

  if (process.platform === 'win32') {
    const res = await NativeInput.getNetworkStats();
    if (res && res.ok) {
      netCache = {
        rxKbps: res.rxKbps,
        txKbps: res.txKbps,
        rxText: formatRate(res.rxKbps),
        txText: formatRate(res.txKbps),
        ts: now,
      };
      return netCache;
    }
  } else if (fs.existsSync('/proc/net/dev')) {
    try {
      const lines = fs.readFileSync('/proc/net/dev', 'utf8').split('\n').slice(2);
      let rx = 0, tx = 0;
      for (const ln of lines) {
        const m = ln.trim().match(/^([^:]+):\s*(\d+)\s+\d+\s+\d+\s+\d+\s+\d+\s+\d+\s+\d+\s+\d+\s+(\d+)/);
        if (m && m[1] !== 'lo') {
          rx += Number(m[2]) || 0;
          tx += Number(m[3]) || 0;
        }
      }
      if (linuxPrevRx >= 0 && now > linuxPrevTs) {
        const dt = (now - linuxPrevTs) / 1000;
        const rxK = Math.max(0, (rx - linuxPrevRx) / 1024 / dt);
        const txK = Math.max(0, (tx - linuxPrevTx) / 1024 / dt);
        netCache = {
          rxKbps: rxK,
          txKbps: txK,
          rxText: formatRate(rxK),
          txText: formatRate(txK),
          ts: now,
        };
      }
      linuxPrevRx = rx;
      linuxPrevTx = tx;
      linuxPrevTs = now;
    } catch (_) {}
  }
  netCache.ts = now;
  return netCache;
}

// ------------------------------------------------------------------ 3. Weather Widget
let weatherCache = {
  city: '本地',
  temp: '24°C',
  tempNum: 24,
  condition: '晴间多云',
  icon: '⛅',
  humidity: '55%',
  ts: 0,
};
let weatherFetching = false;

function weatherIconFor(desc) {
  const d = String(desc || '').toLowerCase();
  if (d.includes('雷') || d.includes('thunder')) return '⛈️';
  if (d.includes('雪') || d.includes('snow')) return '❄️';
  if (d.includes('雨') || d.includes('rain') || d.includes('shower')) return '🌧️';
  if (d.includes('雾') || d.includes('霾') || d.includes('fog') || d.includes('mist')) return '🌫️';
  if (d.includes('阴') || d.includes('overcast')) return '☁️';
  if (d.includes('云') || d.includes('cloud')) return '⛅';
  return '☀️';
}

async function sampleWeather(city = 'Auto') {
  const targetCity = String(city || 'Auto').trim() || 'Auto';
  const now = Date.now();
  if (weatherFetching || (now - weatherCache.ts < 15 * 60 * 1000 && weatherCache.reqCity === targetCity)) {
    return weatherCache;
  }
  weatherFetching = true;
  weatherCache.reqCity = targetCity;
  weatherCache.city = targetCity === 'Auto' ? '本地' : targetCity;

  try {
    let netMod = null;
    try { ({ net: netMod } = require('electron')); } catch (_) {}
    if (netMod && typeof netMod.request === 'function') {
      const q = targetCity === 'Auto' ? '' : encodeURIComponent(targetCity);
      const url = `https://wttr.in/${q}?format=j1&lang=zh`;
      const raw = await new Promise((resolve) => {
        let settled = false;
        const done = (v) => { if (!settled) { settled = true; resolve(v); } };
        const timer = setTimeout(() => done(null), 3200);
        try {
          const req = netMod.request({ url, method: 'GET' });
          req.on('response', (res) => {
            if (res.statusCode !== 200) return done(null);
            const chunks = [];
            res.on('data', (c) => chunks.push(c));
            res.on('end', () => { clearTimeout(timer); done(Buffer.concat(chunks).toString('utf8')); });
            res.on('error', () => done(null));
          });
          req.on('error', () => done(null));
          req.end();
        } catch (_) {
          done(null);
        }
      });
      if (raw) {
        const data = JSON.parse(raw);
        const cur = data && data.current_condition && data.current_condition[0];
        const area = data && data.nearest_area && data.nearest_area[0];
        if (cur) {
          const tC = Number(cur.temp_C) || 24;
          const desc = (cur.lang_zh && cur.lang_zh[0] && cur.lang_zh[0].value)
            || (cur.weatherDesc && cur.weatherDesc[0] && cur.weatherDesc[0].value)
            || '晴';
          const cityName = targetCity !== 'Auto'
            ? targetCity
            : ((area && area.areaName && area.areaName[0] && area.areaName[0].value) || '本地');
          weatherCache = {
            reqCity: targetCity,
            city: cityName.slice(0, 8),
            temp: `${tC}°C`,
            tempNum: tC,
            condition: String(desc).slice(0, 8),
            icon: weatherIconFor(desc),
            humidity: `${cur.humidity || 50}%`,
            ts: Date.now(),
          };
        }
      }
    }
  } catch (_) {
    // Offline fallback keeps last known or sensible default
  } finally {
    weatherCache.ts = Date.now();
    weatherFetching = false;
  }
  return weatherCache;
}

// ------------------------------------------------------------------ 4. Pomodoro Engine
const pomodoroState = {
  phase: 'work',        // 'work' | 'break'
  running: false,
  workMinutes: 25,
  breakMinutes: 5,
  remainingSec: 25 * 60,
  totalSec: 25 * 60,
  completedCount: 0,
  lastTickMs: 0,
};

let pomodoroTimer = null;
let onPomodoroUpdate = null;

function setPomodoroListener(fn) {
  onPomodoroUpdate = fn;
}

function formatPomodoroTime(sec) {
  const s = Math.max(0, Math.round(Number(sec) || 0));
  const mm = String(Math.floor(s / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}

function getPomodoroSnapshot() {
  const pct = pomodoroState.totalSec > 0
    ? Math.round(((pomodoroState.totalSec - pomodoroState.remainingSec) / pomodoroState.totalSec) * 100)
    : 0;
  return {
    phase: pomodoroState.phase,
    phaseLabel: pomodoroState.phase === 'work' ? '🍅 专注中' : '☕ 休息中',
    running: pomodoroState.running,
    remainingSec: pomodoroState.remainingSec,
    totalSec: pomodoroState.totalSec,
    formatted: formatPomodoroTime(pomodoroState.remainingSec),
    progressPct: Math.max(0, Math.min(100, pct)),
    completedCount: pomodoroState.completedCount,
  };
}

function ensurePomodoroTicker() {
  if (pomodoroTimer) return;
  pomodoroTimer = setInterval(() => {
    if (!pomodoroState.running) return;
    if (pomodoroState.remainingSec > 0) {
      pomodoroState.remainingSec--;
      if (onPomodoroUpdate) onPomodoroUpdate(getPomodoroSnapshot(), false);
    } else {
      // Phase finished!
      NativeInput.beep(true).catch(() => {});
      if (pomodoroState.phase === 'work') {
        pomodoroState.completedCount++;
        pomodoroState.phase = 'break';
        pomodoroState.totalSec = pomodoroState.breakMinutes * 60;
        pomodoroState.remainingSec = pomodoroState.totalSec;
      } else {
        pomodoroState.phase = 'work';
        pomodoroState.totalSec = pomodoroState.workMinutes * 60;
        pomodoroState.remainingSec = pomodoroState.totalSec;
      }
      if (onPomodoroUpdate) onPomodoroUpdate(getPomodoroSnapshot(), true);
    }
  }, 1000);
}

function controlPomodoro(act = 'toggle', customMinutes = null) {
  ensurePomodoroTicker();
  if (customMinutes && Number(customMinutes) >= 1 && Number(customMinutes) <= 120) {
    pomodoroState.workMinutes = Math.round(Number(customMinutes));
    if (!pomodoroState.running && pomodoroState.phase === 'work') {
      pomodoroState.totalSec = pomodoroState.workMinutes * 60;
      pomodoroState.remainingSec = pomodoroState.totalSec;
    }
  }
  const cmd = String(act || 'toggle').toLowerCase();
  if (cmd === 'toggle') {
    pomodoroState.running = !pomodoroState.running;
  } else if (cmd === 'start') {
    pomodoroState.running = true;
  } else if (cmd === 'pause' || cmd === 'stop') {
    pomodoroState.running = false;
  } else if (cmd === 'reset') {
    pomodoroState.running = false;
    pomodoroState.phase = 'work';
    pomodoroState.totalSec = pomodoroState.workMinutes * 60;
    pomodoroState.remainingSec = pomodoroState.totalSec;
  } else if (cmd === 'skip') {
    pomodoroState.phase = pomodoroState.phase === 'work' ? 'break' : 'work';
    pomodoroState.totalSec = (pomodoroState.phase === 'work' ? pomodoroState.workMinutes : pomodoroState.breakMinutes) * 60;
    pomodoroState.remainingSec = pomodoroState.totalSec;
  }
  const snap = getPomodoroSnapshot();
  if (onPomodoroUpdate) onPomodoroUpdate(snap, false);
  return snap;
}

// ------------------------------------------------------------------ 5. OBS & Media Now Playing
let mediaObsCache = {
  obs: { running: false, streaming: false, recording: false, statusText: '未运行', scene: '' },
  media: { active: false, app: '', track: '未在播放', artist: '', displayLine: '等待音乐播放' },
  ts: 0,
};

async function sampleMediaAndObs() {
  const now = Date.now();
  if (now - mediaObsCache.ts < 2000) return mediaObsCache;

  const titles = await NativeInput.getProcessWindowTitles([
    'obs64', 'obs32', 'cloudmusic', 'spotify', 'qqmusic', 'foobar2000', 'music.ui', 'yesplaymusic',
  ]);

  // Parse OBS status from window title (e.g. "OBS 30.1.2 - 配置文件: 默认 - 场景: 主场景")
  const obsTitle = titles.obs64 || titles.obs32 || '';
  if (obsTitle) {
    const isStreaming = /推流|直播|streaming|\[live\]/i.test(obsTitle);
    const isRecording = /录制|recording|\[rec\]/i.test(obsTitle);
    let scene = '';
    const mScene = obsTitle.match(/(?:场景|Scenes?)\s*[:：]\s*([^\-\r\n]+)/i);
    if (mScene && mScene[1]) scene = mScene[1].trim();
    mediaObsCache.obs = {
      running: true,
      streaming: isStreaming,
      recording: isRecording,
      scene: scene || '主场景',
      statusText: isStreaming ? '🔴 直播推流中' : (isRecording ? '⏺️ 正在录制' : '🟢 OBS 就绪'),
    };
  } else {
    mediaObsCache.obs = { running: false, streaming: false, recording: false, statusText: 'OBS 未启动', scene: '' };
  }

  // Parse Music player window title (e.g. "晴天 - 周杰伦 - 网易云音乐")
  const musicApps = [
    { key: 'cloudmusic', label: '网易云音乐' },
    { key: 'spotify', label: 'Spotify' },
    { key: 'qqmusic', label: 'QQ音乐' },
    { key: 'yesplaymusic', label: 'YesPlayMusic' },
    { key: 'foobar2000', label: 'foobar2000' },
  ];
  let foundMedia = null;
  for (const ma of musicApps) {
    const rawTitle = titles[ma.key];
    if (rawTitle) {
      const cleaned = rawTitle
        .replace(/\s*-\s*(网易云音乐|QQ音乐|Spotify|YesPlayMusic|foobar2000).*$/i, '')
        .trim();
      if (cleaned && !/^(网易云音乐|QQ音乐|Spotify Free|Spotify Premium|Spotify)$/i.test(cleaned)) {
        const parts = cleaned.split(/\s*-\s*/);
        const track = parts[0] || cleaned;
        const artist = parts.slice(1).join(' / ') || ma.label;
        foundMedia = {
          active: true,
          app: ma.label,
          track: track.slice(0, 24),
          artist: artist.slice(0, 20),
          displayLine: `${track} - ${artist}`,
        };
        break;
      } else {
        foundMedia = {
          active: false,
          app: ma.label,
          track: ma.label,
          artist: '已暂停',
          displayLine: `${ma.label} · 已暂停`,
        };
      }
    }
  }

  mediaObsCache.media = foundMedia || {
    active: false,
    app: '',
    track: '未播放音乐',
    artist: '点击播放/暂停',
    displayLine: '暂无曲目播放',
  };
  mediaObsCache.ts = now;
  return mediaObsCache;
}

// ------------------------------------------------------------------ 6. Custom JS Plugin Loader
const loadedPlugins = new Map();
let pluginsLoadedAt = 0;

function loadExternalPlugins(force = false) {
  const now = Date.now();
  if (!force && pluginsLoadedAt > 0 && (now - pluginsLoadedAt) < 10000) {
    return Array.from(loadedPlugins.values());
  }
  pluginsLoadedAt = now;
  try {
    if (!fs.existsSync(PLUGINS_DIR)) {
      fs.mkdirSync(PLUGINS_DIR, { recursive: true });
    }
    const files = fs.readdirSync(PLUGINS_DIR).filter((f) => f.endsWith('.plugin.js'));
    for (const file of files) {
      const fullPath = path.join(PLUGINS_DIR, file);
      try {
        delete require.cache[require.resolve(fullPath)];
        const mod = require(fullPath);
        if (mod && mod.id && typeof mod.render === 'function') {
          loadedPlugins.set(mod.id, {
            id: String(mod.id),
            name: String(mod.name || mod.id),
            description: String(mod.description || ''),
            color: mod.color || '#1e293b',
            render: mod.render,
            onPress: typeof mod.onPress === 'function' ? mod.onPress : null,
          });
        }
      } catch (_) {}
    }
  } catch (_) {}
  return Array.from(loadedPlugins.values());
}

async function evaluatePlugin(pluginId) {
  loadExternalPlugins();
  const p = loadedPlugins.get(pluginId);
  if (!p) {
    return { title: pluginId || '插件', value: '未加载', sub: '请检查 plugins/', color: '#334155' };
  }
  try {
    const res = await p.render({ os, now: new Date() });
    return Object.assign({ title: p.name, value: '', sub: '', color: p.color }, res || {});
  } catch (err) {
    return { title: p.name, value: 'ERR', sub: String(err.message || err).slice(0, 12), color: '#7f1d1d' };
  }
}

async function triggerPluginPress(pluginId, args) {
  loadExternalPlugins();
  const p = loadedPlugins.get(pluginId);
  if (p && p.onPress) {
    return await p.onPress({ args, os, now: new Date(), NativeInput });
  }
  return { ok: true };
}

function listAvailablePlugins() {
  return loadExternalPlugins(true).map((p) => ({
    id: p.id,
    name: p.name,
    description: p.description,
    color: p.color,
  }));
}

async function gatherTelemetry(options = {}) {
  const types = Array.isArray(options.types) ? options.types : ['gpu', 'net', 'weather', 'pomodoro', 'obs', 'media_now'];
  const out = {};

  const tasks = [];
  if (types.includes('gpu')) {
    tasks.push(sampleGpuAsync().then((g) => { out.gpu = g; }));
  }
  if (types.includes('net')) {
    tasks.push(sampleNetSpeed().then((n) => { out.net = n; }));
  }
  if (types.includes('weather')) {
    tasks.push(sampleWeather(options.weatherCity || 'Auto').then((w) => { out.weather = w; }));
  }
  if (types.includes('pomodoro')) {
    out.pomodoro = getPomodoroSnapshot();
  }
  if (types.includes('obs') || types.includes('media_now')) {
    tasks.push(sampleMediaAndObs().then((m) => {
      out.obs = m.obs;
      out.media_now = m.media;
    }));
  }
  if (options.pluginIds && Array.isArray(options.pluginIds)) {
    out.plugins = {};
    for (const pid of options.pluginIds) {
      tasks.push(evaluatePlugin(pid).then((r) => { out.plugins[pid] = r; }));
    }
  }

  await Promise.all(tasks);
  return out;
}

module.exports = {
  gatherTelemetry,
  controlPomodoro,
  getPomodoroSnapshot,
  setPomodoroListener,
  listAvailablePlugins,
  evaluatePlugin,
  triggerPluginPress,
  PLUGINS_DIR,
};
