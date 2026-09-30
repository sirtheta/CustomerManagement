# F11 Flexible Abos Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `Customer.yearlyInvoice` / `nextInvoiceDate` werden durch mehrere `Subscription`-Abos pro Kunde ersetzt (monatlich, quartalsweise, jährlich); der Job erzeugt die Rechnung mit Positionen aus einer `InvoiceTemplate`, optional mit automatischem Versand.

**Architecture:** Neues Prisma-Modell `Subscription` mit Datenmigration der Altkunden. `lib/subscription-dates.ts` (reine Datumslogik) und `lib/subscriptions.ts` (Job `checkSubscriptions`) ersetzen `lib/yearly-invoices.ts`. Der Versandteil von `approvePendingEmail` wird nach `lib/pending-email-send.ts` extrahiert und vom Job für `autoSend` wiederverwendet. UI: Sektion «Abos» auf der Kundenseite, Server Actions in `customers/subscription-actions.ts`.

**Tech Stack:** Next.js 16 (App Router, Server Actions), Prisma 7 + SQLite (better-sqlite3 Adapter), Vitest, Tailwind 4, shadcn-Komponenten.

**Spec:** `docs/superpowers/specs/2026-09-30-f11-flexible-abos-design.md`

## Global Constraints

- UI-Texte, Fehlermeldungen und Doku sind **auf Deutsch**; Commit-Messages **auf Englisch** (Conventional Commits, z. B. `feat(subscriptions): …`). Jede Commit-Message endet mit `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Next.js 16: vor Änderungen an Routing/Data-Fetching `node_modules/next/dist/docs/` prüfen. Dieser Plan nutzt nur bestehende Muster (Server Components, `"use server"`-Dateien, `useActionState`).
- `logAudit` / `logAuditEntry` **nie** innerhalb eines `$transaction`-Callbacks aufrufen. Nie direkt `prisma.auditLog.create`.
- `"use server"`-Dateien exportieren nur async-Funktionen. Lib-Dateien unter `lib/` haben **kein** `"use server"`.
- Rechnungs-Entwürfe haben `documentNumber = null`; die Nummer wird erst beim Versand/Freigeben über `assignDocumentNumber` vergeben.
- Nach jeder Task: `npx vitest run <betroffene Dateien>` grün, am Ende `npm test`, `npm run lint` und `npx tsc --noEmit`.
- Tests: `createTestDatabase()` (`tests/test-utils.ts`) baut die DB per `prisma db push` aus `schema.prisma`; die globale `@/lib/prisma`-Instanz ist in `tests/setup.ts` auf eine In-Memory-DB gemockt.

## Dateiübersicht

| Datei | Aktion | Verantwortung |
|---|---|---|
| `prisma/schema.prisma` | ändern | `Subscription`, `SubscriptionInterval`; `Customer`-Felder entfallen |
| `prisma/migrations/20260930160000_subscriptions/migration.sql` | neu | Tabelle, Datenkopie, Spalten entfernen |
| `lib/subscription-dates.ts` | neu | `addInterval`, `advancePast`, `INTERVAL_LABELS` |
| `lib/subscriptions.ts` | neu | Job `checkSubscriptions`, `SYSTEM_ACTOR` |
| `lib/yearly-invoices.ts` | löschen | ersetzt |
| `lib/pending-email-send.ts` | neu | `sendPendingInvoice` (aus `approvePendingEmail` extrahiert) |
| `app/(app)/invoices/pending/actions.ts` | ändern | delegiert an `sendPendingInvoice` |
| `app/(app)/customers/subscription-actions.ts` | neu | CRUD + Pausieren |
| `app/(app)/customers/SubscriptionsSection.tsx` | neu | UI-Sektion |
| `app/(app)/customers/[id]/page.tsx`, `CustomerForm.tsx`, `actions.ts`, `page.tsx` | ändern | Abos einbinden, Jahresfelder entfernen, Filter |
| `app/(app)/dashboard/page.tsx`, `app/api/export/customers/route.ts` | ändern | Abos statt Jahresrechnung |
| `lib/notifications.ts`, `app/(app)/settings/actions.ts`, `app/(app)/settings/DevToolsCard.tsx` | ändern | Job umbenennen |
| `lib/audit.ts` | ändern | `AuditEntity` um `"Subscription"` |
| `prisma/seed.ts`, `scripts/seed-manual-demo.ts`, `scripts/migrate-data.mjs` | ändern | Abos statt Jahresfelder |
| Tests, CLAUDE.md, `FEATURE_ANALYSE.md`, `public/benutzerhandbuch.html` | ändern | siehe Tasks |

---

### Task 1: Schema, Migration und Testbasis

**Files:**
- Modify: `prisma/schema.prisma` (Customer ab Zeile 9, `InvoiceTemplate` ab Zeile 172)
- Create: `prisma/migrations/20260930160000_subscriptions/migration.sql`
- Modify: `tests/test-utils.ts:54-66,95`
- Modify: `tests/unit/document-pdf-generation.test.ts:329-331`, `tests/unit/qrbill-data.test.ts:163-165` (nur `yearlyInvoice`/`nextInvoiceDate` aus Kunden-Fixtures entfernen)
- Test: `tests/integration/subscription-migration.test.ts`

**Interfaces:**
- Produces: Prisma-Modell `Subscription { id, customerId, templateId?, interval: SubscriptionInterval, nextInvoiceDate: Date, autoSend: boolean, active: boolean, createdAt }`; Enum `SubscriptionInterval = Monthly | Quarterly | Yearly`; Relationen `Customer.subscriptions`, `InvoiceTemplate.subscriptions`. `createValidTestCustomer()` ohne `yearlyInvoice`.

- [ ] **Step 1: Schema ändern**

In `model Customer` die Zeilen `yearlyInvoice Boolean @default(false)`, `nextInvoiceDate DateTime?` und `@@index([nextInvoiceDate])` entfernen, und nach `notes CustomerNote[]` einfügen:

```prisma
  subscriptions           Subscription[]
```

In `model InvoiceTemplate` nach `items TemplateItem[]` einfügen:

```prisma
  subscriptions Subscription[]
```

Am Ende der Datei (oder nach `TemplateItem`) ergänzen:

```prisma
enum SubscriptionInterval {
  Monthly
  Quarterly
  Yearly
}

model Subscription {
  id              Int                  @id @default(autoincrement())
  customerId      Int
  templateId      Int?
  interval        SubscriptionInterval
  nextInvoiceDate DateTime
  autoSend        Boolean              @default(false)
  active          Boolean              @default(true)
  createdAt       DateTime             @default(now())
  customer        Customer             @relation(fields: [customerId], references: [customerId], onDelete: Cascade)
  template        InvoiceTemplate?     @relation(fields: [templateId], references: [id], onDelete: SetNull)

  @@index([nextInvoiceDate])
  @@index([customerId])
}
```

- [ ] **Step 2: Migration erzeugen und Datenkopie einfügen**

Run: `npx prisma migrate dev --name subscriptions --create-only`
Das legt `prisma/migrations/<timestamp>_subscriptions/migration.sql` an. Den Ordner **immer** in genau `20260930160000_subscriptions` umbenennen (der Migrationstest referenziert diesen Namen, und er sortiert nach `20260930150000_sent_document`). Im generierten SQL direkt **nach** dem `CREATE TABLE "Subscription" (…)`-Statement und **vor** dem ersten `PRAGMA`/`CREATE TABLE "new_Customer"` einfügen:

```sql
-- Existing yearly customers become one Yearly subscription each (no template,
-- manual approval), keeping their planned date.
INSERT INTO "Subscription" ("customerId", "interval", "nextInvoiceDate", "autoSend", "active")
SELECT "customerId", 'Yearly', "nextInvoiceDate", false, true
FROM "Customer"
WHERE "yearlyInvoice" = true AND "nextInvoiceDate" IS NOT NULL;
```

Prüfen, dass das generierte SQL die Spalten `yearlyInvoice`/`nextInvoiceDate` und den Index `Customer_nextInvoiceDate_idx` entfernt und die `Subscription`-Indizes/Fremdschlüssel anlegt. Danach: `npx prisma migrate dev` (wendet an, muss ohne Drift-Meldung laufen) und `npx prisma generate`.

- [ ] **Step 3: Failing test für die Migration schreiben**

`tests/integration/subscription-migration.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { readdirSync, readFileSync } from "fs";
import { join } from "path";

const MIGRATIONS = join(process.cwd(), "prisma", "migrations");
const TARGET = "20260930160000_subscriptions";

