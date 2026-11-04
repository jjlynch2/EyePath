# Components

Plain HTML + CSS, no framework, matching the current app. All values come from `tokens.css`; never hard-code a hex value in `style.css`. Screenshots of every component and its variants: `screens/system/components.png` (Figma page `EyePath · 2 Foundations & components`).

## Global rules

- **Font:** `font-family: var(--ep-font)`, with Atkinson Hyperlegible Next self-hosted (the app runs offline). Use `font-variant-numeric: tabular-nums` on every changing number (count, Hz, ms, %, time).
- **Type:** `font: var(--ep-type-*)`. Add the tracking noted in `tokens.css` comments as `letter-spacing`.
- **Touch targets:** at least 44 × 44 px for every control. Where the visual is smaller (34 px swatches, the 51 × 31 switch, the `···` row menu), extend the hit area with padding or `::before`.
- **Focus:** `:focus-visible { outline: 2px solid var(--ep-accent-default); outline-offset: 2px; }` on every control. This isn't drawn in Figma but is required.
- **Shadows:** only the five tokens `--ep-shadow-raised | card | floating | sheet | glow`. No borders on shadowed cards in Light. In Dark, cards get `1px solid var(--ep-border-default)`, because shadows don't read on dark.
- **Motion:** sheets slide up 240 ms `cubic-bezier(.2,.8,.2,1)` and the scrim fades 200 ms. Toasts fade and rise 8 px. Under `prefers-reduced-motion: reduce`, use fades only. The live preview animation is content, so it keeps running.
- **Card:** `background: var(--ep-bg-surface); border-radius: var(--ep-radius-xl) /*20*/; box-shadow: var(--ep-shadow-card); padding: 16px;` Gap between cards: 10 px. Screen side padding: 16 px.
- **Rows inside cards** are separated by a 1 px `--ep-border-default` divider, with 12–14 px vertical padding.
- **Page background:** `--ep-bg-page`, plus one decorative radial glow at the top (`--ep-glow-ambient`, about 620 × 460, centred above the header). It's decoration only, so give it `pointer-events: none`.

## App header

44 tall, full width minus 16 px padding.
- **Left:** Logo/Mark (24 px, accent) + "EyePath" (Body strong).
- **Right:** connection chip + 44 px round `···` button (surface, Card shadow, aria-label "Room and devices").
- **Connection chip:** 36 tall pill, surface, Raised shadow, 8 px dot + Label strong.
  - Connected: accent dot.
  - Connecting: `--ep-text-secondary` dot.
  - Offline: `--ep-danger-soft` background, `--ep-text-danger` text, wifi-slash icon.
- On the Connect page the chip reads "This Wi-Fi only" with a wifi icon.

## Tab bar (floating)

- **Container:** 358 × 64, `position: fixed`, bottom `calc(20px + env(safe-area-inset-bottom))`, centred. Radius 20, surface, Floating shadow, padding 6, gap 2.
- **5 items:** equal width, 52 tall, radius 12. Icon 24 above a Tab label.
  - Inactive: Regular icon, `--ep-text-secondary`.
  - Active: Fill icon, `--ep-text-accent`, Tab strong, item background `--ep-accent-soft`.
