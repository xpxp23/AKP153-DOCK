"""
AKP153 Icon Generator (256x256 24-bit RGB)
Generates high-contrast, modern Fluent/Cyberpunk/Dark style 256x256 icons specifically for AKP153 LCD keys.
"""

import os
from PIL import Image, ImageDraw, ImageFont

FONT_BOLD = os.path.join(os.environ.get('WINDIR', 'C:\\Windows'), 'Fonts', 'msyhbd.ttc')
FONT_REGULAR = os.path.join(os.environ.get('WINDIR', 'C:\\Windows'), 'Fonts', 'msyh.ttc')

COLOR_PRESETS = {
    'cyan': {'accent': (6, 182, 212), 'glow': (6, 182, 212), 'bg': (15, 20, 24)},
    'sky': {'accent': (56, 189, 248), 'glow': (56, 189, 248), 'bg': (14, 21, 28)},
    'purple': {'accent': (168, 85, 247), 'glow': (147, 51, 234), 'bg': (20, 16, 28)},
    'magenta': {'accent': (236, 72, 153), 'glow': (219, 39, 119), 'bg': (26, 15, 24)},
    'emerald': {'accent': (16, 185, 129), 'glow': (5, 150, 105), 'bg': (13, 25, 20)},
    'amber': {'accent': (245, 158, 11), 'glow': (217, 119, 6), 'bg': (26, 22, 14)},
    'rose': {'accent': (244, 63, 94), 'glow': (225, 29, 72), 'bg': (28, 15, 18)},
    'blue': {'accent': (59, 130, 246), 'glow': (37, 99, 235), 'bg': (14, 20, 30)},
    'slate': {'accent': (148, 163, 184), 'glow': (100, 116, 139), 'bg': (18, 20, 24)},
}

