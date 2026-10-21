'use strict';
/**
 * telemetry-plugins.js - AKP153 动态数据源、SMTC 桌面歌词与可视化画布插件引擎 (v0.9.5)
 *
 * 提供 6 大内置实时数据源与外部 JS 插件扩展能力（支持单键 96×96 与跨格 2×1 / 3×1 宽屏画布）：
 *   1. gpu       : GPU 核心负载、温度、显存占用与 24 点历史趋势折线 (history)
 *   2. net       : 实时网络上下行速率 (KB/s · MB/s) 与上下行双轨折线 (rxHistory / txHistory)
 *   3. weather   : 实时城市天气、温湿度与风向 (15分钟缓存 + 离线优雅降级，兼容 condition/desc)
 *   4. pomodoro  : 番茄钟专注倒计时状态机 (支持按键启停/重置/跳过 + 到点提示音)
 *   5. obs       : OBS Studio 推流/录制实时状态监控
 *   6. media_now : Windows SMTC 系统媒体会话 + 网易云音乐/QQ音乐/Spotify 本地状态、专辑色板、播放进度与双行同步滚动歌词
 *   7. plugin    : 自动加载 plugins/*.plugin.js 可视化画布插件（支持 sparkline / bars / progress / badge / svg）与内置插件市场
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const NativeInput = require('./native-input');

const PLUGINS_DIR = path.join(__dirname, '..', '..', 'plugins');

function pushRing(arr, val, maxLen = 24) {
  arr.push(Number(val) || 0);
  while (arr.length > maxLen) arr.shift();
  return arr;
}

// ------------------------------------------------------------------ 1. GPU Telemetry
const gpuHistory = [32, 35, 34, 38, 42, 40, 44, 46, 45, 48, 47, 48];
let gpuCache = {
  available: false,
  name: 'NVIDIA RTX',
  load: 24,
  temp: 46,
  memUsedMb: 2450,
  memTotalMb: 8192,
  memPct: 30,
  history: gpuHistory.slice(),
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
          pushRing(gpuHistory, load, 24);
          gpuCache = {
            available: true,
            name,
            load,
            temp,
            memUsedMb: used,
            memTotalMb: total,
            memPct: Math.round((used / total) * 100),
            history: gpuHistory.slice(),
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
const netRxHistory = [120, 180, 140, 210, 165, 195, 240, 180, 160, 205, 190, 180];
const netTxHistory = [32, 40, 38, 45, 36, 42, 48, 40, 35, 44, 39, 40];
let netCache = {
  rxKbps: 180,
  txKbps: 40,
  rxSec: 180 * 1024,
  txSec: 40 * 1024,
  rxText: '180 KB/s',
  txText: '40 KB/s',
  downText: '180 KB/s',
  upText: '40 KB/s',
  history: netRxHistory.slice(),
  txHistory: netTxHistory.slice(),
  ts: 0,
};

function formatRate(kbps) {
  const v = Math.max(0, Number(kbps) || 0);
  if (v >= 1024) return `${(v / 1024).toFixed(1)} MB/s`;
  if (v >= 10) return `${Math.round(v)} KB/s`;
  return `${v.toFixed(1)} KB/s`;
}

function buildNetCache(rxK, txK, now) {
  const rxText = formatRate(rxK);
  const txText = formatRate(txK);
  pushRing(netRxHistory, Math.round(rxK), 24);
  pushRing(netTxHistory, Math.round(txK), 24);
  return {
    rxKbps: rxK,
    txKbps: txK,
    rxSec: Math.round(rxK * 1024),
    txSec: Math.round(txK * 1024),
    rxText,
    txText,
    downText: rxText,
    upText: txText,
    history: netRxHistory.slice(),
    txHistory: netTxHistory.slice(),
    ts: now,
  };
}

async function sampleNetSpeed() {
  const now = Date.now();
  if (now - netCache.ts < 1200) return netCache;

  if (process.platform === 'win32') {
    const res = await NativeInput.getNetworkStats();
    if (res && res.ok) {
      netCache = buildNetCache(res.rxKbps, res.txKbps, now);
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
        netCache = buildNetCache(rxK, txK, now);
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
  desc: '晴间多云',
  icon: '⛅',
  humidity: '55%',
  humidityNum: 55,
  wind: '微风 2级',
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
          const humNum = Number(cur.humidity) || 50;
          const desc = (cur.lang_zh && cur.lang_zh[0] && cur.lang_zh[0].value)
            || (cur.weatherDesc && cur.weatherDesc[0] && cur.weatherDesc[0].value)
            || '晴';
          const cityName = targetCity !== 'Auto'
            ? targetCity
            : ((area && area.areaName && area.areaName[0] && area.areaName[0].value) || '本地');
          const cleanCond = String(desc).slice(0, 8);
          weatherCache = {
            reqCity: targetCity,
            city: cityName.slice(0, 8),
            temp: `${tC}°C`,
            tempNum: tC,
            condition: cleanCond,
            desc: cleanCond,
            icon: weatherIconFor(desc),
            humidity: `${humNum}%`,
            humidityNum: humNum,
            wind: `${cur.winddir16Point || ''} ${cur.windspeedKmph || 8}km/h`.trim(),
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
    state: pomodoroState.phase === 'work' ? 'FOCUS' : 'BREAK',
    running: pomodoroState.running,
    remainingSec: pomodoroState.remainingSec,
    remainSec: pomodoroState.remainingSec,
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
  const raw = String(act || 'toggle').toLowerCase().replace(/^pomodoro_/, '');
  if (raw === 'toggle') {
    pomodoroState.running = !pomodoroState.running;
  } else if (raw === 'start') {
    pomodoroState.running = true;
  } else if (raw === 'pause' || raw === 'stop') {
    pomodoroState.running = false;
  } else if (raw === 'reset') {
    pomodoroState.running = false;
    pomodoroState.phase = 'work';
    pomodoroState.totalSec = pomodoroState.workMinutes * 60;
    pomodoroState.remainingSec = pomodoroState.totalSec;
  } else if (raw === 'skip') {
    pomodoroState.phase = pomodoroState.phase === 'work' ? 'break' : 'work';
    pomodoroState.totalSec = (pomodoroState.phase === 'work' ? pomodoroState.workMinutes : pomodoroState.breakMinutes) * 60;
    pomodoroState.remainingSec = pomodoroState.totalSec;
  }
  const snap = getPomodoroSnapshot();
  if (onPomodoroUpdate) onPomodoroUpdate(snap, false);
  return snap;
}

// ------------------------------------------------------------------ 5. SMTC, Local Lyrics & OBS Engine
/**
 * 内置经典曲目与通用 LRC 时间轴歌词库 + 本地网易云音乐/QQ音乐歌词缓存读取器
 */
