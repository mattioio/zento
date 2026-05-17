// Marketing screenshot config.
//
// Each shot points at a raw simulator capture in screenshots/raw/<raw>,
// and gets composited into App Store sizes in screenshots/output/.
//
// gradient: [topColor, bottomColor] — soft brand-y backdrop behind the phone
// tilt: degrees, positive = clockwise, negative = anti-clockwise
// headlineColor: text colour, picked to contrast with gradient

export const SHOTS = [
  {
    id: "01-home",
    raw: "01-home.png",
    headline: "A meditation\nin tiles.",
    gradient: ["#f6e9cf", "#e8c79a"],
    headlineColor: "#3a2b1d",
    tilt: -4
  },
  {
    id: "02-mid-game",
    raw: "02-mid-game.png",
    headline: "Find the path\nthrough the noise.",
    gradient: ["#dfeae1", "#a8c4b3"],
    headlineColor: "#1f3326",
    tilt: 4
  },
  {
    id: "03-themes",
    raw: "03-themes.png",
    headline: "Pick a palette.\nOr let it shuffle.",
    gradient: ["#e5dcef", "#bba8cf"],
    headlineColor: "#2a1d3d",
    tilt: -4
  },
  {
    id: "04-progress",
    raw: "04-progress.png",
    headline: "When you want\na destination.",
    gradient: ["#f2dad5", "#d9a89f"],
    headlineColor: "#3a1f1c",
    tilt: 4
  },
  {
    id: "05-now-playing",
    raw: "05-now-playing.png",
    headline: "Calming piano.\nNo timer. No score.",
    gradient: ["#d8dcef", "#a8b0cf"],
    headlineColor: "#1d233a",
    // Lift just the Now Playing card out of the screenshot and float it
    // on the gradient (no phone frame). Adjust crop if the card's
    // position shifts in your capture.
    layout: "element",
    crop: { left: 40, top: 743, width: 1110, height: 600 }
  }
];

// App Store screenshot sizes. We composite for 6.7" iPhone first
// (Apple accepts this for both 6.7" and 6.9" devices).
export const TARGETS = [
  { id: "iphone-6.7", width: 1290, height: 2796 }
];

export const FONT_HEADLINE = "Krona One";
