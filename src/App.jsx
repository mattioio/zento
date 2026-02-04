import React, { useEffect, useMemo, useRef, useState } from "react";
import { audioAttribution, audioTracks } from "./audioManifest.js";

const ROWS = 10;
const COLS = 6;

const TILE_TYPES = ["blank", "terminal", "straight", "curveLeft", "curveRight", "tJunction"];

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

const BASE_EDGES = {
  blank: [false, false, false, false],
  terminal: [false, false, true, false],
  straight: [true, false, true, false],
  curveLeft: [true, false, false, true],
  curveRight: [true, true, false, false],
  tJunction: [true, true, false, true],
  crossCurve: [true, true, true, true]
};

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
  maxEmptyColRun = Infinity
) {
  if (targetCells <= 0) return;
  const groupTarget = Math.max(1, Math.round(targetCells / 4));
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

  const selectGroupsInClusters = (clusterCountValue) => {
    const minGroups = Math.max(1, Math.ceil(minClusterCells / 4));
    const chosen = new Set();
    const clusters = [];
    const clusterTotal = Math.max(1, clusterCountValue || 1);
    const maxClusterTotal = Math.max(1, Math.floor(groupTarget / minGroups));
    const finalClusterTotal = Math.min(clusterTotal, maxClusterTotal);
    for (let i = 0; i < finalClusterTotal; i += 1) {
      let seedIndex = Math.floor(rand() * groups.length);
      let attempts = 0;
      while (chosen.has(seedIndex) && attempts < 20) {
        seedIndex = Math.floor(rand() * groups.length);
        attempts += 1;
      }
      chosen.add(seedIndex);
      clusters.push([seedIndex]);
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
        let nextIndex = Math.floor(rand() * groups.length);
        let attempts = 0;
        while (chosen.has(nextIndex) && attempts < 50) {
          nextIndex = Math.floor(rand() * groups.length);
          attempts += 1;
        }
        if (!chosen.has(nextIndex)) {
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
    return Array.from(chosen).map((idx) => groups[idx].cells);
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
    for (const group of grouped) {
      if (blanks.size >= groupTarget * 4) break;
      group.forEach((key) => blanks.add(key));
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
  const difficultyConfig = {
    easy: { min: 13, max: 20, clusters: 3, minClusterCells: 6, maxEmptyRowRun: 2, maxEmptyColRun: 2 },
    medium: { min: 4, max: 12, clusters: 2, minClusterCells: 6, maxEmptyRowRun: 2, maxEmptyColRun: 2 },
    hard: { min: 0, max: 0, clusters: 0, minClusterCells: 0, maxEmptyRowRun: 0, maxEmptyColRun: 0 }
  };
  const config = difficultyConfig[difficulty] || difficultyConfig.medium;
  const minTerminals = Math.max(6, Math.floor((ROWS * COLS) * 0.12));
  const maxTerminals = Math.max(minTerminals + 2, Math.floor((ROWS * COLS) * 0.22));
  const maxStraightRunAllowed = 4;
  const minTerminalDistance = 2;
  const maxTerminalClusterAllowed = 3;
  let attemptSeed = 0;
  while (attemptSeed < 60) {
    rand = mulberry32(seed + attemptSeed * 97);
    edgesByCell = generateSolvedEdges(ROWS, COLS, rand);
    if (config.max > 0) {
      const targetCount = config.min + Math.floor(rand() * (config.max - config.min + 1));
      applySymmetricBlanks(
        edgesByCell,
        ROWS,
        COLS,
        rand,
        targetCount,
        config.clusters,
        config.minClusterCells,
        config.maxEmptyRowRun,
        config.maxEmptyColRun
      );
    }
    const terminals = countTerminals(edgesByCell, ROWS, COLS);
    const longestRun = maxStraightRun(edgesByCell, ROWS, COLS);
    const tooClustered = hasCloseTerminals(edgesByCell, ROWS, COLS, minTerminalDistance);
    const terminalClusterSize = maxTerminalCluster(edgesByCell, ROWS, COLS);
    const edgeConnected = isEdgeGraphConnected(edgesByCell, ROWS, COLS);
    if (
      terminals >= minTerminals &&
      terminals <= maxTerminals &&
      longestRun <= maxStraightRunAllowed &&
      !tooClustered &&
      terminalClusterSize <= maxTerminalClusterAllowed &&
      edgeConnected
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

function generateSolvedEdges(rows, cols, rand) {
  const edgesByCell = new Map();
  const visited = new Set();
  const stack = [];

  const start = [0, 0];
  stack.push(start);
  visited.add(start.join("-"));
  edgesByCell.set(start.join("-"), [false, false, false, false]);

  while (stack.length) {
    const [r, c] = stack[stack.length - 1];
    const neighbors = [];
    if (r > 0 && !visited.has(`${r - 1}-${c}`)) neighbors.push([r - 1, c, 0]);
    if (c < cols - 1 && !visited.has(`${r}-${c + 1}`)) neighbors.push([r, c + 1, 1]);
    if (r < rows - 1 && !visited.has(`${r + 1}-${c}`)) neighbors.push([r + 1, c, 2]);
    if (c > 0 && !visited.has(`${r}-${c - 1}`)) neighbors.push([r, c - 1, 3]);

    if (neighbors.length === 0) {
      stack.pop();
      continue;
    }

    const nextIndex = Math.floor(rand() * neighbors.length);
    const [nr, nc, dir] = neighbors[nextIndex];
    const currentKey = `${r}-${c}`;
    const nextKey = `${nr}-${nc}`;

    const currentEdges = edgesByCell.get(currentKey) || [false, false, false, false];
    const nextEdges = edgesByCell.get(nextKey) || [false, false, false, false];
    currentEdges[dir] = true;
    nextEdges[oppositeDir(dir)] = true;
    edgesByCell.set(currentKey, currentEdges);
    edgesByCell.set(nextKey, nextEdges);

    visited.add(nextKey);
    stack.push([nr, nc]);
  }

  // Add extra edges to create cycles / higher-degree nodes (crosses).
  const candidates = [];
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      if (r < rows - 1) candidates.push([r, c, r + 1, c]);
      if (c < cols - 1) candidates.push([r, c, r, c + 1]);
    }
  }

  const maxCrosses = 1;
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
  const faceStyle = {};
  if (typeof tile.pulseDelay === "number") {
    faceStyle["--pulse-delay"] = `${tile.pulseDelay}ms`;
  }
  if (typeof tile.waveDelay === "number") {
    faceStyle["--wave-delay"] = `${tile.waveDelay}ms`;
  }
  const faceStyleProps = Object.keys(faceStyle).length > 0 ? faceStyle : undefined;
  return (
    <button
      type="button"
      className={`tile ${tile.type === "blank" ? "tile-blank" : ""} ${isTileComplete ? "tile-complete" : ""} ${typeof tile.pulseDelay === "number" ? "tile-pulse" : ""} ${tile.waveActive ? "tile-wave" : ""}`}
      onClick={onRotate}
      aria-label={`Tile ${tile.r + 1}, ${tile.c + 1}`}
      disabled={tile.type === "blank"}
    >
      <span className="tile-face" style={faceStyleProps} />
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

export default function App() {
  const difficultyLevels = ["easy", "medium", "hard"];
  const themes = [
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
      name: "Blue Mist",
      colors: ["#C1C6C8", "#A7B2B5", "#8C9DAF", "#6B7B8A", "#4A5B6D"]
    }
  ];

  const [themeIndex, setThemeIndex] = useState(() => {
    const savedTheme = Number(localStorage.getItem("zen_theme_index"));
    return Number.isNaN(savedTheme) ? 0 : Math.max(0, Math.min(savedTheme, themes.length - 1));
  });
  const [themeMode, setThemeMode] = useState(() => {
    const savedMode = localStorage.getItem("zen_theme_mode");
    return savedMode === "fixed" ? "fixed" : "random";
  });
  const [showThemePicker, setShowThemePicker] = useState(false);
  const [themePickerMounted, setThemePickerMounted] = useState(false);
  const [randomSwatchOffset, setRandomSwatchOffset] = useState(0);
  const initialDifficultyIndex = (() => {
    const savedDifficulty = localStorage.getItem("zen_difficulty");
    const idx = difficultyLevels.indexOf(savedDifficulty);
    return idx === -1 ? 1 : idx;
  })();
  const [difficultyIndex, setDifficultyIndex] = useState(initialDifficultyIndex);
  const initialSeed = useMemo(() => Math.random().toString(36).slice(2, 8), []);
  const [seedText, setSeedText] = useState(initialSeed);
  const initialTiles = makeBoard(initialSeed, difficultyLevels[initialDifficultyIndex]);
  const [tiles, setTiles] = useState(initialTiles);
  const [initialRotations, setInitialRotations] = useState(() =>
    initialTiles.map((tile) => tile.rotation)
  );
  const [resetSpinning, setResetSpinning] = useState(false);
  const [pulseDelays, setPulseDelays] = useState(new Map());
  const [waveDelays, setWaveDelays] = useState(new Map());
  const [waveActive, setWaveActive] = useState(false);
  const [solvedDim, setSolvedDim] = useState(false);
  const [fxVolume, setFxVolume] = useState(1);
  const [bgVolume, setBgVolume] = useState(0.3);
  const [boardNoise] = useState(1);
  const [rotateSoundIndex, setRotateSoundIndex] = useState(4);
  const [completeSoundIndex, setCompleteSoundIndex] = useState(2);
  const [bgQueue, setBgQueue] = useState([]);
  const [bgQueuePos, setBgQueuePos] = useState(0);
  const [bgNowPlayingIndex, setBgNowPlayingIndex] = useState(0);
  const [showAttribution, setShowAttribution] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [successMessage, setSuccessMessage] = useState("Well done");
  const initialRecentRandomThemes = useMemo(() => {
    try {
      const raw = localStorage.getItem("zen_recent_random_themes");
      const parsed = JSON.parse(raw ?? "[]");
      if (!Array.isArray(parsed)) return [];
      return parsed.filter((value) => Number.isInteger(value));
    } catch (err) {
      return [];
    }
  }, []);
  const recentRandomThemesRef = useRef(initialRecentRandomThemes);
  const successTimeoutRef = useRef(null);
  const waveStartTimeoutRef = useRef(null);
  const waveEndTimeoutRef = useRef(null);
  const prevConnectionBitsRef = useRef(new Map());
  const prevCompleteBitsRef = useRef(new Map());
  const prevSolvedRef = useRef(false);
  const pulseEndRef = useRef(0);
  const audioCtxRef = useRef(null);
  const bgAudioRef = useRef(null);
  const bgUserPausedRef = useRef(false);
  const hasInteractedRef = useRef(false);

  useEffect(() => {
    localStorage.setItem("zen_theme_index", String(themeIndex));
  }, [themeIndex]);

  useEffect(() => {
    const theme = themes[themeIndex] || themes[0];
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
    const root = document.documentElement;
    root.style.setProperty("--bg-start", c1);
    root.style.setProperty("--bg-mid", c2);
    root.style.setProperty("--bg-end", c3);
    root.style.setProperty("--accent", c4);
    root.style.setProperty("--loop", blend(c5, "#2f2a24", 0.45));
    root.style.setProperty("--loop-soft", "rgba(255, 255, 255, 0.75)");
    root.style.setProperty("--ink", blend(c5, "#2f2a24", 0.4));
    root.style.setProperty("--muted", blend(c4, "#2f2a24", 0.35));
    root.style.setProperty("--board-bg", "rgba(255, 255, 255, 0.1)");
  }, [themeIndex]);

  const connections = useMemo(() => computeConnections(tiles), [tiles]);
  const completeDirs = useMemo(() => computeCompleteDirs(tiles, connections), [tiles, connections]);
  const resetDisabled = useMemo(() => {
    if (tiles.length !== initialRotations.length) return false;
    return tiles.every((tile, index) => tile.rotation === initialRotations[index]);
  }, [tiles, initialRotations]);

  useEffect(() => {
    const savedRotate = Number(localStorage.getItem("zen_rotate_sound"));
    const savedComplete = Number(localStorage.getItem("zen_complete_sound"));
    const savedBgVolume = Number(localStorage.getItem("zen_bg_volume"));
    const savedFxVolume = Number(localStorage.getItem("zen_fx_volume"));
    if (!Number.isNaN(savedRotate)) setRotateSoundIndex(savedRotate);
    if (!Number.isNaN(savedComplete)) setCompleteSoundIndex(savedComplete);
    if (!Number.isNaN(savedBgVolume)) setBgVolume(savedBgVolume);
    if (!Number.isNaN(savedFxVolume)) setFxVolume(savedFxVolume);
  }, []);

  useEffect(() => {
    localStorage.setItem("zen_rotate_sound", String(rotateSoundIndex));
  }, [rotateSoundIndex]);

  useEffect(() => {
    localStorage.setItem("zen_complete_sound", String(completeSoundIndex));
  }, [completeSoundIndex]);

  useEffect(() => {
    localStorage.setItem("zen_bg_volume", String(bgVolume));
  }, [bgVolume]);

  useEffect(() => {
    localStorage.setItem("zen_fx_volume", String(fxVolume));
  }, [fxVolume]);

  useEffect(() => {
    document.documentElement.style.setProperty("--page-noise", String(boardNoise));
  }, [boardNoise]);

  useEffect(() => {
    localStorage.setItem("zen_theme_mode", themeMode);
  }, [themeMode]);

  const getNextRandomTheme = () => {
    const total = themes.length;
    if (total === 0) return 0;
    const recent = recentRandomThemesRef.current
      .filter((index) => index >= 0 && index < total)
      .slice(0, 2);
    const recentSet = new Set(recent);
    const candidates = [];
    for (let i = 0; i < total; i += 1) {
      if (!recentSet.has(i)) candidates.push(i);
    }
    const pool = candidates.length > 0 ? candidates : Array.from({ length: total }, (_, i) => i);
    const next = pool[Math.floor(Math.random() * pool.length)];
    recentRandomThemesRef.current = [next, ...recent].slice(0, 2);
    localStorage.setItem("zen_recent_random_themes", JSON.stringify(recentRandomThemesRef.current));
    return next;
  };

  const clearRecentRandomThemes = () => {
    recentRandomThemesRef.current = [];
    localStorage.removeItem("zen_recent_random_themes");
  };

  useEffect(() => {
    if (themeMode !== "random") return undefined;
    const interval = setInterval(() => {
      setRandomSwatchOffset((prev) => (prev + 1) % themes.length);
    }, 1100);
    return () => clearInterval(interval);
  }, [themeMode, themes.length]);

  useEffect(() => {
    localStorage.setItem("zen_difficulty", difficultyLevels[difficultyIndex]);
  }, [difficultyIndex]);

  useEffect(() => {
    const indices = Array.from({ length: 10 }, (_, i) => i);
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

  function ensureAudioReady() {
    const ctx = ensureAudioContext();
    if (bgVolume > 0) {
      if (bgUserPausedRef.current) {
        return ctx;
      }
      if (!bgAudioRef.current) {
        startAmbient();
      } else if (bgAudioRef.current.paused) {
        bgAudioRef.current.play().catch(() => {});
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
    amp.gain.linearRampToValueAtTime(0.03, ctx.currentTime + 0.06);
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
    { type: "sine", freq: 180, duration: 0.9, gain: 0.025 },
    { type: "sine", freq: 220, duration: 0.7, gain: 0.03 },
    { type: "triangle", freq: 196, duration: 0.8, gain: 0.022 },
    { type: "triangle", freq: 247, duration: 0.75, gain: 0.02 },
    { type: "sine", freq: 262, duration: 0.6, gain: 0.02 },
    { type: "sine", freq: 294, duration: 0.55, gain: 0.018 },
    { type: "sine", freq: 330, duration: 0.5, gain: 0.016 },
    { type: "triangle", freq: 174, duration: 0.9, gain: 0.02 },
    { type: "sine", freq: 196, duration: 1.1, gain: 0.02, sweepTo: 240 },
    { type: "sine", freq: 220, duration: 1.1, gain: 0.02, sweepTo: 180 },
    { type: "sine", freq: 246, duration: 1.2, gain: 0.018, sweepTo: 200 },
    { type: "sine", freq: 180, duration: 0.6, gain: 0.02, lowpass: 500 },
    { type: "sine", freq: 210, duration: 0.7, gain: 0.02, lowpass: 450 },
    { type: "sine", freq: 240, duration: 0.8, gain: 0.02, lowpass: 380 },
    { type: "noise", duration: 0.5, gain: 0.018, bandpass: 650 },
    { type: "noise", duration: 0.7, gain: 0.02, bandpass: 520 },
    { type: "noise", duration: 0.9, gain: 0.02, bandpass: 420 },
    { type: "sine", freq: 196, duration: 1.4, gain: 0.018, sweepTo: 164, lowpass: 420 },
    { type: "sine", freq: 233, duration: 1.3, gain: 0.017, sweepTo: 196, lowpass: 360 },
    { type: "sine", freq: 262, duration: 1.2, gain: 0.016, sweepTo: 220, lowpass: 320 }
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

  function playTestSound(index) {
    if (fxVolume === 0) return;
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
      amp.gain.linearRampToValueAtTime(preset.gain * fxVolume, ctx.currentTime + 0.02);
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
    amp.gain.linearRampToValueAtTime(preset.gain * fxVolume, ctx.currentTime + 0.03);
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
        amp.gain.linearRampToValueAtTime(0.025 * fxVolume, ctx.currentTime + 0.02);
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

  function startAmbient(forcedPos) {
    if (bgVolume == 0) return;
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
    audio.volume = Math.min(1.0, bgVolume * 0.4);

    audio.onended = () => playNextBg();
    audio.play().catch(() => {});
    bgAudioRef.current = audio;
  }

  function stopAmbient() {
    if (!bgAudioRef.current) return;
    bgAudioRef.current.pause();
    bgAudioRef.current.currentTime = 0;
    bgAudioRef.current = null;
  }

  function playNextBg() {
    if (bgQueue.length === 0) return;
    bgUserPausedRef.current = false;
    const nextPos = (bgQueuePos + 1) % bgQueue.length;
    setBgQueuePos(nextPos);
    stopAmbient();
    startAmbient(nextPos);
  }

  function playPrevBg() {
    if (bgQueue.length === 0) return;
    bgUserPausedRef.current = false;
    const prevPos = (bgQueuePos - 1 + bgQueue.length) % bgQueue.length;
    setBgQueuePos(prevPos);
    stopAmbient();
    startAmbient(prevPos);
  }

  useEffect(() => {
    if (bgVolume > 0 && bgQueue.length > 0 && !bgAudioRef.current) {
      startAmbient();
    }
    return () => stopAmbient();
  }, [bgQueue]);

  useEffect(() => {
    if (!bgAudioRef.current) {
      startAmbient();
      return;
    }
    bgAudioRef.current.volume = Math.min(1.0, bgVolume * 0.4);
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

  useEffect(() => {
    if (solved && !prevSolvedRef.current) {
      const startWave = () => {
        const delays = new Map();
        const step = 180;
        const groupSize = 2;
        tiles.forEach((tile) => {
          const groupIndex = Math.floor(tile.r / groupSize);
          delays.set(tile.id, groupIndex * step);
        });
        setWaveDelays(delays);
        setWaveActive(true);
        setSolvedDim(false);
        playWaveMelodyAscending();
        const total = (Math.ceil(ROWS / groupSize) - 1) * step + 700;
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
        setSuccessMessage(messages[Math.floor(Math.random() * messages.length)]);
        setShowSuccess(true);
      }, successDelay);
    }
    if (!solved && prevSolvedRef.current) {
      cancelFinalAnimations();
    }
    prevSolvedRef.current = solved;
  }, [solved, tiles]);

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

  function rotateTile(index) {
    hasInteractedRef.current = true;
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
      const isFullyCompletePath = Array.from(component).every((id) => {
        const tileObj = byPos.get(id);
        if (!tileObj) return false;
        const edges = getEdges(tileObj);
        const completeDirs = nextComplete.get(id) || [false, false, false, false];
        return edges.every((hasEdge, dir) => !hasEdge || completeDirs[dir]);
      });
      if (delays.size > 0 && isFullyCompletePath) {
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

  return (
    <div className={`app${solvedDim ? " is-solved" : ""}${showSuccess ? " show-success" : ""}`}>
      <header className="top-controls">
        <h1 className="app-title">
          ZENT
          <button
            type="button"
            className="title-cta"
            onClick={solveAllButOne}
            aria-label="Solve all but one tile"
            title="Solve all but one tile"
          >
            ō
          </button>
        </h1>
        <div className="header-controls">
          <div className="header-actions">
            <button
              type="button"
              className={`button${resetSpinning ? " reset-spin" : ""}`}
              onClick={() => {
                if (resetDisabled) return;
                setResetSpinning(true);
                window.setTimeout(() => setResetSpinning(false), 420);
                regenerate(seedText, difficultyLevels[difficultyIndex], { shuffleTheme: false });
              }}
              aria-label="Reset level"
              title="Reset"
              disabled={resetDisabled}
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
            <button
              type="button"
              className="button button-ghost"
              onClick={() => {
                const nextSeed = Math.random().toString(36).slice(2, 8);
                setSeedText(nextSeed);
                regenerate(nextSeed, difficultyLevels[difficultyIndex], { shuffleTheme: true });
              }}
            >
              New level
            </button>
            <button
              type="button"
              className="button button-ghost"
              onClick={() => {
                const nextIndex = (difficultyIndex + 1) % difficultyLevels.length;
                setDifficultyIndex(nextIndex);
                regenerate(seedText, difficultyLevels[nextIndex], { shuffleTheme: true });
              }}
              aria-label="Difficulty"
              title="Difficulty"
            >
              {difficultyLevels[difficultyIndex].charAt(0).toUpperCase() +
                difficultyLevels[difficultyIndex].slice(1)}
            </button>
          </div>
          <div className="header-audio audio-controls">
            <button
              type="button"
              className="button button-ghost button-icon"
              onClick={() =>
                setBgVolume((prev) => (prev === 0.6 ? 0 : prev === 0 ? 0.2 : prev === 0.2 ? 0.4 : 0.6))
              }
              aria-label="Background volume"
              title="Background volume"
            >
              <span>BG</span>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M4 9h3l4-3v12l-4-3H4z" fill="currentColor" />
                {bgVolume >= 0.2 ? (
                  <path
                    d="M13.5 10a2.5 2.5 0 010 4"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeOpacity="0.55"
                  />
                ) : null}
                {bgVolume >= 0.4 ? (
                  <path
                    d="M15.5 8a4.5 4.5 0 010 8"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeOpacity="0.75"
                  />
                ) : null}
                {bgVolume >= 0.6 ? (
                  <path
                    d="M17.5 6a6.5 6.5 0 010 12"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeOpacity="0.9"
                  />
                ) : null}
              </svg>
            </button>
            <button
              type="button"
              className="button button-ghost button-icon"
              onClick={() =>
                setFxVolume((prev) => (prev === 1.6 ? 0 : prev === 0 ? 0.6 : prev === 0.6 ? 1.2 : 1.6))
              }
              aria-label="Effects volume"
              title="Effects volume"
            >
              <span>FX</span>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M4 9h3l4-3v12l-4-3H4z" fill="currentColor" />
                {fxVolume >= 0.6 ? (
                  <path
                    d="M13.5 10a2.5 2.5 0 010 4"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeOpacity="0.55"
                  />
                ) : null}
                {fxVolume >= 1.2 ? (
                  <path
                    d="M15.5 8a4.5 4.5 0 010 8"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeOpacity="0.75"
                  />
                ) : null}
                {fxVolume >= 1.6 ? (
                  <path
                    d="M17.5 6a6.5 6.5 0 010 12"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeOpacity="0.9"
                  />
                ) : null}
              </svg>
            </button>
          </div>
        </div>
      </header>

      <main className="board-wrap">
        {showSuccess ? (
          <div className="success-overlay">
            <div className="success-confetti">
              {Array.from({ length: 120 }).map((_, idx) => {
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
            <div className="success-card">
              <div className="success-icon">
                <div className="success-diamond">
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M6 12l4 4 8-8" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>
              </div>
              <p className="success-title">{successMessage}</p>
              <div className="success-actions">
                <button
                  type="button"
                  className="button success-action"
                  onClick={() => {
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
                    setShowSuccess(false);
                    const nextSeed = Math.random().toString(36).slice(2, 8);
                    setSeedText(nextSeed);
                    regenerate(nextSeed, difficultyLevels[difficultyIndex], { shuffleTheme: true });
                  }}
                >
                  New level
                </button>
              </div>
            </div>
          </div>
        ) : null}
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
      </main>

      <section className="floating-controls">
        <div className="theme-panel theme-panel-card">
          <p className="theme-title">Theme</p>
          <div className="theme-summary">
            <span className="theme-label">
              {themeMode === "random"
                ? "Random"
                : themes[themeIndex]?.name || "Theme"}
            </span>
            <span className="theme-swatches">
              {(themeMode === "random"
                ? []
                : (themes[themeIndex]?.colors || themes[0].colors).slice(0, 3)
              ).map((color) => (
                <span key={color} className="theme-swatch" style={{ background: color }} />
              ))}
            </span>
          </div>
          <button
            type="button"
            className="button button-ghost theme-toggle theme-toggle-full"
            onClick={() => {
              if (showThemePicker) {
                setShowThemePicker(false);
                window.setTimeout(() => setThemePickerMounted(false), 260);
              } else {
                setThemePickerMounted(true);
                window.requestAnimationFrame(() => setShowThemePicker(true));
              }
            }}
          >
            {showThemePicker ? "Close" : "Change theme"}
          </button>
          {themePickerMounted ? (
            <div className={`theme-accordion${showThemePicker ? " is-open" : ""}`}>
            <button
              type="button"
              className={`theme-button theme-button-wide${themeMode === "random" ? " is-active is-random" : ""}`}
              onClick={() => {
                setThemeMode("random");
                setShowThemePicker(false);
                window.setTimeout(() => setThemePickerMounted(false), 260);
              }}
            >
              <span className="theme-label">Random</span>
            </button>
            {themes.map((theme, index) => (
              <button
                key={theme.name}
                type="button"
                className={`theme-button theme-button-wide${
                  themeMode === "fixed" && index === themeIndex ? " is-active" : ""
                }`}
                onClick={() => {
                  setThemeMode("fixed");
                  setThemeIndex(index);
                  clearRecentRandomThemes();
                  setShowThemePicker(false);
                  window.setTimeout(() => setThemePickerMounted(false), 260);
                }}
              >
                <span className="theme-label">{theme.name}</span>
                <span className="theme-swatches">
                  {theme.colors.slice(0, 3).map((color) => (
                    <span key={color} className="theme-swatch" style={{ background: color }} />
                  ))}
                </span>
              </button>
            ))}
            </div>
          ) : null}
        </div>
        <div className="player-card">
          <div className="player-info">
            <p className="player-label">Now Playing</p>
            <p className="player-title">
              {audioTracks[bgNowPlayingIndex]?.title || "—"}
            </p>
          </div>
          <div className="player-controls">
            <button type="button" className="player-button" onClick={playPrevBg} aria-label="Previous track">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M7 6v12M19 6l-8 6 8 6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
              <button
                type="button"
                className="player-button player-button-main"
                onClick={() => {
                  if (bgAudioRef.current) {
                    if (bgAudioRef.current.paused) {
                      bgUserPausedRef.current = false;
                      bgAudioRef.current.play().catch(() => {});
                    } else {
                      bgUserPausedRef.current = true;
                      bgAudioRef.current.pause();
                    }
                  }
                }}
                aria-label={bgAudioRef.current?.paused ? "Play" : "Pause"}
              >
              {bgAudioRef.current?.paused ? (
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M8 6l10 6-10 6z" fill="currentColor" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M8 6h3v12H8zM13 6h3v12h-3z" fill="currentColor" />
                </svg>
              )}
            </button>
            <button type="button" className="player-button" onClick={playNextBg} aria-label="Next track">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M17 6v12M5 6l8 6-8 6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>
        </div>
        <div className="credits-footer">
          {audioAttribution.map((item) => (
            <span key={item.source}>
              {item.source} — {item.license} (
              <a className="modal-link" href={item.url} target="_blank" rel="noreferrer">
                source
              </a>
              )
            </span>
          ))}
        </div>
      </section>

      {/* Sound testing UI hidden */}
    </div>
  );
}
