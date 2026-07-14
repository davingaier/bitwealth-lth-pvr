"""Reconstruct the BitWealth logo + icon as clean hand-built vectors.

- Wordmark: real Aptos Bold outlines (from scripts/_wordmark_paths.svg, font units, Y-up).
- Icon: geometric reconstruction — open navy ring + Bitcoin B skeleton + gold bar chart.

Emits on-dark (white ink) and on-light (navy ink) SVGs, plus a comparison HTML.
"""
import math, re, pathlib

NAVY = "#003F5C"
GOLD_LIGHT = "#FFC933"
GOLD = "#FFB400"
GOLD_DARK = "#E6A200"

# ---------- icon geometry (icon-space viewBox 0 0 128 112) ----------
ICON_W, ICON_H = 128.0, 112.0

# Ring
RCX, RCY, RR, RSW = 46.0, 52.0, 39.0, 11.5
# Opening on the lower-right: ring drawn from a1 -> a2 going counter-clockwise.
# Math angles (deg): 0=east, 90=north(up on screen -> smaller y). Screen y is down.
RING_A_TOP = 64.0    # upper-right end (near 1 o'clock)
RING_A_BOT = -95.0   # lower end (just past 6 o'clock)

def pt(cx, cy, r, deg):
    a = math.radians(deg)
    return (cx + r * math.cos(a), cy - r * math.sin(a))

def ring_path():
    x1, y1 = pt(RCX, RCY, RR, RING_A_TOP)
    x2, y2 = pt(RCX, RCY, RR, RING_A_BOT)
    # sweep from top end, counter-clockwise (the long way) to bottom end.
    # large-arc=1 (covers >180deg), sweep=0 draws counter-clockwise in SVG y-down.
    return f'M {x1:.2f} {y1:.2f} A {RR} {RR} 0 1 0 {x2:.2f} {y2:.2f}'

# Bitcoin B skeleton (icon-space). Uniform thick strokes -> bold monoline B.
BSW = 8.6                 # B stroke width
BX = 31.0                 # stem x
B_TOP, B_BOT = 32.0, 72.0 # body top / bottom (bars)
B_MID = 52.0              # middle bar
BAR_R = 44.0              # x where the horizontal bars reach
BOWL1_MAX = 53.0          # upper bowl bulge right (max x)
BOWL2_MAX = 56.0          # lower bowl bulge right (max x, slightly larger)
PRONG = 7.0               # prong length beyond body
PRONG_XL = BX             # left prong x (on stem)
PRONG_XR = 44.0           # right prong x

def bitcoin_b():
    s = []
    cap = 'stroke-linecap="round" stroke-linejoin="round"'
    # stem
    s.append(f'<line x1="{BX}" y1="{B_TOP}" x2="{BX}" y2="{B_BOT}"/>')
    # three bars
    s.append(f'<line x1="{BX}" y1="{B_TOP}" x2="{BAR_R}" y2="{B_TOP}"/>')
    s.append(f'<line x1="{BX}" y1="{B_MID}" x2="{BAR_R}" y2="{B_MID}"/>')
    s.append(f'<line x1="{BX}" y1="{B_BOT}" x2="{BAR_R}" y2="{B_BOT}"/>')
    # upper bowl: from top-bar end bulge right to middle-bar end
    s.append(f'<path d="M {BAR_R} {B_TOP} C {BOWL1_MAX+4} {B_TOP} {BOWL1_MAX+4} {B_MID} {BAR_R} {B_MID}"/>')
    # lower bowl: from middle-bar end bulge right to bottom-bar end
    s.append(f'<path d="M {BAR_R} {B_MID} C {BOWL2_MAX+4} {B_MID} {BOWL2_MAX+4} {B_BOT} {BAR_R} {B_BOT}"/>')
    # prongs (2 top, 2 bottom)
    s.append(f'<line x1="{PRONG_XL}" y1="{B_TOP-PRONG}" x2="{PRONG_XL}" y2="{B_TOP}"/>')
    s.append(f'<line x1="{PRONG_XR}" y1="{B_TOP-PRONG}" x2="{PRONG_XR}" y2="{B_TOP}"/>')
    s.append(f'<line x1="{PRONG_XL}" y1="{B_BOT}" x2="{PRONG_XL}" y2="{B_BOT+PRONG}"/>')
    s.append(f'<line x1="{PRONG_XR}" y1="{B_BOT}" x2="{PRONG_XR}" y2="{B_BOT+PRONG}"/>')
    return (f'<g fill="none" stroke="INK" stroke-width="{BSW}" {cap}>' + "".join(s) + '</g>')

# Gold bar chart (4 ascending bars), baseline aligned, rounded top corners.
BARS = [  # (x, width, height)
    (64.0, 11.0, 26.0),
    (79.0, 11.0, 42.0),
    (94.0, 11.0, 60.0),
    (109.0, 11.0, 80.0),
]
BAR_BASE = 92.0
BAR_R2 = 2.6