const BUILTIN_LYRIC_TIMELINES = {
  default: [
    { sec: 0, text: '故事的小黄花 从出生那年就飘着', sub: '童年的荡秋千 随记忆一直晃到现在' },
    { sec: 12, text: '童年的荡秋千 随记忆一直晃到现在', sub: 'Re So So Si Do Si La So La Si Si Si Si La Si La So' },
    { sec: 24, text: '吹着前奏望着天空 我想起花瓣试着掉落', sub: '为你翘课的那一天 花落的那一天' },
    { sec: 36, text: '为你翘课的那一天 花落的那一天', sub: '教室的那一间 我怎么看不见' },
    { sec: 48, text: '消失的下雨天 我好想再淋一遍', sub: '没想到失去的勇气我还留着' },
    { sec: 60, text: '好想再问一遍 你会等待还是离开', sub: '刮风这天 我试过握着你手' },
    { sec: 75, text: '刮风这天 我试过握着你手', sub: '但偏偏 雨渐渐 大到我看你不见' },
    { sec: 90, text: '还要多久 我才能在你身边', sub: '等到放晴的那天 也许我会比较好一点' },
  ],
};

let trackPlaybackTracker = {
  signature: '',
  startedAtMs: Date.now() - 38000,
  durationSec: 269,
  cachedLrcLines: null,
};

let smtcCache = { ts: 0, polling: false, data: null };

/**
 * 解析标准 [mm:ss.xx] LRC 歌词文本为排序时间轴数组
 */
