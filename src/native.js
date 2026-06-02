import { Capacitor, registerPlugin } from "@capacitor/core";

const isNative = Capacitor.isNativePlatform();

const Review = isNative ? registerPlugin("Review") : null;
const AudioSession = isNative ? registerPlugin("AudioSession") : null;

let appPluginPromise = null;
function loadApp() {
  if (!isNative) return Promise.resolve(null);
  if (!appPluginPromise) {
    appPluginPromise = import("@capacitor/app").catch((err) => {
      console.error("App plugin import failed", err);
      return null;
    });
  }
  return appPluginPromise;
}

export async function onAppStateChange(callback) {
  if (!isNative) return () => {};
  const mod = await loadApp();
  if (!mod) return () => {};
  const handle = await mod.App.addListener("appStateChange", callback);
  return () => handle.remove();
}

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
    const isDark = isColorDark(hexColor);
    await mod.StatusBar.setStyle({ style: isDark ? mod.Style.Dark : mod.Style.Light });
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

export async function requestReview() {
  if (!isNative || !Review) return;
  try {
    await Review.requestReview();
  } catch (err) {
    // Swallow — review prompt failures are non-critical
  }
}

// True when another app (Music, Spotify, a podcast, etc.) is already playing
// audio. Used to avoid auto-starting our music over the user's own choice.
// Resolves false on web / if anything goes wrong, so playback isn't blocked.
export async function isOtherAudioPlaying() {
  if (!isNative || !AudioSession) return false;
  try {
    const { playing } = await AudioSession.isOtherAudioPlaying();
    return !!playing;
  } catch (err) {
    return false;
  }
}

// Fires when another app starts ({ playing: true }) or stops ({ playing: false })
// its audio while Zento is running — so we can duck our music out and back in.
export async function onOtherAudioChange(callback) {
  if (!isNative || !AudioSession) return () => {};
  const handle = await AudioSession.addListener("otherAudioChanged", callback);
  return () => handle.remove();
}

// Fires on audio interruptions — phone calls, Siri, alarms.
// { state: "began" } | { state: "ended", shouldResume: boolean }
export async function onAudioInterruption(callback) {
  if (!isNative || !AudioSession) return () => {};
  const handle = await AudioSession.addListener("interruption", callback);
  return () => handle.remove();
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

function parseColorToRgb(color) {
  if (typeof color !== "string") return null;
  const trimmed = color.trim();
  const rgbMatch = trimmed.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (rgbMatch) return [+rgbMatch[1], +rgbMatch[2], +rgbMatch[3]];
  const clean = trimmed.replace(/^#/, "");
  if (clean.length !== 6 && clean.length !== 3) return null;
  const full = clean.length === 3
    ? clean.split("").map((c) => c + c).join("")
    : clean;
  return [parseInt(full.slice(0, 2), 16), parseInt(full.slice(2, 4), 16), parseInt(full.slice(4, 6), 16)];
}

function isColorDark(color) {
  const rgb = parseColorToRgb(color);
  if (!rgb) return false;
  const luminance = (0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]) / 255;
  return luminance < 0.5;
}
