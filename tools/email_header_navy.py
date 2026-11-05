"""Convert every email template header to a solid navy band with the single on-dark logo (2026-11-05).

Why: two-image light/dark logo swaps are not reliable — new Outlook can *reveal* a hidden image in dark mode but
never *hides* the visible one, and Gmail ignores dark-mode CSS. A navy (#032C48) header with the white logo renders
identically in every client/mode because dark backgrounds and images are left alone by dark-mode rewriters.

Edits are confined to (a) the <style> swap block and (b) the header element that wraps the logo, located by plain
string slicing — no regex replacement is run over whole bodies (see SDD v0.6.185 incident).

Usage:  python tools/email_header_navy.py            # dry run, prints per-template header before/after
        python tools/email_header_navy.py --apply    # PATCH public.email_templates via PostgREST
"""
import json, re, sys, urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ENV = dict(l.split("=", 1) for l in (ROOT / ".env").read_text(encoding="utf-8").splitlines() if "=" in l and not l.startswith("#"))
KEY = ENV["SUPABASE_SERVICE_ROLE_KEY"].strip().strip('"')
URL = "https://wqnmxpooabmedvtackji.supabase.co"
APPLY = "--apply" in sys.argv

NAVY = "#032C48"
DARK_LOGO = f"{URL}/storage/v1/object/public/branding/bitwealth_logo_ondark_cropped.png"
LOGO_IMG = (
    f'<img class="bw-logo" src="{DARK_LOGO}" alt="BitWealth" width="250" '
    'style="width: 250px; height: auto; display: block; margin: 0 auto; border: 0;" />'
)
# Dark-mode rewriters that honour attribute selectors keep the band navy even under full inversion.
HEADER_CSS = (
    "\n    /* Header band stays navy in every client/mode; single on-dark logo (no light/dark swap). */"
    "\n    .bw-hdr { background-color: #032C48 !important; }"
    "\n    [data-ogsc] .bw-hdr, [data-ogsb] .bw-hdr { background-color: #032C48 !important; }"
    "\n    .bw-hdr-text { color: #ffffff !important; }"
    "\n    [data-ogsc] .bw-hdr-text, [data-ogsb] .bw-hdr-text { color: #ffffff !important; }"
    "\n  "
)
OLD_CSS_START = "\n    /* Hosted logo: light by default, dark variant in dark mode."
OLD_CSS_END = "[data-ogsb] .logo-dark { display: block !important; }\n  "

TEXT_TAG = re.compile(r"<(h1|h2|p|span)\b([^>]*)>")
# text colour only — must not touch background-color / border-color declarations
NAVY_TEXT = re.compile(r"(?<![-\w])color:(\s*)#032C48", re.I)
GREY_TEXT = re.compile(r"(?<![-\w])color:(\s*)#(?:4b5563|6b7280|374151|111827|1f2937|333333|333)\b", re.I)


def restyle_header(seg: str) -> str:
    """seg = header open tag through its closing tag. Returns the navy version."""
    open_end = seg.index(">") + 1
    open_tag, inner = seg[:open_end], seg[open_end:]

    for white in ("background-color: #ffffff", "background-color:#ffffff", "background-color: #fff;", "background:#ffffff", "background: #ffffff"):
        if white in open_tag:
            open_tag = open_tag.replace(white, white.replace("#ffffff", NAVY).replace("#fff;", NAVY + ";"), 1)
            break
    else:
        raise ValueError("header has no white background: " + open_tag)
    open_tag = NAVY_TEXT.sub(r"color:\1#ffffff", open_tag)
    # drop the legacy "header" class: its <style> rules force navy text / white background in light mode
    if 'class="header"' in open_tag:
        open_tag = open_tag.replace('class="header"', 'class="bw-hdr"', 1)
    elif 'class="' in open_tag:
        open_tag = open_tag.replace('class="', 'class="bw-hdr ', 1)
    else:
        open_tag = open_tag.replace("<td ", '<td class="bw-hdr" ', 1).replace("<div ", '<div class="bw-hdr" ', 1)
    open_tag = open_tag.replace(" style=", f' bgcolor="{NAVY}" style=', 1)

    # Logo pair -> single on-dark logo.
    light = re.search(r'<img class="logo-light"[^>]*>', inner)
    dark = re.search(r'<img class="logo-dark"[^>]*>', inner)
    if not light or not dark:
        raise ValueError("logo pair not found in header")
    inner = inner[: light.start()] + LOGO_IMG + inner[dark.end():]

    # Header text: navy/grey -> white, and tag with the dark-mode-safe class.
    inner = NAVY_TEXT.sub(r"color:\1#ffffff", inner)
    inner = GREY_TEXT.sub(r"color:\1#e5e7eb", inner)

    def tag(m):
        name, attrs = m.group(1), m.group(2)
        if 'class="' in attrs:
            attrs = attrs.replace('class="', 'class="bw-hdr-text ', 1)
        else:
            attrs = ' class="bw-hdr-text"' + attrs
        return f"<{name}{attrs}>"

    inner = TEXT_TAG.sub(tag, inner)
    out = open_tag + inner
    if "#ffffff" in open_tag.split("style=")[1].split("background")[1][:12] or NAVY not in open_tag:
        raise ValueError("header background not navy: " + open_tag)
    return out


