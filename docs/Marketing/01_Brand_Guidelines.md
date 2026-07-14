# BitWealth — Brand Guidelines

**Version 1.0** · A visual companion is available in [BitWealth_Brand_Guide.html](BitWealth_Brand_Guide.html).

---

## 1. Logo

The BitWealth mark combines a Bitcoin “B” with an ascending bar chart inside an open
arc — signalling disciplined, data-driven wealth accumulation. Always use the supplied
artwork. Never recreate, redraw, or re-typeset the mark.

### Variants (in `assets/logos/`, full set in repo `/logos`)

| Variant | Use on | Files |
|---------|--------|-------|
| Primary — full lockup | Light / white backgrounds | `bitwealth_logo_transparent_cropped.png`, `.svg` |
| On-dark — transparent lockup | Dark / navy / photographic backgrounds | `bitwealth_logo_ondark_cropped.png`, `bitwealth_logo_ondark.png` |
| Icon / app mark | Favicons, avatars, app tiles, small spaces | `Website & UI Icons/bitwealth_icon_only_*.png` |
| Icon + name | Where a compact badge with the name is needed | `bitwealth (with name)_icon_*.png` |

Prefer the **SVG** files wherever the medium supports them (web, vector print) so the
mark stays crisp at any size.

### Clear space & minimum size

- Maintain clear space around the logo equal to at least the height of the icon glyph.
- Minimum on-screen icon height: **24 px**. Minimum full-lockup height: **28 px**.

### Do

- Use the on-dark (transparent, light-text) lockup on dark/navy and photographic backgrounds.
- Use the transparent lockup on white or very light backgrounds.
- Scale proportionally, ideally from the SVG.

### Don't

- Recolour, add gradients, shadows, or outlines to the mark.
- Stretch, rotate, skew, or crop the lockup.
- Place the transparent logo on low-contrast or busy backgrounds.
- Recreate the wordmark in a different typeface.

---

## 2. Colour palette

Deep navy conveys trust and stability; gold signals value and premium quality. Navy and
near-black tones anchor backgrounds; **gold is reserved for emphasis, calls-to-action,
and the brand accent** — used sparingly for maximum impact.

### Core brand

| Name | HEX | Role |
|------|-----|------|
| Primary Dark | `#003F5C` | Wordmark, headings, anchors |
| Primary Blue | `#0A4A6E` | Gradient partner, panels |
| Gold | `#FFB400` | Brand accent, CTAs |
| Gold Light | `#FFC933` | Gradient highlight |
| Gold Dark | `#E6A200` | Gradient shadow, hover states |

### Backgrounds & surfaces

| Name | HEX | Role |
|------|-----|------|
| BG Dark | `#0A0F1E` | Page background |
| BG Darker | `#050A14` | Deep sections |
| Card | `#151B2E` | Cards, panels |

### Text

| Name | HEX | Role |
|------|-----|------|
| Text Primary | `#FFFFFF` | Headlines, body on dark |
| Text Secondary | `#A8B2D1` | Body copy, subtitles |
| Text Tertiary | `#6B7896` | Captions, muted labels |

### Signature gradients

- **Gold gradient:** `linear-gradient(135deg, #E6A200, #FFB400, #FFC933)` — buttons, gradient text.
- **Accent gradient:** `linear-gradient(135deg, #003F5C, #FFB400)` — hero and feature accents.

---

## 3. Typography

**Inter** is the single brand typeface across all digital and print materials — a clean,
highly legible grotesque. It is free and open-source (Google Fonts / SIL Open Font License).

| Weight | Use |
|--------|-----|
| ExtraBold 800 | Display, H1 |
| Bold 700 | Headings |
| SemiBold 600 | Subheads, buttons |
| Regular 400 | Body |
| Light 300 | Large intros |

**Web fallback stack:**
`'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`

Body line-height ~1.6; headings ~1.2. Left-align body copy; centre only short headings
and hero text.

---

## 4. Applying the brand

- Default to **dark UI**: near-black/navy backgrounds with white and light-blue text.
- Use gold for a **single** primary action per view; secondary actions are subtle
  outlined/ghost styles.
- Cards and panels use the Card surface (`#151B2E`) with a 1 px light border
  (`rgba(255,255,255,0.1)`) and ~12–16 px corner radius.
- Charts: gold `#FFB400` for the BitWealth series; use green `#10B981` / red `#EF4444`
  only for buy/sell or positive/negative semantics.
