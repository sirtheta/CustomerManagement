"use client";

import { useActionState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { createCustomer, updateCustomer, type CustomerFormState } from "./actions";
import type { Customer } from "@prisma/client";
import { ADDRESS_LIMITS, COUNTRIES, countryName, formatCityLine, formatStreetLine } from "@/lib/address";

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

function ReviewNotice() {
  return (
    <p
      role="status"
      className="mt-1 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100"
    >
      Die Adresse wurde automatisch in Strasse und Hausnummer aufgeteilt. Bitte prüfen und
      speichern — die QR-Rechnung verlangt getrennte Felder.
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
              <dd className="font-medium">
                {formatStreetLine(customer.street, customer.houseNumber)},{" "}
                {formatCityLine(customer.zipCode, customer.city)}
                {customer.country !== "CH" && `, ${countryName(customer.country)}`}
              </dd>
              {customer.addressNeedsReview && <ReviewNotice />}
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

            {customer?.addressNeedsReview && <ReviewNotice />}

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="street">
                  Strasse <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="street"
                  name="street"
                  required
                  maxLength={ADDRESS_LIMITS.street}
                  defaultValue={customer?.street ?? ""}
                  placeholder="Musterstrasse"
                  aria-invalid={!!fe.street}
                  aria-describedby={fe.street ? "street-error" : undefined}
                />
                <FieldError id="street-error" message={fe.street} />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="houseNumber">Hausnummer</Label>
                <Input
                  id="houseNumber"
                  name="houseNumber"
                  maxLength={ADDRESS_LIMITS.houseNumber}
                  defaultValue={customer?.houseNumber ?? ""}
                  placeholder="1"
                  aria-invalid={!!fe.houseNumber}
                  aria-describedby={fe.houseNumber ? "houseNumber-error" : undefined}
                />
                <FieldError id="houseNumber-error" message={fe.houseNumber} />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
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

              <div className="space-y-1.5">
                <Label htmlFor="country">Land</Label>
                <select
                  id="country"
                  name="country"
                  defaultValue={customer?.country ?? "CH"}
                  className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm"
                >
                  {Object.entries(COUNTRIES).map(([code, name]) => (
                    <option key={code} value={code}>
                      {name}
                    </option>
                  ))}
                  {customer?.country && !(customer.country in COUNTRIES) && (
                    <option value={customer.country}>{customer.country}</option>
                  )}
                </select>
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

            <div className="flex flex-col gap-3 pt-1">
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
