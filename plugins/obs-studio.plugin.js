'use strict';
/**
 * 官方深度集成插件：OBS Studio WebSocket (v5) 双向导播与电平监控 (v0.10.6)
 *
 * 特性：
 * - 原生零依赖实现 RFC6455 WebSocket + OBS WebSocket v5 (SHA256 挑战认证、场景列表同步、推流/录制状态、一键切景)
 * - 实时融合 CoreAudio 麦克风/主输出分贝电平表 (dB Meter Bars)
 * - 当 OBS WebSocket 未开启时，无缝降级至窗口标题状态嗅探与快捷键控制
 * - 支持 dispose() 生命周期清理，热重载插件时自动关闭旧 Socket 与挂起请求
 */
const http = require('http');
const crypto = require('crypto');

const obsClientState = {
  connected: false,
  connecting: false,
  identified: false,
  lastConnectAttempt: 0,
  socket: null,
  url: '',
  password: '',
  streaming: false,
  recording: false,
  recordTimecode: '00:00',
  streamTimecode: '00:00',
  currentScene: '主画面',
  scenes: ['主画面', '游戏全屏', '桌面演示', '中场休息'],
  micMuted: false,
  pendingReqs: new Map(),
};

function encodeWsFrame(text) {
  const payload = Buffer.from(text, 'utf8');
  const len = payload.length;
  const maskKey = crypto.randomBytes(4);
  let header;
  if (len < 126) {
    header = Buffer.alloc(2);
    header[0] = 0x81; // FIN + text
    header[1] = 0x80 | len;
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 0x80 | 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81;
    header[1] = 0x80 | 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  const masked = Buffer.alloc(len);
  for (let i = 0; i < len; i++) {
    masked[i] = payload[i] ^ maskKey[i & 3];
  }
  return Buffer.concat([header, maskKey, masked]);
}

function sendObsWsJson(obj) {
  if (!obsClientState.socket || obsClientState.socket.destroyed) return false;
  try {
    obsClientState.socket.write(encodeWsFrame(JSON.stringify(obj)));
    return true;
  } catch (_) {
    return false;
  }
}

function sendObsRequest(requestType, requestData = {}, timeoutMs = 1200) {
  if (!obsClientState.identified) return Promise.resolve(null);
  const requestId = 'req_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6);
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      obsClientState.pendingReqs.delete(requestId);
      resolve(null);
    }, timeoutMs);
    obsClientState.pendingReqs.set(requestId, { resolve, timer });
    const ok = sendObsWsJson({
      op: 6,
      d: { requestType, requestId, requestData },
    });
    if (!ok) {
      clearTimeout(timer);
      obsClientState.pendingReqs.delete(requestId);
      resolve(null);
    }
  });
}

function handleObsMessage(msg, password, emitState) {
  if (!msg || typeof msg.op !== 'number') return;
  const d = msg.d || {};
  if (msg.op === 0) {
    let authentication = undefined;
    if (d.authentication && d.authentication.challenge && d.authentication.salt) {
      const secret = crypto.createHash('sha256')
        .update(String(password || '') + d.authentication.salt)
        .digest('base64');
      authentication = crypto.createHash('sha256')
        .update(secret + d.authentication.challenge)
        .digest('base64');
    }
    sendObsWsJson({
      op: 1,
      d: Object.assign({ rpcVersion: 1 }, authentication ? { authentication } : {}),
    });
  } else if (msg.op === 2) {
    obsClientState.identified = true;
    sendObsRequest('GetSceneList').then((res) => {
      if (res && res.responseData) {
        if (res.responseData.currentProgramSceneName) {
          obsClientState.currentScene = res.responseData.currentProgramSceneName;
        }
        if (Array.isArray(res.responseData.scenes) && res.responseData.scenes.length) {
          obsClientState.scenes = res.responseData.scenes.map((s) => s.sceneName).filter(Boolean);
        }
      }
    });
    sendObsRequest('GetStreamStatus').then((res) => {
      if (res && res.responseData) {
        obsClientState.streaming = !!res.responseData.outputActive;
        obsClientState.streamTimecode = String(res.responseData.outputTimecode || '00:00').slice(0, 8);
      }
    });
    sendObsRequest('GetRecordStatus').then((res) => {
      if (res && res.responseData) {
        obsClientState.recording = !!res.responseData.outputActive;
        obsClientState.recordTimecode = String(res.responseData.outputTimecode || '00:00').slice(0, 8);
      }
    });
    if (typeof emitState === 'function') emitState({ connected: true });
  } else if (msg.op === 5) {
    const evType = d.eventType;
    const evData = d.eventData || {};
    if (evType === 'CurrentProgramSceneChanged' && evData.sceneName) {
      obsClientState.currentScene = evData.sceneName;
    } else if (evType === 'StreamStateChanged') {
      obsClientState.streaming = !!evData.outputActive;
    } else if (evType === 'RecordStateChanged') {
      obsClientState.recording = !!evData.outputActive;
    }
    if (typeof emitState === 'function') emitState({ event: evType });
  } else if (msg.op === 7) {
    const reqId = d.requestId;
    const pending = obsClientState.pendingReqs.get(reqId);
    if (pending) {
      clearTimeout(pending.timer);
      obsClientState.pendingReqs.delete(reqId);
      pending.resolve(d);
    }
  }
}

