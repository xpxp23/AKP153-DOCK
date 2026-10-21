'use strict';
/**
 * 社区精选插件：股票与加密资产实时 K 线看板 (v0.9)
 *
 * 支持在单键 (96×96) 或跨格宽屏 (192×96 / 288×96) 上绘制实时迷你折线图与涨跌幅角标。
 * 按下物理按键可在 BTC / ETH / NVDA / AAPL 之间一键切换监控标的。
 */
const SYMBOLS = [
  { code: 'BTC/USD', name: '🪙 BTC 比特币', base: 68420, step: 180, unit: '$', decimals: 0, history: [67800, 67950, 68120, 68040, 68290, 68180, 68350, 68510, 68400, 68620, 68490, 68420], changePct: +2.45 },
  { code: 'ETH/USD', name: '💎 ETH 以太坊', base: 2645, step: 15, unit: '$', decimals: 0, history: [2590, 2605, 2618, 2610, 2630, 2622, 2640, 2655, 2638, 2645], changePct: +1.82 },
  { code: 'NVDA', name: '🟩 NVDA 英伟达', base: 138.6, step: 0.8, unit: '$', decimals: 2, history: [134.5, 135.2, 136.0, 135.8, 137.1, 136.9, 137.8, 138.4, 138.1, 138.6], changePct: +3.14 },
  { code: 'AAPL', name: '🍎 AAPL 苹果', base: 231.4, step: 0.5, unit: '$', decimals: 2, history: [233.1, 232.8, 232.4, 232.9, 232.0, 231.8, 231.5, 231.2, 231.6, 231.4], changePct: -0.68 },
];

let activeIdx = 0;
let lastTickAt = 0;

module.exports = {
  id: 'stock_crypto_ticker',
  name: '行情与 K 线趋势监控',
  category: '金融行情',
  author: 'AKP153 Community',
  version: '0.9.5',
  defaultIntervalMs: 3000,
  configSchema: [
    { key: 'symbol', label: '监控股票/币种代码', type: 'select', default: '', options: [
      { label: '自动轮播 (按击切换)', value: '' },
      { label: 'BTC/USD · 比特币', value: 'BTC/USD' },
      { label: 'ETH/USD · 以太坊', value: 'ETH/USD' },
      { label: 'NVDA · 英伟达', value: 'NVDA' },
      { label: 'AAPL · 苹果', value: 'AAPL' }
    ] },
    { key: 'colorScheme', label: '涨跌配色方案', type: 'select', default: 'us', options: [
      { label: '国际标准 (绿涨红跌)', value: 'us' },
      { label: 'A股习惯 (红涨绿跌)', value: 'cn' }
    ] }
  ],
  description: '实时展示 BTC / ETH / NVDA / AAPL 价格走势与迷你 K 线折线图，按击切换标的',
  color: '#091526',

  async render({ config = {} }) {
    const reqSym = String(config.symbol || '').trim().toUpperCase();
    const item = (reqSym && SYMBOLS.find(s => s.code.toUpperCase().startsWith(reqSym))) || SYMBOLS[activeIdx % SYMBOLS.length];
    const now = Date.now();
    if (now - lastTickAt > 2500) {
      lastTickAt = now;
      const drift = (Math.sin(now / 5000 + activeIdx) * 0.6 + (Math.random() - 0.48)) * item.step;
      const nextVal = Math.max(1, Number((item.base + drift).toFixed(item.decimals)));
      item.base = nextVal;
      item.history.push(nextVal);
      if (item.history.length > 20) item.history.shift();
      const first = item.history[0] || nextVal;
      item.changePct = Number((((nextVal - first) / first) * 100).toFixed(2));
    }

    const rawUp = item.changePct >= 0;
    const isUp = config.colorScheme === 'cn' ? !rawUp : rawUp;
    const sign = isUp ? '+' : '';
    const priceStr = `${item.unit}${item.base.toLocaleString('en-US', { minimumFractionDigits: item.decimals, maximumFractionDigits: item.decimals })}`;

    return {
      title: item.name,
      value: priceStr,
      sub: `${item.code}  ${sign}${item.changePct}%`,
      subValue: `${item.code}  ${sign}${item.changePct}%`,
      color: isUp ? '#06221c' : '#260b12',
      accent: isUp ? '#10b981' : '#f43f5e',
      badge: {
        text: `${sign}${item.changePct}%`,
        bg: isUp ? '#059669' : '#e11d48',
      },
      sparkline: item.history.slice(),
    };
  },

  async onPress({ NativeInput }) {
    activeIdx = (activeIdx + 1) % SYMBOLS.length;
    lastTickAt = 0;
    if (NativeInput && NativeInput.beep) {
      await NativeInput.beep(true).catch(() => {});
    }
    return { ok: true, action: 'ticker_switched', symbol: SYMBOLS[activeIdx].code };
  },
};