- **Icons:** Session `play-circle`, Light `sun`, Motion `infinity` (Regular) / `assets/icons/track/infinity-bold.svg` (active; replaces Phosphor's infinity Fill), Sound `headphones`, Presets `bookmarks-simple`.
- **Session live** (a set running while another tab is open): the Session item shows an 8 px accent dot at the icon's top right (2 px surface ring), and the label becomes the pass count `11/24`, tabular.
- **Markup:** `<nav aria-label="Sections">` with buttons using `aria-current="page"`. Give the live item `aria-label="Session, running, pass 11 of 24"`.
- Content needs `padding-bottom` of at least 100 px so nothing hides under the bar.

## Preset bar (Session tab)

- 64 tall card, radius 20, Card shadow.
- **Left:** 40 px `--ep-accent-soft` tile with the `bookmarks-simple` Fill icon, then "Preset" (Caption, secondary) over the name (Body strong).
- **Right:** "N changes" pill (accent-soft, accent dot, Label strong text/accent) and a caret-down.
- The whole bar is one button that opens the Presets sheet.
- With no changes, the pill is hidden.

## Live preview

- 358 × 112, radius 20, `--ep-bg-stage` (#000). Shows the same light as the client, at a reduced scale.
- **Chips:** top left (track name), top right (set state). 24 tall, `rgba(255,255,255,.12)` background, white Caption text.
- The light keeps its glow, because it is content.

## Pass counter card

- **Hero count:** `--ep-type-hero`, tracking −3%, tabular. Beside it, "of 24 passes" (Body, secondary).
- **Status badge** (top right):
  - Ready / Set complete: surface-2 background, secondary dot.
  - Running / Finishing: accent-soft background, accent dot, text/accent.
- Elapsed time sits under the badge (Caption, tabular).
- **Pass rail:** an "L" and "R" caption at either end. One 4 × 10 px tick per pass, gap 3, radius 1.
  - Done ticks: `--ep-accent-default`.
  - To-do ticks: `--ep-text-primary` at 100% while running, or accent at 100% after a completed set.
  - The current tick is 6 × 14.
  - Timer and no-limit modes: one 6 px progress bar instead.
- **Dual attention answers row:** surface-2, radius 12, label left (Label, secondary), answers right (Value, letter-spacing .3em).

## Button/Action (primary actions)

60 tall pill, Body strong label with a 20 px icon. Use real `<button>` elements.

| Kind | Fill | Text | Shadow | Used for |
| --- | --- | --- | --- | --- |
| Start | `--ep-accent-default` | `--ep-text-on-accent` | Glow | "Start set", "Connect", "Save" |
| Stop after pass | `--ep-bg-inverse` | `--ep-text-inverse` | Glow | While running (left, flexible width) |
| Stop after pass, disabled | `--ep-bg-surface-2` | `--ep-text-secondary` | none | "Finishing this pass" |
| Stop now | `--ep-danger-default` #B5110D | `--ep-text-on-danger` #FFF | none | Right, about 110–140 wide; also "Quit EyePath on the computer" (full width, sign-out icon) |
| Secondary | `--ep-bg-surface` + 1 px `--ep-border-strong` | text/primary | Raised | "Reset", "Use a shape instead", "Save current settings as new", dialog Cancel |

Pressed: `transform: scale(.98)` and the fill darkens 6% (use `--ep-accent-strong` for Start). Disabled: `aria-disabled`, no shadow.

## Button/Round (steppers)

- 56 px (Speed on the Session tab) or 44 px (every settings stepper).
- Surface fill, Card shadow, 24 px `minus` / `plus` icon in text/primary.
- **Value between:** Readout style for Speed (`1.05` + "Hz" in Label), Value style elsewhere (`50 ms`).
- **Hold to repeat:** after 400 ms, repeat every 80 ms.
- **Accessibility:** `aria-label` "Slower" / "Faster" etc. The value gets `aria-live="polite"`.
- At min or max, the button is disabled (40% opacity).

## Segment (segmented control)

- **Track:** `--ep-bg-surface-2`, radius 16, padding 4.
- **Items:** 44 tall, radius 12, Label (secondary).
- **Selected item:** `--ep-control-selected` fill, 1 px `--ep-border-default`, Raised shadow, Label strong, text/primary.
- Use `role="radiogroup"` + `role="radio"`, or the current button group with `aria-pressed`. Arrow keys move the selection.

## Chip (quick values)

- 44 tall, radius 12, equal-width grid.
- Default: surface-2 fill, Value text.
- Selected: accent-soft fill, 1.5 px `--ep-accent-default` border, text/accent.

## Switch

- 51 × 31 pill, thumb 27 px (`--ep-control-thumb`, Raised shadow).
- Off: track `--ep-control-track` (3.07:1 in Light, 3.63:1 in Dark; meets non-text contrast).
- On: track `--ep-accent-default`.
- The whole row is the label: `<label>` wraps the text and an `<input type="checkbox" role="switch">`.

## Slider (Height, Volume, Balance)

- 4 px track `--ep-control-track`, filled part `--ep-accent-default`. Balance and Height fill from the centre.
- Thumb 28 px `--ep-control-thumb` with Card shadow. Hit area 44 px tall.
- End captions (Caption, secondary): "Lower / Higher", "Left / Right".
- The value appears at the top right of the row ("Centre", "50%"). When off-centre, the value doubles as a reset button (`#heightReset`, `#balanceReset`).
- Keep the native `<input type="range">` and style it with `appearance: none`.

## Tiles (Shape, Track, Pictures)

- **Shape:** 5 across, 58 × 56, radius 16, surface-2 fill, 22 px glyph in text/primary at 70%.
- **Track:** 4 × 2 grid, about 78 × 84, gap 8, radius 16. 48 × 28 path icon from `assets/icons/track/track-<data-value>.svg` (inline it; `currentColor`). The track line is at 40% opacity, the trail dot at 50%, and the leading dot is solid. Unselected: line and trail use `--ep-text-secondary`, leading dot `--ep-text-primary` (set a different `color` on `.track-dot`). Selected: everything `--ep-accent-default`. Caption label below.
- **Pictures:** 5 × 2, 65 × 74, radius 16, emoji SVG from `static/emoji/` above a Caption label.
- **Selected (all tiles):** accent-soft fill, 1.5 px accent border, text/accent label.
- Use buttons with `aria-pressed`, keeping the `data-value` attributes.

## Swatches

- **Size:** 34 px circles, 8 px gap; give each a 44 px hit area.
  - Light colour: 7 swatches.
  - Background: 12 swatches in 2 rows.
- 1 px `rgba(0,0,0,.12)` inner border so white and light swatches show on white.
- **Selected:** 2 px surface ring + 2 px `--ep-text-primary` outer ring.
- **"+" swatch:** dashed `--ep-border-strong` circle with a plus icon. It is the visible face of the `input[type=color]`.
- The selected colour's name shows at the top right of the group ("Blue", "Black").

## Bottom sheet

- **Scrim:** `--ep-bg-scrim`.
- **Sheet:** surface, top radius 28, Sheet shadow, padding 8 top / 16 sides / 16 + safe area bottom.
- **Grabber:** 36 × 5 at the top, `--ep-border-strong`.
- **Header:** title (Title) on the left, "Done" (Body strong, text/accent) on the right.
- **Height:** content height, maximum 88vh, scrolling inside.
- **Behaviour:**
  - Close on Done, scrim tap, Esc, or drag down.
  - Use `<dialog>` with `showModal()`, as `#confirmDialog` already does; focus is trapped and returns to the trigger.
- **Sheets:**
  - Presets (07): "In use" card on accent-soft, radius 20.
  - Pictures (11).
  - Room & devices (08).

## Dialog (confirm)

- Centred card, 326 wide, radius 24, Sheet shadow, 52 px icon tile (radius 16) at the top.
- Title (Title), one line of body (secondary), two 52 tall buttons side by side: Cancel (Secondary) and the action (Stop now / danger style for Quit and Delete).
- Reuse `#confirmDialog`.

## Toast

- **Size:** 358 wide, radius 20, Floating shadow, padding 12 / 14, gap 12.
- **Position:** fixed above the tab bar, 12 px gap.
- **Colours:** inverse surface (`--ep-bg-inverse`), text `--ep-text-inverse`, secondary line `--ep-text-inverse-secondary`.
- **Status tile:** 40 px, radius 12.
  - Offline: danger fill, wifi-slash icon.
  - Code showing: accent fill, qr-code icon.
- **Action** (Code showing): full-width white pill button "Show the light", 48 tall.
- `role="status"`, `aria-live="polite"`.
- Offline stays until reconnect. Code showing stays while the code is visible.

## Presets list rows

- 64 tall.
- **Left to right:** 32 px number tile (surface-2, Label strong; in use: accent fill, white), name (Body strong) + summary (Caption, secondary, e.g. "1.00 Hz, 24 passes, tone"), "In use" tag, then `dots-six-vertical` drag handle and `···` menu (44 px hit).
- Tap the row to load.
- **Reorder:** drag with Pointer Events, plus Move up / Move down in the menu.
- **Delete:** confirms with the dialog.

## Client screen (desktop)

- **Background:** `--ep-bg-page` (Dark) + a radial glow (`--ep-glow-ambient`) behind the QR.
- **Type:** Client/* text styles (`--ep-type-client-*`).
- **Code tiles:** 64 × 80, radius 16, surface-2, 1 px border, Client/Code tile style, text/accent. The dash between halves is in secondary.
- **QR tile:** 376 square, radius 32, QR 320 inside, `#E8EFF0`, QR in `#0F1B1D`, `box-shadow: var(--ep-shadow-glow)` plus a large soft teal glow.
- **Footer key bar:** 54 tall, radius 20, surface at 60%, 1 px border. `<kbd>`: 28 tall, surface-2, 1 px border-strong, radius 8, Label strong. Labels in secondary.
- **Panel ("Phone can't connect?"):** max-width 720, radius 28, surface, Sheet shadow. Numbered circles 36 px, accent-soft fill, text/accent.
