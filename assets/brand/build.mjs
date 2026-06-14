// Regenerates the Choate Labs brand logo files in this folder.
//   cd assets/brand && npm install @resvg/resvg-js && node build.mjs
//
// The mark is the site logo: a "C"-as-graph (a curved stroke with three
// nodes), the same path used in the header and favicon. Colors are the
// site's design tokens (see assets/site.css and the favicon in index.html).
import { Resvg } from '@resvg/resvg-js';
import { writeFileSync } from 'node:fs';

// Two palettes, both already defined by the site (favicon light/dark modes).
const DARK  = { bg: '#0F0D09', stroke: '#E08146', node: '#EAE3D2', glow: '#1A140C' };
const LIGHT = { bg: '#ECE8DD', stroke: '#A8501C', node: '#1C1B18', glow: '#F4F0E6' };

// The mark in the original 100x100 brand coordinate system, at the
// favicon's bolder weight so it reads as an icon rather than hairlines.
const mark = (p) => `
  <path d="M70 20 Q 10 20 20 50 Q 10 80 70 80"
        fill="none" stroke="${p.stroke}" stroke-width="9" stroke-linecap="round"/>
  <circle cx="70" cy="20" r="9"  fill="${p.node}"/>
  <circle cx="20" cy="50" r="10" fill="${p.node}"/>
  <circle cx="70" cy="80" r="11" fill="${p.node}"/>`;

// Square avatar. Mark bbox in 100-space is x[10,81] y[11,91], center
// (45.5, 51). Scale 7 maps the 80-unit-tall mark to 560px on a 1024
// canvas (~55%), centered, leaving a wide margin so GitHub's circle /
// squircle crop never clips it.
const S = 1024, scale = 7;
const tx = (S / 2 - 45.5 * scale).toFixed(1);
const ty = (S / 2 - 51 * scale).toFixed(1);

const avatar = (p) => `<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}" viewBox="0 0 ${S} ${S}" role="img" aria-label="Choate Labs">
  <rect width="${S}" height="${S}" fill="${p.bg}"/>
  <radialGradient id="v" cx="50%" cy="44%" r="62%">
    <stop offset="0%" stop-color="${p.glow}"/>
    <stop offset="62%" stop-color="${p.bg}"/>
    <stop offset="100%" stop-color="${p.bg}"/>
  </radialGradient>
  <rect width="${S}" height="${S}" fill="url(#v)"/>
  <g transform="translate(${tx} ${ty}) scale(${scale})">${mark(p)}</g>
</svg>`;

const png = (svg, size) =>
  new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng();

// Transparent standalone mark (matches the site header logo exactly).
writeFileSync('logo-mark.svg',
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" fill="none" role="img" aria-label="Choate Labs">${mark(DARK)}</svg>`);

for (const [name, p] of [['avatar', DARK], ['avatar-light', LIGHT]]) {
  const svg = avatar(p);
  writeFileSync(`${name}.svg`, svg);
  writeFileSync(`${name}-1024.png`, png(svg, 1024));
  writeFileSync(`${name}-500.png`, png(svg, 500));
}

console.log('built brand assets in', process.cwd());
