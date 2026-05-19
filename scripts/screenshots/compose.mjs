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
const PHONE_WIDTH_FRACTION = 0.84;
const SCREEN_BEZEL = 0.035;        // fraction of phone width (uniform on all sides)
// Body aspect is chosen so the SCREEN aperture matches a real 19.5:9 iPhone
// screen, accounting for the bezel: (h - 2b)/(w - 2b) = 19.5/9.
const PHONE_ASPECT = (1 - 2 * SCREEN_BEZEL) * (19.5 / 9) + 2 * SCREEN_BEZEL;
const PHONE_CORNER_RADIUS = 0.21;  // fraction of phone width
// Where the phone top sits on the canvas (fraction of canvas height).
// Bottom may go off-canvas — intentional "phone rises into frame" effect.
const PHONE_TOP_FRACTION = 0.26;

const HEADLINE_TOP_FRACTION = 0.075;   // top edge of headline / canvas height
const HEADLINE_FONT_FRACTION = 0.034;  // headline size / canvas height (Krona One is a wide face)
const HEADLINE_LINE_GAP = 1.18;        // line-height multiplier

// When showLogo is true on a shot, render "Zentō" as a brand stamp above
// the headline and push the headline down to make room.
const LOGO_TOP_FRACTION = 0.045;
const LOGO_FONT_FRACTION = 0.046;
const HEADLINE_TOP_FRACTION_WITH_LOGO = 0.115;

// Tablet (iPad) geometry — same idea as the phone bezel but wider body,
// thinner bezels, and less corner radius to match the real hardware.
const TABLET_WIDTH_FRACTION = 0.86;
const TABLET_SCREEN_BEZEL = 0.022;
// Body aspect derived from iPad screen ratio (~4:3 portrait) + bezels.
const TABLET_ASPECT = (1 - 2 * TABLET_SCREEN_BEZEL) * (2732 / 2048) + 2 * TABLET_SCREEN_BEZEL;
const TABLET_CORNER_RADIUS = 0.10;
const TABLET_TOP_FRACTION = 0.26;
const TABLET_STATUS_BAR_CROP = 0.02;  // fraction of raw image height to trim from top

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

