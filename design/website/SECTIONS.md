# Website sections: spec and copy

The reference is the PNGs in `screens/desktop/` (1440) and `screens/mobile/` (390), with the same numbering. Sizes are in CSS px at 1440, and mobile values are in brackets. Type names refer to `web.css` (`--ep-type-web-*`) and `tokens.css` (`--ep-type-*`).

## Global

- **Grid:**
  - Content column 1200 wide, centred, with side gutters `--ep-web-gutter` (120 → 20).
  - Section padding is 120 top and bottom [72].
- **Section backgrounds alternate**, and no two neighbours match:
  - Hero: black stage
  - How it works: white (`--ep-bg-surface`)
  - Remote: grey (`--ep-bg-page`)
  - Light, motion and sound: white
  - Therapy room: grey
  - Privacy: white
  - Setup: grey
  - Research: white
  - Download: grey
  - Footer: white, with a 1 px top border
- **Section header pattern, everywhere:**
  - Left-aligned H2 (`web-heading` 44/50, −0.02em) [30/36].
  - Lead `web-lead` 20/30 in `--ep-text-secondary` [17/27], 16 px below the heading [12], max-width 640.
  - The header sits 48–56 px above the content [28–32].
- **Shape:**
  - Media radius 16; phones 34–40 (device corners); controls are pills.
  - Sections are square.
  - Shadows only on phone images (`--ep-shadow-floating`). No shadows on text blocks.
- **Icons:** Phosphor (in `design/assets/icons/phosphor/`), line style, in `--ep-text-accent` or `--ep-text-primary`. Never inside tinted tiles.
- **Do not add:**
  - tinted icon tiles
  - cards around text
  - glowing buttons
  - all-caps labels
  - "→" in links
  - a second copy of the same claim or screen

## 1. Nav (inside the hero)

- **Size:** 88 tall [64].
- **Left:** Logo/Mark 32 [28] in `--ep-accent-default` with "EyePath" in `--ep-type-title`.
- **Right:**
  - Links "How it works", "Features", "Privacy", "Help" and "GitHub" in `--ep-type-label`, `--ep-text-secondary`, 32 apart, followed by "Download" (label-strong, `--ep-text-accent`, jumps to the download section).
  - Mobile shows only the logo and "Download".
- **Anchors:** keep the existing `#how`, `#features`, `#privacy` and `#help`, plus `#download`. Move `id="download"` from the hero's button group to the new Download section.

## 2. Hero (`.ep-dark` black stage)

**Desktop:**
- **Height:** 900 (use `min(900px, 100vh)` with a 760 minimum).
- **Copy column:** up to 780 wide, left edge on the grid, vertically centred with the phone.
  - H1 `web-display` 72/76, −0.025em, on one line: **"A free EMDR light bar"**.
  - Lede `web-lead`, `--ep-text-secondary`, max 560: "It runs on the computer you already have. The client watches a smoothly moving light, with bilateral sound in headphones, and you control it from your phone."
  - 32 below: buttons, 12 apart: Download for Mac (Apple icon) and Download for Windows (Windows icon). The visitor's OS gets `primary` (the existing script).
  - 20 below: `#version` line in `--ep-type-label`, secondary: "Free and open source (AGPL-3.0). Windows and Mac, Apple Silicon and Intel." The script replaces it with the version.
- **Phone:** `assets/images/hero-remote-dark@2x.png`, shown at 336 × 726, `.ep-device`, right edge on the grid, top 128.
- **Light:**
  - `.ep-track` across the full width, about 230 px below the copy (y ≈ 667 at 1440).
  - `.ep-light` 64 at x ≈ 770 (in the gap between copy and phone), with `.ep-light-trail` 360 × 32 ending at the light's centre.
  - The light passes behind the phone.
  - Optional glide animation is in `web.css`; it is static with reduced motion.

**Mobile:**
- All copy is centred, and the H1 breaks as "A free EMDR / light bar".
- Buttons are full width and stacked, 12 apart.
- The light is centred (44 px), 48 below the copy.
- The phone is 281 wide, centred, 64 below the light, and cropped by the hero's bottom edge (about 440 px of phone shows).

## 3. How it works (white) `#how`

- **Header:** "How it works" with the lead "Install EyePath on the Windows or Mac computer the client will watch, using its own screen or a TV or second screen connected to it. Your phone needs nothing installed; it's the remote."
- **Layout:** 3 equal columns, 24 apart [stacked, 40 apart].
- **Each column:**
  - Media 368 × 264 [350 × 196 or 240], radius 16.
  - 20 below: a title row with the numeral (`--ep-type-title`, `--ep-text-accent`) plus the title (`--ep-type-title`, primary), 12 apart.
  - 8 below: body `web-body`, secondary.

