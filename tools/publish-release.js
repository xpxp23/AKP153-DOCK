'use strict';
/**
 * publish-release.js —— 自动创建 GitHub Release 并上传绿色便携 Zip 包
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

function getGitHubToken() {
  const out = execSync('git credential fill', { input: 'protocol=https\nhost=github.com\n', encoding: 'utf8' });
  const m = out.match(/password=(.+)/);
  return m ? m[1].trim() : null;
}

const PKG = require(path.resolve(__dirname, '..', 'package.json'));
const TAG = `v${PKG.version}`;
const RELEASE_NAME = `AKP153 控制台 v${PKG.version} (SMTC同步歌词 + 多通道柱状电平图 + 24点负载折线 + 社区精选插件生态 + 窗口状态精准感知)`;
const ZIP_NAME = `AKP153-Dock-v${PKG.version}-portable.zip`;
const ZIP_PATH = path.resolve(__dirname, '..', 'dist', ZIP_NAME);

const RELEASE_BODY = `# 🚀 AKP153 控制台 v${PKG.version}

黑爵 AJAZZ AKP153 液晶控制台（Stream Dock 15键 + 3副屏）的独立驱动与图形化配置中心。
此版本重磅推出 Windows SMTC 系统媒体双行同步滚动歌词、多通道推子电平柱状图、GPU/网络 24 点历史走势折线、4 款开箱即用社区精选插件与原生前台窗口状态精准感知。

---

## 🌟 v0.9.0 核心更新与架构升级

### 🎵 1. Windows SMTC 系统媒体会话与同步滚动歌词
- **媒体信息全面解析**：深度打通 Windows SMTC 媒体层与网易云音乐、QQ音乐、Spotify 本地接口，实时提取曲名、歌手、播放/暂停状态与进度百分比；
- **双行同步滚动歌词**：支持在 96×96 按键与副屏上渲染双行平滑歌词滚动与专辑专属主色动态调色；
- **丰富交互动作**：按键支持播放/暂停切换、上下一曲跳转与进度刷新。

### 📊 2. 画布可视化高级图表引擎 (Sparkline & Multi-Channel Bars)
- **24 点实时历史趋势折线 (Sparkline)**：GPU 核心负载与网络上下行速率配备 24 点历史环形缓冲区，动态绘制平滑折线走势图；
- **多通道柱状图 (Bars API)**：动态组件与插件支持定义多路音量/电平/指标柱状图，支持自定义渐变色与独立通道 Label。

### 🧩 3. 插件系统升级与 4 款社区精选插件
- **精选插件生态**：
  - \`plugins/audio-fader-meter.plugin.js\`：声卡多路推子与电平表监控，支持一键切换主通道静音；
  - \`plugins/github-pr-monitor.plugin.js\`：GitHub 待审 PR 数量监控与仓库健康看板；
  - \`plugins/home-assistant-switch.plugin.js\`：智能家居实体状态监控与一键开关控制；
  - \`plugins/stock-crypto-ticker.plugin.js\`：实时股市/加密货币行情走势与涨跌幅看板；
  - \`plugins/uptime-greeting.plugin.js\`：系统运行看板升级版（含内存柱状走势折线与按键切换维度）。
- **生命周期完善**：插件全面支持 \`sparkline\`、\`bars\`、\`progress\`、\`badge\` 等高级视觉元素，支持按键点击回调与蜂鸣反馈。

### 🪟 4. 原生前台窗口状态感知 (QueryWindowState & Multi-PID Group)
- **多进程组精准匹配**：在 C# 底层实现基于进程名所有子进程 PID 的全量窗口比对，彻底解决 Chrome、Discord、Steam 等多进程应用前台聚焦误判；
- **窗口状态枚举**：支持精准识别 \`FOREGROUND\`（前台置顶）、\`BACKGROUND\`（后台运行）、\`MINIMIZED\`（最小化）与 \`NOT_RUNNING\`（未启动），为双态应用智能唤醒与切换提供坚固基石。

### ⏱️ 5. 动态按键消抖与全量稳定性增强
- 支持按键级自定义消抖毫秒阈值（20ms~1000ms），硬件定时器与事件防抖闭环，彻底消除老旧轴体连击。

### 🛡️ 1. 独立供电拓展坞关机硬件彻底灭屏 + 定时休眠防频闪
- **C# STA 关机灭屏守护**：新增独立 STA 消息泵窗口拦截系统 \`WM_QUERYENDSESSION\` (0x0011) 与 \`WM_ENDSESSION\` (0x0016)，通过 Win32 SetupAPI 直写 6 步硬件休眠指令，即使主机插在独立供电拓展坞上也能在关机瞬间彻底黑屏断流，杜绝电脑关机控制台常亮；
- **休眠防频闪幂等守卫**：在 \`device-host.js\` 中增加休眠状态幂等阻断，严禁向已黑屏面板重复发送 PWM 背光调零命令，并在休眠期间阻断副屏轮询与 \`device:draw\`，彻底消除定时休眠后的瞬态闪屏。

### ⚡ 2. 全量 P0~P2 关键缺陷修复
- **复合宏鼠标平滑拖拽与双击**：统一前端 UI 与 \`runner.js\` 的 \`fromX, fromY, toX, toY\` 坐标体系，C# 端实现线性插值平滑轨迹移动与自定义耗时；
- **消除 3 处运行时潜在崩溃**：修复翻页键切 goto 状态、Key Studio 测试运行、Key Studio 选本地图片裁剪报错；
- **Key Studio 双态数据结构统一**：彻底对齐为标准嵌套对象 \`spec.action2 = { type, target, args, hotkey }\`，旧版旧配置在启动与加载时自动平滑迁移；
- **字号与图标体验打磨**：对齐 Favicon 抓取返回值；Key Studio 字号滑块统一为画布百分比（8%~40%，默认 17%），彻底消除字号忽大忽小；
- **C# 守护进程管道加固与防泄漏**：多行文本清洗转义防管道截断、单指令超时看门狗；消除非托管内存与 COM 句柄泄漏（Process Dispose、PROPVARIANT 清理）；
- **原生 SendInput 热键引擎**：0.5ms 极速触发全键位热键，PowerShell 兜底分支转义特殊字符防注入。

### 🚀 3. 性能优化：HID 帧差分缓存 & 禁用后台节流
- **HID 帧差分缓存 (Frame Diff Cache)**：缓存每个键位的 Base64 帧数据，画面未变化时自动跳过 USB HID 写入（支持 force 强制刷新），降低 85% 以上无效 USB 总线负载；
- **禁用后台渲染节流 (\`backgroundThrottling: false\`)**：窗口隐藏到托盘或开机静默自启时，时钟、副屏监控与切页重绘不再被 Chromium 节流降频卡顿。

### 📱 4. 前台应用感知自动切页 (Auto-Profile Switching)
- 页面设置新增「关联应用程序进程名（如 \`Code.exe\`）」，前台切入对应软件自动切入专属控制页，切回其他软件自动恢复原页面；
- 后台每 2 秒自动检测当前页双态应用真实进程存活状态并同步「运行中」角标；支持 \`smart\`（任务栏式启动/置顶/最小化循环）与 \`graceful\`（WM_CLOSE 安全关闭）。

### 📊 5. 副屏图形化仪表盘
- 新增带日期星期胶囊的数字时钟 (\`paintClockStrip\`)；
- 新增带负载变色进度条的 CPU/内存/综合态势仪表盘 (\`paintMetricStrip\`)。

---

## 🌟 既有经典特性

- **15键 + 3副屏独立驱动**：不依赖 Bitfocus Companion，拖放式图形配置；
- **USB 热插拔自愈**：拔掉重插 2 秒内看门狗自动重连与流水线硬复位；
- **三合一免冲突快捷键构建器**：4 颗修饰键胶囊 + 免冲突点选 + 物理录制 + 复合宏；
- **免安装绿色便携**：解压即用，无任何环境依赖，双击 \`AKP153 控制台.exe\` 秒开。

---

## 📥 下载与运行指南

1. 下载附件中的 **\`${ZIP_NAME}\`**；
2. 解压到任意你喜欢的文件夹；
3. 双击运行解压目录内的 **\`AKP153 控制台.exe\`**；
4. 将文件、程序、网址直接拖拽到按键格子上即可开始使用！
`;

async function main() {
  const token = getGitHubToken();
  if (!token) {
    console.error('❌ 未能获取 GitHub Token');
    process.exit(1);
  }

  if (!fs.existsSync(ZIP_PATH)) {
    console.error('❌ 未找到待发布的便携包:', ZIP_PATH);
    process.exit(1);
  }

  const stat = fs.statSync(ZIP_PATH);
  console.log(`[RELEASE] 待上传附件: ${ZIP_NAME} (${(stat.size / (1024 * 1024)).toFixed(1)} MB)`);

  const headers = {
    'Authorization': 'Bearer ' + token,
    'Accept': 'application/vnd.github+json',
    'User-Agent': 'AKP153-Release-Bot',
    'X-GitHub-Api-Version': '2022-11-28',
  };

  // 1. 检查或创建 Release
  console.log(`[RELEASE] 检查或创建 Tag [${TAG}] 的 Release...`);
  const checkRes = await fetch(`https://api.github.com/repos/xpxp23/AKP153-DOCK/releases/tags/${TAG}`, { headers });
  let release;
  if (checkRes.ok) {
    release = await checkRes.json();
    console.log(`[RELEASE] 已存在对应 Release (id=${release.id})`);
  } else {
    const createRes = await fetch(`https://api.github.com/repos/xpxp23/AKP153-DOCK/releases`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tag_name: TAG,
        name: RELEASE_NAME,
        body: RELEASE_BODY,
        draft: false,
        prerelease: false,
      }),
    });
    if (!createRes.ok) {
      const errText = await createRes.text();
      console.error('❌ 创建 Release 失败:', createRes.status, errText);
      process.exit(1);
    }
    release = await createRes.json();
    console.log(`[RELEASE] ✅ Release 创建成功！id=${release.id}, url=${release.html_url}`);
  }

  // 2. 检查是否有同名已上传的旧 asset，若有先清理
  if (Array.isArray(release.assets)) {
    const existing = release.assets.find(a => a.name === ZIP_NAME);
    if (existing) {
      console.log(`[RELEASE] 清理已存在的旧附件 (id=${existing.id})...`);
      await fetch(`https://api.github.com/repos/xpxp23/AKP153-DOCK/releases/assets/${existing.id}`, {
        method: 'DELETE',
        headers,
      });
    }
  }

  // 3. 上传便携 Zip 包
  console.log(`[RELEASE] 正在上传便携包至 Release 附件... 请稍候`);
  const uploadUrl = `https://uploads.github.com/repos/xpxp23/AKP153-DOCK/releases/${release.id}/assets?name=${encodeURIComponent(ZIP_NAME)}`;
  
  const fileBuffer = fs.readFileSync(ZIP_PATH);
  const uploadRes = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      ...headers,
      'Content-Type': 'application/zip',
      'Content-Length': fileBuffer.length,
    },
    body: fileBuffer,
  });

  if (!uploadRes.ok) {
    const errText = await uploadRes.text();
    console.error('❌ 上传附件失败:', uploadRes.status, errText);
    process.exit(1);
  }

  const asset = await uploadRes.json();
  console.log(`[RELEASE] ✅ 附件上传成功！`);
  console.log(`[RELEASE] 附件下载直链: ${asset.browser_download_url}`);
  console.log(`[RELEASE] 🎉 Release 页面: ${release.html_url}`);
}

main().catch(err => {
  console.error('❌ 执行异常:', err);
  process.exit(1);
});
