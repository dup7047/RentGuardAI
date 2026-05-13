"""
One-off generator for the site favicons.

Reads the master logo from public/logo-mark.png, trims the white background,
pads to square with transparency, and writes:
  app/icon.png          512x512 PNG (modern browsers)
  app/apple-icon.png    180x180 PNG (iOS home screen)
  app/favicon.ico       multi-res ICO 16/32/48 (legacy + direct /favicon.ico)

Run: python3 frontend/scripts/generate-favicons.py
"""
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "public" / "logo-mark.png"
APP = ROOT / "app"


def trim_white(img: Image.Image, threshold: int = 245) -> Image.Image:
    """Return img with near-white border rows/columns removed."""
    rgba = img.convert("RGBA")
    px = rgba.load()
    w, h = rgba.size

    def row_is_white(y: int) -> bool:
        return all(px[x, y][0] >= threshold and px[x, y][1] >= threshold and px[x, y][2] >= threshold for x in range(w))

    def col_is_white(x: int) -> bool:
        return all(px[x, y][0] >= threshold and px[x, y][1] >= threshold and px[x, y][2] >= threshold for y in range(h))

    top = 0
    while top < h and row_is_white(top):
        top += 1
    bottom = h - 1
    while bottom > top and row_is_white(bottom):
        bottom -= 1
    left = 0
    while left < w and col_is_white(left):
        left += 1
    right = w - 1
    while right > left and col_is_white(right):
        right -= 1
    return rgba.crop((left, top, right + 1, bottom + 1))


def to_square_transparent(img: Image.Image, padding_ratio: float = 0.06) -> Image.Image:
    """Center img on a transparent square canvas, replacing near-white with transparent."""
    rgba = img.convert("RGBA")
    px = rgba.load()
    w, h = rgba.size
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if r >= 245 and g >= 245 and b >= 245:
                px[x, y] = (r, g, b, 0)

    side = max(w, h)
    pad = int(side * padding_ratio)
    canvas_side = side + pad * 2
    canvas = Image.new("RGBA", (canvas_side, canvas_side), (0, 0, 0, 0))
    canvas.paste(rgba, ((canvas_side - w) // 2, (canvas_side - h) // 2), rgba)
    return canvas


def main() -> None:
    print(f"Reading {SRC}")
    master = Image.open(SRC)
    trimmed = trim_white(master)
    print(f"  trimmed -> {trimmed.size}")
    square = to_square_transparent(trimmed)
    print(f"  square  -> {square.size}")

    icon = square.resize((256, 256), Image.LANCZOS)
    icon_path = APP / "icon.png"
    icon.save(icon_path, format="PNG", optimize=True, compress_level=9)
    print(f"Wrote {icon_path}  ({icon_path.stat().st_size:,} bytes)")

    apple = square.resize((180, 180), Image.LANCZOS)
    apple_path = APP / "apple-icon.png"
    apple.save(apple_path, format="PNG", optimize=True, compress_level=9)
    print(f"Wrote {apple_path}  ({apple_path.stat().st_size:,} bytes)")

    ico_path = APP / "favicon.ico"
    sizes = [(16, 16), (32, 32), (48, 48)]
    square.save(ico_path, format="ICO", sizes=sizes)
    print(f"Wrote {ico_path}  ({ico_path.stat().st_size:,} bytes)")


if __name__ == "__main__":
    main()
