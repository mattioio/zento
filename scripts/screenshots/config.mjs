// Marketing screenshot config.
//
// Each shot points at a raw simulator capture in screenshots/raw/<raw>,
// and gets composited into App Store sizes in screenshots/output/.
//
// gradient: [topColor, bottomColor] — soft brand-y backdrop behind the phone
// tilt: degrees, positive = clockwise, negative = anti-clockwise
// headlineColor: text colour, picked to contrast with gradient

// Each shot's gradient is a harmonised pair built from the in-game theme
// shown on screen. Light-on-light keeps the screenshot as the focal point.
export const SHOTS = [
  {
    id: "01-home",
    raw: "01-home.png",
    headline: "A meditation\nin tiles.",
    // Serene Garden (soft green theme)
    gradient: ["#eaf3e0", "#c5dcbf"],
    headlineColor: "#1f3326",
    tilt: 0,
    showLogo: true
  },
  {
    id: "02-mid-game",
    raw: "02-mid-game.png",
    headline: "Find the path\nthrough the noise.",
    // Rose Bloom (pink theme)
    gradient: ["#fbe2e6", "#f0bccb"],
    headlineColor: "#3a1d2a",
    tilt: 0
  },
  {
    id: "03-themes",
    raw: "03-themes.png",
    headline: "Pick a palette.\nOr let it shuffle.",
    // Quiet Grey theme
    gradient: ["#f1f1f1", "#cfcfcf"],
    headlineColor: "#1f1f1f",
    tilt: 0
  },
  {
    id: "04-progress",
    raw: "04-progress.png",
    headline: "When you want\na destination.",
    // Warm Earth (yellow/tan theme)
    gradient: ["#fbf0d8", "#edd0a0"],
    headlineColor: "#3a2615",
    tilt: 0
  },
  {
    id: "05-now-playing",
    headline: "Calming piano.\nNo timer. No score.",
    gradient: ["#eaf3e0", "#c5dcbf"],
    headlineColor: "#1f3326",
    // Fully drawn — no simulator capture used. Renders a soothing audio
    // waveform + playback controls on the gradient.
    layout: "soundwave",
    trackName: "Hope",
    accent: "#2f5d3a"
  }
];

// App Store screenshot sizes. We composite for 6.7" iPhone first
// (Apple accepts this for both 6.7" and 6.9" devices).
export const TARGETS = [
  { id: "iphone-6.7", width: 1290, height: 2796 }
];

export const FONT_HEADLINE = "Krona One";