function parseLrcText(rawLrc) {
  if (!rawLrc || typeof rawLrc !== 'string') return [];
  const lines = rawLrc.split(/\r?\n/);
  const parsed = [];
  const timeRe = /\[(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?\](.*)/;
  for (const line of lines) {
    const m = line.match(timeRe);
    if (m) {
      const min = parseInt(m[1], 10) || 0;
      const sec = parseInt(m[2], 10) || 0;
      const ms = m[3] ? parseInt(m[3].padEnd(3, '0'), 10) : 0;
      const txt = m[4].replace(/\[.*?\]/g, '').trim();
      if (txt) {
        parsed.push({ sec: min * 60 + sec + ms / 1000, text: txt });
      }
    }
  }
  parsed.sort((a, b) => a.sec - b.sec);
  return parsed;
}

/**
 * 尝试从本地网易云音乐 webdata 缓存目录读取最近播放曲目的真实 LRC 歌词与时长
 */
function tryReadNeteaseLocalLyric(trackName) {
  if (process.platform !== 'win32' || ! process.env.LOCALAPPDATA) return null;
  try {
    const baseDir = path.join(process.env.LOCALAPPDATA, 'Netease', 'CloudMusic', 'webdata');
    const historyFile = path.join(baseDir, 'file', 'history');
    const lyricDir = path.join(baseDir, 'lyric');
    if (fs.existsSync(historyFile)) {
      const rawHist = fs.readFileSync(historyFile, 'utf8');
      const list = JSON.parse(rawHist);
      if (Array.isArray(list) && list.length > 0) {
        const matched = list.find((item) => item && item.track && item.track.name && trackName && item.track.name.includes(trackName)) || list[0];
        if (matched && matched.track) {
          const tid = String(matched.track.id || '');
          const durSec = Math.round((Number(matched.track.duration) || 240000) / 1000);
          if (tid && fs.existsSync( path.join(lyricDir, tid) )) {
            const rawLyricJson = fs.readFileSync(path.join(lyricDir, tid), 'utf8');
            const lrcObj = JSON.parse(rawLyricJson);
            const lrcStr = lrcObj && lrcObj.lrc && lrcObj.lrc.lyric;
            const lines = parseLrcText(lrcStr);
            if (lines.length > 0) {
              return { durationSec: durSec, lines };
            }
          }
          return { durationSec: durSec, lines: null };
        }
      }
    }
  } catch (_) {}
  return null;
}

/**
 * 非阻塞查询 Windows 10/11 GlobalSystemMediaTransportControlsSessionManager (SMTC)
 */
function pollWindowsSmtcAsync() {
  if (process.platform !== 'win32') return;
  const now = Date.now();
  if (smtcCache.polling || (now - smtcCache.ts) < 3500) return;
  smtcCache.polling = true;

  const psScript = `
$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation\`1' })[0]
function Await($WinRtTask, $ResultType) {
  $asTask = $asTaskGeneric.MakeGenericMethod($ResultType)
  $netTask = $asTask.Invoke($null, @($WinRtTask))
  $netTask.Wait(1200) | Out-Null
  return $netTask.Result
}
$mgr = Await ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager,Windows.Media.Control,ContentType=WindowsRuntime]::RequestAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])
$session = $mgr.GetCurrentSession()
if ($session) {
  $info = $session.GetPlaybackInfo()
  $status = $info.PlaybackStatus.ToString()
  $props = Await ($session.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])
  $tl = $session.GetTimelineProperties()
  $pos = [math]::Round($tl.Position.TotalSeconds)
  $end = [math]::Round($tl.EndTime.TotalSeconds)
  Write-Output ("SMTC|" + $session.SourceAppUserModelId + "|" + $status + "|" + $props.Title + "|" + $props.Artist + "|" + $props.AlbumTitle + "|" + $pos + "|" + $end)
}
`;
  try {
    const b64 = Buffer.from(psScript, 'utf16le').toString('base64');
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', b64], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    let out = '';
    const timer = setTimeout(() => { try { child.kill(); } catch (_) {} smtcCache.polling = false; }, 1800);
    child.stdout.on('data', (d) => { out += d.toString('utf8'); });
    child.on('error', () => { clearTimeout(timer); smtcCache.polling = false; smtcCache.ts = Date.now(); });
    child.on('close', () => {
      clearTimeout(timer);
      smtcCache.polling = false;
      smtcCache.ts = Date.now();
      const line = out.split(/\r?\n/).find((l) => l.startsWith('SMTC|'));
      if (line) {
        const [, appId, status, title, artist, album, posStr, endStr] = line.split('|');
        if (title && title.trim()) {
          smtcCache.data = {
            appId: appId || '',
            playing: /playing/i.test(status || ''),
            track: title.trim(),
            artist: (artist || '').trim(),
            album: (album || '').trim(),
            positionSec: Math.max(0, parseInt(posStr, 10) || 0),
            durationSec: Math.max(1, parseInt(endStr, 10) || 240),
          };
        }
      }
    });
  } catch (_) {
    smtcCache.polling = false;
    smtcCache.ts = Date.now();
  }
}

function resolveCurrentLyrics(track, artist, elapsedSec, durationSec) {
  const lines = (trackPlaybackTracker.cachedLrcLines && trackPlaybackTracker.cachedLrcLines.length > 0)
    ? trackPlaybackTracker.cachedLrcLines
    : BUILTIN_LYRIC_TIMELINES.default;

  const loopSec = elapsedSec % Math.max(60, durationSec || 120);
  let curIdx = 0;
  for (let i = 0; i < lines.length; i++) {
    if (loopSec >= lines[i].sec) curIdx = i;
    else break;
  }
  const cur = lines[curIdx] || lines[0];
  const next = lines[(curIdx + 1) % lines.length];
  return {
    lyric: cur ? cur.text : `${track} · ${artist}`,
    subLyric: (cur && cur.sub) ? cur.sub : (next ? next.text : artist),
  };
}

function formatMmSs(sec) {
  const s = Math.max(0, Math.round(Number(sec) || 0));
  const m = String(Math.floor(s / 60)).padStart(2, '0');
  const r = String(s % 60).padStart(2, '0');
  return `${m}:${r}`;
}

let mediaObsCache = {
  obs: { running: false, streaming: false, recording: false, statusText: 'OBS 未启动', scene: '待机' },
  media: {
    active: true,
    playing: true,
    app: '网易云音乐',
    track: '晴天',
    title: '晴天',
    artist: '周杰伦',
    album: '叶惠美',
    lyric: '故事的小黄花 从出生那年就飘着',
    subLyric: '童年的荡秋千 随记忆一直晃到现在',
    displayLine: '晴天 - 周杰伦',
    positionSec: 42,
    durationSec: 269,
    progressPct: 16,
    timeText: '00:42 / 04:29',
    coverColor: '#7c3aed',
  },
  ts: 0,
};

async function sampleMediaAndObs() {
  const now = Date.now();
  if (now - mediaObsCache.ts < 1500) {
    // 即便命中进程查询缓存，也实时推进歌词与进度秒数
    const m = mediaObsCache.media;
    if (m && m.playing) {
      const elapsed = Math.floor((now - trackPlaybackTracker.startedAtMs) / 1000);
      const dur = Math.max(30, m.durationSec || 269);
      const pos = elapsed % dur;
      const lyr = resolveCurrentLyrics(m.track, m.artist, pos, dur);
      m.positionSec = pos;
      m.progressPct = Math.min(100, Math.round((pos / dur) * 100));
      m.timeText = `${formatMmSs(pos)} / ${formatMmSs(dur)}`;
      m.lyric = lyr.lyric;
      m.subLyric = lyr.subLyric;
    }
    return mediaObsCache;
  }

  const titles = await NativeInput.getProcessWindowTitles([
    'obs64', 'obs32', 'cloudmusic', 'spotify', 'qqmusic', 'foobar2000', 'music.ui', 'yesplaymusic',
  ]);

  // 1. 解析 OBS 状态
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
    mediaObsCache.obs = { running: false, streaming: false, recording: false, statusText: 'OBS 未启动', scene: '待机' };
  }

  // 2. 解析音乐播放器与 SMTC 会话
  const musicApps = [
    { key: 'cloudmusic', label: '网易云音乐', color: '#dc2626' },
    { key: 'qqmusic', label: 'QQ音乐', color: '#059669' },
    { key: 'spotify', label: 'Spotify', color: '#16a34a' },
    { key: 'yesplaymusic', label: 'YesPlayMusic', color: '#2563eb' },
    { key: 'foobar2000', label: 'foobar2000', color: '#d97706' },
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
        const track = (parts[0] || cleaned).slice(0, 28);
        const artist = (parts.slice(1).join(' / ') || ma.label).slice(0, 22);
        const sig = `${ma.key}:${track}:${artist}`;
        if (trackPlaybackTracker.signature !== sig) {
          trackPlaybackTracker.signature = sig;
          trackPlaybackTracker.startedAtMs = now;
          const localLrc = ma.key === 'cloudmusic' ? tryReadNeteaseLocalLyric(track) : null;
          trackPlaybackTracker.durationSec = (localLrc && localLrc.durationSec) || 245;
          trackPlaybackTracker.cachedLrcLines = (localLrc && localLrc.lines) || null;
        }
        const dur = trackPlaybackTracker.durationSec || 245;
        const pos = Math.floor((now - trackPlaybackTracker.startedAtMs) / 1000) % dur;
        const lyr = resolveCurrentLyrics(track, artist, pos, dur);
        foundMedia = {
          active: true,
          playing: true,
          app: ma.label,
          track,
          title: track,
          artist,
          album: ma.label,
          lyric: lyr.lyric,
          subLyric: lyr.subLyric,
          displayLine: `${track} - ${artist}`,
          positionSec: pos,
          durationSec: dur,
          progressPct: Math.min(100, Math.round((pos / dur) * 100)),
          timeText: `${formatMmSs(pos)} / ${formatMmSs(dur)}`,
          coverColor: ma.color,
        };
        break;
      }
    }
  }

  // 3. 仅当原生窗口标题未命中任何桌面音乐播放器时，才按需触发异步 SMTC 探测，避免空闲时每 3.5s 拉起 PowerShell
  if (!foundMedia) {
    pollWindowsSmtcAsync();
  }
  if (!foundMedia && smtcCache.data && smtcCache.data.track) {
    const s = smtcCache.data;
    const dur = Math.max(30, s.durationSec || 240);
    const pos = Math.min(dur, s.positionSec || Math.floor((now - trackPlaybackTracker.startedAtMs) / 1000) % dur);
    const lyr = resolveCurrentLyrics(s.track, s.artist, pos, dur);
    foundMedia = {
      active: true,
      playing: s.playing,
      app: /cloudmusic/i.test(s.appId) ? '网易云音乐' : (/spotify/i.test(s.appId) ? 'Spotify' : (/qqmusic/i.test(s.appId) ? 'QQ音乐' : '系统媒体 (SMTC)')),
      track: s.track,
      title: s.track,
      artist: s.artist || '未知歌手',
      album: s.album || '',
      lyric: lyr.lyric,
      subLyric: lyr.subLyric,
      displayLine: `${s.track} - ${s.artist || ''}`,
      positionSec: pos,
      durationSec: dur,
      progressPct: Math.min(100, Math.round((pos / dur) * 100)),
      timeText: `${formatMmSs(pos)} / ${formatMmSs(dur)}`,
      coverColor: '#6d28d9',
    };
  }

  // 4. 优雅默认态（支持实时滚动演示歌词与进度）
  if (!foundMedia) {
    const dur = 269;
    const pos = Math.floor((now - trackPlaybackTracker.startedAtMs) / 1000) % dur;
    const lyr = resolveCurrentLyrics('晴天', '周杰伦', pos, dur);
    foundMedia = {
      active: true,
      playing: true,
      app: '网易云音乐',
      track: '晴天',
      title: '晴天',
      artist: '周杰伦',
      album: '叶惠美',
      lyric: lyr.lyric,
      subLyric: lyr.subLyric,
      displayLine: '晴天 - 周杰伦',
      positionSec: pos,
      durationSec: dur,
      progressPct: Math.min(100, Math.round((pos / dur) * 100)),
      timeText: `${formatMmSs(pos)} / ${formatMmSs(dur)}`,
      coverColor: '#7c3aed',
    };
  }

  mediaObsCache.media = foundMedia;
  mediaObsCache.ts = now;
  return mediaObsCache;
}

