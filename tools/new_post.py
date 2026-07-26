from __future__ import annotations

import argparse
import json
import re
import shutil
import subprocess
import sys
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
POSTS_DIR = ROOT / "_posts"
IMAGES_DIR = ROOT / "assets" / "post_image"
FILES_DIR = ROOT / "assets" / "post_files"
COMPRESSOR = IMAGES_DIR / "_image_compressor.py"
BLOG_TIMEZONE = timezone(timedelta(hours=8))
IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".jfif", ".png", ".bmp", ".tif", ".tiff", ".webp"}
ATTACHMENT_EXTENSIONS = {".pdf", ".doc", ".docx"}
CONTENT_TEMPLATE_OPTIONS = (
    (
        "headings",
        "章节标题",
        (
            "## 章节标题",
            "",
            "在这里填写本节内容。",
            "",
            "### 小节标题",
            "",
            "在这里填写小节内容。",
            "",
            "#### 补充说明",
            "",
            "在这里填写补充内容。",
        ),
    ),
    (
        "code",
        "代码块",
        (
            "## 代码示例",
            "",
            "```text",
            "在这里粘贴代码，并把 text 改成实际语言，例如 python、html 或 powershell。",
            "```",
        ),
    ),
    (
        "table",
        "表格",
        (
            "## 数据表格",
            "",
            "| 项目 | 内容 | 备注 |",
            "| --- | --- | --- |",
            "| 示例一 | 在这里填写 | 在这里填写 |",
            "| 示例二 | 在这里填写 | 在这里填写 |",
        ),
    ),
    (
        "steps",
        "操作步骤",
        (
            "## 操作步骤",
            "",
            "1. 第一步",
            "2. 第二步",
            "3. 第三步",
        ),
    ),
    (
        "prompt",
        "提示框",
        (
            "> 在这里填写需要特别提醒的内容。",
            "{: .prompt-tip }",
        ),
    ),
    (
        "quote",
        "引用",
        (
            "> 在这里填写引用内容。",
            ">",
            "> 这里可以填写来源或补充说明。",
        ),
    ),
)
CONTENT_TEMPLATE_MAP = {
    key: lines for key, _label, lines in CONTENT_TEMPLATE_OPTIONS
}


def split_values(value: str) -> list[str]:
    parts = re.split(r"[,，]", value)
    return [part.strip() for part in parts if part.strip()]


def safe_component(value: str) -> str:
    value = value.strip()
    value = re.sub(r'[<>:"/\\|?*#%&{}$!\'@+`=]+', "-", value)
    value = re.sub(r"\s+", "-", value)
    value = re.sub(r"-{2,}", "-", value)
    value = value.strip(" .-_")
    return value[:96] or "new-post"


def yaml_list(values: list[str]) -> str:
    return json.dumps(values, ensure_ascii=False)


def content_template_lines(selected: list[str]) -> list[str]:
    selected_set = set(selected)
    unknown = selected_set.difference(CONTENT_TEMPLATE_MAP)
    if unknown:
        names = ", ".join(sorted(unknown))
        raise ValueError(f"未知的正文模板：{names}")

    lines: list[str] = []
    for key, _label, template in CONTENT_TEMPLATE_OPTIONS:
        if key not in selected_set:
            continue
        if lines:
            lines.append("")
        lines.extend(template)
        lines.append("")
    return lines


def existing_taxonomy(field: str) -> list[str]:
    pattern = re.compile(rf"^{re.escape(field)}\s*:\s*\[(.*?)\]\s*$", re.MULTILINE)
    values: set[str] = set()

    for post in POSTS_DIR.glob("*.md"):
        try:
            content = post.read_text(encoding="utf-8")
        except OSError:
            continue

        match = pattern.search(content)
        if not match:
            continue

        for value in split_values(match.group(1)):
            cleaned = value.strip("\"'")
            if cleaned:
                values.add(cleaned)

    return sorted(values, key=str.casefold)


