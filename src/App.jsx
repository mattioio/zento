import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { usePwaRegister } from "./pwaRegister.js";
import { audioAttribution, audioTracks } from "./audioManifest.js";
import bakedProgressionLevels from "./progressionLevels.json";
import { storage } from "./storage.js";
import {
  ANALYTICS_CONSENT,
  getAnalyticsConsent,
  initAnalytics,
  setAnalyticsConsent as persistAnalyticsConsent,
  track
} from "./analytics.js";
import {
  useHasFullGame,
  usePriceString,
  purchaseFullGame,
  refreshEntitlements,
  restorePurchases,
  getHasFullGame,
  setDevUnlock
} from "./entitlements.js";
import { applyStatusBarForBackground, hideSplash, impactLight, impactMedium, isOtherAudioPlaying, onAppStateChange, onAudioInterruption, onOtherAudioChange, openExternal, requestReview } from "./native.js";

// --- Error Boundary ---
export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  componentDidCatch(error, info) {
    console.error("Zento crashed:", error, info?.componentStack);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
          minHeight: "100vh", padding: "2rem", textAlign: "center",
          background: "radial-gradient(circle at top, #fff7ea 0%, #f2ede4 55%, #e8e0d6 100%)",
          fontFamily: "'Work Sans', sans-serif", color: "#3b352f",
        }}>
          <p style={{ fontSize: "1.1rem", marginBottom: "1.5rem" }}>Something went wrong.</p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{
              padding: "12px 28px", fontSize: "1rem", fontFamily: "inherit",
              border: "none", borderRadius: "12px", cursor: "pointer",
              background: "rgba(255,255,255,0.6)", color: "#3b352f",
              boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
            }}
          >
            Tap to reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

const ROWS = 10;
const COLS = 6;
const DEFAULT_TOTAL_LEVELS = 200;
const MIN_TOTAL_LEVELS = 1;
const MAX_TOTAL_LEVELS = 999;

const DIFFICULTY_TIERS = [
  { id: "dawn", label: "Still", description: "A calm surface, plenty of openings", locked: false },
  { id: "morning", label: "Drift", description: "A gentle current of paths", locked: false },
  { id: "noon", label: "Ripple", description: "Light patterns emerge", locked: false },
  { id: "dusk", label: "Wave", description: "A flowing, balanced challenge", locked: true },
  { id: "twilight", label: "Swell", description: "Stronger currents, denser paths", locked: true },
  { id: "midnight", label: "Tide", description: "A surging, fully packed board", locked: true }
];
const DIFFICULTY_IDS = DIFFICULTY_TIERS.map((tier) => tier.id);
const LEGACY_DIFFICULTY_MIGRATION = { easy: "dusk", medium: "twilight", hard: "midnight" };
const FREE_MAX_LEVEL = 20;
const MIN_TILES = 4;

const TILE_TYPES = [
  "blank",
  "terminal",
  "straight",
  "curveLeft",
  "curveRight",
  "tJunction"
];

const PROGRESSION_SETTINGS_RANGES = {
  gapRate: { min: 0, max: 96 },
  gapClusters: { min: 0, max: 4 },
  curveBias: { min: 20, max: 40 },
  terminalRate: { min: 12, max: 24 },
  terminalSpacing: { min: 1, max: 5 },
  straightRunMax: { min: 2, max: 6 },
  emptyRowMax: { min: 0, max: 5 },
  emptyColMax: { min: 0, max: 5 },
  centerBias: { min: 0, max: 100 },
  crossRate: { min: 0, max: 12 },
  variant: { min: 0, max: 9 }
};

const DEFAULT_PROGRESSION_SETTINGS = {
  gapRate: 18,
  gapClusters: 2,
  curveBias: 28,
  terminalRate: 18,
  terminalSpacing: 2,
  straightRunMax: 4,
  emptyRowMax: 2,
  emptyColMax: 2,
  centerBias: 0,
  crossRate: 1,
  variant: 0
};

const BASE_EDGES = {
  blank: [false, false, false, false],
  terminal: [false, false, true, false],
  straight: [true, false, true, false],
  curveLeft: [true, false, false, true],
  curveRight: [true, true, false, false],
  tJunction: [true, true, false, true],
  crossCurve: [true, true, true, true]
};

function clampValue(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function normalizeProgressionSettings(settings) {
  const next = { ...DEFAULT_PROGRESSION_SETTINGS };
  if (!settings || typeof settings !== "object") return next;
  Object.entries(PROGRESSION_SETTINGS_RANGES).forEach(([key, range]) => {
    const raw = Number(settings[key]);
    if (Number.isFinite(raw)) {
      next[key] = clampValue(Math.round(raw), range.min, range.max);
    }
  });
  return next;
}

function normalizeLevelList(list, count = DEFAULT_TOTAL_LEVELS) {
  const source = Array.isArray(list)
    ? list
    : list && typeof list === "object" && Array.isArray(list.levels)
      ? list.levels
      : [];
  const length = Math.max(count, source.length);
  return Array.from({ length }, (_, index) => {
    const value = source[index];
    return typeof value === "string" ? value : "";
  });
}

function buildProgressionSeed(settings) {
  const normalized = normalizeProgressionSettings(settings);
  return `P${normalized.gapRate}-${normalized.gapClusters}-${normalized.curveBias}-${normalized.terminalRate}-${normalized.straightRunMax}-${normalized.terminalSpacing}-${normalized.emptyRowMax}-${normalized.emptyColMax}-${normalized.centerBias}-${normalized.crossRate}-${normalized.variant}`;
}

function parseProgressionSeed(seedText) {
  if (!seedText || typeof seedText !== "string") return null;
  const matchV3 = seedText.match(
    /^P(\d+)-(\d+)-(\d+)-(\d+)-(\d+)-(\d+)-(\d+)-(\d+)-(\d+)-(\d+)-(\d+)$/i
  );
  if (matchV3) {
    return normalizeProgressionSettings({
      gapRate: Number(matchV3[1]),
      gapClusters: Number(matchV3[2]),
      curveBias: Number(matchV3[3]),
      terminalRate: Number(matchV3[4]),
      straightRunMax: Number(matchV3[5]),
      terminalSpacing: Number(matchV3[6]),
      emptyRowMax: Number(matchV3[7]),
      emptyColMax: Number(matchV3[8]),
      centerBias: Number(matchV3[9]),
      crossRate: Number(matchV3[10]),
      variant: Number(matchV3[11])
    });
  }
  const match = seedText.match(
    /^P(\d+)-(\d+)-(\d+)-(\d+)-(\d+)-(\d+)-(\d+)-(\d+)-(\d+)-(\d+)$/i
  );
  if (match) {
    return normalizeProgressionSettings({
      gapRate: Number(match[1]),
      gapClusters: Number(match[2]),
      curveBias: Number(match[3]),
      terminalRate: Number(match[4]),
      straightRunMax: Number(match[5]),
      terminalSpacing: Number(match[6]),
      emptyRowMax: Number(match[7]),
      emptyColMax: Number(match[8]),
      centerBias: Number(match[9]),
      variant: Number(match[10])
    });
  }
  const legacyMatch = seedText.match(
    /^P(\d+)-(\d+)-(\d+)-(\d+)-(\d+)-(\d+)-(\d+)-(\d+)-(\d+)$/i
  );
  if (legacyMatch) {
    return normalizeProgressionSettings({
      gapRate: Number(legacyMatch[1]),
      gapClusters: Number(legacyMatch[2]),
      curveBias: Number(legacyMatch[3]),
      terminalRate: Number(legacyMatch[4]),
      straightRunMax: Number(legacyMatch[5]),
      terminalSpacing: Number(legacyMatch[6]),
      emptyRowMax: Number(legacyMatch[7]),
      emptyColMax: Number(legacyMatch[8]),
      variant: Number(legacyMatch[9])
    });
  }
  const legacyMatchShort = seedText.match(/^P(\d+)-(\d+)-(\d+)-(\d+)-(\d+)-(\d+)$/i);
  if (!legacyMatchShort) return null;
  return normalizeProgressionSettings({
    gapRate: Number(legacyMatchShort[1]),
    gapClusters: Number(legacyMatchShort[2]),
    curveBias: Number(legacyMatchShort[3]),
    terminalRate: Number(legacyMatchShort[4]),
    straightRunMax: Number(legacyMatchShort[5]),
    variant: Number(legacyMatchShort[6])
  });
}

function metaToProgressionDeltas(meta) {
  const difficulty = clampValue(Math.round(Number(meta.difficulty) || 0), 0, 100);
  const pathStyle = clampValue(Math.round(Number(meta.pathStyle) || 0), 0, 100);
  const gapLayout = clampValue(Math.round(Number(meta.gapLayout) || 0), 0, 100);
  const terminals = clampValue(Math.round(Number(meta.terminals) || 0), 0, 100);
  const crosses = clampValue(Math.round(Number(meta.crosses) || 0), 0, 100);
  const gapRate = clampValue(Math.round((100 - difficulty) * 0.94), 0, 96);
  const emptyRun = clampValue(Math.round(gapRate / 19), 0, 5);
  return {
    gapRate,
    emptyRowMax: emptyRun,
    emptyColMax: emptyRun,
    curveBias: clampValue(Math.round(20 + pathStyle * 0.2), 20, 40),
    straightRunMax: clampValue(Math.round(6 - pathStyle * 0.04), 2, 6),
    gapClusters: clampValue(Math.round(1 + gapLayout * 0.03), 0, 4),
    centerBias: clampValue(Math.round(gapLayout), 0, 100),
    terminalRate: clampValue(Math.round(12 + terminals * 0.12), 12, 24),
    terminalSpacing: clampValue(Math.round(5 - terminals * 0.04), 1, 5),
    crossRate: clampValue(Math.round(crosses * 0.12), 0, 12)
  };
}

function progressionToMeta(settings) {
  const n = normalizeProgressionSettings(settings);
  return {
    difficulty: clampValue(Math.round(100 - n.gapRate / 0.94), 0, 100),
    pathStyle: clampValue(Math.round((n.curveBias - 20) / 0.2), 0, 100),
    gapLayout: clampValue(Math.round(n.centerBias), 0, 100),
    terminals: clampValue(Math.round((n.terminalRate - 12) / 0.12), 0, 100),
    crosses: clampValue(Math.round(n.crossRate / 0.12), 0, 100)
  };
}

function progressionSettingsToBoardConfig(settings) {
  const normalized = normalizeProgressionSettings(settings);
  const totalCells = ROWS * COLS;
  const gapCellsRaw = Math.round((totalCells * normalized.gapRate) / 100);
  const maxBlankCells = Math.max(0, totalCells - MIN_TILES);
  const maxBlankCellsSnapped = Math.floor(maxBlankCells / 4) * 4;
  const gapCells = Math.min(
    maxBlankCellsSnapped,
    Math.max(0, Math.round(gapCellsRaw / 4) * 4)
  );
  const clusters = gapCells === 0 ? 0 : normalized.gapClusters;
  const minClusterCells = clusters === 0 ? 0 : 4 + clusters * 2;
  const minTerminals = Math.max(4, Math.round((totalCells * normalized.terminalRate) / 100));
  const maxTerminals = Math.min(totalCells, minTerminals + 6);
  return {
    blanks: {
      min: gapCells,
      max: gapCells,
      clusters,
      minClusterCells,
      maxEmptyRowRun: normalized.emptyRowMax,
      maxEmptyColRun: normalized.emptyColMax,
      centerBias: normalized.centerBias / 100
    },
    curveRatio: normalized.curveBias / 100,
    minTerminals,
    maxTerminals,
    maxStraightRunAllowed: normalized.straightRunMax,
    minTerminalDistance: normalized.terminalSpacing,
    maxTerminalClusterAllowed: 3,
    maxCrosses: normalized.crossRate
  };
}

function hashStringToInt(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed) {
  let t = seed >>> 0;
  return function random() {
    t += 0x6D2B79F5;
    let x = t;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

function getSymmetricCells(r, c, rows, cols) {
  const set = new Set();
  const pairs = [
    [r, c],
    [rows - 1 - r, c],
    [r, cols - 1 - c],
    [rows - 1 - r, cols - 1 - c]
  ];
  pairs.forEach(([rr, cc]) => set.add(`${rr}-${cc}`));
  return Array.from(set);
}

function applySymmetricBlanks(
  edgesByCell,
  rows,
  cols,
  rand,
  targetCells,
  clusterCount,
  minClusterCells = 0,
  maxEmptyRowRun = Infinity,
  maxEmptyColRun = Infinity,
  centerBias = 0
) {
  if (targetCells <= 0) return;
  const gridRows = Math.ceil(rows / 2);
  const gridCols = Math.ceil(cols / 2);
  const groups = [];
  const indexGrid = Array.from({ length: gridRows }, () => Array(gridCols).fill(-1));
  for (let r = 0; r < gridRows; r += 1) {
    for (let c = 0; c < gridCols; c += 1) {
      const cells = getSymmetricCells(r, c, rows, cols);
      if (cells.length !== 4) {
        continue;
      }
      const index = groups.length;
      groups.push({ r, c, cells });
      indexGrid[r][c] = index;
    }
  }
  const totalGroups = groups.length;
  const maxBlankGroups = Math.max(0, totalGroups - 1);
  const groupTarget = Math.min(
    maxBlankGroups,
    Math.max(1, Math.round(targetCells / 4))
  );

  const biasStrength = clampValue(centerBias, 0, 1);
  const centerRow = (rows - 1) / 2;
  const centerCol = (cols - 1) / 2;
  const maxDist = Math.abs(centerRow) + Math.abs(centerCol) || 1;
  const groupWeights = groups.map((group) => {
    if (biasStrength <= 0) return 1;
    const dist =
      Math.abs(group.r - centerRow) + Math.abs(group.c - centerCol);
    const normalized = dist / maxDist;
    const power = 1 + biasStrength * 2.5;
    const weighted = Math.pow(normalized, power);
    return 1 + weighted * (1 + biasStrength * 8);
  });

  const pickWeightedIndex = (available) => {
    if (available.length === 0) return -1;
    if (biasStrength <= 0 || rand() > biasStrength) {
      return available[Math.floor(rand() * available.length)];
    }
    let total = 0;
    available.forEach((idx) => {
      total += groupWeights[idx] ?? 1;
    });
    let roll = rand() * total;
    for (let i = 0; i < available.length; i += 1) {
      const idx = available[i];
      roll -= groupWeights[idx] ?? 1;
      if (roll <= 0) return idx;
    }
    return available[available.length - 1];
  };

  const selectGroupsInClusters = (clusterCountValue) => {
    const minGroups = Math.max(1, Math.ceil(minClusterCells / 4));
    const chosen = new Set();
    const clusters = [];
    const clusterTotal = Math.max(1, clusterCountValue || 1);
    const maxClusterTotal = Math.max(1, Math.floor(groupTarget / minGroups));
    const finalClusterTotal = Math.min(clusterTotal, maxClusterTotal);
    for (let i = 0; i < finalClusterTotal; i += 1) {
      const available = [];
      for (let idx = 0; idx < groups.length; idx += 1) {
        if (!chosen.has(idx)) available.push(idx);
      }
      const seedIndex = pickWeightedIndex(available);
      if (seedIndex >= 0) {
        chosen.add(seedIndex);
        clusters.push([seedIndex]);
      }
    }

    const neighborIndices = (group) => {
      const dirs = [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1]
      ];
      const list = [];
      dirs.forEach(([dr, dc]) => {
        const nr = group.r + dr;
        const nc = group.c + dc;
        if (nr >= 0 && nr < gridRows && nc >= 0 && nc < gridCols) {
          const idx = indexGrid[nr][nc];
          if (idx >= 0) list.push(idx);
        }
      });
      return list;
    };

    while (chosen.size < groupTarget) {
      const clusterIndex = Math.floor(rand() * clusters.length);
      const cluster = clusters[clusterIndex];
      const anchorIndex = cluster[Math.floor(rand() * cluster.length)];
      const neighbors = neighborIndices(groups[anchorIndex]).filter((idx) => !chosen.has(idx));
      if (neighbors.length > 0) {
        const nextIndex = neighbors[Math.floor(rand() * neighbors.length)];
        chosen.add(nextIndex);
        cluster.push(nextIndex);
        if (cluster.length < minGroups) {
          continue;
        }
      } else {
        const available = [];
        for (let idx = 0; idx < groups.length; idx += 1) {
          if (!chosen.has(idx)) available.push(idx);
        }
        const nextIndex = pickWeightedIndex(available);
        if (nextIndex >= 0) {
          chosen.add(nextIndex);
          cluster.push(nextIndex);
          if (cluster.length < minGroups) {
            continue;
          }
        } else {
          break;
        }
      }
    }
    return Array.from(chosen);
  };

  const isConnected = (blankSet) => {
    const total = rows * cols - blankSet.size;
    if (total <= 0) return true;
    let start = null;
    for (let r = 0; r < rows && !start; r += 1) {
      for (let c = 0; c < cols; c += 1) {
        const key = `${r}-${c}`;
        if (!blankSet.has(key)) {
          start = [r, c];
          break;
        }
      }
    }
    if (!start) return true;
    const queue = [start];
    const visited = new Set([`${start[0]}-${start[1]}`]);
    while (queue.length) {
      const [r, c] = queue.shift();
      const neighbors = [
        [r + 1, c],
        [r - 1, c],
        [r, c + 1],
        [r, c - 1]
      ];
      neighbors.forEach(([nr, nc]) => {
        if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) return;
        const key = `${nr}-${nc}`;
        if (blankSet.has(key) || visited.has(key)) return;
        visited.add(key);
        queue.push([nr, nc]);
      });
    }
    return visited.size === total;
  };

  const maxEmptyRun = (blankSet, axis) => {
    let maxRun = 0;
    let run = 0;
    const outer = axis === "row" ? rows : cols;
    const inner = axis === "row" ? cols : rows;
    for (let o = 0; o < outer; o += 1) {
      let empty = true;
      for (let i = 0; i < inner; i += 1) {
        const r = axis === "row" ? o : i;
        const c = axis === "row" ? i : o;
        if (!blankSet.has(`${r}-${c}`)) {
          empty = false;
          break;
        }
      }
      if (empty) {
        run += 1;
        if (run > maxRun) maxRun = run;
      } else {
        run = 0;
      }
    }
    return maxRun;
  };

  let blanks = new Set();
  let attempts = 0;
  while (attempts < 40) {
    blanks = new Set();
    const grouped = selectGroupsInClusters(clusterCount);
    const blankGroups = new Set(grouped);
    for (const groupIndex of grouped) {
      if (blanks.size >= groupTarget * 4) break;
      groups[groupIndex].cells.forEach((key) => blanks.add(key));
    }
    if (
      biasStrength >= 0.4 &&
      blankGroups.size > 0 &&
      blankGroups.size < totalGroups
    ) {
      const keepGroups = [];
      for (let i = 0; i < totalGroups; i += 1) {
        if (!blankGroups.has(i)) keepGroups.push(i);
      }
      const keepCount = keepGroups.length;
      if (keepCount > 0) {
        const sortedByCenter = Array.from({ length: totalGroups }, (_, idx) => idx).sort(
          (a, b) => {
            const da =
              Math.abs(groups[a].r - centerRow) + Math.abs(groups[a].c - centerCol);
            const db =
              Math.abs(groups[b].r - centerRow) + Math.abs(groups[b].c - centerCol);
            return da - db;
          }
        );
        const desiredCount = Math.max(1, Math.round(keepCount * biasStrength));
        const desiredSet = new Set(sortedByCenter.slice(0, desiredCount));
        const missing = Array.from(desiredSet).filter((idx) => blankGroups.has(idx));
        if (missing.length > 0) {
          const removable = keepGroups
            .filter((idx) => !desiredSet.has(idx))
            .sort((a, b) => {
              const da =
                Math.abs(groups[a].r - centerRow) + Math.abs(groups[a].c - centerCol);
              const db =
                Math.abs(groups[b].r - centerRow) + Math.abs(groups[b].c - centerCol);
              return db - da;
            });
          const swapCount = Math.min(missing.length, removable.length);
          if (swapCount > 0) {
            for (let i = 0; i < swapCount; i += 1) {
              blankGroups.delete(missing[i]);
              blankGroups.add(removable[i]);
            }
            blanks = new Set();
            blankGroups.forEach((idx) => {
              groups[idx].cells.forEach((key) => blanks.add(key));
            });
          }
        }
      }
    }
    const emptyRowRun = maxEmptyRun(blanks, "row");
    const emptyColRun = maxEmptyRun(blanks, "col");
    if (
      blanks.size === groupTarget * 4 &&
      isConnected(blanks) &&
      emptyRowRun <= maxEmptyRowRun &&
      emptyColRun <= maxEmptyColRun
    ) {
      break;
    }
    attempts += 1;
  }

  blanks.forEach((key) => {
    const [r, c] = key.split("-").map(Number);
    const edges = edgesByCell.get(key) || [false, false, false, false];
    const dirs = [0, 1, 2, 3];
    dirs.forEach((dir) => {
      if (!edges[dir]) return;
      const nr = r + (dir === 2 ? 1 : dir === 0 ? -1 : 0);
      const nc = c + (dir === 1 ? 1 : dir === 3 ? -1 : 0);
      const neighborKey = `${nr}-${nc}`;
      const neighborEdges = edgesByCell.get(neighborKey) || [false, false, false, false];
      edges[dir] = false;
      neighborEdges[oppositeDir(dir)] = false;
      edgesByCell.set(key, edges);
      edgesByCell.set(neighborKey, neighborEdges);
    });
    edgesByCell.set(key, [false, false, false, false]);
  });
}

function makeBoard(seedText, difficulty = "medium") {
  const seed = hashStringToInt(seedText || "zen");
  let rand = mulberry32(seed);
  let edgesByCell = null;
  const progressionSettings = parseProgressionSeed(seedText);
  const progressionConfig = progressionSettings
    ? progressionSettingsToBoardConfig(progressionSettings)
    : null;
  const difficultyConfig = {
    dawn: { min: 44, max: 52, clusters: 6, minClusterCells: 4, maxEmptyRowRun: 6, maxEmptyColRun: 6 },
    morning: { min: 32, max: 40, clusters: 5, minClusterCells: 5, maxEmptyRowRun: 5, maxEmptyColRun: 5 },
    noon: { min: 22, max: 30, clusters: 4, minClusterCells: 5, maxEmptyRowRun: 4, maxEmptyColRun: 4 },
    dusk: { min: 12, max: 20, clusters: 3, minClusterCells: 6, maxEmptyRowRun: 3, maxEmptyColRun: 3 },
    twilight: { min: 2, max: 10, clusters: 2, minClusterCells: 6, maxEmptyRowRun: 2, maxEmptyColRun: 2 },
    midnight: { min: 0, max: 0, clusters: 0, minClusterCells: 0, maxEmptyRowRun: 0, maxEmptyColRun: 0 }
  };
  const baseConfig = progressionConfig?.blanks || difficultyConfig[difficulty] || difficultyConfig.twilight;
  const blankMin = Math.max(0, Math.floor(baseConfig.min));
  const blankMax = Math.max(blankMin, Math.floor(baseConfig.max));
  const curveRatioByDifficulty = {
    dawn: 0.40,
    morning: 0.36,
    noon: 0.34,
    dusk: 0.32,
    twilight: 0.28,
    midnight: 0.24
  };
  const curveRatio = progressionConfig?.curveRatio ?? curveRatioByDifficulty[difficulty] ?? 0.28;
  const minTerminalsDefault = Math.max(6, Math.floor((ROWS * COLS) * 0.12));
  const maxTerminalsDefault = Math.max(minTerminalsDefault + 2, Math.floor((ROWS * COLS) * 0.22));
  const minTerminals = progressionConfig?.minTerminals ?? minTerminalsDefault;
  const maxTerminals = progressionConfig?.maxTerminals ?? maxTerminalsDefault;
  const maxStraightRunAllowed = progressionConfig?.maxStraightRunAllowed ?? 4;
  const minTerminalDistance = progressionConfig?.minTerminalDistance ?? 2;
  const maxTerminalClusterAllowed = progressionConfig?.maxTerminalClusterAllowed ?? 3;
  let attemptSeed = 0;
  while (attemptSeed < 60) {
    rand = mulberry32(seed + attemptSeed * 97);
    edgesByCell = generateSolvedEdges(ROWS, COLS, rand, {
      maxCrosses: progressionConfig?.maxCrosses ?? 1
    });
    if (blankMax > 0) {
      const targetCount = blankMin + Math.floor(rand() * (blankMax - blankMin + 1));
      applySymmetricBlanks(
        edgesByCell,
        ROWS,
        COLS,
        rand,
        targetCount,
        baseConfig.clusters,
        baseConfig.minClusterCells,
        baseConfig.maxEmptyRowRun,
        baseConfig.maxEmptyColRun,
        baseConfig.centerBias ?? 0
      );
    }
    const terminals = countTerminals(edgesByCell, ROWS, COLS);
    const longestRun = maxStraightRun(edgesByCell, ROWS, COLS);
    const tooClustered = hasCloseTerminals(edgesByCell, ROWS, COLS, minTerminalDistance);
    const terminalClusterSize = maxTerminalCluster(edgesByCell, ROWS, COLS);
    const edgeConnected = isEdgeGraphConnected(edgesByCell, ROWS, COLS);
    const { curves, nonBlank } = countCurves(edgesByCell, ROWS, COLS);
    const minCurves = nonBlank === 0 ? 0 : Math.max(8, Math.round(nonBlank * curveRatio));
    if (
      terminals >= minTerminals &&
      terminals <= maxTerminals &&
      longestRun <= maxStraightRunAllowed &&
      !tooClustered &&
      terminalClusterSize <= maxTerminalClusterAllowed &&
      edgeConnected &&
      curves >= minCurves
    ) {
      break;
    }
    attemptSeed += 1;
  }
  const tiles = [];

  for (let r = 0; r < ROWS; r += 1) {
    for (let c = 0; c < COLS; c += 1) {
      const edges = edgesByCell.get(`${r}-${c}`) || [false, false, false, false];
      const { type, rotation } = pickTypeForEdges(edges);
      tiles.push({
        id: `${r}-${c}`,
        r,
        c,
        type,
        rotation: rotation,
        rotationDegrees: rotation * 90,
        targetRotation: rotation
      });
    }
  }

  const scrambleWithoutSolved = () => {
    const next = tiles.map((tile) => {
      const offset = Math.floor(rand() * 4);
      const rotationScrambled = (tile.targetRotation + offset) % 4;
      return {
        ...tile,
        rotation: rotationScrambled,
        rotationDegrees: rotationScrambled * 90
      };
    });
    const connections = computeConnections(next);
    const completeDirs = computeCompleteDirs(next, connections);
    const hasSolved = next.some((tile) => {
      const dirs = completeDirs.get(tile.id) || [false, false, false, false];
      return dirs.some(Boolean);
    });
    return { next, hasSolved };
  };

  let attempt = 0;
  let result = scrambleWithoutSolved();
  while (result.hasSolved && attempt < 20) {
    attempt += 1;
    result = scrambleWithoutSolved();
  }

  return result.next;
}

function rotateEdges(edges, rotation) {
  let [n, e, s, w] = edges;
  for (let i = 0; i < rotation; i += 1) {
    [n, e, s, w] = [w, n, e, s];
  }
  return [n, e, s, w];
}

function getEdges(tile) {
  const base = BASE_EDGES[tile.type];
  if (!base) return [false, false, false, false];
  if (tile.type === "crossCurve") return [true, true, true, true];
  return rotateEdges(base, tile.rotation);
}

function edgesEqual(a, b) {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3];
}

function pickTypeForEdges(edges) {
  const degree = edges.filter(Boolean).length;
  let candidates = [];
  if (degree === 0) candidates = ["blank"];
  if (degree === 1) candidates = ["terminal"];
  if (degree === 2) {
    const isStraight = (edges[0] && edges[2]) || (edges[1] && edges[3]);
    candidates = isStraight ? ["straight"] : ["curveLeft", "curveRight"];
  }
  if (degree === 3) candidates = ["tJunction"];
  if (degree === 4) candidates = ["crossCurve"];

  for (const type of candidates) {
    const base = BASE_EDGES[type];
    for (let rotation = 0; rotation < 4; rotation += 1) {
      const rotated = type === "crossCurve" ? base : rotateEdges(base, rotation);
      if (edgesEqual(rotated, edges)) {
        return { type, rotation };
      }
    }
  }
  return { type: "blank", rotation: 0 };
}

function isBoundaryCell(r, c, rows, cols) {
  return r === 0 || c === 0 || r === rows - 1 || c === cols - 1;
}

function mirrorCoord(r, c, rows, cols, mode) {
  if (mode === "v") return [r, cols - 1 - c];
  if (mode === "h") return [rows - 1 - r, c];
  if (mode === "vh") return [rows - 1 - r, cols - 1 - c];
  return [r, c];
}

function mirrorDir(dir, mode) {
  let d = dir;
  if (mode.includes("v")) {
    if (d === 1) d = 3;
    else if (d === 3) d = 1;
  }
  if (mode.includes("h")) {
    if (d === 0) d = 2;
    else if (d === 2) d = 0;
  }
  return d;
}

function canAddEdge(edgesByCell, r1, c1, r2, c2, dir, maxDegree) {
  const edgesA = edgesByCell.get(`${r1}-${c1}`) || [false, false, false, false];
  const edgesB = edgesByCell.get(`${r2}-${c2}`) || [false, false, false, false];
  if (edgesA[dir]) return false;
  const degreeA = edgesA.filter(Boolean).length;
  const degreeB = edgesB.filter(Boolean).length;
  if (degreeA + 1 > maxDegree || degreeB + 1 > maxDegree) return false;
  return true;
}