function applyUpTo(db: Database.Database, includeTarget: boolean) {
  const folders = readdirSync(MIGRATIONS, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
  for (const name of folders) {
    if (name === TARGET && !includeTarget) break;
    db.exec(readFileSync(join(MIGRATIONS, name, "migration.sql"), "utf8"));
    if (name === TARGET) break;
  }
}

describe("subscriptions migration", () => {
  it("turns yearly customers into Yearly subscriptions and drops the old columns", () => {
    const db = new Database(":memory:");
    applyUpTo(db, false);

    const insert = db.prepare(
      `INSERT INTO "Customer" ("contactPerson","street","city","zipCode","email","yearlyInvoice","nextInvoiceDate")
       VALUES (?,?,?,?,?,?,?)`
    );
    const date = new Date("2027-03-01T00:00:00.000Z").getTime();
    insert.run("Yearly Kunde", "Weg", "Bern", "3000", "a@test.ch", 1, date);
    insert.run("Ohne Abo", "Weg", "Bern", "3000", "b@test.ch", 0, null);
    insert.run("Jahr ohne Datum", "Weg", "Bern", "3000", "c@test.ch", 1, null);

    db.exec(readFileSync(join(MIGRATIONS, TARGET, "migration.sql"), "utf8"));

    const subs = db.prepare(`SELECT * FROM "Subscription"`).all() as Record<string, unknown>[];
    expect(subs).toHaveLength(1);
    expect(subs[0]).toMatchObject({ interval: "Yearly", autoSend: 0, active: 1, templateId: null });
    expect(subs[0].nextInvoiceDate).toBe(date);

    const cols = (db.prepare(`PRAGMA table_info("Customer")`).all() as { name: string }[]).map((c) => c.name);
    expect(cols).not.toContain("yearlyInvoice");
    expect(cols).not.toContain("nextInvoiceDate");
    expect(db.prepare(`SELECT count(*) AS n FROM "Customer"`).get()).toEqual({ n: 3 });
  });
});
```

Falls `Customer` zum Zeitpunkt vor der Migration weitere NOT-NULL-Spalten ohne Default hat, die der INSERT nicht setzt, die Spaltenliste im Test entsprechend ergänzen (`PRAGMA table_info("Customer")` nach `applyUpTo` zeigt sie).

- [ ] **Step 4: Test laufen lassen**

Run: `npx vitest run tests/integration/subscription-migration.test.ts`
Expected: PASS (Migration aus Step 2 existiert bereits; schlägt der Test fehl, SQL in Step 2 korrigieren, nicht den Test aufweichen).

- [ ] **Step 5: Test-Fixtures bereinigen**

In `tests/test-utils.ts`: `yearlyInvoice: false,` aus `createValidTestCustomer` entfernen; in `beforeEach` vor `await p.customer.deleteMany();` einfügen:

```ts
    await p.subscription.deleteMany();
    await p.templateItem.deleteMany();
    await p.invoiceTemplate.deleteMany();
```

In `tests/unit/document-pdf-generation.test.ts` und `tests/unit/qrbill-data.test.ts` die Felder `yearlyInvoice`/`nextInvoiceDate` aus den Kunden-Objekten entfernen. `tests/unit/customer-actions.test.ts` bleibt in dieser Task unverändert (gemockte Prisma-Calls, läuft zur Laufzeit weiter grün); er wird in Task 5 zusammen mit der Action angepasst. `npx tsc --noEmit` meldet bis Task 6 Fehler in noch nicht angepassten Dateien, das ist erwartet.

- [ ] **Step 6: Alten Jobtest entfernen** (er nutzt die entfernten Spalten; `tests/integration/subscriptions.test.ts` in Task 3 ersetzt ihn): `git rm tests/integration/yearly-invoices.test.ts`

- [ ] **Step 7: Commit**

```bash
git add prisma tests
git commit -m "feat(subscriptions): add Subscription model and migrate yearly customers"
```

---

### Task 2: Datumslogik

**Files:**
- Create: `lib/subscription-dates.ts`
- Test: `tests/unit/subscription-dates.test.ts`

**Interfaces:**
- Produces:
  - `type SubscriptionIntervalName = "Monthly" | "Quarterly" | "Yearly"`
  - `addInterval(date: Date, interval: SubscriptionIntervalName): Date`: neue Date-Instanz, Lokalzeit, Monatsende wird geklemmt.
  - `advancePast(date: Date, interval: SubscriptionIntervalName, today: Date): Date`: rückt mindestens einmal vor und so lange weiter, bis das Ergebnis `> today` ist.
  - `INTERVAL_LABELS: Record<SubscriptionIntervalName, string>` = `{ Monthly: "Monatlich", Quarterly: "Quartalsweise", Yearly: "Jährlich" }`.

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect } from "vitest";
import { addInterval, advancePast, INTERVAL_LABELS } from "@/lib/subscription-dates";

const d = (y: number, m: number, day: number) => new Date(y, m - 1, day);

describe("addInterval", () => {
  it("adds one month", () => {
    expect(addInterval(d(2026, 3, 15), "Monthly")).toEqual(d(2026, 4, 15));
  });
  it("adds three months across a year boundary", () => {
    expect(addInterval(d(2026, 11, 10), "Quarterly")).toEqual(d(2027, 2, 10));
  });
  it("adds twelve months", () => {
    expect(addInterval(d(2026, 6, 1), "Yearly")).toEqual(d(2027, 6, 1));
  });
  it("clamps to the end of a shorter month", () => {
    expect(addInterval(d(2026, 1, 31), "Monthly")).toEqual(d(2026, 2, 28));
    expect(addInterval(d(2027, 1, 31), "Monthly")).toEqual(d(2027, 2, 28));
    expect(addInterval(d(2028, 1, 31), "Monthly")).toEqual(d(2028, 2, 29));
  });
  it("moves 29 Feb to 28 Feb in a non-leap year", () => {
    expect(addInterval(d(2028, 2, 29), "Yearly")).toEqual(d(2029, 2, 28));
  });
  it("does not mutate its input", () => {
    const input = d(2026, 3, 15);
    addInterval(input, "Monthly");
    expect(input).toEqual(d(2026, 3, 15));
  });
});

describe("advancePast", () => {
  it("advances once when the result is already in the future", () => {
    expect(advancePast(d(2026, 9, 29), "Monthly", d(2026, 9, 30))).toEqual(d(2026, 10, 29));
  });
  it("catches up after downtime so that only one invoice is due", () => {
    expect(advancePast(d(2026, 1, 15), "Monthly", d(2026, 9, 30))).toEqual(d(2026, 10, 15));
  });
  it("never returns a date <= today", () => {
    const today = d(2026, 10, 15);
    expect(advancePast(d(2026, 9, 15), "Monthly", today).getTime()).toBeGreaterThan(today.getTime());
  });
});

describe("INTERVAL_LABELS", () => {
  it("has a German label per interval", () => {
    expect(INTERVAL_LABELS).toEqual({ Monthly: "Monatlich", Quarterly: "Quartalsweise", Yearly: "Jährlich" });
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

Run: `npx vitest run tests/unit/subscription-dates.test.ts`
Expected: FAIL (Modul nicht gefunden).

- [ ] **Step 3: Implementierung**

```ts
export type SubscriptionIntervalName = "Monthly" | "Quarterly" | "Yearly";

export const INTERVAL_LABELS: Record<SubscriptionIntervalName, string> = {
  Monthly: "Monatlich",
  Quarterly: "Quartalsweise",
  Yearly: "Jährlich",
};

const MONTHS: Record<SubscriptionIntervalName, number> = {
  Monthly: 1,
  Quarterly: 3,
  Yearly: 12,
};

/**
 * Adds the interval in local time. A day that does not exist in the target
 * month is clamped to its last day (31 Jan + 1 month = 28/29 Feb). The clamped
 * day is not remembered, so later dates stay on the clamped day.
 */
export function addInterval(date: Date, interval: SubscriptionIntervalName): Date {
  const result = new Date(date);
  const day = result.getDate();
  result.setDate(1);
  result.setMonth(result.getMonth() + MONTHS[interval]);
  const lastDay = new Date(result.getFullYear(), result.getMonth() + 1, 0).getDate();
  result.setDate(Math.min(day, lastDay));
  return result;
}

/** Advances at least once and keeps going until the date lies after `today` (catch-up after downtime). */
export function advancePast(date: Date, interval: SubscriptionIntervalName, today: Date): Date {
  let next = addInterval(date, interval);
  while (next.getTime() <= today.getTime()) next = addInterval(next, interval);
  return next;
}
```

- [ ] **Step 4: Run, expect PASS**

Run: `npx vitest run tests/unit/subscription-dates.test.ts`

- [ ] **Step 5: Commit**

```bash
git add lib/subscription-dates.ts tests/unit/subscription-dates.test.ts
git commit -m "feat(subscriptions): add interval date calculation"
```

---

### Task 3: Job `checkSubscriptions` (ohne Auto-Versand)

**Files:**
- Create: `lib/subscriptions.ts`
- Delete: `lib/yearly-invoices.ts` (der alte Test wird schon in Task 1 entfernt)
- Modify: `lib/notifications.ts:9,34`, `app/(app)/settings/actions.ts:13,288`, `app/(app)/settings/DevToolsCard.tsx:41`, `tests/unit/settings-actions.test.ts:29`, `tests/integration/notifications.test.ts` (Treffer für `checkYearlyInvoices`/`yearly` anpassen)
- Test: `tests/integration/subscriptions.test.ts`

**Interfaces:**
- Consumes: `addInterval`/`advancePast` aus Task 2; `calculateItemTotal`, `calculateInvoiceTotal` aus `@/lib/calculations`; `formatCurrency`, `formatDate` aus `@/lib/utils`; `logAuditEntry` aus `@/lib/audit`.
- Produces: `checkSubscriptions(prisma: PrismaClient): Promise<void>`; `SYSTEM_ACTOR: Session` (Task 4 nutzt ihn).

- [ ] **Step 1: Failing tests** (`tests/integration/subscriptions.test.ts`)

```ts
import { describe, it, expect, vi } from "vitest";
import { createTestDatabase, createValidTestCustomer } from "../test-utils";
import { checkSubscriptions } from "@/lib/subscriptions";

describe("checkSubscriptions", () => {
  const db = createTestDatabase();

  const yesterday = new Date(Date.now() - 86_400_000);
  const tomorrow = new Date(Date.now() + 86_400_000);

  async function seedTemplate() {
    return db.prisma.invoiceTemplate.create({
      data: {
        name: "Mitgliederbeitrag",
        items: {
          create: [
            { name: "Beitrag", unit: "Piece", unitPrice: 120, quantity: 1 },
            { name: "Hosting", description: "pro Monat", unit: "Piece", unitPrice: 10.5, quantity: 12 },
          ],
        },
      },
    });
  }

  async function seedSubscription(
    overrides: Partial<{ nextInvoiceDate: Date; interval: "Monthly" | "Quarterly" | "Yearly"; active: boolean; templateId: number | null; archived: boolean; email: string }> = {}
  ) {
    const customer = await db.prisma.customer.create({
      data: {
        ...createValidTestCustomer(),
        email: overrides.email ?? "jane@clientag.ch",
        archivedAt: overrides.archived ? new Date() : null,
      },
    });
    return db.prisma.subscription.create({
      data: {
        customerId: customer.customerId,
        templateId: overrides.templateId ?? null,
        interval: overrides.interval ?? "Yearly",
        nextInvoiceDate: overrides.nextInvoiceDate ?? yesterday,
        active: overrides.active ?? true,
      },
    });
  }

  it("creates a draft with template items, the real total and a pending email", async () => {
    const template = await seedTemplate();
    await seedSubscription({ templateId: template.id });
    await checkSubscriptions(db.prisma);

    const invoices = await db.prisma.invoice.findMany({ include: { items: true } });
    const pending = await db.prisma.pendingEmail.findMany();

    expect(invoices).toHaveLength(1);
    expect(invoices[0].state).toBe("Draft");
    expect(invoices[0].documentNumber).toBeNull();
    expect(invoices[0].items).toHaveLength(2);
    expect(invoices[0].totalAmount.toNumber()).toBe(246); // 120 + 12 * 10.5
    expect(pending).toHaveLength(1);
    expect(pending[0].to).toBe("jane@clientag.ch");
    expect(pending[0].subject).toContain("{documentNumber}");
    expect(pending[0].body).toContain("{documentNumber}");
    // Default body contains {totalAmount}; formatCurrency(246) renders "246.00" (check lib/utils.ts if the locale format differs).
    expect(pending[0].body).toContain("246");
  });

  it("creates an empty draft when the subscription has no template", async () => {
    await seedSubscription();
    await checkSubscriptions(db.prisma);

    const invoices = await db.prisma.invoice.findMany({ include: { items: true } });
    expect(invoices).toHaveLength(1);
    expect(invoices[0].items).toHaveLength(0);
    expect(invoices[0].totalAmount.toNumber()).toBe(0);
  });

  it("advances nextInvoiceDate by the interval", async () => {
    const sub = await seedSubscription({ interval: "Quarterly", nextInvoiceDate: new Date(2026, 0, 15) });
    await checkSubscriptions(db.prisma);

    const updated = await db.prisma.subscription.findUniqueOrThrow({ where: { id: sub.id } });
    expect(updated.nextInvoiceDate.getTime()).toBeGreaterThan(Date.now());
    expect(updated.nextInvoiceDate.getDate()).toBe(15);
  });

  it("creates exactly one invoice after a long downtime", async () => {
    await seedSubscription({ interval: "Monthly", nextInvoiceDate: new Date(2026, 0, 15) });
    await checkSubscriptions(db.prisma);
    expect(await db.prisma.invoice.count()).toBe(1);
  });

  it("skips paused subscriptions", async () => {
    await seedSubscription({ active: false });
    await checkSubscriptions(db.prisma);
    expect(await db.prisma.invoice.count()).toBe(0);
  });

  it("skips subscriptions with a future date", async () => {
    await seedSubscription({ nextInvoiceDate: tomorrow });
    await checkSubscriptions(db.prisma);
    expect(await db.prisma.invoice.count()).toBe(0);
  });

  it("skips archived customers", async () => {
    await seedSubscription({ archived: true });
    await checkSubscriptions(db.prisma);
    expect(await db.prisma.invoice.count()).toBe(0);
  });

  it("is idempotent: a second run creates no duplicates", async () => {
    await seedSubscription();
    await checkSubscriptions(db.prisma);
    await checkSubscriptions(db.prisma);
    expect(await db.prisma.invoice.count()).toBe(1);
    expect(await db.prisma.pendingEmail.count()).toBe(1);
  });

  it("handles multiple subscriptions of one customer independently", async () => {
    const customer = await db.prisma.customer.create({ data: createValidTestCustomer() });
    await db.prisma.subscription.createMany({
      data: [
        { customerId: customer.customerId, interval: "Monthly", nextInvoiceDate: yesterday },
        { customerId: customer.customerId, interval: "Yearly", nextInvoiceDate: yesterday },
      ],
    });
    await checkSubscriptions(db.prisma);
    expect(await db.prisma.invoice.count()).toBe(2);
    expect(await db.prisma.pendingEmail.count()).toBe(2);
  });

  it("writes a system audit entry per created invoice", async () => {
    const sub = await seedSubscription();
    await checkSubscriptions(db.prisma);
    const entries = await db.prisma.auditLog.findMany({ where: { entityType: "Invoice", action: "CREATE" } });
    expect(entries).toHaveLength(1);
    expect(entries[0].userName).toBe("System (Abo)");
    expect(entries[0].details).toContain(`"subscriptionId":${sub.id}`);
  });

  it("creates nothing when the subscription was paused after the due list was read", async () => {
    const sub = await seedSubscription();
    // Simulates the window between reading the due list and the transaction.
    const realFindMany = db.prisma.subscription.findMany.bind(db.prisma.subscription);
    const spy = vi.spyOn(db.prisma.subscription, "findMany").mockImplementation(((args: never) =>
      realFindMany(args).then(async (rows: unknown) => {
        await db.prisma.subscription.update({ where: { id: sub.id }, data: { active: false } });
        return rows;
      })) as never);
    await checkSubscriptions(db.prisma);
    spy.mockRestore();
    expect(await db.prisma.invoice.count()).toBe(0);
    expect(await db.prisma.pendingEmail.count()).toBe(0);
  });

  it("cascade-deletes the pending email when the invoice is deleted", async () => {
    await seedSubscription();
    await checkSubscriptions(db.prisma);
    const invoice = await db.prisma.invoice.findFirstOrThrow();
    await db.prisma.item.deleteMany({ where: { invoiceId: invoice.id } });
    await db.prisma.invoice.delete({ where: { id: invoice.id } });
    expect(await db.prisma.pendingEmail.count()).toBe(0);
  });
});
```

- [ ] **Step 2: Run, expect FAIL** (`npx vitest run tests/integration/subscriptions.test.ts`; Modul fehlt).

- [ ] **Step 3: Implementierung `lib/subscriptions.ts`**

```ts
import type { PrismaClient } from "@prisma/client";
import type { Session } from "next-auth";
import { calculateInvoiceTotal, calculateItemTotal } from "@/lib/calculations";
import { advancePast, type SubscriptionIntervalName } from "@/lib/subscription-dates";
import { logAuditEntry } from "@/lib/audit";
import { formatCurrency, formatDate } from "@/lib/utils";
import logger from "@/lib/logger";

const log = logger.child({ module: "subscriptions" });

const DEFAULT_SUBJECT = "Rechnung Nr. {documentNumber} – {companyName}";
const DEFAULT_BODY =
  "Guten Tag {contactPerson}\n\nanbei erhalten Sie die Rechnung Nr. {documentNumber} vom {date} über {totalAmount}.\n\nZahlbar bis: {dueDate}\n\nMit freundlichen Grüssen\n{companyName}";

/** Actor for documents the job sends on its own (autoSend); audit and archive rows need a user id. */
export const SYSTEM_ACTOR: Session = {
  user: { id: "0", name: "System (Abo)", email: "", role: "Admin" },
  expires: "9999-12-31T23:59:59.999Z",
} as Session;

class SubscriptionChangedError extends Error {
  constructor() {
    super("Abo wurde seit dem Laden verändert oder pausiert.");
  }
}

function resolve(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, key) => vars[key] ?? "");
}

