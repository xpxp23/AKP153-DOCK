// Regression test for the launch path - answers "I pressed the key and nothing
// happened" with evidence instead of guesswork.
//
//   npm run test:launch              默认：绝不在桌面上弹任何窗口
//   npm run test:launch -- --visible  额外跑会真的开窗口的端到端用例
//
// SILENT BY CONTRACT: the default run must not put anything on screen. This
// suite used to fire up notepad and a window watcher, and when it ran in the
// background the user saw a blank Notepad + Explorer window appear out of
// nowhere and understandably called it a bug.
const { app } = require('electron');
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const LOG = path.join(__dirname, '..', 'logs', 'launch-test.log');
const VISIBLE = process.argv.includes('--visible');
const out = [];
const put = (s) => out.push(s);
const flush = () => fs.writeFileSync(LOG, out.join('\r\n'), 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const runner = require('../src/main/runner.js');

const NOTEPAD = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'notepad.exe');

function count(name) {
  try {
    const r = spawnSync('tasklist', ['/FI', `IMAGENAME eq ${name}`, '/NH', '/FO', 'CSV'],
      { encoding: 'latin1', windowsHide: true, timeout: 6000 });
    return String(r.stdout || '').toLowerCase().split(/\r?\n/).filter((l) => l.includes(name.toLowerCase())).length;
  } catch (e) { return -1; }
}

function kill(name) {
  try { spawnSync('taskkill', ['/F', '/IM', name], { windowsHide: true, timeout: 6000 }); } catch (e) {}
}

/** Visible top-level windows, as "<process>|<title>". */
function windows() {
  const f = path.join(__dirname, '..', 'logs', '_win-tmp.txt');
  try { fs.unlinkSync(f); } catch (e) {}
  spawnSync('powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
      '-File', path.join(__dirname, 'enum-windows.ps1'), '-Out', f],
    { encoding: 'utf8', windowsHide: true, timeout: 40000 });
  let set = new Set();
  try {
    set = new Set(fs.readFileSync(f, 'utf8').split(/\r?\n/).filter(Boolean));
    fs.unlinkSync(f);
  } catch (e) { /* none */ }
  return set;
}

/** Make a throwaway .lnk so we can test shortcut resolution + focus. */
function makeLnk(target, where) {
  const ps = `
$ErrorActionPreference='Stop'
$sh = New-Object -ComObject WScript.Shell
$lnk = $sh.CreateShortcut(${JSON.stringify(where)})
$lnk.TargetPath = ${JSON.stringify(target)}
$lnk.Save()
`;
  const r = spawnSync('powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
      '-EncodedCommand', Buffer.from(ps, 'utf16le').toString('base64')],
    { encoding: 'utf8', windowsHide: true, timeout: 15000 });
  return fs.existsSync(where);
}

/** Poll instead of sleeping a fixed amount: a cold launch can take seconds. */
async function waitFor(pred, ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (pred()) return true;
    await sleep(300);
  }
  return pred();
}

