#!/usr/bin/env python3
import argparse
import json
import shutil
from pathlib import Path

from PIL import Image


def is_bg(px):
    r, g, b, a = px
    return a > 0 and g >= 120 and r <= 120 and b <= 120


def bbox_non_bg(im):
    pix = im.load()
    xs = []
    ys = []
    w, h = im.size
    for y in range(h):
        for x in range(w):
            px = pix[x, y]
            if px[3] > 0 and not is_bg(px):
                xs.append(x)
                ys.append(y)
    if not xs:
        return None
    return min(xs), min(ys), max(xs) + 1, max(ys) + 1


def normalize(src, out, rows, cols):
    im = Image.open(src).convert("RGBA")
    sw, sh = im.size
    cell_w = sw / cols
    cell_h = sh / rows
    target = Image.new("RGBA", (cols * 192, rows * 208), (0, 255, 0, 255))
    frames = []

    for idx in range(rows * cols):
        row = idx // cols
        col = idx % cols
        cell = im.crop(
            (
                round(col * cell_w),
                round(row * cell_h),
                round((col + 1) * cell_w),
                round((row + 1) * cell_h),
            )
        )
        box = bbox_non_bg(cell)
        if box is None:
            frames.append({"frame": idx + 1, "error": "empty"})
            continue

        subject = cell.crop(box)
        scale = min(184 / subject.width, 200 / subject.height, 1.0)
        new_size = (
            max(1, int(subject.width * scale)),
            max(1, int(subject.height * scale)),
        )
        subject = subject.resize(new_size, Image.Resampling.LANCZOS)

        cleaned = Image.new("RGBA", subject.size, (0, 0, 0, 0))
        cleaned.putdata(
            [(0, 0, 0, 0) if is_bg(px) else px for px in subject.getdata()]
        )
        tx = col * 192 + (192 - cleaned.width) // 2
        ty = row * 208 + (208 - cleaned.height) // 2
        target.alpha_composite(cleaned, (tx, ty))
        frames.append(
            {
                "frame": idx + 1,
                "placed": [tx, ty, tx + cleaned.width, ty + cleaned.height],
            }
        )

    target = Image.alpha_composite(
        Image.new("RGBA", target.size, (0, 255, 0, 255)), target
    )
    target.save(out)
    return {
        "source": str(src),
        "source_size": list(im.size),
        "output": str(out),
        "output_size": list(target.size),
        "rows": rows,
        "cols": cols,
        "frames": frames,
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--out-dir", required=True)
    parser.add_argument("--pet-name", default="")
    parser.add_argument("--focus", required=True)
    parser.add_argument("--merit", required=True)
    parser.add_argument("--rhythm", required=True)
    args = parser.parse_args()

    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    pet_name = args.pet_name or out_dir.name
    specs = [
        ("focus", Path(args.focus), f"{pet_name}-\u4e13\u6ce8\u6a21\u5f0f.png", 1, 4),
        ("merit", Path(args.merit), f"{pet_name}-\u529f\u5fb7\u6a21\u5f0f.png", 1, 4),
        ("rhythm", Path(args.rhythm), f"{pet_name}-\u97f3\u4e50\u5f8b\u52a8.png", 2, 4),
    ]
    reports = []
    for label, src, out_name, rows, cols in specs:
        shutil.copy2(src, out_dir / f"{label}_source.png")
        reports.append(normalize(src, out_dir / out_name, rows, cols))
    print(json.dumps(reports, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
