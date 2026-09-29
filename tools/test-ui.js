'use strict';
/**
 * UI smoke test - loads the renderer in a hidden window, clicks through the
 * grid, and reports any console error. No preload, so the page boots in DEMO
 * mode (sample data, no device calls).
 *
 *   node_modules\electron\dist\electron.exe tools\test-ui.js
 *
 * Results -> logs/ui-test.log
 */
const path = require('path');
const fs = require('fs');
const { app, BrowserWindow } = require('electron');

const LOG = path.join(__dirname, '..', 'logs', 'ui-test.log');
const out = [];
const put = (s) => { out.push(s); console.log(s); };

const consoleErrors = [];

app.whenReady().then(async () => {
  // Mirror the app's real default window: the layout needs >=1000px, and the
  // tests below assert we never overflow at either size.
  const win = new BrowserWindow({
    show: false,
    width: 1160,
    height: 800,
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });

  win.webContents.on('console-message', (...args) => {
    // Electron >= 36 passes a details object, older passes positional args
    const d = args[0];
    let level, message;
    if (d && typeof d === 'object' && 'message' in d) { level = d.level; message = d.message; }
    else { level = args[1]; message = args[2]; }
    const isError = level === 'error' || level === 3 || level === 2;
    if (isError) consoleErrors.push(String(message));
  });
  win.webContents.on('render-process-gone', (e, d) => consoleErrors.push('renderer gone: ' + JSON.stringify(d)));

  await win.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'index.html'));
  await new Promise((r) => setTimeout(r, 800));

  const js = (code) => win.webContents.executeJavaScript(code, true).catch((err) => {
    console.error('JS EXEC ERROR for code:', code, err.message);
    throw err;
  });

  const checks = [];
  const check = (name, cond, extra) => checks.push([name, !!cond, extra]);

  check('grid rendered', await js('document.querySelectorAll("#grid .cell").length') === 18,
    'cells=' + await js('document.querySelectorAll("#grid .cell").length'));
  check('15 pressable cells', await js('document.querySelectorAll("#grid .cell:not(.display)").length') === 15);
  check('3 display cells', await js('document.querySelectorAll("#grid .cell.display").length') === 3);
  check('demo buttons drawn', await js('document.querySelectorAll("#grid .cell.filled").length') > 0,
    'filled=' + await js('document.querySelectorAll("#grid .cell.filled").length'));
  check('strips panel removed', await js('!!document.getElementById("strips")') === false);

  // click a filled key -> inspector with style controls
  await js('document.querySelectorAll("#grid .cell.filled")[0].click()');
  await new Promise((r) => setTimeout(r, 200));
  check('filled -> inspector has label field', await js('!!document.getElementById("i-label")'));
  check('filled -> style controls present',
    await js('!!document.getElementById("i-fontsize") && !!document.getElementById("i-iconscale") && !!document.getElementById("i-color2")'));
  check('filled -> pick buttons present',
    await js('!!document.getElementById("i-pickapp") && !!document.getElementById("i-pickurl")'));

  // click an empty key -> create options
  await js('document.querySelectorAll("#grid .cell:not(.display):not(.filled)")[0].click()');
  await new Promise((r) => setTimeout(r, 200));
  check('empty -> offers file picker', await js('!!document.getElementById("i-pickapp")'));
  check('empty -> offers url/command', await js('!!document.getElementById("i-quickurl") && !!document.getElementById("i-quickcmd")'));

  // click a display strip -> strip inspector
  await js('document.querySelectorAll("#grid .cell.display")[0].click()');
  await new Promise((r) => setTimeout(r, 200));
  check('strip -> inspector type select', await js('!!document.getElementById("s-type")'));
  check('strip -> inspector font slider', await js('!!document.getElementById("s-fontsize")'));
  check('inspector title mentions 显示屏',
    String(await js('document.getElementById("inspectorTitle").textContent')).includes('显示屏'));

  // drag-to-reorder wiring
  check('cells are draggable',
    await js('document.querySelectorAll("#grid .cell:not(.display)[draggable=\\"true\\"]").length') === 15);

  // ---------------------------------------------------- layout must fit -----
  // This is the regression test for the bug that made the UI unusable: at the
  // old default 900x620 the layout needed 1048px, so the third row was clipped
  // and the inspector collapsed to a sliver.
  const measure = async (w, h) => {
    win.setSize(w, h);
    await new Promise((r) => setTimeout(r, 450));
    return js(`(function(){
      var cells = document.querySelectorAll('#grid .cell');
      var last = cells[cells.length - 1].getBoundingClientRect();
      var first = cells[0].getBoundingClientRect();
      return {
        sw: document.documentElement.scrollWidth, iw: window.innerWidth,
        sh: document.documentElement.scrollHeight, ih: window.innerHeight,
        cell: Math.round(first.width),
        fits: Math.round(last.bottom) <= window.innerHeight + 1
              && Math.round(last.right) <= window.innerWidth + 1
              && Math.round(first.top) >= 0
      };
    })()`);
  };

  for (const [w, h] of [[1160, 800], [1000, 660]]) {
    const m = await measure(w, h);
    check(`无横向溢出 @${w}x${h}`, m.sw <= m.iw + 1, `scrollW=${m.sw} innerW=${m.iw}`);
    check(`无纵向溢出 @${w}x${h}`, m.sh <= m.ih + 1, `scrollH=${m.sh} innerH=${m.ih}`);
    check(`18 个格子全部可见 @${w}x${h}`, m.fits, `格子宽=${m.cell}px`);
    check(`格子没有缩得太小 @${w}x${h}`, m.cell >= 60, `${m.cell}px`);
  }
  win.setSize(1160, 800);
  await new Promise((r) => setTimeout(r, 400));

  // ------------------------------------------------------- new shell bits ---
  check('有设备外壳（像块硬件）', await js('!!document.querySelector(".device .device-bar .model")'));
  check('顶栏不再堆设置项', await js('!!document.getElementById("settingsBtn") && document.getElementById("settingsPanel").hidden === true'));
  await js('document.getElementById("settingsBtn").click()');
  await new Promise((r) => setTimeout(r, 200));
  check('齿轮能打开设备设置', await js('document.getElementById("settingsPanel").hidden === false'));
  await js('document.getElementById("settingsBtn").click()');
  await new Promise((r) => setTimeout(r, 150));
  check('再点齿轮能收起', await js('document.getElementById("settingsPanel").hidden === true'));

  check('属性面板分成可折叠小节', await js('document.querySelectorAll("#inspector details.sec").length') >= 2);
  await js('document.querySelectorAll("#inspector details.sec")[1].open = true');
  await new Promise((r) => setTimeout(r, 150));

  check('有按键库抽屉', await js('!!document.getElementById("drawer") && !!document.getElementById("library")'));
  await js('document.getElementById("drawerToggle").click()');
  await new Promise((r) => setTimeout(r, 250));
  check('抽屉能打开', await js('document.getElementById("drawer").classList.contains("open")'));
  check('库里有条目（示例数据）', await js('document.querySelectorAll("#library .libitem").length') > 0,
    'items=' + await js('document.querySelectorAll("#library .libitem").length'));

  // back to a normal key so the type select exists
  await js('document.querySelectorAll("#grid .cell.filled")[0].click()');
  await new Promise((r) => setTimeout(r, 200));
  const typeLabel = String(await js('document.getElementById("i-type").options[0].textContent'));
  check('类型下拉已中文化', !/^[a-z]+$/.test(typeLabel), typeLabel);
  check('属性面板有「设为切页键」', await js('!!document.getElementById("i-page")'));

  // ------------------------------------------------------------- page tree --
  const clickTab = (re) => js(`(function(){
    var t = [...document.querySelectorAll('#pageTabs .ptab')]
              .find(function (x) { return ${re}.test(x.textContent); });
    if (t) t.click();
    return !!t;
  })()`);
  const sleep2 = (ms) => new Promise((r) => setTimeout(r, ms));

  check('有页面标签栏', await js('document.querySelectorAll("#pageTabs .ptab").length') >= 3,
    'tabs=' + await js('document.querySelectorAll("#pageTabs .ptab").length'));
  check('页签高亮当前页', await js('!!document.querySelector("#pageTabs .ptab.on")'));
  check('有新建/删除页按钮',
    await js('!!document.getElementById("pageAddTop") && !!document.getElementById("pageAddSub") && !!document.getElementById("pageDel")'));
  check('显示屏能显示页码',
    /页/.test(String(await js('document.querySelectorAll("#grid .cell.display .cap")[2].textContent'))),
    String(await js('document.querySelectorAll("#grid .cell.display .cap")[2].textContent')));

  // 切到子页「娱乐」
  check('能找到子页页签', await clickTab('/娱乐/'));
  await sleep2(400);
  check('子页右下角自动出现返回键', await js('!!document.querySelector("#grid .cell.back")'));
  check('返回键不能被拖走', await js(`(function(){
    var c = document.querySelector('#grid .cell.back');
    if (!c) return false;
    var ev = new Event('dragstart', { bubbles: true, cancelable: true });
    c.dispatchEvent(ev);
    return ev.defaultPrevented;
  })()`));

  await js('document.querySelector("#grid .cell.back").click()');
  await sleep2(250);
  check('点返回键给出说明', await js('!!document.getElementById("i-goup")'));

  // 回主页面，确认返回键消失、切页键有徽章
  check('能切回主页面', await clickTab('/主页面/'));
  await sleep2(400);
  check('离开子页后返回键消失', await js('!document.querySelector("#grid .cell.back")'));
  check('切页键有「切页」徽章',
    await js(`[...document.querySelectorAll('#grid .cell .badge')].some(function(b){return b.textContent==='切页';})`));

  // ------------------------------------------------- 机身颜色 + 库大面板 --
  check('默认是白色机身', await js('document.body.dataset.theme') === 'light', String(await js('document.body.dataset.theme')));
  await js('(function(){var s=document.getElementById("theme"); s.value="dark"; s.dispatchEvent(new Event("change"));})()');
  await sleep2(150);
  check('能切深色机身', await js('document.body.dataset.theme') === 'dark');
  await js('(function(){var s=document.getElementById("theme"); s.value="light"; s.dispatchEvent(new Event("change"));})()');
  await sleep2(120);
  check('能切回白色机身', await js('document.body.dataset.theme') === 'light');

  await js('document.getElementById("libExpand").click()');
  await sleep2(250);
  check('库能展开成大面板', await js('!document.getElementById("libPanel").hidden'));
  check('大面板有标签筛选', await js('document.querySelectorAll("#libTags .libtag").length') >= 2,
    'chips=' + await js('document.querySelectorAll("#libTags .libtag").length'));
  check('大面板有条目卡片', await js('document.querySelectorAll("#libGrid .libcard").length') > 0);
  check('大面板有搜索框与导入导出',
    await js('!!document.getElementById("libSearch2") && !!document.getElementById("libImport") && !!document.getElementById("libExportAll")'));
  await js('document.getElementById("libClose").click()');
  await sleep2(200);
  check('大面板能关掉', await js('document.getElementById("libPanel").hidden'));

  // ------------------------- 类型下拉选「切换页面」不能生成坏配置（回归） --
  await js('document.querySelectorAll("#grid .cell.filled")[0].click()');
  await sleep2(200);
  await js('(function(){ var t = document.getElementById("tabAction"); if (t) t.click(); })()');
  await sleep2(200);
  await js('(function(){var s=document.getElementById("i-type"); if (s) { s.value="page"; s.dispatchEvent(new Event("change")); }})()');
  await sleep2(400);
  check('选「切换页面」会先问翻页模式', await js('!!document.getElementById("_pmMode")'));
  await js('(function(){ var m = document.getElementById("_pmMode"); var ok = document.getElementById("_pmOk"); if (m && ok) { m.value="prev"; ok.click(); } })()');
  await sleep2(300);
  const paths = String(await js(`[...document.querySelectorAll('#inspector .path')].map(function(e){return e.textContent;}).join(' | ')`));
  check('选完模式后是合法的「上一页」键', /上一页/.test(paths), paths.slice(0, 80));


  // --------------------------------------- 按键库：整页快照 + 拖格子入库 --
  check('库里能区分整页快照', await js('!!document.querySelector("#library .libitem.ispage")')
    || await js('(function(){document.getElementById("libExpand").click(); return true;})()')
    && await js('!!document.querySelector("#libGrid .libcard.ispage")'),
    'ispage=' + await js('document.querySelectorAll("#library .libitem.ispage, #libGrid .libcard.ispage").length'));
  check('整页快照有迷你预览', await js('!!document.querySelector(".minigrid")'));
  check('页面栏有「本页入库」', await js('!!document.getElementById("pageSave")'));

  const libBefore = Number(await js('cfg.library.length'));
  await js('document.getElementById("pageSave").click()');
  await sleep2(350);
  check('点「本页入库」会多出一条整页快照', Number(await js('cfg.library.length')) === libBefore + 1,
    `${libBefore} -> ${await js('cfg.library.length')}`);

  // 把格子拖进按键库（折叠时拖到「按键库」标题栏也要能收）
  const libBefore2 = Number(await js('cfg.library.length'));
  const dropped = await js(`(function(){
    dragFrom = { row: 0, col: 0 };
    var d = document.getElementById('drawer');
    var ev = new Event('drop', { bubbles: true, cancelable: true });
    d.dispatchEvent(ev);
    return true;
  })()`);
  await sleep2(400);
  check('把格子拖进按键库会存进库', dropped && Number(await js('cfg.library.length')) === libBefore2 + 1,
    `${libBefore2} -> ${await js('cfg.library.length')}`);
  await js('document.body.classList.add("dragging-key")');
  await sleep2(120);
  const hint = String(await js('getComputedStyle(document.querySelector(".dhead"), "::after").content'));
  check('拖格子时标题栏会提示「拖到这里存库」', /存库/.test(hint), hint);
  await js('document.body.classList.remove("dragging-key")');

  // ---------------------------------------------------- 整板无缝渐变测试 --
  await js('document.getElementById("pageGradientBtn").click()');
  await sleep2(200);
  check('点渐变按钮展示页面渐变设置', await js('!!document.getElementById("g-enable")'));
  check('渐变面板有预设色卡', await js('document.querySelectorAll("#g-presets .preset-pill").length') === 5);

  // 点击一个预设色卡（赛博霓虹）
  await js(`(function(){
    var p = [...document.querySelectorAll('#g-presets .preset-pill')].find(function(x){ return /赛博霓虹/.test(x.textContent); });
    if (p) p.click();
  })()`);
  await sleep2(250);
  check('点击预设色卡开启整板渐变', await js('document.getElementById("g-enable").checked') === true);
  check('按键与副屏具备无缝渐变类', await js('document.querySelectorAll("#grid .cell.grad-cell").length') >= 16);
  const gradStyle = await js('document.querySelector("#grid .cell.grad-cell").style.backgroundSize');
  check('背景应用了覆盖 6 列的 600% 300% 拼接尺寸', gradStyle === '600% 300%');

  check('顶栏有一体化窗口控制按钮',
    await js('!!document.getElementById("winMin") && !!document.getElementById("winMax") && !!document.getElementById("winClose")'));
  await js('document.getElementById("winMin").click()');
  await js('document.getElementById("winMax").click()');
  check('最大化还原按钮图标切换', await js('document.getElementById("winMax").textContent') === '❐');
  await js('document.getElementById("winMax").click()');
  check('再次点击恢复为最大化图标', await js('document.getElementById("winMax").textContent') === '▢');

  // 点击一个格子，检查自定义底色开关、动作预设与角标控制
  await js('document.querySelectorAll("#grid .cell.filled")[0].click()');
  await sleep2(200);
  check('属性面板具备动作/外观胶囊选项卡', await js('!document.getElementById("inspTabs").hidden'));
  check('默认处于动作选项卡', await js('document.getElementById("tabAction").classList.contains("active")'));
  check('动作区域可见且外观区域隐藏',
    await js('document.querySelector("#inspector details[data-sec=\\"action\\"]").style.display !== "none"') &&
    await js('document.querySelector("#inspector details[data-sec=\\"look\\"]").style.display === "none"'));
  
  await js('document.getElementById("tabStyle").click()');
  await sleep2(100);
  check('点击外观选项卡成功切换激活状态', await js('document.getElementById("tabStyle").classList.contains("active")'));
  check('外观区域可见且动作区域隐藏',
    await js('document.querySelector("#inspector details[data-sec=\\"look\\"]").style.display !== "none"') &&
    await js('document.querySelector("#inspector details[data-sec=\\"action\\"]").style.display === "none"'));
  
  await js('document.getElementById("tabAction").click()');
  await sleep2(100);

  check('选中按键有底色二段胶囊选择器',
    await js('!!document.getElementById("i-colormode-grad") && !!document.getElementById("i-colormode-custom")'));
  await js('document.getElementById("i-colormode-custom").click()');
  await sleep2(100);
  check('点击独立底色胶囊激活自定义底色', await js('document.getElementById("i-customcolor").checked') === true);
  await js('document.getElementById("i-colormode-grad").click()');
  await sleep2(100);
  check('点击整板流光胶囊恢复跟随渐变', await js('document.getElementById("i-customcolor").checked') === false);

  check('选中按键有自定义底色开关', await js('!!document.getElementById("i-customcolor")'));
  check('属性面板有快捷动作预设下拉', await js('!!document.getElementById("i-quickpreset")'));
  check('属性面板有微标角标点选条', await js('document.querySelectorAll("#i-badgepresets .badge-pill").length') >= 8);
  check('页面有右键上下文菜单容器', await js('!!document.getElementById("contextMenu")'));
  check('页面有内置矢量图标库模态框', await js('!!document.getElementById("iconPickerModal")'));
  check('页面有图片裁剪模态框', await js('!!document.getElementById("cropperModal")'));
  check('裁剪器具备适应按钮', await js('!!document.getElementById("cropFit")'));
  check('裁剪器具备填满按钮', await js('!!document.getElementById("cropCover")'));
  check('裁剪器具备旋转按钮', await js('!!document.getElementById("cropRotate")'));
  check('裁剪器具备重置按钮', await js('!!document.getElementById("cropReset")'));
  const zoomMin = await js('document.getElementById("cropZoom").getAttribute("min")');
  const zoomMax = await js('document.getElementById("cropZoom").getAttribute("max")');
  check('裁剪器缩放范围扩展为20%-400%', zoomMin === '0.2' && zoomMax === '4.0', `${zoomMin} ~ ${zoomMax}`);

  // 裁剪器交互测试：大图/长图适应与旋转
  await js(`openCropper("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='800' height='400'><rect width='800' height='400' fill='red'/></svg>", function(){})`);
  await sleep2(200);
  check('打开裁剪器后显示模态框', await js('!document.getElementById("cropperModal").hidden'));
  check('默认初始相对缩放为100%', await js('document.getElementById("cropZoomVal").textContent') === '100%');
  await js('document.getElementById("cropFit").click()');
  await sleep2(100);
  check('点击适应按钮成功缩小至适应尺寸', Number(await js('cropperState.relativeZoom')) < 1.0);
  await js('document.getElementById("cropRotate").click()');
  await sleep2(100);
  check('点击旋转按钮旋转90度', Number(await js('cropperState.rotation')) === 90);
  await js('document.getElementById("cropClose").click()');
  await sleep2(150);
  check('关闭裁剪器成功', await js('document.getElementById("cropperModal").hidden'));

  check('按键类型下拉包含快捷键宏', await js('!!document.querySelector("#i-type option[value=\\"hotkey\\"]")'));
  check('图标库分类包含我的收藏', await js('ICON_CATEGORIES.some(function(c){ return c.id === "custom"; })'));

  // --------------------------------------------- 免冲突快捷键构建器测试 --
  // 点击一个按键，切换到动作面板并设为快捷键
  await js('document.querySelectorAll("#grid .cell:not(.display)")[0].click()');
  await sleep2(150);
  await js('document.getElementById("tabAction").click()');
  await sleep2(100);
  await js('document.getElementById("i-pickhotkey").click()');
  await sleep2(200);

  check('快捷键构建器容器已渲染', await js('!!document.getElementById("i-hotkey-wrap")'));
  check('具备录制按钮与免冲突点选按钮',
    await js('!!document.getElementById("i-hotkey-rec-btn") && !!document.getElementById("i-hotkey-pal-btn")'));
  
  // 测试免冲突点选面板（核心解药）
  await js('document.getElementById("i-hotkey-pal-btn").click()');
  await sleep2(100);
  check('点击点选按钮成功展开免冲突构建面板',
    await js('document.getElementById("i-hotkey-pal-panel").style.display !== "none"'));
  check('包含 4 颗独立修饰键胶囊 (Ctrl/Alt/Shift/Win)',
    await js('document.querySelectorAll("#i-hotkey-pal-panel .hk-mod-pill").length === 4'));

  // 点选 Alt + Shift + F10
  await js(`(function(){
    var pills = document.querySelectorAll('#i-hotkey-pal-panel .hk-mod-pill');
    pills.forEach(function(p){
      var m = p.dataset.mod;
      if (m === 'alt' || m === 'shift') {
        if (!p.classList.contains('active')) p.click();
      } else {
        if (p.classList.contains('active')) p.click();
      }
    });
  })()`);
  await sleep2(100);

  // 确保处于 F 功能键分类，点击 F10
  await js(`(function(){
    var tabs = document.querySelectorAll('#i-hotkey-cat-tabs .hk-cat-tab');
    var fTab = [...tabs].find(function(t){ return t.dataset.cat === 'f'; });
    if (fTab) fTab.click();
    var keys = document.querySelectorAll('#i-hotkey-key-grid .hk-key-pill');
    var f10 = [...keys].find(function(k){ return k.dataset.key === 'F10'; });
    if (f10) f10.click();
  })()`);
  await sleep2(150);

  const curHkVal = await js('document.getElementById("i-hotkey").value');
  check('点选 Alt+Shift 胶囊并点击 F10 成功生成 Alt+Shift+F10 (零键盘敲击)', curHkVal === 'Alt+Shift+F10', curHkVal);

  // 测试物理录制模式触发与 Esc 取消
  await js('document.getElementById("i-hotkey-rec-btn").click()');
  await sleep2(100);
  check('点击录制按钮进入高亮录制中状态',
    await js('document.getElementById("i-hotkey-rec-btn").classList.contains("recording")'));
  // 模拟按下 Escape 键取消录制
  await js(`(function(){
    var ev = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    window.dispatchEvent(ev);
  })()`);
  await sleep2(100);
  check('按下 Esc 键安全退出录制状态且不污染数值',
    await js('!document.getElementById("i-hotkey-rec-btn").classList.contains("recording")') &&
    await js('document.getElementById("i-hotkey").value === "Alt+Shift+F10"'));

  // 点击高频预设标签 (如 Win+D)
  await js(`(function(){
    var tag = document.querySelector('#i-hotkey-wrap .hotkey-tag[data-hk="Win+D"]');
    if (tag) tag.click();
  })()`);
  await sleep2(100);
  check('点击预设标签一键套用 Win+D 并同步修饰键胶囊',
    await js('document.getElementById("i-hotkey").value === "Win+D"') &&
    await js('document.querySelector("#i-hotkey-pal-panel .hk-mod-pill[data-mod=\\"win\\"]").classList.contains("active")'));


  // 检查副屏是否有系统监控选项 (cpu / mem / sys)
  await js('document.querySelectorAll("#grid .cell.display")[0].click()');
  await sleep2(200);
  check('副屏下拉包含 CPU 监控选项', await js('!!document.querySelector("#s-type option[value=\\"cpu\\"]")'));
  check('副屏下拉包含内存监控选项', await js('!!document.querySelector("#s-type option[value=\\"mem\\"]")'));
  check('副屏下拉包含态势仪表选项', await js('!!document.querySelector("#s-type option[value=\\"sys\\"]")'));

  // 1. 文字色二段胶囊选择器与快选色盘测试
  await js('document.querySelectorAll("#grid .cell:not(.display)")[0].click()');
  await sleep2(150);
  await js('document.getElementById("tabStyle").click()');
  await sleep2(150);
  check('外观面板存在文字色二段胶囊组', await js('!!document.getElementById("i-tc-auto") && !!document.getElementById("i-tc-custom")'));
  check('存在隐藏的兼容 autofg 复选框', await js('!!document.getElementById("i-autofg")'));
  await js('document.getElementById("i-tc-custom").click()');
  await sleep2(100);
  check('点击自定义色胶囊展开取色面板', await js('document.getElementById("i-tc-color-row").style.display !== "none"'));
  check('自定义模式下 autofg 处于取消勾选状态', await js('document.getElementById("i-autofg").checked === false'));
  check('取色面板包含快选色彩圆点', await js('document.querySelectorAll("#i-tc-color-row .tc-dot").length >= 5'));
  await js('document.querySelector("#i-tc-color-row .tc-dot").click()');
  await sleep2(100);
  check('点击色点可更新拾色器数值', await js('document.getElementById("i-textcolor").value === "#ffffff"'));
  await js('document.getElementById("i-tc-auto").click()');
  await sleep2(100);
  check('点击自动色胶囊收起取色面板', await js('document.getElementById("i-tc-color-row").style.display === "none"'));
  check('自动模式下 autofg 处于勾选状态', await js('document.getElementById("i-autofg").checked === true'));

  // 2. 深色模式阳极氧化深空钛金属外壳测试
  await js('document.body.setAttribute("data-theme", "dark")');
  await sleep2(100);
  const darkShellBg = await js('window.getComputedStyle(document.querySelector(".device")).backgroundImage');
  check('深色模式机身应用深空钛金属多阶微渐变', darkShellBg && darkShellBg.includes('gradient'));
  await js('document.body.setAttribute("data-theme", "light")');

  // 3. 图标库功能大升级测试（批量导入、子分类标签条、右键菜单）
  check('页面具备图标库批量导入按钮', await js('!!document.getElementById("ipBatchImport")'));
  check('页面具备图标库子分类容器', await js('!!document.getElementById("ipSubTags")'));
  check('页面具备自定义图标专用右键菜单', await js('!!document.getElementById("ipContextMenu")'));
  check('右键菜单包含套用与重命名等核心项', await js('!!document.getElementById("ipCmApply") && !!document.getElementById("ipCmRename") && !!document.getElementById("ipCmCategory") && !!document.getElementById("ipCmDelete")'));

  // 打开图标库并切换到我的收藏
  await js('openIconPicker()');
  await sleep2(200);
  check('打开图标库弹窗成功', await js('!document.getElementById("iconPickerModal").hidden'));
  await js('Array.from(document.querySelectorAll(".ip-tag")).find(b => b.textContent.includes("我的收藏")).click()');
  await sleep2(150);
  check('我的收藏标签下子分类条处于展示状态', await js('!document.getElementById("ipSubTags").hidden'));
  check('子分类条包含全部与常用及新建标签', await js('document.querySelectorAll(".ip-subtag").length >= 2'));
  await js('closeIconPicker()');
  await sleep2(100);
  check('关闭图标库弹窗成功', await js('document.getElementById("iconPickerModal").hidden'));

  // 4. 设置中心与休眠方式（4 种模式）及设备维护工具箱测试
  await js('document.getElementById("settingsBtn").click()');
  await sleep2(150);
  check('设备设置弹层包含休眠方式下拉框', await js('!!document.getElementById("sleepMode")'));
  const sleepModes = await js('Array.from(document.querySelectorAll("#sleepMode option")).map(o => o.value)');
  check('休眠方式完整支持 4 种硬件休眠模式 (zeros-last, nobright, vendor, light)',
    ['zeros-last', 'nobright', 'vendor', 'light'].every(m => sleepModes.includes(m)),
    sleepModes.join(', '));
  check('设置维护工具箱具备休眠屏幕按钮', await js('!!document.getElementById("sleep")'));
  check('设置维护工具箱具备唤醒屏幕按钮', await js('!!document.getElementById("wake")'));
  check('顶栏已移除冗余维护大按钮保持极简',
    await js('document.querySelectorAll("#bar .actions button").length === 1 && document.getElementById("bar").querySelector("#wake") === null'));

  check('设置中心具备 5 大分类导航 Tab',
    await js('document.querySelectorAll(".settings-nav-item").length === 5'));
  await js('document.querySelector(".settings-nav-item[data-tab=\\"behavior\\"]").click()');
  await sleep2(100);
  check('能切换到交互偏好设置 Tab',
    await js('document.getElementById("pane-behavior").hidden === false && document.getElementById("settingsTabTitle").textContent.includes("交互偏好")'));
  check('包含拖拽策略下拉框与防抖滑块',
    await js('!!document.getElementById("prefAppDropMode") && !!document.getElementById("prefDebounce")'));

  await js('document.querySelector(".settings-nav-item[data-tab=\\"data\\"]").click()');
  await sleep2(100);
  check('能切换到备份与数据管理 Tab',
    await js('document.getElementById("pane-data").hidden === false && !!document.getElementById("btnExportConfig")'));

  await js('document.getElementById("settingsCloseBtn").click()');
  await sleep2(100);
  check('点击设置弹窗关闭按钮成功关闭', await js('document.getElementById("settingsPanel").hidden === true'));

  // 5. 按键动态双态角标（ON/OFF Toggle 徽标）全流程测试
  await js('document.querySelectorAll("#grid .cell.filled")[0].click()');
  await sleep2(150);
  await js('document.getElementById("tabStyle").click()');
  await sleep2(100);

  check('外观面板包含角标模式切换三段胶囊组 (无角标 / 静态 / 双态)',
    await js('!!document.getElementById("i-badgemode-none") && !!document.getElementById("i-badgemode-static") && !!document.getElementById("i-badgemode-toggle")'));
  check('未设角标时默认处于无角标模式且收起配置区',
    await js('document.getElementById("i-badgemode-none").classList.contains("active") && document.getElementById("i-badgesec-static").style.display === "none" && document.getElementById("i-badgesec-toggle").style.display === "none"'));

  // 切换为静态角标模式
  await js('document.getElementById("i-badgemode-static").click()');
  await sleep2(150);
  check('点击静态角标胶囊成功展开静态角标区',
    await js('document.getElementById("i-badgesec-static").style.display !== "none" && document.getElementById("i-badgesec-toggle").style.display === "none"'));

  // 切换为动态双态模式
  await js('document.getElementById("i-badgemode-toggle").click()');
  await sleep2(150);
  check('点击切换为动态双态角标模式',
    await js('document.getElementById("i-badgesec-toggle").style.display !== "none" && document.getElementById("i-badgesec-static").style.display === "none"'));
  check('双态面板包含预设胶囊条与状态 1/状态 2 编辑卡片',
    await js('document.querySelectorAll("#i-toggle-presets .badge-toggle-preset-pill").length >= 6 && !!document.getElementById("i-toggle-s1-text") && !!document.getElementById("i-toggle-s2-text")'));
  check('双态面板包含试切按钮',
    await js('!!document.getElementById("i-toggle-try-btn")'));

  // 初始状态验证：DOM 格子徽标为 ON
  const initialBadgeText = await js('document.querySelectorAll("#grid .cell.filled")[0].querySelector(".badge-overlay").textContent');
  check('初始状态下 DOM 格子角标微标为 ON', initialBadgeText === 'ON', initialBadgeText);

  // 点击试切预览按钮 -> 翻转为 OFF
  await js('document.getElementById("i-toggle-try-btn").click()');
  await sleep2(150);
  const toggledBadgeText = await js('document.querySelectorAll("#grid .cell.filled")[0].querySelector(".badge-overlay").textContent');
  check('点击试切按钮后角标翻转为状态 2 (OFF)', toggledBadgeText === 'OFF', toggledBadgeText);
  check('状态 2 卡片高亮当前激活状态',
    await js('document.querySelectorAll(".badge-toggle-card")[1].classList.contains("active-state")'));

  // 再次点击试切按钮 -> 翻转回 ON
  await js('document.getElementById("i-toggle-try-btn").click()');
  await sleep2(150);
  const backBadgeText = await js('document.querySelectorAll("#grid .cell.filled")[0].querySelector(".badge-overlay").textContent');
  check('再次点击试切按钮角标翻转回状态 1 (ON)', backBadgeText === 'ON', backBadgeText);

  // 点击预设胶囊「🟢 开 / 🔴 关」
  await js('Array.from(document.querySelectorAll("#i-toggle-presets .badge-toggle-preset-pill")).find(b => b.textContent.includes("开 / 🔴 关")).click()');
  await sleep2(150);
  const s1Val = await js('document.getElementById("i-toggle-s1-text").value');
  const s2Val = await js('document.getElementById("i-toggle-s2-text").value');
  check('套用预设成功更新状态 1 与状态 2 文字 (开/关)', s1Val === '开' && s2Val === '关', `${s1Val}/${s2Val}`);
  const kaiBadgeText = await js('document.querySelectorAll("#grid .cell.filled")[0].querySelector(".badge-overlay").textContent');
  check('DOM 格子微标即时更新为「开」', kaiBadgeText === '开', kaiBadgeText);

  // 点击「测试运行」联动翻转
  await js('document.getElementById("i-test").click()');
  await sleep2(150);
  const testToggledText = await js('document.querySelectorAll("#grid .cell.filled")[0].querySelector(".badge-overlay").textContent');
  check('点击测试运行联动触发状态翻转为「关」', testToggledText === '关', testToggledText);

  // 测试清空角标 / 无角标三段胶囊
  await js('document.getElementById("i-badgemode-none").click()');
  await sleep2(150);
  check('点击无角标胶囊成功清空并收起双态与静态区域',
    await js('document.getElementById("i-badgesec-toggle").style.display === "none" && document.getElementById("i-badgesec-static").style.display === "none" && document.querySelectorAll("#grid .cell.filled")[0].querySelector(".badge-overlay") === null'));

  // 重新点回静态角标
  await js('document.getElementById("i-badgemode-static").click()');
  await sleep2(150);
  check('重新点击静态角标胶囊成功展开静态区域',
    await js('document.getElementById("i-badgesec-static").style.display !== "none" && document.getElementById("i-badgesec-toggle").style.display === "none"'));

  // 切换回动作与快捷选项卡，测试全新解耦的动作页双态布局
  await js('document.getElementById("tabAction").click()');
  await sleep2(100);

  // 独立双态动作测试（二段胶囊选择器已位于 Tab 1 顶部）
  check('包含动作模式二段胶囊选择器 (单一动作 vs 双态独立动作)',
    await js('!!document.getElementById("i-toggle-act-single") && !!document.getElementById("i-toggle-act-dual")'));
  check('默认处于单动作激活态且双态配置框隐藏',
    await js('document.getElementById("i-toggle-act-single").classList.contains("active") && document.getElementById("i-toggle-action2-box").style.display === "none"'));

  // 点击切换为双态独立动作
  await js('document.getElementById("i-toggle-act-dual").click()');
  await sleep2(150);
  check('切换后双态独立动作胶囊处于激活态',
    await js('document.getElementById("i-toggle-act-dual").classList.contains("active")'));
  check('展开双态动作配置容器且单动作容器隐藏',
    await js('document.getElementById("i-toggle-action2-box").style.display !== "none" && document.getElementById("i-single-action-box").style.display === "none"'));
  check('包含形态 1 卡片与形态 2 卡片及一键对调按钮',
    await js('!!document.querySelector(".state1-card") && !!document.querySelector(".state2-card") && !!document.getElementById("i-swap-actions")'));
  check('形态 2 动作支持类型选择与快捷键构建器',
    await js('!!document.getElementById("i-toggle-action2-type") && !!document.getElementById("i-toggle-action2-hk")'));

  // 测试一键互换形态动作 (Swap Actions)
  await js(`(function() {
    var k = selected.row + ',' + selected.col;
    var s = pageButtons()[k];
    s.type = 'app';
    s.target = 'C:\\\\Apps\\\\wechat.exe';
    s.action2 = { type: 'command', target: 'taskkill /F /IM wechat.exe', args: '' };
    s.badgeState1 = { text: '开', bg: '#107c41' };
    s.badgeState2 = { text: '关', bg: '#e53935' };
    renderInspector();
  })()`);
  await sleep2(100);
  await js('document.getElementById("i-swap-actions").click()');
  await sleep2(150);
  const swappedS1Target = await js('pageButtons()[selected.row + "," + selected.col].target');
  const swappedS1Type = await js('pageButtons()[selected.row + "," + selected.col].type');
  const swappedS2Target = await js('pageButtons()[selected.row + "," + selected.col].action2.target');
  const swappedS2Type = await js('pageButtons()[selected.row + "," + selected.col].action2.type');
  const badge1AfterSwap = await js('pageButtons()[selected.row + "," + selected.col].badgeState1.text');
  const badge2AfterSwap = await js('pageButtons()[selected.row + "," + selected.col].badgeState2.text');
  check('一键互换成功对调形态 1 与形态 2 的执行动作',
    swappedS1Target === 'taskkill /F /IM wechat.exe' && swappedS1Type === 'command' &&
    swappedS2Target === 'C:\\Apps\\wechat.exe' && swappedS2Type === 'app',
    `${swappedS1Type}->${swappedS2Type}`);
  check('一键互换动作时角标文字与色彩保持不变 (开/关不变)',
    badge1AfterSwap === '开' && badge2AfterSwap === '关',
    `${badge1AfterSwap}/${badge2AfterSwap}`);

  // 测试应用拖入默认双态闭环 (applyAppDualStateDefaults)
  const autoDualTest = await js(`(function() {
    var dummySpec = { type: 'app', label: '测试应用', target: 'D:\\\\Games\\\\Steam.exe' };
    applyAppDualStateDefaults(dummySpec, { type: 'app', processName: 'Steam' }, 'D:\\\\Games\\\\Steam.exe');
    return {
      toggleAction: dummySpec.toggleAction,
      act2Type: dummySpec.action2 && dummySpec.action2.type,
      act2Target: dummySpec.action2 && dummySpec.action2.target,
      badgeToggle: dummySpec.badgeToggle,
      b1Text: dummySpec.badgeState1 && dummySpec.badgeState1.text,
      b2Text: dummySpec.badgeState2 && dummySpec.badgeState2.text
    };
  })()`);
  check('应用程序默认自动配置退出双态闭环与 运行中 微标',
    autoDualTest.toggleAction === true &&
    autoDualTest.act2Type === 'command' &&
    autoDualTest.act2Target === 'taskkill /F /IM Steam.exe' &&
    autoDualTest.badgeToggle === true &&
    autoDualTest.b1Text === '' &&
    autoDualTest.b2Text === '运行中',
    JSON.stringify(autoDualTest));

  // 再次点击切回单动作
  await js('document.getElementById("i-toggle-act-single").click()');
  await sleep2(150);
  check('再次点击单一动作胶囊成功收起双态容器并展示单动作容器',
    await js('document.getElementById("i-toggle-action2-box").style.display === "none" && document.getElementById("i-single-action-box").style.display !== "none"'));

  // 验证 Preload 白名单通道
  const preloadRaw = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'preload.js'), 'utf8');
  check('Preload 严格白名单包含 key:toggleState 物理翻转广播通道', preloadRaw.includes("'key:toggleState'"));


  put('--- UI smoke test ---');
  let failed = 0;
  for (const [name, ok, extra] of checks) {
    if (!ok) failed++;
    put(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  (' + extra + ')' : ''}`);
  }
  put('console errors: ' + (consoleErrors.length ? JSON.stringify(consoleErrors.slice(0, 5)) : 'none'));
  if (consoleErrors.length) failed++;
  put(failed === 0 ? 'ALL PASS' : failed + ' FAILED');

  fs.mkdirSync(path.dirname(LOG), { recursive: true });
  fs.writeFileSync(LOG, out.join('\n') + '\n', 'utf8');
  process.exit(failed === 0 ? 0 : 1);
}).catch((err) => {
  console.error('TEST-UI FATAL:', err.message, 'CONSOLE ERRORS:', consoleErrors);
  process.exit(1);
});

process.on('uncaughtException', (e) => { put('UNCAUGHT ' + e.message); process.exit(2); });
