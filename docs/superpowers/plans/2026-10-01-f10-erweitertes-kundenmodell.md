# F10 Erweitertes Kundenmodell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Kunden bekommen Kundennummer, UID, abweichende Rechnungsadresse und -E-Mail, eine eigene Zahlungsfrist und mehrere Kontakte; ohne Eingabe verhält sich alles wie bisher.

**Architecture:** Neue optionale Spalten auf `Customer` plus Tabelle `CustomerContact`. Zwei kleine, reine Module (`lib/customer-uid.ts`, `lib/customer-billing.ts`) kapseln UID-Prüfung, Empfängerauflösung (Rechnungsadresse vs. Kundenadresse), Rechnungs-E-Mail und Zahlungsfrist; alle bisherigen Direktzugriffe auf `customer.email`/Adresse/Frist laufen darüber.

**Tech Stack:** Next.js 16 (Server Actions), Prisma 7 + SQLite (better-sqlite3 Adapter), Zod 4, Vitest, pdfkit/swissqrbill.

**Spec:** `docs/superpowers/specs/2026-10-01-f10-erweitertes-kundenmodell-design.md`

## Global Constraints

- UI-Texte, Fehlermeldungen und Doku sind **auf Deutsch**; Commit-Messages **auf Englisch** (Conventional Commits, z. B. `feat(customers): …`), mit der Zeile `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>` am Ende.
- Alle neuen `Customer`-Spalten sind optional; ohne Eingabe bleibt das Verhalten unverändert (Rechnung an Kundenadresse und `customer.email`, globale Zahlungsfrist).
- Angebote gehen immer an die Kundenadresse und `customer.email` (nie an die Rechnungsadresse/-E-Mail), zeigen keine UID, aber „Kunden-Nr.“. Rechnungen, Gutschriften und Mahnbelege (`RenderDoc.kind` `"invoice"` und `"reminder"`, seit F8 in `lib/pdf/reminder-pdf.ts`) verwenden `billingRecipient`; nur `kind === "quote"` verwendet `customerRecipient`.
- Keine neue Migration: SQL wird ans **Ende** von `prisma/migrations/20261001120000_invoicing_and_banking/migration.sql` angehängt (die Migration steckt in keinem Release-Tag; F8 hat dort bereits den Block „F8: dunning fees, interest …“ angehängt, der F10-Block kommt dahinter). Lokale Dev-DBs müssen danach zurückgesetzt werden.
- Nie `logAudit`/`logAuditEntry` innerhalb eines `$transaction`-Callbacks aufrufen; nie direkt `prisma.auditLog.create`.
- Prisma-Schema ist die einzige Quelle für das Datenmodell; Tests bauen die DB per `prisma db push` aus dem Schema (`tests/test-utils.ts`).
- Next.js 16: vor Änderungen an Routing/Data-Fetching `node_modules/next/dist/docs/` prüfen (hier nur Server Actions und Server-Komponenten nach bestehendem Muster).

## Dateiübersicht

| Datei | Verantwortung |
|---|---|
| `lib/customer-uid.ts` (neu) | `normalizeUid`, `isValidUid` (Format + Prüfziffer) |
| `lib/customer-billing.ts` (neu) | `hasBillingAddress`, `billingRecipient`, `customerRecipient`, `billingEmail`, `effectivePaymentTermDays` |
| `lib/customer-number.ts` (neu) | `nextCustomerNumber(db)` |
| `prisma/schema.prisma` | neue `Customer`-Felder, Modell `CustomerContact` |
| `prisma/migrations/20261001120000_invoicing_and_banking/migration.sql` | angehängtes SQL |
| `app/(app)/customers/actions.ts` | Formular lesen, validieren, speichern (neue Felder) |
| `app/(app)/customers/contact-actions.ts` (neu) | CRUD für `CustomerContact` |
| `app/(app)/customers/ContactsSection.tsx` (neu) | UI-Karte „Kontakte“ |
| `app/(app)/customers/CustomerForm.tsx`, `customers/[id]/page.tsx`, `customers/page.tsx` | Formular, Detailseite, Liste |
| `lib/pdf/document-pdf.ts`, `lib/pdf/qrbill-helpers.ts`, `lib/receivables.ts` | Empfänger/Zahlungspflichtiger aus `billingRecipient` (Rechnung, Gutschrift und Mahnbeleg; `lib/pdf/reminder-pdf.ts` braucht keine Änderung, es reicht `invoice.customer` an `RenderDoc` und `buildQrBillData` durch) |
| `lib/email.ts`, `lib/subscriptions.ts`, `invoices/[id]/page.tsx`, `invoices/reminders/page.tsx` | Rechnungs-E-Mail |
| `app/(app)/quotes/actions.ts`, `invoices/InvoiceForm.tsx`, `components/customer-combobox.tsx` | kundenspezifische Zahlungsfrist |
| `lib/search.ts`, `app/api/export/customers/route.ts` | Suche nach Kundennummer, Export-Spalten |

---

### Task 1: Reine Helfer für UID und Rechnungsdaten

**Files:**
- Create: `lib/customer-uid.ts`
- Create: `lib/customer-billing.ts`
- Test: `tests/unit/customer-uid.test.ts`
- Test: `tests/unit/customer-billing.test.ts`

**Interfaces:**
- Produces:
  - `normalizeUid(input: string): string | null` — liefert `CHE-123.456.789` oder `null`, wenn das Muster nicht passt.
  - `isValidUid(input: string): boolean` — Muster **und** Prüfziffer.
  - `type BillingFields`, `type AddressCustomer`, `type Recipient`
  - `hasBillingAddress(c: BillingFields): boolean`
  - `billingRecipient(c: AddressCustomer): Recipient`, `customerRecipient(c: AddressCustomer): Recipient`
  - `billingEmail(c: { email: string; billingEmail?: string | null }): string`
  - `effectivePaymentTermDays(c: { paymentTermDays?: number | null } | null | undefined, defaultDays: number): number`

- [ ] **Step 1: Failing test für die UID schreiben**

`tests/unit/customer-uid.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { normalizeUid, isValidUid } from "@/lib/customer-uid";

describe("normalizeUid", () => {
  it("formats loose input", () => {
    expect(normalizeUid("che116281710")).toBe("CHE-116.281.710");
    expect(normalizeUid(" CHE-116.281.710 ")).toBe("CHE-116.281.710");
    expect(normalizeUid("CHE-116.281.710 MWST")).toBe("CHE-116.281.710");
    expect(normalizeUid("CHE116.281.710 TVA")).toBe("CHE-116.281.710");
  });

  it("returns null for anything that is not a UID", () => {
    expect(normalizeUid("")).toBeNull();
    expect(normalizeUid("CHE-12.345.678")).toBeNull();
    expect(normalizeUid("ABC-116.281.710")).toBeNull();
    expect(normalizeUid("CHE-116.281.71X")).toBeNull();
  });
});

describe("isValidUid", () => {
  it("accepts UIDs with a correct check digit", () => {
    expect(isValidUid("CHE-116.281.710")).toBe(true);
    expect(isValidUid("CHE-100.000.006")).toBe(true);
    expect(isValidUid("CHE116281710MWST")).toBe(true);
  });

  it("rejects a wrong check digit", () => {
    expect(isValidUid("CHE-116.281.711")).toBe(false);
    expect(isValidUid("CHE-100.000.007")).toBe(false);
  });

  it("rejects UIDs whose check digit would be 10", () => {
    // 11100000: weighted sum 12 -> remainder 1 -> check digit 10, which no UID can carry
    for (let last = 0; last <= 9; last++) {
      expect(isValidUid(`CHE-111.000.00${last}`)).toBe(false);
    }
  });

  it("rejects malformed input", () => {
    expect(isValidUid("")).toBe(false);
    expect(isValidUid("CHE-123")).toBe(false);
  });
});
```

Hinweis zu den Testwerten: Gewichte 5,4,3,2,7,6,5,4 auf die ersten acht Ziffern; Summe mod 11 = `r`; Prüfziffer = `11 - r` (bei `r = 0` → 0, bei Ergebnis 10 ungültig). `10000000`: Summe 5 → Prüfziffer 6 (`CHE-100.000.006`). `11628171`: Summe 132 → `r = 0` → Prüfziffer 0 (`CHE-116.281.710`). `11100000`: Summe 12 → `r = 1` → Prüfziffer 10, also nie gültig.

- [ ] **Step 2: Test laufen lassen, Fehlschlag prüfen**

Run: `npx vitest run tests/unit/customer-uid.test.ts`
Expected: FAIL (`Cannot find module '@/lib/customer-uid'`).

- [ ] **Step 3: `lib/customer-uid.ts` implementieren**

```ts
// Swiss enterprise identification number (UID): CHE-123.456.789, optionally
// followed by a VAT suffix (MWST / TVA / IVA). The last digit is a modulo-11
// check digit over the first eight digits.
const UID_PATTERN = /^CHE-?(\d{3})\.?(\d{3})\.?(\d{3})(?:\s*(?:MWST|TVA|IVA))?$/;

export function normalizeUid(input: string): string | null {
  const match = UID_PATTERN.exec(input.trim().toUpperCase());
  if (!match) return null;
  return `CHE-${match[1]}.${match[2]}.${match[3]}`;
}

const WEIGHTS = [5, 4, 3, 2, 7, 6, 5, 4];

export function isValidUid(input: string): boolean {
  const normalized = normalizeUid(input);
  if (!normalized) return false;
  const digits = normalized.replace(/\D/g, "");
  const sum = WEIGHTS.reduce((acc, weight, i) => acc + weight * Number(digits[i]), 0);
  const check = 11 - (sum % 11);
  if (check === 10) return false;
  return (check === 11 ? 0 : check) === Number(digits[8]);
}
```

- [ ] **Step 4: Test laufen lassen**

Run: `npx vitest run tests/unit/customer-uid.test.ts`
Expected: PASS. Schlägt der Fall `CHE-100.000.007` oder `…006` fehl, die Gewichte/Formel gegen den Hinweis in Step 1 prüfen, nicht die Testwerte anpassen.

- [ ] **Step 5: Failing test für `customer-billing` schreiben**

