const { app, shell } = require('electron');
const fs = require('fs');
const path = require('path');

app.whenReady().then(async () => {
  console.log('--- TEST ICON DIAGNOSTICS ---');
  
  // 1. 测试真实 .lnk
  const startMenu = 'C:\\ProgramData\\Microsoft\\Windows\\Start Menu\\Programs';
  let sampleLnk = null;
  if (fs.existsSync(startMenu)) {
    const files = fs.readdirSync(startMenu);
    for (const f of files) {
      if (f.endsWith('.lnk')) {
        sampleLnk = path.join(startMenu, f);
        break;
      }
    }
  }
  console.log('Sample LNK:', sampleLnk);
  if (sampleLnk) {
    try {
      const details = shell.readShortcutLink(sampleLnk);
      console.log('Shortcut details:', details);
      
      const imgLnk = await app.getFileIcon(sampleLnk, { size: 'large' });
      console.log('app.getFileIcon(sampleLnk) -> empty?', imgLnk.isEmpty(), 'size:', imgLnk.getSize());
      
      if (details.target) {
        console.log('Target:', details.target, 'exists?', fs.existsSync(details.target));
        if (fs.existsSync(details.target)) {
          const imgTarget = await app.getFileIcon(details.target, { size: 'large' });
          console.log('app.getFileIcon(target) -> empty?', imgTarget.isEmpty(), 'size:', imgTarget.getSize());
        }
      }
    } catch (e) {
      console.error('LNK Error:', e);
    }
  }

  // 2. 检查桌面上的快捷方式
  const desktop = path.join(process.env.USERPROFILE, 'Desktop');
  console.log('Desktop:', desktop);
  if (fs.existsSync(desktop)) {
    const dFiles = fs.readdirSync(desktop);
    console.log('Desktop lnks:', dFiles.filter(f => f.endsWith('.lnk')).slice(0, 5));
    for (const f of dFiles) {
      if (f.endsWith('.lnk')) {
        const full = path.join(desktop, f);
        try {
          const det = shell.readShortcutLink(full);
          console.log('Desktop lnk [', f, '] target:', det.target, 'icon:', det.icon);
        } catch (e) {
          console.log('Desktop lnk [', f, '] read error:', e.message);
        }
      }
    }
  }

  // 3. 寻找系统中带 desktop.ini 的文件夹
  console.log('\n--- Checking desktop.ini folders ---');
  const userDirs = ['Downloads', 'Documents', 'Pictures', 'Music', 'Videos', 'Desktop'].map(d => path.join(process.env.USERPROFILE, d));
  for (const d of userDirs) {
    const ini = path.join(d, 'desktop.ini');
    if (fs.existsSync(ini)) {
      console.log('Found desktop.ini in:', d);
      const rawBuf = fs.readFileSync(ini);
      console.log('desktop.ini byte length:', rawBuf.length, 'first 16 bytes:', rawBuf.slice(0, 16));
      // 尝试用不同编码解码
      const strUtf8 = rawBuf.toString('utf8');
      const strUtf16le = rawBuf.toString('utf16le');
      console.log('utf8 search Icon:', /Icon/i.test(strUtf8));
      console.log('utf16le search Icon:', /Icon/i.test(strUtf16le));
      if (/Icon/i.test(strUtf16le)) {
        console.log('utf16le match:', strUtf16le.match(/Icon[^\r\n]+/gi));
      }
      if (/Icon/i.test(strUtf8)) {
        console.log('utf8 match:', strUtf8.match(/Icon[^\r\n]+/gi));
      }
    }
  }

  process.exit(0);
});
