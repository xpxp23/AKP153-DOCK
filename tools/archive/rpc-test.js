'use strict';
/** End-to-end test of the stdio JSON-RPC host (no Electron involved). */
const { spawn } = require('child_process');
const path = require('path');
const jpeg = require('jpeg-js');

const child = spawn(process.execPath, [path.join(__dirname, 'device-host.js')], {
  stdio: ['pipe', 'pipe', 'inherit'],
});

let id = 0;
const waiting = new Map();
function send(cmd, args) {
  return new Promise((resolve, reject) => {
    const my = ++id;
    waiting.set(my, { resolve, reject });
    child.stdin.write(JSON.stringify(Object.assign({ id: my, cmd }, args || {})) + '\n');
    setTimeout(() => { if (waiting.has(my)) { waiting.delete(my); reject(new Error('TIMEOUT ' + cmd)); } }, 8000);
  });
}

function solid(rgb, size) {
  const data = Buffer.alloc(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    data[i * 4] = (rgb >> 16) & 255;
    data[i * 4 + 1] = (rgb >> 8) & 255;
    data[i * 4 + 2] = rgb & 255;
    data[i * 4 + 3] = 255;
  }
  return jpeg.encode({ data, width: size, height: size }, 70).data;
}

let buf = '';
child.stdout.setEncoding('utf8');
child.stdout.on('data', (chunk) => {
  buf += chunk;
  let nl;
  while ((nl = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (!line) continue;
    let msg;
    try { msg = JSON.parse(line); } catch (e) { continue; }
    if (msg.event) {
      if (msg.event === 'down' || msg.event === 'up') {
        console.log('EVENT', msg.event, `r${msg.row}c${msg.col}`);
      } else if (msg.event !== 'ready') {
        console.log('EVENT', JSON.stringify(msg));
      }
    } else if (waiting.has(msg.id)) {
      const w = waiting.get(msg.id);
      waiting.delete(msg.id);
      msg.ok ? w.resolve(msg) : w.reject(new Error(msg.error));
    }
  }
});

(async () => {
  await new Promise((r) => setTimeout(r, 300));
  console.log('ping   ->', JSON.stringify(await send('ping')));
  console.log('open   ->', JSON.stringify(await send('open')));
  console.log('wake   ->', JSON.stringify(await send('wake', { brightness: 80, force: true })));
  console.log('bright ->', JSON.stringify(await send('brightness', { value: 80 })));

  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 5; col++) {
      await send('draw', { row, col, data: solid(0x1e64ff + row * 0x1010 + col * 0x0303, 96).toString('base64') });
    }
  }
  for (let row = 0; row < 3; row++) {
    await send('draw', { row, col: 5, data: solid(0x263238, 80).toString('base64') });
  }
  console.log('draw   -> 15 keys + 3 strips OK');

  console.log('\n按设备上任意键（8 秒）…');
  await new Promise((r) => setTimeout(r, 8000));
  child.kill();
  process.exit(0);
})().catch((e) => {
  console.error('FAILED:', e.message);
  child.kill();
  process.exit(1);
});
