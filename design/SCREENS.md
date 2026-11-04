# Screens

Phone screens are 390 × 844 and desktop screens 1440 × 900. Light PNGs are in `screens/phone-light/`, Dark PNGs in `screens/phone-dark/` with the same names. Figma node IDs are given so a screen can be found in the file (page `EyePath · 3 Screens`).

## Phone remote: structure

```
App header      logo · connection chip · ··· (Room & devices)      always visible, every screen
Content         Session | Light | Motion | Sound | Presets (one per tab)
Floating tab bar  Session · Light · Motion · Sound · Presets         358 × 64, 20 px above the bottom edge (+ safe-area inset), radius 20
Overlays        bottom sheets (Presets, Pictures, Room & devices), dialogs (Quit, Delete preset), toasts
```

- **Session tab never scrolls** at 390 × 844: header → preset bar → live preview → pass counter → speed + set length → action buttons → tab bar.
- Setup tabs scroll (each about 1–1.5 screens). Each tab starts with a large title and a one-line summary ("Circle, blue, 6%").
- While a set runs and the user is on another tab, the **Session tab item shows a live dot and the pass count** (`11/24`) instead of its label (see `14-tab-sound-session-live.png`). There is no floating "live" bar.
- **Change tracking:** when a value differs from the loaded preset, show an accent dot after its label and "Changed, was 1.00 Hz" (text/accent, Caption). The preset bar shows "N changes".

## Phone screens

| # | File | Figma (Light / Dark) | What it shows |
| --- | --- | --- | --- |
| 01 | `01-connect.png` | 108:803 / 108:871 | `login.html`. Title "Connect the remote", 6 code tiles (3 + dash + 3), "Code complete" check, Connect button, "or" divider, QR info card, "Phone can't connect?" link. Chip "This Wi-Fi only". |
| 02 | `02-session-idle.png` | 67:3 / 70:50 | Session tab between sets. Counter shows last set result ("24 of 24 passes", "Set complete", time). Primary "Start set". |
| 03 | `03-session-running.png` | 67:145 / 94:423 | Set running: counter live, rail fills L→R, current pass tick taller. Actions: "Stop after this pass" (inverse fill) + "Stop now" (danger). |
| 04 | `04-session-finishing-dual-attention.png` | 84:693 / 94:548 | Stop requested: "Finishing" badge, left button becomes disabled "Finishing this pass". Dual attention answers row under the rail ("Numbers 4 7 2 9"). Set length caption "Applies to the next set". Tab item shows live dot + `11/24`. |
| 05 | `05-session-offline.png` | 84:834 / 94:676 | Connection lost: header chip "Offline" (danger-soft), toast "Can't reach EyePath" above the tab bar. |
| 06 | `06-session-code-showing.png` | 85:388 / 97:1105 | The client screen is showing the pairing code: toast with "Show the light" button (= `#hideCodeBtn`). |
| 07 | `07-sheet-presets.png` | 71:63 / 96:515 | Opened from the preset bar. "In use" card lists changed values (was → now), "Save changes" + "Reset". List: tap to load; check = in use; drag handle. "Save current settings as new". |
| 08 | `08-sheet-room-devices.png` | 84:125 / 97:537 | Opened from header `···`. Connection status, "Show the connection code", screen picker (which display shows the light), "This phone" theme (System / Light / Dark), computer keys hint, "Quit EyePath on the computer" (danger). |
| 09 | `09-dialog-quit.png` | 86:405 / 97:1235 | Confirm dialog (same pattern for "Delete preset?"). |
| 10 | `10-tab-light.png` | 68:32 / 94:843 | Light tab: Shape (5 tiles) + Pictures row → sheet; Light colour (7 + custom); Background (12 + custom); Size stepper; Glow, Light at rest, Light on switches; "Show on" row (only with 2+ screens). |
| 11 | `11-sheet-pictures.png` | 84:314 / 97:726 | Pictures sheet: 10 picture tiles (emoji assets from `static/emoji/`), "Use a shape instead". |
| 12 | `12-tab-motion.png` | 77:96 / 94:1038 | Motion tab: Track (8 tiles, 4 × 2), Show the track faintly, Height on screen slider (Centre); Movement segment + description; Edge pause and Track width steppers; Dual attention segment, warning, How often segment. |
| 13 | `13-tab-sound.png` | 68:188 / 94:963 | Sound tab: type segment + description, "Test left, then right"; Volume slider; Pitch stepper; Balance slider (Left/Right, Centre); Sound delay stepper with Bluetooth hint. |
| 14 | `14-tab-sound-session-live.png` | 74:86 / 97:1426 | Same tab while a set runs: Session tab item shows live dot and pass count. |
| 15 | `15-tab-presets.png` | 79:123 / 95:497 | Presets tab: disclaimer, numbered list (1–5, "In use" tag, drag handle, `···` menu), "Save current settings" form, keys hint. |
| 16 | `16-closed.png` | 108:852 / 108:920 | After Quit (`#closedScreen`). |

