using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Net.NetworkInformation;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Win32;
using Microsoft.Win32.SafeHandles;

namespace AkpInput
{
    public static class Program
    {
        [StructLayout(LayoutKind.Sequential)]
        public struct POINT
        {
            public int X;
            public int Y;
        }

        [StructLayout(LayoutKind.Sequential)]
        public struct RECT
        {
            public int Left;
            public int Top;
            public int Right;
            public int Bottom;
        }

        [StructLayout(LayoutKind.Sequential)]
        struct INPUT
        {
            public uint type;
            public InputUnion u;
        }

        [StructLayout(LayoutKind.Explicit)]
        struct InputUnion
        {
            [FieldOffset(0)] public MOUSEINPUT mi;
            [FieldOffset(0)] public KEYBDINPUT ki;
            [FieldOffset(0)] public HARDWAREINPUT hi;
        }

        [StructLayout(LayoutKind.Sequential)]
        struct KEYBDINPUT
        {
            public ushort wVk;
            public ushort wScan;
            public uint dwFlags;
            public uint time;
            public UIntPtr dwExtraInfo;
        }

        [StructLayout(LayoutKind.Sequential)]
        struct MOUSEINPUT
        {
            public int dx;
            public int dy;
            public uint mouseData;
            public uint dwFlags;
            public uint time;
            public UIntPtr dwExtraInfo;
        }

        [StructLayout(LayoutKind.Sequential)]
        struct HARDWAREINPUT
        {
            public uint uMsg;
            public ushort wParamL;
            public ushort wParamH;
        }

        const uint INPUT_MOUSE = 0;
        const uint INPUT_KEYBOARD = 1;

        const uint KEYEVENTF_KEYDOWN = 0x0000;
        const uint KEYEVENTF_EXTENDEDKEY = 0x0001;
        const uint KEYEVENTF_KEYUP = 0x0002;
        const uint KEYEVENTF_UNICODE = 0x0004;

        const uint MOUSEEVENTF_LEFTDOWN = 0x0002;
        const uint MOUSEEVENTF_LEFTUP = 0x0004;
        const uint MOUSEEVENTF_RIGHTDOWN = 0x0008;
        const uint MOUSEEVENTF_RIGHTUP = 0x0010;
        const uint MOUSEEVENTF_MIDDLEDOWN = 0x0020;
        const uint MOUSEEVENTF_MIDDLEUP = 0x0040;
        const uint MOUSEEVENTF_WHEEL = 0x0800;
        const uint MOUSEEVENTF_MOVE = 0x0001;

        const uint WM_CLOSE = 0x0010;

        [DllImport("user32.dll", SetLastError = true)]
        static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);

        [DllImport("user32.dll")]
        static extern bool GetCursorPos(out POINT lpPoint);

        [DllImport("user32.dll")]
        static extern bool SetCursorPos(int X, int Y);

        [DllImport("user32.dll")]
        static extern void mouse_event(uint dwFlags, int dx, int dy, uint dwData, UIntPtr dwExtraInfo);

        [DllImport("user32.dll")]
        static extern IntPtr GetForegroundWindow();

        [DllImport("user32.dll")]
        static extern bool SetForegroundWindow(IntPtr hWnd);

        [DllImport("user32.dll")]
        static extern bool IsIconic(IntPtr hWnd);

