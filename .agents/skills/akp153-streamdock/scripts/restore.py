import subprocess
import time
import shutil
import os

print('[*] Stopping all StreamDock processes...')
subprocess.run(['powershell', '-Command', 'Stop-Process -Name "Stream Dock AJAZZ", "streamdockSwitchAudio", "streamdeck-batplug" -Force -ErrorAction SilentlyContinue'])
time.sleep(2.5)

profile_dir = r'C:\Users\Administrator\AppData\Roaming\HotSpot\StreamDock\profiles\OJWX7LY0-7FU2-P411-KV38-WRX8R97URMI8.sdProfile'
backup_dir = r'C:\Users\Administrator\AppData\Roaming\HotSpot\StreamDock\profiles\OJWX7LY0-7FU2-P411-KV38-WRX8R97URMI8.sdProfile.backup_20260918_234754'

if os.path.exists(backup_dir):
    if os.path.exists(profile_dir):
        shutil.rmtree(profile_dir)
    shutil.copytree(backup_dir, profile_dir)
    print('[+] Original profile restored successfully.')
else:
    print('[!] Backup directory not found!')

# Relaunch
exe_path = r'C:\Program Files (x86)\Stream Dock AJAZZ Global\Stream Dock AJAZZ.exe'
cmd = f'Start-Process -FilePath "{exe_path}" -WorkingDirectory "{os.path.dirname(exe_path)}"'
subprocess.run(['powershell', '-Command', cmd])
print('[+] Launched Stream Dock AJAZZ.')
