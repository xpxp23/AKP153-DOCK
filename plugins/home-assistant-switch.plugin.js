'use strict';
/**
 * 深度集成插件：HomeAssistant / Webhook / MQTT 智能家居双向节点 (v0.10.5)
 *
 * 支持：
 * 1. Home Assistant REST API 双向状态拉取 (`/api/states/<entity_id>`) 与服务调用 (`/api/services/<domain>/toggle`)
 * 2. 自定义 Webhook / MQTT HTTP Bridge 节点触发与 JSON 状态字段解析
 * 3. 无网络或未配置服务器时提供平滑本地场景模拟
 */
const http = require('http');
const https = require('https');

const SCENES = [
  { entityId: 'light.studio_desk', name: '💡 工作室桌面灯带', state: true, brightness: 85, tempK: 4200, room: '书房 · 暖白光' },
  { entityId: 'climate.study_ac', name: '❄️ 书房变频空调', state: true, brightness: 65, tempK: 24, room: '制冷 24°C · 静音风' },
  { entityId: 'switch.ambient_wall', name: '🌈 电竞背景光墙', state: false, brightness: 0, tempK: 6500, room: '已关闭 · 按击开启' },
];

let curIdx = 0;
const remoteCache = new Map();

function httpJsonRequest(urlStr, method = 'GET', headers = {}, bodyObj = null, timeoutMs = 1800) {
  return new Promise((resolve) => {
    try {
      const u = new URL(urlStr);
      const mod = u.protocol === 'https:' ? https : http;
      const bodyBuf = bodyObj ? Buffer.from(JSON.stringify(bodyObj), 'utf8') : null;
      const reqHeaders = Object.assign({
        Accept: 'application/json',
        'Content-Type': 'application/json',
      }, headers);
      if (bodyBuf) reqHeaders['Content-Length'] = bodyBuf.length;

      const req = mod.request({
        hostname: u.hostname,
        port: u.port || (u.protocol === 'https:' ? 443 : 80),
        path: u.pathname + (u.search || ''),
        method,
        headers: reqHeaders,
        timeout: timeoutMs,
      }, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          try {
            const txt = Buffer.concat(chunks).toString('utf8');
            resolve({ status: res.statusCode, data: JSON.parse(txt) });
          } catch (_) {
            resolve({ status: res.statusCode, data: null });
          }
        });
      });
      req.on('error', () => resolve(null));
      req.on('timeout', () => { try { req.destroy(); } catch (_) {} resolve(null); });
      if (bodyBuf) req.write(bodyBuf);
      req.end();
    } catch (_) {
      resolve(null);
    }
  });
}