| # | Media | Title | Body |
| --- | --- | --- | --- |
| 1 | `step-1-pairing-screen@2x.png` (crop of the client QR screen) | Open EyePath | It fills the screen with a QR code and a short code. A new code is made every time it opens. |
| 2 | `step-2-connect-phone@2x.png` | Scan with your phone | Or type the address and code into any browser on the same Wi-Fi. The screen turns into the light bar. |
| 3 | CSS: `.ep-dark` stage, `.ep-track` at 50%, `.ep-light` 36 at 68% width with a 150-wide trail | Run your sets | Start, stop, speed, track, colour and sound, all from the phone. Sets end cleanly with the light gliding home. |

## 4. Your phone is the remote (grey)

**Desktop layout:** two columns, 80 apart; the copy column is 540.
- **Copy:**
  - H2 "Your phone is the remote" with the lead "Every control is on your phone, so you can keep watching the client."
  - Then a 3-row list. Each row has a 1 px `--ep-border-default` top border (the last row also a bottom border) and 20 px vertical padding.
  - Each row: title `--ep-type-body-strong`, then body `web-body`, secondary.
- **Rows:**
  - Speed in Hz: "Shown in sweeps per second and Hz. Change speed mid-set without the light jumping."
  - Sets that end cleanly: "Choose a number of passes or a timer. Stop finishes the current sweep, then the light glides back to the centre."
  - Presets per client: "Save the settings that work for a client, including their sound delay and balance."
- **Image:** `remote-panel@2x.png`, shown at 580 × 680, radius 16. Its soft teal background is baked in.

**Mobile:** heading, then `remote-panel-mobile@2x.png` at 350 × 536, then the list.

## 5. Light, motion and sound (white)

- **Header:** "Light, motion and sound" with the lead "Each tab changes the client screen as you adjust it."
- **Phones:** three images, `tab-light`, `tab-motion` and `tab-sound` (`@2x.png`).
  - Each shown at 304 × 620, radius 40, `.ep-device`.
  - Spread across the column with equal gaps.
- **Captions:** 28 below each phone, left-aligned, width 344. Title `--ep-type-title`, then body `web-body`, secondary.
  - Fun shapes instead of the light: "Ten friendly pictures can follow the track in place of the light. Pick one with a tap on the phone, even mid-session."
  - Eight tracks, three ways to move: "Side to side, up and down, both diagonals, and a figure 8 or oval in either direction. Glide, steady pace or jump."
  - Bilateral sound: "A click or tone on each side, or a sweep that follows the light, with a left/right test, balance and Bluetooth delay."
- **Mobile:** a horizontal scroll-snap row, each slide 258 wide (phone 258 × 520), 20 apart, with a 20 px side inset and the next slide peeking. Pager dots: active 24 × 8 in accent, others 8 × 8 in `--ep-border-default`. The dots can be dropped if scroll-snap is clear enough.

## 6. Made for the therapy room (grey) `#features`

- **Header:** "Made for the therapy room" with the lead "A light bar's essentials, plus things that are hard to get from hardware."
- **Annotated client screen:** `.ep-dark`, 1200 × 600 (16:9-ish) [350 × 260], radius 16. Build it in HTML/CSS, not as an image:
  - **Track:** `.ep-track` at y 280 [110].
  - **Light:** `.ep-light` 88 [52] centred at x 720 [220] on the track, with a 320 [150] trail.
    - Inside it, the dual-attention number "7" in `--ep-type-readout` (40/44) [Title 20] in `--ep-text-inverse`.
  - **Key bar:** reuse the client screen's footer key bar markup and CSS (`client.html`), centred 36 from the bottom.
    - Mobile shows key caps only: Space, Esc, ↑ ↓.
  - **Markers:** 28 circles [24], fill `--ep-text-primary` (light on the dark stage), numeral in label-strong `--ep-text-inverse`.
    - 1: just above-right of the light, joined by a 1 px dashed line at 35% opacity.
    - 2: above the track at x 260 [70].
    - 3: above the centre of the key bar.
    - 4: top-right corner, 56 in.
    - Markers are `aria-hidden`; the key below carries the meaning.
- **Key:** 4 equal columns, 32 apart [stacked list with dividers].
  - Each has a 1 px top border and 20 padding above.
  - Title row: numeral (body-strong, accent) and title (body-strong).
  - Body `--ep-type-label` (14/20), secondary.

| # | Title | Body |
| --- | --- | --- |
| 1 | Dual attention | Colour flashes, numbers or letters appear on the light at random moments, at easy, medium or hard. The answers show on your phone. **Plus a second line:** Colour flashes may not be suitable for people with photosensitive epilepsy or sensitivity to flashing light. |
| 2 | Smooth and in sync | Every screen works out the light's position from a shared clock, so a busy Wi-Fi doesn't make it stutter, and each tone plays as the light reaches the side. |
| 3 | Keys on the computer | No phone nearby? Press Space to start or stop, the arrow keys to change speed, or S to move the light to another screen. |
| 4 | Light or dark | The remote follows your phone's setting, or pick Light or Dark under Room & devices. The client screen stays dark, so it fades straight into the light bar. |

