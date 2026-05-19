// Generates a clean, single-layer Zento icon — full-bleed cream gradient
// background with two amber curves. No nested card / drop shadow that
// creates a visible inner boundary against iOS's mask.
//
// Usage: node scripts/generate-icon.mjs
// Then:  cp resources/icon.preview.png resources/icon.png
//        npx @capacitor/assets generate --ios --iconBackgroundColor "#f8f0e4"

import sharp from "sharp";

const SIZE = 1024;

// Palette sampled from the original icon body + curves.
const BG_TOP = "#f9f1e5";
const BG_BOTTOM = "#eee6dc";
const CURVE = "#c69b6a";

// Curve stroke width and inset. The curves echo the in-game tile shape
// but at a scale that reads at small sizes.
const STROKE_W = 70;
const INSET = 270;            // padding from canvas edge to where the curves live
const SIZE_INNER = SIZE - 2 * INSET;  // 484
const CX = SIZE / 2;
const CY = SIZE / 2;

// Two opposing quarter-arcs, one above-left of centre and one below-right,
// like the original icon's two curve marks. They mirror through centre.
const offset = SIZE_INNER * 0.18;
const tlBox = { x: INSET, y: INSET, w: SIZE_INNER, h: SIZE_INNER };

// Upper-left curve: from top-mid to left-mid (curveLeft style).
// Lower-right curve: from bottom-mid to right-mid.
// We use the in-game quadratic-bezier shape but scaled large.
const curveUL = `M ${CX} ${INSET + offset * 0.1}
                 Q ${CX} ${CY - offset} ${INSET + offset * 0.5} ${CY - offset * 0.2}`;
const curveDR = `M ${CX} ${SIZE - INSET - offset * 0.1}
                 Q ${CX} ${CY + offset} ${SIZE - INSET - offset * 0.5} ${CY + offset * 0.2}`;

const svg = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SIZE} ${SIZE}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${BG_TOP}"/>
      <stop offset="100%" stop-color="${BG_BOTTOM}"/>
    </linearGradient>
  </defs>
  <rect width="${SIZE}" height="${SIZE}" fill="url(#bg)"/>
  <g stroke="${CURVE}" stroke-width="${STROKE_W}" stroke-linecap="round" fill="none">
    <path d="${curveUL}"/>
    <path d="${curveDR}"/>
  </g>
</svg>`;

await sharp(Buffer.from(svg)).png().toFile("resources/icon.preview.png");
console.log(`✓ resources/icon.preview.png (${SIZE}x${SIZE}, single layer, no inner frame)`);
