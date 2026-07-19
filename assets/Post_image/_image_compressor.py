from __future__ import annotations

import argparse
import sys
from pathlib import Path

try:
    from PIL import Image, ImageOps, UnidentifiedImageError
except ImportError:
    print("[无法运行] 缺少 Pillow 图片处理组件。")
    print("请执行：python -m pip install Pillow")
    raise SystemExit(2)


ARCHIVE_DIR_NAME = "A_原图"
SUPPORTED_EXTENSIONS = {".jpg", ".jpeg", ".jfif", ".png", ".bmp", ".tif", ".tiff"}
QUALITY_STEPS = (84, 80, 76, 72, 68, 64, 60)
MAX_WIDTH = 1920


def format_size(size: int) -> str:
    if size >= 1024 * 1024:
        return f"{size / 1024 / 1024:.2f} MB"
    return f"{size / 1024:.0f} KB"


def output_image_mode(image: Image.Image) -> Image.Image:
    if image.mode in {"RGBA", "LA"}:
        return image.convert("RGBA")
    if image.mode == "P" and "transparency" in image.info:
        return image.convert("RGBA")
    return image.convert("RGB")


def resize_for_blog(image: Image.Image) -> tuple[Image.Image, bool]:
    if image.width <= MAX_WIDTH:
        return image, False

    target_height = max(1, round(image.height * MAX_WIDTH / image.width))
    resampling = getattr(Image, "Resampling", Image).LANCZOS
    return image.resize((MAX_WIDTH, target_height), resampling), True


def unique_archive_target(archive_dir: Path, source: Path) -> Path:
    candidate = archive_dir / f"{source.stem}_原图{source.suffix}"
    number = 2
    while candidate.exists():
        candidate = archive_dir / f"{source.stem}_原图_{number}{source.suffix}"
        number += 1
    return candidate


def collect_sources(root: Path, archive_root: Path) -> list[Path]:
    files: list[Path] = []
    resolved_archive = archive_root.resolve()

    for path in root.rglob("*"):
        if not path.is_file() or path.suffix.casefold() not in SUPPORTED_EXTENSIONS:
            continue

        try:
            path.resolve().relative_to(resolved_archive)
            continue
        except ValueError:
            pass

        files.append(path)

    return sorted(files, key=lambda item: str(item).casefold())


def compress_one(source: Path, root: Path, archive_root: Path) -> tuple[str, int, int]:
    output = source.with_suffix(".webp")
    relative = source.relative_to(root)

    if output.exists():
        print(f"[跳过] {relative}：同名 WebP 已存在")
        return "skipped", 0, 0

    temp_output = source.parent / f".{source.stem}.webp.tmp"
    temp_output.unlink(missing_ok=True)
    source_size = source.stat().st_size
    resized = False

    try:
        with Image.open(source) as opened:
            if getattr(opened, "is_animated", False) and getattr(opened, "n_frames", 1) > 1:
                print(f"[跳过] {relative}：动画图片不会自动转换")
                return "skipped", 0, 0

            image = ImageOps.exif_transpose(opened)
            image.load()
            image = output_image_mode(image)
            image, resized = resize_for_blog(image)

            for quality in QUALITY_STEPS:
                image.save(temp_output, format="WEBP", quality=quality, method=6)
                if temp_output.stat().st_size < source_size:
                    break

        output_size = temp_output.stat().st_size
        if output_size >= source_size:
            temp_output.unlink(missing_ok=True)
            print(f"[跳过] {relative}：转换后没有变小，已保留原文件")
            return "skipped", 0, 0

        archive_dir = archive_root / relative.parent
        archive_dir.mkdir(parents=True, exist_ok=True)
        archive_target = unique_archive_target(archive_dir, source)

        temp_output.replace(output)
        try:
            source.replace(archive_target)
        except OSError:
            output.unlink(missing_ok=True)
            raise

        saving = 100 * (1 - output_size / source_size)
        resize_note = "，宽度已缩至 1920px" if resized else ""
        print(
            f"[完成] {relative} -> {output.name} "
            f"({format_size(source_size)} -> {format_size(output_size)}，减少 {saving:.1f}%{resize_note})"
        )
        return "converted", source_size, output_size

    except (OSError, UnidentifiedImageError, ValueError) as error:
        temp_output.unlink(missing_ok=True)
        print(f"[失败] {relative}：{error}")
        return "failed", 0, 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Compress article images to WebP.")
    parser.add_argument(
        "--root",
        type=Path,
        default=Path(__file__).resolve().parent,
        help="Folder to scan; defaults to the script folder.",
    )
    args = parser.parse_args()

    root = args.root.resolve()
    archive_root = root / ARCHIVE_DIR_NAME
    archive_root.mkdir(parents=True, exist_ok=True)
    sources = collect_sources(root, archive_root)

    print("文章图片自动压缩工具")
    print(f"扫描目录：{root}")
    print("输出规则：WebP 保留在原位置，源图片归档到 A_原图")
    print("图片过宽时会等比例缩至 1920px；不会拉伸小图片。")
    print()

    if not sources:
        print("没有发现需要处理的 JPG、PNG、BMP 或 TIFF 图片。")
        return 0

    converted = failed = skipped = 0
    original_total = compressed_total = 0

    for source in sources:
        status, original_size, compressed_size = compress_one(source, root, archive_root)
        if status == "converted":
            converted += 1
            original_total += original_size
            compressed_total += compressed_size
        elif status == "failed":
            failed += 1
        else:
            skipped += 1

    print()
    print(f"处理完成：成功 {converted} 张，跳过 {skipped} 张，失败 {failed} 张。")
    if converted:
        print(
            f"总体积：{format_size(original_total)} -> {format_size(compressed_total)}，"
            f"节省 {format_size(original_total - compressed_total)}。"
        )

    return 1 if failed else 0


if __name__ == "__main__":
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    raise SystemExit(main())