## 7. Privacy (white) `#privacy`

- **Desktop layout:** two columns, 80 apart.
  - Left: H2 "EyePath runs entirely on your computer and your local Wi-Fi", width 420.
  - Right: a 2 × 2 grid, 256-wide columns, 40 gaps. Each item: Phosphor icon 24 in accent, 12 gap, title body-strong, body `web-body`, secondary.
- **Mobile:** stacked. The icon sits left of each text block, 14 apart.
- **Items:**
  - **No accounts, no internet needed** (cloud-slash): "There's nothing to sign up for and no cloud service. It works on a Wi-Fi with no internet, or on your phone's hotspot."
  - **Nothing about clients is stored** (eye): "Only your settings and the presets you save. No session logs, no recordings, no analytics."
  - **A new code every session** (qr-code): "Only a phone that scans the QR code or types the code can control it, and nothing stays connected after the app closes."
  - **Open source** (github-logo): "The code is public under the AGPL-3.0 licence, so anyone can check what it does. This website has no cookies or trackers either."

## 8. Setup and troubleshooting (grey) `#help`

- **Desktop layout:** two columns, 80 apart.
  - Left (400): H2 "Setup and troubleshooting" with the lead "EyePath isn't signed by Apple or Microsoft yet, so both show a warning the first time."
  - Right: the accordion.
- **Accordion row:** keep `<details>`.
  - White surface, radius 16, 1 px border, padding 20 / 24, rows 12 apart.
  - The question in body-strong, with a plus icon (20, secondary) on the right.
- **Open state** (not drawn in Figma): the answer in `web-body`, secondary, padding 0 24 20; the icon becomes minus.
- **Content:** keep the five questions and answers from the current page exactly.

## 9. Research (white) `#research`

- **Desktop layout:** two columns, 80 apart.
- **Left column (520):**
  - H2 "Where the features come from".
  - 4 source rows: a 6 px accent dot, then a bold label and the citation.
  - The clinician note: page-grey box, radius 20, 1 px border, padding 24, warning icon, both paragraphs.
- **Right column:**
  - A "References" label (label-strong).
  - A numbered list of the 5 references in `--ep-type-label`, with DOIs as underlined accent links.
- **Mobile:** stacked.
- **Content:** unchanged from the current page.

## 10. Download (grey) `#download`

- **Header:** "Download EyePath" with the lead "Install it on the computer the client watches. Your phone needs nothing installed."
- **Layout:** 3 equal cards, 24 apart [stacked, 12 apart].
- **Each card:** white surface, radius 16, 1 px border, padding 28 [20].
  - Icon 32 [28] in primary.
  - 16 below: title `--ep-type-title`.
  - Line `--ep-type-label`, secondary.
  - 32 below: a full-width large button.

| Card | Line | Button |
| --- | --- | --- |
| macOS | Apple Silicon and Intel | Download for Mac (`#dlMac`, links to the .dmg from the latest release) |
| Windows | Installer for Windows PCs | Download for Windows (`#dlWin`, the .exe) |
| Source code | Free and open source, AGPL-3.0 | View on GitHub |

- **Button styles:** the visitor's OS card gets the primary button and the other gets secondary (same script as the hero). GitHub is always secondary.
- **Note:** 24 below the cards, in `--ep-type-label`, secondary: "You'll also need a phone with a browser on the same Wi-Fi, and headphones if you use bilateral sound."

## 11. Footer (white, 1 px top border)

- **Desktop layout:** two columns, space-between [stacked].
- **Left:**
  - Logo + "EyePath".
  - "Free and open source under the AGPL-3.0 licence. Source code, issues and releases on GitHub." (with links).
  - "Built with help from an AI coding assistant."
  - A share button (`data-share`, export icon, accent): "Share EyePath", which becomes "Link copied" after copying.
- **Right:** three link columns, 64 apart. The title is label-strong; links are label, secondary.
  - Product: How it works, Features, Privacy, First-time setup.
  - Project: GitHub, Releases, Report an issue (`/issues`).
  - Credits: Fun-shape pictures: Noto Emoji (Apache 2.0); QR code generator based on Project Nayuki's (MIT).

## Copy status

All product facts come from the current site. These headings are new and **draft until the owner approves** them:

- "A free EMDR light bar"
- "Your phone is the remote"
- "Light, motion and sound"
- "Made for the therapy room" (from the old site)
- "Setup and troubleshooting"
- "Download EyePath"
- The download card lines
- "You'll also need…"

Open owner question: whether "Fun shapes instead of the light / Ten friendly pictures" (current site wording) becomes "Pictures instead of the light".