        [DllImport("user32.dll")]
        static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);

        [DllImport("user32.dll")]
        static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);

        [DllImport("kernel32.dll")]
        static extern uint GetCurrentThreadId();

        [DllImport("user32.dll", SetLastError = true)]
        static extern bool PostMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);

        [DllImport("user32.dll", SetLastError = true)]
        static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);

        [DllImport("user32.dll")]
        static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

        [DllImport("user32.dll")]
        static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);

        [DllImport("user32.dll", CharSet = CharSet.Auto)]
        static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);

        [DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
        static extern IntPtr CreateWindowEx(int dwExStyle, string lpClassName, string lpWindowName, int dwStyle, int x, int y, int nWidth, int nHeight, IntPtr hWndParent, IntPtr hMenu, IntPtr hInstance, IntPtr lpParam);

        [DllImport("user32.dll", SetLastError = true)]
        static extern bool DestroyWindow(IntPtr hWnd);

        [DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
        static extern bool ShutdownBlockReasonCreate(IntPtr hWnd, string pwszReason);

        [DllImport("user32.dll", SetLastError = true)]
        static extern bool ShutdownBlockReasonDestroy(IntPtr hWnd);

        [DllImport("user32.dll")]
        static extern bool LockWorkStation();

        [DllImport("user32.dll")]
        static extern short GetAsyncKeyState(int vKey);

        [DllImport("shell32.dll", CharSet = CharSet.Auto)]
        static extern int ExtractIconEx(string szFileName, int nIconIndex, IntPtr[] phiconLarge, IntPtr[] phiconSmall, int nIcons);

        [DllImport("user32.dll", SetLastError = true)]
        static extern bool DestroyIcon(IntPtr hIcon);

        [DllImport("ole32.dll")]
        static extern int PropVariantClear(ref PROPVARIANT pvar);

        public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
        public delegate void WinEventDelegate(IntPtr hWinEventHook, uint eventType, IntPtr hwnd, int idObject, int idChild, uint dwEventThread, uint dwmsEventTime);

        [DllImport("user32.dll")]
        static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);

        [DllImport("user32.dll")]
        static extern bool IsWindowVisible(IntPtr hWnd);

        [DllImport("user32.dll")]
        static extern bool IsWindowEnabled(IntPtr hWnd);

        [DllImport("user32.dll")]
        static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);

        [DllImport("user32.dll")]
        static extern bool AllowSetForegroundWindow(int dwProcessId);

        [DllImport("user32.dll")]
        static extern uint MapVirtualKey(uint uCode, uint uMapType);

        [DllImport("user32.dll")]
        static extern IntPtr GetWindow(IntPtr hWnd, uint uCmd);

        [DllImport("user32.dll", SetLastError = true)]
        static extern int GetWindowLong(IntPtr hWnd, int nIndex);

        [DllImport("user32.dll")]
        static extern bool BringWindowToTop(IntPtr hWnd);

        [DllImport("user32.dll")]
        static extern IntPtr SetFocus(IntPtr hWnd);

        [DllImport("user32.dll")]
        static extern void SwitchToThisWindow(IntPtr hWnd, bool fAltTab);

        [DllImport("user32.dll")]
        static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);

        [DllImport("user32.dll", SetLastError = true)]
        static extern bool SystemParametersInfo(uint uiAction, uint uiParam, IntPtr pvParam, uint fWinIni);

        [DllImport("user32.dll", SetLastError = true)]
        static extern bool SystemParametersInfo(uint uiAction, uint uiParam, out IntPtr pvParam, uint fWinIni);

        [DllImport("user32.dll", CharSet = CharSet.Unicode)]
        static extern IntPtr SendMessageTimeoutW(IntPtr hWnd, uint Msg, IntPtr wParam, StringBuilder lParam, uint fuFlags, uint uTimeout, out IntPtr lpdwResult);

        [DllImport("user32.dll")]
        static extern IntPtr SetWinEventHook(uint eventMin, uint eventMax, IntPtr hmodWinEventProc, WinEventDelegate lpfnWinEventProc, uint idProcess, uint idThread, uint dwFlags);

        [DllImport("user32.dll")]
        static extern bool UnhookWinEvent(IntPtr hWinEventHook);

        [DllImport("dwmapi.dll")]
        static extern int DwmGetWindowAttribute(IntPtr hwnd, int dwAttribute, out int pvAttribute, int cbAttribute);

        [DllImport("kernel32.dll")]
        static extern bool SetProcessShutdownParameters(uint dwLevel, uint dwFlags);

        const uint WM_GETTEXT = 0x000D;
        const uint SMTO_ABORTIFHUNG = 0x0002;
        const int GWL_EXSTYLE = -20;
        const int WS_EX_TOOLWINDOW = 0x00000080;
        const int WS_EX_APPWINDOW = 0x00040000;
        const uint GW_OWNER = 4;
        const int DWMWA_CLOAKED = 14;
        const uint SPI_GETFOREGROUNDLOCKTIMEOUT = 0x2000;
        const uint SPI_SETFOREGROUNDLOCKTIMEOUT = 0x2001;
        const uint SPIF_SENDCHANGE = 0x0002;
        const uint EVENT_SYSTEM_FOREGROUND = 0x0003;
        const uint EVENT_SYSTEM_MINIMIZESTART = 0x0016;
        const uint EVENT_SYSTEM_MINIMIZEEND = 0x0017;
        const uint EVENT_OBJECT_NAMECHANGE = 0x800C;
        const uint WINEVENT_OUTOFCONTEXT = 0x0000;
        const uint WINEVENT_SKIPOWNPROCESS = 0x0002;

        public static volatile bool _hostBlackoutAcked = false;
        private static string _lastFgSig = "";
        private static long _lastFgEmitTick = 0;
        private static readonly object _watchLock = new object();
        private static List<string> _watchedProcs = new List<string>();
        private static string _lastWatchedRunningSig = "";
        private static string _lastMediaTitlesSig = "";

        public static void EmitEvent(string evtName, string payload)
        {
            string clean = (payload ?? "").Replace("\r", " ").Replace("\n", " ");
            WriteOut("@evt ", evtName + " " + clean);
        }

        public static string GetWindowTitleSafe(IntPtr hwnd)
        {
            if (hwnd == IntPtr.Zero) return "";
            try
            {
                var sb = new StringBuilder(512);
                IntPtr res;
                IntPtr ok = SendMessageTimeoutW(hwnd, WM_GETTEXT, new IntPtr(sb.Capacity), sb, SMTO_ABORTIFHUNG, 60, out res);
                if (ok == IntPtr.Zero) return "";
                return sb.ToString().Replace("\r", " ").Replace("\n", " ").Trim();
            }
            catch
            {
                return "";
            }
        }

        static bool IsWindowCloaked(IntPtr hwnd)
        {
            try
            {
                int cloaked = 0;
                int hr = DwmGetWindowAttribute(hwnd, DWMWA_CLOAKED, out cloaked, sizeof(int));
                return hr == 0 && cloaked != 0;
            }
            catch
            {
                return false;
            }
        }

        static IntPtr FindBestProcessWindow(HashSet<uint> targetPids, IntPtr fgHwnd)
        {
            IntPtr bestHwnd = IntPtr.Zero;
            int bestScore = -1;
            EnumWindows(delegate(IntPtr hwnd, IntPtr lParam)
            {
                uint pid = 0;
                GetWindowThreadProcessId(hwnd, out pid);
                if (!targetPids.Contains(pid)) return true;
                if (!IsWindowVisible(hwnd)) return true;
                if (!IsWindowEnabled(hwnd)) return true;
                if (IsWindowCloaked(hwnd)) return true;
                int exStyle = GetWindowLong(hwnd, GWL_EXSTYLE);
                if ((exStyle & WS_EX_TOOLWINDOW) != 0 && (exStyle & WS_EX_APPWINDOW) == 0) return true;

                bool iconic = IsIconic(hwnd);
                if (!iconic)
                {
                    RECT rc;
                    if (GetWindowRect(hwnd, out rc))
                    {
                        int w = rc.Right - rc.Left;
                        int h = rc.Bottom - rc.Top;
                        // 过滤 1x1、悬浮球、隐藏阴影层等微小辅助窗口
                        if (w < 80 || h < 50) return true;
                    }
                }

                int score = 100;
                if (hwnd == fgHwnd) score += 10000;
                string title = GetWindowTitleSafe(hwnd);
                if (!string.IsNullOrEmpty(title)) score += 500;
                if (GetWindow(hwnd, GW_OWNER) == IntPtr.Zero) score += 250;
                if ((exStyle & WS_EX_APPWINDOW) != 0) score += 150;
                // 仅给非最小化窗口极小的同分偏置(+5)，绝不压过被最小化的主窗口
                if (!iconic) score += 5;

                if (score > bestScore)
                {
                    bestScore = score;
                    bestHwnd = hwnd;
                }
                return true;
            }, IntPtr.Zero);
            return bestHwnd;
        }

        private static IntPtr _guardHwnd = IntPtr.Zero;
        private static readonly object _outLock = new object();
        public static volatile bool _deviceKnownAsleep = false;

        static void WriteOut(string prefix, string text)
        {
            lock (_outLock)
            {
                Console.WriteLine(string.IsNullOrEmpty(prefix) ? text : (prefix + text));
                Console.Out.Flush();
            }
        }

        class ShutdownGuardForm : Form
        {
            const int WM_QUERYENDSESSION = 0x0011;
            const int WM_ENDSESSION = 0x0016;
            const int WM_POWERBROADCAST = 0x0218;
            const int PBT_APMSUSPEND = 0x0004;
            const int PBT_APMRESUMEAUTOMATIC = 0x0012;

            private WinEventDelegate _winEventProc;
            private IntPtr _hookFg = IntPtr.Zero;
            private IntPtr _hookMin = IntPtr.Zero;
            private IntPtr _hookName = IntPtr.Zero;

            public ShutdownGuardForm()
            {
                this.ShowInTaskbar = false;
                this.WindowState = FormWindowState.Minimized;
                this.FormBorderStyle = FormBorderStyle.None;
                this.Size = new System.Drawing.Size(0, 0);
            }

            protected override void SetVisibleCore(bool value)
            {
                base.SetVisibleCore(false);
            }

            protected override void OnHandleCreated(EventArgs e)
            {
                base.OnHandleCreated(e);
                try
                {
                    ShutdownBlockReasonCreate(this.Handle, "AKP153 控制台正在安全关闭并休眠屏幕...");
                }
                catch { }
                try
                {
                    _winEventProc = new WinEventDelegate(OnWinEventNotification);
                    uint flags = WINEVENT_OUTOFCONTEXT | WINEVENT_SKIPOWNPROCESS;
                    _hookFg = SetWinEventHook(EVENT_SYSTEM_FOREGROUND, EVENT_SYSTEM_FOREGROUND, IntPtr.Zero, _winEventProc, 0, 0, flags);
                    _hookMin = SetWinEventHook(EVENT_SYSTEM_MINIMIZESTART, EVENT_SYSTEM_MINIMIZEEND, IntPtr.Zero, _winEventProc, 0, 0, flags);
                    _hookName = SetWinEventHook(EVENT_OBJECT_NAMECHANGE, EVENT_OBJECT_NAMECHANGE, IntPtr.Zero, _winEventProc, 0, 0, flags);
                }
                catch { }
            }

            private void OnWinEventNotification(IntPtr hWinEventHook, uint eventType, IntPtr hwnd, int idObject, int idChild, uint dwEventThread, uint dwmsEventTime)
            {
                try
                {
                    if (hwnd == IntPtr.Zero) return;
                    if (eventType == EVENT_OBJECT_NAMECHANGE)
                    {
                        if (idObject != 0 || idChild != 0) return;
                        if (hwnd != GetForegroundWindow()) return;
                        long now = Environment.TickCount & Int32.MaxValue;
                        if (now - _lastFgEmitTick < 90) return;
                    }
                    string fgInfo = GetForegroundProcessInfo();
                    if (!string.IsNullOrEmpty(fgInfo) && fgInfo != _lastFgSig)
                    {
                        _lastFgSig = fgInfo;
                        _lastFgEmitTick = Environment.TickCount & Int32.MaxValue;
                        EmitEvent("fg", fgInfo);
                    }
                }
                catch { }
            }

            protected override void WndProc(ref Message m)
            {
                if (m.Msg == WM_POWERBROADCAST)
                {
                    int wp = m.WParam.ToInt32();
                    if (wp == PBT_APMSUSPEND)
                    {
                        _hostBlackoutAcked = false;
                        EmitEvent("shutdown", "suspend");
                        for (int w = 0; w < 20 && !_hostBlackoutAcked; w++)
                        {
                            Thread.Sleep(45);
                        }
                        if (!_hostBlackoutAcked)
                        {
                            try { DirectHardwareBlackout(); } catch { }
                            _hostBlackoutAcked = true;
                        }
                    }
                    else if (wp == PBT_APMRESUMEAUTOMATIC)
                    {
                        _hostBlackoutAcked = false;
                        _deviceKnownAsleep = false;
                    }
                }
                if (m.Msg == WM_QUERYENDSESSION || (m.Msg == WM_ENDSESSION && m.WParam != IntPtr.Zero))
                {
                    EmitEvent("shutdown", "1");
                    // 等待主进程/device-host.js 优先通过既有 HID 句柄优雅完成 blackout（最多 1100ms），
                    // 仅当主进程已先退出或超时未确认时才由 C# 守护窗执行底层 DirectHardwareBlackout，彻底消除双进程并发写 HID 冲突。
                    for (int w = 0; w < 22 && !_hostBlackoutAcked; w++)
                    {
                        Thread.Sleep(50);
                    }
                    if (!_hostBlackoutAcked)
                    {
                        try { DirectHardwareBlackout(); } catch { }
                        _hostBlackoutAcked = true;
                    }
                    if (m.Msg == WM_QUERYENDSESSION)
                    {
                        try { ShutdownBlockReasonDestroy(this.Handle); } catch { }
                        m.Result = new IntPtr(1);
                        return;
                    }
                    else
                    {
                        Application.Exit();
                        m.Result = IntPtr.Zero;
                        return;
                    }
                }
                base.WndProc(ref m);
            }

            protected override void Dispose(bool disposing)
            {
                if (_hookFg != IntPtr.Zero) { UnhookWinEvent(_hookFg); _hookFg = IntPtr.Zero; }
                if (_hookMin != IntPtr.Zero) { UnhookWinEvent(_hookMin); _hookMin = IntPtr.Zero; }
                if (_hookName != IntPtr.Zero) { UnhookWinEvent(_hookName); _hookName = IntPtr.Zero; }
                base.Dispose(disposing);
            }
        }

        private static Thread _guardThread = null;
        private static ShutdownGuardForm _guardForm = null;

        public static void StartShutdownGuard()
        {
            if (_guardThread != null) return;
            _guardThread = new Thread(() =>
            {
                try
                {
                    SetProcessShutdownParameters(0x3FF, 0);
                    SubscribeVolumeEvents(false);
                    _guardForm = new ShutdownGuardForm();
                    Application.Run(_guardForm);
                }
                catch { }
            });
            _guardThread.SetApartmentState(ApartmentState.STA);
            _guardThread.IsBackground = true;
            _guardThread.Name = "AkpShutdownGuard";
            _guardThread.Start();

            Thread watcher = new Thread(() =>
            {
                const string mediaCsv = "qqmusic,cloudmusic,kugou,kuwo,spotify,yesplaymusic,lx-music-desktop,foobar2000,musicbee,aimp,potplayermini64,potplayer,vlc,wmplayer,obs64,obs32";
                while (true)
                {
                    Thread.Sleep(950);
                    try
                    {
                        string watchCsv = "";
                        lock (_watchLock)
                        {
                            if (_watchedProcs.Count > 0) watchCsv = string.Join(",", _watchedProcs);
                        }
                        string mediaTitles;
                        string running;
                        PollProcessSnapshot(mediaCsv, watchCsv, out mediaTitles, out running);
                        if (mediaTitles != _lastMediaTitlesSig)
                        {
                            _lastMediaTitlesSig = mediaTitles;
                            EmitEvent("media", mediaTitles);
                        }
                        if (!string.IsNullOrEmpty(watchCsv) && running != _lastWatchedRunningSig)
                        {
                            _lastWatchedRunningSig = running;
                            EmitEvent("procs", running);
                        }
                    }
                    catch { }
                }
            });
            watcher.IsBackground = true;
            watcher.Name = "AkpStateWatcher";
            watcher.Start();
        }

        public static void StopShutdownGuard()
        {
            if (_guardForm != null && !_guardForm.IsDisposed)
            {
                try
                {
                    _guardForm.Invoke((MethodInvoker)delegate
                    {
                        ShutdownBlockReasonDestroy(_guardForm.Handle);
                        _guardForm.Close();
                    });
                }
                catch { }
                _guardForm = null;
            }
        }

        private static string _cachedDevicePath = null;
        private static long _lastBlackoutTs = 0;

        public static void SetDevicePath(string path)
        {
            if (!string.IsNullOrEmpty(path))
            {
                _cachedDevicePath = path.Trim();
            }
        }

        [StructLayout(LayoutKind.Sequential)]
        struct SP_DEVICE_INTERFACE_DATA
        {
            public int cbSize;
            public Guid interfaceClassGuid;
            public int flags;
            public IntPtr reserved;
        }

        [DllImport("setupapi.dll", SetLastError = true)]
        static extern IntPtr SetupDiGetClassDevs(ref Guid ClassGuid, IntPtr Enumerator, IntPtr hwndParent, uint Flags);

        [DllImport("setupapi.dll", SetLastError = true)]
        static extern bool SetupDiEnumDeviceInterfaces(IntPtr DeviceInfoSet, IntPtr DeviceInfoData, ref Guid InterfaceClassGuid, uint MemberIndex, ref SP_DEVICE_INTERFACE_DATA DeviceInterfaceData);

        [DllImport("setupapi.dll", SetLastError = true, CharSet = CharSet.Auto)]
        static extern bool SetupDiGetDeviceInterfaceDetail(IntPtr DeviceInfoSet, ref SP_DEVICE_INTERFACE_DATA DeviceInterfaceData, IntPtr DeviceInterfaceDetailData, int DeviceInterfaceDetailDataSize, ref int RequiredSize, IntPtr DeviceInfoData);

        [DllImport("setupapi.dll", SetLastError = true)]
        static extern bool SetupDiDestroyDeviceInfoList(IntPtr DeviceInfoSet);

        [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Auto)]
        public static extern SafeFileHandle CreateFile(
            string lpFileName,
            uint dwDesiredAccess,
            uint dwShareMode,
            IntPtr lpSecurityAttributes,
            uint dwCreationDisposition,
            uint dwFlagsAndAttributes,
            IntPtr hTemplateFile);

        [DllImport("kernel32.dll", SetLastError = true)]
        public static extern bool WriteFile(
            SafeFileHandle hFile,
            byte[] lpBuffer,
            uint nNumberOfBytesToWrite,
            out uint lpNumberOfBytesWritten,
            IntPtr lpOverlapped);

        static List<string> EnumerateAkpDevices()
        {
            var list = new List<string>();
            Guid hidGuid = new Guid("4d1e55b2-f16f-11cf-88cb-001111000030");
            uint DIGCF_PRESENT = 0x00000002;
            uint DIGCF_DEVICEINTERFACE = 0x00000010;

            IntPtr devInfo = SetupDiGetClassDevs(ref hidGuid, IntPtr.Zero, IntPtr.Zero, DIGCF_PRESENT | DIGCF_DEVICEINTERFACE);
            if (devInfo == IntPtr.Zero || devInfo == new IntPtr(-1)) return list;

            try
            {
                SP_DEVICE_INTERFACE_DATA ifData = new SP_DEVICE_INTERFACE_DATA();
                ifData.cbSize = Marshal.SizeOf(typeof(SP_DEVICE_INTERFACE_DATA));
                uint idx = 0;

                while (SetupDiEnumDeviceInterfaces(devInfo, IntPtr.Zero, ref hidGuid, idx++, ref ifData))
                {
                    int reqSize = 0;
                    SetupDiGetDeviceInterfaceDetail(devInfo, ref ifData, IntPtr.Zero, 0, ref reqSize, IntPtr.Zero);
                    if (reqSize > 0)
                    {
                        IntPtr detailBuf = Marshal.AllocHGlobal(reqSize);
                        try
                        {
                            Marshal.WriteInt32(detailBuf, (IntPtr.Size == 8) ? 8 : 4 + Marshal.SystemDefaultCharSize);
                            if (SetupDiGetDeviceInterfaceDetail(devInfo, ref ifData, detailBuf, reqSize, ref reqSize, IntPtr.Zero))
                            {
                                IntPtr pPath = new IntPtr(detailBuf.ToInt64() + 4);
                                string path = Marshal.PtrToStringAuto(pPath);
                                if (!string.IsNullOrEmpty(path))
                                {
                                    string lower = path.ToLowerInvariant();
                                    if ((lower.Contains("vid_5548") && lower.Contains("pid_6674")) ||
                                        (lower.Contains("vid_0300") && lower.Contains("pid_1010")))
                                    {
                                        list.Add(path);
                                    }
                                }
                            }
                        }
                        finally
                        {
                            Marshal.FreeHGlobal(detailBuf);
                        }
                    }
                }
            }
            finally
            {
                SetupDiDestroyDeviceInfoList(devInfo);
            }
            return list;
        }

        static byte[] MakeHidPacket(byte[] cmd)
        {
            byte[] buf = new byte[513];
            buf[0] = 0;
            buf[1] = 67; buf[2] = 82; buf[3] = 84; buf[4] = 0; buf[5] = 0; // "CRT\0\0"
            for (int i = 0; i < cmd.Length && (6 + i) < buf.Length; i++)
            {
                buf[6 + i] = cmd[i];
            }
            return buf;
        }

        private static readonly object _blackoutLock = new object();

        public static bool DirectHardwareBlackout()
        {
            lock (_blackoutLock)
            {
                // 幂等防并发守卫：2000ms 内若已由任一通道完成物理断电，不再重复下发，杜绝多通道交错重亮
                long nowTicks = Environment.TickCount & Int32.MaxValue;
                if (_lastBlackoutTs != 0 && (nowTicks - _lastBlackoutTs) < 2000)
                {
                    return true;
                }

                // 大小写不敏感去重，彻底修复 _cachedDevicePath (大写) 与 SetupDi (小写) 重复加入导致二次唤醒屏幕的 Bug
                var seenPaths = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                var candidatePaths = new List<string>();
                if (!string.IsNullOrEmpty(_cachedDevicePath) && seenPaths.Add(_cachedDevicePath))
                {
                    candidatePaths.Add(_cachedDevicePath);
                }

                var scanned = EnumerateAkpDevices();
                foreach (var p in scanned)
                {
                    if (seenPaths.Add(p)) candidatePaths.Add(p);
                }

                if (candidatePaths.Count == 0) return false;

                uint GENERIC_WRITE = 0x40000000;
                uint GENERIC_READ = 0x80000000;
                uint FILE_SHARE_READ = 0x00000001;
                uint FILE_SHARE_WRITE = 0x00000002;
                uint OPEN_EXISTING = 3;

                // 若设备在关机前已处于休眠态（锁屏/闲置熄屏），切勿再发 CLEAR_ALL，否则会唤醒 LCD 控制器
                var seqList = new List<byte[]>();
                var delayList = new List<int>();
                if (!_deviceKnownAsleep)
                {
                    seqList.Add(new byte[] { 67, 76, 69, 0, 0, 0, 255 }); // CLEAR_ALL
                    delayList.Add(45);
                }
                seqList.Add(new byte[] { 76, 66, 76, 73, 71, 0 });       // LBLIG 0
                delayList.Add(20);
                seqList.Add(new byte[] { 76, 73, 71, 0, 0, 0 });         // LIG 0
                delayList.Add(20);
                seqList.Add(new byte[] { 72, 65, 78 });                  // HAN
                delayList.Add(20);
                seqList.Add(new byte[] { 115, 108, 101, 101, 112 });      // sleep
                delayList.Add(35);

                bool anySuccess = false;
                foreach (var path in candidatePaths)
                {
                    try
                    {
                        using (var handle = CreateFile(path, GENERIC_READ | GENERIC_WRITE, FILE_SHARE_READ | FILE_SHARE_WRITE, IntPtr.Zero, OPEN_EXISTING, 0, IntPtr.Zero))
                        {
                            if (handle.IsInvalid) continue;

                            int writeOkCount = 0;
                            for (int i = 0; i < seqList.Count; i++)
                            {
                                byte[] pkt = MakeHidPacket(seqList[i]);
                                uint written = 0;
                                if (WriteFile(handle, pkt, 513, out written, IntPtr.Zero) && written > 0)
                                {
                                    writeOkCount++;
                                }
                                Thread.Sleep(delayList[i]);
                            }
                            if (writeOkCount > 0)
                            {
                                anySuccess = true;
                                _deviceKnownAsleep = true;
                                // 主控制端点已完成断电序列，立即终止遍历，防止复合设备的次级端点再次触发唤醒
                                break;
                            }
                        }
                    }
                    catch { }
                }
                if (anySuccess) _lastBlackoutTs = nowTicks;
                return anySuccess;
            }
        }

        static bool BlockShutdown(IntPtr hwnd, string reason)
        {
            if (_guardForm != null && !_guardForm.IsDisposed)
            {
                return ShutdownBlockReasonCreate(_guardForm.Handle, reason);
            }
            if (hwnd == IntPtr.Zero)
            {
                if (_guardHwnd == IntPtr.Zero)
                {
                    _guardHwnd = CreateWindowEx(0, "STATIC", "AKP153_ShutdownGuard", 0, 0, 0, 0, 0, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero);
                }
                hwnd = _guardHwnd;
            }
            if (hwnd == IntPtr.Zero) return false;
            return ShutdownBlockReasonCreate(hwnd, reason);
        }

        static bool UnblockShutdown(IntPtr hwnd)
        {
            if (_guardForm != null && !_guardForm.IsDisposed)
            {
                return ShutdownBlockReasonDestroy(_guardForm.Handle);
            }
            if (hwnd == IntPtr.Zero)
            {
                hwnd = _guardHwnd;
            }
            bool ok = false;
            if (hwnd != IntPtr.Zero)
            {
                ok = ShutdownBlockReasonDestroy(hwnd);
            }
            if (_guardHwnd != IntPtr.Zero)
            {
                DestroyWindow(_guardHwnd);
                _guardHwnd = IntPtr.Zero;
            }
            return ok;
        }

        const uint SWP_NOSIZE = 0x0001;
        const uint SWP_NOMOVE = 0x0002;
        const uint SWP_NOZORDER = 0x0004;
        const uint SWP_NOACTIVATE = 0x0010;
        const uint SWP_SHOWWINDOW = 0x0040;

        public static void MouseMove(int x, int y, bool relative, int durationMs = 0)
        {
            POINT startPt;
            GetCursorPos(out startPt);
            int targetX = relative ? (startPt.X + x) : x;
            int targetY = relative ? (startPt.Y + y) : y;

            if (durationMs > 15)
            {
                int steps = Math.Max(5, Math.Min(80, durationMs / 10));
                int stepSleep = Math.Max(1, durationMs / steps);
                for (int i = 1; i <= steps; i++)
                {
                    int curX = startPt.X + (targetX - startPt.X) * i / steps;
                    int curY = startPt.Y + (targetY - startPt.Y) * i / steps;
                    SetCursorPos(curX, curY);
                    Thread.Sleep(stepSleep);
                }
            }
            SetCursorPos(targetX, targetY);
        }

        public static void MouseClick(string button, int x, int y)
        {
            if (x >= 0 && y >= 0)
            {
                SetCursorPos(x, y);
                Thread.Sleep(10);
            }

            string b = (button ?? "left").ToLowerInvariant();
            if (b == "right")
            {
                mouse_event(MOUSEEVENTF_RIGHTDOWN, 0, 0, 0, UIntPtr.Zero);
                Thread.Sleep(20);
                mouse_event(MOUSEEVENTF_RIGHTUP, 0, 0, 0, UIntPtr.Zero);
            }
            else if (b == "middle")
            {
                mouse_event(MOUSEEVENTF_MIDDLEDOWN, 0, 0, 0, UIntPtr.Zero);
                Thread.Sleep(20);
                mouse_event(MOUSEEVENTF_MIDDLEUP, 0, 0, 0, UIntPtr.Zero);
            }
            else if (b == "double")
            {
                mouse_event(MOUSEEVENTF_LEFTDOWN, 0, 0, 0, UIntPtr.Zero);
                Thread.Sleep(20);
                mouse_event(MOUSEEVENTF_LEFTUP, 0, 0, 0, UIntPtr.Zero);
                Thread.Sleep(60);
                mouse_event(MOUSEEVENTF_LEFTDOWN, 0, 0, 0, UIntPtr.Zero);
                Thread.Sleep(20);
                mouse_event(MOUSEEVENTF_LEFTUP, 0, 0, 0, UIntPtr.Zero);
            }
            else
            {
                mouse_event(MOUSEEVENTF_LEFTDOWN, 0, 0, 0, UIntPtr.Zero);
                Thread.Sleep(20);
                mouse_event(MOUSEEVENTF_LEFTUP, 0, 0, 0, UIntPtr.Zero);
            }
        }

        public static void MouseDrag(int fromX, int fromY, int toX, int toY, int durationMs = 150)
        {
            SetCursorPos(fromX, fromY);
            Thread.Sleep(25);
            mouse_event(MOUSEEVENTF_LEFTDOWN, 0, 0, 0, UIntPtr.Zero);
            Thread.Sleep(25);

            int totalMs = Math.Max(50, Math.Min(10000, durationMs));
            int steps = Math.Max(10, Math.Min(80, totalMs / 12));
            int stepSleep = Math.Max(1, totalMs / steps);
            for (int i = 1; i <= steps; i++)
            {
                int curX = fromX + (toX - fromX) * i / steps;
                int curY = fromY + (toY - fromY) * i / steps;
                SetCursorPos(curX, curY);
                Thread.Sleep(stepSleep);
            }

            SetCursorPos(toX, toY);
            Thread.Sleep(25);
            mouse_event(MOUSEEVENTF_LEFTUP, 0, 0, 0, UIntPtr.Zero);
        }

        public static void MouseWheel(int delta)
        {
            mouse_event(MOUSEEVENTF_WHEEL, 0, 0, (uint)delta, UIntPtr.Zero);
        }

        public static void SendUnicodeText(string text)
        {
            if (string.IsNullOrEmpty(text)) return;
            string normalized = text.Replace("\\r\\n", "\n").Replace("\\n", "\n");
            var inputs = new List<INPUT>(normalized.Length * 2);
            for (int i = 0; i < normalized.Length; i++)
            {
                char ch = normalized[i];
                if (ch == '\r') continue;
                if (ch == '\n')
                {
                    inputs.Add(CreateKeyInput(0x0D, false, false));
                    inputs.Add(CreateKeyInput(0x0D, true, false));
                    continue;
                }
                inputs.Add(new INPUT
                {
                    type = INPUT_KEYBOARD,
                    u = new InputUnion
                    {
                        ki = new KEYBDINPUT
                        {
                            wVk = 0,
                            wScan = ch,
                            dwFlags = KEYEVENTF_UNICODE,
                            time = 0,
                            dwExtraInfo = UIntPtr.Zero
                        }
                    }
                });
                inputs.Add(new INPUT
                {
                    type = INPUT_KEYBOARD,
                    u = new InputUnion
                    {
                        ki = new KEYBDINPUT
                        {
                            wVk = 0,
                            wScan = ch,
                            dwFlags = KEYEVENTF_UNICODE | KEYEVENTF_KEYUP,
                            time = 0,
                            dwExtraInfo = UIntPtr.Zero
                        }
                    }
                });
            }
            if (inputs.Count > 0)
            {
                var arr = inputs.ToArray();
                SendInput((uint)arr.Length, arr, Marshal.SizeOf(typeof(INPUT)));
            }
        }

        static INPUT CreateKeyInput(ushort vk, bool keyUp, bool extended)
        {
            uint flags = keyUp ? KEYEVENTF_KEYUP : KEYEVENTF_KEYDOWN;
            if (extended) flags |= KEYEVENTF_EXTENDEDKEY;
            ushort scan = 0;
            try { scan = (ushort)MapVirtualKey(vk, 0); } catch { }
            return new INPUT
            {
                type = INPUT_KEYBOARD,
                u = new InputUnion
                {
                    ki = new KEYBDINPUT
                    {
                        wVk = vk,
                        wScan = scan,
                        dwFlags = flags,
                        time = 0,
                        dwExtraInfo = UIntPtr.Zero
                    }
                }
            };
        }

        static bool IsExtendedVk(ushort vk)
        {
            return vk == 0x5B || vk == 0x5C || // LWIN, RWIN
                   vk == 0x21 || vk == 0x22 || vk == 0x23 || vk == 0x24 || // PGUP, PGDN, END, HOME
                   vk == 0x25 || vk == 0x26 || vk == 0x27 || vk == 0x28 || // LEFT, UP, RIGHT, DOWN
                   vk == 0x2D || vk == 0x2E || vk == 0x2C; // INS, DEL, PRTSCN
        }

        static ushort ResolveVk(string token)
        {
            if (string.IsNullOrEmpty(token)) return 0;
            string k = token.Trim().ToLowerInvariant();
            switch (k)
            {
                case "enter": case "return": return 0x0D;
                case "esc": case "escape": return 0x1B;
                case "tab": return 0x09;
                case "space": case "spacebar": return 0x20;
                case "backspace": case "bksp": case "bs": return 0x08;
                case "del": case "delete": return 0x2E;
                case "ins": case "insert": return 0x2D;
                case "home": return 0x24;
                case "end": return 0x23;
                case "pgup": case "pageup": return 0x21;
                case "pgdn": case "pagedown": return 0x22;
                case "up": case "arrowup": return 0x26;
                case "down": case "arrowdown": return 0x28;
                case "left": case "arrowleft": return 0x25;
                case "right": case "arrowright": return 0x27;
                case "prtscn": case "printscreen": case "prtsc": return 0x2C;
                case "pause": case "break": return 0x13;
                case "capslock": case "caps": return 0x14;
                case "numlock": return 0x90;
                case "scrolllock": return 0x91;
                case "apps": case "contextmenu": return 0x5D;
                case "vol_up": case "volume_up": case "volumeup": case "audiovolumeup": return 0xAF;
                case "vol_down": case "volume_down": case "volumedown": case "audiovolumedown": return 0xAE;
                case "vol_mute": case "volume_mute": case "volumemute": case "audiovolumemute": return 0xAD;
                case "media_play_pause": case "mediaplaypause": case "play_pause": return 0xB3;
                case "media_next": case "media_next_track": case "medianexttrack": return 0xB0;
                case "media_prev": case "media_prev_track": case "mediaprevtrack": return 0xB1;
                case "media_stop": case "mediastop": return 0xB2;
                case ";": case "semicolon": return 0xBA;
                case "=": case "plus": case "equal": return 0xBB;
                case ",": case "comma": return 0xBC;
                case "-": case "minus": case "hyphen": return 0xBD;
                case ".": case "period": return "dot" == k ? (ushort)0xBE : (ushort)0xBE;
                case "/": case "slash": return 0xBF;
                case "`": case "tilde": case "backquote": return 0xC0;
                case "[": case "bracketleft": return 0xDB;
                case "\\": case "backslash": return 0xDC;
                case "]": case "bracketright": return 0xDD;
                case "'": case "quote": return 0xDE;
            }
            if (k.StartsWith("f") && k.Length >= 2 && k.Length <= 3)
            {
                int fn;
                if (int.TryParse(k.Substring(1), out fn) && fn >= 1 && fn <= 24)
                {
                    return (ushort)(0x70 + fn - 1);
                }
            }
            if (k.StartsWith("num") && k.Length == 4 && char.IsDigit(k[3]))
            {
                return (ushort)(0x60 + (k[3] - '0'));
            }
            if (k.Length == 1)
            {
                char c = char.ToUpperInvariant(k[0]);
                if ((c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9'))
                {
                    return (ushort)c;
                }
            }
            return 0;
        }

        public static bool SendHotkey(string combo)
        {
            if (string.IsNullOrWhiteSpace(combo)) return false;
            string normalizedCombo = combo.Trim();
            if (normalizedCombo == "+") normalizedCombo = "plus";
            else if (normalizedCombo.EndsWith("++")) normalizedCombo = normalizedCombo.Substring(0, normalizedCombo.Length - 1) + "plus";
            string[] parts = normalizedCombo.Split(new char[] { '+' }, StringSplitOptions.RemoveEmptyEntries);
            bool ctrl = false, alt = false, shift = false, win = false;
            ushort mainVk = 0;

            foreach (var raw in parts)
            {
                string p = raw.Trim().ToLowerInvariant();
                if (p == "ctrl" || p == "control" || p == "lctrl" || p == "rctrl") ctrl = true;
                else if (p == "alt" || p == "menu" || p == "lalt" || p == "ralt") alt = true;
                else if (p == "shift" || p == "lshift" || p == "rshift") shift = true;
                else if (p == "win" || p == "meta" || p == "super" || p == "lwin" || p == "rwin") win = true;
                else
                {
                    ushort resolved = ResolveVk(p);
                    if (resolved != 0) mainVk = resolved;
                }
            }

            if (!ctrl && !alt && !shift && !win && mainVk == 0) return false;

            // Special guard for Win+L: call LockWorkStation directly so LWIN never gets stuck down across desktop switch
            if (win && !ctrl && !alt && !shift && mainVk == (ushort)'L')
            {
                return LockWorkStation();
            }

            var downList = new List<INPUT>();
            var upList = new List<INPUT>();

            if (ctrl)
            {
                downList.Add(CreateKeyInput(0x11, false, false));
                upList.Insert(0, CreateKeyInput(0x11, true, false));
            }
            if (alt)
            {
                downList.Add(CreateKeyInput(0x12, false, false));
                upList.Insert(0, CreateKeyInput(0x12, true, false));
            }
            if (shift)
            {
                downList.Add(CreateKeyInput(0x10, false, false));
                upList.Insert(0, CreateKeyInput(0x10, true, false));
            }
            if (win)
            {
                downList.Add(CreateKeyInput(0x5B, false, true));
                upList.Insert(0, CreateKeyInput(0x5B, true, true));
            }
            if (mainVk != 0)
            {
                bool ext = IsExtendedVk(mainVk);
                downList.Add(CreateKeyInput(mainVk, false, ext));
                upList.Insert(0, CreateKeyInput(mainVk, true, ext));
            }

            int cb = Marshal.SizeOf(typeof(INPUT));
            var downArr = downList.ToArray();
            var upArr = upList.ToArray();
            uint sentDown = SendInput((uint)downArr.Length, downArr, cb);
            Thread.Sleep(8);
            uint sentUp = SendInput((uint)upArr.Length, upArr, cb);
            return (sentDown + sentUp) > 0;
        }

        public static void SetWindowBounds(int x, int y, int width, int height, string target)
        {
            IntPtr hwnd = IntPtr.Zero;
            if (!string.IsNullOrEmpty(target))
            {
                string t = target.Trim().ToLowerInvariant();
                Process[] procs = Process.GetProcesses();
                try
                {
                    foreach (var p in procs)
                    {
                        try
                        {
                            if (hwnd == IntPtr.Zero && p.MainWindowHandle != IntPtr.Zero)
                            {
                                string pName = p.ProcessName.ToLowerInvariant();
                                string wTitle = p.MainWindowTitle.ToLowerInvariant();
                                if (pName.Contains(t) || wTitle.Contains(t))
                                {
                                    hwnd = p.MainWindowHandle;
                                }
                            }
                        }
                        catch { }
                        finally
                        {
                            try { p.Dispose(); } catch { }
                        }
                    }
                }
                finally
                {
                    foreach (var p in procs)
                    {
                        try { p.Dispose(); } catch { }
                    }
                }
            }

            if (hwnd == IntPtr.Zero)
            {
                hwnd = GetForegroundWindow();
            }

            if (hwnd != IntPtr.Zero)
            {
                ShowWindow(hwnd, 9); // SW_RESTORE
                SetWindowPos(hwnd, IntPtr.Zero, x, y, width, height, SWP_NOZORDER | SWP_SHOWWINDOW);
            }
        }

        public static string GetForegroundProcessInfo()
        {
            IntPtr hwnd = GetForegroundWindow();
            if (hwnd == IntPtr.Zero) return "";
            uint pid = 0;
            GetWindowThreadProcessId(hwnd, out pid);
            if (pid == 0) return "";
            string procName = "";
            try
            {
                using (Process p = Process.GetProcessById((int)pid))
                {
                    procName = p.ProcessName ?? "";
                }
            }
            catch { }
            string title = GetWindowTitleSafe(hwnd);
            return procName + "|" + pid + "|" + title.Replace("\r", "").Replace("\n", " ");
        }

        public static string CheckRunningProcesses(string csvNames)
        {
            if (string.IsNullOrWhiteSpace(csvNames)) return "";
            var targets = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (var raw in csvNames.Split(new char[] { ',' }, StringSplitOptions.RemoveEmptyEntries))
            {
                string clean = raw.Trim();
                if (clean.EndsWith(".exe", StringComparison.OrdinalIgnoreCase))
                {
                    clean = clean.Substring(0, clean.Length - 4);
                }
                if (!string.IsNullOrEmpty(clean)) targets.Add(clean);
            }
            if (targets.Count == 0) return "";

            var found = new List<string>();
            Process[] procs = Process.GetProcesses();
            try
            {
                foreach (var p in procs)
                {
                    try
                    {
                        string pName = p.ProcessName;
                        if (!string.IsNullOrEmpty(pName) && targets.Contains(pName))
                        {
                            found.Add(pName.ToLowerInvariant());
                            targets.Remove(pName);
                        }
                    }
                    catch { }
                    finally
                    {
                        try { p.Dispose(); } catch { }
                    }
                }
            }
            finally
            {
                foreach (var p in procs)
                {
                    try { p.Dispose(); } catch { }
                }
            }
            return string.Join(",", found);
        }

        public static string GetProcessWindowTitles(string csvNames)
        {
            if (string.IsNullOrWhiteSpace(csvNames)) return "";
            var targets = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (var raw in csvNames.Split(new char[] { ',' }, StringSplitOptions.RemoveEmptyEntries))
            {
                string clean = raw.Trim();
                if (clean.EndsWith(".exe", StringComparison.OrdinalIgnoreCase))
                {
                    clean = clean.Substring(0, clean.Length - 4);
                }
                if (!string.IsNullOrEmpty(clean)) targets.Add(clean);
            }
            if (targets.Count == 0) return "";

            var results = new List<string>();
            Process[] procs = Process.GetProcesses();
            try
            {
                foreach (var p in procs)
                {
                    try
                    {
                        string pName = p.ProcessName;
                        if (!string.IsNullOrEmpty(pName) && targets.Contains(pName) && p.MainWindowHandle != IntPtr.Zero)
                        {
                            string wTitle = GetWindowTitleSafe(p.MainWindowHandle).Replace(";;", ";").Replace("|", "-");
                            if (!string.IsNullOrWhiteSpace(wTitle))
                            {
                                results.Add(pName.ToLowerInvariant() + "|" + wTitle);
                            }
                        }
                    }
                    catch { }
                    finally
                    {
                        try { p.Dispose(); } catch { }
                    }
                }
            }
            finally
            {
                foreach (var p in procs)
                {
                    try { p.Dispose(); } catch { }
                }
            }
            return string.Join(";;", results);
        }

        public static void PollProcessSnapshot(string mediaCsv, string watchCsv, out string mediaTitlesOut, out string runningProcsOut)
        {
            mediaTitlesOut = "";
            runningProcsOut = "";
            var mediaTargets = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            if (!string.IsNullOrWhiteSpace(mediaCsv))
            {
                foreach (var raw in mediaCsv.Split(new char[] { ',', '|', ';' }, StringSplitOptions.RemoveEmptyEntries))
                {
                    string clean = raw.Trim();
                    if (clean.EndsWith(".exe", StringComparison.OrdinalIgnoreCase)) clean = clean.Substring(0, clean.Length - 4);
                    if (!string.IsNullOrEmpty(clean)) mediaTargets.Add(clean);
                }
            }
            var watchTargets = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            if (!string.IsNullOrWhiteSpace(watchCsv))
            {
                foreach (var raw in watchCsv.Split(new char[] { ',', '|', ';' }, StringSplitOptions.RemoveEmptyEntries))
                {
                    string clean = raw.Trim();
                    if (clean.EndsWith(".exe", StringComparison.OrdinalIgnoreCase)) clean = clean.Substring(0, clean.Length - 4);
                    if (!string.IsNullOrEmpty(clean)) watchTargets.Add(clean);
                }
            }
            if (mediaTargets.Count == 0 && watchTargets.Count == 0) return;

            var mediaResults = new List<string>();
            var foundWatch = new List<string>();
            Process[] procs = Process.GetProcesses();
            try
            {
                foreach (var p in procs)
                {
                    try
                    {
                        string pName = p.ProcessName;
                        if (string.IsNullOrEmpty(pName)) continue;
                        if (watchTargets.Contains(pName))
                        {
                            foundWatch.Add(pName.ToLowerInvariant());
                            watchTargets.Remove(pName);
                        }
                        if (mediaTargets.Contains(pName) && p.MainWindowHandle != IntPtr.Zero)
                        {
                            string wTitle = GetWindowTitleSafe(p.MainWindowHandle).Replace(";;", ";").Replace("|", "-");
                            if (!string.IsNullOrWhiteSpace(wTitle))
                            {
                                mediaResults.Add(pName.ToLowerInvariant() + "|" + wTitle);
                            }
                        }
                    }
                    catch { }
                    finally
                    {
                        try { p.Dispose(); } catch { }
                    }
                }
            }
            finally
            {
                foreach (var p in procs)
                {
                    try { p.Dispose(); } catch { }
                }
            }
            foundWatch.Sort(StringComparer.Ordinal);
            mediaTitlesOut = string.Join(";;", mediaResults);
            runningProcsOut = string.Join(",", foundWatch);
        }

        static List<string> ParseProcessCandidates(string procName)
        {
            var list = new List<string>();
            if (string.IsNullOrWhiteSpace(procName)) return list;
            foreach (var raw in procName.Split(new char[] { '|', ',', ';' }, StringSplitOptions.RemoveEmptyEntries))
            {
                string t = raw.Trim();
                if (t.EndsWith(".exe", StringComparison.OrdinalIgnoreCase))
                {
                    t = t.Substring(0, t.Length - 4);
                }
                if (!string.IsNullOrEmpty(t) && !list.Contains(t))
                {
                    list.Add(t);
                }
            }
            return list;
        }

        public static string QueryWindowState(string procName)
        {
            var candidates = ParseProcessCandidates(procName);
            if (candidates.Count == 0) return "NOT_RUNNING";
            IntPtr fallbackHwnd = IntPtr.Zero;
            bool anyAlive = false;
            var pids = new HashSet<uint>();
            foreach (var target in candidates)
            {
                Process[] procs = Process.GetProcessesByName(target);
                try
                {
                    foreach (var p in procs)
                    {
                        try
                        {
                            anyAlive = true;
                            pids.Add((uint)p.Id);
                            if (fallbackHwnd == IntPtr.Zero && p.MainWindowHandle != IntPtr.Zero && IsWindowVisible(p.MainWindowHandle))
                            {
                                fallbackHwnd = p.MainWindowHandle;
                            }
                        }
                        catch { }
                    }
                }
                finally
                {
                    foreach (var p in procs) { try { p.Dispose(); } catch { } }
                }
            }
            if (!anyAlive) return "NOT_RUNNING";
            IntPtr fg = GetForegroundWindow();
            IntPtr hwnd = FindBestProcessWindow(pids, fg);
            if (hwnd == IntPtr.Zero) hwnd = fallbackHwnd;
            if (hwnd == IntPtr.Zero) return "TRAY_HIDDEN";
            if (IsIconic(hwnd)) return "MINIMIZED";
            IntPtr fgOwner = fg != IntPtr.Zero ? GetWindow(fg, GW_OWNER) : IntPtr.Zero;
            if (fg == hwnd || fgOwner == hwnd) return "FOREGROUND";
            return "BACKGROUND";
        }

        public static string ActivateOrToggleWindow(string procName, bool allowMinimize)
        {
            // 关键修复：将窗口激活操作封送到拥有真实 Win32 消息队列的 _guardForm UI 线程执行，
            // 使 AttachThreadInput 100% 生效，彻底解决后台控制台线程无法抢占前台焦点、仅在任务栏闪烁的问题。
            if (_guardForm != null && !_guardForm.IsDisposed && _guardForm.IsHandleCreated && _guardForm.InvokeRequired)
            {
                try
                {
                    return (string)_guardForm.Invoke(new Func<string>(() => ActivateOrToggleWindowCore(procName, allowMinimize)));
                }
                catch { }
            }
            return ActivateOrToggleWindowCore(procName, allowMinimize);
        }

        private static string ActivateOrToggleWindowCore(string procName, bool allowMinimize)
        {
            var candidates = ParseProcessCandidates(procName);
            if (candidates.Count == 0) return "ERR EMPTY";

            IntPtr fallbackHwnd = IntPtr.Zero;
            var pids = new HashSet<uint>();
            foreach (var target in candidates)
            {
                Process[] procs = Process.GetProcessesByName(target);
                try
                {
                    foreach (var p in procs)
                    {
                        try
                        {
                            pids.Add((uint)p.Id);
                            if (fallbackHwnd == IntPtr.Zero && p.MainWindowHandle != IntPtr.Zero && IsWindowVisible(p.MainWindowHandle))
                            {
                                fallbackHwnd = p.MainWindowHandle;
                            }
                        }
                        catch { }
                    }
                }
                finally
                {
                    foreach (var p in procs)
                    {
                        try { p.Dispose(); } catch { }
                    }
                }
            }

            if (pids.Count == 0) return "NOT_RUNNING";

            IntPtr fg = GetForegroundWindow();
            uint fgPid = 0;
            if (fg != IntPtr.Zero) GetWindowThreadProcessId(fg, out fgPid);

            IntPtr hwnd = FindBestProcessWindow(pids, fg);
            if (hwnd == IntPtr.Zero) hwnd = fallbackHwnd;
            if (hwnd == IntPtr.Zero) return "TRAY_HIDDEN";

            IntPtr fgOwner = fg != IntPtr.Zero ? GetWindow(fg, GW_OWNER) : IntPtr.Zero;
            bool isAlreadyFg = (fg == hwnd) || (fgOwner == hwnd);

            if (allowMinimize && isAlreadyFg && !IsIconic(hwnd))
            {
                ShowWindow(hwnd, 6); // SW_MINIMIZE
                return "MINIMIZED";
            }

            uint targetPid = 0;
            uint fgThread = fg != IntPtr.Zero ? GetWindowThreadProcessId(fg, out fgPid) : 0;
            uint targetThread = GetWindowThreadProcessId(hwnd, out targetPid);
            uint curThread = GetCurrentThreadId();

            IntPtr oldLockTimeout = IntPtr.Zero;
            bool hasLockTimeout = SystemParametersInfo(SPI_GETFOREGROUNDLOCKTIMEOUT, 0, out oldLockTimeout, 0);
            if (hasLockTimeout)
            {
                SystemParametersInfo(SPI_SETFOREGROUNDLOCKTIMEOUT, 0, IntPtr.Zero, SPIF_SENDCHANGE);
            }

            bool attachedFg = false;
            bool attachedTarget = false;
            try
            {
                AllowSetForegroundWindow(-1);
                if (fgThread != 0 && fgThread != curThread)
                {
                    attachedFg = AttachThreadInput(curThread, fgThread, true);
                }
                if (targetThread != 0 && targetThread != curThread)
                {
                    attachedTarget = AttachThreadInput(curThread, targetThread, true);
                }

                if (IsIconic(hwnd))
                {
                    ShowWindow(hwnd, 9); // SW_RESTORE
                }
                else
                {
                    ShowWindow(hwnd, 5); // SW_SHOW
                }

                BringWindowToTop(hwnd);
                SetForegroundWindow(hwnd);
                SetFocus(hwnd);

                if (GetForegroundWindow() != hwnd)
                {
                    // 发送扩展 ALT 键脉冲解除 win32k 前台输入锁
                    keybd_event(0x12, 0x38, KEYEVENTF_EXTENDEDKEY, UIntPtr.Zero);
                    keybd_event(0x12, 0x38, KEYEVENTF_EXTENDEDKEY | KEYEVENTF_KEYUP, UIntPtr.Zero);
                    BringWindowToTop(hwnd);
                    SetForegroundWindow(hwnd);
                    SwitchToThisWindow(hwnd, true);
                }
            }
            finally
            {
                if (attachedTarget) AttachThreadInput(curThread, targetThread, false);
                if (attachedFg) AttachThreadInput(curThread, fgThread, false);
                if (hasLockTimeout)
                {
                    SystemParametersInfo(SPI_SETFOREGROUNDLOCKTIMEOUT, 0, oldLockTimeout, SPIF_SENDCHANGE);
                }
            }

            if (GetForegroundWindow() != hwnd)
            {
                // 终极兜底：通过最小化再恢复接管任务栏窗口焦点，避免二次失败 SetForegroundWindow 引起任务栏空闪
                SetWindowPos(hwnd, new IntPtr(-1), 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_SHOWWINDOW);
                SetWindowPos(hwnd, new IntPtr(-2), 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_SHOWWINDOW);
                SwitchToThisWindow(hwnd, true);
            }
            return (GetForegroundWindow() == hwnd) ? "FOCUSED" : "FLASHED";
        }

        public static bool GracefulCloseProcess(string procName)
        {
            if (string.IsNullOrWhiteSpace(procName)) return false;
            string target = procName.Trim();
            if (target.EndsWith(".exe", StringComparison.OrdinalIgnoreCase))
            {
                target = target.Substring(0, target.Length - 4);
            }
            bool closedAny = false;
            Process[] procs = Process.GetProcessesByName(target);
            try
            {
                foreach (var p in procs)
                {
                    try
                    {
                        if (p.MainWindowHandle != IntPtr.Zero)
                        {
                            PostMessage(p.MainWindowHandle, WM_CLOSE, IntPtr.Zero, IntPtr.Zero);
                            closedAny = true;
                        }
                    }
                    catch { }
                }
            }
            finally
            {
                foreach (var p in procs)
                {
                    try { p.Dispose(); } catch { }
                }
            }
            return closedAny;
        }

        public static void SendMedia(string cmd)
        {
            byte vk = 0;
            string c = (cmd ?? "").ToLowerInvariant();
            if (c == "vol_up") vk = 0xAF;
            else if (c == "vol_down") vk = 0xAE;
            else if (c == "mute") vk = 0xAD;
            else if (c == "play_pause") vk = 0xB3;
            else if (c == "next") vk = 0xB0;
            else if (c == "prev") vk = 0xB1;

            if (vk != 0)
            {
                var inputs = new INPUT[2];
                inputs[0] = new INPUT { type = INPUT_KEYBOARD, u = new InputUnion { ki = new KEYBDINPUT { wVk = vk } } };
                inputs[1] = new INPUT { type = INPUT_KEYBOARD, u = new InputUnion { ki = new KEYBDINPUT { wVk = vk, dwFlags = KEYEVENTF_KEYUP } } };
                SendInput(2, inputs, Marshal.SizeOf(typeof(INPUT)));
            }
        }

        #region Native Icon Extraction, Registry Probe, Pixel Color & Macro Recording

        public static string ExtractIconDataUrl(string filePath, int iconIndex)
        {
            if (string.IsNullOrWhiteSpace(filePath) || !File.Exists(filePath)) return "";
            Bitmap bmp = null;
            IntPtr hIcon = IntPtr.Zero;
            try
            {
                IntPtr[] large = new IntPtr[1];
                int count = ExtractIconEx(filePath, iconIndex, large, null, 1);
                if (count > 0 && large[0] != IntPtr.Zero)
                {
                    hIcon = large[0];
                    using (Icon ico = Icon.FromHandle(hIcon))
                    {
                        bmp = ico.ToBitmap();
                    }
                }
                else
                {
                    using (Icon assoc = Icon.ExtractAssociatedIcon(filePath))
                    {
                        if (assoc != null) bmp = assoc.ToBitmap();
                    }
                }

                if (bmp != null)
                {
                    using (var ms = new MemoryStream())
                    {
                        bmp.Save(ms, ImageFormat.Png);
                        return "data:image/png;base64," + Convert.ToBase64String(ms.ToArray());
                    }
                }
            }
            catch { }
            finally
            {
                if (bmp != null) try { bmp.Dispose(); } catch { }
                if (hIcon != IntPtr.Zero) try { DestroyIcon(hIcon); } catch { }
            }
            return "";
        }

        public static string QueryAppPathRegistry(string exeName)
        {
            if (string.IsNullOrWhiteSpace(exeName)) return "";
            string target = exeName.Trim();
            if (!target.EndsWith(".exe", StringComparison.OrdinalIgnoreCase)) target += ".exe";
            string subKey = @"Software\Microsoft\Windows\CurrentVersion\App Paths\" + target;
            string subKeyWow = @"SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\App Paths\" + target;

            RegistryKey[] roots = new RegistryKey[] { Registry.CurrentUser, Registry.LocalMachine };
            string[] paths = new string[] { subKey, subKeyWow };

            foreach (var r in roots)
            {
                foreach (var p in paths)
                {
                    try
                    {
                        using (var k = r.OpenSubKey(p, false))
                        {
                            if (k != null)
                            {
                                object val = k.GetValue(null);
                                if (val != null)
                                {
                                    string cand = val.ToString().Trim().Trim('"');
                                    if (File.Exists(cand)) return cand;
                                }
                            }
                        }
                    }
                    catch { }
                }
            }
            return "";
        }

        public static string GetScreenPixelHex(int x, int y)
        {
            try
            {
                using (var bmp = new Bitmap(1, 1, PixelFormat.Format32bppArgb))
                {
                    using (var g = Graphics.FromImage(bmp))
                    {
                        g.CopyFromScreen(x, y, 0, 0, new Size(1, 1), CopyPixelOperation.SourceCopy);
                    }
                    Color c = bmp.GetPixel(0, 0);
                    return string.Format("#{0:X2}{1:X2}{2:X2}", c.R, c.G, c.B);
                }
            }
            catch
            {
                return "";
            }
        }

        public static string FindColorInRegion(int rx, int ry, int rw, int rh, string targetHex, int tolerance)
        {
            try
            {
                string clean = (targetHex ?? "").Trim().TrimStart('#');
                if (clean.Length != 6) return "0 -1,-1";
                int tr = Convert.ToInt32(clean.Substring(0, 2), 16);
                int tg = Convert.ToInt32(clean.Substring(2, 2), 16);
                int tb = Convert.ToInt32(clean.Substring(4, 2), 16);
                int w = Math.Max(1, Math.Min(3840, rw));
                int h = Math.Max(1, Math.Min(2160, rh));
                int tol = Math.Max(0, Math.Min(255, tolerance));

                using (var bmp = new Bitmap(w, h, PixelFormat.Format32bppArgb))
                {
                    using (var g = Graphics.FromImage(bmp))
                    {
                        g.CopyFromScreen(rx, ry, 0, 0, new Size(w, h), CopyPixelOperation.SourceCopy);
                    }
                    BitmapData bd = bmp.LockBits(new Rectangle(0, 0, w, h), ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
                    try
                    {
                        int stride = Math.Abs(bd.Stride);
                        byte[] buf = new byte[stride * h];
                        Marshal.Copy(bd.Scan0, buf, 0, buf.Length);
                        int step = (w * h > 160000) ? 2 : 1;
                        for (int dy = 0; dy < h; dy += step)
                        {
                            int rowOffset = dy * stride;
                            for (int dx = 0; dx < w; dx += step)
                            {
                                int idx = rowOffset + (dx * 4);
                                int b = buf[idx];
                                int gVal = buf[idx + 1];
                                int r = buf[idx + 2];
                                if (Math.Abs(r - tr) <= tol && Math.Abs(gVal - tg) <= tol && Math.Abs(b - tb) <= tol)
                                {
                                    return string.Format("1 {0},{1} #{2:X2}{3:X2}{4:X2}", rx + dx, ry + dy, r, gVal, b);
                                }
                            }
                        }
                    }
                    finally
                    {
                        bmp.UnlockBits(bd);
                    }
                }
            }
            catch { }
            return "0 -1,-1";
        }

        private static long _prevRxBytes = -1;
        private static long _prevTxBytes = -1;
        private static long _prevNetTick = 0;
        private static double _lastRxKbps = 0;
        private static double _lastTxKbps = 0;

        public static string GetNetworkSpeedStats()
        {
            try
            {
                long now = Environment.TickCount & Int32.MaxValue;
                long rx = 0, tx = 0;
                foreach (var ni in NetworkInterface.GetAllNetworkInterfaces())
                {
                    if (ni.OperationalStatus != OperationalStatus.Up) continue;
                    if (ni.NetworkInterfaceType == NetworkInterfaceType.Loopback || ni.NetworkInterfaceType == NetworkInterfaceType.Tunnel) continue;
                    var stats = ni.GetIPv4Statistics();
                    rx += stats.BytesReceived;
                    tx += stats.BytesSent;
                }
                if (_prevRxBytes >= 0 && _prevNetTick > 0)
                {
                    long dt = now - _prevNetTick;
                    if (dt >= 400)
                    {
                        _lastRxKbps = Math.Max(0, ((rx - _prevRxBytes) * 1000.0 / dt) / 1024.0);
                        _lastTxKbps = Math.Max(0, ((tx - _prevTxBytes) * 1000.0 / dt) / 1024.0);
                        _prevRxBytes = rx;
                        _prevTxBytes = tx;
                        _prevNetTick = now;
                    }
                }
                else
                {
                    _prevRxBytes = rx;
                    _prevTxBytes = tx;
                    _prevNetTick = now;
                }
                return string.Format("{0:F1}|{1:F1}", _lastRxKbps, _lastTxKbps);
            }
            catch
            {
                return "0.0|0.0";
            }
        }

        private static volatile bool _stopMacroRecord = false;

        static string VkToRecordName(int vk)
        {
            if (vk >= 0x41 && vk <= 0x5A) return ((char)vk).ToString();
            if (vk >= 0x30 && vk <= 0x39) return ((char)vk).ToString();
            if (vk >= 0x60 && vk <= 0x69) return "Num" + (vk - 0x60);
            if (vk >= 0x70 && vk <= 0x87) return "F" + (vk - 0x70 + 1);
            switch (vk)
            {
                case 0x0D: return "Enter";
                case 0x09: return "Tab";
                case 0x20: return "Space";
                case 0x08: return "Backspace";
                case 0x2E: return "Delete";
                case 0x2D: return "Insert";
                case 0x24: return "Home";
                case 0x23: return "End";
                case 0x21: return "PgUp";
                case 0x22: return "PgDn";
                case 0x26: return "Up";
                case 0x28: return "Down";
                case 0x25: return "Left";
                case 0x27: return "Right";
                case 0x2C: return "PrtScn";
                case 0x14: return "CapsLock";
                case 0xBA: return ";";
                case 0xBB: return "plus";
                case 0xBC: return ",";
                case 0xBD: return "-";
                case 0xBE: return ".";
                case 0xBF: return "/";
                case 0xC0: return "`";
                case 0xDB: return "[";
                case 0xDC: return "\\";
                case 0xDD: return "]";
                case 0xDE: return "'";
            }
            return null;
        }

        public static string RecordMacroSequence(int maxDurationMs)
        {
            _stopMacroRecord = false;
            int maxMs = Math.Max(1000, Math.Min(60000, maxDurationMs));
            var steps = new List<string>();
            var prevDown = new bool[256];

            // 等待启动录制按钮的鼠标左键松开并预留 180ms 防误触窗口期
            int waitRelease = 0;
            while (((GetAsyncKeyState(0x01) & 0x8000) != 0) && waitRelease < 40)
            {
                Thread.Sleep(15);
                waitRelease++;
            }
            Thread.Sleep(180);

            for (int v = 1; v < 255; v++)
            {
                prevDown[v] = (GetAsyncKeyState(v) & 0x8000) != 0;
            }

            Stopwatch sw = Stopwatch.StartNew();
            long lastEventMs = 0;

            int[] watchKeys = new int[] {
                0x0D, 0x09, 0x20, 0x08, 0x2E, 0x2D, 0x24, 0x23, 0x21, 0x22, 0x26, 0x28, 0x25, 0x27, 0x2C, 0x14,
                0x30, 0x31, 0x32, 0x33, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39,
                0x41, 0x42, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49, 0x4A, 0x4B, 0x4C, 0x4D,
                0x4E, 0x4F, 0x50, 0x51, 0x52, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59, 0x5A,
                0x60, 0x61, 0x62, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69,
                0x70, 0x71, 0x72, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78, 0x79, 0x7A, 0x7B,
                0xBA, 0xBB, 0xBC, 0xBD, 0xBE, 0xBF, 0xC0, 0xDB, 0xDC, 0xDD, 0xDE
            };

            while (!_stopMacroRecord && sw.ElapsedMilliseconds < maxMs && steps.Count < 80)
            {
                // Esc stops recording immediately
                if ((GetAsyncKeyState(0x1B) & 0x8000) != 0 && !prevDown[0x1B])
                {
                    break;
                }
                prevDown[0x1B] = (GetAsyncKeyState(0x1B) & 0x8000) != 0;

                // Check mouse buttons (L, R, M)
                int[] mBtns = new int[] { 0x01, 0x02, 0x04 };
                string[] mNames = new string[] { "left", "right", "middle" };
                for (int bi = 0; bi < mBtns.Length; bi++)
                {
                    int mv = mBtns[bi];
                    bool isDown = (GetAsyncKeyState(mv) & 0x8000) != 0;
                    if (isDown && !prevDown[mv])
                    {
                        long nowMs = sw.ElapsedMilliseconds;
                        long gap = nowMs - lastEventMs;
                        if (lastEventMs > 0 && gap >= 40)
                        {
                            steps.Add("delay:" + Math.Min(10000, gap));
                        }
                        lastEventMs = nowMs;
                        POINT pt;
                        GetCursorPos(out pt);
                        steps.Add(string.Format("mouse_click:{0}:{1}:{2}", mNames[bi], pt.X, pt.Y));
                    }
                    prevDown[mv] = isDown;
                }

                // Check keyboard keys with modifiers
                bool ctrl = (GetAsyncKeyState(0x11) & 0x8000) != 0;
                bool alt = (GetAsyncKeyState(0x12) & 0x8000) != 0;
                bool shift = (GetAsyncKeyState(0x10) & 0x8000) != 0;
                bool win = ((GetAsyncKeyState(0x5B) & 0x8000) != 0) || ((GetAsyncKeyState(0x5C) & 0x8000) != 0);

                foreach (int kv in watchKeys)
                {
                    bool isDown = (GetAsyncKeyState(kv) & 0x8000) != 0;
                    if (isDown && !prevDown[kv])
                    {
                        string kName = VkToRecordName(kv);
                        if (!string.IsNullOrEmpty(kName))
                        {
                            long nowMs = sw.ElapsedMilliseconds;
                            long gap = nowMs - lastEventMs;
                            if (lastEventMs > 0 && gap >= 40)
                            {
                                steps.Add("delay:" + Math.Min(10000, gap));
                            }
                            lastEventMs = nowMs;
                            var mods = new List<string>();
                            if (ctrl) mods.Add("Ctrl");
                            if (alt) mods.Add("Alt");
                            if (shift) mods.Add("Shift");
                            if (win) mods.Add("Win");
                            mods.Add(kName);
                            steps.Add("hotkey:" + string.Join("+", mods));
                        }
                    }
                    prevDown[kv] = isDown;
                }

                Thread.Sleep(15);
            }

            return string.Join(";", steps);
        }

        #endregion

        #region CoreAudio & Audio Control

        [ComImport]
        [Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
        class MMDeviceEnumeratorComObject { }

        [Guid("7991EEC9-7E89-4D85-8390-6C703CEC60C0"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        interface IMMNotificationClient
        {
            [PreserveSig] int OnDeviceStateChanged([MarshalAs(UnmanagedType.LPWStr)] string pwstrDeviceId, int dwNewState);
            [PreserveSig] int OnDeviceAdded([MarshalAs(UnmanagedType.LPWStr)] string pwstrDeviceId);
            [PreserveSig] int OnDeviceRemoved([MarshalAs(UnmanagedType.LPWStr)] string pwstrDeviceId);
            [PreserveSig] int OnDefaultDeviceChanged(int flow, int role, [MarshalAs(UnmanagedType.LPWStr)] string pwstrDefaultDeviceId);
            [PreserveSig] int OnPropertyValueChanged([MarshalAs(UnmanagedType.LPWStr)] string pwstrDeviceId, PROPERTYKEY key);
        }

        [Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        interface IMMDeviceEnumerator
        {
            int EnumAudioEndpoints(int dataFlow, int dwStateMask, out IMMDeviceCollection ppDevices);
            int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice ppEndpoint);
            int GetDevice(string pwstrId, out IMMDevice ppDevice);
            int RegisterEndpointNotificationCallback(IMMNotificationClient pClient);
            int UnregisterEndpointNotificationCallback(IMMNotificationClient pClient);
        }

        [Guid("0BD7A1BE-7A1A-44DB-8397-CC5392387B5E"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        interface IMMDeviceCollection
        {
            int GetCount(out uint pcDevices);
            int Item(uint nDevice, out IMMDevice ppDevice);
        }

        [Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        interface IMMDevice
        {
            int Activate(ref Guid iid, int dwClsCtx, IntPtr pActivationParams, [MarshalAs(UnmanagedType.IUnknown)] out object ppInterface);
            int OpenPropertyStore(int stgmAccess, out IPropertyStore ppProperties);
            int GetId([MarshalAs(UnmanagedType.LPWStr)] out string ppstrId);
            int GetState(out int pdwState);
        }

        [StructLayout(LayoutKind.Sequential, Pack = 4)]
        struct PROPERTYKEY
        {
            public Guid fmtid;
            public uint pid;
        }

        [StructLayout(LayoutKind.Explicit)]
        struct PROPVARIANT
        {
            [FieldOffset(0)] public ushort vt;
            [FieldOffset(8)] public IntPtr pwszVal;
            [FieldOffset(8)] public long uhVal;
        }

        [Guid("886d8eeb-8cf2-4446-8d02-cdba1dbdcf99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        interface IPropertyStore
        {
            int GetCount(out uint cProps);
            int GetAt(uint iProp, out PROPERTYKEY pkey);
            int GetValue(ref PROPERTYKEY key, out PROPVARIANT pv);
            int SetValue(ref PROPERTYKEY key, ref PROPVARIANT propvar);
            int Commit();
        }

        [Guid("657804FA-D6AD-4496-8A60-352752AF4F89"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        interface IAudioEndpointVolumeCallback
        {
            [PreserveSig]
            int OnNotify(IntPtr pNotifyData);
        }

        sealed class MasterVolumeCallback : IAudioEndpointVolumeCallback
        {
            private int _lastPct = -1;
            private int _lastMute = -1;

            public int OnNotify(IntPtr pNotifyData)
            {
                try
                {
                    if (pNotifyData == IntPtr.Zero) return 0;
                    int bMuted = Marshal.ReadInt32(pNotifyData, 16);
                    int rawFloat = Marshal.ReadInt32(pNotifyData, 20);
                    float level = BitConverter.ToSingle(BitConverter.GetBytes(rawFloat), 0);
                    int pct = (int)Math.Round(Math.Max(0f, Math.Min(1f, level)) * 100f);
                    int mute = (bMuted != 0) ? 1 : 0;
                    if (pct != _lastPct || mute != _lastMute)
                    {
                        _lastPct = pct;
                        _lastMute = mute;
                        EmitEvent("volume", pct.ToString() + " " + mute.ToString());
                    }
                }
                catch { }
                return 0;
            }
        }

        sealed class AudioEndpointNotificationClient : IMMNotificationClient
        {
            public int OnDeviceStateChanged(string pwstrDeviceId, int dwNewState) { return 0; }
            public int OnDeviceAdded(string pwstrDeviceId) { return 0; }
            public int OnDeviceRemoved(string pwstrDeviceId) { return 0; }
            public int OnDefaultDeviceChanged(int flow, int role, string pwstrDefaultDeviceId)
            {
                if (flow == 0 && (role == 0 || role == 1))
                {
                    ThreadPool.QueueUserWorkItem(_ =>
                    {
                        try
                        {
                            Thread.Sleep(60);
                            SubscribeVolumeEvents(true);
                            int lvl; bool mute;
                            if (AudioGetVolume(out lvl, out mute))
                            {
                                EmitEvent("volume", lvl.ToString() + " " + (mute ? "1" : "0"));
                            }
                            EmitEvent("audio_device", pwstrDefaultDeviceId ?? "");
                        }
                        catch { }
                    });
                }
                return 0;
            }
            public int OnPropertyValueChanged(string pwstrDeviceId, PROPERTYKEY key) { return 0; }
        }

        private static readonly object _epvSubLock = new object();
        private static IMMDeviceEnumerator _subscribedEnumerator = null;
        private static AudioEndpointNotificationClient _endpointClient = null;
        private static IAudioEndpointVolume _subscribedEpv = null;
        private static MasterVolumeCallback _volumeCallback = null;

        public static void SubscribeVolumeEvents(bool forceRebind = false)
        {
            lock (_epvSubLock)
            {
                if (_subscribedEpv != null && !forceRebind) return;
                try
                {
                    if (_subscribedEpv != null && _volumeCallback != null)
                    {
                        try { _subscribedEpv.UnregisterControlChangeNotify(_volumeCallback); } catch { }
                        try { Marshal.ReleaseComObject(_subscribedEpv); } catch { }
                        _subscribedEpv = null;
                    }
                    if (_subscribedEnumerator == null)
                    {
                        _subscribedEnumerator = (IMMDeviceEnumerator)new MMDeviceEnumeratorComObject();
                        _endpointClient = new AudioEndpointNotificationClient();
                        try { _subscribedEnumerator.RegisterEndpointNotificationCallback(_endpointClient); } catch { }
                    }
                    IMMDevice dev;
                    if (_subscribedEnumerator.GetDefaultAudioEndpoint(0, 1, out dev) == 0 && dev != null)
                    {
                        var iid = typeof(IAudioEndpointVolume).GUID;
                        object epvObj;
                        if (dev.Activate(ref iid, 1, IntPtr.Zero, out epvObj) == 0 && epvObj != null)
                        {
                            _subscribedEpv = (IAudioEndpointVolume)epvObj;
                            if (_volumeCallback == null) _volumeCallback = new MasterVolumeCallback();
                            _subscribedEpv.RegisterControlChangeNotify(_volumeCallback);
                        }
                        try { Marshal.ReleaseComObject(dev); } catch { }
                    }
                }
                catch { }
            }
        }

        [Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        interface IAudioEndpointVolume
        {
            int RegisterControlChangeNotify(IAudioEndpointVolumeCallback pNotify);
            int UnregisterControlChangeNotify(IAudioEndpointVolumeCallback pNotify);
            int GetChannelCount(out uint pnChannelCount);
            int SetMasterVolumeLevel(float fLevelDB, ref Guid pguidEventContext);
            int SetMasterVolumeLevelScalar(float fLevel, ref Guid pguidEventContext);
            int GetMasterVolumeLevel(out float pfLevelDB);
            int GetMasterVolumeLevelScalar(out float pfLevel);
            int SetChannelVolumeLevel(uint nChannel, float fLevelDB, ref Guid pguidEventContext);
            int SetChannelVolumeLevelScalar(uint nChannel, float fLevel, ref Guid pguidEventContext);
            int GetChannelVolumeLevel(uint nChannel, out float pfLevelDB);
            int GetChannelVolumeLevelScalar(uint nChannel, out float pfLevel);
            int SetMute([MarshalAs(UnmanagedType.Bool)] bool bMute, ref Guid pguidEventContext);
            int GetMute(out bool pbMute);
            int GetVolumeStepInfo(out uint pnStep, out uint pnStepCount);
            int VolumeStepUp(ref Guid pguidEventContext);
            int VolumeStepDown(ref Guid pguidEventContext);
            int QueryHardwareSupport(out uint pdwHardwareSupportMask);
            int GetVolumeRange(out float pflVolumeMindB, out float pflVolumeMaxdB, out float pflVolumeIncrementdB);
        }

        [ComImport]
        [Guid("870af99c-171d-4f9e-af0d-e63df40c2bc9")]
        class PolicyConfigComObject { }

        [Guid("f8679f50-850a-41cf-9c72-430f290290c8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        interface IPolicyConfig
        {
            int GetMixFormat(string pszDeviceName, out IntPtr ppFormat);
            int GetDeviceFormat(string pszDeviceName, int bDefault, out IntPtr ppFormat);
            int ResetDeviceFormat(string pszDeviceName);
            int SetDeviceFormat(string pszDeviceName, IntPtr pEndpointFormat, IntPtr pMixFormat);
            int GetProcessingPeriod(string pszDeviceName, int bDefault, out long pmftDefaultPeriod, out long pmftMinimumPeriod);
            int SetProcessingPeriod(string pszDeviceName, long pmftPeriod);
            int GetShareMode(string pszDeviceName, out IntPtr pMode);
            int SetShareMode(string pszDeviceName, IntPtr pMode);
            int GetPropertyValue(string pszDeviceName, bool bFxStore, IntPtr key, out IntPtr pv);
            int SetPropertyValue(string pszDeviceName, bool bFxStore, IntPtr key, IntPtr pv);
            int SetDefaultEndpoint(string pszDeviceName, int role);
            int SetEndpointVisibility(string pszDeviceName, int bVisible);
        }

        static PROPERTYKEY PKEY_Device_FriendlyName = new PROPERTYKEY
        {
            fmtid = new Guid("a45c254e-df1c-4efd-8020-67d146a850e0"),
            pid = 14
        };

        public class AudioDeviceInfo
        {
            public string Id;
            public string Name;
            public bool IsDefault;
        }

        static bool WithMasterVolumeEndpoint(Func<IAudioEndpointVolume, bool> fn)
        {
            IMMDeviceEnumerator enumerator = null;
            IMMDevice dev = null;
            IAudioEndpointVolume epv = null;
            try
            {
                enumerator = (IMMDeviceEnumerator)new MMDeviceEnumeratorComObject();
                if (enumerator.GetDefaultAudioEndpoint(0, 1, out dev) != 0 || dev == null) return false;
                var iid = typeof(IAudioEndpointVolume).GUID;
                object epvObj;
                if (dev.Activate(ref iid, 1, IntPtr.Zero, out epvObj) != 0 || epvObj == null) return false;
                epv = (IAudioEndpointVolume)epvObj;
                return fn(epv);
            }
            catch
            {
                return false;
            }
            finally
            {
                if (epv != null) try { Marshal.ReleaseComObject(epv); } catch { }
                if (dev != null) try { Marshal.ReleaseComObject(dev); } catch { }
                if (enumerator != null) try { Marshal.ReleaseComObject(enumerator); } catch { }
            }
        }

        public static bool AudioGetVolume(out int level, out bool isMute)
        {
            int outLvl = 0;
            bool outMute = false;
            bool ok = WithMasterVolumeEndpoint(epv =>
            {
                float f;
                epv.GetMasterVolumeLevelScalar(out f);
                outLvl = (int)Math.Round(f * 100);
                epv.GetMute(out outMute);
                return true;
            });
            level = outLvl;
            isMute = outMute;
            return ok;
        }

        public static bool AudioSetVolume(int level)
        {
            return WithMasterVolumeEndpoint(epv =>
            {
                float f = Math.Max(0f, Math.Min(1f, (float)level / 100f));
                Guid empty = Guid.Empty;
                epv.SetMasterVolumeLevelScalar(f, ref empty);
                return true;
            });
        }

        private static int _volStepSeq = 0;

        public static bool AudioStepVolume(int delta, out int newLevel, out bool isMute, bool triggerOsd = true)
        {
            newLevel = 0;
            isMute = false;
            int curLevel;
            bool wasMute;
            if (!AudioGetVolume(out curLevel, out wasMute)) return false;

            int targetLvl = Math.Max(0, Math.Min(100, curLevel + delta));
            newLevel = targetLvl;
            isMute = wasMute;

            int mySeq = Interlocked.Increment(ref _volStepSeq);

            if (wasMute && delta > 0)
            {
                WithMasterVolumeEndpoint(epv =>
                {
                    Guid empty = Guid.Empty;
                    epv.SetMute(false, ref empty);
                    return true;
                });
                isMute = false;
            }

            AudioSetVolume(targetLvl);

            if (triggerOsd && !isMute)
            {
                SendMedia(delta >= 0 ? "vol_up" : "vol_down");
                AudioSetVolume(targetLvl);
                ThreadPool.QueueUserWorkItem(_ =>
                {
                    try
                    {
                        Thread.Sleep(24);
                        // 仅当后续没有更新的连按事件时才补写，彻底消除快速连按时的音量回跳竞态
                        if (Interlocked.CompareExchange(ref _volStepSeq, mySeq, mySeq) == mySeq)
                        {
                            AudioSetVolume(targetLvl);
                        }
                    }
                    catch { }
                });
            }
            return true;
        }

        public static bool AudioToggleMute(out bool newMute, out int curLevel, bool triggerOsd = true)
        {
            bool outMute = false;
            int outLvl = 0;
            bool ok = WithMasterVolumeEndpoint(epv =>
            {
                bool cur;
                epv.GetMute(out cur);
                Guid empty = Guid.Empty;
                epv.SetMute(!cur, ref empty);
                outMute = !cur;
                float f;
                epv.GetMasterVolumeLevelScalar(out f);
                outLvl = (int)Math.Round(f * 100);
                return true;
            });
            newMute = outMute;
            curLevel = outLvl;
            return ok;
        }

        public static List<AudioDeviceInfo> AudioGetDevices()
        {
            var list = new List<AudioDeviceInfo>();
            IMMDeviceEnumerator enumerator = null;
            IMMDevice defDev = null;
            IMMDeviceCollection col = null;
            try
            {
                enumerator = (IMMDeviceEnumerator)new MMDeviceEnumeratorComObject();
                string defId = "";
                if (enumerator.GetDefaultAudioEndpoint(0, 0, out defDev) == 0 && defDev != null)
                {
                    defDev.GetId(out defId);
                }

                enumerator.EnumAudioEndpoints(0, 1, out col);
                if (col == null) return list;
                uint count;
                col.GetCount(out count);
                for (uint i = 0; i < count; i++)
                {
                    IMMDevice d = null;
                    IPropertyStore store = null;
                    PROPVARIANT pv = new PROPVARIANT();
                    try
                    {
                        col.Item(i, out d);
                        if (d == null) continue;
                        string id;
                        d.GetId(out id);
                        d.OpenPropertyStore(0, out store);
                        string name = "Audio Device";
                        if (store != null && store.GetValue(ref PKEY_Device_FriendlyName, out pv) == 0)
                        {
                            if (pv.pwszVal != IntPtr.Zero)
                            {
                                name = Marshal.PtrToStringUni(pv.pwszVal) ?? "Audio Device";
                            }
                        }
                        list.Add(new AudioDeviceInfo { Id = id, Name = name, IsDefault = (id == defId) });
                    }
                    finally
                    {
                        try { PropVariantClear(ref pv); } catch { }
                        if (store != null) try { Marshal.ReleaseComObject(store); } catch { }
                        if (d != null) try { Marshal.ReleaseComObject(d); } catch { }
                    }
                }
            }
            catch { }
            finally
            {
                if (col != null) try { Marshal.ReleaseComObject(col); } catch { }
                if (defDev != null) try { Marshal.ReleaseComObject(defDev); } catch { }
                if (enumerator != null) try { Marshal.ReleaseComObject(enumerator); } catch { }
            }
            return list;
        }

        public static string AudioSwitchDevice(string target)
        {
            var devs = AudioGetDevices();
            if (devs.Count == 0) return "ERR NO_DEVICES";
            AudioDeviceInfo chosen = null;
            AudioDeviceInfo curDef = devs.Find(d => d.IsDefault);

            if (string.IsNullOrEmpty(target) || target.ToLowerInvariant() == "toggle" || target.ToLowerInvariant() == "next")
            {
                int idx = curDef != null ? devs.IndexOf(curDef) : -1;
                int nextIdx = (idx + 1) % devs.Count;
                chosen = devs[nextIdx];
            }
            else
            {
                chosen = devs.Find(d => d.Name.IndexOf(target, StringComparison.OrdinalIgnoreCase) >= 0 || d.Id.IndexOf(target, StringComparison.OrdinalIgnoreCase) >= 0);
            }

            if (chosen == null) return "ERR TARGET_NOT_FOUND";
            IPolicyConfig policy = null;
            try
            {
                policy = (IPolicyConfig)new PolicyConfigComObject();
                policy.SetDefaultEndpoint(chosen.Id, 0);
                policy.SetDefaultEndpoint(chosen.Id, 1);
                policy.SetDefaultEndpoint(chosen.Id, 2);
                return chosen.Name;
            }
            catch (Exception ex)
            {
                return "ERR " + ex.Message;
            }
            finally
            {
                if (policy != null) try { Marshal.ReleaseComObject(policy); } catch { }
            }
        }

        [Guid("C02216F6-8C67-4B5B-9D00-D008E73E0064"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        interface IAudioMeterInformation
        {
            int GetPeakValue(out float pfPeak);
            int GetMeteringChannelCount(out uint pnChannelCount);
            int GetChannelsPeakValues(uint u32ChannelCount, [In] IntPtr afPeakValues);
            int QueryHardwareSupport(out uint pdwHardwareSupportMask);
        }

        [Guid("F4B1A599-7266-4319-A8CA-E70ACB11E8CD"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        interface IAudioSessionControl
        {
            int GetState(out int pRetVal);
            int GetDisplayName([MarshalAs(UnmanagedType.LPWStr)] out string pRetVal);
            int SetDisplayName([MarshalAs(UnmanagedType.LPWStr)] string Value, ref Guid EventContext);
            int GetIconPath([MarshalAs(UnmanagedType.LPWStr)] out string pRetVal);
            int SetIconPath([MarshalAs(UnmanagedType.LPWStr)] string Value, ref Guid EventContext);
            int GetGroupingParam(out Guid pRetVal);
            int SetGroupingParam(ref Guid Override, ref Guid EventContext);
            int RegisterAudioSessionNotification(IntPtr NewNotifications);
            int UnregisterAudioSessionNotification(IntPtr NewNotifications);
        }

        [Guid("bfb7ff88-7239-4fc9-8fa2-07c950be9c6d"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        interface IAudioSessionControl2
        {
            int GetState(out int pRetVal);
            int GetDisplayName([MarshalAs(UnmanagedType.LPWStr)] out string pRetVal);
            int SetDisplayName([MarshalAs(UnmanagedType.LPWStr)] string Value, ref Guid EventContext);
            int GetIconPath([MarshalAs(UnmanagedType.LPWStr)] out string pRetVal);
            int SetIconPath([MarshalAs(UnmanagedType.LPWStr)] string Value, ref Guid EventContext);
            int GetGroupingParam(out Guid pRetVal);
            int SetGroupingParam(ref Guid Override, ref Guid EventContext);
            int RegisterAudioSessionNotification(IntPtr NewNotifications);
            int UnregisterAudioSessionNotification(IntPtr NewNotifications);
            int GetSessionIdentifier([MarshalAs(UnmanagedType.LPWStr)] out string pRetVal);
            int GetSessionInstanceIdentifier([MarshalAs(UnmanagedType.LPWStr)] out string pRetVal);
            int GetProcessId(out uint pRetVal);
            int IsSystemSoundsSession();
            int SetDuckingPreference([MarshalAs(UnmanagedType.Bool)] bool optOut);
        }

        [Guid("87CE5498-68D6-44E5-9215-6DA47EF883D8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        interface ISimpleAudioVolume
        {
            int SetMasterVolume(float fLevel, ref Guid EventContext);
            int GetMasterVolume(out float pfLevel);
            int SetMute([MarshalAs(UnmanagedType.Bool)] bool bMute, ref Guid EventContext);
            int GetMute(out bool pbMute);
        }

        [Guid("E2F5BB11-0570-40CA-ACDD-3AA01277DEE8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        interface IAudioSessionEnumerator
        {
            int GetCount(out int SessionCount);
            int GetSession(int SessionCount, out IAudioSessionControl Session);
        }

        [Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        interface IAudioSessionManager2
        {
            int GetAudioSessionControl(IntPtr AudioSessionGuid, uint StreamFlags, out IAudioSessionControl SessionControl);
            int GetSimpleAudioVolume(IntPtr AudioSessionGuid, uint StreamFlags, out ISimpleAudioVolume AudioVolume);
            int GetSessionEnumerator(out IAudioSessionEnumerator SessionEnum);
            int RegisterSessionNotification(IntPtr SessionNotification);
            int UnregisterSessionNotification(IntPtr SessionNotification);
            int RegisterDuckNotification([MarshalAs(UnmanagedType.LPWStr)] string sessionID, IntPtr duckNotification);
            int UnregisterDuckNotification(IntPtr duckNotification);
        }

        public static string AudioGetMasterAndMicPeak()
        {
            int outPeak = 0;
            int micPeak = 0;
            IMMDeviceEnumerator enumerator = null;
            IMMDevice renderDev = null;
            IMMDevice captureDev = null;
            try
            {
                enumerator = (IMMDeviceEnumerator)new MMDeviceEnumeratorComObject();
                var meterIid = typeof(IAudioMeterInformation).GUID;
                if (enumerator.GetDefaultAudioEndpoint(0, 1, out renderDev) == 0 && renderDev != null)
                {
                    object mObj;
                    if (renderDev.Activate(ref meterIid, 1, IntPtr.Zero, out mObj) == 0 && mObj != null)
                    {
                        var meter = (IAudioMeterInformation)mObj;
                        float pk;
                        if (meter.GetPeakValue(out pk) == 0) outPeak = (int)Math.Round(Math.Max(0f, Math.Min(1f, pk)) * 100f);
                        try { Marshal.ReleaseComObject(meter); } catch { }
                    }
                }
                if (enumerator.GetDefaultAudioEndpoint(1, 1, out captureDev) == 0 && captureDev != null)
                {
                    object mObj;
                    if (captureDev.Activate(ref meterIid, 1, IntPtr.Zero, out mObj) == 0 && mObj != null)
                    {
                        var meter = (IAudioMeterInformation)mObj;
                        float pk;
                        if (meter.GetPeakValue(out pk) == 0) micPeak = (int)Math.Round(Math.Max(0f, Math.Min(1f, pk)) * 100f);
                        try { Marshal.ReleaseComObject(meter); } catch { }
                    }
                }
            }
            catch { }
            finally
            {
                if (captureDev != null) try { Marshal.ReleaseComObject(captureDev); } catch { }
                if (renderDev != null) try { Marshal.ReleaseComObject(renderDev); } catch { }
                if (enumerator != null) try { Marshal.ReleaseComObject(enumerator); } catch { }
            }
            return outPeak + "|" + micPeak;
        }

        static string ResolveTargetAppProcess(string rawTarget)
        {
            string t = (rawTarget ?? "").Trim();
            if (string.IsNullOrEmpty(t) || t.Equals("@foreground", StringComparison.OrdinalIgnoreCase) || t.Equals("active", StringComparison.OrdinalIgnoreCase) || t.Equals("current", StringComparison.OrdinalIgnoreCase))
            {
                IntPtr fg = GetForegroundWindow();
                if (fg != IntPtr.Zero)
                {
                    uint pid = 0;
                    GetWindowThreadProcessId(fg, out pid);
                    if (pid != 0)
                    {
                        try
                        {
                            using (Process p = Process.GetProcessById((int)pid))
                            {
                                return (p.ProcessName ?? "").ToLowerInvariant();
                            }
                        }
                        catch { }
                    }
                }
                return "";
            }
            if (t.EndsWith(".exe", StringComparison.OrdinalIgnoreCase)) t = t.Substring(0, t.Length - 4);
            return t.ToLowerInvariant();
        }

        public static string AppAudioListSessions()
        {
            var results = new List<string>();
            var seenProc = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            IMMDeviceEnumerator enumerator = null;
            IMMDevice dev = null;
            IAudioSessionManager2 mgr = null;
            IAudioSessionEnumerator sesEnum = null;
            try
            {
                enumerator = (IMMDeviceEnumerator)new MMDeviceEnumeratorComObject();
                if (enumerator.GetDefaultAudioEndpoint(0, 1, out dev) != 0 || dev == null) return "";
                var mgrIid = typeof(IAudioSessionManager2).GUID;
                object mgrObj;
                if (dev.Activate(ref mgrIid, 1, IntPtr.Zero, out mgrObj) != 0 || mgrObj == null) return "";
                mgr = (IAudioSessionManager2)mgrObj;
                if (mgr.GetSessionEnumerator(out sesEnum) != 0 || sesEnum == null) return "";
                int count = 0;
                sesEnum.GetCount(out count);
                for (int i = 0; i < count; i++)
                {
                    IAudioSessionControl ctrl = null;
                    try
                    {
                        if (sesEnum.GetSession(i, out ctrl) != 0 || ctrl == null) continue;
                        var ctrl2 = ctrl as IAudioSessionControl2;
                        var vol = ctrl as ISimpleAudioVolume;
                        if (ctrl2 == null || vol == null) continue;
                        if (ctrl2.IsSystemSoundsSession() == 0) continue;
                        uint pid = 0;
                        ctrl2.GetProcessId(out pid);
                        if (pid == 0) continue;
                        string procName = "";
                        string title = "";
                        try
                        {
                            using (Process p = Process.GetProcessById((int)pid))
                            {
                                procName = p.ProcessName ?? "";
                                title = p.MainWindowTitle ?? "";
                            }
                        }
                        catch { continue; }
                        if (string.IsNullOrEmpty(procName) || !seenProc.Add(procName)) continue;
                        float lvl = 1f;
                        bool mute = false;
                        vol.GetMasterVolume(out lvl);
                        vol.GetMute(out mute);
                        int peak = 0;
                        var meter = ctrl as IAudioMeterInformation;
                        if (meter != null)
                        {
                            float pk = 0f;
                            if (meter.GetPeakValue(out pk) == 0) peak = (int)Math.Round(Math.Max(0f, Math.Min(1f, pk)) * 100f);
                        }
                        int pct = (int)Math.Round(Math.Max(0f, Math.Min(1f, lvl)) * 100f);
                        string cleanTitle = (string.IsNullOrEmpty(title) ? procName : title).Replace("|", "-").Replace(";;", ";");
                        results.Add(string.Format("{0}|{1}|{2}|{3}|{4}", procName, cleanTitle, pct, mute ? 1 : 0, peak));
                    }
                    catch { }
                    finally
                    {
                        if (ctrl != null) try { Marshal.ReleaseComObject(ctrl); } catch { }
                    }
                }
            }
            catch { }
            finally
            {
                if (sesEnum != null) try { Marshal.ReleaseComObject(sesEnum); } catch { }
                if (mgr != null) try { Marshal.ReleaseComObject(mgr); } catch { }
                if (dev != null) try { Marshal.ReleaseComObject(dev); } catch { }
                if (enumerator != null) try { Marshal.ReleaseComObject(enumerator); } catch { }
            }
            return string.Join(";;", results);
        }

        public static string AppAudioControl(string rawTarget, string op, int value)
        {
            string target = ResolveTargetAppProcess(rawTarget);
            if (string.IsNullOrEmpty(target)) return "ERR NO_TARGET";
            var candidates = ParseProcessCandidates(target);
            IMMDeviceEnumerator enumerator = null;
            IMMDevice dev = null;
            IAudioSessionManager2 mgr = null;
            IAudioSessionEnumerator sesEnum = null;
            bool matchedAny = false;
            int finalPct = 0;
            bool finalMute = false;
            int finalPeak = 0;
            string matchedProc = target;

            try
            {
                enumerator = (IMMDeviceEnumerator)new MMDeviceEnumeratorComObject();
                if (enumerator.GetDefaultAudioEndpoint(0, 1, out dev) != 0 || dev == null) return "ERR NO_DEVICE";
                var mgrIid = typeof(IAudioSessionManager2).GUID;
                object mgrObj;
                if (dev.Activate(ref mgrIid, 1, IntPtr.Zero, out mgrObj) != 0 || mgrObj == null) return "ERR NO_SESSION_MGR";
                mgr = (IAudioSessionManager2)mgrObj;
                if (mgr.GetSessionEnumerator(out sesEnum) != 0 || sesEnum == null) return "ERR NO_ENUM";
                int count = 0;
                sesEnum.GetCount(out count);
                for (int i = 0; i < count; i++)
                {
                    IAudioSessionControl ctrl = null;
                    try
                    {
                        if (sesEnum.GetSession(i, out ctrl) != 0 || ctrl == null) continue;
                        var ctrl2 = ctrl as IAudioSessionControl2;
                        var vol = ctrl as ISimpleAudioVolume;
                        if (ctrl2 == null || vol == null) continue;
                        uint pid = 0;
                        ctrl2.GetProcessId(out pid);
                        if (pid == 0) continue;
                        string procName = "";
                        try
                        {
                            using (Process p = Process.GetProcessById((int)pid))
                            {
                                procName = (p.ProcessName ?? "").ToLowerInvariant();
                            }
                        }
                        catch { continue; }
                        if (string.IsNullOrEmpty(procName)) continue;

                        bool isMatch = false;
                        foreach (var c in candidates)
                        {
                            if (procName.Equals(c, StringComparison.OrdinalIgnoreCase) || procName.Contains(c.ToLowerInvariant()))
                            {
                                isMatch = true;
                                break;
                            }
                        }
                        if (!isMatch) continue;

                        matchedAny = true;
                        matchedProc = procName;
                        float curLvl = 1f;
                        bool curMute = false;
                        vol.GetMasterVolume(out curLvl);
                        vol.GetMute(out curMute);
                        int curPct = (int)Math.Round(Math.Max(0f, Math.Min(1f, curLvl)) * 100f);
                        Guid empty = Guid.Empty;

                        if (op == "set")
                        {
                            int nextPct = Math.Max(0, Math.Min(100, value));
                            vol.SetMasterVolume(nextPct / 100f, ref empty);
                            if (curMute && nextPct > 0) { vol.SetMute(false, ref empty); curMute = false; }
                            finalPct = nextPct;
                            finalMute = curMute;
                        }
                        else if (op == "step")
                        {
                            int nextPct = Math.Max(0, Math.Min(100, curPct + value));
                            vol.SetMasterVolume(nextPct / 100f, ref empty);
                            if (curMute && value > 0) { vol.SetMute(false, ref empty); curMute = false; }
                            finalPct = nextPct;
                            finalMute = curMute;
                        }
                        else if (op == "mute")
                        {
                            bool nextMute = (value < 0) ? !curMute : (value != 0);
                            vol.SetMute(nextMute, ref empty);
                            finalPct = curPct;
                            finalMute = nextMute;
                        }
                        else
                        {
                            finalPct = curPct;
                            finalMute = curMute;
                        }

                        var meter = ctrl as IAudioMeterInformation;
                        if (meter != null)
                        {
                            float pk = 0f;
                            if (meter.GetPeakValue(out pk) == 0) finalPeak = Math.Max(finalPeak, (int)Math.Round(Math.Max(0f, Math.Min(1f, pk)) * 100f));
                        }
                    }
                    catch { }
                    finally
                    {
                        if (ctrl != null) try { Marshal.ReleaseComObject(ctrl); } catch { }
                    }
                }
            }
            catch (Exception ex)
            {
                return "ERR " + ex.Message;
            }
            finally
            {
                if (sesEnum != null) try { Marshal.ReleaseComObject(sesEnum); } catch { }
                if (mgr != null) try { Marshal.ReleaseComObject(mgr); } catch { }
                if (dev != null) try { Marshal.ReleaseComObject(dev); } catch { }
                if (enumerator != null) try { Marshal.ReleaseComObject(enumerator); } catch { }
            }

            if (!matchedAny) return "ERR SESSION_NOT_FOUND " + matchedProc;
            return string.Format("OK {0} {1} MUTE:{2} PEAK:{3}", matchedProc, finalPct, finalMute ? 1 : 0, finalPeak);
        }

        #endregion

        public static void GetCursor(out int x, out int y)
        {
            POINT p;
            GetCursorPos(out p);
            x = p.X;
            y = p.Y;
        }

        static void ExecuteCommand(string rawLine, bool allowAsync = false)
        {
            if (string.IsNullOrWhiteSpace(rawLine)) return;
            string line = rawLine.Trim();
            string reqPrefix = "";

            if (line.StartsWith("@"))
            {
                int spIdx = line.IndexOf(' ');
                if (spIdx > 1)
                {
                    reqPrefix = line.Substring(0, spIdx + 1);
                    line = line.Substring(spIdx + 1).Trim();
                }
            }

            string[] parts = line.Split(new char[] { ' ' }, StringSplitOptions.RemoveEmptyEntries);
            if (parts.Length == 0) return;

            string op = parts[0].ToLowerInvariant();
            try
            {
                switch (op)
                {
                    case "get_cursor":
                        int cx, cy;
                        GetCursor(out cx, out cy);
                        WriteOut(reqPrefix, "OK " + cx + "," + cy);
                        break;

                    case "get_pixel":
                        {
                            int px = parts.Length > 1 ? int.Parse(parts[1]) : 0;
                            int py = parts.Length > 2 ? int.Parse(parts[2]) : 0;
                            string hex = GetScreenPixelHex(px, py);
                            WriteOut(reqPrefix, !string.IsNullOrEmpty(hex) ? ("OK " + hex) : "ERR PIXEL_FAILED");
                        }
                        break;

                    case "find_color":
                        {
                            int rx = parts.Length > 1 ? int.Parse(parts[1]) : 0;
                            int ry = parts.Length > 2 ? int.Parse(parts[2]) : 0;
                            int rw = parts.Length > 3 ? int.Parse(parts[3]) : 100;
                            int rh = parts.Length > 4 ? int.Parse(parts[4]) : 100;
                            string hex = parts.Length > 5 ? parts[5] : "#FFFFFF";
                            int tol = parts.Length > 6 ? int.Parse(parts[6]) : 16;
                            WriteOut(reqPrefix, "OK " + FindColorInRegion(rx, ry, rw, rh, hex, tol));
                        }
                        break;

                    case "extract_icon":
                        {
                            int iconIdx = parts.Length > 1 ? int.Parse(parts[1]) : 0;
                            string iconFile = parts.Length > 2 ? string.Join(" ", parts, 2, parts.Length - 2) : "";
                            string dataUrl = ExtractIconDataUrl(iconFile, iconIdx);
                            WriteOut(reqPrefix, !string.IsNullOrEmpty(dataUrl) ? ("OK " + dataUrl) : "ERR NO_ICON");
                        }
                        break;

                    case "app_path":
                        {
                            string exeName = parts.Length > 1 ? string.Join(" ", parts, 1, parts.Length - 1) : "";
                            string foundPath = QueryAppPathRegistry(exeName);
                            WriteOut(reqPrefix, !string.IsNullOrEmpty(foundPath) ? ("OK " + foundPath) : "ERR NOT_FOUND");
                        }
                        break;

                    case "net_stats":
                        WriteOut(reqPrefix, "OK " + GetNetworkSpeedStats());
                        break;

                    case "proc_titles":
                        {
                            string csv = parts.Length > 1 ? string.Join("", parts, 1, parts.Length - 1) : "";
                            WriteOut(reqPrefix, "OK " + GetProcessWindowTitles(csv));
                        }
                        break;

                    case "beep":
                        {
                            string bType = parts.Length > 1 ? parts[1].ToLowerInvariant() : "ok";
                            try
                            {
                                if (bType == "err" || bType == "fail") System.Media.SystemSounds.Asterisk.Play();
                                else System.Media.SystemSounds.Beep.Play();
                            }
                            catch { }
                            WriteOut(reqPrefix, "OK");
                        }
                        break;

                    case "record_macro":
                        {
                            int maxDur = parts.Length > 1 ? int.Parse(parts[1]) : 15000;
                            if (allowAsync)
                            {
                                ThreadPool.QueueUserWorkItem(_ =>
                                {
                                    try
                                    {
                                        string seq = RecordMacroSequence(maxDur);
                                        WriteOut(reqPrefix, "OK " + seq);
                                    }
                                    catch (Exception ex)
                                    {
                                        WriteOut(reqPrefix, "ERR " + ex.Message);
                                    }
                                });
                            }
                            else
                            {
                                string seq = RecordMacroSequence(maxDur);
                                WriteOut(reqPrefix, "OK " + seq);
                            }
                        }
                        break;

                    case "stop_record":
                        _stopMacroRecord = true;
                        WriteOut(reqPrefix, "OK");
                        break;

                    case "mouse_click":
                        {
                            string btn = parts.Length > 1 ? parts[1] : "left";
                            int mx = parts.Length > 3 ? int.Parse(parts[2]) : -1;
                            int my = parts.Length > 3 ? int.Parse(parts[3]) : -1;
                            if (allowAsync)
                            {
                                ThreadPool.QueueUserWorkItem(_ =>
                                {
                                    try { MouseClick(btn, mx, my); WriteOut(reqPrefix, "OK"); }
                                    catch (Exception ex) { WriteOut(reqPrefix, "ERR " + ex.Message); }
                                });
                            }
                            else
                            {
                                MouseClick(btn, mx, my);
                                WriteOut(reqPrefix, "OK");
                            }
                        }
                        break;

                    case "mouse_move":
                        {
                            int posX = int.Parse(parts[1]);
                            int posY = int.Parse(parts[2]);
                            bool rel = parts.Length > 3 && parts[3].ToLowerInvariant() == "rel";
                            int moveDur = parts.Length > 4 ? int.Parse(parts[4]) : 0;
                            if (allowAsync && moveDur > 15)
                            {
                                ThreadPool.QueueUserWorkItem(_ =>
                                {
                                    try { MouseMove(posX, posY, rel, moveDur); WriteOut(reqPrefix, "OK"); }
                                    catch (Exception ex) { WriteOut(reqPrefix, "ERR " + ex.Message); }
                                });
                            }
                            else
                            {
                                MouseMove(posX, posY, rel, moveDur);
                                WriteOut(reqPrefix, "OK");
                            }
                        }
                        break;

                    case "mouse_drag":
                        {
                            int fx = int.Parse(parts[1]);
                            int fy = int.Parse(parts[2]);
                            int tx = int.Parse(parts[3]);
                            int ty = int.Parse(parts[4]);
                            int dragDur = parts.Length > 5 ? int.Parse(parts[5]) : 150;
                            if (allowAsync)
                            {
                                ThreadPool.QueueUserWorkItem(_ =>
                                {
                                    try { MouseDrag(fx, fy, tx, ty, dragDur); WriteOut(reqPrefix, "OK"); }
                                    catch (Exception ex) { WriteOut(reqPrefix, "ERR " + ex.Message); }
                                });
                            }
                            else
                            {
                                MouseDrag(fx, fy, tx, ty, dragDur);
                                WriteOut(reqPrefix, "OK");
                            }
                        }
                        break;

                    case "mouse_wheel":
                        int delta = int.Parse(parts[1]);
                        MouseWheel(delta);
                        WriteOut(reqPrefix, "OK");
                        break;

                    case "text":
                        int textStart = line.IndexOf(parts[0]) + parts[0].Length;
                        string textContent = (textStart < line.Length) ? line.Substring(textStart) : "";
                        if (textContent.StartsWith(" ")) textContent = textContent.Substring(1);
                        SendUnicodeText(textContent);
                        WriteOut(reqPrefix, "OK");
                        break;

                    case "hotkey":
                        int hkStart = line.IndexOf(parts[0]) + parts[0].Length;
                        string hkCombo = line.Substring(hkStart).Trim();
                        bool hkOk = SendHotkey(hkCombo);
                        WriteOut(reqPrefix, hkOk ? "OK" : "ERR INVALID_HOTKEY");
                        break;

                    case "fg_window":
                        WriteOut(reqPrefix, "OK " + GetForegroundProcessInfo());
                        break;

                    case "check_procs":
                        string queryCsv = parts.Length > 1 ? string.Join("", parts, 1, parts.Length - 1) : "";
                        WriteOut(reqPrefix, "OK " + CheckRunningProcesses(queryCsv));
                        break;

                    case "win_state":
                        string stTarget = parts.Length > 1 ? parts[1] : "";
                        WriteOut(reqPrefix, "OK " + QueryWindowState(stTarget));
                        break;

                    case "win_activate":
                        string actTarget = parts.Length > 1 ? parts[1] : "";
                        bool toggleMin = parts.Length > 2 && parts[2] == "1";
                        string actRes = ActivateOrToggleWindow(actTarget, toggleMin);
                        WriteOut(reqPrefix, "OK " + actRes);
                        break;

                    case "win_close":
                        string clsTarget = parts.Length > 1 ? string.Join(" ", parts, 1, parts.Length - 1) : "";
                        bool closed = GracefulCloseProcess(clsTarget);
                        WriteOut(reqPrefix, closed ? "OK CLOSED" : "ERR NOT_FOUND");
                        break;

                    case "window_rect":
                        int wx = int.Parse(parts[1]);
                        int wy = int.Parse(parts[2]);
                        int ww = int.Parse(parts[3]);
                        int wh = int.Parse(parts[4]);
                        string wtarget = parts.Length > 5 ? string.Join(" ", parts, 5, parts.Length - 5) : null;
                        SetWindowBounds(wx, wy, ww, wh, wtarget);
                        WriteOut(reqPrefix, "OK");
                        break;

                    case "media":
                        string mcmd = parts.Length > 1 ? parts[1] : "";
                        SendMedia(mcmd);
                        WriteOut(reqPrefix, "OK");
                        break;

                    case "vol_get":
                        int vLvl; bool vMute;
                        if (AudioGetVolume(out vLvl, out vMute))
                        {
                            WriteOut(reqPrefix, string.Format("OK {0} MUTE:{1}", vLvl, vMute ? 1 : 0));
                        }
                        else
                        {
                            WriteOut(reqPrefix, "ERR CANNOT_GET_VOLUME");
                        }
                        break;

                    case "vol_set":
                        int sLvl = parts.Length > 1 ? int.Parse(parts[1]) : 50;
                        if (AudioSetVolume(sLvl))
                        {
                            int curL; bool curM;
                            AudioGetVolume(out curL, out curM);
                            WriteOut(reqPrefix, string.Format("OK {0} MUTE:{1}", curL, curM ? 1 : 0));
                        }
                        else
                        {
                            WriteOut(reqPrefix, "ERR CANNOT_SET_VOLUME");
                        }
                        break;

                    case "vol_step":
                        int volDelta = parts.Length > 1 ? int.Parse(parts[1]) : 5;
                        bool triggerOsd = parts.Length <= 2 || parts[2] != "0";
                        int nLvl; bool nMute;
                        if (AudioStepVolume(volDelta, out nLvl, out nMute, triggerOsd))
                        {
                            WriteOut(reqPrefix, string.Format("OK {0} MUTE:{1}", nLvl, nMute ? 1 : 0));
                        }
                        else
                        {
                            WriteOut(reqPrefix, "ERR CANNOT_STEP_VOLUME");
                        }
                        break;

                    case "vol_mute_toggle":
                        bool muteOsd = parts.Length <= 1 || parts[1] != "0";
                        bool newMute; int curVol;
                        if (AudioToggleMute(out newMute, out curVol, muteOsd))
                        {
                            WriteOut(reqPrefix, string.Format("OK MUTE:{0} {1}", newMute ? 1 : 0, curVol));
                        }
                        else
                        {
                            WriteOut(reqPrefix, "ERR CANNOT_TOGGLE_MUTE");
                        }
                        break;

                    case "audio_devices":
                        var devs = AudioGetDevices();
                        var sb = new StringBuilder();
                        for (int i = 0; i < devs.Count; i++)
                        {
                            if (i > 0) sb.Append(";");
                            sb.Append(devs[i].Id.Replace("|", "_")).Append("|")
                              .Append(devs[i].Name.Replace("|", "_").Replace(";", ",")).Append("|")
                              .Append(devs[i].IsDefault ? "1" : "0");
                        }
                        WriteOut(reqPrefix, "OK " + sb.ToString());
                        break;

                    case "audio_switch":
                        string targetDev = parts.Length > 1 ? string.Join(" ", parts, 1, parts.Length - 1) : "";
                        string resDev = AudioSwitchDevice(targetDev);
                        if (!string.IsNullOrEmpty(resDev) && !resDev.StartsWith("ERR"))
                        {
                            WriteOut(reqPrefix, "OK " + resDev);
                        }
                        else
                        {
                            WriteOut(reqPrefix, resDev.StartsWith("ERR") ? resDev : "ERR SWITCH_FAILED");
                        }
                        break;

                    case "shutdown_block":
                        {
                            IntPtr hwnd = IntPtr.Zero;
                            int startIdx = 1;
                            if (parts.Length > 1)
                            {
                                long val;
                                if (long.TryParse(parts[1], out val) && val != 0)
                                {
                                    hwnd = new IntPtr(val);
                                    startIdx = 2;
                                }
                            }
                            string reason = parts.Length > startIdx ? string.Join(" ", parts, startIdx, parts.Length - startIdx) : "AKP153 控制台正在安全关闭并休眠屏幕...";
                            bool ok = BlockShutdown(hwnd, reason);
                            WriteOut(reqPrefix, ok ? "OK" : "ERR " + Marshal.GetLastWin32Error());
                        }
                        break;

                    case "shutdown_unblock":
                        {
                            IntPtr hwnd = IntPtr.Zero;
                            if (parts.Length > 1)
                            {
                                long val;
                                if (long.TryParse(parts[1], out val) && val != 0)
                                {
                                    hwnd = new IntPtr(val);
                                }
                            }
                            bool ok = UnblockShutdown(hwnd);
                            WriteOut(reqPrefix, ok ? "OK" : "ERR " + Marshal.GetLastWin32Error());
                        }
                        break;

                    case "set_device_path":
                        if (parts.Length > 1)
                        {
                            SetDevicePath(string.Join(" ", parts, 1, parts.Length - 1));
                            WriteOut(reqPrefix, "OK");
                        }
                        else
                        {
                            WriteOut(reqPrefix, "ERR MISSING_PATH");
                        }
                        break;

                    case "blackout_hardware":
                        {
                            bool ok = DirectHardwareBlackout();
                            WriteOut(reqPrefix, ok ? "OK" : "ERR NO_DEVICE");
                        }
                        break;

                    case "watch_procs":
                        {
                            string wCsv = parts.Length > 1 ? string.Join("", parts, 1, parts.Length - 1) : "";
                            lock (_watchLock)
                            {
                                _watchedProcs.Clear();
                                foreach (var item in wCsv.Split(new char[] { ',' }, StringSplitOptions.RemoveEmptyEntries))
                                {
                                    string clean = item.Trim();
                                    if (!string.IsNullOrEmpty(clean) && !_watchedProcs.Contains(clean))
                                    {
                                        _watchedProcs.Add(clean);
                                    }
                                }
                            }
                            WriteOut(reqPrefix, "OK");
                        }
                        break;

                    case "host_blackout_ack":
                        _hostBlackoutAcked = true;
                        _deviceKnownAsleep = true;
                        WriteOut(reqPrefix, "OK");
                        break;

                    case "set_sleep_state":
                        _deviceKnownAsleep = (parts.Length > 1 && parts[1] == "1");
                        WriteOut(reqPrefix, "OK");
                        break;

                    case "audio_peak":
                        WriteOut(reqPrefix, "OK " + AudioGetMasterAndMicPeak());
                        break;

                    case "app_audio_list":
                        WriteOut(reqPrefix, "OK " + AppAudioListSessions());
                        break;

                    case "app_audio_get":
                        {
                            string appTarget = parts.Length > 1 ? parts[1] : "@foreground";
                            WriteOut(reqPrefix, AppAudioControl(appTarget, "get", 0));
                        }
                        break;

                    case "app_audio_set":
                        {
                            string appTarget = parts.Length > 1 ? parts[1] : "@foreground";
                            int appLvl = parts.Length > 2 ? int.Parse(parts[2]) : 50;
                            WriteOut(reqPrefix, AppAudioControl(appTarget, "set", appLvl));
                        }
                        break;

                    case "app_audio_step":
                        {
                            string appTarget = parts.Length > 1 ? parts[1] : "@foreground";
                            int appDelta = parts.Length > 2 ? int.Parse(parts[2]) : 5;
                            WriteOut(reqPrefix, AppAudioControl(appTarget, "step", appDelta));
                        }
                        break;

                    case "app_audio_mute":
                        {
                            string appTarget = parts.Length > 1 ? parts[1] : "@foreground";
                            int muteMode = -1;
                            if (parts.Length > 2)
                            {
                                if (parts[2] == "1" || parts[2].Equals("true", StringComparison.OrdinalIgnoreCase)) muteMode = 1;
                                else if (parts[2] == "0" || parts[2].Equals("false", StringComparison.OrdinalIgnoreCase)) muteMode = 0;
                            }
                            WriteOut(reqPrefix, AppAudioControl(appTarget, "mute", muteMode));
                        }
                        break;

                    case "ping":
                        WriteOut(reqPrefix, "PONG");
                        break;

                    default:
                        WriteOut(reqPrefix, "ERR Unknown op: " + op);
                        break;
                }
            }
            catch (Exception ex)
            {
                WriteOut(reqPrefix, "ERR " + ex.Message.Replace("\r", " ").Replace("\n", " "));
            }
        }

        public static void Main(string[] args)
        {
            Console.OutputEncoding = Encoding.UTF8;
            Console.InputEncoding = Encoding.UTF8;

            if (args.Length > 0)
            {
                if (args[0] == "--daemon")
                {
                    StartShutdownGuard();
                    try
                    {
                        string l;
                        while ((l = Console.ReadLine()) != null)
                        {
                            if (l == "exit" || l == "quit") break;
                            ExecuteCommand(l, true);
                        }
                    }
                    finally
                    {
                        StopShutdownGuard();
                    }
                    return;
                }

                ExecuteCommand(args.Length == 1 ? args[0] : string.Join(" ", args), false);
                return;
            }

            StartShutdownGuard();
            try
            {
                string line;
                while ((line = Console.ReadLine()) != null)
                {
                    ExecuteCommand(line, true);
                }
            }
            finally
            {
                StopShutdownGuard();
            }
        }
    }
}