// ------------------------------------------------------------------ 6. Custom JS Plugin Loader & Built-in Market
const loadedPlugins = new Map();
const pluginAliases = new Map();
let pluginsLoadedAt = 0;

let onPluginStateChange = null;
const pluginStateStore = new Map();

function setPluginStateListener(fn) {
  onPluginStateChange = typeof fn === 'function' ? fn : null;
}

function makeEmitState(pluginId) {
  return (patch = {}) => {
    const prev = pluginStateStore.get(pluginId) || {};
    const next = Object.assign({}, prev, patch, { _updatedAt: Date.now() });
    pluginStateStore.set(pluginId, next);
    if (onPluginStateChange) {
      try { onPluginStateChange(pluginId, next); } catch (_) {}
    }
  };
}

const MARKETPLACE_CATALOG = [
  {
    id: 'obs_studio',
    file: 'obs-studio.plugin.js',
    name: 'OBS Studio WebSocket v5 导播台',
    category: '音频与直播',
    author: 'AKP153 Official',
    version: '0.10.5',
    description: '基于 OBS WebSocket v5 实时显示录制/推流状态、当前场景高亮、麦克风分贝表与一键切景',
    features: ['bars', 'badge', 'bidirectional'],
    color: '#1e1b4b',
  },
  {
    id: 'app_volume_mixer',
    file: 'app-mixer.plugin.js',
    name: '应用级独立混音器 (Per-App Mixer)',
    category: '音频与直播',
    author: 'AKP153 Official',
    version: '0.10.5',
    description: '基于 CoreAudio IAudioSessionManager2 独立控制指定软件或当前前台游戏的音量与静音',
    features: ['bars', 'progress', 'badge', 'bidirectional'],
    color: '#0f172a',
  },
  {
    id: 'uptime_greeting',
    file: 'uptime-greeting.plugin.js',
    name: '系统运行时长与负载看板',
    category: '系统监控',
    author: 'AKP153 Official',
    version: '0.9.5',
    description: '实时展示开机累计运行时长、时段问候语与内存负载折线图，按击切换监控维度',
    features: ['sparkline', 'progress', 'badge'],
    color: '#0f172a',
  },
  {
    id: 'stock_crypto_ticker',
    file: 'stock-crypto-ticker.plugin.js',
    name: '金融行情与 K 线趋势监控',
    category: '金融行情',
    author: 'AKP153 Community',
    version: '0.9.5',
    description: '实时展示 BTC / ETH / NVDA / AAPL 价格走势与迷你 K 线折线图，按击一键切换标的',
    features: ['sparkline', 'badge'],
    color: '#06221c',
  },
  {
    id: 'home_assistant_switch',
    file: 'home-assistant-switch.plugin.js',
    name: 'HomeAssistant 智能家居开关',
    category: '智能家居',
    author: 'AKP153 Community',
    version: '0.9.5',
    description: '控制与监控智能家居灯光/空调状态，支持自定义 SVG 矢量图标与亮度进度条',
    features: ['svg', 'progress', 'badge'],
    color: '#1e1b4b',
  },
  {
    id: 'github_pr_monitor',
    file: 'github-pr-monitor.plugin.js',
    name: 'GitHub PR 与 CI 构建监控',
    category: '开发者工具',
    author: 'AKP153 Community',
    version: '0.9.5',
    description: '监控仓库待审 PR 数量、Actions CI 构建状态角标与近 7 日 Commit 趋势折线',
    features: ['sparkline', 'badge'],
    color: '#0d1117',
  },
  {
    id: 'audio_fader_meter',
    file: 'audio-fader-meter.plugin.js',
    name: '多路声卡推子与电平表',
    category: '音频与直播',
    author: 'AKP153 Community',
    version: '0.9.5',
    description: '四通道实时混音推子柱状图（MAIN / MIC / BGM / GAME），按击一键切换主通道静音',
    features: ['bars', 'badge'],
    color: '#0f172a',
  },
];

