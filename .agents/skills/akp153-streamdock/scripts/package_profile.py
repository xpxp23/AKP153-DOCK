"""
AKP153 Profile Packager (.streamDockProfile)
Compiles layout configuration into a 100% native, official .streamDockProfile zip package.
Safe, zero-risk, no process killing, no USB handle corruption.
"""

import os
import sys
import json
import uuid
import yaml
import zipfile
import hashlib
from io import BytesIO

sys.path.insert(0, os.path.dirname(__file__))
from icon_generator import generate_key_icon

def generate_image_id(data: bytes) -> str:
    """Generate a clean 27-char alphanumeric ID resembling StreamDock image naming."""
    h = hashlib.sha256(data).hexdigest().upper()
    return h[:27] + ".png"

def build_profile_package(yaml_path: str, output_profile_path: str = None, profile_name: str = None):
    """
    Reads a layout YAML and builds an official .streamDockProfile zip archive.
    """
    with open(yaml_path, 'r', encoding='utf-8') as fp:
        cfg = yaml.safe_load(fp)

    p_info = cfg.get('profile_info', {})
    p_name = profile_name or p_info.get('name', 'AI 智能驾驶舱')
    device_model = p_info.get('device_model', '20GBA9901')
    device_uuid = p_info.get('device_uuid', 'AKP153')
    
    grid = cfg.get('keys', cfg.get('grid', {}))

    page_uuid = str(uuid.uuid4()).upper() + ".sdProfile"

    root_manifest = {
        "Actions": {},
        "AppIdentifier": "",
        "DeviceModel": device_model,
        "DeviceUUID": device_uuid,
        "Name": p_name,
        "Pages": {
            "Current": page_uuid,
            "Pages": [page_uuid]
        },
        "Version": "1.0"
    }

    subpage_manifest = {
        "Actions": {},
        "AppIdentifier": "",
        "DeviceModel": device_model,
        "DeviceUUID": device_uuid,
        "Name": "",
        "Pages": {
            "Current": "",
            "Pages": []
        },
        "Version": "1.0"
    }

    images_to_pack = {} # filename -> bytes

    for coord, key_def in grid.items():
        title = key_def.get('title', '')
        symbol = key_def.get('symbol', 'generic')
        theme = key_def.get('theme', 'cyan')
        k_type = key_def.get('type', 'open')

        # 1. Generate 256x256 RGB Icon if requested
        img_filename = ""
        if symbol or title:
            img = generate_key_icon(title, symbol, theme)
            buf = BytesIO()
            img.save(buf, format='PNG')
            img_bytes = buf.getvalue()
            img_filename = generate_image_id(img_bytes)
            images_to_pack[img_filename] = img_bytes

        # 2. Build action definition
        action_id = str(uuid.uuid4()).lower()
        states = key_def.get('states', [])
        if not states:
            states = [
                {
                    "FontSize": 11,
                    "FontStyle": "Bold",
                    "Image": img_filename,
                    "Title": "",
                    "TitleAlignment": "bottom"
                }
            ]
        elif img_filename:
            states[0]["Image"] = img_filename

        action_obj = {
            "ActionID": action_id,
            "Controller": "",
            "Name": key_def.get('name', title),
            "Settings": {},
            "State": 0,
            "States": states,
            "UUID": ""
        }

        if k_type == 'open':
            target = key_def.get('path', key_def.get('target', ''))
            action_obj["UUID"] = "com.hotspot.streamdock.system.open"
            action_obj["Settings"] = {"path": target}

        elif k_type == 'hotkey':
            raw_hk_list = key_def.get('hotkeys', [])
            raw_hk = raw_hk_list[0] if raw_hk_list else key_def.get('hotkey', {})
            action_obj["UUID"] = "com.hotspot.streamdock.system.hotkey"
            action_obj["Settings"] = {
                "KeyCmd": bool(raw_hk.get("KeyCmd", False)),
                "KeyCtrl": bool(raw_hk.get("KeyCtrl", False)),
                "KeyShift": bool(raw_hk.get("KeyShift", False)),
                "KeyOption": bool(raw_hk.get("KeyOption", False)),
                "KeyModifiers": 65536,
                "NativeCode": -1,
                "QTKeyCode": -1,
                "RKeyCmd": False,
                "RKeyCtrl": False,
                "RKeyOption": False,
                "RKeyShift": False,
                "VKeyCode": int(raw_hk.get("VKeyCode", -1))
            }

        elif k_type == 'page_next':
            action_obj["UUID"] = "com.hotspot.streamdock.page.next"

        elif k_type == 'plugin':
            p_uuid = key_def.get('uuid')
            action_obj["UUID"] = p_uuid
            action_obj["Settings"] = key_def.get('settings', {})

        root_manifest["Actions"][coord] = action_obj
        subpage_manifest["Actions"][coord] = action_obj

    if not output_profile_path:
        dist_dir = os.path.join(os.path.dirname(__file__), '..', 'dist')
        os.makedirs(dist_dir, exist_ok=True)
        safe_name = "".join(c for c in p_name if c.isalnum() or c in (' ', '_', '-')).strip()
        output_profile_path = os.path.join(dist_dir, f"{safe_name}.streamDockProfile")

    os.makedirs(os.path.dirname(os.path.abspath(output_profile_path)), exist_ok=True)

    # Write the zip archive
    with zipfile.ZipFile(output_profile_path, 'w', compression=zipfile.ZIP_DEFLATED) as zf:
        # 1. Root manifest
        zf.writestr('manifest.json', json.dumps(root_manifest, indent=4, ensure_ascii=False))
        # 2. Subpage manifest
        sub_manifest_path = f"profiles/{page_uuid}/manifest.json"
        zf.writestr(sub_manifest_path, json.dumps(subpage_manifest, indent=4, ensure_ascii=False))

        # 3. CustomImages placeholder directories
        for r in range(3):
            for c in range(6):
                zf.writestr(f"{c},{r}/CustomImages/", "")
                zf.writestr(f"profiles/{page_uuid}/{c},{r}/CustomImages/", "")

        # 4. Images
        for img_name, img_data in images_to_pack.items():
            zf.writestr(f"Images/{img_name}", img_data)

    print(f"[+] Successfully built native profile package:")
    print(f"    --> {output_profile_path}")
    print(f"    --> Total keys configured: {len(root_manifest['Actions'])}")
    print(f"    --> Total 256x256 RGB icons bundled: {len(images_to_pack)}")
    return output_profile_path

if __name__ == '__main__':
    default_yaml = os.path.join(os.path.dirname(__file__), '..', 'config', 'layout.yaml')
    pkg = build_profile_package(default_yaml)
    print(f"\n[INFO] Profile package ready. To import into StreamDock:")
    print(f"Run in PowerShell: Start-Process '{pkg}' or double-click the file.")