`tests/unit/customer-billing.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  hasBillingAddress,
  billingRecipient,
  customerRecipient,
  billingEmail,
  effectivePaymentTermDays,
} from "@/lib/customer-billing";

const base = {
  contactInsteadOfCompany: false,
  company: "Muster AG",
  contactPerson: "Anna Beispiel",
  street: "Weg",
  houseNumber: "1",
  zipCode: "8000",
  city: "Zürich",
  country: "CH",
  email: "anna@muster.ch",
};

const withBilling = {
  ...base,
  uid: "CHE-116.281.710",
  billingName: "Muster AG, Buchhaltung",
  billingStreet: "Postfach",
  billingHouseNumber: null,
  billingZipCode: "3000",
  billingCity: "Bern",
  billingCountry: "CH",
  billingEmail: "buchhaltung@muster.ch",
};

describe("hasBillingAddress", () => {
  it("needs street, zip and city", () => {
    expect(hasBillingAddress(withBilling)).toBe(true);
    expect(hasBillingAddress({ ...withBilling, billingCity: null })).toBe(false);
    expect(hasBillingAddress({ billingName: "Nur Name" })).toBe(false);
    expect(hasBillingAddress({})).toBe(false);
  });
});

describe("billingRecipient", () => {
  it("falls back to the customer address", () => {
    expect(billingRecipient(base)).toEqual({
      name: "Muster AG",
      contactLine: "Anna Beispiel",
      street: "Weg",
      houseNumber: "1",
      zipCode: "8000",
      city: "Zürich",
      country: "CH",
      uid: null,
    });
  });

  it("uses the billing address and keeps the UID", () => {
    expect(billingRecipient(withBilling)).toEqual({
      name: "Muster AG, Buchhaltung",
      contactLine: null,
      street: "Postfach",
      houseNumber: null,
      zipCode: "3000",
      city: "Bern",
      country: "CH",
      uid: "CHE-116.281.710",
    });
  });

  it("uses the display name when the billing address has no name", () => {
    const r = billingRecipient({ ...withBilling, billingName: null });
    expect(r.name).toBe("Muster AG");
    expect(r.street).toBe("Postfach");
  });

  it("shows the UID even without a billing address", () => {
    expect(billingRecipient({ ...base, uid: "CHE-116.281.710" }).uid).toBe("CHE-116.281.710");
  });

  it("uses the contact person when contactInsteadOfCompany is set", () => {
    const r = billingRecipient({ ...base, contactInsteadOfCompany: true });
    expect(r.name).toBe("Anna Beispiel");
    expect(r.contactLine).toBeNull();
  });

  it("defaults a missing billing country to CH", () => {
    expect(billingRecipient({ ...withBilling, billingCountry: null }).country).toBe("CH");
  });
});

describe("customerRecipient", () => {
  it("ignores billing data and UID", () => {
    const r = customerRecipient(withBilling);
    expect(r.street).toBe("Weg");
    expect(r.zipCode).toBe("8000");
    expect(r.uid).toBeNull();
  });
});

describe("billingEmail", () => {
  it("prefers the billing e-mail", () => {
    expect(billingEmail({ email: "a@x.ch", billingEmail: "b@x.ch" })).toBe("b@x.ch");
    expect(billingEmail({ email: "a@x.ch", billingEmail: null })).toBe("a@x.ch");
    expect(billingEmail({ email: "a@x.ch" })).toBe("a@x.ch");
    expect(billingEmail({ email: "a@x.ch", billingEmail: "  " })).toBe("a@x.ch");
  });
});

describe("effectivePaymentTermDays", () => {
  it("uses the customer term, else the default", () => {
    expect(effectivePaymentTermDays({ paymentTermDays: 10 }, 30)).toBe(10);
    expect(effectivePaymentTermDays({ paymentTermDays: null }, 30)).toBe(30);
    expect(effectivePaymentTermDays({}, 30)).toBe(30);
    expect(effectivePaymentTermDays(null, 30)).toBe(30);
    expect(effectivePaymentTermDays(undefined, 30)).toBe(30);
  });
});
```

- [ ] **Step 6: Test laufen lassen, Fehlschlag prüfen**

Run: `npx vitest run tests/unit/customer-billing.test.ts`
Expected: FAIL (`Cannot find module '@/lib/customer-billing'`).

- [ ] **Step 7: `lib/customer-billing.ts` implementieren**

```ts
import { customerDisplayName } from "@/lib/customer-display";

/** Optional F10 fields; all may be absent on partial customer objects (tests, previews). */
export type BillingFields = {
  customerNumber?: number | null;
  uid?: string | null;
  billingName?: string | null;
  billingStreet?: string | null;
  billingHouseNumber?: string | null;
  billingZipCode?: string | null;
  billingCity?: string | null;
  billingCountry?: string | null;
  billingEmail?: string | null;
  paymentTermDays?: number | null;
};

export type AddressCustomer = {
  contactInsteadOfCompany: boolean;
  company?: string | null;
  contactPerson: string;
  street: string;
  houseNumber?: string | null;
  zipCode: string;
  city: string;
  country?: string | null;
} & BillingFields;

export type Recipient = {
  name: string;
  /** Second line (contact person under the company name); null when not shown. */
  contactLine: string | null;
  street: string;
  houseNumber: string | null;
  zipCode: string;
  city: string;
  country: string;
  uid: string | null;
};

const filled = (value?: string | null) => !!value?.trim();

/** A billing address counts as set when street, zip and city are all filled in. */
export function hasBillingAddress(c: BillingFields): boolean {
  return filled(c.billingStreet) && filled(c.billingZipCode) && filled(c.billingCity);
}

function ownAddress(c: AddressCustomer, uid: string | null): Recipient {
  return {
    name: customerDisplayName({
      company: c.company ?? null,
      contactPerson: c.contactPerson,
      contactInsteadOfCompany: c.contactInsteadOfCompany,
    }),
    contactLine: !c.contactInsteadOfCompany && c.company ? c.contactPerson : null,
    street: c.street,
    houseNumber: c.houseNumber ?? null,
    zipCode: c.zipCode,
    city: c.city,
    country: c.country || "CH",
    uid,
  };
}

/** Recipient of invoices and reminders: the billing address if set, else the customer address. */
export function billingRecipient(c: AddressCustomer): Recipient {
  const uid = c.uid ?? null;
  if (!hasBillingAddress(c)) return ownAddress(c, uid);
  const own = ownAddress(c, uid);
  return {
    name: filled(c.billingName) ? c.billingName!.trim() : own.name,
    contactLine: null,
    street: c.billingStreet!.trim(),
    houseNumber: filled(c.billingHouseNumber) ? c.billingHouseNumber!.trim() : null,
    zipCode: c.billingZipCode!.trim(),
    city: c.billingCity!.trim(),
    country: c.billingCountry || "CH",
    uid,
  };
}

/** Recipient of quotes: always the customer address, never the UID. */
export function customerRecipient(c: AddressCustomer): Recipient {
  return ownAddress(c, null);
}

export function billingEmail(c: { email: string; billingEmail?: string | null }): string {
  return filled(c.billingEmail) ? c.billingEmail!.trim() : c.email;
}

export function effectivePaymentTermDays(
  c: { paymentTermDays?: number | null } | null | undefined,
  defaultDays: number
): number {
  return c?.paymentTermDays ?? defaultDays;
}
```

- [ ] **Step 8: Tests laufen lassen**

Run: `npx vitest run tests/unit/customer-uid.test.ts tests/unit/customer-billing.test.ts`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add lib/customer-uid.ts lib/customer-billing.ts tests/unit/customer-uid.test.ts tests/unit/customer-billing.test.ts
git commit -m "feat(customers): add UID validation and billing recipient helpers"
```

---

### Task 2: Schema, Migration und Kundennummern-Vergabe

**Files:**
- Modify: `prisma/schema.prisma` (model `Customer`, neues Modell `CustomerContact`)
- Modify: `prisma/migrations/20261001120000_invoicing_and_banking/migration.sql` (Ende der Datei)
- Modify: `tests/test-utils.ts` (Aufräum-Reihenfolge)
- Modify: `lib/audit.ts` (Entitätstyp)
- Create: `lib/customer-number.ts`
- Test: `tests/integration/invoicing-and-banking-migration.test.ts`
- Test: `tests/integration/customer-number.test.ts`

**Interfaces:**
- Produces: `nextCustomerNumber(db: Pick<PrismaClient, "customer">): Promise<number>` (`max + 1`, mindestens 1001); Prisma-Felder `Customer.customerNumber/uid/billing*/paymentTermDays`, Relation `Customer.contacts`, Modell `CustomerContact { contactId, customerId, name, role, email, phone, createdAt }`.

- [ ] **Step 1: Schema erweitern**

In `prisma/schema.prisma` im `model Customer` nach `archivedAt DateTime?` einfügen und die Relation ergänzen:

```prisma
  customerNumber          Int?       @unique
  uid                     String?
  billingName             String?
  billingStreet           String?
  billingHouseNumber      String?
  billingZipCode          String?
  billingCity             String?
  billingCountry          String?
  billingEmail            String?
  paymentTermDays         Int?
```

und nach `subscriptions           Subscription[]`:

```prisma
  contacts                CustomerContact[]
```

Direkt nach `model CustomerNote { … }` anfügen:

```prisma
model CustomerContact {
  contactId  Int      @id @default(autoincrement())
  customerId Int
  name       String
  role       String?
  email      String?
  phone      String?
  createdAt  DateTime @default(now())
  customer   Customer @relation(fields: [customerId], references: [customerId], onDelete: Cascade)

  @@index([customerId])
}
```

- [ ] **Step 2: SQL an die Migration anhängen**

Ans Ende von `prisma/migrations/20261001120000_invoicing_and_banking/migration.sql` (nach der letzten `CREATE INDEX`-Zeile, mit Leerzeile davor):

```sql

-- ── Extended customer model (F10) ───────────────────────────────────────
ALTER TABLE "Customer" ADD COLUMN "customerNumber" INTEGER;
ALTER TABLE "Customer" ADD COLUMN "uid" TEXT;
ALTER TABLE "Customer" ADD COLUMN "billingName" TEXT;
ALTER TABLE "Customer" ADD COLUMN "billingStreet" TEXT;
ALTER TABLE "Customer" ADD COLUMN "billingHouseNumber" TEXT;
ALTER TABLE "Customer" ADD COLUMN "billingZipCode" TEXT;
ALTER TABLE "Customer" ADD COLUMN "billingCity" TEXT;
ALTER TABLE "Customer" ADD COLUMN "billingCountry" TEXT;
ALTER TABLE "Customer" ADD COLUMN "billingEmail" TEXT;
ALTER TABLE "Customer" ADD COLUMN "paymentTermDays" INTEGER;

-- Existing customers are numbered from 1001 in the order of their id; the
-- unique index is only created afterwards.
UPDATE "Customer" SET "customerNumber" = 1000 + (
  SELECT COUNT(*) FROM "Customer" AS c2 WHERE c2."customerId" <= "Customer"."customerId"
);
CREATE UNIQUE INDEX "Customer_customerNumber_key" ON "Customer"("customerNumber");

