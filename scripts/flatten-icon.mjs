// Extends the existing icon's cream gradient out to the canvas corners so
// the master is full-bleed (no transparent corners). iOS will apply its own
// squircle mask — we just need a flat, full-bleed source.
//
// Usage: node scripts/flatten-icon.mjs

import sharp from "sharp";

const SOURCE = "resources/icon.png";
const OUTPUT = "resources/icon.flattened.png";
const SIZE = 1024;

// Gradient colours sampled from the existing icon body edges (NOT made up —
// the slightly-too-bright values I used previously created a white halo).
const TOP_COLOR = "#f8f0e4";    // RGB(248, 240, 228) at top edge of original body
const BOTTOM_COLOR = "#efe7dc"; // RGB(239, 231, 220) at bottom edge of original body

const bgSvg = `
<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${TOP_COLOR}"/>
      <stop offset="100%" stop-color="${BOTTOM_COLOR}"/>
    </linearGradient>
  </defs>
  <rect width="${SIZE}" height="${SIZE}" fill="url(#g)"/>
</svg>`;

const bg = await sharp(Buffer.from(bgSvg)).png().toBuffer();

await sharp(bg)
  .composite([{ input: SOURCE, blend: "over" }])
  .png()
  .toFile(OUTPUT);

const meta = await sharp(OUTPUT).metadata();
console.log(`✓ Wrote ${OUTPUT} (${meta.width}x${meta.height}, hasAlpha: ${meta.hasAlpha})`);
console.log(`  When ready: cp ${OUTPUT} ${SOURCE}`);
