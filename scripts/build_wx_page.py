#!/usr/bin/env python3
"""md2wx: 将 Markdown 文件注入微信公众号转换页面模板，生成可直接打开并一键复制的 HTML。

用法:
    python build_wx_page.py <input.md> [-o output.html]

输出: 默认在输入文件同目录生成 <name>.wx.html
"""
import argparse
import json
import sys
from pathlib import Path

PLACEHOLDER = "__MARKDOWN_JSON__"
TEMPLATE = Path(__file__).resolve().parent.parent / "assets" / "wx_template.html"


def build(md_path: str, out_path: str | None = None) -> Path:
    md_file = Path(md_path).resolve()
    if not md_file.exists():
        sys.exit(f"[md2wx] 输入文件不存在: {md_file}")
    if not TEMPLATE.exists():
        sys.exit(f"[md2wx] 找不到模板文件: {TEMPLATE}")

    markdown_text = md_file.read_text(encoding="utf-8")

    # JSON 编码保证任意字符（引号/换行/emoji）安全嵌入 JS 字符串
    payload = json.dumps(markdown_text, ensure_ascii=False)
    # 防止内容中出现 </script> 提前闭合脚本标签
    payload = payload.replace("</", "<\\/")

    template = TEMPLATE.read_text(encoding="utf-8")
    if PLACEHOLDER not in template:
        sys.exit(f"[md2wx] 模板缺少占位符 {PLACEHOLDER}")
    html = template.replace(PLACEHOLDER, payload)

    if out_path:
        out_file = Path(out_path).resolve()
    else:
        out_file = md_file.with_suffix(".wx.html")
    out_file.parent.mkdir(parents=True, exist_ok=True)
    out_file.write_text(html, encoding="utf-8")
    return out_file


def main() -> None:
    parser = argparse.ArgumentParser(description="Markdown -> 微信公众号可复制 HTML 页面")
    parser.add_argument("input", help="Markdown 输入文件路径")
    parser.add_argument("-o", "--output", help="输出 HTML 路径（默认 <name>.wx.html）")
    args = parser.parse_args()
    out = build(args.input, args.output)
    print(f"[md2wx] 已生成: {out}")
    print("[md2wx] 用浏览器/预览打开该文件，点击右上角「复制到公众号」按钮，再粘贴到公众号编辑器即可。")


if __name__ == "__main__":
    main()
