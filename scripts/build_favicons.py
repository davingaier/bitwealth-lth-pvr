"""Build BitWealth favicons matching the public website nav-bar logo style:
white background, goldenrod (#daa520) border, rounded corners, B-icon centered.

Renders at high resolution then downsamples for crisp small-size results.
"""
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "website" / "images" / "logo.png"
OUT_DIRS = [ROOT / "website" / "favicon", ROOT / "ui" / "favicon"]

GOLD = (218, 165, 32, 255)   # goldenrod
WHITE = (255, 255, 255, 255)
TRANSPARENT = (0, 0, 0, 0)

# Sizes to emit (final px)
SIZES = [16, 32, 48, 180, 192, 512]

# Render-multiplier for supersampling (then downsample with LANCZOS)
SS = 8


def render(size: int) -> Image.Image:
    """Render one favicon at `size` px using SS supersampling."""
    big = size * SS
    # transparent canvas
    img = Image.new("RGBA", (big, big), TRANSPARENT)
    draw = ImageDraw.Draw(img)

    # Border thickness scales with size: ~2px @ 32, ~3px @ 48, ~6px @ 180.
    border = max(1, round(size * 0.07)) * SS
    radius = max(2, round(size * 0.18)) * SS

    # Outer rounded square = goldenrod border
    draw.rounded_rectangle(
        [(0, 0), (big - 1, big - 1)],
        radius=radius,
        fill=GOLD,
    )
    # Inner rounded square = white interior (slightly smaller radius for clean inset)
    inner_radius = max(1, radius - border // 2)
    draw.rounded_rectangle(
        [(border, border), (big - 1 - border, big - 1 - border)],
        radius=inner_radius,
        fill=WHITE,
    )

    # Composite the B icon, scaled to fit the white interior with padding.
    src = Image.open(SRC).convert("RGBA")
    # Trim transparent padding from source so the mark fills the inner box.
    bbox = src.getbbox()
    if bbox:
        src = src.crop(bbox)
    pad = max(1, round(size * 0.04)) * SS  # tight padding (mark itself has visual weight)
    inner_box = (
        border + pad,
        border + pad,
        big - 1 - border - pad,
        big - 1 - border - pad,
    )
    inner_w = inner_box[2] - inner_box[0]
    inner_h = inner_box[3] - inner_box[1]

    src_resized = src.copy()
    # Scale (up or down) preserving aspect ratio to fit inner_w x inner_h.
    scale = min(inner_w / src_resized.width, inner_h / src_resized.height)
    new_w = max(1, int(round(src_resized.width * scale)))
    new_h = max(1, int(round(src_resized.height * scale)))
    src_resized = src_resized.resize((new_w, new_h), Image.LANCZOS)
    sx = inner_box[0] + (inner_w - src_resized.width) // 2
    sy = inner_box[1] + (inner_h - src_resized.height) // 2
    img.alpha_composite(src_resized, dest=(sx, sy))

    # Downsample to target size
    return img.resize((size, size), Image.LANCZOS)


def main() -> None:
    for d in OUT_DIRS:
        d.mkdir(parents=True, exist_ok=True)

    rendered = {s: render(s) for s in SIZES}

    for d in OUT_DIRS:
        for s, img in rendered.items():
            img.save(d / f"favicon-{s}x{s}.png", optimize=True)
        # Also write a multi-size .ico for legacy browsers
        ico_sizes = [(16, 16), (32, 32), (48, 48)]
        rendered[48].save(
            d / "favicon.ico",
            format="ICO",
            sizes=ico_sizes,
        )

    print("Wrote favicons to:")
    for d in OUT_DIRS:
        for f in sorted(d.iterdir()):
            print(f"  {f.relative_to(ROOT)}  ({f.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
