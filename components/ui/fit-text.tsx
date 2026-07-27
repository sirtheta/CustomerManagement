"use client";

import { useRef, useLayoutEffect } from "react";
import { cn } from "@/lib/utils";

export function FitText({ value, className }: { value: string; className?: string }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    const wrap = wrapRef.current;
    const text = textRef.current;
    if (!wrap || !text) return;
    text.style.fontSize = "";
    if (text.scrollWidth > wrap.clientWidth) {
      const currentPx = parseFloat(getComputedStyle(text).fontSize);
      const scaled = (currentPx * wrap.clientWidth) / text.scrollWidth;
      text.style.fontSize = `${Math.max(Math.floor(scaled * 10) / 10, 10)}px`;
    }
  });

  return (
    <div ref={wrapRef} className="overflow-hidden">
      <span ref={textRef} className={cn("whitespace-nowrap block", className)}>
        {value}
      </span>
    </div>
  );
}
