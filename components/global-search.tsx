"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Search } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { searchAction } from "@/app/(app)/search/actions";
import { SEARCH_MIN_LENGTH, type GlobalSearchResults } from "@/lib/search";
import { flattenResults, GlobalSearchDropdown } from "@/components/global-search-dropdown";

type Props = {
  autoFocus?: boolean;
  size?: "sm" | "default";
  className?: string;
  disableDropdown?: boolean;
};

export function GlobalSearch({ autoFocus, size = "default", className, disableDropdown }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLFormElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Monotonic counter to drop out-of-order responses: only the latest
  // request may write results (server actions queue per client).
  const requestIdRef = useRef(0);
  const listboxId = useId();
  const isSm = size === "sm";
  const dropdownEnabled = !disableDropdown;

  const [value, setValue] = useState(() => (isSm ? "" : searchParams.get("q") ?? ""));
  const [results, setResults] = useState<GlobalSearchResults | null>(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);

  const term = value.trim();
  // While loading, the dropdown shows only the spinner — keep keyboard
  // navigation in sync by exposing no items.
  const items = !loading && open ? flattenResults(results, term) : [];

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setActiveIndex(-1);
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  function closeDropdown() {
    setOpen(false);
    setActiveIndex(-1);
  }

  function navigateTo(href: string) {
    closeDropdown();
    router.push(href);
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const next = e.target.value;
    setValue(next);
    if (!dropdownEnabled) return;

    if (timerRef.current) clearTimeout(timerRef.current);
    const nextTerm = next.trim();
    if (nextTerm.length < SEARCH_MIN_LENGTH) {
      requestIdRef.current++;
      setResults(null);
      setLoading(false);
      closeDropdown();
      return;
    }

    setOpen(true);
    setLoading(true);
    setActiveIndex(-1);
    timerRef.current = setTimeout(async () => {
      const id = ++requestIdRef.current;
      try {
        const res = await searchAction(nextTerm);
        if (id !== requestIdRef.current) return;
        setResults(res);
      } catch {
        if (id !== requestIdRef.current) return;
        setResults(null);
      }
      setLoading(false);
    }, 300);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!dropdownEnabled) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (!open) {
        // Standard combobox behavior: ArrowDown reopens existing results
        if (results && term.length >= SEARCH_MIN_LENGTH) {
          e.preventDefault();
          setOpen(true);
          setActiveIndex(0);
        }
        return;
      }
      if (items.length === 0) return;
      e.preventDefault();
      setActiveIndex((i) =>
        e.key === "ArrowDown"
          ? (i + 1) % items.length
          : i <= 0
            ? items.length - 1
            : i - 1
      );
    } else if (e.key === "Escape") {
      if (open) {
        // Only close the dropdown: keep the text (Chrome clears type="search"
        // natively) and don't close e.g. the surrounding mobile menu
        e.preventDefault();
        e.stopPropagation();
        closeDropdown();
      }
    } else if (e.key === "Enter") {
      if (open && activeIndex >= 0 && items[activeIndex]) {
        e.preventDefault();
        navigateTo(items[activeIndex].href);
      }
      // otherwise the form submit navigates to /search?q=…
    } else if (e.key === "Tab") {
      closeDropdown();
    }
  }

  function handleFocus() {
    if (dropdownEnabled && term.length >= SEARCH_MIN_LENGTH && results) {
      setOpen(true);
    }
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (term) {
      closeDropdown();
      router.push(`/search?q=${encodeURIComponent(term)}`);
    }
  }

  return (
    <form
      ref={containerRef}
      onSubmit={handleSubmit}
      className={isSm ? (className ?? "hidden md:flex items-center") : undefined}
    >
      <div className={cn("relative", isSm && "w-full")}>
        <Search
          className={cn(
            "absolute top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none",
            isSm ? "left-2 size-3.5" : "left-3 size-4"
          )}
        />
        <Input
          ref={inputRef}
          name="q"
          type="search"
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onFocus={handleFocus}
          placeholder={isSm ? "Suchen…" : "Kunden, Rechnungen oder Offerten suchen…"}
          className={
            isSm
              ? cn("pl-7 h-7 text-xs", className ? "w-full" : "w-36")
              : "pl-10 h-11 text-base"
          }
          role="combobox"
          aria-expanded={dropdownEnabled ? open : undefined}
          aria-controls={dropdownEnabled ? listboxId : undefined}
          aria-autocomplete={dropdownEnabled ? "list" : undefined}
          aria-activedescendant={
            dropdownEnabled && activeIndex >= 0
              ? `${listboxId}-option-${activeIndex}`
              : undefined
          }
          autoComplete="new-password"
          data-lpignore="true"
          data-1p-ignore
          data-bwignore
        />
        {dropdownEnabled && open && (
          <GlobalSearchDropdown
            results={results}
            loading={loading}
            term={term}
            activeIndex={activeIndex}
            listboxId={listboxId}
            onSelect={navigateTo}
            onHover={setActiveIndex}
          />
        )}
      </div>
    </form>
  );
}
