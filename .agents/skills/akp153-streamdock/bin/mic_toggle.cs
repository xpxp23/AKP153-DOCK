using System;
using System.Runtime.InteropServices;

[Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IAudioEndpointVolume {
    int f1(); int f2(); int f3(); int f4(); int f5(); int f6(); int f7(); int f8(); int f9(); int f10(); int f11();
    int SetMute([MarshalAs(UnmanagedType.Bool)] bool bMute, [MarshalAs(UnmanagedType.LPStruct)] Guid pguidEventContext);
    int GetMute([MarshalAs(UnmanagedType.Bool)] out bool pbMute);
}

[Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IMMDevice {
    int Activate([MarshalAs(UnmanagedType.LPStruct)] Guid id, int clsCtx, IntPtr pActivationParams, [MarshalAs(UnmanagedType.IUnknown)] out object ppInterface);
}

[Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IMMDeviceEnumerator {
    int EnumAudioEndpoints(int dataFlow, int stateMask, out IntPtr ppDevices);
    int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice ppDevice);
}

[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
public class MMDeviceEnumeratorComObject {}

public class Program {
    public static int Main(string[] args) {
        try {
            var enumerator = (IMMDeviceEnumerator)(new MMDeviceEnumeratorComObject());
            IMMDevice dev;
            // dataFlow: 1 = eCapture (Mic), role: 1 = eMultimedia
            int hr = enumerator.GetDefaultAudioEndpoint(1, 1, out dev);
            if (hr != 0 || dev == null) return 1;
            Guid iid = new Guid("5CDF2C82-841E-4546-9722-0CF74078229A");
            object epvObj;
            dev.Activate(iid, 23, IntPtr.Zero, out epvObj);
            var epv = (IAudioEndpointVolume)epvObj;
            bool isMuted;
            epv.GetMute(out isMuted);
            bool newMute = !isMuted;
            epv.SetMute(newMute, Guid.Empty);
            return newMute ? 2 : 0;
        } catch {
            return 1;
        }
    }
}
