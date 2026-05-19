// Generates progression seeds for any empty slots in src/progressionLevels.json.
// Authored levels (non-empty strings) are preserved.
//
// Curve, per Matt's spec (2026-05-19):
//   - Tile count is monotonically non-decreasing across levels.
//   - Linear ramp from ~4 tiles (lvl 1) → 60 tiles (lvl 180).
//   - Levels 181-200 are all full boards (60 tiles); we ramp the other
//     complexity (curves, terminals, crosses) across these to build a finale.
//   - Crosses introduced at level 50.
//   - Milestone levels (19, 39, 59...) right before each theme unlock get
//     a showier feel: more crosses, slightly more curves.
//
// Usage: node scripts/generate-levels.mjs

import fs from "fs/promises";

const LEVELS_PATH = "src/progressionLevels.json";
const TOTAL_LEVELS = 200;
const RAMP_END_LEVEL = 180; // tiles reach 60 here; 181-200 are finale plateau

const ROWS = 10;
const COLS = 6;
const TOTAL_CELLS = ROWS * COLS;

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function tilesForLevel(level) {
  if (level >= RAMP_END_LEVEL) return 60;
  const t = (level - 1) / (RAMP_END_LEVEL - 1);
  const tilesContinuous = 4 + 56 * t;
  return clamp(Math.round(tilesContinuous / 4) * 4, 4, 60);
}

function paramsForLevel(level) {
  const tilesSnapped = tilesForLevel(level);
  const gapCells = TOTAL_CELLS - tilesSnapped;
  const gapRate = clamp(Math.round((gapCells / TOTAL_CELLS) * 100), 0, 96);

  let curveBias;
  let straightRunMax;
  let terminalRate;
  let terminalSpacing;
  let gapClusters;
  let centerBias;
  let crossRate;

  if (level <= RAMP_END_LEVEL) {
    const t = (level - 1) / (RAMP_END_LEVEL - 1);
    curveBias = clamp(Math.round(30 + 6 * t), 20, 40);
    straightRunMax = clamp(3 + Math.floor(t * 2), 2, 6);
    terminalRate = clamp(Math.round(12 + 6 * t), 12, 24);
    terminalSpacing = clamp(Math.round(5 - 3 * t), 1, 5);
    gapClusters = clamp(Math.round(1 + 2 * t), 0, 4);
    centerBias = clamp(Math.round(5 + 35 * t), 0, 100);

    crossRate = 0;
    if (level >= 50) {
      const crossT = (level - 50) / (RAMP_END_LEVEL - 50);
      crossRate = clamp(Math.round(1 + 4 * crossT), 0, 12);
    }
  } else {
    // Finale plateau: levels 181-200, all 60 tiles, ramp other complexity.
    const f = (level - (RAMP_END_LEVEL + 1)) / (TOTAL_LEVELS - RAMP_END_LEVEL - 1);
    curveBias = clamp(Math.round(36 + 4 * f), 20, 40);
    straightRunMax = clamp(Math.round(5 - 3 * f), 2, 6);
    terminalRate = clamp(Math.round(18 + 6 * f), 12, 24);
    terminalSpacing = clamp(Math.max(1, Math.round(2 - f)), 1, 5);
    gapClusters = 3;
    centerBias = clamp(Math.round(40 + 60 * f), 0, 100);
    crossRate = clamp(Math.round(5 + 7 * f), 0, 12);
  }

  const emptyRun = clamp(Math.round(gapRate / 19), 0, 5);

  let variant = (level * 7) % 10;

  const isMilestone = level % 20 === 19 && level < TOTAL_LEVELS;
  if (isMilestone) {
    crossRate = clamp(crossRate + 2, 0, 12);
    curveBias = clamp(curveBias + 3, 20, 40);
    variant = (level + 3) % 10;
  }

  return {
    gapRate,
    gapClusters,
    curveBias,
    terminalRate,
    straightRunMax,
    terminalSpacing,
    emptyRowMax: emptyRun,
    emptyColMax: emptyRun,
    centerBias,
    crossRate,
    variant
  };
}