export async function checkSubscriptions(prisma: PrismaClient): Promise<void> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const [settings, due] = await Promise.all([
    prisma.applicationSettings.findFirst({ include: { companyInfo: true } }),
    prisma.subscription.findMany({
      where: { active: true, nextInvoiceDate: { lte: today }, customer: { archivedAt: null } },
      include: {
        customer: true,
        template: { include: { items: { orderBy: { id: "asc" } } } },
      },
      orderBy: { id: "asc" },
    }),
  ]);

  if (due.length === 0) return;

  const companyName = settings?.companyInfo.companyName ?? "";
  const subjectTpl = settings?.emailSubjectTemplate || DEFAULT_SUBJECT;
  const bodyTpl = settings?.emailBodyTemplate || DEFAULT_BODY;
  const paymentDays = settings?.defaultPaymentTermDays ?? 30;

  for (const sub of due) {
    const dueDate = new Date(today);
    dueDate.setDate(dueDate.getDate() + paymentDays);

    const items = (sub.template?.items ?? []).map((item) => {
      const quantity = item.quantity.toNumber();
      const unitPrice = item.unitPrice.toNumber();
      return {
        name: item.name,
        description: item.description,
        unit: item.unit,
        unitPrice,
        quantity,
        discountPercent: 0,
        totalAmount: calculateItemTotal({ quantity, unitPrice }),
        categoryId: item.categoryId,
      };
    });
    const totalAmount = calculateInvoiceTotal(items, 0);

    try {
      // Invoice, PendingEmail and the date advance succeed or fail together: a
      // crash between separate awaits would bill the same period twice.
      const { invoiceId } = await prisma.$transaction(async (tx) => {
        const invoice = await tx.invoice.create({
          data: {
            customerId: sub.customerId,
            date: today,
            dueDate,
            totalAmount,
            discountPercent: 0,
            state: "Draft",
            items: { create: items },
          },
        });

        const vars = {
          // Kept as placeholder: the number is only assigned when the mail is approved.
          documentNumber: "{documentNumber}",
          contactPerson: sub.customer.contactPerson,
          companyName,
          totalAmount: formatCurrency(totalAmount),
          date: formatDate(today),
          dueDate: formatDate(dueDate),
          customUserText: "",
        };

        await tx.pendingEmail.create({
          data: {
            invoiceId: invoice.id,
            to: sub.customer.email,
            subject: resolve(subjectTpl, vars),
            body: resolve(bodyTpl, vars),
          },
        });

        // Guarded against a pause/edit or an overlapping second run since the due
        // list was read: no match rolls the whole transaction back.
        const advanced = await tx.subscription.updateMany({
          where: { id: sub.id, active: true, nextInvoiceDate: sub.nextInvoiceDate },
          data: {
            nextInvoiceDate: advancePast(sub.nextInvoiceDate, sub.interval as SubscriptionIntervalName, today),
          },
        });
        if (advanced.count === 0) throw new SubscriptionChangedError();

        return { invoiceId: invoice.id };
      });

      await logAuditEntry(
        {
          userId: parseInt(SYSTEM_ACTOR.user.id, 10),
          userName: SYSTEM_ACTOR.user.name ?? "System (Abo)",
          action: "CREATE",
          entityType: "Invoice",
          entityId: invoiceId,
          entityRef: null,
          details: JSON.stringify({ subscriptionId: sub.id, source: "subscription" }),
        },
        prisma
      );
    } catch (err) {
      // One broken subscription must not block the others; it is retried on the next run.
      if (err instanceof SubscriptionChangedError) {
        log.warn({ subscriptionId: sub.id }, "Subscription changed while the job ran, skipped");
      } else {
        log.error({ err, subscriptionId: sub.id }, "Creating the subscription invoice failed");
      }
    }
  }
}
```

Hinweis: `Item.unit` ist ein Prisma-Enum; `TemplateItem.unit` hat denselben Typ, die Zuweisung ist also typgleich. `tx.invoice.create` mit verschachteltem `items.create` setzt `invoiceId` selbst.

- [ ] **Step 4: Alte Dateien entfernen und umverdrahten**

```bash
git rm lib/yearly-invoices.ts
```

- `lib/notifications.ts`: Import → `import { checkSubscriptions } from "@/lib/subscriptions";`, Schritt → `["checkSubscriptions", () => checkSubscriptions(prisma)],`.
- `app/(app)/settings/actions.ts`: Import und Aufruf (Zeile 13, 288) auf `checkSubscriptions` umstellen.
- `app/(app)/settings/DevToolsCard.tsx:41`: Text `checkYearlyInvoices` → `checkSubscriptions`.
- `tests/unit/settings-actions.test.ts:29`: `vi.mock("@/lib/subscriptions", () => ({ checkSubscriptions: vi.fn() }));` (und Verweise im selben File auf `checkYearlyInvoices` anpassen).
- `tests/integration/notifications.test.ts`: per `grep -n "yearly\|Yearly" tests/integration/notifications.test.ts` Treffer finden und auf Abos umstellen (Fixtures: `db.prisma.subscription.create` statt `yearlyInvoice`-Kunde).

- [ ] **Step 5: Tests**

Run: `npx vitest run tests/integration/subscriptions.test.ts tests/unit/settings-actions.test.ts tests/integration/notifications.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A lib tests app
git commit -m "feat(subscriptions): replace yearly job with template-based subscription job"
```

---

### Task 4: Auto-Versand

**Files:**
- Create: `lib/pending-email-send.ts`
- Modify: `app/(app)/invoices/pending/actions.ts:16-99`
- Modify: `lib/subscriptions.ts`
- Test: `tests/integration/subscriptions-autosend.test.ts`; vorhandene `tests/unit/invoice-sub-actions.test.ts` und `tests/integration/invoice-dispatch.test.ts` müssen unverändert grün bleiben.

**Interfaces:**
- Produces: `sendPendingInvoice(input: { pendingId: number; to: string; subject: string; body: string; actor: Session }): Promise<{ error: string } | { invoiceId: number }>`.
- Consumes: `SYSTEM_ACTOR`, `checkSubscriptions` (Task 3).

- [ ] **Step 1: `lib/pending-email-send.ts` anlegen** (Logik 1:1 aus `approvePendingEmail`, gleiche Aufruf-Reihenfolge und -Argumente, damit die bestehenden Unit-Tests gültig bleiben)

```ts
import prisma from "@/lib/prisma";
import type { Session } from "next-auth";
import { renderArchiveAndSend, sentDocumentData, auditArchived } from "@/lib/invoice-dispatch";
import type { ArchiveResult } from "@/lib/document-archive";
import { assignDocumentNumber } from "@/lib/document-number";
import { fillDocumentNumber } from "@/lib/document-display";
import { logAudit } from "@/lib/audit";
import logger from "@/lib/logger";

