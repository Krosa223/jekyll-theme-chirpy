from __future__ import annotations

import json
import re
import subprocess
from datetime import datetime, timedelta, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
BLOG_TIMEZONE = timezone(timedelta(hours=8))
POST_PATHSPEC = "_posts"
COVER_NAMES = ("cover.webp", "cover.jpg", "cover.jpeg", "cover.png")


def staged_posts(diff_filter: str) -> set[Path]:
    result = subprocess.run(
        [
            "git",
            "diff",
            "--cached",
            "--name-only",
            "-z",
            f"--diff-filter={diff_filter}",
            "--",
            POST_PATHSPEC,
        ],
        cwd=ROOT,
        check=True,
        capture_output=True,
    )

    paths: set[Path] = set()
    for item in result.stdout.split(b"\0"):
        if not item:
            continue
        path = ROOT / item.decode("utf-8")
        if path.suffix.casefold() in {".md", ".markdown"} and path.is_file():
            paths.add(path)
    return paths


def front_matter_bounds(lines: list[str]) -> tuple[int, int] | None:
    if not lines or lines[0].strip() != "---":
        return None

    for index, line in enumerate(lines[1:], start=1):
        if line.strip() == "---":
            return 1, index
    return None


def field_index(lines: list[str], start: int, end: int, name: str) -> int | None:
    pattern = re.compile(rf"^{re.escape(name)}\s*:")
    for index in range(start, end):
        if pattern.match(lines[index]):
            return index
    return None


def field_value(lines: list[str], start: int, end: int, name: str) -> str | None:
    index = field_index(lines, start, end, name)
    if index is None:
        return None
    return lines[index].split(":", 1)[1].strip().strip("\"'")


def set_publish_time(lines: list[str], start: int, end: int, published_at: str) -> bool:
    date_line = f"date: {published_at}"
    index = field_index(lines, start, end, "date")
    if index is not None:
        if lines[index] == date_line:
            return False
        lines[index] = date_line
        return True

    title_index = field_index(lines, start, end, "title")
    lines.insert((title_index + 1) if title_index is not None else start, date_line)
    return True


def find_cover(media_subpath: str) -> Path | None:
    media_dir = ROOT / media_subpath.lstrip("/")
    if not media_dir.is_dir():
        return None

    names = {path.name.casefold(): path for path in media_dir.iterdir() if path.is_file()}
    for candidate in COVER_NAMES:
        if candidate in names:
            return names[candidate]
    return None


def add_cover_metadata(lines: list[str], start: int, end: int) -> tuple[bool, str | None]:
    if field_index(lines, start, end, "image") is not None:
        return False, None

    media_subpath = field_value(lines, start, end, "media_subpath")
    if not media_subpath:
        return False, None

    cover = find_cover(media_subpath)
    if cover is None:
        return False, None

    title = field_value(lines, start, end, "title") or "文章封面"
    media_index = field_index(lines, start, end, "media_subpath")
    insert_at = (media_index + 1) if media_index is not None else end
    lines[insert_at:insert_at] = [
        "image:",
        f"  path: {cover.name}",
        f"  alt: {json.dumps(title, ensure_ascii=False)}",
    ]
    return True, cover.name


def remove_duplicate_cover(lines: list[str], front_end: int, cover_name: str) -> bool:
    image_pattern = re.compile(r"^!\[[^\]]*\]\(([^)]+)\)\s*$")
    for index in range(front_end + 1, len(lines)):
        if not lines[index].strip():
            continue

        match = image_pattern.match(lines[index].strip())
        if not match or Path(match.group(1)).name.casefold() != cover_name.casefold():
            return False

        del lines[index]
        if index < len(lines) and not lines[index].strip():
            del lines[index]
        return True
    return False


def prepare_post(path: Path, is_new: bool, published_at: str) -> list[str]:
    original = path.read_text(encoding="utf-8")
    newline = "\r\n" if "\r\n" in original else "\n"
    ends_with_newline = original.endswith(("\n", "\r"))
    lines = original.splitlines()
    bounds = front_matter_bounds(lines)
    if bounds is None:
        return ["缺少有效的 YAML 文章头，已跳过"]

    start, end = bounds
    messages: list[str] = []
    if is_new and set_publish_time(lines, start, end, published_at):
        messages.append(f"发布时间：{published_at}")
        bounds = front_matter_bounds(lines)
        assert bounds is not None
        start, end = bounds

    cover_added, cover_name = add_cover_metadata(lines, start, end)
    if cover_added and cover_name:
        messages.append(f"文章封面：{cover_name}")
        bounds = front_matter_bounds(lines)
        assert bounds is not None
        _, end = bounds
        if remove_duplicate_cover(lines, end, cover_name):
            messages.append("已移除正文中重复的封面图片")

    updated = newline.join(lines) + (newline if ends_with_newline else "")
    if updated != original:
        path.write_text(updated, encoding="utf-8", newline="")
    return messages


def main() -> int:
    new_posts = staged_posts("A")
    changed_posts = staged_posts("ACM")
    if not changed_posts:
        print("没有需要补充发布信息的新文章。")
        return 0

    published_at = datetime.now(BLOG_TIMEZONE).strftime("%Y-%m-%d %H:%M:%S %z")
    for path in sorted(changed_posts):
        messages = prepare_post(path, path in new_posts, published_at)
        for message in messages:
            print(f"[文章] {path.name}：{message}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