def copy_image(source: Path, destination_dir: Path, stem: str) -> Path:
    suffix = source.suffix.casefold()
    if suffix not in IMAGE_EXTENSIONS:
        raise ValueError(f"不支持的图片格式：{source.name}")

    destination = destination_dir / f"{stem}{suffix}"
    shutil.copy2(source, destination)
    return destination


def copy_attachment(source: Path, destination_dir: Path) -> Path:
    suffix = source.suffix.casefold()
    if suffix not in ATTACHMENT_EXTENSIONS:
        raise ValueError(f"目前只支持 Word 和 PDF：{source.name}")

    stem = safe_component(source.stem)
    destination = destination_dir / f"{stem}{suffix}"
    number = 2
    while destination.exists():
        destination = destination_dir / f"{stem}-{number}{suffix}"
        number += 1

    shutil.copy2(source, destination)
    return destination


def run_compressor() -> tuple[bool, str]:
    if not COMPRESSOR.is_file():
        return False, "未找到现有图片压缩工具，图片已保留原格式。"

    completed = subprocess.run(
        [sys.executable, str(COMPRESSOR)],
        cwd=ROOT,
        check=False,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
    )
    if completed.returncode == 0:
        return True, "图片已自动压缩。"

    detail = completed.stderr.strip() or completed.stdout.strip()
    return False, f"图片压缩未完成，已保留原文件。\n{detail[-500:]}"


def find_generated_image(directory: Path, stem: str) -> Path | None:
    preferred = directory / f"{stem}.webp"
    if preferred.is_file():
        return preferred

    matches = sorted(
        (
            path
            for path in directory.iterdir()
            if path.is_file()
            and path.stem.casefold() == stem.casefold()
            and path.suffix.casefold() in IMAGE_EXTENSIONS
        ),
        key=lambda path: path.name.casefold(),
    )
    return matches[0] if matches else None


def clipboard_image_sources(temp_dir: Path, next_index: int) -> tuple[tuple[Path, ...], int]:
    from PIL import Image, ImageGrab

    try:
        clipboard = ImageGrab.grabclipboard()
    except OSError as error:
        raise ValueError(f"无法读取剪贴板：{error}") from error

    if isinstance(clipboard, Image.Image):
        temp_dir.mkdir(parents=True, exist_ok=True)
        path = temp_dir / f"clipboard-{next_index:03d}.png"
        clipboard.save(path, "PNG")
        return (path,), next_index + 1

    if isinstance(clipboard, (list, tuple)):
        paths = tuple(
            path
            for item in clipboard
            if (path := Path(item)).is_file()
            and path.suffix.casefold() in IMAGE_EXTENSIONS
        )
        if paths:
            return paths, next_index

    raise ValueError("剪贴板中没有可用图片。请先复制图片或图片文件。")


