// 手动诊断：哪些动作会在桌面上弹窗，以及 detached 到底有没有影响。
// 会自动跑 A/B/C/D/E 五种 spawn 配置，**本身会弹窗**，只在排查时手动跑：
//
//   npm run probe:windows
//
// 结论（2026-09-21 实测，见 logs/console-ab.log）：detached:true 会弹窗，
// windowsHide 压不住；去掉 detached 后完全静默。
// Node's docs say a detached child on Windows "will have its own console
// window" - verify that against windowsHide before believing it.
const { app } = require('electron');
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const DIR = path.join(__dirname, '..', 'logs');
const PS1 = path.join(__dirname, 'enum-windows.ps1');
const out = [];
const put = (s) => out.push(s);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function snapshot(tag) {
  const f = path.join(DIR, `_wb-${tag}.txt`);
  try { fs.unlinkSync(f); } catch (e) {}
  spawnSync('powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', PS1, '-Out', f],
    { encoding: 'utf8', windowsHide: true, timeout: 30000 });
  try { return new Set(fs.readFileSync(f, 'utf8').split(/\r?\n/).filter(Boolean)); }
  catch (e) { return new Set(); }
}

const tmp = os.tmpdir();
const line = (n) => `dir "${tmp}" /b | findstr /i akp153 > "${path.join(tmp, 'akp153-ab-' + n + '.txt')}"`;
const b64 = (s) => Buffer.from(s, 'utf16le').toString('base64');

function launch(n) {
  switch (n) {
    case 'A detached+hide (当前实现)': {
      const c = spawn(line('A'), { shell: true, detached: true, stdio: 'ignore', windowsHide: true });
      c.on('error', () => {}); c.unref(); break;
    }
    case 'B shell+hide (不 detached)': {
      const c = spawn(line('B'), { shell: true, stdio: 'ignore', windowsHide: true });
      c.on('error', () => {}); c.unref(); break;
    }
    case 'C cmd /d /s /c + hide': {
      const c = spawn('cmd.exe', ['/d', '/s', '/c', line('C')], { stdio: 'ignore', windowsHide: true });
      c.on('error', () => {}); c.unref(); break;
    }
    case 'D powershell -WindowStyle Hidden': {
      const c = spawn('powershell.exe',
        ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-EncodedCommand', b64(line('D'))],
        { stdio: 'ignore', windowsHide: true });
      c.on('error', () => {}); c.unref(); break;
    }
    case 'E powershell 编码命令 + hide': {
      const c = spawn('powershell.exe',
        ['-NoProfile', '-NonInteractive', '-EncodedCommand', b64(line('E'))],
        { stdio: 'ignore', windowsHide: true });
      c.on('error', () => {}); c.unref(); break;
    }
  }
}

const NAMES = ['A detached+hide (当前实现)', 'B shell+hide (不 detached)', 'C cmd /d /s /c + hide',
  'D powershell -WindowStyle Hidden', 'E powershell 编码命令 + hide'];

app.whenReady().then(async () => {
  for (const n of NAMES) {
    const before = snapshot('a');
    launch(n);
    await sleep(2800);
    const after = snapshot('b');
    const fresh = [...after].filter((x) => !before.has(x));
    put(`${fresh.length ? '✗ 弹窗' : '✓ 静默'}  ${n}   新窗口 ${fresh.length}`);
    for (const w of fresh) put('      + ' + w);
  }

  // did the commands actually run? (silent must not mean "did nothing")
  put('');
  put('命令是否真的执行了：');
  for (const n of ['A', 'B', 'C', 'D', 'E']) {
    const f = path.join(tmp, 'akp153-ab-' + n + '.txt');
    put(`  ${n}: ${fs.existsSync(f) ? '是' : '否'}  ${f}`);
    try { fs.unlinkSync(f); } catch (e) {}
  }

  fs.writeFileSync(path.join(DIR, 'console-ab.log'), out.join('\r\n'), 'utf8');
  for (const f of ['_wb-a.txt', '_wb-b.txt']) { try { fs.unlinkSync(path.join(DIR, f)); } catch (e) {} }
  app.exit(0);
});

setTimeout(() => { put('TIMEOUT'); fs.writeFileSync(path.join(DIR, 'console-ab.log'), out.join('\r\n'), 'utf8'); app.exit(2); }, 120000);