CREATE TABLE "CustomerContact" (
    "contactId" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "customerId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CustomerContact_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("customerId") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "CustomerContact_customerId_idx" ON "CustomerContact"("customerId");
```

- [ ] **Step 3: Prisma Client generieren**

Run: `npx prisma generate`
Expected: „Generated Prisma Client“ ohne Fehler.

- [ ] **Step 4: Failing Migrationstest ergänzen**

In `tests/integration/invoicing-and-banking-migration.test.ts` innerhalb des `describe`-Blocks einen weiteren Test anfügen:

```ts
  it("numbers existing customers from 1001 and creates the contact table", () => {
    const db = legacyDb();
    const insert = db.prepare(
      `INSERT INTO "Customer" ("contactPerson","address","city","zipCode","email")
       VALUES (?,'Weg 1','Bern','3000','x@test.ch')`
    );
    insert.run("Erster");
    insert.run("Zweiter");
    insert.run("Dritter");
    // A gap in the ids must not leave a gap in the numbers.
    db.prepare(`DELETE FROM "Customer" WHERE "contactPerson" = 'Zweiter'`).run();

    applyMigration(db, MIGRATION);

    const rows = db
      .prepare(
        `SELECT "contactPerson", "customerNumber", "uid", "billingEmail", "paymentTermDays"
         FROM "Customer" ORDER BY "customerId"`
      )
      .all();
    expect(rows).toEqual([
      { contactPerson: "Erster", customerNumber: 1001, uid: null, billingEmail: null, paymentTermDays: null },
      { contactPerson: "Dritter", customerNumber: 1002, uid: null, billingEmail: null, paymentTermDays: null },
    ]);

    expect(() =>
      db.prepare(`UPDATE "Customer" SET "customerNumber" = 1001 WHERE "contactPerson" = 'Dritter'`).run()
    ).toThrow(/UNIQUE/);

    db.prepare(
      `INSERT INTO "CustomerContact" ("customerId","name") VALUES ((SELECT MIN("customerId") FROM "Customer"), 'Buchhaltung')`
    ).run();
    db.pragma("foreign_keys = ON");
    db.prepare(`DELETE FROM "Customer" WHERE "contactPerson" = 'Erster'`).run();
    expect(db.prepare(`SELECT COUNT(*) AS n FROM "CustomerContact"`).get()).toEqual({ n: 0 });
  });
```

- [ ] **Step 5: Migrationstest laufen lassen**

Run: `npx vitest run tests/integration/invoicing-and-banking-migration.test.ts`
Expected: PASS (inklusive der bestehenden Tests).

- [ ] **Step 6: Failing Test für die Vergabe schreiben**

`tests/integration/customer-number.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { createTestDatabase, createValidTestCustomer } from "../test-utils";
import { nextCustomerNumber } from "@/lib/customer-number";

describe("nextCustomerNumber", () => {
  const db = createTestDatabase();

  it("starts at 1001", async () => {
    expect(await nextCustomerNumber(db.prisma)).toBe(1001);
  });

  it("continues after the highest number, ignoring customers without one", async () => {
    const { prisma } = db;
    await prisma.customer.create({ data: createValidTestCustomer() }); // no number
    await prisma.customer.create({ data: { ...createValidTestCustomer(), customerNumber: 2500 } });
    expect(await nextCustomerNumber(prisma)).toBe(2501);
  });

  it("enforces uniqueness", async () => {
    const { prisma } = db;
    await prisma.customer.create({ data: { ...createValidTestCustomer(), customerNumber: 5 } });
    await expect(
      prisma.customer.create({ data: { ...createValidTestCustomer(), customerNumber: 5 } })
    ).rejects.toMatchObject({ code: "P2002" });
  });

  it("allows many customers without a number", async () => {
    const { prisma } = db;
    await prisma.customer.create({ data: createValidTestCustomer() });
    await prisma.customer.create({ data: createValidTestCustomer() });
    expect(await prisma.customer.count()).toBe(2);
  });

  it("deletes contacts together with the customer", async () => {
    const { prisma } = db;
    const c = await prisma.customer.create({
      data: { ...createValidTestCustomer(), contacts: { create: [{ name: "Buchhaltung" }] } },
    });
    expect(await prisma.customerContact.count()).toBe(1);
    await prisma.customer.delete({ where: { customerId: c.customerId } });
    expect(await prisma.customerContact.count()).toBe(0);
  });
});
```

- [ ] **Step 7: Test laufen lassen, Fehlschlag prüfen**

Run: `npx vitest run tests/integration/customer-number.test.ts`
Expected: FAIL (`Cannot find module '@/lib/customer-number'`).

- [ ] **Step 8: `lib/customer-number.ts` anlegen**

```ts
import type { PrismaClient } from "@prisma/client";

export const FIRST_CUSTOMER_NUMBER = 1001;

/** Highest assigned number plus one (at least 1001). Race losers retry on P2002 in the caller. */
export async function nextCustomerNumber(db: Pick<PrismaClient, "customer">): Promise<number> {
  const result = await db.customer.aggregate({ _max: { customerNumber: true } });
  const max = result?._max?.customerNumber ?? null;
  return max === null ? FIRST_CUSTOMER_NUMBER : Math.max(max + 1, FIRST_CUSTOMER_NUMBER);
}
```

- [ ] **Step 9: Aufräumen in `tests/test-utils.ts` und Audit-Typ**

In `tests/test-utils.ts` direkt vor `await p.customer.deleteMany();` einfügen:

```ts
    await p.customerContact.deleteMany();
```

In `lib/audit.ts` den Union-Typ `AuditEntity` um `| "CustomerContact"` erweitern (hinter `"CustomerNote"`).

- [ ] **Step 10: Tests laufen lassen**

Run: `npx vitest run tests/integration/customer-number.test.ts tests/integration/invoicing-and-banking-migration.test.ts tests/integration/customers.test.ts`
Expected: PASS.

- [ ] **Step 11: Migrationskette gegen das Schema prüfen**

Run (Git Bash):

```bash
rm -f data/tmp-check.db*
node -e "const D=require('better-sqlite3');const fs=require('fs');const p=require('path');const db=new D('data/tmp-check.db');const d='prisma/migrations';for(const n of fs.readdirSync(d).filter(n=>fs.existsSync(p.join(d,n,'migration.sql'))).sort()){db.exec(fs.readFileSync(p.join(d,n,'migration.sql'),'utf8'))}db.close()"
DATABASE_URL=file:./data/tmp-check.db npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script
rm -f data/tmp-check.db*
```

Expected: leere Ausgabe bzw. „-- This is an empty migration.“ Weicht sie ab, das angehängte SQL an das Schema angleichen, nicht umgekehrt.

- [ ] **Step 12: Commit**

```bash
git add prisma/schema.prisma prisma/migrations lib/customer-number.ts lib/audit.ts tests/test-utils.ts tests/integration/customer-number.test.ts tests/integration/invoicing-and-banking-migration.test.ts
git commit -m "feat(customers): add customer number, billing fields and contact table"
```

---

### Task 3: Kundenformular-Aktionen (Validierung und Speichern)

**Files:**
- Modify: `app/(app)/customers/actions.ts` (`createCustomer`, `updateCustomer`)
- Test: `tests/unit/customer-actions.test.ts`

**Interfaces:**
- Consumes: `isValidUid`, `normalizeUid` (Task 1), `nextCustomerNumber` (Task 2).
- Produces: `createCustomer`/`updateCustomer` lesen zusätzlich die FormData-Felder `customerNumber`, `uid`, `paymentTermDays`, `billingName`, `billingStreet`, `billingHouseNumber`, `billingZipCode`, `billingCity`, `billingCountry`, `billingEmail`; Fehler stehen in `fieldErrors` unter denselben Schlüsseln.

- [ ] **Step 1: Bestehende Mocks erweitern**

In `tests/unit/customer-actions.test.ts` den Prisma-Mock ersetzen durch:

```ts
vi.mock("@/lib/prisma", () => ({
  default: {
    customer: { create: vi.fn(), update: vi.fn(), delete: vi.fn(), aggregate: vi.fn() },
    invoice: { count: vi.fn() },
  },
}));
```

und im `beforeEach` nach `vi.clearAllMocks();` ergänzen:

```ts
    vi.mocked(prisma.customer.aggregate).mockResolvedValue({ _max: { customerNumber: null } } as never);
    vi.mocked(prisma.customer.create).mockResolvedValue({ customerId: 1 } as never);
```

(`prisma.customer.create` lieferte bisher `undefined`; `createCustomer` liest `customer.customerId`, bestehende Tests mocken das ggf. schon – dann bleibt deren Wert maßgeblich.)

- [ ] **Step 2: Failing Tests für die neuen Felder anfügen**

Am Ende des `describe("customer actions", …)`-Blocks (vor der schliessenden `});`) ergänzen:

```ts
  describe("extended customer fields", () => {
    const BILLING = {
      billingName: "Muster AG, Buchhaltung",
      billingStreet: "Postfach",
      billingZipCode: "3000",
      billingCity: "Bern",
    };

    async function create(fields: Record<string, string>) {
      vi.mocked(auth).mockResolvedValue(editorSession);
      return createCustomer({}, form({ ...VALID_FIELDS, ...fields }));
    }

    it("assigns the next customer number automatically", async () => {
      vi.mocked(prisma.customer.aggregate).mockResolvedValue({ _max: { customerNumber: 1041 } } as never);
      await create({});
      expect(prisma.customer.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ customerNumber: 1042 }) })
      );
    });

    it("keeps an explicit customer number", async () => {
      await create({ customerNumber: "77" });
      expect(prisma.customer.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ customerNumber: 77 }) })
      );
    });

    it("rejects a non-numeric customer number", async () => {
      const result = await create({ customerNumber: "K-1" });
      expect(result.fieldErrors?.customerNumber).toBeDefined();
      expect(prisma.customer.create).not.toHaveBeenCalled();
    });

    it("reports a duplicate customer number", async () => {
      vi.mocked(prisma.customer.create).mockRejectedValueOnce(
        Object.assign(new Error("unique"), { code: "P2002", name: "PrismaClientKnownRequestError" })
      );
      const result = await create({ customerNumber: "77" });
      expect(result.fieldErrors?.customerNumber).toBe("Kundennummer bereits vergeben.");
    });

    it("retries an automatic number once after a collision", async () => {
      vi.mocked(prisma.customer.aggregate)
        .mockResolvedValueOnce({ _max: { customerNumber: 1001 } } as never)
        .mockResolvedValueOnce({ _max: { customerNumber: 1002 } } as never);
      vi.mocked(prisma.customer.create)
        .mockRejectedValueOnce(Object.assign(new Error("unique"), { code: "P2002" }))
        .mockResolvedValueOnce({ customerId: 5 } as never);
      await create({});
      expect(prisma.customer.create).toHaveBeenCalledTimes(2);
      expect(prisma.customer.create).toHaveBeenLastCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ customerNumber: 1003 }) })
      );
    });

    it("normalizes a valid UID and rejects an invalid one", async () => {
      await create({ uid: "che116281710 mwst" });
      expect(prisma.customer.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ uid: "CHE-116.281.710" }) })
      );
      vi.mocked(prisma.customer.create).mockClear();
      const result = await create({ uid: "CHE-116.281.711" });
      expect(result.fieldErrors?.uid).toBeDefined();
      expect(prisma.customer.create).not.toHaveBeenCalled();
    });

    it("saves a complete billing address with default country", async () => {
      await create({ ...BILLING, billingEmail: "buchhaltung@muster.ch" });
      expect(prisma.customer.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            billingName: "Muster AG, Buchhaltung",
            billingStreet: "Postfach",
            billingZipCode: "3000",
            billingCity: "Bern",
            billingCountry: "CH",
            billingEmail: "buchhaltung@muster.ch",
          }),
        })
      );
    });

    it("rejects a partial billing address", async () => {
      const result = await create({ billingStreet: "Postfach", billingCity: "Bern" });
      expect(result.fieldErrors?.billingStreet).toBeDefined();
      expect(prisma.customer.create).not.toHaveBeenCalled();
    });

    it("drops billing name and country when there is no billing address", async () => {
      await create({ billingName: "Nur Name", billingCountry: "DE" });
      expect(prisma.customer.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ billingName: null, billingCountry: null, billingStreet: null }),
        })
      );
    });

    it("rejects an invalid billing e-mail", async () => {
      const result = await create({ billingEmail: "kaputt" });
      expect(result.fieldErrors?.billingEmail).toBeDefined();
    });

    it("validates the payment term (1-365 days)", async () => {
      for (const bad of ["0", "366", "abc", "-5"]) {
        const result = await create({ paymentTermDays: bad });
        expect(result.fieldErrors?.paymentTermDays).toBeDefined();
      }
      expect(prisma.customer.create).not.toHaveBeenCalled();
      await create({ paymentTermDays: "10" });
      expect(prisma.customer.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ paymentTermDays: 10 }) })
      );
    });

    it("stores no payment term when the field is empty", async () => {
      await create({ paymentTermDays: "" });
      expect(prisma.customer.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ paymentTermDays: null }) })
      );
    });

    it("update keeps the customer number when the field is empty", async () => {
      vi.mocked(auth).mockResolvedValue(editorSession);
      await updateCustomer(3, {}, form({ ...VALID_FIELDS, customerNumber: "" }));
      const data = vi.mocked(prisma.customer.update).mock.calls[0][0].data as Record<string, unknown>;
      expect("customerNumber" in data).toBe(false);
    });

    it("update reports a duplicate customer number", async () => {
      vi.mocked(auth).mockResolvedValue(editorSession);
      vi.mocked(prisma.customer.update).mockRejectedValueOnce(
        Object.assign(new Error("unique"), { code: "P2002" })
      );
      const result = await updateCustomer(3, {}, form({ ...VALID_FIELDS, customerNumber: "9" }));
      expect(result.fieldErrors?.customerNumber).toBe("Kundennummer bereits vergeben.");
    });
  });
```

- [ ] **Step 3: Tests laufen lassen, Fehlschlag prüfen**

Run: `npx vitest run tests/unit/customer-actions.test.ts`
Expected: FAIL (neue Tests); bestehende Tests PASS.

- [ ] **Step 4: `actions.ts` umbauen**

Imports ergänzen (oben):

```ts
import { isValidUid, normalizeUid } from "@/lib/customer-uid";
import { nextCustomerNumber } from "@/lib/customer-number";
```

`customerSchema` ersetzen durch (alles bisherige bleibt, neue Felder und `superRefine` kommen dazu):

```ts
const optionalText = (max: number, label: string) =>
  z.string().max(max, `${label} darf maximal ${max} Zeichen lang sein.`).nullable();

