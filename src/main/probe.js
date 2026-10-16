'use strict';
/**
 * probe.js - AKP153 跨机便携化路径展开与智能软件探针
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const DOCK_DIR = path.resolve(__dirname, '..', '..');

// 缓存探针结果（含未命中负缓存），避免在后台 2s 状态轮询中重复拉起 reg.exe 造成主进程卡顿
const probeCache = new Map();

/**
 * 展开路径中的环境宏与内部宏占位符
 */
function expandPath(str) {
  if (!str || typeof str !== 'string') return '';
  let s = str.trim();

  // 内部宏：驱动根目录
  s = s.replace(/%DOCK_DIR%/gi, DOCK_DIR);

  // Windows 标准系统环境变量宏
  s = s.replace(/%([^%]+)%/g, (_, name) => {
    return process.env[name] || process.env[name.toUpperCase()] || `%${name}%`;
  });

  // 如果非协议且非绝对路径，优先尝试相对 user-scripts、DOCK_DIR 或系统 System32 目录
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(s) && !path.isAbsolute(s)) {
    const inUserScripts = path.join(DOCK_DIR, 'user-scripts', s);
    if (fs.existsSync(inUserScripts)) return inUserScripts;
    const inDock = path.join(DOCK_DIR, s);
    if (fs.existsSync(inDock)) return inDock;

    if (process.platform === 'win32') {
      const winDir = process.env.SystemRoot || process.env.WINDIR || 'C:\\Windows';
      const hasExt = !!path.extname(s);
      const sysCandidates = [
        path.join(winDir, 'System32', hasExt ? s : s + '.exe'),
        path.join(winDir, hasExt ? s : s + '.exe'),
        path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'WindowsApps', hasExt ? s : s + '.exe'),
      ];
      for (const cand of sysCandidates) {
        if (cand && fs.existsSync(cand)) return cand;
      }
    }
  }

  return s;
}

/**
 * 查询 Windows App Paths 注册表（采用参数化 spawnSync 替代 shell 字符串拼接）
 */
function queryAppPaths(exeName) {
  if (!exeName || process.platform !== 'win32') return null;
  const targetName = exeName.toLowerCase().endsWith('.exe') ? exeName : exeName + '.exe';

  const hives = [
    `HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\${targetName}`,
    `HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\${targetName}`,
    `HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\App Paths\\${targetName}`,
  ];

  for (const hive of hives) {
    try {
      const r = spawnSync('reg.exe', ['query', hive, '/ve'], {
        encoding: 'utf8',
        windowsHide: true,
        timeout: 1200,
      });
      if (r.status === 0 && r.stdout) {
        const m = r.stdout.match(/REG_SZ\s+(.+)/i);
        if (m && m[1]) {
          const candidate = m[1].trim().replace(/^"(.*)"$/, '$1');
          if (fs.existsSync(candidate)) return candidate;
        }
      }
    } catch (_) {}
  }
  return null;
}

/**
 * 常见软件多盘符与注册表内置指纹库
 */
const KNOWN_FINGERPRINTS = {
  steam: () => {
    try {
      const r = spawnSync('reg.exe', ['query', 'HKCU\\Software\\Valve\\Steam', '/v', 'SteamExe'], {
        encoding: 'utf8',
        windowsHide: true,
        timeout: 1200,
      });
      if (r.status === 0 && r.stdout) {
        const m = r.stdout.match(/SteamExe\s+REG_SZ\s+(.+)/i);
        if (m && m[1]) {
          const p = m[1].trim().replace(/\//g, '\\');
          if (fs.existsSync(p)) return p;
        }
      }
    } catch (_) {}
    const candidates = [
      'F:\\Game Program\\Steam\\steam.exe',
      'C:\\Program Files (x86)\\Steam\\steam.exe',
      'C:\\Program Files\\Steam\\steam.exe',
      'D:\\Steam\\steam.exe',
      'E:\\Steam\\steam.exe',
    ];
    return candidates.find(c => fs.existsSync(c)) || null;
  },
  leigod: () => {
    const candidates = [
      'C:\\Program Files (x86)\\LeiGod_Acc\\leigod.exe',
      'C:\\Program Files\\LeiGod_Acc\\leigod.exe',
      'D:\\LeiGod_Acc\\leigod.exe',
      'E:\\LeiGod_Acc\\leigod.exe',
      'C:\\Program Files (x86)\\LeiGod_Acc\\leigod_launcher.exe',
    ];
    return candidates.find(c => fs.existsSync(c)) || null;
  },
  ts3: () => {
    const candidates = [
      'C:\\Program Files\\TeamSpeak 3\\ts3client_win64.exe',
      'C:\\Program Files (x86)\\TeamSpeak 3\\ts3client_win64.exe',
      'D:\\TeamSpeak 3\\ts3client_win64.exe',
    ];
    return candidates.find(c => fs.existsSync(c)) || null;
  },
  ts3client_win64: () => KNOWN_FINGERPRINTS.ts3(),
  teamspeak: () => KNOWN_FINGERPRINTS.ts3(),
  teamspeak3: () => KNOWN_FINGERPRINTS.ts3(),
  leigod_launcher: () => KNOWN_FINGERPRINTS.leigod(),
  vscode: () => {
    const candidates = [
      expandPath('%LOCALAPPDATA%\\Programs\\Microsoft VS Code\\Code.exe'),
      'C:\\Program Files\\Microsoft VS Code\\Code.exe',
      'C:\\Program Files (x86)\\Microsoft VS Code\\Code.exe',
    ];
    return candidates.find(c => fs.existsSync(c)) || null;
  },
};

/**
 * 软件全自动智能探针
 * @param {string} target 路径、进程名、协议或探针代号
 * @returns {string} 可直接唤起的有效路径或协议
 */
function probeApp(target) {
  if (!target) return '';
  const trimmed = target.trim();

  // 1. 如果是标准 URL 协议（如 steam://open/main, https://...），直接返回
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed)) {
    return trimmed;
  }

  // 2. 检查缓存（包含已解析路径与负缓存，防止轮询风暴）
  if (probeCache.has(trimmed)) {
    return probeCache.get(trimmed);
  }

  // 3. 展开宏路径（含 System32 系统自带工具自动识别），如果直接存在，命中
  const expanded = expandPath(trimmed);
  if (fs.existsSync(expanded)) {
    probeCache.set(trimmed, expanded);
    return expanded;
  }

  // 4. 提取基准文件名（去除路径和拓展名），查找指纹库
  const baseName = path.basename(trimmed, path.extname(trimmed)).toLowerCase();
  if (KNOWN_FINGERPRINTS[baseName]) {
    const hit = KNOWN_FINGERPRINTS[baseName]();
    if (hit) {
      probeCache.set(trimmed, hit);
      return hit;
    }
  }

  // 5. 注册表 App Paths 检索
  const regHit = queryAppPaths(path.basename(trimmed));
  if (regHit) {
    probeCache.set(trimmed, regHit);
    return regHit;
  }

  // 6. 未找到时同样记入缓存，避免每 2 秒后台状态轮询反复拉起 3 个 reg.exe 子进程阻塞主线程
  probeCache.set(trimmed, expanded);
  return expanded;
}

module.exports = {
  DOCK_DIR,
  expandPath,
  probeApp,
};