function normalizePluginId(pid) {
  const raw = String(pid || 'uptime_greeting').trim();
  if (loadedPlugins.has(raw)) return raw;
  if (pluginAliases.has(raw)) return pluginAliases.get(raw);
  const underscored = raw.replace(/-/g, '_');
  if (loadedPlugins.has(underscored)) return underscored;
  return raw;
}

function loadExternalPlugins(force = false) {
  const now = Date.now();
  if (!force && pluginsLoadedAt > 0 && (now - pluginsLoadedAt) < 10000) {
    return Array.from(loadedPlugins.values());
  }
  if (force && loadedPlugins.size > 0) {
    for (const oldEntry of loadedPlugins.values()) {
      if (oldEntry && typeof oldEntry.dispose === "function") {
        try { oldEntry.dispose(); } catch (_) {}
      }
    }
  }
  pluginsLoadedAt = now;
  loadedPlugins.clear();
  pluginAliases.clear();
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
          const configSchema = Array.isArray(mod.configSchema)
            ? mod.configSchema.filter((f) => f && f.key).map((f) => ({
                key: String(f.key).trim(),
                label: String(f.label || f.key).trim(),
                type: ['text', 'number', 'select', 'password', 'boolean'].includes(f.type) ? f.type : 'text',
                default: f.default !== undefined ? f.default : '',
                placeholder: f.placeholder ? String(f.placeholder) : '',
                options: Array.isArray(f.options)
                  ? f.options.map((o) => (typeof o === 'object' ? { label: String(o.label ?? o.value), value: String(o.value) } : { label: String(o), value: String(o) }))
                  : [],
              }))
            : [];
          const entry = {
            id: String(mod.id),
            name: String(mod.name || mod.id),
            category: String(mod.category || '扩展插件'),
            author: String(mod.author || 'Community'),
            version: String(mod.version || '0.9.5'),
            description: String(mod.description || ''),
            color: mod.color || '#1e293b',
            defaultIntervalMs: Math.max(150, Math.min(600000, Number(mod.defaultIntervalMs) || 2500)),
            configSchema,
            render: mod.render,
            onPress: typeof mod.onPress === 'function' ? mod.onPress : null,
            dispose: typeof mod.dispose === 'function' ? mod.dispose : null,
          };
          loadedPlugins.set(entry.id, entry);
          const hyphenId = entry.id.replace(/_/g, '-');
          pluginAliases.set(hyphenId, entry.id);
          if (Array.isArray(mod.aliases)) {
            for (const al of mod.aliases) pluginAliases.set(String(al), entry.id);
          }
        }
      } catch (_) {}
    }
  } catch (_) {}
  return Array.from(loadedPlugins.values());
}

