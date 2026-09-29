"""
AKP153 Stream Dock Profile Compiler & Deployer
Translates declarative layout.yaml into StreamDock manifest.json and deploys to device.
"""

import os
import sys
import json
import uuid
import yaml
import shutil
import time
import subprocess
from datetime import datetime

# Local imports
sys.path.insert(0, os.path.dirname(__file__))
from icon_generator import generate_key_icon

APPDATA = os.environ.get('APPDATA', r'C:\Users\Administrator\AppData\Roaming')
STREAMDOCK_PROFILES_DIR = os.path.join(APPDATA, 'HotSpot', 'StreamDock', 'profiles')
STREAMDOCK_EXE = r"C:\Program Files (x86)\Stream Dock AJAZZ Global\Stream Dock AJAZZ.exe"

def find_target_profile():
    """Find the active AKP153 profile directory."""
    if not os.path.exists(STREAMDOCK_PROFILES_DIR):
        raise FileNotFoundError(f"StreamDock profiles folder not found at {STREAMDOCK_PROFILES_DIR}")

    matched = []
    for item in os.listdir(STREAMDOCK_PROFILES_DIR):
        p = os.path.join(STREAMDOCK_PROFILES_DIR, item)
        m_file = os.path.join(p, 'manifest.json')
        if os.path.isdir(p) and os.path.exists(m_file):
            try:
                with open(m_file, 'r', encoding='utf-8-sig') as fp:
                    data = json.load(fp)
                    uuid_str = str(data.get('DeviceUUID', ''))
                    model_str = str(data.get('DeviceModel', ''))
                    if '153' in uuid_str or '20GBA' in model_str:
                        matched.append((os.path.getmtime(m_file), p, data))
            except Exception:
                pass

    if not matched:
        raise RuntimeError("No AKP153 profile found in StreamDock profiles folder.")

    # Sort by modification time descending
    matched.sort(key=lambda x: x[0], reverse=True)
    return matched[0][1], matched[0][2]

def backup_profile(profile_dir):
    """Create a backup of the profile directory."""
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    backup_dir = f"{profile_dir}.backup_{ts}"
    shutil.copytree(profile_dir, backup_dir)
    print(f"[+] Backup created at: {backup_dir}")
    return backup_dir

def build_hotkey_object(raw_hotkey):
    """Convert layout YAML hotkey into StreamDock Hotkey settings."""
    return {
        "KeyCmd": bool(raw_hotkey.get("KeyCmd", False)),
        "KeyCtrl": bool(raw_hotkey.get("KeyCtrl", False)),
        "KeyShift": bool(raw_hotkey.get("KeyShift", False)),
        "KeyOption": bool(raw_hotkey.get("KeyOption", False)),
        "KeyModifiers": 65536,
        "NativeCode": -1,
        "QTKeyCode": -1,
        "RKeyCmd": False,
        "RKeyCtrl": False,
        "RKeyOption": False,
        "RKeyShift": False,
        "VKeyCode": int(raw_hotkey.get("VKeyCode", -1))
    }

