---
name: akp153-streamdock
description: >-
  Manage, configure, and customize the Ajazz AKP153 (Hotspot/Mirabox Stream Dock) macro pad.
  Use whenever the user mentions AKP153, Stream Dock, streamdeck macro pad, changing key functions,
  updating button icons, configuring AI prompts, audio switching, modifying device layouts,
  adjusting gradients, setting hotkeys, or monitoring system metrics.
---

# AKP153 控制台（akp153-dock）Agent 自动化与配置规范

本技能专门用于自动化管理与配置 **黑爵 AJAZZ AKP153** 液晶控制台（15 个可按 LCD 屏幕按键 + 3 块右侧条形 LCD 显示副屏）。

驱动基于自研的 **`akp153-dock`**（Electron + 独立 Node HID 驱动进程 `host/device-host.js`），支持原子化落盘（`config.json`）并在 1 秒内无感热重载渲染硬件，**无需重启驱动即可秒级生效**。

---

## 📐 硬件矩阵坐标与布局 (Grid Matrix)

控制台采用标准 3 行 × 5 列主按键区 + 3 块右侧状态屏：

```
+---------------+---------------+---------------+---------------+---------------+   +---------------+
|     r0c0      |     r0c1      |     r0c2      |     r0c3      |     r0c4      |   |    strip 0    | (副屏1·顶部)
+---------------+---------------+---------------+---------------+---------------+   +---------------+
|     r1c0      |     r1c1      |     r1c2      |     r1c3      |     r1c4      |   |    strip 1    | (副屏2·中间)
+---------------+---------------+---------------+---------------+---------------+   +---------------+
|     r2c0      |     r2c1      |     r2c2      |     r2c3      |     r2c4      |   |    strip 2    | (副屏3·底部)
+---------------+---------------+---------------+---------------+---------------+   +---------------+
| <----------------- 15 颗物理可按 LCD 按键 (96x96) -----------------> | < 3块侧显示屏 (80x80) > |
```

> [!NOTE]
> 在**子页面**（Folder/Subpage）中，`r2c4`（右下角）为固定的系统返回键 `←`，用于返回上一级，Agent 配置子页面时尽量避免将关键操作分配在 `r2c4`。

---

## 🛠️ Agent 命令行工具：`tools/config-cli.js`

Agent 应始终优先通过驱动目录下的 `tools/config-cli.js` 执行查询与配置，无需手动手写复杂的 JSON，且命令会自动进行原子保存并触发热重载：

工作目录：`E:\项目\AiProgram\akp153-dock\`（便携版解压根目录下同理）

> [!TIP]
> **免 Node.js 环境调用技巧**：如果目标电脑未安装 Node.js，Agent 或脚本可通过自带控制台 exe 直接执行 CLI：
> ```powershell
> $env:ELECTRON_RUN_AS_NODE="1"; & ".\AKP153 控制台.exe" tools/config-cli.js show --json
> ```

### 1. 查询当前配置与状态
```powershell
node tools/config-cli.js show
# 机器可读 JSON 输出
node tools/config-cli.js show --json
```

### 2. 设置单个按键 (`set`)
```powershell
# 1. 应用程序 / 快捷方式 (支持 .exe, .lnk，会自动提取高清图标)
node tools/config-cli.js set r0c0 --type app --target "C:\Program Files\Google\Chrome\Application\chrome.exe" --label "谷歌浏览器"

# 2. 虚拟快捷键 / 组合键宏 (Win+D, Alt+F4, Ctrl+Shift+Esc, Ctrl+Alt+A 等)
node tools/config-cli.js set r1c0 --type hotkey --target "Win+D" --label "显示桌面"
node tools/config-cli.js set r1c1 --type hotkey --target "Ctrl+Shift+Esc" --label "任务管理器"
node tools/config-cli.js set r1c2 --type hotkey --target "Ctrl+Alt+A" --label "屏幕截图"

# 3. 外观、角标微标与独立底色配置
# 支持: --badge (角标文字/符号), --badge-bg (角标背景色), --color (底色), --color2 (渐变底色), --custom-color (独立底色不跟随整板)
node tools/config-cli.js set r0c3 --type hotkey --target "Win+V" --label "剪贴板" --badge "V" --badge-bg "#00838f"
node tools/config-cli.js set r0c4 --type app --target "calc.exe" --label "计算器" --custom-color --color "#0277bd"

# 4. 网址导航
node tools/config-cli.js set r0c1 --type url --target "https://github.com" --label "GitHub"

# 5. 打开文件夹
node tools/config-cli.js set r0c2 --type folder --target "E:\项目\AiProgram" --label "项目工程"

