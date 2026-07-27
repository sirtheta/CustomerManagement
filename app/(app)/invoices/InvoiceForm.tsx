"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CustomerCombobox } from "@/components/customer-combobox";
import ItemsEditor, { type ItemData } from "@/components/items-editor";
import { DatePickerInput } from "@/components/ui/date-picker";
import { addDays } from "@/lib/date";
import { createInvoice, updateInvoice, type InvoiceFormState } from "./actions";
import type { Customer, Invoice, Item, Service, Unit } from "@prisma/client";

type SerializedItem = Omit<Item, "unitPrice" | "quantity" | "totalAmount"> & {
  unitPrice: number; quantity: number; totalAmount: number;
};
type SerializedInvoice = Omit<Invoice, "totalAmount"> & {
  totalAmount: number; items: SerializedItem[];
};

type SerializedService = Omit<Service, "unitPrice"> & { unitPrice: number };

type SerializedTemplateItem = {
  id: number;
  templateId: number;
  name: string;
  description: string | null;
  unit: Unit;
  unitPrice: number;
  quantity: number;
  categoryId: number | null;
};

type SerializedTemplate = {
  id: number;
  name: string;
  items: SerializedTemplateItem[];
};

type Props = {
  customers: Customer[];
  services: SerializedService[];
  defaultPaymentTermDays: number;
  invoice?: SerializedInvoice;
  templates?: SerializedTemplate[];
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
    totalAmount: item.totalAmount,
    customText: item.customText ?? "",
    categoryId: item.categoryId,
  };
}

export default function InvoiceForm({
  customers,
  services,
  defaultPaymentTermDays,
  invoice,
  templates = [],
  defaultCustomerId,
  from,
}: Props) {
  const action = invoice
    ? updateInvoice.bind(null, invoice.id)
    : createInvoice;

  const cancelHref = invoice
    ? `/invoices/${invoice.id}${from ? `?from=${from}` : ""}`
    : "/invoices";

  const [state, formAction, isPending] = useActionState<InvoiceFormState, FormData>(
    action,
    {}
  );

  const today = new Date().toISOString().split("T")[0];
  const defaultDate = invoice
    ? new Date(invoice.date).toISOString().split("T")[0]
    : today;
  const defaultDueDate = invoice
    ? new Date(invoice.dueDate).toISOString().split("T")[0]
    : (() => {
        const d = new Date();
        d.setDate(d.getDate() + defaultPaymentTermDays);
        return d.toISOString().split("T")[0];
      })();

  const [dueDate, setDueDate] = useState(defaultDueDate);

  function handleDateChange(value: string) {
    setDueDate(addDays(value, defaultPaymentTermDays));
  }

  const defaultCustomer =
    customers.find((c) => c.customerId === (invoice?.customerId ?? defaultCustomerId)) ?? null;

  const initialItems = invoice ? invoice.items.map(toItemData) : [];
  const [templateKey, setTemplateKey] = useState(0);
  const [currentItems, setCurrentItems] = useState<ItemData[]>(initialItems);

  function handleTemplateLoad(templateId: string | null) {
    if (!templateId) return;
    const tpl = templates.find((t) => t.id.toString() === templateId);
    if (!tpl) return;
    setCurrentItems(
      tpl.items.map((item) => ({
        name: item.name,
        description: item.description ?? "",
        unit: item.unit,
        unitPrice: item.unitPrice,
        quantity: item.quantity,
        totalAmount: item.unitPrice * item.quantity,
        customText: "",
        categoryId: item.categoryId,
      }))
    );
    setTemplateKey((k) => k + 1);
  }

  return (
    <div className="max-w-3xl space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">
          {invoice ? `Rechnung ${invoice.documentNumber}` : "Neue Rechnung"}
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
            <CardTitle>Rechnungsdaten</CardTitle>
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
                <Label htmlFor="dueDate">
                  Fälligkeitsdatum <span className="text-destructive">*</span>
                </Label>
                <DatePickerInput
                  id="dueDate"
                  name="dueDate"
                  value={dueDate}
                  onChange={setDueDate}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="customUserText">Zusatztext</Label>
              <textarea
                id="customUserText"
                name="customUserText"
                defaultValue={invoice?.customUserText ?? ""}
                rows={3}
                placeholder="Optionaler Text für die Rechnung…"
                className="w-full rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-sm transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 resize-none"
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Positionen</CardTitle>
              {templates.length > 0 && !invoice && (
                <Select onValueChange={handleTemplateLoad}>
                  <SelectTrigger className="w-48 h-7 text-xs">
                    <SelectValue placeholder="Vorlage laden…" />
                  </SelectTrigger>
                  <SelectContent>
                    {templates.map((t) => (
                      <SelectItem key={t.id} value={t.id.toString()}>
                        {t.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          </CardHeader>
          <CardContent>
            <ItemsEditor key={templateKey} services={services} initialItems={currentItems} />
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