def draw_symbol(draw: ImageDraw.ImageDraw, symbol_name: str, accent: tuple, center=(128, 96)):
    cx, cy = center
    if symbol_name == 'terminal':
        # Prompt glyph >_
        draw.line([cx - 48, cy - 32, cx - 16, cy, cx - 48, cy + 32], fill=accent, width=8)
        draw.line([cx + 4, cy + 32, cx + 44, cy + 32], fill=accent, width=8)
    elif symbol_name == 'vscode':
        # Clean editor glyph { }
        draw.text((cx, cy), "{ }", fill=accent, anchor='mm', font=ImageFont.truetype(FONT_BOLD, 72))
    elif symbol_name == 'ai':
        # Sparkle ✦
        draw.polygon([
            (cx, cy - 48), (cx + 12, cy - 12), (cx + 48, cy),
            (cx + 12, cy + 12), (cx, cy + 48), (cx - 12, cy + 12),
            (cx - 48, cy), (cx - 12, cy - 12)
        ], fill=accent)
        # Companion sparkle
        draw.polygon([
            (cx + 36, cy - 36), (cx + 42, cy - 24), (cx + 54, cy - 18),
            (cx + 42, cy - 12), (cx + 36, cy), (cx + 30, cy - 12),
            (cx + 18, cy - 18), (cx + 30, cy - 24)
        ], fill=(255, 255, 255))
    elif symbol_name == 'bug':
        # Bug / Shield glyph
        draw.ellipse([cx - 32, cy - 24, cx + 32, cy + 36], outline=accent, width=6, fill=(accent[0]//3, accent[1]//3, accent[2]//3))
        draw.ellipse([cx - 20, cy - 44, cx + 20, cy - 20], fill=accent)
        # Antennas
        draw.line([cx - 10, cy - 40, cx - 28, cy - 56], fill=accent, width=6)
        draw.line([cx + 10, cy - 40, cx + 28, cy - 56], fill=accent, width=6)
        # Legs
        draw.line([cx - 32, cy - 4, cx - 56, cy - 12], fill=accent, width=6)
        draw.line([cx + 32, cy - 4, cx + 56, cy - 12], fill=accent, width=6)
        draw.line([cx - 32, cy + 16, cx - 56, cy + 24], fill=accent, width=6)
        draw.line([cx + 32, cy + 16, cx + 56, cy + 24], fill=accent, width=6)
    elif symbol_name == 'refactor':
        # Sync / Refactor code loop
        draw.arc([cx - 40, cy - 40, cx + 40, cy + 40], start=30, end=210, fill=accent, width=8)
        draw.arc([cx - 40, cy - 40, cx + 40, cy + 40], start=240, end=30, fill=(255, 255, 255), width=8)
        draw.polygon([(cx + 28, cy - 48), (cx + 48, cy - 36), (cx + 36, cy - 20)], fill=(255, 255, 255))
        draw.polygon([(cx - 28, cy + 48), (cx - 48, cy + 36), (cx - 36, cy + 20)], fill=accent)
    elif symbol_name == 'sql':
        # Database cylinder
        draw.ellipse([cx - 40, cy - 36, cx + 40, cy - 12], outline=accent, width=6)
        draw.line([cx - 40, cy - 24, cx - 40, cy + 28], fill=accent, width=6)
        draw.line([cx + 40, cy - 24, cx + 40, cy + 28], fill=accent, width=6)
        draw.arc([cx - 40, cy - 8, cx + 40, cy + 16], start=0, end=180, fill=accent, width=6)
        draw.arc([cx - 40, cy + 8, cx + 40, cy + 32], start=0, end=180, fill=accent, width=6)
    elif symbol_name == 'siyuan':
        # Note / Book icon
        draw.rounded_rectangle([cx - 36, cy - 44, cx + 36, cy + 36], radius=8, outline=accent, width=6, fill=(accent[0]//3, accent[1]//3, accent[2]//3))
        draw.line([cx - 24, cy - 20, cx + 24, cy - 20], fill=accent, width=4)
        draw.line([cx - 24, cy - 4, cx + 24, cy - 4], fill=accent, width=4)
        draw.line([cx - 24, cy + 12, cx + 8, cy + 12], fill=accent, width=4)
    elif symbol_name == 'ocr':
        # Scan / Text extractor
        draw.arc([cx - 44, cy - 40, cx - 20, cy - 16], start=180, end=270, fill=accent, width=6)
        draw.arc([cx + 20, cy - 40, cx + 44, cy - 16], start=270, end=360, fill=accent, width=6)
        draw.arc([cx - 44, cy + 16, cx - 20, cy + 40], start=90, end=180, fill=accent, width=6)
        draw.arc([cx + 20, cy + 16, cx + 44, cy + 40], start=0, end=90, fill=accent, width=6)
        draw.text((cx, cy), "TXT", fill=(255, 255, 255), anchor='mm', font=ImageFont.truetype(FONT_BOLD, 30))
    elif symbol_name == 'audio':
        # Headphones
        draw.arc([cx - 40, cy - 44, cx + 40, cy + 20], start=180, end=360, fill=accent, width=8)
        draw.rounded_rectangle([cx - 48, cy - 8, cx - 32, cy + 32], radius=8, fill=accent)
        draw.rounded_rectangle([cx + 32, cy - 8, cx + 48, cy + 32], radius=8, fill=accent)
    elif symbol_name == 'mic':
        # Microphone
        draw.rounded_rectangle([cx - 16, cy - 40, cx + 16, cy + 8], radius=16, fill=accent)
        draw.arc([cx - 28, cy - 20, cx + 28, cy + 24], start=0, end=180, fill=accent, width=6)
        draw.line([cx, cy + 24, cx, cy + 40], fill=accent, width=6)
        draw.line([cx - 16, cy + 40, cx + 16, cy + 40], fill=accent, width=6)
    elif symbol_name == 'snap':
        # Window split icon
        draw.rounded_rectangle([cx - 44, cy - 32, cx + 44, cy + 32], radius=8, outline=accent, width=6)
        draw.line([cx, cy - 32, cx, cy + 32], fill=accent, width=6)
        draw.rectangle([cx - 40, cy - 28, cx - 4, cy + 28], fill=(accent[0]//2, accent[1]//2, accent[2]//2))
    elif symbol_name == 'lock':
        # Lock icon
        draw.arc([cx - 24, cy - 44, cx + 24, cy - 4], start=180, end=360, fill=accent, width=8)
        draw.rounded_rectangle([cx - 32, cy - 8, cx + 32, cy + 36], radius=8, fill=accent)
        draw.ellipse([cx - 8, cy + 4, cx + 8, cy + 20], fill=(20, 20, 25))
    elif symbol_name == 'page':
        # Next arrow >>
        draw.line([cx - 24, cy - 28, cx + 4, cy, cx - 24, cy + 28], fill=accent, width=8)
        draw.line([cx + 4, cy - 28, cx + 32, cy, cx + 4, cy + 28], fill=(255, 255, 255), width=8)
    elif symbol_name == 'monitor':
        # Speedometer
        draw.arc([cx - 44, cy - 36, cx + 44, cy + 44], start=135, end=405, fill=accent, width=8)
        draw.line([cx, cy + 8, cx + 24, cy - 16], fill=(255, 255, 255), width=6)
        draw.ellipse([cx - 8, cy, cx + 8, cy + 16], fill=accent)
    else:
        # Default gear / command
        draw.ellipse([cx - 28, cy - 28, cx + 28, cy + 28], outline=accent, width=8)
        draw.ellipse([cx - 8, cy - 8, cx + 8, cy + 8], fill=accent)

def generate_key_icon(
    title: str,
    symbol: str = 'generic',
    theme: str = 'cyan',
    output_path: str = None
) -> Image.Image:
    """Generate 256x256 24-bit RGB high-contrast key icon for AKP153 LCD."""
    theme_cfg = COLOR_PRESETS.get(theme, COLOR_PRESETS['cyan'])
    accent = theme_cfg['accent']
    glow = theme_cfg['glow']
    bg = theme_cfg['bg']

    # Native 256x256 RGB canvas
    img = Image.new('RGB', (256, 256), bg)
    draw = ImageDraw.Draw(img)

    # 1. Outer rounded container border
    draw.rounded_rectangle([4, 4, 251, 251], radius=44, outline=(40, 48, 58), width=3)
    # Inner glow outline
    draw.rounded_rectangle([8, 8, 247, 247], radius=40, outline=(glow[0]//2, glow[1]//2, glow[2]//2), width=2)

    # 2. Top accent indicator pill
    draw.rounded_rectangle([80, 14, 176, 22], radius=4, fill=accent)

    # 3. Center Symbol
    draw_symbol(draw, symbol, accent, center=(128, 96))

    # 4. Bottom Label Pill & Text
    if title:
        font_size = 28 if len(title) <= 5 else 24 if len(title) <= 7 else 22
        try:
            font = ImageFont.truetype(FONT_BOLD, font_size)
        except Exception:
            font = ImageFont.load_default()
        
        # Pill container for high readability
        draw.rounded_rectangle([20, 176, 236, 236], radius=16, fill=(10, 12, 16), outline=(50, 55, 65), width=2)
        draw.text((128, 206), title, fill=(250, 250, 252), anchor='mm', font=font)

    if output_path:
        os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)
        img.save(output_path, 'PNG')

    return img

if __name__ == '__main__':
    test_dir = os.path.join(os.path.dirname(__file__), '..', 'bin', 'preview_icons')
    os.makedirs(test_dir, exist_ok=True)
    samples = [
        ('CPU 负载', 'monitor', 'cyan'),
        ('耳机/音响', 'audio', 'sky'),
        ('麦克风静音', 'mic', 'rose'),
        ('终端呼出', 'terminal', 'amber'),
        ('VS Code', 'vscode', 'blue'),
        ('AI 助手', 'ai', 'magenta'),
        ('Bug 诊断', 'bug', 'rose'),
        ('代码重构', 'refactor', 'purple'),
        ('SQL/正则', 'sql', 'amber'),
        ('思源速记', 'siyuan', 'emerald'),
        ('屏幕 OCR', 'ocr', 'sky'),
        ('下一页', 'page', 'slate'),
    ]
    for title, sym, col in samples:
        out = os.path.join(test_dir, f"{sym}.png")
        im = generate_key_icon(title, sym, col, out)
    print(f"Generated {len(samples)} sample icons (256x256 RGB) in {test_dir}")