def build_post(
    title: str,
    categories: list[str],
    tags: list[str],
    cover: Path | None = None,
    body_images: tuple[Path, ...] = (),
    attachments: tuple[Path, ...] = (),
    content_templates: list[str] | None = None,
) -> tuple[Path, Path, Path | None, str]:
    title = title.strip()
    if not title:
        raise ValueError("文章标题不能为空。")

    folder_name = safe_component(title)
    now = datetime.now(BLOG_TIMEZONE)
    post_path = POSTS_DIR / f"{now:%Y-%m-%d}-{folder_name}.md"
    image_dir = IMAGES_DIR / folder_name
    attachment_dir = FILES_DIR / folder_name if attachments else None

    if post_path.exists():
        raise FileExistsError(f"文章已经存在：{post_path.name}")
    if image_dir.exists() and any(image_dir.iterdir()):
        raise FileExistsError(f"图片文件夹已经存在且不为空：{image_dir}")
    if attachment_dir and attachment_dir.exists() and any(attachment_dir.iterdir()):
        raise FileExistsError(f"附件文件夹已经存在且不为空：{attachment_dir}")

    POSTS_DIR.mkdir(parents=True, exist_ok=True)
    image_dir.mkdir(parents=True, exist_ok=True)
    if attachment_dir:
        attachment_dir.mkdir(parents=True, exist_ok=True)

    if cover:
        copy_image(cover, image_dir, "cover")

    for index, source in enumerate(body_images, start=1):
        copy_image(source, image_dir, f"image-{index:02d}")

    copied_attachments: list[Path] = []
    if attachment_dir:
        for source in attachments:
            copied_attachments.append(copy_attachment(source, attachment_dir))

    compression_note = ""
    if cover or body_images:
        _, compression_note = run_compressor()

    cover_file = find_generated_image(image_dir, "cover")
    body_files = [
        generated
        for index in range(1, len(body_images) + 1)
        if (generated := find_generated_image(image_dir, f"image-{index:02d}")) is not None
    ]

    lines = [
        "---",
        f"title: {json.dumps(title, ensure_ascii=False)}",
        f"date: {now:%Y-%m-%d %H:%M:%S %z}",
        f"media_subpath: /assets/post_image/{folder_name}",
    ]

    if cover_file:
        lines.extend(
            [
                "image:",
                f"  path: {cover_file.name}",
                f"  alt: {json.dumps(title, ensure_ascii=False)}",
            ]
        )

    lines.extend(
        [
            f"categories: {yaml_list(categories or ['随笔'])}",
            f"tags: {yaml_list(tags)}",
            "---",
            "",
            "<!-- 从这里开始写正文。 -->",
            "",
        ]
    )

    lines.extend(content_template_lines(content_templates or []))

    for index, image in enumerate(body_files, start=1):
        lines.extend([f"![图片 {index}]({image.name})", ""])

    if copied_attachments and attachment_dir:
        lines.extend(["## 附件下载", ""])
        for attachment in copied_attachments:
            url = f"/assets/post_files/{folder_name}/{attachment.name}"
            lines.append(f"- [下载 {attachment.name}]({{{{ {json.dumps(url, ensure_ascii=False)} | relative_url }}}})")
        lines.append("")

    post_path.write_text("\n".join(lines), encoding="utf-8", newline="\n")
    return post_path, image_dir, attachment_dir, compression_note


