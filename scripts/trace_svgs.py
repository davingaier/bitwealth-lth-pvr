"""Trace the on-dark PNG logo + icon into true vector SVGs with vtracer.
Sources are upscaled first for smoother curves.
"""
import vtracer
from PIL import Image

JOBS = [
    ("logos/bitwealth_logo_ondark_cropped.png", 3, "logos/bitwealth_logo_ondark.svg"),
    ("logos/bitwealth_icon_only_ondark_512x512.png", 6, "logos/bitwealth_icon_only_ondark.svg"),
]

for src, scale, svg_out in JOBS:
    im = Image.open(src).convert("RGBA")
    up = im.resize((im.width * scale, im.height * scale), Image.LANCZOS)
    tmp = svg_out + ".tmp.png"
    up.save(tmp)
    vtracer.convert_image_to_svg_py(
        tmp, svg_out,
        colormode="color",
        hierarchical="stacked",
        mode="spline",
        filter_speckle=4,
        color_precision=7,
        layer_difference=16,
        corner_threshold=60,
        length_threshold=4.0,
        splice_threshold=45,
        path_precision=8,
    )
    print("traced", src, "->", svg_out, "at", up.size)
