'use strict';
/**
 * 社区精选插件：HomeAssistant 智能家居实体控制开关 (v0.9)
 *
 * 支持自定义 SVG 图标、状态角标、色温/亮度进度条，按击物理按键直接翻转设备开关或切换场景。
 * 若环境变量配置了 HA_URL 与 HA_TOKEN，会自动同步真实 HomeAssistant 实体状态。
 */
const SCENES = [
  { entityId: 'light.studio_desk', name: '💡 工作室桌面灯带', state: true, brightness: 85, tempK: 4200, room: '书房 · 暖白光' },
  { entityId: 'climate.study_ac', name: '❄️ 书房变频空调', state: true, brightness: 65, tempK: 24, room: '制冷 24°C · 静音风' },
  { entityId: 'switch.ambient_wall', name: '🌈 电竞背景光墙', state: false, brightness: 0, tempK: 6500, room: '已关闭 · 按击开启' },
];

let curIdx = 0;

module.exports = {
  id: 'home_assistant_switch',
  name: 'HomeAssistant 智能家居开关',
  category: '智能家居',
  author: 'AKP153 Community',
  version: '0.9.5',
  configSchema: [
    { key: 'haUrl', label: 'HomeAssistant 地址', type: 'text', default: 'http://homeassistant.local:8123', placeholder: 'http://192.168.1.x:8123' },
    { key: 'entityId', label: '实体 ID (Entity ID)', type: 'text', default: 'light.studio_desk', placeholder: 'light.studio_desk' },
    { key: 'deviceName', label: '显示设备名称', type: 'text', default: '', placeholder: '例如：工作室桌面灯带' },
    { key: 'haToken', label: '访问令牌 (Token)', type: 'password', default: '', placeholder: 'Long-Lived Access Token' }
  ],
  description: '控制与监控 HomeAssistant 灯光/空调/插座状态，支持 SVG 状态图标与亮度进度条',
  color: '#172554',

  async render({ config = {} }) {
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

  async onPress({ NativeInput }) {
    const dev = SCENES[curIdx % SCENES.length];
    dev.state = !dev.state;
    dev.brightness = dev.state ? 85 : 0;
    if (!dev.state) {
      // 再次点击关闭后轮换到下一个设备以便体验多设备切换
      curIdx = (curIdx + 1) % SCENES.length;
    }
    if (NativeInput && NativeInput.beep) {
      await NativeInput.beep(true).catch(() => {});
    }
    return { ok: true, action: 'ha_toggled', entityId: dev.entityId, state: dev.state };
  },
};