def open_result(post_path: Path, image_dir: Path, attachment_dir: Path | None) -> None:
    if sys.platform != "win32":
        return

    code = shutil.which("code")
    if code:
        subprocess.Popen(
            [code, "-r", str(post_path)],
            cwd=ROOT,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
    else:
        post_path_str = str(post_path)
        os_startfile = getattr(__import__("os"), "startfile", None)
        if os_startfile:
            os_startfile(post_path_str)

    os_startfile = getattr(__import__("os"), "startfile", None)
    if os_startfile:
        os_startfile(str(image_dir))
        if attachment_dir:
            os_startfile(str(attachment_dir))


def launch_gui() -> int:
    import tkinter as tk
    from tkinter import filedialog, messagebox, ttk

    root = tk.Tk()
    root.title("新建博客文章")
    root.resizable(False, False)
    clipboard_temp = tempfile.TemporaryDirectory(prefix="chirpy-post-clipboard-")
    clipboard_dir = Path(clipboard_temp.name)

    title_var = tk.StringVar()
    category_var = tk.StringVar(value="随笔")
    tags_var = tk.StringVar()
    cover_var = tk.StringVar(value="未选择")
    images_var = tk.StringVar(value="未选择")
    attachments_var = tk.StringVar(value="未选择")
    open_var = tk.BooleanVar(value=True)
    template_vars = {
        key: tk.BooleanVar(value=False)
        for key, _label, _template in CONTENT_TEMPLATE_OPTIONS
    }
    cover_path: Path | None = None
    body_paths: tuple[Path, ...] = ()
    attachment_paths: tuple[Path, ...] = ()
    clipboard_index = 1

    style = ttk.Style(root)
    style.configure(".", font=("Microsoft YaHei UI", 10))
    style.configure("Title.TLabel", font=("Microsoft YaHei UI", 15, "bold"))

    panel = ttk.Frame(root, padding=20)
    panel.grid(row=0, column=0, sticky="nsew")
    panel.columnconfigure(1, weight=1)

    ttk.Label(panel, text="一键新建博客文章", style="Title.TLabel").grid(
        row=0, column=0, columnspan=3, sticky="w", pady=(0, 16)
    )

    ttk.Label(panel, text="文章标题").grid(row=1, column=0, sticky="w", pady=5)
    title_entry = ttk.Entry(panel, textvariable=title_var, width=48)
    title_entry.grid(row=1, column=1, columnspan=2, sticky="ew", pady=5)

    ttk.Label(panel, text="分类").grid(row=2, column=0, sticky="w", pady=5)
    category_box = ttk.Combobox(
        panel,
        textvariable=category_var,
        values=existing_taxonomy("categories"),
        width=45,
    )
    category_box.grid(row=2, column=1, columnspan=2, sticky="ew", pady=5)

    ttk.Label(panel, text="标签").grid(row=3, column=0, sticky="w", pady=5)
    ttk.Entry(panel, textvariable=tags_var).grid(
        row=3, column=1, columnspan=2, sticky="ew", pady=5
    )
    ttk.Label(panel, text="多个分类或标签使用逗号分隔").grid(
        row=4, column=1, columnspan=2, sticky="w", pady=(0, 10)
    )

    def choose_cover() -> None:
        nonlocal cover_path
        selected = filedialog.askopenfilename(
            title="选择文章封面",
            filetypes=[("图片", "*.jpg *.jpeg *.jfif *.png *.bmp *.tif *.tiff *.webp")],
        )
        if selected:
            cover_path = Path(selected)
            cover_var.set(cover_path.name)

    def choose_images() -> None:
        nonlocal body_paths
        selected = filedialog.askopenfilenames(
            title="选择正文图片（可多选）",
            filetypes=[("图片", "*.jpg *.jpeg *.jfif *.png *.bmp *.tif *.tiff *.webp")],
        )
        if selected:
            selected_paths = tuple(Path(path) for path in selected)
            body_paths += tuple(path for path in selected_paths if path not in body_paths)
            images_var.set(f"已选择 {len(body_paths)} 张")

    def paste_cover() -> None:
        nonlocal clipboard_index, cover_path
        try:
            paths, clipboard_index = clipboard_image_sources(clipboard_dir, clipboard_index)
        except ValueError as error:
            messagebox.showwarning("无法粘贴封面", str(error), parent=root)
            return

        cover_path = paths[0]
        cover_var.set(f"已粘贴：{cover_path.name}")

    def paste_images() -> None:
        nonlocal body_paths, clipboard_index
        try:
            paths, clipboard_index = clipboard_image_sources(clipboard_dir, clipboard_index)
        except ValueError as error:
            messagebox.showwarning("无法粘贴图片", str(error), parent=root)
            return

        body_paths += paths
        images_var.set(f"已选择 {len(body_paths)} 张")

    def choose_attachments() -> None:
        nonlocal attachment_paths
        selected = filedialog.askopenfilenames(
            title="选择 Word 或 PDF 附件（可多选）",
            filetypes=[
                ("Word 和 PDF", "*.doc *.docx *.pdf"),
                ("PDF", "*.pdf"),
                ("Word", "*.doc *.docx"),
            ],
        )
        if selected:
            attachment_paths = tuple(Path(path) for path in selected)
            attachments_var.set(f"已选择 {len(attachment_paths)} 个")

    ttk.Label(panel, text="封面图片").grid(row=5, column=0, sticky="w", pady=5)
    cover_actions = ttk.Frame(panel)
    cover_actions.grid(row=5, column=1, sticky="w", pady=5)
    ttk.Button(cover_actions, text="选择封面", command=choose_cover).grid(row=0, column=0)
    ttk.Button(cover_actions, text="粘贴封面", command=paste_cover).grid(
        row=0, column=1, padx=(6, 0)
    )
    ttk.Label(panel, textvariable=cover_var).grid(row=5, column=2, sticky="w", padx=(10, 0))

    ttk.Label(panel, text="正文图片").grid(row=6, column=0, sticky="w", pady=5)
    image_actions = ttk.Frame(panel)
    image_actions.grid(row=6, column=1, sticky="w", pady=5)
    ttk.Button(image_actions, text="选择图片", command=choose_images).grid(row=0, column=0)
    ttk.Button(image_actions, text="粘贴图片", command=paste_images).grid(
        row=0, column=1, padx=(6, 0)
    )
    ttk.Label(panel, textvariable=images_var).grid(row=6, column=2, sticky="w", padx=(10, 0))

    ttk.Label(panel, text="文章附件").grid(row=7, column=0, sticky="w", pady=5)
    ttk.Button(panel, text="选择附件", command=choose_attachments).grid(
        row=7, column=1, sticky="w", pady=5
    )
    ttk.Label(panel, textvariable=attachments_var).grid(row=7, column=2, sticky="w", padx=(10, 0))

    template_frame = ttk.LabelFrame(panel, text="正文模板（可多选）", padding=(10, 7))
    template_frame.grid(
        row=8, column=0, columnspan=3, sticky="ew", pady=(12, 4)
    )
    for index, (key, label, _template) in enumerate(CONTENT_TEMPLATE_OPTIONS):
        ttk.Checkbutton(
            template_frame,
            text=label,
            variable=template_vars[key],
        ).grid(
            row=index // 3,
            column=index % 3,
            sticky="w",
            padx=(0, 22),
            pady=3,
        )

    ttk.Checkbutton(
        panel,
        text="创建后打开文章和资源文件夹",
        variable=open_var,
    ).grid(row=9, column=0, columnspan=3, sticky="w", pady=(10, 8))

    def close_window() -> None:
        clipboard_temp.cleanup()
        root.destroy()

    def create_post() -> None:
        try:
            result = build_post(
                title=title_var.get(),
                categories=split_values(category_var.get()),
                tags=split_values(tags_var.get()),
                cover=cover_path,
                body_images=body_paths,
                attachments=attachment_paths,
                content_templates=[
                    key for key, variable in template_vars.items() if variable.get()
                ],
            )
        except (OSError, ValueError) as error:
            messagebox.showerror("无法创建文章", str(error), parent=root)
            return

        post_path, image_dir, attachment_dir, note = result
        if open_var.get():
            open_result(post_path, image_dir, attachment_dir)

        summary = f"文章已创建：\n{post_path}\n\n图片目录：\n{image_dir}"
        if attachment_dir:
            summary += f"\n\n附件目录：\n{attachment_dir}"
        if note:
            summary += f"\n\n{note}"
        messagebox.showinfo("创建完成", summary, parent=root)
        close_window()

    controls = ttk.Frame(panel)
    controls.grid(row=10, column=0, columnspan=3, sticky="e", pady=(12, 0))
    ttk.Button(controls, text="取消", command=close_window).grid(row=0, column=0, padx=(0, 8))
    ttk.Button(controls, text="创建文章", command=create_post).grid(row=0, column=1)

    root.protocol("WM_DELETE_WINDOW", close_window)
    title_entry.focus_set()
    root.mainloop()
    clipboard_temp.cleanup()
    return 0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Create a Chirpy blog post and its assets.")
    parser.add_argument("--title")
    parser.add_argument("--categories", default="随笔")
    parser.add_argument("--tags", default="")
    parser.add_argument(
        "--templates",
        default="",
        help="Comma-separated templates: headings, code, table, steps, prompt, quote",
    )
    parser.add_argument("--no-open", action="store_true")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if not args.title:
        return launch_gui()

    post_path, image_dir, attachment_dir, note = build_post(
        title=args.title,
        categories=split_values(args.categories),
        tags=split_values(args.tags),
        content_templates=split_values(args.templates),
    )
    print(f"文章：{post_path}")
    print(f"图片：{image_dir}")
    if attachment_dir:
        print(f"附件：{attachment_dir}")
    if note:
        print(note)
    if not args.no_open:
        open_result(post_path, image_dir, attachment_dir)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
