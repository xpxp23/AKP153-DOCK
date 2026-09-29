const { app, shell } = require('electron');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

function extractIconFromResource(filePath, iconIndex = 0) {
  const os = require('os');
  const tmp = path.join(os.tmpdir(), `akp153-res-icon-${Date.now()}-${Math.random().toString(36).slice(2)}.png`);
  
  const psScript = `
Add-Type -TypeDefinition @"
using System;
using System.Drawing;
using System.Runtime.InteropServices;

public class IconExtractor {
    [DllImport("shell32.dll", CharSet = CharSet.Auto)]
    public static extern int ExtractIconEx(string szFileName, int nIconIndex, IntPtr[] phiconLarge, IntPtr[] phiconSmall, int nIcons);

    [DllImport("user32.dll", SetLastError = true)]
    public static extern bool DestroyIcon(IntPtr hIcon);

    public static Bitmap Extract(string file, int index) {
        IntPtr[] large = new IntPtr[1];
        int count = ExtractIconEx(file, index, large, null, 1);
        if (count > 0 && large[0] != IntPtr.Zero) {
            Icon ico = Icon.FromHandle(large[0]);
            Bitmap bmp = ico.ToBitmap();
            DestroyIcon(large[0]);
            return bmp;
        }
        return null;
    }
}
"@ -ReferencedAssemblies System.Drawing

$file = ${JSON.stringify(filePath)}
$idx = ${parseInt(iconIndex, 10) || 0}
$out = ${JSON.stringify(tmp)}

$bmp = [IconExtractor]::Extract($file, $idx)
if ($bmp -ne $null) {
    $bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
    Write-Output "OK"
} else {
    Write-Output "FAIL"
}
`;

  const b64 = Buffer.from(psScript, 'utf16le').toString('base64');
  const r = spawnSync('powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', b64],
    { windowsHide: true, timeout: 8000, encoding: 'utf8' });

  try {
    if (fs.existsSync(tmp)) {
      const buf = fs.readFileSync(tmp);
      fs.unlinkSync(tmp);
      if (buf.length > 0) {
        return 'data:image/png;base64,' + buf.toString('base64');
      }
    }
  } catch (e) {}
  return null;
}

app.whenReady().then(async () => {
  console.log('Testing extraction from shell32.dll, index 21:');
  const icon = extractIconFromResource('C:\\Windows\\System32\\shell32.dll', 21);
  console.log('Result length:', icon ? icon.length : 'NULL');
  if (icon) {
    console.log('Starts with data:image/png;base64,?', icon.startsWith('data:image/png;base64,'));
  }
  process.exit(0);
});
