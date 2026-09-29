// 把配置界面截图存成 PNG，用来「亲眼看」UI（并给设计改动留证据）。
//
//   npm run shot              -> logs/ui-*.png
//
// 窗口用 opacity:0 + show:true 渲染：页面会真正画出来，但用户看不到它，
// 也不会抢焦点。（show:false 的窗口在部分 Electron 版本上截出来是空白。）
//
// 注意必须拦下 window-all-closed：默认行为是「窗口全关 = 退出应用」，
// 那样只截得到第一张。日志逐张追加，中途崩了也能看到进度。
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'logs');
const HTML = path.join(__dirname, '..', 'src', 'renderer', 'index.html');
const LOG = path.join(DIR, 'ui-shots.log');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

app.on('window-all-closed', () => { /* keep going until we say so */ });

const SHOTS = [
  { name: 'ui-1-default', w: 1160, h: 800, js: [] },
  {
    name: 'ui-2-key', w: 1160, h: 800,
    js: [
      'document.querySelectorAll("#grid .cell.filled")[0].click()',
      'document.getElementById("tabStyle").click()',
      'document.getElementById("i-tc-custom").click()',
    ],

  },
  {
    name: 'ui-3-library', w: 1160, h: 800,
    js: ['document.querySelectorAll("#grid .cell.filled")[0].click()',
      'document.getElementById("drawerToggle").click()',
      'document.querySelectorAll("details.sec")[1].open=true'],
  },
  {
    name: 'ui-4-settings', w: 1160, h: 800,
    js: ['document.getElementById("settingsBtn").click()'],
  },
  { name: 'ui-5-narrow', w: 1000, h: 660, js: ['document.querySelectorAll("#grid .cell.filled")[0].click()'] },
  {
    name: 'ui-6-subpage', w: 1160, h: 800,
    js: [`[...document.querySelectorAll('#pageTabs .ptab')].find(function(x){return /娱乐/.test(x.textContent);}).click()`],
  },
  {
    name: 'ui-7-libpanel', w: 1160, h: 800,
    js: ['document.getElementById("libExpand").click()',
      `[...document.querySelectorAll('#libTags .libtag')].find(function(x){return /常用/.test(x.textContent);}).click()`],
  },
  {
    name: 'ui-8-dark', w: 1160, h: 800,
    js: ['(function(){var s=document.getElementById("theme"); s.value="dark"; s.dispatchEvent(new Event("change"));})()',
      'document.querySelectorAll("#grid .cell.filled")[0].click()'],
  },
  {
    name: 'ui-9-gradient', w: 1160, h: 800,
    js: [
      'document.getElementById("pageGradientBtn").click()',
      `[...document.querySelectorAll('#g-presets .preset-pill')].find(function(x){return /赛博霓虹/.test(x.textContent);}).click()`,
    ],
  },
  {
    name: 'ui-10-iconpicker', w: 1160, h: 800,
    js: [
      'document.querySelectorAll("#grid .cell.filled")[0].click()',
      'document.getElementById("i-openiconpicker").click()',
    ],
  },
  {
    name: 'ui-11-contextmenu', w: 1160, h: 800,
    js: [
      `(function(){
        var c = document.querySelectorAll("#grid .cell.filled")[0];
        c.dispatchEvent(new MouseEvent("contextmenu", { clientX: 280, clientY: 220, bubbles: true }));
      })()`,
    ],
  },
  {
    name: 'ui-12-custom-icons', w: 1160, h: 800,
    js: [
      'document.querySelectorAll("#grid .cell.filled")[0].click()',
      'document.getElementById("i-openiconpicker").click()',
      `[...document.querySelectorAll('#ipTags .ip-tag')].find(function(x){return /我的收藏/.test(x.textContent);}).click()`,
    ],
  },
  {
    name: 'ui-13-cropper', w: 1160, h: 800,
    js: [
      'document.querySelectorAll("#grid .cell.filled")[0].click()',
      `openCropper("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='600' height='320'><defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'><stop offset='0%25' stop-color='%236366f1'/><stop offset='100%25' stop-color='%23ec4899'/></linearGradient></defs><rect width='600' height='320' rx='16' fill='url(%23g)'/><circle cx='180' cy='160' r='80' fill='white' fill-opacity='0.2'/><polygon points='280,110 370,160 280,210' fill='white'/><text x='390' y='175' font-family='sans-serif' font-size='42' font-weight='bold' fill='white'>STREAM</text></svg>", function(){})`,
      'document.getElementById("cropFit").click()',
    ],
  },
  {
    name: 'ui-14-hotkey', w: 1160, h: 800,
    js: [
      'document.querySelectorAll("#grid .cell.filled")[0].click()',
      '(function(){ var t = document.getElementById("i-type"); t.value = "hotkey"; t.dispatchEvent(new Event("change")); })()',
      'document.getElementById("tabAction").click()',
      'document.getElementById("i-hotkey-pal-btn").click()',
      `(function(){
        var pills = document.querySelectorAll('#i-hotkey-pal-panel .hk-mod-pill');
        pills.forEach(function(p){
          var m = p.dataset.mod;
          if (m === 'alt' || m === 'shift') {
            if (!p.classList.contains('active')) p.click();
          } else {
            if (p.classList.contains('active')) p.click();
          }
        });
        var keys = document.querySelectorAll('#i-hotkey-key-grid .hk-key-pill');
        var f10 = [...keys].find(function(k){ return k.dataset.key === 'F10'; });
        if (f10) f10.click();
      })()`,
    ],
  },
  {
    name: 'ui-15-ip-contextmenu', w: 1160, h: 800,
    js: [
      'document.querySelectorAll("#grid .cell.filled")[0].click()',
      'document.getElementById("i-openiconpicker").click()',
      `[...document.querySelectorAll('#ipTags .ip-tag')].find(function(x){return /我的收藏/.test(x.textContent);}).click()`,
      `(function(){
        var item = document.querySelector("#ipGrid .ip-item");
        if (item) {
          item.dispatchEvent(new MouseEvent("contextmenu", { clientX: 360, clientY: 280, bubbles: true }));
        }
      })()`,
    ],
  },
  {
    name: 'ui-16-toggle-badge', w: 1160, h: 800,
    js: [
      'document.querySelectorAll("#grid .cell.filled")[0].click()',
      'document.getElementById("tabStyle").click()',
      'document.getElementById("i-badgemode-toggle").click()',
      'document.getElementById("i-toggle-try-btn").click()',
    ],
  },
  {
    name: 'ui-17-dual-action', w: 1160, h: 800,
    js: [
      'document.querySelectorAll("#grid .cell.filled")[0].click()',
      'document.getElementById("tabAction").click()',
      'document.getElementById("i-toggle-act-dual").click()',
      `(function() {
        var k = selected.row + ',' + selected.col;
        var s = pageButtons()[k];
        s.type = 'app';
        s.target = 'C:\\\\Program Files\\\\Tencent\\\\WeChat\\\\WeChat.exe';
        s.label = '微信';
        s.action2 = { type: 'command', target: 'taskkill /F /IM WeChat.exe', args: '' };
        renderInspector();
      })()`,
      'document.querySelector(".insp-body").scrollTop = 110',
    ],
  },
];


