import { Capacitor } from "@capacitor/core";
import { Purchases } from "@revenuecat/purchases-capacitor";
import { useSyncExternalStore } from "react";
import { storage } from "./storage.js";

const ENTITLEMENT_ID = "Zento Pro";
const CACHE_KEY = "zen_has_full_game";
const DEV_KEY = "zen_dev_unlock";

const isNative = Capacitor.isNativePlatform();

function readDevOverride() {
  return storage.getItem(DEV_KEY) === "true";
}

let state = readDevOverride() || storage.getItem(CACHE_KEY) === "true";
let priceString = null;
const listeners = new Set();
const priceListeners = new Set();

function notify() {
  for (const l of listeners) l();
}

function notifyPrice() {
  for (const l of priceListeners) l();
}

function applyState(next) {
  if (state === next) return;
  state = next;
  notify();
}

function applyPrice(next) {
  if (next === priceString) return;
  priceString = next;
  notifyPrice();
}

function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function subscribePrice(listener) {
  priceListeners.add(listener);
  return () => priceListeners.delete(listener);
}

function getSnapshot() {
  return state;
}

function getPriceSnapshot() {
  return priceString;
}

export function useHasFullGame() {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function usePriceString() {
  return useSyncExternalStore(subscribePrice, getPriceSnapshot, getPriceSnapshot);
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
  // Configure synchronously, but defer the network-heavy calls
  // (getCustomerInfo, getOfferings). On older iOS where the sandbox
  // setup is flaky, calling them during boot has caused the StoreKit
  // XPC service to die and take the WebView with it.
  try {
    await Purchases.configure({ apiKey: import.meta.env.VITE_REVENUECAT_IOS_KEY });
  } catch (err) {
    console.error("RevenueCat configure failed", err);
    return;
  }
  // Run entitlement + offering refresh detached from the boot path.
  // Each wrapped independently so one failing doesn't cancel the other.
  setTimeout(() => {
    refreshEntitlements().catch((err) => {
      console.error("RevenueCat refreshEntitlements failed", err);
    });
  }, 1500);
  setTimeout(() => {
    refreshOfferingPrice().catch((err) => {
      console.error("RevenueCat refreshOfferingPrice failed", err);
    });
  }, 2500);
}

async function refreshOfferingPrice() {
  if (!isNative || !hasUsableKey()) return;
  try {
    const { current } = await Purchases.getOfferings();
    const pkg = current?.availablePackages?.[0];
    applyPrice(pkg?.product?.priceString ?? null);
  } catch (err) {
    console.error("RevenueCat getOfferings failed", err);
  }
}

export async function refreshEntitlements() {
  if (!isNative || !hasUsableKey()) return;
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
  await Purchases.restorePurchases();
  await refreshEntitlements();
}

if (typeof window !== "undefined") {
  window.zenDevUnlock = (on = true) => {
    setDevUnlock(Boolean(on));
    return getHasFullGame();
  };
}
