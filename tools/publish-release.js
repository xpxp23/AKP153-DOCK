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
const RELEASE_NAME = `AKP153 控制台 v${PKG.version} (左侧页面管理栏 + 批量管理 + 彩色图标与调色盘 + Favicon抓取 + 角标互换)`;
const ZIP_NAME = `AKP153-Dock-v${PKG.version}-portable.zip`;
const ZIP_PATH = path.resolve(__dirname, '..', 'dist', ZIP_NAME);

const RELEASE_BODY = `# 🚀 AKP153 控制台 v${PKG.version} (左侧页面管理栏 + 批量管理 + 彩色图标与调色盘 + Favicon抓取 + 角标互换)

黑爵 AJAZZ AKP153 液晶控制台（Stream Dock 15键 + 3副屏）的独立驱动与图形化配置中心。

---

## 🌟 v0.4.0 六大体验升级与架构演进

### 📑 1. 页面管理 UI 重构为左侧独立垂直列 (Modern Page Rail)
- **空间垂直释放**：彻底移除挤压在顶部的横向页面栏，重塑为左侧现代三栏式独立垂直 Rail；
- **树形层级与键位统计**：直观展示顶层页（\`📄\`）与子页（\`📁\`），支持多层树状缩进、实时显示已配置键位统计（如 \`8/15\`）与当前高亮指示；
- **折叠与窄屏自适应**：支持点击顶部 \`[ ⇤ ]\` 一键折叠为 46px 紧凑 Mini-Rail，小窗口（1000×660）下自动紧凑排列，底部快捷操作（\`改名\`、\`复制\`、\`入库\`、\`删除\`）优雅自适应，彻底避免横向溢出。

### 🔁 2. 动态双态角标一键互换 & 动作协同联动 (Dynamic Badge Swap)
- **极简融洽胶囊**：外观面板双态编辑区内嵌精致小巧的 \`[ 🔁 互换角标 ]\`，点击即刻对调形态 1 与形态 2 的文字与背景颜色，并同步试切预览；
- **动作协同对调**：在动作面板的“互换动作条”旁增设轻量微型勾选框 \`[✓ 同时对调角标]\`，勾选后点击互换动作即可一键连同角标文字与色彩同步互换！

### 🌐 3. 网址 Favicon 智能抓取与本地 Base64 嵌入 (Website Favicon Fetcher)
- **一键提取**：当按键动作为“打开网址 (URL)”时，在目标网址框右上方显示蓝色微标 \`[ 🌐 抓取网站图标 ]\`；
- **三级容灾探测**：
  1. 第一梯队：轻量请求站点首页 HTML，正则提取 \`<link rel="apple-touch-icon">\` / \`<link rel="icon">\` 高清原图；
  2. 第二梯队：探测根路径 \`/favicon.ico\`；
  3. 第三梯队：防盗链与超时兜底调用高可用镜像节点；
- **离线持久化**：统一规整为 96×96 优质 PNG Data URL 直接存入按键配置，断网或离线环境下始终高清稳定。

### 🌈 4. 海量彩色图标扩充 + 矢量单色动态调色盘 (Rich Color Icons & Tinting)
- **双彩色大类**：
  - 🌈 **彩色通用**：显示器、笔记本电脑、双色文件夹、电池、灵感灯泡、通知铃铛、安全盾、火箭、折线图、游戏手柄、金属麦克风、相机、耳机、三色播放/暂停/停止、便签、咖啡杯等；
  - 🎨 **品牌应用**：微信、QQ、Steam、Chrome、B站、网易云音乐、VSCode、GitHub、Photoshop、Edge、Discord 等；
- **单色动态着色器**：底部配备 8 种高频前景色快捷圆点 + 任意 Hex 拾色器，点击任何单色图标可实时上色并嵌入按键。

### 📦 5. 按键库全功能批量管理 (Key Library Batch Management)
- 展开大面板顶部点击 \`[ ☑️ 批量管理 ]\`，进入安全多选态，卡片显式渲染半透明圆形勾选框，并屏蔽误拖拽；
- 底部滑出浮动操作栏：支持 \`[ 全选 / 清空 ]\`、\`[ 🏷️ 批量设标签 ]\`、\`[ 📤 批量导出 JSON ]\` 与 \`[ 🗑️ 批量删除 (带数量二次确认) ]\`。

### 🎨 6. 矢量图标库批量管理 (Icon Library Batch Management)
- 内置图标库点击 \`[ ☑️ 批量管理 ]\` 自动进入自定义图标多选模式；
- 浮动栏支持自定义图标的 \`[ 🏷️ 批量改分类 ]\`、\`[ 📤 批量导出图标包 ]\` 与 \`[ 🗑️ 批量删除 ]\`。

---

## 🌟 既有经典特性与亮点

### 🛠️ 全功能独立设置中心（Settings Modal）
- 模块化五大分类：硬件与屏幕（亮度、旋转、休眠模式、维护工具箱）、交互偏好（应用拖入双态策略、防抖滑块）、外观主题、配置备份导入导出、开机自启与托盘等。

### 📦 绿色免安装便携 (Zero-Dependency)
- 解压即用：内置独立运行时，无需在电脑上预装 Node.js 或任何开发环境，双击 \`AKP153 控制台.exe\` 秒开；
- 去隐私纯净模板：默认内置泛用生产力第一屏预设，解压即可直接体验；
- 内置 Agent 智能体技能：内嵌完整的 \`.agents/skills/akp153-streamdock/SKILL.md\`，方便 AI 智能体识别接管与自动化编排。

### ⌨️ 三合一免冲突快捷键构建器
- 4 颗独立修饰键胶囊 (Ctrl/Alt/Shift/Win) + 快选网格，鼠标点选零击键生成，100% 避免后台软件热键冲突；
- 交互式物理录制器与复合动作宏全面支持。

### 🛡️ 休眠唤醒双层守卫与硬件自愈
- 休眠首击仅唤醒屏幕不误触业务动作，带 100ms 唤醒连击防抖冷却；
- 覆盖全部 4 种硬件休眠模式，支持 USB 热插拔自愈。

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
