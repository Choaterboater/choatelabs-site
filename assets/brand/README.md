# Choate Labs brand assets

The logo is the site mark: a *C*-as-graph — a curved stroke with three
nodes — the same path used in the header and favicon. Colors are the
site's design tokens (`assets/site.css`, plus the favicon's light/dark
palettes in `index.html`).

## Files

| File | Use |
| --- | --- |
| `avatar-1024.png` | **GitHub profile / org avatar (recommended).** Dark, full-bleed; survives GitHub's circle & squircle crops. Upload this one. |
| `avatar-500.png` | Same, smaller. GitHub displays avatars small, so 500 is plenty. |
| `avatar-light-1024.png` / `avatar-light-500.png` | Light variant (cream background) for light contexts. |
| `avatar.svg` / `avatar-light.svg` | Vector masters for the avatars; re-render at any size. |
| `logo-mark.svg` | Transparent standalone mark (orange curve, cream nodes) for READMEs and embeds on dark surfaces. |

GitHub avatars must be raster (PNG/JPG/GIF) — upload a `*.png`, not the SVG.

## Colors

| Token | Dark | Light |
| --- | --- | --- |
| background | `#0F0D09` | `#ECE8DD` |
| stroke (curve) | `#E08146` | `#A8501C` |
| nodes | `#EAE3D2` | `#1C1B18` |

## Regenerate

```sh
cd assets/brand
npm install @resvg/resvg-js
node build.mjs
```
