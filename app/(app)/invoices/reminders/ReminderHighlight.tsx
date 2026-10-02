"use client";

import { useEffect } from "react";

const HIGHLIGHT_CLASSES = ["ring-2", "ring-primary", "transition-shadow"];
const HIGHLIGHT_MS = 2500;

/**
 * Highlights the card named in `#reminder-<id>`. CSS `:target` alone is not
 * enough: a client navigation from another page (e.g. the invoice page) does
 * not set it, so the ring is set here once on mount and on hash changes.
 */
export function ReminderHighlight() {
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let current: HTMLElement | null = null;

    const clear = () => {
      if (timer) clearTimeout(timer);
      current?.classList.remove(...HIGHLIGHT_CLASSES);
      current = null;
    };

    const highlight = () => {
      const hash = window.location.hash;
      if (!/^#reminder-\d+$/.test(hash)) return;
      const el = document.getElementById(hash.slice(1));
      if (!el) return;
      clear();
      el.querySelector("details")?.setAttribute("open", "");
      current = el;
      el.scrollIntoView({ block: "start" });
      el.classList.add(...HIGHLIGHT_CLASSES);
      timer = setTimeout(clear, HIGHLIGHT_MS);
    };

    highlight();
    window.addEventListener("hashchange", highlight);
    return () => {
      window.removeEventListener("hashchange", highlight);
      clear();
    };
  }, []);

  return null;
}
