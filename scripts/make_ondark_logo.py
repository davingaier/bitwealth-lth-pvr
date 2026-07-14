"""Generate an on-dark logo variant: transparent background with the navy
elements recoloured to white, gold bars preserved. Also emits a tightly
cropped version. Source: logos/bitwealth_logo_transparent.png
"""
from PIL import Image

SRC = "logos/bitwealth_logo_transparent.png"
OUT_FULL = "logos/bitwealth_logo_ondark.png"
OUT_CROP = "logos/bitwealth_logo_ondark_cropped.png"

img = Image.open(SRC).convert("RGBA")
px = img.load()
w, h = img.size

for y in range(h):
    for x in range(w):
        r, g, b, a = px[x, y]
        if a == 0:
            continue
        # Gold-ish elements have R > G (warm); navy/dark elements have R <= G.
        # Recolour only the navy/dark elements to white, keep gold, keep alpha.
        if r <= g:
            px[x, y] = (255, 255, 255, a)

# Save full (padded) version.
img.save(OUT_FULL)

# Tightly crop to the non-transparent bounding box.
bbox = img.getbbox()
img.crop(bbox).save(OUT_CROP)

print("wrote", OUT_FULL, "and", OUT_CROP, "crop bbox", bbox)
