// Decides when to ask for an App Store rating.
//
// Apple only honours three review prompts per user per year, so each one is
// worth spending carefully. The rules here are:
//
//   1. Only ever ask straight after a solved board — a moment the player is
//      pleased with, never on launch, a menu, or the paywall.
//   2. Only ask once they've solved enough boards to have an opinion.
//   3. Only ask once they've come back on a second separate day. Six launches
//      in one sitting isn't a fan; returning tomorrow is.
//
// The three asks are spread across the player's life rather than fired off in
// one week: the first is well inside the free levels so free players are
// actually reachable, the rest land much later.

import { storage } from "./storage.js";
import { requestReview } from "./native.js";

const SOLVES_KEY = "zen_total_solves";
const DAYS_KEY = "zen_play_days";
const PROMPTS_KEY = "zen_review_prompts";

// Solves required for the 1st, 2nd and 3rd ask. The first sits below the free
// level cap (20) on purpose — before this, a free player could never be asked.
export const SOLVE_MILESTONES = [8, 40, 120];

export const MIN_DISTINCT_DAYS = 2;
const MAX_PROMPTS_PER_YEAR = 3;
const DAYS_BETWEEN_PROMPTS = 90;

// Never ask in the shadow of a purchase decision.
const PAYWALL_QUIET_PERIOD_MS = 60 * 1000;

const DAY_MS = 24 * 60 * 60 * 1000;

let paywallTouchedAt = 0;

function readJsonArray(key) {
  try {
    const parsed = JSON.parse(storage.getItem(key) ?? "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    return [];
  }
}

function todayStamp(now) {
  const d = new Date(now);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

// Called once per launch. Keeps a short rolling list of the days the player has
// opened the game; only the count of distinct days matters, so it stays capped.
export function recordPlayDay(now = Date.now()) {
  const today = todayStamp(now);
  const days = readJsonArray(DAYS_KEY).filter((d) => typeof d === "string");
  if (days.includes(today)) return days.length;
  const next = [...days, today].slice(-10);
  storage.setItem(DAYS_KEY, JSON.stringify(next));
  return next.length;
}

export function recordSolve() {
  const raw = Number(storage.getItem(SOLVES_KEY));
  const next = (Number.isFinite(raw) && raw > 0 ? raw : 0) + 1;
  storage.setItem(SOLVES_KEY, String(next));
  return next;
}

// Suppresses the prompt for a minute either side of the paywall, so a player
// who has just been asked for money is never immediately asked for a review.
export function notePaywallActivity(now = Date.now()) {
  paywallTouchedAt = now;
}

/**
 * Pure decision: given what we know, should we ask right now?
 * Exported separately from the side effects so it can be reasoned about
 * and tested without a device.
 */
export function shouldPrompt({ solves, distinctDays, prompts, now, paywallAt }) {
  if (distinctDays < MIN_DISTINCT_DAYS) return false;
  if (now - paywallAt < PAYWALL_QUIET_PERIOD_MS) return false;

  const inLastYear = prompts.filter((t) => now - t < 365 * DAY_MS);
  if (inLastYear.length >= MAX_PROMPTS_PER_YEAR) return false;

  const lastPrompt = prompts.length ? Math.max(...prompts) : null;
  if (lastPrompt !== null && now - lastPrompt < DAYS_BETWEEN_PROMPTS * DAY_MS) return false;

  // Milestone is chosen by how many times we've asked before, so the three
  // asks sequence 8 -> 40 -> 120 and can never double-fire on one milestone.
  const milestone = SOLVE_MILESTONES[prompts.length];
  if (milestone === undefined) return false;

  // >= rather than === so a counter carried over from an older install, or one
  // that skips a value, still qualifies instead of silently missing its window.
  return solves >= milestone;
}

/**
 * Call right after a board is solved. Counts the solve and, if the moment is
 * right, asks for a review once the success card has had time to land.
 * Returns true if a prompt was requested.
 */
export function maybePromptForReview({ delayMs = 2000, now = Date.now() } = {}) {
  const solves = recordSolve();
  const distinctDays = readJsonArray(DAYS_KEY).length;
  const prompts = readJsonArray(PROMPTS_KEY).filter((t) => Number.isFinite(t));

  if (!shouldPrompt({ solves, distinctDays, prompts, now, paywallAt: paywallTouchedAt })) {
    return false;
  }

  storage.setItem(PROMPTS_KEY, JSON.stringify([...prompts, now].slice(-6)));
  window.setTimeout(() => requestReview(), delayMs);
  return true;
}