const log = logger.child({ module: "pending-email-send" });

/**
 * Sends the invoice behind a PendingEmail: assigns the number, renders and
 * archives the PDF, mails it and records the send. Shared by the manual
 * approval and the subscription job (autoSend). Uses the shared Prisma client.
 */
export async function sendPendingInvoice(input: {
  pendingId: number;
  to: string;
  subject: string;
  body: string;
  actor: Session;
}): Promise<{ error: string } | { invoiceId: number }> {
  const { pendingId: id, to, subject, body, actor } = input;

  const pending = await prisma.pendingEmail.findUnique({
    where: { id },
    include: {
      invoice: {
        include: { customer: true, items: { orderBy: { id: "asc" } } },
      },
    },
  });

  if (!pending) return { error: "Eintrag nicht gefunden." };

  const settings = await prisma.applicationSettings.findFirst({
    include: { companyInfo: true },
  });
  if (!settings) return { error: "Einstellungen nicht konfiguriert." };

  let documentNumber: string;
  try {
    documentNumber = await assignDocumentNumber("invoice", pending.invoiceId, { actor });
  } catch (err) {
    log.error({ pendingId: id, err }, "sendPendingInvoice: number assignment failed");
    return { error: "Rechnungsnummer konnte nicht vergeben werden." };
  }
  const invoice = { ...pending.invoice, documentNumber };
  const finalSubject = fillDocumentNumber(subject, documentNumber);
  const finalBody = fillDocumentNumber(body, documentNumber);

  let archive: ArchiveResult;
  try {
    archive = await renderArchiveAndSend({
      invoice,
      settings,
      kind: "Invoice",
      mail: { to, subject: finalSubject, body: finalBody },
    });
  } catch (err) {
    log.error({ pendingId: id, to, err }, "sendPendingInvoice failed");
    return { error: err instanceof Error ? err.message : "Fehler beim Senden." };
  }

  const [, , , sentDocument] = await prisma.$transaction([
    // Paid/PartiallyPaid/Canceled keep their state: it is derived from payments.
    prisma.invoice.updateMany({
      where: { id: pending.invoiceId, state: { in: ["Draft", "Sent", "Overdue"] } },
      data: { state: "Sent" },
    }),
    prisma.invoiceSentLog.create({
      data: { invoiceId: pending.invoiceId, sentTo: to, subject: finalSubject },
    }),
    prisma.pendingEmail.delete({ where: { id } }),
    prisma.sentDocument.create({
      data: sentDocumentData({
        invoiceId: pending.invoiceId,
        documentNumber,
        kind: "Invoice",
        archive,
        sentTo: to,
        subject: finalSubject,
        actor,
      }),
    }),
  ]);

  await logAudit(actor, "SEND", "Invoice", pending.invoiceId, documentNumber, {
    to,
    subject: finalSubject,
  });
  await auditArchived(actor, sentDocument, documentNumber, archive);

  return { invoiceId: pending.invoiceId };
}
```

- [ ] **Step 2: `approvePendingEmail` delegieren lassen**

In `app/(app)/invoices/pending/actions.ts` den Rumpf ab `const pending = …` bis vor `return { success: true … }` ersetzen und die jetzt ungenutzten Imports (`renderArchiveAndSend`, `sentDocumentData`, `auditArchived`, `ArchiveResult`, `assignDocumentNumber`, `fillDocumentNumber`, `logger`/`log`) entfernen. `logAudit` und `requireEditor` bleiben (`discardPendingEmail` nutzt sie):

```ts
export async function approvePendingEmail(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const session = await requireEditor();

  const id = parseInt(formData.get("id") as string, 10);
  const to = (formData.get("to") as string).trim();
  const subject = (formData.get("subject") as string).trim();
  const body = (formData.get("body") as string).trim();

  const result = await sendPendingInvoice({ pendingId: id, to, subject, body, actor: session });
  if ("error" in result) return { error: result.error };

  revalidatePath("/invoices/pending");
  revalidatePath(`/invoices/${result.invoiceId}`);
  return { success: true, _ts: Date.now() };
}
```

Import ergänzen: `import { sendPendingInvoice } from "@/lib/pending-email-send";`.

- [ ] **Step 3: Refactoring absichern**

Run: `npx vitest run tests/unit/invoice-sub-actions.test.ts tests/integration/invoice-dispatch.test.ts`
Expected: PASS ohne Änderungen an diesen Tests. Schlägt ein Test wegen Mock-Pfaden fehl (z. B. weil er `@/lib/logger` oder `@/lib/invoice-dispatch` mockt), den Mock belassen: Module-IDs sind dieselben; nur den Fehler analysieren, nicht die Tests umschreiben.

- [ ] **Step 4: Failing tests für den Job schreiben** (das Schema-Feld `autoSend` existiert seit Task 1). Datei `tests/integration/subscriptions-autosend.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createTestDatabase, createValidTestCustomer } from "../test-utils";