def compile_and_deploy(yaml_path, dry_run=False, reload_driver=True):
    with open(yaml_path, 'r', encoding='utf-8') as fp:
        cfg = yaml.safe_load(fp)

    parent_profile_dir, parent_manifest = find_target_profile()
    print(f"[+] Active parent profile: {os.path.basename(parent_profile_dir)}")

    # Resolve active subpage
    current_page_name = parent_manifest.get('Pages', {}).get('Current')
    if not current_page_name:
        subpages = parent_manifest.get('Pages', {}).get('Pages', [])
        current_page_name = subpages[0] if subpages else None

    if not current_page_name:
        raise RuntimeError("Failed to resolve current page inside parent profile.")

    page_dir = os.path.join(parent_profile_dir, 'profiles', current_page_name)
    if not os.path.exists(page_dir):
        # Could be top-level page
        page_dir = parent_profile_dir

    page_manifest_path = os.path.join(page_dir, 'manifest.json')
    print(f"[+] Target page directory: {page_dir}")

    # Read existing page manifest
    with open(page_manifest_path, 'r', encoding='utf-8-sig') as fp:
        existing_manifest = json.load(fp)

    images_dir = os.path.join(page_dir, 'Images')
    os.makedirs(images_dir, exist_ok=True)

    if not dry_run:
        backup_profile(parent_profile_dir)

    actions = existing_manifest.get('Actions', {})

    for coord, key_def in cfg.get('keys', {}).items():
        k_type = key_def.get('type')
        title = key_def.get('title', '')
        symbol = key_def.get('symbol', 'generic')
        theme = key_def.get('theme', 'cyan')
        clean_coord = coord.replace(',', '_')

        # Generate custom icon if requested or applicable
        icon_name = f"custom_{clean_coord}.png"
        icon_full_path = os.path.join(images_dir, icon_name)
        if not dry_run:
            generate_key_icon(title, symbol=symbol, theme=theme, output_path=icon_full_path)

        if k_type == 'open':
            actions[coord] = {
                "ActionID": str(uuid.uuid4()),
                "Actions": [],
                "Controller": "",
                "Name": key_def.get('name', 'Open'),
                "Settings": {
                    "openShowState": False,
                    "path": key_def.get('path', '').replace('\\', '/')
                },
                "State": 0,
                "States": [
                    {
                        "FontSize": 12,
                        "Image": icon_name,
                        "Title": "",
                        "TitleAlignment": "bottom"
                    }
                ],
                "UUID": "com.hotspot.streamdock.system.open"
            }
        elif k_type == 'hotkey':
            raw_hks = key_def.get('hotkeys', [])
            hks = [build_hotkey_object(hk) for hk in raw_hks]
            while len(hks) < 3:
                hks.append(build_hotkey_object({}))

            actions[coord] = {
                "ActionID": str(uuid.uuid4()),
                "Actions": [],
                "Controller": "",
                "Name": key_def.get('name', 'Hotkey'),
                "Settings": {
                    "Coalesce": True,
                    "Hotkeys": hks,
                    "hotkeyRadioButtonIndex": 0
                },
                "State": 0,
                "States": [
                    {
                        "FontSize": 12,
                        "Image": icon_name,
                        "Title": "",
                        "TitleAlignment": "bottom"
                    }
                ],
                "UUID": "com.hotspot.streamdock.system.hotkey"
            }
        elif k_type == 'page_next':
            actions[coord] = {
                "ActionID": str(uuid.uuid4()),
                "Actions": [],
                "Controller": "",
                "Name": "Next page",
                "Settings": {},
                "State": 0,
                "States": [
                    {
                        "FontSize": 12,
                        "Image": icon_name,
                        "Title": "",
                        "TitleAlignment": "bottom"
                    }
                ],
                "UUID": "com.hotspot.streamdock.page.next"
            }
        elif k_type == 'plugin':
            p_uuid = key_def.get('uuid')
            # Retain or update plugin settings
            existing_act = actions.get(coord, {})
            settings = key_def.get('settings', existing_act.get('Settings', {}))
            states = key_def.get('states', existing_act.get('States', []))
            actions[coord] = {
                "ActionID": existing_act.get('ActionID', str(uuid.uuid4())),
                "Actions": existing_act.get('Actions', []),
                "Controller": existing_act.get('Controller', ''),
                "Name": key_def.get('name', existing_act.get('Name', '')),
                "Settings": settings,
                "State": 0,
                "States": states,
                "UUID": p_uuid
            }

    existing_manifest['Actions'] = actions

    if dry_run:
        print("[*] Dry run mode: would update manifest with", len(actions), "actions.")
        return

    with open(page_manifest_path, 'w', encoding='utf-8') as fp:
        json.dump(existing_manifest, fp, indent=4, ensure_ascii=False)
    print(f"[+] Manifest successfully updated at {page_manifest_path}")

    if reload_driver:
        restart_streamdock()

def restart_streamdock():
    """Kill running StreamDock and restart it to refresh hardware display."""
    print("[*] Restarting Stream Dock driver to apply changes...")
    try:
        subprocess.run(["powershell", "-Command", "Stop-Process -Name 'Stream Dock AJAZZ' -Force -ErrorAction SilentlyContinue"], check=False)
        time.sleep(1.0)
        if os.path.exists(STREAMDOCK_EXE):
            cmd = f"Start-Process -FilePath '{STREAMDOCK_EXE}' -WorkingDirectory '{os.path.dirname(STREAMDOCK_EXE)}'"
            subprocess.run(["powershell", "-Command", cmd], check=False)
            print("[+] Stream Dock driver restarted successfully.")
        else:
            print(f"[!] Warning: Driver executable not found at {STREAMDOCK_EXE}")
    except Exception as ex:
        print(f"[!] Error restarting driver: {ex}")

if __name__ == '__main__':
    default_yaml = os.path.join(os.path.dirname(__file__), '..', 'config', 'layout.yaml')
    dry = '--dry-run' in sys.argv
    compile_and_deploy(default_yaml, dry_run=dry)