function note(s) {
  fs.appendFileSync(LOG, s + '\r\n', 'utf8');
  console.log(s);
}

app.whenReady().then(async () => {
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(LOG, '', 'utf8');

  for (const s of SHOTS) {
    try {
      const win = new BrowserWindow({
        width: s.w, height: s.h,
        show: true, opacity: 0, skipTaskbar: true, focusable: false,
        webPreferences: { contextIsolation: true, nodeIntegration: false },
      });
      win.webContents.setBackgroundThrottling(false);
      await win.loadFile(HTML);
      await sleep(700);

      if (s.js && s.js.length) {
        for (const code of s.js) {
          await win.webContents.executeJavaScript(code, true);
          await sleep(180);
        }
        await sleep(300);
      }

      const img = await win.webContents.capturePage();
      const png = img.toPNG();
      fs.writeFileSync(path.join(DIR, s.name + '.png'), png);
      const sz = img.getSize();
      note(`${s.name}.png  ${s.w}x${s.h} -> ${sz.width}x${sz.height}px  ${(png.length / 1024).toFixed(0)}KB`);
      win.destroy();
      await sleep(150);
    } catch (e) {
      note(`${s.name} FAILED: ${e && e.message}`);
    }
  }

  note('done');
  app.exit(0);
});

setTimeout(() => { note('TIMEOUT'); app.exit(2); }, 120000);
