"""
AKP153 AI Prompt Injector
Wraps clipboard contents with high-efficiency engineering prompts and primes the clipboard for instant paste.
"""

import sys
import os
import argparse
import subprocess
import winsound
import tkinter as tk

PROMPT_PRESETS = {
    'bug': (
        "【请深度排查并修复以下代码/报错】\n"
        "1. 定位并剖析报错的根本原因；\n"
        "2. 给出最小修改建议以及修复后的完整代码片段；\n"
        "3. 阐明防范此边界缺陷的最佳实践。\n\n"
        "---------------- 待分析内容 ----------------\n"
    ),
    'refactor': (
        "【请重构并优化以下代码】\n"
        "1. 提升架构清晰度、可读性与执行效能；\n"
        "2. 补充严谨的类型提示与关键逻辑注释；\n"
        "3. 指出可能存在的安全漏洞或异常处理盲区。\n\n"
        "---------------- 待重构代码 ----------------\n"
    ),
    'sql_regex': (
        "【请生成或解析以下 SQL / 正则表达式需求】\n"
        "1. 提供高效标准实现；\n"
        "2. 拆解核心匹配组/查询子句并详细注释；\n"
        "3. 提供 3 组典型成功与边界用例验证。\n\n"
        "---------------- 需求 / 参考 ----------------\n"
    ),
    'summarize': (
        "【请提炼以下内容的精要知识】\n"
        "1. 一句话主旨结论；\n"
        "2. 3~5 个结构化核心采分点/技术细节；\n"
        "3. 关键推论与执行清单。\n\n"
        "---------------- 原文内容 ----------------\n"
    )
}

DOUBAO_PATH = r"C:\Users\Administrator\AppData\Local\Doubao\Application\Doubao.exe"

def get_clipboard():
    try:
        r = tk.Tk()
        r.withdraw()
        content = r.clipboard_get()
        r.destroy()
        return content
    except:
        return ""

def set_clipboard(text):
    r = tk.Tk()
    r.withdraw()
    r.clipboard_clear()
    r.clipboard_append(text)
    r.update()
    r.destroy()

def main():
    parser = argparse.ArgumentParser(description="AKP153 AI Prompt Injector")
    parser.add_argument('--preset', choices=list(PROMPT_PRESETS.keys()), required=True)
    parser.add_argument('--no-launch', action='store_true', help="Do not launch external AI app")
    args = parser.parse_args()

    content = get_clipboard().strip()
    prefix = PROMPT_PRESETS[args.preset]

    if content:
        final_prompt = f"{prefix}{content}"
    else:
        final_prompt = prefix

    set_clipboard(final_prompt)
    try:
        winsound.MessageBeep(winsound.MB_ICONASTERISK)
    except:
        pass

    if not args.no_launch and os.path.exists(DOUBAO_PATH):
        try:
            subprocess.Popen([DOUBAO_PATH])
        except:
            pass

if __name__ == '__main__':
    main()
