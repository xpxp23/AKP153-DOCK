'use strict';
/**
 * 官方深度集成插件：系统音频应用级混音器 (Per-App Volume Mixer v0.10.0)
 *
 * 基于 CoreAudio IAudioSessionManager2 / ISimpleAudioVolume / IAudioMeterInformation，
 * 支持单独控制某个进程（如 Discord、网易云音乐、QQ音乐、当前前台游戏 @foreground）的独立音量与静音，
 * 并实时渲染该进程的分贝峰值跳动条与音量百分比。
 */
let cycleIndex = 0;
let lastTargetProc = '@foreground';

module.exports = {
  id: 'app_volume_mixer',
  aliases: ['app_mixer', 'per_app_audio'],
  name: '应用级独立混音器 (Per-App Mixer)',
  category: '音频与直播',
  author: 'AKP153 Official',
  version: '0.10.0',
  description: '基于 CoreAudio IAudioSessionManager2 独立控制指定应用或当前前台游戏/音乐软件的音量与静音',
  color: '#0f172a',
  configSchema: [
    {
      key: 'targetApp',
      label: '目标进程 (填 @foreground 自动跟随前台应用)',
      type: 'text',
      default: '@foreground',
      placeholder: '@foreground 或 cloudmusic / discord / chrome',
    },
    {
      key: 'pressAction',
      label: '按键触发动作',
      type: 'select',
      default: 'toggle_mute',
      options: [
        { label: '🔇 切换该应用静音 (Toggle Mute)', value: 'toggle_mute' },
        { label: '🔊 该应用音量 +10% (Step Up)', value: 'vol_up' },
        { label: '🔉 该应用音量 -10% (Step Down)', value: 'vol_down' },
        { label: '🔄 轮换活动音频应用 (Cycle App)', value: 'cycle_app' },
      ],
    },
    {
      key: 'step',
      label: '音量步进幅度 (%)',
      type: 'number',
      default: 10,
      placeholder: '10',
    },
  ],

  async render({ config = {}, NativeInput }) {
    const target = String(config.targetApp || lastTargetProc || '@foreground').trim();
    let session = { ok: false, processName: target === '@foreground' ? '前台应用' : target, level: 80, isMute: false, peak: 15 };

    if (NativeInput && typeof NativeInput.getAppAudio === 'function') {
      const res = await NativeInput.getAppAudio(target).catch(() => null);
      if (res && res.ok) {
        session = res;
      } else if (typeof NativeInput.listAppAudioSessions === 'function') {
        const list = await NativeInput.listAppAudioSessions().catch(() => []);
        if (list.length > 0) {
          session = list[cycleIndex % list.length];
        }
      }
    }

    const appLabel = String(session.processName || 'App').replace(/\.exe$/i, '').slice(0, 10);
    const lvl = Math.max(0, Math.min(100, Number(session.level) || 0));
    const isMute = !!session.isMute;
    const peak = isMute ? 0 : Math.max(4, Number(session.peak) || 12);

    return {
      title: `🎚️ ${appLabel}`,
      value: isMute ? 'MUTE' : `${lvl}%`,
      sub: target === '@foreground' ? `前台混音 · 峰值 ${peak}%` : `独立混音 · 峰值 ${peak}%`,
      subValue: target === '@foreground' ? `前台混音 · 峰值 ${peak}%` : `独立混音 · 峰值 ${peak}%`,
      color: isMute ? '#3f1d2e' : '#0f172a',
      accent: isMute ? '#f43f5e' : '#06b6d4',
      progress: isMute ? 0 : lvl,
      badge: {
        text: isMute ? 'MUTE' : 'MIX',
        bg: isMute ? '#e11d48' : '#0891b2',
      },
      bars: [
        { label: 'VOL', value: isMute ? 0 : lvl, color: '#06b6d4' },
        { label: 'PEAK', value: peak, color: peak > 85 ? '#ef4444' : '#10b981' },
      ],
    };
  },

  async onPress({ config = {}, action, NativeInput, emitState }) {
    const act = action || config.pressAction || 'toggle_mute';
    const step = Math.max(1, Math.min(50, Number(config.step) || 10));
    let target = String(config.targetApp || '@foreground').trim();

    if (act === 'cycle_app' && NativeInput && typeof NativeInput.listAppAudioSessions === 'function') {
      const list = await NativeInput.listAppAudioSessions().catch(() => []);
      if (list.length > 0) {
        cycleIndex = (cycleIndex + 1) % list.length;
        lastTargetProc = list[cycleIndex].processName;
        target = lastTargetProc;
      }
      if (typeof emitState === 'function') emitState({ target });
      return { ok: true, action: 'app_audio_cycled', processName: target };
    }

    let res = { ok: false };
    if (NativeInput) {
      if (act === 'vol_up' && typeof NativeInput.stepAppAudioVolume === 'function') {
        res = await NativeInput.stepAppAudioVolume(target, step);
      } else if (act === 'vol_down' && typeof NativeInput.stepAppAudioVolume === 'function') {
        res = await NativeInput.stepAppAudioVolume(target, -step);
      } else if (typeof NativeInput.toggleAppAudioMute === 'function') {
        res = await NativeInput.toggleAppAudioMute(target, 'toggle');
      }
    }
    if (typeof emitState === 'function') emitState(res);
    return Object.assign({ ok: true, action: 'app_audio_' + act }, res);
  },
};