function composeSoundwave(shot, target) {
  const { width: canvasW, height: canvasH } = target;
  const accent = shot.accent || shot.headlineColor || "#2f5d3a";

  // Headline geometry (no logo on this shot).
  const headlineFont = Math.round(canvasH * HEADLINE_FONT_FRACTION);
  const headlineY = Math.round(canvasH * HEADLINE_TOP_FRACTION) + headlineFont;

  // Track label
  const labelTopY = Math.round(canvasH * 0.34);
  const labelFont = Math.round(canvasH * 0.013);
  const trackFont = Math.round(canvasH * 0.038);
  const trackY = labelTopY + labelFont + Math.round(canvasH * 0.012) + trackFont;

  // Waveform geometry — bars centred on a horizontal baseline.
  const waveCenterY = Math.round(canvasH * 0.56);
  const waveWidth = Math.round(canvasW * 0.74);
  const waveStartX = (canvasW - waveWidth) / 2;
  const barCount = 56;
  const barGap = waveWidth / barCount;
  const barWidth = Math.max(6, Math.round(barGap * 0.42));
  const maxBarHeight = Math.round(canvasH * 0.13);
  const minBarHeight = Math.round(canvasH * 0.012);

  // Deterministic gentle waveform — envelope (sin) modulated by a smooth
  // pseudo-random ripple. Symmetric around baseline so it reads as "audio".
  let bars = "";
  for (let i = 0; i < barCount; i++) {
    const t = i / (barCount - 1);
    const envelope = Math.sin(t * Math.PI); // 0 at edges, 1 at middle
    const ripple =
      0.55 +
      0.25 * Math.sin(i * 0.85 + 1.7) +
      0.20 * Math.sin(i * 1.93 + 0.4);
    const h = Math.round(
      minBarHeight + (maxBarHeight - minBarHeight) * envelope * ripple
    );
    const x = waveStartX + Math.round(i * barGap + (barGap - barWidth) / 2);
    bars += `<rect x="${x}" y="${waveCenterY - h / 2}" width="${barWidth}" height="${h}" rx="${barWidth / 2}" fill="${accent}" fill-opacity="0.92"/>`;
  }

  // Audio controls — prev / play / next, play larger and filled.
  const controlsY = Math.round(canvasH * 0.74);
  const playR = Math.round(canvasW * 0.085);
  const sideR = Math.round(playR * 0.78);
  const controlGap = Math.round(canvasW * 0.075);
  const cx = canvasW / 2;

  // SVG path snippets centred at 0,0 — moved into position via <g translate>.
  const prevIconR = Math.round(sideR * 0.42);
  const nextIconR = prevIconR;
  const playIconR = Math.round(playR * 0.42);

  // Prev: two stacked triangles + bar (skip-back). Drawn as path centred.
  const prevIcon = `
    <path d="M ${prevIconR * 0.1} ${-prevIconR * 0.6} L ${-prevIconR * 0.6} 0 L ${prevIconR * 0.1} ${prevIconR * 0.6} Z
              M ${prevIconR * 0.95} ${-prevIconR * 0.6} L ${prevIconR * 0.25} 0 L ${prevIconR * 0.95} ${prevIconR * 0.6} Z"
          fill="${accent}"/>
  `;
  const nextIcon = `
    <path d="M ${-prevIconR * 0.1} ${-prevIconR * 0.6} L ${prevIconR * 0.6} 0 L ${-prevIconR * 0.1} ${prevIconR * 0.6} Z
              M ${-prevIconR * 0.95} ${-prevIconR * 0.6} L ${-prevIconR * 0.25} 0 L ${-prevIconR * 0.95} ${prevIconR * 0.6} Z"
          fill="${accent}"/>
  `;
  // Play triangle (right-pointing) optically nudged a few px right.
  const playIcon = `
    <path d="M ${-playIconR * 0.55 + playIconR * 0.18} ${-playIconR * 0.85}
             L ${playIconR * 0.85 + playIconR * 0.18} 0
             L ${-playIconR * 0.55 + playIconR * 0.18} ${playIconR * 0.85} Z"
          fill="#ffffff"/>
  `;

  const buttonFill = "#ffffff";
  const buttonStroke = accent;
  const buttonStrokeW = Math.max(2, Math.round(sideR * 0.04));

  const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="${canvasW}" height="${canvasH}" viewBox="0 0 ${canvasW} ${canvasH}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${shot.gradient[0]}"/>
      <stop offset="100%" stop-color="${shot.gradient[1]}"/>
    </linearGradient>
    <filter id="softShadow" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur in="SourceAlpha" stdDeviation="${Math.round(canvasW * 0.012)}"/>
      <feOffset dx="0" dy="${Math.round(canvasW * 0.008)}" result="o"/>
      <feComponentTransfer><feFuncA type="linear" slope="0.20"/></feComponentTransfer>
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

  <!-- now-playing label + track title -->
  <text x="${canvasW / 2}" y="${labelTopY + labelFont}"
        text-anchor="middle"
        font-family="${escapeXml(FONT_HEADLINE)}"
        font-size="${labelFont}"
        fill="${shot.headlineColor}"
        fill-opacity="0.55"
        style="letter-spacing: 0.22em;">NOW PLAYING</text>
  <text x="${canvasW / 2}" y="${trackY}"
        text-anchor="middle"
        font-family="${escapeXml(FONT_HEADLINE)}"
        font-size="${trackFont}"
        fill="${shot.headlineColor}">${escapeXml(shot.trackName || "Hope")}</text>

  <!-- soundwave -->
  <g>${bars}</g>

  <!-- controls -->
  <g transform="translate(${cx - playR - controlGap - sideR} ${controlsY})">
    <circle r="${sideR}" fill="${buttonFill}" stroke="${buttonStroke}" stroke-width="${buttonStrokeW}" filter="url(#softShadow)"/>
    ${prevIcon}
  </g>
  <g transform="translate(${cx} ${controlsY})">
    <circle r="${playR}" fill="${accent}" filter="url(#softShadow)"/>
    ${playIcon}
  </g>
  <g transform="translate(${cx + playR + controlGap + sideR} ${controlsY})">
    <circle r="${sideR}" fill="${buttonFill}" stroke="${buttonStroke}" stroke-width="${buttonStrokeW}" filter="url(#softShadow)"/>
    ${nextIcon}
  </g>
</svg>`;

  return svg;
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

  // Anchor phone so its TOP sits at PHONE_TOP_FRACTION of the canvas; the
  // bottom is allowed to extend past the canvas edge (Matt likes that).
  const phoneCx = canvasW / 2;
  const phoneCy = Math.round(canvasH * PHONE_TOP_FRACTION) + phoneH / 2;

  // Resize the captured screen content to fit the screen aperture, then
  // crop / cover so we never see borders.
  const screenContent = await sharp(rawBuffer)
    .resize(screenW, screenH, { fit: "cover", position: "top" })
    .png()
    .toBuffer();
  const screenContentB64 = screenContent.toString("base64");

  // Headline + optional logo geometry.
  const headlineFont = Math.round(canvasH * HEADLINE_FONT_FRACTION);
  const headlineTopFraction = shot.showLogo
    ? HEADLINE_TOP_FRACTION_WITH_LOGO
    : HEADLINE_TOP_FRACTION;
  const headlineY = Math.round(canvasH * headlineTopFraction) + headlineFont;
  const logoFont = Math.round(canvasH * LOGO_FONT_FRACTION);
  const logoY = Math.round(canvasH * LOGO_TOP_FRACTION) + logoFont;
  // Krona One only ships in one weight, so we fake "bolder" via a stroke
  // the same colour as the fill — adds ~1-2px of weight to each stem.
  const logoStrokeWidth = Math.max(2, Math.round(logoFont * 0.04));
  const logoSvg = shot.showLogo
    ? `<text x="${canvasW / 2}" y="${logoY}" text-anchor="middle" font-family="${escapeXml(FONT_HEADLINE)}" font-size="${logoFont}" fill="${shot.headlineColor}" stroke="${shot.headlineColor}" stroke-width="${logoStrokeWidth}" paint-order="stroke fill" style="letter-spacing: 0.08em;">ZENTō</text>`
    : "";

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

  ${logoSvg}

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
    <!-- screen content (already includes the real iOS status bar +
         dynamic island from the simulator capture), clipped to a
         rounded rect. -->
    <g clip-path="url(#screen)">
      <image
        x="${-screenW / 2}" y="${-screenH / 2}"
        width="${screenW}" height="${screenH}"
        href="data:image/png;base64,${screenContentB64}"
        preserveAspectRatio="xMidYMid slice"
      />
    </g>
  </g>
</svg>`;

  return svg;
}

