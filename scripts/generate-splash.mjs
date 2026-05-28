// Generates resources/splash.png & splash-dark.png — iOS launch screen masters.
// Renders the ZENTō wordmark centred on the brand background.
//
// Usage: node scripts/generate-splash.mjs
// Then:  npx @capacitor/assets generate --ios

import sharp from "sharp";

const SIZE = 2732;

const BG_LIGHT = { r: 248, g: 240, b: 228, alpha: 1 }; // #f8f0e4
const BG_DARK  = { r: 35,  g: 30,  b: 25,  alpha: 1 }; // warm near-black

const INK_LIGHT = "#3b352f"; // dark warm brown on light bg
const INK_DARK  = "#f0e8dc"; // warm off-white on dark bg

// Krona One from Google Fonts — embedded as base64 so the script is self-contained.
// We fetch it at build time instead.
const FONT_URL =
  "https://fonts.gstatic.com/s/kronaone/v15/jAnEgHdjHcjgfIb1ZcUCMQ.ttf";

async function fetchFontBase64() {
  const res = await fetch(FONT_URL);
  if (!res.ok) throw new Error(`Font fetch failed: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  return buf.toString("base64");
}

function wordmarkSvg(ink, fontBase64) {
  // "ZENT" in full size, "ō" slightly smaller (0.85em) to match the logo feel.
  // The macron-o sits on the same baseline but is visually lighter.
  const fontSize = 260; // px — reads well on the 2732 canvas
  const smallSize = Math.round(fontSize * 0.85);

  return `
<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}">
  <defs>
    <style>
      @font-face {
        font-family: 'Krona One';
        src: url('data:font/ttf;base64,${fontBase64}') format('truetype');
        font-weight: 400;
        font-style: normal;
      }
    </style>
  </defs>
  <text
    x="50%" y="50%"
    dominant-baseline="central"
    text-anchor="middle"
    fill="${ink}"
    font-family="'Krona One', sans-serif"
    font-weight="400"
    letter-spacing="0.08em"
  >
    <tspan font-size="${fontSize}">ZENT</tspan><tspan font-size="${smallSize}" dy="0">ō</tspan>
  </text>
</svg>`;
}

async function makeSplash({ output, bg, ink, fontBase64 }) {
  const bgBuf = await sharp({
    create: { width: SIZE, height: SIZE, channels: 4, background: bg },
  })
    .png()
    .toBuffer();

  const svgBuf = Buffer.from(wordmarkSvg(ink, fontBase64));

  await sharp(bgBuf)
    .composite([{ input: svgBuf, top: 0, left: 0 }])
    .png()
    .toFile(output);

  console.log(`✓ ${output} (${SIZE}×${SIZE})`);
}

console.log("Fetching Krona One font…");
const fontBase64 = await fetchFontBase64();

await makeSplash({
  output: "resources/splash.png",
  bg: BG_LIGHT,
  ink: INK_LIGHT,
  fontBase64,
});
await makeSplash({
  output: "resources/splash-dark.png",
  bg: BG_DARK,
  ink: INK_DARK,
  fontBase64,
});
