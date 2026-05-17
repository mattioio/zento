// Composes App Store marketing screenshots from raw simulator captures.
//
// Usage:
//   node scripts/screenshots/compose.mjs
//
// Inputs:  screenshots/raw/<id>.png      (your simulator captures)
// Output:  screenshots/output/<target>/<id>.png
//
// Layout: soft vertical gradient backdrop, brand-font headline at top,
// the captured screen mounted inside a custom-drawn iPhone bezel and
// tilted slightly, anchored to the bottom of the canvas.

import sharp from "sharp";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { SHOTS, TARGETS, FONT_HEADLINE } from "./config.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "..");
const RAW_DIR = path.join(ROOT, "screenshots", "raw");
const OUT_DIR = path.join(ROOT, "screenshots", "output");

// Phone geometry, expressed as fractions of the canvas width.
// These look right for the 6.7" target (1290x2796).
const PHONE_WIDTH_FRACTION = 0.74;
const SCREEN_BEZEL = 0.035;        // fraction of phone width (uniform on all sides)
// Body aspect is chosen so the SCREEN aperture matches a real 19.5:9 iPhone
// screen, accounting for the bezel: (h - 2b)/(w - 2b) = 19.5/9.
const PHONE_ASPECT = (1 - 2 * SCREEN_BEZEL) * (19.5 / 9) + 2 * SCREEN_BEZEL;
const PHONE_CORNER_RADIUS = 0.21;  // fraction of phone width
const ISLAND_WIDTH_FRACTION = 0.32;// fraction of phone width
const ISLAND_HEIGHT_FRACTION = 0.034;
const ISLAND_TOP_OFFSET = 0.025;   // fraction of phone width below top bezel

const HEADLINE_TOP_FRACTION = 0.075;   // top edge of headline / canvas height
const HEADLINE_FONT_FRACTION = 0.034;  // headline size / canvas height (Krona One is a wide face)
const HEADLINE_LINE_GAP = 1.18;        // line-height multiplier

function escapeXml(s) {
  return String(s).replace(/[<>&'"]/g, (c) => ({
    "<": "&lt;",
    ">": "&gt;",
    "&": "&amp;",
    "'": "&apos;",
    '"': "&quot;"
  }[c]));
}

function svgHeadline({ text, color, x, y, fontSize, font }) {
  const lines = text.split("\n");
  const lineHeight = fontSize * HEADLINE_LINE_GAP;
  const tspans = lines
    .map((line, i) => {
      const dy = i === 0 ? 0 : lineHeight;
      return `<tspan x="${x}" dy="${dy}">${escapeXml(line)}</tspan>`;
    })
    .join("");
  return `
    <text
      x="${x}" y="${y}"
      text-anchor="middle"
      font-family="${escapeXml(font)}"
      font-size="${fontSize}"
      fill="${color}"
      style="letter-spacing: -0.01em;"
    >${tspans}</text>
  `;
}

