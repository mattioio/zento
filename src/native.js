import { Capacitor } from "@capacitor/core";

const isNative = Capacitor.isNativePlatform();

let statusBarPromise = null;
function loadStatusBar() {
  if (!isNative) return Promise.resolve(null);
  if (!statusBarPromise) {
    statusBarPromise = import("@capacitor/status-bar").catch((err) => {
      console.error("StatusBar import failed", err);
      return null;
    });
  }
  return statusBarPromise;
}

let splashPromise = null;
function loadSplash() {
  if (!isNative) return Promise.resolve(null);
  if (!splashPromise) {
    splashPromise = import("@capacitor/splash-screen").catch((err) => {
      console.error("SplashScreen import failed", err);
      return null;
    });
  }
  return splashPromise;
}

let hapticsPromise = null;
function loadHaptics() {
  if (!isNative) return Promise.resolve(null);
  if (!hapticsPromise) {
    hapticsPromise = import("@capacitor/haptics").catch((err) => {
      console.error("Haptics import failed", err);
      return null;
    });
  }
  return hapticsPromise;
}

let browserPromise = null;
function loadBrowser() {
  if (!isNative) return Promise.resolve(null);
  if (!browserPromise) {
    browserPromise = import("@capacitor/browser").catch((err) => {
      console.error("Browser import failed", err);
      return null;
    });
  }
  return browserPromise;
}

export async function applyStatusBarForBackground(hexColor) {
  if (!isNative) return;
  const mod = await loadStatusBar();
  if (!mod) return;
  try {
    const isDark = isHexDark(hexColor);
    await mod.StatusBar.setStyle({ style: isDark ? mod.Style.Light : mod.Style.Dark });
    if (mod.StatusBar.setBackgroundColor) {
      await mod.StatusBar.setBackgroundColor({ color: hexColor }).catch(() => {});
    }
  } catch (err) {
    console.error("StatusBar.setStyle failed", err);
  }
}

export async function hideSplash() {
  if (!isNative) return;
  const mod = await loadSplash();
  if (!mod) return;
  try {
    await mod.SplashScreen.hide();
  } catch (err) {
    console.error("SplashScreen.hide failed", err);
  }
}

export async function impactLight() {
  if (!isNative) return;
  const mod = await loadHaptics();
  if (!mod) return;
  try {
    await mod.Haptics.impact({ style: mod.ImpactStyle.Light });
  } catch (err) {
    // Swallow — haptics failures are non-critical
  }
}

export async function impactMedium() {
  if (!isNative) return;
  const mod = await loadHaptics();
  if (!mod) return;
  try {
    await mod.Haptics.impact({ style: mod.ImpactStyle.Medium });
  } catch (err) {
    // Swallow
  }
}

export async function openExternal(url) {
  if (!url) return;
  if (!isNative) {
    window.open(url, "_blank", "noopener,noreferrer");
    return;
  }
  const mod = await loadBrowser();
  if (!mod) {
    window.open(url, "_blank", "noopener,noreferrer");
    return;
  }
  try {
    await mod.Browser.open({ url });
  } catch (err) {
    console.error("Browser.open failed", err);
  }
}

function isHexDark(hex) {
  if (typeof hex !== "string") return false;
  const clean = hex.replace(/^#/, "");
  if (clean.length !== 6 && clean.length !== 3) return false;
  const full = clean.length === 3
    ? clean.split("").map((c) => c + c).join("")
    : clean;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance < 0.5;
}
