#!/usr/bin/env python3
"""Render an EAN-13 ISBN barcode and turn it into Chromium fake-camera video."""

from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

L = {
    "0": "0001101",
    "1": "0011001",
    "2": "0010011",
    "3": "0111101",
    "4": "0100011",
    "5": "0110001",
    "6": "0101111",
    "7": "0111011",
    "8": "0110111",
    "9": "0001011",
}
G = {
    "0": "0100111",
    "1": "0110011",
    "2": "0011011",
    "3": "0100001",
    "4": "0011101",
    "5": "0111001",
    "6": "0000101",
    "7": "0010001",
    "8": "0001001",
    "9": "0010111",
}
R = {
    "0": "1110010",
    "1": "1100110",
    "2": "1101100",
    "3": "1000010",
    "4": "1011100",
    "5": "1001110",
    "6": "1010000",
    "7": "1000100",
    "8": "1001000",
    "9": "1110100",
}
PARITY = {
    "0": "LLLLLL",
    "1": "LLGLGG",
    "2": "LLGGLG",
    "3": "LLGGGL",
    "4": "LGLLGG",
    "5": "LGGLLG",
    "6": "LGGGLL",
    "7": "LGLGLG",
    "8": "LGLGGL",
    "9": "LGGLGL",
}


def isbn13_check_digit(body12: str) -> str:
    total = sum(int(d) * (1 if i % 2 == 0 else 3) for i, d in enumerate(body12))
    return str((10 - (total % 10)) % 10)


def encode_ean13(isbn: str) -> str:
    digits = "".join(ch for ch in isbn if ch.isdigit())
    if len(digits) == 12:
        digits += isbn13_check_digit(digits)
    if len(digits) != 13:
        raise SystemExit(f"Need ISBN-13, got {isbn!r}")
    if isbn13_check_digit(digits[:12]) != digits[12]:
        raise SystemExit(f"Invalid ISBN-13 check digit: {digits}")

    first, left, right = digits[0], digits[1:7], digits[7:]
    bits = ["0000000000", "101"]
    for digit, parity in zip(left, PARITY[first]):
        bits.append(L[digit] if parity == "L" else G[digit])
    bits.append("01010")
    for digit in right:
        bits.append(R[digit])
    bits.append("101")
    bits.append("0000000000")
    return "".join(bits), digits


def render_barcode(isbn: str, width: int = 640, height: int = 480) -> Image.Image:
    pattern, digits = encode_ean13(isbn)
    image = Image.new("RGB", (width, height), "white")
    draw = ImageDraw.Draw(image)
    module = 4
    bar_width = len(pattern) * module
    bar_height = 220
    x0 = (width - bar_width) // 2
    y0 = (height - bar_height) // 2 - 20
    for index, bit in enumerate(pattern):
        if bit == "1":
            x = x0 + index * module
            draw.rectangle([x, y0, x + module - 1, y0 + bar_height], fill="black")
    try:
        font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 28)
    except OSError:
        font = ImageFont.load_default()
    label = f"ISBN {digits}"
    bbox = draw.textbbox((0, 0), label, font=font)
    text_w = bbox[2] - bbox[0]
    draw.text(((width - text_w) / 2, y0 + bar_height + 16), label, fill="black", font=font)
    return image


def run_ffmpeg(args: list[str]) -> None:
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        raise SystemExit("ffmpeg is required to build the fake camera video")
    subprocess.run([ffmpeg, "-y", *args], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--isbn", default="9780141439518")
    parser.add_argument("--out-dir", default=str(Path(__file__).parent / "fixtures"))
    args = parser.parse_args()

    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    png = out_dir / "isbn_barcode.png"
    y4m = out_dir / "isbn_barcode.y4m"
    mjpeg = out_dir / "isbn_barcode.mjpeg"

    render_barcode(args.isbn).save(png)

    common = [
        "-loop",
        "1",
        "-i",
        str(png),
        "-t",
        "6",
        "-r",
        "15",
        "-vf",
        "scale=640:480:flags=neighbor",
    ]
    run_ffmpeg([*common, "-pix_fmt", "yuv420p", str(y4m)])
    run_ffmpeg([*common, "-q:v", "2", str(mjpeg)])
    print(png)
    print(y4m)
    print(mjpeg)
    return 0


if __name__ == "__main__":
    sys.exit(main())