async function composeTablet(shot, target, rawBuffer) {
  const { width: canvasW, height: canvasH } = target;

  const tabletW = Math.round(canvasW * TABLET_WIDTH_FRACTION);
  const tabletH = Math.round(tabletW * TABLET_ASPECT);
  const cornerR = Math.round(tabletW * TABLET_CORNER_RADIUS);
  const bezelPx = Math.round(tabletW * TABLET_SCREEN_BEZEL);
  const screenW = tabletW - bezelPx * 2;
  const screenH = tabletH - bezelPx * 2;
  const screenCornerR = Math.max(0, cornerR - bezelPx);

  const tabletCx = canvasW / 2;
  const tabletCy = Math.round(canvasH * TABLET_TOP_FRACTION) + tabletH / 2;

  const rawMeta = await sharp(rawBuffer).metadata();
  const statusBarH = Math.round(rawMeta.height * TABLET_STATUS_BAR_CROP);
  const croppedRaw = await sharp(rawBuffer)
    .extract({ left: 0, top: statusBarH, width: rawMeta.width, height: rawMeta.height - statusBarH })
    .png()
    .toBuffer();

  const screenContent = await sharp(croppedRaw)
    .resize(screenW, screenH, { fit: "cover", position: "top" })
    .png()
    .toBuffer();
  const screenContentB64 = screenContent.toString("base64");

  const headlineFont = Math.round(canvasH * HEADLINE_FONT_FRACTION);
  const headlineTopFraction = shot.showLogo
    ? HEADLINE_TOP_FRACTION_WITH_LOGO
    : HEADLINE_TOP_FRACTION;
  const headlineY = Math.round(canvasH * headlineTopFraction) + headlineFont;
  const logoFont = Math.round(canvasH * LOGO_FONT_FRACTION);
  const logoY = Math.round(canvasH * LOGO_TOP_FRACTION) + logoFont;
  const logoStrokeWidth = Math.max(2, Math.round(logoFont * 0.04));
  const logoSvg = shot.showLogo
    ? `<text x="${canvasW / 2}" y="${logoY}" text-anchor="middle" font-family="${escapeXml(FONT_HEADLINE)}" font-size="${logoFont}" fill="${shot.headlineColor}" stroke="${shot.headlineColor}" stroke-width="${logoStrokeWidth}" paint-order="stroke fill" style="letter-spacing: 0.08em;">ZENTō</text>`
    : "";

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
    <filter id="tabletShadow" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur in="SourceAlpha" stdDeviation="${Math.round(tabletW * 0.02)}"/>
      <feOffset dx="0" dy="${Math.round(tabletW * 0.01)}" result="offsetblur"/>
      <feComponentTransfer><feFuncA type="linear" slope="0.25"/></feComponentTransfer>
      <feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>

  <rect width="100%" height="100%" fill="url(#bg)"/>

  ${logoSvg}

  ${svgHeadline({
    text: shot.headline,
    color: shot.headlineColor,
    x: canvasW / 2,
    y: headlineY,
    fontSize: headlineFont,
    font: FONT_HEADLINE
  })}

  <g transform="translate(${tabletCx} ${tabletCy}) rotate(${shot.tilt})">
    <rect
      x="${-tabletW / 2}" y="${-tabletH / 2}"
      width="${tabletW}" height="${tabletH}"
      rx="${cornerR}" ry="${cornerR}"
      fill="#15161a"
      filter="url(#tabletShadow)"
    />
    <g clip-path="url(#screen)">
      <image
        x="${-screenW / 2}" y="${-screenH / 2}"
        width="${screenW}" height="${screenH}"
        href="data:image/png;base64,${screenContentB64}"
        preserveAspectRatio="xMidYMid slice"
      />
    </g>
  </g>
</svg>`;

  return svg;
}

async function composeOne(shot, target) {
  let svg;
  let layoutForLog = shot.layout || "phone";
  if (shot.layout === "soundwave") {
    svg = composeSoundwave(shot, target);
  } else {
    const rawSubdir = target.raw ? path.join(RAW_DIR, target.raw) : RAW_DIR;
    const rawPath = path.join(rawSubdir, shot.raw);
    let rawBuffer;
    try {
      rawBuffer = await fs.readFile(rawPath);
    } catch {
      const rel = path.relative(ROOT, rawPath);
      console.warn(`⚠️  ${rel} not found, skipping ${target.id}/${shot.id}`);
      return;
    }
    // Per-target style picks the compositor. iPhones get a phone bezel,
    // iPads (and any future tablets) get a clean framed-screen element.
    if (target.style === "tablet") {
      svg = await composeTablet(shot, target, rawBuffer);
      layoutForLog = "tablet";
    } else if (shot.layout === "element") {
      svg = await composeElement(shot, target, rawBuffer);
      layoutForLog = "element";
    } else {
      svg = await composePhone(shot, target, rawBuffer);
    }
  }
  const outDir = path.join(OUT_DIR, target.id);
  await fs.mkdir(outDir, { recursive: true });
  const outPath = path.join(outDir, `${shot.id}.png`);
  await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toFile(outPath);
  const stat = await fs.stat(outPath);
  console.log(`✓ ${target.id}/${shot.id}.png  (${(stat.size / 1024).toFixed(0)} KB, layout=${layoutForLog})`);
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