const customerSchema = z
  .object({
    company: z.string().nullable(),
    contactPerson: z.string().min(1, "Kontaktperson ist erforderlich."),
    street: z
      .string()
      .min(1, "Strasse ist erforderlich.")
      .max(ADDRESS_LIMITS.street, `Strasse darf maximal ${ADDRESS_LIMITS.street} Zeichen lang sein.`),
    houseNumber: z
      .string()
      .max(ADDRESS_LIMITS.houseNumber, `Hausnummer darf maximal ${ADDRESS_LIMITS.houseNumber} Zeichen lang sein.`)
      .nullable(),
    city: z
      .string()
      .min(1, "Ort ist erforderlich.")
      .max(ADDRESS_LIMITS.city, `Ort darf maximal ${ADDRESS_LIMITS.city} Zeichen lang sein.`),
    zipCode: z
      .string()
      .min(1, "PLZ ist erforderlich.")
      .max(ADDRESS_LIMITS.zip, `PLZ darf maximal ${ADDRESS_LIMITS.zip} Zeichen lang sein.`),
    country: z.string().refine(isCountryCode, "Ungültiger Ländercode."),
    email: z.string().email("Ungültige E-Mail-Adresse."),
    phone: z.string().nullable(),
    customerNumber: z
      .string()
      .nullable()
      .refine((v) => v === null || (/^\d{1,9}$/.test(v) && Number(v) >= 1), "Kundennummer muss eine ganze Zahl ab 1 sein."),
    uid: z
      .string()
      .nullable()
      .refine((v) => v === null || isValidUid(v), "Ungültige UID (Format CHE-123.456.789, Prüfziffer stimmt nicht)."),
    paymentTermDays: z
      .string()
      .nullable()
      .refine(
        (v) => v === null || (/^\d+$/.test(v) && Number(v) >= 1 && Number(v) <= 365),
        "Zahlungsfrist muss zwischen 1 und 365 Tagen liegen."
      ),
    billingName: optionalText(120, "Name"),
    billingStreet: optionalText(ADDRESS_LIMITS.street, "Strasse"),
    billingHouseNumber: optionalText(ADDRESS_LIMITS.houseNumber, "Hausnummer"),
    billingZipCode: optionalText(ADDRESS_LIMITS.zip, "PLZ"),
    billingCity: optionalText(ADDRESS_LIMITS.city, "Ort"),
    billingCountry: z.string().nullable().refine((v) => v === null || isCountryCode(v), "Ungültiger Ländercode."),
    billingEmail: z.string().email("Ungültige E-Mail-Adresse.").nullable(),
  })
  .superRefine((value, ctx) => {
    const parts = [value.billingStreet, value.billingZipCode, value.billingCity];
    const filledCount = parts.filter(Boolean).length;
    if (filledCount > 0 && filledCount < 3) {
      ctx.addIssue({
        code: "custom",
        path: ["billingStreet"],
        message: "Strasse, PLZ und Ort der Rechnungsadresse müssen zusammen ausgefüllt werden.",
      });
    }
  });

function text(formData: FormData, key: string): string | null {
  return ((formData.get(key) as string) || "").trim() || null;
}

function readCustomerForm(formData: FormData) {
  return {
    company: (formData.get("company") as string) || null,
    contactPerson: (formData.get("contactPerson") as string) || "",
    street: ((formData.get("street") as string) || "").trim(),
    houseNumber: text(formData, "houseNumber"),
    city: ((formData.get("city") as string) || "").trim(),
    zipCode: ((formData.get("zipCode") as string) || "").trim(),
    country: ((formData.get("country") as string) || "CH").trim().toUpperCase(),
    email: (formData.get("email") as string) || "",
    phone: (formData.get("phone") as string) || null,
    customerNumber: text(formData, "customerNumber"),
    uid: text(formData, "uid"),
    paymentTermDays: text(formData, "paymentTermDays"),
    billingName: text(formData, "billingName"),
    billingStreet: text(formData, "billingStreet"),
    billingHouseNumber: text(formData, "billingHouseNumber"),
    billingZipCode: text(formData, "billingZipCode"),
    billingCity: text(formData, "billingCity"),
    billingCountry: text(formData, "billingCountry")?.toUpperCase() ?? null,
    billingEmail: text(formData, "billingEmail"),
  };
}

type ParsedCustomer = z.infer<typeof customerSchema>;

function validate(formData: FormData):
  | { ok: true; data: ParsedCustomer }
  | { ok: false; state: CustomerFormState } {
  const parsed = customerSchema.safeParse(readCustomerForm(formData));
  if (parsed.success) return { ok: true, data: parsed.data };
  const fieldErrors: Record<string, string> = {};
  for (const issue of parsed.error.issues) {
    const field = issue.path[0] as string;
    if (!fieldErrors[field]) fieldErrors[field] = issue.message;
  }
  return { ok: false, state: { error: "Bitte alle Pflichtfelder korrekt ausfüllen.", fieldErrors } };
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "P2002";
}

const DUPLICATE_NUMBER: CustomerFormState = {
  error: "Bitte alle Pflichtfelder korrekt ausfüllen.",
  fieldErrors: { customerNumber: "Kundennummer bereits vergeben." },
};

/** Columns shared by create and update (everything except the customer number). */
function customerData(d: ParsedCustomer, formData: FormData) {
  const hasBilling = Boolean(d.billingStreet && d.billingZipCode && d.billingCity);
  return {
    company: d.company || null,
    contactPerson: d.contactPerson,
    street: d.street,
    houseNumber: d.houseNumber,
    city: d.city,
    zipCode: d.zipCode,
    country: d.country,
    // Saving confirms the address, e.g. after the migration's automatic split.
    addressNeedsReview: false,
    email: d.email,
    phone: d.phone || null,
    contactInsteadOfCompany: formData.get("contactInsteadOfCompany") === "on",
    uid: d.uid ? normalizeUid(d.uid) : null,
    paymentTermDays: d.paymentTermDays ? Number(d.paymentTermDays) : null,
    // A billing name or country without an address would be meaningless.
    billingName: hasBilling ? d.billingName : null,
    billingStreet: hasBilling ? d.billingStreet : null,
    billingHouseNumber: hasBilling ? d.billingHouseNumber : null,
    billingZipCode: hasBilling ? d.billingZipCode : null,
    billingCity: hasBilling ? d.billingCity : null,
    billingCountry: hasBilling ? (d.billingCountry ?? "CH") : null,
    billingEmail: d.billingEmail,
  };
}
```

`createCustomer` und `updateCustomer` ersetzen (`deleteCustomer`, `archiveCustomer`, `restoreCustomer` bleiben unverändert):

```ts
export async function createCustomer(
  _prev: CustomerFormState,
  formData: FormData
): Promise<CustomerFormState> {
  const session = await requireEditor();

  const result = validate(formData);
  if (!result.ok) return result.state;
  const data = customerData(result.data, formData);

  const explicitNumber = result.data.customerNumber ? Number(result.data.customerNumber) : null;
  let customer: { customerId: number } | undefined;
  // Automatic numbers race with concurrent creates: recompute and retry on a collision.
  for (let attempt = 0; attempt < 3 && !customer; attempt++) {
    const customerNumber = explicitNumber ?? (await nextCustomerNumber(prisma));
    try {
      customer = await prisma.customer.create({ data: { ...data, customerNumber } });
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      if (explicitNumber !== null) return DUPLICATE_NUMBER;
    }
  }
  if (!customer) return { error: "Kundennummer konnte nicht vergeben werden. Bitte erneut versuchen." };

  await logAudit(session, "CREATE", "Customer", customer.customerId, result.data.contactPerson);

  redirect("/customers");
}

export async function updateCustomer(
  id: number,
  _prev: CustomerFormState,
  formData: FormData
): Promise<CustomerFormState> {
  const session = await requireEditor();

  const result = validate(formData);
  if (!result.ok) return result.state;
  const data = customerData(result.data, formData);
  // An empty field keeps the current number.
  const customerNumber = result.data.customerNumber ? { customerNumber: Number(result.data.customerNumber) } : {};

  try {
    await prisma.customer.update({ where: { customerId: id }, data: { ...data, ...customerNumber } });
  } catch (err) {
    if (isUniqueViolation(err)) return DUPLICATE_NUMBER;
    throw err;
  }
  await logAudit(session, "UPDATE", "Customer", id, result.data.contactPerson);
  // Top-customer names come from the cached analytics payload.
  revalidateTag(ANALYTICS_CACHE_TAG, { expire: 0 });

  redirect(`/customers/${id}`);
}
```

- [ ] **Step 5: Tests laufen lassen**

Run: `npx vitest run tests/unit/customer-actions.test.ts`
Expected: PASS (alte und neue Tests). Bei Abweichungen in alten Tests (z. B. erwarteter `create`-Aufruf mit exakten Daten) den erwarteten Wert um die neuen Felder ergänzen (`uid: null`, `paymentTermDays: null`, `billing*: null`, `customerNumber: 1001`) statt die Implementierung zu ändern.

- [ ] **Step 6: Commit**

```bash
git add "app/(app)/customers/actions.ts" tests/unit/customer-actions.test.ts
git commit -m "feat(customers): validate and save extended customer fields"
```

---

### Task 4: Kontakte (Aktionen und Karte)

**Files:**
- Create: `app/(app)/customers/contact-actions.ts`
- Create: `app/(app)/customers/ContactsSection.tsx`
- Modify: `app/(app)/customers/[id]/page.tsx`
- Test: `tests/unit/contact-actions.test.ts`

**Interfaces:**
- Consumes: Prisma-Modell `CustomerContact` (Task 2), `ActionState` aus `@/hooks/use-action-toast`.
- Produces: `createContact(customerId, _prev, formData)`, `updateContact(customerId, contactId, _prev, formData)`, `deleteContact(customerId, contactId)`; Komponente `ContactsSection({ customerId, canEdit, contacts })`.

- [ ] **Step 1: Failing Test schreiben**

`tests/unit/contact-actions.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  default: {
    customerContact: { create: vi.fn(), update: vi.fn(), delete: vi.fn() },
  },
}));
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }));

import { createContact, updateContact, deleteContact } from "@/app/(app)/customers/contact-actions";
import prisma from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { logAudit } from "@/lib/audit";

const editor = { user: { id: "1", name: "E", email: "e@test.ch", role: "Editor" } } as never;
const viewer = { user: { id: "3", name: "V", email: "v@test.ch", role: "Viewer" } } as never;

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

