'use strict';
/**
 * Countdown Event & Off-Work Timer (countdown-event.plugin.js)
 * 支持今日下班倒计时、周末倒计时与自定义里程碑日程倒计时
 */
module.exports = {
  id: 'countdown_event',
  name: '重要日程 / 下班倒计时看板',
  category: '开发者工具',
  author: 'AKP153 Official',
  version: '0.12.0',
  description: '支持自定义下班时间或里程碑目标倒计时、进度条与鼓励标语，按击切换「今日下班 / 周末 / 自定义目标」',
  color: '#1e1b4b',
  defaultIntervalMs: 1000,
  configSchema: [
    { key: 'offWorkTime', label: '每日下班时间 (HH:mm)', type: 'text', default: '18:00' },
    { key: 'eventTitle', label: '自定义日程名称', type: 'text', default: '版本发版' },
    { key: 'eventDays', label: '自定义日程剩余天数', type: 'number', default: 7 },
  ],
  render({ now, config, state }) {
    const mode = ((state && state.mode) || 0) % 3;
    const d = now instanceof Date ? now : new Date();

    if (mode === 0) {
      const rawTime = String((config && config.offWorkTime) || '18:00').trim();
      const [th, tm] = rawTime.split(':').map((n) => parseInt(n, 10) || 0);
      const target = new Date(d);
      target.setHours(th || 18, tm || 0, 0, 0);
      const startWork = new Date(d);
      startWork.setHours(9, 0, 0, 0);

      const diffMs = target.getTime() - d.getTime();
      if (diffMs <= 0) {
        return {
          title: '今日下班',
          value: '已到点',
          sub: '享受美好生活 ✨',
          color: '#064e3b',
          badge: { text: 'FREE', color: '#10b981' },
          progress: 100,
        };
      }
      const totalMin = Math.ceil(diffMs / 60000);
      const hh = Math.floor(totalMin / 60);
      const mm = totalMin % 60;
      const spanMs = Math.max(3600000, target.getTime() - startWork.getTime());
      const elapsedPct = Math.max(0, Math.min(100, Math.round(((d.getTime() - startWork.getTime()) / spanMs) * 100)));
      return {
        title: `距离 ${rawTime}`,
        value: hh > 0 ? `${hh}h${String(mm).padStart(2, '0')}m` : `${mm} min`,
        sub: `今日进度 ${elapsedPct}%`,
        color: '#1e1b4b',
        badge: { text: '下班', color: '#6366f1' },
        progress: elapsedPct,
      };
    }

    if (mode === 1) {
      const day = d.getDay();
      if (day === 0 || day === 6) {
        return {
          title: '周末愉快',
          value: '休假中',
          sub: '放松充电时刻',
          color: '#064e3b',
          badge: { text: 'WKND', color: '#10b981' },
          progress: 100,
        };
      }
      const leftDays = 6 - day;
      const pct = Math.round((day / 5) * 100);
      return {
        title: '距离周末',
        value: `${leftDays} 天`,
        sub: `本周已过 ${pct}%`,
        color: '#172554',
        badge: { text: '周末', color: '#3b82f6' },
        progress: pct,
      };
    }

    const evTitle = String((config && config.eventTitle) || '版本发版').trim();
    const evDays = Math.max(0, Number(config && config.eventDays) || 7);
    return {
      title: evTitle,
      value: `D-${evDays}`,
      sub: '目标冲刺倒计时',
      color: '#3b0764',
      badge: { text: 'GOAL', color: '#a855f7' },
      progress: Math.max(10, Math.min(95, 100 - evDays * 5)),
    };
  },
  onPress({ state, emitState }) {
    const nextMode = (((state && state.mode) || 0) + 1) % 3;
    emitState({ mode: nextMode });
    return { ok: true, mode: nextMode };
  },
};
