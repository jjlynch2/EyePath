# Snippet for the repo's CLAUDE.md

Paste the block below into `CLAUDE.md` at the repo root (create it if missing), so Claude Code follows the hand-off.

```markdown
## Design v2 (redesign in progress)

- The design spec lives in `design/`. Read `design/README.md`, then follow `design/IMPLEMENTATION.md` phase by phase.
- Target visuals: `design/screens/phone-light|phone-dark|desktop/*.png`. Before finishing a screen, open the matching PNG
  (and its Dark twin) and compare at 390 px wide (desktop: 1440 × 900).
- Use only `--ep-*` tokens from `static/tokens.css` (copied from `design/tokens.css`). No new hex values, fonts or shadows.
- Every existing control must keep working and stay reachable; check against the control map in `design/SCREENS.md`.
  Keep element IDs and `data-*` attributes, because the JS binds to them.
- Component specs (sizes, states, a11y): `design/COMPONENTS.md`. Minimum 44 px targets, visible focus ring, reduced motion.
- The app runs offline: bundle fonts and icons in `static/`, no CDNs.
- Run `npm test` after each phase.
```