describe("contact actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(auth).mockResolvedValue(editor);
    vi.mocked(prisma.customerContact.create).mockResolvedValue({ contactId: 7, name: "Buchhaltung" } as never);
    vi.mocked(prisma.customerContact.delete).mockResolvedValue({ contactId: 7, name: "Buchhaltung" } as never);
  });

  it("rejects viewers", async () => {
    vi.mocked(auth).mockResolvedValue(viewer);
    vi.mocked(redirect).mockImplementation(() => {
      throw new Error("REDIRECT:/dashboard");
    });
    await expect(createContact(1, {}, form({ name: "X" }))).rejects.toThrow("REDIRECT");
    expect(prisma.customerContact.create).not.toHaveBeenCalled();
  });

  it("requires a name", async () => {
    const result = await createContact(1, {}, form({ name: "  " }));
    expect(result.error).toBe("Name ist erforderlich");
    expect(prisma.customerContact.create).not.toHaveBeenCalled();
  });

  it("rejects an invalid e-mail", async () => {
    const result = await createContact(1, {}, form({ name: "X", email: "kaputt" }));
    expect(result.error).toBe("Ungültige E-Mail-Adresse");
  });

  it("creates a contact, trims and nulls empty fields, and audits", async () => {
    const result = await createContact(1, {}, form({ name: " Buchhaltung ", role: "", email: "b@x.ch", phone: "" }));
    expect(result.success).toBe(true);
    expect(prisma.customerContact.create).toHaveBeenCalledWith({
      data: { customerId: 1, name: "Buchhaltung", role: null, email: "b@x.ch", phone: null },
    });
    expect(logAudit).toHaveBeenCalledWith(editor, "CREATE", "CustomerContact", 7, "Buchhaltung");
  });

  it("updates a contact", async () => {
    const result = await updateContact(1, 7, {}, form({ name: "Einkauf", role: "Einkauf" }));
    expect(result.success).toBe(true);
    expect(prisma.customerContact.update).toHaveBeenCalledWith({
      where: { contactId: 7 },
      data: { name: "Einkauf", role: "Einkauf", email: null, phone: null },
    });
    expect(logAudit).toHaveBeenCalledWith(editor, "UPDATE", "CustomerContact", 7, "Einkauf");
  });

  it("deletes a contact as editor and audits", async () => {
    await deleteContact(1, 7);
    expect(prisma.customerContact.delete).toHaveBeenCalledWith({ where: { contactId: 7 } });
    expect(logAudit).toHaveBeenCalledWith(editor, "DELETE", "CustomerContact", 7, "Buchhaltung");
  });
});
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag prüfen**

Run: `npx vitest run tests/unit/contact-actions.test.ts`
Expected: FAIL (Modul fehlt).

- [ ] **Step 3: `contact-actions.ts` implementieren**

```ts
"use server";

import prisma from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ActionState } from "@/hooks/use-action-toast";
import { requireEditor } from "@/lib/permissions";
import { logAudit } from "@/lib/audit";

function field(formData: FormData, key: string): string | null {
  return ((formData.get(key) as string) ?? "").trim() || null;
}

function readContact(formData: FormData):
  | { data: { name: string; role: string | null; email: string | null; phone: string | null } }
  | { error: string } {
  const name = field(formData, "name");
  if (!name) return { error: "Name ist erforderlich" };
  if (name.length > 200) return { error: "Name zu lang (max. 200 Zeichen)" };
  const email = field(formData, "email");
  if (email && !z.string().email().safeParse(email).success) return { error: "Ungültige E-Mail-Adresse" };
  return { data: { name, role: field(formData, "role"), email, phone: field(formData, "phone") } };
}

export async function createContact(
  customerId: number,
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const session = await requireEditor();
  const parsed = readContact(formData);
  if ("error" in parsed) return { error: parsed.error };

  const contact = await prisma.customerContact.create({ data: { customerId, ...parsed.data } });
  await logAudit(session, "CREATE", "CustomerContact", contact.contactId, parsed.data.name);
  revalidatePath(`/customers/${customerId}`);
  return { success: true, _ts: Date.now() };
}

export async function updateContact(
  customerId: number,
  contactId: number,
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const session = await requireEditor();
  const parsed = readContact(formData);
  if ("error" in parsed) return { error: parsed.error };

  await prisma.customerContact.update({ where: { contactId }, data: parsed.data });
  await logAudit(session, "UPDATE", "CustomerContact", contactId, parsed.data.name);
  revalidatePath(`/customers/${customerId}`);
  return { success: true, _ts: Date.now() };
}

export async function deleteContact(customerId: number, contactId: number): Promise<void> {
  const session = await requireEditor();
  const contact = await prisma.customerContact.delete({ where: { contactId } });
  await logAudit(session, "DELETE", "CustomerContact", contactId, contact.name);
  revalidatePath(`/customers/${customerId}`);
}
```

- [ ] **Step 4: Test laufen lassen**

Run: `npx vitest run tests/unit/contact-actions.test.ts`
Expected: PASS.

- [ ] **Step 5: `ContactsSection.tsx` anlegen**

