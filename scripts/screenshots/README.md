# App Store screenshot pipeline

Generates the 5 marketing screenshots for the App Store listing.

## How it works

1. **You capture** the 5 raw moments in the iOS Simulator and save them as
   `screenshots/raw/0X-name.png` (matching the `raw` filename in
   `config.mjs`). Simulator's ⌘S puts captures on your Desktop — just
   rename and move them into `screenshots/raw/`.
2. **You run** `npm run screenshots`.
3. The script composes each raw capture into a 1290×2796 PNG ready for
   App Store Connect, with:
   - soft gradient backdrop (per-shot, brand-y)
   - large headline in Krona One (the in-game heading face)
   - the screen content mounted in a tilted custom iPhone bezel with
     dynamic island
4. Output lands in `screenshots/output/iphone-6.7/` and is ready to
   drag-and-drop into App Store Connect's "iPhone 6.7"" (and 6.9") slot.

## The 5 shots

| File | Game moment to capture | Marketing headline |
|---|---|---|
| `01-home.png` | Home screen, any theme | A meditation in tiles. |
| `02-mid-game.png` | Mid-game board, partially solved, light/cream theme | Find the path through the noise. |
| `03-themes.png` | Theme picker expanded, showing palette variety | Pick a palette. Or let it shuffle. |
| `04-progress.png` | Progress mode level grid with a chunk of levels complete | When you want a destination. |
| `05-now-playing.png` | Settings scrolled to "Now Playing" card mid-track | Calming piano. No timer. No score. |

## Tuning

Edit `config.mjs` to change headlines, gradients, or per-shot tilt.
Edit `compose.mjs` for layout knobs (phone size, headline placement).
