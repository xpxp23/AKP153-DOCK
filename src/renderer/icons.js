'use strict';

/**
 * AKP153 内置精选轻量现代矢量 SVG 图标库
 * 包含常用硬件控制、多媒体、办公、系统、开发与符号工具。
 * 纯内联 SVG，无任何外部网络依赖，单机秒开，高清无损。
 */

const BUILTIN_ICONS = [
  // ---------------------------------------------------- 多媒体 / 影音控制
  {
    category: 'media',
    name: '播放',
    svg: '<svg viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>'
  },
  {
    category: 'media',
    name: '暂停',
    svg: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect></svg>'
  },
  {
    category: 'media',
    name: '播放/暂停',
    svg: '<svg viewBox="0 0 24 24" fill="currentColor"><polygon points="4 4 13 12 4 20 4 4"></polygon><rect x="15" y="4" width="4" height="16"></rect></svg>'
  },
  {
    category: 'media',
    name: '上一曲',
    svg: '<svg viewBox="0 0 24 24" fill="currentColor"><polygon points="19 20 9 12 19 4 19 20"></polygon><line x1="5" y1="19" x2="5" y2="5" stroke="currentColor" stroke-width="3" stroke-linecap="round"></line></svg>'
  },
  {
    category: 'media',
    name: '下一曲',
    svg: '<svg viewBox="0 0 24 24" fill="currentColor"><polygon points="5 4 15 12 5 20 5 4"></polygon><line x1="19" y1="5" x2="19" y2="19" stroke="currentColor" stroke-width="3" stroke-linecap="round"></line></svg>'
  },
  {
    category: 'media',
    name: '静音',
    svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><line x1="23" y1="9" x2="17" y2="15"></line><line x1="17" y1="9" x2="23" y2="15"></line></svg>'
  },
  {
    category: 'media',
    name: '音量+',
    svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path></svg>'
  },
  {
    category: 'media',
    name: '音量-',
    svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path></svg>'
  },
  {
    category: 'media',
    name: '麦克风',
    svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path><path d="M19 10v2a7 7 0 0 1-14 0v-2"></path><line x1="12" y1="19" x2="12" y2="23"></line><line x1="8" y1="23" x2="16" y2="23"></line></svg>'
  },
  {
    category: 'media',
    name: '相机/拍照',
    svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path><circle cx="12" cy="13" r="4"></circle></svg>'
  },
  {
    category: 'media',
    name: '耳机',
    svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 18v-6a9 9 0 0 1 18 0v6"></path><path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"></path></svg>'
  },

  // ---------------------------------------------------- 系统 / 硬件
  {
    category: 'system',
    name: '电源/关机',
    svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18.36 6.64a9 9 0 1 1-12.73 0"></path><line x1="12" y1="2" x2="12" y2="12"></line></svg>'
  },
  {
    category: 'system',
    name: '锁屏',
    svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>'
  },
  {
    category: 'system',
    name: '解锁',
    svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 9.9-1"></path></svg>'
  },
  {
    category: 'system',
    name: '设置',
    svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>'
  },
  {
    category: 'system',
    name: '刷新',
    svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"></polyline><polyline points="1 20 1 14 7 14"></polyline><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg>'
  },
  {
    category: 'system',
    name: '显示器/桌面',
    svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect><line x1="8" y1="21" x2="16" y2="21"></line><line x1="12" y1="17" x2="12" y2="21"></line></svg>'
  },
  {
    category: 'system',
    name: '任务管理',
    svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"></rect><rect x="14" y="3" width="7" height="7"></rect><rect x="14" y="14" width="7" height="7"></rect><rect x="3" y="14" width="7" height="7"></rect></svg>'
  },
  {
    category: 'system',
    name: '终端/命令行',
    svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 17 10 11 4 5"></polyline><line x1="12" y1="19" x2="20" y2="19"></line></svg>'
  },
  {
    category: 'system',
    name: '硬件/芯片',
    svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="16" rx="2" ry="2"></rect><rect x="9" y="9" width="6" height="6"></rect><line x1="9" y1="1" x2="9" y2="4"></line><line x1="15" y1="1" x2="15" y2="4"></line><line x1="9" y1="20" x2="9" y2="23"></line><line x1="15" y1="20" x2="15" y2="23"></line><line x1="20" y1="9" x2="23" y2="9"></line><line x1="20" y1="14" x2="23" y2="14"></line><line x1="1" y1="9" x2="4" y2="9"></line><line x1="1" y1="14" x2="4" y2="14"></line></svg>'
  },

  // ---------------------------------------------------- 工具 / 常用
  {
    category: 'tools',
    name: '截图/裁剪',
    svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="6" r="3"></circle><circle cx="6" cy="18" r="3"></circle><line x1="20" y1="4" x2="8.12" y2="15.88"></line><line x1="14.47" y1="14.48" x2="20" y2="20"></line><line x1="8.12" y1="8.12" x2="12" y2="12"></line></svg>'
  },
  {
    category: 'tools',
    name: '时钟/闹钟',
    svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>'
  },
  {
    category: 'tools',
    name: '文件夹',
    svg: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>'
  },
  {
    category: 'tools',
    name: '文件/文档',
    svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>'
  },
  {
    category: 'tools',
    name: '计算器',
    svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="2" width="16" height="20" rx="2"></rect><line x1="8" y1="6" x2="16" y2="6"></line><line x1="16" y1="14" x2="16" y2="18"></line><path d="M16 10h.01M12 10h.01M8 10h.01M12 14h.01M8 14h.01M12 18h.01M8 18h.01"></path></svg>'
  },
  {
    category: 'tools',
    name: '搜索',
    svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>'
  },
  {
    category: 'tools',
    name: '垃圾桶/删除',
    svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>'
  },
  {
    category: 'tools',
    name: '日历',
    svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>'
  },
  {
    category: 'tools',
    name: '二维码/扫码',
    svg: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M2 2h8v8H2V2zm2 2v4h4V4H4zm1 1h2v2H5V5zm9-3h8v8h-8V2zm2 2v4h4V4h-4zm1 1h2v2h-2V5zM2 14h8v8H2v-8zm2 2v4h4v-4H4zm1 1h2v2H5v-2zm9-3h2v2h-2v-2zm4 0h2v2h-2v-2zm-4 4h2v2h-2v-2zm4 0h2v2h-2v-2zm-2-2h2v2h-2v-2zm4 2h2v4h-2v-4zm-4 2h2v2h-2v-2zm-2 2h2v2h-2v-2z"/></svg>'
  },

  // ---------------------------------------------------- 开发 / 办公
  {
    category: 'dev',
    name: '代码/编程',
    svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"></polyline><polyline points="8 6 2 12 8 18"></polyline></svg>'
  },
  {
    category: 'dev',
    name: '网页/浏览器',
    svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="2" y1="12" x2="22" y2="12"></line><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path></svg>'
  },
  {
    category: 'dev',
    name: 'Git分支',
    svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="6" y1="3" x2="6" y2="15"></line><circle cx="18" cy="6" r="3"></circle><circle cx="6" cy="18" r="3"></circle><path d="M18 9a9 9 0 0 1-9 9"></path></svg>'
  },
  {
    category: 'dev',
    name: '调试/Bug',
    svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="9" width="8" height="10" rx="4"></rect><line x1="12" y1="5" x2="12" y2="9"></line><line x1="4" y1="13" x2="8" y2="13"></line><line x1="16" y1="13" x2="20" y2="13"></line><line x1="5" y1="7" x2="8" y2="10"></line><line x1="19" y1="7" x2="16" y2="10"></line><line x1="5" y1="19" x2="8" y2="16"></line><line x1="19" y1="19" x2="16" y2="16"></line></svg>'
  },
  {
    category: 'dev',
    name: '调色盘/设计',
    svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="13.5" cy="6.5" r=".5"></circle><circle cx="17.5" cy="10.5" r=".5"></circle><circle cx="8.5" cy="7.5" r=".5"></circle><circle cx="6.5" cy="12.5" r=".5"></circle><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z"></path></svg>'
  },
  {
    category: 'dev',
    name: '图表/分析',
    svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"></line><line x1="12" y1="20" x2="12" y2="4"></line><line x1="6" y1="20" x2="6" y2="14"></line></svg>'
  },
  {
    category: 'dev',
    name: '邮件/通知',
    svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path><polyline points="22,6 12,13 2,6"></polyline></svg>'
  },
  {
    category: 'dev',
    name: '数据库',
    svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="5" rx="9" ry="3"></ellipse><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"></path><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"></path></svg>'
  },

  // ---------------------------------------------------- 符号 / 指示 / 状态
  {
    category: 'symbols',
    name: '对号/完成',
    svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>'
  },
  {
    category: 'symbols',
    name: '叉号/关闭',
    svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>'
  },
  {
    category: 'symbols',
    name: '收藏/星标',
    svg: '<svg viewBox="0 0 24 24" fill="currentColor"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>'
  },
  {
    category: 'symbols',
    name: '爱心/点赞',
    svg: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path></svg>'
  },
  {
    category: 'symbols',
    name: '向上',
    svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="19" x2="12" y2="5"></line><polyline points="5 12 12 5 19 12"></polyline></svg>'
  },
  {
    category: 'symbols',
    name: '向下',
    svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><polyline points="19 12 12 19 5 12"></polyline></svg>'
  },
  {
    category: 'symbols',
    name: '向左',
    svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="12" x2="5" y2="12"></line><polyline points="12 19 5 12 12 5"></polyline></svg>'
  },
  {
    category: 'symbols',
    name: '向右',
    svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline></svg>'
  },
  {
    category: 'symbols',
    name: '警告/提醒',
    svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>'
  },
  {
    category: 'symbols',
    name: '帮助/疑问',
    svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"></path><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>'
  },

  // ---------------------------------------------------- 🌈 通用多彩微拟物与常用符号
  {
    category: 'colorful',
    name: '显示器/桌面',
    svg: '<svg viewBox="0 0 24 24"><rect x="2" y="3" width="20" height="14" rx="2" fill="#2563eb"/><rect x="4" y="5" width="16" height="10" rx="1" fill="#38bdf8"/><path d="M8 21h8m-4-4v4" stroke="#94a3b8" stroke-width="2" stroke-linecap="round"/></svg>'
  },
  {
    category: 'colorful',
    name: '笔记本电脑',
    svg: '<svg viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="11" rx="1.5" fill="#3b82f6"/><rect x="6" y="6" width="12" height="7" rx="0.5" fill="#bae6fd"/><path d="M2 18h20a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1z" fill="#64748b"/></svg>'
  },
  {
    category: 'colorful',
    name: '经典文件夹',
    svg: '<svg viewBox="0 0 24 24"><path d="M2 6a2 2 0 0 1 2-2h4l2 2h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6z" fill="#f59e0b"/><path d="M2 9h20v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9z" fill="#fbbf24"/></svg>'
  },
  {
    category: 'colorful',
    name: '满电电池',
    svg: '<svg viewBox="0 0 24 24"><rect x="2" y="6" width="17" height="12" rx="2" fill="#10b981"/><path d="M21 10v4" stroke="#10b981" stroke-width="2" stroke-linecap="round"/><polygon points="10 8 7 13 11 13 9 16 14 11 10 11 10 8" fill="#ffffff"/></svg>'
  },
  {
    category: 'colorful',
    name: '灵感灯泡',
    svg: '<svg viewBox="0 0 24 24"><path d="M9 18h6m-5 3h4m-7-9a6 6 0 1 1 10 0c-1 1-1.5 2-1.5 3.5h-7C8.5 14 8 13 7 12z" fill="#facc15" stroke="#eab308" stroke-width="1.5"/><line x1="12" y1="2" x2="12" y2="4" stroke="#f59e0b" stroke-width="2" stroke-linecap="round"/></svg>'
  },
  {
    category: 'colorful',
    name: '通知铃铛',
    svg: '<svg viewBox="0 0 24 24"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" fill="#f59e0b"/><path d="M13.73 21a2 2 0 0 1-3.46 0" fill="#d97706"/><circle cx="18" cy="5" r="3.5" fill="#ef4444"/></svg>'
  },
  {
    category: 'colorful',
    name: '安全盾牌',
    svg: '<svg viewBox="0 0 24 24"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" fill="#0284c7"/><polyline points="8 11.5 11 14.5 16 9" stroke="#ffffff" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>'
  },
  {
    category: 'colorful',
    name: '极速火箭',
    svg: '<svg viewBox="0 0 24 24"><path d="M12 2c4 2 7 6 7 12l-4 3-3-3-3 3-4-3c0-6 3-10 7-12z" fill="#ef4444"/><circle cx="12" cy="9" r="2.5" fill="#ffffff"/><polygon points="12 17 9 22 15 22 12 17" fill="#f97316"/><polygon points="12 18 10 21 14 21 12 18" fill="#facc15"/></svg>'
  },
  {
    category: 'colorful',
    name: '涨势折线',
    svg: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2" fill="#1e293b"/><polyline points="4 16 9 11 13 15 20 7" fill="none" stroke="#22c55e" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/><polyline points="16 7 20 7 20 11" fill="none" stroke="#22c55e" stroke-width="2.5" stroke-linecap="round"/></svg>'
  },
  {
    category: 'colorful',
    name: '游戏手柄',
    svg: '<svg viewBox="0 0 24 24"><path d="M6 7h12a5 5 0 0 1 4.9 6.2l-1.5 5.8A2 2 0 0 1 19.4 20h-2.1a2 2 0 0 1-1.8-1.1l-1.5-3a2 2 0 0 0-3.6 0l-1.5 3A2 2 0 0 1 7.1 20H5a2 2 0 0 1-1.9-1.5L1.5 13.2A5 5 0 0 1 6 7z" fill="#334155"/><circle cx="17.5" cy="11.5" r="1" fill="#ef4444"/><circle cx="15.5" cy="13.5" r="1" fill="#3b82f6"/><circle cx="17.5" cy="15.5" r="1" fill="#eab308"/><circle cx="19.5" cy="13.5" r="1" fill="#22c55e"/><path d="M6 11v6m-3-3h6" stroke="#94a3b8" stroke-width="2" stroke-linecap="round"/></svg>'
  },
  {
    category: 'colorful',
    name: '专业麦克风',
    svg: '<svg viewBox="0 0 24 24"><rect x="8" y="2" width="8" height="12" rx="4" fill="#dc2626"/><rect x="8" y="5" width="8" height="6" fill="#ef4444"/><path d="M5 10v2a7 7 0 0 0 14 0v-2" stroke="#64748b" stroke-width="2" fill="none" stroke-linecap="round"/><path d="M12 19v4m-4 0h8" stroke="#64748b" stroke-width="2" stroke-linecap="round"/></svg>'
  },
  {
    category: 'colorful',
    name: '彩环单反',
    svg: '<svg viewBox="0 0 24 24"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" fill="#1e293b"/><circle cx="12" cy="13" r="5" fill="#0284c7"/><circle cx="12" cy="13" r="3" fill="#a855f7"/><circle cx="12" cy="13" r="1.5" fill="#f43f5e"/><circle cx="18" cy="9" r="1" fill="#e2e8f0"/></svg>'
  },
  {
    category: 'colorful',
    name: '渐变耳机',
    svg: '<svg viewBox="0 0 24 24"><path d="M3 14h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H3v-7zm15 0h3v7h-3a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2z" fill="#06b6d4"/><path d="M3 14v-3a9 9 0 0 1 18 0v3" fill="none" stroke="#8b5cf6" stroke-width="3" stroke-linecap="round"/></svg>'
  },
  {
    category: 'colorful',
    name: '播放绿色球',
    svg: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="#10b981"/><polygon points="9.5 8 16.5 12 9.5 16 9.5 8" fill="#ffffff"/></svg>'
  },
  {
    category: 'colorful',
    name: '暂停橙色球',
    svg: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="#f97316"/><rect x="8.5" y="7.5" width="2.5" height="9" rx="0.5" fill="#ffffff"/><rect x="13" y="7.5" width="2.5" height="9" rx="0.5" fill="#ffffff"/></svg>'
  },
  {
    category: 'colorful',
    name: '停止红色球',
    svg: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="#ef4444"/><rect x="8" y="8" width="8" height="8" rx="1" fill="#ffffff"/></svg>'
  },
  {
    category: 'colorful',
    name: '蓝色音量',
    svg: '<svg viewBox="0 0 24 24"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="#3b82f6"/><path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a9.5 9.5 0 0 1 0 14" fill="none" stroke="#06b6d4" stroke-width="2.5" stroke-linecap="round"/></svg>'
  },
  {
    category: 'colorful',
    name: '红色静音',
    svg: '<svg viewBox="0 0 24 24"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="#64748b"/><line x1="23" y1="9" x2="17" y2="15" stroke="#ef4444" stroke-width="3" stroke-linecap="round"/><line x1="17" y1="9" x2="23" y2="15" stroke="#ef4444" stroke-width="3" stroke-linecap="round"/></svg>'
  },
  {
    category: 'colorful',
    name: '闪电极速',
    svg: '<svg viewBox="0 0 24 24"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" fill="#eab308"/></svg>'
  },
  {
    category: 'colorful',
    name: '热咖啡杯',
    svg: '<svg viewBox="0 0 24 24"><path d="M18 8h1a3 3 0 0 1 0 6h-1M2 8h16v8a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z" fill="#78350f" stroke="#b45309" stroke-width="1.5"/><path d="M6 2v3m4-3v3m4-3v3" stroke="#f59e0b" stroke-width="1.5" stroke-linecap="round"/></svg>'
  },
  {
    category: 'colorful',
    name: '黄色便签',
    svg: '<svg viewBox="0 0 24 24"><polygon points="3 3 16 3 21 8 21 21 3 21 3 3" fill="#facc15"/><polygon points="16 3 16 8 21 8 16 3" fill="#eab308"/><line x1="7" y1="12" x2="17" y2="12" stroke="#854d0e" stroke-width="2" stroke-linecap="round"/><line x1="7" y1="16" x2="14" y2="16" stroke="#854d0e" stroke-width="2" stroke-linecap="round"/></svg>'
  },
  {
    category: 'colorful',
    name: '柱状图表',
    svg: '<svg viewBox="0 0 24 24"><rect x="3" y="12" width="4" height="9" rx="1" fill="#3b82f6"/><rect x="10" y="7" width="4" height="14" rx="1" fill="#10b981"/><rect x="17" y="3" width="4" height="18" rx="1" fill="#f59e0b"/></svg>'
  },
  {
    category: 'colorful',
    name: '金色钥匙',
    svg: '<svg viewBox="0 0 24 24"><circle cx="7.5" cy="15.5" r="4.5" fill="#f59e0b"/><circle cx="7.5" cy="15.5" r="2" fill="#ffffff"/><path d="M11 12l10-10m-3 0v4m-3-1v3" stroke="#d97706" stroke-width="2.5" stroke-linecap="round"/></svg>'
  },
  {
    category: 'colorful',
    name: '安全挂锁',
    svg: '<svg viewBox="0 0 24 24"><rect x="4" y="10" width="16" height="12" rx="2" fill="#0284c7"/><path d="M7 10V7a5 5 0 0 1 10 0v3" fill="none" stroke="#f59e0b" stroke-width="3" stroke-linecap="round"/><circle cx="12" cy="15" r="1.5" fill="#ffffff"/></svg>'
  },
  {
    category: 'colorful',
    name: '艺术调色板',
    svg: '<svg viewBox="0 0 24 24"><path d="M12 2C6.5 2 2 6.5 2 12c0 4.5 3 6.5 5 6.5 1 0 1.5-.5 2-1s1-1 2-1h2c4 0 7-3 7-7 0-4.5-3.5-7.5-8-7.5z" fill="#d97706"/><circle cx="7.5" cy="8.5" r="1.5" fill="#ef4444"/><circle cx="12" cy="6.5" r="1.5" fill="#facc15"/><circle cx="16.5" cy="8.5" r="1.5" fill="#3b82f6"/><circle cx="8" cy="13.5" r="1.5" fill="#22c55e"/></svg>'
  },
  {
    category: 'colorful',
    name: '环球互联',
    svg: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="#0284c7"/><path d="M3.6 9h16.8M3.6 15h16.8" stroke="#38bdf8" stroke-width="1.5"/><ellipse cx="12" cy="12" rx="4.5" ry="9" fill="none" stroke="#ffffff" stroke-width="1.5"/></svg>'
  },

  // ---------------------------------------------------- 🎨 热门品牌与应用
  {
    category: 'brands',
    name: '微信 (WeChat)',
    svg: '<svg viewBox="0 0 24 24"><path d="M9.5 3.5C5.4 3.5 2 6.3 2 9.8c0 2 1.1 3.7 2.8 4.8l-.7 2.2 2.6-1.3c.9.3 1.8.4 2.8.4 4.1 0 7.5-2.8 7.5-6.3 0-3.5-3.4-6.1-7.5-6.1z" fill="#07c160"/><path d="M15.5 9.5c-3.3 0-6 2.3-6 5.2 0 1.6.8 3.1 2.2 4.1l-.6 1.7 2.1-1c.7.2 1.5.3 2.3.3 3.3 0 6-2.3 6-5.2 0-3-2.7-5.1-6-5.1z" fill="#22c55e"/><circle cx="7" cy="8" r="1" fill="#ffffff"/><circle cx="12" cy="8" r="1" fill="#ffffff"/><circle cx="13.5" cy="13.5" r="0.8" fill="#ffffff"/><circle cx="17.5" cy="13.5" r="0.8" fill="#ffffff"/></svg>'
  },
  {
    category: 'brands',
    name: 'QQ',
    svg: '<svg viewBox="0 0 24 24"><ellipse cx="12" cy="12" rx="7" ry="8" fill="#1e293b"/><path d="M7 14c-2 2-3 5-1 6s4-1 4-2" fill="#f59e0b"/><path d="M17 14c2 2 3 5 1 6s-4-1-4-2" fill="#f59e0b"/><ellipse cx="12" cy="13.5" rx="5" ry="5.5" fill="#ffffff"/><circle cx="9.5" cy="9" r="1.5" fill="#ffffff"/><circle cx="9.8" cy="9.2" r="0.8" fill="#000000"/><circle cx="14.5" cy="9" r="1.5" fill="#ffffff"/><circle cx="14.2" cy="9.2" r="0.8" fill="#000000"/><path d="M10 11.5c1 .8 3 .8 4 0l-2 1.5-2-1.5z" fill="#f59e0b"/><path d="M6.5 11.5c2 1 9 1 11 0 0 1.5-2 3-5.5 3s-5.5-1.5-5.5-3z" fill="#ef4444"/></svg>'
  },
  {
    category: 'brands',
    name: 'Steam',
    svg: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="#171a21"/><path d="M19 9a4 4 0 0 0-4-4c-1.8 0-3.3 1.2-3.8 2.8L7.8 9.5a3 3 0 0 0-2.8-.5l-3 1.2A10 10 0 0 0 12 22a10 10 0 0 0 7.8-3.7l-4.2-1.8a4 4 0 0 0-.6-7.5zm-4 6a2 2 0 1 1 0-4 2 2 0 0 1 0 4z" fill="#66c0f4"/><circle cx="6.5" cy="14" r="1.5" fill="#ffffff"/></svg>'
  },
  {
    category: 'brands',
    name: 'Google Chrome',
    svg: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="#ffffff"/><path d="M12 2a10 10 0 0 1 8.7 5h-8.7l-4.3 7.5L12 2z" fill="#ea4335"/><path d="M20.7 7A10 10 0 0 1 15.5 21l4.3-7.5H11l-3.3-6.5h13z" fill="#fbbc05"/><path d="M12 22a10 10 0 0 1-8.7-15l4.3 7.5 4.4 7.5z" fill="#34a853"/><circle cx="12" cy="12" r="4.2" fill="#ffffff"/><circle cx="12" cy="12" r="3.2" fill="#1a73e8"/></svg>'
  },
  {
    category: 'brands',
    name: 'Bilibili',
    svg: '<svg viewBox="0 0 24 24"><rect x="3" y="6" width="18" height="14" rx="3" fill="#00aeec"/><path d="M7 2l3 3m7-3l-3 3" stroke="#00aeec" stroke-width="2.5" stroke-linecap="round"/><circle cx="8.5" cy="12" r="1.5" fill="#ffffff"/><circle cx="15.5" cy="12" r="1.5" fill="#ffffff"/><path d="M10 15.5c1 .8 3 .8 4 0" stroke="#ffffff" stroke-width="1.8" stroke-linecap="round" fill="none"/></svg>'
  },
  {
    category: 'brands',
    name: '网易云音乐',
    svg: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="#dc2626"/><circle cx="12" cy="12" r="6.5" fill="none" stroke="#ffffff" stroke-width="1.8"/><circle cx="12" cy="12" r="3" fill="#ffffff"/><circle cx="12" cy="12" r="1.2" fill="#dc2626"/></svg>'
  },
  {
    category: 'brands',
    name: 'VS Code',
    svg: '<svg viewBox="0 0 24 24"><path d="M17.5 2.5l4 2v15l-4 2-10-8.5 10-10.5z" fill="#007acc"/><path d="M17.5 6.5l-9 5.5 9 5.5V6.5z" fill="#1f9cf0"/><path d="M3.5 8l4.5 4-4.5 4-1-1 3-3-3-3 1-1z" fill="#ffffff"/></svg>'
  },
  {
    category: 'brands',
    name: 'GitHub',
    svg: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="#181717"/><path d="M12 5.5a6.5 6.5 0 0 0-2.1 12.7c.3.1.5-.1.5-.3v-1.2c-1.8.4-2.2-.9-2.2-.9-.3-.8-.7-1-.7-1-.6-.4 0-.4 0-.4.7.1 1 .7 1 .7.6 1 1.5.7 1.9.5 0-.4.2-.7.4-.9-1.5-.2-3-.7-3-3.2 0-.7.3-1.3.7-1.7 0-.2-.3-.8.1-1.7 0 0 .5-.2 1.8.7.5-.1 1.1-.2 1.6-.2s1.1.1 1.6.2c1.2-.9 1.8-.7 1.8-.7.4.9.1 1.5.1 1.7.4.5.7 1 .7 1.7 0 2.5-1.5 3-3 3.2.2.2.4.6.4 1.2v1.8c0 .2.1.4.5.3A6.5 6.5 0 0 0 12 5.5z" fill="#ffffff"/></svg>'
  },
  {
    category: 'brands',
    name: 'Photoshop',
    svg: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="3.5" fill="#001e36"/><text x="6" y="15" fill="#31a8ff" font-family="Arial,sans-serif" font-size="9" font-weight="bold">Ps</text></svg>'
  },
  {
    category: 'brands',
    name: 'Edge',
    svg: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="#0078d7"/><path d="M12 4a8 8 0 0 1 7.8 6.2c-.8-.5-1.8-.8-2.8-.8-3.3 0-6 2.7-6 6 0 1.2.4 2.3 1 3.2A8 8 0 1 1 12 4z" fill="#00c853"/><circle cx="14" cy="15" r="3" fill="#ffffff"/></svg>'
  },
  {
    category: 'brands',
    name: 'Discord',
    svg: '<svg viewBox="0 0 24 24"><rect x="2" y="3" width="20" height="18" rx="4" fill="#5865f2"/><path d="M16.5 7.5s-.8-.5-1.8-.6l-.1.2c1 .3 1.5.7 1.5.7-1-.5-2-.8-3.1-.8s-2.1.3-3.1.8c0 0 .5-.4 1.5-.7l-.1-.2c-1 .1-1.8.6-1.8.6-1.5 2.2-2 5.3-2 5.3 1 .8 2.2.8 2.2.8l.5-.6c-.8-.2-1.1-.7-1.1-.7s.1.1.2.1c1.2.7 2.7 1 4.2 1s3-.3 4.2-1c.1 0 .2-.1.2-.1s-.3.5-1.1.7l.5.6s1.2 0 2.2-.8c0 0-.5-3.1-2-5.3zM9.5 12c-.6 0-1-.5-1-1.2s.4-1.2 1-1.2 1 .5 1 1.2-.4 1.2-1 1.2zm5 0c-.6 0-1-.5-1-1.2s.4-1.2 1-1.2 1 .5 1 1.2-.4 1.2-1 1.2z" fill="#ffffff"/></svg>'
  }
];

const ICON_CATEGORIES = [
  { id: 'all', name: '全部' },
  { id: 'colorful', name: '🌈 彩色通用' },
  { id: 'brands', name: '🎨 品牌应用' },
  { id: 'custom', name: '🌟 我的收藏' },
  { id: 'media', name: '多媒体' },
  { id: 'system', name: '系统' },
  { id: 'tools', name: '常用工具' },
  { id: 'dev', name: '开发办公' },
  { id: 'symbols', name: '符号指示' }
];

/**
 * 将 SVG 包装为可以直接赋予 img.src 或持久化到 spec.icon 的 Data URL
 * @param {string} rawSvg 原始 SVG 字符串
 * @param {string} color 默认着色，若为空默认使用 #ffffff
 */
function svgToDataUrl(rawSvg, color = '#ffffff') {
  let colored = rawSvg;
  if (!colored.includes('xmlns=')) {
    colored = colored.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
  }
  // 如果 SVG 内部有 currentColor，替换为具体颜色
  colored = colored.replace(/currentColor/g, color);
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(colored);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { BUILTIN_ICONS, ICON_CATEGORIES, svgToDataUrl };
}