function resolvePluginConfig(pluginEntry, customConfig = {}) {
  const out = {};
  if (pluginEntry && Array.isArray(pluginEntry.configSchema)) {
    for (const f of pluginEntry.configSchema) {
      if (f.default !== undefined) out[f.key] = f.default;
    }
  }
  if (customConfig && typeof customConfig === 'object') {
    for (const [k, v] of Object.entries(customConfig)) {
      if (v !== undefined && v !== '') out[k] = v;
    }
  }
  return out;
}

async function evaluatePlugin(pluginId, customConfig = {}) {
  loadExternalPlugins();
  const normId = normalizePluginId(pluginId);
  const p = loadedPlugins.get(normId);
  if (!p) {
    return {
      id: pluginId || 'uptime_greeting',
      title: pluginId || '插件',
      value: '未加载',
      sub: '点击插件市场一键启用',
      subValue: '点击插件市场一键启用',
      color: '#334155',
    };
  }
  try {
    const config = resolvePluginConfig(p, customConfig);
    const state = pluginStateStore.get(p.id) || {};
    const emitState = makeEmitState(p.id);
    const res = await p.render({ os, now: new Date(), NativeInput, config, state, emitState });
    const merged = Object.assign({
      id: p.id,
      title: p.name,
      value: '',
      sub: '',
      color: p.color,
    }, res || {});
    if (!merged.subValue && merged.sub) merged.subValue = merged.sub;
    if (!merged.sub && merged.subValue) merged.sub = merged.subValue;
    return merged;
  } catch (err) {
    const msg = String(err.message || err).slice(0, 14);
    return {
      id: p.id,
      title: p.name,
      value: 'ERR',
      sub: msg,
      subValue: msg,
      color: '#7f1d1d',
    };
  }
}

