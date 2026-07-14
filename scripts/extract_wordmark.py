"""Extract the 'BitWealth' wordmark as a single SVG path from Aptos Bold,
using HarfBuzz shaping (correct kerning) + fontTools outlines.

Outputs (font units, Y-up):
  scripts/_wordmark_path.txt  -> the 'd' attribute
Prints metrics needed to place/scale it in the final SVG.
"""
import uharfbuzz as hb
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen

FONT = r"C:/Users/davin/AppData/Local/Microsoft/FontCache/4/CloudFonts/Aptos/32483553004.ttf"  # Aptos Bold
TEXT = "BitWealth"

# --- shape with HarfBuzz ---
with open(FONT, "rb") as f:
    data = f.read()
face = hb.Face(data)
font = hb.Font(face)
upem = face.upem
buf = hb.Buffer()
buf.add_str(TEXT)
buf.guess_segment_properties()
hb.shape(font, buf, {"kern": True, "liga": True})
infos = buf.glyph_infos
poss = buf.glyph_positions

# --- outlines with fontTools ---
tt = TTFont(FONT)
glyphset = tt.getGlyphSet()
gorder = tt.getGlyphOrder()

parts = []
cursor = 0
for info, pos in zip(infos, poss):
    gid = info.codepoint
    gname = gorder[gid]
    pen = SVGPathPen(glyphset)
    glyphset[gname].draw(pen)
    d = pen.getCommands()
    x = cursor + pos.x_offset
    y = pos.y_offset
    if d:
        parts.append(f'<path transform="translate({x},{y})" d="{d}"/>')
    cursor += pos.x_advance

total_w = cursor

# Cap height / ascender from OS/2 & hhea
os2 = tt["OS/2"]
cap = getattr(os2, "sCapHeight", 0) or 0
asc = tt["hhea"].ascent
desc = tt["hhea"].descent

with open("scripts/_wordmark_paths.svg", "w") as f:
    f.write(f'<g>{"".join(parts)}</g>')

print("upem", upem, "total_width", total_w, "cap", cap, "asc", asc, "desc", desc, "nglyphs", len(infos))