const sendPendingInvoice = vi.fn();
vi.mock("@/lib/pending-email-send", () => ({ sendPendingInvoice: (...a: unknown[]) => sendPendingInvoice(...a) }));
const notifyAdmins = vi.fn();
vi.mock("@/lib/notifications", () => ({ notifyAdmins: (...a: unknown[]) => notifyAdmins(...a) }));

import { checkSubscriptions, SYSTEM_ACTOR } from "@/lib/subscriptions";

describe("checkSubscriptions with autoSend", () => {
  const db = createTestDatabase();
  const yesterday = new Date(Date.now() - 86_400_000);

  beforeEach(async () => {
    sendPendingInvoice.mockReset();
    notifyAdmins.mockReset();
    // notifyAdmins is only called when settings exist
    await db.prisma.applicationSettings.create({ data: { companyInfo: { create: {} } } });
  });

  async function seed(opts: { autoSend: boolean; template: "items" | "empty" | "none" }) {
    const template =
      opts.template === "none"
        ? null
        : await db.prisma.invoiceTemplate.create({
            data: {
              name: "T",
              items:
                opts.template === "items"
                  ? { create: [{ name: "Beitrag", unit: "Piece", unitPrice: 50, quantity: 1 }] }
                  : undefined,
            },
          });
    const customer = await db.prisma.customer.create({ data: createValidTestCustomer() });
    return db.prisma.subscription.create({
      data: {
        customerId: customer.customerId,
        templateId: template?.id ?? null,
        interval: "Yearly",
        nextInvoiceDate: yesterday,
        autoSend: opts.autoSend,
      },
    });
  }

  it("sends the pending invoice as the system actor", async () => {
    sendPendingInvoice.mockResolvedValue({ invoiceId: 1 });
    await seed({ autoSend: true, template: "items" });
    await checkSubscriptions(db.prisma);

    const pending = await db.prisma.pendingEmail.findFirstOrThrow();
    expect(sendPendingInvoice).toHaveBeenCalledTimes(1);
    expect(sendPendingInvoice).toHaveBeenCalledWith({
      pendingId: pending.id,
      to: pending.to,
      subject: pending.subject,
      body: pending.body,
      actor: SYSTEM_ACTOR,
    });
    expect(notifyAdmins).not.toHaveBeenCalled();
  });

  it("keeps draft and pending email and notifies the admins when sending fails", async () => {
    sendPendingInvoice.mockResolvedValue({ error: "SMTP down" });
    const sub = await seed({ autoSend: true, template: "items" });
    await checkSubscriptions(db.prisma);

    expect(await db.prisma.invoice.count()).toBe(1);
    expect(await db.prisma.pendingEmail.count()).toBe(1);
    const updated = await db.prisma.subscription.findUniqueOrThrow({ where: { id: sub.id } });
    expect(updated.nextInvoiceDate.getTime()).toBeGreaterThan(Date.now());
    expect(notifyAdmins).toHaveBeenCalledTimes(1);
    expect(notifyAdmins.mock.calls[0][2]).toContain("SMTP down");
    expect(notifyAdmins.mock.calls[0][3]).toBe("/invoices/pending");
  });

  it("does not throw, keeps the pending email and notifies when sending throws", async () => {
    sendPendingInvoice.mockRejectedValue(new Error("boom"));
    await seed({ autoSend: true, template: "items" });
    await expect(checkSubscriptions(db.prisma)).resolves.toBeUndefined();
    expect(await db.prisma.pendingEmail.count()).toBe(1);
    expect(notifyAdmins).toHaveBeenCalledTimes(1);
  });

  it("never auto-sends without a template", async () => {
    await seed({ autoSend: true, template: "none" });
    await checkSubscriptions(db.prisma);
    expect(sendPendingInvoice).not.toHaveBeenCalled();
    expect(await db.prisma.pendingEmail.count()).toBe(1);
  });

  it("never auto-sends a template without items (CHF 0 invoice)", async () => {
    await seed({ autoSend: true, template: "empty" });
    await checkSubscriptions(db.prisma);
    expect(sendPendingInvoice).not.toHaveBeenCalled();
    expect(await db.prisma.pendingEmail.count()).toBe(1);
  });

  it("does not auto-send when autoSend is off", async () => {
    await seed({ autoSend: false, template: "items" });
    await checkSubscriptions(db.prisma);
    expect(sendPendingInvoice).not.toHaveBeenCalled();
  });
});
```

Zusätzlich ein End-to-End-Test **ohne** Mock von `sendPendingInvoice`, der Archiv, `SentDocument` und Status prüft. Datei `tests/integration/subscriptions-send-e2e.test.ts` (Mocks und Prisma-Proxy wie in `tests/integration/invoice-dispatch.test.ts:1-50`):

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { createTestDatabase, createValidTestCustomer } from "../test-utils";

const holder = vi.hoisted(() => ({ prisma: null as unknown }));
vi.mock("@/lib/prisma", () => ({
  default: new Proxy(
    {},
    {
      get: (_t, prop) => {
        const target = holder.prisma as Record<string | symbol, unknown>;
        const value = target[prop];
        return typeof value === "function" ? value.bind(target) : value;
      },
    }
  ),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock("@/lib/logger", () => ({
  default: { child: () => ({ error: () => {}, info: () => {}, warn: () => {} }) },
}));
vi.mock("@/lib/pdf/invoice-pdf", () => ({ generateInvoicePdf: vi.fn(), generateQuotePdf: vi.fn() }));
vi.mock("@/lib/email", () => ({ sendInvoiceEmail: vi.fn(), sendQuoteEmail: vi.fn() }));

import { checkSubscriptions } from "@/lib/subscriptions";
import { verifyArchived, sha256Hex } from "@/lib/document-archive";
import { generateInvoicePdf } from "@/lib/pdf/invoice-pdf";
import { sendInvoiceEmail } from "@/lib/email";

describe("autoSend end to end", () => {
  const db = createTestDatabase();
  let dir: string;

  beforeEach(async () => {
    holder.prisma = db.prisma;
    vi.clearAllMocks();
    vi.mocked(generateInvoicePdf).mockResolvedValue(Buffer.from("%PDF-1.4 subscription bytes"));
    vi.mocked(sendInvoiceEmail).mockResolvedValue(undefined);
    dir = mkdtempSync(join(tmpdir(), "subscription-send-"));
    process.env.ARCHIVE_DIR = dir;
    await db.prisma.applicationSettings.create({ data: { companyInfo: { create: {} } } });
  });

  afterEach(() => {
    delete process.env.ARCHIVE_DIR;
    rmSync(dir, { recursive: true, force: true });
  });

  it("numbers, archives, mails and marks the invoice as Sent", async () => {
    const template = await db.prisma.invoiceTemplate.create({
      data: { name: "T", items: { create: [{ name: "Beitrag", unit: "Piece", unitPrice: 50, quantity: 1 }] } },
    });
    const customer = await db.prisma.customer.create({ data: createValidTestCustomer() });
    await db.prisma.subscription.create({
      data: {
        customerId: customer.customerId,
        templateId: template.id,
        interval: "Yearly",
        nextInvoiceDate: new Date(Date.now() - 86_400_000),
        autoSend: true,
      },
    });

    await checkSubscriptions(db.prisma);

    const invoice = await db.prisma.invoice.findFirstOrThrow();
    expect(invoice.state).toBe("Sent");
    expect(invoice.documentNumber).not.toBeNull();
    expect(await db.prisma.pendingEmail.count()).toBe(0);
    expect(await db.prisma.invoiceSentLog.count()).toBe(1);

    const rows = await db.prisma.sentDocument.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0].createdById).toBe(0);
    const attached = vi.mocked(sendInvoiceEmail).mock.calls[0][2];
    expect(rows[0].sha256).toBe(sha256Hex(attached));
    expect(readFileSync(join(dir, rows[0].path))).toEqual(attached);
    expect((await verifyArchived(rows[0])).ok).toBe(true);
  });
});
```

- [ ] **Step 5: Run, expect FAIL** (`npx vitest run tests/integration/subscriptions-autosend.test.ts tests/integration/subscriptions-send-e2e.test.ts`: `sendPendingInvoice` wird nie aufgerufen).

- [ ] **Step 6: Implementierung in `lib/subscriptions.ts`**

Die Transaktion gibt zusätzlich die Pending-Daten zurück; nach dem Audit-Eintrag folgt der Versand. Änderungen:

1. `$transaction`-Rückgabe erweitern: `const pendingEmail = await tx.pendingEmail.create({...});` und `return { invoiceId: invoice.id, pending: pendingEmail };`; Destructuring `const { invoiceId, pending } = await prisma.$transaction(...)`.
2. Nach `await logAuditEntry(...)` (noch im `try`) ergänzen:

