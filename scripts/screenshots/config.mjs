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
    headline: "Including a\n200-level journey.",
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

// App Store screenshot sizes.
//   iphone-6.9  → 6.9" iPhone slot in ASC (iPhone 16 Pro Max — current top tier).
//   iphone-6.5  → 6.5" iPhone slot in ASC (XS Max / 11 Pro Max — fallback for older devices).
//   ipad-13     → required since the app ships as universal.
// `style` switches the compositor between the phone-bezel layout (iPhone)
// and a clean framed-screen layout (iPad). iPads in marketing shots usually
// don't get a device frame — the screen sits on the gradient with a soft
// shadow + rounded corners.
export const TARGETS = [
  { id: "iphone-6.9", width: 1320, height: 2868, style: "phone" },
  { id: "iphone-6.5", width: 1284, height: 2778, style: "phone" },
  { id: "ipad-13", width: 2064, height: 2752, style: "tablet", raw: "ipad" }
];

export const FONT_HEADLINE = "Krona One";
