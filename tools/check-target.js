// "Why doesn't this key work?" - inspect what a target will do, without
// pressing anything.
//
//   npm run check -- "F:\Program Files\QOwnNotes\QOwnNotes.exe"
//   npm run check -- "%USERPROFILE%\Desktop\01_AI与开发\微信开发者工具.lnk" --run
//
// Without --run it only reports. With --run it actually executes (and will
// bring an already-running app's window to the front).
const { app } = require('electron');
const fs = require('fs');
const path = require('path');

const runner = require('../src/main/runner.js');

app.whenReady().then(async () => {
  // process.argv is [electron.exe, <this script>, ...realArgs].
  // Drop the entry point and flags rather than slicing a fixed index, since
  // Electron's argv layout differs between `electron .` and `electron script.js`.
  const argv = process.argv.slice(1).filter((a) => !a.startsWith('--'));
  const doRun = process.argv.includes('--run');
  const target = argv.slice(1).find((a) => a !== '.' && !a.endsWith('.js')) || '';

  if (!target) {
    console.log('用法: node tools/check-target.js <路径> [--run]');
    app.exit(2);
    return;
  }

  const d = await runner.diagnose(target);
  const cls = runner.classify(target);

  const lines = [
    '目标      : ' + d.target,
    '存在      : ' + (d.exists ? '是' : '否  <-- 这就是"按了没反应"的常见原因'),
    '分类      : ' + cls.type + (cls.isDir ? ' (文件夹)' : ''),
    '扩展名    : ' + (d.ext || '(无)'),
    '进程名    : ' + d.processName,
    '正在运行  : ' + (d.running ? '是' : '否'),
    '按下会做  : ' + d.willDo,
  ];

  if (doRun) {
    const r = await runner.run(Object.assign({}, cls, { type: cls.type, target: d.exists ? cls.abs : target }));
    lines.push('实际结果  : ' + JSON.stringify(r));
    setTimeout(() => finish(lines, r.ok ? 0 : 1), 1500);
  } else {
    finish(lines, 0);
  }
});

/** Print to stdout AND to a UTF-8 log: a GBK console would mangle the Chinese,
 *  so the log file is the reliable copy. */
function finish(lines, code) {
  for (const l of lines) console.log(l);
  try {
    fs.appendFileSync(path.join(__dirname, '..', 'logs', 'check-target.log'),
      ['--- ' + new Date().toISOString(), ...lines, ''].join('\r\n'), 'utf8');
  } catch (e) { /* best effort */ }
  app.exit(code);
}

setTimeout(() => { console.log('TIMEOUT'); app.exit(2); }, 30000);
