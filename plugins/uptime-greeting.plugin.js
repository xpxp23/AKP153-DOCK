'use strict';
/**
 * 示例自定义动态组件插件：系统运行时长与问候看板 (v0.9 可视化画布增强版)
 *
 * 支持特性：
 * - sparkline: 迷你负载趋势折线
 * - progress: 内存健康度进度条
 * - badge: 右上角状态角标
 * - onPress: 按下物理按键切换展示维度（运行时长 / 内存占用 / CPU 负载）
 */
let modeIndex = 0;
const loadHistory = [22, 26, 24, 31, 28, 35, 30, 27, 33, 29, 25, 32];

module.exports = {
  id: 'uptime_greeting',
  aliases: ['uptime-greeting'],
  name: '系统运行时长看板',
  category: '系统监控',
  author: 'AKP153 Official',
  version: '0.9.0',
  description: '实时展示本机开机累计运行时长、时段问候语与系统负载折线，按击可切换维度',
  color: '#0f172a',

  async render({ os, now }) {
    const upSec = Math.floor(os.uptime());
    const hours = Math.floor(upSec / 3600);
    const mins = Math.floor((upSec % 3600) / 60);
    const h = now.getHours();
    const greet = h < 6 ? '🌙 夜深了' : h < 12 ? '☀️ 早安' : h < 18 ? '⚡ 下午好' : '🌆 晚上好';

    const totalMem = os.totalmem() || 1;
    const freeMem = os.freemem() || 0;
    const memPct = Math.max(5, Math.min(99, Math.round(((totalMem - freeMem) / totalMem) * 100)));

    loadHistory.push(memPct);
    if (loadHistory.length > 18) loadHistory.shift();

    if (modeIndex === 1) {
      const usedGb = ((totalMem - freeMem) / (1024 ** 3)).toFixed(1);
      const totalGb = (totalMem / (1024 ** 3)).toFixed(0);
      return {
        title: '🧠 内存实时状态',
        value: `${memPct}%`,
        sub: `已用 ${usedGb}G / ${totalGb}G`,
        subValue: `已用 ${usedGb}G / ${totalGb}G`,
        color: '#0f172a',
        accent: '#38bdf8',
        badge: { text: memPct > 85 ? '偏高' : '健康', bg: memPct > 85 ? '#ef4444' : '#10b981' },
        progress: memPct,
        sparkline: loadHistory.slice(),
      };
    }

    return {
      title: greet,
      value: `${hours}h ${mins}m`,
      sub: `内存 ${memPct}% · 连续运行`,
      subValue: `内存 ${memPct}% · 连续运行`,
      color: '#0f172a',
      accent: '#38bdf8',
      badge: { text: 'RUN', bg: '#0284c7' },
      progress: Math.min(100, Math.round((hours / 24) * 100)),
      sparkline: loadHistory.slice(),
    };
  },

  async onPress({ NativeInput }) {
    modeIndex = (modeIndex + 1) % 2;
    if (NativeInput && NativeInput.beep) {
      await NativeInput.beep(true).catch(() => {});
    }
    return { ok: true, action: 'plugin_uptime_pressed', modeIndex };
  },
};
