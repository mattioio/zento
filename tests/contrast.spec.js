import { test, expect } from "@playwright/test";
const UNLOCK_LEVELS = [12, 24, 36, 48, 60, 72, 84, 96];
const CONTRAST_THRESHOLD = 3;

const HOME_SELECTORS = [
  { label: "buttons", selector: ".button:not(:disabled)" },
  { label: "buttons-disabled", selector: ".button:disabled" },
  { label: "ghost-buttons", selector: ".button-ghost" },
  { label: "theme-buttons", selector: ".theme-button" },
  { label: "theme-buttons-active", selector: ".theme-button.is-active" },
  { label: "theme-buttons-locked", selector: ".theme-button.is-locked" },
  { label: "sound-pills", selector: ".sound-pill" },
  { label: "sound-pills-muted", selector: ".sound-pill.is-muted" },
  { label: "labels", selector: ".label, .settings-title, .theme-title, .player-label, .perf-label, .mode-title, .mode-copy" }
];

const BOARD_SELECTORS = [
  { label: "level-toggle", selector: ".level-toggle" },
  { label: "level-toggle-label", selector: ".level-toggle-label" },
  { label: "player-button", selector: ".player-button" },
  { label: "player-button-main", selector: ".player-button-main" },
  { label: "tile-stroke", selector: ".tile-stroke, .tile-stroke-complete" }
];


const runCustomContrast = async (page, themeName, screenLabel, selectors) => {
  const results = await page.evaluate(
    ({ selectors, threshold }) => {
      const parseColor = (value) => {
        if (!value) return null;
        const raw = value.trim().toLowerCase();
        if (raw === "transparent") return { r: 0, g: 0, b: 0, a: 0 };
        if (raw.startsWith("#")) {
          const hex = raw.slice(1);
          const normalized = hex.length === 3
            ? hex.split("").map((c) => c + c).join("")
            : hex;
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

      const blend = (top, bottom) => {
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

      const luminance = (color) => {
        return (
          0.2126 * srgbToLinear(color.r) +
          0.7152 * srgbToLinear(color.g) +
          0.0722 * srgbToLinear(color.b)
        );
      };

      const contrastRatio = (a, b) => {
        const l1 = luminance(a);
        const l2 = luminance(b);
        const lighter = Math.max(l1, l2);
        const darker = Math.min(l1, l2);
        return (lighter + 0.05) / (darker + 0.05);
      };

      const getFallbackBackground = () => {
        const rootStyle = getComputedStyle(document.documentElement);
        const raw = rootStyle.getPropertyValue("--bg-start").trim();
        return parseColor(raw) || { r: 255, g: 255, b: 255, a: 1 };
      };

      const getEffectiveBackground = (element) => {
        let node = element;
        let composed = null;
        while (node && node.nodeType === Node.ELEMENT_NODE) {
          const style = getComputedStyle(node);
          const bg = parseColor(style.backgroundColor);
          if (bg && bg.a > 0) {
            composed = composed ? blend(composed, bg) : bg;
            if (composed.a >= 1) return composed;
          }
          node = node.parentElement;
        }
        const fallback = getFallbackBackground();
        return composed ? blend(composed, fallback) : fallback;
      };

      const isVisible = (element) => {
        const style = getComputedStyle(element);
        if (style.display === "none" || style.visibility === "hidden") return false;
        if (Number(style.opacity) === 0) return false;
        const rect = element.getBoundingClientRect();
        return rect.width > 2 && rect.height > 2;
      };

      const toHex = (color) => {
        const clamp = (v) => Math.max(0, Math.min(255, Math.round(v)));
        const hex = (v) => clamp(v).toString(16).padStart(2, "0");
        return `#${hex(color.r)}${hex(color.g)}${hex(color.b)}`;
      };

      const failures = [];
      for (const { label, selector } of selectors) {
        const elements = Array.from(document.querySelectorAll(selector));
        for (const el of elements) {
          if (!isVisible(el)) continue;
          const style = getComputedStyle(el);
          const fgRaw = parseColor(style.color);
          if (!fgRaw) continue;
          const bgRaw = getEffectiveBackground(el);
          if (!bgRaw) continue;
          const fg = fgRaw.a < 1 ? blend(fgRaw, bgRaw) : fgRaw;
          const bg = bgRaw.a < 1 ? blend(bgRaw, { r: 255, g: 255, b: 255, a: 1 }) : bgRaw;
          const ratio = contrastRatio(fg, bg);
          if (ratio < threshold) {
            failures.push({
              type: "custom",
              label,
              selector,
              ratio: Number(ratio.toFixed(2)),
              fg: toHex(fg),
              bg: toHex(bg),
              text: (el.textContent || "").trim().slice(0, 60),
              tag: el.tagName.toLowerCase(),
              className: el.className
            });
          }
        }
      }
      return failures;
    },
    { selectors, threshold: CONTRAST_THRESHOLD }
  );

  return results.map((entry) => ({
    ...entry,
    theme: themeName,
    screen: screenLabel
  }));
};

const formatFailures = (failures) => {
  return failures
    .map((item) => {
      return (
        `[${item.theme} | ${item.screen}] ${item.label} ${item.selector}\n` +
        `  ratio ${item.ratio} fg ${item.fg} bg ${item.bg}\n` +
        `  <${item.tag}> ${item.text}`
      );
    })
    .join("\n\n");
};

test("contrast audit across themes (AA large text)", async ({ page }) => {
  test.setTimeout(300000);
  await page.addInitScript((levels) => {
    localStorage.setItem("zen_theme_mode", "fixed");
    localStorage.setItem("zen_progress_completed", JSON.stringify(levels));
  }, UNLOCK_LEVELS);

  await page.goto("/");
  await page.waitForSelector(".home-screen");
  await page.waitForFunction(() => window.__zenTest && window.__zenTest.getThemeNames);
  await page.evaluate(() => window.__zenTest.unlockAllThemes?.());

  const themeNames = await page.evaluate(() => window.__zenTest.getThemeNames());
  const themeCount = themeNames.length;
  const failures = [];

  for (let i = 0; i < themeCount; i += 1) {
    const themeName = themeNames[i] || `Theme ${i + 1}`;
    await page.evaluate((index) => window.__zenTest.setThemeIndex(index), i);
    await page.waitForTimeout(120);

    failures.push(...(await runCustomContrast(page, themeName, "home", HOME_SELECTORS)));

    await page.getByRole("button", { name: /Endless/i }).click();
    await page.waitForSelector(".board", { state: "visible" });

    failures.push(...(await runCustomContrast(page, themeName, "board", BOARD_SELECTORS)));

    await page.getByRole("button", { name: /Back to home/i }).click();
    await page.waitForSelector(".home-screen", { state: "visible" });
  }

  if (failures.length) {
    console.log("\nContrast violations found:\n");
    console.log(formatFailures(failures));
  }

  expect(failures, "Contrast violations found. See console output for details.").toHaveLength(0);
});
