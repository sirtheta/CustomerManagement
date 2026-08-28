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
import { GripVerticalIcon, PlusIcon, Trash2Icon } from "lucide-react";
import type { Category, Service, Unit } from "@prisma/client";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

type SerializedService = Omit<Service, "unitPrice"> & { unitPrice: number };

export { itemDataSchema, type ItemData } from "@/components/items-editor-schema";

type Props = {
  services: SerializedService[];
  categories?: Category[];
  initialItems?: ItemData[];
  inputName?: string;
  showDiscount?: boolean;
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
    discountPercent: 0,
    totalAmount: 0,
    customText: "",
    categoryId: null,
    isCustom: true,
    saveToCatalog: false,
    includeDescription: true,
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
    discountPercent: 0,
    totalAmount: unitPrice,
    customText: "",
    categoryId: s.categoryId,
    isCustom: false,
  };
}

type SortableItemRowProps = {
  id: string;
  index: number;
  item: ItemData;
  onUpdate: (patch: Partial<ItemData>) => void;
  onRemove: () => void;
  quantityDisplay: string | undefined;
  onQuantityChange: (raw: string) => void;
  onQuantityBlur: () => void;
  priceDisplay: string | undefined;
  onPriceChange: (raw: string) => void;
  onPriceBlur: () => void;
  showDiscount: boolean;
  categories: Category[];
};

