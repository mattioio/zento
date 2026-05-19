// Generates resources/splash.png — the iOS launch screen master.
// Composites the app icon at a sensible size on the brand cream background.
//
// Usage: node scripts/generate-splash.mjs
// Then:  npx @capacitor/assets generate --ios

import sharp from "sharp";

const SIZE = 2732;
// Icon takes ~50% of the canvas width. The master is square (2732) but
// gets cropped to the phone's portrait aspect on display, so the icon
// reads at roughly 50-65% of phone width — substantial and centred.
const ICON_SCALE = 0.5;
const ICON_SIZE = Math.round(SIZE * ICON_SCALE);
const ICON_OFFSET = Math.round((SIZE - ICON_SIZE) / 2);

const BG_LIGHT = { r: 248, g: 240, b: 228 }; // #f8f0e4 — matches icon body edge
const BG_DARK = { r: 35, g: 30, b: 25 };     // warm near-black, not jet black

async function makeSplash({ output, bg }) {
  const bgBuf = await sharp({
    create: { width: SIZE, height: SIZE, channels: 4, background: { ...bg, alpha: 1 } }
  }).png().toBuffer();

  const iconBuf = await sharp("resources/icon.png")
    .resize(ICON_SIZE, ICON_SIZE)
    .png()
    .toBuffer();

  await sharp(bgBuf)
    .composite([{ input: iconBuf, top: ICON_OFFSET, left: ICON_OFFSET }])
    .png()
    .toFile(output);

  console.log(`✓ ${output} (${SIZE}x${SIZE}, icon ${ICON_SIZE}px)`);
}

await makeSplash({ output: "resources/splash.png", bg: BG_LIGHT });
await makeSplash({ output: "resources/splash-dark.png", bg: BG_DARK });