# 6. 命令行指令与 PowerShell 脚本
node tools/config-cli.js set r2c0 --type command --target "notepad.exe" --label "记事本"
node tools/config-cli.js set r2c1 --type ps1 --target "C:\Scripts\cleanup.ps1" --label "一键清理"

# 7. 翻页动作 (next / prev / goto / up / home)
node tools/config-cli.js set r2c3 --type page --mode next --label "下一页"

# 8. 复合动作队列与驱动宏 (multi / macro)
# 支持多操作顺序编排、1ms原生键鼠模拟、窗口归一化以及循环模式
node tools/config-cli.js set r2c3 --type multi --label "一键开黑" --actions '[{"type":"app","target":"leigod"},{"type":"delay","ms":500},{"type":"app","target":"ts3client_win64"},{"type":"delay","ms":500},{"type":"app","target":"steam"}]'

# 循环模式（toggle: 拍击开始循环，再拍停止；times: 循环固定次数）
node tools/config-cli.js set r2c3 --type multi --label "连点宏" --loop toggle --loop-interval 100 --actions '[{"type":"mouse_click","button":"left"},{"type":"delay","ms":100}]'

# 9. 智能二维码解码 (剪贴板秒解 / 屏幕十字框选 / 全屏扫描，结果自动写入剪贴板并带硬件 LCD 反馈)
node tools/config-cli.js set r0c0 --type qr_decode --label "扫码解码"
```

### 3. 清空按键 (`clear`)
```powershell
node tools/config-cli.js clear r0c0
```

### 4. 配置右侧 3 块 LCD 副屏 (`strip`)
副屏支持时钟、页面指示、系统实时态势监控及纯文字：
```powershell
# 屏 1 (顶部)：时钟与星期自动刷新
node tools/config-cli.js strip 0 --type clock

# 屏 2 (中间)：CPU 占用率实时动态仪表监控
node tools/config-cli.js strip 1 --type cpu

# 屏 3 (底部)：内存占用率实时动态仪表监控 (或 sys 综合态势)
node tools/config-cli.js strip 2 --type mem
```

### 5. 整板无缝渐变设置 (`set-gradient`)
驱动支持贯通 15 个按键 + 3 块副屏的 6 列大画布全景无缝渐变：
```powershell
# 开启暗夜蓝金
node tools/config-cli.js set-gradient --from "#141e30" --to "#243b55" --angle 135

# 开启赛博霓虹
node tools/config-cli.js set-gradient --from "#8a2387" --to "#e94057" --angle 90

# 关闭渐变（恢复单键底色）
node tools/config-cli.js set-gradient --disable
```

### 6. 页面管理与批量整页载入
```powershell
# 新建页面
node tools/config-cli.js add-page "开发环境"
# 切换当前展示页
node tools/config-cli.js use "开发环境"
# 从 JSON 文件整页批量应用
node tools/config-cli.js set-page "开发环境" --from patch.json
```

---

## 🌐 跨电脑便携引擎规范 (Portability Engine)

为了让导出给其他电脑的便携包即插即用，**严禁硬编码绝对盘符路径（如 `E:\项目\...`）**：
1. **相对路径宏替换**：
   - `%DOCK_DIR%`：自动展开为当前控制台安装/解压根目录（如 `%DOCK_DIR%\bin\mytool.exe`）。
   - `%USERPROFILE%`、`%APPDATA%`、`%TEMP%`：自动映射到目标电脑对应系统目录。
2. **智能寻径探针 (`probeApp`)**：
   - 常用软件直接填写程序名（如 `steam`, `leigod`, `ts3client_win64`, `code` 等）。
   - 驱动会自动探测 Windows 注册表 `App Paths`、协议关联（如 `steam://`）、默认安装目录（`Program Files`, `Local AppData`），在任意电脑上均能自动秒级寻径。

---

## 🎛️ 驱动级宏动作规范 (Macro & Native Input Spec)

复合动作队列（`type: multi`）由内置的 C# 原生输入守护器（`bin/akp-input.exe`）驱动，实现 **<1ms** 零延迟模拟，安全机制完备：

