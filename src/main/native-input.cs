using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Windows.Forms;
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

        [DllImport("ole32.dll")]
        static extern int PropVariantClear(ref PROPVARIANT pvar);

        private static IntPtr _guardHwnd = IntPtr.Zero;
        private static readonly object _outLock = new object();

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
            }

            protected override void WndProc(ref Message m)
            {
                if (m.Msg == WM_QUERYENDSESSION)
                {
                    // 操作系统正在关机，在独立 STA 消息循环内同步执行硬件灭屏直写
                    try
                    {
                        DirectHardwareBlackout();
                    }
                    catch { }
                    try
                    {
                        ShutdownBlockReasonDestroy(this.Handle);
                    }
                    catch { }
                    m.Result = new IntPtr(1);
                    return;
                }
                if (m.Msg == WM_ENDSESSION)
                {
                    if (m.WParam != IntPtr.Zero)
                    {
                        try
                        {
                            DirectHardwareBlackout();
                        }
                        catch { }
                        Application.Exit();
                    }
                    m.Result = IntPtr.Zero;
                    return;
                }
                base.WndProc(ref m);
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
                    _guardForm = new ShutdownGuardForm();
                    Application.Run(_guardForm);
                }
                catch { }
            });
            _guardThread.SetApartmentState(ApartmentState.STA);
            _guardThread.IsBackground = true;
            _guardThread.Name = "AkpShutdownGuard";
            _guardThread.Start();
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
                var candidatePaths = new List<string>();
                if (!string.IsNullOrEmpty(_cachedDevicePath))
                {
                    candidatePaths.Add(_cachedDevicePath);
                }

                var scanned = EnumerateAkpDevices();
                foreach (var p in scanned)
                {
                    if (!candidatePaths.Contains(p)) candidatePaths.Add(p);
                }

                if (candidatePaths.Count == 0) return false;

                uint GENERIC_WRITE = 0x40000000;
                uint GENERIC_READ = 0x80000000;
                uint FILE_SHARE_READ = 0x00000001;
                uint FILE_SHARE_WRITE = 0x00000002;
                uint OPEN_EXISTING = 3;

                byte[][] blackoutSeq = new byte[][]
                {
                    new byte[] { 67, 76, 69, 0, 0, 0, 255 },     // CLEAR_ALL (清空显存)
                    new byte[] { 76, 66, 76, 73, 71, 0 },          // LBLIG 0 (LED灯带调零)
                    new byte[] { 76, 73, 71, 0, 0, 0 },            // LIG 0 (屏幕背光调零)
                    new byte[] { 72, 65, 78 },                     // HAN (准备休眠)
                    new byte[] { 115, 108, 101, 101, 112 },        // sleep (芯片休眠)
                    new byte[] { 67, 76, 69, 0, 0, 68, 67 }        // DEVICE_CLOSE (断开连接)
                };

                bool anySuccess = false;
                foreach (var path in candidatePaths)
                {
                    try
                    {
                        using (var handle = CreateFile(path, GENERIC_READ | GENERIC_WRITE, FILE_SHARE_READ | FILE_SHARE_WRITE, IntPtr.Zero, OPEN_EXISTING, 0, IntPtr.Zero))
                        {
                            if (handle.IsInvalid) continue;

                            foreach (var cmd in blackoutSeq)
                            {
                                byte[] pkt = MakeHidPacket(cmd);
                                uint written;
                                WriteFile(handle, pkt, 513, out written, IntPtr.Zero);
                                Thread.Sleep(4);
                            }
                            anySuccess = true;
                        }
                    }
                    catch { }
                }
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
            return new INPUT
            {
                type = INPUT_KEYBOARD,
                u = new InputUnion
                {
                    ki = new KEYBDINPUT
                    {
                        wVk = vk,
                        wScan = 0,
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
                case ".": case "period": case "dot": return 0xBE;
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
            string[] parts = combo.Split(new char[] { '+' }, StringSplitOptions.RemoveEmptyEntries);
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

            var all = new List<INPUT>(downList.Count + upList.Count);
            all.AddRange(downList);
            all.AddRange(upList);
            var arr = all.ToArray();
            uint sent = SendInput((uint)arr.Length, arr, Marshal.SizeOf(typeof(INPUT)));
            return sent > 0;
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
            string title = "";
            try
            {
                using (Process p = Process.GetProcessById((int)pid))
                {
                    procName = p.ProcessName ?? "";
                }
            }
            catch { }
            try
            {
                var sb = new StringBuilder(256);
                if (GetWindowText(hwnd, sb, sb.Capacity) > 0)
                {
                    title = sb.ToString();
                }
            }
            catch { }
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

        public static string ActivateOrToggleWindow(string procName, bool allowMinimize)
        {
            if (string.IsNullOrWhiteSpace(procName)) return "ERR EMPTY";
            string target = procName.Trim();
            if (target.EndsWith(".exe", StringComparison.OrdinalIgnoreCase))
            {
                target = target.Substring(0, target.Length - 4);
            }

            IntPtr hwnd = IntPtr.Zero;
            Process[] procs = Process.GetProcessesByName(target);
            try
            {
                foreach (var p in procs)
                {
                    try
                    {
                        if (hwnd == IntPtr.Zero && p.MainWindowHandle != IntPtr.Zero)
                        {
                            hwnd = p.MainWindowHandle;
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

            if (hwnd == IntPtr.Zero) return "NOWINDOW";

            IntPtr fg = GetForegroundWindow();
            if (allowMinimize && fg == hwnd && !IsIconic(hwnd))
            {
                ShowWindowAsync(hwnd, 6); // SW_MINIMIZE
                return "MINIMIZED";
            }

            if (IsIconic(hwnd))
            {
                ShowWindowAsync(hwnd, 9); // SW_RESTORE
            }

            uint fgPid;
            uint fgThread = GetWindowThreadProcessId(fg, out fgPid);
            uint curThread = GetCurrentThreadId();
            bool attached = false;
            if (fgThread != 0 && fgThread != curThread)
            {
                attached = AttachThreadInput(curThread, fgThread, true);
            }
            try
            {
                SetForegroundWindow(hwnd);
            }
            finally
            {
                if (attached) AttachThreadInput(curThread, fgThread, false);
            }
            return "FOCUSED";
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

        #region CoreAudio & Audio Control

        [ComImport]
        [Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
        class MMDeviceEnumeratorComObject { }

        [Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        interface IMMDeviceEnumerator
        {
            int EnumAudioEndpoints(int dataFlow, int dwStateMask, out IMMDeviceCollection ppDevices);
            int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice ppEndpoint);
            int GetDevice(string pwstrId, out IMMDevice ppDevice);
            int RegisterEndpointNotificationCallback(IntPtr pClient);
            int UnregisterEndpointNotificationCallback(IntPtr pClient);
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

        [Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        interface IAudioEndpointVolume
        {
            int RegisterControlChangeNotify(IntPtr pNotify);
            int UnregisterControlChangeNotify(IntPtr pNotify);
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

        static IAudioEndpointVolume GetMasterVolumeEndpoint()
        {
            var enumerator = (IMMDeviceEnumerator)new MMDeviceEnumeratorComObject();
            IMMDevice dev;
            if (enumerator.GetDefaultAudioEndpoint(0, 1, out dev) != 0 || dev == null) return null;
            var iid = typeof(IAudioEndpointVolume).GUID;
            object epvObj;
            if (dev.Activate(ref iid, 1, IntPtr.Zero, out epvObj) != 0 || epvObj == null) return null;
            return (IAudioEndpointVolume)epvObj;
        }

        public static bool AudioGetVolume(out int level, out bool isMute)
        {
            level = 0;
            isMute = false;
            try
            {
                var epv = GetMasterVolumeEndpoint();
                if (epv == null) return false;
                float f;
                epv.GetMasterVolumeLevelScalar(out f);
                level = (int)Math.Round(f * 100);
                epv.GetMute(out isMute);
                return true;
            }
            catch { return false; }
        }

        public static bool AudioSetVolume(int level)
        {
            try
            {
                var epv = GetMasterVolumeEndpoint();
                if (epv == null) return false;
                float f = Math.Max(0f, Math.Min(1f, (float)level / 100f));
                Guid empty = Guid.Empty;
                epv.SetMasterVolumeLevelScalar(f, ref empty);
                return true;
            }
            catch { return false; }
        }

        public static bool AudioStepVolume(int delta, out int newLevel, out bool isMute, bool triggerOsd = true)
        {
            newLevel = 0;
            isMute = false;
            int curLevel;
            bool wasMute;
            if (!AudioGetVolume(out curLevel, out wasMute)) return false;

            newLevel = Math.Max(0, Math.Min(100, curLevel + delta));
            isMute = wasMute;

            if (wasMute && delta > 0)
            {
                try
                {
                    var epv = GetMasterVolumeEndpoint();
                    if (epv != null)
                    {
                        Guid empty = Guid.Empty;
                        epv.SetMute(false, ref empty);
                        isMute = false;
                    }
                }
                catch { }
            }

            // 先直接通过 WASAPI 设定精准目标音量
            AudioSetVolume(newLevel);

            if (triggerOsd && !isMute)
            {
                int targetLvl = newLevel;
                SendMedia(delta >= 0 ? "vol_up" : "vol_down");
                AudioSetVolume(targetLvl);
                // Windows Shell (explorer.exe) 异步处理 VK_VOLUME_UP/DOWN 会附加 ±2% 偏移，
                // 在后台线程延迟 28ms 二次校准，既唤出原生 OSD 弹窗又确保音量精确无回弹跳变
                ThreadPool.QueueUserWorkItem(_ =>
                {
                    try
                    {
                        Thread.Sleep(28);
                        AudioSetVolume(targetLvl);
                    }
                    catch { }
                });
            }
            return true;
        }

        public static bool AudioToggleMute(out bool newMute, out int curLevel, bool triggerOsd = true)
        {
            newMute = false;
            curLevel = 0;
            try
            {
                var epv = GetMasterVolumeEndpoint();
                if (epv == null) return false;
                bool cur;
                epv.GetMute(out cur);
                Guid empty = Guid.Empty;
                epv.SetMute(!cur, ref empty);
                newMute = !cur;
                float f;
                epv.GetMasterVolumeLevelScalar(out f);
                curLevel = (int)Math.Round(f * 100);
                return true;
            }
            catch { return false; }
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

            // 支持可选的 @<id> 异步请求流水号前缀，彻底消除耗时鼠标动画对后续查询指令的队头阻塞
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
