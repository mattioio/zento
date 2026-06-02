import React from "react";
import { createRoot } from "react-dom/client";
import { Capacitor } from "@capacitor/core";
import App, { ErrorBoundary } from "./App.jsx";
import { hydrate } from "./storage.js";
import { initRevenueCat } from "./entitlements.js";
import { hideSplash } from "./native.js";
import "./styles.css";

// Register service worker only on web (not in Capacitor WKWebView)
if (!Capacitor.isNativePlatform() && "serviceWorker" in navigator) {
  import("virtual:pwa-register").then(({ registerSW }) => {
    registerSW({ immediate: true });
  }).catch(() => {});
}

// Safety net: always hide splash after 4s, even if JS crashes before React mounts
setTimeout(hideSplash, 4000);

hydrate().finally(() => {
  try {
    const root = createRoot(document.getElementById("root"));
    root.render(<ErrorBoundary><App /></ErrorBoundary>);
    initRevenueCat();
  } catch (err) {
    console.error("Zento boot failed:", err);
    hideSplash();
    document.getElementById("root").textContent = "Something went wrong. Please restart the app.";
  }
});
