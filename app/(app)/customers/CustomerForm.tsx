"use client";

import { useActionState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DatePickerInput } from "@/components/ui/date-picker";
import { createCustomer, updateCustomer, type CustomerFormState } from "./actions";
import type { Customer } from "@prisma/client";

type Props = {
  customer?: Customer;
  readOnly?: boolean;
  cancelHref?: string;
  editHref?: string;
};

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} className="text-xs text-destructive mt-1" role="alert">
      {message}
    </p>
  );
}

export default function CustomerForm({ customer, readOnly = false, cancelHref = "/customers", editHref }: Props) {
  const action = customer
    ? updateCustomer.bind(null, customer.customerId)
    : createCustomer;

  const [state, formAction, isPending] = useActionState<CustomerFormState, FormData>(
    action,
    {}
  );

  const fe = state.fieldErrors ?? {};

  const nextInvoiceDateDefault = customer?.nextInvoiceDate
    ? new Date(customer.nextInvoiceDate).toISOString().split("T")[0]
    : "";

  if (customer && readOnly) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Kundendaten</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3 text-sm">
            {customer.company && (
              <div>
                <dt className="text-muted-foreground">Firma</dt>
                <dd className="font-medium">{customer.company}</dd>
              </div>
            )}
            <div>
              <dt className="text-muted-foreground">Kontaktperson</dt>
              <dd className="font-medium">{customer.contactPerson}</dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-muted-foreground">Adresse</dt>
              <dd className="font-medium">{customer.address}, {customer.zipCode} {customer.city}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">E-Mail</dt>
              <dd className="font-medium">{customer.email}</dd>
            </div>
            {customer.phone && (
              <div>
                <dt className="text-muted-foreground">Telefon</dt>
                <dd className="font-medium">{customer.phone}</dd>
              </div>
            )}
            {customer.nextInvoiceDate && (
              <div>
                <dt className="text-muted-foreground">Nächstes Rechnungsdatum</dt>
                <dd className="font-medium">
                  {new Date(customer.nextInvoiceDate).toLocaleDateString("de-CH")}
                </dd>
              </div>
            )}
            {customer.yearlyInvoice && (
              <div>
                <dt className="text-muted-foreground">Jährliche Rechnung</dt>
                <dd className="font-medium">Ja</dd>
              </div>
            )}
            {customer.contactInsteadOfCompany && (
              <div>
                <dt className="text-muted-foreground">Anzeige</dt>
                <dd className="font-medium">Kontaktperson statt Firma</dd>
              </div>
            )}
          </dl>
          {editHref && (
            <div className="flex justify-start pt-4 border-t mt-4">
              <Button size="sm" render={<Link href={editHref} />}>
                Bearbeiten
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {!customer && (
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold">Neuer Kunde</h1>
          <Button variant="outline" render={<Link href={cancelHref} />}>
            Abbrechen
          </Button>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Kundendaten</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={formAction} className="space-y-4">
            {state.error && !state.fieldErrors && (
              <p className="text-sm text-destructive">{state.error}</p>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="company">Firma</Label>
                <Input
                  id="company"
                  name="company"
                  defaultValue={customer?.company ?? ""}
                  placeholder="Firma AG"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="contactPerson">
                  Kontaktperson <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="contactPerson"
                  name="contactPerson"
                  required
                  defaultValue={customer?.contactPerson ?? ""}
                  placeholder="Max Muster"
                  aria-invalid={!!fe.contactPerson}
                  aria-describedby={fe.contactPerson ? "contactPerson-error" : undefined}
                />
                <FieldError id="contactPerson-error" message={fe.contactPerson} />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="address">
                Adresse <span className="text-destructive">*</span>
              </Label>
              <Input
                id="address"
                name="address"
                required
                defaultValue={customer?.address ?? ""}
                placeholder="Musterstrasse 1"
                aria-invalid={!!fe.address}
                aria-describedby={fe.address ? "address-error" : undefined}
              />
              <FieldError id="address-error" message={fe.address} />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="zipCode">
                  PLZ <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="zipCode"
                  name="zipCode"
                  required
                  defaultValue={customer?.zipCode ?? ""}
                  placeholder="8000"
                  aria-invalid={!!fe.zipCode}
                  aria-describedby={fe.zipCode ? "zipCode-error" : undefined}
                />
                <FieldError id="zipCode-error" message={fe.zipCode} />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="city">
                  Ort <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="city"
                  name="city"
                  required
                  defaultValue={customer?.city ?? ""}
                  placeholder="Zürich"
                  aria-invalid={!!fe.city}
                  aria-describedby={fe.city ? "city-error" : undefined}
                />
                <FieldError id="city-error" message={fe.city} />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="email">
                  E-Mail <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="email"
                  name="email"
                  type="email"
                  required
                  defaultValue={customer?.email ?? ""}
                  placeholder="info@beispiel.ch"
                  aria-invalid={!!fe.email}
                  aria-describedby={fe.email ? "email-error" : undefined}
                />
                <FieldError id="email-error" message={fe.email} />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="phone">Telefon</Label>
                <Input
                  id="phone"
                  name="phone"
                  type="tel"
                  defaultValue={customer?.phone ?? ""}
                  placeholder="+41 44 000 00 00"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="nextInvoiceDate">Nächstes Rechnungsdatum</Label>
              <DatePickerInput
                id="nextInvoiceDate"
                name="nextInvoiceDate"
                defaultValue={nextInvoiceDateDefault}
              />
            </div>

            <div className="flex flex-col gap-3 pt-1">
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  name="yearlyInvoice"
                  defaultChecked={customer?.yearlyInvoice ?? false}
                  className="h-4 w-4 rounded border-input accent-primary"
                />
                Jährliche Rechnung
              </label>

              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  name="contactInsteadOfCompany"
                  defaultChecked={customer?.contactInsteadOfCompany ?? false}
                  className="h-4 w-4 rounded border-input accent-primary"
                />
                Kontaktperson statt Firma anzeigen
              </label>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" render={<Link href={cancelHref} />}>
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
