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
const RELEASE_NAME = `AKP153 控制台 v${PKG.version} (全新独立设置中心 + 双态动作解耦 + 绿色便携版)`;
const ZIP_NAME = `AKP153-Dock-v${PKG.version}-portable.zip`;
const ZIP_PATH = path.resolve(__dirname, '..', 'dist', ZIP_NAME);

const RELEASE_BODY = `# 🚀 AKP153 控制台 v${PKG.version} (全新独立设置中心 + 双态动作解耦 + 绿色便携版)

黑爵 AJAZZ AKP153 液晶控制台（Stream Dock 15键 + 3副屏）的独立驱动与图形化配置中心。

---

## 🌟 v0.3.0 重大架构与功能升级

### 🛠️ 1. 全功能独立设置中心（Settings Modal）
- **现代化分栏模态弹窗**：点击顶栏 \`⚙️ 设置\` 呼出居中 780×580px 大弹窗，支持毛玻璃遮罩、遮罩点击与 \`Esc\` 极速关闭；
- **五大系统级专业配置模块**：
  - **📟 硬件与屏幕**：背光亮度滑块、屏幕物理旋转（逆时针90°/顺时针90°/不旋转）、无操作自动休眠延时、4 种硬件级休眠模式选择，以及专属的【设备维护工具箱】（一键唤醒、休眠、重连、全屏重画）；
  - **⚡ 交互偏好**：应用拖入默认策略（自动创建启动/退出双态 vs 普通单一启动）、物理按键微动连击防抖时间滑块（50~300ms）；
  - **🎨 外观与主题**：一键切换极光白（默认浅色）与钛空黑（深色金属质感）；
  - **💾 备份与数据**：整机完整配置一键导出备份（.json）、一键导入恢复备份、定位本地存储目录、安全恢复出厂设置；
  - **🛠️ 系统与关于**：Windows 开机自启、关闭窗口时最小化到托盘偏好、原厂驱动（AJAZZ Stream Dock）开机自启冲突检测与一键修复、版本与开源链接。

### ⚡ 2. 双态独立动作卡片 & 一键互换 (Swap Actions)
- **UI 架构彻底解耦**：双态动作配置从外观选项卡剥离，动作选项卡顶部提供 \`[ 🟢 单一动作 ]\` 与 \`[ ⚡ 双态独立动作 ]\` 二段胶囊开关；
- **形态 1 / 形态 2 独立卡片**：开启双态时展示高亮绿/红形态卡片，支持独立配置应用、命令或快捷键；
- **一键互换动作**：卡片间提供 \`[ 🔁 互换形态 1 与形态 2 动作 ]\` 按钮，一键对调两态执行动作，角标与色彩保持原位不变；
- **应用拖入自动双态闭环**：拖入或选择应用（.exe / .lnk）默认自动配置启动与退出闭环（形态 1 启动应用，形态 2 强制静默退出，形态 1 默认无遮挡，形态 2 点亮 \`🟢 运行中\` 绿色指示灯）。

### 🚫 3. 角标三态胶囊控制（一键彻底去除角标）
- **三段式模式选择器**：\`[ 🚫 无角标 ]\` / \`[ 📌 静态角标 ]\` / \`[ ⚡ 动态双态 ]\`；
- **一键彻底清空**：点击“无角标”立即清空静态角标与双态文字并收起配置区，彻底杜绝配置残留；
- **动态预设补充**：动态预设首位新增 \`🚫 清空 / 无角标\` 快捷胶囊；
- **液晶 LCD 96×96 测绘自适应**：Canvas 绘制自适应动态测算文字宽度，完美支持多汉字角标居中渲染。

### 🧹 4. 顶栏深度精简与视觉降噪
- 移除了此前常驻顶栏的 \`唤醒屏幕\`、\`休眠屏幕\`、\`重连设备\` 3 颗低频维护按钮（统一收纳进设置中心的维护工具箱）；
- 顶栏右侧仅保留 \`[ ⚙️ 设置 ]\` 与窗口控制按钮，大幅提升工作台清爽度与留白美感。

## 🌟 既有经典特性与亮点

### 📦 绿色免安装便携 (Zero-Dependency)
- **解压即用**：内置独立运行时，无需在电脑上预装 Node.js 或任何开发环境，双击 \`AKP153 控制台.exe\` 秒开；
- **去隐私纯净模板**：默认内置泛用生产力第一屏预设（系统工具、终端、计算器、常用网址等），解压即可直接体验；
- **内置 Agent 智能体技能**：内嵌完整的 \`.agents/skills/akp153-streamdock/SKILL.md\`，方便 AI 智能体识别接管与自动化编排。

### ⌨️ 三合一免冲突快捷键构建器
- **免冲突点选面板（零击键 · 核心解药）**：
  - 提供 \`[ Ctrl ]\` \`[ Alt ]\` \`[ Shift ]\` \`[ Win ]\` 4 颗独立高亮修饰键胶囊；
  - 搭配 F1~F12、A~Z、常用导航/编辑键分类快选网格；
  - 鼠标点选 \`[Alt]\` + \`[Shift]\` 胶囊，再点一下 \`[F10]\`，立即生成标准的 \`Alt+Shift+F10\`；
  - **全程无需在物理键盘上按压，100% 避免被后台软件（如 IntelliJ IDEA、OBS 等）注册的系统级全局热键拦截霸占**！
- **交互式物理录制器**：点击录制进入脉冲高亮状态，按键捕获沙箱阻止系统菜单激活，支持 \`Esc\` 安全取消；
- **复合宏全面同步**：在“模拟快捷键”子动作中全面嵌入同一套构建器。

### 🎨 工业级微米机身质感与无缝流光
- **整板无缝渐变**：支持横跨 15 键 + 3 块副屏的 600%×300% 连贯流光效果；
- **深色模式深空钛金外壳**：微渐变阳极氧化材质，带 1px 倒角高光切线与环境漫反射发光；
- **硬件水晶键帽透光**：按键浮动、微高光反光与机械触感微回缩反馈；
- **现代化文字色二段胶囊**：\`[ 自动对比色 ]\` 与 \`[ 自定义色彩 ]\`，集成拾色器与 6 颗高对比快选色点。

### 🛡️ 休眠唤醒双层守卫与硬件自愈
- **休眠首击仅唤醒屏幕**：Host 硬件层与 Main 业务层双重拦截，休眠时按任意键仅点亮屏幕，绝不误触发业务动作或弹窗；
- **100ms 唤醒冷却防抖保护期**：有效吸收微动开关弹跳与连击误穿透；
- **全模式支持**：覆盖全部 4 种硬件休眠模式（关背光断电、只切黑屏、厂商规范、微光节能）；
- **USB 热插拔自愈**：拔掉重新插回自动识别新句柄并硬复位 LCD 流水线。

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