function addEdge(edgesByCell, r1, c1, r2, c2, dir) {
  const keyA = `${r1}-${c1}`;
  const keyB = `${r2}-${c2}`;
  const edgesA = edgesByCell.get(keyA) || [false, false, false, false];
  const edgesB = edgesByCell.get(keyB) || [false, false, false, false];
  edgesA[dir] = true;
  edgesB[oppositeDir(dir)] = true;
  edgesByCell.set(keyA, edgesA);
  edgesByCell.set(keyB, edgesB);
}

function generateSolvedEdges(rows, cols, rand, options = {}) {
  const edgesByCell = new Map();
  const visited = new Set();
  const stack = [];

  const start = [0, 0, null];
  stack.push(start);
  visited.add(`${start[0]}-${start[1]}`);
  edgesByCell.set(`${start[0]}-${start[1]}`, [false, false, false, false]);

  while (stack.length) {
    const [r, c, prevDir] = stack[stack.length - 1];
    const neighbors = [];
    if (r > 0 && !visited.has(`${r - 1}-${c}`)) neighbors.push([r - 1, c, 0]);
    if (c < cols - 1 && !visited.has(`${r}-${c + 1}`)) neighbors.push([r, c + 1, 1]);
    if (r < rows - 1 && !visited.has(`${r + 1}-${c}`)) neighbors.push([r + 1, c, 2]);
    if (c > 0 && !visited.has(`${r}-${c - 1}`)) neighbors.push([r, c - 1, 3]);

    if (neighbors.length === 0) {
      stack.pop();
      continue;
    }

    let nextNeighbor = null;
    if (prevDir !== null && prevDir !== undefined) {
      const turnDirs = new Set([(prevDir + 1) % 4, (prevDir + 3) % 4]);
      const turnNeighbors = neighbors.filter((neighbor) => turnDirs.has(neighbor[2]));
      if (turnNeighbors.length > 0 && rand() < 0.85) {
        nextNeighbor = turnNeighbors[Math.floor(rand() * turnNeighbors.length)];
      }
    }
    if (!nextNeighbor) {
      nextNeighbor = neighbors[Math.floor(rand() * neighbors.length)];
    }
    const [nr, nc, dir] = nextNeighbor;
    const currentKey = `${r}-${c}`;
    const nextKey = `${nr}-${nc}`;

    const currentEdges = edgesByCell.get(currentKey) || [false, false, false, false];
    const nextEdges = edgesByCell.get(nextKey) || [false, false, false, false];
    currentEdges[dir] = true;
    nextEdges[oppositeDir(dir)] = true;
    edgesByCell.set(currentKey, currentEdges);
    edgesByCell.set(nextKey, nextEdges);

    visited.add(nextKey);
    stack.push([nr, nc, dir]);
  }

  // Add extra edges to create cycles / higher-degree nodes (crosses).
  const candidates = [];
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      if (r < rows - 1) candidates.push([r, c, r + 1, c]);
      if (c < cols - 1) candidates.push([r, c, r, c + 1]);
    }
  }

  const maxCrosses = options.maxCrosses ?? 1;
  const maxTJunctions = Math.max(2, Math.floor((rows * cols) / 6));
  const extraEdgesTarget = Math.max(1, Math.floor((rows * cols) / 7));
  let added = 0;
  const countCrosses = () => {
    let count = 0;
    for (let r = 0; r < rows; r += 1) {
      for (let c = 0; c < cols; c += 1) {
        const edges = edgesByCell.get(`${r}-${c}`) || [false, false, false, false];
        if (edges.filter(Boolean).length === 4) count += 1;
      }
    }
    return count;
  };

  const countTJunctions = () => {
    let count = 0;
    for (let r = 0; r < rows; r += 1) {
      for (let c = 0; c < cols; c += 1) {
        const edges = edgesByCell.get(`${r}-${c}`) || [false, false, false, false];
        if (edges.filter(Boolean).length === 3) count += 1;
      }
    }
    return count;
  };

  for (let i = 0; i < candidates.length && added < extraEdgesTarget; i += 1) {
    const swapIndex = i + Math.floor(rand() * (candidates.length - i));
    [candidates[i], candidates[swapIndex]] = [candidates[swapIndex], candidates[i]];

    const [r1, c1, r2, c2] = candidates[i];
    const keyA = `${r1}-${c1}`;
    const keyB = `${r2}-${c2}`;
    const dir = r2 > r1 ? 2 : r2 < r1 ? 0 : c2 > c1 ? 1 : 3;
    const edgesA = edgesByCell.get(keyA) || [false, false, false, false];
    const edgesB = edgesByCell.get(keyB) || [false, false, false, false];

    if (edgesA[dir]) continue;

    const degreeA = edgesA.filter(Boolean).length;
    const degreeB = edgesB.filter(Boolean).length;
    if (degreeA >= 4 || degreeB >= 4) continue;

    // Avoid creating a 4-way cross on boundary cells.
    const nextDegreeA = degreeA + 1;
    const nextDegreeB = degreeB + 1;
    if (nextDegreeA === 4 && isBoundaryCell(r1, c1, rows, cols)) continue;
    if (nextDegreeB === 4 && isBoundaryCell(r2, c2, rows, cols)) continue;

    edgesA[dir] = true;
    edgesB[oppositeDir(dir)] = true;
    edgesByCell.set(keyA, edgesA);
    edgesByCell.set(keyB, edgesB);
    if (countCrosses() <= maxCrosses) {
      added += 1;
    } else {
      edgesA[dir] = false;
      edgesB[oppositeDir(dir)] = false;
      edgesByCell.set(keyA, edgesA);
      edgesByCell.set(keyB, edgesB);
    }
  }

  // Promote interior degree-3 nodes to degree-4 when possible (to create crosses).
  const promotionTargets = [];
  for (let r = 1; r < rows - 1; r += 1) {
    for (let c = 1; c < cols - 1; c += 1) {
      const key = `${r}-${c}`;
      const edges = edgesByCell.get(key) || [false, false, false, false];
      const degree = edges.filter(Boolean).length;
      if (degree === 3) promotionTargets.push([r, c]);
    }
  }

  for (let i = 0; i < promotionTargets.length; i += 1) {
    const swapIndex = i + Math.floor(rand() * (promotionTargets.length - i));
    [promotionTargets[i], promotionTargets[swapIndex]] = [
      promotionTargets[swapIndex],
      promotionTargets[i]
    ];
  }

  for (const [r, c] of promotionTargets) {
    if (countCrosses() >= maxCrosses) break;
    const key = `${r}-${c}`;
    const edges = edgesByCell.get(key) || [false, false, false, false];
    const missingDirs = [0, 1, 2, 3].filter((dir) => !edges[dir]);
    for (const dir of missingDirs) {
      const nr = r + (dir === 2 ? 1 : dir === 0 ? -1 : 0);
      const nc = c + (dir === 1 ? 1 : dir === 3 ? -1 : 0);
      const neighborKey = `${nr}-${nc}`;
      const neighborEdges = edgesByCell.get(neighborKey) || [false, false, false, false];
      const neighborDegree = neighborEdges.filter(Boolean).length;
      if (neighborDegree >= 4) continue;
      if (neighborDegree === 3 && isBoundaryCell(nr, nc, rows, cols)) continue;
      edges[dir] = true;
      neighborEdges[oppositeDir(dir)] = true;
      edgesByCell.set(key, edges);
      edgesByCell.set(neighborKey, neighborEdges);
      if (countCrosses() > maxCrosses) {
        edges[dir] = false;
        neighborEdges[oppositeDir(dir)] = false;
        edgesByCell.set(key, edges);
        edgesByCell.set(neighborKey, neighborEdges);
      } else {
        break;
      }
    }
  }

  // Apply soft 4-way symmetry to edges (mirror with small omissions).
  const softness = 0.18;
  const keys = Array.from(edgesByCell.keys());
  keys.forEach((key) => {
    const [r, c] = key.split("-").map(Number);
    const edges = edgesByCell.get(key) || [false, false, false, false];
    edges.forEach((hasEdge, dir) => {
      if (!hasEdge) return;
      const [vr, vc] = mirrorCoord(r, c, rows, cols, "v");
      const [hr, hc] = mirrorCoord(r, c, rows, cols, "h");
      const [vrh, vch] = mirrorCoord(r, c, rows, cols, "vh");
      const dirV = mirrorDir(dir, "v");
      const dirH = mirrorDir(dir, "h");
      const dirVH = mirrorDir(dir, "vh");

      const mirrorPairs = [
        [vr, vc, dirV],
        [hr, hc, dirH],
        [vrh, vch, dirVH]
      ];

      mirrorPairs.forEach(([mr, mc, mdir]) => {
        if (rand() < softness) return;
        const nr = mr + (mdir === 2 ? 1 : mdir === 0 ? -1 : 0);
        const nc = mc + (mdir === 1 ? 1 : mdir === 3 ? -1 : 0);
        if (nr < 0 || nc < 0 || nr >= rows || nc >= cols) return;
        if (canAddEdge(edgesByCell, mr, mc, nr, nc, mdir, 3)) {
          addEdge(edgesByCell, mr, mc, nr, nc, mdir);
        }
      });
    });
  });

  // Defensive pass: if a boundary cell ended up with degree 4, drop one edge.
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      if (!isBoundaryCell(r, c, rows, cols)) continue;
      const key = `${r}-${c}`;
      const edges = edgesByCell.get(key) || [false, false, false, false];
      const degree = edges.filter(Boolean).length;
      if (degree !== 4) continue;
      const dirs = [0, 1, 2, 3].filter((d) => edges[d]);
      const dropDir = dirs[Math.floor(rand() * dirs.length)];
      const nr = r + (dropDir === 2 ? 1 : dropDir === 0 ? -1 : 0);
      const nc = c + (dropDir === 1 ? 1 : dropDir === 3 ? -1 : 0);
      const neighborKey = `${nr}-${nc}`;
      const neighborEdges = edgesByCell.get(neighborKey) || [false, false, false, false];
      edges[dropDir] = false;
      neighborEdges[oppositeDir(dropDir)] = false;
      edgesByCell.set(key, edges);
      edgesByCell.set(neighborKey, neighborEdges);
    }
  }

  const isConnectedGraph = () => {
    const start = "0-0";
    const visitedNodes = new Set();
    const stackNodes = [start];
    while (stackNodes.length) {
      const key = stackNodes.pop();
      if (visitedNodes.has(key)) continue;
      visitedNodes.add(key);
      const [r, c] = key.split("-").map(Number);
      const edges = edgesByCell.get(key) || [false, false, false, false];
      const neighbors = [
        [r - 1, c],
        [r, c + 1],
        [r + 1, c],
        [r, c - 1]
      ];
      edges.forEach((hasEdge, dir) => {
        if (!hasEdge) return;
        const [nr, nc] = neighbors[dir];
        if (nr < 0 || nc < 0 || nr >= rows || nc >= cols) return;
        stackNodes.push(`${nr}-${nc}`);
      });
    }
    return visitedNodes.size === rows * cols;
  };

  const canRemoveEdge = (r, c, dir) => {
    const nr = r + (dir === 2 ? 1 : dir === 0 ? -1 : 0);
    const nc = c + (dir === 1 ? 1 : dir === 3 ? -1 : 0);
    if (nr < 0 || nc < 0 || nr >= rows || nc >= cols) return false;
    const keyA = `${r}-${c}`;
    const keyB = `${nr}-${nc}`;
    const edgesA = edgesByCell.get(keyA) || [false, false, false, false];
    const edgesB = edgesByCell.get(keyB) || [false, false, false, false];
    if (!edgesA[dir]) return false;
    edgesA[dir] = false;
    edgesB[oppositeDir(dir)] = false;
    edgesByCell.set(keyA, edgesA);
    edgesByCell.set(keyB, edgesB);
    const connected = isConnectedGraph();
    if (!connected) {
      edgesA[dir] = true;
      edgesB[oppositeDir(dir)] = true;
      edgesByCell.set(keyA, edgesA);
      edgesByCell.set(keyB, edgesB);
      return false;
    }
    return true;
  };

  // Enforce hard max cross count by removing non-bridge edges from degree-4 cells.
  let crosses = countCrosses();
  if (crosses > maxCrosses) {
    const crossCells = [];
    for (let r = 0; r < rows; r += 1) {
      for (let c = 0; c < cols; c += 1) {
        const edges = edgesByCell.get(`${r}-${c}`) || [false, false, false, false];
        if (edges.filter(Boolean).length === 4) crossCells.push([r, c]);
      }
    }
    for (let i = 0; i < crossCells.length && crosses > maxCrosses; i += 1) {
      const swapIndex = i + Math.floor(rand() * (crossCells.length - i));
      [crossCells[i], crossCells[swapIndex]] = [crossCells[swapIndex], crossCells[i]];
      const [r, c] = crossCells[i];
      const dirs = [0, 1, 2, 3];
      for (let d = 0; d < dirs.length && crosses > maxCrosses; d += 1) {
        const dir = dirs[d];
        if (canRemoveEdge(r, c, dir)) {
          crosses = countCrosses();
          break;
        }
      }
    }
  }

  // Reduce degree-3 nodes to balance tile types.
  let tCount = countTJunctions();
  if (tCount > maxTJunctions) {
    const tCells = [];
    for (let r = 0; r < rows; r += 1) {
      for (let c = 0; c < cols; c += 1) {
        const edges = edgesByCell.get(`${r}-${c}`) || [false, false, false, false];
        if (edges.filter(Boolean).length === 3) tCells.push([r, c]);
      }
    }
    for (let i = 0; i < tCells.length && tCount > maxTJunctions; i += 1) {
      const swapIndex = i + Math.floor(rand() * (tCells.length - i));
      [tCells[i], tCells[swapIndex]] = [tCells[swapIndex], tCells[i]];
      const [r, c] = tCells[i];
      const edges = edgesByCell.get(`${r}-${c}`) || [false, false, false, false];
      const dirs = [0, 1, 2, 3].filter((dir) => edges[dir]);
      for (let d = 0; d < dirs.length && tCount > maxTJunctions; d += 1) {
        if (canRemoveEdge(r, c, dirs[d])) {
          tCount = countTJunctions();
          break;
        }
      }
    }
  }

  return edgesByCell;
}

function countTerminals(edgesByCell, rows, cols) {
  let count = 0;
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const edges = edgesByCell.get(`${r}-${c}`) || [false, false, false, false];
      if (edges.filter(Boolean).length === 1) count += 1;
    }
  }
  return count;
}

function countCurves(edgesByCell, rows, cols) {
  let curves = 0;
  let nonBlank = 0;
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const edges = edgesByCell.get(`${r}-${c}`) || [false, false, false, false];
      const degree = edges.filter(Boolean).length;
      if (degree === 0) continue;
      nonBlank += 1;
      if (degree === 2) {
        const isStraight = (edges[0] && edges[2]) || (edges[1] && edges[3]);
        if (!isStraight) curves += 1;
      }
    }
  }
  return { curves, nonBlank };
}

function isEdgeGraphConnected(edgesByCell, rows, cols) {
  let start = null;
  let total = 0;
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const edges = edgesByCell.get(`${r}-${c}`) || [false, false, false, false];
      if (edges.filter(Boolean).length > 0) {
        total += 1;
        if (!start) start = [r, c];
      }
    }
  }
  if (total <= 1) return true;

  const visited = new Set();
  const queue = [start];
  visited.add(`${start[0]}-${start[1]}`);
  while (queue.length) {
    const [r, c] = queue.shift();
    const edges = edgesByCell.get(`${r}-${c}`) || [false, false, false, false];
    edges.forEach((hasEdge, dir) => {
      if (!hasEdge) return;
      const nr = r + (dir === 2 ? 1 : dir === 0 ? -1 : 0);
      const nc = c + (dir === 1 ? 1 : dir === 3 ? -1 : 0);
      if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) return;
      const neighborEdges = edgesByCell.get(`${nr}-${nc}`) || [false, false, false, false];
      if (neighborEdges.filter(Boolean).length === 0) return;
      const key = `${nr}-${nc}`;
      if (visited.has(key)) return;
      visited.add(key);
      queue.push([nr, nc]);
    });
  }
  return visited.size === total;
}

function hasCloseTerminals(edgesByCell, rows, cols, minDistance) {
  const terminals = [];
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const edges = edgesByCell.get(`${r}-${c}`) || [false, false, false, false];
      if (edges.filter(Boolean).length === 1) terminals.push([r, c]);
    }
  }
  for (let i = 0; i < terminals.length; i += 1) {
    for (let j = i + 1; j < terminals.length; j += 1) {
      const dr = Math.abs(terminals[i][0] - terminals[j][0]);
      const dc = Math.abs(terminals[i][1] - terminals[j][1]);
      if (dr + dc < minDistance) return true;
    }
  }
  return false;
}

function maxTerminalCluster(edgesByCell, rows, cols) {
  const visited = new Set();
  let maxSize = 0;
  const isTerminal = (r, c) => {
    const edges = edgesByCell.get(`${r}-${c}`) || [false, false, false, false];
    return edges.filter(Boolean).length === 1;
  };
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const key = `${r}-${c}`;
      if (visited.has(key) || !isTerminal(r, c)) continue;
      let size = 0;
      const queue = [[r, c]];
      visited.add(key);
      while (queue.length) {
        const [cr, cc] = queue.shift();
        size += 1;
        const neighbors = [
          [cr + 1, cc],
          [cr - 1, cc],
          [cr, cc + 1],
          [cr, cc - 1]
        ];
        neighbors.forEach(([nr, nc]) => {
          if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) return;
          const nKey = `${nr}-${nc}`;
          if (visited.has(nKey) || !isTerminal(nr, nc)) return;
          visited.add(nKey);
          queue.push([nr, nc]);
        });
      }
      if (size > maxSize) maxSize = size;
    }
  }
  return maxSize;
}

function maxStraightRun(edgesByCell, rows, cols) {
  let maxRun = 0;
  for (let c = 0; c < cols; c += 1) {
    let run = 0;
    for (let r = 0; r < rows; r += 1) {
      const edges = edgesByCell.get(`${r}-${c}`) || [false, false, false, false];
      const isVertical = edges[0] && edges[2] && !edges[1] && !edges[3];
      if (isVertical) {
        run += 1;
        if (run > maxRun) maxRun = run;
      } else {
        run = 0;
      }
    }
  }
  for (let r = 0; r < rows; r += 1) {
    let run = 0;
    for (let c = 0; c < cols; c += 1) {
      const edges = edgesByCell.get(`${r}-${c}`) || [false, false, false, false];
      const isHorizontal = edges[1] && edges[3] && !edges[0] && !edges[2];
      if (isHorizontal) {
        run += 1;
        if (run > maxRun) maxRun = run;
      } else {
        run = 0;
      }
    }
  }
  return maxRun;
}

function oppositeDir(dir) {
  return (dir + 2) % 4;
}

function connectionBitmask(connections) {
  return (
    (connections[0] ? 1 : 0) |
    (connections[1] ? 2 : 0) |
    (connections[2] ? 4 : 0) |
    (connections[3] ? 8 : 0)
  );
}

function computeConnections(tiles) {
  const byId = new Map();
  const byPos = new Map();
  tiles.forEach((tile) => {
    byId.set(tile.id, tile);
    byPos.set(`${tile.r}-${tile.c}`, tile);
  });

  const connections = new Map();

  tiles.forEach((tile) => {
    const edges = getEdges(tile);
    const connected = [false, false, false, false];
    const neighbors = [
      byPos.get(`${tile.r - 1}-${tile.c}`),
      byPos.get(`${tile.r}-${tile.c + 1}`),
      byPos.get(`${tile.r + 1}-${tile.c}`),
      byPos.get(`${tile.r}-${tile.c - 1}`)
    ];

    edges.forEach((hasEdge, dir) => {
      if (!hasEdge) return;
      const neighbor = neighbors[dir];
      if (!neighbor) return;
      const neighborEdges = getEdges(neighbor);
      if (neighborEdges[oppositeDir(dir)]) {
        connected[dir] = true;
      }
    });

    connections.set(tile.id, connected);
  });

  return connections;
}

function getInternalPortPairs(tile, edges) {
  if (tile.type === "crossCurve") {
    const parity = tile.rotation % 2;
    return parity === 0
      ? [
          [0, 3],
          [1, 2]
        ]
      : [
          [0, 1],
          [2, 3]
        ];
  }
  const dirs = [];
  edges.forEach((on, dir) => {
    if (on) dirs.push(dir);
  });
  if (dirs.length === 2) return [[dirs[0], dirs[1]]];
  if (dirs.length === 3) {
    return [
      [dirs[0], dirs[1]],
      [dirs[1], dirs[2]],
      [dirs[0], dirs[2]]
    ];
  }
  return [];
}

function computeCompleteDirs(tiles, connections) {
  const byId = new Map();
  const byPos = new Map();
  tiles.forEach((tile) => {
    byId.set(tile.id, tile);
    byPos.set(`${tile.r}-${tile.c}`, tile);
  });

  const portAdj = new Map();
  const danglingPorts = new Set();
  const allPorts = [];

  tiles.forEach((tile) => {
    const edges = getEdges(tile);
    const connected = connections.get(tile.id) || [false, false, false, false];
    const keyBase = tile.id;

    edges.forEach((hasEdge, dir) => {
      if (!hasEdge) return;
      const port = `${keyBase}:${dir}`;
      allPorts.push(port);
      if (!portAdj.has(port)) portAdj.set(port, new Set());
      if (!connected[dir]) {
        danglingPorts.add(port);
      }
    });

    const internalPairs = getInternalPortPairs(tile, edges);
    internalPairs.forEach(([a, b]) => {
      const portA = `${keyBase}:${a}`;
      const portB = `${keyBase}:${b}`;
      if (portAdj.has(portA) && portAdj.has(portB)) {
        portAdj.get(portA).add(portB);
        portAdj.get(portB).add(portA);
      }
    });
  });

  tiles.forEach((tile) => {
    const connected = connections.get(tile.id) || [false, false, false, false];
    const neighbors = [
      byPos.get(`${tile.r - 1}-${tile.c}`),
      byPos.get(`${tile.r}-${tile.c + 1}`),
      byPos.get(`${tile.r + 1}-${tile.c}`),
      byPos.get(`${tile.r}-${tile.c - 1}`)
    ];

    connected.forEach((isConnected, dir) => {
      if (!isConnected) return;
      const neighbor = neighbors[dir];
      if (!neighbor) return;
      const portA = `${tile.id}:${dir}`;
      const portB = `${neighbor.id}:${oppositeDir(dir)}`;
      if (portAdj.has(portA) && portAdj.has(portB)) {
        portAdj.get(portA).add(portB);
        portAdj.get(portB).add(portA);
      }
    });
  });

  const visitedPorts = new Set();
  const completePorts = new Set();

  allPorts.forEach((port) => {
    if (visitedPorts.has(port)) return;
    const stack = [port];
    const component = [];
    let hasDangling = false;

    while (stack.length) {
      const current = stack.pop();
      if (!current || visitedPorts.has(current)) continue;
      visitedPorts.add(current);
      component.push(current);
      if (danglingPorts.has(current)) hasDangling = true;
      const neighbors = portAdj.get(current) || [];
      neighbors.forEach((next) => {
        if (!visitedPorts.has(next)) stack.push(next);
      });
    }

    if (!hasDangling) {
      component.forEach((p) => completePorts.add(p));
    }
  });

  const completeDirs = new Map();
  tiles.forEach((tile) => {
    const dirs = [false, false, false, false];
    for (let dir = 0; dir < 4; dir += 1) {
      if (completePorts.has(`${tile.id}:${dir}`)) dirs[dir] = true;
    }
    completeDirs.set(tile.id, dirs);
  });

  return completeDirs;
}

function Tile({ tile, onRotate }) {
  const localCompleteDirs = rotateEdges(
    tile.completeDirs || [false, false, false, false],
    (4 - tile.rotation) % 4
  );
  const isTileComplete = localCompleteDirs.some(Boolean);
  const tileStyle = {};
  if (typeof tile.pulseDelay === "number") {
    tileStyle["--pulse-delay"] = `${tile.pulseDelay}ms`;
  }
  if (typeof tile.waveDelay === "number") {
    tileStyle["--wave-delay"] = `${tile.waveDelay}ms`;
  }
  const tileStyleProps = Object.keys(tileStyle).length > 0 ? tileStyle : undefined;
  return (
    <button
      type="button"
      className={`tile ${tile.type === "blank" ? "tile-blank" : ""} ${isTileComplete ? "tile-complete" : ""} ${typeof tile.pulseDelay === "number" ? "tile-pulse" : ""} ${tile.waveActive ? "tile-wave" : ""}`}
      onClick={onRotate}
      style={tileStyleProps}
      aria-label={`Tile ${tile.r + 1}, ${tile.c + 1}`}
      disabled={tile.type === "blank"}
    >
      <span className="tile-face" />
      <div
        className="tile-graphic"
        style={{ transform: `rotate(${tile.rotationDegrees}deg)` }}
      >
        <TileSVG type={tile.type} completeDirs={localCompleteDirs} />
      </div>
    </button>
  );
}

function TileSVG({ type, completeDirs }) {
  const [n, e, s, w] = completeDirs || [false, false, false, false];
  const isSegmentComplete = (dirs) => dirs.every((dir) => completeDirs?.[dir]);
  return (
    <svg viewBox="0 0 100 100" aria-hidden="true">
      <g
        className="tile-stroke"
        fill="none"
        stroke="currentColor"
        strokeWidth="8"
        strokeLinecap="round"
      >
        {type === "blank" && null}
        {type === "terminal" && (
          <>
            <circle
              cx="50"
              cy="50"
              r="9"
              className={isSegmentComplete([2]) ? "tile-stroke-complete" : ""}
            />
            <circle
              cx="50"
              cy="50"
              r="4"
              fill="var(--tile-bg)"
              stroke="none"
            />
            <line
              x1="50"
              y1="59"
              x2="50"
              y2="95"
              className={isSegmentComplete([2]) ? "tile-stroke-complete" : ""}
            />
          </>
        )}
        {type === "straight" && (
          <line
            x1="50"
            y1="5"
            x2="50"
            y2="95"
            className={isSegmentComplete([0, 2]) ? "tile-stroke-complete" : ""}
          />
        )}
        {type === "curveLeft" && (
          <path
            d="M 50 5 Q 50 50 5 50"
            className={isSegmentComplete([0, 3]) ? "tile-stroke-complete" : ""}
          />
        )}
        {type === "curveRight" && (
          <path
            d="M 50 5 Q 50 50 95 50"
            className={isSegmentComplete([0, 1]) ? "tile-stroke-complete" : ""}
          />
        )}
        {type === "tJunction" && (
          <>
            <line
              x1="50"
              y1="5"
              x2="50"
              y2="50"
              className={isSegmentComplete([0]) ? "tile-stroke-complete" : ""}
            />
            <line
              x1="5"
              y1="50"
              x2="95"
              y2="50"
              className={isSegmentComplete([1, 3]) ? "tile-stroke-complete" : ""}
            />
          </>
        )}
        {type === "crossCurve" && (
          <>
            <path
              d="M 50 5 Q 50 50 5 50"
              className={isSegmentComplete([0, 3]) ? "tile-stroke-complete" : ""}
            />
            <path
              d="M 50 5 Q 50 50 5 50"
              transform="rotate(180 50 50)"
              className={isSegmentComplete([1, 2]) ? "tile-stroke-complete" : ""}
            />
          </>
        )}
      </g>
    </svg>
  );
}

function Logo({ className = "", interactive = false, onClick, title, ariaLabel }) {
  return (
    <span className={`logo-text ${className}`.trim()}>
      <span className="logo-word">ZENT</span>
      {interactive ? (
        <button
          type="button"
          className="title-cta logo-mark"
          onClick={onClick}
          aria-label={ariaLabel}
          title={title}
        >
          ō
        </button>
      ) : (
        <span className="logo-mark">ō</span>
      )}
    </span>
  );
}