def convert(body: str) -> str:
    # 1. swap CSS block -> header CSS (exactly one block expected)
    a = body.find(OLD_CSS_START)
    if a < 0:
        raise ValueError("swap CSS block missing")
    b = body.index(OLD_CSS_END, a) + len(OLD_CSS_END)
    body = body[:a] + HEADER_CSS + body[b:]
    if body.count(HEADER_CSS) != 1 or "logo-dark { display" in body:
        raise ValueError("css replacement went wrong")

    # 2. header element = nearest <td or <div class="header" opening before the light logo
    p = body.index('<img class="logo-light"')
    td, dv = body.rfind("<td", 0, p), body.rfind('<div class="header"', 0, p)
    if td < 0 and dv < 0:
        raise ValueError("no header element before logo")
    if dv > td:
        start, close = dv, "</div>"
    else:
        start, close = td, "</td>"
    end = body.index(close, p) + len(close)
    seg = body[start:end]
    if seg.count("<td") > 1 and close == "</td>":
        raise ValueError("nested td inside header segment")
    new_seg = restyle_header(seg)
    out = body[:start] + new_seg + body[end:]

    # sanity: everything outside the header and style block untouched, logos consistent
    assert out.count("<img") == body.count("<img") - 1
    assert out.count("logo-light") == 0 and out.count("logo-dark") == 0
    assert out.count('class="bw-logo"') == 1
    assert out[end + (len(new_seg) - len(seg)):] == body[end:]
    return out


def fetch():
    req = urllib.request.Request(f"{URL}/rest/v1/email_templates?select=template_key,body_html&order=template_key",
                                 headers={"apikey": KEY, "Authorization": f"Bearer {KEY}"})
    return json.load(urllib.request.urlopen(req))


def patch(key, body):
    data = json.dumps({"body_html": body}).encode()
    req = urllib.request.Request(f"{URL}/rest/v1/email_templates?template_key=eq.{key}", data=data, method="PATCH",
                                 headers={"apikey": KEY, "Authorization": f"Bearer {KEY}", "Content-Type": "application/json", "Prefer": "return=minimal"})
    urllib.request.urlopen(req).read()


def main():
    rows = fetch()
    done = skipped = 0
    for r in rows:
        key, body = r["template_key"], r["body_html"]
        if '<img class="logo-light"' not in body:
            print(f"-- {key}: no logo pair, skipped")
            skipped += 1
            continue
        new = convert(body)
        p = new.index('class="bw-hdr')
        s = new.rfind("<", 0, p)
        e = new.index("</td>" if new[s:s + 3] == "<td" else "</div>", p)
        print(f"== {key}\n{re.sub(r'\\s+', ' ', new[s:e + 6])}\n")
        if APPLY:
            patch(key, new)
        done += 1
    print(f"{'applied' if APPLY else 'dry run'}: {done} converted, {skipped} skipped")


if __name__ == "__main__":
    main()
