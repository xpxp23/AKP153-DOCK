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
const RELEASE_NAME = `AKP153 控制台 v${PKG.version} (文字图标工坊 + 硬件真彩双角标根治 + 任务栏窗口模式重构 + RuntimeStateStore单向数据流 + 0ms直通)`;
const ZIP_NAME = `AKP153-Dock-v${PKG.version}-portable.zip`;
const ZIP_PATH = path.resolve(__dirname, '..', 'dist', ZIP_NAME);

const RELEASE_BODY = `# 🚀 AKP153 控制台 v${PKG.version}

黑爵 AJAZZ AKP153 液晶控制台（Stream Dock 15键 + 3副屏）的独立驱动与图形化配置中心。
此版本重磅推出内置「文字图标工坊 (Text Icon Studio)」、硬件真彩一大一小双角标与重影彻底隔离根治、任务栏窗口模式主窗口记忆与托盘唤醒加固、配置与状态分离的单向数据流架构（RuntimeStateStore）、0ms 零延迟物理按键直通响应、离屏 Dirty-Rect 差量合成管线以及可视化小组件图层编排工坊（Widget Studio）。

---

## 🌟 v0.10.6 核心特性与架构升级

### 🔤 1. 内置「文字图标工坊 (Text Icon Studio)」
- **8 套精调视觉模板**：极简毛玻璃、赛博霓虹、3D 机械键帽、双行胶囊、印章徽标、流光渐变字、终端代码、环形徽标；
- **全要素可定制**：支持主/副双行文字、4 类字体族、8 套主题色板、自由色轮取色、圆角与字号精细调节；
- **透明底色模式**：支持将背景设为透明，完美透出整板流光渐变壁纸；
- **持久化二次回填**：无损持久化 \`spec.textIconConfig\`，再次点击时自动回填先前所有样式参数。

### 🖥️ 2. 彻底根治「硬件真彩 (hwMirrorEnabled)」双角标与文字重影
- **DOM 与 Canvas 双重隔离**：当启用 1:1 硬件真彩 Canvas 实时预览时，通过 DOM 渲染层与 CSS \`.cell.has-canvas\` 自动跳过并隐藏冗余的 DOM \`.badge-overlay\`、\`.thumb\`、\`.glyph\` 与 \`.cap\`；
- **唯一硬件级角标呈现**：角标在离屏 Canvas 阶段按物理分辨率 1:1 绘制并同步镜像，彻底消除一大一小重影与闪烁。

### 🪟 3. 重构「任务栏窗口模式 (window)」与模式切换自动清洗
- **主窗口句柄记忆池**：在 \`native-input.cs\` 中新增 \`_lastKnownMainHwnd\`、根窗口安全最小化保护与二阶段托盘隐藏主窗口唤醒（\`SW_SHOW + SW_RESTORE\`），并在 \`runner.js\` 中增加完整路径兜底拉起，彻底解决按一下软件消失找不到的死锁；
- **模式切换自动清洗与存量自愈**：切换同步模式/动作类型时自动清洗残留的 \`window_toggle\` 动作与「前台/后台」角标，恢复默认干净状态。

### 🔄 4. 状态与配置分离的单向数据流架构 (SpecStore + RuntimeStateStore)
- **解耦核心状态**：静态持久化配置与进程存活、窗口前后台、系统音量/静音、插件遥测等动态运行时彻底解耦；
- **纯函数计算渲染模型**：前后端共享 \`computeRenderModel(spec, runtimeState, globalState)\`，根治回弹动画覆盖角标、配置保存冲掉状态等同步难题。

### ⚡ 5. 彻底剥离「长按」延迟等待与 0ms 零延迟直通响应
- 针对 AKP153 单报文硬件协议，全链路移除 330ms/360ms 延迟等待定时器与长按误触发；
- 物理按键瞬发直通，敲击响应延迟缩减至 **0ms 零感知**。

### 🧵 6. 离屏 Dirty-Rect 差量合成管线与托盘零节流刷新
- **Dirty-Rect 差量管线**：通过 OffscreenCanvas Worker 结合帧哈希差量缓存（\`dirtyRectHashStore\`），仅重绘变化格子；
- **单格局部 DOM 刷新**：\`refreshSingleCell(row, col)\` 彻底消除滑块拖拽与高频遥测时的全屏渲染掉帧。

### 🎨 7. 可视化小组件图层编排工坊 (Widget Studio)
- **自由图层编排**：单格（1×1）或跨格宽屏（2×1 / 3×1）自由叠加 CPU、GPU、实时网速、声卡电平、历史趋势图与时钟图层；
- **多频独立调度**：支持为每个小组件独立配置 180ms 极速电平至 60s 慢速轮询的刷新周期。

### 🎛️ 8. 多设备型号自适应抽象 (Hardware Profile Adapter)
- 原生自适应 **AJAZZ AKP153 (5×3+3副屏)**、**AJAZZ AKP03 (3×2+3颗物理旋钮编码器)** 与 **StreamDock 15 标准版**；
- 一体式黑晶玻璃副屏拟物外框、三栏分段式检查器与平滑切页动效。

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