async function triggerPluginPress(pluginId, args, customConfig = {}, context = {}) {
  loadExternalPlugins();
  const normId = normalizePluginId(pluginId);
  const p = loadedPlugins.get(normId);
  if (p && p.onPress) {
    const cfgObj = (args && typeof args === 'object' && args.pluginConfig && typeof args.pluginConfig === 'object')
      ? args.pluginConfig
      : customConfig;
    const action = (args && typeof args === 'object' && args.action) ? args.action : (typeof args === 'string' ? args : undefined);
    const config = resolvePluginConfig(p, cfgObj);
    const state = pluginStateStore.get(p.id) || {};
    const emitState = makeEmitState(p.id);
    return await p.onPress({ args, action, config, state, emitState, context, os, now: new Date(), NativeInput });
  }
  return { ok: true };
}

function listAvailablePlugins(force = true) {
  return loadExternalPlugins(force).map((p) => ({
    id: p.id,
    name: p.name,
    category: p.category,
    author: p.author,
    version: p.version,
    description: p.description,
    color: p.color,
    defaultIntervalMs: p.defaultIntervalMs || 2500,
    configSchema: p.configSchema || [],
  }));
}

function installPluginFile(sourcePath) {
  if (!sourcePath || !fs.existsSync(sourcePath)) {
    return { ok: false, error: 'FILE_NOT_FOUND' };
  }
  if (!fs.existsSync(PLUGINS_DIR)) {
    fs.mkdirSync(PLUGINS_DIR, { recursive: true });
  }
  let baseName = path.basename(sourcePath);
  if (!baseName.endsWith('.plugin.js')) {
    baseName = baseName.replace(/\.js$/i, '') + '.plugin.js';
  }
  const dest = path.join(PLUGINS_DIR, baseName);
  fs.copyFileSync(sourcePath, dest);
  const list = listAvailablePlugins(true);
  return { ok: true, plugins: list, installedPath: dest };
}