let failed = 0;
function check(label, cond, detail) {
  if (!cond) failed++;
  put(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? '   ' + detail : ''}`);
}

app.whenReady().then(async () => {
  put('electron ' + process.versions.electron);
  put(VISIBLE ? 'mode: --visible（会开窗口）' : 'mode: 静默（不开任何窗口）');
  put('');

  // ------------------------------------------- 不弹窗：command 类型（回归） --
  // This is the user-reported bug: a stray console window titled after the
  // command line. detached:true was the cause.
  const marker = path.join(os.tmpdir(), 'akp153-silent-command.txt');
  try { fs.unlinkSync(marker); } catch (e) {}
  const w0 = windows();
  const rc = await runner.run({
    type: 'command',
    target: `echo ok> "${marker}" && dir "${os.tmpdir()}" /b | findstr /i akp153 > nul`,
  });
  await waitFor(() => fs.existsSync(marker), 8000);
  await sleep(1200);
  const fresh = [...windows()].filter((w) => !w0.has(w));
  check('command: 执行成功', rc.ok && fs.existsSync(marker), `-> ${JSON.stringify(rc)}`);
  check('command: 不在桌面上弹任何窗口', fresh.length === 0, fresh.length ? `新增: ${fresh.join(' / ')}` : '');
  try { fs.unlinkSync(marker); } catch (e) {}

  // ------------------------------------------- 进程识别 + 唤起判定（无副作用） --
  // explorer.exe is always running and always has a window, so it exercises the
  // real detection path without launching anything.
  const de = await runner.diagnose(path.join(process.env.SystemRoot || 'C:\\Windows', 'explorer.exe'));
  check('exe: 正确识别进程名', de.processName === 'explorer.exe', `-> ${de.processName}`);
  check('exe: 已在运行 -> 判定为唤起', de.running && de.willDo === '唤起已在运行的窗口', `-> ${de.willDo}`);

  const dm = await runner.diagnose('C:\\definitely\\not\\here.exe');
  check('exe: 不存在的目标 -> 判定为启动（会被后续 exists 拦下）', !dm.exists, `-> exists=${dm.exists}`);

  // ------------------------------------------- .lnk 解析（中文 + 空格） --
  const lnk = path.join(os.tmpdir(), 'akp153-测试 快捷方式.lnk');
  try { fs.unlinkSync(lnk); } catch (e) {}
  const made = makeLnk(NOTEPAD, lnk);
  check('lnk: 创建测试快捷方式', made, lnk);
  if (made) {
    const dl = await runner.diagnose(lnk);
    check('lnk: 解析出真实进程名（无乱码）', dl.processName === 'notepad.exe', `-> ${dl.processName}`);
    check('lnk: 没在运行 -> 判定为启动', !dl.running && dl.willDo === '启动它', `-> willDo=${dl.willDo}`);
  }
  try { fs.unlinkSync(lnk); } catch (e) {}

  // ------------------------------------------------------------- 报错路径 --
  const r5 = await runner.run({ type: 'app', target: 'C:\\definitely\\not\\here.exe' });
  check('缺文件会报错，不会静默成功',
    !r5.ok && /找不到/.test(r5.error || ''), `-> ${JSON.stringify(r5)}`);

  // ============================================================ --visible ====
  if (VISIBLE) {
    put('');
    put('--- 端到端（会真的开窗口）---');

    kill('notepad.exe');
    await sleep(800);
    const b1 = count('notepad.exe');
    const r1 = await runner.run({ type: 'app', target: NOTEPAD });
    await waitFor(() => count('notepad.exe') > b1, 10000);
    await sleep(2000);   // give it a window before we ask to focus it
    const a1 = count('notepad.exe');
    check('exe: 首次按下会启动', r1.ok && r1.action === 'launched' && a1 > b1,
      `-> ${JSON.stringify(r1)}  procs ${b1}->${a1}`);

    if (a1 > b1) {
      const r2 = await runner.run({ type: 'app', target: NOTEPAD });
      check('exe: 再按一次是唤起，不再启动', r2.ok && r2.action === 'focused', `-> ${JSON.stringify(r2)}`);
    }

    kill('notepad.exe');
    await sleep(800);
    const lnk2 = path.join(os.tmpdir(), 'akp153-e2e.lnk');
    try { fs.unlinkSync(lnk2); } catch (e) {}
    if (makeLnk(NOTEPAD, lnk2)) {
      const b3 = count('notepad.exe');
      const r3 = await runner.run({ type: 'app', target: lnk2 });
      await waitFor(() => count('notepad.exe') > b3, 10000);
      await sleep(2000);
      const a3 = count('notepad.exe');
      check('lnk: 能启动目标（不再 EFTYPE）', r3.ok && a3 > b3, `-> ${JSON.stringify(r3)}  procs ${b3}->${a3}`);
      if (a3 > b3) {
        const r4 = await runner.run({ type: 'app', target: lnk2 });
        check('lnk: 再按一次是唤起', r4.ok && r4.action === 'focused', `-> ${JSON.stringify(r4)}`);
      }
      kill('notepad.exe');
      try { fs.unlinkSync(lnk2); } catch (e) {}
    }

    const r6 = await runner.run({ type: 'folder', target: os.tmpdir() });
    check('folder: 打开文件夹', r6.ok && r6.action === 'launched', `-> ${JSON.stringify(r6)}`);
  }

  put('');
  put(failed ? `FAILED: ${failed}` : 'ALL PASS');
  flush();
  app.exit(failed ? 1 : 0);
});

setTimeout(() => { put('TIMEOUT'); flush(); app.exit(2); }, VISIBLE ? 90000 : 60000);