function disposeObsConnection() {
  for (const pending of obsClientState.pendingReqs.values()) {
    if (pending && pending.timer) clearTimeout(pending.timer);
    if (pending && typeof pending.resolve === 'function') pending.resolve(null);
  }
  obsClientState.pendingReqs.clear();
  if (obsClientState.socket) {
    try {
      obsClientState.socket.removeAllListeners();
      obsClientState.socket.destroy();
    } catch (_) {}
    obsClientState.socket = null;
  }
  obsClientState.connected = false;
  obsClientState.connecting = false;
  obsClientState.identified = false;
}

function ensureObsConnection(wsUrl = 'ws://127.0.0.1:4455', password = '', emitState = null) {
  const now = Date.now();
  if (obsClientState.connected && obsClientState.url === wsUrl) return;
  if (obsClientState.connecting || (now - obsClientState.lastConnectAttempt) < 4000) return;
  if (obsClientState.socket && obsClientState.url !== wsUrl) {
    disposeObsConnection();
  }
  obsClientState.lastConnectAttempt = now;
  obsClientState.connecting = true;
  obsClientState.url = wsUrl;
  obsClientState.password = password;

  try {
    const parsed = new URL(wsUrl.replace(/^ws:/i, 'http:').replace(/^wss:/i, 'https:'));
    const key = crypto.randomBytes(16).toString('base64');
    const req = http.request({
      hostname: parsed.hostname || '127.0.0.1',
      port: Number(parsed.port) || 4455,
      path: parsed.pathname || '/',
      method: 'GET',
      timeout: 1200,
      headers: {
        Connection: 'Upgrade',
        Upgrade: 'websocket',
        'Sec-WebSocket-Version': '13',
        'Sec-WebSocket-Key': key,
      },
    });

    req.on('upgrade', (res, socket) => {
      obsClientState.connecting = false;
      obsClientState.connected = true;
      obsClientState.socket = socket;
      let rxBuf = Buffer.alloc(0);

      socket.on('data', (chunk) => {
        rxBuf = Buffer.concat([rxBuf, chunk]);
        while (rxBuf.length >= 2) {
          const b0 = rxBuf[0];
          const b1 = rxBuf[1];
          const opcode = b0 & 0x0f;
          let payloadLen = b1 & 0x7f;
          let offset = 2;
          if (payloadLen === 126) {
            if (rxBuf.length < 4) return;
            payloadLen = rxBuf.readUInt16BE(2);
            offset = 4;
          } else if (payloadLen === 127) {
            if (rxBuf.length < 10) return;
            payloadLen = Number(rxBuf.readBigUInt64BE(2));
            offset = 10;
          }
          if (rxBuf.length < offset + payloadLen) return;
          const frameData = rxBuf.subarray(offset, offset + payloadLen);
          rxBuf = rxBuf.subarray(offset + payloadLen);
          if (opcode === 0x08) {
            socket.destroy();
            return;
          }
          if (opcode === 0x01) {
            try {
              const msg = JSON.parse(frameData.toString('utf8'));
              handleObsMessage(msg, password, emitState);
            } catch (_) {}
          }
        }
      });

      const cleanup = () => {
        obsClientState.connected = false;
        obsClientState.connecting = false;
        obsClientState.identified = false;
        obsClientState.socket = null;
      };
      socket.on('close', cleanup);
      socket.on('error', cleanup);
    });

    req.on('error', () => {
      obsClientState.connecting = false;
      obsClientState.connected = false;
    });
    req.on('timeout', () => {
      obsClientState.connecting = false;
      try { req.destroy(); } catch (_) {}
    });
    req.end();
  } catch (_) {
    obsClientState.connecting = false;
  }
}