| 动作类型 (`type`) | 关键参数 | 说明 |
| :--- | :--- | :--- |
| `app` / `open` | `target`, `args` | 启动程序或打开文件/网址（支持 `probeApp` 智能寻径） |
| `delay` | `ms` | 串行等待延迟（毫秒） |
| `hotkey` | `target` (或 `combo`) | 模拟键盘快捷键（如 `Ctrl+C`, `Win+D`, `Alt+F4`） |
| `text` | `text` | 键盘输入指定文本（支持完整中文与 Unicode 字符） |
| `mouse_click` | `button` ('left'/'right'/'middle'), `double`, `x`, `y` | 鼠标点击。若留空 `x`,`y` 则在当前鼠标光标原位点击 |
| `mouse_move` | `x`, `y`, `duration` | 鼠标平滑移动（`duration=0` 为瞬间移动） |
| `mouse_drag` | `x1`, `y1`, `x2`, `y2`, `duration` | 鼠标从起点按住平滑拖拽至终点 |
| `mouse_wheel` | `delta` | 鼠标滚轮（+120 向上滚，-120 向下滚） |
| `window_rect` | `target`, `x`, `y`, `w`, `h` | 固定目标窗口的位置与分辨率（用于固定鼠标宏点击基准） |
| `command` | `target` | 后台静默执行系统命令行 |
| `media` | `cmd` ('play_pause'/'next'/'prev'/'vol_up'/'vol_down'/'mute') | 系统多媒体全局控制 |

### 循环与三重安全防卡死熔断 (Safety Failsafe)
- **开关循环 (`toggle`)**：拍击 AKP153 物理键开始无限循环，LCD 屏幕实时渲染绿色霓虹边框与 `⟳ RUN` 徽章；**再次拍击该物理键立即安全停止**。
- **内置安全阈值**：循环间歇硬编码不低于 20ms（默认 50ms），杜绝占满 Windows 消息队列。
- **全局紧急熔断按键**：任何时候按下键盘 **`Ctrl+Alt+Escape`** 或 **`Pause`** 键，立即强制切断所有后台运行中的宏与循环。

---

## 📋 按键对象规范 (Key Spec Schema)

如需直接修改或生成 `config.json`，按键对象符合如下结构：

```json
{
  "type": "app | hotkey | folder | url | command | ps1 | file | page | multi | qr_decode",
  "label": "按键显示名称（超长自动智能换行）",
  "target": "可执行路径 / 网址 / 命令行 / 快捷键组合（如 Win+D）",
  "args": "启动参数（可选）",
  "icon": "data:image/jpeg;base64,... 或 data:image/svg+xml,... 或留空",
  "color": "#1565c0",
  "badge": "✓",           // 可选：右上角角标（✓, ✕, ➔, 1~9, ●）
  "badgeBg": "#e53935",   // 可选：角标底色
  "badgeColor": "#ffffff",// 可选：角标文字色
  "fontSize": 17,         // 可选：字号百分比（默认 17）
  "iconScale": 62,        // 可选：图标缩放百分比（默认 62）
  "labelPos": "bottom",   // 可选：'bottom' | 'center' | 'top'
  "loop": {               // 可选：宏循环设置（仅 multi 生效）
    "mode": "once | toggle | times",
    "times": 5,
    "interval": 50
  },
  "actions": [            // 可选：宏动作队列（仅 multi 生效）
    { "type": "app", "target": "steam" },
    { "type": "delay", "ms": 500 }
  ]
}
```

---

## 🎯 常用场景 Agent 提示词响应范式

### 场景一：用户要求“把第1排第1个按键改成启动微信”
Agent 执行：
```powershell
node tools/config-cli.js set r0c0 --type app --target "C:\Program Files\Tencent\WeChat\WeChat.exe" --label "微信"
```
（若微信在其他盘或快捷方式，直接将 target 指向对应的微信快捷方式或 exe，驱动会自动提取官方图标并穿透至真实路径）

### 场景二：用户要求“把右侧副屏改成系统监控”
Agent 执行：
```powershell
node tools/config-cli.js strip 0 --type clock
node tools/config-cli.js strip 1 --type cpu
node tools/config-cli.js strip 2 --type mem
```

### 场景三：用户要求“加一个一键回到桌面和一个截图按键”
Agent 执行：
```powershell
node tools/config-cli.js set r1c3 --type hotkey --target "Win+D" --label "显示桌面"
node tools/config-cli.js set r1c4 --type hotkey --target "Ctrl+Alt+A" --label "屏幕截图"
```

### 场景四：用户要求“换一套科技风冷色调渐变”
Agent 执行：
```powershell
node tools/config-cli.js set-gradient --from "#000428" --to "#004e92" --angle 135
```

---

## ⚠️ 安全与执行铁律

1. **测试静默原则**：严禁在自动化执行中调用会弹出可见窗口的外部命令（如打开空白记事本或文件夹窗口），所有测试脚本必须保持无感静默。
2. **写操作原子化**：不要用未加锁的方式直接破坏写入 `config.json`，使用 `tools/config-cli.js` 或主进程 `config.js` 的 `save()`，会自动走 `.tmp` 临时文件原子替换，防止断电或并发写损坏配置。
3. **USB 独占排他性**：AKP153 底层 HID 端口为独占模式，请勿同时运行官方 Qt 驱动或 Companion，否则会造成 `DEVICE_BUSY`。