```tsx
"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { createContact, deleteContact, updateContact } from "./contact-actions";
import { useActionToast } from "@/hooks/use-action-toast";

type ContactRecord = {
  contactId: number;
  name: string;
  role: string | null;
  email: string | null;
  phone: string | null;
};

type Props = {
  customerId: number;
  canEdit: boolean;
  contacts: ContactRecord[];
};

function ContactFields({ contact, disabled }: { contact?: ContactRecord; disabled: boolean }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
      <Input name="name" placeholder="Name" defaultValue={contact?.name ?? ""} disabled={disabled} />
      <Input name="role" placeholder="Rolle (z.B. Buchhaltung)" defaultValue={contact?.role ?? ""} disabled={disabled} />
      <Input name="email" type="email" placeholder="E-Mail" defaultValue={contact?.email ?? ""} disabled={disabled} />
      <Input name="phone" type="tel" placeholder="Telefon" defaultValue={contact?.phone ?? ""} disabled={disabled} />
    </div>
  );
}

function NewContactForm({ customerId }: { customerId: number }) {
  const [state, formAction, isPending] = useActionState(createContact.bind(null, customerId), {});
  const formRef = useRef<HTMLFormElement>(null);
  const prevTs = useRef<number | undefined>(undefined);

  useActionToast(state, "Kontakt hinzugefügt");

  useEffect(() => {
    if (state.success && state._ts !== prevTs.current) {
      prevTs.current = state._ts;
      formRef.current?.reset();
    }
  }, [state]);

  return (
    <form ref={formRef} action={formAction} className="space-y-2">
      <ContactFields disabled={isPending} />
      <Button type="submit" variant="outline" size="sm" disabled={isPending}>
        {isPending ? "Speichert…" : "Kontakt hinzufügen"}
      </Button>
    </form>
  );
}

function EditableContact({ customerId, contact }: { customerId: number; contact: ContactRecord }) {
  const [state, formAction, isPending] = useActionState(
    updateContact.bind(null, customerId, contact.contactId),
    {}
  );
  useActionToast(state, "Kontakt gespeichert");

  return (
    <li className="py-3">
      <form action={formAction} className="space-y-2">
        <ContactFields contact={contact} disabled={isPending} />
        <div className="flex items-center gap-1.5">
          <Button type="submit" variant="outline" size="sm" disabled={isPending}>
            {isPending ? "…" : "Speichern"}
          </Button>
          <ConfirmDialog
            title="Kontakt löschen"
            description="Soll dieser Kontakt wirklich gelöscht werden?"
            confirmLabel="Löschen"
            triggerVariant="ghost"
            triggerSize="sm"
            onConfirm={() => deleteContact(customerId, contact.contactId)}
          >
            Löschen
          </ConfirmDialog>
        </div>
      </form>
    </li>
  );
}

function ReadOnlyContact({ contact }: { contact: ContactRecord }) {
  return (
    <li className="py-3 text-sm">
      <div className="font-medium">
        {contact.name}
        {contact.role && <span className="ml-2 font-normal text-muted-foreground">{contact.role}</span>}
      </div>
      {(contact.email || contact.phone) && (
        <div className="text-muted-foreground">{[contact.email, contact.phone].filter(Boolean).join(" · ")}</div>
      )}
    </li>
  );
}

export default function ContactsSection({ customerId, canEdit, contacts }: Props) {
  // Collapsed state is only a display matter; the card stays visible so contacts are findable.
  const [showAdd, setShowAdd] = useState(false);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Kontakte</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {contacts.length === 0 ? (
          <p className="text-sm text-muted-foreground py-1">Keine weiteren Kontakte vorhanden.</p>
        ) : (
          <ul className="divide-y divide-border">
            {contacts.map((c) =>
              canEdit ? (
                <EditableContact key={c.contactId} customerId={customerId} contact={c} />
              ) : (
                <ReadOnlyContact key={c.contactId} contact={c} />
              )
            )}
          </ul>
        )}
        {canEdit &&
          (showAdd ? (
            <NewContactForm customerId={customerId} />
          ) : (
            <Button variant="outline" size="sm" onClick={() => setShowAdd(true)}>
              Kontakt hinzufügen
            </Button>
          ))}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 6: Karte in die Detailseite einbinden**

In `app/(app)/customers/[id]/page.tsx`:

1. Import ergänzen: `import ContactsSection from "../ContactsSection";`
2. In `Promise.all` am Ende (nach `prisma.invoiceTemplate.findMany(…)`) ergänzen: `prisma.customerContact.findMany({ where: { customerId }, orderBy: { createdAt: "asc" } }),` und die Destrukturierung um `contacts` erweitern: `…, subscriptions, templates, contacts] =await Promise.all([`.
3. Im rechten `<div className="space-y-6">` vor `<SubscriptionsSection …>` einfügen:

```tsx
          <ContactsSection
            customerId={customerId}
            canEdit={canEdit}
            contacts={contacts.map((c) => ({
              contactId: c.contactId,
              name: c.name,
              role: c.role,
              email: c.email,
              phone: c.phone,
            }))}
          />
```

- [ ] **Step 7: Typen, Lint und Tests prüfen**

Run: `npx tsc --noEmit; npm run lint; npx vitest run tests/unit/contact-actions.test.ts`
Expected: keine Fehler, Test PASS.

- [ ] **Step 8: Commit**

```bash
git add "app/(app)/customers/contact-actions.ts" "app/(app)/customers/ContactsSection.tsx" "app/(app)/customers/[id]/page.tsx" tests/unit/contact-actions.test.ts
git commit -m "feat(customers): add additional contacts card"
```

---

### Task 5: Rechnungsadresse und -E-Mail in PDF, QR-Rechnung, OP-Liste und Versand

**Files:**
- Modify: `lib/pdf/document-pdf.ts` (Typ `RenderDoc.customer`, Empfängerblock, Kopfzeilen)
- Modify: `lib/pdf/qrbill-helpers.ts` (Typ `QrBillInput.customer`, Debtor)
- Modify: `lib/receivables.ts` (`ReceivableInput.customer`, `customerAddress`)
- Modify: `lib/email.ts` (Empfänger in `sendInvoiceEmail`), `lib/subscriptions.ts` (`to` des `PendingEmail`), `app/(app)/invoices/[id]/page.tsx` und `app/(app)/invoices/reminders/page.tsx` (vorbelegte Empfängeradresse im Versanddialog)
- Test: `tests/unit/qrbill-data.test.ts`, `tests/unit/document-pdf-generation.test.ts`, `tests/unit/reminder-pdf.test.ts`, `tests/unit/receivables.test.ts`, `tests/unit/email-send.test.ts`

**Interfaces:**
- Consumes: `billingRecipient`, `customerRecipient`, `hasBillingAddress`, `billingEmail`, `AddressCustomer`, `BillingFields` (Task 1).
- Produces: unveränderte öffentliche Signaturen; neue optionale Kundenfelder werden akzeptiert.

- [ ] **Step 1: Failing Tests schreiben**

**a) `tests/unit/qrbill-data.test.ts`:** im bestehenden `describe` anfügen:

```ts
  it("uses the billing address as debtor when set", () => {
    const data = buildQrBillData({
      invoice: { documentNumber: "I-1", totalAmount: 100 },
      company: {
        companyIBAN: "CH93 0076 2011 6238 5295 7",
        companyName: "Firma",
        companyStreet: "Weg",
        companyHouseNumber: "1",
        companyZip: "8000",
        companyCity: "Zürich",
        companyCountry: "CH",
      },
      customer: {
        contactInsteadOfCompany: false,
        company: "Muster AG",
        contactPerson: "Anna",
        street: "Hauptstrasse",
        houseNumber: "5",
        zipCode: "8001",
        city: "Zürich",
        country: "CH",
        billingName: "Muster AG, Buchhaltung",
        billingStreet: "Postfach",
        billingZipCode: "3000",
        billingCity: "Bern",
        billingCountry: "CH",
      },
    });
    expect(data?.debtor).toEqual({
      name: "Muster AG, Buchhaltung",
      address: "Postfach",
      zip: "3000",
      city: "Bern",
      country: "CH",
    });
  });
```

**b) `tests/unit/receivables.test.ts`:** im `describe("buildReceivables customer address", …)` anfügen:

```ts
  it("uses the billing address when set", () => {
    const report = buildReceivables(
      [
        inv({
          id: 1,
          customer: {
            ...customer,
            street: "Seestrasse",
            houseNumber: "100",
            zipCode: "3011",
            city: "Bern",
            country: "CH",
            billingStreet: "Postfach",
            billingHouseNumber: "7",
            billingZipCode: "8001",
            billingCity: "Zürich",
            billingCountry: "CH",
          },
        }),
      ],
      new Date("2026-12-31")
    );
    expect(report.rows[0].customerAddress).toEqual({
      street: "Postfach 7",
      zip: "8001",
      city: "Zürich",
      country: "CH",
    });
  });
```

**c) `tests/unit/email-send.test.ts`:** im `describe("sendInvoiceEmail", …)` anfügen (nutzt die vorhandenen Helfer `makeCustomer`, `makeInvoice`, `makeSettings`, `makeQuote`):

```ts
    it("sends invoices to the billing e-mail when set", async () => {
      await sendInvoiceEmail(
        makeInvoice(makeCustomer({ billingEmail: "buchhaltung@muster.ch" })),
        makeSettings(),
        Buffer.from("pdf")
      );
      expect(mockSendMail).toHaveBeenCalledWith(expect.objectContaining({ to: "buchhaltung@muster.ch" }));
    });

    it("keeps an explicit recipient over the billing e-mail", async () => {
      await sendInvoiceEmail(
        makeInvoice(makeCustomer({ billingEmail: "buchhaltung@muster.ch" })),
        makeSettings(),
        Buffer.from("pdf"),
        { to: "andere@muster.ch" }
      );
      expect(mockSendMail).toHaveBeenCalledWith(expect.objectContaining({ to: "andere@muster.ch" }));
    });

    it("falls back to the customer e-mail without a billing e-mail", async () => {
      await sendInvoiceEmail(makeInvoice(), makeSettings(), Buffer.from("pdf"));
      expect(mockSendMail).toHaveBeenCalledWith(expect.objectContaining({ to: "max@muster.ch" }));
    });
```

und im `describe("sendQuoteEmail", …)`:

```ts
    it("always sends quotes to the customer e-mail", async () => {
      await sendQuoteEmail(
        makeQuote(makeCustomer({ billingEmail: "buchhaltung@muster.ch" })),
        makeSettings(),
        Buffer.from("pdf")
      );
      expect(mockSendMail).toHaveBeenCalledWith(expect.objectContaining({ to: "max@muster.ch" }));
    });
```

(Falls es in der Datei kein `describe("sendQuoteEmail", …)` gibt, den Test in ein neues `describe` am Ende des äusseren `describe("email.ts", …)` setzen.)

**d) `tests/unit/document-pdf-generation.test.ts`:** am Ende des ersten `describe` (nach dem Test „adds no QR page for a quote“) anfügen; `baseDoc` und `extractText` existieren bereits in der Datei:

```ts
  const extended = {
    contactInsteadOfCompany: false,
    company: "Muster AG",
    contactPerson: "Anna Beispiel",
    street: "Hauptstrasse",
    houseNumber: "5",
    zipCode: "8001",
    city: "Zürich",
    country: "CH",
    customerNumber: 1042,
    uid: "CHE-116.281.710",
    billingName: "Muster AG, Buchhaltung",
    billingStreet: "Postfach",
    billingZipCode: "3000",
    billingCity: "Bern",
    billingCountry: "CH",
  };

  it("addresses an invoice to the billing address with UID and customer number", async () => {
    const buf = await generateDocumentPdf(baseDoc({ customer: extended }), company, "de-CH", undefined);
    const text = (await extractText(buf)).pageText.join(" ");
    expect(text).toContain("Muster AG, Buchhaltung");
    expect(text).toContain("Postfach");
    expect(text).toContain("3000 Bern");
    expect(text).toContain("UID: CHE-116.281.710");
    expect(text).toContain("Kunden-Nr.:");
    expect(text).toContain("1042");
    expect(text).not.toContain("Hauptstrasse");
  });

  it("addresses a quote to the customer address without UID but with customer number", async () => {
    const buf = await generateDocumentPdf(
      baseDoc({ kind: "quote", title: "Offerte", customer: extended }),
      company,
      "de-CH",
      undefined
    );
    const text = (await extractText(buf)).pageText.join(" ");
    expect(text).toContain("Hauptstrasse 5");
    expect(text).toContain("8001 Zürich");
    expect(text).not.toContain("Postfach");
    expect(text).not.toContain("UID:");
    expect(text).toContain("1042");
  });

  it("omits Kunden-Nr. and UID for customers without them", async () => {
    const buf = await generateDocumentPdf(baseDoc(), company, "de-CH", undefined);
    const text = (await extractText(buf)).pageText.join(" ");
    expect(text).not.toContain("Kunden-Nr.");
    expect(text).not.toContain("UID:");
  });
```

**e) `tests/unit/reminder-pdf.test.ts`:** im `describe("generateReminderPdf", …)` anfügen (`invoice`, `settings`, `charges` und `extractText` existieren in der Datei):

```ts
  it("addresses the notice to the billing address with UID and shows the QR debtor", async () => {
    const withBilling = {
      ...(invoice as object),
      customer: {
        ...customer,
        customerNumber: 1042,
        uid: "CHE-116.281.710",
        billingName: "Muster AG, Buchhaltung",
        billingStreet: "Postfach",
        billingZipCode: "3000",
        billingCity: "Bern",
        billingCountry: "CH",
      },
    } as never;
    const { pageText } = await extractText(await generateReminderPdf(withBilling, settings, charges(2)));
    expect(pageText[0]).toContain("Muster AG, Buchhaltung");
    expect(pageText[0]).toContain("3000 Bern");
    expect(pageText[0]).toContain("UID: CHE-116.281.710");
    expect(pageText[0]).toContain("Kunden-Nr.:");
    expect(pageText[0]).not.toContain("8000 Zürich");
    // The QR slip (page 2) names the same debtor.
    expect(pageText[1]).toContain("Muster AG, Buchhaltung");
    expect(pageText[1]).toContain("Postfach");
  });
```

- [ ] **Step 2: Tests laufen lassen, Fehlschlag prüfen**

Run: `npx vitest run tests/unit/qrbill-data.test.ts tests/unit/receivables.test.ts tests/unit/email-send.test.ts`
Expected: FAIL (neue Tests).

- [ ] **Step 3: `qrbill-helpers.ts` anpassen**

Import oben ergänzen: `import { billingRecipient, type AddressCustomer } from "@/lib/customer-billing";`

Im Typ `QrBillInput` den Block `customer: { … };` ersetzen durch `customer: AddressCustomer;`.

In `buildQrBillData` die Zeilen `const debtorName = …;` (3 Zeilen) ersetzen durch `const debtor = billingRecipient(customer);` und den `debtor`-Block im Rückgabeobjekt ersetzen durch:

```ts
    debtor: {
      name: debtor.name,
      address: debtor.street,
      ...buildingNumberField(debtor.houseNumber),
      zip: debtor.zipCode,
      city: debtor.city,
      country: debtor.country,
    },
```

- [ ] **Step 4: `document-pdf.ts` anpassen**

Import ergänzen: `import { billingRecipient, customerRecipient, type BillingFields } from "@/lib/customer-billing";`

Im Typ `RenderDoc` den `customer: Pick<Customer, …>` erweitern zu:

```ts
  customer: Pick<
    Customer,
    | "contactInsteadOfCompany"
    | "company"
    | "contactPerson"
    | "street"
    | "houseNumber"
    | "zipCode"
    | "city"
    | "country"
  > &
    BillingFields;
```

Den Abschnitt „Customer address“ (ab `const displayName = …` bis zum `addrLines`-Array) ersetzen durch:

```ts
    // Invoices, credit notes and reminders go to the billing address; quotes always to the customer.
    const recipient = doc.kind === "quote" ? customerRecipient(customer) : billingRecipient(customer);
    const addrLines = [
      recipient.name,
      recipient.contactLine,
      formatStreetLine(recipient.street, recipient.houseNumber),
      formatCityLine(recipient.zipCode, recipient.city),
      foreignCountryLine(recipient.country),
      recipient.uid ? `UID: ${recipient.uid}` : null,
    ].filter(Boolean) as string[];
```

Direkt nach `const detailRows: string[][] = [ … ];` (nach dem `["Datum:", …]`-Eintrag, vor `if (doc.dueDate !== null)`) einfügen:

```ts
    if (customer.customerNumber != null) detailRows.push(["Kunden-Nr.:", String(customer.customerNumber)]);
```

- [ ] **Step 5: PDF manuell prüfen**

Run: `npx vitest run tests/unit/document-pdf-generation.test.ts`
Expected: PASS. Danach in der laufenden App (`npm run dev`) einen Kunden mit Rechnungsadresse, UID und Kundennummer anlegen, eine Entwurfsrechnung öffnen (`/api/invoices/<id>/pdf`) und prüfen: Empfängerblock zeigt Rechnungsadresse und „UID: …“, „Kunden-Nr.:“ steht im Kopf, die QR-Seite nennt dieselbe Adresse als Zahlungspflichtigen; eine Offerte desselben Kunden zeigt die Kundenadresse ohne UID; die Mahnbeleg-Vorschau (`/api/reminders/<id>/pdf` einer überfälligen Rechnung) zeigt wie die Rechnung die Rechnungsadresse.

- [ ] **Step 6: `receivables.ts` anpassen**

Import ergänzen: `import { hasBillingAddress, type BillingFields } from "@/lib/customer-billing";`

Im Typ `ReceivableInput.customer` ein `& BillingFields` an das Objekt-Literal hängen (aus `customer: { … };` wird `customer: { … } & BillingFields;`; die Typzeile endet sonst mit `};`).

Den `customerAddress`-Block ersetzen durch:

```ts
      customerAddress: hasBillingAddress(inv.customer)
        ? {
            street: [inv.customer.billingStreet, inv.customer.billingHouseNumber].filter(Boolean).join(" "),
            zip: inv.customer.billingZipCode ?? "",
            city: inv.customer.billingCity ?? "",
            country: inv.customer.billingCountry ?? "CH",
          }
        : {
            street: [inv.customer.street, inv.customer.houseNumber].filter(Boolean).join(" "),
            zip: inv.customer.zipCode ?? "",
            city: inv.customer.city ?? "",
            country: inv.customer.country ?? "",
          },
```

- [ ] **Step 7: Mailempfänger anpassen**

- `lib/email.ts`: Import `import { billingEmail } from "@/lib/customer-billing";` und in `sendInvoiceEmail` die Zeile `const to = overrides?.to ?? invoice.customer.email;` → `const to = overrides?.to ?? billingEmail(invoice.customer);`. Die Zeile für Offerten (`quote.customer.email`) bleibt unverändert.
- `lib/subscriptions.ts`: Import ergänzen und `to: sub.customer.email,` → `to: billingEmail(sub.customer),`.
- `app/(app)/invoices/[id]/page.tsx`: `customerEmail={invoice.customer.email}` → `customerEmail={billingEmail(invoice.customer)}` plus Import.
- `app/(app)/invoices/reminders/page.tsx`: `customerEmail={c.email}` → `customerEmail={billingEmail(c)}` plus Import (`c` ist dort `inv.customer`). Der Versand selbst (`sendReminder` in `app/(app)/invoices/reminders/actions.ts`) nimmt die Adresse aus dem Formularfeld `to` und braucht keine Änderung.

- [ ] **Step 8: Tests und Typen prüfen**

Run: `npx tsc --noEmit; npx vitest run tests/unit tests/integration/subscriptions.test.ts tests/integration/subscriptions-send-e2e.test.ts tests/integration/receivables.test.ts`
Expected: PASS. Schlägt ein Subscription-Test fehl, weil er `to` des `PendingEmail` prüft, ist das erwartete Verhalten nur dann falsch, wenn der Test Billing-Daten setzt; sonst Implementierung prüfen.

- [ ] **Step 9: Integrationstest für Abo mit Rechnungs-E-Mail**

In `tests/integration/subscriptions.test.ts` den Helfer `seedSubscription` um eine Kunden-Überschreibung erweitern: den Typ von `overrides` um `customer: Record<string, unknown>` ergänzen und im `customer.create`-Aufruf nach `archivedAt: …` die Zeile `...overrides.customer,` einfügen. Dann nach dem Test „creates an empty draft when the subscription has no template“ anfügen:

```ts
  it("sends to the billing e-mail when the customer has one", async () => {
    await seedSubscription({ customer: { billingEmail: "buchhaltung@clientag.ch" } });
    await checkSubscriptions(db.prisma);
    const pending = await db.prisma.pendingEmail.findMany();
    expect(pending).toHaveLength(1);
    expect(pending[0].to).toBe("buchhaltung@clientag.ch");
  });
```

(Der vorhandene Test oben beweist mit `to === "jane@clientag.ch"` die Rückfallebene ohne Rechnungs-E-Mail.)

Run: `npx vitest run tests/integration/subscriptions.test.ts`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add lib app tests
git commit -m "feat(invoices): send invoices to the billing address and e-mail"
```

---

### Task 6: Kundenspezifische Zahlungsfrist

**Files:**
- Modify: `app/(app)/quotes/actions.ts` (`convertQuoteToInvoice`)
- Modify: `lib/subscriptions.ts` (`paymentDays`)
- Modify: `app/(app)/invoices/InvoiceForm.tsx`, `components/customer-combobox.tsx`
- Test: `tests/unit/quote-actions.test.ts`, `tests/integration/subscriptions.test.ts`

**Interfaces:**
- Consumes: `effectivePaymentTermDays` (Task 1).
- Produces: `CustomerCombobox` bekommt die optionale Prop `onValueChange?: (customer: Customer | null) => void`.

- [ ] **Step 1: Failing Tests schreiben**

**a) `tests/unit/quote-actions.test.ts`:** im `describe("convertQuoteToInvoice", …)` nach dem Test „creates invoice, marks quote as Accepted, and redirects“ anfügen:

