import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const base = "/zento/";
const TOTAL_LEVELS = 96;

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const normalizeLevelList = (list) => {
  const source = Array.isArray(list)
    ? list
    : list && typeof list === "object" && Array.isArray(list.levels)
      ? list.levels
      : [];
  return Array.from({ length: TOTAL_LEVELS }, (_, index) => {
    const value = source[index];
    return typeof value === "string" ? value : "";
  });
};

const bakeLevelsPlugin = () => ({
  name: "bake-levels",
  configureServer(server) {
    const bakeHandler = (req, res) => {
      if (req.method !== "POST") {
        res.statusCode = 405;
        res.end("Method Not Allowed");
        return;
      }
      let body = "";
      req.on("data", (chunk) => {
        body += chunk;
      });
      req.on("end", () => {
        try {
          const payload = JSON.parse(body || "{}");
          const levels = normalizeLevelList(payload.levels ?? payload);
          const outPath = path.join(__dirname, "src", "progressionLevels.json");
          fs.writeFileSync(outPath, `${JSON.stringify(levels, null, 2)}\n`);
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ ok: true }));
        } catch (err) {
          res.statusCode = 500;
          res.end("Failed to bake levels");
        }
      });
    };
    const basePath = base.endsWith("/") ? base : `${base}/`;
    server.middlewares.use("/__bake-levels", bakeHandler);
    server.middlewares.use(`${basePath}__bake-levels`, bakeHandler);
  }
});

export default defineConfig(({ command }) => ({
  base,
  plugins: [
    react(),
    command === "serve" ? bakeLevelsPlugin() : null,
    VitePWA({
      registerType: "autoUpdate",
      injectRegister: "auto",
      includeAssets: [
        "icons/*.png",
        "icons/*.svg"
      ],
      manifest: {
        name: "ZENTō",
        short_name: "ZENTō",
        description: "A calming tile-matching game.",
        theme_color: "#e8e0d6",
        background_color: "#fff7ea",
        display: "standalone",
        start_url: base,
        scope: base,
        icons: [
          {
            src: "icons/icon-192.png",
            sizes: "192x192",
            type: "image/png"
          },
          {
            src: "icons/icon-512.png",
            sizes: "512x512",
            type: "image/png"
          },
          {
            src: "icons/icon-maskable-192.png",
            sizes: "192x192",
            type: "image/png",
            purpose: "maskable"
          },
          {
            src: "icons/icon-maskable-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable"
          },
          {
            src: "icons/icon.svg",
            sizes: "any",
            type: "image/svg+xml"
          },
          {
            src: "icons/icon-maskable.svg",
            sizes: "any",
            type: "image/svg+xml",
            purpose: "maskable"
          }
        ]
      },
      devOptions: {
        enabled: true,
        type: "module"
      },
      workbox: {
        globPatterns: [
          "**/*.{js,css,html,svg,ico,png,webmanifest}"
        ],
        runtimeCaching: [
          {
            urlPattern: /\.(?:mp3|mid|midi)$/,
            handler: "CacheFirst",
            options: {
              cacheName: "audio-assets",
              expiration: {
                maxEntries: 50,
                maxAgeSeconds: 60 * 60 * 24 * 30
              }
            }
          }
        ]
      }
    })
  ].filter(Boolean)
}));