```ts
      // Only a template with items is sent unattended, never a CHF 0 invoice.
      if (sub.autoSend && items.length > 0) {
        try {
          // Loaded lazily: the PDF/mail stack is only needed when something is actually sent.
          const { sendPendingInvoice } = await import("@/lib/pending-email-send");
          const result = await sendPendingInvoice({
            pendingId: pending.id,
            to: pending.to,
            subject: pending.subject,
            body: pending.body,
            actor: SYSTEM_ACTOR,
          });
          if ("error" in result) await reportAutoSendFailure(settings, sub.id, invoiceId, result.error);
        } catch (err) {
          await reportAutoSendFailure(settings, sub.id, invoiceId, err instanceof Error ? err.message : "Unbekannter Fehler");
        }
      }
```

3. Den Helfer oberhalb von `resolve` einfügen (lazy Import von `@/lib/notifications`, weil dieses Modul `checkSubscriptions` importiert und ein statischer Import zyklisch wäre):

```ts
type JobSettings = NonNullable<Awaited<ReturnType<PrismaClient["applicationSettings"]["findFirst"]>>>;

/** Logs and tells the admins (notify e-mail / Telegram); draft and PendingEmail stay for manual approval. */
async function reportAutoSendFailure(
  settings: (JobSettings & { companyInfo: unknown }) | null,
  subscriptionId: number,
  invoiceId: number,
  error: string
): Promise<void> {
  log.error({ subscriptionId, invoiceId, error }, "Auto-send failed, invoice waits for manual approval");
  if (!settings) return;
  try {
    const { notifyAdmins } = await import("@/lib/notifications");
    await notifyAdmins(
      settings as Parameters<typeof notifyAdmins>[0],
      "Abo-Rechnung konnte nicht versendet werden",
      `Die Abo-Rechnung (Entwurf ${invoiceId}) konnte nicht automatisch versendet werden: ${error}. Sie wartet auf die manuelle Freigabe.`,
      "/invoices/pending"
    );
  } catch (err) {
    log.error({ err, subscriptionId }, "Notifying the admins about the failed auto-send failed");
  }
}
```

Ein Wurf von `sendPendingInvoice` wird vom inneren `catch` abgefangen und gemeldet (Test «does not throw»).

- [ ] **Step 7: Run, expect PASS**

Run: `npx vitest run tests/integration/subscriptions.test.ts tests/integration/subscriptions-autosend.test.ts tests/integration/subscriptions-send-e2e.test.ts tests/unit/invoice-sub-actions.test.ts tests/integration/invoice-dispatch.test.ts`

- [ ] **Step 8: Commit**

```bash
git add lib app tests
git commit -m "feat(subscriptions): auto-send subscription invoices via shared pending send"
```

---

### Task 5: Abo-Verwaltung (Actions, UI, Kundenformular)

**Files:**
- Create: `app/(app)/customers/subscription-actions.ts`, `app/(app)/customers/SubscriptionsSection.tsx`
- Modify: `lib/audit.ts:10`, `app/(app)/customers/[id]/page.tsx`, `app/(app)/customers/CustomerForm.tsx`, `app/(app)/customers/actions.ts`
- Test: `tests/unit/subscription-actions.test.ts`; `tests/unit/customer-actions.test.ts` (Anpassungen aus Task 1)

**Interfaces:**
- Consumes: `INTERVAL_LABELS`, `SubscriptionIntervalName` (Task 2).
- Produces (alle `"use server"`):
  - `createSubscription(customerId: number, _prev: ActionState, formData: FormData): Promise<ActionState>`
  - `updateSubscription(customerId: number, subscriptionId: number, _prev: ActionState, formData: FormData): Promise<ActionState>`
  - `setSubscriptionActive(customerId: number, subscriptionId: number, active: boolean): Promise<void>`
  - `deleteSubscription(customerId: number, subscriptionId: number): Promise<void>`
  - FormData-Felder: `interval`, `nextInvoiceDate` (`YYYY-MM-DD`), `templateId` (leer = keine), `autoSend` (`"on"`).

- [ ] **Step 1: `AuditEntity` erweitern** (`lib/audit.ts:10`): `| "Subscription"` ergänzen.

- [ ] **Step 2: Failing unit tests** (`tests/unit/subscription-actions.test.ts`; Muster aus `tests/unit/customer-actions.test.ts` für `auth`/`prisma`/`next/cache`-Mocks übernehmen, vorher `sed -n 1,60p tests/unit/customer-actions.test.ts` lesen und dieselben Mocks/Session-Fixtures verwenden):

Zu prüfende Fälle (je ein `it`):
1. `createSubscription` mit gültigen Daten ruft `prisma.subscription.create` mit `{ customerId, interval: "Quarterly", nextInvoiceDate: new Date(2027, 0, 1), templateId: 5, autoSend: true, active: true }` auf (Vorlage via gemocktem `prisma.invoiceTemplate.findUnique` → `{ id: 5 }`), schreibt `logAudit(session, "CREATE", "Subscription", id, …)`, liefert `{ success: true }`.
2. Ungültiges Intervall (`"Weekly"`) → `{ error: "Ungültiges Intervall." }`, kein `create`.
3. Fehlendes/ungültiges Datum → `{ error: "Bitte ein gültiges Datum angeben." }`.
4. `autoSend: "on"` ohne `templateId` → `{ error: "Automatischer Versand braucht eine Vorlage." }`.
5. Unbekannte Vorlage (`findUnique` → `null`) → `{ error: "Vorlage nicht gefunden." }`.
6. Viewer (Rolle ohne Editor-Recht) → `requireEditor` wirft bzw. leitet um (gleiches Verhalten wie im bestehenden Customer-Test prüfen).
7. `setSubscriptionActive(1, 7, false)` ruft `prisma.subscription.updateMany({ where: { id: 7, customerId: 1 }, data: { active: false } })` und `logAudit(session, "UPDATE", "Subscription", 7, …)`; bei `count: 0` (falscher Kunde) wird nichts geschrieben und kein Audit-Eintrag erzeugt.
8. `deleteSubscription(1, 7)` ruft `prisma.subscription.deleteMany({ where: { id: 7, customerId: 1 } })` und `logAudit(session, "DELETE", "Subscription", 7, …)`; nutzt `requireEditor` (nicht nur Admin).
9. `updateSubscription` validiert wie `create`, ruft `prisma.subscription.updateMany({ where: { id, customerId }, data })`; `count: 0` → `{ error: "Abo nicht gefunden." }`.

- [ ] **Step 3: Run, expect FAIL** (`npx vitest run tests/unit/subscription-actions.test.ts`).

- [ ] **Step 4: `subscription-actions.ts` implementieren**

```ts
"use server";

import prisma from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import type { ActionState } from "@/hooks/use-action-toast";
import { requireEditor } from "@/lib/permissions";
import { logAudit } from "@/lib/audit";
import { INTERVAL_LABELS, type SubscriptionIntervalName } from "@/lib/subscription-dates";
import { isValidDateString, parseDate } from "@/lib/date";

type SubscriptionFields = {
  interval: SubscriptionIntervalName;
  nextInvoiceDate: Date;
  templateId: number | null;
  autoSend: boolean;
};

async function parseSubscriptionForm(
  formData: FormData
): Promise<{ error: string } | { data: SubscriptionFields }> {
  const interval = formData.get("interval") as string;
  if (!Object.hasOwn(INTERVAL_LABELS, interval)) return { error: "Ungültiges Intervall." };

  // Local-time parsing (lib/date.ts): `new Date("YYYY-MM-DD")` would be UTC midnight and
  // shift the day around DST changes and for the job's local-midnight comparison.
  const dateRaw = (formData.get("nextInvoiceDate") as string) || "";
  const nextInvoiceDate = isValidDateString(dateRaw) ? parseDate(dateRaw) : undefined;
  if (!nextInvoiceDate) return { error: "Bitte ein gültiges Datum angeben." };

  const templateRaw = (formData.get("templateId") as string) || "";
  const templateId = templateRaw ? parseInt(templateRaw, 10) : null;
  if (templateRaw && Number.isNaN(templateId)) return { error: "Vorlage nicht gefunden." };

  const autoSend = formData.get("autoSend") === "on";
  if (autoSend && templateId == null) return { error: "Automatischer Versand braucht eine Vorlage." };

  if (templateId != null) {
    const template = await prisma.invoiceTemplate.findUnique({ where: { id: templateId }, select: { id: true } });
    if (!template) return { error: "Vorlage nicht gefunden." };
  }

  return { data: { interval: interval as SubscriptionIntervalName, nextInvoiceDate, templateId, autoSend } };
}

export async function createSubscription(
  customerId: number,
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const session = await requireEditor();
  const parsed = await parseSubscriptionForm(formData);
  if ("error" in parsed) return { error: parsed.error };

  const subscription = await prisma.subscription.create({
    data: { customerId, ...parsed.data, active: true },
  });
  await logAudit(session, "CREATE", "Subscription", subscription.id, INTERVAL_LABELS[parsed.data.interval], {
    customerId,
    templateId: parsed.data.templateId,
    autoSend: parsed.data.autoSend,
  });
  revalidatePath(`/customers/${customerId}`);
  revalidatePath("/dashboard");
  return { success: true, _ts: Date.now() };
}

export async function updateSubscription(
  customerId: number,
  subscriptionId: number,
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const session = await requireEditor();
  const parsed = await parseSubscriptionForm(formData);
  if ("error" in parsed) return { error: parsed.error };

  const { count } = await prisma.subscription.updateMany({
    where: { id: subscriptionId, customerId },
    data: parsed.data,
  });
  if (count === 0) return { error: "Abo nicht gefunden." };
  await logAudit(session, "UPDATE", "Subscription", subscriptionId, INTERVAL_LABELS[parsed.data.interval], {
    customerId,
    templateId: parsed.data.templateId,
    autoSend: parsed.data.autoSend,
  });
  revalidatePath(`/customers/${customerId}`);
  revalidatePath("/dashboard");
  return { success: true, _ts: Date.now() };
}

export async function setSubscriptionActive(
  customerId: number,
  subscriptionId: number,
  active: boolean
): Promise<void> {
  const session = await requireEditor();
  const { count } = await prisma.subscription.updateMany({ where: { id: subscriptionId, customerId }, data: { active } });
  if (count === 0) return;
  await logAudit(session, "UPDATE", "Subscription", subscriptionId, undefined, { customerId, active });
  revalidatePath(`/customers/${customerId}`);
  revalidatePath("/dashboard");
}

export async function deleteSubscription(customerId: number, subscriptionId: number): Promise<void> {
  const session = await requireEditor();
  const { count } = await prisma.subscription.deleteMany({ where: { id: subscriptionId, customerId } });
  if (count === 0) return;
  await logAudit(session, "DELETE", "Subscription", subscriptionId, undefined, { customerId });
  revalidatePath(`/customers/${customerId}`);
  revalidatePath("/dashboard");
}
```