module.exports = {
  id: 'obs_studio',
  aliases: ['obs', 'obs-websocket'],
  name: 'OBS Studio WebSocket v5 导播台',
  category: '音频与直播',
  author: 'AKP153 Official',
  version: '0.10.6',
  defaultIntervalMs: 400,
  description: '基于 OBS WebSocket v5 协议实时显示录制/推流状态、当前场景高亮、麦克风分贝表与一键切景/启停录制',
  color: '#1e1b4b',
  configSchema: [
    {
      key: 'obsAction',
      label: '按键触发动作',
      type: 'select',
      default: 'toggle_record',
      options: [
        { label: '⏺️ 启停录制 (Toggle Record)', value: 'toggle_record' },
        { label: '🔴 启停推流 (Toggle Stream)', value: 'toggle_stream' },
        { label: '🎬 切换指定/下一场景 (Switch Scene)', value: 'switch_scene' },
        { label: '🎙️ 麦克风静音切换 (Toggle Mic)', value: 'toggle_mic' },
      ],
    },
    { key: 'sceneName', label: '目标场景名 (留空则循环切景)', type: 'text', default: '', placeholder: '例如：游戏全屏 / 主画面' },
    { key: 'wsUrl', label: 'OBS WebSocket v5 地址', type: 'text', default: 'ws://127.0.0.1:4455', placeholder: 'ws://127.0.0.1:4455' },
    { key: 'password', label: 'WebSocket 密码 (未设可留空)', type: 'password', default: '', placeholder: 'OBS WebSocket Password' },
  ],

  dispose() {
    disposeObsConnection();
  },

  async render({ config = {}, NativeInput, emitState }) {
    ensureObsConnection(config.wsUrl || 'ws://127.0.0.1:4455', config.password || '', emitState);

    let peak = { masterPeak: 18, micPeak: 12 };
    if (NativeInput && typeof NativeInput.getAudioPeak === 'function') {
      const pk = await NativeInput.getAudioPeak().catch(() => null);
      if (pk && pk.ok) peak = pk;
    }

    if (obsClientState.identified) {
      sendObsRequest('GetRecordStatus').then((r) => {
        if (r && r.responseData) {
          obsClientState.recording = !!r.responseData.outputActive;
          obsClientState.recordTimecode = String(r.responseData.outputTimecode || '00:00').slice(0, 8);
        }
      });
    } else if (NativeInput && typeof NativeInput.getProcessWindowTitles === 'function') {
      const titles = await NativeInput.getProcessWindowTitles(['obs64', 'obs32']).catch(() => ({}));
      const obsTitle = titles.obs64 || titles.obs32 || '';
      if (obsTitle) {
        obsClientState.streaming = /推流|直播|streaming|\[live\]/i.test(obsTitle);
        obsClientState.recording = /录制|recording|\[rec\]/i.test(obsTitle);
        const mScene = obsTitle.match(/(?:场景|Scenes?)\s*[:：]\s*([^\-\r\n]+)/i);
        if (mScene && mScene[1]) obsClientState.currentScene = mScene[1].trim();
      }
    }

    const act = config.obsAction || 'toggle_record';
    const isTargetScene = config.sceneName && obsClientState.currentScene === config.sceneName;
    const isLive = obsClientState.streaming;
    const isRec = obsClientState.recording;

    let badgeText = obsClientState.identified ? 'WS v5' : 'READY';
    let badgeBg = '#475569';
    if (isLive) { badgeText = 'LIVE'; badgeBg = '#ef4444'; }
    else if (isRec) { badgeText = 'REC'; badgeBg = '#f97316'; }
    else if (act === 'switch_scene' && isTargetScene) { badgeText = 'PGM'; badgeBg = '#10b981'; }

    const micVal = obsClientState.micMuted ? 0 : Math.max(6, peak.micPeak || 14);
    const outVal = Math.max(8, peak.masterPeak || 22);

    return {
      title: act === 'switch_scene' ? (config.sceneName || obsClientState.currentScene) : 'OBS 导播台',
      value: isLive ? 'LIVE' : (isRec ? (obsClientState.recordTimecode || 'REC') : obsClientState.currentScene.slice(0, 6)),
      sub: `景:${obsClientState.currentScene.slice(0, 6)} · 麦:${obsClientState.micMuted ? '静音' : (micVal + 'dB')}`,
      subValue: `景:${obsClientState.currentScene.slice(0, 6)} · 麦:${obsClientState.micMuted ? '静音' : (micVal + 'dB')}`,
      color: isLive ? '#450a0a' : (isRec ? '#431407' : (isTargetScene ? '#064e3b' : '#1e1b4b')),
      accent: isLive ? '#ef4444' : (isRec ? '#f97316' : '#38bdf8'),
      badge: { text: badgeText, bg: badgeBg },
      bars: [
        { label: 'MIC', value: micVal, color: obsClientState.micMuted ? '#64748b' : (micVal > 80 ? '#ef4444' : '#10b981') },
        { label: 'PGM', value: outVal, color: '#38bdf8' },
      ],
    };
  },

  async onPress({ config = {}, action, NativeInput, emitState }) {
    const act = action || config.obsAction || 'toggle_record';
    if (obsClientState.identified) {
      if (act === 'toggle_stream') {
        await sendObsRequest('ToggleStream');
        obsClientState.streaming = !obsClientState.streaming;
      } else if (act === 'toggle_record') {
        await sendObsRequest('ToggleRecord');
        obsClientState.recording = !obsClientState.recording;
      } else if (act === 'switch_scene') {
        let targetScene = String(config.sceneName || '').trim();
        if (!targetScene && obsClientState.scenes.length > 0) {
          const idx = obsClientState.scenes.indexOf(obsClientState.currentScene);
          targetScene = obsClientState.scenes[(idx + 1) % obsClientState.scenes.length];
        }
        if (targetScene) {
          await sendObsRequest('SetCurrentProgramScene', { sceneName: targetScene });
          obsClientState.currentScene = targetScene;
        }
      } else if (act === 'toggle_mic') {
        obsClientState.micMuted = !obsClientState.micMuted;
        await sendObsRequest('ToggleInputMute', { inputName: '麦克风/Aux' });
        await sendObsRequest('ToggleInputMute', { inputName: 'Mic/Aux' });
      }
    } else {
      if (act === 'toggle_stream') {
        obsClientState.streaming = !obsClientState.streaming;
        if (NativeInput && NativeInput.sendHotkey) await NativeInput.sendHotkey('Ctrl+Alt+S');
      } else if (act === 'toggle_record') {
        obsClientState.recording = !obsClientState.recording;
        if (NativeInput && NativeInput.sendHotkey) await NativeInput.sendHotkey('Alt+F9');
      } else if (act === 'switch_scene') {
        const scenes = obsClientState.scenes;
        const idx = scenes.indexOf(obsClientState.currentScene);
        obsClientState.currentScene = config.sceneName || scenes[(idx + 1) % scenes.length];
        if (NativeInput && NativeInput.sendHotkey) await NativeInput.sendHotkey('Ctrl+Alt+F1');
      } else if (act === 'toggle_mic') {
        obsClientState.micMuted = !obsClientState.micMuted;
      }
    }
    if (typeof emitState === 'function') emitState({ updatedAt: Date.now() });
    return {
      ok: true,
      action: 'obs_' + act,
      scene: obsClientState.currentScene,
      streaming: obsClientState.streaming,
      recording: obsClientState.recording,
    };
  },
};
