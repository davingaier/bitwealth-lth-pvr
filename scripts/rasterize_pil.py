"""Rasterize the reconstructed logo/icon to transparent PNGs with PIL,
reusing the exact geometry from build_logo_svgs and the Aptos Bold font
for the wordmark. No Cairo needed.
"""
import math
from PIL import Image, ImageDraw, ImageFont
import build_logo_svgs as B  # geometry constants + helpers

S = 9  # supersample scale (icon 128*9 = 1152 px wide)
APTOS_BOLD = r"C:/Users/davin/AppData/Local/Microsoft/FontCache/4/CloudFonts/Aptos/32483553004.ttf"
WHITE = (255, 255, 255, 255)
NAVY = (0, 63, 92, 255)

def hexrgb(h):
    h = h.lstrip('#'); return (int(h[0:2],16), int(h[2:4],16), int(h[4:6],16))

def rcap_line(d, p0, p1, w, fill):
    d.line([p0, p1], fill=fill, width=int(round(w)))
    r = w/2
    for (x,y) in (p0,p1):
        d.ellipse([x-r,y-r,x+r,y+r], fill=fill)

def right_half_arc(d, cx, cy, rx, ry, w, fill):
    # thick arc: draw as many line segments so round caps/width are clean
    pts=[]
    for i in range(0,181):
        a=math.radians(-90+i)  # -90(top)->0(right)->90(bottom)
        pts.append((cx+rx*math.cos(a), cy+ry*math.sin(a)))
    for i in range(len(pts)-1):
        d.line([pts[i],pts[i+1]], fill=fill, width=int(round(w)))
    r=w/2
    for (x,y) in (pts[0],pts[-1]):
        d.ellipse([x-r,y-r,x+r,y+r], fill=fill)

def draw_bars(img):
    gl=hexrgb(B.GOLD_LIGHT); gd=hexrgb(B.GOLD_DARK)
    for x,w,h in B.BARS:
        x0,y0=x*S,(B.BAR_BASE-h)*S; w0,h0=w*S,h*S
        grad=Image.new('RGBA',(int(w0),int(h0)))
        gp=grad.load()
        for j in range(int(h0)):
            t=j/max(1,int(h0)-1)
            c=(int(gl[0]+(gd[0]-gl[0])*t),int(gl[1]+(gd[1]-gl[1])*t),int(gl[2]+(gd[2]-gl[2])*t),255)
            for i in range(int(w0)): gp[i,j]=c
        mask=Image.new('L',(int(w0),int(h0)),0)
        md=ImageDraw.Draw(mask); md.rounded_rectangle([0,0,int(w0)-1,int(h0)-1],radius=B.BAR_R2*S,fill=255)
        img.paste(grad,(int(x0),int(y0)),mask)

def draw_icon(ink, W, H):
    img=Image.new('RGBA',(int(W*S),int(H*S)),(0,0,0,0))
    d=ImageDraw.Draw(img)
    # ring
    cx,cy,rr=B.RCX*S,B.RCY*S,B.RR*S; rw=B.RSW*S
    d.arc([cx-rr,cy-rr,cx+rr,cy+rr], start=95, end=296, fill=ink, width=int(round(rw)))
    for deg in (B.RING_A_TOP,B.RING_A_BOT):
        px=B.RCX+B.RR*math.cos(math.radians(deg)); py=B.RCY-B.RR*math.sin(math.radians(deg))
        r=rw/2; d.ellipse([px*S-r,py*S-r,px*S+r,py*S+r],fill=ink)
    # B skeleton
    bw=B.BSW*S
    rcap_line(d,(B.BX*S,B.B_TOP*S),(B.BX*S,B.B_BOT*S),bw,ink)          # stem
    for yy in (B.B_TOP,B.B_MID,B.B_BOT):
        rcap_line(d,(B.BX*S,yy*S),(B.BAR_R*S,yy*S),bw,ink)            # bars
    # bowls (apex x = 0.25*BAR_R + 0.75*ctrl)
    c1=B.BOWL1_MAX+4; apex1=0.25*B.BAR_R+0.75*c1
    right_half_arc(d,B.BAR_R*S,(B.B_TOP+B.B_MID)/2*S,(apex1-B.BAR_R)*S,(B.B_MID-B.B_TOP)/2*S,bw,ink)
    c2=B.BOWL2_MAX+4; apex2=0.25*B.BAR_R+0.75*c2
    right_half_arc(d,B.BAR_R*S,(B.B_MID+B.B_BOT)/2*S,(apex2-B.BAR_R)*S,(B.B_BOT-B.B_MID)/2*S,bw,ink)
    # prongs
    rcap_line(d,(B.PRONG_XL*S,(B.B_TOP-B.PRONG)*S),(B.PRONG_XL*S,B.B_TOP*S),bw,ink)
    rcap_line(d,(B.PRONG_XR*S,(B.B_TOP-B.PRONG)*S),(B.PRONG_XR*S,B.B_TOP*S),bw,ink)
    rcap_line(d,(B.PRONG_XL*S,B.B_BOT*S),(B.PRONG_XL*S,(B.B_BOT+B.PRONG)*S),bw,ink)
    rcap_line(d,(B.PRONG_XR*S,B.B_BOT*S),(B.PRONG_XR*S,(B.B_BOT+B.PRONG)*S),bw,ink)
    draw_bars(img)
    return img

def draw_logo(ink, ink_rgb):
    cap_target=52.0; scale=cap_target/B.CAP_FU; wm_w=B.WM_WIDTH_FU*scale
    tx=B.ICON_W+20.0; baseline=B.RCY+cap_target/2.0; total_w=tx+wm_w+4
    img=draw_icon(ink, total_w, B.ICON_H)
    d=ImageDraw.Draw(img)
    em_px=cap_target*B.UPEM/B.CAP_FU*S   # font size so cap-height == cap_target
    font=ImageFont.truetype(APTOS_BOLD, int(round(em_px)))
    d.text((tx*S, baseline*S), "BitWealth", font=font, fill=ink_rgb, anchor="ls")
    return img

def save(img, path):
    # downsample for antialiasing
    w,h=img.size
    img.resize((max(1,w//S),max(1,h//S)),Image.LANCZOS).save(path)

# on-dark (white)
save(draw_icon(WHITE, B.ICON_W, B.ICON_H), "logos/bitwealth_icon_only_ondark.png")
save(draw_logo(WHITE, WHITE), "logos/bitwealth_logo_ondark.png")
save(draw_logo(WHITE, WHITE), "logos/bitwealth_logo_ondark_cropped.png")
print("rasterized on-dark PNGs")
