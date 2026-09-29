'use strict';
/**
 * Hardware smoke test.
 *   node host/test-draw.js [listenSeconds]
 *
 * Draws a diagnostic pattern (distinct colour per key + a white corner marker
 * in the top-left of the UNROTATED image) so rotation can be verified by eye,
 * then listens for key presses.
 */
const jpeg = require('jpeg-js');
const { Device, buttonId, stripId } = require('./device-host.js');

const SIZE = 96;
const STRIP = 80;

// rotation applied before sending. AKP153 driver used iconRotation 90 -> "CW270"
// which is 90 degrees counter-clockwise. Flip ROTATE to false if it looks wrong.
const ROTATE_CCW = process.env.ROTATE === '0' ? false : true;

function makeImage(rgb, size, marker) {
  const data = Buffer.alloc(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    data[i * 4 + 0] = (rgb >> 16) & 255;
    data[i * 4 + 1] = (rgb >> 8) & 255;
    data[i * 4 + 2] = rgb & 255;
    data[i * 4 + 3] = 255;
  }
  if (marker) {
    // white 18x18 block in the top-left corner
    for (let y = 0; y < 18; y++) {
      for (let x = 0; x < 18; x++) {
        const i = (y * size + x) * 4;
        data[i] = 255; data[i + 1] = 255; data[i + 2] = 255;
      }
    }
  }
  return { data, width: size, height: size };
}

function rotateCCW(raw) {
  const { data, width: w, height: h } = raw;
  const out = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const src = (y * w + x) * 4;
      const nx = y;          // 90 CCW
      const ny = w - 1 - x;
      const dst = (ny * w + nx) * 4;
      out[dst] = data[src];
      out[dst + 1] = data[src + 1];
      out[dst + 2] = data[src + 2];
      out[dst + 3] = 255;
    }
  }
  return { data: out, width: w, height: h };
}

function encode(raw, quality) {
  const out = jpeg.encode(raw, quality);
  return out.data;
}

function fitJpeg(raw, maxBytes) {
  for (let q = 90; q >= 25; q -= 5) {
    const buf = encode(raw, q);
    if (buf.length <= maxBytes) return buf;
  }
  return encode(raw, 20);
}

const COLORS = [
  0xe63232, 0xe6781e, 0xf0c800, 0x32c832, 0x00b4dc,
  0x1e64ff, 0x8c32e6, 0xe632b4, 0xc85050, 0x50b478,
  0xb48c28, 0xa02864, 0x28b4a0, 0x455a64, 0x1a237e,
];

(async () => {
  const dev = new Device();
  const info = dev.open();
  console.log('opened:', info.path);
  console.log('rotate before send:', ROTATE_CCW ? 'CCW 90' : 'none');

  // Force the wake sequence first - a previous owner (Companion idle timer)
  // may have cut the backlight, in which case drawing writes to LCD RAM but
  // the panel stays dark and everything looks dead.
  if (process.argv.includes('--reset')) {
    await dev.reset(80);
    console.log('hard reset sent (DIS/wake/HAN/sleep/DIS/wake/brightness)');
  } else {
    await dev.wake(80, true);
    console.log('wake sequence sent (DIS + wake + brightness)');
  }
  await new Promise((r) => setTimeout(r, 300));

  let n = 0;
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 5; col++) {
      let raw = makeImage(COLORS[n % COLORS.length], SIZE, row === 0 && col === 0);
      if (ROTATE_CCW) raw = rotateCCW(raw);
      const jpg = fitJpeg(raw, 10240);
      await dev.draw(row, col, jpg.toString('base64'));
      process.stdout.write('.');
      n++;
    }
  }
  const STRIP_COLORS = [0x1a237e, 0x00695c, 0x4e342e];
  for (let row = 0; row < 3; row++) {
    let raw = makeImage(STRIP_COLORS[row], STRIP, false);
    if (ROTATE_CCW) raw = rotateCCW(raw);
    const jpg = fitJpeg(raw, 10240);
    await dev.draw(row, 5, jpg.toString('base64'));
  }
  console.log('\ndrew 15 keys + 3 strips');

  const seconds = Number(process.argv[2] || 8);
  console.log('listening for key presses for ' + seconds + 's ... (press any key)');
  const seen = [];
  dev.hid.on('data', (d) => {
    if (!d || d.length < 11) return;
    const id = d[9], st = d[10];
    let pos = null;
    for (let row = 0; row < 3; row++) for (let col = 0; col < 5; col++) if (buttonId(row, col) === id) pos = { row, col };
    if (!pos) return;
    const label = `r${pos.row}c${pos.col} ${st === 0 ? 'UP' : 'DOWN'}`;
    if (st !== 0) { seen.push(label); console.log('  ->', label); }
  });

  setTimeout(() => {
    console.log('captured presses:', seen.length ? seen.join(', ') : '(none)');
    dev.close();
    process.exit(0);
  }, seconds * 1000);
})().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
