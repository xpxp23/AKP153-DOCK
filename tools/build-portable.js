'use strict';
/**
 * build-portable.js —— 一键生成绿色免安装 AKP153 便携版 Zip 包
 *
 * 核心产出：
 *   1. dist/AKP153-Dock/ （解压即用的绿色运行目录，内含独立「AKP153 控制台.exe」）
 *   2. dist/AKP153-Dock-v0.1.0-portable.zip （高压缩便携分享压缩包）
 *
 * 绿色特性：
 *   - 剔除开发者的任何个人隐私配置，以纯净的通用生产力模板（config.default.json）作为初始状态；
 *   - 内置 Electron 运行时，目标机器无需安装 Node.js 或环境依赖，双击秒开；
 *   - 内嵌完整 Agent 技能（.agents/skills/akp153-streamdock/）与 CLI（tools/config-cli.js），便于任意 Agent 识别接管。
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const PKG = require(path.join(ROOT, 'package.json'));
const DIST = path.join(ROOT, 'dist');
const STAGE = path.join(DIST, 'AKP153-Dock');
const ZIP_NAME = `AKP153-Dock-v${PKG.version}-portable.zip`;
const ZIP_PATH = path.join(DIST, ZIP_NAME);

function log(...args) {
  console.log('[PORTABLE-BUILD]', ...args);
}

function copyDirSync(src, dst, filter) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dst, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const dstPath = path.join(dst, entry.name);
    if (filter && !filter(srcPath, entry)) continue;
    if (entry.isDirectory()) {
      copyDirSync(srcPath, dstPath, filter);
    } else {
      fs.copyFileSync(srcPath, dstPath);
    }
  }
}

function run() {
  log('开始构建 AKP153 绿色便携免安装版...');

  // 1. 清理旧产物
  if (fs.existsSync(STAGE)) {
    log('清理旧构建目录:', STAGE);
    fs.rmSync(STAGE, { recursive: true, force: true });
  }
  if (fs.existsSync(ZIP_PATH)) {
    fs.rmSync(ZIP_PATH, { force: true });
  }
  fs.mkdirSync(STAGE, { recursive: true });

  // 2. 复制 Electron 运行时
  const electronDist = path.join(ROOT, 'node_modules', 'electron', 'dist');
  if (!fs.existsSync(electronDist)) {
    throw new Error('未找到 Electron 运行时: ' + electronDist);
  }
  log('复制独立 Electron 运行核心...');
  copyDirSync(electronDist, STAGE, (filePath, entry) => {
    // 排除 default_app.asar，我们将注入自己的 app 目录
    if (filePath.endsWith('default_app.asar')) return false;
    return true;
  });

  // 重命名主入口为「AKP153 控制台.exe」
  const electronExe = path.join(STAGE, 'electron.exe');
  const appExe = path.join(STAGE, 'AKP153 控制台.exe');
  if (fs.existsSync(electronExe)) {
    fs.renameSync(electronExe, appExe);
    log('已生成独立主程序 -> AKP153 控制台.exe');
  }

  // 3. 构建 app 代码目录
  const appDir = path.join(STAGE, 'resources', 'app');
  fs.mkdirSync(appDir, { recursive: true });

  log('注入应用核心代码 (src, host, assets, bin)...');
  copyDirSync(path.join(ROOT, 'src'), path.join(appDir, 'src'));
  copyDirSync(path.join(ROOT, 'host'), path.join(appDir, 'host'));
  copyDirSync(path.join(ROOT, 'assets'), path.join(appDir, 'assets'));
  copyDirSync(path.join(ROOT, 'bin'), path.join(appDir, 'bin'));
  copyDirSync(path.join(ROOT, 'bin'), path.join(STAGE, 'bin'));

  // 复制 package.json
  const pkgContent = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  // 精简 package.json 供运行时读取
  delete pkgContent.devDependencies;
  fs.writeFileSync(path.join(appDir, 'package.json'), JSON.stringify(pkgContent, null, 2), 'utf8');

  // 复制干净的默认配置模板（绝不带个人隐私）
  const defConfigSrc = path.join(ROOT, 'config.default.json');
  if (fs.existsSync(defConfigSrc)) {
    fs.copyFileSync(defConfigSrc, path.join(appDir, 'config.default.json'));
    // 同时作为初始 config.json，确保开箱即用展示第一页常用操作
    fs.copyFileSync(defConfigSrc, path.join(appDir, 'config.json'));
    log('已注入无隐私纯净默认生产力按键模板 (config.default.json & config.json)');
  }

  // 4. 复制生产运行时必需的 node_modules
  log('注入运行时原生模块与生产依赖 (jpeg-js, jsqr, node-hid, pkg-prebuilds, node-addon-api)...');
  const appNodeModules = path.join(appDir, 'node_modules');
  fs.mkdirSync(appNodeModules, { recursive: true });

  const PROD_MODULES = ['jpeg-js', 'jsqr', 'node-hid', 'pkg-prebuilds', 'node-addon-api'];
  for (const mod of PROD_MODULES) {
    const srcMod = path.join(ROOT, 'node_modules', mod);
    const dstMod = path.join(appNodeModules, mod);
    if (!fs.existsSync(srcMod)) {
      throw new Error(`缺少生产运行时依赖: ${mod}，请先执行 npm install`);
    }
    log(`  - 复制模块: ${mod}`);
    copyDirSync(srcMod, dstMod, (filePath) => {
      // 裁剪掉 darwin / linux 等跨平台二进制以大幅缩减体积，仅保留 win32-x64 和 win32-ia32
      if (filePath.includes('prebuilds') && (
        filePath.includes('darwin') ||
        filePath.includes('linux') ||
        filePath.includes('arm')
      )) {
        return false;
      }
      return true;
    });
  }

  // 验证关键运行模块完整性，避免异机启动时抛 Cannot find module 'pkg-prebuilds/bindings'
  const checkBindings = path.join(appNodeModules, 'pkg-prebuilds', 'bindings.js');
  const checkNodeHid = path.join(appNodeModules, 'node-hid', 'nodehid.js');
  const checkJsqr = path.join(appNodeModules, 'jsqr', 'dist', 'jsQR.js');
  const checkJpeg = path.join(appNodeModules, 'jpeg-js', 'index.js');
  if (!fs.existsSync(checkBindings) || !fs.existsSync(checkNodeHid) || !fs.existsSync(checkJsqr) || !fs.existsSync(checkJpeg)) {
    throw new Error('便携版关键依赖完整性校验失败，请检查 node_modules 构建！');
  }
  log('关键依赖完整性校验通过 (pkg-prebuilds, node-hid, jsqr, jpeg-js)');

  // 5. 注入 Agent Skill 与 CLI 工具
  log('注入 Agent Skill 与 CLI 工具...');
  const stageTools = path.join(STAGE, 'tools');
  fs.mkdirSync(stageTools, { recursive: true });
  fs.copyFileSync(path.join(ROOT, 'tools', 'config-cli.js'), path.join(stageTools, 'config-cli.js'));

  // 同时在 appDir 内留一份，方便相对路径引用
  fs.mkdirSync(path.join(appDir, 'tools'), { recursive: true });
  fs.copyFileSync(path.join(ROOT, 'tools', 'config-cli.js'), path.join(appDir, 'tools', 'config-cli.js'));

  const skillDst = path.join(STAGE, '.agents', 'skills', 'akp153-streamdock');
  fs.mkdirSync(skillDst, { recursive: true });
  const skillSrc = path.join(ROOT, '..', '.agents', 'skills', 'akp153-streamdock', 'SKILL.md');
  if (fs.existsSync(skillSrc)) {
    fs.copyFileSync(skillSrc, path.join(skillDst, 'SKILL.md'));
    log('已注入 Agent Skill -> .agents/skills/akp153-streamdock/SKILL.md');
  }

  // 6. 生成便利批处理与使用说明
  const batContent = `@echo off
chcp 65001 >nul
cd /d "%~dp0"
start "" "AKP153 控制台.exe"
`;
  fs.writeFileSync(path.join(STAGE, '启动 AKP153 控制台.bat'), batContent, 'utf8');

  const readmeContent = `========================================================================
  黑爵 AJAZZ AKP153 液晶控制台 - 绿色免安装便携版 (v${PKG.version})
========================================================================

【如何运行】
1. 解压此压缩包至任意目录（推荐路径不包含特殊符号）；
2. 插入 AKP153 设备 USB 数据线；
3. 直接双击运行「AKP153 控制台.exe」（或「启动 AKP153 控制台.bat」）即可！
4. 免安装 Node.js、免配置环境、无注册表残留。

【预置特色】
✓ 默认内置纯净通用的第一屏生产力预设（显示桌面、切窗口、资源管理、任务管理、剪贴板、截图、锁屏、音量控制等）；
✓ 3 块副屏默认配备实时时钟、CPU 动态仪表监控与内存占用动态监控；
✓ 默认开启高颜值科技感整板暗夜蓝金全景流光（跨 15 键 + 3 块副屏连贯渲染）；
✓ 驱动级复合动作队列与宏编辑器（支持多操作编排、1ms 原生鼠标移动/点击/拖拽/滚轮、Unicode 文本键入、窗口尺寸归一化、连点循环）；
✓ 跨电脑便携引擎（自动解析注册表 App Paths 与协议，支持 %DOCK_DIR% 相对路径，异机即插即用）；
✓ 内置三重防卡死安全熔断机制（Ctrl+Alt+Escape 或 Pause 紧急熔断，物理按键双向 LCD RUN 徽章与开关控制）；
✓ 支持任意文件、应用快捷方式、网页、文件夹直接拖拽入格子；
✓ 内置精选矢量图标库、图片 1:1 智能裁剪压缩器与微标角标系统；
✓ 支持开机自启（自动排查与治理原厂驱动占用冲突）。

【AI Agent 智能接管】
- 本目录自带标准 Agent 技能定义：.agents\\skills\\akp153-streamdock\\SKILL.md
- 任意现代 Agent（Antigravity、Claude Code、Cursor、Windsurf 等）打开该目录即可直接自动识别；
- 目标电脑即使未安装 Node.js，亦可使用自带执行程序免环境运行 CLI：
    $env:ELECTRON_RUN_AS_NODE="1"; & ".\\AKP153 控制台.exe" tools/config-cli.js show
========================================================================
`;
  fs.writeFileSync(path.join(STAGE, '使用说明与分享指南.txt'), readmeContent, 'utf8');

  // 7. 压缩为绿色便携版 Zip 包
  log('正在将绿色便携目录压缩为 Zip 包 ->', ZIP_NAME);
  const psCmd = `Compress-Archive -Path "${STAGE}\\*" -DestinationPath "${ZIP_PATH}" -Force`;
  const zipRes = spawnSync('powershell.exe', ['-NoProfile', '-Command', psCmd], { stdio: 'inherit' });
  if (zipRes.status !== 0) {
    throw new Error('压缩 Zip 失败，退出码: ' + zipRes.status);
  }

  const zipStat = fs.statSync(ZIP_PATH);
  const sizeMb = (zipStat.size / (1024 * 1024)).toFixed(1);
  log(`✅ 构建成功！便携绿色压缩包已生成: ${ZIP_PATH} (${sizeMb} MB)`);
  log(`解压即用目录: ${STAGE}`);
}

try {
  run();
} catch (err) {
  console.error('构建失败:', err);
  process.exit(1);
}
