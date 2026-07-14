"""Create the on-dark icon by cropping the symbol out of the on-dark lockup.
Detects the transparent gap between the bar-chart symbol and the 'BitWealth'
wordmark, crops the symbol, trims to its bounding box, and saves a new file.
"""
from PIL import Image

SRC = "logos/bitwealth_logo_ondark_cropped.png"
OUT = "logos/bitwealth_icon_ondark_cropped.png"

im = Image.open(SRC).convert("RGBA")
px = im.load()
w, h = im.size

# per-column non-transparent pixel count
col = [sum(1 for y in range(h) if px[x, y][3] > 0) for x in range(w)]
first = next(x for x in range(w) if col[x] > 0)

# find the first run of empty columns (>= gap) after the symbol -> the gap
# before the wordmark.
GAP = max(6, int(w * 0.02))
run = 0
cut = w
for x in range(first, w):
    if col[x] == 0:
        run += 1
        if run >= GAP:
            cut = x - run + 1
            break
    else:
        run = 0

sym = im.crop((0, 0, cut, h))
bbox = sym.getbbox()
sym = sym.crop(bbox)

# add small transparent padding proportional to size
pad = max(2, int(min(sym.size) * 0.06))
out = Image.new("RGBA", (sym.width + 2 * pad, sym.height + 2 * pad), (0, 0, 0, 0))
out.paste(sym, (pad, pad), sym)
out.save(OUT)
print("wrote", OUT, out.size, "cut@", cut)
