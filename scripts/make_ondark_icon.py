"""Build a clean on-dark icon from the 512px icon source.

The 512px icon_only export contains a stray detached 'E' glyph to the right
of the bars (an export artifact). We detect the vertical gap of empty columns
after the main icon cluster, crop it out, recolour the navy elements to white
(keeping gold), then tightly crop.
"""
from PIL import Image

SRC = "logos/Android & PWA Icons/bitwealth_icon_only_512x512.png"
OUT = "logos/bitwealth_icon_only_ondark_512x512.png"

im = Image.open(SRC).convert("RGBA")
px = im.load()
w, h = im.size

# Per-column non-transparent pixel counts.
col = [sum(1 for y in range(h) if px[x, y][3] > 0) for x in range(w)]

# Walk from the first non-empty column; stop at the first run of >=8 empty
# columns (the gap between the icon and the stray 'E'). Everything after the
# gap is discarded by cropping the right edge there.
first = next(x for x in range(w) if col[x] > 0)
right = w
run = 0
for x in range(first, w):
    if col[x] == 0:
        run += 1
        if run >= 8:
            right = x - run + 1
            break
    else:
        run = 0

# Blank out everything at/after the gap (the stray glyph).
for x in range(right, w):
    for y in range(h):
        if px[x, y][3] > 0:
            px[x, y] = (0, 0, 0, 0)

# Recolour navy/dark elements to white; keep gold; keep alpha.
for y in range(h):
    for x in range(w):
        r, g, b, a = px[x, y]
        if a > 0 and r <= g:
            px[x, y] = (255, 255, 255, a)

bbox = im.getbbox()
im.crop(bbox).save(OUT)

# Preview on dark.
out = Image.open(OUT).convert("RGBA")
bg = Image.new("RGBA", out.size, (5, 10, 20, 255))
Image.alpha_composite(bg, out).convert("RGB").save("scripts/_icon_preview.png")
print("wrote", OUT, "size", out.size, "cropped at col", right)
