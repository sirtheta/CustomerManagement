"use client";

import { useActionState, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Trash2 } from "lucide-react";
import { createCategory, deleteCategory, updateCategory, type CategoryFormState } from "./actions";
import type { Category } from "@prisma/client";
import { activeBadge } from "@/lib/document-states";

export type CategoryRowData = Category & { usageCount: number };

const COLOR_PALETTE = [
  "#64748b", // Schiefer
  "#ef4444", // Rot
  "#f97316", // Orange
  "#f59e0b", // Bernstein
  "#eab308", // Gelb
  "#84cc16", // Limette
  "#22c55e", // Grün
  "#14b8a6", // Türkis
  "#06b6d4", // Cyan
  "#3b82f6", // Blau
  "#6366f1", // Indigo
  "#8b5cf6", // Violett
  "#ec4899", // Pink
];

const DEFAULT_COLOR = COLOR_PALETTE[0];

function ColorSwatchPicker({ name, defaultValue }: { name: string; defaultValue: string }) {
  const [selected, setSelected] = useState(defaultValue);
  const [open, setOpen] = useState(false);

  return (
    <>
      <input type="hidden" name={name} value={selected} readOnly />
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={
            <Button type="button" variant="outline" aria-label="Farbe wählen" className="size-9 p-0" />
          }
        >
          <span
            className="size-5 rounded-full ring-1 ring-black/10"
            style={{ backgroundColor: selected }}
          />
        </PopoverTrigger>
        <PopoverContent className="w-auto" align="start">
          <div className="flex flex-wrap gap-1.5 max-w-52">
            {COLOR_PALETTE.map((color) => {
              const isSelected = selected.toLowerCase() === color.toLowerCase();
              return (
                <button
                  key={color}
                  type="button"
                  onClick={() => {
                    setSelected(color);
                    setOpen(false);
                  }}
                  aria-label={`Farbe ${color}`}
                  aria-pressed={isSelected}
                  title={color}
                  className={cn(
                    "size-7 rounded-full transition focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    isSelected
                      ? "ring-2 ring-offset-2 ring-foreground"
                      : "ring-1 ring-black/10 hover:scale-110"
                  )}
                  style={{ backgroundColor: color }}
                />
              );
            })}
          </div>
        </PopoverContent>
      </Popover>
    </>
  );
}

function CreateCategoryForm() {
  const [state, formAction, isPending] = useActionState<CategoryFormState, FormData>(
    createCategory,
    {}
  );

  return (
    <form action={formAction} className="flex items-end gap-3 flex-wrap">
      <div className="space-y-1.5">
        <Label htmlFor="new-name">Bezeichnung</Label>
        <Input id="new-name" name="name" required placeholder="z.B. Material" className="w-56" />
      </div>
      <div className="space-y-1.5">
        <Label>Farbe</Label>
        <ColorSwatchPicker name="colorHex" defaultValue={DEFAULT_COLOR} />
      </div>
      <Button type="submit" disabled={isPending}>
        {isPending ? "Anlegen…" : "Kategorie anlegen"}
      </Button>
      {state.error && <p className="text-sm text-destructive w-full">{state.error}</p>}
    </form>
  );
}

function CategoryRow({ category }: { category: CategoryRowData }) {
  const action = updateCategory.bind(null, category.categoryId);
  const [state, formAction, isPending] = useActionState<CategoryFormState, FormData>(
    action,
    {}
  );

  return (
    <TableRow>
      <TableCell className="px-4 py-3 whitespace-normal" colSpan={4}>
        <form action={formAction} className="flex items-center gap-3 flex-wrap">
          <Input name="name" defaultValue={category.name} required className="w-56" />
          <ColorSwatchPicker name="colorHex" defaultValue={category.colorHex ?? DEFAULT_COLOR} />
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              name="isActive"
              defaultChecked={category.isActive}
              className="h-4 w-4 rounded border-input accent-primary"
            />
            Aktiv
          </label>
          {!category.isActive && <Badge variant={activeBadge(false).variant}>{activeBadge(false).label}</Badge>}
          <Button type="submit" variant="outline" size="sm" disabled={isPending}>
            {isPending ? "Speichern…" : "Speichern"}
          </Button>
          {state.error && <p className="text-sm text-destructive">{state.error}</p>}
        </form>
        <div className="mt-2 flex items-center gap-3 text-xs text-muted-foreground">
          {category.usageCount > 0 ? (
            <span>Wird {category.usageCount}× verwendet und kann nicht gelöscht werden.</span>
          ) : (
            <ConfirmDialog
              title="Kategorie löschen"
              description={`Soll die Kategorie «${category.name}» wirklich gelöscht werden? Sie wird nirgends verwendet.`}
              confirmLabel="Löschen"
              triggerVariant="ghost"
              triggerSize="sm"
              triggerClassName="text-destructive hover:text-destructive hover:bg-destructive/10"
              onConfirm={async () => {
                const result = await deleteCategory(category.categoryId);
                if (!result.error) toast.success("Kategorie gelöscht");
                return result;
              }}
            >
              <Trash2 /> Löschen
            </ConfirmDialog>
          )}
        </div>
      </TableCell>
    </TableRow>
  );
}

export function CategoryManagement({ categories }: { categories: CategoryRowData[] }) {
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Neue Kategorie</CardTitle>
        </CardHeader>
        <CardContent>
          <CreateCategoryForm />
        </CardContent>
      </Card>

      <div className="rounded-lg border overflow-hidden">
        <Table>
          <TableHeader className="bg-muted/50">
            <TableRow>
              <TableHead className="px-4" colSpan={4}>
                {categories.length === 1 ? "1 Kategorie" : `${categories.length} Kategorien`}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {categories.length === 0 ? (
              <TableRow>
                <TableCell className="px-4 py-8 text-center text-muted-foreground" colSpan={4}>
                  Noch keine Kategorien vorhanden.
                </TableCell>
              </TableRow>
            ) : (
              categories.map((category) => (
                <CategoryRow key={category.categoryId} category={category} />
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
