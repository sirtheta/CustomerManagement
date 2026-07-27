"use client";

import { useActionState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { createService, updateService, type ServiceFormState } from "./actions";
import type { Category, Service, Unit } from "@prisma/client";

type SerializedService = Omit<Service, "unitPrice"> & { unitPrice: number };

type Props = {
  service?: SerializedService;
  categories: Category[];
};

const unitOptions: { value: Unit; label: string }[] = [
  { value: "Hour", label: "Stunde" },
  { value: "Day", label: "Tag" },
  { value: "Piece", label: "Stück" },
  { value: "Package", label: "Pauschal" },
];

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} className="text-xs text-destructive mt-1" role="alert">
      {message}
    </p>
  );
}

export default function ServiceForm({ service, categories }: Props) {
  const action = service
    ? updateService.bind(null, service.id)
    : createService;

  const [state, formAction, isPending] = useActionState<ServiceFormState, FormData>(
    action,
    {}
  );

  const fe = state.fieldErrors ?? {};

  return (
    <div className="max-w-2xl space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">
          {service ? "Leistung bearbeiten" : "Neue Leistung"}
        </h1>
        <Button variant="outline" render={<Link href="/services" />}>
          Abbrechen
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Leistungsdaten</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={formAction} className="space-y-4">
            {state.error && !state.fieldErrors && (
              <p className="text-sm text-destructive">{state.error}</p>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="name">
                Bezeichnung <span className="text-destructive">*</span>
              </Label>
              <Input
                id="name"
                name="name"
                required
                defaultValue={service?.name ?? ""}
                placeholder="z.B. Webentwicklung"
                aria-invalid={!!fe.name}
                aria-describedby={fe.name ? "name-error" : undefined}
              />
              <FieldError id="name-error" message={fe.name} />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="description">Beschreibung</Label>
              <textarea
                id="description"
                name="description"
                defaultValue={service?.description ?? ""}
                rows={3}
                placeholder="Kurze Beschreibung der Leistung"
                className="w-full rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-sm transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 resize-none"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="unit">
                  Einheit <span className="text-destructive">*</span>
                </Label>
                <Select name="unit" defaultValue={service?.unit ?? "Hour"}>
                  <SelectTrigger id="unit" className="w-full">
                    <SelectValue placeholder="Einheit wählen">
                      {(value: string | null) =>
                        value ? (unitOptions.find((o) => o.value === value)?.label ?? value) : "Einheit wählen"
                      }
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {unitOptions.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="unitPrice">
                  Preis (CHF) <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="unitPrice"
                  name="unitPrice"
                  type="number"
                  step="0.01"
                  min="0"
                  required
                  defaultValue={service?.unitPrice ?? ""}
                  placeholder="0.00"
                  aria-invalid={!!fe.unitPrice}
                  aria-describedby={fe.unitPrice ? "unitPrice-error" : undefined}
                />
                <FieldError id="unitPrice-error" message={fe.unitPrice} />
              </div>
            </div>

            {categories.length > 0 && (
              <div className="space-y-1.5">
                <Label htmlFor="categoryId">Kategorie</Label>
                <Select
                  name="categoryId"
                  defaultValue={service?.categoryId?.toString() ?? ""}
                >
                  <SelectTrigger id="categoryId" className="w-full">
                    <SelectValue placeholder="Keine Kategorie">
                      {(value: string | null) =>
                        value
                          ? (categories.find((c) => c.categoryId.toString() === value)?.name ?? value)
                          : "Keine Kategorie"
                      }
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">Keine Kategorie</SelectItem>
                    {categories.map((cat) => (
                      <SelectItem key={cat.categoryId} value={cat.categoryId.toString()}>
                        {cat.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="pt-1">
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  name="isActive"
                  defaultChecked={service?.isActive ?? true}
                  className="h-4 w-4 rounded border-input accent-primary"
                />
                Leistung aktiv
              </label>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" render={<Link href="/services" />}>
                Abbrechen
              </Button>
              <Button type="submit" disabled={isPending}>
                {isPending ? "Speichern…" : "Speichern"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
