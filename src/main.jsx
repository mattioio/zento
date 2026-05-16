import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import { hydrate } from "./storage.js";
import "./styles.css";

hydrate().finally(() => {
  const root = createRoot(document.getElementById("root"));
  root.render(<App />);
});
