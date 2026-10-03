using System;
using System.Collections.Generic;
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
            if (!AudioGetVolume(out newLevel, out isMute)) return false;
            newLevel = Math.Max(0, Math.Min(100, newLevel + delta));
            AudioSetVolume(newLevel);
            if (isMute && delta > 0)
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
            if (triggerOsd)
            {
                SendMedia(delta >= 0 ? "vol_up" : "vol_down");
                AudioSetVolume(newLevel);
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
            try
            {
                var enumerator = (IMMDeviceEnumerator)new MMDeviceEnumeratorComObject();
                IMMDevice defDev;
                string defId = "";
                if (enumerator.GetDefaultAudioEndpoint(0, 0, out defDev) == 0 && defDev != null)
                {
                    defDev.GetId(out defId);
                }

                IMMDeviceCollection col;
                enumerator.EnumAudioEndpoints(0, 1, out col);
                uint count;
                col.GetCount(out count);
                for (uint i = 0; i < count; i++)
                {
                    IMMDevice d;
                    col.Item(i, out d);
                    string id;
                    d.GetId(out id);
                    IPropertyStore store;
                    d.OpenPropertyStore(0, out store);
                    PROPVARIANT pv;
                    store.GetValue(ref PKEY_Device_FriendlyName, out pv);
                    string name = Marshal.PtrToStringUni(pv.pwszVal) ?? "Audio Device";
                    list.Add(new AudioDeviceInfo { Id = id, Name = name, IsDefault = (id == defId) });
                }
            }
            catch { }
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
            try
            {
                var policy = (IPolicyConfig)new PolicyConfigComObject();
                policy.SetDefaultEndpoint(chosen.Id, 0); // eConsole
                policy.SetDefaultEndpoint(chosen.Id, 1); // eMultimedia
                policy.SetDefaultEndpoint(chosen.Id, 2); // eCommunications
                return chosen.Name;
            }
            catch (Exception ex)
            {
                return "ERR " + ex.Message;
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

                    case "vol_get":
                        int vLvl; bool vMute;
                        if (AudioGetVolume(out vLvl, out vMute))
                        {
                            Console.WriteLine(string.Format("OK {0} MUTE:{1}", vLvl, vMute ? 1 : 0));
                        }
                        else
                        {
                            Console.WriteLine("ERR CANNOT_GET_VOLUME");
                        }
                        break;

                    case "vol_set":
                        int sLvl = parts.Length > 1 ? int.Parse(parts[1]) : 50;
                        if (AudioSetVolume(sLvl))
                        {
                            int curL; bool curM;
                            AudioGetVolume(out curL, out curM);
                            Console.WriteLine(string.Format("OK {0} MUTE:{1}", curL, curM ? 1 : 0));
                        }
                        else
                        {
                            Console.WriteLine("ERR CANNOT_SET_VOLUME");
                        }
                        break;

                    case "vol_step":
                        int volDelta = parts.Length > 1 ? int.Parse(parts[1]) : 5;
                        bool triggerOsd = parts.Length <= 2 || parts[2] != "0";
                        int nLvl; bool nMute;
                        if (AudioStepVolume(volDelta, out nLvl, out nMute, triggerOsd))
                        {
                            Console.WriteLine(string.Format("OK {0} MUTE:{1}", nLvl, nMute ? 1 : 0));
                        }
                        else
                        {
                            Console.WriteLine("ERR CANNOT_STEP_VOLUME");
                        }
                        break;

                    case "vol_mute_toggle":
                        bool muteOsd = parts.Length <= 1 || parts[1] != "0";
                        bool newMute; int curVol;
                        if (AudioToggleMute(out newMute, out curVol, muteOsd))
                        {
                            Console.WriteLine(string.Format("OK MUTE:{0} {1}", newMute ? 1 : 0, curVol));
                        }
                        else
                        {
                            Console.WriteLine("ERR CANNOT_TOGGLE_MUTE");
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
                        Console.WriteLine("OK " + sb.ToString());
                        break;

                    case "audio_switch":
                        string targetDev = parts.Length > 1 ? string.Join(" ", parts, 1, parts.Length - 1) : "";
                        string resDev = AudioSwitchDevice(targetDev);
                        if (!string.IsNullOrEmpty(resDev) && !resDev.StartsWith("ERR"))
                        {
                            Console.WriteLine("OK " + resDev);
                        }
                        else
                        {
                            Console.WriteLine(resDev.StartsWith("ERR") ? resDev : "ERR SWITCH_FAILED");
                        }
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
