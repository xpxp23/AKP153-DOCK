'use strict';
const path = require('path');
const config = require('../src/main/config.js');

const svgRec = 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#76b900"><path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4zM10 15c-1.66 0-3-1.34-3-3s1.34-3 3-3 3 1.34 3 3-1.34 3-3 3z"/></svg>');

const svgDvr = 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#76b900"><path d="M13 3a9 9 0 0 0-9 9H1l3.89 3.89.07.14L9 12H6c0-3.87 3.13-7 7-7s7 3.13 7 7-3.13 7-7 7c-1.93 0-3.68-.79-4.94-2.06l-1.42 1.42A8.954 8.954 0 0 0 13 21a9 9 0 0 0 0-18zm-1 5v5l4.28 2.54.72-1.21-3.5-2.08V8H12z"/></svg>');

const svgPanel = 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#76b900"><path d="M21 6H3c-1.1 0-2 .9-2 2v8c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2zm-10 7H8v3H6v-3H3v-2h3V8h2v3h3v2zm4.5 2c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zm4-3c-.83 0-1.5-.67-1.5-1.5S18.67 9 19.5 9s1.5.67 1.5 1.5-.67 1.5-1.5 1.5z"/></svg>');

const cfg = config.load();
cfg.library = cfg.library || [];

// 移除可能存在的旧项，避免重复
cfg.library = cfg.library.filter(item => !['N卡录制', '精彩瞬间', 'N卡面板'].includes(item.name));

const entries = [
  {
    id: 'L' + Date.now().toString(36) + 'nv3',
    name: 'N卡面板',
    tags: ['录屏', '工具'],
    savedAt: new Date().toISOString(),
    spec: {
      type: 'hotkey',
      label: 'N卡面板',
      target: 'Alt+Z',
      hotkey: 'Alt+Z',
      args: '',
      color: '#1a1a1a',
      customColor: true,
      icon: svgPanel,
      fontSize: 16,
      iconScale: 62,
      labelPos: 'bottom'
    }
  },
  {
    id: 'L' + Date.now().toString(36) + 'nv2',
    name: '精彩瞬间',
    tags: ['录屏', '游戏'],
    savedAt: new Date().toISOString(),
    spec: {
      type: 'hotkey',
      label: '精彩瞬间',
      target: 'Alt+F10',
      hotkey: 'Alt+F10',
      args: '',
      color: '#1a1a1a',
      customColor: true,
      badge: 'DVR',
      badgeBg: '#ff9800',
      badgeColor: '#ffffff',
      icon: svgDvr,
      fontSize: 16,
      iconScale: 62,
      labelPos: 'bottom'
    }
  },
  {
    id: 'L' + Date.now().toString(36) + 'nv1',
    name: 'N卡录制',
    tags: ['录屏', '游戏'],
    savedAt: new Date().toISOString(),
    spec: {
      type: 'hotkey',
      label: 'N卡录制',
      target: 'Alt+F9',
      hotkey: 'Alt+F9',
      args: '',
      color: '#1a1a1a',
      customColor: true,
      badge: 'REC',
      badgeBg: '#e53935',
      badgeColor: '#ffffff',
      icon: svgRec,
      fontSize: 16,
      iconScale: 62,
      labelPos: 'bottom'
    }
  }
];

// 插入按键库最前面
for (const entry of entries) {
  cfg.library.unshift(entry);
}

config.save(cfg);
console.log('✅ 成功将 N卡电竞录屏套件（3 颗按键）存入 AKP153 按键库！');
