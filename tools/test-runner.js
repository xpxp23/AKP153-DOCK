'use strict';
/**
 * Headless regression test for the action layer (src/main/runner.js).
 * Must run under Electron so `require('electron').shell` is real:
 *
 *   node_modules\electron\dist\electron.exe tools\test-runner.js
 *
 * Results go to logs/runner-test.log.
 *
 * It intentionally includes a command with spaces AND quotes - that is the case
 * that silently failed when we used spawn('cmd.exe', ['/c', line]).
 *
 * SILENT BY CONTRACT: the default run must not put anything on screen.
 * Cases that inherently open a window (opening a folder) are gated behind
 * --visible, because this test may run in the background while the user works -
 * a stray Explorer window is indistinguishable from a bug in the app.
 */
const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');
const { app } = require('electron');

const runner = require(path.join(__dirname, '..', 'src', 'main', 'runner.js'));

const VISIBLE = process.argv.includes('--visible');
const LOG = path.join(__dirname, '..', 'logs', 'runner-test.log');
const lines = [];
const put = (s) => { lines.push(s); console.log(s); };

app.whenReady().then(async () => {
  const tmp = app.getPath('temp');
  const f = (n) => path.join(tmp, n);

  for (const n of ['akp153-a.txt', 'akp153 has spaces.txt', 'akp153-pipe.txt']) {
    try { fs.unlinkSync(f(n)); } catch (e) { /* ignore */ }
  }

  const ctl = spawnSync('cmd.exe', ['/c', 'echo control-ok'], { encoding: 'utf8', windowsHide: true });
  put(`control: status=${ctl.status} out=${JSON.stringify((ctl.stdout || '').trim())}`);
  put(VISIBLE ? 'mode: --visible (可能开窗口)' : 'mode: 静默（不开任何窗口）');

  // [name, spec, expectFailure, verify]
  const cases = [
    ['command: redirect', { type: 'command', target: `echo ok> "${f('akp153-a.txt')}"` }, false,
      () => fs.existsSync(f('akp153-a.txt'))],
    ['command: spaces + quotes', { type: 'command', target: `type nul> "${f('akp153 has spaces.txt')}"` }, false,
      () => fs.existsSync(f('akp153 has spaces.txt'))],
    ['command: pipe', { type: 'command', target: `dir "${tmp}" /b | findstr /i akp153 > "${f('akp153-pipe.txt')}"` }, false,
      () => fs.existsSync(f('akp153-pipe.txt'))],
    ['missing exe is reported', { type: 'app', target: 'C:\\definitely\\not\\here.exe' }, true, () => true],
    ['missing ps1 is reported', { type: 'ps1', target: 'C:\\definitely\\not\\here.ps1' }, true, () => true],
    ['hotkey: Alt+Shift+F10', { type: 'hotkey', hotkey: 'Alt+Shift+F10' }, false, () => true],
    ['hotkey: Win+F10', { type: 'hotkey', hotkey: 'Win+F10' }, false, () => true],
    ['volume: up (WASAPI 0ms)', { type: 'volume', action: 'up', step: 5 }, false, () => true],
    ['volume: down (WASAPI 0ms)', { type: 'volume', action: 'down', step: 5 }, false, () => true],
    ['volume: mute toggle', { type: 'volume', action: 'mute' }, false, () => true],
  ];

  if (VISIBLE) {
    cases.push(['open folder via openPath (opens Explorer)', { type: 'folder', target: path.join(__dirname, '..', 'logs') }, false, () => true]);
  }

  let failed = 0;
  for (const [name, spec, expectFailure, verify] of cases) {
    const r = await runner.run(spec);
    await new Promise((res) => setTimeout(res, 1200)); // spawn is fire-and-forget
    // A "missing file" case must come back as ok:false WITH an error message.
    const pass = expectFailure ? (!r.ok && !!r.error) : (r.ok && verify());
    if (!pass) failed++;
    put(`${pass ? 'PASS' : 'FAIL'}  ${name} -> ${JSON.stringify(r)}`);
  }

  put(`classify("README.md") -> ${JSON.stringify(runner.classify('README.md'))}`);
  put(failed === 0 ? 'ALL PASS' : `${failed} FAILED`);

  for (const n of ['akp153-a.txt', 'akp153 has spaces.txt', 'akp153-pipe.txt']) {
    try { fs.unlinkSync(f(n)); } catch (e) { /* ignore */ }
  }

  fs.mkdirSync(path.dirname(LOG), { recursive: true });
  fs.writeFileSync(LOG, lines.join('\n') + '\n', 'utf8');
  process.exit(failed === 0 ? 0 : 1);
});

process.on('uncaughtException', (e) => { put('UNCAUGHT ' + e.message); process.exit(2); });
