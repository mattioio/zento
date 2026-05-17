import { Capacitor } from "@capacitor/core";
import { useRegisterSW } from "virtual:pwa-register/react";

const STUB = {
  needRefresh: [false, () => {}],
  updateServiceWorker: () => Promise.resolve()
};

export const usePwaRegister = Capacitor.isNativePlatform()
  ? () => STUB
  : useRegisterSW;
