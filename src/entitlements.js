import { Capacitor } from "@capacitor/core";
import { useSyncExternalStore } from "react";
import { storage } from "./storage.js";

const ENTITLEMENT_ID = "full_game";
const CACHE_KEY = "zen_has_full_game";
const DEV_KEY = "zen_dev_unlock";

const isNative = Capacitor.isNativePlatform();

function readDevOverride() {
  return storage.getItem(DEV_KEY) === "true";
}

let state = readDevOverride() || storage.getItem(CACHE_KEY) === "true";
const listeners = new Set();

function notify() {
  for (const l of listeners) l();
}

function applyState(next) {
  if (state === next) return;
  state = next;
  notify();
}

function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot() {
  return state;
}

export function useHasFullGame() {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function getHasFullGame() {
  return state;
}

export function setDevUnlock(unlocked) {
  if (unlocked) {
    storage.setItem(DEV_KEY, "true");
  } else {
    storage.removeItem(DEV_KEY);
  }
  applyState(unlocked || storage.getItem(CACHE_KEY) === "true");
}

let purchasesPromise = null;
function loadPurchases() {
  if (purchasesPromise) return purchasesPromise;
  if (!isNative) return Promise.resolve(null);
  purchasesPromise = import("@revenuecat/purchases-capacitor")
    .then((m) => m.Purchases)
    .catch((err) => {
      console.error("RevenueCat import failed", err);
      return null;
    });
  return purchasesPromise;
}

function hasUsableKey() {
  const key = import.meta.env.VITE_REVENUECAT_IOS_KEY;
  return typeof key === "string" && key.length > 0 && !key.includes("PLACEHOLDER");
}

export async function initRevenueCat() {
  if (!isNative) return;
  if (!hasUsableKey()) {
    console.warn("RevenueCat: no API key configured, skipping init");
    return;
  }
  const Purchases = await loadPurchases();
  if (!Purchases) return;
  try {
    await Purchases.configure({ apiKey: import.meta.env.VITE_REVENUECAT_IOS_KEY });
    await refreshEntitlements();
  } catch (err) {
    console.error("RevenueCat configure failed", err);
  }
}

export async function refreshEntitlements() {
  if (!isNative || !hasUsableKey()) return;
  const Purchases = await loadPurchases();
  if (!Purchases) return;
  try {
    const { customerInfo } = await Purchases.getCustomerInfo();
    const isActive = Boolean(customerInfo?.entitlements?.active?.[ENTITLEMENT_ID]);
    storage.setItem(CACHE_KEY, isActive ? "true" : "false");
    applyState(isActive || readDevOverride());
  } catch (err) {
    console.error("RevenueCat getCustomerInfo failed", err);
  }
}

export async function purchaseFullGame() {
  if (!isNative || !hasUsableKey()) {
    throw new Error("Purchases unavailable in this environment");
  }
  const Purchases = await loadPurchases();
  if (!Purchases) throw new Error("Purchases plugin failed to load");
  const { current } = await Purchases.getOfferings();
  if (!current) throw new Error("No offering configured in RevenueCat");
  const pkg = current.availablePackages?.[0];
  if (!pkg) throw new Error("No package in current offering");
  await Purchases.purchasePackage({ aPackage: pkg });
  await refreshEntitlements();
}

export async function restorePurchases() {
  if (!isNative || !hasUsableKey()) {
    throw new Error("Restore unavailable in this environment");
  }
  const Purchases = await loadPurchases();
  if (!Purchases) throw new Error("Purchases plugin failed to load");
  await Purchases.restorePurchases();
  await refreshEntitlements();
}

if (typeof window !== "undefined") {
  window.zenDevUnlock = (on = true) => {
    setDevUnlock(Boolean(on));
    return getHasFullGame();
  };
}