function ThemePanel({
  themeMode,
  themeIndex,
  themes,
  unlockedThemeLevels,
  hasFullGame,
  priceString,
  onOpenPaywall,
  showThemePicker,
  themePickerMounted,
  onTogglePicker,
  onSelectRandom,
  onSelectTheme
}) {
  const activeTheme = themes[themeIndex] || themes[0];
  const activeThemeLabel = activeTheme?.nightMode ? "Night mode" : activeTheme?.name;
  const activeSleepLevel = Number(activeTheme?.sleepLevel) || 1;
  const showActiveSwatch = themeMode !== "random" && activeTheme?.showSwatch !== false;
  const coreThemes = themes
    .map((theme, index) => ({ theme, index }))
    .filter(({ theme }) => !theme.unlockable && !theme.nightMode);
  const nightThemes = themes
    .map((theme, index) => ({ theme, index }))
    .filter(({ theme }) => theme.nightMode);
  const unlockableThemes = themes
    .map((theme, index) => ({ theme, index }))
    .filter(({ theme }) => theme.unlockable);
  return (
    <div className="theme-panel theme-panel-card">
      <p className="theme-title">Theme</p>
      <div className="theme-summary">
        <span className="theme-label">
          {themeMode === "random" ? "Shuffle" : activeThemeLabel || "Theme"}
        </span>
        {themeMode === "random" ? (
          <span className="theme-swatches">
            <span className="theme-swatch theme-swatch-random" />
          </span>
        ) : activeTheme?.nightMode ? (
          <span className="theme-swatches theme-swatches-night">
            <span className="theme-sleep" aria-hidden="true">
              <span className={`sleep-z-stack sleep-z-stack-${activeSleepLevel}`}>
                <span className="sleep-z sleep-z-1">Z</span>
                {activeSleepLevel >= 2 ? <span className="sleep-z sleep-z-2">Z</span> : null}
                {activeSleepLevel >= 3 ? <span className="sleep-z sleep-z-3">Z</span> : null}
              </span>
            </span>
          </span>
        ) : showActiveSwatch ? (
          <span className="theme-swatches">
            {(activeTheme?.colors || themes[0].colors).slice(0, 1).map((color) => (
              <span key={color} className="theme-swatch" style={{ background: color }} />
            ))}
          </span>
        ) : null}
      </div>
      <button
        type="button"
        className="button button-ghost theme-toggle theme-toggle-full"
        onClick={onTogglePicker}
      >
        {showThemePicker ? "Close" : "Change theme"}
      </button>
      {themePickerMounted ? (
        <div className={`theme-accordion${showThemePicker ? " is-open" : ""}`}>
          <div className="theme-group-title theme-group-title--basic">Basic themes</div>
          <button
            type="button"
            className={`theme-button theme-button-wide is-full${
              themeMode === "random" ? " is-active is-random" : ""
            }`}
            onClick={onSelectRandom}
          >
            <span className="theme-label">Shuffle</span>
            <span className="theme-swatches">
              <span className="theme-swatch theme-swatch-random" />
            </span>
          </button>
          {coreThemes.map(({ theme, index }) => {
            const isActive = themeMode === "fixed" && index === themeIndex;
            const showSwatch = theme.showSwatch !== false;
            return (
              <button
                key={theme.name}
                type="button"
                className={`theme-button theme-button-wide${
                  isActive ? " is-active" : ""
                }${theme.fullWidth ? " is-full" : ""}${
                  theme.kind === "neumorphic" ? " is-neumorphic" : ""
                }`}
                onClick={() => onSelectTheme(index)}
              >
                <span className="theme-label">{theme.name}</span>
                {showSwatch ? (
                  <span className="theme-swatches">
                    {theme.colors.slice(0, 1).map((color) => (
                      <span key={color} className="theme-swatch" style={{ background: color }} />
                    ))}
                  </span>
                ) : null}
              </button>
            );
          })}
          {!hasFullGame && (nightThemes.length || unlockableThemes.length) ? (
            <div className="difficulty-unlock-row">
              <button type="button" className="difficulty-unlock-cta" onClick={onOpenPaywall}>
                <svg className="difficulty-unlock-icon" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                  <path d="M7 11V8a5 5 0 0 1 10 0v3" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  <rect x="5" y="11" width="14" height="10" rx="2" fill="currentColor" />
                </svg>
                <span>{priceString ? `Unlock all themes for ${priceString}` : "Unlock all themes"}</span>
              </button>
            </div>
          ) : null}
          {nightThemes.length ? (
            <div className="theme-group-header theme-group-header--night">
              <div className="theme-group-title">Night modes</div>
            </div>
          ) : null}
          {nightThemes.length ? (
            <div className="theme-night-row">
              {nightThemes.map(({ theme, index }) => {
                const isActive = themeMode === "fixed" && index === themeIndex;
                const sleepLevel = Number(theme.sleepLevel) || 1;
                const isLocked = !hasFullGame;
                return (
                  <button
                    key={theme.name}
                    type="button"
                    className={`theme-button theme-night-card is-night${
                      isActive ? " is-active" : ""
                    }${isLocked ? " is-locked" : ""}`}
                    onClick={() => {
                      if (isLocked) {
                        onOpenPaywall?.();
                        return;
                      }
                      onSelectTheme(index);
                    }}
                    aria-label={isLocked ? `${theme.name} (locked)` : theme.name}
                  >
                    <span className="theme-label theme-label-hidden" aria-hidden="true">
                      Night mode
                    </span>
                    <span className="theme-sleep" aria-hidden="true">
                      <span className="theme-sleep-optic">
                        <span className={`sleep-z-stack sleep-z-stack-${sleepLevel}`}>
                          <span className="sleep-z sleep-z-1">Z</span>
                          {sleepLevel >= 2 ? <span className="sleep-z sleep-z-2">Z</span> : null}
                          {sleepLevel >= 3 ? <span className="sleep-z sleep-z-3">Z</span> : null}
                        </span>
                      </span>
                    </span>
                    {isLocked ? (
                      <span className="theme-lock-corner" aria-hidden="true">
                        <svg viewBox="0 0 24 24" width="14" height="14">
                          <path d="M7 11V8a5 5 0 0 1 10 0v3" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                          <rect x="5" y="11" width="14" height="10" rx="2" fill="currentColor" />
                        </svg>
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          ) : null}
          {unlockableThemes.length ? (
            <div className="theme-group-header">
              <div className="theme-group-title">Unlockable themes</div>
            </div>
          ) : null}
          {unlockableThemes.map(({ theme, index }) => {
            const isActive = themeMode === "fixed" && index === themeIndex;
            const unlockLevel = Number(theme.unlockLevel);
            const isUnlocked =
              Number.isFinite(unlockLevel) && unlockedThemeLevels?.has(unlockLevel);
            const isLocked = !isUnlocked;
            return (
              <button
                key={theme.name}
                type="button"
                className={`theme-button theme-button-wide is-unlockable${
                  isActive ? " is-active" : ""
                }${theme.fullWidth ? " is-full" : ""}${
                  isLocked ? " is-locked" : ""
                }`}
                onClick={() => {
                  if (isLocked) return;
                  onSelectTheme(index);
                }}
                disabled={isLocked}
              >
                <span className="theme-label">{theme.name}</span>
                {isLocked ? (
                  <span className="theme-lock">
                    <span className="theme-lock-icon" aria-hidden="true">
                      <svg viewBox="0 0 24 24" role="presentation">
                        <path
                          d="M7 11V8.5a5 5 0 0 1 10 0V11"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.8"
                          strokeLinecap="round"
                        />
                        <rect
                          x="5.5"
                          y="11"
                          width="13"
                          height="9"
                          rx="2.2"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.8"
                        />
                        <path
                          d="M12 14.2v2.6"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.8"
                          strokeLinecap="round"
                        />
                      </svg>
                    </span>
                    <span className="theme-lock-level">Lvl {theme.unlockLevel || "X"}</span>
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function PlayerCard({
  nowPlaying,
  onPrev,
  onNext,
  onToggle,
  isPaused,
  isLoading,
  audioAttribution,
  isSubCard
}) {
  return (
    <div className={`player-card${isSubCard ? " is-subcard" : ""}`}>
      <div className="player-main">
        <div className="player-info">
          <p className="player-label">Now Playing</p>
          <p className="player-title">{nowPlaying || "—"}</p>
        </div>
        <div className="player-controls">
          <button type="button" className="player-button" onClick={onPrev} aria-label="Previous track">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M7 6v12M19 6l-8 6 8 6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <button
            type="button"
            className={`player-button player-button-main${isLoading ? " is-loading" : ""}`}
            onClick={onToggle}
            aria-label={isPaused ? "Play" : "Pause"}
            aria-busy={isLoading}
          >
            {isPaused ? (
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M8 6l10 6-10 6z" fill="currentColor" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M8 6h3v12H8zM13 6h3v12h-3z" fill="currentColor" />
              </svg>
            )}
          </button>
          <button type="button" className="player-button" onClick={onNext} aria-label="Next track">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M17 6v12M5 6l8 6-8 6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
      </div>
      <CreditsFooter audioAttribution={audioAttribution} />
    </div>
  );
}

function DifficultyIcon({ id }) {
  const common = {
    className: "difficulty-option-icon",
    viewBox: "0 0 24 24",
    width: 26,
    height: 26,
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.7,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    "aria-hidden": true
  };
  const wave = (y, delay = 0) => (
    <path
      key={y}
      className="ripple-wave"
      style={{ animationDelay: `${delay}s` }}
      d={`M -12 ${y} q 2 -1.6 4 0 t 4 0 t 4 0 t 4 0 t 4 0 t 4 0 t 4 0 t 4 0 t 4 0 t 4 0 t 4 0 t 4 0`}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
    />
  );
  if (id === "dawn") {
    return (
      <svg {...common}>
        <line x1="4" y1="12" x2="20" y2="12" />
      </svg>
    );
  }
  if (id === "morning") {
    return <svg {...common}>{wave(12)}</svg>;
  }
  if (id === "noon") {
    return <svg {...common}>{wave(9, 0)}{wave(15, -1)}</svg>;
  }
  if (id === "dusk") {
    return <svg {...common}>{wave(7, 0)}{wave(12, -0.7)}{wave(17, -1.4)}</svg>;
  }
  if (id === "twilight") {
    return <svg {...common}>{wave(5.5, 0)}{wave(10, -0.5)}{wave(14, -1)}{wave(18.5, -1.5)}</svg>;
  }
  if (id === "midnight") {
    return <svg {...common}>{wave(4.5, 0)}{wave(8.5, -0.4)}{wave(12, -0.8)}{wave(15.5, -1.2)}{wave(19.5, -1.6)}</svg>;
  }
  return null;
}

function useBottomSheetDrag(onDismiss) {
  const sheetRef = useRef(null);
  const dragRef = useRef(null);

  const onPointerDown = useCallback((e) => {
    if (!e.isPrimary || e.button === 2) return;
    const sheet = sheetRef.current;
    if (!sheet) return;
    dragRef.current = { y: e.clientY, t: Date.now(), height: sheet.getBoundingClientRect().height };
    sheet.style.transition = "none";
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch (err) {}
  }, []);

  const onPointerMove = useCallback((e) => {
    const drag = dragRef.current;
    const sheet = sheetRef.current;
    if (!drag || !sheet) return;
    const dy = Math.max(0, e.clientY - drag.y);
    sheet.style.transform = `translateY(${dy}px)`;
  }, []);

  const finishDrag = useCallback((e) => {
    const drag = dragRef.current;
    const sheet = sheetRef.current;
    if (!drag || !sheet) return;
    const dy = Math.max(0, e.clientY - drag.y);
    const elapsed = Math.max(1, Date.now() - drag.t);
    const velocity = dy / elapsed;
    sheet.style.transition = "transform 220ms ease-out";
    const shouldDismiss = dy > drag.height * 0.25 || velocity > 0.5;
    if (shouldDismiss) {
      sheet.style.transform = `translateY(${drag.height}px)`;
      window.setTimeout(onDismiss, 180);
    } else {
      sheet.style.transform = "";
    }
    dragRef.current = null;
  }, [onDismiss]);

  return {
    sheetRef,
    handleProps: {
      onPointerDown,
      onPointerMove,
      onPointerUp: finishDrag,
      onPointerCancel: finishDrag,
    },
  };
}

function DifficultySheet({
  tiers,
  hasFullGame,
  priceString,
  onSelect,
  onUnlock,
  onClose
}) {
  const { sheetRef, handleProps } = useBottomSheetDrag(onClose);
  const freeTiers = tiers.filter((tier) => !tier.locked);
  const lockedTiers = tiers.filter((tier) => tier.locked);
  const renderOption = (tier) => {
    const isLocked = tier.locked && !hasFullGame;
    return (
      <li key={tier.id}>
        <button
          type="button"
          className={`difficulty-option${isLocked ? " is-locked" : ""}`}
          onClick={() => onSelect(tier)}
        >
          <DifficultyIcon id={tier.id} />
          <span className="difficulty-option-text">
            <span className="difficulty-option-label">{tier.label}</span>
            <span className="difficulty-option-desc">{tier.description}</span>
          </span>
        </button>
      </li>
    );
  };
  return (
    <div className="modal-backdrop bottom-sheet-backdrop" onClick={onClose} role="dialog" aria-modal="true">
      <div ref={sheetRef} className="modal bottom-sheet difficulty-sheet" onClick={(event) => event.stopPropagation()}>
        <div className="bottom-sheet-handle bottom-sheet-grab" {...handleProps} aria-hidden="true" />
        <p className="modal-title">Choose difficulty</p>
        <ul className="difficulty-list">
          {freeTiers.map(renderOption)}
          {lockedTiers.length > 0 && !hasFullGame ? (
            <li className="difficulty-unlock-row">
              <button type="button" className="difficulty-unlock-cta" onClick={onUnlock}>
                <svg className="difficulty-unlock-icon" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                  <path d="M7 11V8a5 5 0 0 1 10 0v3" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  <rect x="5" y="11" width="14" height="10" rx="2" fill="currentColor" />
                </svg>
                <span>{priceString ? `Unlock for ${priceString}` : "Unlock more challenge"}</span>
              </button>
            </li>
          ) : null}
          {lockedTiers.map(renderOption)}
        </ul>
        <div className="modal-actions">
          <button type="button" className="button button-ghost" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

function ThemeSwitcherFab({ themes, themeIndex, onSelectTheme, hasFullGame, onToggleUnlock }) {
  const [open, setOpen] = useState(false);
  const { sheetRef, handleProps } = useBottomSheetDrag(() => setOpen(false));
  const themeGroups = useMemo(() => {
    const colors = [];
    const nightModes = [];
    const unlockable = [];
    themes.forEach((theme, index) => {
      const entry = { theme, index };
      if (theme.unlockable) unlockable.push(entry);
      else if (theme.nightMode) nightModes.push(entry);
      else colors.push(entry);
    });
    return [
      { label: "Colors", entries: colors },
      { label: "Night mode", entries: nightModes },
      { label: "Unlockable", entries: unlockable }
    ];
  }, [themes]);
  const renderChip = ({ theme, index }) => {
    const isActive = index === themeIndex;
    const swatch = theme.colors?.[2] || theme.colors?.[1] || "#888";
    return (
      <button
        key={theme.name}
        type="button"
        role="tab"
        aria-selected={isActive}
        className={`theme-switcher-chip${isActive ? " is-active" : ""}`}
        onClick={() => {
          onSelectTheme(index);
          setOpen(false);
        }}
      >
        <span className="theme-switcher-chip-swatch" style={{ background: swatch }} aria-hidden="true" />
        <span className="theme-switcher-chip-name">{theme.name}</span>
      </button>
    );
  };
  return (
    <>
      <button
        type="button"
        className="theme-fab"
        onClick={() => setOpen(true)}
        aria-label="Switch theme"
        title="Switch theme"
      >
        <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
          <path d="M12 3a9 9 0 1 0 0 18c1.66 0 2-1.34 2-2 0-.55-.45-1-1-1h-.5a1.5 1.5 0 0 1 0-3H16a5 5 0 0 0 5-5c0-4-4-7-9-7z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
          <circle cx="7" cy="11" r="1.2" fill="currentColor" />
          <circle cx="9.5" cy="7.5" r="1.2" fill="currentColor" />
          <circle cx="14" cy="7" r="1.2" fill="currentColor" />
          <circle cx="17.5" cy="10" r="1.2" fill="currentColor" />
        </svg>
      </button>
      {open ? (
        <div className="modal-backdrop bottom-sheet-backdrop" onClick={() => setOpen(false)} role="dialog" aria-modal="true">
          <div ref={sheetRef} className="modal bottom-sheet theme-switcher-sheet" onClick={(event) => event.stopPropagation()}>
            <div className="bottom-sheet-handle bottom-sheet-grab" {...handleProps} aria-hidden="true" />
            <p className="modal-title">Switch theme</p>
            <div className="theme-switcher-groups" role="tablist" aria-label="Themes">
              {themeGroups.map((group) =>
                group.entries.length > 0 ? (
                  <div key={group.label} className="theme-switcher-group">
                    <p className="theme-switcher-group-label">{group.label}</p>
                    <div className="theme-switcher-grid">
                      {group.entries.map(renderChip)}
                    </div>
                  </div>
                ) : null
              )}
              <div className="theme-switcher-group">
                <p className="theme-switcher-group-label">Dev</p>
                <button
                  type="button"
                  className={`button button-ghost theme-switcher-unlock${hasFullGame ? " is-active" : ""}`}
                  onClick={onToggleUnlock}
                  aria-pressed={hasFullGame}
                >
                  {hasFullGame ? "Lock game" : "Unlock all"}
                </button>
              </div>
            </div>
            <div className="modal-actions">
              <button type="button" className="button button-ghost" onClick={() => setOpen(false)}>Close</button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

function PerformanceCard({ performanceMode, onToggle }) {
  return (
    <div className="performance-card theme-panel-card">
      <div className="perf-row">
        <div className="perf-copy">
          <p className="perf-label">Performance Mode</p>
          <p className="perf-note">Turn this on if you're experiencing sluggish behavior.</p>
        </div>
        <button
          type="button"
          className={`button button-ghost perf-toggle${performanceMode ? " is-active" : ""}`}
          onClick={onToggle}
          aria-pressed={performanceMode}
        >
          {performanceMode ? "On" : "Off"}
        </button>
      </div>
    </div>
  );
}

function AnalyticsCard({ consent, onAllow, onDeny }) {
  const isGranted = consent === ANALYTICS_CONSENT.GRANTED;
  const isDenied = consent === ANALYTICS_CONSENT.DENIED;
  const note = isGranted
    ? "Anonymous usage helps improve balance and device support."
    : isDenied
      ? "Analytics are off. You can turn this on anytime."
      : "Choose whether to share anonymous usage data.";
  return (
    <div className="analytics-card theme-panel-card">
      <div className="perf-row">
        <div className="perf-copy">
          <p className="perf-label">Analytics</p>
          <p className="perf-note">{note}</p>
        </div>
        <button
          type="button"
          className={`button button-ghost perf-toggle${isGranted ? " is-active" : ""}`}
          onClick={isGranted ? onDeny : onAllow}
          aria-pressed={isGranted}
        >
          {isGranted ? "On" : "Off"}
        </button>
      </div>
    </div>
  );
}

function PrivacyCard({ onOpen }) {
  return (
    <div className="privacy-card theme-panel-card">
      <div className="perf-row">
        <div className="perf-copy">
          <p className="perf-label">Privacy</p>
          <p className="perf-note">Read how analytics and data are handled.</p>
        </div>
        <button type="button" className="button button-ghost" onClick={onOpen}>
          Privacy Policy
        </button>
      </div>
    </div>
  );
}

function PurchasesCard({ hasFullGame, onUnlock, onRestore, busy, totalLevels }) {
  return (
    <div className="purchases-card theme-panel-card">
      <div className="perf-row">
        <div className="perf-copy">
          <p className="perf-label">Purchases</p>
          <p className="perf-note">
            {hasFullGame
              ? "You have the full game unlocked. Thank you."
              : `Unlock all ${totalLevels} levels and themes.`}
          </p>
        </div>
        <div className="purchases-actions">
          {hasFullGame ? null : (
            <button type="button" className="button" onClick={onUnlock} disabled={busy}>
              Unlock
            </button>
          )}
          <button type="button" className="button button-ghost" onClick={onRestore} disabled={busy}>
            Restore
          </button>
        </div>
      </div>
    </div>
  );
}

function InstallBanner({ mode, onInstall, isInstalled }) {
  const title = "Play Zento offline";
  const iconSrc = `${import.meta.env.BASE_URL}icons/icon-192.png`;
  const note =
    isInstalled
      ? "You're running the installed app."
      : mode === "prompt"
      ? "Get the real app—no app store needed. Installs for offline, full-screen play."
      : mode === "ios"
        ? "On iOS: tap Share, then “Add to Home Screen.” No app store needed."
        : "No app store needed. Install the app for offline play (Chrome/Edge/Android).";
  return (
    <div className="install-banner">
      <div className="install-lead">
        <div className="install-icon" aria-hidden="true">
          <img src={iconSrc} alt="" />
        </div>
        <div className="install-copy">
          <div className="install-title-row">
            <p className="install-title">{title}</p>
            {isInstalled ? <span className="install-tag">Already installed</span> : null}
          </div>
          <p className="install-note">{note}</p>
          <div className="install-platforms" aria-label="Supported platforms">
            <span className="install-platform" role="img" aria-label="Chrome" title="Chrome">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path
                  d="M16.214 8.69l6.715-1.679A12.027 12.027 0 0 1 24 11.972C24 18.57 18.569 24 11.968 24c-.302 0-.605-.011-.907-.034l4.905-8.347c.356-.376.655-.803.881-1.271a5.451 5.451 0 0 0-.043-4.748 5.156 5.156 0 0 0-.59-.91zm-3.24 8.575l-2.121 6.682C4.738 23.345 0 18.14 0 11.977 0 9.592.709 7.26 2.038 5.279l4.834 8.377c.18.539 1.119 2.581 3.067 3.327.998.382 2.041.481 3.035.282zM11.973 7.62c-2.006.019-3.878 1.544-4.281 3.512a4.478 4.478 0 0 0 1.237 4.032c1.214 1.186 3.14 1.578 4.734.927 1.408-.576 2.47-1.927 2.691-3.431.272-1.856-.788-3.832-2.495-4.629a4.413 4.413 0 0 0-1.886-.411zM7.046 9.962L2.259 4.963A12.043 12.043 0 0 1 11.997 0c4.56 0 8.744 2.592 10.774 6.675H12.558c-1.811-.125-3.288.52-4.265 1.453a5.345 5.345 0 0 0-1.247 1.834z"
                  fill="currentColor"
                />
              </svg>
            </span>
            <span className="install-platform" role="img" aria-label="Edge" title="Edge">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path
                  d="M23.158 14.25H7.821c0 .578.086 1.103.262 1.575.188.465.431.881.743 1.245.31.364.675.675 1.102.938.413.262.863.48 1.343.648.476.173.975.3 1.48.383a10.078 10.078 0 0 0 3.311-.026c.564-.105 1.111-.244 1.651-.42.54-.177 1.061-.387 1.583-.627.525-.24 1.057-.502 1.605-.795v5.085c-.612.3-1.212.552-1.812.769-.6.21-1.2.394-1.81.54-.612.15-1.23.263-1.865.33a18.41 18.41 0 0 1-1.957.105c-.9 0-1.77-.105-2.606-.311a10.217 10.217 0 0 1-2.355-.893 9.869 9.869 0 0 1-2.018-1.417 8.957 8.957 0 0 1-2.595-4.148 9.359 9.359 0 0 1-.356-2.61c0-.986.135-1.924.405-2.82.274-.9.66-1.717 1.17-2.467a8.92 8.92 0 0 1 1.856-1.999A9.82 9.82 0 0 1 9.426 5.91a5.206 5.206 0 0 0-1.163 1.774 7.671 7.671 0 0 0-.536 2.055h8.542c0-.863-.086-1.613-.262-2.258-.176-.645-.458-1.181-.851-1.605-.39-.427-.893-.75-1.512-.96-.618-.214-1.365-.322-2.238-.322-1.032 0-2.063.15-3.094.461-1.031.3-2.01.731-2.94 1.275-.93.551-1.785 1.2-2.565 1.942-.78.75-1.436 1.557-1.969 2.43a14 14 0 0 1 .649-2.913C1.798 6.863 2.21 6 2.706 5.2a11.606 11.606 0 0 1 1.74-2.152c.663-.645 1.398-1.2 2.212-1.65C7.472.949 8.334.585 9.272.34A13.4 13.4 0 0 1 12.257 0c.615 0 1.226.056 1.837.165.612.113 1.208.263 1.79.458 1.154.397 2.185.952 3.093 1.657a10.553 10.553 0 0 1 2.287 2.449c.62.926 1.088 1.95 1.41 3.063.323 1.114.488 2.273.488 3.477v2.981z"
                  fill="currentColor"
                />
              </svg>
            </span>
            <span className="install-platform" role="img" aria-label="Android" title="Android">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path
                  d="M22.146 9.227c0-.815-.658-1.478-1.476-1.478s-1.48.66-1.48 1.48v6.19c0 .81.663 1.48 1.483 1.48.814 0 1.476-.67 1.476-1.48v-6.2h-.01zM5.393 8.032l.004 9.6c0 .885.704 1.59 1.573 1.59h1.063v3.28c0 .82.66 1.482 1.47 1.482s1.467-.66 1.48-1.468v-3.28h1.993v3.28c0 .823.66 1.483 1.47 1.483.823 0 1.482-.66 1.482-1.49v-3.28h1.078c.87 0 1.573-.71 1.573-1.578v-9.63L5.35 8.03l.04.002zm9.648-2.93c-.31 0-.56-.25-.56-.56 0-.305.25-.558.56-.56.31 0 .56.255.56.56 0 .31-.25.56-.56.56m-6.06 0c-.31 0-.56-.25-.56-.56 0-.307.25-.558.56-.558.31 0 .56.255.56.57s-.252.567-.57.567m6.29-2.9L16.29.33c.06-.105.014-.226-.076-.285C16.11 0 15.99.03 15.93.135l-1.05 1.9c-.868-.405-1.856-.63-2.89-.63s-2.018.215-2.892.603L8.064.105c-.053-.098-.18-.135-.278-.08-.1.045-.136.18-.08.27l1.03 1.875c-2.03 1.047-3.4 3.04-3.4 5.33h13.328c0-2.29-1.368-4.283-3.396-5.33M3.33 7.742c-.817 0-1.48.665-1.48 1.483v6.192c0 .82.664 1.48 1.484 1.48.814 0 1.477-.66 1.477-1.48v-6.19c0-.815-.66-1.478-1.47-1.478"
                  fill="currentColor"
                />
              </svg>
            </span>
          </div>
        </div>
      </div>
      {mode === "prompt" && !isInstalled ? (
        <div className="install-actions">
          <button type="button" className="button" onClick={onInstall}>
            Install app
          </button>
        </div>
      ) : null}
    </div>
  );
}

function CreditsFooter({ audioAttribution }) {
  return (
    <div className="credits-footer">
      {audioAttribution.map((item) => (
        <span key={item.source}>
          {item.source} — {item.license} (
          <a
            className="modal-link"
            href={item.url}
            target="_blank"
            rel="noreferrer"
            onClick={(event) => {
              event.preventDefault();
              openExternal(item.url);
            }}
          >
            source
          </a>
          )
        </span>
      ))}
    </div>
  );
}

function SoundsCard({
  fxVolume,
  onToggleFx,
  nowPlaying,
  onPrev,
  onNext,
  onTogglePlay,
  isPaused,
  isLoading,
  audioAttribution
}) {
  const fxLevel = fxVolume === 0 ? 0 : fxVolume <= 0.6 ? 1 : fxVolume <= 1.2 ? 2 : fxVolume <= 2.5 ? 3 : 4;
  return (
    <div className="sounds-card theme-panel-card">
      <p className="theme-title">Sounds</p>
      <div className="sounds-controls">
        <button
          type="button"
          className={`sound-pill${fxVolume === 0 ? " is-muted" : ""}`}
          onClick={onToggleFx}
          aria-label="FX Volume"
          title="FX Volume"
        >
          <span className="sound-pill-label">FX Volume</span>
          <span className="sound-meter" aria-hidden="true">
            {Array.from({ length: 4 }).map((_, idx) => (
              <span key={idx} className={`sound-dot${idx < fxLevel ? " is-on" : ""}`} />
            ))}
          </span>
        </button>
      </div>
      <PlayerCard
        nowPlaying={nowPlaying}
        onPrev={onPrev}
        onNext={onNext}
        onToggle={onTogglePlay}
        isPaused={isPaused}
        isLoading={isLoading}
        audioAttribution={audioAttribution}
        isSubCard
      />
    </div>
  );
}

function ControlStack({
  themeMode,
  themeIndex,
  themes,
  unlockedThemeLevels,
  showThemePicker,
  themePickerMounted,
  onTogglePicker,
  onSelectRandom,
  onSelectTheme,
  fxVolume,
  onToggleFx,
  nowPlaying,
  onPrev,
  onNext,
  onTogglePlay,
  isPaused,
  isLoading,
  performanceMode,
  onTogglePerformance,
  audioAttribution,
  showInstallBanner,
  installMode,
  isInstalled,
  onInstall,
  analyticsConsent,
  onAllowAnalytics,
  onDenyAnalytics,
  onOpenPrivacyPolicy,
  hasFullGame,
  priceString,
  onUnlock,
  onRestore,
  purchasesBusy,
  onOpenSettings
}) {
  return (
    <section className="floating-controls">
      <p className="settings-title">Settings</p>
      {showInstallBanner ? (
        <InstallBanner mode={installMode} onInstall={onInstall} isInstalled={isInstalled} />
      ) : null}
      <ThemePanel
        themeMode={themeMode}
        themeIndex={themeIndex}
        themes={themes}
        unlockedThemeLevels={unlockedThemeLevels}
        hasFullGame={hasFullGame}
        priceString={priceString}
        onOpenPaywall={onUnlock}
        showThemePicker={showThemePicker}
        themePickerMounted={themePickerMounted}
        onTogglePicker={onTogglePicker}
        onSelectRandom={onSelectRandom}
        onSelectTheme={onSelectTheme}
      />
      <SoundsCard
        fxVolume={fxVolume}
        onToggleFx={onToggleFx}
        nowPlaying={nowPlaying}
        onPrev={onPrev}
        onNext={onNext}
        onTogglePlay={onTogglePlay}
        isPaused={isPaused}
        isLoading={isLoading}
        audioAttribution={audioAttribution}
      />
      <button
        type="button"
        className="button button-ghost advanced-settings-btn"
        onClick={onOpenSettings}
      >
        Advanced Settings
      </button>
      <div className="build-footer">
        <span className="build-footer-studio">
          <span className="build-footer-studio-prefix">Made by</span>
          <span className="build-footer-studio-name">Not Another Studio</span>
        </span>
        <button type="button" className="build-footer-privacy" onClick={onOpenPrivacyPolicy}>
          Privacy Policy
        </button>
      </div>
    </section>
  );
}

export default function App() {
  const difficultyLevels = DIFFICULTY_IDS;
  const baseThemes = [
    {
      name: "Tranquil Waters",
      colors: ["#A4D7E1", "#6B9AC4", "#3B5B8C", "#1F3A5F", "#0D1B2A"]
    },
    {
      name: "Serene Garden",
      colors: ["#E3F6F5", "#B9EBC1", "#A8D8B9", "#6B8E23", "#4B5D33"]
    },
    {
      name: "Soft Blush",
      colors: ["#F7E7D9", "#E1B7A1", "#D6A4A1", "#C69C8D", "#A76D6D"]
    },
    {
      name: "Misty Slate",
      colors: ["#B7C9C7", "#A1B2B5", "#8C9A9E", "#6B7B7A", "#4A5B5D"]
    },
    {
      name: "Warm Earth",
      colors: ["#F6D6A8", "#F2B94C", "#D68A2D", "#A65E2E", "#6A3D2A"]
    },
    {
      name: "Fresh Meadow",
      colors: ["#C8E6C9", "#A5D6A7", "#81C784", "#4CAF50", "#388E3C"]
    },
    {
      name: "Citrus Breeze",
      colors: ["#F0F4C3", "#E6EE9C", "#DCE775", "#C0CA33", "#8BC34A"]
    },
    {
      name: "Quiet Grey",
      colors: ["#E0E0E0", "#BDBDBD", "#9E9E9E", "#757575", "#424242"]
    },
    {
      name: "Rose Bloom",
      colors: ["#F8BBD0", "#F48FB1", "#F06292", "#EC407A", "#D81B60"]
    },
    {
      name: "Harbor Blue",
      colors: ["#B0BEC5", "#90A4AE", "#78909C", "#607D8B", "#455A64"]
    },
    {
      name: "Night mode — Bright",
      kind: "night-1",
      nightMode: true,
      includeInRandom: false,
      fullWidth: true,
      showSwatch: false,
      sleepLevel: 1,
      colors: ["#000000", "#000000", "#000000", "#D2D2D2", "#A5A5A5"]
    },
    {
      name: "Night mode — Medium",
      kind: "night-2",
      nightMode: true,
      includeInRandom: false,
      fullWidth: true,
      showSwatch: false,
      sleepLevel: 2,
      colors: ["#000000", "#000000", "#000000", "#A4A4A4", "#787878"]
    },
    {
      name: "Night mode — Dim",
      kind: "night-3",
      nightMode: true,
      includeInRandom: false,
      fullWidth: true,
      showSwatch: false,
      sleepLevel: 3,
      colors: ["#000000", "#000000", "#000000", "#6E6E6E", "#4E4E4E"]
    },
    {
      name: "Neumorphic",
      kind: "neumorphic",
      includeInRandom: false,
      unlockable: true,
      unlockLevel: 20,
      fullWidth: true,
      showSwatch: false,
      colors: ["#EEF1F5", "#E6EBF1", "#E0E6EE", "#A3AFBC", "#6F7B86"]
    },
    {
      name: "Ink Wash",
      kind: "ink",
      includeInRandom: false,
      unlockable: true,
      unlockLevel: 40,
      fullWidth: true,
      showSwatch: false,
      colors: ["#F7F4EF", "#EDE7DE", "#DED6C9", "#2F2A24", "#6B5C52"]
    },
    {
      name: "Paper Craft",
      kind: "paper",
      includeInRandom: false,
      unlockable: true,
      unlockLevel: 60,
      fullWidth: true,
      showSwatch: false,
      colors: ["#F7F1E8", "#F1E7DA", "#E6D8C8", "#C26E4A", "#6C4E3E"]
    },
    {
      name: "Brutalist Minimal",
      kind: "brutalist",
      includeInRandom: false,
      unlockable: true,
      unlockLevel: 80,
      fullWidth: true,
      showSwatch: false,
      colors: ["#F6F4EF", "#FFFFFF", "#EDE7DE", "#111111", "#FF5A1F"]
    },
    {
      name: "Glass & Glow",
      kind: "glass",
      includeInRandom: false,
      unlockable: true,
      unlockLevel: 100,
      fullWidth: true,
      showSwatch: false,
      colors: ["#0B1324", "#101C33", "#182A4A", "#6AD5FF", "#A77BFF"]
    },
    {
      name: "Blueprint Grid",
      kind: "blueprint",
      includeInRandom: false,
      unlockable: true,
      unlockLevel: 120,
      fullWidth: true,
      showSwatch: false,
      colors: ["#081B33", "#0D2340", "#123055", "#5CC0FF", "#D5E8FF"]
    },
    {
      name: "Synthwave",
      kind: "synthwave",
      includeInRandom: false,
      unlockable: true,
      unlockLevel: 140,
      fullWidth: true,
      showSwatch: false,
      colors: ["#120526", "#2A0B5A", "#3E0F6E", "#FF5FDB", "#5ED1FF"]
    },
    {
      name: "Retro CRT",
      kind: "crt",
      includeInRandom: false,
      unlockable: true,
      unlockLevel: 160,
      fullWidth: true,
      showSwatch: false,
      colors: ["#07110D", "#0B1B14", "#0F2219", "#21FF8A", "#9BFFD0"]
    },
    {
      name: "Sakura",
      kind: "sakura",
      includeInRandom: false,
      unlockable: true,
      unlockLevel: 180,
      fullWidth: true,
      showSwatch: false,
      colors: ["#FFE8F0", "#FFD0DE", "#FFB3CC", "#E27DA1", "#A23B6C"]
    },
    {
      name: "Aurora",
      kind: "aurora",
      includeInRandom: false,
      unlockable: true,
      unlockLevel: 200,
      fullWidth: true,
      showSwatch: false,
      colors: ["#050B22", "#0B1640", "#162960", "#3EE6A9", "#C46BFF"]
    }
  ];

  const [themeUnlockOverrides, setThemeUnlockOverridesState] = useState(() => {
    try {
      const raw = storage.getItem("zen_theme_unlock_levels");
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch (err) {
      return {};
    }
  });
  const setThemeUnlockOverride = (themeName, value) => {
    setThemeUnlockOverridesState((prev) => {
      const next = { ...prev };
      const parsed = Math.floor(Number(value));
      if (Number.isFinite(parsed) && parsed > 0) {
        next[themeName] = parsed;
      } else {
        delete next[themeName];
      }
      storage.setItem("zen_theme_unlock_levels", JSON.stringify(next));
      return next;
    });
  };
  const themes = useMemo(() => {
    return baseThemes.map((theme) => {
      if (!theme.unlockable) return theme;
      const override = themeUnlockOverrides[theme.name];
      if (Number.isFinite(override) && override > 0) {
        return { ...theme, unlockLevel: override };
      }
      return theme;
    });
  }, [themeUnlockOverrides]);

  const [themeIndex, setThemeIndex] = useState(() => {
    const savedTheme = Number(storage.getItem("zen_theme_index"));
    return Number.isNaN(savedTheme) ? 0 : Math.max(0, Math.min(savedTheme, themes.length - 1));
  });
  const [themeMode, setThemeMode] = useState(() => {
    const savedMode = storage.getItem("zen_theme_mode");
    return savedMode === "fixed" ? "fixed" : "random";
  });
  const [showThemePicker, setShowThemePicker] = useState(false);
  const [themePickerMounted, setThemePickerMounted] = useState(false);
  const initialDifficultyIndex = (() => {
    const savedDifficulty = storage.getItem("zen_difficulty");
    const migrated = LEGACY_DIFFICULTY_MIGRATION[savedDifficulty] || savedDifficulty;
    const idx = difficultyLevels.indexOf(migrated);
    return idx === -1 ? difficultyLevels.indexOf("noon") : idx;
  })();
  const [difficultyIndex, setDifficultyIndex] = useState(initialDifficultyIndex);
  const initialSeed = useMemo(() => Math.random().toString(36).slice(2, 8), []);
  const [seedText, setSeedText] = useState(initialSeed);
  const initialDifficulty = difficultyLevels[initialDifficultyIndex];
  // Board generation runs a constraint solver (up to 60 attempts) and is the
  // single most expensive piece of work at startup. The home screen never shows
  // a board, and every game entry calls regenerate(), so we start with an empty
  // board and build the first one after the initial paint (see effect below).
  // This keeps first paint cheap and the main thread responsive — WKWebView was
  // flagging the web process as unresponsive during boot, which can surface as a
  // blank launch screen on slower devices (the App Store rejection reason).
  const [tiles, setTiles] = useState([]);
  const [initialRotations, setInitialRotations] = useState([]);
  const [resetSpinning, setResetSpinning] = useState(false);
  const [pulseDelays, setPulseDelays] = useState(new Map());
  const [waveDelays, setWaveDelays] = useState(new Map());
  const [waveActive, setWaveActive] = useState(false);
  const [solvedDim, setSolvedDim] = useState(false);
  const [fxVolume, setFxVolume] = useState(2.5);
  const [bgVolume, setBgVolume] = useState(1);
  const [boardNoise] = useState(1);
  const [rotateSoundIndex, setRotateSoundIndex] = useState(4);
  const [completeSoundIndex, setCompleteSoundIndex] = useState(2);
  const [bgQueue, setBgQueue] = useState([]);
  const [bgQueuePos, setBgQueuePos] = useState(0);
  const [bgNowPlayingIndex, setBgNowPlayingIndex] = useState(0);
  const [bgIsPaused, setBgIsPaused] = useState(true);
  const [bgIsLoading, setBgIsLoading] = useState(false);
  const [showAttribution, setShowAttribution] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [showFinalSuccess, setShowFinalSuccess] = useState(false);
  const [successThemeApplied, setSuccessThemeApplied] = useState(false);
  const [successMessage, setSuccessMessage] = useState("Well done");
  const [performanceMode, setPerformanceMode] = useState(
    () => storage.getItem("zen_performance_mode") === "on"
  );
  const initialAnalyticsConsent = getAnalyticsConsent();
  const [analyticsConsent, setAnalyticsConsentState] = useState(initialAnalyticsConsent);
  const [showAnalyticsBanner, setShowAnalyticsBanner] = useState(
    initialAnalyticsConsent === null
  );
  const [showPrivacyPolicy, setShowPrivacyPolicy] = useState(false);
  const [showSettingsSheet, setShowSettingsSheet] = useState(false);
  const [showGameSettings, setShowGameSettings] = useState(false);
  const settingsSheetDrag = useBottomSheetDrag(() => setShowSettingsSheet(false));
  const gameSettingsDrag = useBottomSheetDrag(() => setShowGameSettings(false));
  const levelPickerDrag = useBottomSheetDrag(() => setShowLevelPicker(false));
  const [difficultySheetSource, setDifficultySheetSource] = useState(null);
  const [themeSwitcherEnabled, setThemeSwitcherEnabledState] = useState(() => {
    return storage.getItem("zen_dev_theme_switcher") === "true";
  });
  const setThemeSwitcherEnabled = (next) => {
    setThemeSwitcherEnabledState(next);
    if (next) {
      storage.setItem("zen_dev_theme_switcher", "true");
    } else {
      storage.removeItem("zen_dev_theme_switcher");
    }
  };
  const [screen, setScreen] = useState("home");
  const builderUnlocked = import.meta.env.DEV;
  const [totalLevels, setTotalLevelsState] = useState(() => {
    const raw = Number(storage.getItem("zen_total_levels"));
    if (!Number.isFinite(raw) || raw < MIN_TOTAL_LEVELS) return DEFAULT_TOTAL_LEVELS;
    return Math.min(MAX_TOTAL_LEVELS, Math.max(MIN_TOTAL_LEVELS, Math.floor(raw)));
  });
  const setTotalLevels = (next) => {
    const clamped = Math.min(
      MAX_TOTAL_LEVELS,
      Math.max(MIN_TOTAL_LEVELS, Math.floor(Number(next) || DEFAULT_TOTAL_LEVELS))
    );
    setTotalLevelsState(clamped);
    storage.setItem("zen_total_levels", String(clamped));
  };
  const [builderSettings, setBuilderSettings] = useState(() => {
    try {
      const raw = storage.getItem("zen_progression_settings");
      if (!raw) return DEFAULT_PROGRESSION_SETTINGS;
      const parsed = JSON.parse(raw);
      return normalizeProgressionSettings(parsed);
    } catch (err) {
      return DEFAULT_PROGRESSION_SETTINGS;
    }
  });
  const [builderMode, setBuilderMode] = useState(() => {
    const raw = storage.getItem("zen_builder_mode");
    return raw === "advanced" ? "advanced" : "simple";
  });
  const [builderTiles, setBuilderTiles] = useState(() =>
    makeBoard(buildProgressionSeed(builderSettings), "medium")
  );
  const [builderLevel, setBuilderLevel] = useState("1");
  const [builderViewLevel, setBuilderViewLevel] = useState(1);
  const [builderCopyNotice, setBuilderCopyNotice] = useState(false);
  const [saveNotice, setSaveNotice] = useState(false);
  const [hasUnsavedLevels, setHasUnsavedLevels] = useState(() => {
    try {
      const raw = storage.getItem("zen_progression_levels_draft");
      if (!raw) return false;
      const normalized = normalizeLevelList(JSON.parse(raw));
      return normalized.some((seed) => seed);
    } catch (err) {
      return false;
    }
  });
  const [builderSeedDraft, setBuilderSeedDraft] = useState(() =>
    buildProgressionSeed(builderSettings)
  );
  const [seedParseError, setSeedParseError] = useState("");
  const [lastSavedAt, setLastSavedAt] = useState(() => {
    const raw = storage.getItem("zen_progression_levels_saved_at");
    const parsed = raw ? Number(raw) : NaN;
    return Number.isFinite(parsed) ? parsed : null;
  });
  const [isBaking, setIsBaking] = useState(false);
  const [progressionLevels, setProgressionLevels] = useState(() => {
    const baked = normalizeLevelList(bakedProgressionLevels, totalLevels);
    try {
      const draftRaw = storage.getItem("zen_progression_levels_draft");
      if (draftRaw) {
        const parsed = JSON.parse(draftRaw);
        const normalized = normalizeLevelList(parsed, totalLevels);
        if (normalized.some((seed) => seed)) {
          return normalized;
        }
      }
    } catch (err) {
      // Ignore draft parsing failures.
    }
    try {
      const raw = storage.getItem("zen_progression_levels");
      if (raw) {
        const parsed = JSON.parse(raw);
        const normalized = normalizeLevelList(parsed, totalLevels);
        if (normalized.some((seed) => seed)) {
          return normalized;
        }
      }
    } catch (err) {
      // Ignore legacy parsing failures.
    }
    return baked;
  });
  const [progressCursor, setProgressCursor] = useState(0);
  // Holds a saved endless session to resume; null until the player has started
  // one. The first board is generated lazily after paint, so there's no
  // pre-seeded board here.
  const endlessStateRef = useRef(null);
  const prevScreenRef = useRef(screen);
  const [showLevelPicker, setShowLevelPicker] = useState(false);
  const [progressCompletedLevels, setProgressCompletedLevels] = useState(() => {
    try {
      const raw = storage.getItem("zen_progress_completed");
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed
        .map((value) => Number(value))
        .filter((value) => Number.isInteger(value) && value >= 1 && value <= totalLevels);
    } catch (err) {
      return [];
    }
  });
  const [progressUnlockedLevel, setProgressUnlockedLevel] = useState(() => {
    const raw = storage.getItem("zen_progress_unlocked");
    const parsed = raw ? Number(raw) : NaN;
    if (!Number.isFinite(parsed) || parsed < 1) return 1;
    return Math.min(totalLevels, Math.floor(parsed));
  });
  const hasFullGame = useHasFullGame();
  const priceString = usePriceString();
  const effectiveUnlockedLevel = hasFullGame
    ? progressUnlockedLevel
    : Math.min(progressUnlockedLevel, FREE_MAX_LEVEL);
  const [showPaywall, setShowPaywall] = useState(false);
  const [paywallBusy, setPaywallBusy] = useState(false);
  const [paywallError, setPaywallError] = useState(null);
  const pendingContinueLevelRef = useRef(null);
  const endlessSolvesRef = useRef((() => {
    const raw = Number(storage.getItem("zen_endless_solves"));
    return Number.isFinite(raw) ? raw : 0;
  })());
  const reviewPromptedRef = useRef(storage.getItem("zen_review_prompted") === "true");
  const initialRecentRandomThemes = useMemo(() => {
    try {
      const raw = storage.getItem("zen_recent_random_themes");
      const parsed = JSON.parse(raw ?? "[]");
      if (!Array.isArray(parsed)) return [];
      return parsed.filter((value) => Number.isInteger(value));
    } catch (err) {
      return [];
    }
  }, []);
  const recentRandomThemesRef = useRef(initialRecentRandomThemes);
  const successTimeoutRef = useRef(null);
  const successThemePrevRef = useRef(null);
  const waveStartTimeoutRef = useRef(null);
  const waveEndTimeoutRef = useRef(null);
  const prevConnectionBitsRef = useRef(new Map());
  const prevCompleteBitsRef = useRef(new Map());
  const prevSolvedRef = useRef(false);
  const lastProgressBoardRef = useRef(null);
  const lastEndlessBoardRef = useRef(null);
  const analyticsInitSentRef = useRef(false);
  const progressShuffleThemeRef = useRef(false);
  const pulseEndRef = useRef(0);
  const levelsInitRef = useRef(true);
  const skipDraftRef = useRef(false);
  const seedEditingRef = useRef(false);
  const audioCtxRef = useRef(null);
  const bgAudioRef = useRef(null);
  const bgFadeRef = useRef(null);
  const bgUserPausedRef = useRef(false);
  // True when we auto-paused for the user's own audio or an interruption (call/
  // Siri). Lets us resume afterward — but only if the user didn't pause it too.
  const bgDuckedRef = useRef(false);
  // Mirror of bgVolume so playback helpers invoked from mount-time listeners
  // (duck/resume, app-state) always read the current value, not a stale closure.
  const bgVolumeRef = useRef(bgVolume);
  const hasInteractedRef = useRef(false);
  const [installPromptEvent, setInstallPromptEvent] = useState(null);
  const [isStandalone, setIsStandalone] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker
  } = usePwaRegister();
  const getEventContext = () => {
    const context = { screen, difficulty: difficultyLevels[difficultyIndex] };
    if (typeof window !== "undefined") {
      context.viewport_w = window.innerWidth;
      context.viewport_h = window.innerHeight;
      context.device_pixel_ratio = window.devicePixelRatio || 1;
    }
    if (isStandalone) {
      context.is_pwa = true;
    }
    if (isIOS) {
      context.is_ios = true;
    }
    return context;
  };
  const emitEvent = (name, props = {}) => {
    if (analyticsConsent !== ANALYTICS_CONSENT.GRANTED) return;
    track(name, { ...getEventContext(), ...props });
  };
  const handleAnalyticsConsent = async (next) => {
    persistAnalyticsConsent(next);
    setAnalyticsConsentState(next);
    setShowAnalyticsBanner(false);
    if (next === ANALYTICS_CONSENT.GRANTED) {
      await initAnalytics();
      track("analytics_consent", { value: "granted" });
    }
  };
  const openPrivacyPolicy = () => {
    setShowPrivacyPolicy(true);
    emitEvent("privacy_policy_opened");
  };
  const closePrivacyPolicy = () => {
    setShowPrivacyPolicy(false);
  };
  const openPaywall = () => {
    pendingContinueLevelRef.current = null;
    setShowSettingsSheet(false);
    setShowGameSettings(false);
    setShowLevelPicker(false);
    setDifficultySheetSource(null);
    setPaywallError(null);
    setShowPaywall(true);
    emitEvent("paywall_opened");
  };
  const handleSelectDifficulty = (tier) => {
    impactLight();
    if (tier.locked && !hasFullGame) {
      setDifficultySheetSource(null);
      openPaywall();
      return;
    }
    const nextIndex = difficultyLevels.indexOf(tier.id);
    if (nextIndex === -1) return;
    const source = difficultySheetSource;
    const prevId = difficultyLevels[difficultyIndex];
    setDifficultyIndex(nextIndex);
    setDifficultySheetSource(null);
    emitEvent("difficulty_changed", { mode: "endless", from: prevId, to: tier.id, source });
    if (source === "home") {
      endlessStateRef.current = null;
      setScreen("endless");
      const nextSeed = Math.random().toString(36).slice(2, 8);
      setSeedText(nextSeed);
      regenerate(nextSeed, tier.id, { shuffleTheme: true });
    } else {
      regenerate(seedText, tier.id, { shuffleTheme: true });
    }
  };
  const closePaywall = () => {
    if (paywallBusy) return;
    pendingContinueLevelRef.current = null;
    setShowPaywall(false);
  };
  // After a successful unlock that originated from a level gate ("Unlock to
  // keep playing"), drop the player straight into the level they were trying
  // to reach instead of leaving them on the just-solved board.
  const consumePendingContinue = () => {
    const level = pendingContinueLevelRef.current;
    pendingContinueLevelRef.current = null;
    if (level != null) handleSelectProgressLevel(level);
  };
  const handleUnlock = async () => {
    if (paywallBusy) return;
    setPaywallBusy(true);
    setPaywallError(null);
    try {
      await purchaseFullGame();
      emitEvent("purchase_completed");
      setShowPaywall(false);
      consumePendingContinue();
    } catch (err) {
      const msg = err?.message || "";
      const cancelled = /cancel/i.test(msg) || /userCancelled/i.test(msg);
      if (!cancelled) {
        setPaywallError("Something went wrong. Please try again.");
        emitEvent("purchase_failed");
      }
    } finally {
      setPaywallBusy(false);
    }
  };
  const handleRestore = async () => {
    if (paywallBusy) return;
    setPaywallBusy(true);
    setPaywallError(null);
    try {
      await restorePurchases();
      if (getHasFullGame()) {
        emitEvent("restore_completed");
        setShowPaywall(false);
        consumePendingContinue();
      } else {
        emitEvent("restore_empty");
        setPaywallError("No purchases to restore.");
      }
    } catch (err) {
      setPaywallError("Could not restore purchases. Please try again.");
      emitEvent("restore_failed");
    } finally {
      setPaywallBusy(false);
    }
  };

  useEffect(() => {
    storage.setItem("zen_theme_index", String(themeIndex));
  }, [themeIndex]);

  // iOS scroll lock — prevent background scroll when any modal/sheet is open.
  // Note: showThemePicker is an inline accordion (expands within the page), not
  // an overlay, so it must NOT lock scroll. When it lives inside the game
  // settings sheet, showGameSettings already holds the lock.
  const anyModalOpen = !!(
    difficultySheetSource ||
    showSettingsSheet ||
    showGameSettings ||
    showLevelPicker ||
    showAttribution ||
    showPrivacyPolicy
  );
  useEffect(() => {
    if (!anyModalOpen) return;
    const scrollY = window.scrollY;
    const html = document.documentElement;
    html.style.position = "fixed";
    html.style.top = `-${scrollY}px`;
    html.style.left = "0";
    html.style.right = "0";
    html.style.overflow = "hidden";
    return () => {
      html.style.position = "";
      html.style.top = "";
      html.style.left = "";
      html.style.right = "";
      html.style.overflow = "";
      window.scrollTo(0, scrollY);
    };
  }, [anyModalOpen]);

  // Prevent pinch-to-zoom on iOS WKWebView (gesturestart is WebKit-only)
  useEffect(() => {
    const prevent = (e) => e.preventDefault();
    document.addEventListener("gesturestart", prevent, { passive: false });
    document.addEventListener("gesturechange", prevent, { passive: false });
    return () => {
      document.removeEventListener("gesturestart", prevent);
      document.removeEventListener("gesturechange", prevent);
    };
  }, []);

  // Hide the native splash only once the web fonts are ready. The splash shows
  // the wordmark in the correct font, so keeping it up until fonts load means no
  // flash of fallback text (FOUT) when the web content appears. Fonts are
  // bundled locally and preloaded, so this resolves almost immediately; the 2s
  // backstop (and main.jsx's 4s net) guarantee the splash never sticks.
  useEffect(() => {
    let done = false;
    const reveal = () => {
      if (done) return;
      done = true;
      hideSplash();
    };
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(reveal);
    } else {
      reveal();
    }
    const backstop = setTimeout(reveal, 2000);
    return () => clearTimeout(backstop);
  }, []);

  // Generate the first board once, after the initial paint, so the expensive
  // constraint solver never blocks startup. Entering a game calls regenerate()
  // anyway; this just makes a board ready ahead of time and seeds the endless
  // resume fallback (matching the previous synchronous behavior).
  useEffect(() => {
    const firstBoard = makeBoard(initialSeed, initialDifficulty);
    const rotations = firstBoard.map((tile) => tile.rotation);
    setTiles(firstBoard);
    setInitialRotations(rotations);
    endlessStateRef.current = {
      seedText: initialSeed,
      tiles: firstBoard,
      initialRotations: rotations,
      difficultyIndex: initialDifficultyIndex
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setProgressionLevels((prev) => {
      if (prev.length >= totalLevels) return prev;
      return normalizeLevelList(prev, totalLevels);
    });
  }, [totalLevels]);

  useEffect(() => {
    if (analyticsConsent === ANALYTICS_CONSENT.GRANTED) {
      initAnalytics();
    }
  }, [analyticsConsent]);

  useEffect(() => {
    const media = window.matchMedia("(display-mode: standalone)");
    const updateStandalone = () => {
      const standalone = media.matches || window.navigator.standalone === true;
      setIsStandalone(standalone);
    };
    updateStandalone();
    if (media.addEventListener) {
      media.addEventListener("change", updateStandalone);
    } else if (media.addListener) {
      media.addListener(updateStandalone);
    }
    return () => {
      if (media.removeEventListener) {
        media.removeEventListener("change", updateStandalone);
      } else if (media.removeListener) {
        media.removeListener(updateStandalone);
      }
    };
  }, []);

  useEffect(() => {
    const ua = window.navigator.userAgent || "";
    setIsIOS(/iphone|ipad|ipod/i.test(ua));
  }, []);

  useEffect(() => {
    let removeListener = () => {};
    onAppStateChange(({ isActive }) => {
      if (isActive) {
        if (audioCtxRef.current?.state === "suspended") {
          audioCtxRef.current.resume();
        }
        if (bgAudioRef.current && !bgUserPausedRef.current) {
          // Don't resume over the user's own audio if they started some while
          // we were away; otherwise restore full volume (a fade may have been
          // cancelled mid-ramp when backgrounding) and play.
          isOtherAudioPlaying().then((busy) => {
            if (!bgAudioRef.current) return;
            if (busy) {
              bgDuckedRef.current = true;
              syncBgPaused(true);
              return;
            }
            cancelBgFade();
            bgAudioRef.current.volume = bgVolumeRef.current > 0 ? 1.0 : 0;
            bgAudioRef.current.play().catch(() => {});
          });
        }
        refreshEntitlements();
      } else {
        if (audioCtxRef.current?.state === "running") {
          audioCtxRef.current.suspend();
        }
        if (bgAudioRef.current && !bgAudioRef.current.paused) {
          cancelBgFade();
          bgAudioRef.current.pause();
        }
      }
    }).then((remove) => { removeListener = remove; });
    return () => removeListener();
  }, []);

  // Yield to the user's own audio (and calls/Siri) live: duck our music out
  // when theirs starts, bring it back when it stops — unless they paused ours.
  useEffect(() => {
    let removeOther = () => {};
    let removeInterruption = () => {};

    const duck = () => {
      if (bgAudioRef.current && !bgAudioRef.current.paused) {
        cancelBgFade();
        bgAudioRef.current.pause();
        syncBgPaused(true);
        bgDuckedRef.current = true;
      }
    };
    const unduck = () => {
      if (!bgDuckedRef.current || bgUserPausedRef.current) return;
      bgDuckedRef.current = false;
      if (bgAudioRef.current) {
        attemptBgPlay(bgAudioRef.current, { fade: true });
      } else if (bgVolumeRef.current > 0) {
        startAmbient(undefined, { fade: true });
      }
    };

    onOtherAudioChange(({ playing }) => {
      if (playing) duck();
      else unduck();
    }).then((remove) => { removeOther = remove; });

    onAudioInterruption(({ state, shouldResume }) => {
      if (state === "began") duck();
      else if (state === "ended" && shouldResume) unduck();
    }).then((remove) => { removeInterruption = remove; });

    return () => { removeOther(); removeInterruption(); };
  }, []);

  useEffect(() => {
    const handleBeforeInstallPrompt = (event) => {
      event.preventDefault();
      setInstallPromptEvent(event);
    };
    const handleAppInstalled = () => {
      setInstallPromptEvent(null);
    };
    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    window.addEventListener("appinstalled", handleAppInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
      window.removeEventListener("appinstalled", handleAppInstalled);
    };
  }, []);

  useEffect(() => {
    const theme = themes[themeIndex] || themes[0];
    const root = document.documentElement;
    const parseColor = (value) => {
      if (!value) return null;
      const raw = value.trim().toLowerCase();
      if (raw === "transparent") return { r: 0, g: 0, b: 0, a: 0 };
      if (raw.startsWith("#")) {
        const hex = raw.slice(1);
        const normalized =
          hex.length === 3 ? hex.split("").map((c) => c + c).join("") : hex;
        if (normalized.length !== 6) return null;
        return {
          r: parseInt(normalized.slice(0, 2), 16),
          g: parseInt(normalized.slice(2, 4), 16),
          b: parseInt(normalized.slice(4, 6), 16),
          a: 1
        };
      }
      const match = raw.match(/rgba?\(([^)]+)\)/);
      if (!match) return null;
      const parts = match[1].split(/\s*,\s*/).map(Number);
      if (parts.length < 3) return null;
      return {
        r: parts[0],
        g: parts[1],
        b: parts[2],
        a: parts.length === 4 ? parts[3] : 1
      };
    };
    const blendRgba = (top, bottom) => {
      const alpha = top.a + bottom.a * (1 - top.a);
      if (alpha === 0) return { r: 0, g: 0, b: 0, a: 0 };
      return {
        r: (top.r * top.a + bottom.r * bottom.a * (1 - top.a)) / alpha,
        g: (top.g * top.a + bottom.g * bottom.a * (1 - top.a)) / alpha,
        b: (top.b * top.a + bottom.b * bottom.a * (1 - top.a)) / alpha,
        a: alpha
      };
    };
    const srgbToLinear = (value) => {
      const v = value / 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    };
    const luminance = (color) =>
      0.2126 * srgbToLinear(color.r) +
      0.7152 * srgbToLinear(color.g) +
      0.0722 * srgbToLinear(color.b);
    const contrastRatio = (a, b) => {
      const l1 = luminance(a);
      const l2 = luminance(b);
      const lighter = Math.max(l1, l2);
      const darker = Math.min(l1, l2);
      return (lighter + 0.05) / (darker + 0.05);
    };
    const mix = (a, b, t) => ({
      r: Math.round(a.r + (b.r - a.r) * t),
      g: Math.round(a.g + (b.g - a.g) * t),
      b: Math.round(a.b + (b.b - a.b) * t),
      a: 1
    });
    const toRgb = (color) =>
      `rgb(${Math.round(color.r)}, ${Math.round(color.g)}, ${Math.round(color.b)})`;
    const resolveVarValue = (name, seen = new Set()) => {
      if (seen.has(name)) return null;
      seen.add(name);
      const raw = getComputedStyle(root).getPropertyValue(name).trim();
      if (!raw) return null;
      const varMatch = raw.match(/^var\((--[^),\s]+)(?:,\s*([^)]+))?\)$/);
      if (varMatch) {
        return resolveVarValue(varMatch[1], seen) ?? varMatch[2]?.trim() ?? null;
      }
      return raw;
    };
    const resolveColorVar = (name, fallback) => {
      const raw = resolveVarValue(name);
      if (!raw) return fallback;
      if (raw.includes("gradient")) return fallback;
      const parsed = parseColor(raw);
      if (!parsed) return fallback;
      if (parsed.a < 1 && fallback) {
        return blendRgba(parsed, fallback);
      }
      return parsed;
    };
    const ensureContrast = (fg, backgrounds, target) => {
      if (!fg || backgrounds.length === 0) return fg;
      const safeBackgrounds = backgrounds.filter(Boolean);
      if (safeBackgrounds.length === 0) return fg;
      const findWorst = (color) => {
        let worst = safeBackgrounds[0];
        let worstRatio = contrastRatio(color, worst);
        safeBackgrounds.slice(1).forEach((bg) => {
          const ratio = contrastRatio(color, bg);
          if (ratio < worstRatio) {
            worstRatio = ratio;
            worst = bg;
          }
        });
        return { worst, ratio: worstRatio };
      };
      const { worst, ratio } = findWorst(fg);
      if (ratio >= target) return fg;
      const white = { r: 255, g: 255, b: 255, a: 1 };
      const black = { r: 0, g: 0, b: 0, a: 1 };
      const toward =
        contrastRatio(white, worst) >= contrastRatio(black, worst) ? white : black;
      let lo = 0;
      let hi = 1;
      let best = toward;
      for (let i = 0; i < 18; i += 1) {
        const mid = (lo + hi) / 2;
        const candidate = mix(fg, toward, mid);
        if (contrastRatio(candidate, worst) >= target) {
          best = candidate;
          hi = mid;
        } else {
          lo = mid;
        }
      }
      return best;
    };
    const ensureMinContrast = (fg, backgrounds, target) => {
      const safeBackgrounds = backgrounds.filter(Boolean);
      if (safeBackgrounds.length === 0) return fg;
      const minRatio = Math.min(...safeBackgrounds.map((bg) => contrastRatio(fg, bg)));
      if (minRatio >= target) return fg;
      const white = { r: 255, g: 255, b: 255, a: 1 };
      const black = { r: 0, g: 0, b: 0, a: 1 };
      const minWhite = Math.min(...safeBackgrounds.map((bg) => contrastRatio(white, bg)));
      const minBlack = Math.min(...safeBackgrounds.map((bg) => contrastRatio(black, bg)));
      return minWhite >= minBlack ? white : black;
    };
      const pickBestText = (backgrounds) => {
        const safeBackgrounds = backgrounds.filter(Boolean);
        if (safeBackgrounds.length === 0) return { r: 0, g: 0, b: 0, a: 1 };
        const white = { r: 255, g: 255, b: 255, a: 1 };
        const black = { r: 0, g: 0, b: 0, a: 1 };
        const minContrast = (color) =>
          Math.min(...safeBackgrounds.map((bg) => contrastRatio(color, bg)));
        return minContrast(white) >= minContrast(black) ? white : black;
      };
      const applyContrastOverrides = () => {
        const baseBg = resolveColorVar("--bg-start", { r: 255, g: 255, b: 255, a: 1 });
        const boardBg = resolveColorVar("--board-bg", baseBg);
        const surfaceBg = resolveColorVar("--surface-bg", boardBg);
        const controlBg = resolveColorVar("--control-bg", boardBg);
        const buttonBg = resolveColorVar("--button-bg", controlBg);
        const controlActiveBg = resolveColorVar("--control-active-bg", controlBg);
        const buttonHoverBg = resolveColorVar("--button-hover-bg", buttonBg);
        const ink = resolveColorVar("--ink", { r: 34, g: 34, b: 34, a: 1 });
        const muted = resolveColorVar("--muted", ink);
        const inkAdjusted = ensureContrast(ink, [baseBg, surfaceBg, controlBg], 3);
        const mutedAdjusted = ensureContrast(muted, [baseBg, surfaceBg, controlBg], 3);
        root.style.setProperty("--ink", toRgb(inkAdjusted));
        root.style.setProperty("--muted", toRgb(mutedAdjusted));
      if (buttonBg) {
        const buttonBackgrounds = [buttonBg];
        const buttonBase = pickBestText(buttonBackgrounds);
        let buttonText = ensureContrast(buttonBase, buttonBackgrounds, 3);
        buttonText = ensureMinContrast(buttonText, buttonBackgrounds, 3);
        root.style.setProperty("--button-text", toRgb(buttonText));
      }
      if (buttonHoverBg) {
        const hoverBackgrounds = [buttonHoverBg];
        const hoverBase = pickBestText(hoverBackgrounds);
        let hoverText = ensureContrast(hoverBase, hoverBackgrounds, 3);
        hoverText = ensureMinContrast(hoverText, hoverBackgrounds, 3);
        root.style.setProperty("--button-hover-text", toRgb(hoverText));
      } else {
        root.style.removeProperty("--button-hover-text");
      }
      if (controlActiveBg) {
        const activeBase = pickBestText([controlActiveBg]);
        let activeText = ensureContrast(activeBase, [controlActiveBg], 3);
        activeText = ensureMinContrast(activeText, [controlActiveBg], 3);
        root.style.setProperty("--control-active-text", toRgb(activeText));
      }
      };
    const setMetaThemeColor = (value) => {
      if (!value) return;
      let meta = document.querySelector('meta[name="theme-color"]');
      if (!meta) {
        meta = document.createElement("meta");
        meta.setAttribute("name", "theme-color");
        document.head.appendChild(meta);
      }
      meta.setAttribute("content", value);
    };
    const resolveThemeColor = (fallback) => {
      const computed = window.getComputedStyle(root);
      const bgStart = computed.getPropertyValue("--bg-start").trim();
      return bgStart || fallback;
    };
    if (theme?.kind) {
      root.setAttribute("data-theme", theme.kind);
      [
        "--bg-start",
        "--bg-mid",
        "--bg-end",
        "--accent",
        "--loop",
        "--loop-soft",
        "--ink",
        "--muted",
        "--board-bg"
      ].forEach((prop) => root.style.removeProperty(prop));
      applyContrastOverrides();
      const resolvedKind = resolveThemeColor("#000000");
      setMetaThemeColor(resolvedKind);
      applyStatusBarForBackground(resolvedKind);
      return;
    }
    root.removeAttribute("data-theme");
    const [c1, c2, c3, c4, c5] = theme.colors;
    const toRgba = (hex, alpha) => {
      const normalized = hex.replace("#", "");
      const r = parseInt(normalized.slice(0, 2), 16);
      const g = parseInt(normalized.slice(2, 4), 16);
      const b = parseInt(normalized.slice(4, 6), 16);
      return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    };
    const blend = (hexA, hexB, amount) => {
      const a = hexA.replace("#", "");
      const b = hexB.replace("#", "");
      const ar = parseInt(a.slice(0, 2), 16);
      const ag = parseInt(a.slice(2, 4), 16);
      const ab = parseInt(a.slice(4, 6), 16);
      const br = parseInt(b.slice(0, 2), 16);
      const bg = parseInt(b.slice(2, 4), 16);
      const bb = parseInt(b.slice(4, 6), 16);
      const mix = (v1, v2) => Math.round(v1 * (1 - amount) + v2 * amount);
      return `rgb(${mix(ar, br)}, ${mix(ag, bg)}, ${mix(ab, bb)})`;
    };
    const darken = (hex, factor) => {
      const normalized = hex.replace("#", "");
      const r = Math.round(parseInt(normalized.slice(0, 2), 16) * factor);
      const g = Math.round(parseInt(normalized.slice(2, 4), 16) * factor);
      const b = Math.round(parseInt(normalized.slice(4, 6), 16) * factor);
      return `rgb(${r}, ${g}, ${b})`;
    };
    root.style.setProperty("--bg-start", c1);
    root.style.setProperty("--bg-mid", c2);
    root.style.setProperty("--bg-end", c3);
    root.style.setProperty("--accent", c4);
    root.style.setProperty("--loop", blend(c5, "#2f2a24", 0.45));
    root.style.setProperty("--loop-soft", "rgba(255, 255, 255, 0.75)");
    root.style.setProperty("--ink", blend(c5, "#2f2a24", 0.4));
    root.style.setProperty("--muted", blend(c4, "#2f2a24", 0.35));
    root.style.setProperty("--board-bg", "rgba(255, 255, 255, 0.1)");
    applyContrastOverrides();
    const resolvedBg = resolveThemeColor(c1);
    setMetaThemeColor(resolvedBg);
    applyStatusBarForBackground(resolvedBg);
  }, [themeIndex]);

  const connections = useMemo(() => computeConnections(tiles), [tiles]);
  const completeDirs = useMemo(() => computeCompleteDirs(tiles, connections), [tiles, connections]);
  const resetDisabled = useMemo(() => {
    if (tiles.length !== initialRotations.length) return false;
    return tiles.every((tile, index) => tile.rotation === initialRotations[index]);
  }, [tiles, initialRotations]);

  useEffect(() => {
    const savedRotate = Number(storage.getItem("zen_rotate_sound"));
    const savedComplete = Number(storage.getItem("zen_complete_sound"));
    const savedBgVolume = Number(storage.getItem("zen_bg_volume"));
    const savedFxVolume = Number(storage.getItem("zen_fx_volume"));
    if (!Number.isNaN(savedRotate)) setRotateSoundIndex(savedRotate);
    if (!Number.isNaN(savedComplete)) setCompleteSoundIndex(savedComplete);
    if (!Number.isNaN(savedBgVolume)) setBgVolume(savedBgVolume);
    if (!Number.isNaN(savedFxVolume)) setFxVolume(savedFxVolume);
  }, []);

  useEffect(() => {
    storage.setItem("zen_rotate_sound", String(rotateSoundIndex));
  }, [rotateSoundIndex]);

  useEffect(() => {
    storage.setItem("zen_complete_sound", String(completeSoundIndex));
  }, [completeSoundIndex]);

  useEffect(() => {
    bgVolumeRef.current = bgVolume;
    storage.setItem("zen_bg_volume", String(bgVolume));
  }, [bgVolume]);

  useEffect(() => {
    storage.setItem("zen_fx_volume", String(fxVolume));
  }, [fxVolume]);

  useEffect(() => {
    const noise = performanceMode ? 0 : boardNoise;
    document.documentElement.style.setProperty("--page-noise", String(noise));
  }, [boardNoise, performanceMode]);

  useEffect(() => {
    storage.setItem("zen_performance_mode", performanceMode ? "on" : "off");
    document.body.classList.toggle("perf-mode", performanceMode);
    return () => document.body.classList.remove("perf-mode");
  }, [performanceMode]);

  useEffect(() => {
    storage.setItem("zen_theme_mode", themeMode);
  }, [themeMode]);

  useEffect(() => {
    storage.setItem("zen_progression_settings", JSON.stringify(builderSettings));
  }, [builderSettings]);

  useEffect(() => {
    storage.setItem("zen_builder_mode", builderMode);
  }, [builderMode]);

  useEffect(() => {
    storage.setItem("zen_progress_completed", JSON.stringify(progressCompletedLevels));
  }, [progressCompletedLevels]);

  useEffect(() => {
    storage.setItem("zen_progress_unlocked", String(progressUnlockedLevel));
  }, [progressUnlockedLevel]);

  const getNextRandomTheme = () => {
    const eligible = themes
      .map((theme, index) => (theme.includeInRandom === false ? null : index))
      .filter((value) => value !== null);
    if (eligible.length === 0) return 0;
    const eligibleSet = new Set(eligible);
    const recent = recentRandomThemesRef.current
      .filter((index) => eligibleSet.has(index))
      .slice(0, 2);
    const recentSet = new Set(recent);
    const candidates = eligible.filter((index) => !recentSet.has(index));
    const pool = candidates.length > 0 ? candidates : eligible;
    const next = pool[Math.floor(Math.random() * pool.length)];
    recentRandomThemesRef.current = [next, ...recent].slice(0, 2);
    storage.setItem("zen_recent_random_themes", JSON.stringify(recentRandomThemesRef.current));
    return next;
  };

  const clearRecentRandomThemes = () => {
    recentRandomThemesRef.current = [];
    storage.removeItem("zen_recent_random_themes");
  };

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const unlockLevels = themes
      .filter((theme) => theme.unlockable && Number.isFinite(Number(theme.unlockLevel)))
      .map((theme) => Number(theme.unlockLevel));
    window.__zenTest = {
      getThemeNames: () => themes.map((theme) => theme.name),
      setThemeIndex: (index) => {
        setThemeMode("fixed");
        setThemeIndex(index);
        clearRecentRandomThemes();
      },
      unlockAllThemes: () => setProgressCompletedLevels(unlockLevels)
    };
    return () => {
      delete window.__zenTest;
    };
  }, [themes, clearRecentRandomThemes, setThemeIndex, setThemeMode, setProgressCompletedLevels]);

  useEffect(() => {
    if (themeMode === "random") {
      const nextTheme = getNextRandomTheme();
      setThemeIndex(nextTheme);
    }
  }, [themeMode]);

  useEffect(() => {
    storage.setItem("zen_difficulty", difficultyLevels[difficultyIndex]);
  }, [difficultyIndex]);

  useEffect(() => {
    const currentTier = DIFFICULTY_TIERS[difficultyIndex];
    if (!hasFullGame && currentTier?.locked) {
      setDifficultyIndex(difficultyLevels.indexOf("noon"));
    }
  }, [hasFullGame, difficultyIndex]);

  useEffect(() => {
    const indices = Array.from({ length: audioTracks.length }, (_, i) => i);
    for (let i = indices.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [indices[i], indices[j]] = [indices[j], indices[i]];
    }
    setBgQueue(indices);
    setBgQueuePos(0);
    setBgNowPlayingIndex(indices[0]);
  }, []);

  useEffect(() => {
    const nextBits = new Map();
    tiles.forEach((tile) => {
      const connected = connections.get(tile.id) || [false, false, false, false];
      const bits = connectionBitmask(connected);
      nextBits.set(tile.id, bits);
    });
    prevConnectionBitsRef.current = nextBits;
  }, [tiles, connections]);

  useEffect(() => {
    const nextBits = new Map();
    let hasNewComplete = false;
    tiles.forEach((tile) => {
      const dirs = completeDirs.get(tile.id) || [false, false, false, false];
      const bits = connectionBitmask(dirs);
      const prevBits = prevCompleteBitsRef.current.get(tile.id) || 0;
      if ((bits & ~prevBits) !== 0) {
        hasNewComplete = true;
      }
      nextBits.set(tile.id, bits);
    });
    prevCompleteBitsRef.current = nextBits;
    if (hasNewComplete) {
      playSelectedComplete();
    }
  }, [tiles, completeDirs]);

  function ensureAudioContext() {
    if (!audioCtxRef.current) {
      audioCtxRef.current = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioCtxRef.current.state === "suspended") {
      audioCtxRef.current.resume();
    }
    return audioCtxRef.current;
  }

  const syncBgPaused = (nextValue) => {
    if (typeof nextValue === "boolean") {
      setBgIsPaused(nextValue);
      return;
    }
    setBgIsPaused(bgAudioRef.current?.paused ?? true);
  };

  const cancelBgFade = () => {
    if (bgFadeRef.current != null) {
      cancelAnimationFrame(bgFadeRef.current);
      bgFadeRef.current = null;
    }
  };

  // Gently ramp the background track from silence up to its target volume.
  // Used on auto-start so the music eases in rather than beginning abruptly.
  const fadeBgVolume = (audio, target, durationMs = 10000) => {
    cancelBgFade();
    if (!audio) return;
    audio.volume = 0;
    const startTime = performance.now();
    const tick = (now) => {
      const p = Math.min(1, (now - startTime) / durationMs);
      audio.volume = target * p;
      if (p < 1) {
        bgFadeRef.current = requestAnimationFrame(tick);
      } else {
        audio.volume = target;
        bgFadeRef.current = null;
      }
    };
    bgFadeRef.current = requestAnimationFrame(tick);
  };

  const attemptBgPlay = (audio, { fade = false } = {}) => {
    if (!audio) return;
    setBgIsLoading(true);
    const target = bgVolumeRef.current > 0 ? 1.0 : 0;
    if (fade) audio.volume = 0;
    const playPromise = audio.play();
    const onPlaying = () => {
      setBgIsLoading(false);
      syncBgPaused(false);
      if (fade) {
        fadeBgVolume(audio, target);
      } else {
        cancelBgFade();
        audio.volume = target;
      }
    };
    if (playPromise && typeof playPromise.then === "function") {
      playPromise
        .then(onPlaying)
        .catch(() => {
          setBgIsLoading(false);
          syncBgPaused(true);
        });
    } else {
      onPlaying();
    }
  };

  // Auto-start ambient music, but yield to the user's own audio: if Music,
  // Spotify, a podcast, etc. is already playing, stay silent so we don't talk
  // over their choice — they can still start ours manually. The native check
  // resolves false on web, so web behavior is unchanged.
  function maybeAutoStartAmbient() {
    isOtherAudioPlaying().then((otherPlaying) => {
      if (bgAudioRef.current) return;
      if (otherPlaying) {
        syncBgPaused(true);
        return;
      }
      startAmbient(undefined, { fade: true });
    });
  }

  function ensureAudioReady() {
    const ctx = ensureAudioContext();
    if (bgVolumeRef.current > 0) {
      if (bgUserPausedRef.current) {
        return ctx;
      }
      if (!bgAudioRef.current) {
        maybeAutoStartAmbient();
      } else if (bgAudioRef.current.paused) {
        attemptBgPlay(bgAudioRef.current, { fade: true });
      }
    }
    return ctx;
  }

  function playScrape({ duration = 0.12, gain = 0.06 }) {
    if (!soundOn) return;
    const ctx = ensureAudioContext();
    const buffer = ctx.createBuffer(1, ctx.sampleRate * duration, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
    }
    const source = ctx.createBufferSource();
    source.buffer = buffer;

    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = 900;
    filter.Q.value = 1.4;

    const amp = ctx.createGain();
    amp.gain.value = 0;
    amp.gain.linearRampToValueAtTime(gain, ctx.currentTime + 0.01);
    amp.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);

    source.connect(filter);
    filter.connect(amp);
    amp.connect(ctx.destination);
    source.start();
  }

  function playCompleteSweep() {
    if (!soundOn) return;
    const ctx = ensureAudioContext();
    const osc = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    const filter = ctx.createBiquadFilter();
    const amp = ctx.createGain();
    osc.type = "sine";
    osc2.type = "sine";
    osc.frequency.value = 196;
    osc2.frequency.value = 247;
    filter.type = "lowpass";
    filter.frequency.value = 520;
    amp.gain.value = 0;
    amp.gain.linearRampToValueAtTime(0.12 * fxVolume, ctx.currentTime + 0.06);
    amp.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 1.6);
    filter.frequency.exponentialRampToValueAtTime(300, ctx.currentTime + 1.4);
    osc.connect(filter);
    osc2.connect(filter);
    filter.connect(amp);
    amp.connect(ctx.destination);
    osc.start();
    osc2.start();
    osc.stop(ctx.currentTime + 1.7);
    osc2.stop(ctx.currentTime + 1.7);
  }

  const testSounds = [
    { type: "sine", freq: 180, duration: 0.9, gain: 0.10 },
    { type: "sine", freq: 220, duration: 0.7, gain: 0.12 },
    { type: "triangle", freq: 196, duration: 0.8, gain: 0.085 },
    { type: "triangle", freq: 247, duration: 0.75, gain: 0.08 },
    { type: "sine", freq: 262, duration: 0.6, gain: 0.08 },
    { type: "sine", freq: 294, duration: 0.55, gain: 0.07 },
    { type: "sine", freq: 330, duration: 0.5, gain: 0.06 },
    { type: "triangle", freq: 174, duration: 0.9, gain: 0.08 },
    { type: "sine", freq: 196, duration: 1.1, gain: 0.08, sweepTo: 240 },
    { type: "sine", freq: 220, duration: 1.1, gain: 0.08, sweepTo: 180 },
    { type: "sine", freq: 246, duration: 1.2, gain: 0.07, sweepTo: 200 },
    { type: "sine", freq: 180, duration: 0.6, gain: 0.08, lowpass: 500 },
    { type: "sine", freq: 210, duration: 0.7, gain: 0.08, lowpass: 450 },
    { type: "sine", freq: 240, duration: 0.8, gain: 0.08, lowpass: 380 },
    { type: "noise", duration: 0.5, gain: 0.07, bandpass: 650 },
    { type: "noise", duration: 0.7, gain: 0.08, bandpass: 520 },
    { type: "noise", duration: 0.9, gain: 0.08, bandpass: 420 },
    { type: "sine", freq: 196, duration: 1.4, gain: 0.07, sweepTo: 164, lowpass: 420 },
    { type: "sine", freq: 233, duration: 1.3, gain: 0.065, sweepTo: 196, lowpass: 360 },
    { type: "sine", freq: 262, duration: 1.2, gain: 0.06, sweepTo: 220, lowpass: 320 }
  ];

  const completeMelodies = [
    [0, 2, 4],
    [1, 3, 5],
    [2, 4, 6],
    [3, 5, 7],
    [4, 6, 8],
    [5, 7, 9],
    [6, 8, 10],
    [7, 9, 11],
    [8, 10, 12],
    [9, 11, 13],
    [10, 12, 14],
    [11, 13, 15],
    [12, 14, 16],
    [13, 15, 17],
    [14, 16, 18],
    [15, 17, 19],
    [16, 18, 0],
    [17, 19, 1],
    [18, 0, 2],
    [19, 1, 3]
  ];

  function playTestSound(index, volumeOverride) {
    const vol = volumeOverride ?? fxVolume;
    if (vol === 0) return;
    const ctx = ensureAudioReady();
    const preset = testSounds[index % testSounds.length];
    if (preset.type === "noise") {
      const buffer = ctx.createBuffer(1, ctx.sampleRate * preset.duration, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < data.length; i += 1) {
        data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
      }
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      const filter = ctx.createBiquadFilter();
      filter.type = "bandpass";
      filter.frequency.value = preset.bandpass || 520;
      filter.Q.value = 1.2;
      const amp = ctx.createGain();
      amp.gain.value = 0;
      amp.gain.linearRampToValueAtTime(preset.gain * vol, ctx.currentTime + 0.02);
      amp.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + preset.duration);
      source.connect(filter);
      filter.connect(amp);
      amp.connect(ctx.destination);
      source.start();
      return;
    }

    const osc = ctx.createOscillator();
    const amp = ctx.createGain();
    let node = osc;
    osc.type = preset.type;
    osc.frequency.value = preset.freq;
    if (preset.sweepTo) {
      osc.frequency.exponentialRampToValueAtTime(preset.sweepTo, ctx.currentTime + preset.duration);
    }
    if (preset.lowpass) {
      const filter = ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = preset.lowpass;
      osc.connect(filter);
      node = filter;
    }
    amp.gain.value = 0;
    amp.gain.linearRampToValueAtTime(preset.gain * vol, ctx.currentTime + 0.03);
    amp.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + preset.duration);
    node.connect(amp);
    amp.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + preset.duration + 0.05);
  }

  function playCompleteMelody(index) {
    if (fxVolume === 0) return;
    const melody = completeMelodies[index % completeMelodies.length];
    const noteGap = 96;
    melody.forEach((noteIndex, idx) => {
      setTimeout(() => playTestSound(noteIndex), idx * noteGap);
    });
  }

  function playCompleteMelodyDescending(index) {
    if (fxVolume === 0) return;
    const baseMelody = completeMelodies[index % completeMelodies.length].slice().reverse();
    const last = baseMelody[baseMelody.length - 1];
    const extra = [
      (last - 2 + testSounds.length) % testSounds.length,
      (last - 4 + testSounds.length) % testSounds.length
    ];
    const melody = baseMelody.concat(extra);
    const noteGap = 150;
    melody.forEach((noteIndex, idx) => {
      setTimeout(() => playTestSound(noteIndex), idx * noteGap);
    });
  }

  function playWaveMelodyAscending() {
    if (fxVolume === 0) return;
    const ctx = ensureAudioReady();
    const freqs = [196, 220, 247, 262, 294, 330, 392];
    const noteGap = 180;
    const duration = 0.5;
    freqs.forEach((freq, idx) => {
      window.setTimeout(() => {
        const osc = ctx.createOscillator();
        const amp = ctx.createGain();
        osc.type = "sine";
        osc.frequency.value = freq;
        amp.gain.value = 0;
        amp.gain.linearRampToValueAtTime(0.10 * fxVolume, ctx.currentTime + 0.02);
        amp.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);
        osc.connect(amp);
        amp.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + duration + 0.05);
      }, idx * noteGap);
    });
  }

  function playSelectedRotate() {
    playTestSound(rotateSoundIndex);
  }

  function playSelectedComplete() {
    playCompleteMelody(completeSoundIndex);
  }

  function startAmbient(forcedPos, { fade = false } = {}) {
    if (bgVolumeRef.current == 0) return;
    if (bgQueue.length === 0) return;
    bgUserPausedRef.current = false;
    const position = typeof forcedPos === "number" ? forcedPos : bgQueuePos;
    const trackIndex = bgQueue[position] ?? 0;
    setBgNowPlayingIndex(trackIndex);
    const track = audioTracks[trackIndex];
    const trackPath = track.file.startsWith("/")
      ? track.file.slice(1)
      : track.file;
    const baseUrl = new URL(import.meta.env.BASE_URL, window.location.origin);
    const trackUrl = new URL(trackPath, baseUrl).toString();
    const audio = new Audio(trackUrl);
    audio.loop = false;
    audio.volume = bgVolumeRef.current > 0 ? 1.0 : 0;
    audio.onplay = () => {
      setBgIsLoading(false);
      syncBgPaused(false);
    };
    audio.onpause = () => {
      setBgIsLoading(false);
      syncBgPaused(true);
    };
    audio.onended = () => {
      setBgIsLoading(false);
      syncBgPaused(true);
      playNextBg();
    };
    bgAudioRef.current = audio;
    syncBgPaused(true);
    setBgIsLoading(true);
    attemptBgPlay(audio, { fade });
  }

  function stopAmbient() {
    cancelBgFade();
    if (!bgAudioRef.current) {
      syncBgPaused(true);
      setBgIsLoading(false);
      return;
    }
    bgAudioRef.current.pause();
    bgAudioRef.current.currentTime = 0;
    bgAudioRef.current = null;
    syncBgPaused(true);
    setBgIsLoading(false);
  }

  function playNextBg() {
    impactLight();
    if (bgQueue.length === 0) return;
    bgUserPausedRef.current = false;
    const nextPos = (bgQueuePos + 1) % bgQueue.length;
    setBgQueuePos(nextPos);
    stopAmbient();
    startAmbient(nextPos);
  }

  function playPrevBg() {
    impactLight();
    if (bgQueue.length === 0) return;
    bgUserPausedRef.current = false;
    const prevPos = (bgQueuePos - 1 + bgQueue.length) % bgQueue.length;
    setBgQueuePos(prevPos);
    stopAmbient();
    startAmbient(prevPos);
  }

  useEffect(() => {
    if (bgVolume > 0 && bgQueue.length > 0 && !bgAudioRef.current) {
      // Auto-start on first load (eased in over ~10s) — unless the user is
      // already playing their own audio, in which case we stay out of the way.
      maybeAutoStartAmbient();
    }
    return () => stopAmbient();
  }, [bgQueue]);

  useEffect(() => {
    if (!bgAudioRef.current) {
      startAmbient();
      return;
    }
    // Manual volume change snaps immediately; stop any in-flight fade first.
    cancelBgFade();
    bgAudioRef.current.volume = bgVolume > 0 ? 1.0 : 0;
  }, [bgVolume]);

  useEffect(() => {
    const handleFirstInteraction = () => {
      ensureAudioReady();
      window.removeEventListener("pointerdown", handleFirstInteraction);
    };
    window.addEventListener("pointerdown", handleFirstInteraction);
    return () => window.removeEventListener("pointerdown", handleFirstInteraction);
  }, []);

  const solved = useMemo(() => {
    return tiles.every((tile) => {
      const edges = getEdges(tile);
      const dirs = completeDirs.get(tile.id) || [false, false, false, false];
      return edges.every((hasEdge, dir) => !hasEdge || dirs[dir]);
    });
  }, [tiles, completeDirs]);

  function regenerate(nextSeed, nextDifficulty = difficultyLevels[difficultyIndex], { shuffleTheme = false } = {}) {
    if (shuffleTheme && themeMode === "random") {
      const nextTheme = getNextRandomTheme();
      setThemeIndex(nextTheme);
    }
    const nextTiles = makeBoard(nextSeed, nextDifficulty);
    setTiles(nextTiles);
    setInitialRotations(nextTiles.map((tile) => tile.rotation));
  }

  function handleSeedChange(e) {
    const nextSeed = e.target.value;
    setSeedText(nextSeed);
    regenerate(nextSeed);
  }

  const updateBuilderSetting = (key, value) => {
    setBuilderSettings((prev) =>
      normalizeProgressionSettings({
        ...prev,
        [key]: value
      })
    );
  };

  const updateBuilderMeta = (metaKey, value) => {
    setBuilderSettings((prev) => {
      const currentMeta = progressionToMeta(prev);
      const nextMeta = { ...currentMeta, [metaKey]: Number(value) };
      const deltas = metaToProgressionDeltas(nextMeta);
      return normalizeProgressionSettings({ ...prev, ...deltas });
    });
  };

  const builderMeta = useMemo(() => progressionToMeta(builderSettings), [builderSettings]);

  const applyBuilderSeedDraft = () => {
    const cleaned = builderSeedDraft.trim();
    const parsed = parseProgressionSeed(cleaned);
    if (!parsed) {
      setSeedParseError("Invalid seed");
      return false;
    }
    setSeedParseError("");
    setBuilderSettings(parsed);
    return true;
  };

  const setGapRateFromGapCells = (value) => {
    const total = ROWS * COLS;
    const raw = Number(value);
    if (!Number.isFinite(raw)) return;
    const maxBlankCells = Math.max(0, total - MIN_TILES);
    const clamped = clampValue(Math.round(raw), 0, maxBlankCells);
    const snapped = Math.round(clamped / 4) * 4;
    const rate = Math.round((snapped / total) * 100);
    updateBuilderSetting("gapRate", rate);
  };

  const setGapRateFromTileCount = (value) => {
    const total = ROWS * COLS;
    const raw = Number(value);
    if (!Number.isFinite(raw)) return;
    const clamped = clampValue(Math.round(raw), MIN_TILES, total);
    const gapCells = total - clamped;
    setGapRateFromGapCells(gapCells);
  };

  const rollBuilderVariant = () => {
    const min = PROGRESSION_SETTINGS_RANGES.variant.min;
    const max = PROGRESSION_SETTINGS_RANGES.variant.max;
    const next = Math.floor(Math.random() * (max - min + 1)) + min;
    updateBuilderSetting("variant", next);
  };

  const handleCopyBuilderSeed = async () => {
    if (!navigator.clipboard) return;
    try {
      await navigator.clipboard.writeText(builderSeed);
      setBuilderCopyNotice(true);
      window.setTimeout(() => setBuilderCopyNotice(false), 1400);
    } catch (err) {
      setBuilderCopyNotice(false);
    }
  };

  const handleAssignLevel = () => {
    if (!levelIsValid) return;
    const nextLevels = [...progressionLevels];
    nextLevels[levelNumber - 1] = builderSeed;
    skipDraftRef.current = true;
    setProgressionLevels(nextLevels);
    setBuilderViewLevel(levelNumber);
    if (levelNumber < totalLevels) {
      setBuilderLevel(String(levelNumber + 1));
    }
    handleSaveLevels(nextLevels);
  };

  const handleClearLevel = (level) => {
    if (!Number.isInteger(level) || level < 1 || level > totalLevels) return;
    setProgressionLevels((prev) => {
      const next = [...prev];
      next[level - 1] = "";
      return next;
    });
  };

  const downloadTextFile = (filename, text, type) => {
    const blob = new Blob([text], { type });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  const handleExportLevelsJSON = () => {
    const payload = {
      version: 1,
      levels: progressionLevels.map((seed, index) => ({
        level: index + 1,
        seed: seed || ""
      }))
    };
    downloadTextFile("progression-levels.json", JSON.stringify(payload, null, 2), "application/json");
  };

  const handleExportLevelsCSV = () => {
    const escapeCell = (value) => {
      const text = String(value ?? "");
      if (text.includes(",") || text.includes("\"") || text.includes("\n")) {
        return `"${text.replace(/\"/g, "\"\"")}"`;
      }
      return text;
    };
    const header = "level,seed";
    const rows = progressionLevels.map((seed, index) =>
      `${escapeCell(index + 1)},${escapeCell(seed || "")}`
    );
    downloadTextFile("progression-levels.csv", [header, ...rows].join("\n"), "text/csv");
  };

  const handleLoadFromBundle = () => {
    if (hasUnsavedLevels) {
      const ok = window.confirm(
        "Replace the current level map with the bundled one? Unsaved changes will be lost."
      );
      if (!ok) return;
    }
    const baked = normalizeLevelList(bakedProgressionLevels, totalLevels);
    setProgressionLevels(baked);
    try {
      storage.removeItem("zen_progression_levels_draft");
    } catch (err) {
      // Ignore.
    }
    setHasUnsavedLevels(false);
  };

  const handleSaveLevels = async (levelsOverride) => {
    const levelsToSave = Array.isArray(levelsOverride) ? levelsOverride : progressionLevels;
    setIsBaking(true);
    try {
      storage.setItem("zen_progression_levels", JSON.stringify(levelsToSave));
      storage.removeItem("zen_progression_levels_draft");
    } catch (err) {
      // Ignore persistence errors.
    }
    let bakedOk = true;
    if (import.meta.env.DEV) {
      const url = `${import.meta.env.BASE_URL}__bake-levels`;
      try {
        const response = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ levels: levelsToSave })
        });
        if (!response.ok) bakedOk = false;
      } catch (err) {
        bakedOk = false;
      }
    }
    setIsBaking(false);
    if (bakedOk) {
      setHasUnsavedLevels(false);
      const now = Date.now();
      setLastSavedAt(now);
      try {
        storage.setItem("zen_progression_levels_saved_at", String(now));
      } catch (err) {
        // Ignore timestamp persistence errors.
      }
      setSaveNotice(true);
      window.setTimeout(() => setSaveNotice(false), 1400);
    } else {
      setHasUnsavedLevels(true);
    }
  };

  const handleLoadLevelSeed = (seed, level) => {
    const parsed = parseProgressionSeed(seed);
    if (!parsed) return;
    setBuilderSettings(parsed);
    if (Number.isInteger(level)) {
      setBuilderViewLevel(level);
      const nextTarget = Math.min(totalLevels, level + 1);
      setBuilderLevel(String(nextTarget));
    }
  };

  const handleResetProgression = () => {
    setProgressCompletedLevels([]);
    setProgressUnlockedLevel(1);
    setShowFinalSuccess(false);
    setShowSuccess(false);
    setShowLevelPicker(true);
    const firstIndex = assignedLevelIndexByNumber.get(1) ?? 0;
    setProgressCursor(firstIndex);
    if (isProgress && assignedLevels[firstIndex]) {
      const nextSeed = assignedLevels[firstIndex].seed;
      setSeedText(nextSeed);
      regenerate(nextSeed, difficultyLevels[difficultyIndex], { shuffleTheme: false });
    }
  };

  const navigateBuilderLevel = (direction) => {
    const base = clampValue(builderLevelDisplay, 1, totalLevels);
    const nextLevel = clampValue(base + direction, 1, totalLevels);
    setBuilderViewLevel(nextLevel);
    const seed = progressionLevels[nextLevel - 1];
    if (seed) {
      handleLoadLevelSeed(seed, nextLevel);
    } else {
      const nextTarget = Math.min(totalLevels, nextLevel + 1);
      setBuilderLevel(String(nextTarget));
    }
  };

  const markProgressLevelComplete = (level) => {
    if (!Number.isInteger(level) || level < 1 || level > totalLevels) return;
    setProgressCompletedLevels((prev) => {
      if (prev.includes(level)) return prev;
      const next = [...prev, level];
      next.sort((a, b) => a - b);
      return next;
    });
    setProgressUnlockedLevel((prev) => Math.max(prev, Math.min(totalLevels, level + 1)));
  };

  const handleSelectProgressLevel = (level) => {
    impactLight();
    const index = assignedLevelIndexByNumber.get(level);
    if (index === undefined) return;
    progressShuffleThemeRef.current = themeMode === "random";
    setProgressCursor(index);
    setShowLevelPicker(false);
    setShowSuccess(false);
  };

  const handleApplyUnlockedTheme = (index) => {
    const theme = themes[index];
    if (!theme) return;
    if (!successThemeApplied) {
      successThemePrevRef.current = { mode: themeMode, index: themeIndex };
      setThemeMode("fixed");
      setThemeIndex(index);
      clearRecentRandomThemes();
      setShowThemePicker(false);
      setSuccessThemeApplied(true);
      return;
    }
    const prev = successThemePrevRef.current;
    if (prev) {
      setThemeMode(prev.mode);
      setThemeIndex(prev.index);
    }
    setSuccessThemeApplied(false);
  };

  const toggleLevelPicker = () => {
    impactLight();
    setShowLevelPicker((prev) => {
      const next = !prev;
      if (next) {
        cancelFinalAnimations();
      }
      return next;
    });
  };

  const rotateBuilderTile = (index) => {
    setBuilderTiles((prev) => {
      const next = [...prev];
      const tile = { ...next[index] };
      const prevRotationDegrees = tile.rotationDegrees ?? tile.rotation * 90;
      tile.rotation = (tile.rotation + 1) % 4;
      tile.rotationDegrees = prevRotationDegrees + 90;
      next[index] = tile;
      return next;
    });
  };

  function rotateTile(index) {
    hasInteractedRef.current = true;
    impactLight();
    if (showSuccess || waveActive) {
      cancelFinalAnimations();
    }
    const next = [...tiles];
    const tile = { ...next[index] };
    const prevRotationDegrees = tile.rotationDegrees ?? tile.rotation * 90;
    tile.rotation = (tile.rotation + 1) % 4;
    tile.rotationDegrees = prevRotationDegrees + 90;
    next[index] = tile;

    const nextConnections = computeConnections(next);
    const nextComplete = computeCompleteDirs(next, nextConnections);
    let hasNewComplete = false;
    next.forEach((nextTile) => {
      const dirs = nextComplete.get(nextTile.id) || [false, false, false, false];
      const bits = connectionBitmask(dirs);
      const prevBits = prevCompleteBitsRef.current.get(nextTile.id) || 0;
      if ((bits & ~prevBits) !== 0) {
        hasNewComplete = true;
      }
    });

    if (hasNewComplete) {
      const startTile = next[index];
      const byPos = new Map();
      next.forEach((t) => byPos.set(`${t.r}-${t.c}`, t));
      const startComplete = nextComplete.get(startTile.id) || [false, false, false, false];
      if (!startComplete.some(Boolean)) {
        setTiles(next);
        if (!hasNewComplete) {
          playSelectedRotate();
        }
        return;
      }
      const queue = [{ tile: startTile, dist: 0 }];
      const visited = new Set([startTile.id]);
      const distanceMap = new Map();
      let maxDist = 0;
      const component = new Set([startTile.id]);
      while (queue.length) {
        const { tile: current, dist } = queue.shift();
        distanceMap.set(current.id, dist);
        if (dist > maxDist) maxDist = dist;
        const connected = nextConnections.get(current.id) || [false, false, false, false];
        const completeDirs = nextComplete.get(current.id) || [false, false, false, false];
        const neighbors = [
          byPos.get(`${current.r - 1}-${current.c}`),
          byPos.get(`${current.r}-${current.c + 1}`),
          byPos.get(`${current.r + 1}-${current.c}`),
          byPos.get(`${current.r}-${current.c - 1}`)
        ];
        neighbors.forEach((neighbor, dir) => {
          if (!neighbor) return;
          if (!connected[dir] || !completeDirs[dir]) return;
          const neighborComplete = nextComplete.get(neighbor.id) || [false, false, false, false];
          if (!neighborComplete[oppositeDir(dir)]) return;
          if (visited.has(neighbor.id)) return;
          visited.add(neighbor.id);
          component.add(neighbor.id);
          queue.push({ tile: neighbor, dist: dist + 1 });
        });
      }
      const delays = new Map();
      const base = 80;
      const min = 38;
      distanceMap.forEach((dist, id) => {
        const progress = maxDist > 0 ? dist / Math.max(1, maxDist) : 0;
        const eased = 1 - Math.pow(1 - progress, 2);
        const step = base - (base - min) * eased;
        delays.set(id, dist * step);
      });
      if (delays.size > 0) {
        setPulseDelays(delays);
        const endStep = base - (base - min);
        const pulseDuration = maxDist * endStep + 260;
        pulseEndRef.current = performance.now() + pulseDuration;
        window.setTimeout(() => setPulseDelays(new Map()), pulseDuration);
      }
    }

    setTiles(next);
    if (!hasNewComplete) {
      playSelectedRotate();
    }
  }

  function solveAllButOne() {
    const nonBlankIndices = tiles
      .map((tile, idx) => (tile.type === "blank" ? null : idx))
      .filter((idx) => idx !== null);
    if (nonBlankIndices.length === 0) return;
    const leaveIndex = nonBlankIndices[Math.floor(Math.random() * nonBlankIndices.length)];
    const next = tiles.map((tile, idx) => {
      const target = tile.targetRotation;
      const rotation = idx === leaveIndex ? (target + 1) % 4 : target;
      return {
        ...tile,
        rotation,
        rotationDegrees: rotation * 90
      };
    });
    setTiles(next);
  }

  const cancelFinalAnimations = () => {
    setWaveActive(false);
    setWaveDelays(new Map());
    setSolvedDim(false);
    setShowSuccess(false);
    setShowFinalSuccess(false);
    if (successTimeoutRef.current) {
      window.clearTimeout(successTimeoutRef.current);
      successTimeoutRef.current = null;
    }
    if (waveStartTimeoutRef.current) {
      window.clearTimeout(waveStartTimeoutRef.current);
      waveStartTimeoutRef.current = null;
    }
    if (waveEndTimeoutRef.current) {
      window.clearTimeout(waveEndTimeoutRef.current);
      waveEndTimeoutRef.current = null;
    }
  };

  useEffect(() => {
    cancelFinalAnimations();
  }, [screen]);

  const confettiCount = performanceMode ? 40 : 120;
  const isHome = screen === "home";
  const isProgression = screen === "progression";
  const isProgress = screen === "progress";
  const isEndless = screen === "endless";
  const builderSeed = useMemo(() => buildProgressionSeed(builderSettings), [builderSettings]);
  const builderConfig = useMemo(
    () => progressionSettingsToBoardConfig(builderSettings),
    [builderSettings]
  );
  const builderConnections = useMemo(
    () => computeConnections(builderTiles),
    [builderTiles]
  );
  const builderCompleteDirs = useMemo(
    () => computeCompleteDirs(builderTiles, builderConnections),
    [builderTiles, builderConnections]
  );
  const themeUnlockMap = useMemo(() => {
    const map = new Map();
    themes.forEach((theme, index) => {
      if (!theme.unlockable) return;
      const unlockLevel = Number(theme.unlockLevel);
      if (Number.isFinite(unlockLevel)) {
        map.set(unlockLevel, { theme, index, unlockLevel });
      }
    });
    return map;
  }, [themes]);
  const themeUnlockCadence = useMemo(() => {
    const levels = Array.from(themeUnlockMap.keys()).sort((a, b) => a - b);
    if (levels.length < 2) return null;
    return levels[1] - levels[0];
  }, [themeUnlockMap]);
  const levelEntries = useMemo(
    () =>
      Array.from({ length: totalLevels }, (_, index) => ({
        level: index + 1,
        seed: progressionLevels[index] || ""
      })),
    [progressionLevels, totalLevels]
  );
  const assignedLevels = useMemo(
    () => levelEntries.filter((entry) => Boolean(entry.seed)),
    [levelEntries]
  );
  const assignedLevelIndexByNumber = useMemo(() => {
    const map = new Map();
    assignedLevels.forEach((level, index) => {
      map.set(level.level, index);
    });
    return map;
  }, [assignedLevels]);
  const duplicateSeedLevels = useMemo(() => {
    const seedCounts = new Map();
    progressionLevels.slice(0, totalLevels).forEach((seed, index) => {
      const trimmed = seed.trim();
      if (!trimmed) return;
      const entry = seedCounts.get(trimmed);
      if (entry) {
        entry.count += 1;
        entry.levels.push(index + 1);
      } else {
        seedCounts.set(trimmed, { count: 1, levels: [index + 1] });
      }
    });
    const duplicates = new Set();
    seedCounts.forEach((entry) => {
      if (entry.count > 1) {
        entry.levels.forEach((level) => duplicates.add(level));
      }
    });
    return duplicates;
  }, [progressionLevels, totalLevels]);
  const hasDuplicateSeeds = duplicateSeedLevels.size > 0;
  const duplicateSeedList = useMemo(
    () => Array.from(duplicateSeedLevels).sort((a, b) => a - b),
    [duplicateSeedLevels]
  );
  const progressCompletedSet = useMemo(
    () => new Set(progressCompletedLevels),
    [progressCompletedLevels]
  );
  const effectiveUnlockedThemes = useMemo(() => {
    if (!hasFullGame) return progressCompletedSet;
    const next = new Set(progressCompletedSet);
    for (const theme of themes) {
      if (theme.unlockable) {
        const lvl = Number(theme.unlockLevel);
        if (Number.isFinite(lvl)) next.add(lvl);
      }
    }
    return next;
  }, [hasFullGame, progressCompletedSet, themes]);
  const assignedCount = assignedLevels.length;
  const totalCells = ROWS * COLS;
  const maxBlankCells = Math.max(0, totalCells - MIN_TILES);
  const effectiveGapRate = totalCells
    ? Math.round((builderConfig.blanks.min / totalCells) * 100)
    : 0;
  const builderTileCount = Math.max(0, totalCells - builderConfig.blanks.min);
  const levelNumber = Number(builderLevel);
  const levelIsValid =
    Number.isInteger(levelNumber) && levelNumber >= 1 && levelNumber <= totalLevels;
  const assignedSeedForLevel = levelIsValid ? progressionLevels[levelNumber - 1] : "";
  const builderLevelDisplay = clampValue(
    Number.isFinite(builderViewLevel) ? builderViewLevel : 1,
    1,
    totalLevels
  );
  const builderLevelSeed = progressionLevels[builderLevelDisplay - 1] || "";
  const builderLevelHasSeed = Boolean(builderLevelSeed.trim());
  const lastSavedLabel = useMemo(() => {
    if (!lastSavedAt) return "";
    try {
      return new Date(lastSavedAt).toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit"
      });
    } catch (err) {
      return "";
    }
  }, [lastSavedAt]);
  const progressLevelsAvailable = assignedLevels.length > 0;
  const progressLevel = progressLevelsAvailable ? assignedLevels[progressCursor] : null;
  const progressLevelNumber = progressLevel?.level ?? null;
  const progressSeed = progressLevel?.seed ?? "";
  const nextProgressLevel = assignedLevels[progressCursor + 1] ?? null;
  const hasNextProgressLevel = Boolean(
    nextProgressLevel && nextProgressLevel.level <= effectiveUnlockedLevel
  );
  const nextProgressLevelLocked = Boolean(
    isProgress && !hasFullGame && nextProgressLevel && !hasNextProgressLevel
  );
  const isProgressPlayable = isProgress && progressLevelsAvailable;
  const isBoardScreen = isEndless || isProgressPlayable;
  const isFinalLevel = isProgress && progressLevelNumber === totalLevels;
  const isProgressionComplete = progressCompletedSet.has(totalLevels);
  const unlockableThemeForLevel = useMemo(() => {
    if (!Number.isInteger(progressLevelNumber)) return null;
    return themeUnlockMap.get(progressLevelNumber) || null;
  }, [progressLevelNumber, themeUnlockMap]);
  const progressSuccessTitle = progressLevelNumber ? `Level ${progressLevelNumber} complete` : "Level complete";
  const finalSuccessTitle = "A Winner Is You";
  const successTitle = showFinalSuccess
    ? finalSuccessTitle
    : isProgress
      ? progressSuccessTitle
      : successMessage;

  useEffect(() => {
    if (analyticsConsent === ANALYTICS_CONSENT.DENIED) {
      analyticsInitSentRef.current = false;
      return;
    }
    if (analyticsConsent !== ANALYTICS_CONSENT.GRANTED || analyticsInitSentRef.current) return;
    analyticsInitSentRef.current = true;
    emitEvent("app_opened");
    emitEvent("screen_view", { screen });
    if (screen === "endless" || screen === "progress") {
      emitEvent("mode_started", { mode: screen });
    }
    if (isProgress && Number.isInteger(progressLevelNumber)) {
      emitEvent("board_started", { mode: "progress", level: progressLevelNumber });
    } else if (isEndless && seedText) {
      emitEvent("board_started", { mode: "endless" });
    }
  }, [
    analyticsConsent,
    screen,
    isProgress,
    isEndless,
    progressLevelNumber,
    seedText
  ]);

  useEffect(() => {
    if (!progressLevelsAvailable) {
      setProgressCursor(0);
      return;
    }
    setProgressCursor((prev) => Math.min(prev, assignedLevels.length - 1));
  }, [progressLevelsAvailable, assignedLevels.length]);

  useEffect(() => {
    if (!progressCompletedLevels.length) {
      setProgressUnlockedLevel(1);
      return;
    }
    const maxCompleted = Math.max(...progressCompletedLevels);
    const minUnlocked = Math.min(totalLevels, Math.max(1, maxCompleted + 1));
    setProgressUnlockedLevel((prev) => Math.max(prev, minUnlocked));
  }, [progressCompletedLevels]);

  useEffect(() => {
    if (!isProgress) {
      setShowLevelPicker(false);
    }
  }, [isProgress]);

  useEffect(() => {
    if (import.meta.env.DEV) return;
    if (screen === "progression") {
      setScreen("home");
    }
  }, [screen]);

  useEffect(() => {
    if (!showSuccess) {
      setSuccessThemeApplied(false);
      successThemePrevRef.current = null;
      return;
    }
    setSuccessThemeApplied(false);
    successThemePrevRef.current = null;
  }, [showSuccess, unlockableThemeForLevel?.index]);

  useEffect(() => {
    if (!isProgress) return;
    if (!progressLevelsAvailable) return;
    const level = assignedLevels[progressCursor];
    if (!level) return;
    const shouldShuffleTheme = progressShuffleThemeRef.current;
    progressShuffleThemeRef.current = false;
    setSeedText(level.seed);
    regenerate(level.seed, difficultyLevels[difficultyIndex], { shuffleTheme: shouldShuffleTheme });
  }, [isProgress, progressLevelsAvailable, assignedLevels, progressCursor, difficultyIndex]);

  useEffect(() => {
    const prev = prevScreenRef.current;
    if (prev !== screen) {
      emitEvent("screen_view", { screen });
      if (screen === "endless" || screen === "progress") {
        emitEvent("mode_started", { mode: screen });
      }
    }
    if (prev === "endless" && screen !== "endless") {
      endlessStateRef.current = {
        seedText,
        tiles,
        initialRotations,
        difficultyIndex
      };
    }
    if (prev !== "progress" && screen === "progress") {
      if (assignedLevels.length > 0) {
        let targetIndex = -1;
        for (let i = 0; i < assignedLevels.length; i += 1) {
          const lvl = assignedLevels[i].level;
          if (lvl > effectiveUnlockedLevel) break;
          if (!progressCompletedSet.has(lvl)) {
            targetIndex = i;
            break;
          }
        }
        if (targetIndex === -1) {
          for (let i = assignedLevels.length - 1; i >= 0; i -= 1) {
            if (assignedLevels[i].level <= effectiveUnlockedLevel) {
              targetIndex = i;
              break;
            }
          }
        }
        if (targetIndex === -1) targetIndex = 0;
        setProgressCursor(targetIndex);
      }
    }
    if (prev !== "endless" && screen === "endless") {
      const saved = endlessStateRef.current;
      if (saved) {
        setSeedText(saved.seedText);
        setTiles(saved.tiles);
        setInitialRotations(saved.initialRotations);
        setDifficultyIndex(saved.difficultyIndex);
      }
    }
    prevScreenRef.current = screen;
  }, [screen]);

  useEffect(() => {
    if (!isProgress || !Number.isInteger(progressLevelNumber)) return;
    const key = `${progressLevelNumber}-${difficultyLevels[difficultyIndex]}`;
    if (lastProgressBoardRef.current === key) return;
    lastProgressBoardRef.current = key;
    emitEvent("board_started", {
      mode: "progress",
      level: progressLevelNumber,
      difficulty: difficultyLevels[difficultyIndex]
    });
  }, [isProgress, progressLevelNumber, difficultyIndex]);

  useEffect(() => {
    if (!isEndless || !seedText) return;
    const key = `${seedText}-${difficultyLevels[difficultyIndex]}`;
    if (lastEndlessBoardRef.current === key) return;
    lastEndlessBoardRef.current = key;
    emitEvent("board_started", { mode: "endless", difficulty: difficultyLevels[difficultyIndex] });
  }, [isEndless, seedText, difficultyIndex]);

  useEffect(() => {
    if (!isBoardScreen) {
      prevSolvedRef.current = solved;
      return;
    }
    if (solved && !prevSolvedRef.current) {
      emitEvent("board_completed", {
        mode: isProgress ? "progress" : "endless",
        level: isProgress && Number.isInteger(progressLevelNumber) ? progressLevelNumber : undefined,
        difficulty: difficultyLevels[difficultyIndex]
      });
      const step = 180;
      const groupSize = 2;
      const delays = new Map();
      let maxDelay = 0;
      tiles.forEach((tile) => {
        const groupIndex = Math.floor(tile.r / groupSize);
        const delay = groupIndex * step;
        delays.set(tile.id, delay);
        if (delay > maxDelay) maxDelay = delay;
      });

      const startWave = () => {
        setWaveDelays(delays);
        setWaveActive(true);
        setSolvedDim(false);
        playWaveMelodyAscending();
        const total = maxDelay + 700;
        waveEndTimeoutRef.current = window.setTimeout(() => {
          setWaveActive(false);
          setSolvedDim(true);
          waveEndTimeoutRef.current = null;
        }, total);
      };

      const waveDelay = 400;
      const remaining = Math.max(0, pulseEndRef.current - performance.now());
      const totalDelay = remaining + waveDelay;
      if (totalDelay > 0) {
        waveStartTimeoutRef.current = window.setTimeout(() => {
          startWave();
          waveStartTimeoutRef.current = null;
        }, totalDelay);
      } else {
        startWave();
      }
      const successDelay = totalDelay + 1600;
      if (successTimeoutRef.current) {
        window.clearTimeout(successTimeoutRef.current);
      }
      successTimeoutRef.current = window.setTimeout(() => {
        const messages = [
          "Nicely done",
          "Well done",
          "Nice work",
          "Good work",
          "Level complete",
          "Puzzle complete",
          "Level solved",
          "Puzzle solved",
          "Task complete"
        ];
        const nextMessage = isProgress
          ? progressSuccessTitle
          : messages[Math.floor(Math.random() * messages.length)];
        if (isProgress && Number.isInteger(progressLevelNumber)) {
          markProgressLevelComplete(progressLevelNumber);
        }
        const isFinal = isFinalLevel;
        setShowFinalSuccess(isFinal);
        setSuccessMessage(nextMessage);
        setShowSuccess(true);
        impactMedium();

        // Review prompt triggers
        if (!reviewPromptedRef.current) {
          let shouldPrompt = false;
          if (isProgress && progressLevelNumber === 50) {
            shouldPrompt = true;
          }
          if (!isProgress) {
            endlessSolvesRef.current += 1;
            storage.setItem("zen_endless_solves", String(endlessSolvesRef.current));
            if (endlessSolvesRef.current === 50) {
              shouldPrompt = true;
            }
          }
          if (shouldPrompt) {
            reviewPromptedRef.current = true;
            storage.setItem("zen_review_prompted", "true");
            window.setTimeout(() => requestReview(), 1500);
          }
        }
      }, successDelay);
    }
    if (!solved && prevSolvedRef.current) {
      cancelFinalAnimations();
    }
    prevSolvedRef.current = solved;
  }, [solved, tiles, isBoardScreen, isProgress, progressSuccessTitle, progressLevelNumber, isFinalLevel]);

  useEffect(() => {
    setBuilderTiles(makeBoard(builderSeed, "medium"));
  }, [builderSeed]);

  useEffect(() => {
    if (seedEditingRef.current) return;
    setBuilderSeedDraft(builderSeed);
    setSeedParseError("");
  }, [builderSeed]);

  useEffect(() => {
    const theme = themes[themeIndex];
    if (themeMode !== "fixed" || !theme) return;
    if (hasFullGame || themeSwitcherEnabled) return;
    if (theme.nightMode) {
      setThemeMode("fixed");
      setThemeIndex(0);
      return;
    }
    if (!theme.unlockable) return;
    const unlockLevel = Number(theme.unlockLevel);
    if (!Number.isFinite(unlockLevel)) return;
    if (!progressCompletedSet.has(unlockLevel)) {
      setThemeMode("fixed");
      setThemeIndex(0);
    }
  }, [themes, themeIndex, themeMode, progressCompletedSet, hasFullGame, themeSwitcherEnabled]);

  useEffect(() => {
    if (levelsInitRef.current) {
      levelsInitRef.current = false;
      return;
    }
    if (skipDraftRef.current) {
      skipDraftRef.current = false;
      return;
    }
    setHasUnsavedLevels(true);
    try {
      storage.setItem("zen_progression_levels_draft", JSON.stringify(progressionLevels));
    } catch (err) {
      // Ignore draft persistence errors.
    }
  }, [progressionLevels]);
  const toggleThemePicker = () => {
    impactLight();
    if (showThemePicker) {
      setShowThemePicker(false);
      window.setTimeout(() => setThemePickerMounted(false), 260);
    } else {
      setThemePickerMounted(true);
      window.requestAnimationFrame(() => setShowThemePicker(true));
    }
  };
  const selectRandomTheme = () => {
    impactLight();
    setThemeMode("random");
    setShowThemePicker(false);
    window.setTimeout(() => setThemePickerMounted(false), 260);
  };
  const selectFixedTheme = (index) => {
    impactLight();
    const theme = themes[index];
    if (theme?.unlockable) {
      const unlockLevel = Number(theme.unlockLevel);
      if (!Number.isFinite(unlockLevel) || !progressCompletedSet.has(unlockLevel)) {
        return;
      }
    }
    setThemeMode("fixed");
    setThemeIndex(index);
    clearRecentRandomThemes();
    setShowThemePicker(false);
    window.setTimeout(() => setThemePickerMounted(false), 260);
  };
  const toggleBgPlay = () => {
    impactLight();
    // Manual control overrides any auto-duck state.
    bgDuckedRef.current = false;
    if (!bgAudioRef.current) {
      bgUserPausedRef.current = false;
      if (bgVolume === 0) {
        setBgVolume(1);
        return;
      }
      startAmbient();
      return;
    }
    if (bgAudioRef.current.paused) {
      bgUserPausedRef.current = false;
      attemptBgPlay(bgAudioRef.current);
    } else {
      bgUserPausedRef.current = true;
      cancelBgFade();
      bgAudioRef.current.pause();
      syncBgPaused(true);
      setBgIsLoading(false);
    }
  };
  const isBgPaused = bgIsPaused;
  const isBgLoading = bgIsLoading;
  const showInstallBanner = false;
  const isDevBuild = import.meta.env.DEV;
  const installMode = installPromptEvent ? "prompt" : isIOS ? "ios" : "unavailable";
  const handleInstallClick = async () => {
    if (!installPromptEvent) return;
    installPromptEvent.prompt();
    try {
      await installPromptEvent.userChoice;
    } catch (err) {
      // Ignore prompt errors; we just hide the banner for now.
    }
    setInstallPromptEvent(null);
  };
  const handleUpdateNow = () => {
    setNeedRefresh(false);
    updateServiceWorker(true);
  };
  const handleUpdateLater = () => {
    setNeedRefresh(false);
  };
  const privacyContact = (import.meta.env.VITE_PRIVACY_CONTACT || "").trim();

  return (
    <div
      className={`app${solvedDim ? " is-solved" : ""}${showSuccess ? " show-success" : ""}${
        performanceMode ? " is-perf" : ""
      }${isHome ? " is-home" : ""}`}
    >
      {isDevBuild ? <div className="dev-badge">DEV</div> : null}
      {showPrivacyPolicy ? (
        <div className="modal-backdrop privacy-backdrop" onClick={closePrivacyPolicy} role="dialog" aria-modal="true">
          <div className="privacy-sheet" onClick={(event) => event.stopPropagation()}>
            <div className="privacy-header">
              <div className="privacy-header-spacer" />
              <p className="privacy-nav-title">Privacy Policy</p>
              <button type="button" className="privacy-done" onClick={closePrivacyPolicy}>Done</button>
            </div>
            <div className="privacy-scroll">
              <p className="privacy-updated">Last updated May 19, 2026</p>

              <p className="privacy-group-header">What we collect</p>
              <div className="privacy-group">
                <div className="privacy-row">
                  <span className="privacy-row-icon" aria-hidden="true">📊</span>
                  <span className="privacy-row-text">Anonymous gameplay events — mode started, board started/completed, level number for progress mode</span>
                </div>
                <div className="privacy-row">
                  <span className="privacy-row-icon" aria-hidden="true">📱</span>
                  <span className="privacy-row-text">Device and app context — viewport size, pixel ratio, browser, OS, install status</span>
                </div>
              </div>

              <p className="privacy-group-header">How we use it</p>
              <div className="privacy-group">
                <div className="privacy-row">
                  <span className="privacy-row-text">Improve balance, performance, and device support</span>
                </div>
                <div className="privacy-row">
                  <span className="privacy-row-text">Understand mode usage and level completion rates</span>
                </div>
              </div>

              <p className="privacy-group-header">Your choices</p>
              <div className="privacy-group">
                <div className="privacy-row">
                  <span className="privacy-row-icon" aria-hidden="true">🔒</span>
                  <span className="privacy-row-text">Analytics are off by default. Opt in or out anytime in Settings.</span>
                </div>
                <div className="privacy-row">
                  <span className="privacy-row-icon" aria-hidden="true">🗑</span>
                  <span className="privacy-row-text">Clearing app data removes stored analytics identifiers</span>
                </div>
              </div>

              <p className="privacy-group-header">Purchases</p>
              <div className="privacy-group">
                <div className="privacy-row">
                  <span className="privacy-row-text">In-app purchases are handled by Apple. We use RevenueCat to verify your purchase and unlock the full game. Neither service receives personal data from inside the app.</span>
                </div>
                <div className="privacy-row">
                  <span className="privacy-row-text">Your purchase is tied to your Apple ID, not to any Zento account. Restore Purchases is available on the paywall.</span>
                </div>
              </div>

              <p className="privacy-group-header">Third-party services</p>
              <div className="privacy-group">
                <div className="privacy-row privacy-row-service">
                  <span className="privacy-row-label">PostHog</span>
                  <span className="privacy-row-detail">Anonymous analytics, only after opt-in</span>
                </div>
                <div className="privacy-row privacy-row-service">
                  <span className="privacy-row-label">RevenueCat</span>
                  <span className="privacy-row-detail">Purchase verification and entitlements</span>
                </div>
                <div className="privacy-row privacy-row-service">
                  <span className="privacy-row-label">Apple</span>
                  <span className="privacy-row-detail">Payment processing for in-app purchases</span>
                </div>
              </div>

              {privacyContact ? (
                <>
                  <p className="privacy-group-header">Contact</p>
                  <div className="privacy-group">
                    <div className="privacy-row">
                      <span className="privacy-row-text">{privacyContact}</span>
                    </div>
                  </div>
                </>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
      {showPaywall ? (
        <div className="modal-backdrop" onClick={closePaywall} role="dialog" aria-modal="true">
          <div className="modal paywall-modal" onClick={(event) => event.stopPropagation()}>
            <p className="modal-title paywall-title">Unlock Zento</p>
            <p className="modal-subtitle paywall-subtitle">Continue the journey.</p>
            <ul className="paywall-features">
              <li>One-time purchase. No subscription.</li>
              <li>Unlock all {totalLevels} progress mode levels</li>
              <li>Night mode themes</li>
              <li>Harder endless modes</li>
            </ul>
            {paywallError ? (
              <p className="modal-item paywall-error" role="alert">
                {paywallError}
              </p>
            ) : null}
            <div className="modal-actions paywall-actions">
              <button
                type="button"
                className="button paywall-button"
                onClick={handleUnlock}
                disabled={paywallBusy}
              >
                {paywallBusy
                  ? "Unlocking…"
                  : priceString
                    ? `Unlock for ${priceString}`
                    : "Unlock"}
              </button>
              <button
                type="button"
                className="button button-ghost paywall-button"
                onClick={handleRestore}
                disabled={paywallBusy}
              >
                Restore purchases
              </button>
              <button
                type="button"
                className="button button-ghost paywall-button"
                onClick={closePaywall}
                disabled={paywallBusy}
              >
                Not now
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {showSettingsSheet ? (
        <div className="modal-backdrop bottom-sheet-backdrop" onClick={() => setShowSettingsSheet(false)} role="dialog" aria-modal="true">
          <div ref={settingsSheetDrag.sheetRef} className="modal bottom-sheet settings-sheet" onClick={(event) => event.stopPropagation()}>
            <div className="bottom-sheet-handle bottom-sheet-grab" {...settingsSheetDrag.handleProps} aria-hidden="true" />
            <p className="modal-title">Settings</p>
            <PurchasesCard
              hasFullGame={hasFullGame}
              onUnlock={openPaywall}
              onRestore={handleRestore}
              busy={paywallBusy}
              totalLevels={totalLevels}
            />
            <PerformanceCard performanceMode={performanceMode} onToggle={() => setPerformanceMode((prev) => !prev)} />
            <AnalyticsCard
              consent={analyticsConsent}
              onAllow={() => handleAnalyticsConsent(ANALYTICS_CONSENT.GRANTED)}
              onDeny={() => handleAnalyticsConsent(ANALYTICS_CONSENT.DENIED)}
            />
            <div className="modal-actions">
              <button type="button" className="button" onClick={() => setShowSettingsSheet(false)}>
                Done
              </button>
            </div>
            <p className="settings-version">Zento v{__APP_VERSION__}</p>
          </div>
        </div>
      ) : null}
      {builderUnlocked && themeSwitcherEnabled ? (
        <ThemeSwitcherFab
          themes={themes}
          themeIndex={themeIndex}
          onSelectTheme={(index) => {
            setThemeIndex(index);
            setThemeMode("fixed");
          }}
          hasFullGame={hasFullGame}
          onToggleUnlock={() => setDevUnlock(!hasFullGame)}
        />
      ) : null}
      {difficultySheetSource ? (
        <DifficultySheet
          tiers={DIFFICULTY_TIERS}
          hasFullGame={hasFullGame}
          priceString={priceString}
          onSelect={handleSelectDifficulty}
          onUnlock={() => {
            setDifficultySheetSource(null);
            openPaywall();
          }}
          onClose={() => setDifficultySheetSource(null)}
        />
      ) : null}
      {showGameSettings ? (
        <div className="modal-backdrop bottom-sheet-backdrop" onClick={() => setShowGameSettings(false)} role="dialog" aria-modal="true">
          <div ref={gameSettingsDrag.sheetRef} className="modal bottom-sheet game-settings-sheet" onClick={(event) => event.stopPropagation()}>
            <div className="bottom-sheet-handle bottom-sheet-grab" {...gameSettingsDrag.handleProps} aria-hidden="true" />
            <ThemePanel
              themeMode={themeMode}
              themeIndex={themeIndex}
              themes={themes}
              unlockedThemeLevels={effectiveUnlockedThemes}
              hasFullGame={hasFullGame}
              priceString={priceString}
              onOpenPaywall={() => {
                setShowGameSettings(false);
                openPaywall();
              }}
              showThemePicker={showThemePicker}
              themePickerMounted={themePickerMounted}
              onTogglePicker={toggleThemePicker}
              onSelectRandom={selectRandomTheme}
              onSelectTheme={selectFixedTheme}
            />
            <SoundsCard
              fxVolume={fxVolume}
              onToggleFx={() => {
                impactLight();
                const nextVol = fxVolume === 4.0 ? 0 : fxVolume === 2.5 ? 4.0 : fxVolume === 0 ? 0.6 : fxVolume === 0.6 ? 1.2 : fxVolume === 1.2 ? 2.5 : 4.0;
                setFxVolume(nextVol);
                playTestSound(rotateSoundIndex, nextVol);
              }}
              nowPlaying={audioTracks[bgNowPlayingIndex]?.title}
              onPrev={playPrevBg}
              onNext={playNextBg}
              onTogglePlay={toggleBgPlay}
              isPaused={isBgPaused}
              isLoading={isBgLoading}
              audioAttribution={audioAttribution}
            />
            <div className="modal-actions">
              <button type="button" className="button" onClick={() => setShowGameSettings(false)}>
                Done
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {isProgress && showLevelPicker ? (
        <div className="modal-backdrop bottom-sheet-backdrop" onClick={() => setShowLevelPicker(false)} role="dialog" aria-modal="true">
          <div ref={levelPickerDrag.sheetRef} className="modal bottom-sheet level-picker-sheet" onClick={(event) => event.stopPropagation()}>
            <div className="bottom-sheet-handle bottom-sheet-grab" {...levelPickerDrag.handleProps} aria-hidden="true" />
            <p className="modal-title level-picker-title">Choose level</p>
            {themeUnlockCadence ? (
              <p className="level-picker-blurb">
                <span className="theme-lock-badge" aria-hidden="true">
                  <svg viewBox="0 0 24 24">
                    <path
                      d="M7 11V8.5a5 5 0 0 1 10 0V11"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                    />
                    <rect
                      x="5.5"
                      y="11"
                      width="13"
                      height="9"
                      rx="2.2"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                    />
                  </svg>
                </span>
                <span>A new theme unlocks every {themeUnlockCadence} levels</span>
              </p>
            ) : null}
            {progressLevelsAvailable ? (
              <>
                {isProgressionComplete ? (
                  <div className="level-picker-banner">
                    <div className="level-picker-banner-copy">
                      <p className="level-picker-banner-title">Congratulations</p>
                      <p className="level-picker-banner-text">
                        Would you like to reset your progression?
                      </p>
                    </div>
                    <button
                      type="button"
                      className="button"
                      onClick={handleResetProgression}
                    >
                      Reset
                    </button>
                  </div>
                ) : null}
                <div className="level-grid">
                  {Array.from({ length: totalLevels }, (_, index) => {
                    const level = index + 1;
                    const seed = progressionLevels[index];
                    const hasSeed = Boolean(seed);
                    const isUnlocked = level <= effectiveUnlockedLevel;
                    const isComplete = progressCompletedSet.has(level);
                    const hasThemeUnlock = themeUnlockMap.has(level);
                    const themeUnlocked = hasThemeUnlock && isComplete;
                    const isAvailable = hasSeed && isUnlocked;
                    const state = isComplete
                      ? "complete"
                      : isAvailable
                        ? "available"
                        : "unavailable";
                    const showInlinePaywall = !hasFullGame && level === FREE_MAX_LEVEL + 1;
                    return (
                      <React.Fragment key={level}>
                        {showInlinePaywall ? (
                          <button
                            type="button"
                            className="level-paywall-cta"
                            onClick={openPaywall}
                          >
                            <svg
                              className="level-paywall-icon"
                              viewBox="0 0 24 24"
                              width="16"
                              height="16"
                              aria-hidden="true"
                            >
                              <path
                                d="M7 11V8a5 5 0 0 1 10 0v3"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeLinecap="round"
                              />
                              <rect x="5" y="11" width="14" height="10" rx="2" fill="currentColor" />
                            </svg>
                            <span>
                              {priceString
                                ? `Unlock all ${totalLevels} levels for ${priceString}`
                                : `Unlock all ${totalLevels} levels`}
                            </span>
                          </button>
                        ) : null}
                      <button
                        type="button"
                        className="level-card"
                        data-state={state}
                        disabled={!isAvailable}
                        onClick={() => handleSelectProgressLevel(level)}
                        aria-label={`Level ${level} ${state}`}
                        title={`Level ${level}`}
                      >
                        {hasThemeUnlock ? (
                          themeUnlocked ? (
                            <span className="level-check" aria-hidden="true">
                              <svg viewBox="0 0 24 24">
                                <path
                                  d="M6 12l4 4 8-8"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="2.6"
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                />
                              </svg>
                            </span>
                          ) : (
                            <span className="theme-lock-badge level-theme-lock" aria-hidden="true">
                              <svg viewBox="0 0 24 24">
                                <path
                                  d="M7 11V8.5a5 5 0 0 1 10 0V11"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="1.8"
                                  strokeLinecap="round"
                                />
                                <rect
                                  x="5.5"
                                  y="11"
                                  width="13"
                                  height="9"
                                  rx="2.2"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="1.8"
                                />
                              </svg>
                            </span>
                          )
                        ) : isComplete ? (
                          <span className="level-check" aria-hidden="true">
                            <svg viewBox="0 0 24 24">
                              <path
                                d="M6 12l4 4 8-8"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2.6"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              />
                            </svg>
                          </span>
                        ) : null}
                        <span className="level-number">{level}</span>
                      </button>
                      </React.Fragment>
                    );
                  })}
                </div>
              </>
            ) : (
              <p className="builder-empty">No progress levels assigned yet.</p>
            )}
          </div>
        </div>
      ) : null}
      {showAnalyticsBanner ? (
        <div className="analytics-banner" role="dialog" aria-live="polite">
          <div className="analytics-banner-copy">
            <p className="analytics-banner-title">Help improve Zento</p>
            <p className="analytics-banner-note">
              Allow anonymous analytics so we can see device sizes and level completion. No
              personal data.
            </p>
          </div>
          <div className="analytics-banner-actions">
            <button
              type="button"
              className="button"
              onClick={() => handleAnalyticsConsent(ANALYTICS_CONSENT.GRANTED)}
            >
              Allow analytics
            </button>
            <button
              type="button"
              className="button button-ghost"
              onClick={() => handleAnalyticsConsent(ANALYTICS_CONSENT.DENIED)}
            >
              No thanks
            </button>
          </div>
        </div>
      ) : null}
      {isHome ? (
        <section className="home-screen">
          <div className="home-stack">
            <h1 className="home-title">
              <Logo className="logo--home" />
            </h1>
            <div className="home-modes">
              <button
                type="button"
                className="mode-card"
                onClick={() => { impactLight(); setDifficultySheetSource("home"); }}
              >
                <div className="mode-graphic mode-graphic-endless" aria-hidden="true">
                  <i className="loader loader--3" aria-hidden="true" />
                </div>
                <div className="mode-content">
                  <div className="mode-title">Endless</div>
                  <p className="mode-copy">
                    A continuous stream of randomly generated boards with no set end point.
                  </p>
                </div>
              </button>
              <button
                type="button"
                className="mode-card"
                onClick={() => { impactLight(); setScreen("progress"); }}
              >
                <div className="mode-graphic mode-graphic-progression" aria-hidden="true">
                  <i className="loader loader--8" aria-hidden="true" />
                </div>
                <div className="mode-content">
                  <div className="mode-title">Progressive</div>
                  <p className="mode-copy">
                    A guided journey through curated boards with increasing complexity and unlocks.
                  </p>
                </div>
              </button>
            </div>
          </div>
          <div className="home-bottom">
            <ControlStack
              themeMode={themeMode}
              themeIndex={themeIndex}
              themes={themes}
              unlockedThemeLevels={effectiveUnlockedThemes}
              showThemePicker={showThemePicker}
              themePickerMounted={themePickerMounted}
              onTogglePicker={toggleThemePicker}
              onSelectRandom={selectRandomTheme}
              onSelectTheme={selectFixedTheme}
              fxVolume={fxVolume}
              onToggleFx={() => {
                impactLight();
                const nextVol = fxVolume === 4.0 ? 0 : fxVolume === 2.5 ? 4.0 : fxVolume === 0 ? 0.6 : fxVolume === 0.6 ? 1.2 : fxVolume === 1.2 ? 2.5 : 4.0;
                setFxVolume(nextVol);
                playTestSound(rotateSoundIndex, nextVol);
              }}
              nowPlaying={audioTracks[bgNowPlayingIndex]?.title}
              onPrev={playPrevBg}
              onNext={playNextBg}
              onTogglePlay={toggleBgPlay}
              isPaused={isBgPaused}
              isLoading={isBgLoading}
              performanceMode={performanceMode}
              onTogglePerformance={() => { impactLight(); setPerformanceMode((prev) => !prev); }}
              audioAttribution={audioAttribution}
              showInstallBanner={showInstallBanner}
              installMode={installMode}
              isInstalled={isStandalone}
              onInstall={handleInstallClick}
              analyticsConsent={analyticsConsent}
              onAllowAnalytics={() => handleAnalyticsConsent(ANALYTICS_CONSENT.GRANTED)}
              onDenyAnalytics={() => handleAnalyticsConsent(ANALYTICS_CONSENT.DENIED)}
              onOpenPrivacyPolicy={openPrivacyPolicy}
              hasFullGame={hasFullGame}
              priceString={priceString}
              onUnlock={openPaywall}
              onRestore={handleRestore}
              purchasesBusy={paywallBusy}
              onOpenSettings={() => { impactLight(); setShowSettingsSheet(true); }}
            />
            {builderUnlocked ? (
            <div className="home-builder">
              <button
                type="button"
                className="mode-card mode-card-builder mode-card-no-graphic"
                onClick={() => setScreen("progression")}
              >
                <div className="mode-content">
                  <div className="mode-title">Level Builder</div>
                  <p className="mode-copy">
                    Build a {totalLevels}-level journey with sliders and seeds.
                  </p>
                </div>
              </button>
              <button
                type="button"
                className={`mode-card mode-card-builder mode-card-no-graphic${themeSwitcherEnabled ? " is-active" : ""}`}
                onClick={() => setThemeSwitcherEnabled(!themeSwitcherEnabled)}
                aria-pressed={themeSwitcherEnabled}
              >
                <div className="mode-content">
                  <div className="mode-title">Theme Switcher {themeSwitcherEnabled ? "· On" : "· Off"}</div>
                  <p className="mode-copy">
                    {themeSwitcherEnabled
                      ? "Tap the palette button anywhere to swap themes. Tap again to disable."
                      : "Show a floating palette button to swap themes from any screen."}
                  </p>
                </div>
              </button>
            </div>
            ) : null}
          </div>
        </section>
      ) : isProgression ? (
        <>
          <header className="top-controls">
            <div className="header-title-row">
              <button
                type="button"
                className="button button-ghost home-icon"
                onClick={() => { impactLight(); setScreen("home"); }}
                aria-label="Back to home"
                title="Back to home"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path
                    d="M4 11.5l8-7 8 7"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <path
                    d="M6.5 10.5V20h11V10.5"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
              <h1 className="app-title">Progression Builder</h1>
              <button
                type="button"
                className="button button-ghost home-icon builder-reset"
                onClick={handleResetProgression}
                aria-label="Reset progression"
                title="Reset progression"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path
                    d="M17 7a7 7 0 1 0 1.9 6.3"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <path
                    d="M19 4.5v4.8h-4.8"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
            </div>
            <p className="builder-subhead">
              Dial in the sliders, grab the seed, and assign it to levels 1-{totalLevels}.
            </p>
          </header>

          <section className="builder-layout">
            <main className="board-wrap builder-board">
              <div className="builder-board-stack">
                <div className="builder-level-nav" aria-live="polite">
                  <button
                    type="button"
                    className="button button-ghost builder-level-step"
                    onClick={() => navigateBuilderLevel(-1)}
                    disabled={builderLevelDisplay <= 1}
                    aria-label="Previous level"
                  >
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path
                        d="M15 6l-6 6 6 6"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.4"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </button>
                  <div
                    className={`button level-toggle builder-level-title${
                      builderLevelHasSeed ? "" : " is-missing"
                    }`}
                  >
                    <span className="level-toggle-label">Level {builderLevelDisplay}</span>
                  </div>
                  <button
                    type="button"
                    className="button button-ghost builder-level-step"
                    onClick={() => navigateBuilderLevel(1)}
                    disabled={builderLevelDisplay >= totalLevels}
                    aria-label="Next level"
                  >
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path
                        d="M9 6l6 6-6 6"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.4"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </button>
                </div>
                <div
                  className="board"
                  style={{
                    "--cols": COLS,
                    "--rows": ROWS
                  }}
                >
                  {builderTiles.map((tile, index) => (
                    <Tile
                      key={tile.id}
                      tile={{
                        ...tile,
                        completeDirs: builderCompleteDirs.get(tile.id),
                        waveActive: false
                      }}
                      onRotate={() => rotateBuilderTile(index)}
                    />
                  ))}
                </div>
              </div>
            </main>

            <aside className="builder-panel">
              <div className="builder-section">
                <div className="builder-section-header">
                  <span className="label">Seed</span>
                  {seedParseError ? <span className="builder-chip">Invalid</span> : null}
                  {builderCopyNotice ? <span className="builder-chip">Copied</span> : null}
                </div>
                <div className="builder-seed-row">
                  <input
                    type="text"
                    className="builder-seed-code builder-seed-input"
                    value={builderSeedDraft}
                    onFocus={() => {
                      seedEditingRef.current = true;
                    }}
                    onBlur={() => {
                      seedEditingRef.current = false;
                      applyBuilderSeedDraft();
                    }}
                    onChange={(event) => setBuilderSeedDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        const ok = applyBuilderSeedDraft();
                        if (ok) event.currentTarget.blur();
                      }
                      if (event.key === "Escape") {
                        setBuilderSeedDraft(builderSeed);
                        setSeedParseError("");
                        event.currentTarget.blur();
                      }
                    }}
                  />
                  <button
                    type="button"
                    className="button button-ghost builder-action"
                    onClick={handleCopyBuilderSeed}
                  >
                    Copy
                  </button>
                  <button
                    type="button"
                    className="button button-ghost builder-action"
                    onClick={rollBuilderVariant}
                  >
                    Shuffle
                  </button>
                </div>
                <p className="builder-note">
                  Seed encodes slider settings plus the variant.
                </p>
              </div>

              <div className="builder-section builder-assign">
                <div className="builder-section-header">
                  <span className="label">Assign Level</span>
                  {assignedSeedForLevel ? (
                    <span className="builder-chip">Overwriting</span>
                  ) : null}
                </div>
                <div className="builder-assign-row">
                  <input
                    type="number"
                    className="input"
                    min="1"
                    max={totalLevels}
                    step="1"
                    inputMode="numeric"
                    value={builderLevel}
                    onChange={(event) => setBuilderLevel(event.target.value)}
                  />
                  <button
                    type="button"
                    className="button"
                    onClick={handleAssignLevel}
                    disabled={!levelIsValid}
                  >
                    Assign
                  </button>
                  <button
                    type="button"
                    className="button button-ghost builder-action"
                    onClick={() => handleClearLevel(levelNumber)}
                    disabled={!levelIsValid || !assignedSeedForLevel}
                  >
                    Clear
                  </button>
                </div>
                <p className="builder-note">
                  Assigns the current seed to the selected level.
                </p>
              </div>

              <div className="builder-section builder-sliders">
                <div className="builder-section-header">
                  <span className="label">Tuning</span>
                  <div className="builder-mode-toggle" role="tablist">
                    <button
                      type="button"
                      role="tab"
                      aria-selected={builderMode === "simple"}
                      className={`builder-mode-button${builderMode === "simple" ? " is-active" : ""}`}
                      onClick={() => setBuilderMode("simple")}
                    >
                      Simple
                    </button>
                    <button
                      type="button"
                      role="tab"
                      aria-selected={builderMode === "advanced"}
                      className={`builder-mode-button${builderMode === "advanced" ? " is-active" : ""}`}
                      onClick={() => setBuilderMode("advanced")}
                    >
                      Advanced
                    </button>
                  </div>
                </div>

                {builderMode === "simple" ? (
                  <>
                    <div className="builder-slider">
                      <div className="builder-slider-header">
                        <span className="label">Difficulty</span>
                        <span className="builder-slider-value">{builderMeta.difficulty}</span>
                      </div>
                      <input
                        type="range"
                        min="0"
                        max="100"
                        value={builderMeta.difficulty}
                        onChange={(event) => updateBuilderMeta("difficulty", event.target.value)}
                      />
                      <p className="builder-slider-note">
                        Easy ← many gaps · packed →  Hard. Auto-scales gap rate and empty-run limits.
                      </p>
                    </div>

                    <div className="builder-slider">
                      <div className="builder-slider-header">
                        <span className="label">Path Style</span>
                        <span className="builder-slider-value">{builderMeta.pathStyle}</span>
                      </div>
                      <input
                        type="range"
                        min="0"
                        max="100"
                        value={builderMeta.pathStyle}
                        onChange={(event) => updateBuilderMeta("pathStyle", event.target.value)}
                      />
                      <p className="builder-slider-note">
                        Grid (straights) ← → Winding (curves, short runs).
                      </p>
                    </div>

                    <div className="builder-slider">
                      <div className="builder-slider-header">
                        <span className="label">Gap Layout</span>
                        <span className="builder-slider-value">{builderMeta.gapLayout}</span>
                      </div>
                      <input
                        type="range"
                        min="0"
                        max="100"
                        value={builderMeta.gapLayout}
                        onChange={(event) => updateBuilderMeta("gapLayout", event.target.value)}
                      />
                      <p className="builder-slider-note">
                        One blob at the edges ← → Scattered clumps, tiles centred.
                      </p>
                    </div>

                    <div className="builder-slider">
                      <div className="builder-slider-header">
                        <span className="label">Terminals</span>
                        <span className="builder-slider-value">{builderMeta.terminals}</span>
                      </div>
                      <input
                        type="range"
                        min="0"
                        max="100"
                        value={builderMeta.terminals}
                        onChange={(event) => updateBuilderMeta("terminals", event.target.value)}
                      />
                      <p className="builder-slider-note">
                        Sparse, spaced out ← → Dense, close together.
                      </p>
                    </div>

                    <div className="builder-slider">
                      <div className="builder-slider-header">
                        <span className="label">Crosses</span>
                        <span className="builder-slider-value">{builderMeta.crosses}</span>
                      </div>
                      <input
                        type="range"
                        min="0"
                        max="100"
                        value={builderMeta.crosses}
                        onChange={(event) => updateBuilderMeta("crosses", event.target.value)}
                      />
                      <p className="builder-slider-note">
                        How often the 4-way cross piece appears on a board.
                      </p>
                    </div>

                    <div className="builder-slider">
                      <div className="builder-slider-header">
                        <span className="label">Seed Variant</span>
                        <span className="builder-slider-value">
                          <input
                            type="number"
                            className="builder-number"
                            min={PROGRESSION_SETTINGS_RANGES.variant.min}
                            max={PROGRESSION_SETTINGS_RANGES.variant.max}
                            step="1"
                            value={builderSettings.variant}
                            onChange={(event) =>
                              updateBuilderSetting("variant", Number(event.target.value))
                            }
                          />
                        </span>
                      </div>
                      <input
                        type="range"
                        min={PROGRESSION_SETTINGS_RANGES.variant.min}
                        max={PROGRESSION_SETTINGS_RANGES.variant.max}
                        value={builderSettings.variant}
                        onChange={(event) =>
                          updateBuilderSetting("variant", Number(event.target.value))
                        }
                      />
                      <p className="builder-slider-note">
                        Re-rolls layout without changing the tuning.
                      </p>
                    </div>
                  </>
                ) : (
                <>
                <div className="builder-slider">
                  <div className="builder-slider-header">
                    <span className="label">Gap Frequency</span>
                    <span className="builder-slider-value">
                      <input
                        type="number"
                        className="builder-number"
                        min={PROGRESSION_SETTINGS_RANGES.gapRate.min}
                        max={PROGRESSION_SETTINGS_RANGES.gapRate.max}
                        step="1"
                        value={builderSettings.gapRate}
                        onChange={(event) =>
                          updateBuilderSetting("gapRate", Number(event.target.value))
                        }
                      />
                      <span className="builder-value-suffix">
                        % (eff {effectiveGapRate}%) / {builderConfig.blanks.min} gaps · {builderTileCount} tiles
                      </span>
                    </span>
                  </div>
                  <input
                    type="range"
                    min={PROGRESSION_SETTINGS_RANGES.gapRate.min}
                    max={PROGRESSION_SETTINGS_RANGES.gapRate.max}
                    value={builderSettings.gapRate}
                    onChange={(event) =>
                      updateBuilderSetting("gapRate", Number(event.target.value))
                    }
                  />
                  <div className="builder-input-row">
                    <span className="builder-input-label">Tiles</span>
                    <input
                      type="number"
                      className="builder-number"
                      min={MIN_TILES}
                      max={totalCells}
                      step="1"
                      value={builderTileCount}
                      onChange={(event) => setGapRateFromTileCount(event.target.value)}
                    />
                    <span className="builder-input-label">Gaps</span>
                    <input
                      type="number"
                      className="builder-number"
                      min="0"
                      max={maxBlankCells}
                      step="1"
                      value={builderConfig.blanks.min}
                      onChange={(event) => setGapRateFromGapCells(event.target.value)}
                    />
                  </div>
                  <p className="builder-slider-note">
                    More gaps = easier. Gap counts snap to multiples of 4.
                  </p>
                </div>

                <div className="builder-slider">
                  <div className="builder-slider-header">
                    <span className="label">Gap Clustering</span>
                    <span className="builder-slider-value">
                      <input
                        type="number"
                        className="builder-number"
                        min={PROGRESSION_SETTINGS_RANGES.gapClusters.min}
                        max={PROGRESSION_SETTINGS_RANGES.gapClusters.max}
                        step="1"
                        value={builderSettings.gapClusters}
                        onChange={(event) =>
                          updateBuilderSetting("gapClusters", Number(event.target.value))
                        }
                      />
                    </span>
                  </div>
                  <input
                    type="range"
                    min={PROGRESSION_SETTINGS_RANGES.gapClusters.min}
                    max={PROGRESSION_SETTINGS_RANGES.gapClusters.max}
                    value={builderSettings.gapClusters}
                    onChange={(event) =>
                      updateBuilderSetting("gapClusters", Number(event.target.value))
                    }
                  />
                  <p className="builder-slider-note">
                    Higher values clump gaps together.
                  </p>
                </div>

                <div className="builder-slider">
                  <div className="builder-slider-header">
                    <span className="label">Tile Centrality</span>
                    <span className="builder-slider-value">
                      <input
                        type="number"
                        className="builder-number"
                        min={PROGRESSION_SETTINGS_RANGES.centerBias.min}
                        max={PROGRESSION_SETTINGS_RANGES.centerBias.max}
                        step="1"
                        value={builderSettings.centerBias}
                        onChange={(event) =>
                          updateBuilderSetting("centerBias", Number(event.target.value))
                        }
                      />
                      <span className="builder-value-suffix">% centered</span>
                    </span>
                  </div>
                  <input
                    type="range"
                    min={PROGRESSION_SETTINGS_RANGES.centerBias.min}
                    max={PROGRESSION_SETTINGS_RANGES.centerBias.max}
                    value={builderSettings.centerBias}
                    onChange={(event) =>
                      updateBuilderSetting("centerBias", Number(event.target.value))
                    }
                  />
                  <p className="builder-slider-note">
                    0 = chaotic spread, 100 = tight center focus.
                  </p>
                </div>

                <div className="builder-slider">
                  <div className="builder-slider-header">
                    <span className="label">Curve Bias</span>
                    <span className="builder-slider-value">
                      <input
                        type="number"
                        className="builder-number"
                        min={PROGRESSION_SETTINGS_RANGES.curveBias.min}
                        max={PROGRESSION_SETTINGS_RANGES.curveBias.max}
                        step="1"
                        value={builderSettings.curveBias}
                        onChange={(event) =>
                          updateBuilderSetting("curveBias", Number(event.target.value))
                        }
                      />
                      <span className="builder-value-suffix">% target</span>
                    </span>
                  </div>
                  <input
                    type="range"
                    min={PROGRESSION_SETTINGS_RANGES.curveBias.min}
                    max={PROGRESSION_SETTINGS_RANGES.curveBias.max}
                    value={builderSettings.curveBias}
                    onChange={(event) =>
                      updateBuilderSetting("curveBias", Number(event.target.value))
                    }
                  />
                  <p className="builder-slider-note">More curves = trickier.</p>
                </div>

                <div className="builder-slider">
                  <div className="builder-slider-header">
                    <span className="label">Terminal Density</span>
                    <span className="builder-slider-value">
                      <input
                        type="number"
                        className="builder-number"
                        min={PROGRESSION_SETTINGS_RANGES.terminalRate.min}
                        max={PROGRESSION_SETTINGS_RANGES.terminalRate.max}
                        step="1"
                        value={builderSettings.terminalRate}
                        onChange={(event) =>
                          updateBuilderSetting("terminalRate", Number(event.target.value))
                        }
                      />
                      <span className="builder-value-suffix">
                        % / {builderConfig.minTerminals}-{builderConfig.maxTerminals}
                      </span>
                    </span>
                  </div>
                  <input
                    type="range"
                    min={PROGRESSION_SETTINGS_RANGES.terminalRate.min}
                    max={PROGRESSION_SETTINGS_RANGES.terminalRate.max}
                    value={builderSettings.terminalRate}
                    onChange={(event) =>
                      updateBuilderSetting("terminalRate", Number(event.target.value))
                    }
                  />
                  <p className="builder-slider-note">
                    More terminals add structure.
                  </p>
                </div>

                <div className="builder-slider">
                  <div className="builder-slider-header">
                    <span className="label">Terminal Spacing</span>
                    <span className="builder-slider-value">
                      <input
                        type="number"
                        className="builder-number"
                        min={PROGRESSION_SETTINGS_RANGES.terminalSpacing.min}
                        max={PROGRESSION_SETTINGS_RANGES.terminalSpacing.max}
                        step="1"
                        value={builderSettings.terminalSpacing}
                        onChange={(event) =>
                          updateBuilderSetting("terminalSpacing", Number(event.target.value))
                        }
                      />
                      <span className="builder-value-suffix">tiles apart</span>
                    </span>
                  </div>
                  <input
                    type="range"
                    min={PROGRESSION_SETTINGS_RANGES.terminalSpacing.min}
                    max={PROGRESSION_SETTINGS_RANGES.terminalSpacing.max}
                    value={builderSettings.terminalSpacing}
                    onChange={(event) =>
                      updateBuilderSetting("terminalSpacing", Number(event.target.value))
                    }
                  />
                  <p className="builder-slider-note">
                    Higher spacing keeps terminals separated.
                  </p>
                </div>

                <div className="builder-slider">
                  <div className="builder-slider-header">
                    <span className="label">Max Straight Run</span>
                    <span className="builder-slider-value">
                      <input
                        type="number"
                        className="builder-number"
                        min={PROGRESSION_SETTINGS_RANGES.straightRunMax.min}
                        max={PROGRESSION_SETTINGS_RANGES.straightRunMax.max}
                        step="1"
                        value={builderSettings.straightRunMax}
                        onChange={(event) =>
                          updateBuilderSetting("straightRunMax", Number(event.target.value))
                        }
                      />
                      <span className="builder-value-suffix">tiles</span>
                    </span>
                  </div>
                  <input
                    type="range"
                    min={PROGRESSION_SETTINGS_RANGES.straightRunMax.min}
                    max={PROGRESSION_SETTINGS_RANGES.straightRunMax.max}
                    value={builderSettings.straightRunMax}
                    onChange={(event) =>
                      updateBuilderSetting("straightRunMax", Number(event.target.value))
                    }
                  />
                  <p className="builder-slider-note">
                    Lower values force more turns.
                  </p>
                </div>

                <div className="builder-slider">
                  <div className="builder-slider-header">
                    <span className="label">Empty Row Run</span>
                    <span className="builder-slider-value">
                      <input
                        type="number"
                        className="builder-number"
                        min={PROGRESSION_SETTINGS_RANGES.emptyRowMax.min}
                        max={PROGRESSION_SETTINGS_RANGES.emptyRowMax.max}
                        step="1"
                        value={builderSettings.emptyRowMax}
                        onChange={(event) =>
                          updateBuilderSetting("emptyRowMax", Number(event.target.value))
                        }
                      />
                      <span className="builder-value-suffix">rows</span>
                    </span>
                  </div>
                  <input
                    type="range"
                    min={PROGRESSION_SETTINGS_RANGES.emptyRowMax.min}
                    max={PROGRESSION_SETTINGS_RANGES.emptyRowMax.max}
                    value={builderSettings.emptyRowMax}
                    onChange={(event) =>
                      updateBuilderSetting("emptyRowMax", Number(event.target.value))
                    }
                  />
                  <p className="builder-slider-note">
                    Limits consecutive fully empty rows.
                  </p>
                </div>

                <div className="builder-slider">
                  <div className="builder-slider-header">
                    <span className="label">Empty Col Run</span>
                    <span className="builder-slider-value">
                      <input
                        type="number"
                        className="builder-number"
                        min={PROGRESSION_SETTINGS_RANGES.emptyColMax.min}
                        max={PROGRESSION_SETTINGS_RANGES.emptyColMax.max}
                        step="1"
                        value={builderSettings.emptyColMax}
                        onChange={(event) =>
                          updateBuilderSetting("emptyColMax", Number(event.target.value))
                        }
                      />
                      <span className="builder-value-suffix">cols</span>
                    </span>
                  </div>
                  <input
                    type="range"
                    min={PROGRESSION_SETTINGS_RANGES.emptyColMax.min}
                    max={PROGRESSION_SETTINGS_RANGES.emptyColMax.max}
                    value={builderSettings.emptyColMax}
                    onChange={(event) =>
                      updateBuilderSetting("emptyColMax", Number(event.target.value))
                    }
                  />
                  <p className="builder-slider-note">
                    Limits consecutive fully empty columns.
                  </p>
                </div>

                <div className="builder-slider">
                  <div className="builder-slider-header">
                    <span className="label">Cross Pieces</span>
                    <span className="builder-slider-value">
                      <input
                        type="number"
                        className="builder-number"
                        min={PROGRESSION_SETTINGS_RANGES.crossRate.min}
                        max={PROGRESSION_SETTINGS_RANGES.crossRate.max}
                        step="1"
                        value={builderSettings.crossRate}
                        onChange={(event) =>
                          updateBuilderSetting("crossRate", Number(event.target.value))
                        }
                      />
                      <span className="builder-value-suffix">max per board</span>
                    </span>
                  </div>
                  <input
                    type="range"
                    min={PROGRESSION_SETTINGS_RANGES.crossRate.min}
                    max={PROGRESSION_SETTINGS_RANGES.crossRate.max}
                    value={builderSettings.crossRate}
                    onChange={(event) =>
                      updateBuilderSetting("crossRate", Number(event.target.value))
                    }
                  />
                  <p className="builder-slider-note">
                    Upper bound on the 4-way cross piece count per board.
                  </p>
                </div>

                <div className="builder-slider">
                  <div className="builder-slider-header">
                    <span className="label">Seed Variant</span>
                    <span className="builder-slider-value">
                      <input
                        type="number"
                        className="builder-number"
                        min={PROGRESSION_SETTINGS_RANGES.variant.min}
                        max={PROGRESSION_SETTINGS_RANGES.variant.max}
                        step="1"
                        value={builderSettings.variant}
                        onChange={(event) =>
                          updateBuilderSetting("variant", Number(event.target.value))
                        }
                      />
                    </span>
                  </div>
                  <input
                    type="range"
                    min={PROGRESSION_SETTINGS_RANGES.variant.min}
                    max={PROGRESSION_SETTINGS_RANGES.variant.max}
                    value={builderSettings.variant}
                    onChange={(event) =>
                      updateBuilderSetting("variant", Number(event.target.value))
                    }
                  />
                  <p className="builder-slider-note">
                    Alternate layout without changing sliders.
                  </p>
                </div>
                </>
                )}
              </div>
            </aside>
          </section>

          <section className="floating-controls builder-footer">
            <div className="builder-panel builder-map-panel">
              <div className="builder-section builder-save">
                <div className="builder-section-header">
                  <span className="label">Save Levels</span>
                  {saveNotice ? <span className="builder-chip">Saved</span> : null}
                  {!saveNotice && hasUnsavedLevels ? (
                    <span className="builder-chip">Unsaved</span>
                  ) : null}
                </div>
                <div className="builder-export-row">
                  <button
                    type="button"
                    className="button"
                    onClick={handleSaveLevels}
                    disabled={isBaking}
                  >
                    {isBaking ? "Saving..." : "Save"}
                  </button>
                  <button
                    type="button"
                    className="button button-ghost"
                    onClick={handleLoadFromBundle}
                    disabled={isBaking}
                  >
                    Load from bundle
                  </button>
                </div>
                <p className="builder-note">
                  Save writes the current map into the game source. Load from bundle replaces it with the last saved file.
                  {lastSavedLabel ? ` Last saved ${lastSavedLabel}.` : ""}
                </p>
              </div>

              <div className="builder-section builder-levels">
                {hasDuplicateSeeds ? (
                  <p className="builder-error">
                    Duplicate seeds detected on levels {duplicateSeedList.join(", ")}. Each level should have a unique seed.
                  </p>
                ) : null}
                <div className="builder-levels-header">
                  <span className="label">Level Map</span>
                  <span className="builder-count">
                    {assignedCount}/
                    <input
                      type="number"
                      className="builder-count-input"
                      min={MIN_TOTAL_LEVELS}
                      max={MAX_TOTAL_LEVELS}
                      value={totalLevels}
                      onChange={(event) => setTotalLevels(event.target.value)}
                      aria-label="Total levels"
                    />
                  </span>
                </div>
                <p className="builder-note">
                  Paste seeds directly into any level and click Save. Change the total to grow or shrink the journey — extra seeds remain in storage if you shrink and re-expand.
                </p>
                <ul className="builder-level-list">
                  {levelEntries.map(({ level, seed }) => (
                    <li
                      key={level}
                      className={`builder-level-item${
                        duplicateSeedLevels.has(level) ? " is-duplicate" : ""
                      }`}
                    >
                      <span className="builder-level-number">Level {level}</span>
                      <input
                        type="text"
                        className="builder-level-seed builder-seed-input"
                        value={seed}
                        placeholder="Paste seed…"
                        onChange={(event) => {
                          const nextSeed = event.target.value;
                          setProgressionLevels((prev) => {
                            const next = [...prev];
                            next[level - 1] = nextSeed.trim();
                            return next;
                          });
                        }}
                        onBlur={(event) => {
                          const parsed = parseProgressionSeed(event.target.value.trim());
                          if (!parsed && event.target.value.trim() !== "") {
                            event.target.classList.add("is-invalid");
                          } else {
                            event.target.classList.remove("is-invalid");
                          }
                        }}
                      />
                      <div className="builder-level-actions">
                        <button
                          type="button"
                          className="button button-ghost builder-action"
                          onClick={() => handleLoadLevelSeed(seed, level)}
                          disabled={!seed}
                        >
                          Load
                        </button>
                        <button
                          type="button"
                          className="button button-ghost builder-action"
                          onClick={() => handleClearLevel(level)}
                          disabled={!seed}
                        >
                          Clear
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="builder-section builder-theme-unlocks">
                <div className="builder-section-header">
                  <span className="label">Theme Unlocks</span>
                </div>
                <p className="builder-note">
                  Set the level at which each theme unlocks.
                </p>
                <ul className="theme-unlock-list">
                  {themes.filter((theme) => theme.unlockable).map((theme) => (
                    <li key={theme.name} className="theme-unlock-item">
                      <span
                        className="theme-unlock-swatch"
                        style={{ background: theme.colors?.[2] || theme.colors?.[1] || "#888" }}
                        aria-hidden="true"
                      />
                      <span className="theme-unlock-name">{theme.name}</span>
                      <input
                        type="number"
                        className="theme-unlock-input"
                        min={1}
                        max={MAX_TOTAL_LEVELS}
                        value={theme.unlockLevel ?? ""}
                        onChange={(event) => setThemeUnlockOverride(theme.name, event.target.value)}
                        aria-label={`${theme.name} unlock level`}
                      />
                    </li>
                  ))}
                </ul>
              </div>

              <div className="builder-section builder-export">
                <div className="builder-section-header">
                  <span className="label">Export</span>
                </div>
                <div className="builder-export-row">
                  <button type="button" className="button" onClick={handleExportLevelsJSON}>
                    Export JSON
                  </button>
                  <button
                    type="button"
                    className="button button-ghost builder-action"
                    onClick={handleExportLevelsCSV}
                  >
                    Export CSV
                  </button>
                </div>
                <p className="builder-note">
                  Exports all {totalLevels} levels (blank seeds stay blank).
                </p>
              </div>

            </div>
          </section>
        </>
      ) : (
        <>
          <header className="top-controls">
            <div className="header-title-row header-title-row-game">
              <button
                type="button"
                className="button button-ghost home-icon"
                onClick={() => { impactLight(); setScreen("home"); }}
                aria-label="Back to home"
                title="Back to home"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path
                    d="M4 11.5l8-7 8 7"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <path
                    d="M6.5 10.5V20h11V10.5"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
              {isProgress && progressLevelsAvailable ? (
                <button
                  type="button"
                  className="difficulty-inline-label"
                  onClick={toggleLevelPicker}
                  aria-label={showLevelPicker ? "Hide level picker" : "Show level picker"}
                  title={showLevelPicker ? "Hide levels" : "Show levels"}
                  aria-pressed={showLevelPicker}
                >
                  <span className="difficulty-inline-name">Level {progressLevelNumber}</span>
                  <span className="difficulty-inline-hint">{showLevelPicker ? "Tap to close" : "Tap to change"}</span>
                </button>
              ) : isEndless ? (
                <button
                  type="button"
                  className="difficulty-inline-label"
                  onClick={() => { impactLight(); setDifficultySheetSource("in-game"); }}
                  aria-label="Change difficulty"
                >
                  <span className="difficulty-inline-name">{DIFFICULTY_TIERS[difficultyIndex]?.label || "Difficulty"}</span>
                  <span className="difficulty-inline-hint">Tap to change</span>
                </button>
              ) : (
                <span className="header-title-spacer" aria-hidden="true" />
              )}
              <button
                type="button"
                className="button button-ghost home-icon"
                onClick={() => { impactLight(); setShowGameSettings(true); }}
                aria-label="Settings"
                title="Settings"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M19.14 12.94a7.07 7.07 0 0 0 .06-.94c0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.49.49 0 0 0-.59-.22l-2.39.96a7.04 7.04 0 0 0-1.62-.94l-.36-2.54a.48.48 0 0 0-.48-.41h-3.84a.48.48 0 0 0-.48.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96a.48.48 0 0 0-.59.22L2.74 8.87a.48.48 0 0 0 .12.61l2.03 1.58c-.05.3-.07.62-.07.94s.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.3.59.22l2.39-.96c.5.37 1.03.7 1.62.94l.36 2.54c.05.24.26.41.48.41h3.84c.24 0 .44-.17.48-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32a.49.49 0 0 0-.12-.61l-2.03-1.58zM12 15.6A3.6 3.6 0 1 1 12 8.4a3.6 3.6 0 0 1 0 7.2z" fill="currentColor"/>
                </svg>
              </button>
            </div>
          </header>

          <main className="board-wrap">
            <div className="board-toolbar">
              <button
                type="button"
                className={`button button-ghost board-toolbar-icon${resetSpinning ? " reset-spin" : ""}`}
                onClick={() => {
                  if (resetDisabled || (isProgress && !progressLevelsAvailable)) return;
                  impactLight();
                  setResetSpinning(true);
                  window.setTimeout(() => setResetSpinning(false), 420);
                  const nextSeed = isProgress ? progressSeed : seedText;
                  if (!nextSeed) return;
                  setSeedText(nextSeed);
                  regenerate(nextSeed, difficultyLevels[difficultyIndex], { shuffleTheme: false });
                }}
                aria-label="Reset level"
                title="Reset"
                disabled={resetDisabled || (isProgress && !progressLevelsAvailable)}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path
                    d="M17 7a7 7 0 1 0 1.9 6.3"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <path
                    d="M19 4.5v4.8h-4.8"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
              {isEndless ? (
                <button
                  type="button"
                  className="button button-ghost board-toolbar-primary"
                  onClick={() => {
                    impactLight();
                    const nextSeed = Math.random().toString(36).slice(2, 8);
                    setSeedText(nextSeed);
                    regenerate(nextSeed, difficultyLevels[difficultyIndex], { shuffleTheme: true });
                  }}
                >
                  New level
                </button>
              ) : null}
            </div>
            {showSuccess && isBoardScreen && !showLevelPicker ? (
              <div className="success-overlay">
                <div className="success-confetti">
                  {Array.from({ length: confettiCount }).map((_, idx) => {
                    const palette = themes[themeIndex]?.colors || themes[0].colors;
                    const color = palette[idx % palette.length];
                    const size = 6 + (idx % 5) * 3 + (idx % 2);
                    const drift = (idx % 2 === 0 ? 1 : -1) * (12 + (idx % 7) * 6);
                    const rotate = (idx % 8) * 18;
                    const delay = (idx % 20) * 45;
                    const duration = 1600 + (idx % 10) * 140;
                    const radius = idx % 5 === 0 ? "999px" : "2px";
                    return (
                      <span
                        key={idx}
                        className="confetti-piece"
                        style={{
                          "--confetti-x": `${(idx % 24) * 4 + 2}%`,
                          "--confetti-delay": `${delay}ms`,
                          "--confetti-duration": `${duration}ms`,
                          "--confetti-size": `${size}px`,
                          "--confetti-rotate": `${rotate}deg`,
                          "--confetti-color": color,
                          "--confetti-drift": `${drift}px`,
                          "--confetti-radius": radius
                        }}
                      />
                    );
                  })}
                </div>
                <div className="success-stack">
                  <div className="success-card">
                    <div className="success-icon">
                      <div className="success-diamond">
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                          <path d="M6 12l4 4 8-8" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </div>
                    </div>
                    <p className="success-title">{successTitle}</p>
                    <div className={`success-actions${nextProgressLevelLocked ? " success-actions--stacked" : ""}`}>
                      {isProgress ? (
                        showFinalSuccess ? (
                          <>
                            <button
                              type="button"
                              className="button success-action"
                              onClick={() => {
                                impactLight();
                                cancelFinalAnimations();
                                setShowFinalSuccess(false);
                                setShowLevelPicker(false);
                                setScreen("home");
                              }}
                            >
                              Go home
                            </button>
                            <button
                              type="button"
                              className="button button-ghost success-action"
                              onClick={() => {
                                impactLight();
                                cancelFinalAnimations();
                                setShowFinalSuccess(false);
                                setShowLevelPicker(false);
                                setScreen("endless");
                              }}
                            >
                              Endless mode
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              type="button"
                              className={nextProgressLevelLocked ? "button button-ghost success-action" : "button success-action"}
                              onClick={() => {
                                impactLight();
                                setShowSuccess(false);
                                if (!progressSeed) return;
                                setSeedText(progressSeed);
                                regenerate(progressSeed, difficultyLevels[difficultyIndex], { shuffleTheme: false });
                              }}
                            >
                              Reset
                            </button>
                            <button
                              type="button"
                              className={nextProgressLevelLocked ? "button success-action" : "button button-ghost success-action"}
                              disabled={!hasNextProgressLevel && !nextProgressLevelLocked}
                              onClick={() => {
                                if (nextProgressLevelLocked) {
                                  impactLight();
                                  setShowSuccess(false);
                                  openPaywall();
                                  pendingContinueLevelRef.current = nextProgressLevel?.level ?? null;
                                  return;
                                }
                                if (!hasNextProgressLevel) return;
                                impactLight();
                                setShowSuccess(false);
                                if (!nextProgressLevel) return;
                                handleSelectProgressLevel(nextProgressLevel.level);
                              }}
                            >
                              {nextProgressLevelLocked ? "Unlock to keep playing" : "Next level"}
                            </button>
                          </>
                        )
                      ) : (
                        <>
                          <button
                            type="button"
                            className="button success-action"
                            onClick={() => {
                              impactLight();
                              setShowSuccess(false);
                              regenerate(seedText, difficultyLevels[difficultyIndex], { shuffleTheme: false });
                            }}
                          >
                            Reset
                          </button>
                          <button
                            type="button"
                            className="button button-ghost success-action"
                            onClick={() => {
                              impactLight();
                              setShowSuccess(false);
                              const nextSeed = Math.random().toString(36).slice(2, 8);
                              setSeedText(nextSeed);
                              regenerate(nextSeed, difficultyLevels[difficultyIndex], { shuffleTheme: true });
                            }}
                          >
                            New level
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                  {isProgress && unlockableThemeForLevel ? (
                    <div className="success-unlock-card">
                      <div className="success-unlock-copy">
                        <span className="success-unlock-label">New theme unlocked</span>
                        <span className="success-unlock-name">
                          {unlockableThemeForLevel.theme.name}
                        </span>
                      </div>
                      <button
                        type="button"
                        className="button button-ghost success-unlock-cta"
                        onClick={() => handleApplyUnlockedTheme(unlockableThemeForLevel.index)}
                      >
                        {successThemeApplied ? "Undo" : "Apply theme"}
                      </button>
                    </div>
                  ) : null}
                </div>
              </div>
            ) : null}
            {isProgress && !progressLevelsAvailable ? (
              <p className="builder-empty">No progress levels assigned yet.</p>
            ) : (
              <div
                className="board"
                style={{
                  "--cols": COLS,
                  "--rows": ROWS
                }}
              >
                {tiles.map((tile, index) => (
                  <Tile
                    key={tile.id}
                    tile={{
                      ...tile,
                      completeDirs: completeDirs.get(tile.id),
                      pulseDelay: pulseDelays.get(tile.id),
                      waveDelay: waveDelays.get(tile.id),
                      waveActive
                    }}
                    onRotate={() => rotateTile(index)}
                  />
                ))}
              </div>
            )}
          </main>

        </>
      )}

      {needRefresh ? (
        <div className="pwa-toast" role="status" aria-live="polite">
          <div className="pwa-toast-copy">
            <p className="pwa-toast-title">Update ready</p>
            <p className="pwa-toast-note">A new version is available.</p>
          </div>
          <div className="pwa-toast-actions">
            <button type="button" className="button" onClick={handleUpdateNow}>
              Refresh
            </button>
            <button type="button" className="button button-ghost" onClick={handleUpdateLater}>
              Later
            </button>
          </div>
        </div>
      ) : null}

      {/* Sound testing UI hidden */}
    </div>
  );
}
