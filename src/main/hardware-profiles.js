'use strict';
/**
 * Hardware Profile Adapter & Descriptor Engine (v0.11.0)
 *
 * 将不同型号的 Stream Dock 硬件布局、报文协议特征（单报文 push vs 双报文 button vs 旋钮编码器）、
 * 屏幕尺寸与过渡动效参数抽象为统一的 Hardware Descriptor。
 *
 * 核心价值：
 * 1. 彻底隔离 AKP153 等单报文设备（inputMode: 'push', data[10] 恒为 0，无物理抬起/长按报文）与支持按键抬起/旋钮设备的协议差异。
 * 2. 为驱动 UI 与底层 device-host 提供统一的坐标映射、画布尺寸、侧屏/旋钮能力描述与上下文切换过渡动效配置。
 */

const HARDWARE_PROFILES = {
  akp153: {
    id: 'akp153',
    name: 'AJAZZ AKP153 / 153E / 153R',
    vendorNames: ['AJAZZ', 'Mirabox', 'Keychron'],
    description: '15 键 LCD 主控网格 (5×3) + 右侧一体式 3 段 LCD 状态副屏',
    usbIds: [
      { vid: 0x0300, pid: 0x1010 },
      { vid: 0x0300, pid: 0x1020 },
      { vid: 0x0300, pid: 0x3004 },
      { vid: 0x5548, pid: 0x6670 },
      { vid: 0x6603, pid: 0x1005 },
    ],
    grid: {
      cols: 5,
      rows: 3,
      keyCount: 15,
      iconSize: 96,
      jpegQuality: 92,
      colRotate: 180,
    },
    sideStrip: {
      enabled: true,
      slots: 3,
      width: 85,
      totalHeight: 290,
      slotHeights: [96, 96, 98],
      slotYOffsets: [0, 96, 192],
      rotate: 180,
    },
    encoders: {
      enabled: false,
      count: 0,
      items: [],
    },
    protocol: {
      packetSize: 1024,
      inputMode: 'push',      // 单次触发报文，data[10] 恒为 0，无物理长按或抬起报文
      supportsHold: false,    // 硬件不支持长按
      supportsKeyUp: false,
      supportsEncoderEvent: false,
    },
    transitions: {
      supported: ['fade', 'slide-left', 'slide-right', 'zoom', 'none'],
      defaultPageTransition: 'slide-left',
      defaultProfileTransition: 'zoom',
      durationMs: 220,
    },
  },

  akp03: {
    id: 'akp03',
    name: 'AJAZZ AKP03 / 03E / 03R (旋钮版)',
    vendorNames: ['AJAZZ', 'Mirabox'],
    description: '6 键 LCD 网格 (3×2) + 3 颗物理无极旋钮编码器 (支持左旋/右旋/按压)',
    usbIds: [
      { vid: 0x0300, pid: 0x1011 },
      { vid: 0x0300, pid: 0x1030 },
      { vid: 0x5548, pid: 0x6672 },
    ],
    grid: {
      cols: 3,
      rows: 2,
      keyCount: 6,
      iconSize: 96,
      jpegQuality: 92,
      colRotate: 180,
    },
    sideStrip: {
      enabled: false,
      slots: 0,
      width: 0,
      totalHeight: 0,
      slotHeights: [],
      slotYOffsets: [],
      rotate: 0,
    },
    encoders: {
      enabled: true,
      count: 3,
      items: [
        { index: 0, id: 'knob_0', label: '左旋钮 (主音量/滚轮)', defaultAction: 'volume_master' },
        { index: 1, id: 'knob_1', label: '中旋钮 (应用混音/时间轴)', defaultAction: 'volume_app' },
        { index: 2, id: 'knob_2', label: '右旋钮 (页面/亮度调节)', defaultAction: 'brightness_step' },
      ],
    },
    protocol: {
      packetSize: 1024,
      inputMode: 'button',
      supportsHold: false,
      supportsKeyUp: true,
      supportsEncoderEvent: true,
      encoderMap: {
        // 典型 AKP03 旋钮事件编码映射
        0x50: { knob: 0, dir: 'ccw' },
        0x51: { knob: 0, dir: 'cw' },
        0x33: { knob: 0, dir: 'press' },
        0x60: { knob: 1, dir: 'ccw' },
        0x61: { knob: 1, dir: 'cw' },
        0x35: { knob: 1, dir: 'press' },
        0x90: { knob: 2, dir: 'ccw' },
        0x91: { knob: 2, dir: 'cw' },
        0x34: { knob: 2, dir: 'press' },
      },
    },
    transitions: {
      supported: ['fade', 'slide-left', 'slide-right', 'zoom', 'none'],
      defaultPageTransition: 'fade',
      defaultProfileTransition: 'zoom',
      durationMs: 200,
    },
  },

  streamdock_15: {
    id: 'streamdock_15',
    name: 'StreamDock 15 标准版 (5×3 纯键版)',
    vendorNames: ['Mirabox', 'Generic'],
    description: '标准 15 键 LCD 矩阵 (5×3)，无右侧条形副屏',
    usbIds: [
      { vid: 0x0300, pid: 0x1001 },
      { vid: 0x5548, pid: 0x0001 },
    ],
    grid: {
      cols: 5,
      rows: 3,
      keyCount: 15,
      iconSize: 96,
      jpegQuality: 92,
      colRotate: 180,
    },
    sideStrip: {
      enabled: false,
      slots: 0,
      width: 0,
      totalHeight: 0,
      slotHeights: [],
      slotYOffsets: [],
      rotate: 0,
    },
    encoders: {
      enabled: false,
      count: 0,
      items: [],
    },
    protocol: {
      packetSize: 1024,
      inputMode: 'push',
      supportsHold: false,
      supportsKeyUp: false,
      supportsEncoderEvent: false,
    },
    transitions: {
      supported: ['fade', 'slide-left', 'slide-right', 'zoom', 'none'],
      defaultPageTransition: 'slide-left',
      defaultProfileTransition: 'zoom',
      durationMs: 220,
    },
  },
};

