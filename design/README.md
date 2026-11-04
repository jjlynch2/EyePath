# EyePath v2 design hand-off

This folder holds everything needed to build the EyePath v2 redesign without opening Figma. The PNGs show the target and the Markdown files give the measurements, so a developer working with Claude Code can implement it from the repo alone.

- **Figma source (view-only is enough):** https://www.figma.com/design/dykzd8rugaodx2IbsP9345/Dr-Lynch. Open the pages named `EyePath · …`; the same file also holds an unrelated project.
- **Scope:** a visual and UX redesign of the phone remote (`static/therapist.html`), the connect page (`static/login.html`) and the computer screen (`static/client.html`). Every existing setting and feature stays (see the control map in [SCREENS.md](SCREENS.md)).
- **Out of scope:** the server, the protocol, the light engine, audio and the Electron shell. Behaviour should not change, only layout, styling and where controls live.

## Read in this order

1. [IMPLEMENTATION.md](IMPLEMENTATION.md): phased plan with acceptance checks. Start here.
2. [SCREENS.md](SCREENS.md): each screen, what is on it, and the complete map from current control to new location.
3. [COMPONENTS.md](COMPONENTS.md): component specs (sizes, states, tokens, accessibility).
4. [tokens.css](tokens.css) / [tokens.json](tokens.json): design tokens (`--ep-*`), Light and Dark.
5. [CLAUDE-snippet.md](CLAUDE-snippet.md): paste into the repo's `CLAUDE.md` so Claude Code follows this folder.

## Folder map

| Path | Contents |
| --- | --- |
| `screens/phone-light/` | 16 phone screens, 390 × 844 (1×), Light |
| `screens/phone-dark/` | The same 16 screens, Dark (same file names) |
| `screens/desktop/` | 5 computer-screen states, 1440 × 900 |
| `screens/system/` | Colour tokens, type, spacing, radius and shadow sheets, and the components sheet |
| `tokens.css` | CSS custom properties. `:root` = Light; `[data-theme="dark"]`, `body.client` and `prefers-color-scheme: dark` = Dark |
| `tokens.json` | The same tokens in W3C design-token format |
| `assets/icons/phosphor/` | 40 Phosphor icons × Regular/Fill SVG (MIT, `LICENSE` included) |
| `assets/icons/track/` | 8 custom track-pattern icons (named after `data-value`) + the bold infinity icon for the active Motion tab |
| `assets/logo/` | Logo mark (currentColor, light, dark), app icon SVG, `icon-512.png`, `apple-touch-icon-180.png` |
| `assets/fonts/` | Atkinson Hyperlegible Next variable woff2 (latin + latin-ext, weights 200–800) and `OFL.txt` |

## Design in one paragraph

This is a calm clinical tool, not a children's app. Near-white surfaces in Light and deep teal-graphite in Dark, one deep-teal accent, and soft layered shadows (never hard offsets, no gradients). The type is Atkinson Hyperlegible Next. The phone remote moves from one long scrolling page to a **Session** tab that never scrolls, plus **Light / Motion / Sound / Presets** tabs in a floating bottom tab bar. Quick tasks open as **bottom sheets** (Presets, Pictures, Room & devices) and confirmations as dialogs. Values beat labels: the pass count is the largest type, and changed settings show "Changed, was …". Danger (Stop now, Quit, Offline) is solid `#B5110D` with white text.

## Screenshot naming

`NN-name.png`, where NN is the order in Figma. Light and Dark share names, so `phone-light/10-tab-light.png` pairs with `phone-dark/10-tab-light.png`.

## Licences

- Phosphor Icons: MIT.
- Atkinson Hyperlegible Next: SIL OFL 1.1. Both can be bundled in this MIT app.
