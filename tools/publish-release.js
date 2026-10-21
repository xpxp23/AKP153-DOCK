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
const RELEASE_NAME = `AKP153 控制台 v${PKG.version} (RuntimeStateStore单向数据流 + 0ms零延迟直通 + DirtyRect差量合成 + Widget Studio图层编排 + 多硬件型号自适应)`;
const ZIP_NAME = `AKP153-Dock-v${PKG.version}-portable.zip`;
const ZIP_PATH = path.resolve(__dirname, '..', 'dist', ZIP_NAME);

const RELEASE_BODY = `# 🚀 AKP153 控制台 v${PKG.version}

黑爵 AJAZZ AKP153 液晶控制台（Stream Dock 15键 + 3副屏）的独立驱动与图形化配置中心。
此版本重磅推出配置与状态分离的单向数据流架构（RuntimeStateStore）、0ms 零延迟物理按键直通响应、离屏 Dirty-Rect 差量合成管线、可视化小组件图层编排工坊（Widget Studio）以及多硬件型号自适应抽象（AKP153 / AKP03 带旋钮 / StreamDock 15）。

---

## 🌟 v0.10.5 核心架构演进与深度优化

### 🔄 1. 状态与配置分离的单向数据流架构 (SpecStore + RuntimeStateStore)
- **解耦核心状态**：静态持久化配置与进程存活、窗口前后台、系统音量/静音、插件遥测等动态运行时彻底解耦；
- **纯函数计算渲染模型**：前后端共享 computeRenderModel(spec, runtimeState, globalState)，根治回弹动画覆盖角标、配置保存冲掉状态等同步难题。

### ⚡ 2. 彻底剥离「长按」延迟等待与 0ms 零延迟直通响应
- 针对 AKP153 单报文硬件协议，全链路移除 330ms/360ms 延迟等待定时器与长按误触发；
- 物理按键瞬发直通，敲击响应延迟缩减至 **0ms 零感知**。

### 🧵 3. 离屏 Dirty-Rect 差量合成管线与托盘零节流刷新
- **Dirty-Rect 差量管线**：通过 OffscreenCanvas Worker 结合帧哈希差量缓存（dirtyRectHashStore），仅重绘变化格子；
- **单格局部 DOM 刷新**：efreshSingleCell(row, col) 彻底消除滑块拖拽与高频遥测时的全屏渲染掉帧。

### 🎨 4. 可视化小组件图层编排工坊 (Widget Studio)
- **自由图层编排**：单格（1×1）或跨格宽屏（2×1 / 3×1）自由叠加 CPU、GPU、实时网速、声卡电平、历史趋势图与时钟图层；
- **多频独立调度**：支持为每个小组件独立配置 180ms 极速电平至 60s 慢速轮询的刷新周期。

### 🎛️ 5. 多设备型号自适应抽象 (Hardware Profile Adapter)
- 原生自适应 **AJAZZ AKP153 (5×3+3副屏)**、**AJAZZ AKP03 (3×2+3颗物理旋钮编码器)** 与 **StreamDock 15 标准版**；
- 一体式黑晶玻璃副屏拟物外框、三栏分段式检查器与平滑切页动效。

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