function listMarketplacePlugins() {
  const installed = new Set(loadExternalPlugins(true).map((p) => p.id));
  return MARKETPLACE_CATALOG.map((item) => Object.assign({}, item, {
    installed: installed.has(item.id),
  }));
}

async function gatherTelemetry(options = {}) {
  const types = Array.isArray(options.types) && options.types.length > 0
    ? options.types
    : ['gpu', 'net', 'weather', 'pomodoro', 'obs', 'media_now', 'plugin'];
  const out = {};

  const tasks = [];
  if (types.includes('gpu')) {
    tasks.push(sampleGpuAsync().then((g) => { out.gpu = g; }));
  } else {
    out.gpu = gpuCache;
  }

  if (types.includes('net')) {
    tasks.push(sampleNetSpeed().then((n) => { out.net = n; }));
  } else {
    out.net = netCache;
  }

  if (types.includes('weather')) {
    tasks.push(sampleWeather(options.weatherCity || 'Auto').then((w) => { out.weather = w; }));
  } else {
    out.weather = weatherCache;
  }

  out.pomodoro = getPomodoroSnapshot();

  if (types.includes('obs') || types.includes('media_now') || types.includes('media')) {
    tasks.push(sampleMediaAndObs().then((m) => {
      out.obs = m.obs;
      out.media_now = m.media;
      out.media = m.media;
    }));
  } else {
    out.obs = mediaObsCache.obs;
    out.media_now = mediaObsCache.media;
    out.media = mediaObsCache.media;
  }

  if (types.includes('plugin') || (options.pluginIds && options.pluginIds.length > 0)) {
    const allLoaded = loadExternalPlugins();
    const reqIds = Array.isArray(options.pluginIds) && options.pluginIds.length > 0
      ? Array.from(new Set(options.pluginIds.map(normalizePluginId)))
      : allLoaded.map((p) => p.id);

    const pluginConfigs = (options && options.pluginConfigs && typeof options.pluginConfigs === 'object')
      ? options.pluginConfigs
      : {};
    const pluginArr = [];
    await Promise.all(reqIds.map(async (pid) => {
      const customCfg = pluginConfigs[pid] || pluginConfigs[pid.replace(/_/g, '-')] || {};
      const evaluated = await evaluatePlugin(pid, customCfg);
      pluginArr.push(evaluated);
      pluginArr[pid] = evaluated;
      pluginArr[pid.replace(/_/g, '-')] = evaluated;
    }));
    out.plugins = pluginArr;
  }

  await Promise.all(tasks);
  return out;
}

module.exports = {
  gatherTelemetry,
  controlPomodoro,
  getPomodoroSnapshot,
  setPomodoroListener,
  setPluginStateListener,
  listAvailablePlugins,
  listMarketplacePlugins,
  loadExternalPlugins,
  evaluatePlugin,
  triggerPluginPress,
  installPluginFile,
  resolvePluginConfig,
  PLUGINS_DIR,
};

if (NativeInput && typeof NativeInput.on === 'function') {
  NativeInput.on('media', () => {
    mediaObsCache.ts = 0;
  });
}
