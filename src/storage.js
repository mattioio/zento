import { Capacitor } from "@capacitor/core";
import { Preferences } from "@capacitor/preferences";

const isNative = Capacitor.isNativePlatform();

export async function hydrate() {
  if (!isNative) return;
  try {
    const { keys } = await Preferences.keys();
    await Promise.all(
      keys.map(async (key) => {
        if (localStorage.getItem(key) !== null) return;
        const { value } = await Preferences.get({ key });
        if (value !== null) localStorage.setItem(key, value);
      })
    );
  } catch (err) {
    console.error("storage.hydrate failed", err);
  }
}

function persist(key, value) {
  if (!isNative) return;
  Preferences.set({ key, value }).catch((err) => {
    console.error(`Preferences.set failed for ${key}`, err);
  });
}

function unpersist(key) {
  if (!isNative) return;
  Preferences.remove({ key }).catch((err) => {
    console.error(`Preferences.remove failed for ${key}`, err);
  });
}

export const storage = {
  getItem(key) {
    return localStorage.getItem(key);
  },
  setItem(key, value) {
    const str = String(value);
    localStorage.setItem(key, str);
    persist(key, str);
  },
  removeItem(key) {
    localStorage.removeItem(key);
    unpersist(key);
  },
};
