# Zento — App Store Connect copy for v1.1

Everything below is ready to paste into App Store Connect. Character counts are
against Apple's limits and were computed from the exact strings shown.

App: **Zento** · Apple ID `6770275298` · bundle `io.mattio.zento`
Seller: Not Another Studio LTD · IAP: `io.mattio.zento.fullgame`, non-consumable, £2.99

> **Why any of this is changing:** as of 26 Aug 2026 the app appeared in the top 25
> for no search term except its own name — and fifth even for that, behind a payments
> app, a sushi app and a subscription tracker. The listing is written in words nobody
> searches for. See the fuller diagnosis in the discoverability report.

---

## 1. Name

**Paste this:**

```
Zento: Zen Loop Puzzle
```

`22 / 30` · currently `Zento: Zen Tile Puzzle`

On the App Store, "tile puzzle" means match-3 and mahjong. That exact phrase is owned
by *Onet 3D — Zen Tile Puzzle* (3,800 ratings) and *Match Jong — Zen Tile Puzzle*
(1,200). Zento cannot out-rank them for it, and the people it does attract are
expecting mahjong, don't install, and that low conversion pushes the ranking down
further.

Zento is a **loop / pipe / connect** puzzle, and that neighbourhood is barely
defended — the biggest app of that kind for "loop puzzle" has 48 ratings.

Alternatives if you prefer: `Zento: Loop & Line Puzzle` (25), `Zento: Calm Loop Puzzle` (23).

---

## 2. Subtitle

**Paste this:**

```
Connect pipes & lines, relax
```

`28 / 30` · currently `A zen path puzzle game`

Carries the genre words the name doesn't. Alternatives: `Relaxing pipe & path puzzles`
(28), `Rotate pipes. Calm, no timer.` (29).

---

## 3. Keywords

**Paste this:**

```
anxiety,stress,calm,mindful,meditate,unwind,quiet,offline,rotate,flow,path,logic,minimal,soothing
```

`97 / 100`

Two rules that catch people out:

- **Never repeat a word** between name, subtitle and keywords. Apple combines all
  three, so a repeat wastes a slot. That's why *zen, loop, puzzle, connect, pipes,
  lines, relax* are absent here — they're already in the name or subtitle.
- **Never include** "game", "app", "free", or your category name. Apple indexes those
  for you, and they're wasted characters.

No commas-plus-spaces — commas only.

---

## 4. Promotional text

Editable at any time **without submitting a new version**, so this is your lever for
seasonal pushes.

```
200 hand-tuned levels of quiet path puzzles. Rotate tiles to connect the lines. No timer, no score, no ads — just stillness, calming piano and 23 themes.
```

`153 / 170`

---

## 5. Description

The live description undersells the app and contains two things that are no longer
true. Corrections marked below.

```
Zento is a quiet puzzle game about finding paths through stillness.

Rotate the tiles. Connect the lines. There's no timer, no score, no failure state — just you, the board, and the calming sound of piano.

200 hand-tuned levels guide you through a slow, satisfying progression. Endless mode is always there when you want to drift. Themes unlock as you play, each one a new mood.

A zen ritual you can pick up for a minute or sink into for an hour.

FEATURES
• 200 hand-tuned levels, gently growing in size and complexity
• Endless mode for limitless, randomly generated boards
• Six difficulty tiers, from Still to Tide
• 23 themes — ten of them earned by playing, plus three night modes for dark rooms
• Nine calming piano tracks, adjustable or off
• Subtle haptic feedback that feels right (and can be turned off)
• Plays entirely offline. Universal — designed for iPhone and iPad
• No accounts, no ads, no nag screens

Try the first 20 levels free. One in-app purchase unlocks the rest: all 200 levels, the night modes and the harder endless tiers.

Made by Not Another Studio. Hand-crafted with care.
```

### What changed and why