module.exports = {
  id: 'home_assistant_switch',
  name: 'HomeAssistant / Webhook 智能节点',
  category: '智能家居',
  author: 'AKP153 Community',
  version: '0.10.5',
  defaultIntervalMs: 5000,
  configSchema: [
    {
      key: 'nodeMode',
      label: '节点协议模式',
      type: 'select',
      default: 'ha',
      options: [
        { label: '🏠 Home Assistant 实体开关/传感器', value: 'ha' },
        { label: '🔗 Webhook / MQTT HTTP 桥接节点', value: 'webhook' },
      ],
    },
    { key: 'haUrl', label: '服务器/Webhook 地址', type: 'text', default: 'http://homeassistant.local:8123', placeholder: 'http://192.168.1.x:8123 或 Webhook URL' },
    { key: 'entityId', label: '实体 ID / MQTT Topic', type: 'text', default: 'light.studio_desk', placeholder: 'light.studio_desk 或 sensor.room_temp' },
    { key: 'deviceName', label: '显示设备名称', type: 'text', default: '', placeholder: '例如：工作室桌面灯带' },
    { key: 'haToken', label: '访问令牌 (Bearer Token)', type: 'password', default: '', placeholder: 'Long-Lived Access Token' },
  ],
  description: '双向同步 HomeAssistant 实体状态、传感器数值与 Webhook/MQTT 智能家居节点',
  color: '#172554',

  async render({ config = {} }) {
    const token = config.haToken || process.env.HA_TOKEN || '';
    const baseUrl = String(config.haUrl || process.env.HA_URL || '').trim().replace(/\/+$/, '');
    const entityId = String(config.entityId || 'light.studio_desk').trim();

    if (token && baseUrl && !baseUrl.includes('homeassistant.local')) {
      const cached = remoteCache.get(entityId);
      if (!cached || (Date.now() - cached.ts) > 4000) {
        const resp = await httpJsonRequest(
          `${baseUrl}/api/states/${encodeURIComponent(entityId)}`,
          'GET',
          { Authorization: `Bearer ${token}` }
        );
        if (resp && resp.status === 200 && resp.data) {
          remoteCache.set(entityId, { ts: Date.now(), data: resp.data });
        }
      }
      const remote = remoteCache.get(entityId);
      if (remote && remote.data) {
        const st = String(remote.data.state || 'off');
        const attrs = remote.data.attributes || {};
        const isOn = st === 'on' || st === 'playing' || st === 'cool' || st === 'heat';
        const unit = attrs.unit_of_measurement || '';
        const bri = attrs.brightness ? Math.round((Number(attrs.brightness) / 255) * 100) : (isOn ? 100 : 0);
        return {
          title: config.deviceName || attrs.friendly_name || entityId,
          value: unit ? `${st}${unit}` : (attrs.brightness ? `${bri}%` : st.toUpperCase()),
          sub: attrs.friendly_name || entityId,
          subValue: attrs.friendly_name || entityId,
          color: isOn ? '#1e1b4b' : '#0f172a',
          accent: isOn ? '#f59e0b' : '#64748b',
          badge: { text: isOn ? 'ON' : st.toUpperCase().slice(0, 4), bg: isOn ? '#10b981' : '#475569' },
          progress: bri,
        };
      }
    }

    const dev = SCENES.find(s => s.entityId === config.entityId) || SCENES[curIdx % SCENES.length];
    const isOn = dev.state;
    const svgIcon = isOn
      ? '<svg viewBox="0 0 24 24" fill="none" stroke="#fbbf24" stroke-width="2.2"><path d="M9 18h6M10 22h4M12 2a7 7 0 0 0-4 12.7V17h8v-2.3A7 7 0 0 0 12 2z"/></svg>'
      : '<svg viewBox="0 0 24 24" fill="none" stroke="#64748b" stroke-width="2"><path d="M9 18h6M10 22h4M12 2a7 7 0 0 0-4 12.7V17h8v-2.3A7 7 0 0 0 12 2z"/></svg>';

    return {
      title: config.deviceName || dev.name,
      value: isOn ? (dev.tempK < 100 ? `${dev.tempK}°C` : `${dev.brightness}%`) : 'OFF',
      sub: isOn ? dev.room : '待机中 · 按击唤醒',
      subValue: isOn ? dev.room : '待机中 · 按击唤醒',
      color: isOn ? '#1e1b4b' : '#0f172a',
      accent: isOn ? '#f59e0b' : '#64748b',
      badge: {
        text: isOn ? 'ON' : 'OFF',
        bg: isOn ? '#10b981' : '#475569',
      },
      progress: isOn ? dev.brightness : 0,
      svg: svgIcon,
    };
  },

  async onPress({ config = {}, NativeInput, emitState }) {
    const token = config.haToken || process.env.HA_TOKEN || '';
    const baseUrl = String(config.haUrl || process.env.HA_URL || '').trim().replace(/\/+$/, '');
    const entityId = String(config.entityId || 'light.studio_desk').trim();

    if (config.nodeMode === 'webhook' && baseUrl.startsWith('http')) {
      await httpJsonRequest(baseUrl, 'POST', token ? { Authorization: `Bearer ${token}` } : {}, {
        entityId,
        timestamp: Date.now(),
        source: 'akp153-dock',
      });
    } else if (token && baseUrl && !baseUrl.includes('homeassistant.local')) {
      const domain = entityId.includes('.') ? entityId.split('.')[0] : 'homeassistant';
      await httpJsonRequest(
        `${baseUrl}/api/services/${domain}/toggle`,
        'POST',
        { Authorization: `Bearer ${token}` },
        { entity_id: entityId }
      );
      remoteCache.delete(entityId);
    }

    const dev = SCENES.find(s => s.entityId === config.entityId) || SCENES[curIdx % SCENES.length];
    dev.state = !dev.state;
    dev.brightness = dev.state ? 85 : 0;
    if (!dev.state && !config.entityId) {
      curIdx = (curIdx + 1) % SCENES.length;
    }
    if (NativeInput && NativeInput.beep) {
      await NativeInput.beep(true).catch(() => {});
    }
    if (typeof emitState === 'function') emitState({ entityId: dev.entityId, state: dev.state });
    return { ok: true, action: 'ha_toggled', entityId: dev.entityId, state: dev.state };
  },
};