Datumsformat: Job und `addInterval` rechnen in Lokalzeit. Formularwerte werden deshalb mit `parseDate` (lokale Mitternacht) gespeichert und mit `toDateString` (lokale Getter) angezeigt, nie mit `new Date("YYYY-MM-DD")` oder `toISOString()` (UTC würde den Tag an DST-Grenzen verschieben). Migrierte Altwerte (UTC-Mitternacht, in der Schweiz 01:00/02:00 lokal) zeigen lokal denselben Kalendertag.

- [ ] **Step 5: Run, expect PASS** (`npx vitest run tests/unit/subscription-actions.test.ts`).

- [ ] **Step 6: Kundenformular, Customer-Actions und deren Test bereinigen**

Zuerst `tests/unit/customer-actions.test.ts` anpassen: die erwarteten `data`-Objekte (Zeile ~99-101) verlieren `yearlyInvoice`/`nextInvoiceDate`; der Test «sets yearlyInvoice and contactInsteadOfCompany to true when 'on'» (Zeile ~113) prüft nur noch `contactInsteadOfCompany: true` (`form({ ...VALID_FIELDS, contactInsteadOfCompany: "on" })`); die Tests «parses nextInvoiceDate when provided» und «ignores nextInvoiceDate when yearlyInvoice is not enabled» werden gelöscht. Run: `npx vitest run tests/unit/customer-actions.test.ts` (FAIL, weil die Action die Felder noch schreibt), dann:

`app/(app)/customers/actions.ts`: in `createCustomer` und `updateCustomer` die Zeilen `const yearlyInvoice = …`, `const nextInvoiceDateRaw = …`, `const nextInvoiceDate = …` sowie `yearlyInvoice,` und `nextInvoiceDate,` im `data`-Objekt entfernen.

`app/(app)/customers/CustomerForm.tsx`: entfernen: `nextInvoiceDateDefault`, die States `yearlyInvoice`/`nextInvoiceDate` (Zeilen 54-58), im Read-only-Block die beiden `<div>` «Nächstes Rechnungsdatum» und «Jährliche Rechnung» (Zeilen 97-110), das Datumsfeld `<div className="space-y-1.5">…nextInvoiceDate…</div>` (Zeilen 297-306) und die Checkbox `yearlyInvoice` (Zeilen 309-322; die Checkbox `contactInsteadOfCompany` bleibt). Danach ungenutzte Imports (`DatePickerInput`, evtl. `useState`) per `npm run lint` finden und entfernen.

- [ ] **Step 7: `SubscriptionsSection.tsx`** (Client Component; Muster `NotesSection.tsx`: `Card`, `useActionState`, `useActionToast`, `ConfirmDialog`). Props:

```ts
type TemplateOption = { id: number; name: string };
type SubscriptionRecord = {
  id: number;
  interval: "Monthly" | "Quarterly" | "Yearly";
  nextInvoiceDate: string; // "YYYY-MM-DD"
  autoSend: boolean;
  active: boolean;
  templateId: number | null;
  templateName: string | null;
};
type Props = {
  customerId: number;
  subscriptions: SubscriptionRecord[];
  templates: TemplateOption[];
  canEdit: boolean;
};
```

Aufbau:
- `SubscriptionFields`-Teilkomponente mit einem nativen `<select name="interval">` (Optionen aus `INTERVAL_LABELS`), `DatePickerInput name="nextInvoiceDate"` (controlled, `value`/`onChange`, `components/ui/date-picker.tsx`), nativem `<select name="templateId">` («Keine Vorlage» mit Wert `""` + Vorlagen) und Checkbox `name="autoSend"` («Automatisch versenden»), deaktiviert solange keine Vorlage gewählt ist (State `templateId`; beim Zurücksetzen auf «Keine» `autoSend` abwählen). Klassen für `<select>`: `"h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm dark:bg-input/30"`.
- `NewSubscriptionForm` (`useActionState(createSubscription.bind(null, customerId), {})`, Toast «Abo angelegt», Reset bei Erfolg wie `NewNoteForm`).
- `SubscriptionItem` pro Abo (`useActionState(updateSubscription.bind(null, customerId, sub.id), {})`, Toast «Abo gespeichert»): zeigt Felder, Badge «Pausiert» wenn `!active`, Badge `variant="destructive"` «Vorlage fehlt» wenn `templateId == null`, Buttons «Speichern», «Pausieren»/«Fortsetzen» (`onClick={() => setSubscriptionActive(customerId, sub.id, !sub.active)}`), `ConfirmDialog` «Abo löschen» → `deleteSubscription(customerId, sub.id)`.
- Ist `!canEdit`, nur eine Read-only-Liste (Intervall, nächstes Datum, Vorlage, Auto-Versand) ohne Formulare/Buttons.
- Leerzustand: «Noch keine Abos vorhanden.»

- [ ] **Step 8: Seite einbinden** (`app/(app)/customers/[id]/page.tsx`; Import `import { toDateString } from "@/lib/date";`)

Im `Promise.all` zwei Abfragen ergänzen und Destructuring erweitern (`subscriptions`, `templates`):

```ts
    prisma.subscription.findMany({
      where: { customerId },
      include: { template: { select: { name: true } } },
      orderBy: { nextInvoiceDate: "asc" },
    }),
    prisma.invoiceTemplate.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
```

Import `SubscriptionsSection from "../SubscriptionsSection"`; in der rechten Spalte vor `DocumentsSection`:

```tsx
          <SubscriptionsSection
            customerId={customerId}
            canEdit={canEdit}
            templates={templates}
            subscriptions={subscriptions.map((s) => ({
              id: s.id,
              interval: s.interval,
              nextInvoiceDate: toDateString(s.nextInvoiceDate),
              autoSend: s.autoSend,
              active: s.active,
              templateId: s.templateId,
              templateName: s.template?.name ?? null,
            }))}
          />
```

- [ ] **Step 9: Verifizieren**

Run: `npx vitest run tests/unit/customer-actions.test.ts tests/unit/subscription-actions.test.ts` → PASS.
Run: `npx tsc --noEmit` und `npm run lint` → ohne Fehler (alle `yearlyInvoice`-Reste in Customers-Dateien beseitigt; Reste in Dashboard/Liste/Export folgen in Task 6, bis dahin meldet tsc dort Fehler, das ist erwartet).
Manuell (`npm run dev`): Kunde öffnen → Abo anlegen, Auto-Versand ohne Vorlage gesperrt, pausieren, bearbeiten, löschen.

- [ ] **Step 10: Commit**

```bash
git add -A app lib tests
git commit -m "feat(subscriptions): manage subscriptions on the customer page"
```

---

### Task 6: Dashboard, Kundenliste, Export, Seeds

**Files:**
- Modify: `app/(app)/dashboard/page.tsx:49-63,165-207`
- Modify: `app/(app)/customers/page.tsx:39,174-217`
- Modify: `app/api/export/customers/route.ts`
- Modify: `prisma/seed.ts`, `scripts/seed-manual-demo.ts:72-79`, `scripts/migrate-data.mjs:137-139`
- Test: bestehende Tests für Export (`grep -rn "export/customers" tests`) anpassen bzw. neuen Test `tests/unit/export-customers.test.ts` (Muster eines vorhandenen Export-Tests übernehmen)

**Interfaces:**
- Consumes: `INTERVAL_LABELS` (Task 2).

- [ ] **Step 1: Dashboard.** Die beiden Abfragen (Zeilen 49-63) ersetzen:

```ts
    prisma.subscription.count({
      where: { active: true, customer: { archivedAt: null } },
    }),
    prisma.subscription.findMany({
      where: { active: true, customer: { archivedAt: null } },
      select: {
        id: true,
        interval: true,
        nextInvoiceDate: true,
        customer: {
          select: { customerId: true, company: true, contactPerson: true, contactInsteadOfCompany: true },
        },
      },
      orderBy: { nextInvoiceDate: "asc" },
      take: 5,
    }),
```

