"use client";

import { useEffect } from "react";
import { refreshSessionIfDue } from "@/lib/session-refresh";

// Keeps the login alive while the app is in use (see lib/session-refresh.ts). Renders nothing.
const CHECK_EVERY_MS = 15 * 60 * 1000;

function getStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function SessionRefresh() {
  useEffect(() => {
    const check = () => {
      void refreshSessionIfDue({ storage: getStorage(), fetchFn: window.fetch.bind(window) });
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") check();
    };

    check();
    document.addEventListener("visibilitychange", onVisible);
    // A tab that stays open and visible (PWA, wall display) never fires visibilitychange.
    const timer = window.setInterval(check, CHECK_EVERY_MS);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.clearInterval(timer);
    };
  }, []);

  return null;
}