```ts
    it("uses the customer's payment term for the due date", async () => {
      vi.mocked(auth).mockResolvedValue(editorSession);
      vi.mocked(prisma.quote.findUnique).mockResolvedValue({
        id: 1,
        customerId: 10,
        customUserText: null,
        totalAmount: 500,
        items: [],
        customer: { paymentTermDays: 10 },
      } as never);
      vi.mocked(prisma.applicationSettings.findFirst).mockResolvedValue({
        defaultPaymentTermDays: 30,
      } as never);
      vi.mocked(prisma.invoice.create).mockResolvedValue({ id: 99 } as never);
      vi.mocked(prisma.quote.update).mockResolvedValue({} as never);
      vi.mocked(prisma.$transaction).mockImplementation((cb: (tx: typeof prisma) => Promise<unknown>) => cb(prisma));
      vi.mocked(redirect).mockImplementation(() => {
        throw new Error("REDIRECT:/invoices/99");
      });

      await expect(convertQuoteToInvoice(1)).rejects.toThrow("REDIRECT:/invoices/99");
      const data = vi.mocked(prisma.invoice.create).mock.calls[0][0].data as { date: Date; dueDate: Date };
      const days = Math.round((data.dueDate.getTime() - data.date.getTime()) / 86_400_000);
      expect(days).toBe(10);
    });
```

(Der bestehende Test mit `defaultPaymentTermDays: 30` ohne `customer` im Mock beweist die Rückfallebene.)

**b) `tests/integration/subscriptions.test.ts`:** (Helfer `seedSubscription` mit `customer`-Überschreibung wie in Task 5 Step 9) nach dem Test „sends to the billing e-mail…“ anfügen:

```ts
  it("uses the customer's payment term for the invoice due date", async () => {
    await db.prisma.applicationSettings.create({ data: { defaultPaymentTermDays: 30 } });
    await seedSubscription({ customer: { paymentTermDays: 14 } });
    await checkSubscriptions(db.prisma);
    const [invoice] = await db.prisma.invoice.findMany();
    const days = Math.round((invoice.dueDate.getTime() - invoice.date.getTime()) / 86_400_000);
    expect(days).toBe(14);
  });
```

Falls `applicationSettings.create` weitere Pflichtfelder verlangt, die Einstellungen so anlegen, wie es andere Tests in `tests/integration/` tun (`grep -rn "applicationSettings.create" tests/integration`); `checkSubscriptions` liest die Einstellungen mit `findFirst` samt `companyInfo` (siehe `lib/subscriptions.ts`), ohne Einstellungen gilt die Frist 30.

- [ ] **Step 2: Tests laufen lassen, Fehlschlag prüfen**

Run: `npx vitest run tests/unit/quote-actions.test.ts tests/integration/subscriptions.test.ts`
Expected: FAIL (neue Tests).

- [ ] **Step 3: Server-Stellen anpassen**

`app/(app)/quotes/actions.ts`: Import `import { effectivePaymentTermDays } from "@/lib/customer-billing";`. In `convertQuoteToInvoice` die Abfrage erweitern:

```ts
  const quote = await prisma.quote.findUnique({
    where: { id: quoteId },
    include: { items: true, customer: { select: { paymentTermDays: true } } },
  });
```

und `const paymentTermDays = settings?.defaultPaymentTermDays ?? 30;` ersetzen durch:

```ts
  const paymentTermDays = effectivePaymentTermDays(quote.customer, settings?.defaultPaymentTermDays ?? 30);
```

`lib/subscriptions.ts`: Import ergänzen (zusammen mit `billingEmail` aus Task 5: `import { billingEmail, effectivePaymentTermDays } from "@/lib/customer-billing";`). Die Zeile `const paymentDays = settings?.defaultPaymentTermDays ?? 30;` ersetzen durch `const defaultPaymentDays = settings?.defaultPaymentTermDays ?? 30;` und in der Schleife (vor `const dueDate = new Date(today);`) einfügen:

```ts
    const paymentDays = effectivePaymentTermDays(sub.customer, defaultPaymentDays);
```

- [ ] **Step 4: Tests laufen lassen**

Run: `npx vitest run tests/unit tests/integration/subscriptions.test.ts`
Expected: PASS. Unit-Tests, die `prisma.quote.findUnique` ohne `customer` mocken, funktionieren, weil `effectivePaymentTermDays` `undefined` akzeptiert.

- [ ] **Step 5: `CustomerCombobox` um `onValueChange` erweitern**

In `components/customer-combobox.tsx` `onValueChange?: (customer: Customer | null) => void` zu `Props` hinzufügen, die Komponente erhält `onValueChange` in der Destrukturierung und gibt es an `ComboboxRoot` weiter:

```tsx
      onValueChange={(value) => onValueChange?.((value as Customer | null) ?? null)}
```

(als zusätzliche Prop neben `name={name}`).

- [ ] **Step 6: `InvoiceForm` anpassen**

Den Block ab `const defaultDate = …` bis `function handleDateChange` (inkl. `useState(defaultDueDate)`) ersetzen durch:

```tsx
  const defaultDate = invoice
    ? new Date(invoice.date).toISOString().split("T")[0]
    : today;

  const initialCustomer =
    customers.find((c) => c.customerId === (invoice?.customerId ?? defaultCustomerId)) ?? null;
  // Term of the selected customer, else the global default. Existing invoices keep their due date.
  const [termDays, setTermDays] = useState(
    effectivePaymentTermDays(initialCustomer, defaultPaymentTermDays)
  );
  const [invoiceDate, setInvoiceDate] = useState(defaultDate);
  const defaultDueDate = invoice
    ? new Date(invoice.dueDate).toISOString().split("T")[0]
    : addDays(defaultDate, termDays);

  const [dueDate, setDueDate] = useState(defaultDueDate);

  function handleDateChange(value: string) {
    setInvoiceDate(value);
    setDueDate(addDays(value, termDays));
  }

  function handleCustomerChange(customer: Customer | null) {
    const days = effectivePaymentTermDays(customer, defaultPaymentTermDays);
    setTermDays(days);
    if (!invoice) setDueDate(addDays(invoiceDate, days));
  }
```

Die danach folgende Zeile `const defaultCustomer = customers.find(…) ?? null;` ersetzen durch `const defaultCustomer = initialCustomer;`. Im JSX `onValueChange={handleCustomerChange}` an `<CustomerCombobox …>` ergänzen. Import ergänzen: `import { effectivePaymentTermDays } from "@/lib/customer-billing";`. Prüfen, dass `addDays` mit `(isoDate: string, days: number)` aufgerufen wird (`lib/date.ts`).

- [ ] **Step 7: Verhalten manuell prüfen**

Run: `npx tsc --noEmit; npm run lint`
Dann in der App: Kunde mit Frist 10 Tagen anlegen, `/invoices/new` öffnen, Kunden wählen → Fälligkeitsdatum = Datum + 10; Kunden ohne Frist wählen → Datum + globale Frist; Rechnungsdatum ändern → Fälligkeit folgt der Frist des gewählten Kunden; beim Bearbeiten einer bestehenden Rechnung bleibt die Fälligkeit beim Öffnen unverändert.

- [ ] **Step 8: Commit**

```bash
git add "app/(app)/quotes/actions.ts" lib/subscriptions.ts "app/(app)/invoices/InvoiceForm.tsx" components/customer-combobox.tsx tests
git commit -m "feat(invoices): use the customer's payment term for due dates"
```

---

### Task 7: Formular, Detailansicht, Liste, Suche und Export

**Files:**
- Modify: `app/(app)/customers/CustomerForm.tsx`
- Modify: `app/(app)/customers/page.tsx`
- Modify: `lib/search.ts`
- Modify: `app/api/export/customers/route.ts`
- Test: `tests/integration/export-customers-route.test.ts`, `tests/integration/search.test.ts`

**Interfaces:**
- Consumes: Formularfelder aus Task 3 (`customerNumber`, `uid`, `paymentTermDays`, `billing*`), `COUNTRIES`, `ADDRESS_LIMITS`.
- Produces: Kundenliste mit Spalte „Kunden-Nr.“; Suche (Liste und Global) findet die Kundennummer; CSV mit neuen Spalten.

- [ ] **Step 1: Failing Tests schreiben**

**a) `tests/integration/search.test.ts`:** nach dem Test „should find customers by company, contactPerson, email and city“ anfügen (der Helfer `seedCustomer` existiert):

```ts
  it("should find a customer by its exact customer number", async () => {
    const { prisma } = db;
    await seedCustomer({ company: "Nummer AG", customerNumber: 1042 } as never);
    await seedCustomer({ company: "Andere AG", customerNumber: 1043 } as never);

    const hit = await searchGlobal(prisma, "1042");
    expect(hit.customers.map((c) => c.company)).toEqual(["Nummer AG"]);

    const none = await searchGlobal(prisma, "1044");
    expect(none.customers).toHaveLength(0);
  });
```

**b) `tests/integration/export-customers-route.test.ts`:** am Ende des `describe` anfügen:

