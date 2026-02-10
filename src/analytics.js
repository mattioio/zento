const CONSENT_KEY = "zen_analytics_consent";
const CONSENT_GRANTED = "granted";
const CONSENT_DENIED = "denied";

let posthogInstance = null;
let isReady = false;
let initPromise = null;

const getConfig = () => {
  const key = import.meta.env.VITE_POSTHOG_KEY;
  if (!key) return null;
  const rawHost = import.meta.env.VITE_POSTHOG_HOST;
  const host = rawHost && rawHost.trim().length > 0 ? rawHost.trim() : "https://app.posthog.com";
  return { key, host };
};

export function getAnalyticsConsent() {
  try {
    return localStorage.getItem(CONSENT_KEY);
  } catch (err) {
    return null;
  }
}

export function setAnalyticsConsent(next) {
  try {
    localStorage.setItem(CONSENT_KEY, next);
  } catch (err) {
    // Ignore persistence errors.
  }
  if (next === CONSENT_GRANTED) {
    initAnalytics();
    return;
  }
  if (next === CONSENT_DENIED && posthogInstance && isReady) {
    posthogInstance.opt_out_capturing();
    posthogInstance.reset();
  }
}

export async function initAnalytics() {
  if (isReady) return posthogInstance;
  if (initPromise) return initPromise;
  const config = getConfig();
  if (!config) return null;
  initPromise = import("posthog-js")
    .then((mod) => {
      posthogInstance = mod.default;
      const isSecure =
        typeof window !== "undefined" && window.location && window.location.protocol === "https:";
      posthogInstance.init(config.key, {
        api_host: config.host,
        autocapture: false,
        capture_pageview: false,
        capture_pageleave: false,
        disable_session_recording: true,
        persistence: "localStorage",
        secure_cookie: isSecure
      });
      posthogInstance.opt_in_capturing();
      if (typeof window !== "undefined") {
        window.posthog = posthogInstance;
      }
      isReady = true;
      return posthogInstance;
    })
    .catch(() => {
      initPromise = null;
      return null;
    });
  return initPromise;
}

export function track(eventName, properties = {}) {
  if (!isReady || !posthogInstance) return;
  posthogInstance.capture(eventName, properties);
}

export const ANALYTICS_CONSENT = {
  GRANTED: CONSENT_GRANTED,
  DENIED: CONSENT_DENIED
};
