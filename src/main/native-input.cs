using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

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

        [DllImport("user32.dll", SetLastError = true)]
        static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);

        [DllImport("user32.dll")]
        static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

        [DllImport("user32.dll", CharSet = CharSet.Auto)]
        static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);

        const uint SWP_NOZORDER = 0x0004;
        const uint SWP_NOACTIVATE = 0x0010;
        const uint SWP_SHOWWINDOW = 0x0040;

        public static void MouseMove(int x, int y, bool relative)
        {
            if (relative)
            {
                POINT p;
                GetCursorPos(out p);
                SetCursorPos(p.X + x, p.Y + y);
            }
            else
            {
                SetCursorPos(x, y);
            }
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
                Thread.Sleep(80);
                mouse_event(MOUSEEVENTF_LEFTDOWN, 0, 0, 0, UIntPtr.Zero);
                Thread.Sleep(20);
                mouse_event(MOUSEEVENTF_LEFTUP, 0, 0, 0, UIntPtr.Zero);
            }
            else
            {
                // default left click
                mouse_event(MOUSEEVENTF_LEFTDOWN, 0, 0, 0, UIntPtr.Zero);
                Thread.Sleep(20);
                mouse_event(MOUSEEVENTF_LEFTUP, 0, 0, 0, UIntPtr.Zero);
            }
        }

        public static void MouseDrag(int fromX, int fromY, int toX, int toY)
        {
            SetCursorPos(fromX, fromY);
            Thread.Sleep(30);
            mouse_event(MOUSEEVENTF_LEFTDOWN, 0, 0, 0, UIntPtr.Zero);
            Thread.Sleep(30);

            // 平滑插值移动
            int steps = 15;
            for (int i = 1; i <= steps; i++)
            {
                int curX = fromX + (toX - fromX) * i / steps;
                int curY = fromY + (toY - fromY) * i / steps;
                SetCursorPos(curX, curY);
                Thread.Sleep(10);
            }

            SetCursorPos(toX, toY);
            Thread.Sleep(30);
            mouse_event(MOUSEEVENTF_LEFTUP, 0, 0, 0, UIntPtr.Zero);
        }

        public static void MouseWheel(int delta)
        {
            mouse_event(MOUSEEVENTF_WHEEL, 0, 0, (uint)delta, UIntPtr.Zero);
        }

        public static void SendUnicodeText(string text)
        {
            if (string.IsNullOrEmpty(text)) return;
            var inputs = new INPUT[text.Length * 2];
            for (int i = 0; i < text.Length; i++)
            {
                char ch = text[i];
                // Key down
                inputs[i * 2] = new INPUT
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
                };
                // Key up
                inputs[i * 2 + 1] = new INPUT
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
                };
            }
            SendInput((uint)inputs.Length, inputs, Marshal.SizeOf(typeof(INPUT)));
        }

        public static void SetWindowBounds(int x, int y, int width, int height, string target)
        {
            IntPtr hwnd = IntPtr.Zero;
            if (!string.IsNullOrEmpty(target))
            {
                string t = target.Trim().ToLowerInvariant();
                foreach (var p in Process.GetProcesses())
                {
                    try
                    {
                        if (p.MainWindowHandle != IntPtr.Zero)
                        {
                            string pName = p.ProcessName.ToLowerInvariant();
                            string wTitle = p.MainWindowTitle.ToLowerInvariant();
                            if (pName.Contains(t) || wTitle.Contains(t))
                            {
                                hwnd = p.MainWindowHandle;
                                break;
                            }
                        }
                    }
                    catch { }
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

        public static void SendMedia(string cmd)
        {
            byte vk = 0;
            string c = (cmd ?? "").ToLowerInvariant();
            if (c == "vol_up") vk = 0xAF; // VK_VOLUME_UP
            else if (c == "vol_down") vk = 0xAE; // VK_VOLUME_DOWN
            else if (c == "mute") vk = 0xAD; // VK_VOLUME_MUTE
            else if (c == "play_pause") vk = 0xB3; // VK_MEDIA_PLAY_PAUSE
            else if (c == "next") vk = 0xB0; // VK_MEDIA_NEXT_TRACK
            else if (c == "prev") vk = 0xB1; // VK_MEDIA_PREV_TRACK

            if (vk != 0)
            {
                var inputs = new INPUT[2];
                inputs[0] = new INPUT { type = INPUT_KEYBOARD, u = new InputUnion { ki = new KEYBDINPUT { wVk = vk } } };
                inputs[1] = new INPUT { type = INPUT_KEYBOARD, u = new InputUnion { ki = new KEYBDINPUT { wVk = vk, dwFlags = KEYEVENTF_KEYUP } } };
                SendInput(2, inputs, Marshal.SizeOf(typeof(INPUT)));
            }
        }

        public static void GetCursor(out int x, out int y)
        {
            POINT p;
            GetCursorPos(out p);
            x = p.X;
            y = p.Y;
        }

        static void ExecuteCommand(string line)
        {
            if (string.IsNullOrWhiteSpace(line)) return;
            string[] parts = line.Trim().Split(new char[] { ' ' }, StringSplitOptions.RemoveEmptyEntries);
            if (parts.Length == 0) return;

            string op = parts[0].ToLowerInvariant();
            try
            {
                switch (op)
                {
                    case "get_cursor":
                        int cx, cy;
                        GetCursor(out cx, out cy);
                        Console.WriteLine("OK " + cx + "," + cy);
                        break;

                    case "mouse_click":
                        string btn = parts.Length > 1 ? parts[1] : "left";
                        int mx = parts.Length > 3 ? int.Parse(parts[2]) : -1;
                        int my = parts.Length > 3 ? int.Parse(parts[3]) : -1;
                        MouseClick(btn, mx, my);
                        Console.WriteLine("OK");
                        break;

                    case "mouse_move":
                        int posX = int.Parse(parts[1]);
                        int posY = int.Parse(parts[2]);
                        bool rel = parts.Length > 3 && parts[3].ToLowerInvariant() == "rel";
                        MouseMove(posX, posY, rel);
                        Console.WriteLine("OK");
                        break;

                    case "mouse_drag":
                        int fx = int.Parse(parts[1]);
                        int fy = int.Parse(parts[2]);
                        int tx = int.Parse(parts[3]);
                        int ty = int.Parse(parts[4]);
                        MouseDrag(fx, fy, tx, ty);
                        Console.WriteLine("OK");
                        break;

                    case "mouse_wheel":
                        int delta = int.Parse(parts[1]);
                        MouseWheel(delta);
                        Console.WriteLine("OK");
                        break;

                    case "text":
                        // text is the remainder of the line
                        int textStart = line.IndexOf(parts[0]) + parts[0].Length;
                        string textContent = line.Substring(textStart).Trim();
                        SendUnicodeText(textContent);
                        Console.WriteLine("OK");
                        break;

                    case "window_rect":
                        int wx = int.Parse(parts[1]);
                        int wy = int.Parse(parts[2]);
                        int ww = int.Parse(parts[3]);
                        int wh = int.Parse(parts[4]);
                        string wtarget = parts.Length > 5 ? parts[5] : null;
                        SetWindowBounds(wx, wy, ww, wh, wtarget);
                        Console.WriteLine("OK");
                        break;

                    case "media":
                        string mcmd = parts.Length > 1 ? parts[1] : "";
                        SendMedia(mcmd);
                        Console.WriteLine("OK");
                        break;

                    case "ping":
                        Console.WriteLine("PONG");
                        break;

                    default:
                        Console.WriteLine("ERR Unknown op: " + op);
                        break;
                }
            }
            catch (Exception ex)
            {
                Console.WriteLine("ERR " + ex.Message);
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
                    string l;
                    while ((l = Console.ReadLine()) != null)
                    {
                        if (l == "exit" || l == "quit") break;
                        ExecuteCommand(l);
                    }
                    return;
                }

                // One-shot mode
                ExecuteCommand(string.Join(" ", args));
                return;
            }

            // Default: Read lines until EOF
            string line;
            while ((line = Console.ReadLine()) != null)
            {
                ExecuteCommand(line);
            }
        }
    }
}
