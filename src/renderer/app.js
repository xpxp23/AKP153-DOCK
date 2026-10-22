'use strict';
/* global api */

const KEY_COLS = 5;   // pressable columns
const ROWS = 3;
const TOTAL_COLS = 6; // last column = display strips

let cfg = null;
let selected = null;  // {row, col}
let clipboardKey = null; // { ...spec } 复制/剪切/粘贴剪贴板
let currentIconCategory = 'all';
let currentCustomSubCategory = '全部';
let ipContextTarget = null;
const DEFAULT_CUSTOM_CATEGORIES = ['全部', '常用', '办公开发', '游戏娱乐', '影音多媒体', '系统工具'];
const iconCache = new Map();
const MAX_ICON_CACHE = 200;
const activeLoopKeyIds = new Set();
let isDeviceAsleep = false;
let repaintGen = 0;
let lastSysStats = { cpu: 0, mem: 0, memUsedGb: '' };

// v0.8.0: Multi-select, Style Brush, Undo/Redo History Stack & Telemetry State
const multiSelected = new Set(); // Set<"row,col">
let styleBrushSpec = null;       // Extracted visual style for Style Painter
const historyStack = [];
const redoStack = [];
const MAX_HISTORY = 50;
let _isApplyingHistory = false;
let _lastHistoryHash = '';

const BUILTIN_MARKET_PLUGINS = [
  {
    id: 'obs_studio',
    name: 'OBS Studio WebSocket v5 导播台',
    category: '音频与直播',
    icon: '🎬',
    color: '#1e1b4b',
    accent: '#38bdf8',
    title: 'OBS 导播台',
    value: '主画面',
    sub: '景:主画面 · 麦:18dB',
    subValue: '景:主画面 · 麦:18dB',
    badge: { text: 'WS v5', bg: '#10b981' },
    bars: [
      { label: 'MIC', value: 62, color: '#10b981' },
      { label: 'PGM', value: 78, color: '#38bdf8' },
    ],
    features: ['📊 dB 电平表', '🔄 双向切景/录制', '🏷️ 直播角标'],
    description: '基于 OBS WebSocket v5 实时显示录制/推流状态、当前场景高亮、麦克风分贝表与一键切景',
    configSchema: [
      { key: 'obsAction', label: '按键触发动作', type: 'select', default: 'toggle_record', options: [
        { label: '⏺️ 启停录制 (Toggle Record)', value: 'toggle_record' },
        { label: '🔴 启停推流 (Toggle Stream)', value: 'toggle_stream' },
        { label: '🎬 切换指定/下一场景 (Switch Scene)', value: 'switch_scene' },
        { label: '🎙️ 麦克风静音切换 (Toggle Mic)', value: 'toggle_mic' },
      ] },
      { key: 'sceneName', label: '目标场景名 (留空则循环切景)', type: 'text', default: '', placeholder: '例如：游戏全屏 / 主画面' },
      { key: 'wsUrl', label: 'OBS WebSocket v5 地址', type: 'text', default: 'ws://127.0.0.1:4455', placeholder: 'ws://127.0.0.1:4455' },
      { key: 'password', label: 'WebSocket 密码 (可留空)', type: 'password', default: '', placeholder: 'Password' }
    ]
  },
  {
    id: 'app_volume_mixer',
    name: '应用级独立混音器 (Per-App Mixer)',
    category: '音频与直播',
    icon: '🎚️',
    color: '#0f172a',
    accent: '#06b6d4',
    title: '🎚️ 前台应用',
    value: '85%',
    sub: '前台混音 · 峰值 42%',
    subValue: '前台混音 · 峰值 42%',
    badge: { text: 'MIX', bg: '#0891b2' },
    progress: 85,
    bars: [
      { label: 'VOL', value: 85, color: '#06b6d4' },
      { label: 'PEAK', value: 42, color: '#10b981' },
    ],
    features: ['🎚️ 独立进程音量', '📊 实时峰值表', '🔇 一键应用静音'],
    description: '基于 CoreAudio IAudioSessionManager2 单独控制指定软件或当前前台游戏的音量与静音',
    configSchema: [
      { key: 'targetApp', label: '目标进程 (填 @foreground 自动跟随前台应用)', type: 'text', default: '@foreground', placeholder: '@foreground 或 cloudmusic / discord' },
      { key: 'pressAction', label: '按键触发动作', type: 'select', default: 'toggle_mute', options: [
        { label: '🔇 切换该应用静音 (Toggle Mute)', value: 'toggle_mute' },
        { label: '🔊 该应用音量 +10% (Step Up)', value: 'vol_up' },
        { label: '🔉 该应用音量 -10% (Step Down)', value: 'vol_down' },
        { label: '🔄 轮换活动音频应用 (Cycle App)', value: 'cycle_app' },
      ] },
      { key: 'step', label: '音量步进幅度 (%)', type: 'number', default: 10, placeholder: '10' }
    ]
  },
  {
    id: 'uptime_greeting',
    name: '系统运行时长与负载看板',
    category: '系统监控',
    icon: '✨',
    color: '#0f172a',
    accent: '#38bdf8',
    title: '⚡ 下午好',
    value: '3h 42m',
    sub: '内存 48% · 连续运行',
    subValue: '内存 48% · 连续运行',
    badge: { text: 'RUN', bg: '#0284c7' },
    progress: 48,
    sparkline: [22, 26, 24, 31, 28, 35, 30, 27, 33, 29, 25, 32],
    features: ['📈 Sparkline 折线', '📊 Progress 进度', '🏷️ Badge 角标'],
    description: '实时展示本机开机累计运行时长、时段问候语与内存负载趋势折线，按击切换监控维度',
    configSchema: [
      { key: 'customGreet', label: '自定义问候语', type: 'text', default: '', placeholder: '留空则按时段自动问候' },
      { key: 'memWarnPct', label: '内存告警阈值 (%)', type: 'number', default: 85, placeholder: '85' }
    ]
  },
  {
    id: 'stock_crypto_ticker',
    name: '金融行情与 K 线趋势监控',
    category: '金融行情',
    icon: '🪙',
    color: '#06221c',
    accent: '#10b981',
    title: '🪙 BTC 比特币',
    value: '$68,420',
    sub: 'BTC/USD +2.45%',
    subValue: 'BTC/USD +2.45%',
    badge: { text: '+2.45%', bg: '#059669' },
    sparkline: [67800, 67950, 68120, 68040, 68290, 68180, 68350, 68510, 68400, 68620, 68490, 68420],
    features: ['📈 K 线趋势图', '🏷️ 涨跌角标', '🔄 按击切标的'],
    description: '实时展示 BTC / ETH / NVDA / AAPL 价格走势与迷你 K 线折线图，按击一键切换标的',
    configSchema: [
      { key: 'symbol', label: '监控股票/币种代码', type: 'select', default: '', options: [
        { label: '自动轮播 (按击切换)', value: '' },
        { label: 'BTC/USD · 比特币', value: 'BTC/USD' },
        { label: 'ETH/USD · 以太坊', value: 'ETH/USD' },
        { label: 'NVDA · 英伟达', value: 'NVDA' },
        { label: 'AAPL · 苹果', value: 'AAPL' }
      ] },
      { key: 'colorScheme', label: '涨跌配色方案', type: 'select', default: 'us', options: [
        { label: '国际标准 (绿涨红跌)', value: 'us' },
        { label: 'A股习惯 (红涨绿跌)', value: 'cn' }
      ] }
    ]
  },
  {
    id: 'home_assistant_switch',
    name: 'HomeAssistant 智能家居开关',
    category: '智能家居',
    icon: '💡',
    color: '#1e1b4b',
    accent: '#f59e0b',
    title: '💡 工作室桌面灯带',
    value: '85%',
    sub: '书房 · 暖白光',
    subValue: '书房 · 暖白光',
    badge: { text: 'ON', bg: '#10b981' },
    progress: 85,
    svg: '<svg viewBox="0 0 24 24" fill="none" stroke="#fbbf24" stroke-width="2.2"><path d="M9 18h6M10 22h4M12 2a7 7 0 0 0-4 12.7V17h8v-2.3A7 7 0 0 0 12 2z"/></svg>',
    features: ['🎨 SVG 矢量图标', '📊 亮度进度条', '⚡ 按击开关'],
    description: '控制与监控智能家居灯光/空调/插座状态，支持自定义 SVG 图标与亮度进度条',
    configSchema: [
      { key: 'haUrl', label: 'HomeAssistant 地址', type: 'text', default: 'http://homeassistant.local:8123', placeholder: 'http://192.168.1.x:8123' },
      { key: 'entityId', label: '实体 ID (Entity ID)', type: 'text', default: 'light.studio_desk', placeholder: 'light.studio_desk' },
      { key: 'deviceName', label: '显示设备名称', type: 'text', default: '', placeholder: '例如：工作室桌面灯带' },
      { key: 'haToken', label: '访问令牌 (Token)', type: 'password', default: '', placeholder: 'Long-Lived Access Token' }
    ]
  },
  {
    id: 'github_pr_monitor',
    name: 'GitHub PR 与 CI 构建监控',
    category: '开发者工具',
    icon: '🐙',
    color: '#0d1117',
    accent: '#2ea043',
    title: '🐙 akp153-dock',
    value: '3 PRs',
    sub: 'main · CI 通过',
    subValue: 'main · CI 通过',
    badge: { text: 'PASS', bg: '#238636' },
    sparkline: [4, 7, 5, 9, 12, 8, 14],
    features: ['📈 Commit 活跃线', '🏷️ CI 状态标', '🔄 多仓库切换'],
    description: '实时监控 GitHub 仓库待审 PR 数量、Actions CI 构建状态与近期提交活跃度趋势',
    configSchema: [
      { key: 'repo', label: 'GitHub 仓库名', type: 'text', default: '', placeholder: '例如：electron/electron' },
      { key: 'branch', label: '监控分支', type: 'text', default: 'main', placeholder: 'main' }
    ]
  },
  {
    id: 'audio_fader_meter',
    name: '声卡多路推子电平表',
    category: '音频与直播',
    icon: '🎚️',
    color: '#0f172a',
    accent: '#06b6d4',
    title: '🎚️ 混音推子监控',
    value: '68%',
    sub: 'MIC 52% · BGM 58%',
    subValue: 'MIC 52% · BGM 58%',
    badge: { text: 'LIVE', bg: '#0891b2' },
    bars: [
      { label: 'MAIN', value: 68, color: '#06b6d4' },
      { label: 'MIC', value: 52, color: '#10b981' },
      { label: 'BGM', value: 58, color: '#8b5cf6' },
      { label: 'GAME', value: 46, color: '#f59e0b' }
    ],
    features: ['📊 4 路推子柱图', '🏷️ 直播状态标', '🔇 按击一键静音'],
    description: '四通道实时混音推子柱状图（MAIN / MIC / BGM / GAME），按击一键切换主通道静音',
    configSchema: [
      { key: 'title', label: '面板显示标题', type: 'text', default: '🎚️ 混音推子监控', placeholder: '例如：直播混音台' },
      { key: 'theme', label: '推子配色方案', type: 'select', default: 'cyber', options: [
        { label: '赛博青紫 (Cyber)', value: 'cyber' },
        { label: '录音室绿金 (Studio)', value: 'studio' },
        { label: '烈焰暖橙 (Warm)', value: 'warm' }
      ] }
    ]
  }
];

let lastTelemetry = {
  gpu: { available: true, name: 'NVIDIA RTX', temp: 48, load: 22, memUsedMb: 2450, memTotalMb: 8192, memPct: 30, history: [24, 28, 26, 32, 30, 35, 29, 25, 28, 24, 22, 24] },
  net: { rxKbps: 180, txKbps: 40, rxSec: 184320, txSec: 40960, rxText: '180 KB/s', txText: '40 KB/s', downText: '180 KB/s', upText: '40 KB/s', history: [110, 145, 132, 190, 168, 210, 175, 160, 195, 180] },
  weather: { city: '本地', temp: '24°C', tempNum: 24, condition: '晴间多云', desc: '晴间多云', icon: '⛅', humidity: '56%', humidityNum: 56, wind: '东南风 2级' },
  obs: { running: false, streaming: false, recording: false, statusText: 'OBS 待命', scene: '主场景' },
  media: {
    active: true, playing: true, app: '网易云音乐', track: '晴天', title: '晴天', artist: '周杰伦', album: '叶惠美',
    lyric: '故事的小黄花 从出生那年就飘着', subLyric: '童年的荡秋千 随记忆一直晃到现在',
    positionSec: 42, durationSec: 269, progressPct: 26, timeText: '00:42 / 04:29', coverColor: '#7c3aed'
  },
  media_now: {
    active: true, playing: true, app: '网易云音乐', track: '晴天', title: '晴天', artist: '周杰伦', album: '叶惠美',
    lyric: '故事的小黄花 从出生那年就飘着', subLyric: '童年的荡秋千 随记忆一直晃到现在',
    positionSec: 42, durationSec: 269, progressPct: 26, timeText: '00:42 / 04:29', coverColor: '#7c3aed'
  },
  pomodoro: { running: false, phase: 'work', remainSec: 25 * 60, remainingSec: 25 * 60, totalSec: 25 * 60, formatted: '25:00', progressPct: 0 },
  plugins: BUILTIN_MARKET_PLUGINS.map(p => Object.assign({}, p))
};

// v0.10.6: Unidirectional Renderer RuntimeStateStore & Dirty-Rect Hash Cache
const rendererRuntimeStore = new Map(); // "${pageId}:${row},${col}" -> { activeState, windowSubState }
const dirtyRectHashStore = new Map();   // "${pageId}:${row},${col}" -> visualHash
const widgetLastTickMap = new Map();    // "${pageId}:${row},${col}" -> timestamp

function getRuntimeCellState(pageId, row, col) {
  const k = `${pageId || (curPage() && curPage().id) || 'p1'}:${row},${col}`;
  return rendererRuntimeStore.get(k) || null;
}

function setRuntimeCellState(pageId, row, col, patch) {
  const pid = pageId || (curPage() && curPage().id) || 'p1';
  const k = `${pid}:${row},${col}`;
  const prev = rendererRuntimeStore.get(k) || { activeState: 0, windowSubState: 'stopped' };
  const next = Object.assign({}, prev, patch || {});
  rendererRuntimeStore.set(k, next);
  return next;
}

function syncRuntimeStoreToConfig(targetCfg) {
  if (!targetCfg || !Array.isArray(targetCfg.pages)) return;
  for (const p of targetCfg.pages) {
    if (!p || !p.buttons) continue;
    for (const [posKey, spec] of Object.entries(p.buttons)) {
      if (!spec) continue;
      const [r, c] = posKey.split(',').map(Number);
      const rt = getRuntimeCellState(p.id, r, c);
      if (rt) {
        spec._activeState = rt.activeState;
        if (rt.windowSubState !== undefined) spec._windowSubState = rt.windowSubState;
      } else if (spec._activeState !== undefined) {
        setRuntimeCellState(p.id, r, c, {
          activeState: spec._activeState,
          windowSubState: spec._windowSubState || 'stopped',
        });
      }
    }
  }
}

function triggerGridTransition(customStyle) {
  const grid = document.getElementById('grid');
  if (!grid) return;
  const style = customStyle || (cfg && cfg.transitionStyle) || 'slide-left';
  grid.classList.remove('transition-slide-left', 'transition-zoom', 'transition-fade');
  if (style === 'none') return;
  void grid.offsetWidth;
  const cls = style === 'zoom' ? 'transition-zoom' : (style === 'fade' ? 'transition-fade' : 'transition-slide-left');
  grid.classList.add(cls);
  clearTimeout(grid._transTimer);
  grid._transTimer = setTimeout(() => {
    grid.classList.remove('transition-slide-left', 'transition-zoom', 'transition-fade');
  }, 250);
}

function applyHardwareModelToUI(modelId) {
  const model = modelId || (cfg && cfg.hardwareModel) || 'akp153';
  const grid = document.getElementById('grid');
  if (grid) {
    grid.dataset.hwModel = model;
    grid.querySelectorAll('.cell').forEach((cell) => {
      const r = +cell.dataset.row;
      const c = +cell.dataset.col;
      if (model === 'akp03') {
        cell.classList.toggle('hw-hidden', r >= 2 || c >= 3);
      } else {
        cell.classList.remove('hw-hidden');
      }
    });
  }
  const modelLabelEl = document.querySelector('.device-bar .model');
  if (modelLabelEl) {
    modelLabelEl.textContent = model === 'akp03' ? 'AKP-03 旋钮版' : (model === 'streamdock_15' ? 'StreamDock 15' : 'AKP-153');
  }
  const hintEl = document.getElementById('hardwareProtocolHint');
  if (hintEl) {
    if (model === 'akp03') {
      hintEl.textContent = '🎛️ 当前协议适配：3×2 矩阵 + 3 路无极旋钮编码器（支持左旋/右旋/按压事件）';
    } else if (model === 'streamdock_15') {
      hintEl.textContent = '⚡ 当前协议适配：标准 5×3 15 键矩阵（单报文 Push 零延迟直通模式）';
    } else {
      hintEl.textContent = '⚡ 当前协议适配：AKP153 5×3 主键 + 3 段式一体副屏（单报文 Push 零延迟直通模式）';
    }
  }
  renderEncoderDockBar(model);
}

function renderEncoderDockBar(modelId) {
  const bar = document.getElementById('encoderDockBar');
  if (!bar) return;
  const model = modelId || (cfg && cfg.hardwareModel) || 'akp153';
  if (model !== 'akp03') {
    bar.hidden = true;
    return;
  }
  bar.hidden = false;
  const knobs = [
    { idx: 0, icon: '🔊', title: '左旋钮 · 主音量', pressTip: '按压静音切换' },
    { idx: 1, icon: '🎚️', title: '中旋钮 · 前台混音', pressTip: '按压应用静音' },
    { idx: 2, icon: '☀️', title: '右旋钮 · 亮度/切页', pressTip: '按压切换下一页' },
  ];
  bar.innerHTML = knobs.map((k) => `
    <div class="encoder-knob-card" data-knob="${k.idx}">
      <div class="encoder-knob-dial" data-knob-press="${k.idx}" title="${k.pressTip}（支持鼠标滚轮模拟旋转）">${k.icon}</div>
      <div class="encoder-knob-title">${k.title}</div>
      <div class="encoder-knob-actions">
        <button type="button" class="encoder-step-btn" data-knob="${k.idx}" data-dir="ccw" title="逆时针左旋">↺ 左旋</button>
        <button type="button" class="encoder-step-btn" data-knob="${k.idx}" data-dir="press" title="${k.pressTip}">● 按压</button>
        <button type="button" class="encoder-step-btn" data-knob="${k.idx}" data-dir="cw" title="顺时针右旋">右旋 ↻</button>
      </div>
    </div>
  `).join('');

  const fireEnc = async (knob, dir) => {
    const dial = bar.querySelector(`[data-knob-press="${knob}"]`);
    if (dial) {
      dial.style.transform = dir === 'cw' ? 'rotate(22deg) scale(1.05)' : (dir === 'ccw' ? 'rotate(-22deg) scale(1.05)' : 'scale(0.9)');
      setTimeout(() => { dial.style.transform = ''; }, 160);
    }
    if (!DEMO && window.api && api.triggerEncoder) {
      await api.triggerEncoder(knob, dir);
    } else {
      toast(`🎛️ 旋钮 ${knob + 1} 触发：${dir === 'cw' ? '顺时针 ↻' : (dir === 'ccw' ? '逆时针 ↺' : '按压 ●')}`);
    }
  };

  bar.querySelectorAll('.encoder-step-btn').forEach((btn) => {
    btn.onclick = () => fireEnc(Number(btn.dataset.knob), btn.dataset.dir);
  });
  bar.querySelectorAll('.encoder-knob-dial').forEach((dial) => {
    const kIdx = Number(dial.dataset.knobPress);
    dial.onclick = () => fireEnc(kIdx, 'press');
    dial.addEventListener('wheel', (e) => {
      e.preventDefault();
      fireEnc(kIdx, e.deltaY < 0 ? 'cw' : 'ccw');
    }, { passive: false });
  });
}

function getPagesSnapshotHash() {
  if (!cfg || !cfg.pages) return '';
  try {
    return JSON.stringify({
      pages: compactPagesForHistory(cfg.pages),
      currentPage: cfg.currentPage,
    });
  } catch (_) {
    return '';
  }
}

function updateUndoRedoUI() {
  const btnUndo = document.getElementById('btnUndo');
  const btnRedo = document.getElementById('btnRedo');
  if (btnUndo) {
    btnUndo.disabled = historyStack.length === 0;
    btnUndo.title = historyStack.length
      ? `撤销：${historyStack[historyStack.length - 1].reason || '上一步修改'} (Ctrl+Z)`
      : '撤销上一步修改 (Ctrl+Z)';
  }
  if (btnRedo) {
    btnRedo.disabled = redoStack.length === 0;
    btnRedo.title = redoStack.length
      ? `重做：${redoStack[redoStack.length - 1].reason || '上一步修改'} (Ctrl+Y)`
      : '重做上一步修改 (Ctrl+Y)';
  }
}

const _historyIconPool = new Map();
const _historyIconReverse = new Map();

function compactPagesForHistory(pages) {
  const cloned = JSON.parse(JSON.stringify(pages || []));
  for (const p of cloned) {
    for (const s of Object.values(p.buttons || {})) {
      if (s && typeof s.icon === 'string' && s.icon.length > 256) {
        let refKey = _historyIconReverse.get(s.icon);
        if (!refKey) {
          refKey = `__hist_icon_${_historyIconPool.size + 1}__`;
          _historyIconPool.set(refKey, s.icon);
          _historyIconReverse.set(s.icon, refKey);
        }
        s.icon = refKey;
      }
    }
  }
  return cloned;
}

function restorePagesFromHistory(pages) {
  const cloned = JSON.parse(JSON.stringify(pages || []));
  for (const p of cloned) {
    for (const s of Object.values(p.buttons || {})) {
      if (s && typeof s.icon === 'string' && _historyIconPool.has(s.icon)) {
        s.icon = _historyIconPool.get(s.icon);
      }
    }
  }
  return cloned;
}

let _cleanBaselinePages = null;
let _cleanBaselinePageId = null;

function syncHistoryBaseline() {
  if (!cfg || !cfg.pages) return;
  _cleanBaselinePages = compactPagesForHistory(cfg.pages);
  _cleanBaselinePageId = cfg.currentPage;
  _lastHistoryHash = getPagesSnapshotHash();
}

function pushHistory(reason = '编辑配置') {
  if (!cfg || !cfg.pages || _isApplyingHistory) return;
  const curHash = getPagesSnapshotHash();
  const snapPages = (_cleanBaselinePages && curHash !== _lastHistoryHash)
    ? _cleanBaselinePages
    : compactPagesForHistory(cfg.pages);
  const snapPageId = (_cleanBaselinePages && curHash !== _lastHistoryHash)
    ? (_cleanBaselinePageId || cfg.currentPage)
    : cfg.currentPage;
  historyStack.push({
    pages: snapPages,
    currentPage: snapPageId,
    reason
  });
  if (historyStack.length > MAX_HISTORY) historyStack.shift();
  redoStack.length = 0;
  _cleanBaselinePages = compactPagesForHistory(cfg.pages);
  _cleanBaselinePageId = cfg.currentPage;
  _lastHistoryHash = curHash;
  updateUndoRedoUI();
}

async function performUndo() {
  if (!historyStack.length || !cfg) {
    toast('没有可撤销的操作');
    return;
  }
  _isApplyingHistory = true;
  try {
    const snap = historyStack.pop();
    redoStack.push({
      pages: compactPagesForHistory(cfg.pages),
      currentPage: cfg.currentPage,
      reason: snap.reason
    });
    cfg.pages = restorePagesFromHistory(snap.pages);
    if (snap.currentPage && cfg.pages.some(p => p.id === snap.currentPage)) {
      cfg.currentPage = snap.currentPage;
    } else if (cfg.pages[0]) {
      cfg.currentPage = cfg.pages[0].id;
    }
    syncHistoryBaseline();
    updateUndoRedoUI();
    renderPageTabs();
    refreshGrid();
    renderInspector();
    await saveConfig();
    if (!DEMO) await repaintAll();
    toast(`↩ 已撤销：${snap.reason || '上一步修改'}`);
  } finally {
    _isApplyingHistory = false;
  }
}

async function performRedo() {
  if (!redoStack.length || !cfg) {
    toast('没有可重做的操作');
    return;
  }
  _isApplyingHistory = true;
  try {
    const snap = redoStack.pop();
    historyStack.push({
      pages: compactPagesForHistory(cfg.pages),
      currentPage: cfg.currentPage,
      reason: snap.reason
    });
    cfg.pages = restorePagesFromHistory(snap.pages);
    if (snap.currentPage && cfg.pages.some(p => p.id === snap.currentPage)) {
      cfg.currentPage = snap.currentPage;
    } else if (cfg.pages[0]) {
      cfg.currentPage = cfg.pages[0].id;
    }
    syncHistoryBaseline();
    updateUndoRedoUI();
    renderPageTabs();
    refreshGrid();
    renderInspector();
    await saveConfig();
    if (!DEMO) await repaintAll();
    toast(`↪ 已重做：${snap.reason || '修改'}`);
  } finally {
    _isApplyingHistory = false;
  }
}

function setStyleBrush(spec) {
  if (!spec) {
    styleBrushSpec = null;
    document.body.classList.remove('style-brush-mode');
    const btn = document.getElementById('btnStyleBrush');
    if (btn) {
      btn.classList.remove('active');
      btn.textContent = '🖌️ 样式刷';
    }
    return;
  }
  styleBrushSpec = {
    color: spec.color || '#37474f',
    color2: spec.color2 || '',
    customColor: !!spec.customColor,
    textColor: spec.textColor || '',
    fontSize: Number(spec.fontSize) || 17,
    iconScale: Number(spec.iconScale) || 62,
    labelPos: spec.labelPos || 'bottom',
  };
  document.body.classList.add('style-brush-mode');
  const btn = document.getElementById('btnStyleBrush');
  if (btn) {
    btn.classList.add('active');
    btn.textContent = '🖌️ 刷子就绪 (点格子应用)';
  }
  toast('🖌️ 已提取按键外观样式！点击任意格子（或多选格子）即可一键刷入样式，按 Esc 退出');
}

async function applyStyleBrushToCell(row, col) {
  if (!styleBrushSpec || col === 5 || isBackCell(row, col)) return;
  pushHistory('样式刷应用');
  const targets = (multiSelected.size > 1 && multiSelected.has(`${row},${col}`))
    ? Array.from(multiSelected).map(k => { const [r, c] = k.split(',').map(Number); return { row: r, col: c }; })
    : [{ row, col }];
  for (const t of targets) {
    if (t.col === 5 || isBackCell(t.row, t.col)) continue;
    const key = `${t.row},${t.col}`;
    if (!pageButtons()[key]) {
      pageButtons()[key] = { type: 'app', label: '新按键', target: '', color: styleBrushSpec.color };
    }
    const dst = pageButtons()[key];
    dst.color = styleBrushSpec.color;
    if (styleBrushSpec.color2) dst.color2 = styleBrushSpec.color2; else delete dst.color2;
    if (styleBrushSpec.customColor) dst.customColor = true; else delete dst.customColor;
    dst.textColor = styleBrushSpec.textColor;
    dst.fontSize = styleBrushSpec.fontSize;
    dst.iconScale = styleBrushSpec.iconScale;
    dst.labelPos = styleBrushSpec.labelPos;
  }
  await saveConfig();
  refreshGrid();
  renderInspector();
  if (!DEMO) {
    for (const t of targets) await pushKey(t.row, t.col);
  }
  toast(`🖌️ 已将外观样式刷入 ${targets.length} 个按键`);
}

if (typeof api !== 'undefined' && api.on) {
  api.on('macro:loopState', (payload) => {
    if (!payload) return;
    const { keyId, isRunning, context } = payload;
    const rc = context ? `${context.row},${context.col}` : (keyId && keyId.includes(':') ? keyId.split(':')[1] : keyId);
    if (isRunning) {
      if (keyId) activeLoopKeyIds.add(keyId);
      if (rc) activeLoopKeyIds.add(rc);
    } else {
      if (keyId) activeLoopKeyIds.delete(keyId);
      if (rc) activeLoopKeyIds.delete(rc);
    }
    refreshGrid();
    if (context && context.row !== undefined && context.col !== undefined) {
      pushKey(context.row, context.col);
    }
  });
}

const $ = (id) => document.getElementById(id);

const ACTION_TEMPLATES = [
  { id: '', name: '⚡ 快捷动作模板…' },
  {
    id: 'media_play', name: '⏯️ 播放 / 暂停',
    spec: {
      type: 'media', cmd: 'play_pause', label: '播放/暂停',
      color: '#2e7d32', iconName: '播放/暂停'
    }
  },
  {
    id: 'media_next', name: '⏭️ 下一首',
    spec: {
      type: 'media', cmd: 'next', label: '下一曲',
      color: '#00838f', iconName: '下一曲'
    }
  },
  {
    id: 'media_prev', name: '⏮️ 上一首',
    spec: {
      type: 'media', cmd: 'prev', label: '上一曲',
      color: '#00838f', iconName: '上一曲'
    }
  },
  {
    id: 'sys_lock', name: '🔒 一键锁屏',
    spec: {
      type: 'command', label: '锁屏',
      target: 'rundll32.exe user32.dll,LockWorkStation',
      color: '#d32f2f', iconName: '锁屏'
    }
  },
  {
    id: 'sys_snip', name: '✂️ 截图工具',
    spec: {
      type: 'command', label: '截图',
      target: 'explorer.exe ms-screenclip:',
      color: '#e65100', iconName: '截图/裁剪'
    }
  },
  {
    id: 'sys_taskmgr', name: '📊 任务管理器',
    spec: {
      type: 'command', label: '任务管理',
      target: 'taskmgr.exe',
      color: '#455a64', iconName: '任务管理'
    }
  },
  {
    id: 'sys_desktop', name: '🖥️ 显示桌面',
    spec: {
      type: 'command', label: '桌面',
      target: 'powershell -ExecutionPolicy Bypass -WindowStyle Hidden -Command "(New-Object -ComObject Shell.Application).MinimizeAll()"',
      color: '#37474f', iconName: '显示器/桌面'
    }
  },
  {
    id: 'tool_qr', name: '📷 一键扫码 / 二维码解码',
    spec: {
      type: 'qr_decode', label: '扫码解码',
      target: 'qr_decode',
      color: '#00838f', iconName: '二维码/扫码'
    }
  },
  {
    id: 'widget_pomodoro', name: '🍅 番茄钟专注倒计时 (实时组件)',
    spec: {
      type: 'widget', widgetKind: 'pomodoro', action: 'pomodoro_toggle',
      label: '番茄钟', color: '#b71c1c'
    }
  },
  {
    id: 'widget_gpu', name: '🎮 GPU 温度与显存监控 (NVML)',
    spec: {
      type: 'widget', widgetKind: 'gpu', action: 'refresh',
      label: 'GPU 监控', color: '#1b5e20'
    }
  },
  {
    id: 'widget_net', name: '🌐 实时上下行网速表',
    spec: {
      type: 'widget', widgetKind: 'net', action: 'refresh',
      label: '实时网速', color: '#0d47a1'
    }
  },
  {
    id: 'widget_media', name: '🎵 正在播放歌词/曲目卡片',
    spec: {
      type: 'widget', widgetKind: 'media_now', action: 'media_play_pause',
      label: '正在播放', color: '#4a148c'
    }
  }
];


// ---------------------------------------------------------------- page tree

/* 页面树：一个键可以设成「切页」（下一页 / 上一页 / 跳到某页 / 回上级 / 回主页）。
 * 子页（parent 非空）的右下角会自动长出一个「返回」键，退出后你原来放在
 * 那个角上的按键恢复显示 —— 位置永远一样，闭眼也按得到。
 * 编辑器与设备永远显示同一页：你在改哪一页，设备上就是哪一页。 */

const BACK = { row: 2, col: 4 };

function curPage() {
  if (!cfg || !cfg.pages || !cfg.pages.length) {
    return { id: 'none', name: '', parent: null, buttons: {}, strips: {}, gradient: { enabled: false, from: '#1565c0', to: '#6a1b9a', angle: 135 } };
  }
  const p = cfg.pages.find((p) => p.id === cfg.currentPage) || cfg.pages[0];
  if (!p.gradient) {
    p.gradient = { enabled: false, from: '#1565c0', to: '#6a1b9a', angle: 135 };
  }
  return p;
}
let activeRendererContextBar = null;
let dualInspectorViewMode = 'both'; // 'both' | 'form1' | 'form2'

function pageButtons() { return curPage().buttons; }
function pageStrips() { return curPage().strips; }
function effectiveStrips() {
  if (activeRendererContextBar && cfg && cfg.contextBarEnabled !== false && activeRendererContextBar.strips) {
    return activeRendererContextBar.strips;
  }
  return curPage().strips;
}
function childPages(id) { return (cfg.pages || []).filter((p) => p.parent === id); }
function pageById(id) { return (cfg.pages || []).find((p) => p.id === id) || null; }

/** Depth-first, top level first - this is the order 下一页/上一页 walks. */
function pageTree() {
  const out = [];
  const walk = (parent, depth) => {
    for (const p of (cfg.pages || []).filter((x) => x.parent === parent)) {
      out.push({ page: p, depth });
      walk(p.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

function isBackCell(row, col) {
  return !!(curPage().parent && row === BACK.row && col === BACK.col);
}

/** What the device should draw on the automatic back key. */
function backSpec() {
  return { type: 'back', label: '返回', color: '#37474f', textColor: '#ffffff', fontSize: 17 };
}

// ------------------------------------------------------------------- helpers

function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), 3200);
}

function contrast(hex) {
  const h = (hex || '#37474f').replace('#', '');
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 > 140 ? '#1f2430' : '#ffffff';
}

function glyphFor(type) {
  switch (type) {
    case 'volume':
    case 'audio': return '🔊';
    case 'media': return '⏯️';
    case 'multi':
    case 'macro': return '🎛️';
    case 'app': return '▶';
    case 'hotkey': return '⌨';
    case 'folder': return '📁';
    case 'file': return '📄';
    case 'url': return '🌐';
    case 'command': return '⌘';
    case 'ps1': return 'PS';
    case 'page': return '↦';
    case 'profile': return '🗂️';
    case 'back': return '←';
    case 'qr_decode':
    case 'qr': return '📷';
    case 'widget': return '📊';
    case 'app_volume': return '🎚️';
    case 'plugin_action': return '🧩';
    case 'window_toggle': return '🪟';
    default: return '';
  }
}

/** The type select used to show raw values (`app`, `ps1`...) - unreadable in an
 *  otherwise Chinese UI. */
const TYPE_NAMES = {
  volume: '🔊 音频与音量控制 (WASAPI 主音量/切声卡)',
  app_volume: '🎚️ 应用级独立混音器 (Per-App 进程音量/静音)',
  media: '⏯️ 多媒体播放控制 (播放/暂停/上下曲)',
  widget: '📊 动态实时组件 (GPU/网速/番茄钟/天气/音乐/OBS/插件)',
  plugin_action: '🧩 双向状态插件动作 (OBS导播/智能家居/混音)',
  multi: '🎛️ 复合动作 (多操作宏 / 键鼠录制 / 条件分支)',
  app: '🚀 应用程序 / 快捷方式 (.exe / .lnk)',
  window_toggle: '🪟 任务栏窗口置顶/最小化切换 (HWND)',
  hotkey: '⌨️ 虚拟快捷键 / 组合键宏',
  folder: '📁 文件夹',
  url: '🌐 网址 (URL)',
  command: '⌘ 命令行 (CMD / taskkill / wm_close)',
  ps1: '⚡ PowerShell 脚本 (.ps1)',
  file: '📄 其它文件（用默认程序打开）',
  page: '↦ 切换页面（下一页 / 跳转 / 返回上级）',
  profile: '🗂️ 切换整机模式 (办公/直播/剪辑/游戏 Profile)',
  qr_decode: '📷 屏幕/剪贴板二维码解码',
};
const TYPE_SHORT = {
  volume: '音量', app_volume: '应用混音', media: '媒体', widget: '组件', plugin_action: '插件动作',
  multi: '宏', app: '应用', window_toggle: '窗口切换', hotkey: '快捷键', folder: '文件夹', url: '网址',
  command: '命令', ps1: '脚本', file: '文件', page: '切页', profile: '切模式', qr_decode: '扫码',
};

/** Collapsible inspector sections keep their state across re-renders. */
let secOpen = { action: true, look: false, more: false };
const clone = (o) => JSON.parse(JSON.stringify(o));

// ------------------------------------------------------- device image render

function drawBase(ctx, size, spec) {
  if (spec.color2) {
    const g = ctx.createLinearGradient(0, 0, 0, size);
    g.addColorStop(0, spec.color || '#37474f');
    g.addColorStop(1, spec.color2);
    ctx.fillStyle = g;
  } else {
    ctx.fillStyle = spec.color || '#37474f';
  }
  ctx.fillRect(0, 0, size, size);
}

async function loadImage(src) {
  if (iconCache.has(src)) {
    const cached = iconCache.get(src);
    iconCache.delete(src);
    iconCache.set(src, cached);
    return cached;
  }
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      if (iconCache.size >= MAX_ICON_CACHE) {
        const oldestKey = iconCache.keys().next().value;
        if (oldestKey !== undefined) iconCache.delete(oldestKey);
      }
      iconCache.set(src, img);
      resolve(img);
    };
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

let cachedGradientKey = '';
let cachedGradientCanvas = null;

function getGlobalGradientCanvas(gradient) {
  if (!gradient || !gradient.enabled) return null;
  const key = `${gradient.from}_${gradient.to}_${gradient.angle}`;
  if (cachedGradientCanvas && cachedGradientKey === key) return cachedGradientCanvas;

  const w = TOTAL_COLS * 96; // 6 * 96 = 576 (覆盖包含副屏的全部 6 列)
  const h = ROWS * 96;       // 3 * 96 = 288
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');

  const angle = (Number(gradient.angle) || 0) % 360;
  const rad = ((angle - 90) * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const L = Math.abs(w * cos) + Math.abs(h * sin);
  const cx = w / 2;
  const cy = h / 2;
  const x0 = cx - (L / 2) * cos;
  const y0 = cy - (L / 2) * sin;
  const x1 = cx + (L / 2) * cos;
  const y1 = cy + (L / 2) * sin;

  const g = ctx.createLinearGradient(x0, y0, x1, y1);
  g.addColorStop(0, gradient.from || '#1565c0');
  g.addColorStop(1, gradient.to || '#6a1b9a');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);

  cachedGradientKey = key;
  cachedGradientCanvas = c;
  return c;
}

function parseHexRgb(hex, fallback = [55, 71, 79]) {
  const h = String(hex || '').replace('#', '').trim();
  if (h.length !== 6) return fallback;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  if (isNaN(r) || isNaN(g) || isNaN(b)) return fallback;
  return [r, g, b];
}

function sampleGradientContrast(grad, row, col) {
  if (!grad || !grad.enabled) return '#ffffff';
  const w = TOTAL_COLS * 96;
  const h = ROWS * 96;
  const angle = (Number(grad.angle) || 0) % 360;
  const rad = ((angle - 90) * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const L = Math.abs(w * cos) + Math.abs(h * sin) || 1;
  const px = col * 96 + 48 - w / 2;
  const py = row * 96 + 48 - h / 2;
  const proj = px * cos + py * sin;
  const t = Math.max(0, Math.min(1, proj / L + 0.5));
  const c0 = parseHexRgb(grad.from, [21, 101, 192]);
  const c1 = parseHexRgb(grad.to, [106, 27, 154]);
  const r = c0[0] + (c1[0] - c0[0]) * t;
  const g = c0[1] + (c1[1] - c0[1]) * t;
  const b = c0[2] + (c1[2] - c0[2]) * t;
  const bri = (r * 299 + g * 587 + b * 114) / 1000;
  return bri > 140 ? '#1f2430' : '#ffffff';
}

/**
 * 智能自动换行与字号自适应
 * @param {CanvasRenderingContext2D} ctx
 * @param {string} text 待排版文本
 * @param {number} maxW 最大宽度
 * @param {number} maxLines 最多容纳行数
 * @param {number} baseFontSize 基准字号
 * @param {string} fontFamily 字体族
 */
function wrapAndFitText(ctx, text, maxW, maxLines, baseFontSize, fontFamily) {
  if (!text) return { lines: [], fontSize: baseFontSize };
  const rawParas = String(text).split('\n');

  function splitParaIntoLines(para, fSize) {
    ctx.font = `${fSize}px ${fontFamily}`;
    if (!para) return [''];
    if (ctx.measureText(para).width <= maxW) return [para];

    const out = [];
    let cur = '';
    for (let i = 0; i < para.length; i++) {
      const ch = para[i];
      const test = cur + ch;
      if (ctx.measureText(test).width <= maxW) {
        cur = test;
      } else {
        if (cur) out.push(cur);
        cur = ch;
      }
    }
    if (cur) out.push(cur);
    return out;
  }

  let fs = baseFontSize;
  const minFs = Math.max(8, Math.round(baseFontSize * 0.65));

  let lines = [];
  while (fs >= minFs) {
    lines = [];
    for (const p of rawParas) {
      lines.push(...splitParaIntoLines(p, fs));
    }
    if (lines.length <= maxLines) break;
    fs -= 1;
  }

  if (lines.length > maxLines) {
    lines = lines.slice(0, maxLines);
    ctx.font = `${fs}px ${fontFamily}`;
    let last = lines[maxLines - 1];
    while (last.length > 0 && ctx.measureText(last + '…').width > maxW) {
      last = last.slice(0, -1);
    }
    lines[maxLines - 1] = last ? last + '…' : '…';
  }

  return { lines, fontSize: fs };
}

/**
 * Draw one key. Style knobs (all optional, with sane defaults):
 *   color / color2   background (color2 turns it into a vertical gradient)
 *   textColor        label colour, auto-contrast when omitted
 *   fontSize         label size as a percentage of the tile (default 17)
 *   iconScale        icon box as a percentage of the tile (default 62)
 *   labelPos         'bottom' | 'center' | 'top'
 *   badge            overlay badge text (✓, ✕, 1, A, etc.)
 */
const BADGE_TOGGLE_PRESETS = [
  { name: '🚫 清空 / 无角标', s1: { text: '', bg: '#546e7a', color: '#ffffff' }, s2: { text: '', bg: '#107c41', color: '#ffffff' } },
  { name: '🟢 运行中 / 无', s1: { text: '', bg: '#546e7a', color: '#ffffff' }, s2: { text: '运行中', bg: '#107c41', color: '#ffffff' } },
  { name: '🟢 运行中 / ⚪ 未运行', s1: { text: '未运行', bg: '#546e7a', color: '#ffffff' }, s2: { text: '运行中', bg: '#107c41', color: '#ffffff' } },
  { name: '🟢 ON / 🔴 OFF', s1: { text: 'ON', bg: '#107c41', color: '#ffffff' }, s2: { text: 'OFF', bg: '#e53935', color: '#ffffff' } },
  { name: '🟢 开 / 🔴 关', s1: { text: '开', bg: '#107c41', color: '#ffffff' }, s2: { text: '关', bg: '#e53935', color: '#ffffff' } },
  { name: '🔴 REC / ⚪ IDLE', s1: { text: 'REC', bg: '#e53935', color: '#ffffff' }, s2: { text: 'IDLE', bg: '#546e7a', color: '#ffffff' } },
  { name: '🟢 MIC / 🔴 MUTE', s1: { text: 'MIC', bg: '#107c41', color: '#ffffff' }, s2: { text: 'MUTE', bg: '#d32f2f', color: '#ffffff' } },
  { name: '🔵 1 / 🟣 2', s1: { text: '1', bg: '#1976d2', color: '#ffffff' }, s2: { text: '2', bg: '#7b1fa2', color: '#ffffff' } },
];

let lastAudioState = { volume: 50, isMute: false, device: '' };

function normalizeAudioState(state) {
  if (!state) return lastAudioState;
  const vol = (state.level !== undefined ? state.level : (state.volume !== undefined ? state.volume : lastAudioState.volume));
  const isMute = state.isMute !== undefined ? !!state.isMute : lastAudioState.isMute;
  const device = state.device !== undefined ? state.device : lastAudioState.device;
  return { volume: Math.max(0, Math.min(100, Math.round(Number(vol)))), isMute, device };
}

async function updateVolumeState(state) {
  if (!state) return;
  lastAudioState = normalizeAudioState(state);

  if (cfg) {
    const strips = effectiveStrips();
    const preStats = { volume: lastAudioState.volume, isMute: lastAudioState.isMute };
    const batchJobs = [];
    const rotMode = $('rotate') ? $('rotate').value : (cfg.rotate || 'ccw');

    for (let row = 0; row < ROWS; row++) {
      const s = strips[String(row)];
      if (s && s.type === 'volume') {
        refreshSingleCell(row, 5);
        if (!DEMO) {
          batchJobs.push(
            buildStripCanvas(row, preStats).then(async (c) => ({
              row, col: 5, data: await encodeCanvasToJpegB64(c, rotMode), force: false,
            }))
          );
        }
      }
    }
    const buttons = pageButtons();
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < KEY_COLS; c++) {
        const spec = buttons[`${r},${c}`];
        if (spec && (spec.type === 'volume' || spec.type === 'audio')) {
          refreshSingleCell(r, c);
          if (!DEMO) {
            batchJobs.push(
              paintKey(spec, 96, { row: r, col: c }).then(async (cnv) => ({
                row: r, col: c, data: await encodeCanvasToJpegB64(cnv, rotMode), force: false,
              }))
            );
          }
        }
      }
    }
    if (!DEMO && batchJobs.length > 0 && api.deviceBatchDraw) {
      Promise.all(batchJobs).then((items) => api.deviceBatchDraw(items)).catch(() => {});
    }
  }

  const curIconEl = $('i-vol-cur-icon');
  const curLevelEl = $('i-vol-cur-level');
  if (curIconEl && curLevelEl) {
    curIconEl.textContent = lastAudioState.isMute ? '🔇' : '🔊';
    curLevelEl.textContent = lastAudioState.isMute ? '已静音' : `${lastAudioState.volume}%`;
  }
}

function computeDynamicGlyph(spec) {
  if (!spec) return '';
  let gl = glyphFor(spec.type);
  if (spec.type === 'volume' || spec.type === 'audio') {
    if (spec.action === 'up') gl = '🔊';
    else if (spec.action === 'down') gl = '🔉';
    else if (spec.action === 'mute') gl = (lastAudioState && lastAudioState.isMute) ? '🔇' : '🔊';
    else if (spec.action === 'switch_device') gl = '🎧';
    else if (spec.action === 'set') gl = '🎚️';
  }
  return gl;
}

function getActiveBadge(spec, keyPos = null) {
  if (!spec) return null;

  // 从单向 RuntimeStateStore 恢复可能因 config 重载而缺省的运行时状态
  let activeState = spec._activeState;
  let windowSubState = spec._windowSubState;
  if (keyPos && keyPos.row !== undefined && keyPos.col !== undefined) {
    const rt = getRuntimeCellState(curPage() && curPage().id, keyPos.row, keyPos.col);
    if (rt) {
      if (activeState === undefined) activeState = rt.activeState;
      if (windowSubState === undefined) windowSubState = rt.windowSubState;
    }
  }
  const stateIdx = (activeState !== undefined) ? activeState : (spec.badgeInitialState || 0);

  // 1. 专属声学静音/音量动作与系统物理音频状态闭环联动
  if (spec.type === 'volume' || spec.type === 'audio') {
    if (spec.action === 'mute') {
      const isMute = lastAudioState ? !!lastAudioState.isMute : false;
      const s1 = spec.badgeState1 || { text: '🔊', bg: '#107c41', color: '#ffffff' };
      const s2 = spec.badgeState2 || { text: '🔇', bg: '#e53935', color: '#ffffff' };
      const sObj = isMute ? s2 : s1;
      const txt = String(sObj.text !== undefined ? sObj.text : (isMute ? '🔇' : '🔊')).trim();
      if (!txt) return null;
      return {
        text: txt,
        bg: sObj.bg || (isMute ? '#e53935' : '#107c41'),
        color: sObj.color || '#ffffff',
        state: isMute ? 1 : 0,
        isToggle: true,
      };
    }
    if ((spec.action === 'up' || spec.action === 'down' || spec.action === 'set') && !spec.badge && !spec.badgeToggle) {
      const vol = lastAudioState ? lastAudioState.volume : 50;
      const isMute = lastAudioState ? !!lastAudioState.isMute : false;
      return {
        text: isMute ? 'MUTE' : `${vol}%`,
        bg: isMute ? '#d32f2f' : '#1565c0',
        color: '#ffffff',
        state: 0,
        isToggle: false,
      };
    }
  }

  // 2. 双态动态角标（兼容显式开启 badgeToggle 或已配置 badgeState1/badgeState2/badge2 的按键）
  const hasToggleBadge = Boolean(spec.badgeToggle || spec.badgeState1 || spec.badgeState2 || spec.badge2);
  if (hasToggleBadge) {
    const s1 = spec.badgeState1 || { text: spec.badge || '待机', bg: spec.badgeBg || '#546e7a', color: '#ffffff' };
    const s2 = spec.badgeState2 || { text: spec.badge2 || '运行中', bg: spec.color2 || '#107c41', color: '#ffffff' };
    if (stateIdx === 1 && spec.toggleSyncMode === 'window' && (windowSubState === 'minimized' || windowSubState === 'background')) {
      return {
        text: '后台',
        bg: '#d97706',
        color: '#ffffff',
        state: 1,
        isToggle: true,
      };
    }
    const sObj = stateIdx === 1 ? s2 : s1;
    const text = String(sObj && sObj.text !== undefined ? sObj.text : '').trim();
    // 关键修复：当双态角标的当前状态文字设为空字符串 ""（如“🟢 运行中 / 无”预设下的待机态）时，
    // 必须直接返回 null（不显示角标），严禁向下穿透回退到静态 spec.badge！
    if (!text) return null;
    return {
      text,
      bg: (sObj && sObj.bg) || (stateIdx === 1 ? '#107c41' : '#546e7a'),
      color: (sObj && sObj.color) || '#ffffff',
      state: stateIdx,
      isToggle: true,
    };
  }

  // 3. 静态单态角标
  const text = String(spec.badge || '').trim();
  if (!text) return null;
  return {
    text,
    bg: spec.badgeBg || '#e53935',
    color: spec.badgeColor || '#ffffff',
    state: 0,
    isToggle: false,
  };
}

function computeRenderModel(spec, keyPos = null) {
  if (!spec) return { empty: true, visualHash: 'empty' };
  const badge = getActiveBadge(spec, keyPos);
  const glyph = computeDynamicGlyph(spec);
  const stateIdx = (spec._activeState !== undefined) ? spec._activeState : (spec.badgeInitialState || 0);
  const winSub = spec._windowSubState || 'stopped';
  const iconSig = spec.icon ? `${spec.icon.length}:${spec.icon.slice(0, 20)}:${spec.icon.slice(-16)}` : '';
  const badgeSig = badge ? `${badge.text}|${badge.bg}|${badge.color}` : '';
  const layersSig = Array.isArray(spec.widgetLayers) ? JSON.stringify(spec.widgetLayers) : '';
  return {
    empty: false,
    spec,
    badge,
    glyph,
    stateIdx,
    winSub,
    visualHash: [
      spec.type || '',
      spec.label || '',
      spec.color || '',
      spec.color2 || '',
      spec.customColor ? 1 : 0,
      spec.textColor || '',
      spec.fontSize || 17,
      spec.iconScale || 62,
      spec.labelPos || 'bottom',
      iconSig,
      glyph,
      badgeSig,
      stateIdx,
      winSub,
      spec.widgetKind || '',
      spec.pluginId || '',
      layersSig,
    ].join('§'),
  };
}

function findSpanMasterCell(buttons, row, col) {
  if (!buttons || col >= KEY_COLS || col < 0) return null;
  for (let c = 0; c < col; c++) {
    const cand = buttons[row + ',' + c];
    if (cand) {
      const span = Math.max(1, Math.min(KEY_COLS - c, Number(cand.spanCols) || 1));
      if (c + span > col) {
        return { masterCol: c, spanCols: span, spanOffset: col - c, spec: cand };
      }
    }
  }
  return null;
}

async function paintKey(spec, size, keyPos) {
  if (keyPos && keyPos.col !== undefined && keyPos.col < KEY_COLS) {
    const master = findSpanMasterCell(pageButtons(), keyPos.row, keyPos.col);
    if (master) {
      return paintWidgetCanvas(
        master.spec,
        size,
        { row: keyPos.row, col: keyPos.col, masterCol: master.masterCol, spanCols: master.spanCols, spanOffset: master.spanOffset }
      );
    }
  }
  if (spec && spec.type === 'widget') {
    const spanCols = (keyPos && keyPos.col < KEY_COLS)
      ? Math.max(1, Math.min(KEY_COLS - keyPos.col, Number(spec.spanCols) || 1))
      : 1;
    return paintWidgetCanvas(spec, size, Object.assign({ row: 0, col: 0, spanCols, spanOffset: 0 }, keyPos || {}));
  }
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');

  const page = curPage();
  const grad = page && page.gradient;
  let sampledFg = null;

  // 贯通 6 列整板渐变（包括副屏 col: 5）
  if (keyPos && grad && grad.enabled && (!spec || !spec.customColor)) {
    const master = getGlobalGradientCanvas(grad);
    if (master) {
      const sx = keyPos.col * 96;
      const sy = keyPos.row * 96;
      ctx.drawImage(master, sx, sy, 96, 96, 0, 0, size, size);
      sampledFg = sampleGradientContrast(grad, keyPos.row, keyPos.col);
    } else {
      drawBase(ctx, size, spec);
    }
  } else {
    drawBase(ctx, size, spec);
  }

  const label = spec.label || '';
  const fg = spec.textColor || sampledFg || contrast(spec.color);
  const pos = spec.labelPos || 'bottom';
  const fs = Math.max(8, Math.round((size * (Number(spec.fontSize) || 17)) / 100));
  const iconBox = (size * (Number(spec.iconScale) || 62)) / 100;

  let iconTop = size * 0.07;
  if (!label) iconTop = (size - iconBox) / 2;
  else if (pos === 'top') iconTop = Math.min(size - iconBox - size * 0.06, size * 0.14 + fs * 1.35);
  else if (pos === 'center') iconTop = size * 0.03;

  if (spec.icon) {
    const img = await loadImage(spec.icon);
    if (img) {
      const s = Math.min(iconBox / img.width, iconBox / img.height);
      const w = img.width * s, h = img.height * s;
      ctx.drawImage(img, (size - w) / 2, iconTop + (iconBox - h) / 2, w, h);
    }
  } else if (spec.type && spec.type !== 'text') {
    const gl = computeDynamicGlyph(spec);
    ctx.fillStyle = fg;
    ctx.font = `${Math.round(iconBox * 0.72)}px "Microsoft YaHei", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(gl, size / 2, iconTop + iconBox / 2);
  }

  // 自定义角标徽章（静态徽章或动态双态 Toggle 徽章）
  const activeBadge = getActiveBadge(spec, keyPos);
  if (activeBadge && activeBadge.text) {
    const badgeText = activeBadge.text;
    ctx.save();
    const bh = Math.max(14, Math.round(size * 0.20));
    ctx.font = `bold ${Math.round(bh * 0.72)}px "Segoe UI", "Microsoft YaHei", sans-serif`;
    const textWidth = ctx.measureText ? ctx.measureText(badgeText).width : (badgeText.length * bh * 0.65);
    const bw = Math.max(bh, Math.round(textWidth + 8));
    const bx = size - bw - size * 0.05;
    const by = size * 0.05;
    ctx.shadowColor = 'rgba(0,0,0,0.4)';
    ctx.shadowBlur = 4;
    ctx.fillStyle = activeBadge.bg || '#e53935';
    ctx.beginPath();
    if (ctx.roundRect) {
      ctx.roundRect(bx, by, bw, bh, bh / 2);
    } else {
      ctx.rect(bx, by, bw, bh);
    }
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.fillStyle = activeBadge.color || '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(badgeText, bx + bw / 2, by + bh / 2 + 0.5);
    ctx.restore();
  }

  // 宏循环活跃状态：硬件按键边框高亮 + RUN 徽章
  const isLoopRunning = keyPos && (
    activeLoopKeyIds.has(`${keyPos.row},${keyPos.col}`) ||
    (page && activeLoopKeyIds.has(`${page.id}:${keyPos.row},${keyPos.col}`))
  );
  if (isLoopRunning) {
    ctx.save();
    ctx.strokeStyle = '#00e676';
    ctx.lineWidth = Math.max(3, Math.round(size * 0.06));
    ctx.strokeRect(ctx.lineWidth / 2, ctx.lineWidth / 2, size - ctx.lineWidth, size - ctx.lineWidth);

    const bh = Math.max(14, Math.round(size * 0.20));
    const badgeText = '⟳ RUN';
    const bw = Math.max(bh, Math.round(badgeText.length * bh * 0.55 + 8));
    const bx = size * 0.05;
    const by = size * 0.05;
    ctx.fillStyle = '#00c853';
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(bx, by, bw, bh, bh / 2);
    else ctx.rect(bx, by, bw, bh);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.font = `bold ${Math.round(bh * 0.65)}px "Segoe UI", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(badgeText, bx + bw / 2, by + bh / 2 + 0.5);
    ctx.restore();
  }

  if (label) {
    const maxW = size * 0.86;
    const maxLines = (pos === 'center' || !spec.icon) ? 4 : 2;
    const { lines, fontSize: fittedFs } = wrapAndFitText(
      ctx,
      label,
      maxW,
      maxLines,
      fs,
      '"Microsoft YaHei", sans-serif'
    );
    ctx.fillStyle = fg;
    ctx.font = `${fittedFs}px "Microsoft YaHei", sans-serif`;
    ctx.textAlign = 'center';
    const lh = fittedFs * 1.15;
    if (pos === 'top') {
      ctx.textBaseline = 'top';
      lines.forEach((ln, i) => ctx.fillText(ln, size / 2, size * 0.08 + i * lh));
    } else if (pos === 'center') {
      ctx.textBaseline = 'middle';
      const total = lines.length * lh;
      lines.forEach((ln, i) => ctx.fillText(ln, size / 2, (size - total) / 2 + lh / 2 + i * lh));
    } else {
      // 底部基线边距提升至 size * 0.13，硬件物理透镜透光黄金区，彻底消灭底部裁切
      ctx.textBaseline = 'bottom';
      lines.forEach((ln, i) => ctx.fillText(ln, size / 2, size - size * 0.13 - (lines.length - 1 - i) * lh));
    }
  }
  return c;
}

function rotateCanvas(src, mode) {
  if (mode === 'none') return src;
  const s = src.width;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const ctx = c.getContext('2d');
  if (mode === 'ccw') {           // 90° counter-clockwise
    ctx.translate(0, s);
    ctx.rotate(-Math.PI / 2);
  } else {                        // 90° clockwise
    ctx.translate(s, 0);
    ctx.rotate(Math.PI / 2);
  }
  ctx.drawImage(src, 0, 0);
  return c;
}

function toJpegUnder(canvas, maxBytes) {
  for (let q = 0.92; q >= 0.35; q -= 0.06) {
    const dataUrl = canvas.toDataURL('image/jpeg', q);
    const bytes = Math.floor((dataUrl.length - 'data:image/jpeg;base64,'.length) * 0.75);
    if (bytes <= maxBytes) return dataUrl;
  }
  return canvas.toDataURL('image/jpeg', 0.3);
}

// v0.9.5: OffscreenCanvas Web Worker for zero-jank hardware frame rotation & JPEG encoding
let offscreenWorker = null;
let offscreenSeq = 1;
const offscreenPending = new Map();
let isWindowVisible = true;
let hwMirrorEnabled = false;
const _hwMirrorCanvasCache = new Map();
let cachedPluginSchemas = [];

function ensureOffscreenWorker() {
  if (offscreenWorker !== null) return offscreenWorker;
  if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined' || typeof Blob === 'undefined') {
    offscreenWorker = false;
    return null;
  }
  try {
    const code = `
      const pool = new Map();
      function getCanvas(s) {
        let e = pool.get(s);
        if (!e) {
          const c = new OffscreenCanvas(s, s);
          e = { c, ctx: c.getContext('2d', { alpha: false }) };
          pool.set(s, e);
        }
        return e;
      }
      self.onmessage = async (ev) => {
        const m = ev.data;
        if (!m || !m.id) return;
        try {
          const s = m.size || 96;
          const { c, ctx } = getCanvas(s);
          ctx.save();
          ctx.fillStyle = '#000';
          ctx.fillRect(0, 0, s, s);
          if (m.mode === 'ccw') { ctx.translate(0, s); ctx.rotate(-Math.PI / 2); }
          else if (m.mode === 'cw') { ctx.translate(s, 0); ctx.rotate(Math.PI / 2); }
          ctx.drawImage(m.bitmap, 0, 0, s, s);
          ctx.restore();
          if (m.bitmap && m.bitmap.close) m.bitmap.close();
          const blob = await c.convertToBlob({ type: 'image/jpeg', quality: 0.90 });
          let b64 = '';
          if (typeof FileReaderSync !== 'undefined') {
            const url = new FileReaderSync().readAsDataURL(blob);
            b64 = url.split(',')[1] || '';
          } else {
            const ab = await blob.arrayBuffer();
            const u8 = new Uint8Array(ab);
            let bin = '';
            for (let i = 0; i < u8.length; i++) bin += String.fromCharCode(u8[i]);
            b64 = btoa(bin);
          }
          self.postMessage({ id: m.id, ok: true, data: b64 });
        } catch (err) {
          self.postMessage({ id: m.id, ok: false });
        }
      };
    `;
    const blobUrl = URL.createObjectURL(new Blob([code], { type: 'application/javascript' }));
    offscreenWorker = new Worker(blobUrl);
    offscreenWorker.onmessage = (e) => {
      const msg = e.data;
      if (!msg || !msg.id) return;
      const p = offscreenPending.get(msg.id);
      if (p) {
        offscreenPending.delete(msg.id);
        p.resolve(msg.ok ? msg.data : null);
      }
    };
    offscreenWorker.onerror = () => { offscreenWorker = false; };
    return offscreenWorker;
  } catch (_) {
    offscreenWorker = false;
    return null;
  }
}

async function encodeCanvasToJpegB64(canvas, rotMode) {
  const worker = ensureOffscreenWorker();
  if (worker && typeof createImageBitmap === 'function') {
    try {
      const bmp = await createImageBitmap(canvas);
      const id = offscreenSeq++;
      const b64 = await new Promise((resolve) => {
        const timer = setTimeout(() => {
          offscreenPending.delete(id);
          resolve(null);
        }, 1200);
        offscreenPending.set(id, {
          resolve: (res) => { clearTimeout(timer); resolve(res); }
        });
        worker.postMessage({ id, bitmap: bmp, size: canvas.width, mode: rotMode }, [bmp]);
      });
      if (b64) return b64;
    } catch (_) {}
  }
  const rotated = rotateCanvas(canvas, rotMode);
  const dataUrl = toJpegUnder(rotated, 10240);
  return dataUrl.split(',')[1];
}

// Preview mode: when opened as a plain HTML file (no Electron preload) we
// render a sample layout so the UI can be inspected without the device.
const DEMO = typeof api === 'undefined';

async function pushKey(row, col, force = false) {
  if (!cfg || DEMO) return;
  if (col < KEY_COLS) {
    const master = findSpanMasterCell(pageButtons(), row, col);
    if (master) {
      return await pushKey(row, master.masterCol, force);
    }
    const spec = isBackCell(row, col) ? backSpec() : pageButtons()[row + ',' + col];
    const spanCols = (spec && spec.type === 'widget')
      ? Math.max(1, Math.min(KEY_COLS - col, Number(spec.spanCols) || 1))
      : 1;
    if (spanCols > 1) {
      const rotMode = $('rotate') ? $('rotate').value : (cfg.rotate || 'ccw');
      const sliceJobs = [];
      for (let k = 0; k < spanCols; k++) {
        const targetCol = col + k;
        if (isBackCell(row, targetCol)) continue;
        sliceJobs.push(
          paintKey(spec, 96, { row, col: targetCol }).then(async (c) => {
            const b64 = await encodeCanvasToJpegB64(c, rotMode);
            return { row, col: targetCol, data: b64, force: !!force };
          })
        );
      }
      const items = await Promise.all(sliceJobs);
      if (api.deviceBatchDraw && items.length > 1) {
        await api.deviceBatchDraw(items);
      } else {
        for (const it of items) await api.deviceDraw(it);
      }
      return;
    }
  }
  const spec = isBackCell(row, col) ? backSpec() : pageButtons()[row + ',' + col];
  const size = col === 5 ? 80 : 96;
  const blank = { color: '#20262e', label: '' };
  const c = await paintKey(spec || blank, size, { row, col });
  const rotMode = $('rotate') ? $('rotate').value : (cfg.rotate || 'ccw');
  const b64 = await encodeCanvasToJpegB64(c, rotMode);
  await api.deviceDraw({ row, col, data: b64, force: !!force });
}

/** 显示屏上的页码/页名。顶层页显示「第 N/M 页」，子页显示「子页 · 名字」。 */
function pageStripLabel() {
  const p = curPage();
  const name = String(p.name || '').slice(0, 10);
  if (p.parent) return `子页\n${name}`;
  const tops = (cfg.pages || []).filter((x) => !x.parent);
  const n = tops.findIndex((x) => x.id === p.id) + 1;
  return `第 ${n}/${tops.length} 页\n${name}`;
}

function paintVolumeStrip(spec, size, row, vol, isMute) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');

  const page = curPage();
  const grad = page && page.gradient;

  if (isMute) {
    const g = ctx.createLinearGradient(0, 0, 0, size);
    g.addColorStop(0, '#3a0c0c');
    g.addColorStop(1, '#1b0505');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  } else if (grad && grad.enabled && (!spec || !spec.customColor)) {
    const master = getGlobalGradientCanvas(grad);
    if (master) {
      const sx = 5 * 96;
      const sy = row * 96;
      ctx.drawImage(master, sx, sy, 96, 96, 0, 0, size, size);
    } else {
      ctx.fillStyle = spec.color || '#0d131a';
      ctx.fillRect(0, 0, size, size);
    }
  } else {
    const g = ctx.createLinearGradient(0, 0, 0, size);
    g.addColorStop(0, '#16222f');
    g.addColorStop(1, '#0b1118');
    ctx.fillStyle = spec.color ? spec.color : g;
    ctx.fillRect(0, 0, size, size);
  }

  // Header tag
  ctx.save();
  ctx.fillStyle = isMute ? '#ff5252' : '#00e5ff';
  ctx.font = 'bold 11px "Microsoft YaHei", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText(isMute ? '🔇 已静音' : '🔊 声学监听', size / 2, 7);
  ctx.restore();

  // Center display
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if (isMute) {
    ctx.fillStyle = '#ff5252';
    ctx.font = 'bold 20px "Segoe UI", sans-serif';
    ctx.fillText('MUTE', size / 2, size * 0.44);
  } else {
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 24px "Segoe UI", sans-serif';
    ctx.fillText(`${vol}%`, size / 2, size * 0.44);
  }
  ctx.restore();

  // Bottom level meter
  const barX = 10;
  const barY = size - 17;
  const barW = size - 20;
  const barH = 7;
  const barRadius = 3.5;

  ctx.fillStyle = 'rgba(255, 255, 255, 0.14)';
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(barX, barY, barW, barH, barRadius);
  else ctx.rect(barX, barY, barW, barH);
  ctx.fill();

  if (!isMute && vol > 0) {
    const fillW = Math.max(barH, Math.min(barW, Math.round((barW * vol) / 100)));
    const fg = ctx.createLinearGradient(barX, 0, barX + fillW, 0);
    if (vol > 80) {
      fg.addColorStop(0, '#00e676');
      fg.addColorStop(0.7, '#ffd600');
      fg.addColorStop(1, '#ff3d00');
    } else {
      fg.addColorStop(0, '#00e5ff');
      fg.addColorStop(1, '#00e676');
    }
    ctx.fillStyle = fg;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(barX, barY, fillW, barH, barRadius);
    else ctx.rect(barX, barY, fillW, barH);
    ctx.fill();
  }

  // Border frame
  ctx.strokeStyle = isMute ? 'rgba(255, 82, 82, 0.4)' : 'rgba(0, 229, 255, 0.25)';
  ctx.lineWidth = 1;
  ctx.strokeRect(0.5, 0.5, size - 1, size - 1);

  return c;
}

function fillStripBackground(ctx, spec, size, row, defaultTop = '#16222f', defaultBot = '#0b1118') {
  const page = curPage();
  const grad = page && page.gradient;
  if (grad && grad.enabled && (!spec || !spec.customColor)) {
    const master = getGlobalGradientCanvas(grad);
    if (master) {
      ctx.drawImage(master, 5 * 96, row * 96, 96, 96, 0, 0, size, size);
      return;
    }
  }
  if (spec && spec.color && spec.customColor) {
    ctx.fillStyle = spec.color;
    ctx.fillRect(0, 0, size, size);
    return;
  }
  const g = ctx.createLinearGradient(0, 0, 0, size);
  g.addColorStop(0, (spec && spec.color) || defaultTop);
  g.addColorStop(1, defaultBot);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
}

function paintClockStrip(spec, size, row) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  fillStripBackground(ctx, spec, size, row, '#141e30', '#0c131f');

  const d = new Date();
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const da = String(d.getDate()).padStart(2, '0');
  const wd = ['日', '一', '二', '三', '四', '五', '六'][d.getDay()];

  ctx.save();
  ctx.fillStyle = '#80deea';
  ctx.font = 'bold 10px "Microsoft YaHei", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText(`${mo}-${da} 周${wd}`, size / 2, 8);

  const scalePct = Number(spec && spec.fontSize) || 26;
  const timeFs = Math.max(16, Math.min(28, Math.round((size * scalePct) / 100) + 4));
  ctx.fillStyle = '#ffffff';
  ctx.font = `bold ${timeFs}px "Segoe UI", Consolas, sans-serif`;
  ctx.textBaseline = 'middle';
  ctx.fillText(`${hh}:${mm}`, size / 2, size * 0.56);

  ctx.strokeStyle = 'rgba(128, 222, 234, 0.22)';
  ctx.lineWidth = 1;
  ctx.strokeRect(0.5, 0.5, size - 1, size - 1);
  ctx.restore();
  return c;
}

function paintMetricStrip(spec, size, row, mode, stats) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  fillStripBackground(ctx, spec, size, row, '#14202e', '#0a1018');

  const cpu = Math.max(0, Math.min(100, Number(stats && stats.cpu) || 0));
  const mem = Math.max(0, Math.min(100, Number(stats && stats.mem) || 0));
  const usedGb = (stats && stats.memUsedGb) ? `${stats.memUsedGb}G` : '';

  const colorForLoad = (val, baseColor) => {
    if (val >= 85) return '#ff5252';
    if (val >= 65) return '#ffb74d';
    return baseColor;
  };

  if (mode === 'sys') {
    ctx.save();
    ctx.fillStyle = '#90caf9';
    ctx.font = 'bold 10px "Microsoft YaHei", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText('⚡ 系统态势', size / 2, 6);

    const drawMiniBar = (label, val, yTop, baseCol) => {
      const col = colorForLoad(val, baseCol);
      ctx.fillStyle = '#e2e8f0';
      ctx.font = 'bold 11px "Segoe UI", sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(label, 8, yTop);
      ctx.fillStyle = col;
      ctx.textAlign = 'right';
      ctx.fillText(`${val}%`, size - 8, yTop);

      const bx = 8, by = yTop + 13, bw = size - 16, bh = 6;
      ctx.fillStyle = 'rgba(255,255,255,0.14)';
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(bx, by, bw, bh, 3);
      else ctx.rect(bx, by, bw, bh);
      ctx.fill();

      if (val > 0) {
        const fw = Math.max(bh, Math.round((bw * val) / 100));
        ctx.fillStyle = col;
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(bx, by, fw, bh, 3);
        else ctx.rect(bx, by, fw, bh);
        ctx.fill();
      }
    };

    drawMiniBar('CPU', cpu, 23, '#00e5ff');
    drawMiniBar('MEM', mem, 50, '#00e676');

    ctx.strokeStyle = 'rgba(144, 202, 249, 0.22)';
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, size - 1, size - 1);
    ctx.restore();
    return c;
  }

  const isCpu = mode === 'cpu';
  const val = isCpu ? cpu : mem;
  const accent = colorForLoad(val, isCpu ? '#00e5ff' : '#00e676');
  const title = isCpu ? '💻 CPU 负载' : (usedGb ? `📊 内存 ${usedGb}` : '📊 内存占用');

  ctx.save();
  ctx.fillStyle = accent;
  ctx.font = 'bold 10px "Microsoft YaHei", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText(title, size / 2, 7);

  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 23px "Segoe UI", sans-serif';
  ctx.textBaseline = 'middle';
  ctx.fillText(`${val}%`, size / 2, size * 0.45);

  const barX = 10, barY = size - 16, barW = size - 20, barH = 7;
  ctx.fillStyle = 'rgba(255, 255, 255, 0.14)';
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(barX, barY, barW, barH, 3.5);
  else ctx.rect(barX, barY, barW, barH);
  ctx.fill();

  if (val > 0) {
    const fillW = Math.max(barH, Math.min(barW, Math.round((barW * val) / 100)));
    ctx.fillStyle = accent;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(barX, barY, fillW, barH, 3.5);
    else ctx.rect(barX, barY, fillW, barH);
    ctx.fill();
  }

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.18)';
  ctx.lineWidth = 1;
  ctx.strokeRect(0.5, 0.5, size - 1, size - 1);
  ctx.restore();
  return c;
}

const WIDGET_KINDS = ['gpu', 'net', 'weather', 'pomodoro', 'obs', 'media_now', 'plugin', 'composite'];

const DEFAULT_COMPOSITE_LAYERS = [
  { id: 'ly_bg', source: 'sparkline_gpu', slot: 'background', color: '#38bdf8', label: 'GPU 趋势波形' },
  { id: 'ly_top', source: 'cpu_load', slot: 'top', color: '#4ade80', label: 'CPU' },
  { id: 'ly_mid', source: 'gpu_temp', slot: 'middle', color: '#ffffff', label: 'GPU' },
  { id: 'ly_bot', source: 'net_speed', slot: 'bottom', color: '#38bdf8', label: 'NET' },
];

function resolveCompositeLayerValue(source) {
  const gpu = (lastTelemetry && lastTelemetry.gpu) || { temp: 46, load: 22, memPct: 30, history: [22, 26, 24, 30, 28, 25] };
  const net = (lastTelemetry && lastTelemetry.net) || { rxText: '180 KB/s', txText: '40 KB/s', history: [110, 150, 130, 190, 175] };
  const cpu = (lastSysStats && lastSysStats.cpu !== undefined) ? lastSysStats.cpu : 24;
  const mem = (lastSysStats && lastSysStats.mem !== undefined) ? lastSysStats.mem : 48;
  const vol = (lastAudioState && lastAudioState.volume !== undefined) ? lastAudioState.volume : 60;
  const isMute = !!(lastAudioState && lastAudioState.isMute);
  const d = new Date();
  const hhmm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

  switch (source) {
    case 'cpu_load':
      return { text: `CPU ${cpu}%`, big: `${cpu}%`, pct: cpu, history: (lastSysStats && lastSysStats.cpuHistory) || [18, 22, 25, 21, 28, 24] };
    case 'gpu_temp':
      return { text: `GPU ${gpu.temp || 46}°C (${gpu.load || 22}%)`, big: `${gpu.temp || 46}°C`, pct: gpu.load || 22, history: gpu.history || [24, 28, 26, 32, 30] };
    case 'net_speed':
      return { text: `↓${net.rxText || '180 KB/s'}`, big: `↓${net.rxText || '180K'}`, pct: 45, history: net.history || [120, 160, 140, 210, 180] };
    case 'mem_usage':
      return { text: `MEM ${mem}%`, big: `${mem}%`, pct: mem, history: (lastSysStats && lastSysStats.memHistory) || [48, 49, 50, 50, 51] };
    case 'audio_vol':
      return { text: isMute ? '🔇 MUTE' : `🔊 ${vol}%`, big: isMute ? 'MUTE' : `${vol}%`, pct: isMute ? 0 : vol, bars: [
        { label: 'OUT', value: isMute ? 0 : vol, color: '#06b6d4' },
        { label: 'PEAK', value: isMute ? 0 : Math.min(100, Math.round(vol * 0.78)), color: '#10b981' },
      ] };
    case 'audio_bars':
      return { text: 'AUDIO METER', big: `${vol}%`, pct: vol, bars: [
        { label: 'MAIN', value: isMute ? 0 : vol, color: '#06b6d4' },
        { label: 'MIC', value: isMute ? 0 : 48, color: '#10b981' },
        { label: 'APP', value: isMute ? 0 : Math.max(12, Math.round(vol * 0.82)), color: '#8b5cf6' },
      ] };
    case 'clock_time':
      return { text: `🕒 ${hhmm}`, big: hhmm, pct: Math.round((d.getSeconds() / 60) * 100) };
    case 'sparkline_cpu':
      return { history: (lastSysStats && lastSysStats.cpuHistory) || [18, 24, 21, 29, 25, 22] };
    case 'sparkline_net':
      return { history: net.history || [110, 150, 130, 190, 175] };
    case 'sparkline_gpu':
    default:
      return { history: gpu.history || [24, 28, 26, 32, 30, 35] };
  }
}

function paintCompositeWidgetCanvas(ctx, spec, size, fullW, fullH, scale) {
  const layers = (Array.isArray(spec.widgetLayers) && spec.widgetLayers.length > 0)
    ? spec.widgetLayers
    : DEFAULT_COMPOSITE_LAYERS;

  // 1. 先绘制背景波形层 (background)
  for (const ly of layers) {
    if (!ly || ly.slot !== 'background') continue;
    const d = resolveCompositeLayerValue(ly.source);
    if (Array.isArray(d.history) && d.history.length > 1) {
      const col = ly.color || '#38bdf8';
      drawSparklineChart(ctx, d.history, 4, Math.round(fullH * 0.42), fullW - 8, Math.round(fullH * 0.52), col, col + '33');
    }
  }

  // 2. 绘制柱状图层或进度条层
  for (const ly of layers) {
    if (!ly) continue;
    const d = resolveCompositeLayerValue(ly.source);
    if (ly.slot === 'bars' && Array.isArray(d.bars)) {
      const bx = fullW > size ? (size + Math.round(6 * scale)) : Math.round(7 * scale);
      const bw = fullW > size ? (fullW - bx - Math.round(7 * scale)) : (fullW - Math.round(14 * scale));
      drawBarsChart(ctx, d.bars, bx, Math.round(22 * scale), bw, fullH - Math.round(30 * scale), scale * 0.9);
    } else if (ly.slot === 'progress') {
      const px = Math.round(7 * scale), py = fullH - Math.round(8 * scale), pw = fullW - Math.round(14 * scale), ph = Math.max(3, Math.round(3.5 * scale));
      ctx.fillStyle = 'rgba(255,255,255,0.15)';
      ctx.fillRect(px, py, pw, ph);
      ctx.fillStyle = ly.color || '#10b981';
      ctx.fillRect(px, py, Math.round((pw * Math.max(4, Math.min(100, d.pct || 0))) / 100), ph);
    }
  }

  // 3. 绘制顶部 / 中部 / 底部指标文字层
  const textMaxW = (fullW > size && layers.some(l => l.slot === 'bars')) ? (size - Math.round(12 * scale)) : (fullW - Math.round(12 * scale));
  const centerX = (fullW > size && layers.some(l => l.slot === 'bars')) ? (size / 2) : (fullW / 2);

  for (const ly of layers) {
    if (!ly) continue;
    const d = resolveCompositeLayerValue(ly.source);
    const prefix = ly.label ? `${ly.label} ` : '';
    if (ly.slot === 'top') {
      ctx.fillStyle = ly.color || '#4ade80';
      ctx.font = `bold ${Math.round(9.5 * scale)}px "Microsoft YaHei", sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      drawClampedLine(ctx, d.text || (prefix + d.big), centerX, Math.round(6 * scale), textMaxW, 'center');
    } else if (ly.slot === 'middle') {
      ctx.fillStyle = ly.color || '#ffffff';
      ctx.font = `bold ${Math.round(17 * scale)}px "Segoe UI", Consolas, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      drawClampedLine(ctx, prefix ? `${prefix}${d.big}` : (d.big || d.text), centerX, Math.round(fullH * 0.44), textMaxW, 'center');
    } else if (ly.slot === 'bottom') {
      ctx.fillStyle = ly.color || '#94a3b8';
      ctx.font = `bold ${Math.round(9 * scale)}px "Segoe UI", "Microsoft YaHei", sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      drawClampedLine(ctx, d.text || d.big, centerX, fullH - Math.round(9 * scale), textMaxW, 'center');
    }
  }
}

function resolvePluginData(spec) {
  const rawId = String((spec && spec.pluginId) || 'uptime_greeting').trim();
  const normId = rawId.replace(/-/g, '_');
  const plugins = (lastTelemetry && lastTelemetry.plugins) || BUILTIN_MARKET_PLUGINS;
  let found = null;
  if (Array.isArray(plugins)) {
    found = plugins.find(p => p && (p.id === rawId || p.id === normId || (p.id && p.id.replace(/-/g, '_') === normId)));
  }
  if (!found && plugins && typeof plugins === 'object') {
    found = plugins[rawId] || plugins[normId];
  }
  if (!found) {
    found = BUILTIN_MARKET_PLUGINS.find(p => p.id === normId || p.id === rawId) || BUILTIN_MARKET_PLUGINS[0];
  }
  return found;
}

function drawSparklineChart(ctx, data, x, y, w, h, strokeColor, fillTopColor) {
  if (!Array.isArray(data) || data.length < 2) return;
  const vals = data.map(v => Number(v) || 0);
  let min = Math.min(...vals);
  let max = Math.max(...vals);
  if (max - min < 1e-3) { min -= 1; max += 1; }
  const pad = (max - min) * 0.12;
  min -= pad;
  max += pad;

  const pts = vals.map((v, i) => ({
    px: x + (i / (vals.length - 1)) * w,
    py: y + h - ((v - min) / (max - min)) * h,
  }));

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(pts[0].px, y + h);
  for (const p of pts) ctx.lineTo(p.px, p.py);
  ctx.lineTo(pts[pts.length - 1].px, y + h);
  ctx.closePath();
  const grad = ctx.createLinearGradient(0, y, 0, y + h);
  grad.addColorStop(0, fillTopColor || 'rgba(56, 189, 248, 0.38)');
  grad.addColorStop(1, 'rgba(15, 23, 42, 0.0)');
  ctx.fillStyle = grad;
  ctx.fill();

  ctx.beginPath();
  pts.forEach((p, idx) => {
    if (idx === 0) ctx.moveTo(p.px, p.py);
    else ctx.lineTo(p.px, p.py);
  });
  ctx.strokeStyle = strokeColor || '#38bdf8';
  ctx.lineWidth = 1.8;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.stroke();

  const last = pts[pts.length - 1];
  ctx.fillStyle = strokeColor || '#38bdf8';
  ctx.beginPath();
  ctx.arc(last.px, last.py, 2.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawBarsChart(ctx, bars, x, y, w, h, scale = 1) {
  if (!Array.isArray(bars) || !bars.length) return;
  const count = Math.min(5, bars.length);
  const gap = Math.max(4, Math.round(5 * scale));
  const barW = Math.max(6, Math.floor((w - gap * (count - 1)) / count));
  const labelH = Math.round(10 * scale);
  const trackH = Math.max(8, h - labelH - 2);

  ctx.save();
  for (let i = 0; i < count; i++) {
    const b = bars[i];
    const bx = x + i * (barW + gap);
    const pct = Math.max(0, Math.min(100, Number(b.value) || 0));
    const fillH = Math.max(2, Math.round((trackH * pct) / 100));

    ctx.fillStyle = 'rgba(255, 255, 255, 0.12)';
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(bx, y, barW, trackH, 3);
    else ctx.rect(bx, y, barW, trackH);
    ctx.fill();

    ctx.fillStyle = b.color || '#38bdf8';
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(bx, y + trackH - fillH, barW, fillH, 3);
    else ctx.rect(bx, y + trackH - fillH, barW, fillH);
    ctx.fill();

    ctx.fillStyle = '#94a3b8';
    ctx.font = `bold ${Math.max(7, Math.round(7.5 * scale))}px "Segoe UI", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillText(String(b.label || '').slice(0, 4), bx + barW / 2, y + h);
  }
  ctx.restore();
}

function drawPillBadge(ctx, text, bg, rightX, topY, scale = 1) {
  if (!text) return;
  ctx.save();
  const h = Math.max(12, Math.round(13 * scale));
  ctx.font = `bold ${Math.max(8, Math.round(8.5 * scale))}px "Segoe UI", "Microsoft YaHei", sans-serif`;
  const tw = ctx.measureText(text).width;
  const w = Math.max(h + 4, Math.round(tw + 8 * scale));
  const x = rightX - w;
  ctx.fillStyle = bg || '#0284c7';
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x, topY, w, h, h / 2);
  else ctx.rect(x, topY, w, h);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x + w / 2, topY + h / 2 + 0.5);
  ctx.restore();
}

function drawClampedLine(ctx, text, cx, y, maxW, align = 'center') {
  const s = String(text || '').trim();
  if (!s) return;
  ctx.save();
  ctx.textAlign = align;
  if (ctx.measureText(s).width <= maxW) {
    ctx.fillText(s, cx, y);
    ctx.restore();
    return;
  }
  let clipped = s;
  while (clipped.length > 1 && ctx.measureText(clipped + '…').width > maxW) {
    clipped = clipped.slice(0, -1);
  }
  ctx.fillText(clipped + '…', cx, y);
  ctx.restore();
}

function paintWideWidgetMasterCanvas(spec, size, spanCols, keyPos) {
  const fullW = size * spanCols;
  const fullH = size;
  const master = document.createElement('canvas');
  master.width = fullW;
  master.height = fullH;
  const ctx = master.getContext('2d');
  const kind = (spec && (spec.widgetKind || (WIDGET_KINDS.includes(spec.type) ? spec.type : ''))) || 'gpu';
  const scale = size / 80;

  const drawWideBg = (topCol, botCol, borderCol) => {
    const g = ctx.createLinearGradient(0, 0, fullW, fullH);
    g.addColorStop(0, (spec && spec.customColor && spec.color) ? spec.color : topCol);
    g.addColorStop(1, botCol);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, fullW, fullH);

    // Subtle key boundary ticks so each physical key slice aligns harmoniously
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.lineWidth = 1;
    for (let k = 1; k < spanCols; k++) {
      ctx.beginPath();
      ctx.moveTo(k * size, 8);
      ctx.lineTo(k * size, fullH - 8);
      ctx.stroke();
    }
    ctx.strokeStyle = borderCol || 'rgba(56, 189, 248, 0.35)';
    ctx.strokeRect(0.5, 0.5, fullW - 1, fullH - 1);
  };

  if (kind === 'media_now') {
    const m = (lastTelemetry && (lastTelemetry.media_now || lastTelemetry.media)) || {
      playing: true, app: '网易云音乐', track: '晴天', title: '晴天', artist: '周杰伦',
      lyric: '故事的小黄花 从出生那年就飘着', subLyric: '童年的荡秋千 随记忆一直晃到现在',
      progressPct: 26, timeText: '00:42 / 04:29', coverColor: '#7c3aed'
    };
    drawWideBg('#2e1065', '#0f172a', 'rgba(232, 121, 249, 0.38)');

    // Key 1 (0..size): Vinyl Record Disc & Time strictly centered within Key 1
    const discCx = Math.round(size * 0.50);
    const discCy = Math.round(size * 0.41);
    const discR = Math.round(size * 0.28);
    ctx.save();
    ctx.fillStyle = '#090d16';
    ctx.beginPath();
    ctx.arc(discCx, discCy, discR, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.22)';
    ctx.lineWidth = 1.4;
    ctx.stroke();

    ctx.fillStyle = m.coverColor || '#ec4899';
    ctx.beginPath();
    ctx.arc(discCx, discCy, Math.round(discR * 0.48), 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#ffffff';
    ctx.font = `bold ${Math.round(10 * scale)}px "Segoe UI", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(m.playing === false ? '⏸' : '▶', discCx, discCy + 0.5);

    ctx.fillStyle = '#cbd5e1';
    ctx.font = `${Math.round(8.5 * scale)}px Consolas, "Segoe UI", sans-serif`;
    ctx.textBaseline = 'bottom';
    ctx.fillText(m.timeText || '00:42 / 04:29', discCx, fullH - Math.round(6 * scale));
    ctx.restore();

    // Key 2..N (size..fullW): Title, Artist, Dual-Line Synchronized Desktop Lyrics & Progress Bar strictly inside Key 2+
    const rx = size + Math.round(7 * scale);
    const rw = fullW - rx - Math.round(7 * scale);

    ctx.fillStyle = '#f0abfc';
    ctx.font = `bold ${Math.round(9.5 * scale)}px "Microsoft YaHei", sans-serif`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    const trackTitle = m.track || m.title || '晴天';
    const artistStr = m.artist ? ` · ${m.artist}` : '';
    drawClampedLine(ctx, `🎵 ${m.app || 'SMTC'}  |  ${trackTitle}${artistStr}`, rx, Math.round(8 * scale), rw, 'left');

    // Line 1: Active Lyric (Highlighted)
    ctx.fillStyle = '#ffffff';
    ctx.font = `bold ${Math.round(12 * scale)}px "Microsoft YaHei", sans-serif`;
    ctx.textBaseline = 'middle';
    drawClampedLine(ctx, m.lyric || '故事的小黄花 从出生那年就飘着', rx, Math.round(37 * scale), rw, 'left');

    // Line 2: Upcoming Sub-Lyric
    ctx.fillStyle = '#c4b5fd';
    ctx.font = `${Math.round(10 * scale)}px "Microsoft YaHei", sans-serif`;
    drawClampedLine(ctx, m.subLyric || '童年的荡秋千 随记忆一直晃到现在', rx, Math.round(56 * scale), rw, 'left');

    // Progress Bar
    const py = fullH - Math.round(12 * scale);
    const ph = Math.max(4, Math.round(4.5 * scale));
    ctx.fillStyle = 'rgba(255,255,255,0.16)';
    ctx.fillRect(rx, py, rw, ph);
    const pct = Math.max(6, Math.min(100, Number(m.progressPct) || 26));
    const gradBar = ctx.createLinearGradient(rx, 0, rx + rw, 0);
    gradBar.addColorStop(0, '#e879f9');
    gradBar.addColorStop(1, '#38bdf8');
    ctx.fillStyle = gradBar;
    ctx.fillRect(rx, py, Math.round((rw * pct) / 100), ph);
    return master;
  }

  if (kind === 'composite' || (Array.isArray(spec.widgetLayers) && spec.widgetLayers.length > 0)) {
    drawWideBg('#0f172a', '#070b12', 'rgba(56, 189, 248, 0.35)');
    paintCompositeWidgetCanvas(ctx, spec, size, fullW, fullH, scale);
    return master;
  }
  if (kind === 'gpu' || kind === 'net') {
    const isGpu = kind === 'gpu';
    const gpu = (lastTelemetry && lastTelemetry.gpu) || { temp: 48, load: 22, memPct: 30, history: [24, 28, 32, 30, 35, 28, 24] };
    const net = (lastTelemetry && lastTelemetry.net) || { rxText: '180 KB/s', txText: '40 KB/s', history: [120, 160, 140, 210, 180] };
    drawWideBg(isGpu ? '#0f291e' : '#0c1e35', '#07111d', isGpu ? 'rgba(74, 222, 128, 0.35)' : 'rgba(56, 189, 248, 0.35)');

    // Left panel metrics strictly inside Key 1 (0..size)
    const padX = Math.round(7 * scale);
    const key1MaxW = size - Math.round(14 * scale);
    ctx.fillStyle = isGpu ? '#4ade80' : '#38bdf8';
    ctx.font = `bold ${Math.round(9.5 * scale)}px "Microsoft YaHei", sans-serif`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    drawClampedLine(ctx, isGpu ? '🎮 GPU 遥测' : '🌐 实时网速', padX, Math.round(7 * scale), key1MaxW, 'left');

    ctx.fillStyle = '#ffffff';
    ctx.font = `bold ${Math.round((isGpu ? 19 : 13) * scale)}px "Segoe UI", Consolas, sans-serif`;
    ctx.textBaseline = 'middle';
    drawClampedLine(ctx, isGpu ? `${gpu.temp || 46}°C` : `↓ ${net.rxText || net.downText || '180 KB/s'}`, padX, Math.round(36 * scale), key1MaxW, 'left');

    ctx.fillStyle = '#94a3b8';
    ctx.font = `bold ${Math.round(8.5 * scale)}px "Segoe UI", sans-serif`;
    ctx.textBaseline = 'bottom';
    drawClampedLine(
      ctx,
      isGpu ? `C:${gpu.load || 22}% V:${gpu.memPct || 30}%` : `↑ ${net.txText || net.upText || '40 KB/s'}`,
      padX,
      fullH - Math.round(8 * scale),
      key1MaxW,
      'left'
    );

    // Right wide sparkline waveform inside Key 2..N
    const chartX = size + Math.round(7 * scale);
    const chartW = fullW - chartX - Math.round(8 * scale);
    const chartY = Math.round(16 * scale);
    const chartH = fullH - chartY - Math.round(12 * scale);
    drawSparklineChart(
      ctx,
      isGpu ? (gpu.history || [24, 28, 26, 32, 30, 35, 28]) : (net.history || [120, 180, 150, 210, 180]),
      chartX,
      chartY,
      chartW,
      chartH,
      isGpu ? '#34d399' : '#38bdf8',
      isGpu ? 'rgba(52, 211, 153, 0.35)' : 'rgba(56, 189, 248, 0.35)'
    );
    return master;
  }

  if (kind === 'plugin') {
    const plg = resolvePluginData(spec);
    drawWideBg(plg.color || '#0f172a', '#090d16', 'rgba(56, 189, 248, 0.35)');
    const padX = Math.round(7 * scale);
    const key1MaxW = size - Math.round(14 * scale);

    ctx.fillStyle = plg.accent || '#38bdf8';
    ctx.font = `bold ${Math.round(9.5 * scale)}px "Microsoft YaHei", sans-serif`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    drawClampedLine(ctx, plg.title || '🧩 插件看板', padX, Math.round(8 * scale), key1MaxW, 'left');

    if (plg.badge && plg.badge.text) {
      drawPillBadge(ctx, plg.badge.text, plg.badge.bg, fullW - Math.round(7 * scale), Math.round(7 * scale), scale);
    }

    ctx.fillStyle = '#ffffff';
    ctx.font = `bold ${Math.round(16 * scale)}px "Segoe UI", "Microsoft YaHei", sans-serif`;
    ctx.textBaseline = 'middle';
    drawClampedLine(ctx, plg.value || 'READY', padX, Math.round(39 * scale), key1MaxW, 'left');

    ctx.fillStyle = '#94a3b8';
    ctx.font = `${Math.round(8.5 * scale)}px "Microsoft YaHei", sans-serif`;
    ctx.textBaseline = 'bottom';
    drawClampedLine(ctx, plg.sub || plg.subValue || '', padX, fullH - Math.round(8 * scale), key1MaxW, 'left');

    const chartX = size + Math.round(7 * scale);
    const chartW = fullW - chartX - Math.round(8 * scale);
    const chartY = Math.round(22 * scale);
    const chartH = fullH - chartY - Math.round(10 * scale);
    if (Array.isArray(plg.bars) && plg.bars.length) {
      drawBarsChart(ctx, plg.bars, chartX, chartY, chartW, chartH, scale);
    } else if (Array.isArray(plg.sparkline) && plg.sparkline.length > 1) {
      drawSparklineChart(ctx, plg.sparkline, chartX, chartY, chartW, chartH, plg.accent || '#38bdf8', 'rgba(56, 189, 248, 0.32)');
    }
    return master;
  }

  // Fallback wide layout for pomodoro / weather / obs
  const single = paintWidgetCanvas(Object.assign({}, spec, { spanCols: 1 }), size, { row: keyPos.row, col: keyPos.masterCol || 0 });
  for (let k = 0; k < spanCols; k++) {
    ctx.drawImage(single, k * size, 0);
  }
  return master;
}

function paintWidgetCanvas(spec, size, keyPos) {
  const spanCols = Math.max(1, Number((keyPos && keyPos.spanCols) || (spec && spec.spanCols) || 1));
  const spanOffset = Math.max(0, Number(keyPos && keyPos.spanOffset) || 0);
  if (spanCols > 1 && (!keyPos || keyPos.col < KEY_COLS)) {
    const master = paintWideWidgetMasterCanvas(spec, size, spanCols, keyPos || { row: 0, col: 0 });
    const slice = document.createElement('canvas');
    slice.width = slice.height = size;
    const sctx = slice.getContext('2d');
    sctx.drawImage(master, spanOffset * size, 0, size, size, 0, 0, size, size);
    return slice;
  }

  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const row = (keyPos && keyPos.row !== undefined) ? keyPos.row : 0;
  const col = (keyPos && keyPos.col !== undefined) ? keyPos.col : 5;
  const kind = (spec && (spec.widgetKind || (WIDGET_KINDS.includes(spec.type) ? spec.type : ''))) || 'gpu';

  const page = curPage();
  const grad = page && page.gradient;
  const drawBg = (topCol, botCol) => {
    if (grad && grad.enabled && (!spec || !spec.customColor)) {
      const master = getGlobalGradientCanvas(grad);
      if (master) {
        ctx.drawImage(master, col * 96, row * 96, 96, 96, 0, 0, size, size);
        return;
      }
    }
    if (spec && spec.color && spec.customColor) {
      ctx.fillStyle = spec.color;
      ctx.fillRect(0, 0, size, size);
      return;
    }
    const g = ctx.createLinearGradient(0, 0, 0, size);
    g.addColorStop(0, (spec && spec.color) || topCol);
    g.addColorStop(1, botCol);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  };

  const fontBoost = (spec && spec.fontSize) ? Math.max(0.8, Math.min(1.3, Number(spec.fontSize) / 20)) : 1;
  const scale = (size / 80) * fontBoost;
  const geomScale = size / 80;
  ctx.save();

  if (kind === 'composite' || (Array.isArray(spec.widgetLayers) && spec.widgetLayers.length > 0)) {
    drawBg('#0f172a', '#070b12');
    paintCompositeWidgetCanvas(ctx, spec, size, size, size, geomScale);
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.30)';
    ctx.strokeRect(0.5, 0.5, size - 1, size - 1);
  } else if (kind === 'gpu') {
    drawBg('#0f291e', '#07140e');
    const gpu = (lastTelemetry && lastTelemetry.gpu) || { temp: 46, load: 22, memPct: 30, history: [22, 26, 24, 30, 28, 25] };
    if (Array.isArray(gpu.history) && gpu.history.length > 1) {
      drawSparklineChart(ctx, gpu.history, 4, Math.round(size * 0.52), size - 8, Math.round(size * 0.42), 'rgba(52, 211, 153, 0.45)', 'rgba(52, 211, 153, 0.16)');
    }
    ctx.fillStyle = '#4ade80';
    ctx.font = `bold ${Math.round(9.5 * scale)}px "Microsoft YaHei", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText('🎮 GPU 监控', size / 2, Math.round(5 * geomScale));

    ctx.fillStyle = '#ffffff';
    ctx.font = `bold ${Math.round(19 * scale)}px "Segoe UI", sans-serif`;
    ctx.textBaseline = 'middle';
    ctx.fillText(`${gpu.temp || 46}°C`, size / 2, Math.round(30 * geomScale));

    const drawMini = (lbl, pct, y, colHex) => {
      ctx.fillStyle = '#cbd5e1';
      ctx.font = `bold ${Math.round(9 * geomScale)}px "Segoe UI", sans-serif`;
      ctx.textAlign = 'left';
      ctx.fillText(lbl, Math.round(7 * geomScale), y);
      ctx.fillStyle = colHex;
      ctx.textAlign = 'right';
      ctx.fillText(`${pct}%`, size - Math.round(7 * geomScale), y);
      const bx = Math.round(7 * geomScale), by = y + Math.round(6.5 * geomScale), bw = size - Math.round(14 * geomScale), bh = Math.max(3, Math.round(4 * geomScale));
      ctx.fillStyle = 'rgba(255,255,255,0.14)';
      ctx.fillRect(bx, by, bw, bh);
      ctx.fillStyle = colHex;
      ctx.fillRect(bx, by, Math.max(2, Math.round((bw * Math.min(100, Math.max(0, pct))) / 100)), bh);
    };
    drawMini('CORE', gpu.load !== undefined ? gpu.load : 22, Math.round(47 * geomScale), '#34d399');
    drawMini('VRAM', gpu.memPct !== undefined ? gpu.memPct : 30, Math.round(62 * geomScale), '#38bdf8');
    ctx.strokeStyle = 'rgba(74, 222, 128, 0.28)';
    ctx.strokeRect(0.5, 0.5, size - 1, size - 1);
  } else if (kind === 'net') {
    drawBg('#0c1e35', '#07111f');
    const net = (lastTelemetry && lastTelemetry.net) || { rxText: '180 KB/s', txText: '40 KB/s', rxKbps: 180 };
    const downStr = net.rxText || net.downText || '0.0 KB/s';
    const upStr = net.txText || net.upText || '0.0 KB/s';

    if (Array.isArray(net.history) && net.history.length > 1) {
      drawSparklineChart(ctx, net.history, 5, Math.round(size * 0.62), size - 10, Math.round(size * 0.30), '#38bdf8', 'rgba(56, 189, 248, 0.25)');
    }

    ctx.fillStyle = '#38bdf8';
    ctx.font = `bold ${Math.round(9.5 * scale)}px "Microsoft YaHei", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText('🌐 实时网速', size / 2, Math.round(5 * geomScale));

    ctx.textAlign = 'left';
    ctx.fillStyle = '#34d399';
    ctx.font = `bold ${Math.round(11.5 * scale)}px Consolas, "Segoe UI", sans-serif`;
    drawClampedLine(ctx, `↓ ${downStr}`, Math.round(7 * geomScale), Math.round(26 * geomScale), size - Math.round(14 * geomScale), 'left');

    ctx.fillStyle = '#c084fc';
    ctx.font = `bold ${Math.round(11.5 * scale)}px Consolas, "Segoe UI", sans-serif`;
    drawClampedLine(ctx, `↑ ${upStr}`, Math.round(7 * geomScale), Math.round(44 * geomScale), size - Math.round(14 * geomScale), 'left');

    const rxBytes = net.rxSec !== undefined ? net.rxSec : ((Number(net.rxKbps) || 100) * 1024);
    const rxPct = Math.min(100, Math.round(Math.log10(Math.max(10, rxBytes)) * 15));
    const bx = Math.round(8 * geomScale), by = size - Math.round(10 * geomScale), bw = size - Math.round(16 * geomScale), bh = Math.max(3, Math.round(4 * geomScale));
    ctx.fillStyle = 'rgba(255,255,255,0.14)';
    ctx.fillRect(bx, by, bw, bh);
    ctx.fillStyle = '#38bdf8';
    ctx.fillRect(bx, by, Math.max(4, Math.round((bw * rxPct) / 100)), bh);
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.28)';
    ctx.strokeRect(0.5, 0.5, size - 1, size - 1);
  } else if (kind === 'weather') {
    drawBg('#102a43', '#091826');
    const w = (lastTelemetry && lastTelemetry.weather) || { icon: '⛅', temp: '24°C', condition: '晴间多云', city: '本地', humidity: '55%' };
    const tempFormatted = String(w.temp !== undefined ? w.temp : '24°C').replace(/°C$/i, '') + '°C';
    const humFormatted = String(w.humidity !== undefined ? w.humidity : '55%').replace(/%$/, '') + '%';
    const condStr = String(w.condition || w.desc || '晴').slice(0, 5);

    ctx.fillStyle = '#7dd3fc';
    ctx.font = `bold ${Math.round(9.5 * scale)}px "Microsoft YaHei", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(`${w.icon || '🌤️'} ${String(w.city || '本地').slice(0, 5)}`, size / 2, Math.round(6 * geomScale));

    ctx.fillStyle = '#ffffff';
    ctx.font = `bold ${Math.round(21 * scale)}px "Segoe UI", sans-serif`;
    ctx.textBaseline = 'middle';
    ctx.fillText(tempFormatted, size / 2, Math.round(39 * geomScale));

    ctx.fillStyle = '#bae6fd';
    ctx.font = `${Math.round(9.5 * geomScale)}px "Microsoft YaHei", sans-serif`;
    ctx.textBaseline = 'bottom';
    drawClampedLine(ctx, `${condStr} · 湿${humFormatted}`, size / 2, size - Math.round(7 * geomScale), size - 10, 'center');
    ctx.strokeStyle = 'rgba(125, 211, 252, 0.28)';
    ctx.strokeRect(0.5, 0.5, size - 1, size - 1);
  } else if (kind === 'pomodoro') {
    const p = (lastTelemetry && lastTelemetry.pomodoro) || { running: false, formatted: '25:00', progressPct: 0, phase: 'work' };
    drawBg(p.running ? '#7f1d1d' : '#27272a', p.running ? '#450a0a' : '#18181b');
    ctx.fillStyle = p.running ? '#fca5a5' : '#fbbf24';
    ctx.font = `bold ${Math.round(9.5 * scale)}px "Microsoft YaHei", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(p.running ? (p.phase === 'break' ? '☕ 休息中' : '🍅 专注中') : '🍅 番茄钟', size / 2, Math.round(7 * geomScale));

    ctx.fillStyle = '#ffffff';
    ctx.font = `bold ${Math.round(20 * scale)}px Consolas, "Segoe UI", sans-serif`;
    ctx.textBaseline = 'middle';
    ctx.fillText(p.formatted || '25:00', size / 2, Math.round(41 * geomScale));

    const bx = Math.round(9 * geomScale), by = size - Math.round(14 * geomScale), bw = size - Math.round(18 * geomScale), bh = Math.max(4, Math.round(5.5 * geomScale));
    ctx.fillStyle = 'rgba(255,255,255,0.16)';
    ctx.fillRect(bx, by, bw, bh);
    ctx.fillStyle = p.running ? '#f87171' : '#fbbf24';
    const pct = p.running ? Math.max(8, p.progressPct || 0) : (p.progressPct || 0);
    if (pct > 0) ctx.fillRect(bx, by, Math.round((bw * pct) / 100), bh);
    ctx.strokeStyle = p.running ? 'rgba(248, 113, 113, 0.45)' : 'rgba(251, 191, 36, 0.25)';
    ctx.strokeRect(0.5, 0.5, size - 1, size - 1);
  } else if (kind === 'obs') {
    const obs = (lastTelemetry && lastTelemetry.obs) || { running: false, streaming: false, recording: false, statusText: 'OBS 待命' };
    drawBg(obs.streaming || obs.recording ? '#4c0519' : '#1e293b', '#0f172a');
    ctx.fillStyle = obs.streaming ? '#fb7185' : '#94a3b8';
    ctx.font = `bold ${Math.round(9.5 * scale)}px "Microsoft YaHei", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText('🔴 OBS 监控', size / 2, Math.round(7 * geomScale));

    ctx.fillStyle = obs.streaming ? '#ff4d6d' : (obs.running ? '#34d399' : '#cbd5e1');
    ctx.font = `bold ${Math.round(13.5 * scale)}px "Microsoft YaHei", sans-serif`;
    ctx.textBaseline = 'middle';
    ctx.fillText(obs.streaming ? 'LIVE 推流' : (obs.running ? '已就绪' : '未运行'), size / 2, Math.round(40 * geomScale));

    ctx.fillStyle = '#94a3b8';
    ctx.font = `${Math.round(9.5 * geomScale)}px "Microsoft YaHei", sans-serif`;
    ctx.textBaseline = 'bottom';
    drawClampedLine(ctx, obs.statusText || '待命', size / 2, size - Math.round(8 * geomScale), size - 10, 'center');
    ctx.strokeStyle = 'rgba(251, 113, 133, 0.28)';
    ctx.strokeRect(0.5, 0.5, size - 1, size - 1);
  } else if (kind === 'media_now') {
    drawBg('#2e1065', '#0f172a');
    const m = (lastTelemetry && (lastTelemetry.media_now || lastTelemetry.media)) || {
      playing: true, app: '网易云音乐', track: '晴天', title: '晴天', artist: '周杰伦',
      lyric: '故事的小黄花 从出生那年就飘着', progressPct: 26
    };
    ctx.fillStyle = '#f0abfc';
    ctx.font = `bold ${Math.round(9 * geomScale)}px "Microsoft YaHei", sans-serif`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    drawClampedLine(ctx, `🎵 ${m.app || '音乐'}`, Math.round(6 * geomScale), Math.round(6 * geomScale), size - Math.round(24 * geomScale), 'left');

    ctx.fillStyle = m.playing === false ? '#94a3b8' : '#34d399';
    ctx.textAlign = 'right';
    ctx.fillText(m.playing === false ? '⏸' : '▶', size - Math.round(6 * geomScale), Math.round(6 * geomScale));

    const songLine = (m.track || m.title || '晴天') + (m.artist && !(m.title || '').includes(m.artist) ? ` - ${m.artist}` : '');
    ctx.fillStyle = '#ffffff';
    ctx.font = `bold ${Math.round(11 * scale)}px "Microsoft YaHei", sans-serif`;
    ctx.textBaseline = 'middle';
    drawClampedLine(ctx, songLine, size / 2, Math.round(33 * geomScale), size - Math.round(12 * geomScale), 'center');

    // Synchronized desktop lyric line (high contrast + clean fitting, never cuts half character)
    ctx.fillStyle = '#38bdf8';
    ctx.font = `bold ${Math.round(9.5 * geomScale)}px "Microsoft YaHei", sans-serif`;
    drawClampedLine(ctx, m.lyric || m.subLyric || '故事的小黄花', size / 2, Math.round(53 * geomScale), size - Math.round(10 * geomScale), 'center');

    // Bottom progress bar
    const bx = Math.round(7 * geomScale), by = size - Math.round(10 * geomScale), bw = size - Math.round(14 * geomScale), bh = Math.max(3, Math.round(3.8 * geomScale));
    ctx.fillStyle = 'rgba(255,255,255,0.16)';
    ctx.fillRect(bx, by, bw, bh);
    const pct = Math.max(8, Math.min(100, Number(m.progressPct) || 26));
    ctx.fillStyle = '#e879f9';
    ctx.fillRect(bx, by, Math.round((bw * pct) / 100), bh);

    ctx.strokeStyle = 'rgba(232, 121, 249, 0.35)';
    ctx.strokeRect(0.5, 0.5, size - 1, size - 1);
  } else {
    // External JS plugin card (supports sparkline, bars, progress, badge)
    const plg = resolvePluginData(spec);
    drawBg(plg.color || '#0f172a', '#090d16');
    const accent = plg.accent || '#38bdf8';

    if (Array.isArray(plg.sparkline) && plg.sparkline.length > 1 && !plg.bars) {
      drawSparklineChart(ctx, plg.sparkline, 4, Math.round(size * 0.55), size - 8, Math.round(size * 0.38), accent, 'rgba(56, 189, 248, 0.18)');
    }

    ctx.fillStyle = accent;
    ctx.font = `bold ${Math.round(9 * geomScale)}px "Microsoft YaHei", sans-serif`;
    ctx.textAlign = (plg.badge && plg.badge.text) ? 'left' : 'center';
    ctx.textBaseline = 'top';
    const titleX = (plg.badge && plg.badge.text) ? Math.round(6 * geomScale) : size / 2;
    const titleMaxW = (plg.badge && plg.badge.text) ? size - Math.round(34 * geomScale) : size - Math.round(12 * geomScale);
    drawClampedLine(ctx, plg.title || '🧩 插件', titleX, Math.round(6 * geomScale), titleMaxW, ctx.textAlign);

    if (plg.badge && plg.badge.text) {
      drawPillBadge(ctx, plg.badge.text, plg.badge.bg, size - Math.round(5 * geomScale), Math.round(5 * geomScale), geomScale * 0.9);
    }

    if (Array.isArray(plg.bars) && plg.bars.length) {
      drawBarsChart(ctx, plg.bars, Math.round(7 * geomScale), Math.round(23 * geomScale), size - Math.round(14 * geomScale), size - Math.round(29 * geomScale), geomScale * 0.9);
    } else {
      ctx.fillStyle = '#ffffff';
      ctx.font = `bold ${Math.round(15.5 * scale)}px "Segoe UI", "Microsoft YaHei", sans-serif`;
      ctx.textBaseline = 'middle';
      drawClampedLine(ctx, plg.value || 'OK', size / 2, Math.round(36 * geomScale), size - Math.round(10 * geomScale), 'center');

      ctx.fillStyle = '#cbd5e1';
      ctx.font = `${Math.round(9 * geomScale)}px "Microsoft YaHei", sans-serif`;
      ctx.textBaseline = 'bottom';
      const subY = (plg.progress !== undefined) ? size - Math.round(13 * geomScale) : size - Math.round(6 * geomScale);
      drawClampedLine(ctx, plg.sub || plg.subValue || '', size / 2, subY, size - Math.round(10 * geomScale), 'center');

      if (plg.progress !== undefined) {
        const bx = Math.round(7 * geomScale), by = size - Math.round(9 * geomScale), bw = size - Math.round(14 * geomScale), bh = Math.max(3, Math.round(3.5 * geomScale));
        ctx.fillStyle = 'rgba(255,255,255,0.14)';
        ctx.fillRect(bx, by, bw, bh);
        ctx.fillStyle = accent;
        ctx.fillRect(bx, by, Math.round((bw * Math.max(0, Math.min(100, Number(plg.progress) || 0))) / 100), bh);
      }
    }

    ctx.strokeStyle = 'rgba(56, 189, 248, 0.28)';
    ctx.strokeRect(0.5, 0.5, size - 1, size - 1);
  }

  ctx.restore();
  return c;
}

async function buildStripCanvas(row, preStats = null) {
  const spec = effectiveStrips()[String(row)] || { type: 'text', label: '', color: '#263238' };
  if (spec && spec.type === 'telemetry' && spec.telemetryType) {
    return paintWidgetCanvas(Object.assign({}, spec, { widgetKind: spec.telemetryType }), 80, { row, col: 5 });
  }
  if (spec && spec.type === 'disk') {
    const stats = preStats || lastSysStats || { cpu: 24, mem: 48 };
    return paintMetricStrip(spec, 80, row, 'mem', stats);
  }
  const size = 80;
  let s = Object.assign({}, spec);

  if (s.type === 'volume') {
    let vol = lastAudioState ? lastAudioState.volume : 50;
    let isMute = lastAudioState ? lastAudioState.isMute : false;
    if (preStats && preStats.volume !== undefined) {
      vol = preStats.volume;
      isMute = !!preStats.isMute;
    }
    return paintVolumeStrip(s, size, row, vol, isMute);
  }
  if (s.type === 'clock') {
    return paintClockStrip(s, size, row);
  }
  if (s.type === 'cpu' || s.type === 'mem' || s.type === 'sys') {
    const stats = preStats || lastSysStats || { cpu: 24, mem: 48, memUsedGb: '7.6' };
    return paintMetricStrip(s, size, row, s.type, stats);
  }
  if (WIDGET_KINDS.includes(s.type) || s.type === 'widget') {
    return paintWidgetCanvas(Object.assign({}, s, { widgetKind: s.widgetKind || s.type }), size, { row, col: 5 });
  }
  if (s.type === 'page') {
    s = Object.assign({}, s, { label: pageStripLabel() });
  }
  return paintKey(s, size, { row, col: 5 });
}

async function pushStrip(row, force = false, preStats = null) {
  if (!cfg || DEMO) return;
  const c = await buildStripCanvas(row, preStats);
  const rotMode = $('rotate') ? $('rotate').value : (cfg.rotate || 'ccw');
  const b64 = await encodeCanvasToJpegB64(c, rotMode);
  await api.deviceDraw({ row, col: 5, data: b64, force: !!force });
}

async function repaintAllKeys(force = false, gen = null) {
  if (!cfg || DEMO) return;
  const myGen = gen !== null ? gen : ++repaintGen;
  const rotMode = $('rotate') ? $('rotate').value : (cfg.rotate || 'ccw');
  const blank = { color: '#20262e', label: '' };
  const jobs = [];
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < KEY_COLS; col++) {
      const spec = isBackCell(row, col) ? backSpec() : pageButtons()[row + ',' + col];
      jobs.push(
        paintKey(spec || blank, 96, { row, col }).then(async (c) => {
          const b64 = await encodeCanvasToJpegB64(c, rotMode);
          return { row, col, data: b64, force: !!force };
        })
      );
    }
  }
  const items = await Promise.all(jobs);
  if (myGen !== repaintGen) return;
  if (api.deviceBatchDraw) {
    await api.deviceBatchDraw(items);
  } else {
    for (const item of items) {
      if (myGen !== repaintGen) return;
      await api.deviceDraw(item);
    }
  }
}

async function repaintAll(force = false) {
  if (!cfg || DEMO) return;
  const myGen = ++repaintGen;
  const rotMode = $('rotate') ? $('rotate').value : (cfg.rotate || 'ccw');
  const blank = { color: '#20262e', label: '' };

  let sharedStats = lastSysStats;
  const strips = pageStrips();
  const needsStats = [0, 1, 2].some((r) => {
    const st = strips[String(r)];
    return st && ['cpu', 'mem', 'sys', 'volume'].includes(st.type);
  });
  if (needsStats && api.systemStats) {
    try {
      const st = await api.systemStats();
      if (st) {
        sharedStats = st;
        lastSysStats = Object.assign({}, lastSysStats, st);
      }
    } catch (_) {}
  }

  const jobs = [];
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < KEY_COLS; col++) {
      const spec = isBackCell(row, col) ? backSpec() : pageButtons()[row + ',' + col];
      jobs.push(
        paintKey(spec || blank, 96, { row, col }).then(async (c) => {
          const b64 = await encodeCanvasToJpegB64(c, rotMode);
          return { row, col, data: b64, force: !!force };
        })
      );
    }
  }
  for (let row = 0; row < ROWS; row++) {
    jobs.push(
      buildStripCanvas(row, sharedStats).then(async (c) => {
        const b64 = await encodeCanvasToJpegB64(c, rotMode);
        return { row, col: 5, data: b64, force: !!force };
      })
    );
  }
  const items = await Promise.all(jobs);
  if (myGen !== repaintGen) return;
  if (api.deviceBatchDraw) {
    await api.deviceBatchDraw(items);
  } else {
    for (const item of items) {
      if (myGen !== repaintGen) return;
      await api.deviceDraw(item);
    }
  }
}

/** Pressing an unconfigured key: flash "未配置" on that key of the device. */
async function flashUnconfigured(row, col) {
  if (DEMO || col === 5) return;
  const size = 96;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#8e2323';
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 22px "Microsoft YaHei", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('未配置', size / 2, size / 2);
  const dataUrl = toJpegUnder(rotateCanvas(c, $('rotate').value), 10240);
  await api.deviceDraw({ row, col, data: dataUrl.split(',')[1] });
  setTimeout(() => pushKey(row, col), 1100);
}

/** 扫码结果瞬态硬件反馈：成功显示绿底 ✓ 已复制，失败显示红底 ✕ 未识别，并可向副屏推送文本 */
async function flashKeyResult(row, col, success, text) {
  if (DEMO || col === 5) return;
  const size = 96;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');

  // 底色与边框
  ctx.fillStyle = success ? '#1b5e20' : '#8e2323';
  ctx.fillRect(0, 0, size, size);
  ctx.strokeStyle = success ? '#00e676' : '#ff5252';
  ctx.lineWidth = 4;
  ctx.strokeRect(2, 2, size - 4, size - 4);

  // 大符号
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 36px "Segoe UI", "Microsoft YaHei", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(success ? '✓' : '✕', size / 2, size * 0.38);

  // 说明文字
  ctx.font = 'bold 15px "Microsoft YaHei", sans-serif';
  ctx.fillText(success ? '已复制' : '未识别', size / 2, size * 0.76);

  const dataUrl = toJpegUnder(rotateCanvas(c, $('rotate').value), 10240);
  await api.deviceDraw({ row, col, data: dataUrl.split(',')[1] });

  // 若成功且有文本，向副屏 3 (底部 strip 2) 临时展示
  if (success && text) {
    const stripSize = 80;
    const sc = document.createElement('canvas');
    sc.width = sc.height = stripSize;
    const sctx = sc.getContext('2d');
    sctx.fillStyle = '#004d40';
    sctx.fillRect(0, 0, stripSize, stripSize);
    sctx.strokeStyle = '#00e5ff';
    sctx.lineWidth = 2;
    sctx.strokeRect(1, 1, stripSize - 2, stripSize - 2);

    sctx.fillStyle = '#80deea';
    sctx.font = 'bold 12px "Microsoft YaHei", sans-serif';
    sctx.textAlign = 'center';
    sctx.fillText('扫码成功', stripSize / 2, 18);

    sctx.fillStyle = '#ffffff';
    sctx.font = '11px Consolas, monospace';
    const clean = text.replace(/https?:\/\//, '');
    sctx.fillText(clean.slice(0, 8), stripSize / 2, 36);
    if (clean.length > 8) sctx.fillText(clean.slice(8, 16), stripSize / 2, 52);
    if (clean.length > 16) sctx.fillText(clean.slice(16, 24), stripSize / 2, 68);

    const sData = toJpegUnder(rotateCanvas(sc, $('rotate').value), 10240);
    await api.deviceDraw({ row: 2, col: 5, data: sData.split(',')[1] });

    setTimeout(() => pushStrip(2), 3500);
  }

  setTimeout(() => pushKey(row, col), 1600);
}

async function repaintStrips() {
  for (let row = 0; row < ROWS; row++) await pushStrip(row);
}

// ----------------------------------------------------------------- grid build

let dragFrom = null;   // {row,col} of a cell being dragged, for reordering

function buildGrid() {
  const grid = $('grid');
  grid.innerHTML = '';
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < TOTAL_COLS; col++) {
      const cell = document.createElement('div');
      cell.className = 'cell' + (col === 5 ? ' display' : '');
      cell.dataset.row = row;
      cell.dataset.col = col;

      // 已彻底移除 360ms 长按副动作定时器，杜绝鼠标按住拖拽或停留时的误触

      cell.addEventListener('dblclick', async () => {
        if (col === 5 && activeRendererContextBar && activeRendererContextBar.strips) {
          const st = activeRendererContextBar.strips[String(row)];
          if (st && st.action && !DEMO && api.actionRun) {
            await api.actionRun(st.action, { row, col: 5 });
            toast(`✨ 已执行上下文副屏动作：${st.action.label || st.label || '快捷工具'}`);
          }
        }
      });

      cell.addEventListener('click', async (e) => {
        hideContextMenu();
        if (styleBrushSpec && col < 5 && !isBackCell(row, col)) {
          await applyStyleBrushToCell(row, col);
          return;
        }
        if ((e.ctrlKey || e.metaKey) && col < 5 && !isBackCell(row, col)) {
          const sm = findSpanMasterCell(pageButtons(), row, col);
          const effCol = sm ? sm.masterCol : col;
          const k = `${row},${effCol}`;
          if (selected && selected.col < 5 && !multiSelected.size) {
            multiSelected.add(`${selected.row},${selected.col}`);
          }
          if (multiSelected.has(k)) multiSelected.delete(k);
          else multiSelected.add(k);
          selected = { row, col: effCol };
          refreshGrid();
          renderInspector();
          return;
        }
        if (e.shiftKey && selected && selected.col < 5 && col < 5) {
          multiSelected.clear();
          const r0 = Math.min(selected.row, row), r1 = Math.max(selected.row, row);
          const c0 = Math.min(selected.col, col), c1 = Math.max(selected.col, col);
          for (let rr = r0; rr <= r1; rr++) {
            for (let cc = c0; cc <= c1; cc++) {
              if (!isBackCell(rr, cc) && !findSpanMasterCell(pageButtons(), rr, cc)) {
                multiSelected.add(`${rr},${cc}`);
              }
            }
          }
          selected = { row, col };
          refreshGrid();
          renderInspector();
          return;
        }
        multiSelected.clear();
        if (col < KEY_COLS) {
          const sm = findSpanMasterCell(pageButtons(), row, col);
          if (sm) { select(row, sm.masterCol); return; }
        }
        select(row, col);
      });

      // 右键上下文菜单
      cell.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        select(row, col);
        showContextMenu(e.clientX, e.clientY, row, col);
      });

      if (col !== 5) {
        cell.draggable = true;
        cell.addEventListener('dragstart', (e) => {
          if (isBackCell(row, col) || !pageButtons()[row + ',' + col]) { e.preventDefault(); return; }
          dragFrom = { row, col };
          cell.classList.add('dragging');
          document.body.classList.add('dragging-key');
          e.dataTransfer.effectAllowed = 'copyMove';
          e.dataTransfer.setData('text/plain', row + ',' + col);
          e.dataTransfer.setData('application/akp153-cell', row + ',' + col);
        });
        cell.addEventListener('dragend', () => {
          cell.classList.remove('dragging');
          document.body.classList.remove('dragging-key');
          dragFrom = null;
        });
      }

      cell.addEventListener('dragover', (e) => {
        if (isBackCell(row, col)) return;
        e.preventDefault();
        const occupied = col !== 5 && !!pageButtons()[row + ',' + col];
        const swap = !!dragFrom && occupied && !dragLib;
        cell.classList.add(swap ? 'dragswap' : 'dragover');
      });
      cell.addEventListener('dragleave', () => {
        cell.classList.remove('dragover', 'dragswap');
      });
      cell.addEventListener('drop', (e) => {
        e.preventDefault();
        cell.classList.remove('dragover', 'dragswap');
        handleDrop(row, col, e);
      });
      grid.appendChild(cell);
    }
  }
  applyHardwareModelToUI(cfg && cfg.hardwareModel);
  refreshGrid();
}

/** A drop is a library item, an internal move (reorder) or new content. */
async function handleDrop(row, col, e) {
  const internal = dragFrom;
  const fromLib = dragLib;
  dragFrom = null;
  dragLib = null;

  // 若拖拽落入跨格宽屏组件的从属格，自动收缩原跨格组件宽度，彻底杜绝被遮挡的幽灵按键
  if (col < KEY_COLS) {
    const sm = findSpanMasterCell(pageButtons(), row, col);
    if (sm && sm.spec) {
      sm.spec.spanCols = Math.max(1, col - sm.masterCol);
    }
  }

  if (fromLib) {
    if (col === 5) { toast('显示屏不能放按键'); return; }
    if (isBackCell(row, col)) { toast('子页自动返回键不可覆盖'); return; }
    const entry = (cfg.library || []).find((x) => x.id === fromLib);
    if (!entry) return;
    pushHistory(`放置库按键「${entry.name}」`);
    await stopKeyMacroIfNeeded(row, col);
    const clonedSpec = clone(entry.spec);
    if (clonedSpec && Number(clonedSpec.spanCols) > 1) {
      clonedSpec.spanCols = Math.max(1, Math.min(KEY_COLS - col, Number(clonedSpec.spanCols) || 1));
    }
    pageButtons()[row + ',' + col] = clonedSpec;
    await saveConfig();
    select(row, col);
    await pushKey(row, col);
    toast(`已把「${entry.name}」放到 r${row}c${col}`);
    return;
  }
  if (internal) {
    await swapCells(internal, { row, col });
    return;
  }
  await onDrop(row, col, e);
}

async function swapCells(a, b) {
  if (a.row === b.row && a.col === b.col) return;
  if (a.col === 5 || b.col === 5) return;   // strips are not part of the key grid
  pushHistory(`交换按键 r${a.row}c${a.col} ⇄ r${b.row}c${b.col}`);
  const ka = a.row + ',' + a.col;
  const kb = b.row + ',' + b.col;
  const va = pageButtons()[ka];
  const vb = pageButtons()[kb];
  if (vb && Number(vb.spanCols) > 1) vb.spanCols = Math.max(1, Math.min(KEY_COLS - a.col, Number(vb.spanCols) || 1));
  if (va && Number(va.spanCols) > 1) va.spanCols = Math.max(1, Math.min(KEY_COLS - b.col, Number(va.spanCols) || 1));
  // 交换按键时同步迁移 RuntimeStateStore 状态
  const pid = curPage() && curPage().id;
  const rtA = getRuntimeCellState(pid, a.row, a.col);
  const rtB = getRuntimeCellState(pid, b.row, b.col);
  if (rtB) setRuntimeCellState(pid, a.row, a.col, rtB);
  if (rtA) setRuntimeCellState(pid, b.row, b.col, rtA);
  if (vb) pageButtons()[ka] = vb; else delete pageButtons()[ka];
  if (va) pageButtons()[kb] = va; else delete pageButtons()[kb];
  await saveConfig();
  selected = b;
  refreshGrid();
  renderInspector();
  await pushKey(a.row, a.col);
  await pushKey(b.row, b.col);
}

function renderStripCellContent(cell, row, page, grad) {
  const rawS = effectiveStrips()[String(row)] || { type: 'text', label: '', color: '#263238' };
  const s = (rawS.type === 'telemetry' && rawS.telemetryType)
    ? Object.assign({}, rawS, { type: rawS.telemetryType, widgetKind: rawS.telemetryType })
    : (rawS.type === 'disk' ? Object.assign({}, rawS, { type: 'mem' }) : rawS);
  cell.classList.add('display');
  cell.classList.toggle('ctx-active', !!(activeRendererContextBar && cfg && cfg.contextBarEnabled !== false));
  cell.classList.remove('filled', 'pos-top', 'pos-center', 'has-canvas');

  const isCanvasStrip = ['clock', 'cpu', 'mem', 'sys', 'volume', ...WIDGET_KINDS, 'widget'].includes(s.type);
  if (isCanvasStrip) {
    cell.classList.add('has-canvas');
    let c = null;
    if (s.type === 'clock') c = paintClockStrip(s, 80, row);
    else if (s.type === 'volume') c = paintVolumeStrip(s, 80, row, lastAudioState ? lastAudioState.volume : 50, !!(lastAudioState && lastAudioState.isMute));
    else if (s.type === 'cpu' || s.type === 'mem' || s.type === 'sys') {
      const st = (lastSysStats && (lastSysStats.cpu || lastSysStats.mem)) ? lastSysStats : { cpu: 24, mem: 48, memUsedGb: '7.6' };
      c = paintMetricStrip(s, 80, row, s.type, st);
    } else {
      c = paintWidgetCanvas(Object.assign({}, s, { widgetKind: s.widgetKind || s.type }), 80, { row, col: 5 });
    }
    if (c) {
      c.className = 'cell-canvas-preview';
      cell.appendChild(c);
    }
    cell.appendChild(el('span', 'badge', `屏 ${row + 1}`));
    return;
  }

  const txt = s.type === 'page' ? pageStripLabel() : (s.label || '（空）');
  const gl = '▢';

  const isStripGrad = grad && grad.enabled && !s.customColor;
  cell.classList.toggle('grad-cell', !!isStripGrad);

  if (isStripGrad) {
    cell.style.backgroundImage = `linear-gradient(${grad.angle}deg, ${grad.from}, ${grad.to})`;
    cell.style.backgroundSize = '600% 300%';
    cell.style.backgroundPosition = `${5 * 20}% ${row * 50}%`;
    cell.style.backgroundColor = '';
    cell.style.color = sampleGradientContrast(grad, row, 5);
  } else {
    cell.style.backgroundImage = '';
    cell.style.backgroundSize = '';
    cell.style.backgroundPosition = '';
    cell.style.background = s.color || '#263238';
    cell.style.color = contrast(s.color);
  }

  cell.appendChild(el('span', 'glyph', gl));
  const capEl = el('span', 'cap', String(txt));
  if (s.fontSize) {
    const fsPx = Math.max(9, Math.min(20, Math.round(76 * (Number(s.fontSize) / 100) * 0.65)));
    capEl.style.fontSize = `${fsPx}px`;
  }
  cell.appendChild(capEl);
  cell.appendChild(el('span', 'badge', `屏 ${row + 1}`));
}

function refreshStripCells(stats) {
  if (stats) lastSysStats = Object.assign({}, lastSysStats, stats);
  const page = curPage();
  const grad = page.gradient;
  document.querySelectorAll('#grid .cell.display').forEach((cell) => {
    const row = +cell.dataset.row;
    const isSel = !!selected && selected.row === row && selected.col === 5;
    cell.classList.toggle('selected', isSel);
    cell.innerHTML = '';
    cell.style.background = '';
    cell.style.color = '';
    renderStripCellContent(cell, row, page, grad);
  });
}

function renderSingleCellDOM(cell, row, col, page, grad) {
  if (!cell) return;
  const isSel = !!selected && selected.row === row && selected.col === col;
  const isMulti = col < 5 && multiSelected.size > 1 && multiSelected.has(`${row},${col}`);
  cell.classList.toggle('selected', isSel);
  cell.classList.toggle('multi-selected', isMulti);
  cell.classList.remove('has-canvas');
  cell.innerHTML = '';
  cell.style.background = '';
  cell.style.color = '';

  // 副屏 (Col 5)
  if (col === 5) {
    renderStripCellContent(cell, row, page, grad);
    return;
  }

  // 子页自动返回键
  if (isBackCell(row, col)) {
    cell.classList.remove('filled', 'pos-top', 'pos-center');
    cell.classList.add('back');
    cell.style.background = '#37474f';
    cell.style.color = '#ffffff';
    cell.appendChild(el('span', 'glyph', '←'));
    cell.appendChild(el('span', 'cap', '返回'));
    cell.appendChild(el('span', 'badge', '自动'));
    return;
  }
  cell.classList.remove('back');

  cell.classList.remove('span-master', 'span-slave', 'span-left', 'span-mid', 'span-right');
  const spanMaster = findSpanMasterCell(pageButtons(), row, col);
  if (spanMaster) {
    cell.classList.add('filled', 'has-canvas', 'span-slave');
    cell.classList.add(spanMaster.spanOffset === spanMaster.spanCols - 1 ? 'span-right' : 'span-mid');
    const wc = paintWidgetCanvas(spanMaster.spec, 96, {
      row,
      col,
      masterCol: spanMaster.masterCol,
      spanCols: spanMaster.spanCols,
      spanOffset: spanMaster.spanOffset,
    });
    wc.className = 'cell-canvas-preview';
    cell.appendChild(wc);
    cell.appendChild(el('span', 'tag', `r${row}c${col}`));
    cell.appendChild(el('span', 'badge', `🔗 ${spanMaster.spanOffset + 1}/${spanMaster.spanCols}`));
    return;
  }

  const spec = pageButtons()[row + ',' + col];
  const isGrad = grad && grad.enabled && (!spec || !spec.customColor);

  cell.classList.toggle('filled', !!spec);
  cell.classList.toggle('grad-cell', !!isGrad);
  const pos = (spec && spec.labelPos) || 'bottom';
  cell.classList.toggle('pos-top', !!spec && pos === 'top');
  cell.classList.toggle('pos-center', !!spec && pos === 'center');

  if (isGrad) {
    cell.style.backgroundImage = `linear-gradient(${grad.angle}deg, ${grad.from}, ${grad.to})`;
    cell.style.backgroundSize = '600% 300%';
    cell.style.backgroundPosition = `${col * 20}% ${row * 50}%`;
    cell.style.backgroundColor = '';
  } else if (spec) {
    cell.style.backgroundImage = spec.color2
      ? `linear-gradient(180deg, ${spec.color || '#37474f'}, ${spec.color2})`
      : '';
    cell.style.backgroundSize = '';
    cell.style.backgroundPosition = '';
    cell.style.backgroundColor = spec.color || '#37474f';
  } else {
    cell.style.backgroundImage = '';
    cell.style.backgroundSize = '';
    cell.style.backgroundPosition = '';
    cell.style.backgroundColor = '';
  }

  if (!spec) {
    cell.appendChild(el('span', 'plus', '＋'));
    return;
  }

  if (spec.type === 'widget') {
    const spanCols = Math.max(1, Math.min(KEY_COLS - col, Number(spec.spanCols) || 1));
    cell.classList.add('has-canvas');
    if (spanCols > 1) cell.classList.add('span-master', 'span-left');
    const wc = paintWidgetCanvas(spec, 96, { row, col, masterCol: col, spanCols, spanOffset: 0 });
    wc.className = 'cell-canvas-preview';
    cell.appendChild(wc);
    cell.appendChild(el('span', 'tag', `r${row}c${col}`));
    cell.appendChild(el('span', 'badge', spanCols > 1 ? `🔗 ${spanCols}联屏` : '组件'));
    const x = document.createElement('button');
    x.className = 'clear';
    x.textContent = '×';
    x.onclick = (e) => { e.stopPropagation(); removeKey(row, col); };
    cell.appendChild(x);
    return;
  }

  const renderModel = computeRenderModel(spec, { row, col });
  const isLoopRunning = activeLoopKeyIds.has(`${row},${col}`) ||
    (page && activeLoopKeyIds.has(`${page.id}:${row},${col}`));
  cell.classList.toggle('loop-running', !!isLoopRunning);

  if (spec.textColor) {
    cell.style.color = spec.textColor;
  } else if (isGrad) {
    cell.style.color = sampleGradientContrast(grad, row, col);
  } else {
    cell.style.color = contrast(spec.color);
  }

  // v0.10.6 彻底修复「硬件真彩」模式下出现一大一小双角标与文字重影：
  // 启用 hwMirrorEnabled 时，仅挂载 1:1 硬件级 Canvas 画面，不再挂载冗余的 DOM .thumb/.glyph/.badge-overlay/.cap
  if (hwMirrorEnabled) {
    cell.classList.add('has-canvas', 'hw-mirror-cell');
    const cacheKey = `${(page && page.id) || 'p1'}:${row},${col}`;
    const cachedSrc = _hwMirrorCanvasCache.get(cacheKey);
    if (cachedSrc) {
      const syncCnv = document.createElement('canvas');
      syncCnv.width = syncCnv.height = 96;
      syncCnv.className = 'cell-canvas-preview cell-hw-mirror-canvas';
      syncCnv.getContext('2d').drawImage(cachedSrc, 0, 0);
      cell.appendChild(syncCnv);
    }
    paintKey(spec, 96, { row, col }).then((hwCnv) => {
      if (!hwCnv) return;
      _hwMirrorCanvasCache.set(cacheKey, hwCnv);
      if (!cell.isConnected) return;
      hwCnv.className = 'cell-canvas-preview cell-hw-mirror-canvas';
      const oldCnv = cell.querySelector('.cell-hw-mirror-canvas');
      if (oldCnv) oldCnv.replaceWith(hwCnv);
      else cell.insertBefore(hwCnv, cell.firstChild);
    }).catch(() => {});
  } else {
    cell.classList.remove('hw-mirror-cell');
    const iconScalePct = Math.max(25, Math.min(100, Number(spec.iconScale) || 62));
    const fontSizePct = Math.max(8, Math.min(45, Number(spec.fontSize) || 17));

    if (spec.icon) {
      const img = document.createElement('img');
      img.className = 'thumb';
      img.src = spec.icon;
      const thumbPx = Math.max(20, Math.min(76, Math.round(78 * (iconScalePct / 100))));
      img.style.width = `${thumbPx}px`;
      img.style.height = `${thumbPx}px`;
      cell.appendChild(img);
    } else {
      const glSpan = el('span', 'glyph', renderModel.glyph);
      const glPx = Math.max(14, Math.min(44, Math.round(24 * (iconScalePct / 62))));
      glSpan.style.fontSize = `${glPx}px`;
      cell.appendChild(glSpan);
    }

    // 右上角状态角标（仅在非硬件真彩 DOM 预览模式下挂载）
    const activeBadge = renderModel.badge;
    if (activeBadge && activeBadge.text) {
      const bEl = el('span', 'badge-overlay', activeBadge.text);
      if (activeBadge.bg) bEl.style.backgroundColor = activeBadge.bg;
      if (activeBadge.color) bEl.style.color = activeBadge.color;
      if (activeBadge.isToggle) bEl.classList.add('badge-toggle');
      cell.appendChild(bEl);
    }

    if (isLoopRunning) {
      const runTag = el('span', 'badge-overlay', '⟳ RUN');
      runTag.style.backgroundColor = '#00c853';
      runTag.style.color = '#ffffff';
      runTag.style.left = '4px';
      runTag.style.right = 'auto';
      cell.appendChild(runTag);
    }

    const capEl = el('span', 'cap', spec.label || '');
    const capPx = Math.max(9, Math.min(22, Math.round(72 * (fontSizePct / 100))));
    capEl.style.fontSize = `${capPx}px`;
    if (!spec.label) capEl.style.display = 'none';
    cell.appendChild(capEl);
  }

  cell.appendChild(el('span', 'tag', `r${row}c${col}`));
  if (TYPE_SHORT[spec.type]) cell.appendChild(el('span', 'badge', TYPE_SHORT[spec.type]));

  const x = document.createElement('button');
  x.className = 'clear';
  x.textContent = '×';
  x.onclick = (e) => { e.stopPropagation(); removeKey(row, col); };
  cell.appendChild(x);
}

function refreshGrid() {
  const page = curPage();
  if (!page) return;
  const grad = page.gradient;
  const msHint = $('multiSelectHint');
  if (msHint) {
    msHint.hidden = multiSelected.size <= 1;
    if (multiSelected.size > 1) {
      msHint.textContent = `已多选 ${multiSelected.size} 格 · 右侧可批量修改样式`;
    }
  }
  applyHardwareModelToUI(cfg && cfg.hardwareModel);

  document.querySelectorAll('#grid .cell').forEach((cell) => {
    const row = +cell.dataset.row, col = +cell.dataset.col;
    renderSingleCellDOM(cell, row, col, page, grad);
  });
}

function refreshSingleCell(row, col) {
  if (!cfg) return;
  if (col === 5) {
    refreshStripCells(lastSysStats);
    return;
  }
  const page = curPage();
  if (!page) return;
  const sp = pageButtons()[`${row},${col}`];
  const sm = findSpanMasterCell(pageButtons(), row, col);
  if ((sp && Number(sp.spanCols) > 1) || sm) {
    // 仅刷新该行的 5 个按键格，仍避免重绘其它行和副屏
    for (let c = 0; c < KEY_COLS; c++) {
      const rowCell = document.querySelector(`#grid .cell[data-row="${row}"][data-col="${c}"]`);
      if (rowCell) renderSingleCellDOM(rowCell, row, c, page, page.gradient);
    }
    return;
  }
  const targetCell = document.querySelector(`#grid .cell[data-row="${row}"][data-col="${col}"]`);
  if (targetCell) {
    renderSingleCellDOM(targetCell, row, col, page, page.gradient);
  } else {
    refreshGrid();
  }
}

function el(tag, cls, text) {
  const n = document.createElement(tag);
  n.className = cls;
  n.textContent = text;
  return n;
}

// ------------------------------------------------------------------- editing

function applyAppDualStateDefaults(spec, cls, targetPath) {
  if (!cls || cls.type !== 'app') return;
  const mode = (cfg && cfg.appDropMode) || 'dual';
  if (mode === 'single') return;
  const rawTarget = targetPath || (spec && spec.target) || '';
  const procName = cls.processName || (rawTarget ? rawTarget.replace(/\\/g, '/').split('/').pop().replace(/\.[^.]+$/, '') : '');
  if (!procName) return;
  const isScript = /\.(bat|cmd|ps1|vbs|py|sh)$/i.test(rawTarget);

  if (mode === 'smart') {
    spec.smartToggle = true;
    spec.toggleAction = true;
    spec.toggleSyncMode = 'window';
    spec.watchProcess = procName;
    spec.action2 = {
      type: 'window_toggle',
      target: procName,
      watchProcess: procName,
      args: ''
    };
    spec.badgeToggle = true;
    spec.badgeState1 = { text: '', bg: '#546e7a' };
    spec.badgeState2 = { text: '前台', bg: '#107c41' };
    return;
  }

  spec.toggleAction = true;
  spec.toggleSyncMode = isScript ? 'manual' : 'auto';
  spec.watchProcess = procName;
  spec.action2 = {
    type: 'command',
    target: mode === 'graceful' ? `wm_close:${procName}` : `taskkill /F /IM ${procName}.exe`,
    args: ''
  };
  spec.badgeToggle = true;
  spec.badgeState1 = { text: '', bg: '#546e7a' };
  spec.badgeState2 = { text: '运行中', bg: '#107c41' };
}

async function onDrop(row, col, e) {
  if (isBackCell(row, col)) {
    toast('这是子页右下角的自动返回键 —— 退出子页后你原来放在这里的按键会恢复');
    return;
  }
  const dt = e.dataTransfer;
  let target = null;
  let kind = null;

  if (dt.files && dt.files.length) {
    const f = dt.files[0];
    // File.path was removed in Electron 32 - ask the preload for the real path.
    target = api.pathForFile(f) || '';
    if (!target) {
      toast('没拿到文件路径（' + f.name + '）—— 试试从资源管理器拖，而不是从浏览器里拖');
      return;
    }
    kind = 'path';
  } else {
    const text = (dt.getData('text/uri-list') || dt.getData('text') || '').trim();
    if (text) { target = text; kind = 'text'; }
  }
  if (!target) return;

  let spec;
  if (kind === 'text' && /^https?:\/\//i.test(target)) {
    spec = { type: 'url', label: new URL(target).hostname.replace(/^www\./, ''), target, icon: '', color: '#0277bd' };
  } else if (kind === 'text') {
    spec = { type: 'command', label: target.slice(0, 12), target, args: '', icon: '', color: '#4e342e' };
  } else {
    const cls = await api.actionClassify(target);
    const abs = cls.abs || target;
    // Never save a path we cannot resolve - that is how the app directory ended
    // up as the target for every dropped file.
    if (!cls.exists) {
      toast('路径不存在：' + abs);
      return;
    }
    spec = { type: cls.type, label: cls.label, target: abs, args: '', icon: '', color: colorFor(cls.type) };
    const icon = await api.iconExtract(abs);
    if (icon) spec.icon = icon;
    applyAppDualStateDefaults(spec, cls, abs);
  }

  pushHistory(`拖入配置 r${row}c${col}`);
  await stopKeyMacroIfNeeded(row, col);
  pageButtons()[row + ',' + col] = spec;
  await saveConfig();
  select(row, col);
  await pushKey(row, col);
}

function colorFor(type) {
  switch (type) {
    case 'app': return '#1565c0';
    case 'hotkey': return '#107c41';
    case 'folder': return '#ef6c00';
    case 'url': return '#0277bd';
    case 'command': return '#4e342e';
    case 'ps1': return '#6a1b9a';
    case 'page': return '#455a64';
    default: return '#37474f';
  }
}

/** 页面动作的默认外观 + 名称。 */
const PAGE_MODES = [
  ['next', '下一页'],
  ['prev', '上一页'],
  ['goto', '跳到指定页'],
  ['up', '返回上级'],
  ['home', '回到主页面'],
];

const PAGE_MODE_INFOS = [
  { id: 'next', icon: '⏭️', name: '下一页', desc: '按顺序循环切换至下一页' },
  { id: 'prev', icon: '⏮️', name: '上一页', desc: '按顺序返回至上一张页面' },
  { id: 'goto', icon: '🎯', name: '跳到指定页', desc: '直接跳转至指定子页或页面' },
  { id: 'up',   icon: '⤴️', name: '返回上级', desc: '从当前子页面返回父级页面' },
  { id: 'home', icon: '🏠', name: '回到主页面', desc: '无论当前在哪，一键回主页' },
];

function pageActionLabel(spec) {
  const mode = spec.mode || 'next';
  if (mode === 'goto') {
    const p = pageById(spec.pageId);
    return p ? p.name : '（目标页已删）';
  }
  const m = PAGE_MODES.find(([v]) => v === mode);
  return m ? m[1] : '下一页';
}

function makePageSpec(mode, pageId) {
  const spec = {
    type: 'page', mode: mode || 'next', pageId: pageId || '',
    label: '', args: '', icon: '', color: colorFor('page'),
  };
  spec.label = pageActionLabel(spec);
  return spec;
}

/** 选「切页」模式 + 目标页（现代化卡片流交互式弹窗）。 */
function askPageAction(current) {
  return new Promise((resolve) => {
    let mode = (current && current.mode) || 'next';
    const target = (current && current.pageId) || '';
    const pages = pageTree().map(({ page, depth }) =>
      `<option value="${page.id}" ${target === page.id ? 'selected' : ''}>${'　'.repeat(depth)}${depth ? '↳ ' : ''}${escapeHtml(page.name)}</option>`).join('');

    const wrap = document.createElement('div');
    wrap.className = 'modal';
    wrap.innerHTML = `
      <div class="page-modal-box">
        <input id="_pmMode" type="hidden" value="${mode}" />
        <div class="page-modal-head">
          <div class="page-modal-title"><span>📄</span><span>设置翻页按键动作</span></div>
          <div class="page-modal-subtitle">点击此键时在 AKP153 控制台页面间平滑切换</div>
        </div>

        <div class="page-mode-grid" id="_pmModeGrid">
          ${PAGE_MODE_INFOS.map(m => `
            <div class="page-mode-card ${mode === m.id ? 'active' : ''}" data-mode="${m.id}">
              <span class="pm-icon">${m.icon}</span>
              <div class="pm-info">
                <span class="pm-title">${m.name}</span>
                <span class="pm-desc">${m.desc}</span>
              </div>
            </div>
          `).join('')}
        </div>

        <div class="page-target-wrap" id="_pmWrap" style="${mode === 'goto' ? '' : 'display:none;'}">
          <label style="font-size: 12px; font-weight: 600; color: var(--fg); display: flex; align-items: center; gap: 4px;">
            <span>🎯</span><span>选择目标跳转页面：</span>
          </label>
          <select id="_pmPage" class="page-select-styled">${pages}</select>
        </div>

        <div class="btnrow" style="margin-top: 6px; justify-content: flex-end; gap: 8px;">
          <button type="button" class="ghost" id="_pmCancel">取消</button>
          <button type="button" class="primary" id="_pmOk" style="min-width: 90px;">✓ 确定保存</button>
        </div>
      </div>
    `;
    document.body.appendChild(wrap);

    const cards = wrap.querySelectorAll('.page-mode-card');
    const iptMode = wrap.querySelector('#_pmMode');
    const wrapTarget = wrap.querySelector('#_pmWrap');
    const tgt = wrap.querySelector('#_pmPage');

    cards.forEach((card) => {
      card.addEventListener('click', () => {
        mode = card.dataset.mode;
        if (iptMode) iptMode.value = mode;
        cards.forEach((c) => c.classList.toggle('active', c === card));
        wrapTarget.style.display = mode === 'goto' ? '' : 'none';
      });
      card.addEventListener('dblclick', () => {
        const finalMode = (iptMode && iptMode.value) || mode;
        done({ mode: finalMode, pageId: tgt.value });
      });
    });

    const done = (v) => { wrap.remove(); resolve(v); };
    wrap.querySelector('#_pmOk').onclick = () => {
      const finalMode = (iptMode && iptMode.value) || mode;
      done({ mode: finalMode, pageId: tgt.value });
    };
    wrap.querySelector('#_pmCancel').onclick = () => done(null);
    wrap.addEventListener('click', (e) => { if (e.target === wrap) done(null); });
  });
}

/** Yes/no modal - window.confirm is unavailable in Electron renderers. */
function askConfirm(title, body) {
  return new Promise((resolve) => {
    const wrap = document.createElement('div');
    wrap.className = 'modal';
    wrap.innerHTML = `<div class="modalbox">
      <h3>${escapeHtml(title)}</h3>
      <p class="muted" style="margin:0 0 14px">${escapeHtml(body)}</p>
      <div class="btnrow">
        <button class="primary" id="_cOk">确定</button>
        <button class="ghost" id="_cCancel">取消</button>
      </div>
    </div>`;
    document.body.appendChild(wrap);
    const done = (v) => { wrap.remove(); resolve(v); };
    wrap.querySelector('#_cOk').onclick = () => done(true);
    wrap.querySelector('#_cCancel').onclick = () => done(false);
    wrap.addEventListener('click', (e) => { if (e.target === wrap) done(false); });
  });
}

async function stopKeyMacroIfNeeded(row, col, pageId) {
  const pid = pageId || (curPage() && curPage().id);
  const k1 = `${row},${col}`;
  const k2 = pid ? `${pid}:${row},${col}` : k1;
  activeLoopKeyIds.delete(k1);
  activeLoopKeyIds.delete(k2);
  if (!DEMO && typeof api !== 'undefined' && api.macroStopKey) {
    try { await api.macroStopKey(pid, row, col); } catch (_) {}
  }
}

async function stopPageMacrosIfNeeded(pageId) {
  const pid = pageId || (curPage() && curPage().id);
  if (!pid) return;
  for (const k of Array.from(activeLoopKeyIds)) {
    if (k.startsWith(`${pid}:`)) activeLoopKeyIds.delete(k);
  }
  if (!DEMO && typeof api !== 'undefined' && api.macroStopPage) {
    try { await api.macroStopPage(pid); } catch (_) {}
  }
}

async function removeKey(row, col) {
  pushHistory(`清空按键 r${row}c${col}`);
  await stopKeyMacroIfNeeded(row, col);
  delete pageButtons()[row + ',' + col];
  await saveConfig();
  if (selected && selected.row === row && selected.col === col) selected = null;
  refreshGrid();
  renderInspector();
  await pushKey(row, col);
}

function select(row, col) {
  selected = (row != null && col != null) ? { row, col } : null;
  refreshGrid();
  renderInspector();
}

async function repaintSelected() {
  if (!selected) return;
  if (selected.col === 5) await pushStrip(selected.row);
  else await pushKey(selected.row, selected.col);
}

/** Preview mode (no preload) has no main process to talk to. Everything that
 *  would persist must go through here, otherwise a plain edit in preview throws
 *  and the panel silently stops re-rendering. */
function saveConfig() {
  if (DEMO) return Promise.resolve(true);
  return api.configSave(cfg);
}

function syncSelectedToggleBadge() {
  // v0.10.6 修复：当开启双态角标 (badgeToggle) 时，绝不将当前激活态角标回写污染静态 s.badge 字段，
  // 从而彻底解决“运行中 / 无”预设在编辑后待机态仍然残留“运行中”角标的 Bug！
}

let _debouncedSaveTimer = null;
let _debouncedRepaintTimer = null;

function scheduleDebouncedCommit(repaint = true) {
  if (selected && multiSelected.size <= 1) {
    refreshSingleCell(selected.row, selected.col);
  } else {
    refreshGrid();
  }
  clearTimeout(_debouncedSaveTimer);
  _debouncedSaveTimer = setTimeout(() => {
    saveConfig();
  }, 220);
  if (repaint) {
    clearTimeout(_debouncedRepaintTimer);
    _debouncedRepaintTimer = setTimeout(() => {
      repaintSelected();
    }, 120);
  }
}

async function commit(repaint) {
  clearTimeout(_debouncedSaveTimer);
  clearTimeout(_debouncedRepaintTimer);
  syncSelectedToggleBadge();
  if (!_isApplyingHistory && cfg && cfg.pages) {
    const curHash = getPagesSnapshotHash();
    if (_lastHistoryHash && curHash !== _lastHistoryHash) {
      pushHistory('编辑按键配置');
    } else if (!_lastHistoryHash) {
      syncHistoryBaseline();
    }
  }
  refreshGrid();
  await saveConfig();
  if (repaint) await repaintSelected();
}

let currentInspTab = 'action';

function updateInspTabs() {
  const tabAction = $('tabAction');
  const tabStyle = $('tabStyle');
  const tabBadge = $('tabBadge');
  if (tabAction && tabStyle) {
    tabAction.classList.toggle('active', currentInspTab === 'action');
    tabStyle.classList.toggle('active', currentInspTab === 'style');
    if (tabBadge) tabBadge.classList.toggle('active', currentInspTab === 'badge');
  }
  const secAction = document.querySelector('#inspector details[data-sec="action"]');
  const secStyle = document.querySelector('#inspector details[data-sec="look"]');
  const secBadge = document.querySelector('#inspector details[data-sec="badge"]');
  if (secAction) {
    secAction.style.display = currentInspTab === 'action' ? 'block' : 'none';
    if (currentInspTab === 'action') secAction.open = true;
  }
  if (secStyle) {
    secStyle.style.display = currentInspTab === 'style' ? 'block' : 'none';
    if (currentInspTab === 'style') secStyle.open = true;
  }
  if (secBadge) {
    secBadge.style.display = currentInspTab === 'badge' ? 'block' : 'none';
    if (currentInspTab === 'badge') secBadge.open = true;
  }
}

function initInspTabs() {
  const tabAction = $('tabAction');
  const tabStyle = $('tabStyle');
  const tabBadge = $('tabBadge');
  if (tabAction) tabAction.onclick = () => { currentInspTab = 'action'; updateInspTabs(); };
  if (tabStyle) tabStyle.onclick = () => { currentInspTab = 'style'; updateInspTabs(); };
  if (tabBadge) tabBadge.onclick = () => { currentInspTab = 'badge'; updateInspTabs(); };
}

// ------------------------------------------------------------- 宏编辑器辅助逻辑

function getActionIcon(type) {
  switch (type) {
    case 'open':
    case 'app': return '🚀';
    case 'cmd':
    case 'command': return '⚡';
    case 'hotkey': return '⌨️';
    case 'text': return '✍️';
    case 'delay': return '⏱️';
    case 'mouse_click': return '🖱️';
    case 'mouse_move': return '🖱️';
    case 'mouse_drag': return '🖲️';
    case 'mouse_wheel': return '🎡';
    case 'window_rect': return '📐';
    case 'media': return '🔊';
    case 'if_color': return '🎨';
    case 'if_process': return '🔍';
    case 'if_qr': return '📷';
    default: return '▶';
  }
}

function getActionTypeName(type) {
  switch (type) {
    case 'open':
    case 'app': return '启动程序 / 打开';
    case 'cmd':
    case 'command': return '执行命令行';
    case 'hotkey': return '模拟快捷键';
    case 'text': return '键盘输入文本';
    case 'delay': return '等待延迟';
    case 'mouse_click': return '鼠标点击';
    case 'mouse_move': return '鼠标平移';
    case 'mouse_drag': return '鼠标拖拽';
    case 'mouse_wheel': return '鼠标滚轮';
    case 'window_rect': return '固定窗口尺寸位置';
    case 'media': return '多媒体控制';
    case 'if_color': return '条件分支：屏幕颜色检测';
    case 'if_process': return '条件分支：进程状态检测';
    case 'if_qr': return '条件分支：屏幕二维码检测';
    default: return type || '动作';
  }
}

function startColorCoordPicker(btnEl, onPicked) {
  let count = 3;
  btnEl.disabled = true;
  const originalText = btnEl.textContent;
  btnEl.textContent = `⏳ ${count} 秒后采样坐标与颜色...`;

  const timer = setInterval(async () => {
    count--;
    if (count > 0) {
      btnEl.textContent = `⏳ ${count} 秒后采样坐标与颜色...`;
    } else {
      clearInterval(timer);
      btnEl.textContent = '🎯 正在采样像素...';
      try {
        const pt = (!DEMO && api.macroGetCursor) ? await api.macroGetCursor() : { x: 640, y: 360 };
        let hex = '#00e676';
        if (!DEMO && pt && pt.x !== undefined) {
          if (api.macroGetPixel) {
            const pRes = await api.macroGetPixel(pt.x, pt.y);
            if (pRes && (pRes.color || pRes.hex)) hex = pRes.color || pRes.hex;
          } else if (api.pixelGetColor) {
            const cRes = await api.pixelGetColor(pt.x, pt.y);
            if (typeof cRes === 'string' && cRes.startsWith('#')) hex = cRes;
            else if (cRes && (cRes.hex || cRes.color)) hex = cRes.hex || cRes.color;
          }
        }
        if (pt && pt.x !== undefined && pt.y !== undefined) {
          onPicked(pt.x, pt.y, hex);
          toast(`🎯 已采样坐标 (${pt.x}, ${pt.y}) 颜色 ${hex}`);
        }
      } catch (err) {
        toast('采样失败：' + (err && err.message));
      } finally {
        btnEl.disabled = false;
        btnEl.textContent = originalText;
      }
    }
  }, 1000);
}

function startCoordinatePicker(btnEl, onPicked) {
  let count = 3;
  btnEl.disabled = true;
  const originalText = btnEl.textContent;
  btnEl.textContent = `⏳ ${count} 秒后采样...`;

  const timer = setInterval(async () => {
    count--;
    if (count > 0) {
      btnEl.textContent = `⏳ ${count} 秒后采样...`;
    } else {
      clearInterval(timer);
      btnEl.textContent = '🎯 正在读取...';
      try {
        const pt = await api.macroGetCursor();
        if (pt && pt.x !== undefined && pt.y !== undefined) {
          onPicked(pt.x, pt.y);
          toast(`已拾取坐标：X=${pt.x}, Y=${pt.y}`);
        } else {
          toast('未能获取坐标');
        }
      } catch (err) {
        toast('拾取坐标失败：' + (err && err.message));
      } finally {
        btnEl.disabled = false;
        btnEl.textContent = originalText;
      }
    }
  }, 1000);
}

// -------------------------------------------------------- 免冲突快捷键构建器与录制器
const HOTKEY_PRESETS = [
  { hk: 'Alt+Shift+F10', lbl: 'IDEA 运行配置' },
  { hk: 'Win+D', lbl: '显示桌面' },
  { hk: 'Alt+F4', lbl: '关闭窗口' },
  { hk: 'Ctrl+Shift+Esc', lbl: '任务管理器' },
  { hk: 'Win+E', lbl: '此电脑' },
  { hk: 'Win+L', lbl: '一键锁屏' },
  { hk: 'Win+V', lbl: '剪贴板' },
  { hk: 'Ctrl+Alt+A', lbl: '屏幕截图' },
  { hk: 'Ctrl+C', lbl: '复制' },
  { hk: 'Ctrl+V', lbl: '粘贴' },
  { hk: 'Ctrl+Z', lbl: '撤销' },
];

const HOTKEY_KEY_CATEGORIES = [
  {
    id: 'f',
    name: 'F 功能键',
    keys: ['F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12'],
  },
  {
    id: 'common',
    name: '常用按键',
    keys: ['Enter', 'Esc', 'Tab', 'Space', 'Backspace', 'Delete'],
  },
  {
    id: 'nav',
    name: '导航/编辑',
    keys: ['Up', 'Down', 'Left', 'Right', 'Home', 'End', 'PgUp', 'PgDn', 'PrtScn', 'Insert'],
  },
  {
    id: 'alpha',
    name: '字母 A~Z',
    keys: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split(''),
  },
  {
    id: 'num',
    name: '数字 0~9',
    keys: '0123456789'.split(''),
  },
];

function normalizeKeyName(k) {
  if (!k) return '';
  const raw = String(k).trim();
  const lk = raw.toLowerCase();
  const map = {
    'esc': 'Esc', 'escape': 'Esc',
    'enter': 'Enter', 'return': 'Enter',
    'tab': 'Tab', 'space': 'Space',
    'backspace': 'Backspace', 'delete': 'Delete', 'del': 'Delete',
    'insert': 'Insert', 'ins': 'Insert',
    'home': 'Home', 'end': 'End',
    'pageup': 'PgUp', 'pgup': 'PgUp',
    'pagedown': 'PgDn', 'pgdn': 'PgDn',
    'arrowup': 'Up', 'up': 'Up',
    'arrowdown': 'Down', 'down': 'Down',
    'arrowleft': 'Left', 'left': 'Left',
    'arrowright': 'Right', 'right': 'Right',
    'prtscn': 'PrtScn', 'printscreen': 'PrtScn',
  };
  if (map[lk]) return map[lk];
  if (/^f([1-9]|1[0-9]|2[0-4])$/i.test(lk)) return lk.toUpperCase();
  if (raw.length === 1) return raw.toUpperCase();
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

function parseHotkey(str) {
  const raw = String(str || '').trim();
  if (!raw) return { ctrl: false, alt: false, shift: false, win: false, key: '' };
  const parts = raw.split('+').map(s => s.trim()).filter(Boolean);
  let ctrl = false, alt = false, shift = false, win = false;
  let key = '';
  for (const p of parts) {
    const pl = p.toLowerCase();
    if (pl === 'ctrl' || pl === 'control') ctrl = true;
    else if (pl === 'alt') alt = true;
    else if (pl === 'shift') shift = true;
    else if (pl === 'win' || pl === 'meta' || pl === 'super') win = true;
    else key = p;
  }
  return { ctrl, alt, shift, win, key: normalizeKeyName(key) };
}

function buildHotkey({ ctrl, alt, shift, win, key }) {
  const mods = [];
  if (ctrl) mods.push('Ctrl');
  if (alt) mods.push('Alt');
  if (shift) mods.push('Shift');
  if (win) mods.push('Win');
  const normKey = normalizeKeyName(key);
  if (!normKey) return mods.join('+');
  return mods.concat([normKey]).join('+');
}

function mapEventKey(e) {
  const code = e.code || '';
  if (/^Key([A-Z])$/i.test(code)) return code.replace(/^Key/i, '').toUpperCase();
  if (/^Digit([0-9])$/i.test(code)) return code.replace(/^Digit/i, '');
  if (/^F([1-9]|1[0-9]|2[0-4])$/i.test(code)) return code.toUpperCase();
  if (/^Numpad([0-9])$/i.test(code)) return 'Num' + code.replace(/^Numpad/i, '');
  const codeMap = {
    'ArrowLeft': 'Left', 'ArrowRight': 'Right', 'ArrowUp': 'Up', 'ArrowDown': 'Down',
    'Enter': 'Enter', 'NumpadEnter': 'Enter', 'Escape': 'Esc', 'Tab': 'Tab',
    'Space': 'Space', 'Backspace': 'Backspace', 'Delete': 'Delete', 'Insert': 'Insert',
    'Home': 'Home', 'End': 'End', 'PageUp': 'PgUp', 'PageDown': 'PgDn',
    'PrintScreen': 'PrtScn', 'Minus': '-', 'Equal': '=',
    'BracketLeft': '[', 'BracketRight': ']', 'Backslash': '\\',
    'Semicolon': ';', 'Quote': '\'', 'Comma': ',', 'Period': '.', 'Slash': '/',
  };
  if (codeMap[code]) return codeMap[code];
  return normalizeKeyName(e.key);
}

let activeHkRecorder = null;

function stopCurrentHkRecorder(finalValue) {
  if (activeHkRecorder) {
    activeHkRecorder.stop(finalValue);
    activeHkRecorder = null;
  }
}

function renderHotkeyBuilderHtml(idPrefix, currentVal, options = {}) {
  const val = String(currentVal || '').trim();
  const parsed = parseHotkey(val);
  const macroAttr = options.isMacro ? `data-macro-idx="${options.idx}"` : '';
  const inputClass = options.isMacro ? 'm-field hotkey-input' : 'hotkey-input';
  const dataField = options.isMacro ? 'data-field="target"' : '';
  const dataIdx = options.isMacro ? `data-idx="${options.idx}"` : '';

  return `
    <div class="hotkey-builder-wrap" id="${idPrefix}-wrap" ${macroAttr}>
      <div class="hotkey-top-row">
        <input id="${idPrefix}" class="${inputClass}" ${dataField} ${dataIdx} value="${escapeAttr(val)}" placeholder="例如 Alt+Shift+F10 或 Ctrl+C" autocomplete="off" />
        <button type="button" class="hk-btn-record" id="${idPrefix}-rec-btn" title="点击后直接在键盘上敲击组合键录制">🔴 录制</button>
        <button type="button" class="hk-btn-palette" id="${idPrefix}-pal-btn" title="免敲击物理键盘，鼠标点选修饰键与按键组合（100% 免疫系统/软件冲突）">⌨️ 免冲突点选</button>
      </div>

      <div class="hk-palette-panel" id="${idPrefix}-pal-panel" style="display: none;">
        <div class="hk-sec-title">
          <span>⚡ 修饰键多选（可自由勾选叠加）：</span>
          <span style="margin-left: auto; font-size: 10px; color: var(--accent); font-weight: normal;">零键盘敲击 · 绝不触发后台软件</span>
        </div>
        <div class="hk-mod-row">
          <button type="button" class="hk-mod-pill ${parsed.ctrl ? 'active' : ''}" data-mod="ctrl">Ctrl</button>
          <button type="button" class="hk-mod-pill ${parsed.alt ? 'active' : ''}" data-mod="alt">Alt</button>
          <button type="button" class="hk-mod-pill ${parsed.shift ? 'active' : ''}" data-mod="shift">Shift</button>
          <button type="button" class="hk-mod-pill ${parsed.win ? 'active' : ''}" data-mod="win">Win</button>
        </div>

        <div class="hk-cat-tabs" id="${idPrefix}-cat-tabs">
          ${HOTKEY_KEY_CATEGORIES.map((cat, i) => `
            <button type="button" class="hk-cat-tab ${i === 0 ? 'active' : ''}" data-cat="${cat.id}">${cat.name}</button>
          `).join('')}
        </div>

        <div class="hk-key-grid" id="${idPrefix}-key-grid">
          ${HOTKEY_KEY_CATEGORIES[0].keys.map(k => `
            <button type="button" class="hk-key-pill" data-key="${k}">${k}</button>
          `).join('')}
        </div>

        <div class="hk-builder-hint">
          <span>💡 提示：先点选修饰键（如 Alt+Shift），再点功能键（如 F10）即可直接套用</span>
        </div>
      </div>

      <div class="hotkey-preset-tags" style="margin-top: 2px;">
        ${HOTKEY_PRESETS.map(p => `
          <span class="hotkey-tag" data-hk="${p.hk}" data-lbl="${p.lbl}">${p.hk} (${p.lbl})</span>
        `).join('')}
      </div>
    </div>
  `;
}

function bindHotkeyBuilder(rootEl, idPrefix, onChange) {
  const root = rootEl || document;
  const ipt = root.querySelector ? (root.querySelector(`#${idPrefix}`) || $(idPrefix)) : $(idPrefix);
  if (!ipt) return;
  const wrap = root.querySelector ? (root.querySelector(`#${idPrefix}-wrap`) || $(`${idPrefix}-wrap`)) : $(`${idPrefix}-wrap`);
  const recBtn = root.querySelector ? (root.querySelector(`#${idPrefix}-rec-btn`) || $(`${idPrefix}-rec-btn`)) : $(`${idPrefix}-rec-btn`);
  const palBtn = root.querySelector ? (root.querySelector(`#${idPrefix}-pal-btn`) || $(`${idPrefix}-pal-btn`)) : $(`${idPrefix}-pal-btn`);
  const palPanel = root.querySelector ? (root.querySelector(`#${idPrefix}-pal-panel`) || $(`${idPrefix}-pal-panel`)) : $(`${idPrefix}-pal-panel`);
  const catTabs = root.querySelector ? (root.querySelector(`#${idPrefix}-cat-tabs`) || $(`${idPrefix}-cat-tabs`)) : $(`${idPrefix}-cat-tabs`);
  const keyGrid = root.querySelector ? (root.querySelector(`#${idPrefix}-key-grid`) || $(`${idPrefix}-key-grid`)) : $(`${idPrefix}-key-grid`);

  const syncPillsFromValue = (val) => {
    if (!palPanel) return;
    const p = parseHotkey(val);
    palPanel.querySelectorAll('.hk-mod-pill').forEach(pill => {
      const m = pill.dataset.mod;
      pill.classList.toggle('active', !!p[m]);
    });
  };

  const getActiveModifiers = () => {
    if (!palPanel) return { ctrl: false, alt: false, shift: false, win: false };
    const pills = palPanel.querySelectorAll('.hk-mod-pill');
    let ctrl = false, alt = false, shift = false, win = false;
    pills.forEach(p => {
      if (p.classList.contains('active')) {
        const m = p.dataset.mod;
        if (m === 'ctrl') ctrl = true;
        if (m === 'alt') alt = true;
        if (m === 'shift') shift = true;
        if (m === 'win') win = true;
      }
    });
    return { ctrl, alt, shift, win };
  };

  // 1. 输入框直接改动
  ipt.addEventListener('change', () => {
    const norm = buildHotkey(parseHotkey(ipt.value.trim()));
    ipt.value = norm;
    syncPillsFromValue(norm);
    if (onChange) onChange(norm);
  });

  // 2. 交互式物理键盘录制（带沙箱捕获与冒泡阻断）
  if (recBtn) {
    recBtn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      if (activeHkRecorder && activeHkRecorder.idPrefix === idPrefix) {
        stopCurrentHkRecorder(null);
        return;
      }
      stopCurrentHkRecorder(null);

      const oldVal = ipt.value;
      recBtn.classList.add('recording');
      recBtn.textContent = '⏹️ 录制中... (Esc 取消)';
      ipt.classList.add('recording');
      ipt.placeholder = '请在键盘上按下快捷键组合...';
      ipt.focus();

      const onKeyDown = (e) => {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();

        // 纯 Escape 键取消
        if (e.key === 'Escape' && !e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey) {
          stopCurrentHkRecorder(null);
          return;
        }

        const ctrl = e.ctrlKey;
        const alt = e.altKey;
        const shift = e.shiftKey;
        const win = e.metaKey;

        // 若当前只按下了修饰键本身
        if (['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) {
          const modPreview = buildHotkey({ ctrl, alt, shift, win, key: '' });
          ipt.value = modPreview ? (modPreview + '+…') : '';
          return;
        }

        // 捕获到了主按键
        const key = mapEventKey(e);
        if (key) {
          const combo = buildHotkey({ ctrl, alt, shift, win, key });
          stopCurrentHkRecorder(combo);
        }
      };

      const stop = (finalVal) => {
        window.removeEventListener('keydown', onKeyDown, { capture: true });
        recBtn.classList.remove('recording');
        recBtn.textContent = '🔴 录制';
        ipt.classList.remove('recording');
        ipt.placeholder = '例如 Alt+Shift+F10 或 Ctrl+C';
        if (finalVal !== null && finalVal !== undefined) {
          ipt.value = finalVal;
          syncPillsFromValue(finalVal);
          if (onChange) onChange(finalVal);
          toast('已成功录制快捷键：' + finalVal);
        } else {
          ipt.value = oldVal;
          syncPillsFromValue(oldVal);
        }
      };

      activeHkRecorder = { idPrefix, stop };
      window.addEventListener('keydown', onKeyDown, { capture: true });
    });
  }

  // 3. 点选构建器折叠与展开
  if (palBtn && palPanel) {
    palBtn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      const isOpen = palPanel.style.display !== 'none';
      palPanel.style.display = isOpen ? 'none' : 'flex';
      palBtn.classList.toggle('active', !isOpen);
      if (!isOpen) {
        syncPillsFromValue(ipt.value);
      }
    });
  }

  // 4. 修饰键胶囊切换
  if (palPanel) {
    palPanel.querySelectorAll('.hk-mod-pill').forEach(pill => {
      pill.addEventListener('click', (ev) => {
        ev.stopPropagation();
        pill.classList.toggle('active');
        const mods = getActiveModifiers();
        const curParsed = parseHotkey(ipt.value);
        const combo = buildHotkey({ ...mods, key: curParsed.key });
        ipt.value = combo;
        if (onChange) onChange(combo);
      });
    });
  }

  // 5. 分类标签页切换
  if (catTabs && keyGrid) {
    catTabs.querySelectorAll('.hk-cat-tab').forEach(tab => {
      tab.addEventListener('click', (ev) => {
        ev.stopPropagation();
        catTabs.querySelectorAll('.hk-cat-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        const catId = tab.dataset.cat;
        const catObj = HOTKEY_KEY_CATEGORIES.find(c => c.id === catId) || HOTKEY_KEY_CATEGORIES[0];
        keyGrid.innerHTML = catObj.keys.map(k => `
          <button type="button" class="hk-key-pill" data-key="${k}">${k}</button>
        `).join('');
        bindKeyPills();
      });
    });
  }

  // 6. 按键点选
  const bindKeyPills = () => {
    if (!keyGrid) return;
    keyGrid.querySelectorAll('.hk-key-pill').forEach(btn => {
      btn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const key = btn.dataset.key;
        const mods = getActiveModifiers();
        const combo = buildHotkey({ ...mods, key });
        ipt.value = combo;
        if (onChange) onChange(combo);
        btn.style.transform = 'scale(0.9)';
        setTimeout(() => { btn.style.transform = ''; }, 100);
      });
    });
  };
  bindKeyPills();

  // 7. 高频快捷标签点选
  if (wrap) {
    wrap.querySelectorAll('.hotkey-tag').forEach(tag => {
      tag.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const hk = tag.dataset.hk;
        ipt.value = hk;
        syncPillsFromValue(hk);
        if (onChange) onChange(hk);
      });
    });
  }
}

function renderActionCardHtml(act, idx, total) {
  const t = act.type || 'app';
  let bodyHtml = '';

  if (t === 'app' || t === 'open' || t === 'url' || t === 'file' || t === 'folder') {
    bodyHtml = `
      <div class="macro-inline-row">
        <input class="m-field" data-field="target" data-idx="${idx}" value="${escapeAttr(act.target || '')}" placeholder="程序名、.exe、路径或网址 (支持 steam, leigod 等自动寻径)" />
        <button type="button" class="ghost tiny" data-act-pick="file" data-idx="${idx}" title="浏览本地文件">📁 浏览</button>
      </div>
      <input class="m-field" data-field="args" data-idx="${idx}" value="${escapeAttr(act.args || '')}" placeholder="启动参数 (可选)" />
    `;
  } else if (t === 'cmd' || t === 'command' || t === 'ps1') {
    bodyHtml = `
      <textarea class="m-field" data-field="target" data-idx="${idx}" rows="2" placeholder="输入要在后台静默执行的命令">${escapeHtml(act.target || '')}</textarea>
    `;
  } else if (t === 'hotkey') {
    const val = act.target || act.combo || act.hotkey || '';
    bodyHtml = `
      <div style="margin-top: 4px;">
        ${renderHotkeyBuilderHtml(`m-hk-${idx}`, val, { isMacro: true, idx })}
      </div>
    `;
  } else if (t === 'text') {
    bodyHtml = `
      <textarea class="m-field" data-field="text" data-idx="${idx}" rows="2" placeholder="输入要模拟键盘输入的文本（支持中文及 Unicode）">${escapeHtml(act.text || '')}</textarea>
    `;
  } else if (t === 'delay') {
    bodyHtml = `
      <div class="macro-inline-row">
        <label>等待延迟：</label>
        <input type="number" class="m-field" data-field="ms" data-idx="${idx}" min="1" max="60000" step="50" value="${act.ms !== undefined ? act.ms : 500}" style="width: 80px;" /> ms
        <div style="display:flex; gap:4px; margin-left:auto;">
          <button type="button" class="ghost tiny m-quick-delay" data-idx="${idx}" data-val="100">+100ms</button>
          <button type="button" class="ghost tiny m-quick-delay" data-idx="${idx}" data-val="500">+500ms</button>
          <button type="button" class="ghost tiny m-quick-delay" data-idx="${idx}" data-val="1000">+1s</button>
        </div>
      </div>
    `;
  } else if (t === 'mouse_click') {
    bodyHtml = `
      <div class="macro-inline-row">
        <label>按键：</label>
        <select class="m-field" data-field="button" data-idx="${idx}" style="flex: 1;">
          <option value="left" ${act.button === 'left' || !act.button ? 'selected' : ''}>左键 (Left)</option>
          <option value="right" ${act.button === 'right' ? 'selected' : ''}>右键 (Right)</option>
          <option value="middle" ${act.button === 'middle' ? 'selected' : ''}>中键 (Middle)</option>
        </select>
        <label style="margin-left: 6px; display: flex; align-items: center; gap: 4px; font-size: 12px; cursor: pointer;">
          <input type="checkbox" class="m-field-chk" data-field="double" data-idx="${idx}" ${act.double ? 'checked' : ''} /> 双击
        </label>
      </div>
      <div class="macro-inline-row" style="margin-top: 4px;">
        <span style="font-size: 11px; color: var(--muted); min-width: 32px;">坐标:</span>
        <input type="number" class="m-field" data-field="x" data-idx="${idx}" value="${act.x !== undefined ? act.x : ''}" placeholder="X (原位)" style="flex: 1; min-width: 0;" />
        <input type="number" class="m-field" data-field="y" data-idx="${idx}" value="${act.y !== undefined ? act.y : ''}" placeholder="Y (原位)" style="flex: 1; min-width: 0;" />
      </div>
      <button type="button" class="ghost tiny m-pick-coord" data-idx="${idx}" data-fields="x,y" style="width: 100%; margin-top: 4px;">🎯 倒计时 3 秒拾取坐标</button>
      <span class="muted small" style="display:block; margin-top:2px;">（X/Y 留空则在当前鼠标位置原位点击）</span>
    `;
  } else if (t === 'mouse_move') {
    bodyHtml = `
      <div class="macro-inline-row">
        <span style="font-size: 11px; color: var(--muted); min-width: 32px;">目标:</span>
        <input type="number" class="m-field" data-field="x" data-idx="${idx}" value="${act.x !== undefined ? act.x : 0}" placeholder="X 坐标" style="flex: 1; min-width: 0;" />
        <input type="number" class="m-field" data-field="y" data-idx="${idx}" value="${act.y !== undefined ? act.y : 0}" placeholder="Y 坐标" style="flex: 1; min-width: 0;" />
      </div>
      <button type="button" class="ghost tiny m-pick-coord" data-idx="${idx}" data-fields="x,y" style="width: 100%; margin-top: 4px;">🎯 倒计时 3 秒拾取坐标</button>
      <div class="macro-inline-row" style="margin-top: 4px;">
        <label>平滑移动：</label>
        <input type="number" class="m-field" data-field="duration" data-idx="${idx}" min="0" max="5000" step="50" value="${act.duration || 0}" style="width: 75px;" /> ms
        <span class="muted small" style="margin-left: auto;">(0为瞬间瞬移)</span>
      </div>
    `;
  } else if (t === 'mouse_drag') {
    const fxVal = act.fromX !== undefined ? act.fromX : (act.x1 !== undefined ? act.x1 : 0);
    const fyVal = act.fromY !== undefined ? act.fromY : (act.y1 !== undefined ? act.y1 : 0);
    const txVal = act.toX !== undefined ? act.toX : (act.x2 !== undefined ? act.x2 : 0);
    const tyVal = act.toY !== undefined ? act.toY : (act.y2 !== undefined ? act.y2 : 0);
    bodyHtml = `
      <div class="macro-inline-row">
        <span style="font-size: 11px; color: var(--muted); min-width: 32px;">起点:</span>
        <input type="number" class="m-field" data-field="fromX" data-idx="${idx}" value="${fxVal}" placeholder="起点 X" style="flex: 1; min-width: 0;" />
        <input type="number" class="m-field" data-field="fromY" data-idx="${idx}" value="${fyVal}" placeholder="起点 Y" style="flex: 1; min-width: 0;" />
        <button type="button" class="ghost tiny m-pick-coord" data-idx="${idx}" data-fields="fromX,fromY">🎯 拾取起点</button>
      </div>
      <div class="macro-inline-row" style="margin-top: 4px;">
        <span style="font-size: 11px; color: var(--muted); min-width: 32px;">终点:</span>
        <input type="number" class="m-field" data-field="toX" data-idx="${idx}" value="${txVal}" placeholder="终点 X" style="flex: 1; min-width: 0;" />
        <input type="number" class="m-field" data-field="toY" data-idx="${idx}" value="${tyVal}" placeholder="终点 Y" style="flex: 1; min-width: 0;" />
        <button type="button" class="ghost tiny m-pick-coord" data-idx="${idx}" data-fields="toX,toY">🎯 拾取终点</button>
      </div>
      <div class="macro-inline-row" style="margin-top: 4px;">
        <label>拖拽耗时：</label>
        <input type="number" class="m-field" data-field="duration" data-idx="${idx}" min="50" max="10000" step="50" value="${act.duration || 300}" style="width: 75px;" /> ms
      </div>
    `;
  } else if (t === 'mouse_wheel') {
    bodyHtml = `
      <div class="macro-inline-row">
        <label>滚动步长：</label>
        <input type="number" class="m-field" data-field="delta" data-idx="${idx}" step="120" value="${act.delta || -120}" style="width: 80px;" />
        <button type="button" class="ghost tiny m-wheel-set" data-idx="${idx}" data-val="120">向上 +120</button>
        <button type="button" class="ghost tiny m-wheel-set" data-idx="${idx}" data-val="-120">向下 -120</button>
      </div>
    `;
  } else if (t === 'window_rect') {
    bodyHtml = `
      <div class="macro-inline-row">
        <label>目标窗口：</label>
        <input class="m-field" data-field="target" data-idx="${idx}" value="${escapeAttr(act.target || '')}" placeholder="窗口标题包含或进程名 (例如 Steam, leigod)" />
      </div>
      <div class="macro-rect-grid" style="margin-top: 6px;">
        <div class="macro-num-field">
          <span class="m-lbl">X 坐标</span>
          <input type="number" class="m-field" data-field="x" data-idx="${idx}" value="${act.x !== undefined ? act.x : 0}" />
        </div>
        <div class="macro-num-field">
          <span class="m-lbl">Y 坐标</span>
          <input type="number" class="m-field" data-field="y" data-idx="${idx}" value="${act.y !== undefined ? act.y : 0}" />
        </div>
        <div class="macro-num-field">
          <span class="m-lbl">宽度 W</span>
          <input type="number" class="m-field" data-field="w" data-idx="${idx}" value="${act.w !== undefined ? act.w : 1280}" />
        </div>
        <div class="macro-num-field">
          <span class="m-lbl">高度 H</span>
          <input type="number" class="m-field" data-field="h" data-idx="${idx}" value="${act.h !== undefined ? act.h : 720}" />
        </div>
      </div>
      <div class="btn-win-preset-row">
        <button type="button" class="ghost tiny m-win-preset" data-idx="${idx}" data-x="0" data-y="0" data-w="960" data-h="1040">🖥️ 左半屏</button>
        <button type="button" class="ghost tiny m-win-preset" data-idx="${idx}" data-x="960" data-y="0" data-w="960" data-h="1040">🖥️ 右半屏</button>
        <button type="button" class="ghost tiny m-win-preset" data-idx="${idx}" data-x="0" data-y="0" data-w="1920" data-h="1080">🖥️ 全屏 1080p</button>
        <button type="button" class="ghost tiny m-win-preset" data-idx="${idx}" data-x="320" data-y="180" data-w="1280" data-h="720">🖥️ 居中 720p</button>
      </div>
    `;
  } else if (t === 'media') {
    bodyHtml = `
      <div class="macro-inline-row">
        <label>多媒体操作：</label>
        <select class="m-field" data-field="cmd" data-idx="${idx}">
          <option value="play_pause" ${act.cmd === 'play_pause' || !act.cmd ? 'selected' : ''}>⏯️ 播放 / 暂停</option>
          <option value="next" ${act.cmd === 'next' ? 'selected' : ''}>⏭️ 下一曲</option>
          <option value="prev" ${act.cmd === 'prev' ? 'selected' : ''}>⏮️ 上一曲</option>
          <option value="vol_up" ${act.cmd === 'vol_up' ? 'selected' : ''}>🔊 音量 +</option>
          <option value="vol_down" ${act.cmd === 'vol_down' ? 'selected' : ''}>🔉 音量 -</option>
          <option value="mute" ${act.cmd === 'mute' ? 'selected' : ''}>🔇 静音切换</option>
        </select>
      </div>
    `;
  } else if (t === 'if_color') {
    bodyHtml = `
      <div class="macro-rect-grid">
        <div class="macro-num-field">
          <span class="m-lbl">起点 X</span>
          <input type="number" class="m-field" data-field="x" data-idx="${idx}" value="${act.x !== undefined ? act.x : 500}" />
        </div>
        <div class="macro-num-field">
          <span class="m-lbl">起点 Y</span>
          <input type="number" class="m-field" data-field="y" data-idx="${idx}" value="${act.y !== undefined ? act.y : 500}" />
        </div>
        <div class="macro-num-field">
          <span class="m-lbl">区域宽 W</span>
          <input type="number" class="m-field" data-field="w" data-idx="${idx}" value="${act.w !== undefined ? act.w : 1}" title="1 表示单点像素检测，>1 表示矩形区域搜色" />
        </div>
        <div class="macro-num-field">
          <span class="m-lbl">区域高 H</span>
          <input type="number" class="m-field" data-field="h" data-idx="${idx}" value="${act.h !== undefined ? act.h : 1}" />
        </div>
      </div>
      <div class="macro-inline-row" style="margin-top: 4px;">
        <span style="font-size:11px; color:var(--muted);">目标色:</span>
        <input type="color" class="m-field" data-field="color" data-idx="${idx}" value="${act.color || '#00e676'}" style="width:36px; height:26px; padding:0; cursor:pointer;" />
        <span style="font-size:11px; color:var(--muted);">容差:</span>
        <input type="number" class="m-field" data-field="tolerance" data-idx="${idx}" min="0" max="120" value="${act.tolerance !== undefined ? act.tolerance : 24}" style="width:58px;" />
        <button type="button" class="ghost tiny m-pick-color-coord" data-idx="${idx}" style="margin-left:auto;">🎯 3秒拾取坐标与颜色</button>
      </div>
      <div class="macro-inline-row" style="margin-top: 4px;">
        <label>匹配动作：</label>
        <select class="m-field" data-field="thenAction" data-idx="${idx}" style="flex:1;">
          <option value="click_found" ${(act.thenAction || 'click_found') === 'click_found' ? 'selected' : ''}>🖱️ 找到颜色后自动点击该坐标并继续</option>
          <option value="continue" ${act.thenAction === 'continue' ? 'selected' : ''}>✅ 满足则继续执行后续步骤 (不满足则中止)</option>
          <option value="skip_next" ${act.thenAction === 'skip_next' ? 'selected' : ''}>⏭️ 满足则执行下一步 (不满足则跳过下一步)</option>
          <option value="abort" ${act.thenAction === 'abort' ? 'selected' : ''}>⏹️ 满足该颜色时立即停止本轮宏</option>
        </select>
      </div>
    `;
  } else if (t === 'if_process') {
    bodyHtml = `
      <div class="macro-inline-row">
        <input class="m-field" data-field="target" data-idx="${idx}" value="${escapeAttr(act.target || 'obs64.exe')}" placeholder="进程名 (如 obs64.exe, Code.exe)" style="flex:1;" />
        <select class="m-field" data-field="thenAction" data-idx="${idx}" style="width:155px;">
          <option value="continue" ${(act.thenAction || 'continue') === 'continue' ? 'selected' : ''}>运行中则继续，否则中止</option>
          <option value="skip_next" ${act.thenAction === 'skip_next' ? 'selected' : ''}>未运行则跳过下一步</option>
          <option value="abort" ${act.thenAction === 'abort' ? 'selected' : ''}>运行中则立即中止宏</option>
        </select>
      </div>
    `;
  } else if (t === 'if_qr') {
    bodyHtml = `
      <div class="macro-inline-row">
        <label>检测到二维码后：</label>
        <select class="m-field" data-field="thenAction" data-idx="${idx}" style="flex:1;">
          <option value="continue" ${(act.thenAction || 'continue') === 'continue' ? 'selected' : ''}>📋 解码复制并继续执行 (未识别则中止)</option>
          <option value="click" ${act.thenAction === 'click' ? 'selected' : ''}>🖱️ 解码复制后点击下方指定坐标</option>
          <option value="skip_next" ${act.thenAction === 'skip_next' ? 'selected' : ''}>⏭️ 未识别到二维码则跳过下一步</option>
        </select>
      </div>
      <div class="macro-inline-row" style="margin-top:4px;">
        <span style="font-size:11px; color:var(--muted);">点击坐标(可选):</span>
        <input type="number" class="m-field" data-field="clickX" data-idx="${idx}" value="${act.clickX !== undefined ? act.clickX : ''}" placeholder="X" style="flex:1;" />
        <input type="number" class="m-field" data-field="clickY" data-idx="${idx}" value="${act.clickY !== undefined ? act.clickY : ''}" placeholder="Y" style="flex:1;" />
      </div>
    `;
  }

  const isCond = ['if_color', 'if_process', 'if_qr'].includes(t);
  return `
    <div class="macro-card ${isCond ? 'cond-card' : ''}" data-idx="${idx}">
      <div class="macro-card-head">
        <div class="macro-card-title">
          <span class="badge" style="background: var(--line);">${idx + 1}</span>
          <span>${getActionIcon(t)} ${getActionTypeName(t)}</span>
        </div>
        <div class="macro-card-tools">
          <button type="button" class="ghost tiny" data-act-tool="up" data-idx="${idx}" ${idx === 0 ? 'disabled' : ''} title="上移">▲</button>
          <button type="button" class="ghost tiny" data-act-tool="down" data-idx="${idx}" ${idx === total - 1 ? 'disabled' : ''} title="下移">▼</button>
          <button type="button" class="ghost tiny" data-act-tool="clone" data-idx="${idx}" title="复制">📋</button>
          <button type="button" class="ghost tiny danger" data-act-tool="del" data-idx="${idx}" title="删除">×</button>
        </div>
      </div>
      <div class="macro-card-body">
        ${bodyHtml}
      </div>
    </div>
  `;
}

function renderMacroEditorHtml(spec) {
  const actions = Array.isArray(spec.actions) ? spec.actions : [];
  const loop = spec.loop || { mode: 'once', interval: 50 };

  return `
    <div class="macro-box">
      <div class="macro-loop-box">
        <div class="macro-loop-row">
          <label style="font-weight: 600; color: var(--fg);">🔁 宏执行模式：</label>
          <select id="m-loop-mode" style="width: auto; flex: 1;">
            <option value="once" ${loop.mode === 'once' ? 'selected' : ''}>🎯 单次运行（拍击一次执行一轮）</option>
            <option value="toggle" ${loop.mode === 'toggle' ? 'selected' : ''}>🔁 开关循环（拍击开始循环，再拍停止）</option>
            <option value="times" ${loop.mode === 'times' ? 'selected' : ''}>🔢 指定次数（循环运行 N 次）</option>
          </select>
        </div>
        <div class="macro-loop-row" id="m-loop-times-row" style="${loop.mode === 'times' ? '' : 'display:none;'}">
          <label>循环次数：</label>
          <input type="number" id="m-loop-times" min="1" max="9999" value="${loop.times || 5}" style="width: 80px;" /> 次
        </div>
        <div class="macro-loop-row">
          <label>轮次间歇延迟：</label>
          <input type="number" id="m-loop-interval" min="20" max="60000" step="10" value="${loop.interval || 50}" style="width: 80px;" /> ms
          <span class="muted small" style="margin-left:auto;">(防卡死阈值: 20ms)</span>
        </div>
        <div class="btnrow" style="margin-top: 4px;">
          <button type="button" class="ghost tiny" id="m-btn-test-run" style="flex:1;">▶ 运行测试宏</button>
          <button type="button" class="ghost tiny danger" id="m-btn-stop-all" style="flex:1;">⏹ 停止所有宏</button>
        </div>
        <div class="macro-record-bar">
          <div style="display:flex; flex-direction:column; gap:1px;">
            <span style="font-size:11.5px; font-weight:600; color:var(--fg);">🎥 全局键鼠轨迹录制器</span>
            <span style="font-size:10px; color:var(--muted);">记录点击坐标、快捷键与时间间隔 (Esc 结束)</span>
          </div>
          <button type="button" class="macro-record-btn" id="m-btn-record-macro">🔴 开始录制</button>
        </div>
      </div>

      <div class="macro-action-list" id="m-action-list">
        ${actions.map((act, idx) => renderActionCardHtml(act, idx, actions.length)).join('')}
        ${actions.length === 0 ? '<p class="muted" style="text-align: center; padding: 14px 0; background: var(--card); border: 1px dashed var(--line); border-radius: 8px;">动作队列暂为空，请点击下方按钮添加动作步骤 ⬇️</p>' : ''}
      </div>

      <div style="margin-top: 6px;">
        <label style="font-size: 11px; color: var(--muted); margin-bottom: 4px; display: block;">➕ 添加动作步骤：</label>
        <div class="macro-add-toolbar">
          <button type="button" class="ghost" data-add="open">🚀 启动程序/打开</button>
          <button type="button" class="ghost" data-add="delay">⏱️ 等待延迟</button>
          <button type="button" class="ghost" data-add="mouse_click">🖱️ 鼠标点击</button>
          <button type="button" class="ghost" data-add="hotkey">⌨️ 模拟快捷键</button>
          <button type="button" class="ghost" data-add="text">✍️ 键盘输入文本</button>
          <button type="button" class="ghost" data-add="window_rect">📐 窗口尺寸归一化</button>
          <button type="button" class="ghost" data-add="mouse_move">🖱️ 鼠标平移</button>
          <button type="button" class="ghost" data-add="mouse_drag">🖲️ 鼠标拖拽</button>
          <button type="button" class="ghost" data-add="mouse_wheel">🎡 鼠标滚轮</button>
          <button type="button" class="ghost" data-add="cmd">⚡ 命令行 (Cmd/PS)</button>
          <button type="button" class="ghost" data-add="media">🔊 多媒体控制</button>
          <button type="button" class="ghost" data-add="if_color" style="border-color:rgba(245,158,11,0.45);">🎨 条件: 屏幕找色点击</button>
          <button type="button" class="ghost" data-add="if_qr" style="border-color:rgba(245,158,11,0.45);">📷 条件: 扫码判定分支</button>
          <button type="button" class="ghost" data-add="if_process" style="border-color:rgba(245,158,11,0.45);">🔍 条件: 进程状态分支</button>
        </div>
      </div>
    </div>
  `;
}

function wireMacroEditor(box, spec) {
  spec.actions = spec.actions || [];
  spec.loop = spec.loop || { mode: 'once', interval: 50 };

  const modeSel = box.querySelector('#m-loop-mode');
  const timesRow = box.querySelector('#m-loop-times-row');
  const timesInput = box.querySelector('#m-loop-times');
  const intervalInput = box.querySelector('#m-loop-interval');

  if (modeSel) {
    modeSel.addEventListener('change', async () => {
      spec.loop.mode = modeSel.value;
      if (timesRow) timesRow.style.display = spec.loop.mode === 'times' ? '' : 'none';
      await commit(true);
    });
  }
  if (timesInput) {
    timesInput.addEventListener('change', async () => {
      spec.loop.times = Number(timesInput.value) || 5;
      await commit(true);
    });
  }
  if (intervalInput) {
    intervalInput.addEventListener('change', async () => {
      spec.loop.interval = Math.max(20, Number(intervalInput.value) || 50);
      await commit(true);
    });
  }

  const btnRun = box.querySelector('#m-btn-test-run');
  if (btnRun) {
    btnRun.onclick = async () => {
      if (typeof api !== 'undefined' && api.actionRun) {
        toast('正在测试执行宏动作序列…');
        await api.actionRun(spec);
      }
    };
  }
  const btnStop = box.querySelector('#m-btn-stop-all');
  if (btnStop) {
    btnStop.onclick = async () => {
      if (typeof api !== 'undefined' && api.macroStopAll) {
        await api.macroStopAll();
        toast('已发送紧急停止信号');
      }
    };
  }

  box.querySelectorAll('.m-field').forEach((inp) => {
    inp.addEventListener('change', async () => {
      const idx = Number(inp.dataset.idx);
      const fld = inp.dataset.field;
      if (spec.actions[idx]) {
        spec.actions[idx][fld] = inp.type === 'number' ? (inp.value === '' ? '' : Number(inp.value)) : inp.value;
        await commit(true);
      }
    });
  });

  box.querySelectorAll('.m-field-chk').forEach((chk) => {
    chk.addEventListener('change', async () => {
      const idx = Number(chk.dataset.idx);
      const fld = chk.dataset.field;
      if (spec.actions[idx]) {
        spec.actions[idx][fld] = chk.checked;
        await commit(true);
      }
    });
  });

  box.querySelectorAll('.hotkey-builder-wrap[data-macro-idx]').forEach((wrap) => {
    const idx = Number(wrap.dataset.macroIdx);
    bindHotkeyBuilder(wrap, `m-hk-${idx}`, async (val) => {
      if (spec.actions && spec.actions[idx]) {
        spec.actions[idx].target = val;
        spec.actions[idx].combo = val;
        await commit(true);
      }
    });
  });

  box.querySelectorAll('[data-act-tool]').forEach((btn) => {
    btn.onclick = async () => {
      const tool = btn.dataset.actTool;
      const idx = Number(btn.dataset.idx);
      if (tool === 'up' && idx > 0) {
        const tmp = spec.actions[idx - 1];
        spec.actions[idx - 1] = spec.actions[idx];
        spec.actions[idx] = tmp;
      } else if (tool === 'down' && idx < spec.actions.length - 1) {
        const tmp = spec.actions[idx + 1];
        spec.actions[idx + 1] = spec.actions[idx];
        spec.actions[idx] = tmp;
      } else if (tool === 'clone') {
        spec.actions.splice(idx + 1, 0, clone(spec.actions[idx]));
      } else if (tool === 'del') {
        spec.actions.splice(idx, 1);
      }
      await commit(true);
      renderInspector();
    };
  });

  box.querySelectorAll('[data-add]').forEach((btn) => {
    btn.onclick = async () => {
      const type = btn.dataset.add;
      let newAct = { type };
      if (type === 'open') newAct = { type: 'app', target: '', args: '' };
      else if (type === 'delay') newAct = { type: 'delay', ms: 500 };
      else if (type === 'mouse_click') newAct = { type: 'mouse_click', button: 'left', double: false };
      else if (type === 'mouse_move') newAct = { type: 'mouse_move', x: 0, y: 0, duration: 0 };
      else if (type === 'mouse_drag') newAct = { type: 'mouse_drag', fromX: 0, fromY: 0, toX: 200, toY: 200, x1: 0, y1: 0, x2: 200, y2: 200, duration: 300 };
      else if (type === 'mouse_wheel') newAct = { type: 'mouse_wheel', delta: -120 };
      else if (type === 'hotkey') newAct = { type: 'hotkey', target: 'Ctrl+C' };
      else if (type === 'text') newAct = { type: 'text', text: '' };
      else if (type === 'window_rect') newAct = { type: 'window_rect', target: '', x: 0, y: 0, w: 1280, h: 720 };
      else if (type === 'cmd') newAct = { type: 'command', target: '' };
      else if (type === 'media') newAct = { type: 'media', cmd: 'play_pause' };
      else if (type === 'if_color') newAct = { type: 'if_color', x: 500, y: 500, w: 1, h: 1, color: '#00e676', tolerance: 24, thenAction: 'click_found' };
      else if (type === 'if_process') newAct = { type: 'if_process', target: 'obs64.exe', expectRunning: true, thenAction: 'continue' };
      else if (type === 'if_qr') newAct = { type: 'if_qr', thenAction: 'continue' };
      pushHistory('添加宏步骤');
      spec.actions.push(newAct);
      await commit(true);
      renderInspector();
    };
  });

  box.querySelectorAll('.m-pick-coord').forEach((btn) => {
    btn.onclick = () => {
      const idx = Number(btn.dataset.idx);
      const fields = btn.dataset.fields.split(',');
      startCoordinatePicker(btn, async (x, y) => {
        if (spec.actions[idx]) {
          if (fields.length === 2) {
            spec.actions[idx][fields[0]] = x;
            spec.actions[idx][fields[1]] = y;
          }
          await commit(true);
          renderInspector();
        }
      });
    };
  });

  box.querySelectorAll('[data-act-pick="file"]').forEach((btn) => {
    btn.onclick = async () => {
      const idx = Number(btn.dataset.idx);
      if (typeof api !== 'undefined' && api.dialogPick) {
        const r = await api.dialogPick({ properties: ['openFile'] });
        const picked = typeof r === 'string' ? r : (r && r.filePaths && r.filePaths[0]);
        if (picked && spec.actions[idx]) {
          spec.actions[idx].target = picked;
          await commit(true);
          renderInspector();
        }
      }
    };
  });

  box.querySelectorAll('.m-quick-hk').forEach((tag) => {
    tag.onclick = async () => {
      const idx = Number(tag.dataset.idx);
      if (spec.actions[idx]) {
        spec.actions[idx].target = tag.dataset.hk;
        await commit(true);
        renderInspector();
      }
    };
  });

  box.querySelectorAll('.m-quick-delay').forEach((btn) => {
    btn.onclick = async () => {
      const idx = Number(btn.dataset.idx);
      if (spec.actions[idx]) {
        spec.actions[idx].ms = (Number(spec.actions[idx].ms) || 0) + Number(btn.dataset.val);
        await commit(true);
        renderInspector();
      }
    };
  });

  box.querySelectorAll('.m-wheel-set').forEach((btn) => {
    btn.onclick = async () => {
      const idx = Number(btn.dataset.idx);
      if (spec.actions[idx]) {
        spec.actions[idx].delta = Number(btn.dataset.val);
        await commit(true);
        renderInspector();
      }
    };
  });

  box.querySelectorAll('.m-win-preset').forEach((btn) => {
    btn.onclick = async () => {
      const idx = Number(btn.dataset.idx);
      if (spec.actions[idx]) {
        spec.actions[idx].x = Number(btn.dataset.x);
        spec.actions[idx].y = Number(btn.dataset.y);
        spec.actions[idx].w = Number(btn.dataset.w);
        spec.actions[idx].h = Number(btn.dataset.h);
        await commit(true);
        renderInspector();
      }
    };
  });

  box.querySelectorAll('.m-pick-color-coord').forEach((btn) => {
    btn.onclick = () => {
      const idx = Number(btn.dataset.idx);
      startColorCoordPicker(btn, async (x, y, hex) => {
        if (spec.actions[idx]) {
          pushHistory('拾取找色坐标与颜色');
          spec.actions[idx].x = x;
          spec.actions[idx].y = y;
          if (hex) spec.actions[idx].color = hex;
          await commit(true);
          renderInspector();
        }
      });
    };
  });

  const btnRecMacro = box.querySelector('#m-btn-record-macro');
  if (btnRecMacro) {
    btnRecMacro.onclick = async () => {
      if (btnRecMacro.classList.contains('recording')) {
        if (!DEMO && api.macroRecordStop) await api.macroRecordStop();
        return;
      }
      btnRecMacro.classList.add('recording');
      btnRecMacro.textContent = '⏹ 录制中… (按 Esc 结束)';
      toast('🎥 已开启全局键鼠录制：请直接点击屏幕或按键，按 Esc 结束录制');
      try {
        let res = null;
        if (!DEMO && api.macroRecordStart) {
          res = await api.macroRecordStart({ maxSec: 15 });
        } else {
          await new Promise(r => setTimeout(r, 1200));
          res = {
            ok: true,
            actions: [
              { type: 'mouse_click', button: 'left', x: 640, y: 400 },
              { type: 'delay', ms: 350 },
              { type: 'hotkey', target: 'Ctrl+V', combo: 'Ctrl+V' }
            ]
          };
        }
        if (res && Array.isArray(res.actions) && res.actions.length > 0) {
          pushHistory(`录制 ${res.actions.length} 步键鼠宏`);
          spec.actions.push(...res.actions);
          await commit(true);
          renderInspector();
          toast(`✅ 录制完成！已追加 ${res.actions.length} 个真实键鼠动作步骤`);
        } else {
          toast('录制结束，未捕获到新的键鼠操作');
        }
      } catch (err) {
        toast('录制出错：' + (err && err.message));
      } finally {
        const b = box.querySelector('#m-btn-record-macro');
        if (b) {
          b.classList.remove('recording');
          b.textContent = '🔴 开始录制';
        }
      }
    };
  }
}

function renderVolumeEditorHtml(spec, prefix = 'i-vol') {
  const isAppMixer = spec.type === 'app_volume' || String(spec.action || '').startsWith('app_');
  const rawAction = String(spec.action || (isAppMixer ? 'app_mute' : 'up')).replace(/^app_/, '');
  const action = rawAction || 'up';
  const step = Number(spec.step) || (isAppMixer ? 10 : 5);
  const target = spec.target || '';
  const appTarget = spec.appTarget || spec.target || '@foreground';
  const isMute = lastAudioState ? lastAudioState.isMute : false;
  const curVol = lastAudioState ? lastAudioState.volume : 50;

  return `
    <div class="volume-editor-card" data-vol-prefix="${prefix}">
      <div class="row" style="margin-bottom: 8px;">
        <label style="font-size: 11px; color: var(--muted); margin-bottom: 4px; display: block;">🎚️ 音频控制层级：</label>
        <div class="color-capsule-group">
          <button type="button" class="color-capsule-pill ${!isAppMixer ? 'active' : ''}" data-vol-scope="master">🔊 系统主音量 (WASAPI)</button>
          <button type="button" class="color-capsule-pill ${isAppMixer ? 'active' : ''}" data-vol-scope="app">🎚️ 应用级独立混音 (Per-App)</button>
        </div>
      </div>

      ${isAppMixer ? `
        <div class="vol-sub-row" style="margin-bottom: 8px;">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
            <label style="font-size:11px; color:var(--muted); margin:0;">🎯 目标音频进程：</label>
            <button type="button" class="ghost tiny" id="${prefix}-refresh-apps" style="padding:2px 6px;">🔄 扫描正在发声的应用</button>
          </div>
          <div style="display:flex; gap:6px;">
            <select id="${prefix}-app-select" style="flex:1;">
              <option value="@foreground" ${appTarget === '@foreground' ? 'selected' : ''}>🎯 当前前台活动应用/游戏 (@foreground)</option>
              <option value="cloudmusic" ${appTarget === 'cloudmusic' ? 'selected' : ''}>🎵 网易云音乐 (cloudmusic)</option>
              <option value="qqmusic" ${appTarget === 'qqmusic' ? 'selected' : ''}>🎶 QQ 音乐 (qqmusic)</option>
              <option value="spotify" ${appTarget === 'spotify' ? 'selected' : ''}>🎧 Spotify</option>
              <option value="discord" ${appTarget === 'discord' ? 'selected' : ''}>🎙️ Discord 语音</option>
              <option value="chrome" ${appTarget === 'chrome' ? 'selected' : ''}>🌐 Chrome 浏览器</option>
            </select>
            <input id="${prefix}-app-custom" value="${escapeAttr(appTarget)}" placeholder="进程名或 @foreground" style="width:128px; font-size:11.5px;" />
          </div>
        </div>
      ` : ''}

      <div class="vol-mode-row">
        <label style="font-size: 11px; color: var(--muted); margin-bottom: 6px; display: block;">⚡ 控制动作：</label>
        <div class="vol-mode-pills">
          <button type="button" class="vol-pill ${action === 'up' ? 'active' : ''}" data-act="up">🔊 增大音量</button>
          <button type="button" class="vol-pill ${action === 'down' ? 'active' : ''}" data-act="down">🔉 减小音量</button>
          <button type="button" class="vol-pill ${action === 'mute' ? 'active' : ''}" data-act="mute">🔇 静音 / 恢复</button>
          <button type="button" class="vol-pill ${action === 'set' ? 'active' : ''}" data-act="set">🎚️ 设为指定音量</button>
          ${!isAppMixer ? `<button type="button" class="vol-pill ${action === 'switch_device' ? 'active' : ''}" data-act="switch_device">🎧 切换输出声卡</button>` : ''}
        </div>
      </div>

      ${(action === 'up' || action === 'down') ? `
        <div class="vol-sub-row" style="margin-top: 8px;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
            <label style="font-size: 11px; color: var(--muted); margin: 0;">调节步长：</label>
            <span style="font-size: 12px; font-weight: bold; color: var(--accent);"><b id="${prefix}-v-step">${step}</b>%</span>
          </div>
          <div class="vol-step-pills">
            ${[2, 5, 8, 10, 15, 20].map(s => `
              <button type="button" class="vol-step-pill ${step === s ? 'active' : ''}" data-step="${s}">±${s}%</button>
            `).join('')}
          </div>
          <input type="range" id="${prefix}-step-range" min="1" max="25" value="${step}" style="margin-top: 6px; width: 100%;" />
        </div>
      ` : ''}

      ${action === 'set' ? `
        <div class="vol-sub-row" style="margin-top: 8px;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
            <label style="font-size: 11px; color: var(--muted); margin: 0;">🎯 目标音量绝对值：</label>
            <span style="font-size: 12px; font-weight: bold; color: var(--accent);"><b id="${prefix}-v-target">${spec.level !== undefined ? spec.level : (target || '50')}</b>%</span>
          </div>
          <div class="vol-step-pills">
            ${[0, 20, 35, 50, 65, 80, 100].map(val => `
              <button type="button" class="vol-target-pill ${String(spec.level !== undefined ? spec.level : target) === String(val) ? 'active' : ''}" data-val="${val}">${val}%</button>
            `).join('')}
          </div>
          <input type="range" id="${prefix}-target-range" min="0" max="100" value="${spec.level !== undefined ? spec.level : (target || 50)}" style="margin-top: 6px; width: 100%;" />
        </div>
      ` : ''}

      ${(!isAppMixer && action === 'switch_device') ? `
        <div class="vol-sub-row" style="margin-top: 8px;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
            <label style="font-size: 11px; color: var(--muted); margin: 0;">🎯 目标输出设备（留空则智能轮换）：</label>
            <button type="button" class="ghost tiny" id="${prefix}-refresh-devs" style="padding: 2px 6px;">🔄 刷新声卡</button>
          </div>
          <select id="${prefix}-device-select" class="vol-dev-select" style="width: 100%; margin-top: 4px;">
            <option value="">🔄 耳机 ⇄ 音箱 智能轮换 (默认)</option>
          </select>
          <p class="muted small" style="margin-top: 4px;">采用 Windows IPolicyConfig 底层无感切换默认声卡，毫秒级即时生效。</p>
        </div>
      ` : ''}

      <div class="vol-status-card" style="margin-top: 10px; padding: 8px 10px; background: rgba(0,0,0,0.18); border-radius: 6px; display: flex; align-items: center; justify-content: space-between;">
        <div style="display: flex; align-items: center; gap: 8px;">
          <span id="i-vol-cur-icon" style="font-size: 18px;">${isMute ? '🔇' : '🔊'}</span>
          <span style="font-size: 12px; color: var(--fg);">${isAppMixer ? `目标：<b>${escapeHtml(appTarget)}</b>` : `系统音量：<b id="i-vol-cur-level">${isMute ? '已静音' : curVol + '%'}</b>`}</span>
        </div>
        <button type="button" class="primary tiny" id="${prefix}-test-now" style="padding: 3px 12px;">▶ 立即测试</button>
      </div>
    </div>
  `;
}

function wireVolumeEditor(box, spec, prefix = 'i-vol', isSubAction = false) {
  const card = box.querySelector(`.volume-editor-card[data-vol-prefix="${prefix}"]`) || box;

  card.querySelectorAll('[data-vol-scope]').forEach((btn) => {
    btn.onclick = async () => {
      const scope = btn.dataset.volScope;
      if (scope === 'app') {
        spec.type = 'app_volume';
        spec.appTarget = spec.appTarget || '@foreground';
        spec.action = 'app_' + String(spec.action || 'mute').replace(/^app_/, '').replace('switch_device', 'mute');
        spec.step = spec.step || 10;
        if (!isSubAction && (!spec.label || spec.label.startsWith('音量') || spec.label === '静音切换')) {
          spec.label = '应用混音';
        }
      } else {
        spec.type = 'volume';
        spec.action = String(spec.action || 'up').replace(/^app_/, '');
        spec.step = spec.step || 5;
      }
      await commit(true);
      renderInspector();
    };
  });

  const appSel = card.querySelector(`#${prefix}-app-select`);
  const appCustom = card.querySelector(`#${prefix}-app-custom`);
  const btnRefreshApps = card.querySelector(`#${prefix}-refresh-apps`);
  const loadAppSessions = async () => {
    if (!appSel || typeof api === 'undefined' || !api.audioListAppSessions) return;
    try {
      const sessions = await api.audioListAppSessions();
      if (Array.isArray(sessions) && sessions.length > 0) {
        const curT = spec.appTarget || spec.target || '@foreground';
        appSel.innerHTML = `<option value="@foreground" ${curT === '@foreground' ? 'selected' : ''}>🎯 当前前台活动应用/游戏 (@foreground)</option>` +
          sessions.map((s) => `<option value="${escapeAttr(s.processName)}" ${curT.toLowerCase() === s.processName.toLowerCase() ? 'selected' : ''}>🔊 ${escapeHtml(s.processName)} (${s.isMute ? '静音' : s.level + '%'})</option>`).join('');
      }
    } catch (_) {}
  };
  if (appSel) {
    loadAppSessions();
    appSel.onchange = async () => {
      spec.appTarget = appSel.value;
      spec.target = appSel.value;
      if (appCustom) appCustom.value = appSel.value;
      await commit(true);
    };
  }
  if (appCustom) {
    appCustom.onchange = async () => {
      spec.appTarget = appCustom.value.trim() || '@foreground';
      spec.target = spec.appTarget;
      await commit(true);
      renderInspector();
    };
  }
  if (btnRefreshApps) {
    btnRefreshApps.onclick = async () => {
      await loadAppSessions();
      toast('已刷新正在发声的应用程序列表');
    };
  }

  card.querySelectorAll('.vol-pill').forEach((btn) => {
    btn.onclick = async () => {
      const act = btn.dataset.act;
      const isApp = spec.type === 'app_volume' || String(spec.action || '').startsWith('app_');
      // 关键修复：绝不在点击音量模式胶囊时重置 spec.toggleAction 或删除 spec.action2！
      spec.action = isApp ? ('app_' + act) : act;
      if (act === 'up') {
        spec.step = spec.step || (isApp ? 10 : 5);
        if (!isSubAction) {
          spec.label = isApp ? '应用音量+' : '音量 +';
          spec.color = '#1565c0';
          if (typeof BUILTIN_ICONS !== 'undefined') {
            const ic = BUILTIN_ICONS.find(i => i.name === '音量+');
            if (ic) spec.icon = svgToDataUrl(ic.svg, '#ffffff');
          }
        }
      } else if (act === 'down') {
        spec.step = spec.step || (isApp ? 10 : 5);
        if (!isSubAction) {
          spec.label = isApp ? '应用音量-' : '音量 -';
          spec.color = '#1565c0';
          if (typeof BUILTIN_ICONS !== 'undefined') {
            const ic = BUILTIN_ICONS.find(i => i.name === '音量-');
            if (ic) spec.icon = svgToDataUrl(ic.svg, '#ffffff');
          }
        }
      } else if (act === 'mute') {
        if (!isSubAction) {
          spec.label = isApp ? '应用静音' : '静音切换';
          spec.color = '#c62828';
          if (!spec.toggleAction) {
            spec.badgeToggle = false;
            spec.badgeState1 = { text: '🔊', bg: '#107c41', color: '#ffffff' };
            spec.badgeState2 = { text: '🔇', bg: '#e53935', color: '#ffffff' };
          }
          if (typeof BUILTIN_ICONS !== 'undefined') {
            const ic = BUILTIN_ICONS.find(i => i.name === '静音');
            if (ic) spec.icon = svgToDataUrl(ic.svg, '#ffffff');
          }
        }
      } else if (act === 'set') {
        spec.level = Number(spec.level !== undefined ? spec.level : (spec.target || 50)) || 50;
        if (!isApp) spec.target = String(spec.level);
        if (!isSubAction) {
          spec.label = `${isApp ? '应用' : '音量'} ${spec.level}%`;
          spec.color = '#00838f';
        }
      } else if (act === 'switch_device') {
        if (!isSubAction) {
          spec.label = '切换输出';
          spec.color = '#6a1b9a';
          if (typeof BUILTIN_ICONS !== 'undefined') {
            const ic = BUILTIN_ICONS.find(i => i.name === '耳机');
            if (ic) spec.icon = svgToDataUrl(ic.svg, '#ffffff');
          }
        }
      }
      await commit(true);
      renderInspector();
    };
  });

  card.querySelectorAll('.vol-step-pill').forEach((btn) => {
    btn.onclick = async () => {
      spec.step = Number(btn.dataset.step) || 5;
      await commit(true);
      renderInspector();
    };
  });

  const stepRange = card.querySelector(`#${prefix}-step-range`);
  const vStep = card.querySelector(`#${prefix}-v-step`);
  if (stepRange && vStep) {
    stepRange.addEventListener('input', () => {
      vStep.textContent = stepRange.value;
      spec.step = Number(stepRange.value);
    });
    stepRange.addEventListener('change', async () => {
      await commit(true);
      renderInspector();
    });
  }

  card.querySelectorAll('.vol-target-pill').forEach((btn) => {
    btn.onclick = async () => {
      const val = btn.dataset.val;
      spec.level = Number(val);
      if (spec.type !== 'app_volume') spec.target = val;
      if (!isSubAction) spec.label = `音量 ${val}%`;
      await commit(true);
      renderInspector();
    };
  });

  const targetRange = card.querySelector(`#${prefix}-target-range`);
  const vTarget = card.querySelector(`#${prefix}-v-target`);
  if (targetRange && vTarget) {
    targetRange.addEventListener('input', () => {
      vTarget.textContent = targetRange.value;
      spec.level = Number(targetRange.value);
      if (spec.type !== 'app_volume') spec.target = targetRange.value;
      if (!isSubAction) spec.label = `音量 ${targetRange.value}%`;
    });
    targetRange.addEventListener('change', async () => {
      await commit(true);
      renderInspector();
    });
  }

  const devSelect = card.querySelector(`#${prefix}-device-select`);
  const btnRefreshDevs = card.querySelector(`#${prefix}-refresh-devs`);
  const loadDevices = async () => {
    if (!devSelect || typeof api === 'undefined' || !api.audioGetDevices) return;
    try {
      const res = await api.audioGetDevices();
      const devs = Array.isArray(res) ? res : (res && res.devices ? res.devices : []);
      if (devs && devs.length > 0) {
        devSelect.innerHTML = `<option value="">🔄 耳机 ⇄ 音箱 智能轮换 (默认)</option>` +
          devs.map(d => `<option value="${escapeAttr(d.name)}" ${spec.target === d.name ? 'selected' : ''}>${d.isDefault ? '🔊 [默认] ' : '🔈 '}${escapeHtml(d.name)}</option>`).join('');
      }
    } catch (_) {}
  };
  if (devSelect) {
    loadDevices();
    devSelect.onchange = async () => {
      spec.target = devSelect.value;
      await commit(true);
    };
  }
  if (btnRefreshDevs) {
    btnRefreshDevs.onclick = async () => {
      toast('正在探测 Windows 音频输出设备…');
      await loadDevices();
    };
  }

  const btnTest = card.querySelector(`#${prefix}-test-now`);
  if (btnTest) {
    btnTest.onclick = async () => {
      if (typeof api === 'undefined' || !api.actionRun) return;
      btnTest.disabled = true;
      try {
        const res = await api.actionRun(spec);
        if (res && res.ok) {
          toast('✅ 音频动作测试执行成功');
        } else {
          toast('动作执行失败: ' + ((res && res.error) || '请确认目标进程正在发声'));
        }
      } catch (err) {
        toast('执行出错: ' + (err.message || err));
      } finally {
        btnTest.disabled = false;
      }
    };
  }
}

let lastSwapSyncBadges = false;

const ACTION_PAYLOAD_KEYS = [
  'type', 'target', 'args', 'hotkey', 'action', 'step', 'level', 'appTarget',
  'cmd', 'mode', 'pageId', 'profileId', 'widgetKind', 'pluginId', 'pluginConfig',
  'watchProcess', 'actions', 'loop'
];

function extractActionPayload(src) {
  if (!src) return { type: 'command', target: '', args: '', hotkey: '' };
  const out = {};
  for (const k of ACTION_PAYLOAD_KEYS) {
    if (src[k] !== undefined) {
      out[k] = (typeof src[k] === 'object' && src[k] !== null) ? clone(src[k]) : src[k];
    }
  }
  out.type = out.type || 'app';
  out.target = out.target || '';
  out.args = out.args || '';
  out.hotkey = out.hotkey || (out.type === 'hotkey' ? (out.target || '') : '');
  return out;
}

function applyActionPayload(dst, payload) {
  if (!dst || !payload) return dst;
  for (const k of ACTION_PAYLOAD_KEYS) {
    delete dst[k];
  }
  for (const k of ACTION_PAYLOAD_KEYS) {
    if (payload[k] !== undefined) {
      dst[k] = (typeof payload[k] === 'object' && payload[k] !== null) ? clone(payload[k]) : payload[k];
    }
  }
  dst.type = dst.type || 'app';
  return dst;
}

function isActionConfigured(act) {
  if (!act || !act.type) return false;
  if (['volume', 'audio', 'app_volume', 'media', 'page', 'profile', 'qr_decode', 'qr', 'widget', 'window_toggle', 'plugin_action'].includes(act.type)) return true;
  if ((act.type === 'multi' || act.type === 'macro') && Array.isArray(act.actions) && act.actions.length > 0) return true;
  return !!(act.target || act.hotkey);
}

function renderMediaEditorHtml(spec, prefix = 'i-media') {
  const curCmd = String(spec.cmd || spec.action || spec.target || 'play_pause').toLowerCase();
  const cmds = [
    { id: 'play_pause', label: '⏯️ 播放 / 暂停' },
    { id: 'next', label: '⏭️ 下一首' },
    { id: 'prev', label: '⏮️ 上一首' },
    { id: 'mute', label: '🔇 媒体静音' },
    { id: 'vol_up', label: '🔊 音量 +' },
    { id: 'vol_down', label: '🔉 音量 -' },
  ];
  return `
    <div class="volume-editor-card" data-media-prefix="${prefix}" style="margin-top:6px;">
      <label style="font-size:11px; color:var(--muted); margin-bottom:6px; display:block;">⏯️ 选择多媒体控制指令：</label>
      <div class="vol-mode-pills">
        ${cmds.map((c) => `
          <button type="button" class="vol-pill ${curCmd.includes(c.id) ? 'active' : ''}" data-media-cmd="${c.id}">${c.label}</button>
        `).join('')}
      </div>
    </div>
  `;
}

function wireMediaEditor(box, spec, prefix = 'i-media', isSubAction = false) {
  const card = box.querySelector(`[data-media-prefix="${prefix}"]`);
  if (!card) return;
  card.querySelectorAll('[data-media-cmd]').forEach((btn) => {
    btn.onclick = async () => {
      const cmd = btn.dataset.mediaCmd;
      spec.cmd = cmd;
      spec.action = cmd;
      spec.target = cmd;
      if (!isSubAction) {
        const lblMap = { play_pause: '播放/暂停', next: '下一曲', prev: '上一曲', mute: '静音', vol_up: '音量 +', vol_down: '音量 -' };
        spec.label = lblMap[cmd] || cmd;
      }
      await commit(true);
      renderInspector();
    };
  });
}

function renderPluginActionEditorHtml(spec, prefix = 'i-plgact') {
  const pid = spec.pluginId || 'obs_studio';
  const act = spec.action || 'toggle_record';
  return `
    <div class="volume-editor-card" data-plgact-prefix="${prefix}" style="margin-top:6px;">
      <div class="row">
        <label style="font-size:11px;">🧩 目标双向插件</label>
        <select id="${prefix}-plugin">
          <option value="obs_studio" ${pid === 'obs_studio' ? 'selected' : ''}>🎬 OBS Studio WebSocket v5 导播台</option>
          <option value="app_volume_mixer" ${pid === 'app_volume_mixer' ? 'selected' : ''}>🎚️ 系统应用级独立混音器 (Per-App)</option>
          <option value="home_assistant_switch" ${pid === 'home_assistant_switch' ? 'selected' : ''}>🏠 HomeAssistant / Webhook 智能家居节点</option>
        </select>
      </div>
      <div class="row" style="margin-top:6px;">
        <label style="font-size:11px;">⚡ 触发插件指令</label>
        <select id="${prefix}-action">
          ${pid === 'obs_studio' ? `
            <option value="toggle_record" ${act === 'toggle_record' ? 'selected' : ''}>⏺️ 启停录制 (Toggle Record)</option>
            <option value="toggle_stream" ${act === 'toggle_stream' ? 'selected' : ''}>🔴 启停推流 (Toggle Stream)</option>
            <option value="switch_scene" ${act === 'switch_scene' ? 'selected' : ''}>🎬 切换场景 (Switch Scene)</option>
            <option value="toggle_mic" ${act === 'toggle_mic' ? 'selected' : ''}>🎙️ 麦克风静音切换 (Toggle Mic)</option>
          ` : pid === 'app_volume_mixer' ? `
            <option value="toggle_mute" ${act === 'toggle_mute' ? 'selected' : ''}>🔇 切换当前应用静音</option>
            <option value="vol_up" ${act === 'vol_up' ? 'selected' : ''}>🔊 当前应用音量 +10%</option>
            <option value="vol_down" ${act === 'vol_down' ? 'selected' : ''}>🔉 当前应用音量 -10%</option>
            <option value="cycle_app" ${act === 'cycle_app' ? 'selected' : ''}>🔄 轮换活动音频应用</option>
          ` : `
            <option value="toggle" ${act === 'toggle' ? 'selected' : ''}>🔄 翻转智能家居实体开关 / 触发 Webhook</option>
          `}
        </select>
      </div>
    </div>
  `;
}

function wirePluginActionEditor(box, spec, prefix = 'i-plgact') {
  const selPlg = box.querySelector(`#${prefix}-plugin`);
  const selAct = box.querySelector(`#${prefix}-action`);
  if (selPlg) {
    selPlg.onchange = async () => {
      spec.pluginId = selPlg.value;
      spec.target = selPlg.value;
      spec.action = selPlg.value === 'obs_studio' ? 'toggle_record' : (selPlg.value === 'app_volume_mixer' ? 'toggle_mute' : 'toggle');
      await commit(true);
      renderInspector();
    };
  }
  if (selAct) {
    selAct.onchange = async () => {
      spec.action = selAct.value;
      await commit(true);
      renderInspector();
    };
  }
}

const WIDGET_KIND_INFOS = [
  { id: 'gpu', icon: '🎮', name: 'GPU 温度与显存', desc: '实时显示核心温度、负载、显存与趋势线', color: '#0f291e', act: 'refresh' },
  { id: 'net', icon: '🌐', name: '实时网速上下行', desc: '实时监控网卡吞吐速率与历史波形', color: '#0c1e35', act: 'refresh' },
  { id: 'pomodoro', icon: '🍅', name: '番茄钟专注倒计时', desc: '按键即启停/重置专注倒计时进度', color: '#7f1d1d', act: 'pomodoro_toggle' },
  { id: 'weather', icon: '🌤️', name: '实时天气与温湿度', desc: '自动或指定城市天气状况与温湿度', color: '#102a43', act: 'refresh' },
  { id: 'media_now', icon: '🎵', name: 'SMTC 音乐与桌面歌词', desc: '系统媒体会话、黑胶封面与同步歌词', color: '#2e1065', act: 'media_play_pause' },
  { id: 'obs', icon: '🔴', name: 'OBS 推流/录制监控', desc: '实时监控 OBS Studio 在线与直播态', color: '#1e293b', act: 'refresh' },
  { id: 'plugin', icon: '🧩', name: '可视化画布插件', desc: '支持折线图/推子柱图/SVG 的插件市场', color: '#0f172a', act: 'plugin_click' },
  { id: 'composite', icon: '🎨', name: '自由图层画布 (Studio)', desc: '多图层叠加 CPU/GPU/网速/电平/波形与独立刷新率', color: '#0f172a', act: 'refresh' },
];

function openPluginMarketModal(onSelectPlugin) {
  const wrap = document.createElement('div');
  wrap.className = 'modal';
  wrap.id = 'pluginMarketModal';
  const catalog = BUILTIN_MARKET_PLUGINS;

  wrap.innerHTML = `
    <div class="modalbox" style="width: 680px; max-width: 94vw; padding: 16px 20px;">
      <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:12px; padding-bottom:10px; border-bottom:1px solid var(--line);">
        <div>
          <h3 style="margin:0; font-size:15px;">🛍️ AKP153 可视化画布插件中心 (v0.9 Plugin API)</h3>
          <div style="font-size:11.5px; color:var(--muted); margin-top:3px;">支持 Sparkline 折线图、Bars 多路推子、SVG 矢量图标与 Badge 状态角标渲染</div>
        </div>
        <div style="display:flex; gap:6px; align-items:center;">
          <button type="button" class="ghost tiny" id="pmInstallLocalBtn">📦 安装本地 .plugin.js</button>
          <button type="button" class="ghost tiny" id="pmCloseBtn">✕ 关闭</button>
        </div>
      </div>
      <div class="plugin-market-grid" style="display:grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap:10px; max-height: 76vh; overflow-y:auto; padding-right:4px;">
        ${catalog.map(p => `
          <div class="plugin-market-card" data-pid="${escapeAttr(p.id)}" style="background:var(--bg); border:1px solid var(--line); border-radius:10px; padding:11px 12px; display:flex; flex-direction:column; gap:7px;">
            <div style="display:flex; align-items:center; justify-content:space-between; gap:6px;">
              <span style="font-weight:700; font-size:13px; color:var(--ink);">${escapeHtml(p.icon || '🧩')} ${escapeHtml(p.name)}</span>
              <span style="font-size:10px; padding:2px 7px; border-radius:999px; background:var(--accent-subtle); color:var(--accent); font-weight:600;">${escapeHtml(p.category)}</span>
            </div>
            <div style="font-size:11.5px; color:var(--muted); line-height:1.45;">${escapeHtml(p.description)}</div>
            <div style="display:flex; flex-wrap:wrap; gap:4px; margin-top:auto;">
              ${(p.features || []).map(f => `<span style="font-size:10px; padding:1px 6px; border-radius:4px; background:rgba(56,189,248,0.12); color:var(--ink);">${escapeHtml(f)}</span>`).join('')}
            </div>
            <button type="button" class="primary tiny pm-use-btn" data-pid="${escapeAttr(p.id)}" style="margin-top:4px; width:100%;">⚡ 立即绑定此插件</button>
          </div>
        `).join('')}
      </div>
    </div>
  `;
  document.body.appendChild(wrap);
  const close = () => wrap.remove();
  wrap.querySelector('#pmCloseBtn').onclick = close;
  const installBtn = wrap.querySelector('#pmInstallLocalBtn');
  if (installBtn) {
    installBtn.onclick = async () => {
      if (!DEMO && api.pluginsInstall) {
        const res = await api.pluginsInstall('__pick__');
        if (res && res.ok && Array.isArray(res.plugins)) {
          cachedPluginSchemas = res.plugins;
          toast(`✅ 插件安装成功，共加载 ${res.plugins.length} 个插件`);
          close();
          renderInspector();
        }
      } else {
        toast('预览模式下不支持安装本地文件');
      }
    };
  }
  wrap.addEventListener('click', (e) => { if (e.target === wrap) close(); });
  wrap.querySelectorAll('.pm-use-btn').forEach(btn => {
    btn.onclick = () => {
      const pid = btn.dataset.pid;
      const meta = catalog.find(x => x.id === pid) || catalog[0];
      close();
      if (onSelectPlugin) onSelectPlugin(meta);
    };
  });
}

function getPluginSchemaForId(pluginId) {
  const normId = String(pluginId || 'uptime_greeting').replace(/-/g, '_');
  const fromLoaded = (cachedPluginSchemas || []).find(p => p && String(p.id).replace(/-/g, '_') === normId);
  if (fromLoaded && Array.isArray(fromLoaded.configSchema) && fromLoaded.configSchema.length) {
    return fromLoaded.configSchema;
  }
  const fromBuiltin = BUILTIN_MARKET_PLUGINS.find(p => p && String(p.id).replace(/-/g, '_') === normId);
  return (fromBuiltin && Array.isArray(fromBuiltin.configSchema)) ? fromBuiltin.configSchema : [];
}

function renderPluginSchemaBoxHtml(pluginId, pluginConfig = {}, idPrefix = 'i-plgcfg-') {
  const schema = getPluginSchemaForId(pluginId);
  if (!schema || !schema.length) return '';
  return `
    <div class="plugin-schema-box" id="${idPrefix}box">
      <div class="plugin-schema-title">
        <span>🔌 插件参数配置 (Schema Config)</span>
        <span style="font-size:10px; opacity:0.75;">自动持久化至 spec.pluginConfig</span>
      </div>
      ${schema.map(f => {
        const curVal = (pluginConfig && pluginConfig[f.key] !== undefined)
          ? pluginConfig[f.key]
          : (f.default !== undefined ? f.default : '');
        const fid = `${idPrefix}${f.key}`;
        if (f.type === 'select' && Array.isArray(f.options)) {
          return `
            <div class="plugin-schema-field">
              <label for="${escapeAttr(fid)}">${escapeHtml(f.label || f.key)}</label>
              <select id="${escapeAttr(fid)}" data-schema-key="${escapeAttr(f.key)}" data-schema-type="select">
                ${f.options.map(opt => {
                  const val = typeof opt === 'object' ? opt.value : opt;
                  const lbl = typeof opt === 'object' ? opt.label : opt;
                  return `<option value="${escapeAttr(String(val))}" ${String(curVal) === String(val) ? 'selected' : ''}>${escapeHtml(String(lbl))}</option>`;
                }).join('')}
              </select>
            </div>
          `;
        }
        const inputType = f.type === 'number' ? 'number' : (f.type === 'password' ? 'password' : 'text');
        return `
          <div class="plugin-schema-field">
            <label for="${escapeAttr(fid)}">${escapeHtml(f.label || f.key)}</label>
            <input id="${escapeAttr(fid)}" type="${inputType}" data-schema-key="${escapeAttr(f.key)}" data-schema-type="${inputType}" value="${escapeAttr(String(curVal))}" placeholder="${escapeAttr(f.placeholder || '')}" />
          </div>
        `;
      }).join('')}
    </div>
  `;
}

function wirePluginSchemaBox(rootEl, pluginId, targetSpec, idPrefix = 'i-plgcfg-', onUpdated = null) {
  const box = rootEl.querySelector(`#${idPrefix}box`);
  if (!box || !targetSpec) return;
  const normId = String(pluginId || targetSpec.pluginId || 'uptime_greeting').replace(/-/g, '_');
  box.querySelectorAll('[data-schema-key]').forEach((el) => {
    const key = el.dataset.schemaKey;
    const stype = el.dataset.schemaType;
    const handler = async () => {
      pushHistory('修改插件配置参数');
      if (!targetSpec.pluginConfig || typeof targetSpec.pluginConfig !== 'object') {
        targetSpec.pluginConfig = {};
      }
      targetSpec.pluginConfig[key] = stype === 'number' ? (Number(el.value) || 0) : el.value;
      if (!DEMO && api.pluginsEvaluate) {
        try {
          const evaluated = await api.pluginsEvaluate(normId, targetSpec.pluginConfig);
          if (evaluated && lastTelemetry && lastTelemetry.plugins) {
            if (Array.isArray(lastTelemetry.plugins)) {
              const idx = lastTelemetry.plugins.findIndex(p => p && String(p.id).replace(/-/g, '_') === normId);
              if (idx >= 0) lastTelemetry.plugins[idx] = evaluated;
              else lastTelemetry.plugins.push(evaluated);
            }
            lastTelemetry.plugins[normId] = evaluated;
          }
        } catch (_) {}
      }
      await commit(true);
      if (onUpdated) onUpdated();
    };
    if (el.tagName === 'SELECT') el.addEventListener('change', handler);
    else el.addEventListener('change', handler);
  });
}

const WIDGET_FREQ_OPTIONS = [
  { ms: 180, label: '⚡ 180ms 极速电平' },
  { ms: 500, label: '🚀 500ms 高帧监控' },
  { ms: 1000, label: '⏱️ 1.0s 秒级实时' },
  { ms: 2500, label: '⚖️ 2.5s 标准均衡' },
  { ms: 10000, label: '🌱 10s 节能低刷' },
  { ms: 60000, label: '☁️ 60s 慢速轮询' },
];

const STUDIO_LAYER_SOURCES = [
  { id: 'cpu_load', label: '🧠 CPU 负载 (%)' },
  { id: 'gpu_temp', label: '🎮 GPU 温度/核心' },
  { id: 'net_speed', label: '🌐 实时下行网速' },
  { id: 'mem_usage', label: '💾 内存占用 (%)' },
  { id: 'audio_vol', label: '🔊 主音量/静音' },
  { id: 'audio_bars', label: '🎚️ 多路声卡峰值电平条' },
  { id: 'clock_time', label: '🕒 实时时钟 (HH:mm)' },
  { id: 'sparkline_gpu', label: '📈 GPU 历史趋势波形' },
  { id: 'sparkline_cpu', label: '📈 CPU 历史趋势波形' },
  { id: 'sparkline_net', label: '📈 网速吞吐趋势波形' },
];

const STUDIO_LAYER_SLOTS = [
  { id: 'top', label: '⬆️ 顶部标题栏' },
  { id: 'middle', label: '🎯 中央主数值' },
  { id: 'bottom', label: '⬇️ 底部副指标' },
  { id: 'background', label: '🌊 背景折线图' },
  { id: 'bars', label: '📊 多路电平柱图' },
  { id: 'progress', label: '📏 底部进度条' },
];

function renderWidgetEditorHtml(spec) {
  const kind = spec.widgetKind || 'gpu';
  const act = spec.action || (kind === 'pomodoro' ? 'pomodoro_toggle' : (kind === 'media_now' ? 'media_play_pause' : (kind === 'plugin' ? 'plugin_click' : 'refresh')));
  const curCol = (selected && selected.col !== undefined && selected.col < KEY_COLS) ? selected.col : 0;
  const maxSpan = Math.max(1, Math.min(3, KEY_COLS - curCol));
  const curSpan = Math.max(1, Math.min(maxSpan, Number(spec.spanCols) || 1));
  const rawPlugins = (lastTelemetry && Array.isArray(lastTelemetry.plugins) && lastTelemetry.plugins.length)
    ? lastTelemetry.plugins
    : BUILTIN_MARKET_PLUGINS;
  const curPluginId = String(spec.pluginId || 'uptime_greeting').replace(/-/g, '_');
  const curFreq = Number(spec.refreshIntervalMs) || (kind === 'plugin' && curPluginId === 'audio_fader_meter' ? 180 : 2500);
  const hasCustomLayers = (kind === 'composite') || (Array.isArray(spec.widgetLayers) && spec.widgetLayers.length > 0);
  const layers = (Array.isArray(spec.widgetLayers) && spec.widgetLayers.length > 0)
    ? spec.widgetLayers
    : (kind === 'composite' ? JSON.parse(JSON.stringify(DEFAULT_COMPOSITE_LAYERS)) : []);

  return `
    <div class="widget-editor-card">
      <div>
        <label style="font-size: 11px; color: var(--muted); margin-bottom: 6px; display: block;">📊 选择实时数据源组件：</label>
        <div class="widget-kind-grid">
          ${WIDGET_KIND_INFOS.map(w => `
            <button type="button" class="widget-kind-pill ${kind === w.id ? 'active' : ''}" data-kind="${w.id}">
              <span style="font-size:15px;">${w.icon}</span>
              <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${w.name}</span>
            </button>
          `).join('')}
        </div>
      </div>

      <div class="row" style="margin-top: 8px; margin-bottom: 0;">
        <label>⏱️ 独立刷新频率调度 (Per-Widget Refresh Rate)</label>
        <div class="ws-freq-pills" id="i-widget-freq-group">
          ${WIDGET_FREQ_OPTIONS.map(f => `
            <button type="button" class="ws-freq-pill ${curFreq === f.ms ? 'active' : ''}" data-freq="${f.ms}">${f.label}</button>
          `).join('')}
        </div>
      </div>

      <div class="row" style="margin-top: 8px; margin-bottom: 0;">
        <label>📏 跨格联合画布宽度 (Multi-Key Span 宽屏模式)</label>
        <div class="color-capsule-group" id="i-widget-span-group">
          <button type="button" class="color-capsule-pill widget-span-pill ${curSpan === 1 ? 'active' : ''}" data-span="1">1×1 标准单格</button>
          <button type="button" class="color-capsule-pill widget-span-pill ${curSpan === 2 ? 'active' : ''}" data-span="2" ${maxSpan < 2 ? 'disabled title="右侧剩余格子不足 2 格"' : ''}>2×1 双联宽屏</button>
          <button type="button" class="color-capsule-pill widget-span-pill ${curSpan === 3 ? 'active' : ''}" data-span="3" ${maxSpan < 3 ? 'disabled title="右侧剩余格子不足 3 格"' : ''}>3×1 三联超宽</button>
        </div>
        ${curSpan > 1 ? `<div style="font-size:11px; color:var(--accent); margin-top:4px;">🔗 已开启 ${curSpan}×1 跨格宽屏联屏（自动展开实时趋势折线图 / 多路电平条）</div>` : ''}
      </div>

      <!-- Widget Studio 可视化多图层编排器 -->
      <div class="widget-studio-box">
        <div class="ws-head">
          <span class="ws-title">🎨 可视化小组件图层编排工坊 (Widget Studio)</span>
          <div style="display:flex; gap:4px;">
            <button type="button" class="ghost tiny" id="i-ws-add-layer">＋ 添加图层</button>
            ${hasCustomLayers ? `<button type="button" class="ghost tiny danger" id="i-ws-reset-layers">重置</button>` : ''}
          </div>
        </div>
        ${hasCustomLayers ? `
          <div class="ws-layer-list" id="i-ws-layer-list">
            ${layers.map((ly, idx) => `
              <div class="ws-layer-row" data-layer-idx="${idx}">
                <select class="ws-layer-source" data-idx="${idx}" style="flex:1.2;">
                  ${STUDIO_LAYER_SOURCES.map(src => `<option value="${src.id}" ${ly.source === src.id ? 'selected' : ''}>${src.label}</option>`).join('')}
                </select>
                <select class="ws-layer-slot" data-idx="${idx}" style="flex:1;">
                  ${STUDIO_LAYER_SLOTS.map(sl => `<option value="${sl.id}" ${ly.slot === sl.id ? 'selected' : ''}>${sl.label}</option>`).join('')}
                </select>
                <input type="color" class="ws-layer-color" data-idx="${idx}" value="${ly.color || '#38bdf8'}" style="width:24px; height:22px; padding:0; border:none; border-radius:4px; cursor:pointer;" title="图层主色调" />
                <button type="button" class="ws-layer-btn ws-layer-up" data-idx="${idx}" title="上移图层">↑</button>
                <button type="button" class="ws-layer-btn ws-layer-del" data-idx="${idx}" title="删除图层">✕</button>
              </div>
            `).join('')}
          </div>
        ` : `
          <div style="font-size:11px; color:var(--muted);">💡 点击「＋ 添加图层」或选择「自由图层画布」即可在同一按键上自由组合 CPU、GPU、网速、音频峰值与趋势折线。</div>
        `}
      </div>

      <div class="row" style="margin-top: 6px; margin-bottom: 0;">
        <label>按下该组件按键时的交互动作</label>
        <select id="i-widget-action">
          <option value="pomodoro_toggle" ${act === 'pomodoro_toggle' ? 'selected' : ''}>🍅 番茄钟：开始 / 暂停倒计时</option>
          <option value="pomodoro_reset" ${act === 'pomodoro_reset' ? 'selected' : ''}>🔄 番茄钟：重置倒计时</option>
          <option value="media_play_pause" ${act === 'media_play_pause' ? 'selected' : ''}>⏯️ 音乐：播放 / 暂停切换 (3联屏支持左/中/右切歌)</option>
          <option value="media_next" ${act === 'media_next' ? 'selected' : ''}>⏭️ 音乐：切到下一首</option>
          <option value="refresh" ${act === 'refresh' ? 'selected' : ''}>⚡ 立即刷新实时监控数据</option>
          <option value="open_taskmgr" ${act === 'open_taskmgr' ? 'selected' : ''}>📊 打开系统任务管理器 (taskmgr)</option>
          <option value="plugin_click" ${act === 'plugin_click' ? 'selected' : ''}>🧩 触发 JS 插件 onPress 交互钩子</option>
        </select>
      </div>

      ${kind === 'plugin' ? `
        <div class="row" style="margin-top: 6px; margin-bottom: 0;">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:5px; gap:6px;">
            <label style="margin:0;">选择可视化画布插件</label>
            <div style="display:flex; gap:4px;">
              <button type="button" class="primary tiny" id="i-widget-open-market">🛍️ 插件市场 (${BUILTIN_MARKET_PLUGINS.length})</button>
              <button type="button" class="ghost tiny" id="i-widget-reload-plugins">🔄 重载</button>
            </div>
          </div>
          <select id="i-widget-plugin-id">
            ${rawPlugins.map(p => {
              const pid = String(p.id || '').replace(/-/g, '_');
              return `<option value="${escapeAttr(pid)}" ${curPluginId === pid ? 'selected' : ''}>${escapeHtml(p.icon || '🧩')} ${escapeHtml(p.name || p.title || pid)}</option>`;
            }).join('')}
          </select>
          ${renderPluginSchemaBoxHtml(curPluginId, spec.pluginConfig || {}, 'i-plgcfg-')}
        </div>
      ` : ''}

      ${kind === 'pomodoro' ? `
        <div class="btnrow" style="margin-top: 6px; margin-bottom: 0;">
          <button type="button" class="ghost tiny" id="i-pomo-toggle" style="flex:1;">⏯️ 启停番茄钟</button>
          <button type="button" class="ghost tiny" id="i-pomo-reset" style="flex:1;">↺ 重置 (${(cfg && cfg.pomodoroMinutes) || 25}分钟)</button>
        </div>
      ` : ''}
    </div>
  `;
}

function wireWidgetEditor(box, spec) {
  box.querySelectorAll('.widget-kind-pill').forEach((btn) => {
    btn.onclick = async () => {
      pushHistory('切换实时组件类型');
      const kind = btn.dataset.kind;
      const info = WIDGET_KIND_INFOS.find(x => x.id === kind) || WIDGET_KIND_INFOS[0];
      spec.widgetKind = kind;
      spec.action = info.act;
      if (kind === 'plugin' && !spec.pluginId) spec.pluginId = 'uptime_greeting';
      if (kind === 'composite' && (!Array.isArray(spec.widgetLayers) || !spec.widgetLayers.length)) {
        spec.widgetLayers = JSON.parse(JSON.stringify(DEFAULT_COMPOSITE_LAYERS));
      } else if (kind !== 'composite') {
        delete spec.widgetLayers;
      }
      spec.label = info.name.split(' ')[0];
      spec.color = info.color;
      await commit(true);
      renderInspector();
    };
  });

  box.querySelectorAll('.ws-freq-pill').forEach((btn) => {
    btn.onclick = async () => {
      const ms = Math.max(150, Number(btn.dataset.freq) || 2500);
      spec.refreshIntervalMs = ms;
      await commit(false);
      renderInspector();
      toast(`⏱️ 已将该组件独立刷新周期设为 ${ms < 1000 ? ms + 'ms' : (ms / 1000) + 's'}`);
    };
  });

  const ensureLayers = () => {
    if (!Array.isArray(spec.widgetLayers) || !spec.widgetLayers.length) {
      spec.widgetLayers = JSON.parse(JSON.stringify(DEFAULT_COMPOSITE_LAYERS));
    }
    spec.widgetKind = 'composite';
  };

  const btnAddLayer = box.querySelector('#i-ws-add-layer');
  if (btnAddLayer) {
    btnAddLayer.onclick = async () => {
      pushHistory('添加小组件编排图层');
      if (!Array.isArray(spec.widgetLayers) || !spec.widgetLayers.length) {
        spec.widgetLayers = JSON.parse(JSON.stringify(DEFAULT_COMPOSITE_LAYERS));
      } else {
        spec.widgetLayers.push({
          id: 'ly_' + Date.now().toString(36),
          source: 'audio_vol',
          slot: 'bottom',
          color: '#38bdf8',
          label: 'VOL',
        });
      }
      spec.widgetKind = 'composite';
      await commit(true);
      renderInspector();
    };
  }

  const btnResetLayers = box.querySelector('#i-ws-reset-layers');
  if (btnResetLayers) {
    btnResetLayers.onclick = async () => {
      pushHistory('重置小组件图层');
      delete spec.widgetLayers;
      if (spec.widgetKind === 'composite') {
        spec.widgetLayers = JSON.parse(JSON.stringify(DEFAULT_COMPOSITE_LAYERS));
      }
      await commit(true);
      renderInspector();
    };
  }

  box.querySelectorAll('.ws-layer-source').forEach((sel) => {
    sel.onchange = async () => {
      ensureLayers();
      const idx = Number(sel.dataset.idx);
      if (spec.widgetLayers[idx]) {
        spec.widgetLayers[idx].source = sel.value;
        await commit(true);
        renderInspector();
      }
    };
  });

  box.querySelectorAll('.ws-layer-slot').forEach((sel) => {
    sel.onchange = async () => {
      ensureLayers();
      const idx = Number(sel.dataset.idx);
      if (spec.widgetLayers[idx]) {
        spec.widgetLayers[idx].slot = sel.value;
        await commit(true);
        renderInspector();
      }
    };
  });

  box.querySelectorAll('.ws-layer-color').forEach((inp) => {
    inp.onchange = async () => {
      ensureLayers();
      const idx = Number(inp.dataset.idx);
      if (spec.widgetLayers[idx]) {
        spec.widgetLayers[idx].color = inp.value;
        await commit(true);
      }
    };
  });

  box.querySelectorAll('.ws-layer-up').forEach((btn) => {
    btn.onclick = async () => {
      ensureLayers();
      const idx = Number(btn.dataset.idx);
      if (idx > 0 && spec.widgetLayers[idx]) {
        const tmp = spec.widgetLayers[idx - 1];
        spec.widgetLayers[idx - 1] = spec.widgetLayers[idx];
        spec.widgetLayers[idx] = tmp;
        await commit(true);
        renderInspector();
      }
    };
  });

  box.querySelectorAll('.ws-layer-del').forEach((btn) => {
    btn.onclick = async () => {
      ensureLayers();
      const idx = Number(btn.dataset.idx);
      spec.widgetLayers.splice(idx, 1);
      await commit(true);
      renderInspector();
    };
  });

  box.querySelectorAll('.widget-span-pill').forEach((btn) => {
    btn.onclick = async () => {
      if (btn.disabled) return;
      const span = Math.max(1, Math.min(3, Number(btn.dataset.span) || 1));
      pushHistory(`设置组件跨格联屏 ${span}×1`);
      if (span > 1 && selected && selected.col < KEY_COLS) {
        const btns = pageButtons();
        for (let k = 1; k < span && (selected.col + k) < KEY_COLS; k++) {
          const nk = `${selected.row},${selected.col + k}`;
          if (btns[nk]) delete btns[nk];
        }
      }
      if (span === 1) delete spec.spanCols;
      else spec.spanCols = span;
      await commit(true);
      renderInspector();
      toast(span > 1 ? `🔗 已合并为 ${span}×1 跨格联合宽屏画布` : '已恢复为 1×1 标准单格组件');
    };
  });

  const actSel = box.querySelector('#i-widget-action');
  if (actSel) {
    actSel.onchange = async () => {
      spec.action = actSel.value;
      await commit(true);
    };
  }
  const plgSel = box.querySelector('#i-widget-plugin-id');
  if (plgSel) {
    plgSel.onchange = async () => {
      spec.pluginId = plgSel.value;
      const meta = BUILTIN_MARKET_PLUGINS.find(x => x.id === plgSel.value);
      if (meta) {
        spec.label = meta.name;
        spec.color = meta.color;
      }
      await commit(true);
      renderInspector();
    };
  }
  const btnMarket = box.querySelector('#i-widget-open-market');
  if (btnMarket) {
    btnMarket.onclick = () => {
      openPluginMarketModal(async (meta) => {
        spec.widgetKind = 'plugin';
        spec.pluginId = meta.id;
        spec.action = 'plugin_click';
        spec.label = meta.name;
        spec.color = meta.color;
        await commit(true);
        renderInspector();
        toast(`✅ 已绑定插件：「${meta.name}」`);
      });
    };
  }
  wirePluginSchemaBox(box, spec.pluginId || 'uptime_greeting', spec, 'i-plgcfg-', () => {
    refreshGrid();
  });
  const btnReloadPlg = box.querySelector('#i-widget-reload-plugins');
  if (btnReloadPlg) {
    btnReloadPlg.onclick = async () => {
      if (!DEMO && api.pluginsReload) {
        const list = await api.pluginsReload();
        toast(`已重新扫描加载 ${Array.isArray(list) ? list.length : BUILTIN_MARKET_PLUGINS.length} 个外部 JS 插件`);
        renderInspector();
      } else {
        toast(`已加载内置与社区插件共 ${BUILTIN_MARKET_PLUGINS.length} 个`);
      }
    };
  }
  const btnPomoToggle = box.querySelector('#i-pomo-toggle');
  if (btnPomoToggle) {
    btnPomoToggle.onclick = async () => {
      const mins = (cfg && cfg.pomodoroMinutes) || 25;
      if (!DEMO && (api.pomodoroControl || api.pomodoroAction)) {
        const fn = api.pomodoroControl || api.pomodoroAction;
        const snap = await fn('toggle', mins);
        if (snap) lastTelemetry.pomodoro = snap;
      } else {
        lastTelemetry.pomodoro.running = !lastTelemetry.pomodoro.running;
      }
      refreshGrid();
      if (selected) await pushKey(selected.row, selected.col);
      toast(lastTelemetry.pomodoro.running ? '🍅 番茄专注已启动' : '⏸ 番茄专注已暂停');
    };
  }
  const btnPomoReset = box.querySelector('#i-pomo-reset');
  if (btnPomoReset) {
    btnPomoReset.onclick = async () => {
      const mins = (cfg && cfg.pomodoroMinutes) || 25;
      if (!DEMO && (api.pomodoroControl || api.pomodoroAction)) {
        const fn = api.pomodoroControl || api.pomodoroAction;
        const snap = await fn('reset', mins);
        if (snap) lastTelemetry.pomodoro = snap;
      } else {
        lastTelemetry.pomodoro = { running: false, phase: 'work', remainSec: mins * 60, remainingSec: mins * 60, totalSec: mins * 60, formatted: `${String(mins).padStart(2, '0')}:00`, progressPct: 0 };
      }
      refreshGrid();
      if (selected) await pushKey(selected.row, selected.col);
      toast('↺ 番茄钟已重置');
    };
  }
}

function renderBatchInspector(box) {
  const coords = Array.from(multiSelected).map(k => {
    const [r, c] = k.split(',').map(Number);
    return { key: k, row: r, col: c };
  });
  const firstSpec = pageButtons()[coords[0].key] || { color: '#37474f', fontSize: 17, iconScale: 62, labelPos: 'bottom' };
  const grad = curPage().gradient;

  box.className = 'inspector';
  box.innerHTML = `
    <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:10px; padding-bottom:8px; border-bottom:1px solid var(--line);">
      <div>
        <div style="font-size:13px; font-weight:700; color:var(--ink);">🎨 批量样式工作台 (已选 ${coords.length} 格)</div>
        <div style="font-size:11px; color:var(--muted);">按住 Ctrl 或 Shift 点击面板格子可增减多选范围</div>
      </div>
      <button type="button" class="ghost tiny" id="b-clear-sel">取消多选</button>
    </div>

    ${grad && grad.enabled ? `
      <div class="row">
        <label>批量底色模式</label>
        <div class="color-capsule-group">
          <button type="button" id="b-mode-grad" class="color-capsule-pill ${!firstSpec.customColor ? 'active' : ''}">🌈 跟随整板流光</button>
          <button type="button" id="b-mode-custom" class="color-capsule-pill ${firstSpec.customColor ? 'active' : ''}">🎨 统一独立底色</button>
        </div>
      </div>
    ` : ''}

    <div class="stylegrid" style="margin-bottom:10px;">
      <span>统一底色</span><input id="b-color" type="color" value="${firstSpec.color || '#37474f'}" />
      <span>渐变底色</span><input id="b-color2" type="color" value="${firstSpec.color2 || '#37474f'}" />
    </div>

    <div class="row">
      <label>快捷色卡一键着色</label>
      <div style="display:flex; gap:6px; flex-wrap:wrap; margin-top:4px;">
        ${['#1565c0', '#2e7d32', '#c62828', '#6a1b9a', '#ef6c00', '#00838f', '#37474f', '#1e293b'].map(c => `
          <span class="lkm-cchip b-cchip" data-c="${c}" style="background:${c}; width:22px; height:22px;"></span>
        `).join('')}
      </div>
    </div>

    <div class="tc-capsule-row">
      <span class="tc-label">统一文字色</span>
      <div class="color-capsule-group">
        <button type="button" id="b-tc-auto" class="color-capsule-pill">⚡ 自动对比色</button>
        <button type="button" id="b-tc-white" class="color-capsule-pill">⚪ 纯白文字</button>
      </div>
    </div>

    <div class="stylegrid" style="margin-top:8px;">
      <span>字号 <b id="b-v-font">${Number(firstSpec.fontSize) || 17}</b>%</span>
      <input id="b-fontsize" type="range" min="8" max="40" value="${Number(firstSpec.fontSize) || 17}" />
      <span>图标 <b id="b-v-icon">${Number(firstSpec.iconScale) || 62}</b>%</span>
      <input id="b-iconscale" type="range" min="25" max="100" value="${Number(firstSpec.iconScale) || 62}" />
      <span>文字对齐</span>
      <select id="b-labelpos">
        <option value="bottom" ${(firstSpec.labelPos || 'bottom') === 'bottom' ? 'selected' : ''}>底部</option>
        <option value="center" ${firstSpec.labelPos === 'center' ? 'selected' : ''}>居中</option>
        <option value="top" ${firstSpec.labelPos === 'top' ? 'selected' : ''}>顶部</option>
      </select>
    </div>

    <div class="insp-foot-actions">
      <button type="button" class="primary act-main" id="b-push-all">↻ 同步重画所选 (${coords.length})</button>
      <button type="button" class="ghost danger act-sub" id="b-del-all">🗑️ 批量清空</button>
    </div>
  `;

  const applyBatch = async (mutator, reason = '批量修改样式') => {
    pushHistory(reason);
    for (const { key, row, col } of coords) {
      if (col === 5 || isBackCell(row, col)) continue;
      if (!pageButtons()[key]) continue;
      mutator(pageButtons()[key]);
    }
    refreshGrid();
    await saveConfig();
    if (!DEMO) {
      for (const { row, col } of coords) await pushKey(row, col);
    }
  };

  $('b-clear-sel').onclick = () => {
    multiSelected.clear();
    refreshGrid();
    renderInspector();
  };

  if ($('b-mode-grad')) {
    $('b-mode-grad').onclick = () => applyBatch(s => { delete s.customColor; }, '批量设为整板流光');
  }
  if ($('b-mode-custom')) {
    $('b-mode-custom').onclick = () => applyBatch(s => { s.customColor = true; }, '批量设为独立底色');
  }

  $('b-color').onchange = (e) => applyBatch(s => { s.color = e.target.value; s.customColor = true; }, '批量修改底色');
  $('b-color2').onchange = (e) => applyBatch(s => { s.color2 = e.target.value; s.customColor = true; }, '批量修改渐变色');

  box.querySelectorAll('.b-cchip').forEach(chip => {
    chip.onclick = () => {
      const c = chip.dataset.c;
      $('b-color').value = c;
      applyBatch(s => { s.color = c; delete s.color2; s.customColor = true; }, '批量应用色卡');
    };
  });

  $('b-tc-auto').onclick = () => applyBatch(s => { s.textColor = ''; }, '批量设为自动文字对比色');
  $('b-tc-white').onclick = () => applyBatch(s => { s.textColor = '#ffffff'; }, '批量设为纯白文字');

  $('b-fontsize').oninput = (e) => { $('b-v-font').textContent = e.target.value; };
  $('b-fontsize').onchange = (e) => applyBatch(s => { s.fontSize = Number(e.target.value); }, '批量调整字号');

  $('b-iconscale').oninput = (e) => { $('b-v-icon').textContent = e.target.value; };
  $('b-iconscale').onchange = (e) => applyBatch(s => { s.iconScale = Number(e.target.value); }, '批量调整图标缩放');

  $('b-labelpos').onchange = (e) => applyBatch(s => { s.labelPos = e.target.value; }, '批量调整文字对齐');

  $('b-push-all').onclick = async () => {
    if (!DEMO) {
      for (const { row, col } of coords) await pushKey(row, col, true);
    }
    toast(`已同步重画选中的 ${coords.length} 个按键`);
  };

  $('b-del-all').onclick = async () => {
    if (!(await askConfirm('批量清空按键', `确定要清空选中的 ${coords.length} 个按键格子吗？（可按 Ctrl+Z 撤销）`))) return;
    pushHistory(`批量清空 ${coords.length} 个按键`);
    for (const { key, row, col } of coords) {
      await stopKeyMacroIfNeeded(row, col);
      delete pageButtons()[key];
    }
    multiSelected.clear();
    await saveConfig();
    refreshGrid();
    renderInspector();
    if (!DEMO) await repaintAllKeys();
    toast(`已批量清空 ${coords.length} 个按键`);
  };
}

function renderInspector() {
  stopCurrentHkRecorder(null);
  const box = $('inspector');
  const title = $('inspectorTitle');
  const inspTabs = $('inspTabs');

  if (multiSelected.size > 1) {
    if (inspTabs) inspTabs.hidden = true;
    title.textContent = `批量编辑 · 已选 ${multiSelected.size} 格`;
    return renderBatchInspector(box);
  }

  if (!selected) {
    if (inspTabs) inspTabs.hidden = true;
    title.textContent = '页面设置 · 整板渐变';
    return renderPageInspector(box);
  }
  if (selected.col === 5) {
    if (inspTabs) inspTabs.hidden = true;
    title.textContent = `显示屏 ${selected.row + 1}`;
    return renderStripInspector(box);
  }

  title.textContent = `按键 r${selected.row}c${selected.col}`;

  if (isBackCell(selected.row, selected.col)) {
    if (inspTabs) inspTabs.hidden = true;
    box.className = 'inspector';
    box.innerHTML = `
      <p class="muted"><b>这是子页的自动返回键。</b></p>
      <p class="muted">子页（文件夹）的右下角一定长着它，按一下就回到上一级 ——
      位置永远一样，闭眼也按得到。你不用配它，也不能覆盖它。</p>
      <p class="path">当前页：「${escapeHtml(curPage().name)}」是子页${
        pageById(curPage().parent) ? '，上级是「' + escapeHtml(pageById(curPage().parent).name) + '」' : ''}。</p>
      <div class="btnrow"><button class="ghost" id="i-goup">现在回到上一级</button></div>`;
    $('i-goup').onclick = () => goToPage(curPage().parent);
    return;
  }

  const key = selected.row + ',' + selected.col;
  const spec = pageButtons()[key];
  if (!spec) {
    if (inspTabs) inspTabs.hidden = true;
    box.className = 'inspector empty';
    box.innerHTML = `<p class="muted">r${selected.row}c${selected.col} 还是空的 —— 拖入文件/快捷方式，或一键选择动作类型：</p>
      <div class="quick-switch-grid">
        <button class="ghost" id="i-pickapp">🚀 选择程序…</button>
        <button class="ghost" id="i-pickdir">📁 选择文件夹…</button>
        <button class="ghost" id="i-quickurl">🌐 填网址…</button>
        <button class="ghost" id="i-quickcmd">⌘ 填命令…</button>
        <button class="ghost" id="i-quickmacro">🎛️ 设为复合宏…</button>
        <button class="ghost" id="i-quickhotkey">⌨️ 设为快捷键…</button>
        <button class="ghost" id="i-quickvol">🔊 设为音量…</button>
        <button class="ghost" id="i-quickwidget">📊 设为实时组件…</button>
        <button class="ghost" id="i-page">↦ 设为翻页键…</button>
      </div>`;
    $('i-pickapp').onclick = () => pickInto({ properties: ['openFile'] });
    $('i-pickdir').onclick = () => pickInto({ properties: ['openDirectory'] });
    $('i-quickurl').onclick = () => quickSet('url');
    $('i-quickcmd').onclick = () => quickSet('command');
    $('i-quickmacro').onclick = () => {
      pageButtons()[selected.row + ',' + selected.col] = {
        type: 'multi', label: '新宏动作', color: '#1b5e20',
        actions: [],
        loop: { mode: 'once', interval: 50 }
      };
      commit(true);
      renderInspector();
    };
    $('i-quickhotkey').onclick = () => {
      pageButtons()[selected.row + ',' + selected.col] = {
        type: 'hotkey', label: '显示桌面', hotkey: 'Win+D', target: 'Win+D', color: '#107c41', icon: '', args: ''
      };
      commit(true);
      renderInspector();
    };
    if ($('i-quickwidget')) {
      $('i-quickwidget').onclick = () => {
        pushHistory('新建实时动态组件');
        pageButtons()[selected.row + ',' + selected.col] = {
          type: 'widget', widgetKind: 'pomodoro', action: 'pomodoro_toggle', label: '番茄钟', color: '#7f1d1d'
        };
        commit(true);
        renderInspector();
      };
    }
    $('i-quickvol').onclick = () => {
      pushHistory('新建音量控制键');
      pageButtons()[selected.row + ',' + selected.col] = {
        type: 'volume', action: 'up', step: 5, label: '音量 +', color: '#1565c0'
      };
      if (typeof BUILTIN_ICONS !== 'undefined') {
        const ic = BUILTIN_ICONS.find(i => i.name === '音量+');
        if (ic) pageButtons()[selected.row + ',' + selected.col].icon = svgToDataUrl(ic.svg, '#ffffff');
      }
      commit(true);
      renderInspector();
    };
    $('i-page').onclick = async () => {
      const r = await askPageAction(null);
      if (!r) return;
      pageButtons()[selected.row + ',' + selected.col] = makePageSpec(r.mode, r.pageId);
      await commit(true);
      renderInspector();
    };
    return;
  }

  if (inspTabs) inspTabs.hidden = false;

  const curBadge = getActiveBadge(spec);
  const curBadgeState = (spec._activeState !== undefined) ? spec._activeState : (spec.badgeInitialState || 0);

  const t = (id, val) => `<input id="${id}" value="${escapeAttr(val)}" />`;
  box.className = 'inspector';
  box.innerHTML = `
    <details class="sec" data-sec="action" ${secOpen.action ? 'open' : ''}>
      <summary>按键动作配置</summary>
      <div class="body">
        <div class="row">
          <label>动作模式</label>
          <div class="color-capsule-group">
            <button type="button" id="i-toggle-act-single" class="color-capsule-pill ${!spec.toggleAction ? 'active' : ''}">🟢 单一动作</button>
            <button type="button" id="i-toggle-act-dual" class="color-capsule-pill ${spec.toggleAction ? 'active' : ''}">⚡ 双态独立动作</button>
          </div>
        </div>

        ${!spec.toggleAction ? `
          <div id="i-single-action-box">
            <div class="row" style="display:grid; grid-template-columns: 1fr 1fr; gap:6px; margin-bottom:8px;">
              <div>
                <label>动作类型</label>
                <select id="i-type">
                  ${Object.keys(TYPE_NAMES).map((x) =>
                    `<option value="${x}" ${spec.type === x ? 'selected' : ''}>${TYPE_SHORT[x] ? TYPE_SHORT[x] + ' · ' : ''}${TYPE_NAMES[x].replace(/^[^\s]+\s/, '')}</option>`).join('')}
                </select>
              </div>
              <div>
                <label>快捷模板预设</label>
                <select id="i-quickpreset" class="quick-preset-select">
                  ${ACTION_TEMPLATES.map((t) => `<option value="${t.id}">${t.name}</option>`).join('')}
                </select>
              </div>
            </div>
            <div class="quick-switch-compact" style="${['multi', 'macro', 'widget', 'volume', 'audio', 'page'].includes(spec.type) ? 'display:none;' : ''}">
              <button class="ghost" id="i-pickapp" title="浏览并绑定本地程序">🚀 选程序</button>
              <button class="ghost" id="i-pickdir" title="浏览并绑定本地文件夹">📁 选目录</button>
              <button class="ghost" id="i-pickurl" title="一键设为打开网址">🌐 设网址</button>
              <button class="ghost" id="i-pickcmd" title="一键设为执行命令行">⌘ 设命令</button>
              <button class="ghost" id="i-pickmacro" title="切换为多步复合宏与键鼠录制">🎛️ 复合宏</button>
              <button class="ghost" id="i-pickhotkey" title="切换为系统快捷键">⌨️ 快捷键</button>
              <button class="ghost" id="i-pickvol" title="切换为 WASAPI 音量控制">🔊 调音量</button>
              <button class="ghost" id="i-page" title="切换为页面跳转键">↦ 翻页键</button>
            </div>
            ${spec.type === 'hotkey' ? `
              <div class="row">
                <label>快捷键组合（支持免冲突点选、录制或直接输入）</label>
                ${renderHotkeyBuilderHtml('i-hotkey', spec.hotkey || spec.target || '')}
              </div>
            ` : ''}

            ${spec.type === 'multi' || spec.type === 'macro' ? `
              <div id="i-macro-editor-container">
                ${renderMacroEditorHtml(spec)}
              </div>
            ` : (spec.type === 'volume' || spec.type === 'audio' || spec.type === 'app_volume') ? `
              <div id="i-volume-editor-container">
                ${renderVolumeEditorHtml(spec, 'i-vol')}
              </div>
            ` : spec.type === 'media' ? `
              <div id="i-media-editor-container">
                ${renderMediaEditorHtml(spec, 'i-media')}
              </div>
            ` : spec.type === 'plugin_action' ? `
              <div id="i-plgact-editor-container">
                ${renderPluginActionEditorHtml(spec, 'i-plgact')}
              </div>
            ` : spec.type === 'widget' ? `
              <div id="i-widget-editor-container">
                ${renderWidgetEditorHtml(spec)}
              </div>
            ` : spec.type === 'page' ? `
              <div class="page-inspector-card">
                <div class="page-insp-head">
                  <span class="page-insp-label">${(PAGE_MODE_INFOS.find(m => m.id === (spec.mode || 'next')) || {}).icon || '📄'} ${escapeHtml(pageActionLabel(spec))}</span>
                  <span class="page-insp-badge">模式: ${escapeHtml(spec.mode || 'next')}</span>
                </div>
                <div style="font-size: 11px; color: var(--muted); margin-top: 2px;">快速切换翻页行为：</div>
                <div class="page-mode-pills">
                  ${PAGE_MODE_INFOS.map((m) => `
                    <button type="button" class="page-pill ${(spec.mode || 'next') === m.id ? 'active' : ''}" data-mode="${m.id}">
                      ${m.icon} ${m.name}
                    </button>
                  `).join('')}
                </div>
                ${(spec.mode === 'goto') ? `
                  <div class="page-target-wrap" style="margin-top: 6px;">
                    <label style="font-size: 11px; color: var(--muted); margin-bottom: 4px; display: block;">🎯 目标跳转页面：</label>
                    <select id="i-page-target-select" class="page-select-styled">
                      ${pageTree().map(({ page, depth }) => `
                        <option value="${page.id}" ${spec.pageId === page.id ? 'selected' : ''}>
                          ${'　'.repeat(depth)}${depth ? '↳ ' : ''}${escapeHtml(page.name)}
                        </option>
                      `).join('')}
                    </select>
                  </div>
                ` : ''}
                <p class="path" style="font-size: 11px; color: var(--muted); margin-top: 6px;">实际目标：切至「${escapeHtml(pageActionLabel(spec))}」</p>
                <button type="button" class="ghost tiny" id="i-page-open-modal" style="width: 100%; margin-top: 6px;">
                  ⚙️ 打开高级翻页配置器…
                </button>
              </div>
            ` : spec.type === 'profile' ? `
              <div class="page-inspector-card">
                <div class="page-insp-head">
                  <span class="page-insp-label">🗂️ 整机模式热切 (Profile)</span>
                  <span class="page-insp-badge">模式: ${escapeHtml(spec.mode || 'next')}</span>
                </div>
                <div class="row" style="margin-top:8px;">
                  <label>切换方式</label>
                  <select id="i-profile-mode-select">
                    <option value="next" ${(spec.mode || 'next') === 'next' ? 'selected' : ''}>🔄 顺序循环切换下一套模式</option>
                    <option value="prev" ${spec.mode === 'prev' ? 'selected' : ''}>⏮️ 逆序切换上一套模式</option>
                    <option value="goto" ${spec.mode === 'goto' ? 'selected' : ''}>🎯 切换到指定模式 (Profile)</option>
                  </select>
                </div>
                ${spec.mode === 'goto' ? `
                  <div class="row" style="margin-top:6px;">
                    <label>目标配置文件模式</label>
                    <select id="i-profile-target-select">
                      ${((cfg && cfg.profiles) || []).map(pr => `
                        <option value="${escapeAttr(pr.id)}" ${spec.profileId === pr.id ? 'selected' : ''}>${escapeHtml(pr.icon || '🗂️')} ${escapeHtml(pr.name)}</option>
                      `).join('')}
                    </select>
                  </div>
                ` : ''}
              </div>
            ` : `
              <div class="row">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
                  <label style="margin: 0;">目标（程序 / 路径 / 网址 / 命令 / 快捷键）</label>
                  ${spec.type === 'url' ? `
                    <button type="button" id="i-fetch-favicon" class="icon-fetch-btn" title="联网探测并抓取该网址的网站图标 (Favicon)">
                      <span>🌐</span> 抓取网站图标
                    </button>
                  ` : ''}
                </div>
                <textarea id="i-target">${escapeHtml(spec.target || '')}</textarea>
              </div>
              <div class="row"><label>参数（可留空）</label>${t('i-args', spec.args || '')}</div>
              <p class="path">实际目标：${escapeHtml(spec.target || '(空)')}</p>
            `}
          </div>
          <div id="i-toggle-action2-box" style="display: none;"></div>
        ` : `
          <div id="i-single-action-box" style="display: none;"></div>
          <div id="i-toggle-action2-box" class="dual-action-container">
            <!-- 双形态分段切换导航条 -->
            <div class="dual-form-switcher">
              <button type="button" class="dual-form-tab ${dualInspectorViewMode === 'form1' ? 'active' : ''}" data-dual-view="form1">🟢 形态 1 (默认)</button>
              <button type="button" class="dual-form-tab ${dualInspectorViewMode === 'form2' ? 'active' : ''}" data-dual-view="form2">⚡ 形态 2 (触发)</button>
              <button type="button" class="dual-form-tab ${dualInspectorViewMode === 'both' ? 'active' : ''}" data-dual-view="both" title="同时展开形态 1 与形态 2">↕ 双栏</button>
            </div>

            <!-- 形态 1 卡片 -->
            <div class="dual-action-card state1-card" style="${dualInspectorViewMode === 'form2' ? 'display:none;' : ''}">
              <div class="dual-action-head">
                <div class="dual-head-left">
                  <span class="dual-dot state1-dot"></span>
                  <span class="dual-title">形态 1 · 默认动作</span>
                </div>
                <span class="dual-tag tag-state1">默认态 (State 1)</span>
              </div>
              <div class="btnrow" style="margin-top: 6px;">
                <button class="ghost tiny" id="i-pickapp">选择程序…</button>
                <button class="ghost tiny" id="i-pickdir">选择文件夹…</button>
                <button class="ghost tiny" id="i-pickhotkey">设为快捷键</button>
                <button class="ghost tiny" id="i-pickcmd">设为命令</button>
              </div>
              <div class="row" style="margin-top: 6px;"><label style="font-size: 11px;">形态 1 动作类型</label>
                <select id="i-type">
                  ${Object.keys(TYPE_NAMES).map((x) =>
                    `<option value="${x}" ${spec.type === x ? 'selected' : ''}>${TYPE_NAMES[x]}</option>`).join('')}
                </select>
              </div>
              ${spec.type === 'hotkey' ? `
                <div class="row" style="margin-top: 6px;">
                  <label style="font-size: 11px;">形态 1 快捷键组合</label>
                  ${renderHotkeyBuilderHtml('i-hotkey', spec.hotkey || spec.target || '')}
                </div>
              ` : spec.type === 'multi' || spec.type === 'macro' ? `
                <div id="i-macro-editor-container">
                  ${renderMacroEditorHtml(spec)}
                </div>
              ` : (spec.type === 'volume' || spec.type === 'audio' || spec.type === 'app_volume') ? `
                <div id="i-volume-editor-container">
                  ${renderVolumeEditorHtml(spec, 'i-vol')}
                </div>
              ` : spec.type === 'media' ? `
                <div id="i-media-editor-container">
                  ${renderMediaEditorHtml(spec, 'i-media')}
                </div>
              ` : spec.type === 'plugin_action' ? `
                <div id="i-plgact-editor-container">
                  ${renderPluginActionEditorHtml(spec, 'i-plgact')}
                </div>
              ` : spec.type === 'widget' ? `
                <div id="i-widget-editor-container">
                  ${renderWidgetEditorHtml(spec)}
                </div>
              ` : spec.type === 'page' ? `
                <div class="page-inspector-card" style="margin-top: 6px;">
                  <div class="page-insp-head">
                    <span class="page-insp-label">${(PAGE_MODE_INFOS.find(m => m.id === (spec.mode || 'next')) || {}).icon || '📄'} ${escapeHtml(pageActionLabel(spec))}</span>
                    <span class="page-insp-badge">模式: ${escapeHtml(spec.mode || 'next')}</span>
                  </div>
                  <div class="page-mode-pills">
                    ${PAGE_MODE_INFOS.map((m) => `
                      <button type="button" class="page-pill ${(spec.mode || 'next') === m.id ? 'active' : ''}" data-mode="${m.id}">
                        ${m.icon} ${m.name}
                      </button>
                    `).join('')}
                  </div>
                  ${(spec.mode === 'goto') ? `
                    <div class="page-target-wrap" style="margin-top: 6px;">
                      <label style="font-size: 11px; color: var(--muted); margin-bottom: 4px; display: block;">🎯 目标跳转页面：</label>
                      <select id="i-page-target-select" class="page-select-styled">
                        ${pageTree().map(({ page, depth }) => `
                          <option value="${page.id}" ${spec.pageId === page.id ? 'selected' : ''}>
                            ${'　'.repeat(depth)}${depth ? '↳ ' : ''}${escapeHtml(page.name)}
                          </option>
                        `).join('')}
                      </select>
                    </div>
                  ` : ''}
                </div>
              ` : spec.type === 'profile' ? `
                <div class="page-inspector-card" style="margin-top: 6px;">
                  <div class="row">
                    <label style="font-size:11px;">切换整机模式方式</label>
                    <select id="i-profile-mode-select">
                      <option value="next" ${(spec.mode || 'next') === 'next' ? 'selected' : ''}>🔄 顺序切换下一套模式</option>
                      <option value="prev" ${spec.mode === 'prev' ? 'selected' : ''}>⏮️ 切换上一套模式</option>
                      <option value="goto" ${spec.mode === 'goto' ? 'selected' : ''}>🎯 切换到指定模式</option>
                    </select>
                  </div>
                  ${spec.mode === 'goto' ? `
                    <div class="row" style="margin-top:6px;">
                      <select id="i-profile-target-select">
                        ${((cfg && cfg.profiles) || []).map(pr => `
                          <option value="${escapeAttr(pr.id)}" ${spec.profileId === pr.id ? 'selected' : ''}>${escapeHtml(pr.icon || '🗂️')} ${escapeHtml(pr.name)}</option>
                        `).join('')}
                      </select>
                    </div>
                  ` : ''}
                </div>
              ` : spec.type !== 'qr_decode' ? `
                <div class="row">
                  <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
                    <label style="font-size: 11px; margin: 0;">形态 1 目标（程序/网址/命令）</label>
                    ${spec.type === 'url' ? `
                      <button type="button" id="i-fetch-favicon" class="icon-fetch-btn" title="联网探测并抓取该网址的网站图标 (Favicon)">
                        <span>🌐</span> 抓取网站图标
                      </button>
                    ` : ''}
                  </div>
                  <textarea id="i-target" style="min-height: 48px;">${escapeHtml(spec.target || '')}</textarea>
                </div>
                <div class="row"><label style="font-size: 11px;">参数（可留空）</label>${t('i-args', spec.args || '')}</div>
              ` : ''}
            </div>

            <!-- 双态状态切换策略 -->
            <div class="dual-sync-policy-card" style="background:var(--bg); border:1px solid var(--line); border-radius:8px; padding:8px 10px; margin:8px 0;">
              <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:5px;">
                <label style="font-size:11.5px; font-weight:600; color:var(--ink); margin:0;">🧠 状态切换与进程同步策略</label>
                <span style="font-size:10px; color:var(--accent);">v0.10 焦点接管状态机</span>
              </div>
              <select id="i-toggle-sync-mode" style="font-size:12px;">
                <option value="auto" ${(!spec.toggleSyncMode || spec.toggleSyncMode === 'auto') ? 'selected' : ''}>🧠 智能混合模式 (推荐：常驻软件同步进程，脚本/启动器自动保持双态)</option>
                <option value="window" ${spec.toggleSyncMode === 'window' ? 'selected' : ''}>🪟 任务栏窗口模式 (未启动则启动 → 后台则置顶 → 前台则最小化隐藏)</option>
                <option value="manual" ${spec.toggleSyncMode === 'manual' ? 'selected' : ''}>🔄 纯手动乒乓切换 (适合开关命令，严格按击交替形态 1 ⇄ 2)</option>
                <option value="process" ${spec.toggleSyncMode === 'process' ? 'selected' : ''}>📡 严格绑定进程存活 (仅当目标或指定监测进程运行时处于形态 2)</option>
              </select>
              <div style="margin-top:6px; ${(spec.toggleSyncMode === 'process' || spec.toggleSyncMode === 'window') ? '' : 'display:none;'}">
                <label style="font-size:11px; color:var(--muted);">自定义监测进程名（支持多个以 | 分隔，如 WeChat.exe|Weixin.exe）</label>
                <input id="i-watch-process" placeholder="留空则自动解析形态 1 目标进程名" value="${escapeAttr(spec.watchProcess || '')}" style="font-size:12px;" />
              </div>
            </div>

            <!-- 互换动作胶囊 -->
            <div class="dual-action-swap-card">
              <div class="dual-swap-main-row">
                <button type="button" id="i-swap-actions" class="swap-action-btn" title="互换形态 1 与形态 2 的完整动作配置">
                  <span class="swap-icon">🔁</span> 互换形态 1 与形态 2 动作
                </button>
              </div>
              <div class="dual-swap-sub-row">
                <label class="swap-mini-switch-wrap" id="i-swap-sync-wrap" title="互换动作时，是否同步互换角标形态 1 与形态 2 的文字与色彩">
                  <input type="checkbox" id="i-swap-sync-badges" hidden ${lastSwapSyncBadges ? 'checked' : ''} />
                  <span class="mini-switch-track ${lastSwapSyncBadges ? 'on' : ''}" id="i-swap-sync-track"><span class="mini-switch-thumb"></span></span>
                  <span class="swap-switch-text">同时对调角标</span>
                </label>
              </div>
            </div>

            <!-- 形态 2 卡片（与形态 1 100% 对称一致的完整参数编辑器） -->
            <div class="dual-action-card state2-card" style="${dualInspectorViewMode === 'form1' ? 'display:none;' : ''}">
              <div class="dual-action-head">
                <div class="dual-head-left">
                  <span class="dual-dot state2-dot"></span>
                  <span class="dual-title">形态 2 · 触发动作</span>
                </div>
                <span class="dual-tag tag-state2">触发态 (State 2)</span>
              </div>
              <div class="btnrow" style="margin-top: 6px;">
                <button class="ghost tiny" id="i-act2-pickwin" title="未启动则启动，后台则置顶激活，已处前台则最小化隐藏">🪟 唤醒/最小化</button>
                <button class="ghost tiny" id="i-act2-pickkill" title="提取主进程名一键填充 taskkill 退出命令">⚡ 设为退出命令</button>
                <button class="ghost tiny" id="i-act2-pickapp">选择程序…</button>
                <button class="ghost tiny" id="i-act2-pickhk">设为快捷键</button>
                <button class="ghost tiny" id="i-act2-pickcmd">设为命令</button>
              </div>
              <div class="row" style="margin-top: 6px;">
                <label style="font-size: 11px;">形态 2 动作类型</label>
                <select id="i-toggle-action2-type">
                  ${Object.keys(TYPE_NAMES).map((x) => {
                    const curT = (spec.action2 && spec.action2.type) || (spec.type === 'app' ? 'command' : 'hotkey');
                    return `<option value="${x}" ${curT === x ? 'selected' : ''}>${TYPE_NAMES[x]}</option>`;
                  }).join('')}
                </select>
              </div>

              ${(spec.action2 && spec.action2.type === 'hotkey') ? `
                <div class="row" id="i-toggle-action2-hotkey-row">
                  <label style="font-size: 11px;">形态 2 快捷键组合</label>
                  ${renderHotkeyBuilderHtml('i-toggle-action2-hk', (spec.action2 && (spec.action2.hotkey || spec.action2.target)) || '')}
                </div>
              ` : (spec.action2 && (spec.action2.type === 'volume' || spec.action2.type === 'audio' || spec.action2.type === 'app_volume')) ? `
                <div id="i-act2-volume-container">
                  ${renderVolumeEditorHtml(spec.action2, 'i-act2-vol')}
                </div>
              ` : (spec.action2 && (spec.action2.type === 'multi' || spec.action2.type === 'macro')) ? `
                <div id="i-act2-macro-container">
                  ${renderMacroEditorHtml(spec.action2)}
                </div>
              ` : (spec.action2 && spec.action2.type === 'media') ? `
                <div id="i-act2-media-container">
                  ${renderMediaEditorHtml(spec.action2, 'i-act2-media')}
                </div>
              ` : (spec.action2 && spec.action2.type === 'plugin_action') ? `
                <div id="i-act2-plgact-container">
                  ${renderPluginActionEditorHtml(spec.action2, 'i-act2-plgact')}
                </div>
              ` : (spec.action2 && spec.action2.type === 'page') ? `
                <div class="page-inspector-card" style="margin-top: 6px;">
                  <div class="page-insp-head">
                    <span class="page-insp-label">${(PAGE_MODE_INFOS.find(m => m.id === ((spec.action2 && spec.action2.mode) || 'next')) || {}).icon || '📄'} ${escapeHtml(pageActionLabel(spec.action2))}</span>
                    <span class="page-insp-badge">模式: ${escapeHtml((spec.action2 && spec.action2.mode) || 'next')}</span>
                  </div>
                  <div class="page-mode-pills">
                    ${PAGE_MODE_INFOS.map((m) => `
                      <button type="button" class="act2-page-pill ${((spec.action2 && spec.action2.mode) || 'next') === m.id ? 'active' : ''}" data-mode="${m.id}">
                        ${m.icon} ${m.name}
                      </button>
                    `).join('')}
                  </div>
                  ${(spec.action2 && spec.action2.mode === 'goto') ? `
                    <div class="page-target-wrap" style="margin-top: 6px;">
                      <label style="font-size: 11px; color: var(--muted); margin-bottom: 4px; display: block;">🎯 形态 2 目标跳转页面：</label>
                      <select id="i-act2-page-target-select" class="page-select-styled">
                        ${pageTree().map(({ page, depth }) => `
                          <option value="${page.id}" ${spec.action2.pageId === page.id ? 'selected' : ''}>
                            ${'　'.repeat(depth)}${depth ? '↳ ' : ''}${escapeHtml(page.name)}
                          </option>
                        `).join('')}
                      </select>
                    </div>
                  ` : ''}
                </div>
              ` : (spec.action2 && spec.action2.type === 'profile') ? `
                <div class="page-inspector-card" style="margin-top: 6px;">
                  <div class="row">
                    <label style="font-size:11px;">形态 2 切换模式方式</label>
                    <select id="i-act2-profile-mode-select">
                      <option value="next" ${((spec.action2 && spec.action2.mode) || 'next') === 'next' ? 'selected' : ''}>🔄 顺序切换下一套模式</option>
                      <option value="prev" ${(spec.action2 && spec.action2.mode) === 'prev' ? 'selected' : ''}>⏮️ 切换上一套模式</option>
                      <option value="goto" ${(spec.action2 && spec.action2.mode) === 'goto' ? 'selected' : ''}>🎯 切换到指定模式</option>
                    </select>
                  </div>
                  ${(spec.action2 && spec.action2.mode === 'goto') ? `
                    <div class="row" style="margin-top:6px;">
                      <select id="i-act2-profile-target-select">
                        ${((cfg && cfg.profiles) || []).map(pr => `
                          <option value="${escapeAttr(pr.id)}" ${spec.action2.profileId === pr.id ? 'selected' : ''}>${escapeHtml(pr.icon || '🗂️')} ${escapeHtml(pr.name)}</option>
                        `).join('')}
                      </select>
                    </div>
                  ` : ''}
                </div>
              ` : `
                <div class="row" id="i-toggle-action2-target-row" style="${(spec.action2 && ['qr_decode', 'widget'].includes(spec.action2.type)) ? 'display: none;' : ''}">
                  <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
                    <label style="font-size: 11px; margin: 0;">${(spec.action2 && spec.action2.type === 'window_toggle') ? '形态 2 目标窗口进程名' : '形态 2 目标（命令行 / 程序 / 网址）'}</label>
                    ${(spec.action2 && spec.action2.type === 'url') ? `
                      <button type="button" id="i-act2-fetch-favicon" class="icon-fetch-btn" title="联网探测并抓取该网址的网站图标 (Favicon)">
                        <span>🌐</span> 抓取网站图标
                      </button>
                    ` : ''}
                  </div>
                  <textarea id="i-toggle-action2-target" style="min-height: 48px;">${escapeHtml((spec.action2 && spec.action2.target) || '')}</textarea>
                </div>
                <div class="row" id="i-toggle-action2-args-row" style="${(spec.action2 && ['app', 'command', 'ps1'].includes(spec.action2.type)) ? '' : 'display: none;'}">
                  <label style="font-size: 11px;">形态 2 参数（可留空）</label>
                  <input id="i-toggle-action2-args" value="${escapeAttr((spec.action2 && spec.action2.args) || '')}" />
                </div>
              `}
            </div>
          </div>
        `}

              </div>
    </details>

    <details class="sec" data-sec="look" ${secOpen.look ? 'open' : ''}>
      <summary>外观与图标</summary>
      <div class="body">
        <div class="row" style="margin-bottom: 12px;">
          <label>显示名称（支持自动换行或回车折行）</label>
          <textarea id="i-label">${escapeHtml(spec.label || '')}</textarea>
        </div>
        <div class="icon-ctrl-box">
          <div class="icon-preview-wrap">
            ${spec.icon
              ? `<img src="${spec.icon}" class="icon-preview-img" />`
              : `<span class="icon-preview-glyph">${computeDynamicGlyph(spec) || '无'}</span>`}
          </div>
          <div class="icon-btn-group">
            <button class="ghost" id="i-openiconpicker">🎨 矢量图标库…</button>
            <button class="ghost" id="i-texticon" style="color:var(--accent);border-color:var(--accent);font-weight:600;" title="打开内置文字图标工坊（支持 8 套精调视觉模板、双行文字、发光霓虹、机械键帽与透明流光底）">🔤 文字图标…</button>
            <button class="ghost" id="i-iconfile">📁 本地文件…</button>
            ${spec.icon ? `<button class="ghost" id="i-cropicon">✂️ 裁剪微调</button>` : ''}
            <button class="ghost" id="i-saveicon">⭐ 存入图标库</button>
            ${spec.icon ? `<button class="ghost tiny danger" id="i-clr">清除图标</button>` : ''}
          </div>
        </div>
        ${curPage().gradient && curPage().gradient.enabled ? `
          <div class="row" style="margin: 12px 0 6px;">
            <label style="display:block; font-size:12px; color:var(--muted); margin-bottom:4px;">底色模式</label>
            <div class="color-capsule-group">
              <button type="button" id="i-colormode-grad" class="color-capsule-pill ${!spec.customColor ? 'active' : ''}">🌈 跟随整板流光</button>
              <button type="button" id="i-colormode-custom" class="color-capsule-pill ${spec.customColor ? 'active' : ''}">🎨 独立底色</button>
            </div>
            <input type="checkbox" id="i-customcolor" style="display:none;" ${spec.customColor ? 'checked' : ''} />
          </div>
        ` : ''}
        <div class="stylegrid" id="i-colorgroup" style="${curPage().gradient && curPage().gradient.enabled && !spec.customColor ? 'display: none;' : ''}">
          <span>底色</span><input id="i-color" type="color" value="${spec.color || '#37474f'}" />
          <span>渐变到</span><input id="i-color2" type="color" value="${spec.color2 || '#37474f'}" />
        </div>
        <div class="tc-capsule-row">
          <span class="tc-label">文字色</span>
          <div class="color-capsule-group" id="i-tc-group">
            <button type="button" id="i-tc-auto" class="color-capsule-pill ${!spec.textColor ? 'active' : ''}">⚡ 自动对比色</button>
            <button type="button" id="i-tc-custom" class="color-capsule-pill ${spec.textColor ? 'active' : ''}">🎨 自定义色彩</button>
          </div>
          <input type="checkbox" id="i-autofg" style="display:none;" ${spec.textColor ? '' : 'checked'} />
        </div>
        <div id="i-tc-color-row" class="tc-color-expanded" style="${!spec.textColor ? 'display: none;' : ''}">
          <span class="muted small">选择颜色</span>
          <div class="tc-picker-wrap">
            <input id="i-textcolor" type="color" value="${spec.textColor || '#ffffff'}" />
            <span id="i-textcolor-hex" class="tc-hex">${spec.textColor || '#ffffff'}</span>
            <div class="tc-quick-dots">
              <span class="tc-dot" data-color="#ffffff" style="background:#ffffff;" title="纯白"></span>
              <span class="tc-dot" data-color="#000000" style="background:#000000;" title="纯黑"></span>
              <span class="tc-dot" data-color="#00ffcc" style="background:#00ffcc;" title="荧光青"></span>
              <span class="tc-dot" data-color="#ffb703" style="background:#ffb703;" title="琥珀金"></span>
              <span class="tc-dot" data-color="#ff4d4f" style="background:#ff4d4f;" title="亮红"></span>
              <span class="tc-dot" data-color="#69b1ff" style="background:#69b1ff;" title="天蓝"></span>
            </div>
          </div>
        </div>
        <div class="stylegrid">
          <span>字号 <b id="v-font">${Number(spec.fontSize) || 17}</b>%</span>
          <input id="i-fontsize" type="range" min="8" max="40" value="${Number(spec.fontSize) || 17}" />
          <span>图标 <b id="v-icon">${Number(spec.iconScale) || 62}</b>%</span>
          <input id="i-iconscale" type="range" min="25" max="100" value="${Number(spec.iconScale) || 62}" />
          <span>文字位置</span>
          <select id="i-labelpos">
            ${[['bottom', '底部'], ['center', '居中'], ['top', '顶部']].map(([v, n]) =>
              `<option value="${v}" ${(spec.labelPos || 'bottom') === v ? 'selected' : ''}>${n}</option>`).join('')}
          </select>
        </div>
      </div>
    </details>

    <details class="sec" data-sec="badge" open>
      <summary>状态与角标</summary>
      <div class="body">
        ${spec.type === 'app' ? `
          <div class="smart-badge-banner">
            <div class="smart-badge-banner-info">
              <span class="smart-badge-banner-title">🟢 智能进程/窗口状态角标</span>
              <span class="smart-badge-banner-desc">自动感知程序运行与前后台状态，硬件与驱动 100% 实时同源同步</span>
            </div>
            <button type="button" class="primary tiny" id="i-smart-app-badge-btn">${spec.badgeToggle ? '✓ 已开启同步' : '⚡ 一键开启'}</button>
          </div>
        ` : ''}

        <div class="row" style="margin-top: 4px;">
          <label>角标提示模式（右上角胶囊微标）</label>
          <div class="color-capsule-group" style="margin-bottom: 8px;">
            <button type="button" id="i-badgemode-none" class="color-capsule-pill ${(!spec.badgeToggle && !spec.badge) ? 'active' : ''}">🚫 无角标</button>
            <button type="button" id="i-badgemode-static" class="color-capsule-pill ${(!spec.badgeToggle && spec.badge) ? 'active' : ''}">📌 静态角标</button>
            <button type="button" id="i-badgemode-toggle" class="color-capsule-pill ${spec.badgeToggle ? 'active' : ''}">⚡ 动态双态</button>
          </div>

          <!-- 静态角标区 -->
          <div id="i-badgesec-static" class="badge-ctrl-row" style="${spec.badgeToggle || !spec.badge ? 'display: none;' : ''}">
            <div class="badge-presets" id="i-badgepresets">
              <button class="badge-pill ${!spec.badge ? 'active' : ''}" data-val="">无</button>
              <button class="badge-pill ${spec.badge === '✓' ? 'active' : ''}" data-val="✓">✓</button>
              <button class="badge-pill ${spec.badge === '✕' ? 'active' : ''}" data-val="✕">✕</button>
              <button class="badge-pill ${spec.badge === '➔' ? 'active' : ''}" data-val="➔">➔</button>
              <button class="badge-pill ${spec.badge === '1' ? 'active' : ''}" data-val="1">1</button>
              <button class="badge-pill ${spec.badge === '2' ? 'active' : ''}" data-val="2">2</button>
              <button class="badge-pill ${spec.badge === 'A' ? 'active' : ''}" data-val="A">A</button>
              <button class="badge-pill ${spec.badge === '●' ? 'active' : ''}" data-val="●">●</button>
            </div>
            <div class="badge-custom-row">
              <input id="i-badgetext" class="badge-input" maxlength="4" placeholder="自定义" value="${escapeAttr(spec.badge || '')}" />
              <input id="i-badgebg" type="color" class="badge-color" title="微标背景色" value="${spec.badgeBg || '#e53935'}" />
            </div>
          </div>

          <!-- 动态双态角标区 -->
          <div id="i-badgesec-toggle" class="badge-toggle-container" style="${!spec.badgeToggle ? 'display: none;' : ''}">
            <div class="badge-toggle-presets" id="i-toggle-presets">
              ${BADGE_TOGGLE_PRESETS.map((p, idx) => `
                <button type="button" class="badge-toggle-preset-pill" data-idx="${idx}">${p.name}</button>
              `).join('')}
            </div>
            <div class="badge-toggle-grid">
              <div class="badge-toggle-card ${curBadgeState === 0 ? 'active-state' : ''}">
                <div class="badge-toggle-card-head">
                  <span class="badge-toggle-dot" style="background: ${(spec.badgeState1 && spec.badgeState1.bg) || '#546e7a'};"></span>
                  <span class="badge-toggle-title">状态 1 (默认/待机)</span>
                  ${curBadgeState === 0 ? '<span class="badge-current-tag">当前激活</span>' : ''}
                </div>
                <div class="badge-toggle-card-inputs">
                  <input id="i-toggle-s1-text" class="badge-input" maxlength="6" placeholder="留空则无角标" value="${escapeAttr((spec.badgeState1 && spec.badgeState1.text !== undefined) ? spec.badgeState1.text : '待机')}" />
                  <input id="i-toggle-s1-bg" type="color" class="badge-color" title="背景色" value="${(spec.badgeState1 && spec.badgeState1.bg) || '#546e7a'}" />
                </div>
              </div>
              <div class="badge-toggle-card ${curBadgeState === 1 ? 'active-state' : ''}">
                <div class="badge-toggle-card-head">
                  <span class="badge-toggle-dot" style="background: ${(spec.badgeState2 && spec.badgeState2.bg) || '#107c41'};"></span>
                  <span class="badge-toggle-title">状态 2 (运行/激活)</span>
                  ${curBadgeState === 1 ? '<span class="badge-current-tag">当前激活</span>' : ''}
                </div>
                <div class="badge-toggle-card-inputs">
                  <input id="i-toggle-s2-text" class="badge-input" maxlength="6" placeholder="文字" value="${escapeAttr((spec.badgeState2 && spec.badgeState2.text !== undefined) ? spec.badgeState2.text : '运行中')}" />
                  <input id="i-toggle-s2-bg" type="color" class="badge-color" title="背景色" value="${(spec.badgeState2 && spec.badgeState2.bg) || '#107c41'}" />
                </div>
              </div>
            </div>
            <div class="badge-toggle-actions">
              <button type="button" class="badge-swap-btn" id="i-swap-badges" title="一键互换形态 1 与形态 2 的角标文字及色彩">
                ⇅ 互换两态角标
              </button>
              <button type="button" class="ghost tiny badge-try-btn" id="i-toggle-try-btn">
                🔄 试切状态预览（当前：${(curBadge && curBadge.text) || '无角标'}）
              </button>
            </div>
          </div>
        </div>
      </div>
    </details>

    <div class="insp-foot-actions">
      <button class="primary act-main" id="i-test" title="立即测试运行当前按键绑定的动作">
        <span class="btn-icon">▶</span> 测试运行
      </button>
      <button class="ghost act-sub" id="i-push" title="重画这个键到设备物理屏幕">
        <span class="btn-icon">↻</span> 重画
      </button>
      <button class="ghost act-sub" id="i-save" title="存进按键库方便后续复用">
        <span class="btn-icon">⭐</span> 入库
      </button>
      <button class="ghost danger act-del" id="i-del" title="清空/删除这个按键">
        <span class="btn-icon">🗑️</span>
      </button>
    </div>

  `;

  wireSections(box);

  const selPreset = $('i-quickpreset');
  if (selPreset) {
    selPreset.addEventListener('change', async () => {
      const pId = selPreset.value;
      if (!pId) return;
      const tpl = ACTION_TEMPLATES.find(x => x.id === pId);
      if (tpl && tpl.spec) {
        pushHistory(`套用快捷模板：${tpl.name}`);
        sanitizeSpecOnModeOrTypeChange(spec, { nextType: tpl.spec.type, clearDual: !tpl.spec.toggleAction });
        Object.assign(spec, tpl.spec);
        if (tpl.spec.iconName && typeof BUILTIN_ICONS !== 'undefined') {
          const ic = BUILTIN_ICONS.find(i => i.name === tpl.spec.iconName);
          if (ic) {
            spec.icon = svgToDataUrl(ic.svg, '#ffffff');
            delete spec.textIconConfig;
          }
        }
        await commit(true);
        renderInspector();
      }
    });
  }


  box.querySelectorAll('.page-pill').forEach((btn) => {
    btn.onclick = async () => {
      const mode = btn.dataset.mode;
      spec.mode = mode;
      if (mode === 'goto' && !spec.pageId) {
        spec.pageId = (cfg && cfg.pages && cfg.pages[0] && cfg.pages[0].id) || 'p1';
      }
      spec.label = (PAGE_MODE_INFOS.find((m) => m.id === mode) || {}).name || '翻页';
      await commit(true);
      renderInspector();
    };
  });
  const pageTargetSel = $('i-page-target-select');
  if (pageTargetSel) {
    pageTargetSel.onchange = async () => {
      spec.pageId = pageTargetSel.value;
      await commit(true);
    };
  }
  const profModeSel = $('i-profile-mode-select');
  if (profModeSel) {
    profModeSel.onchange = async () => {
      pushHistory('修改模式切换方式');
      spec.mode = profModeSel.value;
      if (spec.mode === 'goto' && !spec.profileId && cfg && cfg.profiles && cfg.profiles[0]) {
        spec.profileId = cfg.profiles[0].id;
      }
      await commit(true);
      renderInspector();
    };
  }
  const profTargetSel = $('i-profile-target-select');
  if (profTargetSel) {
    profTargetSel.onchange = async () => {
      pushHistory('选择目标整机模式');
      spec.profileId = profTargetSel.value;
      const found = ((cfg && cfg.profiles) || []).find(p => p.id === spec.profileId);
      if (found) spec.label = found.name;
      await commit(true);
      renderInspector();
    };
  }
  const btnPageOpenModal = $('i-page-open-modal');
  if (btnPageOpenModal) {
    btnPageOpenModal.onclick = async () => {
      const r = await askPageAction({ mode: spec.mode, pageId: spec.pageId });
      if (!r) return;
      spec.mode = r.mode;
      spec.pageId = r.pageId;
      spec.label = pageActionLabel(spec);
      await commit(true);
      renderInspector();
    };
  }

  const btnOpenPicker = $('i-openiconpicker');
  if (btnOpenPicker) btnOpenPicker.onclick = () => openIconPicker();

  const btnTextIcon = $('i-texticon');
  if (btnTextIcon) {
    btnTextIcon.onclick = () => {
      openTextIconStudio(spec, async (res) => {
        pushHistory('生成自定义文字图标');
        spec.icon = res.dataUrl;
        spec.textIconConfig = res.config;
        if (res.config && res.config.hideKeyLabel) {
          spec.label = '';
          spec.iconScale = Math.max(Number(spec.iconScale) || 62, 84);
        }
        await commit(true);
        renderInspector();
        toast(`🔤 已应用「${res.templateName || '文字图标'}」样式`);
      });
    };
  }

  const btnCrop = $('i-cropicon');
  if (btnCrop) {
    btnCrop.onclick = () => {
      if (!spec.icon) return;
      openCropper(spec.icon, async (cropped) => {
        spec.icon = cropped;
        await commit(true);
        renderInspector();
      });
    };
  }

  const btnSaveIcon = $('i-saveicon');
  if (btnSaveIcon) {
    btnSaveIcon.onclick = async () => {
      if (!spec.icon) { toast('当前按键没有设置图标'); return; }
      const name = await askText('存入自定义图标库', spec.label || '我的图标', '输入图标名称');
      if (!name) return;
      cfg.customIcons = cfg.customIcons || [];
      cfg.customIcons.push({
        id: 'ci_' + Date.now(),
        name: name.trim(),
        icon: spec.icon,
        badge: spec.badge || '',
        badgeBg: spec.badgeBg || '',
        badgeColor: spec.badgeColor || '',
      });
      await saveConfig();
      toast(`已存入自定义图标库：「${name.trim()}」`);
    };
  }

  const btnPickMacro = $('i-pickmacro');
  if (btnPickMacro) {
    btnPickMacro.onclick = () => {
      spec.type = 'multi';
      if (!Array.isArray(spec.actions)) {
        spec.actions = spec.target ? [{ type: 'app', target: spec.target, args: spec.args || '' }] : [];
      }
      if (!spec.loop) spec.loop = { mode: 'once', interval: 50 };
      if (!spec.color) spec.color = '#1b5e20';
      if (!spec.label) spec.label = '复合宏';
      commit(true);
      renderInspector();
    };
  }

  $('i-pickhotkey').onclick = () => {
    spec.type = 'hotkey';
    spec.hotkey = spec.hotkey || 'Win+D';
    spec.target = spec.hotkey;
    spec.color = '#107c41';
    if (!spec.label) spec.label = '显示桌面';
    commit(true);
    renderInspector();
  };

  const btnPickVol = $('i-pickvol');
  if (btnPickVol) {
    btnPickVol.onclick = () => {
      spec.type = 'volume';
      spec.action = spec.action || 'up';
      spec.step = spec.step || 5;
      spec.color = '#1565c0';
      if (!spec.label) spec.label = '音量 +';
      if (typeof BUILTIN_ICONS !== 'undefined') {
        const ic = BUILTIN_ICONS.find(i => i.name === '音量+');
        if (ic) spec.icon = svgToDataUrl(ic.svg, '#ffffff');
      }
      commit(true);
      renderInspector();
    };
  }

  if (spec.type === 'volume' || spec.type === 'audio' || spec.type === 'app_volume') {
    wireVolumeEditor(box, spec, 'i-vol', false);
  }
  if (spec.type === 'media') {
    wireMediaEditor(box, spec, 'i-media', false);
  }
  if (spec.type === 'plugin_action') {
    wirePluginActionEditor(box, spec, 'i-plgact');
  }
  if (spec.type === 'widget') {
    wireWidgetEditor(box, spec);
  }
  if (spec.toggleAction && spec.action2) {
    if (spec.action2.type === 'volume' || spec.action2.type === 'audio' || spec.action2.type === 'app_volume') {
      wireVolumeEditor(box, spec.action2, 'i-act2-vol', true);
    } else if (spec.action2.type === 'media') {
      wireMediaEditor(box, spec.action2, 'i-act2-media', true);
    } else if (spec.action2.type === 'plugin_action') {
      wirePluginActionEditor(box, spec.action2, 'i-act2-plgact');
    } else if (spec.action2.type === 'multi' || spec.action2.type === 'macro') {
      const act2MacroBox = $('i-act2-macro-container');
      if (act2MacroBox) wireMacroEditor(act2MacroBox, spec.action2);
    }
  }

  // 双形态分段视图切换
  box.querySelectorAll('[data-dual-view]').forEach((tabBtn) => {
    tabBtn.onclick = () => {
      dualInspectorViewMode = tabBtn.dataset.dualView || 'both';
      renderInspector();
    };
  });

  // 形态 2 翻页模式胶囊与目标页下拉
  box.querySelectorAll('.act2-page-pill').forEach((btn) => {
    btn.onclick = async () => {
      if (!spec.action2) spec.action2 = { type: 'page' };
      spec.action2.mode = btn.dataset.mode;
      if (spec.action2.mode === 'goto' && !spec.action2.pageId) {
        spec.action2.pageId = (cfg && cfg.pages && cfg.pages[0] && cfg.pages[0].id) || 'p1';
      }
      await commit(false);
      renderInspector();
    };
  });
  const act2PageTargetSel = $('i-act2-page-target-select');
  if (act2PageTargetSel) {
    act2PageTargetSel.onchange = async () => {
      if (!spec.action2) spec.action2 = { type: 'page', mode: 'goto' };
      spec.action2.pageId = act2PageTargetSel.value;
      await commit(false);
    };
  }
  const act2ProfModeSel = $('i-act2-profile-mode-select');
  if (act2ProfModeSel) {
    act2ProfModeSel.onchange = async () => {
      if (!spec.action2) spec.action2 = { type: 'profile' };
      spec.action2.mode = act2ProfModeSel.value;
      if (spec.action2.mode === 'goto' && !spec.action2.profileId && cfg && cfg.profiles && cfg.profiles[0]) {
        spec.action2.profileId = cfg.profiles[0].id;
      }
      await commit(false);
      renderInspector();
    };
  }
  const act2ProfTargetSel = $('i-act2-profile-target-select');
  if (act2ProfTargetSel) {
    act2ProfTargetSel.onchange = async () => {
      if (!spec.action2) spec.action2 = { type: 'profile', mode: 'goto' };
      spec.action2.profileId = act2ProfTargetSel.value;
      await commit(false);
    };
  }

  // 一键开启智能进程/窗口状态角标
  const btnSmartAppBadge = $('i-smart-app-badge-btn');
  if (btnSmartAppBadge) {
    btnSmartAppBadge.onclick = async () => {
      pushHistory('一键配置智能进程状态角标');
      spec.toggleAction = true;
      spec.badgeToggle = true;
      spec.toggleSyncMode = spec.toggleSyncMode || 'window';
      const proc = (spec.watchProcess || (spec.target ? spec.target.replace(/\\/g, '/').split('/').pop().replace(/\.[^.]+$/, '') : '')) || '';
      if (proc) spec.watchProcess = proc;
      if (!spec.action2) {
        spec.action2 = { type: 'window_toggle', target: proc, watchProcess: proc, args: '' };
      }
      spec.badgeState1 = spec.badgeState1 || { text: '', bg: '#546e7a', color: '#ffffff' };
      spec.badgeState2 = spec.badgeState2 || { text: '运行中', bg: '#107c41', color: '#ffffff' };
      await commit(true);
      renderInspector();
      toast('🟢 已开启智能进程运行状态角标同步');
    };
  }

  const iptHotkey = $('i-hotkey');
  if (iptHotkey) {
    bindHotkeyBuilder(box, 'i-hotkey', async (val) => {
      spec.hotkey = val;
      spec.target = val;
      if (!spec.label || spec.label === '显示桌面' || spec.label === '快捷键') {
        const p = HOTKEY_PRESETS.find(x => x.hk.toLowerCase() === val.toLowerCase());
        spec.label = p ? p.lbl : val;
      }
      await commit(true);
      const iptLabel = $('i-label');
      if (iptLabel && spec.label) iptLabel.value = spec.label;
    });
  }

  // 静态角标控制
  box.querySelectorAll('#i-badgepresets .badge-pill').forEach((btn) => {
    btn.onclick = async () => {
      spec.badge = btn.dataset.val;
      await commit(true);
      renderInspector();
    };
  });
  const txtBadge = $('i-badgetext');
  if (txtBadge) {
    txtBadge.addEventListener('change', async () => {
      spec.badge = txtBadge.value.trim();
      await commit(true);
      renderInspector();
    });
  }
  const bgBadge = $('i-badgebg');
  if (bgBadge) {
    bgBadge.addEventListener('change', async () => {
      spec.badgeBg = bgBadge.value;
      await commit(true);
    });
  }

  // 动态双态角标模式切换（三段胶囊：无角标 / 静态角标 / 动态双态）
  const btnBadgeModeNone = $('i-badgemode-none');
  const btnBadgeModeStatic = $('i-badgemode-static');
  const btnBadgeModeToggle = $('i-badgemode-toggle');

  if (btnBadgeModeNone) {
    btnBadgeModeNone.onclick = async () => {
      spec.badge = '';
      spec.badgeToggle = false;
      if (spec.badgeState1) spec.badgeState1.text = '';
      if (spec.badgeState2) spec.badgeState2.text = '';
      delete spec._activeState;
      await commit(true);
      renderInspector();
    };
  }

  if (btnBadgeModeStatic) {
    btnBadgeModeStatic.onclick = async () => {
      spec.badgeToggle = false;
      if (!spec.badge) spec.badge = '●';
      await commit(true);
      renderInspector();
    };
  }

  if (btnBadgeModeToggle) {
    btnBadgeModeToggle.onclick = async () => {
      spec.badgeToggle = true;
      if (!spec.badgeState1) spec.badgeState1 = { text: '待机', bg: '#546e7a', color: '#ffffff' };
      if (!spec.badgeState2) spec.badgeState2 = { text: '运行中', bg: '#107c41', color: '#ffffff' };
      if (!spec.badgeState1.text && !spec.badgeState2.text) {
        spec.badgeState1.text = '待机';
        spec.badgeState2.text = '运行中';
      }
      if (spec._activeState === undefined) spec._activeState = 0;
      await commit(true);
      renderInspector();
    };
  }

  // 双态角标快捷预设
  box.querySelectorAll('#i-toggle-presets .badge-toggle-preset-pill').forEach((btn) => {
    btn.onclick = async () => {
      const idx = Number(btn.dataset.idx);
      const p = BADGE_TOGGLE_PRESETS[idx];
      if (p) {
        spec.badgeState1 = Object.assign({}, p.s1);
        spec.badgeState2 = Object.assign({}, p.s2);
        await commit(true);
        renderInspector();
      }
    };
  });

  // 状态 1 / 状态 2 文字与色彩输入（防抖写盘 + 实时 0ms 预览）
  const s1Text = $('i-toggle-s1-text');
  if (s1Text) {
    s1Text.addEventListener('input', () => {
      if (!spec.badgeState1) spec.badgeState1 = {};
      spec.badgeState1.text = s1Text.value.trim();
      scheduleDebouncedCommit(true);
    });
    s1Text.addEventListener('change', () => commit(true));
  }
  const s1Bg = $('i-toggle-s1-bg');
  if (s1Bg) {
    s1Bg.addEventListener('input', () => {
      if (!spec.badgeState1) spec.badgeState1 = {};
      spec.badgeState1.bg = s1Bg.value;
      scheduleDebouncedCommit(true);
    });
    s1Bg.addEventListener('change', () => commit(true));
  }

  const s2Text = $('i-toggle-s2-text');
  if (s2Text) {
    s2Text.addEventListener('input', () => {
      if (!spec.badgeState2) spec.badgeState2 = {};
      spec.badgeState2.text = s2Text.value.trim();
      scheduleDebouncedCommit(true);
    });
    s2Text.addEventListener('change', () => commit(true));
  }
  const s2Bg = $('i-toggle-s2-bg');
  if (s2Bg) {
    s2Bg.addEventListener('input', () => {
      if (!spec.badgeState2) spec.badgeState2 = {};
      spec.badgeState2.bg = s2Bg.value;
      scheduleDebouncedCommit(true);
    });
    s2Bg.addEventListener('change', () => commit(true));
  }

  // 动态角标试切按钮
  const tryBtn = $('i-toggle-try-btn');
  if (tryBtn) {
    tryBtn.onclick = async () => {
      const cur = spec._activeState !== undefined ? spec._activeState : (spec.badgeInitialState || 0);
      spec._activeState = (cur === 1 ? 0 : 1);
      if (selected) setRuntimeCellState(curPage() && curPage().id, selected.row, selected.col, { activeState: spec._activeState });
      refreshGrid();
      await pushKey(selected.row, selected.col);
      renderInspector();
    };
  }

  // 一键互换动态角标
  const btnSwapBadges = $('i-swap-badges');
  if (btnSwapBadges) {
    btnSwapBadges.onclick = async () => {
      const b1 = spec.badgeState1 || { text: 'ON', bg: '#107c41', color: '#ffffff' };
      const b2 = spec.badgeState2 || { text: 'OFF', bg: '#e53935', color: '#ffffff' };
      spec.badgeState1 = {
        text: b2.text != null ? b2.text : '',
        bg: b2.bg || '#107c41',
        color: b2.color || '#ffffff'
      };
      spec.badgeState2 = {
        text: b1.text != null ? b1.text : '',
        bg: b1.bg || '#e53935',
        color: b1.color || '#ffffff'
      };
      await commit(true);
      refreshGrid();
      await pushKey(selected.row, selected.col);
      renderInspector();
      toast('已互换形态 1 与形态 2 角标');
    };
  }

  // 动作模式胶囊切换
  const btnActSingle = $('i-toggle-act-single');
  const btnActDual = $('i-toggle-act-dual');
  if (btnActSingle && btnActDual) {
    btnActSingle.onclick = async () => {
      pushHistory('切换为单一动作模式');
      sanitizeSpecOnModeOrTypeChange(spec, { toSingleAction: true });
      await commit(true);
      renderInspector();
    };
    btnActDual.onclick = async () => {
      spec.toggleAction = true;
      if (!spec.action2) {
        let targetKill = '';
        if (spec.target) {
          const proc = spec.target.replace(/\\/g, '/').split('/').pop().replace(/\.[^.]+$/, '');
          if (proc) targetKill = `taskkill /F /IM ${proc}.exe`;
        }
        spec.action2 = { type: targetKill ? 'command' : 'hotkey', target: targetKill || 'Alt+F4', hotkey: targetKill ? '' : 'Alt+F4', args: '' };
      }
      if (!spec.toggleSyncMode) {
        spec.toggleSyncMode = /\.(bat|cmd|ps1|vbs|py|sh)$/i.test(spec.target || '') ? 'manual' : 'auto';
      }
      if (!spec.badgeToggle) {
        spec.badgeToggle = true;
        spec.badgeState1 = spec.badgeState1 || { text: '待机', bg: '#546e7a' };
        spec.badgeState2 = spec.badgeState2 || { text: '运行中', bg: '#107c41' };
      }
      await commit(false);
      renderInspector();
    };
  }

  // 一键互换形态 1 与形态 2 动作
  const btnSwap = $('i-swap-actions');
  const syncSwapCheck = $('i-swap-sync-badges');
  const syncSwapTrack = $('i-swap-sync-track');
  if (syncSwapCheck && syncSwapTrack) {
    syncSwapCheck.onchange = () => {
      lastSwapSyncBadges = !!syncSwapCheck.checked;
      syncSwapTrack.classList.toggle('on', syncSwapCheck.checked);
    };
  }
  if (btnSwap) {
    btnSwap.onclick = async () => {
      const s1 = extractActionPayload(spec);
      const s2 = extractActionPayload(spec.action2 || { type: 'command', target: '', args: '', hotkey: '' });
      applyActionPayload(spec, s2);
      spec.action2 = applyActionPayload({}, s1);

      if (syncSwapCheck && syncSwapCheck.checked) {
        const b1 = spec.badgeState1 || { text: 'ON', bg: '#107c41', color: '#ffffff' };
        const b2 = spec.badgeState2 || { text: 'OFF', bg: '#e53935', color: '#ffffff' };
        spec.badgeState1 = {
          text: b2.text != null ? b2.text : '',
          bg: b2.bg || '#107c41',
          color: b2.color || '#ffffff'
        };
        spec.badgeState2 = {
          text: b1.text != null ? b1.text : '',
          bg: b1.bg || '#e53935',
          color: b1.color || '#ffffff'
        };
      }

      await commit(true);
      refreshGrid();
      renderInspector();
      toast('已互换形态 1 与形态 2 的执行动作' + (syncSwapCheck && syncSwapCheck.checked ? '（并同步对调角标）' : ''));
    };
  }

  // 网站 Favicon 图标抓取绑定
  const bindFaviconBtn = (btnId, getter) => {
    const btn = $(btnId);
    if (!btn) return;
    btn.onclick = async () => {
      const rawUrl = getter();
      if (!rawUrl) {
        toast('请先输入有效的目标网址');
        return;
      }
      btn.disabled = true;
      btn.textContent = '⏳ 抓取中…';
      try {
        if (!window.api || !api.fetchFavicon) {
          toast('当前环境不支持网络探测');
          return;
        }
        const res = await api.fetchFavicon(rawUrl);
        if (res && res.dataUrl) {
          spec.icon = res.dataUrl;
          await commit(true);
          refreshGrid();
          await pushKey(selected.row, selected.col);
          renderInspector();
          toast('✅ 网站图标获取成功并已存入！');
        } else {
          toast('未能获取到网站图标：' + ((res && res.error) || '请检查网址或网络'));
        }
      } catch (err) {
        toast('抓取失败：' + (err.message || err));
      } finally {
        const cur = $(btnId);
        if (cur) {
          cur.disabled = false;
          cur.innerHTML = '<span>🌐</span> 抓取网站图标';
        }
      }
    };
  };
  bindFaviconBtn('i-fetch-favicon', () => ($('i-target') && $('i-target').value.trim()) || spec.target || '');
  bindFaviconBtn('i-act2-fetch-favicon', () => ($('i-toggle-action2-target') && $('i-toggle-action2-target').value.trim()) || (spec.action2 && spec.action2.target) || '');

  // 双态同步策略与自定义监测进程绑定（含切离任务栏窗口模式时的自动动作与角标还原）
  const selSyncMode = $('i-toggle-sync-mode');
  if (selSyncMode) {
    selSyncMode.onchange = async () => {
      const nextMode = selSyncMode.value;
      pushHistory(`切换双态同步策略：${nextMode}`);
      spec.toggleSyncMode = nextMode;
      delete spec._downgradedToManual;
      if (nextMode === 'window') {
        const proc = (spec.watchProcess || (spec.target ? spec.target.replace(/\\/g, '/').split('/').pop().replace(/\.[^.]+$/, '') : '')) || '';
        if (proc) spec.watchProcess = proc;
        spec.action2 = { type: 'window_toggle', target: proc, watchProcess: proc, args: '' };
        spec.badgeToggle = true;
        spec.badgeState1 = { text: '', bg: '#546e7a', color: '#ffffff' };
        spec.badgeState2 = { text: '前台', bg: '#107c41', color: '#ffffff' };
      } else {
        sanitizeSpecOnModeOrTypeChange(spec, { nextSyncMode: nextMode });
      }
      await commit(true);
      renderInspector();
    };
  }
  const iptWatchProc = $('i-watch-process');
  if (iptWatchProc) {
    iptWatchProc.addEventListener('change', async () => {
      spec.watchProcess = iptWatchProc.value.trim();
      await commit(false);
    });
  }

  // 状态 2 快捷辅助按钮
  const btnAct2Win = $('i-act2-pickwin');
  if (btnAct2Win) {
    btnAct2Win.onclick = async () => {
      let proc = spec.watchProcess || '';
      if (!proc && spec.target) {
        proc = spec.target.replace(/\\/g, '/').split('/').pop().replace(/\.[^.]+$/, '');
      }
      spec.toggleSyncMode = 'window';
      spec.watchProcess = proc;
      spec.action2 = {
        type: 'window_toggle',
        target: proc || 'app',
        watchProcess: proc || 'app',
        args: ''
      };
      spec.badgeToggle = true;
      spec.badgeState1 = { text: '', bg: '#546e7a' };
      spec.badgeState2 = { text: '前台', bg: '#107c41' };
      await commit(true);
      renderInspector();
      toast('🪟 已设为任务栏唤醒/最小化切换模式');
    };
  }
  const btnAct2Kill = $('i-act2-pickkill');
  if (btnAct2Kill) {
    btnAct2Kill.onclick = async () => {
      if (!spec.action2) spec.action2 = {};
      let proc = '';
      if (spec.target) {
        proc = spec.target.replace(/\\/g, '/').split('/').pop().replace(/\.[^.]+$/, '');
      }
      spec.action2.type = 'command';
      spec.action2.target = proc ? `taskkill /F /IM ${proc}.exe` : 'taskkill /F /IM app.exe';
      spec.action2.args = '';
      await commit(false);
      renderInspector();
      toast('已设为退出命令：' + spec.action2.target);
    };
  }
  const btnAct2App = $('i-act2-pickapp');
  if (btnAct2App) {
    btnAct2App.onclick = async () => {
      const p = await api.dialogPick({ properties: ['openFile'] });
      if (!p) return;
      const cls = await api.actionClassify(p);
      if (!spec.action2) spec.action2 = {};
      spec.action2.type = 'app';
      spec.action2.target = cls.abs || p;
      spec.action2.args = '';
      await commit(false);
      renderInspector();
    };
  }
  const btnAct2Hk = $('i-act2-pickhk');
  if (btnAct2Hk) {
    btnAct2Hk.onclick = async () => {
      if (!spec.action2) spec.action2 = {};
      spec.action2.type = 'hotkey';
      spec.action2.hotkey = 'Alt+F4';
      spec.action2.target = 'Alt+F4';
      await commit(false);
      renderInspector();
    };
  }
  const btnAct2Cmd = $('i-act2-pickcmd');
  if (btnAct2Cmd) {
    btnAct2Cmd.onclick = async () => {
      if (!spec.action2) spec.action2 = {};
      spec.action2.type = 'command';
      await commit(false);
      renderInspector();
    };
  }

  const selAct2Type = $('i-toggle-action2-type');
  if (selAct2Type) {
    selAct2Type.onchange = async () => {
      if (!spec.action2) spec.action2 = {};
      const v2 = selAct2Type.value;
      spec.action2.type = v2;
      if (v2 === 'volume') {
        spec.action2.action = spec.action2.action || 'mute';
        spec.action2.step = spec.action2.step || 5;
      } else if (v2 === 'app_volume') {
        spec.action2.action = spec.action2.action || 'app_mute';
        spec.action2.appTarget = spec.action2.appTarget || '@foreground';
        spec.action2.step = spec.action2.step || 10;
      } else if (v2 === 'page') {
        spec.action2.mode = spec.action2.mode || 'next';
      } else if (v2 === 'profile') {
        spec.action2.mode = spec.action2.mode || 'next';
      } else if (v2 === 'media') {
        spec.action2.cmd = spec.action2.cmd || 'play_pause';
        spec.action2.target = spec.action2.cmd;
      } else if (v2 === 'multi' || v2 === 'macro') {
        if (!Array.isArray(spec.action2.actions)) spec.action2.actions = [];
        if (!spec.action2.loop) spec.action2.loop = { mode: 'once', interval: 50 };
      } else if (v2 === 'plugin_action') {
        spec.action2.pluginId = spec.action2.pluginId || 'obs_studio';
        spec.action2.action = spec.action2.action || 'toggle_record';
      }
      await commit(false);
      renderInspector();
    };
  }
  const act2VolSel = $('i-act2-vol-action');
  if (act2VolSel) {
    act2VolSel.onchange = async () => {
      if (!spec.action2) spec.action2 = { type: 'volume' };
      spec.action2.action = act2VolSel.value;
      await commit(false);
      renderInspector();
    };
  }
  const act2PageBtn = $('i-act2-page-cfg');
  if (act2PageBtn) {
    act2PageBtn.onclick = async () => {
      const r = await askPageAction(spec.action2);
      if (!r) return;
      if (!spec.action2) spec.action2 = { type: 'page' };
      spec.action2.mode = r.mode;
      spec.action2.pageId = r.pageId;
      await commit(false);
      renderInspector();
    };
  }
  const iptAct2Target = $('i-toggle-action2-target');
  if (iptAct2Target) {
    iptAct2Target.addEventListener('input', () => {
      if (!spec.action2) spec.action2 = {};
      spec.action2.target = iptAct2Target.value;
      scheduleDebouncedCommit(false);
    });
    iptAct2Target.addEventListener('change', () => commit(false));
  }
  const iptAct2Args = $('i-toggle-action2-args');
  if (iptAct2Args) {
    iptAct2Args.addEventListener('input', () => {
      if (!spec.action2) spec.action2 = {};
      spec.action2.args = iptAct2Args.value;
      scheduleDebouncedCommit(false);
    });
    iptAct2Args.addEventListener('change', () => commit(false));
  }
  const iptAct2Hk = $('i-toggle-action2-hk');
  if (iptAct2Hk) {
    bindHotkeyBuilder(box, 'i-toggle-action2-hk', async (val) => {
      if (!spec.action2) spec.action2 = {};
      spec.action2.type = 'hotkey';
      spec.action2.hotkey = val;
      spec.action2.target = val;
      await commit(false);
    });
  }

  const chkCustom = $('i-customcolor');
  const btnModeGrad = $('i-colormode-grad');
  const btnModeCustom = $('i-colormode-custom');

  const updateCapsules = (isCustom) => {
    if (btnModeGrad) btnModeGrad.classList.toggle('active', !isCustom);
    if (btnModeCustom) btnModeCustom.classList.toggle('active', !!isCustom);
  };

  if (chkCustom) {
    chkCustom.addEventListener('change', async () => {
      if (chkCustom.checked) {
        spec.customColor = true;
      } else {
        delete spec.customColor;
      }
      updateCapsules(spec.customColor);
      const cg = $('i-colorgroup');
      if (cg) cg.style.display = spec.customColor ? '' : 'none';
      await commit(true);
    });
  }

  if (btnModeGrad && btnModeCustom && chkCustom) {
    btnModeGrad.onclick = () => {
      if (!chkCustom.checked) return;
      chkCustom.checked = false;
      chkCustom.dispatchEvent(new Event('change'));
    };
    btnModeCustom.onclick = () => {
      if (chkCustom.checked) return;
      chkCustom.checked = true;
      chkCustom.dispatchEvent(new Event('change'));
    };
  }

  const bind = (id, field, ev, transform) => {
    const elm = $(id);
    if (!elm) return;
    elm.addEventListener(ev, async () => {
      spec[field] = transform ? transform(elm) : elm.value;
      await commit(ev === 'change');
    });
  };
  bind('i-label', 'label', 'change');
  const iptLabelLive = $('i-label');
  if (iptLabelLive) {
    iptLabelLive.addEventListener('input', () => {
      spec.label = iptLabelLive.value;
      scheduleDebouncedCommit(true);
    });
  }
  bind('i-target', 'target', 'change');
  bind('i-args', 'args', 'change');
  bind('i-color', 'color', 'change');
  const iptColorLive = $('i-color');
  if (iptColorLive) {
    iptColorLive.addEventListener('input', () => {
      spec.color = iptColorLive.value;
      scheduleDebouncedCommit(true);
    });
  }
  bind('i-color2', 'color2', 'change');
  const iptColor2Live = $('i-color2');
  if (iptColor2Live) {
    iptColor2Live.addEventListener('input', () => {
      spec.color2 = iptColor2Live.value;
      scheduleDebouncedCommit(true);
    });
  }
  bind('i-labelpos', 'labelPos', 'change');

  $('i-type').addEventListener('change', async () => {
    const v = $('i-type').value;
    if (v === 'page') {
      const r = await askPageAction(spec.type === 'page' ? spec : null);
      if (!r) { renderInspector(); return; }
      const fresh = pageButtons()[key];
      Object.keys(fresh).forEach((k) => delete fresh[k]);
      Object.assign(fresh, makePageSpec(r.mode, r.pageId));
    } else {
      sanitizeSpecOnModeOrTypeChange(spec, { nextType: v });
      spec.type = v;
      delete spec.mode;
      delete spec.pageId;
      if (v === 'hotkey') {
        spec.hotkey = spec.hotkey || 'Win+D';
        spec.target = spec.hotkey;
        spec.color = '#107c41';
        if (!spec.label) spec.label = '显示桌面';
      } else if (v === 'multi' || v === 'macro') {
        if (!Array.isArray(spec.actions)) {
          spec.actions = spec.target ? [{ type: 'app', target: spec.target, args: spec.args || '' }] : [];
        }
        if (!spec.loop) spec.loop = { mode: 'once', interval: 50 };
        if (!spec.color) spec.color = '#1b5e20';
        if (!spec.label) spec.label = '复合宏';
      } else if (v === 'volume' || v === 'audio') {
        spec.action = spec.action || 'up';
        spec.step = spec.step || 5;
        spec.color = spec.color || '#1565c0';
        if (!spec.label) spec.label = spec.action === 'up' ? '音量 +' : (spec.action === 'down' ? '音量 -' : '音量');
        if (typeof BUILTIN_ICONS !== 'undefined') {
          const ic = BUILTIN_ICONS.find(i => i.name === '音量+');
          if (ic) spec.icon = svgToDataUrl(ic.svg, '#ffffff');
        }
      } else if (v === 'app_volume') {
        spec.action = spec.action || 'app_mute';
        spec.appTarget = spec.appTarget || '@foreground';
        spec.step = spec.step || 10;
        spec.color = spec.color || '#0f172a';
        if (!spec.label) spec.label = '应用混音';
      } else if (v === 'media') {
        spec.cmd = spec.cmd || 'play_pause';
        spec.target = spec.cmd;
        spec.color = spec.color || '#2e7d32';
        if (!spec.label) spec.label = '播放/暂停';
      } else if (v === 'plugin_action') {
        spec.pluginId = spec.pluginId || 'obs_studio';
        spec.action = spec.action || 'toggle_record';
        spec.target = spec.pluginId;
        spec.color = spec.color || '#1e1b4b';
        if (!spec.label) spec.label = 'OBS 录制';
      } else if (v === 'window_toggle') {
        spec.target = spec.target || 'chrome';
        spec.watchProcess = spec.watchProcess || spec.target;
        spec.color = spec.color || '#0284c7';
        if (!spec.label) spec.label = '窗口切换';
      } else if (v === 'widget') {
        spec.widgetKind = spec.widgetKind || 'gpu';
        spec.action = spec.action || 'refresh';
        spec.color = spec.color || '#0f291e';
        if (!spec.label) spec.label = 'GPU 监控';
      }
    }
    await commit(true);
    renderInspector();
  });

  const slider = (id, field, out) => {
    const elm = $(id);
    if (!elm) return;
    elm.addEventListener('input', () => {
      spec[field] = Number(elm.value);
      if ($(out)) $(out).textContent = elm.value;
      scheduleDebouncedCommit(true);
    });
    elm.addEventListener('change', () => commit(true));
  };
  slider('i-fontsize', 'fontSize', 'v-font');
  slider('i-iconscale', 'iconScale', 'v-icon');

  const auto = $('i-autofg');
  const tc = $('i-textcolor');
  const tcHex = $('i-textcolor-hex');
  const tcRow = $('i-tc-color-row');
  const btnTcAuto = $('i-tc-auto');
  const btnTcCustom = $('i-tc-custom');

  const updateTcUI = (isAuto) => {
    auto.checked = isAuto;
    tc.disabled = isAuto;
    if (btnTcAuto) btnTcAuto.classList.toggle('active', isAuto);
    if (btnTcCustom) btnTcCustom.classList.toggle('active', !isAuto);
    if (tcRow) tcRow.style.display = isAuto ? 'none' : 'flex';
  };

  if (btnTcAuto) {
    btnTcAuto.onclick = async () => {
      updateTcUI(true);
      spec.textColor = '';
      await commit(true);
    };
  }
  if (btnTcCustom) {
    btnTcCustom.onclick = async () => {
      updateTcUI(false);
      spec.textColor = tc.value || '#ffffff';
      if (tcHex) tcHex.textContent = spec.textColor;
      await commit(true);
    };
  }
  auto.addEventListener('change', async () => {
    updateTcUI(auto.checked);
    spec.textColor = auto.checked ? '' : tc.value;
    await commit(true);
  });
  tc.addEventListener('input', () => {
    if (tcHex) tcHex.textContent = tc.value;
  });
  tc.addEventListener('change', async () => {
    spec.textColor = tc.value;
    if (tcHex) tcHex.textContent = tc.value;
    await commit(true);
  });
  box.querySelectorAll('.tc-dot').forEach((dot) => {
    dot.onclick = async () => {
      const c = dot.dataset.color;
      if (!c) return;
      tc.value = c;
      if (tcHex) tcHex.textContent = c;
      spec.textColor = c;
      updateTcUI(false);
      await commit(true);
    };
  });


  if ($('i-pickapp')) $('i-pickapp').onclick = () => pickInto({ properties: ['openFile'] });
  if ($('i-pickdir')) $('i-pickdir').onclick = () => pickInto({ properties: ['openDirectory'] });
  if ($('i-pickurl')) $('i-pickurl').onclick = () => quickSet('url');
  if ($('i-pickcmd')) $('i-pickcmd').onclick = () => quickSet('command');
  if ($('i-page')) $('i-page').onclick = async () => {
    const r = await askPageAction(spec.type === 'page' ? spec : null);
    if (!r) return;
    let fresh = pageButtons()[selected.row + ',' + selected.col];
    if (!fresh) { pageButtons()[selected.row + ',' + selected.col] = fresh = {}; }
    Object.keys(fresh).forEach((k) => delete fresh[k]);
    Object.assign(fresh, makePageSpec(r.mode, r.pageId));
    await commit(true);
    renderInspector();
  };
  $('i-test').onclick = async () => {
    let act = spec;
    const isDual = Boolean(spec.toggleAction || spec.badgeToggle);
    if (isDual) {
      const cur = spec._activeState !== undefined ? spec._activeState : (spec.badgeInitialState || 0);
      if (spec.toggleAction && spec.action2 && (isActionConfigured(spec.action2) || spec.action2.type === 'window_toggle') && cur === 1) {
        act = spec.action2;
      }
      spec._activeState = (spec.toggleSyncMode === 'window') ? 1 : (cur === 1 ? 0 : 1);
      refreshGrid();
      await pushKey(selected.row, selected.col);
      renderInspector();
    }
    const r = !DEMO ? await api.actionRun(act, { row: selected.row, col: selected.col, activeState: spec._activeState }) : { ok: true };
    toast(r && r.ok ? '✅ 已触发执行' : '启动失败：' + (r && r.error));
  };
  $('i-push').onclick = () => repaintSelected();
  $('i-iconfile').onclick = async () => {
    const p = await api.dialogPick({ properties: ['openFile'] });
    if (!p) return;
    const ext = p.split('.').pop().toLowerCase();
    const isImg = ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'svg'].includes(ext);
    const icon = await api.iconExtract(p);
    if (!icon) { toast('这个文件取不到图标'); return; }
    if (isImg) {
      openCropper(icon, async (cropped) => {
        spec.icon = cropped;
        await commit(true);
        renderInspector();
      });
    } else {
      spec.icon = icon;
      await commit(true);
      renderInspector();
    }
  };
  const btnClr = $('i-clr');
  if (btnClr) btnClr.onclick = async () => { spec.icon = ''; delete spec.textIconConfig; await commit(true); renderInspector(); };
  $('i-save').onclick = () => libraryAdd(spec);
  $('i-del').onclick = () => removeKey(selected.row, selected.col);
  if (spec.type === 'multi' || spec.type === 'macro') {
    wireMacroEditor(box, spec);
  }
  updateInspTabs();
}

/** <details> state must survive the innerHTML rebuild on every edit. */
function wireSections(box) {
  box.querySelectorAll('details.sec').forEach((d) => {
    d.addEventListener('toggle', () => { secOpen[d.dataset.sec] = d.open; });
  });
}

const GRADIENT_PRESETS = [
  { name: '暗夜蓝金', from: '#141e30', to: '#243b55', angle: 135 },
  { name: '赛博霓虹', from: '#8a2387', to: '#e94057', angle: 90 },
  { name: '深海极光', from: '#000428', to: '#004e92', angle: 135 },
  { name: '极光翠绿', from: '#0f2027', to: '#203a43', angle: 135 },
  { name: '落日暖橘', from: '#ff4e50', to: '#f9d423', angle: 45 },
];

function renderPageInspector(box) {
  const p = curPage();
  if (!p.gradient) {
    p.gradient = { enabled: false, from: '#1565c0', to: '#6a1b9a', angle: 135 };
  }
  const g = p.gradient;
  box.className = 'inspector';
  box.innerHTML = `
    <details class="sec" data-sec="page-grad" open>
      <summary>页面外观 · 整板无缝渐变</summary>
      <div class="body">
        <div class="switch-card" id="g-enable-card">
          <div class="switch-card-info">
            <span class="switch-card-title">整板无缝渐变流光</span>
            <span class="switch-card-desc">跨越 15 键 + 3 块副屏无缝连贯渲染</span>
          </div>
          <label class="switch" onclick="event.stopPropagation()">
            <input type="checkbox" id="g-enable" ${g.enabled ? 'checked' : ''} />
            <span class="switch-slider"></span>
          </label>
        </div>

        <div id="g-controls" style="${g.enabled ? '' : 'opacity: 0.45; pointer-events: none;'}">
          <div class="stylegrid" style="margin-bottom: 12px;">
            <span>起点色</span>
            <input id="g-from" type="color" value="${g.from || '#1565c0'}" />
            <span>终点色</span>
            <input id="g-to" type="color" value="${g.to || '#6a1b9a'}" />
            <span>角度 <b id="g-angle-val">${Number(g.angle) || 0}</b>°</span>
            <input id="g-angle" type="range" min="0" max="360" step="5" value="${Number(g.angle) || 0}" />
          </div>

          <div class="row">
            <label>常用方向快捷设定</label>
            <div class="btnrow" style="margin-bottom: 10px; flex-wrap: wrap;">
              <button class="ghost tiny g-dir" data-angle="90">水平 90°</button>
              <button class="ghost tiny g-dir" data-angle="180">垂直 180°</button>
              <button class="ghost tiny g-dir" data-angle="135">对角 135°</button>
              <button class="ghost tiny g-dir" data-angle="45">反角 45°</button>
            </div>
          </div>

          <div class="row">
            <label>推荐精选主题色卡</label>
            <div class="preset-grid" id="g-presets"></div>
          </div>
        </div>

        <p class="muted" style="margin-top: 14px; font-size: 11px; line-height: 1.4;">
          💡 开启后，整块 15 键面板将作为一张无缝连贯的大画布绘制渐变。若个别按键需要独立颜色强调，可在该按键外观中勾选「独立自定义底色」。
        </p>
      </div>
    </details>

    <details class="sec" data-sec="page-autoapp" open>
      <summary>智能前台感知自动切页 (Auto-Profile 2.0)</summary>
      <div class="body">
        <div class="row">
          <label>关联进程名（多个用逗号分隔，留空则匹配任意进程）</label>
          <div style="display:flex; gap:6px;">
            <input id="p-autoapp" value="${escapeAttr(p.autoApp || '')}" placeholder="例如：chrome.exe, msedge.exe, Code.exe" style="flex:1;" />
            <button type="button" class="ghost tiny" id="p-autoapp-pick" title="选择本地程序自动提取进程名">📁 选程序…</button>
          </div>
        </div>
        <div class="row">
          <label>窗口标题正则 / 关键词匹配（可选，支持标签页级精准切页）</label>
          <input id="p-autotitle" value="${escapeAttr(p.autoTitle || '')}" placeholder="例如：Bilibili|哔哩哔哩|Figma|YouTube" />
          <div style="display:flex; gap:4px; flex-wrap:wrap; margin-top:4px;">
            <span class="hotkey-tag p-title-preset" data-val="Bilibili|哔哩哔哩">📺 Bilibili</span>
            <span class="hotkey-tag p-title-preset" data-val="Figma">🎨 Figma</span>
            <span class="hotkey-tag p-title-preset" data-val="GitHub">🐙 GitHub</span>
            <span class="hotkey-tag p-title-preset" data-val="YouTube">▶️ YouTube</span>
            <span class="hotkey-tag p-title-preset" data-val="Premiere|剪映">🎬 剪辑工作台</span>
          </div>
        </div>
        <p class="muted" style="margin: 4px 0 0; font-size: 11px; line-height: 1.4;">
          💡 支持「进程名 + 窗口标题正则」双重感知，并内置<b>多层级子页记忆栈</b>：即使在自动切入的「${escapeHtml(p.name)}」内点进子页，切走应用后仍能精准还原您之前的手动驻留页。
        </p>
      </div>
    </details>

    <details class="sec" data-sec="page-ctxbar" open>
      <summary>✨ 场景上下文感知动态副屏栏 (Context-Aware Dynamic Bar)</summary>
      <div class="body">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
          <span style="font-size:11.5px; color:var(--muted);">主 15 键保持不变，根据前台活动窗口自动切换右侧 3 块副屏：</span>
          <label class="switch" title="全局启用/停用场景上下文感知动态副屏栏">
            <input type="checkbox" id="g-ctxbar-enable" ${(cfg && cfg.contextBarEnabled !== false) ? 'checked' : ''} />
            <span class="switch-slider"></span>
          </label>
        </div>
        <div id="g-ctxbar-list" style="display:flex; flex-direction:column; gap:6px;">
          ${((cfg && cfg.contextBars) || []).map((bar, idx) => `
            <div style="display:flex; align-items:center; justify-content:space-between; padding:6px 8px; border:1px solid var(--line); border-radius:7px; background:var(--bg);">
              <div style="min-width:0; flex:1;">
                <div style="font-size:12px; font-weight:600; color:var(--ink); display:flex; align-items:center; gap:5px;">
                  <span style="width:8px; height:8px; border-radius:50%; background:${escapeAttr(bar.accent || '#10b981')}; display:inline-block;"></span>
                  <span>${escapeHtml(bar.name || ('上下文栏 ' + (idx + 1)))}</span>
                  ${(activeRendererContextBar && activeRendererContextBar.id === bar.id) ? '<span class="long-press-pill" style="background:rgba(16,185,129,0.16);color:#10b981;">当前激活</span>' : ''}
                </div>
                <div style="font-size:10.5px; color:var(--muted); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">匹配进程：${escapeHtml(bar.matchApp || '任意')}</div>
              </div>
              <div style="display:flex; gap:4px; align-items:center; flex:none;">
                <button type="button" class="ghost tiny" data-ctx-preview="${idx}" title="在右侧 3 块副屏上预览此上下文工具栏">${(activeRendererContextBar && activeRendererContextBar.id === bar.id) ? '↺ 还原' : '🔍 预览'}</button>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    </details>

    <div class="btnrow">
      <button class="ghost" id="g-repaint-all">重画全部 15 键</button>
    </div>
  `;

  wireSections(box);

  const preBox = box.querySelector('#g-presets');
  for (const pre of GRADIENT_PRESETS) {
    const btn = document.createElement('button');
    btn.className = 'preset-pill';
    btn.innerHTML = `
      <span class="preset-swatch" style="background: linear-gradient(${pre.angle}deg, ${pre.from}, ${pre.to});"></span>
      <span class="preset-name">${pre.name}</span>
    `;
    btn.onclick = async () => {
      g.enabled = true;
      g.from = pre.from;
      g.to = pre.to;
      g.angle = pre.angle;
      cachedGradientKey = '';
      await commit(false);
      renderPageInspector(box);
      if (!DEMO) await repaintAllKeys();
    };
    preBox.appendChild(btn);
  }

  const syncControls = () => {
    box.querySelector('#g-controls').style.opacity = g.enabled ? '' : '0.45';
    box.querySelector('#g-controls').style.pointerEvents = g.enabled ? '' : 'none';
  };

  const cardEnable = box.querySelector('#g-enable-card');
  const chkEnable = box.querySelector('#g-enable');
  if (cardEnable && chkEnable) {
    cardEnable.onclick = (e) => {
      if (e.target === chkEnable || e.target.closest('.switch')) return;
      chkEnable.checked = !chkEnable.checked;
      chkEnable.dispatchEvent(new Event('change'));
    };
  }

  box.querySelector('#g-enable').onchange = async (e) => {
    g.enabled = e.target.checked;
    cachedGradientKey = '';
    syncControls();
    await commit(false);
    if (!DEMO) await repaintAllKeys();
  };

  const angleInput = box.querySelector('#g-angle');
  const angleVal = box.querySelector('#g-angle-val');
  angleInput.oninput = () => { angleVal.textContent = angleInput.value; };
  angleInput.onchange = async () => {
    g.angle = Number(angleInput.value);
    cachedGradientKey = '';
    await commit(false);
    if (!DEMO) await repaintAllKeys();
  };

  box.querySelectorAll('.g-dir').forEach((btn) => {
    btn.onclick = async () => {
      const a = Number(btn.dataset.angle);
      g.angle = a;
      angleInput.value = a;
      angleVal.textContent = a;
      cachedGradientKey = '';
      await commit(false);
      if (!DEMO) await repaintAllKeys();
    };
  });

  box.querySelector('#g-from').onchange = async (e) => {
    g.from = e.target.value;
    cachedGradientKey = '';
    await commit(false);
    if (!DEMO) await repaintAllKeys();
  };

  box.querySelector('#g-to').onchange = async (e) => {
    g.to = e.target.value;
    cachedGradientKey = '';
    await commit(false);
    if (!DEMO) await repaintAllKeys();
  };

  const autoAppInput = box.querySelector('#p-autoapp');
  if (autoAppInput) {
    autoAppInput.onchange = async () => {
      p.autoApp = autoAppInput.value.trim();
      await commit(false);
      renderPageTabs();
      toast(p.autoApp ? `已绑定自动切页进程：${p.autoApp}` : '已清除本页进程名限制');
    };
  }
  const autoTitleInput = box.querySelector('#p-autotitle');
  if (autoTitleInput) {
    autoTitleInput.onchange = async () => {
      const val = autoTitleInput.value.trim();
      if (val) {
        try { new RegExp(val, 'i'); } catch (err) {
          toast('正则表达式语法有误，将按普通关键词匹配：' + err.message);
        }
      }
      p.autoTitle = val;
      await commit(false);
      renderPageTabs();
      toast(p.autoTitle ? `已设置窗口标题正则匹配：${p.autoTitle}` : '已清除窗口标题匹配规则');
    };
  }
  box.querySelectorAll('.p-title-preset').forEach((tag) => {
    tag.onclick = async () => {
      if (!autoTitleInput) return;
      autoTitleInput.value = tag.dataset.val;
      p.autoTitle = tag.dataset.val;
      await commit(false);
      renderPageTabs();
      toast(`已应用窗口标题匹配规则：${p.autoTitle}`);
    };
  });
  const autoAppPick = box.querySelector('#p-autoapp-pick');
  if (autoAppPick) {
    autoAppPick.onclick = async () => {
      if (DEMO || !window.api || !api.dialogPick) return;
      const fp = await api.dialogPick({
        properties: ['openFile'],
        filters: [{ name: '可执行程序或快捷方式', extensions: ['exe', 'lnk'] }]
      });
      if (!fp) return;
      const cls = await api.actionClassify(fp);
      const proc = (cls && cls.processName) ? `${cls.processName}.exe` : fp.split(/[\\/]/).pop();
      if (proc && autoAppInput) {
        const existing = autoAppInput.value.split(/[,，;；\s]+/).map(s => s.trim()).filter(Boolean);
        if (!existing.includes(proc)) existing.push(proc);
        p.autoApp = existing.join(', ');
        autoAppInput.value = p.autoApp;
        await commit(false);
        renderPageTabs();
        toast(`已关联自动切页进程：${p.autoApp}`);
      }
    };
  }

  const chkCtxBar = box.querySelector('#g-ctxbar-enable');
  if (chkCtxBar) {
    chkCtxBar.onchange = async () => {
      cfg.contextBarEnabled = chkCtxBar.checked;
      if ($('prefContextBarEnabled')) $('prefContextBarEnabled').checked = cfg.contextBarEnabled;
      if (!cfg.contextBarEnabled) activeRendererContextBar = null;
      updateContextBarBadgeUI();
      refreshStripCells(lastSysStats);
      await commit(false);
      if (!DEMO) await repaintStrips();
      renderPageInspector(box);
    };
  }
  box.querySelectorAll('[data-ctx-preview]').forEach((btn) => {
    btn.onclick = async () => {
      const idx = Number(btn.dataset.ctxPreview);
      const bar = ((cfg && cfg.contextBars) || [])[idx];
      if (!bar) return;
      if (activeRendererContextBar && activeRendererContextBar.id === bar.id) {
        activeRendererContextBar = null;
        toast('已退出上下文副屏预览，恢复页面默认副屏');
      } else {
        cfg.contextBarEnabled = true;
        activeRendererContextBar = bar;
        toast(`✨ 正在预览「${bar.name}」—— 双击右侧副屏格可直接触发其绑定的快捷工具`);
      }
      updateContextBarBadgeUI();
      refreshStripCells(lastSysStats);
      if (!DEMO) await repaintStrips();
      renderPageInspector(box);
    };
  });

  box.querySelector('#g-repaint-all').onclick = () => repaintAllKeys(true);
}

function renderStripInspector(box) {
  const row = selected.row;
  const s = pageStrips()[String(row)] || { type: 'text', label: '', color: '#263238' };
  const page = curPage();
  const grad = page && page.gradient;
  const rawPlugins = (lastTelemetry && Array.isArray(lastTelemetry.plugins) && lastTelemetry.plugins.length)
    ? lastTelemetry.plugins
    : BUILTIN_MARKET_PLUGINS;
  const curPluginId = String(s.pluginId || 'uptime_greeting').replace(/-/g, '_');

  box.className = 'inspector';
  box.innerHTML = `
    <details class="sec" data-sec="action" ${secOpen.action ? 'open' : ''}>
      <summary>显示内容</summary>
      <div class="body">
        <div class="row">
          <label>副屏数据源模式</label>
          <select id="s-type">
            <option value="clock" ${s.type === 'clock' ? 'selected' : ''}>⏰ 时钟与星期（自动刷新）</option>
            <option value="page" ${s.type === 'page' ? 'selected' : ''}>📑 页码 + 页名（随翻页自动更新）</option>
            <option value="cpu" ${s.type === 'cpu' ? 'selected' : ''}>💻 CPU 占用率（实时动态监控）</option>
            <option value="mem" ${s.type === 'mem' ? 'selected' : ''}>📊 内存占用率（实时动态监控）</option>
            <option value="sys" ${s.type === 'sys' ? 'selected' : ''}>📈 系统态势仪表（CPU + 内存组合）</option>
            <option value="volume" ${s.type === 'volume' ? 'selected' : ''}>🔊 声学监听与音量监控（实时动态）</option>
            <option value="gpu" ${s.type === 'gpu' ? 'selected' : ''}>🎮 GPU 温度/显存/趋势线 (NVML)</option>
            <option value="net" ${s.type === 'net' ? 'selected' : ''}>🌐 实时网速上下行与波形监控</option>
            <option value="pomodoro" ${s.type === 'pomodoro' ? 'selected' : ''}>🍅 番茄钟专注倒计时</option>
            <option value="weather" ${s.type === 'weather' ? 'selected' : ''}>🌤️ 实时天气与温湿度</option>
            <option value="media_now" ${s.type === 'media_now' ? 'selected' : ''}>🎵 SMTC 音乐与同步桌面歌词</option>
            <option value="obs" ${s.type === 'obs' ? 'selected' : ''}>🔴 OBS 推流 / 录制状态监控</option>
            <option value="plugin" ${s.type === 'plugin' ? 'selected' : ''}>🧩 可视化画布插件 (plugins/*.plugin.js)</option>
            <option value="text" ${s.type === 'text' ? 'selected' : ''}>✍️ 自定义静态文字</option>
          </select>
        </div>
        <div class="row" id="s-label-row" style="${s.type === 'text' ? '' : 'display:none;'}">
          <label>自定义显示文字（支持回车换行）</label>
          <textarea id="s-label" placeholder="输入要在副屏显示的静态文字...">${escapeHtml(s.label || '')}</textarea>
        </div>
        ${s.type === 'plugin' ? `
          <div class="row">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:5px;">
              <label style="margin:0;">绑定可视化画布插件</label>
              <button type="button" class="primary tiny" id="s-open-plugin-market">🛍️ 插件市场 (${BUILTIN_MARKET_PLUGINS.length})</button>
            </div>
            <select id="s-plugin-id">
              ${rawPlugins.map(p => {
                const pid = String(p.id || '').replace(/-/g, '_');
                return `<option value="${escapeAttr(pid)}" ${curPluginId === pid ? 'selected' : ''}>${escapeHtml(p.icon || '🧩')} ${escapeHtml(p.name || p.title || pid)}</option>`;
              }).join('')}
            </select>
            ${renderPluginSchemaBoxHtml(curPluginId, s.pluginConfig || {}, 's-plgcfg-')}
          </div>
        ` : ''}
        ${s.type === 'pomodoro' ? `
          <div class="btnrow" style="margin-top:4px;">
            <button type="button" class="ghost tiny" id="s-pomo-toggle" style="flex:1;">⏯️ 启停番茄钟</button>
            <button type="button" class="ghost tiny" id="s-pomo-reset" style="flex:1;">↺ 重置倒计时</button>
          </div>
        ` : ''}
      </div>
    </details>
    <details class="sec" data-sec="look" ${secOpen.look ? 'open' : ''}>
      <summary>外观与底色</summary>
      <div class="body">
        ${grad && grad.enabled ? `
          <div class="row" style="margin-bottom: 8px;">
            <label style="display:block; font-size:12px; color:var(--muted); margin-bottom:4px;">底色模式</label>
            <div class="color-capsule-group">
              <button type="button" id="s-colormode-grad" class="color-capsule-pill ${!s.customColor ? 'active' : ''}">🌈 跟随整板流光</button>
              <button type="button" id="s-colormode-custom" class="color-capsule-pill ${s.customColor ? 'active' : ''}">🎨 独立底色</button>
            </div>
            <input type="checkbox" id="s-customcolor" style="display:none;" ${s.customColor ? 'checked' : ''} />
          </div>
        ` : ''}
        <div class="stylegrid" id="s-colorgroup" style="${grad && grad.enabled && !s.customColor ? 'display: none;' : ''}">
          <span>底色</span><input id="s-color" type="color" value="${s.color || '#263238'}" />
        </div>
        <div class="stylegrid">
          <span>字号 <b id="v-sfont">${Number(s.fontSize) || 20}</b>%</span>
          <input id="s-fontsize" type="range" min="10" max="45" value="${Number(s.fontSize) || 20}" />
        </div>
      </div>
    </details>
    <div class="btnrow" style="margin-top: 14px;">
      <button class="ghost" id="s-push">↻ 重画这块屏</button>
      <button class="ghost" id="s-save">⭐ 存为组件模板</button>
    </div>
  `;
  wireSections(box);
  const el = (id) => $(id);
  el('s-type').addEventListener('change', async () => {
    const nextType = el('s-type').value;
    const nextSpec = Object.assign({}, s, { type: nextType });
    if (nextType === 'plugin' && !nextSpec.pluginId) nextSpec.pluginId = 'uptime_greeting';
    pageStrips()[String(row)] = nextSpec;
    await commit(true);
    renderInspector();
  });
  el('s-label').addEventListener('change', async () => {
    pageStrips()[String(row)] = Object.assign({}, s, { label: el('s-label').value });
    await commit(true);
  });
  const sPlgSel = el('s-plugin-id');
  if (sPlgSel) {
    sPlgSel.addEventListener('change', async () => {
      pageStrips()[String(row)] = Object.assign({}, s, { pluginId: sPlgSel.value });
      await commit(true);
      renderInspector();
    });
    wirePluginSchemaBox(box, s.pluginId || 'uptime_greeting', pageStrips()[String(row)], 's-plgcfg-', () => {
      refreshStripCells(lastSysStats);
      pushStrip(row, true);
    });
  }
  const sMarketBtn = el('s-open-plugin-market');
  if (sMarketBtn) {
    sMarketBtn.onclick = () => {
      openPluginMarketModal(async (meta) => {
        pageStrips()[String(row)] = Object.assign({}, s, { type: 'plugin', pluginId: meta.id, color: meta.color });
        await commit(true);
        renderInspector();
        toast(`✅ 副屏 ${row + 1} 已绑定插件：「${meta.name}」`);
      });
    };
  }
  const sPomoToggle = el('s-pomo-toggle');
  if (sPomoToggle) {
    sPomoToggle.onclick = async () => {
      const mins = (cfg && cfg.pomodoroMinutes) || 25;
      if (!DEMO && (api.pomodoroControl || api.pomodoroAction)) {
        const snap = await (api.pomodoroControl || api.pomodoroAction)('toggle', mins);
        if (snap) lastTelemetry.pomodoro = snap;
      } else {
        lastTelemetry.pomodoro.running = !lastTelemetry.pomodoro.running;
      }
      refreshGrid();
      await pushStrip(row);
    };
  }
  const sPomoReset = el('s-pomo-reset');
  if (sPomoReset) {
    sPomoReset.onclick = async () => {
      const mins = (cfg && cfg.pomodoroMinutes) || 25;
      if (!DEMO && (api.pomodoroControl || api.pomodoroAction)) {
        const snap = await (api.pomodoroControl || api.pomodoroAction)('reset', mins);
        if (snap) lastTelemetry.pomodoro = snap;
      } else {
        lastTelemetry.pomodoro = { running: false, phase: 'work', remainSec: mins * 60, remainingSec: mins * 60, totalSec: mins * 60, formatted: `${String(mins).padStart(2, '0')}:00`, progressPct: 0 };
      }
      refreshGrid();
      await pushStrip(row);
    };
  }

  const chkCustom = el('s-customcolor');
  const btnModeGrad = el('s-colormode-grad');
  const btnModeCustom = el('s-colormode-custom');

  const updateCapsules = (isCustom) => {
    if (btnModeGrad) btnModeGrad.classList.toggle('active', !isCustom);
    if (btnModeCustom) btnModeCustom.classList.toggle('active', !!isCustom);
  };

  if (chkCustom) {
    chkCustom.addEventListener('change', async () => {
      if (chkCustom.checked) {
        s.customColor = true;
      } else {
        delete s.customColor;
      }
      updateCapsules(s.customColor);
      const cg = el('s-colorgroup');
      if (cg) cg.style.display = s.customColor ? '' : 'none';
      pageStrips()[String(row)] = s;
      await commit(true);
    });
  }

  if (btnModeGrad && btnModeCustom && chkCustom) {
    btnModeGrad.onclick = () => {
      if (!chkCustom.checked) return;
      chkCustom.checked = false;
      chkCustom.dispatchEvent(new Event('change'));
    };
    btnModeCustom.onclick = () => {
      if (chkCustom.checked) return;
      chkCustom.checked = true;
      chkCustom.dispatchEvent(new Event('change'));
    };
  }
  el('s-color').addEventListener('change', async () => {
    pageStrips()[String(row)] = Object.assign({}, s, { color: el('s-color').value });
    await commit(true);
  });
  el('s-fontsize').addEventListener('input', () => {
    el('v-sfont').textContent = el('s-fontsize').value;
    s.fontSize = Number(el('s-fontsize').value);
    pageStrips()[String(row)] = s;
    scheduleDebouncedCommit(true);
  });
  el('s-fontsize').addEventListener('change', async () => {
    s.fontSize = Number(el('s-fontsize').value);
    pageStrips()[String(row)] = s;
    await commit(true);
  });
  el('s-push').onclick = () => pushStrip(row);
  el('s-save').onclick = () => {
    // 若副屏是实时组件类，存入按键库时自动封装为标准 widget 规格，拖到主键即可正常渲染！
    if (WIDGET_KINDS.includes(s.type)) {
      const info = WIDGET_KIND_INFOS.find(x => x.id === s.type);
      libraryAdd({
        type: 'widget',
        widgetKind: s.type,
        pluginId: s.pluginId || 'uptime_greeting',
        action: (info && info.act) || 'refresh',
        label: (info && info.name.split(' ')[0]) || s.type.toUpperCase(),
        color: s.color || (info && info.color) || '#0f291e',
      });
    } else {
      libraryAdd(s);
    }
  };
}

/** Pick a file/folder into the currently selected cell (creating the spec). */
async function pickInto(opts) {
  if (!selected || selected.col === 5 || isBackCell(selected.row, selected.col)) return;
  const p = await api.dialogPick(opts);
  if (!p) return;
  const cls = await api.actionClassify(p);
  const icon = await api.iconExtract(p);
  const spec = {
    type: cls.type, label: cls.label, target: cls.abs || p,
    args: '', icon: icon || '', color: colorFor(cls.type),
  };
  applyAppDualStateDefaults(spec, cls, p);
  await stopKeyMacroIfNeeded(selected.row, selected.col);
  pageButtons()[selected.row + ',' + selected.col] = spec;
  await commit(true);
  renderInspector();
}

/** Modal text prompt (window.prompt is disabled in Electron renderers). */
function askText(title, value, placeholder) {
  return new Promise((resolve) => {
    const wrap = document.createElement('div');
    wrap.className = 'modal';
    wrap.innerHTML = `<div class="modalbox">
      <h3>${escapeHtml(title)}</h3>
      <input id="_askInput" value="${escapeAttr(value || '')}" placeholder="${escapeAttr(placeholder || '')}" />
      <div class="btnrow">
        <button class="primary" id="_askOk">确定</button>
        <button class="ghost" id="_askCancel">取消</button>
      </div>
    </div>`;
    document.body.appendChild(wrap);
    const input = wrap.querySelector('#_askInput');
    input.focus();
    input.select();
    const done = (v) => { wrap.remove(); resolve(v); };
    wrap.querySelector('#_askOk').onclick = () => done(input.value);
    wrap.querySelector('#_askCancel').onclick = () => done(null);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') done(input.value);
      if (e.key === 'Escape') done(null);
    });
  });
}

async function quickSet(kind) {
  if (!selected || selected.col === 5 || isBackCell(selected.row, selected.col)) return;
  const key = selected.row + ',' + selected.col;
  const existing = pageButtons()[key];
  const seed = existing && existing.type === kind ? existing.target : '';
  const value = await askText(
    kind === 'url' ? '输入网址' : '输入命令行',
    seed,
    kind === 'url' ? 'https://example.com' : 'notepad 或 cmd /c echo hi'
  );
  if (value == null) return;
  const v = String(value).trim();
  if (!v) return;
  pageButtons()[key] = {
    type: kind,
    label: kind === 'url' ? v.replace(/^https?:\/\//, '').replace(/\/.*$/, '').slice(0, 20) : v.slice(0, 12),
    target: v,
    args: '', icon: '', color: colorFor(kind),
  };
  await commit(true);
  renderInspector();
}

function escapeHtml(s) { return String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }
function escapeAttr(s) { return escapeHtml(s).replace(/"/g, '&quot;'); }

// ------------------------------------------------------------------- library

/* 「按键库」= 把调好的一个键存起来，随时取回任意格子 / 任意页。
 * 数据：config.library = [{id, name, tags:[], savedAt, spec}]
 *   - 分类用**标签**而不是文件夹：一个键可以同时属于「开发」和「常用」，
 *     不用为了两处可见而存两份，切分类也不用进进出出。
 *   - 抽屉是"小态"（随手取一个），「展开」是大面板（搜索 + 标签 + 批量操作）。
 *   - 可以单独导出成 library.json，按标签导出。 */

let dragLib = null;      // id of a library entry being dragged onto a cell
let libQuery = '';
let libTag = '';

const libEntries = () => (cfg && cfg.library) || [];

function normTags(v) {
  if (Array.isArray(v)) return v.map((t) => String(t).trim()).filter(Boolean);
  if (typeof v === 'string') return v.split(/[,，\s]+/).map((t) => t.trim()).filter(Boolean);
  return [];
}

/** 整页快照：存的是一整页（15 个键 + 3 块屏），而不是单个键。 */
const isPageEntry = (e) => !!e && (e.kind === 'page' || (!e.spec && !!e.page));

function libMatches(e) {
  if (libTag && !(e.tags || []).includes(libTag)) return false;
  const q = libQuery.trim().toLowerCase();
  if (!q) return true;
  return [e.name, e.spec && e.spec.target, e.spec && e.spec.type,
    isPageEntry(e) ? '整页 页面' : '', (e.tags || []).join(' ')]
    .filter(Boolean).join(' ').toLowerCase().includes(q);
}

/** 6×3 迷你预览，让整页快照在库里一眼能认出来。 */
function libMiniGrid(page) {
  const g = document.createElement('div');
  g.className = 'minigrid';
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 6; col++) {
      const c = document.createElement('i');
      if (col === 5) {
        const s = (page.strips || {})[String(row)];
        c.style.background = (s && s.color) || '#263238';
      } else {
        const b = (page.buttons || {})[row + ',' + col];
        if (b) c.style.background = b.color || '#37474f';
        else c.classList.add('empty');
      }
      g.appendChild(c);
    }
  }
  return g;
}

function libAllTags() {
  const m = new Map();
  for (const e of libEntries()) for (const t of (e.tags || [])) m.set(t, (m.get(t) || 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

function libSwatch(entry, cls) {
  if (isPageEntry(entry)) return libMiniGrid(entry.page || {});
  const sw = document.createElement('div');
  sw.className = cls;
  sw.style.background = entry.spec.color || '#37474f';
  sw.style.color = contrast(entry.spec.color);
  if (entry.spec.icon) {
    const im = document.createElement('img');
    im.src = entry.spec.icon;
    sw.appendChild(im);
  } else {
    sw.textContent = glyphFor(entry.spec.type);
  }
  return sw;
}

/** 库条目拖到格子上时用（库 -> 面板）。 */
function libDropSpec(entry) {
  return clone(entry.spec);
}

function libSave() {
  if (DEMO) { renderLibrary(); renderLibPanel(); return Promise.resolve(); }
  return api.configSave(cfg).then(() => { renderLibrary(); renderLibPanel(); });
}

/** Small tile used in the drawer. */
function libItemEl(entry) {
  const it = document.createElement('div');
  it.className = 'libitem' + (isPageEntry(entry) ? ' ispage' : '');
  // 整页快照拖不上单个格子 —— 它是整页，只能建成新页或覆盖当前页
  it.draggable = !isPageEntry(entry);
  const what = isPageEntry(entry)
    ? `整页快照 · ${Object.keys((entry.page || {}).buttons || {}).length} 个按键`
    : entry.spec.target || '';
  it.title = `${entry.name}\n${what}\n标签：${(entry.tags || []).join(' / ') || '无'}`;
  it.appendChild(libSwatch(entry, 'sw'));
  it.appendChild(el('span', 'nm', entry.name));

  const del = document.createElement('button');
  del.className = 'del';
  del.textContent = '×';
  del.title = '从库里删掉';
  del.onclick = (e) => { e.stopPropagation(); libraryRemove(entry.id); };
  it.appendChild(del);

  it.onclick = () => (isPageEntry(entry) ? libraryApplyPage(entry) : libraryApply(entry));
  it.addEventListener('dragstart', (e) => {
    dragLib = entry.id;
    e.dataTransfer.effectAllowed = 'copy';
    e.dataTransfer.setData('text/plain', 'lib:' + entry.id);
  });
  it.addEventListener('dragend', () => { dragLib = null; });
  return it;
}

let libBatchMode = false;
const libSelectedIds = new Set();

function toggleLibSelect(id) {
  if (libSelectedIds.has(id)) {
    libSelectedIds.delete(id);
  } else {
    libSelectedIds.add(id);
  }
  updateLibBatchBar();
  renderLibPanel();
}

function updateLibBatchBar() {
  const bar = $('libBatchBar');
  const normalFoot = $('libNormalFoot');
  const countEl = $('libBatchCount');
  if (bar) bar.hidden = !libBatchMode;
  if (normalFoot) normalFoot.hidden = !!libBatchMode;
  if (countEl) countEl.textContent = `已选 ${libSelectedIds.size} 项`;
  const toggleBtn = $('libBatchToggle');
  if (toggleBtn) {
    toggleBtn.textContent = libBatchMode ? '✓ 完成管理' : '☑️ 批量管理';
    toggleBtn.classList.toggle('active', libBatchMode);
  }
}

async function libraryBatchTags() {
  if (!libSelectedIds.size) { toast('请先勾选要修改标签的按键'); return; }
  const v = await askText('批量设置标签（空格或逗号分隔）', '', '例如：常用 开发 视频');
  if (v == null) return;
  const tags = normTags(v);
  const count = libSelectedIds.size;
  for (const e of libEntries()) {
    if (libSelectedIds.has(e.id)) {
      e.tags = clone(tags);
    }
  }
  await libSave();
  renderLibPanel();
  toast(`已为 ${count} 个按键统一设置标签`);
}

async function libraryBatchExport() {
  if (DEMO) { toast('预览模式下不能导出'); return; }
  if (!libSelectedIds.size) { toast('请先勾选要导出的按键'); return; }
  const list = libEntries().filter(e => libSelectedIds.has(e.id));
  const name = `akp153-library-batch-${list.length}.json`;
  const json = JSON.stringify({ type: 'akp153-library', version: 1, exportedAt: new Date().toISOString(), entries: list }, null, 2);
  const r = await api.libraryExport({ json, name });
  if (r && r.ok) toast(`已导出 ${list.length} 个条目到 ${r.path}`);
  else if (r && !r.canceled) toast('导出失败：' + (r.error || '未知错误'));
}

async function libraryBatchDelete() {
  if (!libSelectedIds.size) { toast('请先勾选要删除的按键'); return; }
  const count = libSelectedIds.size;
  if (!(await askConfirm('批量删除按键', `确定要从库里删除选中的 ${count} 个条目吗？已放到格子上的不受影响。`))) return;
  cfg.library = libEntries().filter(e => !libSelectedIds.has(e.id));
  libSelectedIds.clear();
  await libSave();
  renderLibPanel();
  renderLibrary();
  toast(`已批量删除 ${count} 个按键条目`);
}

let currentLibModalEntry = null;
let currentLibModalSpec = null;
let lkmActiveTab = 'action';
let lkmPreviewState = 1;
let iconPickerTarget = null; // null | 'libModal'

function setLkmTab(tab) {
  lkmActiveTab = tab;
  const tabs = {
    action: { btn: $('lkmTabAction'), pane: $('lkmPaneAction') },
    style: { btn: $('lkmTabStyle'), pane: $('lkmPaneStyle') },
    dual: { btn: $('lkmTabDual'), pane: $('lkmPaneDual') }
  };
  for (const [k, v] of Object.entries(tabs)) {
    if (v.btn) v.btn.classList.toggle('active', k === tab);
    if (v.pane) v.pane.hidden = (k !== tab);
  }
}

function updateLkmSwatch(previewState) {
  if (previewState != null) lkmPreviewState = previewState;
  const wrap = $('lkmSwatchWrap');
  if (!wrap || !currentLibModalSpec) return;
  wrap.innerHTML = '';

  const sw = document.createElement('div');
  sw.style.width = '100%';
  sw.style.height = '100%';
  sw.style.display = 'flex';
  sw.style.flexDirection = 'column';
  sw.style.alignItems = 'center';
  sw.style.justifyContent = 'center';
  sw.style.position = 'relative';
  sw.style.background = currentLibModalSpec.color || '#37474f';
  sw.style.color = contrast(currentLibModalSpec.color);

  const isState2 = (lkmPreviewState === 2);
  const showIcon = currentLibModalSpec.icon;
  const showLabel = currentLibModalSpec.label;

  if (showIcon) {
    const img = document.createElement('img');
    img.src = showIcon;
    const scale = (currentLibModalSpec.iconScale || 80) / 100;
    img.style.maxWidth = `${Math.round(75 * scale)}%`;
    img.style.maxHeight = `${Math.round(75 * scale)}%`;
    img.style.objectFit = 'contain';
    sw.appendChild(img);
  }
  if (showLabel) {
    const lbl = document.createElement('span');
    lbl.textContent = showLabel;
    const pct = Number(currentLibModalSpec.fontSize) || 17;
    const previewPx = Math.max(9, Math.min(18, Math.round(58 * (pct / 100))));
    lbl.style.fontSize = `${previewPx}px`;
    lbl.style.fontWeight = '600';
    lbl.style.whiteSpace = 'nowrap';
    lbl.style.overflow = 'hidden';
    lbl.style.textOverflow = 'ellipsis';
    lbl.style.maxWidth = '90%';
    lbl.style.textAlign = 'center';
    lbl.style.marginTop = showIcon ? '2px' : '0';
    sw.appendChild(lbl);
  } else if (!showIcon) {
    const glyph = document.createElement('span');
    glyph.className = 'glyph';
    glyph.textContent = glyphFor(currentLibModalSpec.type);
    sw.appendChild(glyph);
  }

  // 角标覆盖展示（复用统一的 getActiveBadge 纯函数）
  const previewSpec = Object.assign({}, currentLibModalSpec, { _activeState: isState2 ? 1 : 0 });
  const activeB = getActiveBadge(previewSpec);
  if (activeB && activeB.text) {
    const badgeEl = document.createElement('span');
    badgeEl.className = 'badge-overlay' + (activeB.isToggle ? ' badge-toggle' : '');
    badgeEl.style.position = 'absolute';
    badgeEl.style.top = '3px';
    badgeEl.style.right = '3px';
    badgeEl.style.background = activeB.bg || '#107c41';
    badgeEl.style.color = activeB.color || '#ffffff';
    badgeEl.textContent = activeB.text;
    sw.appendChild(badgeEl);
  }

  wrap.appendChild(sw);

  // 同步更新双态面板中的角标效果
  const badgeWrap = $('lkmBadgePreviewWrap');
  if (badgeWrap) {
    badgeWrap.innerHTML = '';
    if (currentLibModalSpec.badgeToggle) {
      const b1 = currentLibModalSpec.badgeState1 || { text: 'ON', bg: '#107c41' };
      const b2 = currentLibModalSpec.badgeState2 || { text: 'OFF', bg: '#e53935' };
      badgeWrap.innerHTML = `<span class="badge-overlay badge-toggle" style="position:static; display:inline-block; margin-right:6px; background:${b1.bg};">${escapeHtml(b1.text)}</span>`
        + `<span style="font-size:11px; color:var(--muted); margin-right:6px;">⇄</span>`
        + `<span class="badge-overlay badge-toggle" style="position:static; display:inline-block; background:${b2.bg};">${escapeHtml(b2.text)}</span>`;
    } else if (currentLibModalSpec.badge) {
      badgeWrap.innerHTML = `<span class="badge-overlay" style="position:static; display:inline-block; background:${currentLibModalSpec.badgeBg || '#e53935'};">${escapeHtml(currentLibModalSpec.badge)}</span>`;
    } else {
      badgeWrap.innerHTML = `<span style="font-size:11px; color:var(--muted);">(无角标)</span>`;
    }
  }
}

function formatSpecSummaryText(s) {
  if (!s) return '(未设置)';
  const t = s.type || 'app';
  if (t === 'volume' || t === 'audio') {
    const act = s.action || 'up';
    if (act === 'up') return `增大音量 (+${s.step || 5}%)`;
    if (act === 'down') return `减小音量 (-${s.step || 5}%)`;
    if (act === 'mute') return '静音 / 恢复切换';
    if (act === 'set') return `设为指定音量 (${s.target || 50}%)`;
    if (act === 'switch_device') return `切换输出声卡 (${s.target || '智能轮换'})`;
    return `音量控制 (${act})`;
  }
  if (t === 'page') return pageActionLabel(s);
  if (t === 'multi' || t === 'macro') return `复合宏 (${(s.actions || []).length} 步)`;
  if (t === 'media') return `多媒体控制 (${s.cmd || s.target || 'play_pause'})`;
  if (t === 'qr_decode' || t === 'qr') return '屏幕/剪贴板二维码智能解码';
  return s.target || s.hotkey || '(未设置)';
}

function updateLkmActionUI() {
  if (!currentLibModalSpec) return;
  const type = currentLibModalSpec.type || 'app';
  if ($('lkmActType')) $('lkmActType').value = type;
  if ($('lkmTypeBadge')) $('lkmTypeBadge').textContent = TYPE_SHORT[type] || type || '未配置';

  const isVolume = (type === 'volume' || type === 'audio');
  const isPage = (type === 'page');
  const isMulti = (type === 'multi' || type === 'macro');
  const isQr = (type === 'qr_decode' || type === 'qr');
  const hideTargetInput = isVolume || isPage || isMulti || isQr;

  const targetWrap = $('lkmTargetWrap');
  if (targetWrap) targetWrap.hidden = hideTargetInput;

  const tInput = $('lkmTargetInput');
  if (tInput && !hideTargetInput) {
    if (type === 'hotkey') tInput.value = currentLibModalSpec.hotkey || currentLibModalSpec.target || '';
    else if (type === 'media') tInput.value = currentLibModalSpec.cmd || currentLibModalSpec.target || 'play_pause';
    else tInput.value = currentLibModalSpec.target || '';
  }
  const aInput = $('lkmArgsInput');
  if (aInput) aInput.value = currentLibModalSpec.args || '';

  const pickBtn = $('lkmPickAppBtn');
  if (pickBtn) pickBtn.hidden = !['app', 'file', 'folder', 'ps1'].includes(type);
  const favBtn = $('lkmFaviconBtn');
  if (favBtn) favBtn.hidden = (type !== 'url');
  const hkBuilder = $('lkmHotkeyBuilder');
  if (hkBuilder) hkBuilder.hidden = (type !== 'hotkey');
  const argsWrap = $('lkmArgsWrap');
  if (argsWrap) argsWrap.hidden = !['app', 'command', 'ps1'].includes(type);

  const isWidget = (type === 'widget');
  if (targetWrap) targetWrap.hidden = hideTargetInput || isWidget;

  // 专属音量配置面板同步 (#lkmVolAction + #lkmVolStep)
  const volWrap = $('lkmVolumeWrap');
  if (volWrap) {
    volWrap.hidden = !isVolume;
    if (isVolume) {
      const act = currentLibModalSpec.action || 'up';
      const step = (act === 'set') ? (Number(currentLibModalSpec.target) || 50) : (Number(currentLibModalSpec.step) || 5);
      if ($('lkmVolAction')) $('lkmVolAction').value = act;
      if ($('lkmVolStep')) {
        $('lkmVolStep').value = step;
        $('lkmVolStep').hidden = (act === 'mute' || act === 'switch_device');
      }
    }
  }

  // 专属翻页配置面板同步 (#lkmPageMode + #lkmPageTargetSelect)
  const pageWrap = $('lkmPageWrap');
  if (pageWrap) {
    pageWrap.hidden = !isPage;
    if (isPage) {
      const mode = currentLibModalSpec.mode || 'next';
      if ($('lkmPageMode')) $('lkmPageMode').value = mode;
      if ($('lkmPageTargetWrap')) $('lkmPageTargetWrap').hidden = (mode !== 'goto');
      const sel = $('lkmPageTargetSelect');
      if (sel) {
        sel.innerHTML = pageTree().map(({ page, depth }) =>
          `<option value="${page.id}" ${currentLibModalSpec.pageId === page.id ? 'selected' : ''}>${'　'.repeat(depth)}${depth ? '↳ ' : ''}${escapeHtml(page.name)}</option>`
        ).join('');
      }
    }
  }

  // 专属实时动态组件面板同步 (#lkmWidgetWrap)
  const widgetWrap = $('lkmWidgetWrap');
  if (widgetWrap) {
    widgetWrap.hidden = !isWidget;
    if (isWidget && $('lkmWidgetKind')) {
      $('lkmWidgetKind').value = currentLibModalSpec.widgetKind || 'gpu';
    }
  }

  const tLabel = $('lkmTargetLabel');
  if (tLabel) {
    if (type === 'app') tLabel.textContent = '应用程序或文件路径 (.exe / .lnk / .bat)';
    else if (type === 'folder') tLabel.textContent = '文件夹路径';
    else if (type === 'file') tLabel.textContent = '文件路径（用系统默认关联程序打开）';
    else if (type === 'url') tLabel.textContent = '网页网址 URL (http:// 或 https://)';
    else if (type === 'hotkey') tLabel.textContent = '系统热键组合 (例如 Ctrl+Shift+Esc)';
    else if (type === 'command') tLabel.textContent = '控制台终端命令行';
    else if (type === 'ps1') tLabel.textContent = 'PowerShell 脚本文件路径';
    else if (type === 'media') tLabel.textContent = '多媒体控制指令 (play_pause / next / prev / mute)';
    else tLabel.textContent = '执行目标';
  }

  const desc = $('lkmActionDesc');
  const detail = $('lkmActionDetail');
  if (desc && detail) {
    if (type === 'app') {
      desc.textContent = '运行本地应用程序或文件';
      detail.textContent = currentLibModalSpec.target ? `${currentLibModalSpec.target}${currentLibModalSpec.args ? ' ' + currentLibModalSpec.args : ''}` : '(未设置目标路径)';
    } else if (type === 'folder') {
      desc.textContent = '在资源管理器中打开文件夹';
      detail.textContent = currentLibModalSpec.target || '(未设置文件夹路径)';
    } else if (type === 'file') {
      desc.textContent = '用系统默认程序打开文件';
      detail.textContent = currentLibModalSpec.target || '(未设置文件路径)';
    } else if (type === 'url') {
      desc.textContent = '在浏览器中打开网址';
      detail.textContent = currentLibModalSpec.target || '(未设置网址)';
    } else if (type === 'hotkey') {
      desc.textContent = '模拟系统快捷键组合';
      detail.textContent = currentLibModalSpec.hotkey || currentLibModalSpec.target || '(未配置快捷键)';
    } else if (type === 'command') {
      desc.textContent = '执行控制台终端命令行';
      detail.textContent = currentLibModalSpec.target || '(未设置命令)';
    } else if (type === 'ps1') {
      desc.textContent = '运行 PowerShell 脚本';
      detail.textContent = currentLibModalSpec.target || '(未设置脚本路径)';
    } else if (isVolume) {
      desc.textContent = 'WASAPI 底层极速声学与音量控制';
      detail.textContent = formatSpecSummaryText(currentLibModalSpec);
    } else if (type === 'media') {
      desc.textContent = '系统多媒体播放控制';
      detail.textContent = formatSpecSummaryText(currentLibModalSpec);
    } else if (isQr) {
      desc.textContent = '一键屏幕/剪贴板二维码智能解码';
      detail.textContent = '自动截取剪贴板或全屏画面识别二维码并复制结果';
    } else if (isMulti) {
      const count = (currentLibModalSpec.actions || []).length;
      desc.textContent = `复合动作宏 (${count} 步执行 · 可放置到面板后在右侧编辑详细步骤)`;
      detail.textContent = (currentLibModalSpec.actions || []).map((a, i) => `${i + 1}. [${TYPE_SHORT[a.type] || a.type}] ${a.target || a.hotkey || a.text || (a.ms ? a.ms + 'ms' : '')}`).join('  ▶  ') || '(宏动作序列为空)';
    } else if (isPage) {
      desc.textContent = '页面切换跳转';
      detail.textContent = pageActionLabel(currentLibModalSpec);
    } else {
      desc.textContent = '按键执行动作';
      detail.textContent = formatSpecSummaryText(currentLibModalSpec);
    }
  }

  const d1Text = $('lkmDualAct1Text');
  if (d1Text) d1Text.textContent = `[${TYPE_SHORT[type] || type}] ${formatSpecSummaryText(currentLibModalSpec)}`;
}

function updateLkmStyleUI() {
  if (!currentLibModalSpec) return;
  if ($('lkmLabelInput')) $('lkmLabelInput').value = currentLibModalSpec.label || '';
  const fsPct = Number(currentLibModalSpec.fontSize) || 17;
  if ($('lkmFontSize')) {
    $('lkmFontSize').value = fsPct;
    if ($('lkmFontSizeVal')) $('lkmFontSizeVal').textContent = fsPct + '%';
  }
  const icScale = Number(currentLibModalSpec.iconScale) || 62;
  if ($('lkmIconScale')) {
    $('lkmIconScale').value = icScale;
    if ($('lkmIconScaleVal')) $('lkmIconScaleVal').textContent = icScale + '%';
  }
  if ($('lkmColorInput')) {
    $('lkmColorInput').value = currentLibModalSpec.color || '#37474f';
    if ($('lkmColorVal')) $('lkmColorVal').textContent = currentLibModalSpec.color || '#37474f';
  }
}

function updateLkmDualUI() {
  if (!currentLibModalSpec) return;
  if (currentLibModalSpec.toggleAction && !currentLibModalSpec.action2 && (currentLibModalSpec.act2Target || currentLibModalSpec.act2Type)) {
    currentLibModalSpec.action2 = {
      type: currentLibModalSpec.act2Type || 'command',
      target: currentLibModalSpec.act2Target || '',
      args: currentLibModalSpec.act2Args || '',
    };
    delete currentLibModalSpec.act2Type;
    delete currentLibModalSpec.act2Target;
    delete currentLibModalSpec.act2Args;
  }
  const toggleAction = !!currentLibModalSpec.toggleAction;
  const act2 = currentLibModalSpec.action2 || {};
  if ($('lkmToggleAction')) $('lkmToggleAction').checked = toggleAction;
  if ($('lkmDualActionWrap')) $('lkmDualActionWrap').hidden = !toggleAction;
  if ($('lkmDualAct2Type')) $('lkmDualAct2Type').value = act2.type || 'command';
  if ($('lkmDualAct2Target')) $('lkmDualAct2Target').value = act2.target || act2.hotkey || '';

  const isDualBadge = !!currentLibModalSpec.badgeToggle;
  const isStaticBadge = !isDualBadge && !!currentLibModalSpec.badge;
  const isNoBadge = !isDualBadge && !isStaticBadge;

  const bNone = $('lkmBadgeModeNone');
  const bStatic = $('lkmBadgeModeStatic');
  const bDual = $('lkmBadgeModeDual');
  if (bNone) bNone.classList.toggle('active', isNoBadge);
  if (bStatic) bStatic.classList.toggle('active', isStaticBadge);
  if (bDual) bDual.classList.toggle('active', isDualBadge);

  if ($('lkmBadgeStaticWrap')) $('lkmBadgeStaticWrap').hidden = !isStaticBadge;
  if ($('lkmBadgeDualWrap')) $('lkmBadgeDualWrap').hidden = !isDualBadge;

  if (isStaticBadge) {
    if ($('lkmBadgeStaticText')) $('lkmBadgeStaticText').value = currentLibModalSpec.badge || '';
    if ($('lkmBadgeStaticColor')) $('lkmBadgeStaticColor').value = currentLibModalSpec.badgeBg || '#e53935';
  } else if (isDualBadge) {
    const b1 = currentLibModalSpec.badgeState1 || { text: 'ON', bg: '#107c41' };
    const b2 = currentLibModalSpec.badgeState2 || { text: 'OFF', bg: '#e53935' };
    if ($('lkmBadge1Text')) $('lkmBadge1Text').value = b1.text || '';
    if ($('lkmBadge1Color')) $('lkmBadge1Color').value = b1.bg || '#107c41';
    if ($('lkmBadge2Text')) $('lkmBadge2Text').value = b2.text || '';
    if ($('lkmBadge2Color')) $('lkmBadge2Color').value = b2.bg || '#e53935';
  }
}

function openLibKeyModal(entry) {
  if (!entry) return;
  currentLibModalEntry = entry;
  currentLibModalSpec = clone(entry.spec || {});
  lkmPreviewState = 1;
  const modal = $('libKeyModal');
  if (!modal) return;

  $('lkmTitle').textContent = `按键编辑器 · ${entry.name || '未命名'}`;
  $('lkmNameInput').value = entry.name || '';
  $('lkmTagsInput').value = (entry.tags || []).join(' ');

  setLkmTab('action');
  updateLkmActionUI();
  updateLkmStyleUI();
  updateLkmDualUI();
  updateLkmSwatch(1);

  const slotTag = $('lkmCurrentSlotTag');
  const applyBtn = $('lkmApplyToSlot');
  if (selected && selected.col < 5 && !isBackCell(selected.row, selected.col)) {
    slotTag.textContent = `r${selected.row}c${selected.col}`;
    applyBtn.disabled = false;
    applyBtn.style.opacity = '1';
  } else {
    slotTag.textContent = (selected && isBackCell(selected.row, selected.col)) ? '返回键不可覆盖' : '未选格子';
    applyBtn.disabled = true;
    applyBtn.style.opacity = '0.6';
  }

  modal.hidden = false;
}

function closeLibKeyModal() {
  const modal = $('libKeyModal');
  if (modal) modal.hidden = true;
  currentLibModalEntry = null;
  currentLibModalSpec = null;
  iconPickerTarget = null;
}

function openIconPickerForLib() {
  iconPickerTarget = 'libModal';
  const modal = $('iconPickerModal');
  if (!modal) return;
  modal.hidden = false;
  $('ipSearch').value = '';
  renderIconPicker();
  $('ipSearch').focus();
}

async function pickAppForLib() {
  if (DEMO) {
    if (currentLibModalSpec) {
      currentLibModalSpec.target = 'C:\\Program Files\\Example\\App.exe';
      if (!currentLibModalSpec.label || currentLibModalSpec.label === '新按键') {
        currentLibModalSpec.label = 'App';
      }
      updateLkmActionUI();
      updateLkmSwatch();
      toast('已选择示例应用路径（预览模式）');
    }
    return;
  }
  const p = await api.dialogPick({ properties: ['openFile'] });
  if (!p) return;
  const cls = await api.actionClassify(p);
  const icon = await api.iconExtract(p);
  if (currentLibModalSpec) {
    currentLibModalSpec.target = cls.abs || p;
    if (!currentLibModalSpec.label || currentLibModalSpec.label === '新按键') {
      currentLibModalSpec.label = cls.label || '';
    }
    if (icon) {
      currentLibModalSpec.icon = icon;
    }
    updateLkmActionUI();
    updateLkmSwatch();
    toast(`已选择：${cls.label || p}`);
  }
}

async function pickLocalIconForLib() {
  if (DEMO) {
    if (currentLibModalSpec) {
      currentLibModalSpec.icon = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" fill="%23f59e0b"/></svg>';
      updateLkmSwatch();
      toast('已选择示例图标（预览模式）');
    }
    return;
  }
  const r = await api.dialogPick({
    multiple: false,
    properties: ['openFile'],
    filters: [{ name: '图片与图标文件', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'svg', 'ico', 'exe', 'lnk'] }]
  });
  const filePath = typeof r === 'string' ? r : (Array.isArray(r) ? r[0] : (r && r.paths && r.paths[0]));
  if (!filePath || !currentLibModalSpec) return;
  const iconDataUrl = await api.iconExtract(filePath);
  if (!iconDataUrl) {
    toast('无法从该文件中提取图标');
    return;
  }
  const ext = filePath.split('.').pop().toLowerCase();
  const isCropable = ['png', 'jpg', 'jpeg', 'webp', 'bmp'].includes(ext);
  if (isCropable) {
    openCropper(iconDataUrl, (cropped) => {
      if (currentLibModalSpec) {
        currentLibModalSpec.icon = cropped;
        updateLkmSwatch();
        toast('已裁剪并导入本地图片');
      }
    });
  } else {
    currentLibModalSpec.icon = iconDataUrl;
    updateLkmSwatch();
    toast('已导入本地图标');
  }
}

async function fetchFaviconForLib() {
  if (!currentLibModalSpec) return;
  const url = (currentLibModalSpec.target || '').trim();
  if (!url) { toast('请先输入网站网址'); return; }
  if (DEMO) {
    toast('正在抓取网站图标…');
    setTimeout(() => {
      currentLibModalSpec.icon = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="%230284c7"/></svg>';
      updateLkmSwatch();
      toast('成功获取网站图标（示例）');
    }, 300);
    return;
  }
  toast('正在抓取网站高清图标…');
  try {
    const res = await api.fetchFavicon(url);
    const dataUrl = res && (res.dataUrl || res.iconData);
    if (res && res.ok && dataUrl) {
      currentLibModalSpec.icon = dataUrl;
      updateLkmSwatch();
      toast('已成功抓取网站图标！');
    } else {
      toast('未能抓取到网站图标：' + ((res && res.error) || '未知'));
    }
  } catch (err) {
    toast('抓取失败：' + (err && err.message));
  }
}

// ------------------------------------------------------------------ 页面快照专属管理中心
const snapshotEntries = () => (cfg && cfg.pageSnapshots) || [];

function openPageSnapshotModal() {
  const modal = $('pageSnapshotModal');
  if (!modal) return;
  renderPageSnapshots();
  modal.hidden = false;
}

function closePageSnapshotModal() {
  const modal = $('pageSnapshotModal');
  if (modal) modal.hidden = true;
}

function renderPageSnapshots() {
  const grid = $('psmGrid');
  const badge = $('psmCountBadge');
  if (!grid) return;
  grid.innerHTML = '';
  const list = snapshotEntries();
  if (badge) badge.textContent = `${list.length} 个快照`;

  if (!list.length) {
    grid.innerHTML = `<div class="psm-empty">暂无保存的页面快照。<br>点击右上角「📥 将当前页存为快照」，即可把当前 15 键 + 3 块副屏保存为独立模板！</div>`;
    return;
  }

  for (const snap of list) {
    const card = document.createElement('div');
    card.className = 'psm-card';

    const top = document.createElement('div');
    top.className = 'psm-card-top';

    const miniWrap = document.createElement('div');
    miniWrap.className = 'psm-minigrid-wrap';
    miniWrap.appendChild(libMiniGrid(snap.page || {}));
    top.appendChild(miniWrap);

    const info = document.createElement('div');
    info.className = 'psm-card-info';
    info.appendChild(el('div', 'psm-card-title', snap.name || '未命名快照'));
    const timeStr = snap.savedAt ? new Date(snap.savedAt).toLocaleString('zh-CN', { hour12: false }) : '';
    info.appendChild(el('div', 'psm-card-time', timeStr || '未知时间'));
    const btnCount = Object.keys((snap.page || {}).buttons || {}).length;
    const stripCount = Object.keys((snap.page || {}).strips || {}).length;
    info.appendChild(el('div', 'psm-card-stats', `${btnCount} 个按键 · ${stripCount} 块副屏`));
    top.appendChild(info);
    card.appendChild(top);

    const actions = document.createElement('div');
    actions.className = 'psm-card-actions';

    const btnNew = document.createElement('button');
    btnNew.className = 'ghost tiny';
    btnNew.textContent = '＋ 恢复新页';
    btnNew.onclick = () => applyPageSnapshot(snap, 'new');
    actions.appendChild(btnNew);

    const btnOverwrite = document.createElement('button');
    btnOverwrite.className = 'ghost tiny';
    btnOverwrite.textContent = '⚡ 覆盖当前页';
    btnOverwrite.onclick = () => applyPageSnapshot(snap, 'overwrite');
    actions.appendChild(btnOverwrite);

    const btnRename = document.createElement('button');
    btnRename.className = 'ghost tiny';
    btnRename.textContent = '✏️ 改名';
    btnRename.onclick = () => renamePageSnapshot(snap);
    actions.appendChild(btnRename);

    const btnDel = document.createElement('button');
    btnDel.className = 'ghost tiny danger';
    btnDel.textContent = '🗑️ 删除';
    btnDel.style.marginLeft = 'auto';
    btnDel.onclick = () => deletePageSnapshot(snap.id);
    actions.appendChild(btnDel);

    card.appendChild(actions);
    grid.appendChild(card);
  }
}

async function saveCurrentPageAsSnapshot() {
  const p = curPage();
  if (!p || (!Object.keys(p.buttons || {}).length && !Object.keys(p.strips || {}).length)) {
    toast('当前页面是空的，无需保存快照');
    return;
  }
  const defaultName = `${p.name} 快照`;
  const name = await askText('页面快照名称', defaultName, '输入快照名称');
  if (name == null || !name.trim()) return;

  cfg.pageSnapshots = cfg.pageSnapshots || [];
  cfg.pageSnapshots.unshift({
    id: 'PS_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    name: name.trim().slice(0, 30),
    tags: [],
    savedAt: new Date().toISOString(),
    page: {
      buttons: clone(p.buttons || {}),
      strips: clone(p.strips || {}),
      gradient: clone(p.gradient || { enabled: false, from: '#1565c0', to: '#6a1b9a', angle: 135 }),
      autoApp: p.autoApp || '',
      autoTitle: p.autoTitle || ''
    }
  });

  await libSave();
  renderPageSnapshots();
  toast(`已将「${name.trim()}」保存为页面快照`);
}

async function applyPageSnapshot(snap, mode) {
  const pageData = snap.page || { buttons: {}, strips: {} };
  let how = mode;
  if (!how) {
    const ok = await askConfirm('应用页面快照', `将快照「${snap.name}」覆盖到当前页「${curPage().name}」？确定=覆盖当前页，取消=新建为独立页面`);
    how = ok ? 'overwrite' : 'new';
  }
  if (how === 'overwrite') {
    pushHistory(`应用快照「${snap.name}」覆盖当前页`);
    const p = curPage();
    await stopPageMacrosIfNeeded(p.id);
    p.buttons = clone(pageData.buttons || {});
    p.strips = clone(pageData.strips || {});
    if (pageData.gradient) p.gradient = clone(pageData.gradient);
    if (pageData.autoApp !== undefined) p.autoApp = pageData.autoApp;
    if (pageData.autoTitle !== undefined) p.autoTitle = pageData.autoTitle;
    selected = null;
    await persistAll();
    closePageSnapshotModal();
    toast(`已用快照「${snap.name}」覆盖当前页面`);
    return;
  }
  const name = await askText('以此快照创建新页面', snap.name);
  if (name == null || !name.trim()) return;
  const id = newPageId();
  pushHistory(`从快照新建页面「${name.trim()}」`);
  cfg.pages.push({
    id,
    name: name.trim(),
    parent: null,
    buttons: clone(pageData.buttons || {}),
    strips: clone(pageData.strips || {}),
    gradient: clone(pageData.gradient || { enabled: false, from: '#1565c0', to: '#6a1b9a', angle: 135 }),
    autoApp: pageData.autoApp || '',
    autoTitle: pageData.autoTitle || ''
  });
  cfg.currentPage = id;
  selected = null;
  await persistAll();
  closePageSnapshotModal();
  toast(`已成功用快照创建新页面「${name.trim()}」`);
}

async function renamePageSnapshot(snap) {
  const name = await askText('重命名页面快照', snap.name);
  if (name == null || !name.trim()) return;
  snap.name = name.trim().slice(0, 30);
  await libSave();
  renderPageSnapshots();
  toast('已更新快照名称');
}

async function deletePageSnapshot(id) {
  const snap = snapshotEntries().find(x => x.id === id);
  if (!snap) return;
  if (!(await askConfirm('删除页面快照', `确定要删除快照「${snap.name}」吗？已创建的页面不受影响。`))) return;
  cfg.pageSnapshots = snapshotEntries().filter(x => x.id !== id);
  await libSave();
  renderPageSnapshots();
  toast(`已删除快照「${snap.name}」`);
}

async function exportAllPageSnapshots() {
  if (DEMO) { toast('预览模式下不能导出'); return; }
  const list = snapshotEntries();
  if (!list.length) { toast('暂无快照可导出'); return; }
  const json = JSON.stringify({ type: 'akp153-page-snapshots', version: 1, exportedAt: new Date().toISOString(), snapshots: list }, null, 2);
  const r = await api.libraryExport({ json, name: `akp153-page-snapshots-${list.length}.json` });
  if (r && r.ok) toast(`已导出 ${list.length} 个页面快照到 ${r.path}`);
  else if (r && !r.canceled) toast('导出失败：' + (r.error || '未知错误'));
}

async function importPageSnapshots() {
  if (DEMO) { toast('预览模式下不能导入'); return; }
  const r = await api.libraryImport();
  if (!r || r.canceled) return;
  if (!r.ok) { toast(r.error); return; }
  const data = r.data;
  const list = Array.isArray(data) ? data : (data && (data.snapshots || data.entries));
  if (!Array.isArray(list)) { toast('文件格式不正确，缺少快照列表'); return; }
  cfg.pageSnapshots = cfg.pageSnapshots || [];
  let added = 0;
  for (const s of list) {
    if (!s || (!s.page && !s.buttons)) continue;
    const pageObj = s.page || { buttons: s.buttons || {}, strips: s.strips || {} };
    cfg.pageSnapshots.push({
      id: 'PS_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      name: String(s.name || '导入快照').slice(0, 30),
      tags: normTags(s.tags),
      savedAt: s.savedAt || new Date().toISOString(),
      page: pageObj
    });
    added++;
  }
  await libSave();
  renderPageSnapshots();
  toast(`成功导入了 ${added} 个页面快照`);
}

/** Big card used in the expanded panel. */
function libCardEl(entry) {
  const page = isPageEntry(entry);
  const isSelected = libSelectedIds.has(entry.id);
  const c = document.createElement('div');
  c.className = 'libcard' + (page ? ' ispage' : '') + (libBatchMode ? ' batch-mode' : '') + (isSelected ? ' selected' : '');
  c.draggable = !page && !libBatchMode;
  c.title = page ? '整页快照' : '点击打开设置详情，或直接拖拽到按键格子';

  if (libBatchMode) {
    const chk = document.createElement('input');
    chk.type = 'checkbox';
    chk.className = 'batch-checkbox';
    chk.checked = isSelected;
    chk.onclick = (e) => {
      e.stopPropagation();
      toggleLibSelect(entry.id);
    };
    c.appendChild(chk);
    c.onclick = (e) => {
      e.stopPropagation();
      toggleLibSelect(entry.id);
    };
  } else {
    c.onclick = () => (page ? libraryApplyPage(entry) : openLibKeyModal(entry));
  }

  c.appendChild(libSwatch(entry, 'sw'));
  c.appendChild(el('div', 'nm', entry.name));
  const tg = (entry.tags || []).join(' · ');
  c.appendChild(el('div', 'tg', tg || '未分类'));
  const sub = el('div', 'tg', page
    ? `整页 · ${Object.keys((entry.page || {}).buttons || {}).length} 键`
    : (entry.spec.type === 'multi' || entry.spec.type === 'macro'
      ? `复合宏 · ${(entry.spec.actions || []).length} 个步骤`
      : (entry.spec.target || (entry.spec.type === 'page' ? pageActionLabel(entry.spec) : ''))));
  sub.title = page ? '整页快照' : (entry.spec.type === 'multi' ? `复合宏 (${(entry.spec.actions || []).length} 动作)` : (entry.spec.target || ''));
  c.appendChild(sub);

  if (!libBatchMode && page) {
    const ops = document.createElement('div');
    ops.className = 'ops';
    const mk = (text, cls, fn) => {
      const b = document.createElement('button');
      b.textContent = text;
      if (cls) b.className = cls;
      b.onclick = (e) => { e.stopPropagation(); fn(); };
      return b;
    };
    ops.appendChild(mk('建成新页', 'wide', () => libraryApplyPage(entry, 'new')));
    ops.appendChild(mk('覆盖当前页', 'wide', () => libraryApplyPage(entry, 'overwrite')));
    ops.appendChild(mk('删除', 'dz wide', () => libraryRemove(entry.id)));
    c.appendChild(ops);
  }

  c.addEventListener('dragstart', (e) => {
    if (libBatchMode) return;
    dragLib = entry.id;
    e.dataTransfer.effectAllowed = 'copy';
    e.dataTransfer.setData('text/plain', 'lib:' + entry.id);
  });
  c.addEventListener('dragend', () => { dragLib = null; });
  return c;
}

function renderLibrary() {
  const box = $('library');
  if (!box) return;
  $('libraryCount').textContent = String(libEntries().length);
  box.innerHTML = '';
  const list = libEntries().filter(libMatches);
  if (!libEntries().length) {
    box.appendChild(el('p', 'lib-empty',
      '库是空的。在右边把某个键调好之后点「存进按键库」，以后就能拖回任意格子 —— 换页、重装、换机器都不会丢。'));
    return;
  }
  if (!list.length) {
    box.appendChild(el('p', 'lib-empty', '没有匹配的条目。'));
    return;
  }
  for (const e of list) box.appendChild(libItemEl(e));
}

function renderLibPanel() {
  const panel = $('libPanel');
  if (!panel || panel.hidden) return;
  updateLibBatchBar();

  const tags = libAllTags();
  const bar = $('libTags');
  bar.innerHTML = '';
  const mkTag = (label, value, count) => {
    const b = document.createElement('button');
    b.className = 'libtag' + (libTag === value ? ' on' : '');
    b.textContent = label;
    if (count != null) b.appendChild(el('i', '', String(count)));
    b.onclick = () => { libTag = libTag === value ? '' : value; renderLibPanel(); renderLibrary(); };
    return b;
  };
  bar.appendChild(mkTag('全部', '', libEntries().length));
  for (const [t, n] of tags) bar.appendChild(mkTag(t, t, n));

  const grid = $('libGrid');
  grid.innerHTML = '';
  const list = libEntries().filter(libMatches);
  if (!list.length) {
    grid.appendChild(el('p', 'lib-empty', libEntries().length ? '没有匹配的条目。' : '库还是空的 —— 先在右边把某个键配好，再点「存进按键库」。'));
  }
  for (const e of list) grid.appendChild(libCardEl(e));
  $('libHint').textContent = `共 ${libEntries().length} 条，显示 ${list.length} 条`
    + (libTag ? ` · 标签「${libTag}」` : '');
}

function setDrawer(open) {
  const d = $('drawer');
  if (d) d.classList.toggle('open', !!open);
}

function openLibPanel(open) {
  const p = $('libPanel');
  if (!p) return;
  p.hidden = !open;
  if (open) { $('libSearch2').value = libQuery; renderLibPanel(); }
}

// ------------------------------------------------------------------ library ops

function libraryAdd(spec) {
  if (!spec || (! isActionConfigured(spec) && !spec.label && !spec.icon)) {
    toast('这个键还没配任何内容，无法存入库'); return;
  }
  const name = String(spec.label || (spec.type === 'page' ? pageActionLabel(spec) : TYPE_SHORT[spec.type]) || '按键')
    .split('\n')[0].slice(0, 24);
  cfg.library = cfg.library || [];
  cfg.library.unshift({
    id: 'L' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
    name,
    tags: normTags(libTag && libTag !== '' ? libTag : ''),   // 存进正在筛选的标签，省一次编辑
    savedAt: new Date().toISOString(),
    spec: clone(spec),
  });
  libSave().then(() => setDrawer(true));
  toast('已存进按键库：' + name + (libTag ? `（标签 ${libTag}）` : ''));
}

async function libraryApply(entry) {
  if (!selected || selected.col === 5) { toast('先在左边点一个格子，再点库里的条目'); return; }
  if (isBackCell(selected.row, selected.col)) { toast('子页右下角的自动返回键不可覆盖'); return; }
  await stopKeyMacroIfNeeded(selected.row, selected.col);
  pageButtons()[selected.row + ',' + selected.col] = clone(entry.spec);
  await commit(true);
  renderInspector();
  toast(`已把「${entry.name}」放到 r${selected.row}c${selected.col}`);
}

async function libraryRemove(id) {
  const e = libEntries().find((x) => x.id === id);
  if (!e) return;
  if (!(await askConfirm('从库里删除', `「${e.name}」会从按键库移除，已放到格子上的不受影响。`))) return;
  cfg.library = libEntries().filter((x) => x.id !== id);
  await libSave();
}

async function libraryRename(entry) {
  const name = await askText('库条目的名字', entry.name);
  if (name == null || !name.trim()) return;
  entry.name = name.trim().slice(0, 24);
  await libSave();
}

async function libraryEditTags(entry) {
  const v = await askText(
    `标签（空格或逗号分隔）`,
    (entry.tags || []).join(' '),
    '例如：开发 常用 视频'
  );
  if (v == null) return;
  entry.tags = normTags(v);
  await libSave();
}

/** 把当前整页（15 个键 + 3 块屏）存进库 —— 换页/重装都能一键还原。 */
function libraryAddPage() {
  const p = curPage();
  if (!Object.keys(p.buttons).length) { toast('这一页是空的，没什么可存'); return; }
  cfg.library = cfg.library || [];
  cfg.library.unshift({
    id: 'L' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
    name: String(p.name).slice(0, 24),
    kind: 'page',
    tags: normTags(libTag && libTag !== '' ? libTag : ''),
    savedAt: new Date().toISOString(),
    page: { buttons: clone(p.buttons), strips: clone(p.strips) },
  });
  libSave().then(() => setDrawer(true));
  toast(`已把整页「${p.name}」存入按键库（${Object.keys(p.buttons).length} 个键）`);
}

/** 整页快照怎么用：'new' 建成新页 / 'overwrite' 覆盖当前页 / 不传就问一句。 */
async function libraryApplyPage(entry, mode) {
  const snap = entry.page || { buttons: {}, strips: {} };
  let how = mode;
  if (!how) {
    const ok = await askConfirm('整页快照',
      `把「${entry.name}」覆盖到当前页「${curPage().name}」？确定=覆盖，取消=建成一个新页`);
    how = ok ? 'overwrite' : 'new';
  }
  if (how === 'overwrite') {
    const p = curPage();
    await stopPageMacrosIfNeeded(p.id);
    p.buttons = clone(snap.buttons || {});
    p.strips = clone(snap.strips || {});
    selected = null;
    await persistAll();
    toast(`已用「${entry.name}」覆盖当前页`);
    return;
  }
  const name = await askText('用这个快照建一个新页', entry.name);
  if (name == null || !name.trim()) return;
  const id = newPageId();
  cfg.pages.push({
    id, name: name.trim(), parent: null,
    buttons: clone(snap.buttons || {}), strips: clone(snap.strips || {}),
  });
  cfg.currentPage = id;
  selected = null;
  await persistAll();
  toast(`已建成新页「${name.trim()}」`);
}

/** 用当前选中的格子覆盖库里这一条 —— 调好了再更新，不用删了重建。 */
async function libraryUpdate(entry) {
  if (!selected || selected.col === 5) { toast('先在左边点一个格子（就是你调好的那个）'); return; }
  const spec = pageButtons()[selected.row + ',' + selected.col];
  if (!spec) { toast('选中的格子是空的，没有可覆盖的内容'); return; }
  if (!(await askConfirm('覆盖库条目', `用 r${selected.row}c${selected.col} 当前的配置覆盖库里的「${entry.name}」？`))) return;
  entry.spec = clone(spec);
  entry.savedAt = new Date().toISOString();
  await libSave();
  toast(`已更新「${entry.name}」`);
}

async function libraryExport(onlyTag) {
  if (DEMO) { toast('预览模式下不能导出'); return; }
  const list = onlyTag ? libEntries().filter((e) => (e.tags || []).includes(onlyTag)) : libEntries();
  if (!list.length) { toast('没有可导出的条目'); return; }
  const name = onlyTag ? `akp153-library-${onlyTag}.json` : 'akp153-library.json';
  const json = JSON.stringify({ type: 'akp153-library', version: 1, exportedAt: new Date().toISOString(), entries: list }, null, 2);
  const r = await api.libraryExport({ json, name });
  if (r && r.ok) toast('已导出到 ' + r.path);
  else if (r && !r.canceled) toast('导出失败：' + (r.error || '未知错误'));
}

async function libraryImport() {
  if (DEMO) { toast('预览模式下不能导入'); return; }
  const r = await api.libraryImport();
  if (!r || r.canceled) return;
  if (!r.ok) { toast(r.error); return; }
  const data = r.data;
  const list = Array.isArray(data) ? data : (data && data.entries);
  if (!Array.isArray(list)) { toast('这个文件里没有 entries 数组'); return; }
  const have = new Set(libEntries().map((e) => e.id));
  let added = 0;
  for (const e of list) {
    if (!e || !e.spec) continue;
    const id = (e.id && !have.has(e.id)) ? e.id : 'L' + Math.random().toString(36).slice(2, 10);
    have.add(id);
    cfg.library.push({
      id,
      name: String(e.name || e.spec.label || '导入条目').slice(0, 24),
      tags: normTags(e.tags),
      savedAt: e.savedAt || new Date().toISOString(),
      spec: e.spec,
    });
    added++;
  }
  await libSave();
  toast(`导入了 ${added} 条`);
}

function setDrawer(open) {
  const d = $('drawer');
  if (d) d.classList.toggle('open', !!open);
}

// ---------------------------------------------------------------- page bar

function newPageId() {
  return 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
}

/** Save + redraw tabs / grid / inspector / device in one go. */
async function persistAll() {
  if (!DEMO) await saveConfig();
  renderPageTabs();
  buildGrid();
  renderInspector();
  if (!DEMO) await repaintAll();
}

async function goToPage(id) {
  if (!id || id === cfg.currentPage || !pageById(id)) return;
  cfg.currentPage = id;
  syncRuntimeStoreToConfig(cfg);
  selected = null;
  multiSelected.clear();
  if (!DEMO && typeof api !== 'undefined' && api.pageManualSwitch) {
    api.pageManualSwitch(id).catch(() => {});
  }
  await persistAll();
  triggerGridTransition();
}

function renderPageTabs() {
  const box = $('pageTabs');
  if (!box) return;
  box.innerHTML = '';
  for (const { page, depth } of pageTree()) {
    const t = document.createElement('button');
    t.className = 'ptab' + (page.id === cfg.currentPage ? ' on' : '');
    t.dataset.pageId = page.id;
    if (depth) {
      t.style.paddingLeft = `${Math.min(depth * 14 + 8, 36)}px`;
    }

    const iconSpan = document.createElement('span');
    iconSpan.className = 'ptab-icon';
    iconSpan.textContent = depth ? '📁' : '📄';

    const nameSpan = document.createElement('span');
    nameSpan.className = 'ptab-name';
    nameSpan.textContent = (depth ? '↳ ' : '') + page.name;

    const count = Object.keys(page.buttons || {}).filter(k => {
      const b = page.buttons[k];
      return b && (b.type || b.label || b.icon || b.color);
    }).length;
    const countSpan = document.createElement('span');
    countSpan.className = 'ptab-count';
    countSpan.textContent = `${count}/15`;

    t.appendChild(iconSpan);
    t.appendChild(nameSpan);
    t.appendChild(countSpan);

    if (page.autoApp || page.autoTitle) {
      nameSpan.textContent = (depth ? '↳ ' : '') + page.name + ' ⚡';
    }
    t.title = (depth ? `子页「${page.name}」（返回键已自动生成）` : `顶层页「${page.name}」`)
      + (page.autoApp ? ` · 关联进程: ${page.autoApp}` : '')
      + (page.autoTitle ? ` · 标题匹配: ${page.autoTitle}` : '')
      + ` · 已配置 ${count}/15 键 (支持拖拽排序，右键管理)`;
    t.onclick = () => goToPage(page.id);

    // 右键上下文菜单
    t.oncontextmenu = (e) => {
      e.preventDefault();
      e.stopPropagation();
      showPageContextMenu(e.clientX, e.clientY, page.id);
    };

    // 拖拽排序（同层级兄弟节点调换顺序）
    t.draggable = true;
    t.addEventListener('dragstart', (e) => {
      dragPageId = page.id;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', 'page:' + page.id);
      t.classList.add('page-dragging');
    });
    t.addEventListener('dragend', () => {
      dragPageId = null;
      document.querySelectorAll('.ptab').forEach(el => {
        el.classList.remove('page-dragging', 'drag-over-top', 'drag-over-bottom');
      });
    });
    t.addEventListener('dragover', (e) => {
      if (!dragPageId || dragPageId === page.id) return;
      const srcPage = pageById(dragPageId);
      if (!srcPage || srcPage.parent !== page.parent) return; // 仅同级拖拽重排
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      const rect = t.getBoundingClientRect();
      const isTop = (e.clientY - rect.top) < (rect.height / 2);
      t.classList.toggle('drag-over-top', isTop);
      t.classList.toggle('drag-over-bottom', !isTop);
    });
    t.addEventListener('dragleave', () => {
      t.classList.remove('drag-over-top', 'drag-over-bottom');
    });
    t.addEventListener('drop', async (e) => {
      t.classList.remove('drag-over-top', 'drag-over-bottom');
      if (!dragPageId || dragPageId === page.id) return;
      const srcPage = pageById(dragPageId);
      if (!srcPage || srcPage.parent !== page.parent) return;
      e.preventDefault();
      e.stopPropagation();
      const rect = t.getBoundingClientRect();
      const isTop = (e.clientY - rect.top) < (rect.height / 2);
      const srcBlock = [srcPage, ...getAllPageDescendants(srcPage.id)];
      const srcIds = new Set(srcBlock.map(x => x.id));
      const remaining = (cfg.pages || []).filter(x => !srcIds.has(x.id));
      if (isTop) {
        const idx = remaining.findIndex(x => x.id === page.id);
        if (idx !== -1) remaining.splice(idx, 0, ...srcBlock);
      } else {
        const targetDesc = getAllPageDescendants(page.id);
        const lastTargetId = targetDesc.length ? targetDesc[targetDesc.length - 1].id : page.id;
        const idx = remaining.findIndex(x => x.id === lastTargetId);
        if (idx !== -1) remaining.splice(idx + 1, 0, ...srcBlock);
      }
      cfg.pages = remaining;
      dragPageId = null;
      if (!DEMO) await saveConfig();
      renderPageTabs();
      toast('已调整页面顺序');
    });

    box.appendChild(t);
  }
}

let dragPageId = null;

function getAllPageDescendants(pageId) {
  const res = [];
  const collect = (pid) => {
    for (const p of (cfg.pages || []).filter(x => x.parent === pid)) {
      res.push(p);
      collect(p.id);
    }
  };
  collect(pageId);
  return res;
}

// ------------------------------------------------------------ page context menu

let pcmTargetId = null;

function showPageContextMenu(x, y, pageId) {
  const cm = $('pageContextMenu');
  if (!cm) return;
  pcmTargetId = pageId;
  const targetPage = pageById(pageId);
  if (!targetPage) return;

  const btnDel = $('pcmDel');
  if (btnDel) {
    btnDel.disabled = ((cfg.pages || []).length <= 1);
  }

  const w = 180, h = 180;
  const px = Math.min(x, window.innerWidth - w - 10);
  const py = Math.min(y, window.innerHeight - h - 10);
  cm.style.left = px + 'px';
  cm.style.top = py + 'px';
  cm.hidden = false;
}

function hidePageContextMenu() {
  const cm = $('pageContextMenu');
  if (cm) cm.hidden = true;
  pcmTargetId = null;
}

function initPageContextMenu() {
  const cm = $('pageContextMenu');
  if (!cm) return;

  $('pcmRename').onclick = async () => {
    const tid = pcmTargetId;
    hidePageContextMenu();
    if (tid) await pageRename(tid);
  };

  $('pcmDup').onclick = async () => {
    const tid = pcmTargetId;
    hidePageContextMenu();
    if (tid) await pageDuplicate(tid);
  };

  $('pcmSnapshot').onclick = async () => {
    const tid = pcmTargetId;
    hidePageContextMenu();
    if (tid && tid !== cfg.currentPage) {
      await goToPage(tid);
    }
    openPageSnapshotModal();
  };

  $('pcmDel').onclick = async () => {
    const tid = pcmTargetId;
    hidePageContextMenu();
    if (tid) await pageDelete(tid);
  };

  document.addEventListener('click', (e) => {
    if (!e.target.closest('#pageContextMenu')) hidePageContextMenu();
  });
}

async function pageAddTop() {
  const n = pageTree().filter((t) => !t.page.parent).length + 1;
  const name = await askText('新建顶层页', `第 ${n} 页`, '例如：娱乐、开发、素材');
  if (name == null || !name.trim()) return;
  const id = newPageId();
  cfg.pages.push({ id, name: name.trim(), parent: null, buttons: {}, strips: {} });
  cfg.currentPage = id;
  selected = null;
  await persistAll();
}

async function pageAddChild() {
  const parent = curPage();
  const name = await askText('新建子页', '新子页', '例如：娱乐、开发、素材');
  if (name == null || !name.trim()) return;
  const id = newPageId();
  cfg.pages.push({ id, name: name.trim(), parent: parent.id, buttons: {}, strips: {} });
  cfg.currentPage = id;
  selected = null;
  await persistAll();
  toast(`子页「${name.trim()}」已建好 —— 右下角会自动出现返回键`);
}

async function pageRename(targetId) {
  const p = targetId ? pageById(targetId) : curPage();
  if (!p) return;
  const name = await askText('页面改名', p.name);
  if (name == null || !name.trim()) return;
  p.name = name.trim();
  await persistAll();
}

async function pageDuplicate(targetId) {
  const p = targetId ? pageById(targetId) : curPage();
  if (!p) return;
  const name = await askText('复制本页', p.name + ' 副本');
  if (name == null || !name.trim()) return;
  const id = newPageId();
  cfg.pages.push({
    id, name: name.trim(), parent: p.parent,
    buttons: clone(p.buttons), strips: clone(p.strips),
  });
  cfg.currentPage = id;
  selected = null;
  await persistAll();
}

async function pageDelete(targetId) {
  const p = targetId ? pageById(targetId) : curPage();
  if (!p) return;
  if (cfg.pages.length <= 1) { toast('至少要留一页'); return; }
  const kids = [];
  const collect = (id) => { for (const c of childPages(id)) { kids.push(c); collect(c.id); } };
  collect(p.id);
  const msg = kids.length
    ? `「${p.name}」下面还有 ${kids.length} 个子页，会一起删掉，且不能撤销。`
    : `会删掉「${p.name}」以及里面的所有按键，不能撤销。`;
  if (!(await askConfirm('删除页面', msg))) return;
  const doomed = new Set([p.id, ...kids.map((k) => k.id)]);
  for (const pid of doomed) {
    await stopPageMacrosIfNeeded(pid);
  }
  cfg.pages = cfg.pages.filter((x) => !doomed.has(x.id));
  if (doomed.has(cfg.currentPage)) {
    cfg.currentPage = (p.parent && pageById(p.parent)) ? p.parent : cfg.pages[0].id;
  }
  selected = null;
  await persistAll();
  toast('页面已删除');
}

// ------------------------------------------------------------ context menu

let cmTarget = null; // { row, col }

function showContextMenu(x, y, row, col) {
  const cm = $('contextMenu');
  if (!cm) return;
  cmTarget = { row, col };
  const isBack = isBackCell(row, col);
  const spec = (col === 5) ? pageStrips()[String(row)] : pageButtons()[row + ',' + col];

  $('cmCopy').disabled = !spec || isBack;
  $('cmCut').disabled = !spec || isBack || col === 5;
  $('cmPaste').disabled = !clipboardKey || isBack || col === 5;
  $('cmSaveLib').disabled = !spec || isBack;
  $('cmClear').disabled = !spec || isBack || col === 5;

  const w = 180, h = 180;
  const px = Math.min(x, window.innerWidth - w - 10);
  const py = Math.min(y, window.innerHeight - h - 10);
  cm.style.left = px + 'px';
  cm.style.top = py + 'px';
  cm.hidden = false;
}

function hideContextMenu() {
  const cm = $('contextMenu');
  if (cm) cm.hidden = true;
  cmTarget = null;
}

function initContextMenu() {
  $('cmCopy').onclick = () => {
    if (!cmTarget) return;
    const { row, col } = cmTarget;
    const spec = (col === 5) ? pageStrips()[String(row)] : pageButtons()[row + ',' + col];
    if (spec) {
      clipboardKey = clone(spec);
      toast(`已复制按键配置（Ctrl+V 粘贴到其他格子）`);
    }
    hideContextMenu();
  };

  $('cmCut').onclick = async () => {
    if (!cmTarget || cmTarget.col === 5) return;
    const { row, col } = cmTarget;
    const spec = pageButtons()[row + ',' + col];
    if (spec) {
      clipboardKey = clone(spec);
      await removeKey(row, col);
      toast(`已剪切按键配置`);
    }
    hideContextMenu();
  };

  $('cmPaste').onclick = async () => {
    if (!cmTarget || cmTarget.col === 5 || !clipboardKey) return;
    const { row, col } = cmTarget;
    if (isBackCell(row, col)) return;
    pushHistory(`粘贴按键到 r${row}c${col}`);
    await stopKeyMacroIfNeeded(row, col);
    pageButtons()[row + ',' + col] = clone(clipboardKey);
    await commit(true);
    select(row, col);
    toast(`已粘贴到 r${row}c${col}`);
    hideContextMenu();
  };

  if ($('cmCopyStyle')) {
    $('cmCopyStyle').onclick = () => {
      if (!cmTarget) return;
      const { row, col } = cmTarget;
      const spec = (col === 5) ? pageStrips()[String(row)] : pageButtons()[row + ',' + col];
      if (spec) setStyleBrush(spec);
      hideContextMenu();
    };
  }

  $('cmSaveLib').onclick = () => {
    if (!cmTarget) return;
    const { row, col } = cmTarget;
    const spec = (col === 5) ? pageStrips()[String(row)] : pageButtons()[row + ',' + col];
    if (spec) libraryAdd(spec);
    hideContextMenu();
  };

  $('cmClear').onclick = async () => {
    if (!cmTarget || cmTarget.col === 5) return;
    const { row, col } = cmTarget;
    await removeKey(row, col);
    toast(`已清空格子`);
    hideContextMenu();
  };

  document.addEventListener('click', (e) => {
    if (!e.target.closest('#contextMenu')) hideContextMenu();
  });
}

// ------------------------------------------------------------ icon picker

function getCustomSubCategories() {
  const set = new Set(DEFAULT_CUSTOM_CATEGORIES);
  const list = (cfg && cfg.customIcons) || [];
  for (const item of list) {
    if (item.category && item.category !== '全部') set.add(item.category);
    if (Array.isArray(item.tags)) {
      item.tags.forEach(t => { if (t && t !== '全部') set.add(t); });
    }
  }
  return Array.from(set);
}


// ------------------------------------------------------------------- v0.10.6 模式/动作切换状态清洗器与内置「🔤 文字图标工坊」

function sanitizeSpecOnModeOrTypeChange(spec, opts = {}) {
  if (!spec || typeof spec !== "object") return;
  const { nextSyncMode, nextType, toSingleAction, clearDual } = opts;
  const pageId = curPage() && curPage().id;

  // 1. 从「任务栏窗口模式 (window)」切向其它双态同步模式（如 auto / process / manual）
  if (nextSyncMode && nextSyncMode !== "window") {
    delete spec.smartToggle;
    spec._windowSubState = "stopped";
    if (selected && pageId) {
      setRuntimeCellState(pageId, selected.row, selected.col, { windowSubState: "stopped" });
    }
    if (spec.action2 && spec.action2.type === "window_toggle") {
      const rawTarget = String(spec.target || spec.watchProcess || spec.action2.target || "").trim();
      const proc = rawTarget.replace(/\\/g, "/").split("/").pop().replace(/\.[^.]+$/, "");
      const dropMode = (cfg && cfg.appDropMode) || "dual";
      if (proc && spec.type === "app") {
        spec.action2 = {
          type: "command",
          target: dropMode === "graceful" ? `wm_close:${proc}` : `taskkill /F /IM ${proc}.exe`,
          args: "",
        };
      } else {
        spec.action2 = { type: "hotkey", target: "Alt+F4", hotkey: "Alt+F4", args: "" };
      }
    }
    if (spec.badgeToggle) {
      if (spec.badgeState2 && (spec.badgeState2.text === "前台" || spec.badgeState2.text === "后台")) {
        spec.badgeState2 = { text: "运行中", bg: "#107c41", color: "#ffffff" };
      }
      if (spec.badgeState1 && (spec.badgeState1.text === "后台" || spec.badgeState1.text === "前台")) {
        spec.badgeState1 = { text: "", bg: "#546e7a", color: "#ffffff" };
      }
    }
  }

  // 2. 从「双态独立动作」切回「单一动作」
  if (toSingleAction || clearDual) {
    spec.toggleAction = false;
    delete spec.smartToggle;
    spec._activeState = 0;
    spec._windowSubState = "stopped";
    if (selected && pageId) {
      setRuntimeCellState(pageId, selected.row, selected.col, { activeState: 0, windowSubState: "stopped" });
    }
    if (spec.toggleSyncMode === "window") {
      delete spec.toggleSyncMode;
      if (spec.action2 && spec.action2.type === "window_toggle") {
        delete spec.action2;
      }
      if (spec.badgeState2 && (spec.badgeState2.text === "前台" || spec.badgeState2.text === "后台")) {
        spec.badgeToggle = false;
        spec.badgeState1 = { text: "", bg: "#546e7a", color: "#ffffff" };
        spec.badgeState2 = { text: "运行中", bg: "#107c41", color: "#ffffff" };
      }
    }
  }

  // 3. 切换主动作类型或快捷预设时清理跨格与残留窗口状态
  if (nextType) {
    if (nextType !== "widget") {
      delete spec.spanCols;
      delete spec.widgetKind;
      delete spec.widgetLayers;
      delete spec.refreshIntervalMs;
    }
    if (nextType !== "app" && nextType !== "window_toggle") {
      delete spec.smartToggle;
      delete spec.watchProcess;
      if (spec.toggleSyncMode === "window" || spec.toggleSyncMode === "process") {
        delete spec.toggleSyncMode;
      }
      if (spec.action2 && spec.action2.type === "window_toggle") {
        delete spec.action2;
        spec.toggleAction = false;
      }
      if (spec.badgeState2 && (spec.badgeState2.text === "前台" || spec.badgeState2.text === "后台")) {
        spec.badgeToggle = false;
        spec.badgeState2.text = "运行中";
      }
      spec._activeState = 0;
      spec._windowSubState = "stopped";
      if (selected && pageId) {
        setRuntimeCellState(pageId, selected.row, selected.col, { activeState: 0, windowSubState: "stopped" });
      }
    }
  }
}

const TEXT_ICON_TEMPLATES = [
  { id: "glass", name: "极简毛玻璃", badge: "Frosted", desc: "高透微光斜切折射 + 悬浮大字", defaultText1: "DEV", defaultText2: "BUILD", accent: "#38bdf8", bgColor: "#0f172a" },
  { id: "neon", name: "赛博霓虹", badge: "Cyber", desc: "暗夜机甲切角外框 + 双重霓虹辉光", defaultText1: "OBS", defaultText2: "LIVE", accent: "#c084fc", bgColor: "#090714" },
  { id: "keycap", name: "3D 机械键帽", badge: "Keycap", desc: "球帽内凹指槽与四边立体倒角", defaultText1: "⌘C", defaultText2: "COPY", accent: "#fbbf24", bgColor: "#1e293b" },
  { id: "pill", name: "双行胶囊", badge: "Capsule", desc: "顶部高亮胶囊铭牌 + 底部醒目主字", defaultText1: "PRO", defaultText2: "编译", accent: "#34d399", bgColor: "#091914" },
  { id: "stamp", name: "印章徽标", badge: "Stamp", desc: "微倾双环印章边框 + 醒目徽章字", defaultText1: "核准", defaultText2: "PASS", accent: "#f87171", bgColor: "#1c0d0d" },
  { id: "gradient_text", name: "流光渐变字", badge: "Gradient", desc: "多色流光渐变填充字 + 极光底栏", defaultText1: "AI", defaultText2: "AGENT", accent: "#ec4899", bgColor: "#0f1021" },
  { id: "terminal", name: "终端代码", badge: "Shell", desc: "三色窗口顶栏 + 极客命令提示符", defaultText1: "git", defaultText2: "push", accent: "#2dd4bf", bgColor: "#0a0f16" },
  { id: "ring", name: "环形徽标", badge: "Orbital", desc: "精密刻度能量圆环 + 中心视觉锚点", defaultText1: "MAX", defaultText2: "100%", accent: "#60a5fa", bgColor: "#0b1324" },
];

const TEXT_ICON_PALETTES = [
  { name: "电光蓝", accent: "#38bdf8", bg: "#0f172a", fg: "#ffffff" },
  { name: "赛博紫", accent: "#c084fc", bg: "#140b24", fg: "#ffffff" },
  { name: "翡翠绿", accent: "#34d399", bg: "#082019", fg: "#ffffff" },
  { name: "琥珀金", accent: "#fbbf24", bg: "#211706", fg: "#ffffff" },
  { name: "烈焰红", accent: "#f87171", bg: "#240b0b", fg: "#ffffff" },
  { name: "霓虹粉", accent: "#f472b6", bg: "#230b19", fg: "#ffffff" },
  { name: "极客青", accent: "#2dd4bf", bg: "#071f1e", fg: "#ffffff" },
  { name: "曜石银", accent: "#e2e8f0", bg: "#18181b", fg: "#ffffff" },
];

const TEXT_ICON_FONTS = [
  { id: "sans", name: "现代黑体 (YaHei / Segoe)", family: "'Microsoft YaHei', 'Segoe UI', system-ui, sans-serif" },
  { id: "mono", name: "极客等宽 (Consolas / Mono)", family: "Consolas, 'JetBrains Mono', 'Courier New', monospace" },
  { id: "heavy", name: "几何重黑 (Arial Black)", family: "'Segoe UI Black', 'Arial Black', 'Microsoft YaHei', sans-serif" },
  { id: "serif", name: "典雅衬线 (Georgia / Serif)", family: "Georgia, 'Times New Roman', 'Songti SC', serif" },
];

function fitSingleLineFontSize(ctx, text, maxW, startFs, minFs, weight, fontFamily) {
  let fs = startFs;
  while (fs > minFs) {
    ctx.font = `${weight} ${fs}px ${fontFamily}`;
    if (ctx.measureText(text).width <= maxW) break;
    fs -= 2;
  }
  return fs;
}

function renderTextIconCanvas(rawCfg, size = 192) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d");
  const s = size / 192;

  const tpl = TEXT_ICON_TEMPLATES.find(t => t.id === (rawCfg && rawCfg.style)) || TEXT_ICON_TEMPLATES[0];
  const style = tpl.id;
  const text1 = String((rawCfg && rawCfg.text1 !== undefined) ? rawCfg.text1 : (tpl.defaultText1 || "ICON")).trim() || "KEY";
  const text2 = String((rawCfg && rawCfg.text2 !== undefined) ? rawCfg.text2 : "").trim();
  const accent = (rawCfg && rawCfg.accent) || tpl.accent || "#38bdf8";
  const bgColor = (rawCfg && rawCfg.bgColor) || tpl.bgColor || "#0f172a";
  const textColor = (rawCfg && rawCfg.textColor) || "#ffffff";
  const bgTransparent = !!(rawCfg && rawCfg.bgTransparent);
  const fontObj = TEXT_ICON_FONTS.find(f => f.id === (rawCfg && rawCfg.fontId)) || TEXT_ICON_FONTS[0];
  const fontFamily = fontObj.family;
  const fontScale = Math.max(60, Math.min(145, Number(rawCfg && rawCfg.fontScale) || 100)) / 100;
  const radius = Math.round(Math.max(8, Math.min(80, Number(rawCfg && rawCfg.radius !== undefined ? rawCfg.radius : 36))) * s);
  const pad = Math.round(10 * s);
  const boxW = size - pad * 2;
  const boxH = size - pad * 2;

  ctx.clearRect(0, 0, size, size);

  const drawRoundedBox = (x, y, w, h, r) => {
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, w, h, r);
    else ctx.rect(x, y, w, h);
  };

  // Base background (unless transparent mode is enabled so board gradient shines through)
  if (!bgTransparent) {
    ctx.save();
    drawRoundedBox(pad, pad, boxW, boxH, radius);
    ctx.clip();
    const bgGrad = ctx.createLinearGradient(pad, pad, pad + boxW, pad + boxH);
    bgGrad.addColorStop(0, bgColor);
    bgGrad.addColorStop(1, "#050811");
    ctx.fillStyle = bgGrad;
    ctx.fillRect(pad, pad, boxW, boxH);

    // Subtle radial ambient glow from accent color
    const radGlow = ctx.createRadialGradient(size * 0.5, size * 0.32, 4 * s, size * 0.5, size * 0.5, size * 0.52);
    radGlow.addColorStop(0, accent + "44");
    radGlow.addColorStop(1, "transparent");
    ctx.fillStyle = radGlow;
    ctx.fillRect(pad, pad, boxW, boxH);
    ctx.restore();
  }

  // Template-specific decorative chrome
  if (style === "glass") {
    ctx.save();
    drawRoundedBox(pad, pad, boxW, boxH, radius);
    ctx.clip();
    const sheen = ctx.createLinearGradient(pad, pad, pad + boxW * 0.85, pad + boxH * 0.65);
    sheen.addColorStop(0, "rgba(255,255,255,0.22)");
    sheen.addColorStop(0.46, "rgba(255,255,255,0.05)");
    sheen.addColorStop(0.47, "rgba(255,255,255,0.0)");
    sheen.addColorStop(1, "rgba(255,255,255,0.0)");
    ctx.fillStyle = sheen;
    ctx.fillRect(pad, pad, boxW, boxH);
    ctx.restore();

    ctx.save();
    drawRoundedBox(pad + 1.5 * s, pad + 1.5 * s, boxW - 3 * s, boxH - 3 * s, Math.max(4, radius - 2));
    ctx.strokeStyle = accent + "88";
    ctx.lineWidth = 2.5 * s;
    ctx.stroke();
    ctx.restore();
  } else if (style === "neon") {
    ctx.save();
    drawRoundedBox(pad + 4 * s, pad + 4 * s, boxW - 8 * s, boxH - 8 * s, Math.max(6, radius - 4));
    ctx.shadowColor = accent;
    ctx.shadowBlur = 14 * s;
    ctx.strokeStyle = accent;
    ctx.lineWidth = 3.2 * s;
    ctx.stroke();
    ctx.restore();

    // Corner cyber brackets
    ctx.save();
    ctx.strokeStyle = "#ffffffcc";
    ctx.lineWidth = 2.2 * s;
    const cLen = 14 * s;
    const m = pad + 11 * s;
    // Top-left & bottom-right accents
    ctx.beginPath();
    ctx.moveTo(m, m + cLen); ctx.lineTo(m, m); ctx.lineTo(m + cLen, m);
    ctx.moveTo(size - m - cLen, size - m); ctx.lineTo(size - m, size - m); ctx.lineTo(size - m, size - m - cLen);
    ctx.stroke();
    ctx.restore();
  } else if (style === "keycap") {
    // 3D Mechanical Keycap Bevel
    ctx.save();
    const outerR = radius;
    if (bgTransparent) {
      drawRoundedBox(pad, pad, boxW, boxH, outerR);
      ctx.fillStyle = bgColor;
      ctx.fill();
    }
    // Bottom & side shadow bevel
    drawRoundedBox(pad, pad, boxW, boxH, outerR);
    ctx.lineWidth = 3 * s;
    ctx.strokeStyle = "rgba(0,0,0,0.65)";
    ctx.stroke();

    const dishPad = Math.round(23 * s);
    const dishW = size - dishPad * 2;
    const dishH = size - dishPad * 2 - Math.round(4 * s);
    const dishY = dishPad - Math.round(3 * s);
    const dishR = Math.max(8, Math.round(outerR * 0.72));

    // Chamfer lines connecting outer corners to inner dish
    ctx.strokeStyle = "rgba(255,255,255,0.14)";
    ctx.lineWidth = 1.6 * s;
    ctx.beginPath();
    ctx.moveTo(pad + 8 * s, pad + 8 * s); ctx.lineTo(dishPad + 4 * s, dishY + 4 * s);
    ctx.moveTo(size - pad - 8 * s, pad + 8 * s); ctx.lineTo(size - dishPad - 4 * s, dishY + 4 * s);
    ctx.stroke();

    // Inner concave dish
    drawRoundedBox(dishPad, dishY, dishW, dishH, dishR);
    const dishGrad = ctx.createLinearGradient(dishPad, dishY, dishPad, dishY + dishH);
    dishGrad.addColorStop(0, "#1e293b");
    dishGrad.addColorStop(1, bgColor);
    ctx.fillStyle = dishGrad;
    ctx.fill();
    ctx.strokeStyle = accent + "99";
    ctx.lineWidth = 2.2 * s;
    ctx.stroke();
    ctx.restore();
  } else if (style === "pill") {
    ctx.save();
    drawRoundedBox(pad + 2 * s, pad + 2 * s, boxW - 4 * s, boxH - 4 * s, radius);
    ctx.strokeStyle = accent + "66";
    ctx.lineWidth = 2.2 * s;
    ctx.stroke();

    // Top glowing pill bar
    const pillW = Math.round(boxW * 0.76);
    const pillH = Math.round(44 * s);
    const pillX = Math.round((size - pillW) / 2);
    const pillY = Math.round(pad + 18 * s);
    drawRoundedBox(pillX, pillY, pillW, pillH, pillH / 2);
    ctx.fillStyle = accent;
    ctx.shadowColor = accent + "88";
    ctx.shadowBlur = 10 * s;
    ctx.fill();
    ctx.restore();

    // Render text inside pill & bottom area directly
    ctx.save();
    const topStr = text2 ? text1 : "ACTION";
    const botStr = text2 ? text2 : text1;
    const pillFs = fitSingleLineFontSize(ctx, topStr, boxW * 0.66, Math.round(24 * s * fontScale), Math.round(12 * s), "900", fontFamily);
    ctx.font = `900 ${pillFs}px ${fontFamily}`;
    ctx.fillStyle = "#06101e";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(topStr, size / 2, pad + 40 * s);

    const botFs = fitSingleLineFontSize(ctx, botStr, boxW * 0.82, Math.round(48 * s * fontScale), Math.round(18 * s), "900", fontFamily);
    ctx.font = `900 ${botFs}px ${fontFamily}`;
    ctx.fillStyle = textColor;
    ctx.shadowColor = "rgba(0,0,0,0.55)";
    ctx.shadowBlur = 6 * s;
    ctx.fillText(botStr, size / 2, size * 0.67);
    ctx.restore();
    return c;
  } else if (style === "stamp") {
    ctx.save();
    ctx.translate(size / 2, size / 2);
    ctx.rotate((-6 * Math.PI) / 180);
    const sw = boxW - 18 * s;
    const sh = boxH - 18 * s;
    drawRoundedBox(-sw / 2, -sh / 2, sw, sh, Math.min(radius, 28 * s));
    ctx.strokeStyle = accent;
    ctx.lineWidth = 5 * s;
    ctx.stroke();

    drawRoundedBox(-sw / 2 + 7 * s, -sh / 2 + 7 * s, sw - 14 * s, sh - 14 * s, Math.max(6, Math.min(radius, 28 * s) - 5 * s));
    ctx.setLineDash([6 * s, 4 * s]);
    ctx.lineWidth = 2 * s;
    ctx.strokeStyle = accent + "cc";
    ctx.stroke();
    ctx.setLineDash([]);

    const maxW = sw - 26 * s;
    if (text2) {
      const fs1 = fitSingleLineFontSize(ctx, text1, maxW, Math.round(44 * s * fontScale), Math.round(16 * s), "900", fontFamily);
      ctx.font = `900 ${fs1}px ${fontFamily}`;
      ctx.fillStyle = textColor;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(text1, 0, -14 * s);

      const fs2 = fitSingleLineFontSize(ctx, text2, maxW, Math.round(22 * s * fontScale), Math.round(11 * s), "800", fontFamily);
      ctx.font = `800 ${fs2}px ${fontFamily}`;
      ctx.fillStyle = accent;
      ctx.fillText(text2, 0, 24 * s);
    } else {
      const fs1 = fitSingleLineFontSize(ctx, text1, maxW, Math.round(52 * s * fontScale), Math.round(18 * s), "900", fontFamily);
      ctx.font = `900 ${fs1}px ${fontFamily}`;
      ctx.fillStyle = accent;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(text1, 0, 2 * s);
    }
    ctx.restore();
    return c;
  } else if (style === "terminal") {
    ctx.save();
    drawRoundedBox(pad + 2 * s, pad + 2 * s, boxW - 4 * s, boxH - 4 * s, Math.min(radius, 28 * s));
    ctx.strokeStyle = accent + "77";
    ctx.lineWidth = 2.2 * s;
    ctx.stroke();

    // Terminal header bar & traffic dots
    const dotY = pad + 18 * s;
    const dots = [["#ff5f56", pad + 20 * s], ["#ffbd2e", pad + 34 * s], ["#27c93f", pad + 48 * s]];
    for (const [col, dx] of dots) {
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.arc(dx, dotY, 4.5 * s, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.strokeStyle = "rgba(255,255,255,0.1)";
    ctx.lineWidth = 1.5 * s;
    ctx.beginPath();
    ctx.moveTo(pad + 6 * s, pad + 31 * s);
    ctx.lineTo(size - pad - 6 * s, pad + 31 * s);
    ctx.stroke();

    const termFont = "Consolas, 'JetBrains Mono', 'Microsoft YaHei', monospace";
    const maxW = boxW - 24 * s;
    const line1Str = `>${text1}`;
    const fs1 = fitSingleLineFontSize(ctx, line1Str, maxW, Math.round((text2 ? 40 : 46) * s * fontScale), Math.round(15 * s), "bold", termFont);
    ctx.font = `bold ${fs1}px ${termFont}`;
    ctx.fillStyle = accent;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(line1Str, size / 2, text2 ? size * 0.51 : size * 0.58);

    if (text2) {
      const fs2 = fitSingleLineFontSize(ctx, text2 + "_", maxW, Math.round(25 * s * fontScale), Math.round(12 * s), "bold", termFont);
      ctx.font = `bold ${fs2}px ${termFont}`;
      ctx.fillStyle = textColor;
      ctx.fillText(text2 + "_", size / 2, size * 0.75);
    }
    ctx.restore();
    return c;
  } else if (style === "ring") {
    ctx.save();
    const cx = size / 2;
    const cy = size / 2;
    const ringR = Math.round(size * 0.39);

    ctx.beginPath();
    ctx.arc(cx, cy, ringR, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(255,255,255,0.14)";
    ctx.lineWidth = 6 * s;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(cx, cy, ringR, -Math.PI * 0.75, Math.PI * 0.85);
    ctx.strokeStyle = accent;
    ctx.shadowColor = accent;
    ctx.shadowBlur = 10 * s;
    ctx.lineWidth = 6.5 * s;
    ctx.lineCap = "round";
    ctx.stroke();
    ctx.restore();
  } else if (style === "gradient_text") {
    ctx.save();
    // Bottom glowing accent bar
    const barW = Math.round(boxW * 0.52);
    const barH = Math.round(6 * s);
    drawRoundedBox((size - barW) / 2, size - pad - 18 * s, barW, barH, barH / 2);
    const barGrad = ctx.createLinearGradient((size - barW) / 2, 0, (size + barW) / 2, 0);
    barGrad.addColorStop(0, accent);
    barGrad.addColorStop(1, "#38bdf8");
    ctx.fillStyle = barGrad;
    ctx.fill();
    ctx.restore();
  }

  // Standard 1-line or 2-line centered typography for glass / neon / keycap / gradient_text / ring
  ctx.save();
  const maxTextW = style === "ring" ? boxW * 0.64 : (style === "keycap" ? boxW * 0.68 : boxW * 0.82);
  const centerY = style === "keycap" ? size * 0.48 : size * 0.5;

  const makeTextFill = (yTop, yBot) => {
    if (style === "gradient_text") {
      const tg = ctx.createLinearGradient(size * 0.2, yTop, size * 0.8, yBot);
      tg.addColorStop(0, "#ffffff");
      tg.addColorStop(0.45, accent);
      tg.addColorStop(1, "#38bdf8");
      return tg;
    }
    return textColor;
  };

  if (style === "neon") {
    ctx.shadowColor = accent;
    ctx.shadowBlur = 16 * s;
  } else {
    ctx.shadowColor = "rgba(0,0,0,0.55)";
    ctx.shadowBlur = 6 * s;
    ctx.shadowOffsetY = 2 * s;
  }

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  if (text2) {
    const base1 = Math.round((text1.length <= 2 ? 56 : (text1.length === 3 ? 46 : 38)) * s * fontScale);
    const fs1 = fitSingleLineFontSize(ctx, text1, maxTextW, base1, Math.round(16 * s), "900", fontFamily);
    ctx.font = `900 ${fs1}px ${fontFamily}`;
    ctx.fillStyle = makeTextFill(centerY - fs1, centerY);
    ctx.fillText(text1, size / 2, centerY - Math.round(17 * s));

    const base2 = Math.round(23 * s * fontScale);
    const fs2 = fitSingleLineFontSize(ctx, text2, maxTextW, base2, Math.round(11 * s), "800", fontFamily);
    ctx.font = `800 ${fs2}px ${fontFamily}`;
    ctx.shadowBlur = style === "neon" ? 8 * s : 3 * s;
    ctx.fillStyle = accent;
    ctx.fillText(text2, size / 2, centerY + Math.round(25 * s));
  } else {
    const base1 = Math.round((text1.length === 1 ? 76 : (text1.length === 2 ? 64 : (text1.length === 3 ? 50 : 40))) * s * fontScale);
    const fs1 = fitSingleLineFontSize(ctx, text1, maxTextW, base1, Math.round(16 * s), "900", fontFamily);
    ctx.font = `900 ${fs1}px ${fontFamily}`;
    ctx.fillStyle = makeTextFill(centerY - fs1 / 2, centerY + fs1 / 2);
    ctx.fillText(text1, size / 2, centerY + 1 * s);
  }

  ctx.restore();
  return c;
}

function openTextIconStudio(initialSpec, onApply) {
  const existingCfg = (initialSpec && initialSpec.textIconConfig && typeof initialSpec.textIconConfig === "object")
    ? Object.assign({}, initialSpec.textIconConfig)
    : null;
  const rawLabel = String((initialSpec && initialSpec.label) || "").trim();
  const labelLines = rawLabel ? rawLabel.split(/\r?\n/).map(s => s.trim()).filter(Boolean) : [];

  const state = Object.assign({
    style: "glass",
    text1: labelLines[0] ? labelLines[0].slice(0, 6) : "DEV",
    text2: labelLines[1] ? labelLines[1].slice(0, 8) : "PRO",
    accent: "#38bdf8",
    bgColor: (initialSpec && initialSpec.color) || "#0f172a",
    textColor: "#ffffff",
    fontId: "sans",
    fontScale: 100,
    radius: 36,
    bgTransparent: false,
    hideKeyLabel: true,
  }, existingCfg || {});

  const wrap = document.createElement("div");
  wrap.className = "modal";
  wrap.id = "textIconStudioModal";
  wrap.innerHTML = `
    <div class="modalbox text-icon-modal-box">
      <div class="tis-head">
        <div>
          <h3 style="margin:0; font-size:15px;">🔤 文字图标工坊 (Text Icon Studio)</h3>
          <div style="font-size:11.5px; color:var(--muted); margin-top:2px;">内置 8 套高颜值图标视觉模板 · 支持双行文字、发光霓虹、3D 键帽与透明整板流光底</div>
        </div>
        <button type="button" class="ghost tiny" id="tisCloseBtn">✕ 关闭</button>
      </div>

      <div class="tis-body">
        <div class="tis-preview-col">
          <div style="font-size:11px; font-weight:700; color:var(--muted);">1:1 实时高清渲染预览</div>
          <div class="tis-preview-stage" id="tisPreviewStage">
            <canvas id="tisPreviewCanvas" width="192" height="192"></canvas>
          </div>
          <div style="font-size:10.5px; color:var(--muted); text-align:center; line-height:1.4;">
            192×192 超采样矢量级抗锯齿<br>支持随时再次点击「🔤 文字图标」无损回填修改
          </div>
          <label style="display:flex; align-items:center; gap:6px; font-size:11.5px; color:var(--ink); cursor:pointer; margin-top:4px;">
            <input type="checkbox" id="tisBgTransparent" ${state.bgTransparent ? "checked" : ""} />
            <span>🌈 透明底色（透出整板流光渐变）</span>
          </label>
          <label style="display:flex; align-items:center; gap:6px; font-size:11.5px; color:var(--ink); cursor:pointer;">
            <input type="checkbox" id="tisHideKeyLabel" ${state.hideKeyLabel ? "checked" : ""} />
            <span>✨ 自动隐藏按键下方重复标题</span>
          </label>
          <button type="button" class="ghost tiny" id="tisSaveToLibBtn" style="width:100%; margin-top:4px;">⭐ 同时存入自定义图标库</button>
        </div>

        <div class="tis-ctrl-col">
          <div>
            <div style="font-size:11.5px; font-weight:700; color:var(--ink); margin-bottom:6px;">🎨 1. 选择视觉模板 (8 套精调样式)</div>
            <div class="tis-template-grid" id="tisTemplateGrid">
              ${TEXT_ICON_TEMPLATES.map(t => `
                <button type="button" class="tis-tpl-card ${state.style === t.id ? "active" : ""}" data-tpl="${t.id}" title="${escapeAttr(t.desc)}">
                  <span class="tis-tpl-badge">${escapeHtml(t.badge)}</span>
                  <span class="tis-tpl-name">${escapeHtml(t.name)}</span>
                </button>
              `).join("")}
            </div>
          </div>

          <div style="display:grid; grid-template-columns: 1fr 1fr; gap:8px;">
            <div>
              <label style="font-size:11px; color:var(--muted); display:block; margin-bottom:4px;">主标题文字 (第 1 行，建议 1~5 字)</label>
              <input id="tisText1" type="text" maxlength="8" value="${escapeAttr(state.text1)}" placeholder="如 DEV / 静音 / ⌘C" style="font-weight:700;" />
            </div>
            <div>
              <label style="font-size:11px; color:var(--muted); display:block; margin-bottom:4px;">副标题 / 胶囊标 (第 2 行，可留空)</label>
              <input id="tisText2" type="text" maxlength="10" value="${escapeAttr(state.text2)}" placeholder="留空则为单行居中大字" />
            </div>
          </div>

          <div style="display:grid; grid-template-columns: 1.2fr 1fr; gap:8px; align-items:center;">
            <div>
              <label style="font-size:11px; color:var(--muted); display:block; margin-bottom:4px;">字体风格</label>
              <select id="tisFontId">
                ${TEXT_ICON_FONTS.map(f => `<option value="${f.id}" ${state.fontId === f.id ? "selected" : ""}>${escapeHtml(f.name)}</option>`).join("")}
              </select>
            </div>
            <div>
              <label style="font-size:11px; color:var(--muted); display:block; margin-bottom:4px;">主题色板一键切换</label>
              <div class="tis-color-row" id="tisPaletteRow">
                ${TEXT_ICON_PALETTES.map(p => `
                  <span class="tis-color-dot" data-accent="${p.accent}" data-bg="${p.bg}" data-fg="${p.fg}" title="${p.name}" style="background: linear-gradient(135deg, ${p.accent}, ${p.bg});"></span>
                `).join("")}
              </div>
            </div>
          </div>

          <div style="display:grid; grid-template-columns: repeat(3, 1fr); gap:8px; background:var(--panel-2); padding:8px 10px; border-radius:8px; border:1px solid var(--line);">
            <div style="display:flex; align-items:center; justify-content:space-between; gap:6px;">
              <span style="font-size:11px; color:var(--muted);">霓虹/主色</span>
              <input id="tisAccentColor" type="color" value="${state.accent}" style="width:32px; height:24px; padding:0; border:none; cursor:pointer;" />
            </div>
            <div style="display:flex; align-items:center; justify-content:space-between; gap:6px;">
              <span style="font-size:11px; color:var(--muted);">背景底色</span>
              <input id="tisBgColor" type="color" value="${state.bgColor}" style="width:32px; height:24px; padding:0; border:none; cursor:pointer;" />
            </div>
            <div style="display:flex; align-items:center; justify-content:space-between; gap:6px;">
              <span style="font-size:11px; color:var(--muted);">主文字色</span>
              <input id="tisTextColor" type="color" value="${state.textColor}" style="width:32px; height:24px; padding:0; border:none; cursor:pointer;" />
            </div>
          </div>

          <div style="display:grid; grid-template-columns: 1fr 1fr; gap:10px;">
            <div>
              <div style="display:flex; justify-content:space-between; font-size:11px; color:var(--muted); margin-bottom:3px;">
                <span>字号缩放比例</span>
                <b id="tisFontScaleVal">${state.fontScale}%</b>
              </div>
              <input id="tisFontScale" type="range" min="65" max="135" value="${state.fontScale}" />
            </div>
            <div>
              <div style="display:flex; justify-content:space-between; font-size:11px; color:var(--muted); margin-bottom:3px;">
                <span>外框圆角弧度</span>
                <b id="tisRadiusVal">${state.radius}px</b>
              </div>
              <input id="tisRadius" type="range" min="10" max="76" value="${state.radius}" />
            </div>
          </div>
        </div>
      </div>

      <div class="tis-foot">
        <button type="button" class="ghost" id="tisCancelBtn">取消</button>
        <button type="button" class="primary" id="tisApplyBtn" style="min-width:130px;">✓ 立即生成并应用</button>
      </div>
    </div>
  `;

  document.body.appendChild(wrap);

  const previewCnv = wrap.querySelector("#tisPreviewCanvas");
  const updatePreview = () => {
    const rendered = renderTextIconCanvas(state, 192);
    const pctx = previewCnv.getContext("2d");
    pctx.clearRect(0, 0, 192, 192);
    pctx.drawImage(rendered, 0, 0);
  };

  updatePreview();

  const close = () => wrap.remove();
  wrap.querySelector("#tisCloseBtn").onclick = close;
  wrap.querySelector("#tisCancelBtn").onclick = close;
  wrap.addEventListener("click", (e) => { if (e.target === wrap) close(); });

  wrap.querySelectorAll(".tis-tpl-card").forEach(btn => {
    btn.onclick = () => {
      const tplId = btn.dataset.tpl;
      const tpl = TEXT_ICON_TEMPLATES.find(t => t.id === tplId);
      state.style = tplId;
      if (tpl) {
        state.accent = tpl.accent;
        state.bgColor = tpl.bgColor;
        wrap.querySelector("#tisAccentColor").value = state.accent;
        wrap.querySelector("#tisBgColor").value = state.bgColor;
      }
      wrap.querySelectorAll(".tis-tpl-card").forEach(b => b.classList.toggle("active", b === btn));
      updatePreview();
    };
  });

  wrap.querySelector("#tisText1").oninput = (e) => {
    state.text1 = e.target.value;
    updatePreview();
  };
  wrap.querySelector("#tisText2").oninput = (e) => {
    state.text2 = e.target.value;
    updatePreview();
  };
  wrap.querySelector("#tisFontId").onchange = (e) => {
    state.fontId = e.target.value;
    updatePreview();
  };
  wrap.querySelectorAll(".tis-color-dot").forEach(dot => {
    dot.onclick = () => {
      state.accent = dot.dataset.accent;
      state.bgColor = dot.dataset.bg;
      state.textColor = dot.dataset.fg || "#ffffff";
      wrap.querySelector("#tisAccentColor").value = state.accent;
      wrap.querySelector("#tisBgColor").value = state.bgColor;
      wrap.querySelector("#tisTextColor").value = state.textColor;
      updatePreview();
    };
  });
  wrap.querySelector("#tisAccentColor").oninput = (e) => { state.accent = e.target.value; updatePreview(); };
  wrap.querySelector("#tisBgColor").oninput = (e) => { state.bgColor = e.target.value; updatePreview(); };
  wrap.querySelector("#tisTextColor").oninput = (e) => { state.textColor = e.target.value; updatePreview(); };
  wrap.querySelector("#tisBgTransparent").onchange = (e) => { state.bgTransparent = e.target.checked; updatePreview(); };
  wrap.querySelector("#tisHideKeyLabel").onchange = (e) => { state.hideKeyLabel = e.target.checked; };

  const fsInput = wrap.querySelector("#tisFontScale");
  fsInput.oninput = () => {
    state.fontScale = Number(fsInput.value);
    wrap.querySelector("#tisFontScaleVal").textContent = state.fontScale + "%";
    updatePreview();
  };
  const radInput = wrap.querySelector("#tisRadius");
  radInput.oninput = () => {
    state.radius = Number(radInput.value);
    wrap.querySelector("#tisRadiusVal").textContent = state.radius + "px";
    updatePreview();
  };

  wrap.querySelector("#tisSaveToLibBtn").onclick = async () => {
    const outCnv = renderTextIconCanvas(state, 192);
    const dataUrl = outCnv.toDataURL("image/png");
    const name = [state.text1, state.text2].filter(Boolean).join(" · ") || "文字图标";
    cfg.customIcons = cfg.customIcons || [];
    cfg.customIcons.unshift({
      id: "ci_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6),
      name,
      icon: dataUrl,
      category: "常用",
      tags: ["文字图标"],
      textIconConfig: Object.assign({}, state),
      addedAt: Date.now(),
    });
    await saveConfig();
    toast(`⭐ 已将文字图标「${name}」存入自定义图标库`);
  };

  wrap.querySelector("#tisApplyBtn").onclick = () => {
    const outCnv = renderTextIconCanvas(state, 192);
    const dataUrl = outCnv.toDataURL("image/png");
    const tpl = TEXT_ICON_TEMPLATES.find(t => t.id === state.style);
    close();
    if (onApply) {
      onApply({
        dataUrl,
        config: Object.assign({}, state),
        templateName: tpl ? tpl.name : "文字图标",
      });
    }
  };
}

function openIconPicker() {
  iconPickerTarget = null;
  if (!selected || selected.col === 5 || isBackCell(selected.row, selected.col)) {
    toast('先点选一个可编辑的按键格子');
    return;
  }
  const modal = $('iconPickerModal');
  if (!modal) return;
  modal.hidden = false;
  $('ipSearch').value = '';
  renderIconPicker();
  $('ipSearch').focus();
}

function closeIconPicker() {
  const modal = $('iconPickerModal');
  if (modal) modal.hidden = true;
  hideIpContextMenu();
}

function hideIpContextMenu() {
  const cm = $('ipContextMenu');
  if (cm) cm.hidden = true;
  ipContextTarget = null;
}

function openIpContextMenu(x, y, iconItem) {
  const cm = $('ipContextMenu');
  if (!cm) return;
  ipContextTarget = iconItem;
  cm.hidden = false;
  
  const w = 180;
  const h = 180;
  const maxX = window.innerWidth - w - 8;
  const maxY = window.innerHeight - h - 8;
  cm.style.left = `${Math.min(x, maxX)}px`;
  cm.style.top = `${Math.min(y, maxY)}px`;
}

function initIpContextMenu() {
  const cm = $('ipContextMenu');
  if (!cm) return;

  $('ipCmApply').onclick = async () => {
    if (!ipContextTarget || !selected || selected.col === 5) return;
    const spec = pageButtons()[selected.row + ',' + selected.col];
    if (spec) {
      spec.icon = ipContextTarget.icon;
      if (ipContextTarget.badge) {
        spec.badge = ipContextTarget.badge;
        if (ipContextTarget.badgeBg) spec.badgeBg = ipContextTarget.badgeBg;
        if (ipContextTarget.badgeColor) spec.badgeColor = ipContextTarget.badgeColor;
      }
      await commit(true);
      renderInspector();
      toast(`已套用图标：「${ipContextTarget.name}」`);
      closeIconPicker();
    }
    hideIpContextMenu();
  };

  $('ipCmRename').onclick = async () => {
    if (!ipContextTarget) return;
    const target = ipContextTarget;
    hideIpContextMenu();
    const newName = await askText('重命名图标', target.name, '输入新图标名称');
    if (!newName || !newName.trim() || newName.trim() === target.name) return;
    target.name = newName.trim();
    await saveConfig();
    renderIconPicker();
    toast(`已重命名为：「${target.name}」`);
  };

  $('ipCmCategory').onclick = async () => {
    if (!ipContextTarget) return;
    const target = ipContextTarget;
    hideIpContextMenu();
    const currentCat = target.category || '常用';
    const newCat = await askText('修改图标分类', currentCat, '输入分类名称（例如：常用、办公、游戏、工具）');
    if (!newCat || !newCat.trim()) return;
    target.category = newCat.trim();
    await saveConfig();
    renderIconPicker();
    toast(`已归入分类：「${target.category}」`);
  };

  $('ipCmCopy').onclick = async () => {
    if (!ipContextTarget) return;
    const target = ipContextTarget;
    hideIpContextMenu();
    try {
      await navigator.clipboard.writeText(target.icon || '');
      toast('已复制 Base64 图标数据到剪贴板');
    } catch (_) {
      toast('复制失败');
    }
  };

  $('ipCmDelete').onclick = async () => {
    if (!ipContextTarget) return;
    const target = ipContextTarget;
    hideIpContextMenu();
    cfg.customIcons = (cfg.customIcons || []).filter(x => x.id !== target.id);
    await saveConfig();
    renderIconPicker();
    toast(`已删除图标：「${target.name}」`);
  };

  document.addEventListener('click', (e) => {
    if (!e.target.closest('#ipContextMenu')) hideIpContextMenu();
  });
}

let ipBatchMode = false;
const ipSelectedIds = new Set();
let ipTintColor = '#ffffff';

function toggleIpSelect(id) {
  if (ipSelectedIds.has(id)) {
    ipSelectedIds.delete(id);
  } else {
    ipSelectedIds.add(id);
  }
  updateIpBatchBar();
  renderIconPicker();
}

function updateIpBatchBar() {
  const bar = $('ipBatchBar');
  const normalFoot = $('ipNormalFoot');
  const countEl = $('ipBatchCount');
  if (bar) bar.hidden = !ipBatchMode;
  if (normalFoot) normalFoot.hidden = !!ipBatchMode;
  if (countEl) countEl.textContent = `已选 ${ipSelectedIds.size} 个图标`;
  const toggleBtn = $('ipBatchToggle');
  if (toggleBtn) {
    toggleBtn.textContent = ipBatchMode ? '✓ 完成管理' : '☑️ 批量管理';
    toggleBtn.classList.toggle('active', ipBatchMode);
  }
}

async function iconBatchCategory() {
  if (!ipSelectedIds.size) { toast('请先勾选要归类/收藏的图标'); return; }
  const newCat = await askText('批量归类/收藏图标', '常用', '输入分类名称（例如：办公、设计、常用）');
  if (!newCat || !newCat.trim()) return;
  const cat = newCat.trim();
  const count = ipSelectedIds.size;
  cfg.customIcons = cfg.customIcons || [];
  let customUpdated = 0;
  let builtinAdded = 0;
  for (const id of Array.from(ipSelectedIds)) {
    if (id.startsWith('bi:')) {
      const bi = (typeof BUILTIN_ICONS !== 'undefined') && BUILTIN_ICONS.find(b => ('bi:' + (b.category || 'all') + ':' + b.name) === id);
      if (bi) {
        const dataUrl = svgToDataUrl(bi.svg, ipTintColor);
        cfg.customIcons.push({
          id: 'ci_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6) + Math.floor(Math.random() * 1000),
          name: bi.name,
          category: cat,
          tags: [bi.category || '内置', cat],
          icon: dataUrl,
          createdAt: new Date().toISOString()
        });
        builtinAdded++;
      }
    } else {
      const ic = cfg.customIcons.find(x => x.id === id);
      if (ic) {
        ic.category = cat;
        customUpdated++;
      }
    }
  }
  await saveConfig();
  renderIconPicker();
  toast(`已将 ${count} 个图标归类至「${cat}」${builtinAdded ? `（其中 ${builtinAdded} 个已存入我的收藏）` : ''}`);
}

async function iconBatchExport() {
  if (DEMO) { toast('预览模式下不能导出'); return; }
  if (!ipSelectedIds.size) { toast('请先勾选要导出的图标'); return; }
  const list = [];
  for (const id of ipSelectedIds) {
    if (id.startsWith('bi:')) {
      const bi = (typeof BUILTIN_ICONS !== 'undefined') && BUILTIN_ICONS.find(b => ('bi:' + (b.category || 'all') + ':' + b.name) === id);
      if (bi) {
        list.push({
          id,
          name: bi.name,
          category: bi.category || '内置',
          svg: bi.svg,
          icon: svgToDataUrl(bi.svg, ipTintColor)
        });
      }
    } else {
      const ic = (cfg && cfg.customIcons || []).find(x => x.id === id);
      if (ic) list.push(ic);
    }
  }
  const name = `akp153-icons-${list.length}.json`;
  const json = JSON.stringify({ type: 'akp153-custom-icons', version: 1, exportedAt: new Date().toISOString(), icons: list }, null, 2);
  const r = await api.libraryExport({ json, name });
  if (r && r.ok) toast(`已导出 ${list.length} 个图标到 ${r.path}`);
  else if (r && !r.canceled) toast('导出失败：' + (r.error || '未知错误'));
}

async function iconBatchDelete() {
  if (!ipSelectedIds.size) { toast('请先勾选要删除/隐藏的图标'); return; }
  const count = ipSelectedIds.size;
  if (!(await askConfirm('批量删除/隐藏图标', `确定要从图标库中移除选中的 ${count} 个图标吗？（自定义图标将被删除，内置图标将被隐藏）`))) return;
  cfg.hiddenBuiltinIcons = cfg.hiddenBuiltinIcons || [];
  for (const id of Array.from(ipSelectedIds)) {
    if (id.startsWith('bi:')) {
      if (!cfg.hiddenBuiltinIcons.includes(id)) {
        cfg.hiddenBuiltinIcons.push(id);
      }
    }
  }
  cfg.customIcons = ((cfg && cfg.customIcons) || []).filter(ic => !ipSelectedIds.has(ic.id));
  ipSelectedIds.clear();
  await saveConfig();
  renderIconPicker();
  updateIpBatchBar();
  toast(`已批量处理 ${count} 个图标`);
}

function renderIconPicker() {
  const tagsBox = $('ipTags');
  const subTagsBox = $('ipSubTags');
  const gridBox = $('ipGrid');
  if (!tagsBox || !gridBox || typeof BUILTIN_ICONS === 'undefined') return;

  tagsBox.innerHTML = '';
  for (const cat of ICON_CATEGORIES) {
    const btn = document.createElement('button');
    btn.className = 'ip-tag' + (cat.id === currentIconCategory ? ' active' : '');
    btn.textContent = cat.name;
    btn.onclick = () => {
      currentIconCategory = cat.id;
      renderIconPicker();
    };
    tagsBox.appendChild(btn);
  }

  if ((cfg && cfg.hiddenBuiltinIcons || []).length > 0) {
    const unhideBtn = document.createElement('button');
    unhideBtn.className = 'ip-tag';
    unhideBtn.style.color = '#ef4444';
    unhideBtn.style.borderColor = '#fca5a5';
    unhideBtn.textContent = `↺ 恢复已隐藏 (${cfg.hiddenBuiltinIcons.length})`;
    unhideBtn.title = '点击恢复所有被批量隐藏的内置图标';
    unhideBtn.onclick = async () => {
      const count = cfg.hiddenBuiltinIcons.length;
      cfg.hiddenBuiltinIcons = [];
      await saveConfig();
      renderIconPicker();
      toast(`已恢复 ${count} 个被隐藏的内置图标`);
    };
    tagsBox.appendChild(unhideBtn);
  }

  const customList = (cfg && cfg.customIcons) || [];

  if (currentIconCategory === 'custom') {
    if (subTagsBox) {
      subTagsBox.hidden = false;
      subTagsBox.innerHTML = '';
      const subCats = getCustomSubCategories();
      for (const sc of subCats) {
        const count = sc === '全部'
          ? customList.length
          : customList.filter(item => (item.category || '常用') === sc || (Array.isArray(item.tags) && item.tags.includes(sc))).length;
        const btn = document.createElement('button');
        btn.className = 'ip-subtag' + (sc === currentCustomSubCategory ? ' active' : '');
        btn.textContent = `${sc} (${count})`;
        btn.onclick = () => {
          currentCustomSubCategory = sc;
          renderIconPicker();
        };
        subTagsBox.appendChild(btn);
      }
      const btnAddCat = document.createElement('button');
      btnAddCat.className = 'ip-subtag';
      btnAddCat.style.borderStyle = 'dashed';
      btnAddCat.textContent = '＋ 新建分类';
      btnAddCat.onclick = async () => {
        const catName = await askText('新建图标分类', '', '输入新分类名称（例如：浏览器、音视频、Adobe）');
        if (!catName || !catName.trim()) return;
        currentCustomSubCategory = catName.trim();
        renderIconPicker();
      };
      subTagsBox.appendChild(btnAddCat);
    }
  } else {
    if (subTagsBox) subTagsBox.hidden = true;
  }

  const q = ($('ipSearch').value || '').trim().toLowerCase();
  gridBox.innerHTML = '';

  if (currentIconCategory === 'custom') {
    let filtered = customList;
    if (currentCustomSubCategory !== '全部') {
      filtered = filtered.filter(item => (item.category || '常用') === currentCustomSubCategory || (Array.isArray(item.tags) && item.tags.includes(currentCustomSubCategory)));
    }
    if (q) {
      filtered = filtered.filter(item => {
        const matchName = item.name && item.name.toLowerCase().includes(q);
        const matchCat = item.category && item.category.toLowerCase().includes(q);
        const matchTags = Array.isArray(item.tags) && item.tags.some(t => t.toLowerCase().includes(q));
        return matchName || matchCat || matchTags;
      });
    }

    if (!filtered.length) {
      gridBox.innerHTML = `
        <div style="grid-column:1/-1;text-align:center;padding:32px 16px;">
          <p class="muted" style="margin:0 0 8px;font-size:14px;">当前分类暂无图标</p>
          <span style="font-size:12px;color:var(--muted);">
            点击右上角「📁 批量导入…」可批量导入本地图片/程序；<br>
            或在按键设置中点选「⭐ 存入图标库」保存当前按键图标。
          </span>
        </div>
      `;
      return;
    }

    for (const cIcon of filtered) {
      const isSelected = ipSelectedIds.has(cIcon.id);
      const item = document.createElement('div');
      item.className = 'ip-item' + (ipBatchMode ? ' batch-mode' : '') + (isSelected ? ' selected' : '');
      const catLabel = cIcon.category || '常用';
      item.title = `${cIcon.name} (${catLabel}) - 右击查看更多操作`;
      item.innerHTML = `
        ${ipBatchMode ? `<input type="checkbox" class="batch-checkbox" ${isSelected ? 'checked' : ''} />` : ''}
        <div class="ip-icon-preview">
          <img src="${cIcon.icon}" style="max-width:100%;max-height:100%;object-fit:contain;" />
        </div>
        <span class="ip-icon-name">${escapeHtml(cIcon.name)}</span>
        <span class="ip-badge-cat">${escapeHtml(catLabel)}</span>
        ${!ipBatchMode ? '<button class="ip-del-btn" title="删除此图标">✕</button>' : ''}
      `;
      if (ipBatchMode) {
        const chk = item.querySelector('.batch-checkbox');
        if (chk) chk.onclick = (e) => { e.stopPropagation(); toggleIpSelect(cIcon.id); };
        item.onclick = (e) => { e.stopPropagation(); toggleIpSelect(cIcon.id); };
      } else {
        item.oncontextmenu = (e) => {
          e.preventDefault();
          e.stopPropagation();
          openIpContextMenu(e.clientX, e.clientY, cIcon);
        };
        const delBtn = item.querySelector('.ip-del-btn');
        if (delBtn) delBtn.onclick = async (e) => {
          e.stopPropagation();
          cfg.customIcons = (cfg.customIcons || []).filter(x => x.id !== cIcon.id);
          await saveConfig();
          renderIconPicker();
          toast(`已删除「${cIcon.name}」`);
        };
        item.onclick = async () => {
          if (iconPickerTarget === 'libModal' && currentLibModalSpec) {
            currentLibModalSpec.icon = cIcon.icon;
            updateLkmSwatch();
            closeIconPicker();
            toast(`已为按键套用图标：${cIcon.name}`);
            iconPickerTarget = null;
            return;
          }
          if (!selected || selected.col === 5) return;
          const spec = pageButtons()[selected.row + ',' + selected.col];
          if (spec) {
            spec.icon = cIcon.icon;
            if (cIcon.badge) {
              spec.badge = cIcon.badge;
              if (cIcon.badgeBg) spec.badgeBg = cIcon.badgeBg;
              if (cIcon.badgeColor) spec.badgeColor = cIcon.badgeColor;
            }
            await commit(true);
            renderInspector();
            toast(`已套用自定义图标：${cIcon.name}`);
            closeIconPicker();
          }
        };
      }
      gridBox.appendChild(item);
    }
    return;
  }

  if (currentIconCategory === 'all' && customList.length) {
    const matchedCustom = customList.filter(item => !q || item.name.toLowerCase().includes(q) || (item.category && item.category.toLowerCase().includes(q)));
    for (const cIcon of matchedCustom) {
      const isSelected = ipSelectedIds.has(cIcon.id);
      const item = document.createElement('div');
      item.className = 'ip-item' + (ipBatchMode ? ' batch-mode' : '') + (isSelected ? ' selected' : '');
      item.title = `${cIcon.name} (我的收藏) - 右击管理`;
      item.innerHTML = `
        ${ipBatchMode ? `<input type="checkbox" class="batch-checkbox" ${isSelected ? 'checked' : ''} />` : ''}
        <div class="ip-icon-preview">
          <img src="${cIcon.icon}" style="max-width:100%;max-height:100%;object-fit:contain;" />
        </div>
        <span class="ip-icon-name">🌟 ${escapeHtml(cIcon.name)}</span>
        <span class="ip-badge-cat">${escapeHtml(cIcon.category || '收藏')}</span>
      `;
      if (ipBatchMode) {
        const chk = item.querySelector('.batch-checkbox');
        if (chk) chk.onclick = (e) => { e.stopPropagation(); toggleIpSelect(cIcon.id); };
        item.onclick = (e) => { e.stopPropagation(); toggleIpSelect(cIcon.id); };
      } else {
        item.oncontextmenu = (e) => {
          e.preventDefault();
          e.stopPropagation();
          openIpContextMenu(e.clientX, e.clientY, cIcon);
        };
        item.onclick = async () => {
          if (iconPickerTarget === 'libModal' && currentLibModalSpec) {
            currentLibModalSpec.icon = cIcon.icon;
            updateLkmSwatch();
            closeIconPicker();
            toast(`已为按键套用图标：${cIcon.name}`);
            iconPickerTarget = null;
            return;
          }
          if (!selected || selected.col === 5) return;
          const spec = pageButtons()[selected.row + ',' + selected.col];
          if (spec) {
            spec.icon = cIcon.icon;
            if (cIcon.badge) {
              spec.badge = cIcon.badge;
              if (cIcon.badgeBg) spec.badgeBg = cIcon.badgeBg;
              if (cIcon.badgeColor) spec.badgeColor = cIcon.badgeColor;
            }
            await commit(true);
            renderInspector();
            toast(`已套用自定义图标：${cIcon.name}`);
            closeIconPicker();
          }
        };
      }
      gridBox.appendChild(item);
    }
  }

  const list = BUILTIN_ICONS.filter((item) => {
    const iconId = 'bi:' + (item.category || 'all') + ':' + item.name;
    if ((cfg.hiddenBuiltinIcons || []).includes(iconId) || (cfg.hiddenBuiltinIcons || []).includes(item.name)) return false;
    if (currentIconCategory !== 'all' && item.category !== currentIconCategory) return false;
    if (q && !item.name.toLowerCase().includes(q)) return false;
    return true;
  });

  if (!list.length && (currentIconCategory !== 'all' || !customList.some(item => !q || item.name.toLowerCase().includes(q)))) {
    gridBox.innerHTML = '<p class="muted" style="grid-column:1/-1;text-align:center;padding:24px;">没有匹配的图标</p>';
    return;
  }

  for (const icon of list) {
    const iconId = 'bi:' + (icon.category || 'all') + ':' + icon.name;
    const isSelected = ipSelectedIds.has(iconId);
    const item = document.createElement('div');
    item.className = 'ip-item' + (ipBatchMode ? ' batch-mode' : '') + (isSelected ? ' selected' : '');
    item.title = icon.name;
    item.innerHTML = `
      ${ipBatchMode ? `<input type="checkbox" class="batch-checkbox" ${isSelected ? 'checked' : ''} />` : ''}
      <div class="ip-icon-preview">${icon.svg}</div>
      <span class="ip-icon-name">${icon.name}</span>
    `;
    if (ipBatchMode) {
      const chk = item.querySelector('.batch-checkbox');
      if (chk) chk.onclick = (e) => { e.stopPropagation(); toggleIpSelect(iconId); };
      item.onclick = (e) => { e.stopPropagation(); toggleIpSelect(iconId); };
    } else {
      item.onclick = async () => {
        const dataUrl = svgToDataUrl(icon.svg, ipTintColor);
        if (iconPickerTarget === 'libModal' && currentLibModalSpec) {
          currentLibModalSpec.icon = dataUrl;
          updateLkmSwatch();
          closeIconPicker();
          toast(`已为按键应用图标：${icon.name}`);
          iconPickerTarget = null;
          return;
        }
        if (!selected || selected.col === 5) return;
        const spec = pageButtons()[selected.row + ',' + selected.col];
        if (spec) {
          spec.icon = dataUrl;
          await commit(true);
          renderInspector();
          toast(`已应用图标：${icon.name}`);
          closeIconPicker();
        }
      };
    }
    gridBox.appendChild(item);
  }
}

function initIconPicker() {
  $('ipClose').onclick = closeIconPicker;
  $('ipSearch').addEventListener('input', renderIconPicker);
  $('iconPickerModal').addEventListener('click', (e) => {
    if (e.target === $('iconPickerModal')) closeIconPicker();
  });

  initIpContextMenu();

  const btnBatchImport = $('ipBatchImport');
  if (btnBatchImport) {
    btnBatchImport.onclick = async () => {
      const res = await api.dialogPick({
        multiple: true,
        properties: ['openFile', 'multiSelections'],
        filters: [
          { name: '图标与图像/应用程序', extensions: ['png', 'jpg', 'jpeg', 'webp', 'svg', 'ico', 'exe', 'lnk'] }
        ]
      });
      if (!res) return;
      const filePaths = Array.isArray(res) ? res : [res];
      if (!filePaths.length) return;

      cfg.customIcons = cfg.customIcons || [];
      const targetCat = (currentCustomSubCategory === '全部') ? '常用' : currentCustomSubCategory;
      let count = 0;
      toast(`正在批量处理 ${filePaths.length} 个文件…`);

      for (const fp of filePaths) {
        try {
          const iconData = await api.iconExtract(fp);
          if (!iconData) continue;
          const base = fp.split(/[\\/]/).pop();
          const name = base.replace(/\.[^.]+$/, '');
          cfg.customIcons.push({
            id: 'ci_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
            name: name || '图标',
            icon: iconData,
            category: targetCat,
            tags: [],
            badge: '',
            badgeBg: '',
            badgeColor: '',
            addedAt: Date.now()
          });
          count++;
        } catch (err) {
          console.warn('Batch import error for', fp, err);
        }
      }

      if (count > 0) {
        await saveConfig();
        currentIconCategory = 'custom';
        renderIconPicker();
        toast(`成功批量导入 ${count} 个图标到「${targetCat}」分类！`);
      } else {
        toast('未提取到有效图标');
      }
    };
  }

  const btnIpTextIcon = $('ipOpenTextIcon');
  if (btnIpTextIcon) {
    btnIpTextIcon.onclick = () => {
      const targetSpec = (iconPickerTarget === 'libModal' && currentLibModalSpec)
        ? currentLibModalSpec
        : ((selected && selected.col < 5) ? pageButtons()[`${selected.row},${selected.col}`] : null);
      openTextIconStudio(targetSpec || {}, async (res) => {
        if (iconPickerTarget === 'libModal' && currentLibModalSpec) {
          currentLibModalSpec.icon = res.dataUrl;
          currentLibModalSpec.textIconConfig = res.config;
          if (res.config && res.config.hideKeyLabel) currentLibModalSpec.label = '';
          updateLkmStyleUI();
          updateLkmSwatch();
          closeIconPicker();
          iconPickerTarget = null;
          toast(`🔤 已为按键应用「${res.templateName}」文字图标`);
          return;
        }
        if (selected && selected.col < 5 && !isBackCell(selected.row, selected.col)) {
          const sp = pageButtons()[`${selected.row},${selected.col}`];
          if (sp) {
            pushHistory('生成自定义文字图标');
            sp.icon = res.dataUrl;
            sp.textIconConfig = res.config;
            if (res.config && res.config.hideKeyLabel) {
              sp.label = '';
              sp.iconScale = Math.max(Number(sp.iconScale) || 62, 84);
            }
            await commit(true);
            renderInspector();
            closeIconPicker();
            toast(`🔤 已应用「${res.templateName}」文字图标`);
          }
        }
      });
    };
  }

  const btnSaveCurrent = $('ipSaveCurrent');
  if (btnSaveCurrent) {
    btnSaveCurrent.onclick = async () => {
      if (!selected || selected.col === 5) {
        toast('先点选一个按键');
        return;
      }
      const spec = pageButtons()[selected.row + ',' + selected.col];
      if (!spec || !spec.icon) {
        toast('选中的按键没有设置图标');
        return;
      }
      const name = await askText('存入自定义图标库', spec.label || '我的图标', '输入图标名称');
      if (!name) return;
      cfg.customIcons = cfg.customIcons || [];
      const targetCat = (currentCustomSubCategory === '全部') ? '常用' : currentCustomSubCategory;
      cfg.customIcons.push({
        id: 'ci_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
        name: name.trim(),
        icon: spec.icon,
        category: targetCat,
        tags: [],
        badge: spec.badge || '',
        badgeBg: spec.badgeBg || '',
        badgeColor: spec.badgeColor || '',
        addedAt: Date.now()
      });
      await saveConfig();
      toast(`已存入自定义图标库「${targetCat}」分类：「${name.trim()}」`);
      currentIconCategory = 'custom';
      renderIconPicker();
    };
  }

  // 矢量图标单色着色盘事件
  const tintDots = document.querySelectorAll('.ip-tint-dot');
  tintDots.forEach(dot => {
    dot.onclick = () => {
      tintDots.forEach(d => d.classList.remove('active'));
      dot.classList.add('active');
      ipTintColor = dot.dataset.color || '#ffffff';
      const picker = $('ipCustomTintColor');
      if (picker) picker.value = ipTintColor;
    };
  });
  const customTint = $('ipCustomTintColor');
  if (customTint) {
    customTint.oninput = (e) => {
      ipTintColor = e.target.value;
      tintDots.forEach(d => {
        d.classList.toggle('active', d.dataset.color.toLowerCase() === ipTintColor.toLowerCase());
      });
    };
  }

  // 图标库批量管理相关按钮绑定
  const btnIpBatchToggle = $('ipBatchToggle');
  if (btnIpBatchToggle) {
    btnIpBatchToggle.onclick = () => {
      ipBatchMode = !ipBatchMode;
      if (!ipBatchMode) ipSelectedIds.clear();
      updateIpBatchBar();
      renderIconPicker();
    };
  }
  const btnIpSelectAll = $('ipBatchSelectAll');
  if (btnIpSelectAll) {
    btnIpSelectAll.onclick = () => {
      const q = ($('ipSearch').value || '').trim().toLowerCase();
      // 选中当前可见的自定义图标
      if (currentIconCategory === 'custom' || currentIconCategory === 'all') {
        for (const ic of ((cfg && cfg.customIcons) || [])) {
          if (!q || ic.name.toLowerCase().includes(q) || (ic.category && ic.category.toLowerCase().includes(q))) {
            if (currentIconCategory !== 'custom' || currentCustomSubCategory === '全部' || (ic.category || '常用') === currentCustomSubCategory) {
              ipSelectedIds.add(ic.id);
            }
          }
        }
      }
      // 选中当前可见的内置图标
      if (currentIconCategory !== 'custom' && typeof BUILTIN_ICONS !== 'undefined') {
        for (const icon of BUILTIN_ICONS) {
          if (currentIconCategory !== 'all' && icon.category !== currentIconCategory) continue;
          if (q && !icon.name.toLowerCase().includes(q)) continue;
          const iconId = 'bi:' + (icon.category || 'all') + ':' + icon.name;
          if ((cfg.hiddenBuiltinIcons || []).includes(iconId) || (cfg.hiddenBuiltinIcons || []).includes(icon.name)) continue;
          ipSelectedIds.add(iconId);
        }
      }
      updateIpBatchBar();
      renderIconPicker();
    };
  }
  const btnIpDeselect = $('ipBatchDeselect');
  if (btnIpDeselect) {
    btnIpDeselect.onclick = () => {
      ipSelectedIds.clear();
      updateIpBatchBar();
      renderIconPicker();
    };
  }
  const btnIpBatchCat = $('ipBatchCategory');
  if (btnIpBatchCat) btnIpBatchCat.onclick = iconBatchCategory;
  const btnIpBatchExp = $('ipBatchExport');
  if (btnIpBatchExp) btnIpBatchExp.onclick = iconBatchExport;
  const btnIpBatchDel = $('ipBatchDelete');
  if (btnIpBatchDel) btnIpBatchDel.onclick = iconBatchDelete;
  const btnIpBatchExit = $('ipBatchExit');
  if (btnIpBatchExit) {
    btnIpBatchExit.onclick = () => {
      ipBatchMode = false;
      ipSelectedIds.clear();
      updateIpBatchBar();
      renderIconPicker();
    };
  }
}


// ------------------------------------------------------------ image cropper

let cropperState = {
  active: false,
  image: null,
  rotation: 0,        // 0, 90, 180, 270
  relativeZoom: 1.0,  // 1.0 = 100%
  baseScale: 1.0,     // scale at relativeZoom = 1.0
  coverScale: 1.0,    // scale to cover the 210x210 mask
  fitScale: 1.0,      // scale to fit inside 210x210 mask
  scale: 1.0,         // actual scale = baseScale * relativeZoom
  x: 140,             // center X on 280x280 canvas
  y: 140,             // center Y on 280x280 canvas
  dragging: false,
  startX: 0,
  startY: 0,
  onConfirm: null,
};

function computeCropperScales() {
  if (!cropperState.image) return;
  const img = cropperState.image;
  const isRot90 = (cropperState.rotation % 180 !== 0);
  const effW = isRot90 ? img.height : img.width;
  const effH = isRot90 ? img.width : img.height;
  const maskSize = 210;

  cropperState.coverScale = maskSize / Math.min(effW, effH);
  cropperState.fitScale = maskSize / Math.max(effW, effH);
  cropperState.baseScale = cropperState.coverScale;
  cropperState.scale = cropperState.baseScale * cropperState.relativeZoom;
}

function openCropper(imageSrc, onConfirm) {
  const modal = $('cropperModal');
  if (!modal) {
    if (onConfirm) onConfirm(imageSrc);
    return;
  }
  const img = new Image();
  img.onload = () => {
    cropperState.image = img;
    cropperState.onConfirm = onConfirm;
    cropperState.active = true;
    cropperState.rotation = 0;
    cropperState.relativeZoom = 1.0;
    cropperState.x = 140;
    cropperState.y = 140;

    computeCropperScales();

    const zoomInput = $('cropZoom');
    if (zoomInput) {
      zoomInput.value = '1.0';
      $('cropZoomVal').textContent = '100%';
    }

    modal.hidden = false;
    renderCropper();
  };
  img.src = imageSrc;
}

function closeCropper() {
  const modal = $('cropperModal');
  if (modal) modal.hidden = true;
  cropperState.active = false;
  cropperState.image = null;
  cropperState.onConfirm = null;
}

function setRelativeZoom(newZoom, cx = 140, cy = 140) {
  newZoom = Math.max(0.2, Math.min(4.0, newZoom));
  const oldScale = cropperState.scale;
  cropperState.relativeZoom = newZoom;
  cropperState.scale = cropperState.baseScale * newZoom;

  if (oldScale > 0) {
    const ratio = cropperState.scale / oldScale;
    cropperState.x = cx - (cx - cropperState.x) * ratio;
    cropperState.y = cy - (cy - cropperState.y) * ratio;
  }

  const zoomInput = $('cropZoom');
  if (zoomInput) {
    zoomInput.value = newZoom.toFixed(2);
    $('cropZoomVal').textContent = Math.round(newZoom * 100) + '%';
  }
  renderCropper();
}

function renderCropper() {
  const canvas = $('cropCanvas');
  if (!canvas || !cropperState.image) return;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, 280, 280);

  // Outer dark background
  ctx.fillStyle = '#14171a';
  ctx.fillRect(0, 0, 280, 280);

  // Inside mask transparency checkerboard (210x210 centered at 140,140 => bounds: [35, 35, 210, 210])
  ctx.save();
  ctx.beginPath();
  if (ctx.roundRect) {
    ctx.roundRect(35, 35, 210, 210, 28);
  } else {
    ctx.rect(35, 35, 210, 210);
  }
  ctx.clip();

  const checkSize = 10;
  for (let y = 35; y < 245; y += checkSize) {
    for (let x = 35; x < 245; x += checkSize) {
      ctx.fillStyle = ((Math.floor(x / checkSize) + Math.floor(y / checkSize)) % 2 === 0) ? '#22272e' : '#1c2128';
      ctx.fillRect(x, y, checkSize, checkSize);
    }
  }

  // Draw the image rotated and scaled around (cropperState.x, cropperState.y)
  ctx.save();
  ctx.translate(cropperState.x, cropperState.y);
  ctx.rotate((cropperState.rotation * Math.PI) / 180);
  ctx.scale(cropperState.scale, cropperState.scale);
  ctx.drawImage(cropperState.image, -cropperState.image.width / 2, -cropperState.image.height / 2);
  ctx.restore();

  ctx.restore(); // end clip
}

function initCropper() {
  const canvas = $('cropCanvas');
  const modal = $('cropperModal');
  if (!canvas || !modal) return;

  canvas.addEventListener('mousedown', (e) => {
    cropperState.dragging = true;
    cropperState.startX = e.clientX - cropperState.x;
    cropperState.startY = e.clientY - cropperState.y;
  });

  window.addEventListener('mousemove', (e) => {
    if (!cropperState.dragging) return;
    cropperState.x = e.clientX - cropperState.startX;
    cropperState.y = e.clientY - cropperState.startY;
    renderCropper();
  });

  window.addEventListener('mouseup', () => {
    cropperState.dragging = false;
  });

  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    const delta = e.deltaY < 0 ? 0.08 : -0.08;
    setRelativeZoom(cropperState.relativeZoom + delta, cx, cy);
  }, { passive: false });

  const zoomInput = $('cropZoom');
  if (zoomInput) {
    zoomInput.addEventListener('input', () => {
      setRelativeZoom(Number(zoomInput.value), 140, 140);
    });
  }

  // 快捷操作按钮
  const btnFit = $('cropFit');
  if (btnFit) {
    btnFit.onclick = () => {
      if (!cropperState.image) return;
      computeCropperScales();
      const fitRelative = cropperState.fitScale / cropperState.baseScale;
      cropperState.x = 140;
      cropperState.y = 140;
      setRelativeZoom(fitRelative, 140, 140);
    };
  }

  const btnCover = $('cropCover');
  if (btnCover) {
    btnCover.onclick = () => {
      if (!cropperState.image) return;
      computeCropperScales();
      cropperState.x = 140;
      cropperState.y = 140;
      setRelativeZoom(1.0, 140, 140);
    };
  }

  const btnRotate = $('cropRotate');
  if (btnRotate) {
    btnRotate.onclick = () => {
      if (!cropperState.image) return;
      cropperState.rotation = (cropperState.rotation + 90) % 360;
      computeCropperScales();
      renderCropper();
    };
  }

  const btnReset = $('cropReset');
  if (btnReset) {
    btnReset.onclick = () => {
      if (!cropperState.image) return;
      cropperState.rotation = 0;
      cropperState.x = 140;
      cropperState.y = 140;
      computeCropperScales();
      setRelativeZoom(1.0, 140, 140);
    };
  }

  $('cropClose').onclick = closeCropper;
  $('cropCancel').onclick = closeCropper;

  $('cropOk').onclick = () => {
    if (!cropperState.image || !cropperState.onConfirm) {
      closeCropper();
      return;
    }
    const outCanvas = document.createElement('canvas');
    outCanvas.width = 192;
    outCanvas.height = 192;
    const outCtx = outCanvas.getContext('2d');
    outCtx.clearRect(0, 0, 192, 192);
    outCtx.imageSmoothingEnabled = true;
    outCtx.imageSmoothingQuality = 'high';

    const exportRatio = 192 / 210;
    outCtx.save();
    outCtx.translate(96, 96);
    outCtx.translate((cropperState.x - 140) * exportRatio, (cropperState.y - 140) * exportRatio);
    outCtx.rotate((cropperState.rotation * Math.PI) / 180);
    const exportScale = cropperState.scale * exportRatio;
    outCtx.scale(exportScale, exportScale);
    outCtx.drawImage(cropperState.image, -cropperState.image.width / 2, -cropperState.image.height / 2);
    outCtx.restore();

    // 导出高保真带透明通道的 PNG（体积通常仅 15KB~35KB）
    const croppedDataUrl = outCanvas.toDataURL('image/png');
    const cb = cropperState.onConfirm;
    closeCropper();
    cb(croppedDataUrl);
  };
}

// ------------------------------------------------------------ keyboard shortcuts

function initKeyboardShortcuts() {
  document.addEventListener('keydown', async (e) => {
    const tag = e.target.tagName ? e.target.tagName.toLowerCase() : '';
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return;

    if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z')) {
      e.preventDefault();
      if (e.shiftKey) await performRedo();
      else await performUndo();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || e.key === 'Y')) {
      e.preventDefault();
      await performRedo();
      return;
    }

    if (e.key === 'Escape') {
      hideContextMenu();
      closeIconPicker();
      closeCropper();
      if (styleBrushSpec) {
        setStyleBrush(null);
        toast('已退出样式刷模式');
        return;
      }
      if (multiSelected.size > 0) {
        multiSelected.clear();
        refreshGrid();
        renderInspector();
        return;
      }
      if (selected) select(null);
      return;
    }

    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
      e.preventDefault();
      if (!selected) { select(0, 0); return; }
      let { row, col } = selected;
      if (e.key === 'ArrowUp') row = Math.max(0, row - 1);
      if (e.key === 'ArrowDown') row = Math.min(ROWS - 1, row + 1);
      if (e.key === 'ArrowLeft') col = Math.max(0, col - 1);
      if (e.key === 'ArrowRight') col = Math.min(TOTAL_COLS - 1, col + 1);
      select(row, col);
      return;
    }

    if ((e.ctrlKey || e.metaKey) && (e.key === 'c' || e.key === 'C')) {
      if (!selected) return;
      const spec = (selected.col === 5) ? pageStrips()[String(selected.row)] : pageButtons()[selected.row + ',' + selected.col];
      if (spec) {
        clipboardKey = clone(spec);
        toast(`已复制按键配置`);
      }
      return;
    }

    if ((e.ctrlKey || e.metaKey) && (e.key === 'v' || e.key === 'V')) {
      if (!selected || selected.col === 5 || !clipboardKey) return;
      if (isBackCell(selected.row, selected.col)) return;
      await stopKeyMacroIfNeeded(selected.row, selected.col);
      pageButtons()[selected.row + ',' + selected.col] = clone(clipboardKey);
      await commit(true);
      renderInspector();
      toast(`已粘贴到 r${selected.row}c${selected.col}`);
      return;
    }

    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (!selected || selected.col === 5) return;
      if (isBackCell(selected.row, selected.col)) return;
      const spec = pageButtons()[selected.row + ',' + selected.col];
      if (spec) {
        await removeKey(selected.row, selected.col);
        toast(`已清空格子`);
      }
      return;
    }
  });
}

// ------------------------------------------------------------- shell wiring

function bindShell() {
  if ($('btnUndo')) $('btnUndo').onclick = () => performUndo();
  if ($('btnRedo')) $('btnRedo').onclick = () => performRedo();
  if ($('btnStyleBrush')) {
    $('btnStyleBrush').onclick = () => {
      if (styleBrushSpec) {
        setStyleBrush(null);
        toast('已关闭样式刷');
        return;
      }
      if (!selected || selected.col === 5) {
        toast('请先点选一个已经配好外观的按键，再点「🖌️ 样式刷」提取其样式');
        return;
      }
      const spec = pageButtons()[`${selected.row},${selected.col}`];
      if (!spec) {
        toast('当前选中的格子是空的，请先选择一个已有按键提取样式');
        return;
      }
      setStyleBrush(spec);
    };
  }

  const weatherInput = $('prefWeatherCity');
  if (weatherInput) {
    weatherInput.value = cfg.weatherCity || 'Auto';
    weatherInput.addEventListener('change', async () => {
      cfg.weatherCity = weatherInput.value.trim() || 'Auto';
      if (!DEMO) await saveConfig();
      toast(`天气组件默认城市已设为：${cfg.weatherCity}`);
    });
  }
  const pomoInput = $('prefPomodoroMin');
  if (pomoInput) {
    pomoInput.value = cfg.pomodoroMinutes || 25;
    pomoInput.addEventListener('change', async () => {
      cfg.pomodoroMinutes = Math.max(1, Math.min(180, Number(pomoInput.value) || 25));
      pomoInput.value = cfg.pomodoroMinutes;
      if (!DEMO) await saveConfig();
      toast(`番茄钟默认时长已设为：${cfg.pomodoroMinutes} 分钟`);
    });
  }

  const panel = $('settingsPanel');
  const gear = $('settingsBtn');
  const closeBtn = $('settingsCloseBtn');

  const openSettings = (open) => {
    panel.hidden = !open;
    gear.classList.toggle('on', open);
  };

  gear.onclick = (e) => {
    e.stopPropagation();
    openSettings(panel.hidden);
  };

  if (closeBtn) {
    closeBtn.onclick = () => openSettings(false);
  }

  panel.addEventListener('click', (e) => {
    if (e.target === panel) openSettings(false);
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !panel.hidden) {
      openSettings(false);
    }
  });

  // Settings Nav Tabs
  const navItems = document.querySelectorAll('.settings-nav-item');
  const tabTitle = $('settingsTabTitle');
  const titleMap = {
    hardware: '📟 硬件与屏幕设置',
    behavior: '⚡ 交互偏好设置',
    appearance: '🎨 外观与主题设置',
    data: '💾 备份与数据管理',
    system: '🛠️ 系统与关于'
  };

  navItems.forEach((btn) => {
    btn.onclick = () => {
      const tab = btn.dataset.tab;
      navItems.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');

      document.querySelectorAll('.settings-tab-pane').forEach((pane) => {
        pane.hidden = (pane.id !== `pane-${tab}`);
      });
      if (tabTitle && titleMap[tab]) {
        tabTitle.textContent = titleMap[tab];
      }
    };
  });

  // 交互偏好
  const dropModeSelect = $('prefAppDropMode');
  if (dropModeSelect) {
    dropModeSelect.value = cfg.appDropMode || 'dual';
    dropModeSelect.addEventListener('change', async (e) => {
      cfg.appDropMode = e.target.value;
      if (!DEMO) await saveConfig();
      const modeNames = {
        dual: '启动/强退双态闭环',
        graceful: '启动/优雅关闭双态 (WM_CLOSE)',
        smart: '智能任务栏模式 (启动/置顶/最小化切换)',
        single: '普通单一启动'
      };
      toast(`应用拖拽策略已切换为：${modeNames[e.target.value] || e.target.value}`);
    });
  }

  const autoSwitchBox = $('prefAutoSwitchPage');
  if (autoSwitchBox) {
    autoSwitchBox.checked = cfg.autoSwitchPage !== false;
    autoSwitchBox.addEventListener('change', async (e) => {
      cfg.autoSwitchPage = e.target.checked;
      if (!DEMO) await saveConfig();
      toast(e.target.checked ? '已开启前台应用感知自动切页' : '已关闭前台应用感知自动切页');
    });
  }

  const debounceInput = $('prefDebounce');
  const debounceVal = $('prefDebounceVal');
  if (debounceInput) {
    debounceInput.value = cfg.keyDebounceMs || 100;
    if (debounceVal) debounceVal.textContent = cfg.keyDebounceMs || 100;
    debounceInput.addEventListener('input', (e) => {
      const v = +e.target.value;
      if (debounceVal) debounceVal.textContent = v;
      cfg.keyDebounceMs = v;
      scheduleDebouncedCommit(false);
    });
    debounceInput.addEventListener('change', async () => {
      if (!DEMO) {
        await saveConfig();
        if (api.deviceSetDebounce) await api.deviceSetDebounce(cfg.keyDebounceMs);
      }
    });
  }

  const hwModelSel = $('hardwareModelSelect');
  if (hwModelSel) {
    hwModelSel.value = cfg.hardwareModel || 'akp153';
    hwModelSel.addEventListener('change', async (e) => {
      const modelId = e.target.value || 'akp153';
      cfg.hardwareModel = modelId;
      applyHardwareModelToUI(modelId);
      if (!DEMO) {
        await saveConfig();
        if (api.hardwareSetModel) await api.hardwareSetModel(modelId);
      }
      toast(`📟 硬件配置模型已切换为：${hwModelSel.options[hwModelSel.selectedIndex].text}`);
    });
  }

  const transSel = $('transitionStyleSelect');
  if (transSel) {
    transSel.value = cfg.transitionStyle || 'slide-left';
    transSel.addEventListener('change', async (e) => {
      cfg.transitionStyle = e.target.value || 'slide-left';
      triggerGridTransition(cfg.transitionStyle);
      if (!DEMO) await saveConfig();
      toast(`✨ 页面切换过渡动效已设为：${transSel.options[transSel.selectedIndex].text}`);
    });
  }

  const ctxBarBox = $('prefContextBarEnabled');
  if (ctxBarBox) {
    ctxBarBox.checked = cfg.contextBarEnabled !== false;
    ctxBarBox.addEventListener('change', async (e) => {
      cfg.contextBarEnabled = e.target.checked;
      if (!cfg.contextBarEnabled) activeRendererContextBar = null;
      updateContextBarBadgeUI();
      refreshStripCells(lastSysStats);
      if (!DEMO) {
        await saveConfig();
        await repaintStrips();
      }
      toast(e.target.checked ? '✨ 已开启场景上下文感知动态副屏栏' : '已关闭智能上下文副屏栏，恢复页面固定副屏');
    });
  }

  const pressAnimBox = $('prefKeyPressAnim');
  if (pressAnimBox) {
    pressAnimBox.checked = cfg.keyPressAnim !== false;
    pressAnimBox.addEventListener('change', async (e) => {
      cfg.keyPressAnim = e.target.checked;
      if (!DEMO) {
        await saveConfig();
        if (!e.target.checked && api.deviceClearAnims) await api.deviceClearAnims();
      }
      toast(e.target.checked ? '🎞️ 已开启硬件动效帧缓冲与按压微缩回弹' : '已关闭硬件动效帧缓冲');
    });
  }

  const ctxBadgeEl = $('contextBarBadge');
  if (ctxBadgeEl) {
    ctxBadgeEl.onclick = async () => {
      cfg.contextBarEnabled = !(cfg.contextBarEnabled !== false);
      if ($('prefContextBarEnabled')) $('prefContextBarEnabled').checked = cfg.contextBarEnabled;
      updateContextBarBadgeUI();
      refreshStripCells(lastSysStats);
      if (!DEMO) {
        await saveConfig();
        await repaintStrips();
      }
      toast(cfg.contextBarEnabled ? '✨ 智能上下文副屏已激活' : '已临时切回页面默认副屏');
    };
  }

  const hudBox = $('prefHudEnabled');
  if (hudBox) {
    hudBox.checked = cfg.hudEnabled !== false;
    hudBox.addEventListener('change', async (e) => {
      cfg.hudEnabled = e.target.checked;
      if (!DEMO) await saveConfig();
      toast(e.target.checked ? '已开启桌面毛玻璃 HUD 悬浮提示窗' : '已关闭桌面 HUD 悬浮提示窗');
    });
  }
  const btnPrevHud = $('btnPreviewHud');
  if (btnPrevHud) {
    btnPrevHud.onclick = () => {
      if (!DEMO && api.hudShow) {
        api.hudShow({
          icon: 'sparkles',
          title: 'AKP153 悬浮胶囊提示',
          subtitle: '无焦点穿透毛玻璃 OSD 已就绪',
          accent: '#3b82f6'
        });
      } else {
        toast('✨ 桌面 HUD 胶囊预览（真机模式下在屏幕顶部中央弹出）');
      }
    };
  }

  const closeToTrayBox = $('prefCloseToTray');
  if (closeToTrayBox) {
    closeToTrayBox.checked = cfg.closeToTray !== false;
    closeToTrayBox.addEventListener('change', async (e) => {
      cfg.closeToTray = e.target.checked;
      if (!DEMO) await saveConfig();
      toast(e.target.checked ? '已开启关闭时最小化到托盘' : '已关闭托盘，点击✕将直接退出应用');
    });
  }

  // 备份与数据管理
  const btnExport = $('btnExportConfig');
  if (btnExport) {
    btnExport.onclick = async () => {
      if (DEMO || !window.api || !api.configExport) {
        toast('当前为演示模式，不可导出配置');
        return;
      }
      const res = await api.configExport();
      if (res && res.ok) toast(`配置已成功备份到：${res.path}`);
      else if (res && res.error) toast(`导出失败：${res.error}`);
    };
  }

  const btnImport = $('btnImportConfig');
  if (btnImport) {
    btnImport.onclick = async () => {
      if (DEMO || !window.api || !api.configImport) {
        toast('当前为演示模式，不可导入配置');
        return;
      }
      const res = await api.configImport();
      if (res && res.ok) {
        cfg = await api.configLoad();
        selected = null;
        applyTheme();
        renderPageTabs();
        buildGrid();
        renderInspector();
        renderLibrary();
        renderLibPanel();
        await repaintAll();
        toast('配置备份恢复成功！');
      } else if (res && res.error) {
        toast(`导入失败：${res.error}`);
      }
    };
  }

  const btnOpenFolder = $('btnOpenConfigFolder');
  if (btnOpenFolder) {
    btnOpenFolder.onclick = async () => {
      if (DEMO || !window.api || !api.configOpenFolder) {
        toast('演示模式');
        return;
      }
      await api.configOpenFolder();
    };
  }

  const btnReset = $('btnResetConfig');
  if (btnReset) {
    btnReset.onclick = async () => {
      if (DEMO || !window.api || !api.configReset) {
        toast('演示模式');
        return;
      }
      if (!(await askConfirm('恢复出厂设置', '确定要将控制台全部重置为出厂设置吗？当前所有自定义按键和页面将被清空！'))) return;
      const res = await api.configReset();
      if (res && res.ok) {
        activeLoopKeyIds.clear();
        cfg = await api.configLoad();
        selected = null;
        applyTheme();
        renderPageTabs();
        buildGrid();
        renderInspector();
        renderLibrary();
        renderLibPanel();
        await repaintAll();
        toast('已恢复出厂设置！');
      }
    };
  }

  const linkGithub = $('linkGithub');
  if (linkGithub) {
    linkGithub.onclick = (e) => {
      e.preventDefault();
      if (!DEMO && window.api && api.openExternal) {
        api.openExternal('https://github.com/xpxp23/AKP153-DOCK');
      } else {
        window.open('https://github.com/xpxp23/AKP153-DOCK', '_blank');
      }
    };
  }

  // 机身颜色（默认白色）。故意放在 bindShell 而不是 bindDevice，
  // 这样预览模式（无 preload）里也能切换、能截图。
  $('theme').value = (cfg.theme === 'dark') ? 'dark' : 'light';
  $('theme').addEventListener('change', async (e) => {
    cfg.theme = e.target.value;
    applyTheme();
    if (!DEMO) await saveConfig();
  });

  $('drawerToggle').onclick = () => setDrawer(!$('drawer').classList.contains('open'));
  $('inspHelp').onclick = showHelp;

  const onSearch = (e) => { libQuery = e.target.value; renderLibrary(); renderLibPanel(); };
  $('libSearch').addEventListener('input', onSearch);
  $('libSearch2').addEventListener('input', onSearch);
  $('libExpand').onclick = () => openLibPanel(true);
  $('libClose').onclick = () => openLibPanel(false);
  $('libPanel').addEventListener('click', (e) => { if (e.target === $('libPanel')) openLibPanel(false); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !$('libPanel').hidden) openLibPanel(false);
  });
  $('libImport').onclick = libraryImport;
  $('libExportAll').onclick = () => libraryExport('');
  $('libExportTag').onclick = () => {
    if (!libTag) { toast('先点一个标签再导出'); return; }
    libraryExport(libTag);
  };

  const btnLibBatchToggle = $('libBatchToggle');
  if (btnLibBatchToggle) {
    btnLibBatchToggle.onclick = () => {
      libBatchMode = !libBatchMode;
      if (!libBatchMode) libSelectedIds.clear();
      updateLibBatchBar();
      renderLibPanel();
    };
  }
  const btnLibSelectAll = $('libBatchSelectAll');
  if (btnLibSelectAll) {
    btnLibSelectAll.onclick = () => {
      for (const e of libEntries().filter(libMatches)) libSelectedIds.add(e.id);
      updateLibBatchBar();
      renderLibPanel();
    };
  }
  const btnLibDeselect = $('libBatchDeselect');
  if (btnLibDeselect) {
    btnLibDeselect.onclick = () => {
      libSelectedIds.clear();
      updateLibBatchBar();
      renderLibPanel();
    };
  }
  const btnLibBatchTag = $('libBatchTag');
  if (btnLibBatchTag) btnLibBatchTag.onclick = libraryBatchTags;
  const btnLibBatchExp = $('libBatchExport');
  if (btnLibBatchExp) btnLibBatchExp.onclick = libraryBatchExport;
  const btnLibBatchDel = $('libBatchDelete');
  if (btnLibBatchDel) btnLibBatchDel.onclick = libraryBatchDelete;
  const btnLibBatchExit = $('libBatchExit');
  if (btnLibBatchExit) {
    btnLibBatchExit.onclick = () => {
      libBatchMode = false;
      libSelectedIds.clear();
      updateLibBatchBar();
      renderLibPanel();
    };
  }

  const lkm = $('libKeyModal');
  if (lkm) {
    $('lkmClose').onclick = closeLibKeyModal;
    lkm.addEventListener('click', (e) => { if (e.target === lkm) closeLibKeyModal(); });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !lkm.hidden) closeLibKeyModal();
    });

    // 三 Tab 切换
    $('lkmTabAction').onclick = () => setLkmTab('action');
    $('lkmTabStyle').onclick = () => setLkmTab('style');
    $('lkmTabDual').onclick = () => setLkmTab('dual');

    // Tab 1: 动作与快捷事件
    $('lkmActType').onchange = (e) => {
      if (!currentLibModalSpec) return;
      const nextType = e.target.value;
      currentLibModalSpec.type = nextType;
      if (nextType === 'volume') {
        currentLibModalSpec.action = currentLibModalSpec.action || 'up';
        currentLibModalSpec.step = currentLibModalSpec.step || 5;
      } else if (nextType === 'page') {
        currentLibModalSpec.mode = currentLibModalSpec.mode || 'next';
        if (currentLibModalSpec.mode === 'goto' && !currentLibModalSpec.pageId) {
          currentLibModalSpec.pageId = (cfg && cfg.pages && cfg.pages[0] && cfg.pages[0].id) || 'p1';
        }
      } else if (nextType === 'media') {
        currentLibModalSpec.cmd = currentLibModalSpec.cmd || 'play_pause';
      } else if (nextType === 'multi') {
        currentLibModalSpec.actions = Array.isArray(currentLibModalSpec.actions) ? currentLibModalSpec.actions : [];
        currentLibModalSpec.loop = currentLibModalSpec.loop || { mode: 'once', interval: 50 };
      } else if (nextType === 'qr_decode') {
        currentLibModalSpec.target = 'qr_decode';
      }
      updateLkmActionUI();
      updateLkmSwatch();
    };
    $('lkmTargetInput').oninput = (e) => {
      if (!currentLibModalSpec) return;
      if (currentLibModalSpec.type === 'hotkey') {
        currentLibModalSpec.hotkey = e.target.value;
        currentLibModalSpec.target = e.target.value;
      } else if (currentLibModalSpec.type === 'media') {
        currentLibModalSpec.cmd = e.target.value;
        currentLibModalSpec.target = e.target.value;
      } else {
        currentLibModalSpec.target = e.target.value;
      }
      updateLkmActionUI();
      updateLkmSwatch();
    };

    // 专属音量控制绑定 (#lkmVolAction + #lkmVolStep)
    if ($('lkmVolAction')) {
      $('lkmVolAction').onchange = (e) => {
        if (!currentLibModalSpec) return;
        currentLibModalSpec.action = e.target.value;
        if (e.target.value === 'set') {
          currentLibModalSpec.target = String(Number($('lkmVolStep') && $('lkmVolStep').value) || 50);
        } else {
          currentLibModalSpec.step = Number($('lkmVolStep') && $('lkmVolStep').value) || 5;
        }
        updateLkmActionUI();
        updateLkmSwatch();
      };
    }
    if ($('lkmVolStep')) {
      $('lkmVolStep').oninput = (e) => {
        if (!currentLibModalSpec) return;
        const val = Math.max(1, Math.min(100, Number(e.target.value) || 5));
        if (currentLibModalSpec.action === 'set') currentLibModalSpec.target = String(val);
        else currentLibModalSpec.step = val;
        updateLkmActionUI();
      };
    }

    // 专属翻页动作绑定 (#lkmPageMode + #lkmPageTargetSelect)
    if ($('lkmPageMode')) {
      $('lkmPageMode').onchange = (e) => {
        if (!currentLibModalSpec) return;
        currentLibModalSpec.mode = e.target.value;
        if (currentLibModalSpec.mode === 'goto' && !currentLibModalSpec.pageId) {
          currentLibModalSpec.pageId = (cfg && cfg.pages && cfg.pages[0] && cfg.pages[0].id) || 'p1';
        }
        currentLibModalSpec.label = pageActionLabel(currentLibModalSpec);
        updateLkmActionUI();
        updateLkmSwatch();
      };
    }
    if ($('lkmPageTargetSelect')) {
      $('lkmPageTargetSelect').onchange = (e) => {
        if (!currentLibModalSpec) return;
        currentLibModalSpec.pageId = e.target.value;
        currentLibModalSpec.label = pageActionLabel(currentLibModalSpec);
        updateLkmActionUI();
        updateLkmSwatch();
      };
    }

    // 专属实时动态组件绑定 (#lkmWidgetKind)
    if ($('lkmWidgetKind')) {
      $('lkmWidgetKind').onchange = (e) => {
        if (!currentLibModalSpec) return;
        currentLibModalSpec.widgetKind = e.target.value;
        const info = WIDGET_KIND_INFOS.find(x => x.id === e.target.value);
        if (info) {
          currentLibModalSpec.action = info.act;
          currentLibModalSpec.color = info.color;
          currentLibModalSpec.label = info.name.split(' ')[0];
        }
        updateLkmActionUI();
        updateLkmSwatch();
      };
    }
    if ($('lkmSwapSyncCheck') && $('lkmSwapSyncTrack')) {
      $('lkmSwapSyncCheck').onchange = () => {
        $('lkmSwapSyncTrack').classList.toggle('on', $('lkmSwapSyncCheck').checked);
      };
    }
    $('lkmArgsInput').oninput = (e) => {
      if (!currentLibModalSpec) return;
      currentLibModalSpec.args = e.target.value;
      updateLkmActionUI();
    };
    $('lkmPickAppBtn').onclick = pickAppForLib;
    $('lkmFaviconBtn').onclick = fetchFaviconForLib;

    for (const pill of document.querySelectorAll('.lkm-mod-pill')) {
      pill.onclick = () => {
        const mod = pill.dataset.mod;
        if (!mod || !currentLibModalSpec) return;
        const cur = (currentLibModalSpec.hotkey || '').split('+').filter(Boolean);
        let next;
        if (cur.includes(mod)) next = cur.filter(x => x !== mod);
        else next = [...cur.filter(x => ['Ctrl', 'Alt', 'Shift', 'Win'].includes(x)), mod, ...cur.filter(x => !['Ctrl', 'Alt', 'Shift', 'Win'].includes(x))];
        currentLibModalSpec.hotkey = next.join('+');
        updateLkmActionUI();
        updateLkmSwatch();
      };
    }
    for (const btn of document.querySelectorAll('.lkm-hk-key')) {
      btn.onclick = () => {
        const key = btn.dataset.key;
        if (!key || !currentLibModalSpec) return;
        const cur = (currentLibModalSpec.hotkey || '').split('+').filter(x => ['Ctrl', 'Alt', 'Shift', 'Win'].includes(x));
        cur.push(key);
        currentLibModalSpec.hotkey = cur.join('+');
        updateLkmActionUI();
        updateLkmSwatch();
      };
    }
    if ($('lkmHkClear')) {
      $('lkmHkClear').onclick = () => {
        if (!currentLibModalSpec) return;
        currentLibModalSpec.hotkey = '';
        updateLkmActionUI();
        updateLkmSwatch();
      };
    }

    // Tab 2: 外观与样式事件
    $('lkmOpenIconPicker').onclick = openIconPickerForLib;
    if ($('lkmOpenTextIcon')) {
      $('lkmOpenTextIcon').onclick = () => {
        if (!currentLibModalSpec) return;
        openTextIconStudio(currentLibModalSpec, (res) => {
          currentLibModalSpec.icon = res.dataUrl;
          currentLibModalSpec.textIconConfig = res.config;
          if (res.config && res.config.hideKeyLabel) {
            currentLibModalSpec.label = '';
            currentLibModalSpec.iconScale = Math.max(Number(currentLibModalSpec.iconScale) || 62, 84);
          }
          updateLkmStyleUI();
          updateLkmSwatch();
          toast(`🔤 已应用「${res.templateName}」文字图标`);
        });
      };
    }
    $('lkmPickLocalIcon').onclick = pickLocalIconForLib;
    $('lkmClearIcon').onclick = () => {
      if (!currentLibModalSpec) return;
      currentLibModalSpec.icon = '';
      updateLkmSwatch();
      toast('已清除按键图标');
    };
    $('lkmLabelInput').oninput = (e) => {
      if (!currentLibModalSpec) return;
      currentLibModalSpec.label = e.target.value;
      updateLkmSwatch();
    };
    $('lkmFontSize').oninput = (e) => {
      if (!currentLibModalSpec) return;
      currentLibModalSpec.fontSize = +e.target.value;
      $('lkmFontSizeVal').textContent = e.target.value + '%';
      updateLkmSwatch();
    };
    $('lkmIconScale').oninput = (e) => {
      if (!currentLibModalSpec) return;
      currentLibModalSpec.iconScale = +e.target.value;
      $('lkmIconScaleVal').textContent = e.target.value + '%';
      updateLkmSwatch();
    };
    $('lkmColorInput').oninput = (e) => {
      if (!currentLibModalSpec) return;
      currentLibModalSpec.color = e.target.value;
      $('lkmColorVal').textContent = e.target.value;
      updateLkmSwatch();
    };
    for (const chip of document.querySelectorAll('.lkm-cchip')) {
      chip.onclick = () => {
        if (!currentLibModalSpec) return;
        currentLibModalSpec.color = chip.dataset.c;
        $('lkmColorInput').value = chip.dataset.c;
        $('lkmColorVal').textContent = chip.dataset.c;
        updateLkmSwatch();
      };
    }

    // Tab 3: 动态双态与角标事件
    $('lkmToggleAction').onchange = (e) => {
      if (!currentLibModalSpec) return;
      currentLibModalSpec.toggleAction = e.target.checked;
      if (currentLibModalSpec.toggleAction && !currentLibModalSpec.action2) {
        let defaultKill = '';
        if (currentLibModalSpec.target && currentLibModalSpec.type === 'app') {
          const proc = currentLibModalSpec.target.replace(/\\/g, '/').split('/').pop().replace(/\.[^.]+$/, '');
          if (proc) defaultKill = `taskkill /F /IM ${proc}.exe`;
        }
        currentLibModalSpec.action2 = {
          type: 'command',
          target: defaultKill,
          args: '',
        };
      }
      updateLkmDualUI();
    };
    $('lkmDualAct2Type').onchange = (e) => {
      if (!currentLibModalSpec) return;
      if (!currentLibModalSpec.action2) currentLibModalSpec.action2 = { type: 'command', target: '', args: '' };
      currentLibModalSpec.action2.type = e.target.value;
    };
    $('lkmDualAct2Target').oninput = (e) => {
      if (!currentLibModalSpec) return;
      if (!currentLibModalSpec.action2) currentLibModalSpec.action2 = { type: $('lkmDualAct2Type').value || 'command', target: '', args: '' };
      currentLibModalSpec.action2.target = e.target.value.trim();
      if (currentLibModalSpec.action2.type === 'hotkey') {
        currentLibModalSpec.action2.hotkey = currentLibModalSpec.action2.target;
      }
    };
    $('lkmSwapDualActionBtn').onclick = () => {
      if (!currentLibModalSpec) return;
      const s1 = extractActionPayload(currentLibModalSpec);
      const s2 = extractActionPayload(currentLibModalSpec.action2 || { type: 'command', target: '', args: '', hotkey: '' });
      applyActionPayload(currentLibModalSpec, s2);
      currentLibModalSpec.action2 = applyActionPayload({}, s1);

      const syncChk = $('lkmSwapSyncCheck');
      if (syncChk && syncChk.checked && currentLibModalSpec.badgeToggle) {
        const b1 = clone(currentLibModalSpec.badgeState1 || { text: 'ON', bg: '#107c41' });
        const b2 = clone(currentLibModalSpec.badgeState2 || { text: 'OFF', bg: '#e53935' });
        currentLibModalSpec.badgeState1 = b2;
        currentLibModalSpec.badgeState2 = b1;
      }
      updateLkmActionUI();
      updateLkmDualUI();
      updateLkmSwatch();
      toast('已互换形态 1 与形态 2 执行动作');
    };

    $('lkmBadgeModeNone').onclick = () => {
      if (!currentLibModalSpec) return;
      delete currentLibModalSpec.badge;
      delete currentLibModalSpec.badgeToggle;
      delete currentLibModalSpec.badgeState1;
      delete currentLibModalSpec.badgeState2;
      updateLkmDualUI();
      updateLkmSwatch();
    };
    $('lkmBadgeModeStatic').onclick = () => {
      if (!currentLibModalSpec) return;
      delete currentLibModalSpec.badgeToggle;
      delete currentLibModalSpec.badgeState1;
      delete currentLibModalSpec.badgeState2;
      currentLibModalSpec.badge = currentLibModalSpec.badge || 'VIP';
      currentLibModalSpec.badgeBg = currentLibModalSpec.badgeBg || '#e53935';
      updateLkmDualUI();
      updateLkmSwatch();
    };
    $('lkmBadgeModeDual').onclick = () => {
      if (!currentLibModalSpec) return;
      delete currentLibModalSpec.badge;
      currentLibModalSpec.badgeToggle = true;
      currentLibModalSpec.badgeState1 = currentLibModalSpec.badgeState1 || { text: '待机', bg: '#546e7a' };
      currentLibModalSpec.badgeState2 = currentLibModalSpec.badgeState2 || { text: '运行中', bg: '#107c41' };
      updateLkmDualUI();
      updateLkmSwatch();
    };
    $('lkmBadgeStaticText').oninput = (e) => {
      if (!currentLibModalSpec) return;
      currentLibModalSpec.badge = e.target.value.trim();
      updateLkmSwatch();
    };
    $('lkmBadgeStaticColor').oninput = (e) => {
      if (!currentLibModalSpec) return;
      currentLibModalSpec.badgeBg = e.target.value;
      updateLkmSwatch();
    };
    $('lkmBadge1Text').oninput = (e) => {
      if (!currentLibModalSpec) return;
      currentLibModalSpec.badgeState1 = currentLibModalSpec.badgeState1 || {};
      currentLibModalSpec.badgeState1.text = e.target.value.trim();
      updateLkmSwatch();
    };
    $('lkmBadge1Color').oninput = (e) => {
      if (!currentLibModalSpec) return;
      currentLibModalSpec.badgeState1 = currentLibModalSpec.badgeState1 || {};
      currentLibModalSpec.badgeState1.bg = e.target.value;
      updateLkmSwatch();
    };
    $('lkmBadge2Text').oninput = (e) => {
      if (!currentLibModalSpec) return;
      currentLibModalSpec.badgeState2 = currentLibModalSpec.badgeState2 || {};
      currentLibModalSpec.badgeState2.text = e.target.value.trim();
      updateLkmSwatch();
    };
    $('lkmBadge2Color').oninput = (e) => {
      if (!currentLibModalSpec) return;
      currentLibModalSpec.badgeState2 = currentLibModalSpec.badgeState2 || {};
      currentLibModalSpec.badgeState2.bg = e.target.value;
      updateLkmSwatch();
    };
    $('lkmSwapDualBadgeBtn').onclick = () => {
      if (!currentLibModalSpec) return;
      const b1 = clone(currentLibModalSpec.badgeState1 || { text: 'ON', bg: '#107c41' });
      const b2 = clone(currentLibModalSpec.badgeState2 || { text: 'OFF', bg: '#e53935' });
      currentLibModalSpec.badgeState1 = b2;
      currentLibModalSpec.badgeState2 = b1;
      updateLkmDualUI();
      updateLkmSwatch();
      toast('已互换两态角标');
    };
    $('lkmPreviewToggleBtn').onclick = () => {
      lkmPreviewState = (lkmPreviewState === 1 ? 2 : 1);
      updateLkmSwatch(lkmPreviewState);
      toast(lkmPreviewState === 1 ? '正在预览形态 1' : '正在预览形态 2');
    };

    // 底栏操作
    $('lkmApplyToSlot').onclick = async () => {
      if (!currentLibModalEntry || !currentLibModalSpec) return;
      if (!selected || selected.col === 5 || isBackCell(selected.row, selected.col)) {
        toast('请先在主控面板点选一个可编辑的按键格子');
        return;
      }
      await stopKeyMacroIfNeeded(selected.row, selected.col);
      pageButtons()[selected.row + ',' + selected.col] = clone(currentLibModalSpec);
      await commit(true);
      renderInspector();
      closeLibKeyModal();
      toast(`已把「${currentLibModalEntry.name}」放置到 r${selected.row}c${selected.col}`);
    };
    $('lkmSave').onclick = async () => {
      if (!currentLibModalEntry || !currentLibModalSpec) return;
      const newName = $('lkmNameInput').value.trim();
      if (!newName) {
        toast('按键名称不能为空');
        return;
      }
      currentLibModalEntry.name = newName.slice(0, 24);
      currentLibModalEntry.tags = normTags($('lkmTagsInput').value);
      currentLibModalEntry.spec = clone(currentLibModalSpec);
      currentLibModalEntry.savedAt = new Date().toISOString();
      await libSave();
      renderLibPanel();
      renderLibrary();
      closeLibKeyModal();
      toast(`已保存修改：「${currentLibModalEntry.name}」`);
    };
    $('lkmDelete').onclick = async () => {
      if (!currentLibModalEntry) return;
      const id = currentLibModalEntry.id;
      const name = currentLibModalEntry.name;
      if (!(await askConfirm('从按键库删除', `「${name}」将从按键库中永久移除，已放置在面板上的不受影响。`))) return;
      cfg.library = libEntries().filter((x) => x.id !== id);
      await libSave();
      closeLibKeyModal();
      renderLibPanel();
      renderLibrary();
      toast(`已从库中删除：「${name}」`);
    };
    $('lkmTestBtn').onclick = async () => {
      if (!currentLibModalSpec) return;
      if (!DEMO && typeof api !== 'undefined' && api.actionRun) {
        const res = await api.actionRun(currentLibModalSpec);
        toast(res && res.ok ? `✅ 已测试执行：「${$('lkmNameInput').value || '按键'}」` : `执行失败：${(res && res.error) || '未知错误'}`);
      } else {
        toast(`已发送执行测试（预览模式）：「${$('lkmNameInput').value || '按键'}」`);
      }
    };
  }

  // 专属页面快照管理中心弹窗事件
  const psm = $('pageSnapshotModal');
  if (psm) {
    $('psmClose').onclick = closePageSnapshotModal;
    psm.addEventListener('click', (e) => { if (e.target === psm) closePageSnapshotModal(); });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !psm.hidden) closePageSnapshotModal();
    });
    $('psmSaveCurrent').onclick = saveCurrentPageAsSnapshot;
    $('psmImport').onclick = importPageSnapshots;
    $('psmExportAll').onclick = exportAllPageSnapshots;
  }

  if ($('pageAddTop')) $('pageAddTop').onclick = pageAddTop;
  if ($('pageAddSub')) $('pageAddSub').onclick = pageAddChild;
  if ($('pageRename')) $('pageRename').onclick = pageRename;
  if ($('pageDup')) $('pageDup').onclick = pageDuplicate;
  const pageSaveBtn = $('pageSave') || $('pageSnapshotBtn');
  if (pageSaveBtn) pageSaveBtn.onclick = openPageSnapshotModal;
  if ($('pageDel')) $('pageDel').onclick = pageDelete;

  const sideToggle = $('pageSidebarToggle');
  if (sideToggle) {
    sideToggle.onclick = () => {
      const sb = $('pageSidebar');
      if (sb) {
        const isCollapsed = sb.classList.toggle('collapsed');
        sideToggle.textContent = isCollapsed ? '⇥' : '⇤ 收起';
        sideToggle.title = isCollapsed ? '展开页面侧栏' : '收起页面侧栏';
      }
    };
  }

  const pGrad = $('pageGradientBtn');
  if (pGrad) pGrad.onclick = () => select(null);

  const hwMirrorBtn = $('hwMirrorToggleBtn');
  if (hwMirrorBtn) {
    hwMirrorBtn.onclick = () => {
      hwMirrorEnabled = !hwMirrorEnabled;
      hwMirrorBtn.classList.toggle('active-mirror', hwMirrorEnabled);
      refreshGrid();
      toast(hwMirrorEnabled ? '🖥️ 已开启 1:1 硬件真彩 Canvas 镜像预览' : '已切换为标准矢量 DOM 预览');
    };
  }

  const stage = document.querySelector('.stage');
  if (stage) {
    stage.addEventListener('click', (e) => {
      if (e.target.closest('.cell')) return;
      select(null);
    });
  }

  // 把格子拖进按键库 = 存进库。抽屉整条（含折叠时的标题栏）和库大面板都是放置目标。
  // 只绑 #drawer 而不额外绑它内部的 #library，否则 drop 会冒泡两次、存两条。
  for (const id of ['drawer', 'libGrid']) {
    const zone = $(id);
    if (!zone) continue;
    zone.addEventListener('dragover', (e) => {
      const hasKey = !!dragFrom || (e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('application/akp153-cell'));
      if (!hasKey) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      zone.classList.add('drop');
    });
    zone.addEventListener('dragleave', (e) => {
      if (zone.contains(e.relatedTarget)) return;
      zone.classList.remove('drop');
    });
    zone.addEventListener('drop', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      zone.classList.remove('drop');
      let from = dragFrom;
      if (!from && e.dataTransfer) {
        const raw = e.dataTransfer.getData('application/akp153-cell') || e.dataTransfer.getData('text/plain');
        if (raw && raw.includes(',')) {
          const [r, c] = raw.split(',').map(Number);
          if (!isNaN(r) && !isNaN(c)) from = { row: r, col: c };
        }
      }
      dragFrom = null;
      dragLib = null;
      if (!from) return;
      const spec = pageButtons()[from.row + ',' + from.col];
      if (!spec) { toast('这个格子是空的，没东西可存'); return; }
      await libraryAdd(spec);
    });
  }
}

function renderProfileSwitcherBar() {
  const bar = $('profileSwitcherBar');
  if (!bar || !cfg) return;
  if (!Array.isArray(cfg.profiles) || !cfg.profiles.length) {
    cfg.profiles = [
      { id: 'office', name: '办公模式', icon: '💼', accent: '#3b82f6', pages: cfg.pages, currentPage: cfg.currentPage },
      { id: 'stream', name: '直播模式', icon: '📡', accent: '#a855f7', pages: cfg.pages, currentPage: cfg.currentPage },
      { id: 'edit',   name: '剪辑模式', icon: '🎬', accent: '#f59e0b', pages: cfg.pages, currentPage: cfg.currentPage },
      { id: 'gaming', name: '游戏模式', icon: '🎮', accent: '#10b981', pages: cfg.pages, currentPage: cfg.currentPage },
    ];
    cfg.currentProfile = 'office';
  }
  bar.innerHTML = '';
  for (const prof of cfg.profiles) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `profile-pill-btn ${prof.id === cfg.currentProfile ? 'active' : ''}`;
    btn.style.setProperty('--prof-accent', prof.accent || '#2563eb');
    btn.textContent = `${prof.icon || '🗂️'} ${prof.name}`;
    btn.title = `一键切换整机模式至「${prof.name}」`;
    btn.onclick = async () => {
      if (prof.id === cfg.currentProfile) return;
      if (!DEMO && api.profileSwitch) {
        const res = await api.profileSwitch(prof.id);
        if (res && res.config) {
          cfg = res.config;
          selected = null;
          renderProfileSwitcherBar();
          renderPageTabs();
          buildGrid();
          renderInspector();
          await repaintAll(true);
          toast(`🗂️ 已切换整机模式：「${prof.name}」`);
        }
      } else {
        cfg.currentProfile = prof.id;
        renderProfileSwitcherBar();
        toast(`🗂️ 已切换至「${prof.name}」`);
      }
    };
    bar.appendChild(btn);
  }
  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.className = 'profile-pill-btn profile-pill-add';
  addBtn.textContent = '＋';
  addBtn.title = '新建或管理多套顶层配置文件 (Profiles)';
  addBtn.onclick = () => openProfileManagerModal();
  bar.appendChild(addBtn);
}

function openProfileManagerModal() {
  const wrap = document.createElement('div');
  wrap.className = 'modal';
  wrap.id = 'profileManagerModal';
  const profiles = (cfg && cfg.profiles) || [];
  wrap.innerHTML = `
    <div class="modalbox" style="width: 520px; max-width: 92vw; padding: 18px 20px;">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
        <h3 style="margin:0; font-size:15px;">🗂️ 多套顶层配置文件管理 (Profiles)</h3>
        <button type="button" class="ghost tiny" id="profModalClose">✕ 关闭</button>
      </div>
      <div style="font-size:12px; color:var(--muted); margin-bottom:10px;">每套 Profile 拥有独立的整机页面树，支持顶栏一键热切、托盘菜单切换与物理按键绑定。</div>
      <div id="profModalList" style="display:flex; flex-direction:column; gap:7px; max-height:220px; overflow-y:auto; margin-bottom:12px;">
        ${profiles.map(p => `
          <div style="display:flex; justify-content:space-between; align-items:center; padding:8px 11px; border:1px solid var(--line); border-radius:8px; background:var(--bg);">
            <span><b>${escapeHtml(p.icon || '🗂️')} ${escapeHtml(p.name)}</b> ${p.id === cfg.currentProfile ? '<span style="color:#10b981;font-size:11px;margin-left:6px;">● 当前激活</span>' : ''}</span>
            <div style="display:flex; gap:6px;">
              <button type="button" class="ghost tiny" data-prof-switch="${escapeAttr(p.id)}">切换</button>
              ${profiles.length > 1 ? `<button type="button" class="ghost tiny danger" data-prof-del="${escapeAttr(p.id)}">删除</button>` : ''}
            </div>
          </div>
        `).join('')}
      </div>
      <div style="border-top:1px solid var(--line); padding-top:12px; display:flex; gap:8px; align-items:center;">
        <input id="newProfNameInput" type="text" placeholder="新模式名称 (如：会议模式 / 设计模式)" style="flex:1;" />
        <select id="newProfPresetSel" style="width:140px;">
          <option value="clone">克隆当前页面树</option>
          <option value="stream">预设：直播模式</option>
          <option value="edit">预设：剪辑模式</option>
          <option value="gaming">预设：游戏模式</option>
        </select>
        <button type="button" class="primary tiny" id="btnAddProfConfirm">＋ 新建模式</button>
      </div>
    </div>
  `;
  document.body.appendChild(wrap);
  const close = () => wrap.remove();
  wrap.querySelector('#profModalClose').onclick = close;
  wrap.addEventListener('click', (e) => { if (e.target === wrap) close(); });
  wrap.querySelectorAll('[data-prof-switch]').forEach(b => {
    b.onclick = async () => {
      const id = b.dataset.profSwitch;
      if (!DEMO && api.profileSwitch) {
        const res = await api.profileSwitch(id);
        if (res && res.config) cfg = res.config;
      } else {
        cfg.currentProfile = id;
      }
      close();
      renderProfileSwitcherBar();
      renderPageTabs();
      buildGrid();
      renderInspector();
      await repaintAll(true);
    };
  });
  wrap.querySelectorAll('[data-prof-del]').forEach(b => {
    b.onclick = async () => {
      const id = b.dataset.profDel;
      if (!DEMO && api.profileDelete) {
        const res = await api.profileDelete(id);
        if (res && res.config) cfg = res.config;
      } else {
        cfg.profiles = (cfg.profiles || []).filter(p => p.id !== id);
      }
      close();
      renderProfileSwitcherBar();
      renderPageTabs();
      buildGrid();
      renderInspector();
      toast('已删除模式');
    };
  });
  wrap.querySelector('#btnAddProfConfirm').onclick = async () => {
    const name = wrap.querySelector('#newProfNameInput').value.trim() || '自定义模式';
    const presetVal = wrap.querySelector('#newProfPresetSel').value;
    if (!DEMO && api.profileCreate) {
      const res = await api.profileCreate({
        name,
        cloneCurrent: presetVal === 'clone',
        preset: presetVal !== 'clone' ? presetVal : '',
        switchNow: true,
      });
      if (res && res.config) cfg = res.config;
    } else {
      const id = 'prof_' + Date.now().toString(36);
      cfg.profiles.push({ id, name, icon: '🗂️', accent: '#3b82f6', pages: cfg.pages, currentPage: cfg.currentPage });
      cfg.currentProfile = id;
    }
    close();
    renderProfileSwitcherBar();
    renderPageTabs();
    buildGrid();
    renderInspector();
    await repaintAll(true);
    toast(`✅ 已创建并切换至模式：「${name}」`);
  };
}

function applyTheme() {
  document.body.dataset.theme = (cfg && cfg.theme === 'dark') ? 'dark' : 'light';
}

function showHelp() {
  const wrap = document.createElement('div');
  wrap.className = 'modal';
  wrap.innerHTML = `<div class="modalbox" style="width: 520px; max-width: 92vw;">
    <h3>📖 AKP153 控制台快速上手指南</h3>
    <ol style="margin:0 0 14px 18px;padding:0;font-size:13px;line-height:1.85">
      <li><b>极速拖拽配置</b>：把文件、程序、快捷方式、文件夹或网址直接拖进中央 15 键网格，系统会自动提取高清图标并根据策略配置<b>双态启动/切换</b>。</li>
      <li><b>所见即所得精修</b>：点击任意格子，在右侧属性检查器切换<b>「⚡ 动作」</b>与<b>「🎨 外观」</b>标签页，支持复合宏编排、WASAPI 毫秒级音量调节、免冲突快捷键点选、双态角标与实时字号/图标缩放。</li>
      <li><b>左侧页面树与自动切页</b>：左侧边栏管理多层级页面与子页（进入子页右下角自动生成返回键）；点击画布空白处可设置<b>整板无缝流光渐变</b>与<b>前台软件感知自动切页 (Auto-Profile)</b>。</li>
      <li><b>右侧 3 块状态副屏</b>：最右列 3 块 LCD 副屏可设为实时时钟、页码指示、CPU/内存负载仪表或声学音量监听表。</li>
      <li><b>底部按键库与页面快照</b>：调好的按键可一键「⭐ 入库」或拖入底部抽屉永久复用；点击「📸 页面快照」可备份或还原整页 18 格布局。</li>
    </ol>
    <div class="btnrow" style="justify-content: flex-end;"><button class="primary" id="_helpOk">知道了</button></div>
  </div>`;
  document.body.appendChild(wrap);
  const done = () => wrap.remove();
  wrap.querySelector('#_helpOk').onclick = done;
  wrap.addEventListener('click', (e) => { if (e.target === wrap) done(); });
}

// ----------------------------------------------------------------------- boot

function demoConfig() {
  return {
    version: 2, brightness: 80, idleSleepMinutes: 5, openAtLogin: true,
    currentPage: 'p1',
    pages: [
      {
        id: 'p1', name: '主页面', parent: null,
        buttons: {
          '0,0': { type: 'app', label: 'VS Code', target: 'C:\\Code.exe', args: '', icon: '', color: '#1565c0' },
          '0,1': { type: 'app', label: '终端', target: 'wt.exe', args: '', icon: '', color: '#37474f' },
          '0,2': { type: 'folder', label: '项目目录', target: 'E:\\项目', args: '', icon: '', color: '#ef6c00' },
          '0,3': { type: 'url', label: 'github.com', target: 'https://github.com', args: '', icon: '', color: '#0277bd' },
          '0,4': { type: 'ps1', label: '系统体检', target: 'Sys-Stats.ps1', args: '', icon: '', color: '#00838f' },
          '1,0': { type: 'command', label: '锁屏', target: 'rundll32.exe user32.dll,LockWorkStation', args: '', icon: '', color: '#c62828' },
          '1,1': { type: 'widget', widgetKind: 'gpu', action: 'refresh', label: 'GPU 监控', color: '#0f291e' },
          '1,2': { type: 'widget', widgetKind: 'pomodoro', action: 'pomodoro_toggle', label: '番茄钟', color: '#7f1d1d' },
          '1,3': { type: 'widget', widgetKind: 'media_now', action: 'media_play_pause', label: '正在播放', color: '#3b0764' },
          '2,0': { type: 'page', mode: 'goto', pageId: 'p3', label: '娱乐', args: '', icon: '', color: '#455a64' },
          '2,1': { type: 'page', mode: 'next', label: '下一页', args: '', icon: '', color: '#455a64' },
        },
        strips: {
          '0': { type: 'clock', label: '', color: '#263238' },
          '1': { type: 'net', label: '', color: '#0c1e35' },
          '2': { type: 'page', label: '', color: '#263238' },
        },
      },
      {
        id: 'p2', name: '媒体', parent: null,
        buttons: {
          '0,0': { type: 'app', label: '音乐', target: 'C:\\Music.exe', args: '', icon: '', color: '#6a1b9a' },
          '2,1': { type: 'page', mode: 'prev', label: '上一页', args: '', icon: '', color: '#455a64' },
        },
        strips: {
          '0': { type: 'sys', label: '', color: '#14202e' },
          '2': { type: 'page', label: '', color: '#263238' },
        },
      },
      {
        id: 'p3', name: '娱乐', parent: 'p1',
        buttons: {
          '0,0': { type: 'url', label: 'bilibili', target: 'https://bilibili.com', args: '', icon: '', color: '#0277bd' },
          '1,0': { type: 'page', mode: 'home', label: '主页面', args: '', icon: '', color: '#455a64' },
        },
        strips: { '2': { type: 'page', label: '', color: '#263238' } },
      },
    ],
    pageSnapshots: [
      {
        id: 'PS_1',
        name: '主页面（整页快照）',
        tags: ['整页', '常用'],
        savedAt: new Date().toISOString(),
        page: {
          buttons: {
            '0,0': { type: 'app', label: 'VS Code', target: 'C:\\Code.exe', color: '#1565c0' },
            '1,1': { type: 'url', label: 'github', target: 'https://github.com', color: '#0277bd' },
          },
          strips: { '0': { type: 'clock', label: '', color: '#263238' } },
        },
      },
    ],
    library: [
      { id: 'L1', name: 'VS Code', tags: ['开发', '常用'], spec: { type: 'app', label: 'VS Code', target: 'C:\\Code.exe', color: '#1565c0' } },
      { id: 'L2', name: '关屏', tags: ['系统'], spec: { type: 'ps1', label: '关屏', target: 'System-Action.ps1', color: '#1a237e' } },
      { id: 'L3', name: '区域截图', tags: ['常用'], spec: { type: 'command', label: '区域截图', target: 'ms-screenclip:', color: '#00838f' } },
      { id: 'L4', name: '下一页', tags: ['导航'], spec: { type: 'page', mode: 'next', label: '下一页', color: '#455a64' } },
    ],
  };
}

/** Wires the device/settings controls. Only meaningful with a real preload. */
function bindDevice() {
  $('brightness').value = cfg.brightness;
  $('brightVal').textContent = cfg.brightness;
  $('idle').value = String(cfg.idleSleepMinutes || 0);
  $('login').checked = !!cfg.openAtLogin;
  $('sleepMode').value = cfg.sleepMode || 'zeros-last';
  if ($('rotate')) $('rotate').value = cfg.rotate || 'ccw';

  let _brightTimer = null;
  $('brightness').addEventListener('input', (e) => {
    const v = +e.target.value;
    $('brightVal').textContent = v;
    cfg.brightness = v;
    clearTimeout(_brightTimer);
    _brightTimer = setTimeout(async () => {
      await saveConfig();
      await api.deviceBrightness(v);
    }, 60);
  });
  $('idle').addEventListener('change', async (e) => {
    cfg.idleSleepMinutes = +e.target.value;
    await saveConfig();
  });
  $('rotate').addEventListener('change', async (e) => {
    cfg.rotate = e.target.value;
    await saveConfig();
    await repaintAll(true);
  });
  $('sleepMode').addEventListener('change', async (e) => {
    cfg.sleepMode = e.target.value;
    await saveConfig();
    toast('休眠方式已切换，按一下「休眠屏幕」试试');
  });
  $('login').addEventListener('change', async (e) => {
    cfg.openAtLogin = e.target.checked;
    await saveConfig();
    await api.setLogin(e.target.checked);
  });

  $('reconnect').onclick = async () => { await api.deviceReconnect(); await repaintAll(true); };
  $('repaint').onclick = () => repaintAll(true);
  $('sleep').onclick = () => api.deviceSleep();
  $('wake').onclick = async () => { await api.deviceWake(); await repaintAll(true); };

  api.on('device:sleep-state', (payload) => {
    isDeviceAsleep = !!(payload && payload.asleep);
  });
  api.on('host:status', (s) => setStatus(s));
  api.on('device:repaint', (opts) => { isDeviceAsleep = false; repaintAll(opts && opts.force); });
  api.on('device:repaint-strips', () => { if (!isDeviceAsleep) repaintStrips(); });
  api.on('audio:state', (data) => updateVolumeState(data));
  const handleRealtimeTelemetryUpdate = async (data) => {
    if (!data) return;
    lastTelemetry = Object.assign({}, lastTelemetry, data);
    if (data.media_now && !data.media) lastTelemetry.media = data.media_now;
    if (!cfg || isDeviceAsleep) return;
    const buttons = pageButtons();
    const strips = effectiveStrips();
    const rotMode = $('rotate') ? $('rotate').value : (cfg.rotate || 'ccw');
    const batchJobs = [];

    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < KEY_COLS; c++) {
        const sp = buttons[`${r},${c}`];
        if (sp && sp.type === 'widget') {
          if (Number(sp.spanCols) > 1) {
            pushKey(r, c, false).catch(() => {});
          } else {
            batchJobs.push(
              paintKey(sp, 96, { row: r, col: c }).then(async (cnv) => ({
                row: r, col: c, data: await encodeCanvasToJpegB64(cnv, rotMode), force: false,
              }))
            );
          }
        }
      }
      const st = strips[String(r)];
      if (st && (WIDGET_KINDS.includes(st.type) || st.type === 'widget' || st.type === 'telemetry')) {
        batchJobs.push(
          buildStripCanvas(r).then(async (cnv) => ({
            row: r, col: 5, data: await encodeCanvasToJpegB64(cnv, rotMode), force: false,
          }))
        );
      }
    }
    if (isWindowVisible) refreshGrid();
    if (!DEMO && batchJobs.length > 0 && api.deviceBatchDraw) {
      Promise.all(batchJobs).then((items) => api.deviceBatchDraw(items)).catch(() => {});
    }
  };
  api.on('telemetry:update', handleRealtimeTelemetryUpdate);
  api.on('telemetry:data', handleRealtimeTelemetryUpdate);
  api.on('pomodoro:tick', (pomo) => handleRealtimeTelemetryUpdate({ pomodoro: pomo }));
  api.on('contextbar:changed', async (payload) => {
    activeRendererContextBar = (payload && payload.activeBar) || null;
    updateContextBarBadgeUI();
    refreshStripCells(lastSysStats);
    if (!DEMO && !isDeviceAsleep) await repaintStrips();
  });
  api.on('toast', (t) => toast(t && t.message));
  api.on('key:flash', (k) => {
    const cell = document.querySelector(`.cell[data-row="${k.row}"][data-col="${k.col}"]`);
    if (cell) {
      cell.classList.add('flash');
      clearTimeout(cell._flash);
      cell._flash = setTimeout(() => cell.classList.remove('flash'), 240);
    }
    // 关键修复：当按键标记了 skipBounce（双态按键/动态角标/静音切换/切页键）时，
    // 跳过异步 2 帧旧状态回弹动画，防止回弹动画第 2 帧在 67ms 后把新切换的硬件角标覆盖回旧状态！
    if (!DEMO && cfg && cfg.keyPressAnim !== false && k && !k.skipBounce && k.col < 5 && k.phase === 'down') {
      const sp = pageButtons()[`${k.row},${k.col}`];
      if (!sp || (!sp.toggleAction && !sp.badgeToggle && !(sp.type === 'volume' && sp.action === 'mute'))) {
        triggerHardwarePressBounce(k.row, k.col).catch(() => {});
      }
    }
  });
  api.on('key:unconfigured', (k) => flashUnconfigured(k.row, k.col));
  api.on('key:result', (payload) => {
    if (payload) flashKeyResult(payload.row, payload.col, payload.success, payload.text);
  });
  const onKeyStateMsg = async ({ pageId, row, col, activeState, windowSubState }) => {
    if (!cfg || !cfg.pages) return;
    const p = (pageId && cfg.pages.find((x) => x.id === pageId)) || curPage();
    const targetPid = (p && p.id) || pageId || (curPage() && curPage().id);
    setRuntimeCellState(targetPid, row, col, {
      activeState,
      windowSubState: windowSubState !== undefined ? windowSubState : 'stopped',
    });
    if (p && p.buttons) {
      const s = p.buttons[`${row},${col}`];
      if (s) {
        s._activeState = activeState;
        if (windowSubState !== undefined) s._windowSubState = windowSubState;
      }
    }
    const current = curPage();
    if (!pageId || (current && current.id === pageId) || (p && current && p.id === current.id)) {
      if (!DEMO && api.deviceStopAnim) {
        await api.deviceStopAnim({ row, col }).catch(() => {});
      }
      refreshSingleCell(row, col);
      await pushKey(row, col, true);
      if (selected && selected.row === row && selected.col === col) {
        renderInspector();
      }
    }
  };
  api.on('key:toggleState', onKeyStateMsg);
  api.on('device:key-state', onKeyStateMsg);
  api.on('hardware:model-changed', (payload) => {
    if (payload && payload.modelId && cfg) {
      cfg.hardwareModel = payload.modelId;
      applyHardwareModelToUI(payload.modelId);
    }
  });

  api.on('window:visibility', (st) => {
    isWindowVisible = !!(st && st.visible);
    if (isWindowVisible) refreshGrid();
  });

  api.on('profile:changed', async () => {
    cfg = await api.configLoad();
    syncRuntimeStoreToConfig(cfg);
    selected = null;
    renderProfileSwitcherBar();
    renderPageTabs();
    buildGrid();
    triggerGridTransition('zoom');
    renderInspector();
    await repaintAll(true);
  });

  api.on('page:changed', async (payload) => {
    cfg = await api.configLoad();
    if (payload && payload.runtimeStates && payload.pageId) {
      for (const [posKey, st] of Object.entries(payload.runtimeStates)) {
        const [r, c] = posKey.split(',').map(Number);
        setRuntimeCellState(payload.pageId, r, c, st);
      }
    }
    syncRuntimeStoreToConfig(cfg);
    selected = null;
    renderPageTabs();
    buildGrid();
    triggerGridTransition();
    renderInspector();
    await repaintAll(true);
  });

  api.on('config:external', async () => {
    cfg = await api.configLoad();
    syncRuntimeStoreToConfig(cfg);
    selected = null;
    applyTheme();
    $('theme').value = (cfg.theme === 'dark') ? 'dark' : 'light';
    renderPageTabs();
    buildGrid();
    renderInspector();
    renderLibrary();
    renderLibPanel();
    await repaintAll(true);
    toast('配置已从文件重新载入');
  });
}

function initWindowControls() {
  const winMin = $('winMin');
  const winMax = $('winMax');
  const winClose = $('winClose');
  const bar = $('bar');

  const updateMaxIcon = (maximized) => {
    if (winMax) {
      winMax.textContent = maximized ? '❐' : '▢';
      winMax.title = maximized ? '还原' : '最大化';
    }
  };

  if (!DEMO && window.api && api.windowMinimize) {
    if (winMin) winMin.onclick = () => api.windowMinimize();
    if (winMax) {
      winMax.onclick = async () => {
        const isMax = await api.windowMaximize();
        updateMaxIcon(isMax);
      };
    }
    if (winClose) winClose.onclick = () => api.windowClose();

    if (bar) {
      bar.addEventListener('dblclick', async (e) => {
        if (e.target.closest('button, input, select, .pill, #winControls, .actions')) return;
        const isMax = await api.windowMaximize();
        updateMaxIcon(isMax);
      });
    }

    api.on('window:max-changed', (d) => {
      updateMaxIcon(d && d.maximized);
    });

    if (api.windowIsMaximized) {
      api.windowIsMaximized().then(updateMaxIcon).catch(() => {});
    }
  } else {
    let demoMax = false;
    if (winMin) winMin.onclick = () => toast('最小化（预览模式）');
    if (winMax) {
      winMax.onclick = () => {
        demoMax = !demoMax;
        updateMaxIcon(demoMax);
        toast(demoMax ? '已最大化（预览模式）' : '已还原（预览模式）');
      };
    }
    if (winClose) winClose.onclick = () => toast('关闭并最小化到托盘（预览模式）');
  }
}

function updateContextBarBadgeUI() {
  const badge = $('contextBarBadge');
  if (!badge) return;
  const isAct = !!(activeRendererContextBar && cfg && cfg.contextBarEnabled !== false);
  badge.hidden = !isAct;
  if (isAct) {
    badge.textContent = `✨ ${activeRendererContextBar.name || '智能副屏'}`;
    badge.style.borderColor = activeRendererContextBar.accent || '#10b981';
    badge.style.color = activeRendererContextBar.accent || '#10b981';
  }
}

async function triggerHardwarePressBounce(row, col) {
  if (DEMO || !cfg || isDeviceAsleep || !api.deviceStartAnim) return;
  const sm = findSpanMasterCell(pageButtons(), row, col);
  if (sm) return;
  const spec = isBackCell(row, col) ? backSpec() : pageButtons()[`${row},${col}`];
  if (!spec || Number(spec.spanCols) > 1) return;
  const normalCanvas = await paintKey(spec, 96, { row, col });
  const shrinkCanvas = document.createElement('canvas');
  shrinkCanvas.width = shrinkCanvas.height = 96;
  const sctx = shrinkCanvas.getContext('2d');
  sctx.fillStyle = '#090d16';
  sctx.fillRect(0, 0, 96, 96);
  sctx.save();
  sctx.translate(48, 48);
  sctx.scale(0.88, 0.88);
  sctx.drawImage(normalCanvas, -48, -48);
  sctx.strokeStyle = 'rgba(56, 189, 248, 0.75)';
  sctx.lineWidth = 3;
  sctx.strokeRect(-46, -46, 92, 92);
  sctx.restore();

  const rotMode = $('rotate') ? $('rotate').value : (cfg.rotate || 'ccw');
  const [fShrink, fNormal] = await Promise.all([
    encodeCanvasToJpegB64(shrinkCanvas, rotMode),
    encodeCanvasToJpegB64(normalCanvas, rotMode),
  ]);
  await api.deviceStartAnim({
    row,
    col,
    frames: [fShrink, fNormal],
    fps: 15,
    loop: false,
  });
}

async function boot() {
  if (DEMO) {
    cfg = demoConfig();
  } else {
    cfg = await api.configLoad();
    if (!cfg.library) cfg.library = [];
    bindDevice();
  }

  if (!cfg.pageSnapshots) cfg.pageSnapshots = [];
  // 架构解耦自动迁移：将历史残留在 cfg.library 中的整页条目 (kind === 'page') 自动迁移至专属 cfg.pageSnapshots
  const legacyPages = (cfg.library || []).filter(isPageEntry);
  if (legacyPages.length > 0) {
    for (const lp of legacyPages) {
      cfg.pageSnapshots.push({
        id: lp.id && lp.id.startsWith('PS_') ? lp.id : ('PS_' + (lp.id || '').replace(/^L/, '')),
        name: lp.name || '迁移整页快照',
        tags: lp.tags || [],
        savedAt: lp.savedAt || new Date().toISOString(),
        page: lp.page || { buttons: {}, strips: {} }
      });
    }
    cfg.library = (cfg.library || []).filter(e => !isPageEntry(e));
    if (!DEMO && window.api && api.configSave) {
      await api.configSave(cfg).catch(() => {});
    }
  }

  buildGrid();
  bindShell();
  initInspTabs();
  initWindowControls();
  initContextMenu();
  initPageContextMenu();
  initIconPicker();
  initCropper();
  initKeyboardShortcuts();
  syncHistoryBaseline();
  updateUndoRedoUI();
  if (!DEMO && window.api && api.contextBarGet) {
    api.contextBarGet().then((st) => {
      if (st && st.activeBar) {
        activeRendererContextBar = st.activeBar;
        updateContextBarBadgeUI();
        refreshStripCells(lastSysStats);
      }
    }).catch(() => {});
  }
  applyTheme();
  setDrawer(false);
  if (!DEMO && window.api && api.pluginsList) {
    api.pluginsList().then((list) => {
      if (Array.isArray(list) && list.length) cachedPluginSchemas = list;
    }).catch(() => {});
  }
  renderProfileSwitcherBar();
  renderLibrary();
  renderPageTabs();
  renderInspector();

  // 启动即时获取系统物理音量并初始化状态
  if (!DEMO && window.api && api.audioGetVolume) {
    api.audioGetVolume().then((res) => {
      if (res && res.level !== undefined) {
        updateVolumeState(res);
      }
    }).catch(() => {});
  }

  // v0.10.6 多频自适应遥测调度器 + Dirty-Rect 批量硬件推流引擎 (支持 180ms 高帧率电平与 60s 低频天气)
  let _telemetryTickBusy = false;
  let _lastFullStatsFetchAt = 0;
  setInterval(async () => {
    if (DEMO || !cfg || isDeviceAsleep || _telemetryTickBusy) return;
    const now = Date.now();
    const page = curPage();
    if (!page) return;
    const strips = pageStrips();
    const buttons = pageButtons();
    const neededTypes = new Set();
    const neededPluginIds = new Set();
    const dueWidgets = [];

    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < KEY_COLS; c++) {
        const sp = buttons[`${r},${c}`];
        if (sp && sp.type === 'widget') {
          const wk = sp.widgetKind || 'gpu';
          const intervalMs = Math.max(180, Number(sp.refreshIntervalMs) || (wk === 'plugin' && sp.pluginId === 'audio_fader_meter' ? 200 : 2500));
          const cellKey = `${page.id}:${r},${c}`;
          const lastTick = widgetLastTickMap.get(cellKey) || 0;
          if (now - lastTick >= intervalMs) {
            widgetLastTickMap.set(cellKey, now);
            neededTypes.add(wk === 'composite' ? 'gpu' : wk);
            if (wk === 'composite') {
              neededTypes.add('net');
            }
            if (wk === 'plugin') neededPluginIds.add(sp.pluginId || 'uptime_greeting');
            dueWidgets.push({ row: r, col: c, spec: sp });
          }
        }
      }
    }

    const dueStripRows = [];
    if (now - _lastFullStatsFetchAt >= 2400) {
      _lastFullStatsFetchAt = now;
      for (const row of [0, 1, 2]) {
        const s = strips[String(row)];
        if (!s) continue;
        if (WIDGET_KINDS.includes(s.type) || s.type === 'widget') {
          const wk = s.widgetKind || s.type;
          neededTypes.add(wk);
          if (wk === 'plugin') neededPluginIds.add(s.pluginId || 'uptime_greeting');
          dueStripRows.push(row);
        } else if (['cpu', 'mem', 'sys', 'volume', 'clock'].includes(s.type)) {
          dueStripRows.push(row);
        }
      }
    }

    if (!dueWidgets.length && !dueStripRows.length) return;
    _telemetryTickBusy = true;
    try {
      const pluginConfigs = {};
      for (const { spec: sp } of dueWidgets) {
        if (sp && sp.widgetKind === 'plugin' && sp.pluginId && sp.pluginConfig) {
          pluginConfigs[sp.pluginId] = sp.pluginConfig;
        }
      }
      for (const row of dueStripRows) {
        const st = strips[String(row)];
        if (st && st.type === 'plugin' && st.pluginId && st.pluginConfig) {
          pluginConfigs[st.pluginId] = st.pluginConfig;
        }
      }

      let sharedStats = lastSysStats;
      if (api.systemStats) {
        const st = await api.systemStats({
          types: Array.from(neededTypes),
          pluginIds: Array.from(neededPluginIds),
          pluginConfigs,
        });
        if (st) {
          sharedStats = st;
          lastSysStats = Object.assign({}, lastSysStats, st);
          lastTelemetry = Object.assign({}, lastTelemetry, st);
          if (st.media_now && !st.media) lastTelemetry.media = st.media_now;
          if (st.volume !== undefined) {
            lastAudioState.volume = st.volume;
            lastAudioState.isMute = !!st.isMute;
          }
        }
      }

      const rotMode = $('rotate') ? $('rotate').value : (cfg.rotate || 'ccw');
      const batchJobs = [];

      for (const { row, col, spec: sp } of dueWidgets) {
        const spanCols = Math.max(1, Math.min(KEY_COLS - col, Number(sp.spanCols) || 1));
        for (let k = 0; k < spanCols; k++) {
          const targetCol = col + k;
          if (isBackCell(row, targetCol)) continue;
          batchJobs.push(
            paintKey(sp, 96, { row, col: targetCol }).then(async (c) => ({
              row,
              col: targetCol,
              data: await encodeCanvasToJpegB64(c, rotMode),
              force: false,
            }))
          );
        }
        if (isWindowVisible) refreshSingleCell(row, col);
      }

      for (const row of dueStripRows) {
        batchJobs.push(
          buildStripCanvas(row, sharedStats).then(async (c) => ({
            row,
            col: 5,
            data: await encodeCanvasToJpegB64(c, rotMode),
            force: false,
          }))
        );
      }
      if (isWindowVisible && dueStripRows.length > 0) {
        refreshStripCells(sharedStats);
      }

      if (batchJobs.length > 0 && api.deviceBatchDraw) {
        const items = await Promise.all(batchJobs);
        await api.deviceBatchDraw(items);
      }
    } catch (_) {
    } finally {
      _telemetryTickBusy = false;
    }
  }, 250);

  if (DEMO) {
    toast('预览模式 · 真机请运行「启动 AKP153 控制台.bat」');
    return;
  }

  setStatus(await api.hostStatus());
  await repaintAll();
}

function setStatus(s) {
  const el = $('status');
  if (!s) return;
  if (s.error === 'DEVICE_BUSY') {
    el.className = 'pill pill-err';
    el.textContent = '设备被 Companion 占用';
  } else if (s.error === 'DEVICE_LOST') {
    el.className = 'pill pill-warn';
    el.textContent = '设备已断开 · 自动重连中…';
  } else if (s.error) {
    el.className = 'pill pill-err';
    el.textContent = '设备异常：' + s.error;
  } else if (s.device) {
    const d = s.draws || {};
    const bad = d.fail || 0;
    el.className = 'pill ' + (bad ? 'pill-err' : 'pill-ok');
    el.textContent = bad ? `已连接 · 推图失败 ${bad}` : `已连接 · 推图 ${d.ok || 0}`;
    el.title = bad ? String(d.lastError || '') : '';
  } else {
    el.className = 'pill pill-warn';
    el.textContent = '连接中…';
  }
  const devEl = $('settingsDevStatus');
  if (devEl) {
    devEl.textContent = el.textContent;
    devEl.className = 'device-status-indicator' +
      (el.classList.contains('pill-err') ? ' err' : (el.classList.contains('pill-warn') ? ' warn' : ''));
  }
}

boot().catch((e) => toast('初始化失败：' + (e && e.message)));