async function composeElement(shot, target, rawBuffer) {
  const { width: canvasW, height: canvasH } = target;
  const meta = await sharp(rawBuffer).metadata();

  // Crop region in input pixels (defaults to the full image).
  const crop = shot.crop || { left: 0, top: 0, width: meta.width, height: meta.height };
  const cropped = await sharp(rawBuffer)
    .extract({
      left: Math.max(0, crop.left | 0),
      top: Math.max(0, crop.top | 0),
      width: Math.min(meta.width - crop.left, crop.width | 0),
      height: Math.min(meta.height - crop.top, crop.height | 0)
    })
    .png()
    .toBuffer();
  const croppedMeta = await sharp(cropped).metadata();

  // Scale element to a comfortable width on the canvas.
  const elementWidth = Math.round(canvasW * 0.84);
  const elementHeight = Math.round((croppedMeta.height / croppedMeta.width) * elementWidth);
  const elementResized = await sharp(cropped)
    .resize(elementWidth, elementHeight, { fit: "fill" })
    .png()
    .toBuffer();
  const elementB64 = elementResized.toString("base64");

  const elementCornerR = Math.round(elementWidth * 0.06);
  const elementCx = canvasW / 2;
  const elementCy = canvasH * 0.6;

  const headlineFont = Math.round(canvasH * HEADLINE_FONT_FRACTION);
  const headlineY = Math.round(canvasH * HEADLINE_TOP_FRACTION) + headlineFont;

  const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="${canvasW}" height="${canvasH}" viewBox="0 0 ${canvasW} ${canvasH}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${shot.gradient[0]}"/>
      <stop offset="100%" stop-color="${shot.gradient[1]}"/>
    </linearGradient>
    <clipPath id="elementClip">
      <rect x="${-elementWidth / 2}" y="${-elementHeight / 2}" width="${elementWidth}" height="${elementHeight}" rx="${elementCornerR}" ry="${elementCornerR}"/>
    </clipPath>
    <filter id="elementShadow" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur in="SourceAlpha" stdDeviation="${Math.round(elementWidth * 0.025)}"/>
      <feOffset dx="0" dy="${Math.round(elementWidth * 0.018)}" result="offsetblur"/>
      <feComponentTransfer><feFuncA type="linear" slope="0.22"/></feComponentTransfer>
      <feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>

  <rect width="100%" height="100%" fill="url(#bg)"/>

  ${svgHeadline({
    text: shot.headline,
    color: shot.headlineColor,
    x: canvasW / 2,
    y: headlineY,
    fontSize: headlineFont,
    font: FONT_HEADLINE
  })}

  <g transform="translate(${elementCx} ${elementCy})">
    <rect
      x="${-elementWidth / 2}" y="${-elementHeight / 2}"
      width="${elementWidth}" height="${elementHeight}"
      rx="${elementCornerR}" ry="${elementCornerR}"
      fill="#ffffff" fill-opacity="0.001"
      filter="url(#elementShadow)"
    />
    <g clip-path="url(#elementClip)">
      <image
        x="${-elementWidth / 2}" y="${-elementHeight / 2}"
        width="${elementWidth}" height="${elementHeight}"
        href="data:image/png;base64,${elementB64}"
        preserveAspectRatio="xMidYMid slice"
      />
    </g>
  </g>
</svg>`;

  return svg;
}

async function composePhone(shot, target, rawBuffer) {
  const { width: canvasW, height: canvasH } = target;
  const rawMeta = await sharp(rawBuffer).metadata();
  // Reference rawMeta to avoid unused-var noise; used here for clarity if logging needs it.
  void rawMeta;

  // Phone geometry on this canvas.
  const phoneW = Math.round(canvasW * PHONE_WIDTH_FRACTION);
  const phoneH = Math.round(phoneW * PHONE_ASPECT);
  const cornerR = Math.round(phoneW * PHONE_CORNER_RADIUS);
  const bezelPx = Math.round(phoneW * SCREEN_BEZEL);
  const screenW = phoneW - bezelPx * 2;
  const screenH = phoneH - bezelPx * 2;
  const screenCornerR = Math.max(0, cornerR - bezelPx);
  const islandW = Math.round(phoneW * ISLAND_WIDTH_FRACTION);
  const islandH = Math.round(phoneW * ISLAND_HEIGHT_FRACTION);
  const islandTop = bezelPx + Math.round(phoneW * ISLAND_TOP_OFFSET);

  // Anchor phone near bottom, so headline sits above it comfortably.
  // Centre of phone, in canvas coords:
  const phoneCx = canvasW / 2;
  const phoneCy = canvasH - phoneH / 2 - Math.round(canvasH * 0.04);

  // Resize the captured screen content to fit the screen aperture, then
  // crop / cover so we never see borders.
  const screenContent = await sharp(rawBuffer)
    .resize(screenW, screenH, { fit: "cover", position: "top" })
    .png()
    .toBuffer();
  const screenContentB64 = screenContent.toString("base64");

  // Headline geometry.
  const headlineFont = Math.round(canvasH * HEADLINE_FONT_FRACTION);
  const headlineY = Math.round(canvasH * HEADLINE_TOP_FRACTION) + headlineFont;

  const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="${canvasW}" height="${canvasH}" viewBox="0 0 ${canvasW} ${canvasH}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${shot.gradient[0]}"/>
      <stop offset="100%" stop-color="${shot.gradient[1]}"/>
    </linearGradient>
    <clipPath id="screen">
      <rect x="${-screenW / 2}" y="${-screenH / 2}" width="${screenW}" height="${screenH}" rx="${screenCornerR}" ry="${screenCornerR}"/>
    </clipPath>
    <filter id="phoneShadow" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur in="SourceAlpha" stdDeviation="${Math.round(phoneW * 0.025)}"/>
      <feOffset dx="0" dy="${Math.round(phoneW * 0.012)}" result="offsetblur"/>
      <feComponentTransfer><feFuncA type="linear" slope="0.28"/></feComponentTransfer>
      <feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>

  <rect width="100%" height="100%" fill="url(#bg)"/>

  ${svgHeadline({
    text: shot.headline,
    color: shot.headlineColor,
    x: canvasW / 2,
    y: headlineY,
    fontSize: headlineFont,
    font: FONT_HEADLINE
  })}

  <g transform="translate(${phoneCx} ${phoneCy}) rotate(${shot.tilt})">
    <!-- phone body -->
    <rect
      x="${-phoneW / 2}" y="${-phoneH / 2}"
      width="${phoneW}" height="${phoneH}"
      rx="${cornerR}" ry="${cornerR}"
      fill="#15161a"
      filter="url(#phoneShadow)"
    />
    <!-- screen content, clipped to rounded rect -->
    <g clip-path="url(#screen)">
      <image
        x="${-screenW / 2}" y="${-screenH / 2}"
        width="${screenW}" height="${screenH}"
        href="data:image/png;base64,${screenContentB64}"
        preserveAspectRatio="xMidYMid slice"
      />
    </g>
    <!-- dynamic island -->
    <rect
      x="${-islandW / 2}" y="${-phoneH / 2 + islandTop}"
      width="${islandW}" height="${islandH}"
      rx="${islandH / 2}" ry="${islandH / 2}"
      fill="#000"
    />
  </g>
</svg>`;

  return svg;
}

async function composeOne(shot, target) {
  const rawPath = path.join(RAW_DIR, shot.raw);
  let rawBuffer;
  try {
    rawBuffer = await fs.readFile(rawPath);
  } catch {
    console.warn(`⚠️  ${shot.raw} not found in screenshots/raw/, skipping ${shot.id}`);
    return;
  }
  const svg =
    shot.layout === "element"
      ? await composeElement(shot, target, rawBuffer)
      : await composePhone(shot, target, rawBuffer);
  const outDir = path.join(OUT_DIR, target.id);
  await fs.mkdir(outDir, { recursive: true });
  const outPath = path.join(outDir, `${shot.id}.png`);
  await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toFile(outPath);
  const stat = await fs.stat(outPath);
  console.log(`✓ ${target.id}/${shot.id}.png  (${(stat.size / 1024).toFixed(0)} KB, layout=${shot.layout || "phone"})`);
}

async function main() {
  await fs.mkdir(RAW_DIR, { recursive: true });
  await fs.mkdir(OUT_DIR, { recursive: true });
  for (const target of TARGETS) {
    for (const shot of SHOTS) {
      await composeOne(shot, target);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
