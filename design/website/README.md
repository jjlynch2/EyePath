# EyePath website v2: design hand-off

This is the redesign of `docs/index.html` (GitHub Pages) in the EyePath v2 design system. The PNGs are the target and the Markdown gives the measurements, so you can build it without Figma.

- **Figma (view only):** https://www.figma.com/design/dykzd8rugaodx2IbsP9345/Dr-Lynch, page `EyePath · 5 Website (redesign)`.
  - Desktop 1440: node `155:435`.
  - Mobile 390: node `163:987`.
- **Scope:** layout, styling and copy of the marketing page only. The app, server and release workflow are untouched.
- **Keep the page's behaviour and hooks:**
  - The download script: OS detection makes the visitor's platform primary; `#dlMac` and `#dlWin` point to the latest .dmg and .exe; `#version` shows the version.
  - Share buttons (`[data-share]`, "Link copied").
  - `<details>` FAQ answers.
  - The anchors `#how`, `#features`, `#privacy`, `#help`, `#research`, plus a new `#download`.
  - The meta, OG and JSON-LD tags.
  - No cookies or trackers.

## Read in this order

1. [IMPLEMENTATION.md](IMPLEMENTATION.md): phases with acceptance checks.
2. [SECTIONS.md](SECTIONS.md): each section's layout, sizes and final copy.
3. [web.css](web.css): web type tokens, scoped dark mode for the black stages, the light recipe, the button.

## Folder map

| Path | Contents |
| --- | --- |
| `screens/desktop/01…10` | Each section at 1440 (1×) |
| `screens/mobile/01…10` | Each section at 390 (1×) |
| `assets/images/*@2x.png` | Product images exported from Figma at 2×: hero remote (dark), step 1 pairing crop, step 2 connect phone, remote panel (desktop and mobile), Light / Motion / Sound tabs |
| `../assets/icons/phosphor/` | Phosphor icons (MIT). New for the site: apple-logo, windows-logo, github-logo, download-simple, export, lock-simple, cloud-slash, arrows-left-right |
| `../tokens.css` | Design tokens (same as `static/tokens.css`) |

## Design in one paragraph

The hero is the client screen: a black stage where the light glides along a faint horizon with a single fading trail, next to the real dark remote. Below, the page is calm and clinical. Light grey and white sections alternate. There's one header pattern, real app screens are the only imagery, and nothing is boxed for decoration. The features section is one annotated client screen with a numbered key. The page ends with a practical download section (macOS, Windows, source) and a quiet footer.

## Paste into CLAUDE.md

```markdown
## Website v2
- Spec: `design/website/` (README → IMPLEMENTATION → SECTIONS). Target visuals: `design/website/screens/{desktop,mobile}/*.png`;
  compare at 1440 and 390 before finishing each section.
- Use `--ep-*` tokens (docs/tokens.css copied from static/tokens.css) plus `design/website/web.css`. No new colours, fonts or shadows.
- Keep the download/version/share scripts, ids, anchors and meta tags of docs/index.html working.
- Product images: regenerate with tools/media.js from the real app where possible; otherwise use design/website/assets/images.
```