function getHardwareProfile(profileId = 'akp153') {
  return HARDWARE_PROFILES[profileId] || HARDWARE_PROFILES.akp153;
}

function listHardwareProfiles() {
  return Object.values(HARDWARE_PROFILES).map((p) => ({
    id: p.id,
    name: p.name,
    description: p.description,
    grid: p.grid,
    sideStrip: p.sideStrip,
    encoders: p.encoders,
    protocol: {
      inputMode: p.protocol.inputMode,
      supportsHold: p.protocol.supportsHold,
      supportsEncoderEvent: p.protocol.supportsEncoderEvent,
    },
    transitions: p.transitions,
  }));
}

function detectHardwareProfileByUsb(vid, pid, productName = '') {
  const numVid = Number(vid) || 0;
  const numPid = Number(pid) || 0;
  const prodUpper = String(productName || '').toUpperCase();

  if (prodUpper.includes('AKP03') || prodUpper.includes('N3')) {
    return HARDWARE_PROFILES.akp03;
  }
  if (prodUpper.includes('AKP153') || prodUpper.includes('293S')) {
    return HARDWARE_PROFILES.akp153;
  }

  for (const prof of Object.values(HARDWARE_PROFILES)) {
    if (prof.usbIds.some((u) => u.vid === numVid && u.pid === numPid)) {
      return prof;
    }
  }
  return HARDWARE_PROFILES.akp153;
}

/**
 * 将物理设备 keyIndex (1..N) 与逻辑网格 (row, col) 互相转换
 * AKP153 采用列优先排布：col 0..4, 每列 3 行 (bottom-to-top 映射)
 */
function posToDeviceIndex(row, col, profileId = 'akp153') {
  const prof = getHardwareProfile(profileId);
  const rows = prof.grid.rows;
  return col * rows + (rows - row);
}

function deviceIndexToPos(index, profileId = 'akp153') {
  const prof = getHardwareProfile(profileId);
  const rows = prof.grid.rows;
  const idx0 = index - 1;
  const col = Math.floor(idx0 / rows);
  const row = (rows - 1) - (idx0 % rows);
  return { row, col };
}

/**
 * 统一解析来自 HID 设备的原始输入报文
 * - 对 AKP153 (inputMode: 'push')：收到 data[9] 立即触发一次完整按击事件，无任何长按等待或延迟定时器
 * - 对 AKP03 (supportsEncoderEvent: true)：额外识别旋钮编码器 CW/CCW/Press 事件
 */
function parseHardwareInputPacket(buf, profileId = 'akp153') {
  if (!buf || buf.length < 10) return null;
  let ascii = '';
  for (let i = 0; i < 9 && i < buf.length; i++) {
    const c = buf[i];
    if (c >= 32 && c < 127) ascii += String.fromCharCode(c);
  }
  if (!ascii.startsWith('ACK') && !ascii.startsWith('OK')) return null;

  const rawCode = buf[9];
  const stateByte = buf.length > 10 ? buf[10] : 0;
  if (!rawCode) return null;

  const prof = getHardwareProfile(profileId);

  // 1. 检查是否为旋钮编码器事件 (例如 AKP03)
  if (prof.protocol.supportsEncoderEvent && prof.protocol.encoderMap && prof.protocol.encoderMap[rawCode]) {
    const enc = prof.protocol.encoderMap[rawCode];
    return {
      eventType: 'encoder',
      knob: enc.knob,
      dir: enc.dir, // 'cw' | 'ccw' | 'press'
      rawCode,
      profileId: prof.id,
    };
  }

  // 2. 标准矩阵按键事件
  if (rawCode >= 1 && rawCode <= prof.grid.keyCount) {
    // 若硬件为 button 模式且发送了抬起报文 (stateByte === 0 且曾有按下态)，可按模式过滤
    // 对 AKP153 (inputMode === 'push')，data[10] 恒为 0，单条报文即代表一次按下触发
    const pos = deviceIndexToPos(rawCode, prof.id);
    return {
      eventType: 'key',
      index: rawCode,
      row: pos.row,
      col: pos.col,
      stateByte,
      inputMode: prof.protocol.inputMode,
      profileId: prof.id,
    };
  }

  return null;
}

module.exports = {
  HARDWARE_PROFILES,
  getHardwareProfile,
  listHardwareProfiles,
  detectHardwareProfileByUsb,
  posToDeviceIndex,
  deviceIndexToPos,
  parseHardwareInputPacket,
};
