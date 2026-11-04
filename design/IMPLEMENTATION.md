# Implementation plan

Build in phases. Each phase ends with a working app, `npm test` passing, and a visual check against the PNGs. Compare at 390 px wide in the browser's device mode, in both Light and Dark. Commit after each phase.

## Ground rules

- **Behaviour doesn't change.** Keep element IDs, `data-param`, `data-value`, `data-step`, `data-set` and the WebSocket messages. `therapist.js` / `client.js` changes should be limited to view logic: tabs, sheets, the rail, change tracking, the 3-way theme.
- **Nothing is removed.** Every control in [SCREENS.md → Control map](SCREENS.md#control-map-every-current-control-has-a-home) must exist after the work. Tick it off as you go.
- **Offline.** No CDNs. Fonts and icons are bundled in `static/`.
- **Tokens only.** All colours, radii, shadows and type come from `tokens.css` variables. Treat `tokens.css` as generated: if a value must change, change it in Figma and re-export, or note it in this folder.
- **Phone first.** The phone is 390 px. The remote must also work from 360 to 430 px wide, and on a computer browser, where it is centred at max-width 430 px. A two-column desktop layout for the remote is not designed (see Open items).

## Phase 1: Foundations

1. Copy `design/tokens.css` → `static/tokens.css`. Link it before `style.css` in `therapist.html`, `client.html` and `login.html`.
2. Copy `design/assets/fonts/*.woff2` → `static/fonts/`. Add to `style.css`, replacing the Public Sans `@font-face` rules once nothing uses them:
   ```css
   @font-face { font-family: "Atkinson Hyperlegible Next"; src: url(/static/fonts/AtkinsonHyperlegibleNext-Variable-latin.woff2) format("woff2"); font-weight: 200 800; font-display: swap;
     unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD; }
   @font-face { font-family: "Atkinson Hyperlegible Next"; src: url(/static/fonts/AtkinsonHyperlegibleNext-Variable-latin-ext.woff2) format("woff2"); font-weight: 200 800; font-display: swap;
     unicode-range: U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C4, U+2113, U+2C60-2C7F, U+A720-A7FF; }
   ```
   Put `OFL.txt` next to them.
3. Copy the needed icons from `design/assets/icons/phosphor/` → `static/icons/`. Inline them as SVG or use `<svg><use href="…#icon">` from one sprite. They are 256-unit viewBox SVGs; set `fill="currentColor"`.
4. Replace `static/icon.svg`, `icon-512.png` and `apple-touch-icon.png` with `design/assets/logo/app-icon.svg`, `icon-512.png` and `apple-touch-icon-180.png`. Rename as needed and keep the existing paths. Also check the Electron app icon in `build/`.
5. Map the old `style.css` variables to the new tokens, or replace them. Set `meta[name=theme-color]` from `--ep-bg-page`.

**Accept when:** all three pages render in Atkinson Hyperlegible Next with no network access. Light and Dark backgrounds match `#F2F5F5` / `#0C1315`. Nothing breaks functionally.

## Phase 2: Phone shell (header, tabs, sheets)

1. **App header** (COMPONENTS → App header), with `#conn` as the connection chip and a `···` button.
2. **Tab bar** and five tab panels. Use `role="tablist"`-style nav with buttons and `aria-current`; hide inactive panels with `hidden`. Keep the active tab in `sessionStorage` so a reload returns to it.
3. **Bottom sheet** primitive on `<dialog>`, plus the Room & devices sheet (08):
   - connection status
   - "Show the connection code" (sends the same message as the client's C key / `#hideCodeBtn` inverse)
   - screen list (from `#screenRow` data)
   - theme System / Light / Dark
   - keys hint
   - `#appVersion`
   - Quit, which goes through `#confirmDialog`
4. **Toasts:** offline (on socket close) and code showing (replaces `#codeBanner`).

**Accept when:** header, tabs, sheets and toasts match `02`, `05`, `06`, `08` and `09` in both themes. Esc and the scrim close sheets, and focus returns to the trigger. The theme choice persists, and System follows the OS.

## Phase 3: Session tab

1. Preset bar → Presets sheet (07). It needs change tracking: compare current settings with the loaded preset, list the differences ("was → now"), then Save changes (overwrite) and Reset (reload the preset).
2. Live preview card (reuse `#preview`) with the track and set chips (`#setCount`).
3. Counter card: Hero count, status badge, elapsed time, pass rail, dual attention answers (`#dualInfo`).
4. Speed: 56 px round steppers + Readout. Show "Changed, was 1.00 Hz" when it differs from the preset.
5. Set length: segment + chips (passes or seconds), with fine −/+ (see SCREENS note).
6. Actions: Start set → while running, Stop after this pass + Stop now → Finishing this pass (disabled).

**Accept when:** the Session tab matches `02`, `03` and `04` and **does not scroll** at 390 × 844. It also must not scroll at 390 × 750 (Safari with toolbars): if needed, shrink the preview to 96 px tall first, then the card gaps to 8. The Session tab item shows the live dot + count while a set runs and another tab is open (`14`).

## Phase 4: Setup tabs

- **Light (10)** + Pictures sheet (11).
- **Motion (12)**, including Dual attention.
- **Sound (13).**
- **Presets (15):** load, drag reorder, `···` menu (Move up / Move down / Delete), save form.
- Every setting shows its current value at the top right of its group, and the change marker when it differs from the preset.
- Each tab's summary line under the title updates live ("Circle, blue, 6%").

**Accept when:**
- Each tab matches its PNG in both themes.
- Every row of the SCREENS control map is present and works.
- Presets still save every setting, including sound delay and balance.
- Keys 1–0 still load presets on a computer.

## Phase 5: Connect, Closed, client screen

- `login.html` → 01, including the error and expired states (danger text under the tiles; not drawn).
- `#closedScreen` → 16.
- `client.html` → desktop 01–05: code screen, can't-connect panel (with the `#net` select and "Control it from this computer instead" link added at the bottom), light at rest, sound check, not running.

**Accept when:** the pages match the PNGs at 1440 × 900 and still read well at 1280 × 720 and 1920 × 1080. QR scanning and code entry work end to end.

## Phase 6: Accessibility and polish

- Visible `:focus-visible` ring on every control.
- All targets at least 44 px; swatches and row menus get extended hit areas.
- Contrast is already checked in the tokens (text pairs ≥ 4.9:1; switch track ≥ 3:1; white on `#B5110D` 6.88:1). Don't introduce new colour pairs.
- `prefers-reduced-motion`: fades only.
- Screen reader pass (VoiceOver on iPhone):
  - tab names and the live state announced
  - steppers announce values
  - segments act as radio groups
  - sheets are modal
- Keyboard: every action reachable on a computer browser. The existing shortcuts are unchanged.

**Accept when:** an axe or Lighthouse run shows no contrast or name/role errors, and a manual VoiceOver run of one full session (connect → start → stop → change a setting → save preset) works.

## Open items (not designed; use judgement and the existing patterns)

- **Not designed:** the "Set 1 not started yet" state (counter "0 of 24 passes", badge "Ready") and the "stopping" transition. Use the components as they are.
- **Computer-browser remote layout:** for now, a centred 430 px column. A wider layout can come later.
- **Login error states:** see Phase 5.
- **Landscape phone:** keep the portrait layout and let it scroll.
- **Reserved tokens:** `bg/sunken` and `accent/strong` aren't used on any screen yet. `accent/strong` is fine for pressed Start.