function buildSeed(p) {
  return [
    "P" + p.gapRate,
    p.gapClusters,
    p.curveBias,
    p.terminalRate,
    p.straightRunMax,
    p.terminalSpacing,
    p.emptyRowMax,
    p.emptyColMax,
    p.centerBias,
    p.crossRate,
    p.variant
  ].join("-");
}

function parseSeed(seed) {
  if (!seed) return null;
  const parts = seed.replace(/^P/, "").split("-").map(Number);
  if (parts.length < 10 || parts.some((n) => !Number.isFinite(n))) return null;
  const [
    gapRate,
    gapClusters,
    curveBias,
    terminalRate,
    straightRunMax,
    terminalSpacing,
    emptyRowMax,
    emptyColMax,
    centerBias,
    crossOrVariant,
    maybeVariant
  ] = parts;
  // Legacy 10-field seeds put variant where crossRate now sits.
  const crossRate = parts.length >= 11 ? crossOrVariant : 1;
  return { gapRate, gapClusters, curveBias, terminalRate, straightRunMax, terminalSpacing, emptyRowMax, emptyColMax, centerBias, crossRate };
}

function tilesFromSeed(seed) {
  const parsed = parseSeed(seed);
  if (!parsed) return null;
  const gapCells = Math.min(56, Math.round((TOTAL_CELLS * parsed.gapRate) / 100 / 4) * 4);
  return TOTAL_CELLS - gapCells;
}

async function main() {
  const raw = await fs.readFile(LEVELS_PATH, "utf-8");
  const existing = JSON.parse(raw);
  const out = Array.from({ length: TOTAL_LEVELS }, (_, i) => existing[i] || "");

  let filled = 0;
  let preserved = 0;
  for (let i = 0; i < TOTAL_LEVELS; i += 1) {
    if (out[i]) {
      preserved += 1;
      continue;
    }
    out[i] = buildSeed(paramsForLevel(i + 1));
    filled += 1;
  }

  // Verify monotonic tile counts.
  let prevTiles = 0;
  const monotonicBreaks = [];
  out.forEach((seed, idx) => {
    const tiles = tilesFromSeed(seed);
    if (tiles === null) return;
    if (tiles < prevTiles) monotonicBreaks.push({ level: idx + 1, tiles, prevTiles });
    prevTiles = tiles;
  });
  if (monotonicBreaks.length) {
    console.warn(`⚠ ${monotonicBreaks.length} monotonic breaks (tile count decreased):`);
    monotonicBreaks.slice(0, 5).forEach((b) => console.warn(`  lvl ${b.level}: ${b.tiles} tiles < prev ${b.prevTiles}`));
  } else {
    console.log("✓ Tile counts are monotonically non-decreasing.");
  }

  // Verify the finale plateau.
  const finaleAllFull = out.slice(RAMP_END_LEVEL).every((s) => tilesFromSeed(s) === 60);
  console.log(`${finaleAllFull ? "✓" : "⚠"} Levels ${RAMP_END_LEVEL + 1}-${TOTAL_LEVELS} ${finaleAllFull ? "are" : "are NOT all"} full boards (60 tiles).`);

  // Uniqueness check.
  const seen = new Map();
  const dupes = [];
  out.forEach((seed, idx) => {
    if (!seed) return;
    if (seen.has(seed)) dupes.push([idx + 1, seen.get(seed) + 1, seed]);
    else seen.set(seed, idx);
  });
  if (dupes.length) {
    console.warn(`⚠ ${dupes.length} duplicate seeds:`);
    dupes.slice(0, 5).forEach(([a, b, seed]) => console.warn(`  lvl ${a} == lvl ${b}: ${seed}`));
  } else {
    console.log("✓ All seeds unique.");
  }

  await fs.writeFile(LEVELS_PATH, JSON.stringify(out, null, 2) + "\n");
  console.log(`✓ Wrote ${TOTAL_LEVELS} levels (${preserved} preserved, ${filled} generated).`);

  console.log("\nSample curve:");
  [1, 4, 5, 20, 50, 100, 150, 180, 181, 199, 200].forEach((l) => {
    if (l > TOTAL_LEVELS) return;
    const seed = out[l - 1];
    const tiles = tilesFromSeed(seed);
    console.log(`  lvl ${String(l).padStart(3)}: ${seed.padEnd(28)}  → ${tiles} tiles`);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