function SortableItemRow({
  id,
  index,
  item,
  onUpdate,
  onRemove,
  quantityDisplay,
  onQuantityChange,
  onQuantityBlur,
  priceDisplay,
  onPriceChange,
  onPriceBlur,
  showDiscount,
  categories,
}: SortableItemRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "rounded-lg border p-3 space-y-2 bg-background",
        index % 2 === 0 ? "" : "bg-muted/20",
        isDragging && "opacity-50 z-10 shadow-lg"
      )}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1">
          <button
            type="button"
            {...attributes}
            {...listeners}
            className="text-muted-foreground hover:text-foreground transition-colors p-1 -ml-1 cursor-grab active:cursor-grabbing touch-none"
            aria-label="Position verschieben"
          >
            <GripVerticalIcon className="size-4" />
          </button>
          <span className="text-xs font-medium text-muted-foreground">Position {index + 1}</span>
        </div>
        <button
          type="button"
          onClick={onRemove}
          className="text-destructive hover:text-destructive/70 transition-colors p-1"
          aria-label="Position entfernen"
        >
          <Trash2Icon className="size-4" />
        </button>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <div className="space-y-1">
          <label className="text-xs font-medium">Bezeichnung</label>
          <Input
            value={item.name}
            onChange={(e) => onUpdate({ name: e.target.value })}
            placeholder="Bezeichnung"
            className="h-8 text-sm"
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium">Beschreibung</label>
          <Textarea
            value={item.description}
            onChange={(e) => onUpdate({ description: e.target.value })}
            placeholder="Beschreibung"
            rows={2}
            className="text-sm resize-none"
          />
        </div>
      </div>
      <div className={cn("grid grid-cols-1 gap-2", showDiscount ? "sm:grid-cols-6" : "sm:grid-cols-5")}>
        <div className="space-y-1">
          <label className="text-xs font-medium">Kategorie</label>
          <Select
            value={item.categoryId?.toString() ?? "none"}
            onValueChange={(value) => onUpdate({ categoryId: value === "none" ? null : Number(value) })}
          >
            <SelectTrigger size="sm" className="h-8 text-sm w-full">
              <SelectValue>
                {(value: string | null) => value === "none" || !value
                  ? "Keine Kategorie"
                  : categories.find((category) => category.categoryId.toString() === value)?.name ?? value}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Keine Kategorie</SelectItem>
              {categories.map((category) => (
                <SelectItem key={category.categoryId} value={category.categoryId.toString()}>
                  {category.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium">Einheit</label>
          <Select
            value={item.unit}
            onValueChange={(val: string | null) => { if (val) onUpdate({ unit: val as Unit }); }}
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
            value={quantityDisplay ?? String(item.quantity)}
            onChange={(e) => onQuantityChange(e.target.value)}
            onBlur={onQuantityBlur}
            className="h-8 text-sm text-right"
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium">Preis (CHF)</label>
          <Input
            type="text"
            inputMode="decimal"
            value={priceDisplay ?? String(item.unitPrice)}
            onChange={(e) => onPriceChange(e.target.value)}
            onBlur={onPriceBlur}
            className="h-8 text-sm text-right"
          />
        </div>
        {showDiscount && (
          <div className="space-y-1">
            <label className="text-xs font-medium">Rabatt (%)</label>
            <Input
              type="number"
              min="0"
              max="100"
              step="0.01"
              value={item.discountPercent}
              onChange={(e) => onUpdate({ discountPercent: Number(e.target.value) || 0 })}
              className="h-8 text-sm text-right"
            />
          </div>
        )}
        <div className="space-y-1 hidden sm:block">
          <label className="text-xs font-medium">Total (CHF)</label>
          <div className="h-8 flex items-center justify-end text-sm font-semibold">
            {formatCurrency(item.totalAmount)}
          </div>
        </div>
      </div>
      {item.isCustom && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={item.saveToCatalog ?? false}
              onChange={(event) => onUpdate({ saveToCatalog: event.target.checked })}
              className="h-3.5 w-3.5 accent-primary"
            />
            Zum Leistungskatalog hinzufügen
          </label>
          {item.saveToCatalog && (
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={item.includeDescription ?? true}
                onChange={(event) => onUpdate({ includeDescription: event.target.checked })}
                className="h-3.5 w-3.5 accent-primary"
              />
              Beschreibung übernehmen
            </label>
          )}
        </div>
      )}
      <div className="text-right text-sm font-semibold sm:hidden">
        Total: {formatCurrency(item.totalAmount)}
      </div>
    </div>
  );
}

export default function ItemsEditor({
  services,
  categories = [],
  initialItems = [],
  inputName = "itemsJson",
  showDiscount = false,
}: Props) {
  const [items, setItems] = useState<ItemData[]>(initialItems);
  const [ids, setIds] = useState<string[]>(() => initialItems.map(() => crypto.randomUUID()));
  const [addMode, setAddMode] = useState<"service" | "custom" | null>(null);
  const [serviceSearch, setServiceSearch] = useState<string>("");
  const [quantityDisplays, setQuantityDisplays] = useState<Record<string, string>>({});
  const [priceDisplays, setPriceDisplays] = useState<Record<string, string>>({});

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  function updateItem(index: number, patch: Partial<ItemData>) {
    setItems((prev) => {
      const next = [...prev];
      const updated = { ...next[index], ...patch };
      if ("quantity" in patch || "unitPrice" in patch || "discountPercent" in patch) {
        updated.totalAmount =
          Number(updated.quantity) * Number(updated.unitPrice) * (1 - Number(updated.discountPercent) / 100);
      }
      next[index] = updated;
      return next;
    });
  }

  function removeItem(index: number) {
    const removedId = ids[index];
    setItems((prev) => prev.filter((_, i) => i !== index));
    setIds((prev) => prev.filter((_, i) => i !== index));
    const dropId = (setter: Dispatch<SetStateAction<Record<string, string>>>) => {
      setter((prev) => {
        if (!(removedId in prev)) return prev;
        const next = { ...prev };
        delete next[removedId];
        return next;
      });
    };
    dropId(setQuantityDisplays);
    dropId(setPriceDisplays);
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = ids.indexOf(String(active.id));
    const newIndex = ids.indexOf(String(over.id));
    if (oldIndex === -1 || newIndex === -1) return;
    setItems((prev) => arrayMove(prev, oldIndex, newIndex));
    setIds((prev) => arrayMove(prev, oldIndex, newIndex));
  }

  function addCustomItem() {
    setItems((prev) => [...prev, emptyItem()]);
    setIds((prev) => [...prev, crypto.randomUUID()]);
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
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext items={ids} strategy={verticalListSortingStrategy}>
            {items.map((item, i) => (
              <SortableItemRow
                key={ids[i]}
                id={ids[i]}
                index={i}
                item={item}
                onUpdate={(patch) => updateItem(i, patch)}
                onRemove={() => removeItem(i)}
                quantityDisplay={quantityDisplays[ids[i]]}
                onQuantityChange={(raw) => {
                  setQuantityDisplays((prev) => ({ ...prev, [ids[i]]: raw }));
                  const num = parseFloat(raw.replace(",", "."));
                  if (!isNaN(num) && num >= 0) updateItem(i, { quantity: num });
                }}
                onQuantityBlur={() => {
                  const raw = quantityDisplays[ids[i]] ?? String(item.quantity);
                  const num = parseFloat(raw.replace(",", "."));
                  updateItem(i, { quantity: isNaN(num) || num < 0 ? 0 : num });
                  setQuantityDisplays((prev) => {
                    const next = { ...prev };
                    delete next[ids[i]];
                    return next;
                  });
                }}
                priceDisplay={priceDisplays[ids[i]]}
                onPriceChange={(raw) => {
                  setPriceDisplays((prev) => ({ ...prev, [ids[i]]: raw }));
                  const num = parseFloat(raw.replace(",", "."));
                  if (!isNaN(num) && num >= 0) updateItem(i, { unitPrice: num });
                }}
                onPriceBlur={() => {
                  const raw = priceDisplays[ids[i]] ?? String(item.unitPrice);
                  const num = parseFloat(raw.replace(",", "."));
                  updateItem(i, { unitPrice: isNaN(num) || num < 0 ? 0 : num });
                  setPriceDisplays((prev) => {
                    const next = { ...prev };
                    delete next[ids[i]];
                    return next;
                  });
                }}
                showDiscount={showDiscount}
                categories={categories}
              />
            ))}
          </SortableContext>
        </DndContext>
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
                    setIds((prev) => [...prev, crypto.randomUUID()]);
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
                    <div className="text-xs text-muted-foreground">
                      {categories.find((category) => category.categoryId === s.categoryId)?.name ?? "Keine Kategorie"}
                    </div>
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
