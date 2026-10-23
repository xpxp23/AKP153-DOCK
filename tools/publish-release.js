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
const RELEASE_NAME = `AKP153 控制台 v${PKG.version} (1:1真彩像素管线 + 靶心视窗雷达拾取 + 1×3全景副屏 + 瞬态按住切层 + VM沙箱)`;
const ZIP_NAME = `AKP153-Dock-v${PKG.version}-portable.zip`;
const ZIP_PATH = path.resolve(__dirname, '..', 'dist', ZIP_NAME);

const RELEASE_BODY = `# 🚀 AKP153 控制台 v${PKG.version}

黑爵 AJAZZ AKP153 液晶控制台（Stream Dock 15键 + 3副屏）的独立驱动与图形化配置中心。
此版本重磅推出默认 1:1 硬件真彩 Canvas 像素镜像管线、原生靶心跨程序视窗雷达与吸管拾取器、1×3 一体式副屏全景可视化画布、文字图标工坊 2.0、瞬态按住切层（Hold-to-Layer）、遥测插件 Node.js VM 沙箱隔离以及低功耗帧率预算与动态总线带宽保护。

---

## 🌟 v0.11.0 核心特性与架构升级

### 🖥️ 1. 1:1 硬件真彩 Canvas 像素管线与全屏统一渲染 (1:1 Canvas Pipeline)
- **100% 所见即所得**：默认开启 1:1 硬件真彩 Canvas 镜像预览，物理面板旋转与 JPEG 压缩管线直接映射至前台高保真 Canvas，彻底消除窗口缩放导致的文字截断与不对齐；
- **离屏合成与零闪烁**：硬件级角标与图标在离屏 Canvas 阶段按物理分辨率 1:1 绘制并同步镜像，消除重影与闪烁。

### 🪟 2. 靶心跨程序视窗雷达与可视化吸管拾取器 (Window Picker & Radar)
- **原生靶心穿透拾取**：在 \`native-input.cs\` 中实现原生无焦点穿透高亮框（\`CrosshairPickerForm\`），点击界面吸管即可交互式点选屏幕上任意前台/后台程序；
- **多维雷达侦测**：瞬间提取进程名、Win32 窗口类名、完整 Exe 文件路径、主窗口标题以及同名伴生进程，彻底解决多窗口进程绑定错漏；
- **屏幕像素取色**：支持交互式屏幕像素取色（RGB / Hex 取色器）。

### 🎛️ 3. 1×3 副屏一体全景可视化画布 (1×3 Panorama Strip)
- **突破副屏物理隔离**：支持将右侧 3 块 80×80 副屏虚拟拼接为一体式 80×240 宽幅全景画布；
- **宽幅动效与电平表**：支持 VU Meter 动效瀑布流、频谱分析与全景系统态势流转。

### 🎨 4. 文字图标工坊 2.0 (Text Icon Studio 2.0)
- **高保真微渐变字形**：全面强化文字图标工坊排版引擎，支持自由边框圆角、字体族选择与色彩搭配；
- **透明穿透流光壁纸**：支持背景设为透明，完美透出整板流光渐变壁纸；
- **100% 满格无黑边图片裁剪**：支持满格铺满与自由缩放（25%~115%），二次点击无损回填编辑。

### ⚡ 5. 瞬时按住切层 (Hold-to-Layer / Momentary Switch)
- **Fn 层瞬态逻辑**：扩展按键动作模型，支持「按住切换至临时层/副页面，松开物理按键自动返回原页面」，实现类似高级机械键盘的瞬态 Fn 层。

### 🛡️ 6. 插件 VM 沙箱隔离与容错运行 (VM Sandbox)
- **受控沙箱执行**：遥测插件在 Node.js \`vm\` 沙箱中受控运行，捕获所有同步与异步异常，严防插件恶意脚本或内存泄漏崩溃宿主进程。

### 🌊 7. 低功耗帧率预算控制器与动态总线带宽保护
- **功耗帧率预算**：单键循环动效默认限制在 8~12 FPS（瞬态按压回弹允许最高 18 FPS）；
- **动态总线保护**：同屏多 GIF 激活时自动动态拉大帧间隔，单次 Tick 最多推送 4 颗动效键，绝不阻塞物理按键响应。

### 🏝️ 8. 桌面悬浮毛玻璃 OSD 灵动岛胶囊位置自定义
- 设置中支持一键切换 OSD 灵动岛胶囊出现于屏幕底部中央（默认）或顶部中央。

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
