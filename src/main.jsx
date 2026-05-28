import React from "react";
import { createRoot } from "react-dom/client";
import App, { ErrorBoundary } from "./App.jsx";
import { hydrate } from "./storage.js";
import { initRevenueCat } from "./entitlements.js";
import "./styles.css";

hydrate().finally(() => {
  const root = createRoot(document.getElementById("root"));
  root.render(<ErrorBoundary><App /></ErrorBoundary>);
  initRevenueCat();
});