```ts
  it("exports customer number, UID, billing data, payment term and contacts", async () => {
    currentSession = sessionFor("Editor");
    await db.prisma.customer.create({
      data: {
        ...createValidTestCustomer(),
        contactPerson: "Extended",
        email: "ext@example.ch",
        customerNumber: 1042,
        uid: "CHE-116.281.710",
        paymentTermDays: 10,
        billingName: "Muster AG, Buchhaltung",
        billingStreet: "Postfach",
        billingHouseNumber: "7",
        billingZipCode: "3000",
        billingCity: "Bern",
        billingCountry: "CH",
        billingEmail: "buchhaltung@example.ch",
        contacts: {
          create: [
            { name: "Buchhaltung", role: "Buchhaltung", email: "b@x.ch" },
            { name: "Einkauf", email: "e@x.ch" },
          ],
        },
      },
    });

    const res = await GET();
    const [header, line] = (await res.text()).split("\n");
    expect(header).toBe(
      "ID,Kunden-Nr.,Firma,Kontaktperson,Strasse,Hausnummer,PLZ,Ort,Land,E-Mail,Telefon,UID," +
        "Zahlungsfrist (Tage),Rechnungsname,Rechnungsstrasse,Rechnungs-PLZ,Rechnungsort,Rechnungsland," +
        "Rechnungs-E-Mail,Weitere Kontakte,Abos"
    );
    expect(line).toContain(",1042,");
    expect(line).toContain("CHE-116.281.710");
    expect(line).toContain("Postfach 7");
    expect(line).toContain("buchhaltung@example.ch");
    expect(line).toContain("Buchhaltung (Buchhaltung) <b@x.ch>; Einkauf <e@x.ch>");
  });
```

Der bestehende Test „lists distinct active subscription intervals…“ bleibt gültig (`header.endsWith(",Abos")`, das Zeilenende prüft nur die letzte Spalte).

- [ ] **Step 2: Tests laufen lassen, Fehlschlag prüfen**

Run: `npx vitest run tests/integration/search.test.ts tests/integration/export-customers-route.test.ts`
Expected: FAIL (neue/angepasste Tests).

- [ ] **Step 3: Suche erweitern**

`lib/search.ts`: Direkt vor dem `Promise.all` einfügen:

```ts
  // Customer numbers are integers: match them exactly, only for purely numeric terms.
  const numberMatch = /^\d{1,9}$/.test(q) ? [{ customerNumber: Number(q) }] : [];
```

und im Kunden-`where.OR` (neben `{ city: { contains: q } }`) `...numberMatch,` ergänzen.

`app/(app)/customers/page.tsx`: Im `where`-Objekt nach `{ city: { contains: term } },` ergänzen: `...(/^\d{1,9}$/.test(term) ? [{ customerNumber: Number(term) }] : []),`. In der Tabelle: vor `<TableHead>` für „Firma / Kontakt“ eine `<TableHead>Kunden-Nr.</TableHead>` einfügen (ohne Sortierung) und in der Zeile vor der ersten `<TableCell>` `<TableCell>{c.customerNumber ?? "—"}</TableCell>`; `colSpan` der Leer-Zeile um 1 erhöhen.

- [ ] **Step 4: Export erweitern**

`app/api/export/customers/route.ts`:

```ts
  const customers = await prisma.customer.findMany({
    orderBy: { contactPerson: "asc" },
    include: {
      subscriptions: { where: { active: true }, select: { interval: true } },
      contacts: { orderBy: { createdAt: "asc" } },
    },
  });

  const headers = [
    "ID", "Kunden-Nr.", "Firma", "Kontaktperson", "Strasse", "Hausnummer", "PLZ", "Ort", "Land",
    "E-Mail", "Telefon", "UID", "Zahlungsfrist (Tage)", "Rechnungsname", "Rechnungsstrasse",
    "Rechnungs-PLZ", "Rechnungsort", "Rechnungsland", "Rechnungs-E-Mail", "Weitere Kontakte", "Abos",
  ];
  const rows = customers.map((c) => [
    c.customerId,
    c.customerNumber ?? "",
    c.company ?? "",
    c.contactPerson,
    c.street,
    c.houseNumber ?? "",
    c.zipCode,
    c.city,
    c.country,
    c.email,
    c.phone ?? "",
    c.uid ?? "",
    c.paymentTermDays ?? "",
    c.billingName ?? "",
    [c.billingStreet, c.billingHouseNumber].filter(Boolean).join(" "),
    c.billingZipCode ?? "",
    c.billingCity ?? "",
    c.billingCountry ?? "",
    c.billingEmail ?? "",
    c.contacts
      .map((k) => `${k.name}${k.role ? ` (${k.role})` : ""}${k.email ? ` <${k.email}>` : ""}`)
      .join("; "),
    [...new Set(c.subscriptions.map((s) => INTERVAL_LABELS[s.interval]))].join(", "),
  ]);
```

(`csvResponse`-Zeile darunter bleibt.)

- [ ] **Step 5: Tests laufen lassen**

Run: `npx vitest run tests/integration/search.test.ts tests/integration/export-customers-route.test.ts`
Expected: PASS.

- [ ] **Step 6: `CustomerForm` erweitern**

In `app/(app)/customers/CustomerForm.tsx`:

**Nur-Lesen-Ansicht:** Nach dem Block `{customer.phone && (…)}` (vor `contactInsteadOfCompany`) einfügen:

```tsx
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
```

**Bearbeiten/Neu-Formular:** Direkt **nach** dem `<div className="flex flex-col gap-3 pt-1">…</div>` mit der Checkbox „Kontaktperson statt Firma anzeigen“ und **vor** dem Button-Block `<div className="flex justify-end gap-2 pt-2">` einfügen:

```tsx
            <details
              className="rounded-lg border border-input px-3 py-2"
              open={Boolean(
                customer &&
                  (customer.uid ||
                    customer.paymentTermDays != null ||
                    customer.billingStreet ||
                    customer.billingEmail)
              ) || Object.keys(fe).some((k) => k === "customerNumber" || k === "uid" || k === "paymentTermDays" || k.startsWith("billing"))}
            >
              <summary className="cursor-pointer text-sm font-medium">Weitere Angaben</summary>
              <div className="space-y-4 pt-3">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="customerNumber">Kundennummer</Label>
                    <Input
                      id="customerNumber"
                      name="customerNumber"
                      inputMode="numeric"
                      defaultValue={customer?.customerNumber ?? ""}
                      placeholder={customer ? "" : "automatisch"}
                      aria-invalid={!!fe.customerNumber}
                      aria-describedby={fe.customerNumber ? "customerNumber-error" : undefined}
                    />
                    <FieldError id="customerNumber-error" message={fe.customerNumber} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="uid">UID</Label>
                    <Input
                      id="uid"
                      name="uid"
                      defaultValue={customer?.uid ?? ""}
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
                      defaultValue={customer?.paymentTermDays ?? ""}
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
                    defaultValue={customer?.billingName ?? ""}
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
                      defaultValue={customer?.billingStreet ?? ""}
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
                      defaultValue={customer?.billingHouseNumber ?? ""}
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
                      defaultValue={customer?.billingZipCode ?? ""}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="billingCity">Ort</Label>
                    <Input
                      id="billingCity"
                      name="billingCity"
                      maxLength={ADDRESS_LIMITS.city}
                      defaultValue={customer?.billingCity ?? ""}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="billingCountry">Land</Label>
                    <Select name="billingCountry" defaultValue={customer?.billingCountry ?? "CH"}>
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
                    defaultValue={customer?.billingEmail ?? ""}
                    placeholder="buchhaltung@beispiel.ch"
                    aria-invalid={!!fe.billingEmail}
                    aria-describedby={fe.billingEmail ? "billingEmail-error" : undefined}
                  />
                  <FieldError id="billingEmail-error" message={fe.billingEmail} />
                </div>
              </div>
            </details>
```

Hinweis: Das Land-Select sendet immer einen Wert („CH“); ohne Strasse/PLZ/Ort verwirft `customerData` (Task 3) Land und Name, ein leerer Abschnitt bleibt also folgenlos.

- [ ] **Step 7: Typen, Lint, Tests**

Run: `npx tsc --noEmit; npm run lint; npm test`
Expected: alles grün.

- [ ] **Step 8: UI manuell prüfen**

Mit `npm run dev`: (a) Neuer Kunde ohne Weitere Angaben → Formular wie vorher, Kunde bekommt automatisch die nächste Kundennummer; (b) „Weitere Angaben“ ausfüllen (UID `CHE-116.281.710`, Frist 10, Rechnungsadresse und -E-Mail) → Detailansicht zeigt die Werte, Bearbeiten öffnet den Abschnitt; (c) ungültige UID und halbe Rechnungsadresse zeigen Fehler und der Abschnitt bleibt offen; (d) Kontakt hinzufügen/ändern/löschen; (e) Kundenliste zeigt „Kunden-Nr.“ und die Suche nach der Nummer findet den Kunden; (f) Kunden-Export (CSV) enthält die neuen Spalten.

- [ ] **Step 9: Commit**

```bash
git add "app/(app)/customers" lib/search.ts app/api/export/customers/route.ts tests
git commit -m "feat(customers): extended customer form, list search and export"
```

---

### Task 8: Seed, Doku und Abschluss

**Files:**
- Modify: `prisma/seed.ts`
- Modify: `CLAUDE.md`
- Modify: `FEATURE_ANALYSE.md`

**Interfaces:**
- Consumes: alles aus Tasks 1–7.

- [ ] **Step 1: Seed anpassen**

In `prisma/seed.ts` bei `prisma.customer.create` (Zeile ~131) das `data`-Objekt um `customerNumber: 1001 + index` erweitern (die Schleifenvariable der Kunden verwenden; gibt es keinen Index, einen Zähler vor der Schleife anlegen). Für die ersten zwei Kunden zusätzlich Beispielwerte: `uid: "CHE-116.281.710"`, `paymentTermDays: 10`, Rechnungsadresse und `billingEmail`, sowie einen Kontakt via `contacts: { create: [{ name: "Buchhaltung", role: "Buchhaltung", email: "buchhaltung@example.ch" }] }`.

Run: `npm run db:seed` gegen eine frische lokale DB (`npx prisma migrate reset --force` setzt sie zurück; nur lokal).
Expected: läuft ohne Fehler durch.

- [ ] **Step 2: `CLAUDE.md` ergänzen**

Im Abschnitt „Business document workflow“ einen Aufzählungspunkt anfügen:

```markdown
- **Extended customer model** (`lib/customer-billing.ts`, `lib/customer-uid.ts`, `lib/customer-number.ts`): `Customer` has an optional `customerNumber` (assigned as max + 1 from 1001 by `createCustomer`, retried on a `P2002` collision; empty on edit keeps it), `uid` (normalized `CHE-123.456.789`, mod-11 check digit), a billing address (`billingName/Street/HouseNumber/ZipCode/City/Country`, set only when street, zip and city are all filled, otherwise the other billing fields are dropped), `billingEmail` and `paymentTermDays` (`null` = `ApplicationSettings.defaultPaymentTermDays`). Everything that addresses a customer goes through the helpers: `billingRecipient` for invoice and reminder PDFs, QR-bill debtor and the open-items address, `billingEmail` for invoice/reminder mails, subscription mails and the send dialogs, `effectivePaymentTermDays` for invoice dates, quote conversion and subscriptions. Quotes always use `customerRecipient` and `customer.email` (no UID, no billing data). `CustomerContact` rows are informational only (no mail routing). Archived PDFs are never re-rendered, so later changes do not affect them
```

- [ ] **Step 3: `FEATURE_ANALYSE.md` abhaken**

`- [ ] 12. F10 erweitertes Kundenmodell` → `- [x] 12. F10 erweitertes Kundenmodell`.

- [ ] **Step 4: Gesamtverifikation**

Run: `npm run lint; npx tsc --noEmit; npm test; npm run build`
Expected: Lint ohne Fehler, Typecheck sauber, alle Tests grün, Build erfolgreich. Schlägt etwas fehl, die Ursache beheben (nicht überspringen) und erneut ausführen.

- [ ] **Step 5: Commit**

```bash
git add prisma/seed.ts CLAUDE.md FEATURE_ANALYSE.md
git commit -m "docs: document the extended customer model and update seed"
```
