import { describe, it, expect } from "vitest";
import {
  buildProgressionSeed,
  parseProgressionSeed,
  normalizeProgressionSettings,
  normalizeLevelList
} from "../App.jsx";

describe("progression helpers", () => {
  it("defaults settings when input is empty", () => {
    const settings = normalizeProgressionSettings();
    expect(settings).toMatchObject({
      gapRate: 18,
      gapClusters: 2,
      curveBias: 28,
      terminalRate: 18,
      terminalSpacing: 2,
      straightRunMax: 4,
      emptyRowMax: 2,
      emptyColMax: 2,
      centerBias: 0,
      variant: 0
    });
  });

  it("clamps settings to allowed ranges", () => {
    const settings = normalizeProgressionSettings({
      gapRate: -10,
      curveBias: 999,
      terminalSpacing: 12
    });

    expect(settings.gapRate).toBe(0);
    expect(settings.curveBias).toBe(40);
    expect(settings.terminalSpacing).toBe(5);
  });

  it("round-trips a progression seed", () => {
    const seed = buildProgressionSeed({
      gapRate: 10,
      gapClusters: 1,
      curveBias: 30,
      terminalRate: 16,
      straightRunMax: 5,
      terminalSpacing: 3,
      emptyRowMax: 1,
      emptyColMax: 2,
      centerBias: 40,
      variant: 7
    });
    const parsed = parseProgressionSeed(seed);

    expect(parsed).toMatchObject({
      gapRate: 10,
      gapClusters: 1,
      curveBias: 30,
      terminalRate: 16,
      straightRunMax: 5,
      terminalSpacing: 3,
      emptyRowMax: 1,
      emptyColMax: 2,
      centerBias: 40,
      variant: 7
    });
  });

  it("normalizes level list length", () => {
    const levels = normalizeLevelList(["A", "B"]);

    expect(levels).toHaveLength(96);
    expect(levels[0]).toBe("A");
    expect(levels[1]).toBe("B");
    expect(levels[2]).toBe("");
  });

  it("returns null for invalid seeds", () => {
    expect(parseProgressionSeed("nope")).toBeNull();
  });
});
