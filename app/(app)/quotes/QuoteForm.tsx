"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CustomerCombobox } from "@/components/customer-combobox";
import ItemsEditor, { type ItemData } from "@/components/items-editor";
import { DatePickerInput } from "@/components/ui/date-picker";
import { addDays } from "@/lib/date";
import { createQuote, updateQuote, type QuoteFormState } from "./actions";
import type { Category, Customer, Quote, Item, Service } from "@prisma/client";

type SerializedItem = Omit<Item, "unitPrice" | "quantity" | "totalAmount"> & {
  unitPrice: number; quantity: number; totalAmount: number;
};
type SerializedQuote = Omit<Quote, "totalAmount"> & {
  totalAmount: number; items: SerializedItem[];
};

type SerializedService = Omit<Service, "unitPrice"> & { unitPrice: number };

type Props = {
  customers: Customer[];
  services: SerializedService[];
  categories: Category[];
  defaultQuoteValidityDays: number;
  quote?: SerializedQuote;
  defaultCustomerId?: number;
  from?: string;
};

function toItemData(item: SerializedItem): ItemData {
  return {
    name: item.name,
    description: item.description ?? "",
    unit: item.unit,
    unitPrice: item.unitPrice,
    quantity: item.quantity,
    discountPercent: Number(item.discountPercent ?? 0),
    totalAmount: item.totalAmount,
    customText: item.customText ?? "",
    categoryId: item.categoryId,
  };
}

export default function QuoteForm({
  customers,
  services,
  categories,
  defaultQuoteValidityDays,
  quote,
  defaultCustomerId,
  from,
}: Props) {
  const action = quote ? updateQuote.bind(null, quote.id) : createQuote;

  const cancelHref = quote
    ? `/quotes/${quote.id}${from ? `?from=${from}` : ""}`
    : "/quotes";

  const [state, formAction, isPending] = useActionState<QuoteFormState, FormData>(
    action,
    {}
  );

  const today = new Date().toISOString().split("T")[0];
  const defaultDate = quote
    ? new Date(quote.date).toISOString().split("T")[0]
    : today;
  const defaultValidUntil = quote
    ? new Date(quote.validUntil).toISOString().split("T")[0]
    : (() => {
        const d = new Date();
        d.setDate(d.getDate() + defaultQuoteValidityDays);
        return d.toISOString().split("T")[0];
      })();

  const [validUntil, setValidUntil] = useState(defaultValidUntil);

  function handleDateChange(value: string) {
    setValidUntil(addDays(value, defaultQuoteValidityDays));
  }

  const defaultCustomer =
    customers.find((c) => c.customerId === (quote?.customerId ?? defaultCustomerId)) ?? null;

  const initialItems = quote ? quote.items.map(toItemData) : [];

  return (
    <div className="max-w-3xl space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">
          {quote ? `Offerte ${quote.documentNumber}` : "Neue Offerte"}
        </h1>
        <Button variant="outline" render={<Link href={cancelHref} />}>
          Abbrechen
        </Button>
      </div>

      <form action={formAction} className="space-y-4">
        {from && <input type="hidden" name="from" value={from} />}
        {state.error && (
          <p className="text-sm text-destructive">{state.error}</p>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Offertendaten</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="customerId">
                Kunde <span className="text-destructive">*</span>
              </Label>
              <CustomerCombobox
                id="customerId"
                name="customerId"
                customers={customers}
                defaultValue={defaultCustomer}
                required
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="date">
                  Datum <span className="text-destructive">*</span>
                </Label>
                <DatePickerInput
                  id="date"
                  name="date"
                  defaultValue={defaultDate}
                  onChange={handleDateChange}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="validUntil">
                  Gültig bis <span className="text-destructive">*</span>
                </Label>
                <DatePickerInput
                  id="validUntil"
                  name="validUntil"
                  value={validUntil}
                  onChange={setValidUntil}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="customUserText">Zusatztext</Label>
              <textarea
                id="customUserText"
                name="customUserText"
                defaultValue={quote?.customUserText ?? ""}
                rows={3}
                placeholder="Optionaler Text für die Offerte…"
                className="w-full rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-sm transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 resize-none"
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Positionen</CardTitle>
          </CardHeader>
          <CardContent>
            <ItemsEditor services={services} categories={categories} initialItems={initialItems} />
          </CardContent>
        </Card>

        <div className="flex justify-end gap-2">
          <Button variant="outline" render={<Link href={cancelHref} />}>
            Abbrechen
          </Button>
          <Button type="submit" disabled={isPending}>
            {isPending ? "Speichern…" : "Speichern"}
          </Button>
        </div>
      </form>
    </div>
  );
}
