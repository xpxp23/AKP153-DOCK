const path = require('path');
const hidPath = 'C:\\Program Files\\Companion\\resources\\builtin-surfaces\\mirabox-stream-dock\\prebuilds\\HID-win32-x64\\node-napi-v4.node';
const jpegPath = 'C:\\Program Files\\Companion\\resources\\builtin-surfaces\\mirabox-stream-dock\\prebuilds\\jpeg-turbo-win32-x64\\node-napi-v10.node';

const HID = require(hidPath);
const jpeg = require(jpegPath);

const devices = HID.devices();
const akp = devices.find(d => (d.vendorId === 0x5548 && d.productId === 0x6674) || (d.vendorId === 0x0300 && d.productId === 0x1010));
if (!akp) {
  console.error('AKP153 设备未找到，请检查 USB 连接！');
  process.exit(1);
}

const dev = new HID.HID(akp.path);
console.log('[+] 已成功连接 AKP153 硬件设备:', akp.product);

const packetSize = 512;
const cmdPrefix = [67, 82, 84, 0, 0]; // CRT\0\0

function sendCmdSimple(cmd) {
  const t = Buffer.from(cmd);
  const e = Buffer.from(cmdPrefix);
  const n = Buffer.concat([Buffer.from([0]), e, t], packetSize + 1);
  return dev.write(n);
}

function writeRaw(buf) {
  return dev.write(buf);
}

async function sendDrawKeyCmd(data) {
  for (let offset = 0; offset < data.length; offset += packetSize) {
    const chunk = data.subarray(offset, offset + packetSize);
    const packet = Buffer.concat([Buffer.from([0]), chunk], packetSize + 1);
    writeRaw(packet);
  }
}

async function drawButton(keyId, w, h, r, g, b, label) {
  const rawRgb = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * 3;
      const isBorder = (x < 4 || x >= w - 4 || y < 4 || y >= h - 4);
      if (isBorder) {
        rawRgb[idx + 0] = 255;
        rawRgb[idx + 1] = 255;
        rawRgb[idx + 2] = 255;
      } else {
        const check = ((Math.floor(x / 10) + Math.floor(y / 10)) % 2 === 0);
        const factor = check ? 1.0 : 0.82;
        rawRgb[idx + 0] = Math.round(r * factor);
        rawRgb[idx + 1] = Math.round(g * factor);
        rawRgb[idx + 2] = Math.round(b * factor);
      }
    }
  }

  const compressOptions = {
    format: jpeg.FORMAT_RGB,
    width: w,
    height: h,
    subsampling: jpeg.SAMP_422,
    quality: 85
  };

  const res = await jpeg.compress(rawRgb, compressOptions);
  const jpgData = (res && res.data) ? res.data.subarray(0, res.size) : res;

  const u = jpgData.length;
  sendCmdSimple([66, 65, 84, (u >> 24) & 255, (u >> 16) & 255, (u >> 8) & 255, u & 255, keyId]);
  await sendDrawKeyCmd(jpgData);
  sendCmdSimple([83, 84, 80]); // STP
}

async function main() {
  try {
    console.log('[+] 正在点亮屏幕并设置 100% 亮度...');
    sendCmdSimple([68, 73, 83]); // Wake
    sendCmdSimple([76, 73, 71, 0, 0, 100]); // Brightness 100%

    const mainKeys = [
      { id: 13, name: "K1",  color: [230, 50, 50] },   // 鲜红
      { id: 10, name: "K2",  color: [230, 120, 30] },  // 橙黄
      { id: 7,  name: "K3",  color: [240, 200, 0] },   // 暖黄
      { id: 4,  name: "K4",  color: [50, 200, 50] },   // 翠绿
      { id: 1,  name: "K5",  color: [0, 180, 220] },   // 青蓝
      { id: 14, name: "K6",  color: [30, 100, 255] },  // 宝蓝
      { id: 11, name: "K7",  color: [140, 50, 230] },  // 魅紫
      { id: 8,  name: "K8",  color: [230, 50, 180] },  // 品红
      { id: 5,  name: "K9",  color: [200, 80, 80] },   // 珊瑚
      { id: 2,  name: "K10", color: [80, 180, 120] },  // 薄荷绿
      { id: 15, name: "K11", color: [40, 120, 180] },  // 钢蓝
      { id: 12, name: "K12", color: [180, 140, 40] },  // 古铜
      { id: 9,  name: "K13", color: [160, 40, 100] },  // 浆果
      { id: 6,  name: "K14", color: [40, 180, 160] },  // 蓝绿
      { id: 3,  name: "K15", color: [100, 100, 255] }  // 紫罗兰
    ];

    console.log('[+] 正在绘制全部 15 颗主液晶按键...');
    for (const k of mainKeys) {
      await drawButton(k.id, 85, 85, k.color[0], k.color[1], k.color[2], k.name);
    }

    console.log('[+] 正在绘制侧边副屏 (S1, S2, S3)...');
    await drawButton(16, 80, 80, 0, 220, 255, "S1");
    await drawButton(17, 80, 80, 255, 180, 0, "S2");
    await drawButton(18, 80, 80, 255, 0, 128, "S3");

    console.log('====================================================');
    console.log('  AKP153 18块炫彩高饱和度方块已全量绘制上屏！');
    console.log('====================================================');
  } catch (err) {
    console.error('[-] 绘制失败:', err);
  } finally {
    dev.close();
  }
}

main();
