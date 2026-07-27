"use client";

import { useState, type Dispatch, type SetStateAction } from "react";
import { type ItemData } from "@/components/items-editor-schema";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn, formatCurrency } from "@/lib/utils";
import { ChevronDownIcon, ChevronUpIcon, PlusIcon, Trash2Icon } from "lucide-react";
import type { Service, Unit } from "@prisma/client";

type SerializedService = Omit<Service, "unitPrice"> & { unitPrice: number };

export { itemDataSchema, type ItemData } from "@/components/items-editor-schema";

type Props = {
  services: SerializedService[];
  initialItems?: ItemData[];
  inputName?: string;
};

const unitLabels: Record<Unit, string> = {
  Hour: "Stunde",
  Day: "Tag",
  Piece: "Stück",
  Package: "Pauschal",
};

function emptyItem(): ItemData {
  return {
    name: "",
    description: "",
    unit: "Hour",
    unitPrice: 0,
    quantity: 1,
    totalAmount: 0,
    customText: "",
    categoryId: null,
  };
}

function fromService(s: SerializedService): ItemData {
  const unitPrice = s.unitPrice;
  return {
    name: s.name,
    description: s.description ?? "",
    unit: s.unit,
    unitPrice,
    quantity: 1,
    totalAmount: unitPrice,
    customText: "",
    categoryId: s.categoryId,
  };
}

