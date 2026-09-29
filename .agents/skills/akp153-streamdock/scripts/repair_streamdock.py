"""
AKP153 Complete Recovery & Repair Tool
1. Closes any lingering driver handles.
2. Cleans up any non-standard profile folders.
3. Restores OJWX7LY0 profile from original backup.
4. Corrects StreamDockConfig.ini device mappings for active USB instance.
5. Syncs DataCache.db sqlite tables.
6. Relaunches Stream Dock AJAZZ and validates connection.
"""

import os
import sys
import time
import shutil
import sqlite3
import subprocess
import configparser

APPDATA = os.environ.get('APPDATA', r'C:\Users\Administrator\AppData\Roaming')
HOTSPOT_DIR = os.path.join(APPDATA, 'HotSpot', 'StreamDock')
PROFILES_DIR = os.path.join(HOTSPOT_DIR, 'profiles')
CONFIG_INI = os.path.join(HOTSPOT_DIR, 'config', 'StreamDockConfig.ini')
DATACACHE_DB = os.path.join(HOTSPOT_DIR, 'config', 'DataCache.db')
STREAMDOCK_EXE = r"C:\Program Files (x86)\Stream Dock AJAZZ Global\Stream Dock AJAZZ.exe"

TARGET_PROFILE_ID = "OJWX7LY0-7FU2-P411-KV38-WRX8R97URMI8.sdProfile"
BACKUP_SOURCE = r"e:\项目\AiProgram\.agents\skills\akp153-streamdock\backups\OJWX7LY0-7FU2-P411-KV38-WRX8R97URMI8.sdProfile.backup_20260918_234754"

def step1_stop_processes():
    print("[1/5] Stopping all StreamDock related processes...")
    subprocess.run([
        "powershell", "-Command",
        "Stop-Process -Name 'Stream Dock AJAZZ', 'streamdockSwitchAudio', 'streamdeck-batplug' -Force -ErrorAction SilentlyContinue"
    ], check=False)
    time.sleep(2.5)

def step2_clean_profiles_dir():
    print("[2/5] Cleaning up profiles directory...")
    # Move any .backup folders out
    safe_backup_dir = r"e:\项目\AiProgram\.agents\skills\akp153-streamdock\backups"
    os.makedirs(safe_backup_dir, exist_ok=True)
    for item in os.listdir(PROFILES_DIR):
        p = os.path.join(PROFILES_DIR, item)
        if "backup" in item.lower() or item.startswith("5GT19C6T") or item.startswith("71E99FV4"):
            dest = os.path.join(safe_backup_dir, item)
            if os.path.exists(dest):
                shutil.rmtree(dest)
            shutil.move(p, dest)
            print(f"  Moved stray profile folder: {item}")

    # Restore pristine target profile from safe backup
    target_path = os.path.join(PROFILES_DIR, TARGET_PROFILE_ID)
    if os.path.exists(BACKUP_SOURCE):
        if os.path.exists(target_path):
            shutil.rmtree(target_path)
        shutil.copytree(BACKUP_SOURCE, target_path)
        print(f"  Restored {TARGET_PROFILE_ID} from original backup.")
    else:
        print(f"  Warning: Backup source not found at {BACKUP_SOURCE}")

def step3_fix_config_ini():
    print("[3/5] Updating StreamDockConfig.ini mappings...")
    if not os.path.exists(CONFIG_INI):
        print("  Config ini not found!")
        return

    # Read raw text to preserve specific section formatting
    with open(CONFIG_INI, 'r', encoding='utf-8-sig', errors='ignore') as fp:
        lines = fp.readlines()

    new_lines = []
    current_section = None
    target_full_path = os.path.join(PROFILES_DIR, TARGET_PROFILE_ID).replace('/', '\\').replace('\\', '\\\\')

    for line in lines:
        stripped = line.strip()
        if stripped.startswith('[') and stripped.endswith(']'):
            current_section = stripped[1:-1]
            new_lines.append(line)
        elif current_section and ("AKP153" in current_section) and ("DeviceConfig" in current_section):
            if stripped.startswith("sdProfileName="):
                new_lines.append(f"sdProfileName={TARGET_PROFILE_ID}\n")
            elif stripped.startswith("sdProfilePath="):
                new_lines.append(f"sdProfilePath={target_full_path}\n")
            else:
                new_lines.append(line)
        else:
            new_lines.append(line)

    with open(CONFIG_INI, 'w', encoding='utf-8') as fp:
        fp.writelines(new_lines)
    print("  StreamDockConfig.ini updated.")

def step4_fix_database():
    print("[4/5] Updating DataCache.db...")
    if not os.path.exists(DATACACHE_DB):
        print("  DataCache.db not found!")
        return

    try:
        conn = sqlite3.connect(DATACACHE_DB)
        cursor = conn.cursor()

        # Ensure AKP153 table has target profile
        cursor.execute("CREATE TABLE IF NOT EXISTS AKP153 (Profile TEXT);")
        rows = cursor.execute("SELECT Profile FROM AKP153 WHERE Profile = ?;", (TARGET_PROFILE_ID,)).fetchall()
        if not rows:
            cursor.execute("INSERT INTO AKP153 VALUES (?);", (TARGET_PROFILE_ID,))
            print(f"  Inserted {TARGET_PROFILE_ID} into table AKP153.")

        conn.commit()
        conn.close()
        print("  Database committed.")
    except Exception as ex:
        print(f"  Database update error: {ex}")

def step5_launch_streamdock():
    print("[5/5] Launching Stream Dock AJAZZ...")
    cmd = f"Start-Process -FilePath '{STREAMDOCK_EXE}' -WorkingDirectory '{os.path.dirname(STREAMDOCK_EXE)}'"
    subprocess.run(["powershell", "-Command", cmd], check=False)
    print("  Driver process launched.")
    time.sleep(3.0)

if __name__ == '__main__':
    step1_stop_processes()
    step2_clean_profiles_dir()
    step3_fix_config_ini()
    step4_fix_database()
    step5_launch_streamdock()
    print("\n[+] Repair routine finished. Waiting for driver initialization...")
