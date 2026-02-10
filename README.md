**Overview**
Zen Tile Game built with Vite + React. Deployed under the `/zento/` base path (see `vite.config.js`).

**Scripts**
1. `npm run dev` - local dev server
2. `npm run build` - production build
3. `npm run preview` - preview the production build locally
4. Push to `main` - GitHub Actions builds and deploys to GitHub Pages

**PWA**
PWA support is provided by `vite-plugin-pwa`. The service worker is enabled in dev mode to allow offline testing.

If the dev service worker gets in the way of live reloads:
1. Open DevTools -> Application -> Service Workers
2. Click "Unregister"
3. Hard refresh the page

**Icons (PNG + Apple Touch)**
PWA icons are stored in `public/icons/`. PNGs are generated from the dedicated static PWA SVGs:
- `public/icons/icon.svg`
- `public/icons/icon-maskable.svg`

Note: these are intentionally separate from any in-game animated SVGs (e.g. the cross) so gameplay visuals can keep their stateful edits without affecting the PWA assets.

Regenerate PNGs with `sharp`:
1. `npm run icons`
2. Or run the script directly: `node scripts/generate-icons.mjs`

**Audio Caching**
Workbox caches `.mp3`, `.mid`, and `.midi` assets with a cache-first strategy to keep audio available offline.