| Live text | Problem | New text |
|---|---|---|
| "Nine unlockable themes inspired by light, water and stone" | There are **23 themes** — 10 core, 3 night modes, 10 unlockable. You were underselling by more than half, and the count was wrong in both directions. | "23 themes — ten of them earned by playing, plus three night modes" |
| "Calming ambient piano soundtrack" | There are **nine** distinct tracks. Say so. | "Nine calming piano tracks" |
| "Themes unlock as you play" | Was **false** until the v1.1 fix — buying granted them all outright (and then they didn't work). Now true. | kept, now accurate |
| "One-time purchase unlocks the full game" | Vague about what you get. | spells out levels + night modes + endless tiers |
| — | Six difficulty tiers were never mentioned at all. | added |
| — | Offline play was never mentioned. Strong seller in this category. | added |

---

## 6. What's New in this version

```
This update restores the full 200-level journey. Levels 97 to 200 were missing from version 1.0, along with the six themes that unlock across them.

Also in this release:

• The level-complete screen now settles into your chosen theme instead of washing the board grey
• Unlockable themes are earned by reaching their level, and the theme panel now shows exactly which level each one needs
• A new ending for the 200th level
• Clearer wording about what the one-time purchase includes
• Zento now asks for a review at a sensible moment, and far less often
```

---

## 7. Screenshots

Five slots. Current set has three problems.

| # | Now | Change to |
|---|---|---|
| 1 | The home menu — two grey cards, no game visible | **A board mid-solve.** Search results show the first two or three shots; lead with the thing people are buying |
| 2 | Board mid-game — fine | keep |
| 3 | Theme picker — fine | keep, but shoot it with the unlock badges visible, they tell a story |
| 4 | "Level 3 complete" over a grey, broken-looking board | **Re-shoot.** The dimming is fixed in v1.1, and shoot it deep in the run, not at level 3, under a headline promising 200 |
| 5 | Now Playing — fully illustrated, no real screen | keep |

Sizes are already configured in `scripts/screenshots/config.mjs`: 6.9" (1320×2868),
6.5" (1284×2778), iPad 13" (2064×2752). Capture raws into `screenshots/raw/`, then
`npm run screenshots`.

---

## 8. App preview video

**Not currently used, and it's the biggest untouched conversion lever** — a preview
autoplays silently right in search results.

- 15–30 seconds, portrait, H.264
- 6.9" slot: 1320×2868
- Must be actual footage from the app

Suggested 20 seconds: a board mid-solve → a few tiles rotating → a loop clicking shut
→ the completed board → one theme change → the calm home screen. No text overlays
needed; the game sells itself by moving.

---

## 9. Free shelf space you're not using

- **Localizations.** Every language you add gets its own name, subtitle and keyword
  field, and opens that country's store. Zento has almost no text — German, French,
  Spanish, Japanese and Simplified Chinese would roughly quintuple the terms you're
  indexed for, for the cost of translating a few dozen words.
- **In-App Events.** These get their own cards in search results and on the Today tab.
  Free placement. "A new theme every week", or a seasonal level set.
- **Promoted in-app purchase.** The unlock can appear on the product page and in search
  results in its own right.
- **Product Page Optimization.** Free A/B testing of up to three screenshot or icon
  variants. Worth running once the new screenshots are in.
- **Accessibility Nutrition Labels.** Your page currently says the developer hasn't
  indicated any. See the next section — but only tick what's genuinely true.

---

## 10. Accessibility labels — verify before ticking

Apple shows these on the product page. Over-claiming is worse than leaving them blank.
My reading of the code, for you to confirm:

| Label | My assessment |
|---|---|
| Reduced Motion | **Likely yes** — `styles.css` honours `prefers-reduced-motion` in four places |
| Differentiate Without Colour Alone | **Likely yes** — tiles are line shapes, not colours |
| Sufficient Contrast | **Check first** — there's an axe-core contrast test, but it isn't currently passing in CI |
| Dark Interface | **Probably not** — there are night themes, but they're manual, not tied to the system appearance |
| Larger Text | **No** — a WKWebView won't honour Dynamic Type without specific work |
| VoiceOver | **No** — there are aria-labels, but a rotating tile grid isn't a usable VoiceOver experience without testing it properly |

---

## 11. Categories and the rest

| Field | Value | Note |
|---|---|---|
| Primary category | Games → Puzzle | correct, keep |
| Secondary | Games → Casual | fine. Games → Board is less contested if you ever want chart visibility |
| Age rating | 4+ | correct |
| Price | Free with one £2.99 non-consumable | correct |
| Privacy | Purchases + Usage Data, not linked to identity | matches what PostHog and RevenueCat collect |
| Support URL | notanother.studio/zento | live |

---

## Order to do it in

1. Ship the v1.1 build (already merged to `main`)
2. Re-shoot screenshots 1 and 4 against that build
3. Record the preview video
4. Paste sections 1–6 into the new version
5. Submit
6. After it's live: accessibility labels, promoted purchase, an In-App Event
7. Localizations once English is settled and earning ratings
8. Re-run the search test in six weeks and see which terms moved

**Expect nothing for four to six weeks.** Search rankings move slowly, and with three
ratings Apple has little reason to rank the app yet — which is why the review-prompt
fix in this build matters as much as any of the words above.