def bars():
    s = []
    for x, w, h in BARS:
        y = BAR_BASE - h
        s.append(f'<rect x="{x}" y="{y:.2f}" width="{w}" height="{h:.2f}" rx="{BAR_R2}" fill="url(#gold)"/>')
    return "".join(s)

GOLD_DEFS = (f'<linearGradient id="gold" x1="0" y1="0" x2="0" y2="1">'
             f'<stop offset="0" stop-color="{GOLD_LIGHT}"/>'
             f'<stop offset="1" stop-color="{GOLD_DARK}"/></linearGradient>')

def icon_inner(ink):
    ring = f'<path d="{ring_path()}" fill="none" stroke="INK" stroke-width="{RSW}" stroke-linecap="round"/>'
    inner = ring + bitcoin_b() + bars()
    return inner.replace("INK", ink)

# ---------- wordmark ----------
WM = pathlib.Path("scripts/_wordmark_paths.svg").read_text()
WM_INNER = re.sub(r'^<g>|</g>$', '', WM)  # per-glyph <path transform=... d=.../>
UPEM = 2048
WM_WIDTH_FU = 9183
CAP_FU = 1346

def wordmark_group(ink, scale, tx, ty):
    # font units Y-up -> flip. Baseline at y=0 in font space.
    return (f'<g transform="translate({tx},{ty}) scale({scale},{-scale})" fill="{ink}">' + WM_INNER + '</g>')

def emit_icon(path, ink):
    svg = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {ICON_W:.0f} {ICON_H:.0f}">' +
           '<defs>' + GOLD_DEFS + '</defs>' + icon_inner(ink) + '</svg>')
    pathlib.Path(path).write_text(svg)

def emit_logo(path, ink):
    # place icon left, wordmark right, cap-height aligned to ~0.60 of icon height
    cap_target = 52.0
    scale = cap_target / CAP_FU
    wm_w = WM_WIDTH_FU * scale
    gap = 20.0
    tx = ICON_W + gap
    # vertical: center cap block on icon centre (RCY). baseline = center + cap/2
    baseline = RCY + cap_target / 2.0
    total_w = tx + wm_w + 4
    svg = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {total_w:.1f} {ICON_H:.0f}">' +
           '<defs>' + GOLD_DEFS + '</defs>' + icon_inner(ink) +
           wordmark_group(ink, scale, tx, baseline) + '</svg>')
    pathlib.Path(path).write_text(svg)

emit_icon("scripts/_recon_icon_ondark.svg", "#FFFFFF")
emit_icon("scripts/_recon_icon_navy.svg", NAVY)
emit_logo("scripts/_recon_logo_ondark.svg", "#FFFFFF")
emit_logo("scripts/_recon_logo_navy.svg", NAVY)

# ---- final deliverables ----
emit_icon("logos/bitwealth_icon_only_ondark.svg", "#FFFFFF")
emit_logo("logos/bitwealth_logo_ondark.svg", "#FFFFFF")
emit_icon("logos/bitwealth_icon_only_navy.svg", NAVY)
emit_logo("logos/bitwealth_logo_navy.svg", NAVY)

# comparison HTML
html = f'''<!DOCTYPE html><html><head><meta charset="utf-8"><style>
body{{margin:0;background:#050A14;font-family:sans-serif;color:#889;padding:30px}}
.row{{display:flex;gap:24px;align-items:center;margin-bottom:30px;flex-wrap:wrap}}
.box{{background:#0A0F1E;border:1px solid #223;border-radius:12px;padding:24px}}
.box.light{{background:#fff}}
img{{display:block}}
.cap{{font-size:12px;margin-top:8px}}
</style></head><body>
<div class="row">
  <div class="box"><img src="_orig_icon.png" style="height:180px"><div class="cap">ORIGINAL icon</div></div>
  <div class="box"><img src="_recon_icon_ondark.svg" style="height:180px"><div class="cap">RECON icon (on-dark)</div></div>
  <div class="box light"><img src="_recon_icon_navy.svg" style="height:180px"><div class="cap">RECON icon (navy)</div></div>
</div>
<div class="row">
  <div class="box"><img src="_orig_logo_flat.png" style="height:120px"><div class="cap">ORIGINAL logo</div></div>
</div>
<div class="row">
  <div class="box"><img src="_recon_logo_ondark.svg" style="height:120px"><div class="cap">RECON logo (on-dark)</div></div>
</div>
<div class="row">
  <div class="box light"><img src="_recon_logo_navy.svg" style="height:120px"><div class="cap">RECON logo (navy)</div></div>
</div>
</body></html>'''
pathlib.Path("scripts/_recon_compare.html").write_text(html)
print("built recon svgs + compare html")
