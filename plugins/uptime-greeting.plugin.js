'use strict';
/**
 * 示例自定义动态组件插件：系统运行时长与问候看板
 *
 * 只需在 plugins/ 目录下放入 *.plugin.js，AKP153 控制台即可自动识别并供按键或副屏绑定。
 */
module.exports = {
  id: 'uptime_greeting',
  name: '系统运行时长看板',
  description: '实时展示本机开机累计运行时长与时段问候语',
  color: '#0f172a',

  async render({ os, now }) {
    const upSec = Math.floor(os.uptime());
    const hours = Math.floor(upSec / 3600);
    const mins = Math.floor((upSec % 3600) / 60);
    const h = now.getHours();
    const greet = h < 6 ? '🌙 夜深了' : h < 12 ? '☀️ 早安' : h < 18 ? '⚡ 下午好' : '🌆 晚上好';
    return {
      title: greet,
      value: `${hours}h ${mins}m`,
      sub: '本机已连续运行',
      accent: '#38bdf8',
    };
  },

  async onPress({ NativeInput }) {
    await NativeInput.beep(true);
    return { ok: true, action: 'plugin_uptime_pressed' };
  },
};
