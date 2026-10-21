"use client";

import { useMemo, useState } from "react";
import { SearchIcon } from "lucide-react";
import type { Unit } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { filterServices } from "@/lib/work-entries";
import { UNIT_LABELS } from "@/lib/units";

export type MaterialOption = { id: number; name: string; unit: Unit; category: string | null };

export const FREE_TEXT = "free";

type Props = {
  services: MaterialOption[];
  recentIds: number[];
  value: string; // service id or FREE_TEXT
  onChange: (value: string) => void;
  /** Called with the search text when the user takes it over as free text. */
  onFreeText?: (name: string) => void;
};

/**
 * Few shortcuts instead of a long dropdown: the recently used articles (plus the current choice)
 * as chips, everything else through a search dialog with category filter. Anything not in the
 * catalog goes through "Freitext".
 */
export function MaterialPicker({ services, recentIds, value, onChange, onFreeText }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string | null>(null);

  const categories = useMemo(
    () => [...new Set(services.map((s) => s.category).filter((c): c is string => c !== null))].sort((a, b) => a.localeCompare(b, "de")),
    [services],
  );
  const results = useMemo(() => filterServices(services, query, category), [services, query, category]);

  const chips: MaterialOption[] = [];
  for (const id of recentIds) {
    const s = services.find((x) => x.id === id);
    if (s) chips.push(s);
  }
  const current = services.find((s) => String(s.id) === value);
  if (current && !chips.some((c) => c.id === current.id)) chips.unshift(current);
  // Nothing used yet: show the first few so the section is never empty.
  if (chips.length === 0) chips.push(...services.slice(0, 3));

  function pick(next: string) {
    onChange(next);
    setOpen(false);
    setQuery("");
    setCategory(null);
  }

  const chip = (selected: boolean) =>
    cn(
      "min-h-11 rounded-lg border px-3 text-base font-medium transition-colors",
      selected ? "border-primary bg-primary text-primary-foreground" : "bg-background hover:bg-muted",
    );
  const trimmed = query.trim();

  return (
    <div className="space-y-2">
      <Label>{recentIds.length > 0 ? "Artikel (zuletzt verwendet)" : "Artikel"}</Label>
      <div className="flex flex-wrap gap-2">
        {chips.map((s) => (
          <button key={s.id} type="button" className={chip(String(s.id) === value)} aria-pressed={String(s.id) === value} onClick={() => pick(String(s.id))}>
            {s.name}
          </button>
        ))}
        <button type="button" className={chip(value === FREE_TEXT)} aria-pressed={value === FREE_TEXT} onClick={() => pick(FREE_TEXT)}>
          Freitext
        </button>
      </div>
      {services.length > chips.length && (
        <Button type="button" variant="outline" className="h-11 w-full justify-start gap-2 border-dashed text-base" onClick={() => setOpen(true)}>
          <SearchIcon className="size-4" aria-hidden="true" />
          <span className="flex-1 text-left">Alle Artikel durchsuchen</span>
          <span className="text-sm text-muted-foreground">{services.length}</span>
        </Button>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85dvh] grid-rows-[auto_auto_auto_minmax(0,1fr)]">
          <DialogHeader>
            <DialogTitle>Artikel wählen</DialogTitle>
          </DialogHeader>
          <div className="relative">
            <SearchIcon className="pointer-events-none absolute left-3 top-3.5 size-4 text-muted-foreground" aria-hidden="true" />
            <Input
              type="search"
              aria-label="Artikel suchen"
              placeholder="Artikel suchen"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="h-11 pl-9 text-base"
              autoFocus
            />
          </div>
          {categories.length > 0 && (
            <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
              {[null, ...categories].map((c) => (
                <button key={c ?? "all"} type="button" aria-pressed={category === c} className={cn(chip(category === c), "shrink-0 rounded-full")} onClick={() => setCategory(c)}>
                  {c ?? "Alle"}
                </button>
              ))}
            </div>
          )}
          <div className="space-y-2 overflow-y-auto">
            {results.map((s) => (
              <button
                key={s.id}
                type="button"
                className="flex min-h-14 w-full items-center gap-3 rounded-lg border px-3 py-2 text-left hover:bg-muted"
                onClick={() => pick(String(s.id))}
              >
                <span className="flex-1">
                  <span className="block text-base font-medium">{s.name}</span>
                  {s.category && <span className="block text-sm text-muted-foreground">{s.category}</span>}
                </span>
                <span className="text-sm text-muted-foreground">{UNIT_LABELS[s.unit]}</span>
              </button>
            ))}
            {results.length === 0 && <p className="text-sm text-muted-foreground">Kein Treffer im Katalog.</p>}
            {results.length === 0 && trimmed !== "" && (
              <Button type="button" variant="outline" className="h-14 w-full justify-start border-dashed text-base" onClick={() => {
                  onFreeText?.(trimmed);
                  pick(FREE_TEXT);
                }}>
                «{trimmed}» als Freitext erfassen
              </Button>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
