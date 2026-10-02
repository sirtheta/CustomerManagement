"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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

export default function CustomerForm({ customer, readOnly = false, cancelHref = "/customers", editHref }: Props) {
  const action = customer
    ? updateCustomer.bind(null, customer.customerId)
    : createCustomer;

  const [state, formAction, isPending] = useActionState<CustomerFormState, FormData>(
    action,
    {}
  );
  // Every action result refills the inputs through new defaultValues; Base UI warns when the default of
  // a mounted input changes, so the form is remounted per result (like the country Selects below).
  const [seenState, setSeenState] = useState(state);
  const [formKey, setFormKey] = useState(0);
  if (seenState !== state) {
    setSeenState(state);
    setFormKey((k) => k + 1);
  }

  const fe = state.fieldErrors ?? {};
  // After a failed submit the action returns what was typed; React resets the form
  // to its defaultValues, so those must come from the submitted values.
  const submitted = state.values;
  const val = (name: string, fallback: string | number | null | undefined) =>
    submitted ? (submitted[name] ?? "") : (fallback ?? "");

  // "Weitere Angaben" stays open when it holds values or errors, and keeps what the user chose across the
  // remount after a failed save (the state lives above the keyed form).
  const [moreOpen, setMoreOpen] = useState<boolean | null>(null);
  const moreHasValues = [
    val("uid", customer?.uid),
    val("paymentTermDays", customer?.paymentTermDays),
    val("billingName", customer?.billingName),
    val("billingStreet", customer?.billingStreet),
    val("billingZipCode", customer?.billingZipCode),
    val("billingCity", customer?.billingCity),
    val("billingEmail", customer?.billingEmail),
    val("customerNumber", null),
  ].some((v) => String(v).trim() !== "");
  const moreHasErrors = Object.keys(fe).some(
    (k) => k === "customerNumber" || k === "uid" || k === "paymentTermDays" || k.startsWith("billing")
  );

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
            {customer.customerNumber != null && (
              <div>
                <dt className="text-muted-foreground">Kunden-Nr.</dt>
                <dd className="font-medium">{customer.customerNumber}</dd>
              </div>
            )}
            {customer.uid && (
              <div>
                <dt className="text-muted-foreground">UID</dt>
                <dd className="font-medium">{customer.uid}</dd>
              </div>
            )}
            {customer.paymentTermDays != null && (
              <div>
                <dt className="text-muted-foreground">Zahlungsfrist</dt>
                <dd className="font-medium">{customer.paymentTermDays} Tage</dd>
              </div>
            )}
            {customer.billingStreet && (
              <div className="sm:col-span-2">
                <dt className="text-muted-foreground">Rechnungsadresse</dt>
                <dd className="font-medium">
                  {[customer.billingName, formatStreetLine(customer.billingStreet, customer.billingHouseNumber), formatCityLine(customer.billingZipCode, customer.billingCity)]
                    .filter(Boolean)
                    .join(", ")}
                  {customer.billingCountry && customer.billingCountry !== "CH" && `, ${countryName(customer.billingCountry)}`}
                </dd>
              </div>
            )}
            {customer.billingEmail && (
              <div>
                <dt className="text-muted-foreground">Rechnungs-E-Mail</dt>
                <dd className="font-medium">{customer.billingEmail}</dd>
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
          <form key={formKey} action={formAction} className="space-y-4">
            {state.error && !state.fieldErrors && (
              <p className="text-sm text-destructive">{state.error}</p>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="company">Firma</Label>
                <Input
                  id="company"
                  name="company"
                  defaultValue={val("company", customer?.company)}
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
                  defaultValue={val("contactPerson", customer?.contactPerson)}
                  placeholder="Max Muster"
                  aria-invalid={!!fe.contactPerson}
                  aria-describedby={fe.contactPerson ? "contactPerson-error" : undefined}
                />
                <FieldError id="contactPerson-error" message={fe.contactPerson} />
              </div>
            </div>

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
                  defaultValue={val("street", customer?.street)}
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
                  defaultValue={val("houseNumber", customer?.houseNumber)}
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
                  defaultValue={val("zipCode", customer?.zipCode)}
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
                  defaultValue={val("city", customer?.city)}
                  placeholder="Zürich"
                  aria-invalid={!!fe.city}
                  aria-describedby={fe.city ? "city-error" : undefined}
                />
                <FieldError id="city-error" message={fe.city} />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="country">Land</Label>
                {/* key re-mounts the uncontrolled Select with the submitted value after an error round trip */}
                <Select key={submitted ? `country-${submitted.country ?? ""}` : "country-initial"} name="country" defaultValue={submitted?.country ?? customer?.country ?? "CH"}>
                  <SelectTrigger id="country" className="w-full">
                    <SelectValue>
                      {(value: string | null) =>
                        value ? ((COUNTRIES as Record<string, string>)[value] ?? value) : ""
                      }
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(COUNTRIES).map(([code, name]) => (
                      <SelectItem key={code} value={code}>
                        {name}
                      </SelectItem>
                    ))}
                    {customer?.country && !(customer.country in COUNTRIES) && (
                      <SelectItem value={customer.country}>{customer.country}</SelectItem>
                    )}
                  </SelectContent>
                </Select>
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
                  defaultValue={val("email", customer?.email)}
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
                  defaultValue={val("phone", customer?.phone)}
                  placeholder="+41 44 000 00 00"
                />
              </div>
            </div>

            <div className="flex flex-col gap-3 pt-1">
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  name="contactInsteadOfCompany"
                  defaultChecked={submitted ? submitted.contactInsteadOfCompany === "on" : (customer?.contactInsteadOfCompany ?? false)}
                  className="h-4 w-4 rounded border-input accent-primary"
                />
                Kontaktperson statt Firma anzeigen
              </label>
            </div>

            <details
              className="rounded-lg border border-input px-3 py-2"
              open={moreHasErrors || (moreOpen ?? moreHasValues)}
              onToggle={(e) => setMoreOpen(e.currentTarget.open)}
            >
              <summary className="cursor-pointer text-sm font-medium">Weitere Angaben</summary>
              <div className="space-y-4 pt-3">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="customerNumber">Kundennummer</Label>
                    {customer ? (
                      // Fixed after creation (archived PDFs carry it): shown, never submitted.
                      <Input
                        id="customerNumber"
                        inputMode="numeric"
                        value={customer.customerNumber ?? ""}
                        placeholder="keine Nummer vergeben"
                        disabled
                        readOnly
                      />
                    ) : (
                      <Input
                        id="customerNumber"
                        name="customerNumber"
                        inputMode="numeric"
                        defaultValue={val("customerNumber", null)}
                        placeholder="wird automatisch vergeben"
                        aria-invalid={!!fe.customerNumber}
                        aria-describedby={fe.customerNumber ? "customerNumber-error" : undefined}
                      />
                    )}
                    {customer != null && (
                      <p className="text-xs text-muted-foreground">Nach dem Anlegen nicht änderbar.</p>
                    )}
                    <FieldError id="customerNumber-error" message={fe.customerNumber} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="uid">UID</Label>
                    <Input
                      id="uid"
                      name="uid"
                      defaultValue={val("uid", customer?.uid)}
                      placeholder="CHE-123.456.789"
                      aria-invalid={!!fe.uid}
                      aria-describedby={fe.uid ? "uid-error" : undefined}
                    />
                    <FieldError id="uid-error" message={fe.uid} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="paymentTermDays">Zahlungsfrist (Tage)</Label>
                    <Input
                      id="paymentTermDays"
                      name="paymentTermDays"
                      inputMode="numeric"
                      defaultValue={val("paymentTermDays", customer?.paymentTermDays)}
                      placeholder="Standard"
                      aria-invalid={!!fe.paymentTermDays}
                      aria-describedby={fe.paymentTermDays ? "paymentTermDays-error" : undefined}
                    />
                    <FieldError id="paymentTermDays-error" message={fe.paymentTermDays} />
                  </div>
                </div>

                <p className="text-xs text-muted-foreground">
                  Abweichende Rechnungsadresse: Rechnungen, Mahnungen und die QR-Rechnung gehen an diese Adresse
                  (Strasse, PLZ und Ort zusammen ausfüllen). Offerten verwenden immer die Kundenadresse.
                </p>
                <div className="space-y-1.5">
                  <Label htmlFor="billingName">Name auf der Rechnung</Label>
                  <Input
                    id="billingName"
                    name="billingName"
                    maxLength={70}
                    defaultValue={val("billingName", customer?.billingName)}
                    placeholder="Firma AG, Kreditorenbuchhaltung"
                  />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div className="space-y-1.5 sm:col-span-2">
                    <Label htmlFor="billingStreet">Strasse</Label>
                    <Input
                      id="billingStreet"
                      name="billingStreet"
                      maxLength={ADDRESS_LIMITS.street}
                      defaultValue={val("billingStreet", customer?.billingStreet)}
                      aria-invalid={!!fe.billingStreet}
                      aria-describedby={fe.billingStreet ? "billingStreet-error" : undefined}
                    />
                    <FieldError id="billingStreet-error" message={fe.billingStreet} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="billingHouseNumber">Hausnummer</Label>
                    <Input
                      id="billingHouseNumber"
                      name="billingHouseNumber"
                      maxLength={ADDRESS_LIMITS.houseNumber}
                      defaultValue={val("billingHouseNumber", customer?.billingHouseNumber)}
                    />
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="billingZipCode">PLZ</Label>
                    <Input
                      id="billingZipCode"
                      name="billingZipCode"
                      maxLength={ADDRESS_LIMITS.zip}
                      defaultValue={val("billingZipCode", customer?.billingZipCode)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="billingCity">Ort</Label>
                    <Input
                      id="billingCity"
                      name="billingCity"
                      maxLength={ADDRESS_LIMITS.city}
                      defaultValue={val("billingCity", customer?.billingCity)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="billingCountry">Land</Label>
                    {/* key re-mounts the uncontrolled Select with the submitted value after an error round trip */}
                    <Select key={submitted ? `billingCountry-${submitted.billingCountry ?? ""}` : "billingCountry-initial"} name="billingCountry" defaultValue={submitted?.billingCountry ?? customer?.billingCountry ?? "CH"}>
                      <SelectTrigger id="billingCountry" className="w-full">
                        <SelectValue>
                          {(value: string | null) =>
                            value ? ((COUNTRIES as Record<string, string>)[value] ?? value) : ""
                          }
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {Object.entries(COUNTRIES).map(([code, name]) => (
                          <SelectItem key={code} value={code}>
                            {name}
                          </SelectItem>
                        ))}
                        {customer?.billingCountry && !(customer.billingCountry in COUNTRIES) && (
                          <SelectItem value={customer.billingCountry}>{customer.billingCountry}</SelectItem>
                        )}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="space-y-1.5 sm:max-w-sm">
                  <Label htmlFor="billingEmail">Rechnungs-E-Mail</Label>
                  <Input
                    id="billingEmail"
                    name="billingEmail"
                    type="email"
                    defaultValue={val("billingEmail", customer?.billingEmail)}
                    placeholder="buchhaltung@beispiel.ch"
                    aria-invalid={!!fe.billingEmail}
                    aria-describedby={fe.billingEmail ? "billingEmail-error" : undefined}
                  />
                  <FieldError id="billingEmail-error" message={fe.billingEmail} />
                </div>
              </div>
            </details>

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