## Desktop (client) screens

The client screen is always Dark (`body.client`). 1440 × 900; it must also work from 1280 × 720 to 4K (scale with `clamp()`; keep the two-column layout from 1100 px wide, stack below).

| # | File | Figma | What it shows |
| --- | --- | --- | --- |
| 01 | `01-code-screen.png` | 91:423 | `#codeScreen`. Left: headline, lead, 3 numbered steps (scan; address in a pill; code as 6 character tiles). Right: QR on a light tile with a soft teal glow, caption "Point the camera here". Footer bar: keys + "Phone can't connect?". Top: logo, status pill "Waiting for a phone", version. |
| 02 | `02-phone-cant-connect.png` | 90:435 | The `<details>` "Phone can't connect?" becomes a centred panel over a dimmed screen, 5 numbered fixes, Close. |
| 03 | `03-light-at-rest.png` | 90:418 | Stage only: the light at rest, nothing else. |
| 04 | `04-sound-check-left.png` | 90:420 | Sound check: big "Left" / "Right" label (`#checkLeft` / `#checkRight`). |
| 05 | `05-not-running.png` | 92:423 | `#lost`: "EyePath isn't running" card. |

## Control map: every current control has a home

Element IDs and `data-param` names must stay, because `therapist.js`, `client.js` and `common.js` bind to them. Move the markup and restyle it; don't rename.

### Header, live area, dialogs (`therapist.html`)

| Current | v2 location | Notes |
| --- | --- | --- |
| `.brand` logo | App header, left | New Logo/Mark (`assets/logo/logo-mark.svg`, `currentColor` = `--ep-accent-default`) |
| `#conn` chip | App header connection chip | Connected (accent dot) / Connecting… / Offline (danger-soft, wifi-slash icon) |
| `#setCount` | Preview chip, top right ("Set 2 done", "Set 3" while running) | |
| `#themeBtn` | Room & devices sheet → "This phone" segment System / Light / Dark | 3-way now: System removes `data-theme` and the `eyepath-theme` key |
| `#quitBtn` | Room & devices sheet → "Quit EyePath on the computer" | Still confirms with `#confirmDialog` |
| `#preview` | Live preview card (black stage, 358 × 112) | Chips: track name (left), set state (right) |
| `#count`, `#countSub` | Counter card: Hero number, "of 24 passes", status badge, elapsed time | Badge: Ready / Running / Finishing / Set complete |
| — (new) | Pass rail under the counter: L … R, one tick per pass, current taller | Derived from count and passes; timer and no-limit modes show a time bar instead |
| `#dualInfo` | Counter card, answers row ("Numbers 4 7 2 9") | Only when Dual attention is on |
| `#startBtn` | "Start set" (Button/Action Start), full width | While running the same element reads "Stop after this pass", then "Finishing this pass" (disabled) |
| `#stopNowBtn` | "Stop now" (Button/Action danger), beside it while running | |
| `#quickPresets` | Replaced by the preset bar → Presets sheet (2 taps to any preset); keys 1–0 unchanged | Owner-approved IA; keep the element hidden or remove the render code |
| `.keys-hint` | Room & devices sheet, keys line; Presets tab, keys hint | Hidden on touch devices as today |
| `#codeBanner`, `#hideCodeBtn` | Toast "The client screen shows the code" + "Show the light" button | Also: Room sheet → "Show the connection code" sends the opposite command |
| `#confirmDialog` | Dialog (09) | Cancel = secondary, OK = danger for Quit/Delete |
| `#closedScreen` | Closed screen (16) | |
| `#appVersion` | Room & devices sheet footer (Caption, text/secondary) | Not drawn; add under the Quit button |

### Settings cards (`therapist.html`)

