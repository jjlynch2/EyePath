# Website implementation plan

`docs/` is what GitHub Pages serves, so everything the page uses must live in `docs/`. Fonts are already in `docs/fonts/`. Commit after each phase and compare against `screens/` at 1440 and 390.

## Phase 1: Foundations

1. Copy `static/tokens.css` → `docs/tokens.css`, then copy `design/website/web.css` → `docs/web.css`. Link both before the page styles.
2. Pick one way to get dark mode on the black stages:
   - add `, .ep-dark` to both dark selectors in `tokens.css` (preferred, since it keeps one source), or
   - keep the local `.ep-dark` block in `web.css`.
3. Replace the page's own `--bg`, `--surface` and other variables with `--ep-*` tokens. The page becomes Light (`:root`); only `.ep-dark` areas are dark.
4. Copy the needed icons from `design/assets/icons/phosphor/` into `docs/media/icons/` or inline them as SVG with `fill="currentColor"`.

**Accept when:**
- The page renders in Atkinson Hyperlegible Next on the grey/white palette.
- The hero area is black with dark tokens.
- There are no hard-coded hex values outside the tokens.

## Phase 2: Structure and sections

Rebuild the sections in order (SECTIONS.md 1–11), keeping the existing ids, anchors, `<details>` and scripts. Use semantic HTML:
- `<header>` with `<nav>`, `<main>` with one `<section>` per block, and `<footer>`.
- `<h1>` only in the hero, then `<h2>` per section.

**Accept when:**
- Every section matches its PNG at 1440 (layout, sizes, copy).
- The five FAQ answers, the research references and the clinician and photosensitivity notes are all present and unchanged.

## Phase 3: Images

- **Preferred:** extend `tools/media.js` so it captures, from the real app, the crops listed in SECTIONS.md:
  - hero remote mid-set (Dark)
  - Session idle (Light) with the Presets sheet
  - the Connect page
  - a crop of the client QR screen
  - the Light, Motion and Sound tabs, cropped to 620 px of height at 304 wide
  This keeps the site in sync with the app.
- **Fallback:** use `design/website/assets/images/*@2x.png`, displayed at half their pixel size, with `width`/`height` attributes and `loading="lazy"` below the fold.
- **Build in CSS, not images:**
  - the light, trail and track (`web.css`)
  - the annotated client screen in "Made for the therapy room"
  - the step 3 stage
- Update `social-preview.png` with tools/media.js in the new look (`tools/media-social.html`).

**Accept when:**
- Images are sharp on 2× screens.
- The page weight stays reasonable: no GIFs above the fold, and the demo GIFs only where the old page used them, with stills for reduced motion.

## Phase 4: Responsive

- **Breakpoint:** 820 px (the existing site uses it). Below it, use the single-column mobile layout from `screens/mobile/`.
- **Mobile hero:** centred copy, full-width buttons, a centred light, and the phone cropped by the hero bottom.
- **Light, motion and sound:** a horizontal scroll-snap gallery.
- **Therapy room:** a smaller stage with key caps only; the key becomes a stacked list.

**Accept when:** the page matches the mobile PNGs at 390, and nothing overflows horizontally from 360 to 430 or from 820 to 1440.

## Phase 5: Quality

- **Accessibility:**
  - Visible `:focus-visible` rings on all links, buttons and `<summary>`.
  - Alt text on the product images, describing what the screen shows.
  - The annotated stage's markers are `aria-hidden`; the numbered key carries the meaning.
  - Colour contrast comes from the tokens (all text pairs ≥ 4.5:1).
- **Motion:** at most the hero light glide; nothing under `prefers-reduced-motion`.
- **Checks:** Lighthouse/axe with no errors, and the page works with JavaScript off (download buttons fall back to the Releases page).

## Not designed (use the patterns above)

- FAQ open state: SECTIONS.md §8.
- Hover states: links underline; buttons go 6% darker (`--ep-accent-strong` for primary); cards don't move.
- Widths between 820 and 1440: let the 1200 column shrink with the gutters, and stack the two-column sections below about 1000 if they get cramped.