export default function ItemsEditor({
  services,
  initialItems = [],
  inputName = "itemsJson",
}: Props) {
  const [items, setItems] = useState<ItemData[]>(initialItems);
  const [addMode, setAddMode] = useState<"service" | "custom" | null>(null);
  const [serviceSearch, setServiceSearch] = useState<string>("");
  const [quantityDisplays, setQuantityDisplays] = useState<Record<number, string>>({});
  const [priceDisplays, setPriceDisplays] = useState<Record<number, string>>({});

  function updateItem(index: number, patch: Partial<ItemData>) {
    setItems((prev) => {
      const next = [...prev];
      const updated = { ...next[index], ...patch };
      if ("quantity" in patch || "unitPrice" in patch) {
        updated.totalAmount =
          Number(updated.quantity) * Number(updated.unitPrice);
      }
      next[index] = updated;
      return next;
    });
  }

  function removeItem(index: number) {
    setItems((prev) => prev.filter((_, i) => i !== index));
    setQuantityDisplays((prev) => {
      const next: Record<number, string> = {};
      for (const [key, val] of Object.entries(prev)) {
        const k = Number(key);
        if (k < index) next[k] = val;
        else if (k > index) next[k - 1] = val;
      }
      return next;
    });
    setPriceDisplays((prev) => {
      const next: Record<number, string> = {};
      for (const [key, val] of Object.entries(prev)) {
        const k = Number(key);
        if (k < index) next[k] = val;
        else if (k > index) next[k - 1] = val;
      }
      return next;
    });
  }

  function moveItem(index: number, dir: -1 | 1) {
    const target = index + dir;
    if (target < 0 || target >= items.length) return;
    setItems((prev) => {
      const next = [...prev];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
    const swapDisplays = (
      setter: Dispatch<SetStateAction<Record<number, string>>>
    ) => {
      setter((prev) => {
        const next = { ...prev };
        const a = next[index];
        const b = next[target];
        if (b === undefined) delete next[index]; else next[index] = b;
        if (a === undefined) delete next[target]; else next[target] = a;
        return next;
      });
    };
    swapDisplays(setQuantityDisplays);
    swapDisplays(setPriceDisplays);
  }

  function addCustomItem() {
    setItems((prev) => [...prev, emptyItem()]);
    setAddMode(null);
  }

  const total = items.reduce((sum, item) => sum + Number(item.totalAmount), 0);

  return (
    <div className="space-y-3">
      {/* Card layout for all screen sizes */}
      <div className="space-y-3">
        {items.length === 0 && (
          <p className="text-center text-gray-400 py-6 italic text-sm">
            Noch keine Positionen hinzugefügt.
          </p>
        )}
        {items.map((item, i) => (
          <div key={i} className={cn("rounded-lg border p-3 space-y-2", i % 2 === 0 ? "" : "bg-muted/20")}>
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">Position {i + 1}</span>
              <div className="flex items-center gap-0.5">
                <button
                  type="button"
                  onClick={() => moveItem(i, -1)}
                  disabled={i === 0}
                  className="text-muted-foreground hover:text-foreground transition-colors p-1 disabled:opacity-30 disabled:pointer-events-none"
                  aria-label="Position nach oben verschieben"
                >
                  <ChevronUpIcon className="size-4" />
                </button>
                <button
                  type="button"
                  onClick={() => moveItem(i, 1)}
                  disabled={i === items.length - 1}
                  className="text-muted-foreground hover:text-foreground transition-colors p-1 disabled:opacity-30 disabled:pointer-events-none"
                  aria-label="Position nach unten verschieben"
                >
                  <ChevronDownIcon className="size-4" />
                </button>
                <button
                  type="button"
                  onClick={() => removeItem(i)}
                  className="text-destructive hover:text-destructive/70 transition-colors p-1"
                  aria-label="Position entfernen"
                >
                  <Trash2Icon className="size-4" />
                </button>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div className="space-y-1">
                <label className="text-xs font-medium">Bezeichnung</label>
                <Input
                  value={item.name}
                  onChange={(e) => updateItem(i, { name: e.target.value })}
                  placeholder="Bezeichnung"
                  className="h-8 text-sm"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium">Beschreibung</label>
                <Textarea
                  value={item.description}
                  onChange={(e) => updateItem(i, { description: e.target.value })}
                  placeholder="Beschreibung"
                  rows={2}
                  className="text-sm resize-none"
                />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
              <div className="space-y-1">
                <label className="text-xs font-medium">Einheit</label>
                <Select
                  value={item.unit}
                  onValueChange={(val: string | null) => { if (val) updateItem(i, { unit: val as Unit }); }}
                >
                  <SelectTrigger size="sm" className="h-8 text-sm w-full">
                    <SelectValue>
                      {(value: string | null) => value ? (unitLabels[value as Unit] ?? value) : "Einheit"}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(unitLabels) as Unit[]).map((u) => (
                      <SelectItem key={u} value={u}>
                        {unitLabels[u]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium">Menge</label>
                <Input
                  type="text"
                  inputMode="decimal"
                  value={quantityDisplays[i] ?? String(item.quantity)}
                  onChange={(e) => {
                    const raw = e.target.value;
                    setQuantityDisplays((prev) => ({ ...prev, [i]: raw }));
                    const num = parseFloat(raw.replace(",", "."));
                    if (!isNaN(num) && num >= 0) updateItem(i, { quantity: num });
                  }}
                  onBlur={() => {
                    const raw = quantityDisplays[i] ?? String(item.quantity);
                    const num = parseFloat(raw.replace(",", "."));
                    updateItem(i, { quantity: isNaN(num) || num < 0 ? 0 : num });
                    setQuantityDisplays((prev) => {
                      const next = { ...prev };
                      delete next[i];
                      return next;
                    });
                  }}
                  className="h-8 text-sm text-right"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium">Preis (CHF)</label>
                <Input
                  type="text"
                  inputMode="decimal"
                  value={priceDisplays[i] ?? String(item.unitPrice)}
                  onChange={(e) => {
                    const raw = e.target.value;
                    setPriceDisplays((prev) => ({ ...prev, [i]: raw }));
                    const num = parseFloat(raw.replace(",", "."));
                    if (!isNaN(num) && num >= 0) updateItem(i, { unitPrice: num });
                  }}
                  onBlur={() => {
                    const raw = priceDisplays[i] ?? String(item.unitPrice);
                    const num = parseFloat(raw.replace(",", "."));
                    updateItem(i, { unitPrice: isNaN(num) || num < 0 ? 0 : num });
                    setPriceDisplays((prev) => {
                      const next = { ...prev };
                      delete next[i];
                      return next;
                    });
                  }}
                  className="h-8 text-sm text-right"
                />
              </div>
              <div className="space-y-1 hidden sm:block">
                <label className="text-xs font-medium">Total (CHF)</label>
                <div className="h-8 flex items-center justify-end text-sm font-semibold">
                  {formatCurrency(item.totalAmount)}
                </div>
              </div>
            </div>
            <div className="text-right text-sm font-semibold sm:hidden">
              Total: {formatCurrency(item.totalAmount)}
            </div>
          </div>
        ))}
        {items.length > 0 && (
          <div className="text-right text-sm font-semibold pt-1 border-t">
            Gesamt: {formatCurrency(total)}
          </div>
        )}
      </div>

      {addMode === "service" && (
        <div className="border rounded-lg p-3 space-y-2">
          <Input
            autoFocus
            value={serviceSearch}
            onChange={(e) => setServiceSearch(e.target.value)}
            placeholder="Leistung suchen…"
            className="h-8"
            autoComplete="off"
            data-lpignore="true"
            data-1p-ignore
            data-bwignore
            data-form-type="other"
          />
          <div className="max-h-48 overflow-y-auto space-y-0.5">
            {(() => {
              const filteredServices = services.filter(
                (s) =>
                  serviceSearch === "" ||
                  s.name.toLowerCase().includes(serviceSearch.toLowerCase()) ||
                  (s.description ?? "").toLowerCase().includes(serviceSearch.toLowerCase())
              );
              if (filteredServices.length === 0) {
                return (
                  <p className="text-center text-sm text-muted-foreground py-3 italic">
                    Keine Leistung gefunden.
                  </p>
                );
              }
              return filteredServices.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => {
                    setItems((prev) => [...prev, fromService(s)]);
                    setServiceSearch("");
                    setAddMode(null);
                  }}
                  className="w-full text-left px-2 py-1.5 rounded hover:bg-accent hover:text-accent-foreground text-sm transition-colors flex items-center justify-between gap-2"
                >
                  <div>
                    <div className="font-medium">{s.name}</div>
                    {s.description && (
                      <div className="text-xs text-muted-foreground">{s.description}</div>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground whitespace-nowrap shrink-0">
                    {formatCurrency(s.unitPrice)}
                  </div>
                </button>
              ));
            })()}
          </div>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => { setAddMode(null); setServiceSearch(""); }}
          >
            Abbrechen
          </Button>
        </div>
      )}

      {addMode === null && (
        <div className="flex gap-2 flex-wrap">
          {services.length > 0 && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setAddMode("service")}
            >
              <PlusIcon className="size-3.5" />
              Leistung hinzufügen
            </Button>
          )}
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={addCustomItem}
          >
            <PlusIcon className="size-3.5" />
            Eigene Position
          </Button>
        </div>
      )}

      <input type="hidden" name={inputName} value={JSON.stringify(items)} />
    </div>
  );
}