| Current card → control | v2 location |
| --- | --- |
| Speed: `data-step="speed"` −/+, `#speed` range | Session tab: Speed card, 56 px round − / + and the Readout value "1.05 Hz". The range input is no longer visible; keep it in the DOM (hidden) or drive `speed` directly. |
| Set length: Passes / Timer / No limit | Session tab: Segment |
| Passes −/+ and 12 / 24 / 36 / 48 | Session tab: Chips 12 / 24 / 36 / 48. Fine −/+ (±2) is not drawn: long-press a chip, or add 44 px round −/+ at both ends of the chip row (preferred). |
| Seconds −/+ and 20s / 30s / 45s / 60s | Same chip row when Timer is selected (chips read 20s 30s 45s 60s) |
| Track: 8 pattern buttons | Motion tab: Track tiles (4 × 2) with drawn icons, labels below |
| Track: "Show the track faintly" | Motion tab: Switch row |
| Track: height range, `#heightReset` | Motion tab: "Height on screen" slider, value "Centre" / "+12"; tapping the value resets (= `#heightReset`) |
| Light: `#screenRow` (screen picker) | Light tab: "Show on" row → opens Room sheet screen list (only shown with 2+ screens) |
| Light: shape buttons (5) | Light tab: Shape tiles |
| Light: picture buttons (10) | Light tab: Pictures row → Pictures sheet (11) |
| Light: colour swatches (7) + `input[type=color]` | Light tab: Light colour swatches + "+" opens the native colour input |
| Light: background swatches (12) + custom | Light tab: Background swatches (2 rows) + "+" |
| Light: size range | Light tab: Size stepper (44 px round), "Share of screen height" |
| Light: Glow, rest, visual checkboxes | Light tab: Switch rows "Glow", "Light at rest between sets", "Light on / Off for sound-only sets" |
| Motion: Smooth / Steady / Jump | Motion tab: Movement segment + one-line description |
| Motion: pause range | Motion tab: Edge pause stepper (ms) |
| Motion: travel range | Motion tab: Track width stepper (%) |
| Sound: Off / Click / Tone / Sweep | Sound tab: Segment + description |
| Sound: `#soundCheckBtn` | Sound tab: "Test left, then right" secondary button |
| Sound: volume range | Sound tab: Volume slider (value right) |
| Sound: pitch range | Sound tab: Pitch stepper (Hz) |
| Sound: balance range, `#balanceReset` | Sound tab: Left / right balance slider with centre detent; tap "Centre" value to reset |
| Sound: audioOffset range | Sound tab: Sound delay stepper (ms) + Bluetooth hint |
| Dual attention: Off / Flashes / Numbers / Letters | Motion tab: Dual attention segment |
| Dual attention: Easy / Medium / Hard | Motion tab: "How often" segment |
| Dual attention help + photosensitivity warning | Motion tab: warning callout (warning icon, danger) under the segment; help line under How often |
| Presets: list (load, ↑/↓ reorder, delete) | Presets tab list: tap row = load; drag handle = reorder; `···` menu = Move up, Move down, Delete (keeps the arrow function for keyboard and switch users) |
| Presets: `#presetForm`, `#presetName`, Save | Presets tab: "Save current settings" field + Save; also Presets sheet "Save current settings as new" and "Save changes" (overwrite the loaded preset) |
| Presets help text | Presets tab intro line + keys hint |

### Connect page (`login.html`)

| Current | v2 |
| --- | --- |
| `<h1>Connect your phone</h1>` | "Connect the remote" (Headline) |
| `input[name=code]` | One real `<input>` (keep the name, `autocomplete="one-time-code"`, `inputmode` text, uppercase), drawn as 6 tiles with a dash after 3. Easiest: a transparent input over 6 display boxes. |
| Connect button | Button/Action Start style, label "Connect" |
| `#err`, `#expired` | Not drawn. Show under the tiles in `--ep-text-danger` with a warning icon, tiles get `--ep-danger-default` border. |
| (new) QR info card | Static info card "Scan the QR code / Point the phone's camera at the computer screen" (not a button) |
| (new) "Phone can't connect?" | Link to the same fixes as the client panel (a sheet with the 5 fixes) |

### Client screen (`client.html`)

| Current | v2 |
| --- | --- |
| `.code-brand`, `.code-eye` | Header logo (top left); the big eye graphic is dropped |
| `#qr` | Right column, light tile (`#E8EFF0`-ish surface, radius 32, Glow shadow), caption below |
| `#addr` | Step 2 address pill with wifi icon (Client/Address style) |
| `#code` | Step 3 character tiles (Client/Code tile style) |
| `.keys-box` | Footer key bar (54 tall, radius 20, centred, bottom 40 px) |
| `.multi-screen` key "S Next screen" | Not drawn: add to the footer bar after F when shown |
| `details` "Phone can't connect?" | Footer link → centred panel (02) |
| `#netRow` / `#net` select | Not drawn: add at the bottom of the panel, "Network address to show" + select, when shown |
| "Control it from this computer instead" link | Not drawn: add as a text link at the bottom of the panel |
| `#appVersion` | Header, top right, after the status pill |
| `#status` dot | Header status pill: "Waiting for a phone" / "Phone connected" |
| `#lost` | Not running card (05) |
| `#checkLeft`, `#checkRight` | Sound check labels (04), Client/Check style |