Variablennamen `scheduledCustomerCount`/`scheduledCustomers` zu `scheduledSubscriptionCount`/`scheduledSubscriptions` umbenennen. Im JSX: Link-Ziele `/customers?yearlyInvoice=true` → `/customers?subscription=true`; Texte «Geplante Jahresrechnungen» → «Geplante Abos», «Aktive Planungen» → «Aktive Abos», «Kommende Jahresrechnungen» → «Kommende Abo-Rechnungen», «Keine Jahresrechnungen geplant.» → «Keine Abos geplant.». Listenzeilen: `key={sub.id}`, Link auf `/customers/${sub.customer.customerId}` mit dem bisherigen Namensausdruck (`sub.customer.…`), rechts `{INTERVAL_LABELS[sub.interval]} · {sub.nextInvoiceDate.toLocaleDateString("de-CH")}`. Import `INTERVAL_LABELS` aus `@/lib/subscription-dates`.

- [ ] **Step 2: Kundenliste** (`customers/page.tsx`). Zeile 39 ersetzen:

```ts
    ...(yearlyOnly ? { subscriptions: { some: { active: true } } } : {}),
```

Query-Parameter umbenennen: in `Props`, Destructuring und beiden `p.set(...)` `yearlyInvoice` → `subscription`; `const yearlyOnly = subscription === "true";` → Variable in `subscriptionOnly` umbenennen (in `TableProps`, `CustomersTable`-Signatur und Aufruf mitziehen). Titel Zeile 217: «Geplante Jahresrechnungen» → «Kunden mit Abo».

- [ ] **Step 3: Export.** `findMany` mit `include: { subscriptions: { where: { active: true }, select: { interval: true } } }`; Header `"Jahresrechnung"` → `"Abos"`; Zeile 30 ersetzen durch

```ts
    [...new Set(c.subscriptions.map((s) => INTERVAL_LABELS[s.interval]))].join(", "),
```

Import `INTERVAL_LABELS` aus `@/lib/subscription-dates`. Falls ein Test den Export prüft (`grep -rn "Jahresrechnung" tests`), auf «Abos» und das neue Format anpassen.

- [ ] **Step 4: Seeds.**
- `prisma/seed.ts` Zeilen 139-140: entfernen. Stattdessen nach dem Anlegen der Kunden (Zeile 143 `customers.push(customer)`) pro Kunde: `if (forcedYearly || faker.datatype.boolean()) await prisma.subscription.create({ data: { customerId: customer.customerId, interval: forcedYearly ? "Yearly" : faker.helpers.arrayElement(["Monthly", "Quarterly", "Yearly"]), nextInvoiceDate: faker.date.future() } })`. Die `forcedYearly`-Kunden bekommen bewusst `Yearly`, weil `seedPendingYearlyInvoices` ihr Datum um ein Jahr weiterschiebt.
- `seedPendingYearlyInvoices` (ab Zeile 306): Kommentar auf Abos umstellen, das Draft-`totalAmount: 0` durch die Summe der `items` (`priorTotal`-ähnlich, Items per `items: { create: buildItems(categories) }`) ersetzen, `totalAmount` in den Mail-Variablen entsprechend formatieren, und statt `prisma.customer.update({ … nextInvoiceDate: next })` die Subscription des Kunden um ein Jahr weiterschieben: `prisma.subscription.updateMany({ where: { customerId: customer.customerId }, data: { nextInvoiceDate: next } })`. Die ersten `PENDING_YEARLY_COUNT` Kunden erhalten garantiert ein Abo (`forcedYearly`). Im Seed-Logtext «pending yearly invoice mails» → «pending subscription invoice mails».
- `scripts/seed-manual-demo.ts` Zeilen 72-79: in den Kunden-Literalen `yearlyInvoice`/`nextInvoiceDate` entfernen und für die drei bisherigen Jahreskunden (Bergland Bäckerei, Optik Sonnenschein, Confiserie Mathez) nach dem Anlegen je ein Abo mit dem bisherigen Datum (`daysFromNow(45|120|200)`) und Intervall `Yearly` bzw. `Quarterly`/`Monthly` zur Demonstration anlegen (Code an der Stelle lesen, an der die Kunden erzeugt werden, und dort `prisma.subscription.create` ergänzen).
- `scripts/migrate-data.mjs` Zeilen 137-139: die Felder `yearlyInvoice`/`nextInvoiceDate` aus dem Kunden-Insert entfernen; danach im selben Skript (nach dem Kunden-Insert) pro Quellzeile mit `toBool(r.YearlyInvoice) && toDate(r.NextInvoiceDate)` ein `subscription`-Insert mit `interval: "Yearly"` ergänzen (an den umgebenden Code-Stil anpassen).

- [ ] **Step 5: Übrige «Jahresrechnung»-Texte anpassen.** `grep -rn "Jahresrechnung" app lib scripts README.md marketing --include=*.ts --include=*.tsx --include=*.md --include=*.html | cut -c1-200` zeigt die Stellen (nie die ganze Zeile von `public/benutzerhandbuch.html` ausgeben, sie enthält Base64-Bilder). Bekannte Treffer und ihre neue Formulierung:
  - `app/(app)/dashboard/page.tsx:79-80`, `app/(app)/invoices/page.tsx:321-322`, `app/(app)/invoices/pending/page.tsx:20`: «Jahresrechnung(en)» → «Abo-Rechnung(en)» (sinngemäss; die Seiten zeigen Entwürfe aus dem Abo-Job).
  - `lib/notifications.ts:109-110`: Betreff `Abo-Rechnungen zur Überprüfung – ${n} neue Rechnung(en)` und Text `${n} neue Abo-Rechnung(en) warten auf Überprüfung.`
  - `app/(app)/settings/SettingsForm.tsx:376`, `scripts/splice-manual-screenshots.ts:20`, `README.md:21`, `marketing/features-section.html:93`: Wortlaut auf «Abos» bzw. «wiederkehrende Rechnungen (monatlich, quartalsweise, jährlich)» ändern.
  - `ApplicationSettings.defaultYearlyInvoice` (Schema, `settings/actions.ts:101`) ist schon heute ungenutzt und bleibt ausdrücklich ausserhalb dieses Features.
  Falls ein Test auf die alten Texte prüft (`grep -rn "Jahresrechnung" tests`), anpassen.

- [ ] **Step 6: Verifizieren**

Run: `npx tsc --noEmit`, `npm run lint`, `npm test` → alles grün. `npm run db:seed` gegen eine frische Dev-DB lokal prüfen (`DATABASE_URL=file:./data/seed-check.db npx prisma migrate deploy && DATABASE_URL=file:./data/seed-check.db npm run db:seed`, danach die Datei löschen).

- [ ] **Step 7: Commit**

```bash
git add app lib prisma scripts tests README.md marketing
git commit -m "feat(subscriptions): show subscriptions in dashboard, customer list, export and seeds"
```

---

### Task 7: Dokumentation und Abschluss

**Files:**
- Modify: `CLAUDE.md`, `FEATURE_ANALYSE.md:232`, `public/benutzerhandbuch.html`, `docs/superpowers/specs/2026-09-30-f11-flexible-abos-design.md`

- [ ] **Step 1: CLAUDE.md.** Den Stichpunkt `lib/yearly-invoices.ts handles automatic recurring invoice creation` ersetzen durch:

```
- **Subscriptions** (`lib/subscriptions.ts`, `lib/subscription-dates.ts`): a `Subscription` (several per customer; interval Monthly/Quarterly/Yearly, `InvoiceTemplate`, `nextInvoiceDate`, `autoSend`, `active`) replaces the old `Customer.yearlyInvoice`. The daily job `checkSubscriptions` creates a Draft with the template's items (no template → empty draft) plus a `PendingEmail` and advances the date in one transaction (catch-up: one invoice per run). `autoSend` (template with at least one item required) then sends through `sendPendingInvoice` (`lib/pending-email-send.ts`, shared with `approvePendingEmail`) as `SYSTEM_ACTOR`; on failure the draft and pending mail stay for manual approval and the admins are notified via `notifyAdmins`. A day that does not exist in the target month is clamped (31 Jan → 28 Feb) and stays clamped
```

- [ ] **Step 2: `FEATURE_ANALYSE.md:232`:** `- [ ] 9. F11 flexible Abos` → `- [x] 9. F11 flexible Abos`.

- [ ] **Step 3: Handbuch.** `grep -n "Jahresrechnung" public/benutzerhandbuch.html | cut -c1-200` zeigt die Stellen (die Datei enthält eingebettete Base64-Bilder; nie die ganze Zeile ausgeben). Den Abschnitt um «Geplante Jahresrechnungen» (Zeile ~508) auf «Abos» umschreiben: Abos werden auf der Kundenseite angelegt (Intervall, nächstes Datum, Vorlage, optional automatischer Versand, Pausieren); ohne Vorlage entsteht ein leerer Entwurf.

- [ ] **Step 4: Spec abgleichen.** In der Spec unter «Job» präzisieren: «`autoSend` sendet nur Vorlagen mit mindestens einer Position. Bei Fehler bleiben Entwurf und `PendingEmail` bestehen, und die Admins werden über `notifyAdmins` (Notify-E-Mail, Telegram) benachrichtigt.» Zusätzlich im Abschnitt UI «Datumswerte werden lokal geparst (`lib/date.ts`)» ergänzen.

- [ ] **Step 5: Gesamtprüfung**

Run: `npm test`, `npm run lint`, `npx tsc --noEmit`, `npm run build`. Alle müssen grün sein; Fehlschläge ansehen und beheben (keine Tests löschen oder abschwächen).

- [ ] **Step 6: Commit**

```bash
git add CLAUDE.md FEATURE_ANALYSE.md public/benutzerhandbuch.html docs/superpowers/specs/2026-09-30-f11-flexible-abos-design.md
git commit -m "docs(subscriptions): document flexible subscriptions and mark F11 done"
```
