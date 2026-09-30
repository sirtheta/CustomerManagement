# F5 Zahlungen und offene Posten Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rechnungen lassen sich in Teilzahlungen begleichen (neues Modell `Payment`, Status `PartiallyPaid`), Auswertungen rechnen nach Zahlungsdatum, und eine Offene-Posten-Liste zeigt Forderungen per Stichtag mit Altersstruktur.

**Architecture:** `Payment` ist die Quelle der Wahrheit. `lib/payments.ts` kapselt alle Zahlungsänderungen und berechnet danach `Invoice.state` und `Invoice.paidDate` neu (Beträge in Rappen als Integer). Bestehende Zahlwege (manuell, CAMT-Import, Budget-Import) rufen dieselben Funktionen. Die OP-Liste ist eine reine Funktion in `lib/receivables.ts` über geladenen Rechnungen samt Zahlungen.

**Tech Stack:** Next.js 16 (Server Actions), Prisma 7 + SQLite (better-sqlite3), Vitest, shadcn/ui, Tailwind 4.

**Spec:** `docs/superpowers/specs/2026-09-30-f5-zahlungen-offene-posten-design.md`

## Global Constraints

- UI-Texte, Fehlermeldungen und Doku auf Deutsch. Commit-Messages auf Englisch (Conventional Commits, z. B. `feat(payments): ...`), Commits enden mit der Co-Authored-By-Zeile des ausführenden Modells (z. B. `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`).
- Jeder Commit ist grün: `npx tsc --noEmit` und die bis dahin betroffenen Tests laufen durch.
- Produktion wendet Migrationen per reinem SQL in `scripts/startup.js` an (kein Prisma CLI). Die Migration muss als SQL lauffähig sein.
- Beträge werden in Rappen als Integer verglichen (`Math.round(x * 100)`), nie als Gleitkomma.
- Mutationen sind Server Actions und beginnen mit `requireEditor()`. Jede Mutation schreibt `logAudit`.
- Next.js 16: vor Änderungen an Routing/Datenabruf `node_modules/next/dist/docs/` prüfen, keine Annahmen aus älteren Versionen.
- Tests: `npx vitest run <datei>`; Integrationstests nutzen `createTestDatabase()` aus `tests/test-utils.ts` (`prisma db push` auf Temp-DB).
- Skonto, Debitorenverlust, Kundenguthaben, Gutschrift, Bankbewegungs-Speicherung und Mahnung auf Restbetrag sind ausser Umfang.
- Bekannte, bewusste Abweichung: Kategorie-Auswertung und Kategorie-Drilldown (Analytics) bleiben rechnungsbasiert (vollständig bezahlte Rechnungen, `paidDate` = Datum der letzten Zahlung). Nur Summen, Monatsverlauf und Top-Kunden laufen über `Payment`.
- Zahlungen werden nicht bearbeitet, nur gelöscht und neu erfasst. Es gibt kein `updatePayment`.
- Rechnungen mit Zahlungen lassen sich nicht löschen (Einnahmen verschwänden sonst ohne Payment-Audit).

---

### Task 1: Schema und Migration

**Files:**
- Modify: `prisma/schema.prisma` (enum `InvoiceState` ~Zeile 321, Modell `Invoice` ~Zeile 33)
- Create: `prisma/migrations/<timestamp>_payments/migration.sql` (per `--create-only` erzeugen)
- Modify: `tests/test-utils.ts` (beforeEach-Cleanup)
- Modify (Label-Maps, `PartiallyPaid` ergänzen): `app/(app)/invoices/page.tsx`, `app/(app)/invoices/[id]/page.tsx`, `app/(app)/customers/[id]/page.tsx`, `app/(app)/search/page.tsx`, `app/(app)/analytics/components/drilldown-drawer.tsx`, `app/api/export/invoices/route.ts`
- Test: `tests/integration/payments-migration.test.ts`

**Interfaces:**
- Produces: Prisma-Modell `Payment { id, invoiceId, date, amount: Decimal, source: string, bankReference: string | null, createdAt }`, Relation `Invoice.payments Payment[]`, Enum-Wert `InvoiceState.PartiallyPaid`.

- [ ] **Step 1: Schema ändern**

In `prisma/schema.prisma` `PartiallyPaid` ins Enum `InvoiceState` (nach `Sent`) aufnehmen, in `Invoice` die Relation `payments Payment[]` ergänzen und das Modell anlegen:

```prisma
model Payment {
  id            Int      @id @default(autoincrement())
  invoiceId     Int
  date          DateTime
  amount        Decimal
  source        String   @default("manual") // manual | camt-import | budget-import | migration
  bankReference String?
  createdAt     DateTime @default(now())
  invoice       Invoice  @relation(fields: [invoiceId], references: [id], onDelete: Cascade)

  @@index([invoiceId])
  @@index([date])
}
```

- [ ] **Step 2: Migration erzeugen und Datenumwandlung anhängen**

Run: `npx prisma migrate dev --name payments --create-only`
Expected: neuer Ordner `prisma/migrations/<timestamp>_payments/` mit `CREATE TABLE "Payment"` und den zwei Indizes.

Am Ende der erzeugten `migration.sql` anhängen (Enum-Wert braucht in SQLite keine SQL-Änderung, Enums sind TEXT):

```sql
-- Backfill: one payment per already paid invoice
INSERT INTO "Payment" ("invoiceId", "date", "amount", "source")
SELECT "id", COALESCE("paidDate", "date"), "totalAmount", 'migration'
FROM "Invoice"
WHERE "state" = 'Paid';
```

- [ ] **Step 3: Failing Test schreiben**

`tests/integration/payments-migration.test.ts`:

```ts
import { describe, it, expect, afterAll } from "vitest";
import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { tmpdir } from "os";
import { randomUUID } from "crypto";

// Replays the real migration folders in order (like scripts/startup.js) on a
// throwaway SQLite file. Paid invoices that exist before the payments
// migration must end up with exactly one payment over their total.
const migrationsDir = path.join(process.cwd(), "prisma", "migrations");
const folders = fs
  .readdirSync(migrationsDir, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name)
  .filter((n) => fs.existsSync(path.join(migrationsDir, n, "migration.sql")))
  .sort();
const MIGRATION = folders.find((n) => n.endsWith("_payments"))!;

function applyMigration(db: Database.Database, name: string) {
  const sql = fs.readFileSync(path.join(migrationsDir, name, "migration.sql"), "utf8");
  db.pragma("foreign_keys = OFF");
  try {
    db.transaction(() => db.exec(sql))();
  } finally {
    db.pragma("foreign_keys = ON");
  }
}

describe(`migration ${MIGRATION}`, () => {
  const dbPath = path.join(tmpdir(), `migration-${randomUUID()}.db`);
  const db = new Database(dbPath);
  afterAll(() => {
    db.close();
    fs.rmSync(dbPath, { force: true });
  });

  it("creates one payment per Paid invoice and leaves others alone", () => {
    expect(MIGRATION).toBeDefined();
    const idx = folders.indexOf(MIGRATION);
    for (const name of folders.slice(0, idx)) applyMigration(db, name);

    // FK off: the customer row is irrelevant for this test
    db.pragma("foreign_keys = OFF");
    const insert = db.prepare(
      `INSERT INTO "Invoice" ("customerId", "documentNumber", "date", "totalAmount", "dueDate", "state", "paidDate")
       VALUES (1, ?, 1700000000000, ?, 1702592000000, ?, ?)`
    );
    insert.run("R-1", 120.5, "Paid", 1701000000000);
    insert.run("R-2", 80, "Paid", null);
    insert.run("R-3", 50, "Sent", null);

    applyMigration(db, MIGRATION);

    const rows = db
      .prepare(
        `SELECT i."documentNumber" AS nr, p."amount" AS amount, p."date" AS date, p."source" AS source
         FROM "Payment" p JOIN "Invoice" i ON i."id" = p."invoiceId" ORDER BY i."id"`
      )
      .all();
    expect(rows).toEqual([
      { nr: "R-1", amount: 120.5, date: 1701000000000, source: "migration" },
      { nr: "R-2", amount: 80, date: 1700000000000, source: "migration" },
    ]);
  });
});
```

- [ ] **Step 4: Test laufen lassen**

Run: `npx vitest run tests/integration/payments-migration.test.ts`
Expected: PASS. Schlägt der Erwartungswert bei `amount` wegen Typ fehl (z. B. String statt Zahl), den Test auf die tatsächliche SQLite-Rückgabe anpassen, nicht die Migration.

- [ ] **Step 5: Test-Cleanup ergänzen**

In `tests/test-utils.ts` im `beforeEach` vor `await p.invoiceSentLog.deleteMany();` einfügen: `await p.payment.deleteMany();`

- [ ] **Step 6: Prisma Client generieren, Label-Maps ergänzen**

Run: `npx prisma generate; npx tsc --noEmit`
Expected: Fehler „Property 'PartiallyPaid' is missing in type ..." bei jeder `Record<InvoiceState, ...>`-Map. Die Liste als Arbeitsliste nutzen und in jeder Map ergänzen: `PartiallyPaid: "Teilbezahlt"` (Labels), `PartiallyPaid: "secondary"` (Badge-Variante). Zusätzlich, obwohl tsc dort nicht meldet (`Partial<Record>` bzw. untypisiert): im Drilldown-Drawer Label „Teilbezahlt“ und Farbklasse `"bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400"`, im Rechnungs-Export `PartiallyPaid: "Teilbezahlt"`. In `app/(app)/invoices/page.tsx` der Filter-Liste (Zeile ~47) `{ value: "PartiallyPaid", label: "Teilbezahlt" }` nach `Sent` hinzufügen.

Run: `npx tsc --noEmit`
Expected: keine Fehler.

- [ ] **Step 7: Commit**

```bash
git add prisma tests app
git commit -m "feat(payments): add Payment model and PartiallyPaid state"
```

---

### Task 2: Kernlogik `lib/payments.ts`

**Files:**
- Create: `lib/payments.ts`
- Modify: `lib/audit.ts` (Typ `AuditEntity` um `"Payment"` erweitern)
- Test: `tests/unit/payments-state.test.ts`, `tests/integration/payments.test.ts`

**Interfaces:**
- Produces (alle in `lib/payments.ts`):
  - `type PaymentSource = "manual" | "camt-import" | "budget-import" | "migration"`
  - `class PaymentError extends Error` (Nachricht auf Deutsch, für die UI)
  - `toRappen(value: number | { toNumber(): number }): number`
  - `computeInvoiceState(input: { state: InvoiceState; totalRappen: number; paidRappen: number; dueDate: Date; now?: Date }): InvoiceState`
  - `getPaymentSummary(invoiceId: number, prisma?: PrismaClient): Promise<{ totalRappen: number; paidRappen: number; remainingRappen: number; overpaidRappen: number }>`
  - `recordPayment(params: { invoiceId: number; amount: number; date: Date; source: PaymentSource; bankReference?: string | null; actor: Session }, prisma?): Promise<{ paymentId: number; state: InvoiceState }>`
  - `recordRemainingPayment(params: { invoiceId: number; date: Date; source: PaymentSource; bankReference?: string | null; actor: Session }, prisma?): Promise<{ paymentId: number; state: InvoiceState } | null>` (`null`, wenn kein Restbetrag offen; Restbetrag wird in derselben Transaktion wie das Anlegen berechnet, damit ein Doppelklick keine zweite Zahlung erzeugt)
  - `deletePayment(params: { paymentId: number; actor: Session }, prisma?): Promise<{ state: InvoiceState }>`
  - `syncInvoiceState(params: { invoiceId: number; actor: Session; source: string }, prisma?): Promise<{ state: InvoiceState }>` (berechnet Status/`paidDate` neu, z. B. nach Änderung des Rechnungsbetrags, und schreibt bei Wechsel einen `STATUS`-Audit)
  - `sumOpenAmount(prisma?): Promise<{ amount: number; count: number }>` (Summe Restbeträge aller Rechnungen in `Sent`, `Overdue`, `PartiallyPaid`, in Franken)

- [ ] **Step 1: Failing Unit-Test für `computeInvoiceState` und `toRappen`**

`tests/unit/payments-state.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { computeInvoiceState, toRappen } from "@/lib/payments";

const future = new Date("2099-01-01");
const past = new Date("2000-01-01");
const base = { totalRappen: 10000, dueDate: future };

describe("toRappen", () => {
  it("rounds floating point noise", () => {
    expect(toRappen(0.1 + 0.2)).toBe(30);
    expect(toRappen(123.45)).toBe(12345);
    expect(toRappen({ toNumber: () => 19.99 })).toBe(1999);
  });
});

describe("computeInvoiceState", () => {
  it("is Paid when payments cover the total", () => {
    expect(computeInvoiceState({ ...base, state: "Sent", paidRappen: 10000 })).toBe("Paid");
  });
  it("is Paid on overpayment", () => {
    expect(computeInvoiceState({ ...base, state: "Overdue", paidRappen: 12000 })).toBe("Paid");
  });
  it("is PartiallyPaid for a partial sum", () => {
    expect(computeInvoiceState({ ...base, state: "Sent", paidRappen: 1 })).toBe("PartiallyPaid");
    expect(computeInvoiceState({ ...base, state: "Overdue", paidRappen: 9999 })).toBe("PartiallyPaid");
  });
  it("falls back to Sent when all payments are gone and not due", () => {
    expect(computeInvoiceState({ ...base, state: "Paid", paidRappen: 0 })).toBe("Sent");
    expect(computeInvoiceState({ ...base, state: "PartiallyPaid", paidRappen: 0 })).toBe("Sent");
  });
  it("falls back to Overdue when all payments are gone and due date passed", () => {
    expect(
      computeInvoiceState({ ...base, dueDate: past, state: "Paid", paidRappen: 0 })
    ).toBe("Overdue");
  });
  it("leaves unpaid Sent/Overdue untouched", () => {
    expect(computeInvoiceState({ ...base, state: "Sent", paidRappen: 0 })).toBe("Sent");
    expect(computeInvoiceState({ ...base, state: "Overdue", paidRappen: 0 })).toBe("Overdue");
  });
  it("never changes Draft or Canceled", () => {
    expect(computeInvoiceState({ ...base, state: "Draft", paidRappen: 10000 })).toBe("Draft");
    expect(computeInvoiceState({ ...base, state: "Canceled", paidRappen: 10000 })).toBe("Canceled");
  });
  it("does not mark a zero-total invoice Paid without a payment", () => {
    expect(computeInvoiceState({ ...base, totalRappen: 0, state: "Sent", paidRappen: 0 })).toBe("Sent");
  });
});
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag prüfen**

Run: `npx vitest run tests/unit/payments-state.test.ts`
Expected: FAIL (Modul `@/lib/payments` fehlt).

- [ ] **Step 3: `lib/audit.ts` erweitern**

`AuditEntity` um `| "Payment"` ergänzen.

- [ ] **Step 4: `lib/payments.ts` implementieren**

```ts
import defaultPrisma from "@/lib/prisma";
import type { InvoiceState, Prisma, PrismaClient } from "@prisma/client";
import type { Session } from "next-auth";
import { logAudit } from "@/lib/audit";

export type PaymentSource = "manual" | "camt-import" | "budget-import" | "migration";

/** Validation error whose message is safe to show in the UI. */
export class PaymentError extends Error {}

type Db = PrismaClient | Prisma.TransactionClient;

export function toRappen(value: number | { toNumber(): number }): number {
  const n = typeof value === "number" ? value : value.toNumber();
  return Math.round(n * 100);
}

export function computeInvoiceState(input: {
  state: InvoiceState;
  totalRappen: number;
  paidRappen: number;
  dueDate: Date;
  now?: Date;
}): InvoiceState {
  const { state, totalRappen, paidRappen, dueDate } = input;
  if (state === "Draft" || state === "Canceled") return state;
  if (paidRappen > 0 && paidRappen >= totalRappen) return "Paid";
  if (paidRappen > 0) return "PartiallyPaid";
  if (state === "Paid" || state === "PartiallyPaid") {
    return dueDate.getTime() < (input.now ?? new Date()).getTime() ? "Overdue" : "Sent";
  }
  return state;
}

async function sumPaidRappen(db: Db, invoiceId: number): Promise<number> {
  const payments = await db.payment.findMany({ where: { invoiceId }, select: { amount: true } });
  return payments.reduce((sum, p) => sum + toRappen(p.amount), 0);
}

/**
 * Recomputes `state` and `paidDate` of an invoice from its payments.
 * Returns the previous and the new state.
 */
async function recalculateInvoiceState(
  db: Db,
  invoiceId: number
): Promise<{ from: InvoiceState; to: InvoiceState; documentNumber: string | null }> {
  const invoice = await db.invoice.findUniqueOrThrow({
    where: { id: invoiceId },
    select: { state: true, totalAmount: true, dueDate: true, documentNumber: true },
  });
  const paidRappen = await sumPaidRappen(db, invoiceId);
  const to = computeInvoiceState({
    state: invoice.state,
    totalRappen: toRappen(invoice.totalAmount),
    paidRappen,
    dueDate: invoice.dueDate,
  });

  let paidDate: Date | null = null;
  if (to === "Paid") {
    const last = await db.payment.findFirst({
      where: { invoiceId },
      orderBy: [{ date: "desc" }, { id: "desc" }],
      select: { date: true },
    });
    paidDate = last?.date ?? null;
  }

  await db.invoice.update({ where: { id: invoiceId }, data: { state: to, paidDate } });
  // A reminder only makes sense while the invoice is Overdue.
  if (to !== "Overdue") await db.pendingReminder.deleteMany({ where: { invoiceId } });

  return { from: invoice.state, to, documentNumber: invoice.documentNumber };
}

export async function getPaymentSummary(invoiceId: number, prisma: PrismaClient = defaultPrisma) {
  const invoice = await prisma.invoice.findUniqueOrThrow({
    where: { id: invoiceId },
    select: { totalAmount: true },
  });
  const totalRappen = toRappen(invoice.totalAmount);
  const paidRappen = await sumPaidRappen(prisma, invoiceId);
  return {
    totalRappen,
    paidRappen,
    remainingRappen: Math.max(totalRappen - paidRappen, 0),
    overpaidRappen: Math.max(paidRappen - totalRappen, 0),
  };
}

function validate(amount: number, date: Date) {
  if (!Number.isFinite(amount) || toRappen(amount) <= 0) {
    throw new PaymentError("Der Betrag muss grösser als 0 sein.");
  }
  if (isNaN(date.getTime())) throw new PaymentError("Ungültiges Datum.");
}

async function logStatusChange(
  actor: Session,
  invoiceId: number,
  change: { from: InvoiceState; to: InvoiceState; documentNumber: string | null },
  source: string,
  prisma: PrismaClient,
  extra: Record<string, unknown> = {}
) {
  if (change.from === change.to) return;
  await logAudit(
    actor,
    "STATUS",
    "Invoice",
    invoiceId,
    change.documentNumber ?? undefined,
    { from: change.from, to: change.to, source, ...extra },
    prisma
  );
}

type RecordParams = {
  invoiceId: number;
  date: Date;
  source: PaymentSource;
  bankReference?: string | null;
  actor: Session;
};

/**
 * Creates a payment and recalculates the invoice in one transaction.
 * `amount: "remaining"` books the open remainder read inside that same
 * transaction, so two concurrent "mark paid" clicks cannot both book it.
 * Returns null only for "remaining" when nothing is open.
 */
async function createPayment(
  params: RecordParams & { amount: number | "remaining" },
  prisma: PrismaClient
): Promise<{ paymentId: number; state: InvoiceState } | null> {
  if (params.amount === "remaining") {
    if (isNaN(params.date.getTime())) throw new PaymentError("Ungültiges Datum.");
  } else {
    validate(params.amount, params.date);
  }

  const result = await prisma.$transaction(async (tx) => {
    const invoice = await tx.invoice.findUnique({
      where: { id: params.invoiceId },
      select: { state: true, totalAmount: true },
    });
    if (!invoice) throw new PaymentError("Rechnung nicht gefunden.");
    if (invoice.state === "Draft" || invoice.state === "Canceled") {
      throw new PaymentError("Für Entwürfe und stornierte Rechnungen sind keine Zahlungen möglich.");
    }
    const amountRappen =
      params.amount === "remaining"
        ? toRappen(invoice.totalAmount) - (await sumPaidRappen(tx, params.invoiceId))
        : toRappen(params.amount);
    if (amountRappen <= 0) return null;

    const payment = await tx.payment.create({
      data: {
        invoiceId: params.invoiceId,
        date: params.date,
        amount: amountRappen / 100,
        source: params.source,
        bankReference: params.bankReference ?? null,
      },
    });
    const change = await recalculateInvoiceState(tx, params.invoiceId);
    return { payment, change, amountRappen };
  });
  if (!result) return null;

  await logAudit(
    params.actor,
    "CREATE",
    "Payment",
    result.payment.id,
    result.change.documentNumber ?? undefined,
    {
      invoiceId: params.invoiceId,
      amount: result.amountRappen / 100,
      date: params.date,
      source: params.source,
      ...(params.bankReference ? { bankReference: params.bankReference } : {}),
    },
    prisma
  );
  await logStatusChange(params.actor, params.invoiceId, result.change, params.source, prisma);
  return { paymentId: result.payment.id, state: result.change.to };
}

export async function recordPayment(
  params: RecordParams & { amount: number },
  prisma: PrismaClient = defaultPrisma
): Promise<{ paymentId: number; state: InvoiceState }> {
  // Never null: validate() rejects amounts <= 0 before the transaction.
  return (await createPayment(params, prisma))!;
}

export async function recordRemainingPayment(
  params: RecordParams,
  prisma: PrismaClient = defaultPrisma
): Promise<{ paymentId: number; state: InvoiceState } | null> {
  return createPayment({ ...params, amount: "remaining" }, prisma);
}

/** Recomputes state/paidDate after the invoice total changed. */
export async function syncInvoiceState(
  params: { invoiceId: number; actor: Session; source: string },
  prisma: PrismaClient = defaultPrisma
): Promise<{ state: InvoiceState }> {
  const change = await prisma.$transaction((tx) => recalculateInvoiceState(tx, params.invoiceId));
  await logStatusChange(params.actor, params.invoiceId, change, params.source, prisma);
  return { state: change.to };
}

export async function deletePayment(
  params: { paymentId: number; actor: Session },
  prisma: PrismaClient = defaultPrisma
): Promise<{ state: InvoiceState }> {
  const result = await prisma.$transaction(async (tx) => {
    const existing = await tx.payment.findUnique({ where: { id: params.paymentId } });
    if (!existing) throw new PaymentError("Zahlung nicht gefunden.");
    await tx.payment.delete({ where: { id: params.paymentId } });
    const change = await recalculateInvoiceState(tx, existing.invoiceId);
    return { existing, change };
  });

  await logAudit(
    params.actor,
    "DELETE",
    "Payment",
    params.paymentId,
    result.change.documentNumber ?? undefined,
    {
      invoiceId: result.existing.invoiceId,
      amount: result.existing.amount.toNumber(),
      date: result.existing.date,
    },
    prisma
  );
  await logStatusChange(params.actor, result.existing.invoiceId, result.change, "manual", prisma);
  return { state: result.change.to };
}

/** Remaining amount (CHF) and count of all invoices still awaiting money. */
export async function sumOpenAmount(
  prisma: PrismaClient = defaultPrisma
): Promise<{ amount: number; count: number }> {
  const invoices = await prisma.invoice.findMany({
    where: { state: { in: ["Sent", "Overdue", "PartiallyPaid"] } },
    select: { totalAmount: true, payments: { select: { amount: true } } },
  });
  let rappen = 0;
  for (const inv of invoices) {
    const paid = inv.payments.reduce((s, p) => s + toRappen(p.amount), 0);
    rappen += Math.max(toRappen(inv.totalAmount) - paid, 0);
  }
  return { amount: rappen / 100, count: invoices.length };
}
```

- [ ] **Step 5: Unit-Test laufen lassen**

Run: `npx vitest run tests/unit/payments-state.test.ts`
Expected: PASS.

- [ ] **Step 6: Failing Integrationstest schreiben**

`tests/integration/payments.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import type { Session } from "next-auth";
import { createTestDatabase, createValidTestCustomer } from "../test-utils";
import {
  recordPayment,
  recordRemainingPayment,
  deletePayment,
  getPaymentSummary,
  sumOpenAmount,
  syncInvoiceState,
  PaymentError,
} from "@/lib/payments";

const actor = { user: { id: "1", name: "Tester", email: "t@example.ch" } } as Session;

describe("payments against a real database", () => {
  const db = createTestDatabase();

  async function seedInvoice(total = 100, state: "Sent" | "Overdue" | "Draft" = "Sent") {
    const customer = await db.prisma.customer.create({ data: createValidTestCustomer() });
    return db.prisma.invoice.create({
      data: {
        customerId: customer.customerId,
        documentNumber: state === "Draft" ? null : `R-${Math.floor(Math.random() * 1e8)}`,
        date: new Date("2026-01-01"),
        dueDate: new Date("2099-01-01"),
        totalAmount: total,
        state,
      },
    });
  }

  it("partial payment sets PartiallyPaid, rest sets Paid with last payment date", async () => {
    const inv = await seedInvoice(100);
    const first = await recordPayment(
      { invoiceId: inv.id, amount: 40, date: new Date("2026-03-01"), source: "manual", actor },
      db.prisma
    );
    expect(first.state).toBe("PartiallyPaid");
    let row = await db.prisma.invoice.findUniqueOrThrow({ where: { id: inv.id } });
    expect(row.paidDate).toBeNull();

    const second = await recordPayment(
      { invoiceId: inv.id, amount: 60, date: new Date("2026-05-02"), source: "manual", actor },
      db.prisma
    );
    expect(second.state).toBe("Paid");
    row = await db.prisma.invoice.findUniqueOrThrow({ where: { id: inv.id } });
    expect(row.paidDate?.toISOString().slice(0, 10)).toBe("2026-05-02");
  });

  it("accepts an overpayment and reports it in the summary", async () => {
    const inv = await seedInvoice(100);
    await recordPayment(
      { invoiceId: inv.id, amount: 105.5, date: new Date("2026-03-01"), source: "manual", actor },
      db.prisma
    );
    const row = await db.prisma.invoice.findUniqueOrThrow({ where: { id: inv.id } });
    expect(row.state).toBe("Paid");
    expect(await getPaymentSummary(inv.id, db.prisma)).toEqual({
      totalRappen: 10000,
      paidRappen: 10550,
      remainingRappen: 0,
      overpaidRappen: 550,
    });
  });

  it("rejects payments on drafts and non-positive amounts", async () => {
    const draft = await seedInvoice(100, "Draft");
    await expect(
      recordPayment({ invoiceId: draft.id, amount: 10, date: new Date(), source: "manual", actor }, db.prisma)
    ).rejects.toBeInstanceOf(PaymentError);
    const inv = await seedInvoice(100);
    await expect(
      recordPayment({ invoiceId: inv.id, amount: 0, date: new Date(), source: "manual", actor }, db.prisma)
    ).rejects.toBeInstanceOf(PaymentError);
  });

  it("recordRemainingPayment pays the rest once and returns null afterwards", async () => {
    const inv = await seedInvoice(100);
    await recordPayment(
      { invoiceId: inv.id, amount: 30, date: new Date("2026-02-01"), source: "manual", actor },
      db.prisma
    );
    const res = await recordRemainingPayment(
      { invoiceId: inv.id, date: new Date("2026-02-02"), source: "manual", actor },
      db.prisma
    );
    expect(res?.state).toBe("Paid");
    const payments = await db.prisma.payment.findMany({ where: { invoiceId: inv.id } });
    expect(payments.map((p) => p.amount.toNumber()).sort()).toEqual([30, 70]);
    expect(
      await recordRemainingPayment(
        { invoiceId: inv.id, date: new Date(), source: "manual", actor },
        db.prisma
      )
    ).toBeNull();
  });

  it("deleting payments walks the state back and clears paidDate", async () => {
    const inv = await seedInvoice(100);
    const { paymentId } = await recordPayment(
      { invoiceId: inv.id, amount: 100, date: new Date("2026-02-01"), source: "manual", actor },
      db.prisma
    );
    const { state } = await deletePayment({ paymentId, actor }, db.prisma);
    expect(state).toBe("Sent");
    const row = await db.prisma.invoice.findUniqueOrThrow({ where: { id: inv.id } });
    expect(row.paidDate).toBeNull();
  });

  it("concurrent recordRemainingPayment calls book the remainder only once", async () => {
    const inv = await seedInvoice(100);
    const params = { invoiceId: inv.id, date: new Date("2026-02-01"), source: "manual" as const, actor };
    const results = await Promise.all([
      recordRemainingPayment(params, db.prisma),
      recordRemainingPayment(params, db.prisma),
    ]);
    expect(results.filter((r) => r !== null)).toHaveLength(1);
    expect(await db.prisma.payment.count({ where: { invoiceId: inv.id } })).toBe(1);
  });

  it("syncInvoiceState follows a changed invoice total", async () => {
    const inv = await seedInvoice(100);
    await recordPayment(
      { invoiceId: inv.id, amount: 100, date: new Date("2026-02-01"), source: "manual", actor },
      db.prisma
    );
    await db.prisma.invoice.update({ where: { id: inv.id }, data: { totalAmount: 150 } });
    expect((await syncInvoiceState({ invoiceId: inv.id, actor, source: "edit" }, db.prisma)).state).toBe(
      "PartiallyPaid"
    );
    let row = await db.prisma.invoice.findUniqueOrThrow({ where: { id: inv.id } });
    expect(row.paidDate).toBeNull();

    await db.prisma.invoice.update({ where: { id: inv.id }, data: { totalAmount: 80 } });
    expect((await syncInvoiceState({ invoiceId: inv.id, actor, source: "edit" }, db.prisma)).state).toBe("Paid");
    row = await db.prisma.invoice.findUniqueOrThrow({ where: { id: inv.id } });
    expect(row.paidDate?.toISOString().slice(0, 10)).toBe("2026-02-01");
  });

  it("deletes the pending reminder when the invoice becomes Paid", async () => {
    const inv = await seedInvoice(100, "Overdue");
    await db.prisma.pendingReminder.create({ data: { invoiceId: inv.id } });
    await recordPayment(
      { invoiceId: inv.id, amount: 100, date: new Date(), source: "manual", actor },
      db.prisma
    );
    expect(await db.prisma.pendingReminder.count({ where: { invoiceId: inv.id } })).toBe(0);
  });

  it("writes payment and status audit entries", async () => {
    const inv = await seedInvoice(100);
    await recordPayment(
      { invoiceId: inv.id, amount: 100, date: new Date(), source: "camt-import", bankReference: "REF1", actor },
      db.prisma
    );
    const logs = await db.prisma.auditLog.findMany({ orderBy: { id: "asc" } });
    expect(logs.map((l) => `${l.action}:${l.entityType}`)).toEqual(["CREATE:Payment", "STATUS:Invoice"]);
    expect(JSON.parse(logs[1].details!)).toMatchObject({ from: "Sent", to: "Paid", source: "camt-import" });
  });

  it("sumOpenAmount subtracts payments and includes PartiallyPaid", async () => {
    const a = await seedInvoice(100);
    await seedInvoice(50);
    await recordPayment(
      { invoiceId: a.id, amount: 40, date: new Date(), source: "manual", actor },
      db.prisma
    );
    expect(await sumOpenAmount(db.prisma)).toEqual({ amount: 110, count: 2 });
  });
});
```

- [ ] **Step 7: Integrationstest laufen lassen**

Run: `npx vitest run tests/integration/payments.test.ts`
Expected: PASS (Implementierung aus Step 4 existiert bereits). Fehlschläge beheben, bevor es weitergeht. Schlägt der Parallel-Test fehl, serialisiert der `better-sqlite3`-Adapter die interaktiven Transaktionen nicht: dann in `createPayment` die Transaktion mit `isolationLevel: "Serializable"` starten bzw. den Adapter-Code in `node_modules/@prisma/adapter-better-sqlite3` prüfen, nicht den Test lockern.

- [ ] **Step 8: Commit**

```bash
git add lib tests
git commit -m "feat(payments): add payment service with state recalculation"
```

---

### Task 3: Bestehende Zahlwege auf `recordPayment` umstellen

**Files:**
- Modify: `lib/payment-matching.ts`
- Modify: `lib/import/matching.ts` (`OpenInvoice.totalAmount` → `openAmount`)
- Modify: `app/(app)/invoices/actions.ts` (`updateInvoice`, `updateInvoiceStatus`, `updateInvoicePaidDate` entfernen, `markInvoicesPaidFromImport`, `deleteInvoice`)
- Modify: `app/(app)/invoices/import/actions.ts` (offene Rechnungen)
- Modify: `app/(app)/invoices/import/ImportWizard.tsx` (Betrag mitschicken, Toast-Text)
- Create: `app/(app)/invoices/payments/actions.ts`
- Modify (Tests): `tests/unit/invoice-paid-date.test.ts`, `tests/unit/payment-matching.test.ts`, `tests/unit/import-matching.test.ts`, `tests/integration/payment-matching.test.ts`, `tests/integration/state-transitions.test.ts`, weitere nach Fehlerlauf
- Create (Test): `tests/integration/camt-import-payments.test.ts`

**Interfaces:**
- Consumes: `recordPayment`, `recordRemainingPayment`, `deletePayment`, `getPaymentSummary`, `syncInvoiceState`, `PaymentError`, `toRappen` aus `lib/payments.ts`.
- Changes: `ImportMatch` bekommt `amountCents: number` (Betrag der Bankbewegung). `updateInvoiceStatus` liefert `Promise<{ error?: string }>` statt `Promise<void>`. `deleteInvoice` liefert einen Fehler, wenn Zahlungen existieren.
- Produces (Server Actions in `app/(app)/invoices/payments/actions.ts`):
  - `recordPaymentAction(invoiceId: number, amountRaw: string, dateRaw: string, confirmOverpayment: boolean): Promise<{ error?: string; needsConfirmation?: { overpaidBy: number } }>`
  - `markInvoicePaidAction(invoiceId: number): Promise<{ error?: string }>`
  - `deletePaymentAction(paymentId: number): Promise<{ error?: string }>`

- [ ] **Step 1: `lib/payment-matching.ts` anpassen**

`markInvoicePaid` und den Import von `logAudit` entfernen. `matchAndMarkPaid` so ändern, dass es Kandidaten in `state: { in: ["Sent", "Overdue", "PartiallyPaid"] }` sucht, den Restbetrag (`getPaymentSummary(...).remainingRappen`) statt `totalAmount` vergleicht und bei Treffer verbucht:

```ts
import { getPaymentSummary, recordPayment } from "@/lib/payments";
// ...
  for (const documentNumber of candidates) {
    const invoice = await prisma.invoice.findFirst({
      where: { documentNumber, state: { in: ["Sent", "Overdue", "PartiallyPaid"] } },
    });
    if (!invoice) continue;

    const { remainingRappen } = await getPaymentSummary(invoice.id, prisma);
    if (remainingRappen !== params.amountRappen) continue;

    const paidDate = params.bookingDate ? new Date(params.bookingDate) : new Date();

    await recordPayment(
      {
        invoiceId: invoice.id,
        amount: params.amountRappen / 100,
        date: paidDate,
        source: "budget-import",
        actor: SYSTEM_ACTOR,
      },
      prisma
    );

    return { matched: true, invoiceId: invoice.id, documentNumber };
  }
```

Der Kommentar über `SYSTEM_ACTOR` bleibt, der Docblock von `matchAndMarkPaid` wird angepasst („whose remaining amount matches“). Die Funktion wirft nie: bei ungültigem `bookingDate` (`isNaN`) wird `new Date()` verwendet.

- [ ] **Step 2: Server Actions für Zahlungen anlegen**

`app/(app)/invoices/payments/actions.ts`:

```ts
"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import prisma from "@/lib/prisma";
import { requireEditor } from "@/lib/permissions";
import { ANALYTICS_CACHE_TAG } from "@/lib/cache-tags";
import logger from "@/lib/logger";
import {
  PaymentError,
  deletePayment,
  getPaymentSummary,
  recordPayment,
  recordRemainingPayment,
  toRappen,
} from "@/lib/payments";

const log = logger.child({ module: "payment-actions" });

function refresh(invoiceId: number) {
  revalidatePath(`/invoices/${invoiceId}`);
  revalidatePath("/invoices");
  revalidatePath("/invoices/reminders");
  revalidatePath("/accounting");
  revalidatePath("/accounting/receivables");
  revalidatePath("/dashboard");
  revalidateTag(ANALYTICS_CACHE_TAG, { expire: 0 });
}

function parseAmount(raw: string): number {
  return Number(raw.trim().replace(/'/g, "").replace(",", "."));
}

export async function recordPaymentAction(
  invoiceId: number,
  amountRaw: string,
  dateRaw: string,
  confirmOverpayment: boolean
): Promise<{ error?: string; needsConfirmation?: { overpaidBy: number } }> {
  const session = await requireEditor();
  const amount = parseAmount(amountRaw);
  const date = new Date(dateRaw);
  if (!Number.isFinite(amount) || amount <= 0) return { error: "Der Betrag muss grösser als 0 sein." };
  if (isNaN(date.getTime())) return { error: "Ungültiges Datum." };

  try {
    const summary = await getPaymentSummary(invoiceId);
    const overpaidRappen = summary.paidRappen + toRappen(amount) - summary.totalRappen;
    if (overpaidRappen > 0 && !confirmOverpayment) {
      return { needsConfirmation: { overpaidBy: overpaidRappen / 100 } };
    }
    await recordPayment({ invoiceId, amount, date, source: "manual", actor: session });
  } catch (err) {
    if (err instanceof PaymentError) return { error: err.message };
    log.error({ invoiceId, err }, "recordPaymentAction failed");
    return { error: "Zahlung konnte nicht gespeichert werden." };
  }
  refresh(invoiceId);
  return {};
}

export async function markInvoicePaidAction(invoiceId: number): Promise<{ error?: string }> {
  const session = await requireEditor();
  try {
    await recordRemainingPayment({ invoiceId, date: new Date(), source: "manual", actor: session });
  } catch (err) {
    if (err instanceof PaymentError) return { error: err.message };
    log.error({ invoiceId, err }, "markInvoicePaidAction failed");
    return { error: "Zahlung konnte nicht gespeichert werden." };
  }
  refresh(invoiceId);
  return {};
}

export async function deletePaymentAction(paymentId: number): Promise<{ error?: string }> {
  const session = await requireEditor();
  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    select: { invoiceId: true },
  });
  if (!payment) return { error: "Zahlung nicht gefunden." };
  try {
    await deletePayment({ paymentId, actor: session });
  } catch (err) {
    if (err instanceof PaymentError) return { error: err.message };
    log.error({ paymentId, err }, "deletePaymentAction failed");
    return { error: "Zahlung konnte nicht gelöscht werden." };
  }
  refresh(payment.invoiceId);
  return {};
}
```

- [ ] **Step 3: `updateInvoiceStatus` umbauen, `updateInvoicePaidDate` entfernen**

In `app/(app)/invoices/actions.ts`:
- Import `markInvoicePaid` ersetzen durch `import { PaymentError, recordRemainingPayment, syncInvoiceState, toRappen } from "@/lib/payments";`.
- `updateInvoicePaidDate` komplett löschen.
- `updateInvoiceStatus` ersetzen durch:

```ts
export async function updateInvoiceStatus(
  id: number,
  state: InvoiceState
): Promise<{ error?: string }> {
  const session = await requireEditor();

  const current = await prisma.invoice.findUnique({
    where: { id },
    select: { state: true, documentNumber: true, totalAmount: true },
  });
  if (!current) return { error: "Rechnung nicht gefunden." };
  if (current.state === state) return {};
  // PartiallyPaid results from payments only. Leaving Paid/PartiallyPaid
  // works by deleting the payments, so state and payments never disagree.
  if (state === "PartiallyPaid") {
    return { error: "„Teilbezahlt“ ergibt sich aus den erfassten Zahlungen." };
  }
  const hasPayments = current.state === "Paid" || current.state === "PartiallyPaid";
  if (hasPayments && state !== "Paid") {
    return { error: "Zum Zurücksetzen zuerst die Zahlungen löschen." };
  }
  // Checked before any change: a zero invoice has nothing to pay, and a
  // Draft must not be turned Sent/numbered for a Paid that then fails.
  if (state === "Paid" && toRappen(current.totalAmount) <= 0) {
    return { error: "Die Rechnung hat keinen offenen Betrag." };
  }

  const NUMBERED_STATES: InvoiceState[] = ["Sent", "Overdue", "Paid"];
  let documentNumber = current.documentNumber;
  if (!current.documentNumber && NUMBERED_STATES.includes(state)) {
    documentNumber = await assignDocumentNumber("invoice", id, { actor: session });
  }

  if (state === "Paid") {
    // A Draft must become Sent first: payments are not allowed on drafts.
    if (current.state === "Draft") {
      await prisma.invoice.update({ where: { id }, data: { state: "Sent" } });
      await logAudit(session, "STATUS", "Invoice", id, documentNumber ?? undefined, {
        from: "Draft",
        to: "Sent",
      });
    }
    try {
      await recordRemainingPayment({ invoiceId: id, date: new Date(), source: "manual", actor: session });
    } catch (err) {
      if (err instanceof PaymentError) return { error: err.message };
      throw err;
    }
  } else {
    await prisma.invoice.update({ where: { id }, data: { state } });
    await logAudit(session, "STATUS", "Invoice", id, documentNumber ?? undefined, {
      from: current.state,
      to: state,
    });
  }

  // Reminders only make sense while the invoice is Overdue; any other
  // state clears the pending one so it disappears from the Mahnungen list.
  if (state !== "Overdue") {
    await prisma.pendingReminder.deleteMany({ where: { invoiceId: id } });
  }

  revalidatePath(`/invoices/${id}`);
  revalidatePath("/invoices");
  revalidatePath("/invoices/reminders");
  revalidatePath("/accounting");
  revalidatePath("/accounting/receivables");
  revalidatePath("/dashboard");
  revalidateTag(ANALYTICS_CACHE_TAG, { expire: 0 });
  return {};
}
```

Hinweis: `paidDate` wird nicht mehr von Hand gesetzt (`recalculateInvoiceState` macht das); der Wechsel weg von `Paid` ist gesperrt, `leavingPaid`/`becomingPaid` entfallen.

`InvoiceStatusSelect.handleChange` wertet das Ergebnis aus: `const res = await updateInvoiceStatus(...); if (res.error) toast.error(res.error);` (`toast` aus `sonner`). Der optimistische Wert fällt nach der Transition von selbst auf `currentState` zurück.

- [ ] **Step 3b: `updateInvoice` und `deleteInvoice` an Zahlungen anpassen**

In `updateInvoice` nach dem erfolgreichen `updateDocumentWithItems` (vor `logAudit`) den Status aus den Zahlungen neu berechnen, damit ein geänderter Rechnungsbetrag `state`/`paidDate` nachzieht (z. B. `Paid` → `PartiallyPaid`, wenn der Betrag steigt):

```ts
  await syncInvoiceState({ invoiceId: id, actor: session, source: "edit" });
```

Für Rechnungen ohne Zahlungen ändert das nichts (`computeInvoiceState` lässt `Draft`/`Sent`/`Overdue` bei Summe 0 unverändert). `revalidatePath("/accounting/receivables")` und `revalidatePath("/dashboard")` ergänzen.

In `deleteInvoice` vor dem `delete` prüfen:

```ts
  const paymentCount = await prisma.payment.count({ where: { invoiceId: id } });
  if (paymentCount > 0) {
    return { error: "Die Rechnung hat erfasste Zahlungen. Bitte zuerst die Zahlungen löschen." };
  }
```

`DeleteInvoiceButton` zeigt den Fehler über `ConfirmDialog` bereits als Toast an (`onConfirm` darf `{ error }` liefern).

- [ ] **Step 4: `markInvoicesPaidFromImport` umbauen**

Der CAMT-Import bucht den Betrag der Bankbewegung, nicht den Restbetrag: Auch Treffer über die Referenz mit abweichendem Betrag (Teilzahlung) werden in der Vorschau angeboten (`lib/import/matching.ts`, Konfidenz `amount`) und dürfen nach Bestätigung nicht die ganze Rechnung ausgleichen.

`ImportMatch` erweitern:

```ts
export type ImportMatch = {
  invoiceId: number;
  /** Booking date from the statement entry, YYYY-MM-DD. */
  paidDate: string;
  /** Credited amount of the statement entry, in Rappen. */
  amountCents: number;
  bankReference: string | null;
};
```

In `ImportWizard.handleConfirm` beim Mapping `amountCents: match.transaction.amountCents` mitgeben. Toast-Texte: „1 Zahlung verbucht.“ bzw. „`${count}` Zahlungen verbucht.“.

In `markInvoicesPaidFromImport` den Schleifenkörper nach der bestehenden `paidDate`-Prüfung ersetzen: akzeptierter Ausgangsstatus ist `Sent`, `Overdue` oder `PartiallyPaid`, gebucht wird `amountCents`. Doppelte Bestätigung derselben Bankbewegung (zwei Browser-Tabs, erneuter Upload) wird über die `bankReference` erkannt, weil ohne F7 keine Bankbewegungen gespeichert werden:

```ts
    if (!Number.isInteger(match.amountCents) || match.amountCents <= 0) continue;

    const current = await prisma.invoice.findUnique({
      where: { id: match.invoiceId },
      select: { state: true },
    });
    if (
      !current ||
      (current.state !== "Sent" && current.state !== "Overdue" && current.state !== "PartiallyPaid")
    ) {
      continue;
    }
    if (
      match.bankReference &&
      (await prisma.payment.count({
        where: { invoiceId: match.invoiceId, bankReference: match.bankReference },
      })) > 0
    ) {
      continue;
    }

    try {
      await recordPayment({
        invoiceId: match.invoiceId,
        amount: match.amountCents / 100,
        date: paidDate,
        source: "camt-import",
        bankReference: match.bankReference,
        actor: session,
      });
      paidCount++;
    } catch (err) {
      if (!(err instanceof PaymentError)) throw err;
    }
```

`recordPayment` und `PaymentError` im Import aus `@/lib/payments` ergänzen. Docblock „Marks invoices paid“ → „Records the confirmed statement entries as payments“. Zusätzlich `revalidatePath("/accounting/receivables")` und `revalidatePath("/dashboard")` ergänzen. Die Funktion behält ihren Namen, damit der Wizard-Import stabil bleibt.

- [ ] **Step 5: CAMT-Vorschau auf Restbeträge umstellen**

In `lib/import/matching.ts` das Feld `OpenInvoice.totalAmount` in `openAmount` umbenennen (Doc: „Francs still open: total minus recorded payments.“) und die beiden `centsOf(... .totalAmount)` entsprechend anpassen. Den Docblock von `matchStatementToInvoices` („`Sent`/`Overdue` only“) um `PartiallyPaid` ergänzen und den Modul-Kommentar zum Duplikatschutz anpassen („once an invoice is fully paid it drops out … a partial payment is recognised by its `bankReference`“). In `tests/unit/import-matching.test.ts` `totalAmount` → `openAmount` ersetzen.

In `app/(app)/invoices/import/actions.ts` die Abfrage ändern auf `state: { in: ["Sent", "Overdue", "PartiallyPaid"] }`, `select` um `payments: { select: { amount: true } }` erweitern und im Mapping den Restbetrag liefern:

```ts
      .map((invoice) => {
        const paidRappen = invoice.payments.reduce((s, p) => s + toRappen(p.amount), 0);
        return {
          id: invoice.id,
          documentNumber: invoice.documentNumber,
          openAmount: Math.max(toRappen(invoice.totalAmount) - paidRappen, 0) / 100,
        };
      }),
```

(`toRappen` aus `@/lib/payments` importieren; der `.filter` auf `documentNumber !== null` bleibt davor, der Typ-Guard muss erhalten bleiben.)

- [ ] **Step 6: Integrationstest CAMT-Import mit Teilzahlung**

`tests/integration/camt-import-payments.test.ts` (Server Action direkt aufrufen; `requireEditor`, `next/cache` und `@/lib/prisma` wie in bestehenden Action-Tests mocken bzw. auf `db.prisma` umleiten, Muster aus `tests/integration/payment-matching.test.ts` bzw. `tests/unit/invoice-paid-date.test.ts` übernehmen):

- Rechnung 100, `Sent`. `markInvoicesPaidFromImport([{ invoiceId, paidDate: "2026-03-01", amountCents: 4000, bankReference: "REF-A" }])` → `paidCount: 1`, Status `PartiallyPaid`, eine Zahlung 40 mit `source: "camt-import"`, `bankReference: "REF-A"`.
- Dieselbe Bewegung nochmals bestätigen → `paidCount: 0`, weiterhin eine Zahlung.
- Zweite Bewegung `paidDate: "2026-03-15"`, `amountCents: 6000`, `bankReference: "REF-B"` → `Paid`, `Invoice.paidDate` = 2026-03-15.
- Rechnung `Paid` oder `Draft` als Ziel → übersprungen.

Run: `npx vitest run tests/integration/camt-import-payments.test.ts`
Expected: PASS.

- [ ] **Step 7: Bestehende Tests anpassen**

Run: `npx vitest run 2>&1 | tail -60`
Erwartete Fehlschläge und Anpassung:
- `tests/unit/invoice-paid-date.test.ts`: Tests für `updateInvoicePaidDate` löschen. Für `updateInvoiceStatus` `@/lib/payments` mit `vi.mock("@/lib/payments", () => ({ recordRemainingPayment: vi.fn(), syncInvoiceState: vi.fn(), toRappen: (v: number | { toNumber(): number }) => Math.round((typeof v === "number" ? v : v.toNumber()) * 100), PaymentError: class extends Error {} }))` mocken. Erwartungen: Wechsel auf `Paid` ruft `recordRemainingPayment` mit `{ invoiceId, source: "manual" }` und macht kein `invoice.update` mit `paidDate`; Wechsel `Paid` → `Sent` und Ziel `PartiallyPaid` liefern `{ error }` und ändern nichts; `Sent` → `Overdue` macht `invoice.update({ data: { state } })` plus `logAudit("STATUS")`; `Draft` → `Paid` setzt erst `state: "Sent"` und loggt `STATUS` Draft → Sent; Rechnung mit Total 0 → `Paid` liefert `{ error }` ohne Nummernvergabe; `PaymentError` aus `recordRemainingPayment` kommt als `{ error }` zurück. `deleteInvoice`: neuer Fall „Zahlungen vorhanden → `{ error }`, kein `delete`“ (Mock `payment.count` ergänzen), bestehende Fälle mit `payment.count` → 0. Dateiname ggf. in `invoice-status-actions.test.ts` ändern.
- Tests für `updateInvoice` (vermutlich `tests/unit/document-actions.test.ts` oder `tests/integration/invoices.test.ts`): `syncInvoiceState` mocken bzw. mit echter DB laufen lassen.
- `tests/unit/payment-matching.test.ts` und `tests/integration/payment-matching.test.ts`: `markInvoicePaid`-Erwartungen durch Payment-Erwartungen ersetzen. Der Integrationstest prüft nun zusätzlich `prisma.payment.findMany({ where: { invoiceId } })` mit einer Zahlung über 123.45 und `source: "budget-import"`; der Audit-Test erwartet für `entityType: "Invoice"` weiterhin genau einen `STATUS`-Eintrag mit `{ from: "Overdue", to: "Paid", source: "budget-import" }` (Payment-Audit hat `entityType: "Payment"`, fällt nicht in den Filter). Neuer Test: Rechnung `PartiallyPaid` mit 40 von 100 bezahlt, Match mit 6000 Rappen → `Paid`.
- `tests/unit/external-payments-route.test.ts`: falls es `matchAndMarkPaid`-Interna mockt, auf das neue Verhalten anpassen.
- `tests/integration/state-transitions.test.ts`: nur anpassen, wenn er bricht. Die Query-Tests (`income-statement`, `analytics-queries`) lesen in diesem Task noch `paidDate` und bleiben grün; sie werden erst in Task 5 umgestellt.

- [ ] **Step 8: Tests, Lint, Commit**

Run: `npx tsc --noEmit; npx vitest run; npm run lint`
Expected: alles grün.

```bash
git add lib app tests
git commit -m "feat(payments): route manual, CAMT and Budget payments through recordPayment"
```

---

### Task 4: Zahlungsblock auf der Rechnungsseite

**Files:**
- Create: `app/(app)/invoices/PaymentsPanel.tsx`
- Delete: `app/(app)/invoices/PaidDateField.tsx`
- Modify: `app/(app)/invoices/[id]/page.tsx`
- Modify: `app/(app)/invoices/InvoiceStatusSelect.tsx`

(Label-Maps für `PartiallyPaid` sind bereits in Task 1 ergänzt.)

**Interfaces:**
- Consumes: `recordPaymentAction`, `markInvoicePaidAction`, `deletePaymentAction` (Task 3).
- Produces: Komponente `PaymentsPanel` mit Props `{ invoiceId: number; state: InvoiceState; canEdit: boolean; summary: { total: number; paid: number; remaining: number; overpaid: number }; payments: { id: number; date: string; amount: number; source: string }[] }` (Beträge in Franken, Datum ISO).

- [ ] **Step 1: `InvoiceStatusSelect` anpassen**

`stateOptions` bekommt `{ value: "PartiallyPaid", label: "Teilbezahlt" }` (nur zur Anzeige des aktuellen Werts) und die Komponente deaktiviert Optionen: `PartiallyPaid` ist nie wählbar, und bei `currentState` `Paid` oder `PartiallyPaid` ist alles ausser `Paid` gesperrt. Im `SelectItem`:

```tsx
const locked = currentState === "Paid" || currentState === "PartiallyPaid";
// ...
{stateOptions.map((opt) => (
  <SelectItem
    key={opt.value}
    value={opt.value}
    disabled={
      opt.value === "PartiallyPaid" ? opt.value !== currentState : locked && opt.value !== "Paid" && opt.value !== currentState
    }
  >
    {opt.label}
  </SelectItem>
))}
```

Unterhalb des Selects ein Hinweis, wenn `locked`: `<p className="text-xs text-muted-foreground">Zum Zurücksetzen die Zahlungen löschen.</p>` (Select und Hinweis in einen `<div className="space-y-1">` wickeln).

- [ ] **Step 2: `PaymentsPanel` schreiben**

`app/(app)/invoices/PaymentsPanel.tsx`:

```tsx
"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatCurrency, formatDate } from "@/lib/utils";
import {
  deletePaymentAction,
  markInvoicePaidAction,
  recordPaymentAction,
} from "./payments/actions";
import type { InvoiceState } from "@prisma/client";

type Props = {
  invoiceId: number;
  state: InvoiceState;
  canEdit: boolean;
  summary: { total: number; paid: number; remaining: number; overpaid: number };
  payments: { id: number; date: string; amount: number; source: string }[];
};

const SOURCE_LABELS: Record<string, string> = {
  manual: "Manuell",
  "camt-import": "Bankimport",
  "budget-import": "Budget-App",
  migration: "Übernommen",
};

export default function PaymentsPanel({ invoiceId, state, canEdit, summary, payments }: Props) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [amount, setAmount] = useState(summary.remaining > 0 ? summary.remaining.toFixed(2) : "");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [overpaidBy, setOverpaidBy] = useState<number | null>(null);

  const canPay = canEdit && (state === "Sent" || state === "Overdue" || state === "PartiallyPaid" || state === "Paid");
  const canMarkPaid = canEdit && (state === "Sent" || state === "Overdue" || state === "PartiallyPaid");

  function run(action: () => Promise<{ error?: string; needsConfirmation?: { overpaidBy: number } }>) {
    setError(null);
    startTransition(async () => {
      const res = await action();
      if (res.error) setError(res.error);
      else if (res.needsConfirmation) setOverpaidBy(res.needsConfirmation.overpaidBy);
      else setOverpaidBy(null);
    });
  }

  function submit(confirm: boolean) {
    run(() => recordPaymentAction(invoiceId, amount, date, confirm));
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-6 text-sm">
        <div>Total: <span className="font-medium">{formatCurrency(summary.total)}</span></div>
        <div>Bezahlt: <span className="font-medium">{formatCurrency(summary.paid)}</span></div>
        {summary.remaining > 0 && (
          <div>Offen: <span className="font-medium">{formatCurrency(summary.remaining)}</span></div>
        )}
        {summary.overpaid > 0 && (
          <Badge variant="secondary">Überzahlt um {formatCurrency(summary.overpaid)}</Badge>
        )}
      </div>

      {payments.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Datum</TableHead>
              <TableHead>Betrag</TableHead>
              <TableHead>Quelle</TableHead>
              {canEdit && <TableHead className="w-24" />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {payments.map((p) => (
              <TableRow key={p.id}>
                <TableCell>{formatDate(p.date)}</TableCell>
                <TableCell>{formatCurrency(p.amount)}</TableCell>
                <TableCell>{SOURCE_LABELS[p.source] ?? p.source}</TableCell>
                {canEdit && (
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={isPending}
                      onClick={() => {
                        if (window.confirm("Zahlung wirklich löschen?")) {
                          run(() => deletePaymentAction(p.id));
                        }
                      }}
                    >
                      Löschen
                    </Button>
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {canPay && (
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="paymentAmount">Betrag (CHF)</Label>
            <Input
              id="paymentAmount"
              inputMode="decimal"
              className="w-36"
              value={amount}
              onChange={(e) => { setAmount(e.target.value); setOverpaidBy(null); }}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="paymentDate">Datum</Label>
            <Input
              id="paymentDate"
              type="date"
              className="w-40"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>
          <Button variant="outline" disabled={isPending} onClick={() => submit(false)}>
            Zahlung erfassen
          </Button>
          {canMarkPaid && (
            <Button disabled={isPending} onClick={() => run(() => markInvoicePaidAction(invoiceId))}>
              Als bezahlt markieren
            </Button>
          )}
        </div>
      )}

      {overpaidBy !== null && (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm dark:bg-amber-900/20">
          <p>
            Der Betrag übersteigt den offenen Betrag um {formatCurrency(overpaidBy)}. Trotzdem speichern?
          </p>
          <div className="mt-2 flex gap-2">
            <Button size="sm" disabled={isPending} onClick={() => submit(true)}>Ja, speichern</Button>
            <Button size="sm" variant="outline" onClick={() => setOverpaidBy(null)}>Abbrechen</Button>
          </div>
        </div>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
```

- [ ] **Step 3: Rechnungsseite einbinden**

In `app/(app)/invoices/[id]/page.tsx`:
- `PaidDateField`-Import und die Verwendung (Zeilen ~230–235) entfernen; `PaidDateField.tsx` löschen.
- `include` der Abfrage um `payments: { orderBy: [{ date: "asc" }, { id: "asc" }] }` erweitern.
- Session holen (`auth()` aus `@/lib/auth`, `hasRole` aus `@/lib/permissions`, `UserRole` aus `@prisma/client`; so wie in `app/api/export/accounting/route.ts`) und `canEdit = hasRole(session, [UserRole.Admin, UserRole.Editor])` berechnen. Falls die Seite schon eine Session nutzt, diese wiederverwenden.
- Die Summen berechnen und eine neue Card vor „Status ändern“ einfügen (nur wenn `invoice.state !== "Draft" && invoice.state !== "Canceled"`):

```tsx
import PaymentsPanel from "../PaymentsPanel";
import { toRappen } from "@/lib/payments";
// ...
const totalRappen = toRappen(invoice.totalAmount);
const paidRappen = invoice.payments.reduce((s, p) => s + toRappen(p.amount), 0);
const summary = {
  total: totalRappen / 100,
  paid: paidRappen / 100,
  remaining: Math.max(totalRappen - paidRappen, 0) / 100,
  overpaid: Math.max(paidRappen - totalRappen, 0) / 100,
};
// ...
{invoice.state !== "Draft" && invoice.state !== "Canceled" && (
  <Card>
    <CardHeader>
      <CardTitle>Zahlungen</CardTitle>
    </CardHeader>
    <CardContent>
      <PaymentsPanel
        invoiceId={invoice.id}
        state={invoice.state}
        canEdit={canEdit}
        summary={summary}
        payments={invoice.payments.map((p) => ({
          id: p.id,
          date: p.date.toISOString(),
          amount: p.amount.toNumber(),
          source: p.source,
        }))}
      />
    </CardContent>
  </Card>
)}
```

Die Komponente `PaymentsPanel` setzt den Standardbetrag beim ersten Rendern; nach Server-Refresh soll er auf den neuen Restbetrag springen. Dafür im Panel `key` setzen: `<PaymentsPanel key={`${invoice.payments.length}-${summary.remaining}`} ... />`.

- [ ] **Step 4: Build-Check und Commit**

Run: `npx tsc --noEmit; npm run lint`
Expected: keine Fehler.

Manuell prüfen (`npm run dev`, Login als Admin): Rechnung `Sent` öffnen → Teilbetrag erfassen → Status „Teilbezahlt“, Offen sinkt → Überzahlung löst Bestätigung aus → „Als bezahlt markieren“ → „Bezahlt“ → Rechnung löschen verweigert (Toast) → Rechnungsbetrag erhöhen → „Teilbezahlt“ → Status-Select auf „Versendet“ verweigert (Toast) → Zahlungen löschen → zurück auf „Versendet“.

```bash
git add app
git commit -m "feat(payments): add payments panel and PartiallyPaid labels to invoice UI"
```

---

### Task 5: Auswertungen, Dashboard und Export auf `Payment` umstellen

**Files:**
- Modify: `app/(app)/accounting/lib/income-statement-queries.ts`
- Modify: `app/(app)/accounting/page.tsx`
- Modify: `app/api/export/accounting/route.ts`
- Modify: `app/(app)/dashboard/page.tsx`
- Modify: `app/(app)/analytics/lib/analytics-queries.ts`
- Modify (Tests): `tests/integration/income-statement.test.ts`, `tests/unit/analytics-queries.test.ts`, weitere Fehlschläge

**Interfaces:**
- Consumes: `sumOpenAmount` (Task 2), `Payment`-Modell.
- Produces: `fetchPaidInvoicesForYear` heisst neu `fetchPaymentsForYear` und liefert `IncomeRow { id: number /* paymentId */; invoiceId: number; documentNumber: string | null; customerName: string; paidDate: string; amount: number }`.

- [ ] **Step 1: Failing Test für die GuV anpassen**

In `tests/integration/income-statement.test.ts` die Fixtures so ändern, dass statt `state: Paid` + `paidDate` Rechnungen mit `payments: { create: [{ date, amount }] }` angelegt werden, und zwei neue Fälle ergänzen:

```ts
it("books a partial payment and the rest in their own months", async () => {
  const { prisma } = db;
  const customer = await prisma.customer.create({ data: createValidTestCustomer() });
  await prisma.invoice.create({
    data: {
      customerId: customer.customerId,
      documentNumber: "R-1",
      date: new Date("2026-01-10"),
      dueDate: new Date("2026-02-10"),
      totalAmount: 100,
      state: "Paid",
      paidDate: new Date("2026-05-02T12:00:00Z"),
      payments: {
        create: [
          { date: new Date("2026-03-05T12:00:00Z"), amount: 40 },
          { date: new Date("2026-05-02T12:00:00Z"), amount: 60 },
        ],
      },
    },
  });

  const result = await fetchIncomeStatement(prisma, 2026);
  expect(result.monthlyResults[2].income).toBe(40); // März
  expect(result.monthlyResults[4].income).toBe(60); // Mai
  expect(result.totalIncome).toBe(100);
});

it("counts the payment of a PartiallyPaid invoice as income", async () => {
  const { prisma } = db;
  const customer = await prisma.customer.create({ data: createValidTestCustomer() });
  await prisma.invoice.create({
    data: {
      customerId: customer.customerId,
      documentNumber: "R-2",
      date: new Date("2026-01-10"),
      dueDate: new Date("2026-02-10"),
      totalAmount: 100,
      state: "PartiallyPaid",
      payments: { create: [{ date: new Date("2026-04-01T12:00:00Z"), amount: 25 }] },
    },
  });
  expect((await fetchIncomeStatement(prisma, 2026)).totalIncome).toBe(25);
});
```

Run: `npx vitest run tests/integration/income-statement.test.ts`
Expected: FAIL (Queries lesen noch `paidDate`).

- [ ] **Step 2: `income-statement-queries.ts` umstellen**

In `fetchIncomeStatement` die zwei Invoice-Abfragen ersetzen:

```ts
  const [payments, expenses, paymentDateRange, expenseDateRange] = await Promise.all([
    prisma.payment.findMany({
      where: { date: { gte: yearStart, lt: yearEnd } },
      select: { date: true, amount: true },
    }),
    prisma.expense.findMany({
      where: { date: { gte: yearStart, lt: yearEnd } },
      select: { date: true, amount: true },
    }),
    prisma.payment.aggregate({ _min: { date: true }, _max: { date: true } }),
    prisma.expense.aggregate({ _min: { date: true }, _max: { date: true } }),
  ]);

  const incomeByMonth = new Array(12).fill(0) as number[];
  for (const pay of payments) {
    incomeByMonth[pay.date.getMonth()] += pay.amount.toNumber();
  }
```

`paidDateRange` → `paymentDateRange` mit `_min.date`/`_max.date` in der Jahre-Menge. `InvoiceState`-Import entfernen, falls ungenutzt. `fetchPaidInvoicesForYear` ersetzen:

```ts
export type IncomeRow = {
  id: number;
  invoiceId: number;
  documentNumber: string | null;
  customerName: string;
  paidDate: string;
  amount: number;
};

export async function fetchPaymentsForYear(prisma: PrismaClient, year: number): Promise<IncomeRow[]> {
  const yearStart = new Date(year, 0, 1);
  const yearEnd = new Date(year + 1, 0, 1);

  const payments = await prisma.payment.findMany({
    where: { date: { gte: yearStart, lt: yearEnd } },
    orderBy: [{ date: "desc" }, { id: "desc" }],
    select: {
      id: true,
      date: true,
      amount: true,
      invoice: {
        select: {
          id: true,
          documentNumber: true,
          customer: { select: { company: true, contactPerson: true, contactInsteadOfCompany: true } },
        },
      },
    },
  });

  return payments.map((p) => ({
    id: p.id,
    invoiceId: p.invoice.id,
    documentNumber: p.invoice.documentNumber,
    customerName: customerDisplayName(p.invoice.customer),
    paidDate: p.date.toISOString(),
    amount: p.amount.toNumber(),
  }));
}
```

- [ ] **Step 3: Buchhaltungsseite anpassen**

In `app/(app)/accounting/page.tsx`: Import und Aufruf `fetchPaidInvoicesForYear` → `fetchPaymentsForYear`; Tabellentitel „Bezahlte Rechnungen“ → „Zahlungseingänge {Jahr}“; Spalte „Bezahlt am“ bleibt; Zeile: `key={inv.id}` (Payment-ID), Link auf `/invoices/${inv.invoiceId}`, Betrag `formatCurrency(inv.amount)`; Leerzustand „Keine Zahlungseingänge vorhanden.“. Darüber (beim Seitenkopf, neben den bestehenden Aktionen wie dem Export) einen Link-Button zur OP-Liste einfügen: `<Button variant="outline" render={<Link href="/accounting/receivables" />}>Offene Posten</Button>` (Stil wie dort vorhandene Buttons).

- [ ] **Step 4: CSV-Export umstellen**

In `app/api/export/accounting/route.ts` die erste Abfrage ersetzen und Zeilen pro Zahlung bauen:

```ts
  const [payments, expenses] = await Promise.all([
    prisma.payment.findMany({
      where: { date: { gte: yearStart, lt: yearEnd } },
      include: { invoice: { select: { documentNumber: true } } },
    }),
    // expenses unchanged
  ]);
  // ...
    ...payments.map((p) => ({
      date: p.date,
      type: "Einnahme" as const,
      description: documentLabel(p.invoice.documentNumber),
      category: "",
      amount: p.amount.toNumber(),
    })),
```

`InvoiceState`-Import entfernen, `UserRole` bleibt.

- [ ] **Step 5: Dashboard umstellen**

In `app/(app)/dashboard/page.tsx`:
- Die zweite Abfrage (offene Rechnungen, `aggregate` über `Sent`/`Overdue`) durch `sumOpenAmount(prisma)` ersetzen. Die Verwendung der Ergebnisse (`_sum.totalAmount`, `_count`) auf `.amount` und `.count` umstellen (die Stelle in der JSX und evtl. Zwischenvariablen per Suche auf den Variablennamen finden).
- Die Abfrage „bezahlt im Jahr“ ersetzen durch:

```ts
    prisma.payment.aggregate({
      where: {
        date: {
          gte: new Date(`${currentYear}-01-01`),
          lt: new Date(`${currentYear + 1}-01-01`),
        },
      },
      _sum: { amount: true },
    }),
```

und die Verwendung von `_sum.totalAmount` auf `_sum.amount` ändern.

- [ ] **Step 6: Analytics umstellen**

In `fetchAnalyticsDataUncached`:
- `annualRevenueResult` → `prisma.payment.aggregate({ where: { date: { gte: yearStart, lt: yearEnd } }, _sum: { amount: true } })`; `annualRevenue = result._sum.amount?.toNumber() ?? 0`.
- `outstandingResult` → entfällt, stattdessen `sumOpenAmount(prisma)` im `Promise.all`; `outstanding = open.amount`, `outstandingCount = open.count`.
- `paidInYear` → `prisma.payment.findMany({ where: { date: { gte: yearStart, lt: yearEnd } }, select: { date: true, amount: true, invoice: { select: { customerId: true } } } })`; Monatsverlauf: `monthlyMap[new Date(p.date).getMonth()] += p.amount.toNumber()`.
- `topCustomerGroups` (bisher `invoice.groupBy`) ersetzen durch Summierung in JS aus `paidInYear`:

```ts
  const totalsByCustomer = new Map<number, number>();
  for (const p of paidInYear) {
    totalsByCustomer.set(p.invoice.customerId, (totalsByCustomer.get(p.invoice.customerId) ?? 0) + p.amount.toNumber());
  }
  const topCustomerGroups = [...totalsByCustomer.entries()]
    .map(([customerId, total]) => ({ customerId, total }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 5);
```

und im Mapping `g._sum.totalAmount?.toNumber() ?? 0` → `g.total`.
- `incomeItems` und `fetchDrilldownIncomeItems` (Kategorien) bleiben unverändert (siehe Global Constraints).
- `paymentRate`-Zeile bleibt.

Hinweis: `sumOpenAmount` importieren (`@/lib/payments`). `unstable_cache` bleibt; `sumOpenAmount(prisma)` nimmt hier den globalen `prisma` aus `@/lib/prisma` (Standardargument reicht, ohne Argument aufrufen).

- [ ] **Step 7: Tests anpassen und laufen lassen**

Run: `npx vitest run`
Erwartet: Fehlschläge in `tests/unit/analytics-queries.test.ts` (falls es `fetchAnalyticsData` mit gemocktem Prisma prüft: Mocks auf `payment.aggregate`/`payment.findMany` umstellen, `invoice.groupBy` entfällt), `tests/integration/income-statement.test.ts`, evtl. `tests/unit/accounting-actions.test.ts`. Alle auf das neue Verhalten anpassen, keine Erwartung lockern, die Korrektheit prüft. Danach: Expected PASS für die gesamte Suite.

- [ ] **Step 8: Commit**

```bash
git add app tests
git commit -m "feat(payments): base income statement, analytics, dashboard and export on payments"
```

---

### Task 6: Offene-Posten-Liste

**Files:**
- Create: `lib/receivables.ts`
- Create: `app/(app)/accounting/receivables/page.tsx`
- Create: `app/api/export/receivables/route.ts`
- Test: `tests/unit/receivables.test.ts`, `tests/integration/receivables.test.ts`

**Interfaces:**
- Consumes: `toRappen` (Task 2).
- Produces (`lib/receivables.ts`):
  - `type AgeBucket = "notDue" | "d0_30" | "d31_60" | "d61_90" | "d90plus"`
  - `const AGE_BUCKETS: { key: AgeBucket; label: string }[]` (Reihenfolge wie oben)
  - `ageBucket(dueDate: Date, asOf: Date): AgeBucket`
  - `type ReceivableRow = { invoiceId: number; documentNumber: string | null; customerId: number; customerName: string; date: Date; dueDate: Date; totalRappen: number; paidRappen: number; openRappen: number; creditRappen: number; bucket: AgeBucket | null }` (`bucket` nur bei `openRappen > 0`)
  - `type ReceivablesReport = { asOf: Date; rows: ReceivableRow[]; bucketTotals: Record<AgeBucket, number>; totalOpenRappen: number; totalCreditRappen: number; byCustomer: { customerId: number; customerName: string; openRappen: number; creditRappen: number }[] }`
  - `buildReceivables(invoices: ReceivableInput[], asOf: Date): ReceivablesReport` mit `ReceivableInput = { id: number; documentNumber: string | null; state: InvoiceState; date: Date; dueDate: Date; totalAmount: { toNumber(): number }; customer: { customerId: number; company: string | null; contactPerson: string | null; contactInsteadOfCompany: boolean }; payments: { date: Date; amount: { toNumber(): number } }[] }`
  - `fetchReceivables(prisma: PrismaClient, asOf: Date): Promise<ReceivablesReport>`

- [ ] **Step 1: Failing Unit-Test schreiben**

`tests/unit/receivables.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { ageBucket, buildReceivables, type ReceivableInput } from "@/lib/receivables";

const dec = (n: number) => ({ toNumber: () => n });
const customer = { customerId: 1, company: "Muster AG", contactPerson: "Anna", contactInsteadOfCompany: false };

function inv(over: Partial<ReceivableInput> & { id: number }): ReceivableInput {
  return {
    documentNumber: `R-${over.id}`,
    state: "Sent",
    date: new Date("2026-01-01"),
    dueDate: new Date("2026-02-01"),
    totalAmount: dec(100),
    customer,
    payments: [],
    ...over,
  };
}

describe("ageBucket", () => {
  const asOf = new Date("2026-12-31");
  it("classifies days since due date", () => {
    expect(ageBucket(new Date("2027-01-05"), asOf)).toBe("notDue");
    expect(ageBucket(new Date("2026-12-31"), asOf)).toBe("d0_30");
    expect(ageBucket(new Date("2026-12-01"), asOf)).toBe("d0_30");
    expect(ageBucket(new Date("2026-11-30"), asOf)).toBe("d31_60");
    expect(ageBucket(new Date("2026-10-31"), asOf)).toBe("d61_90");
    expect(ageBucket(new Date("2026-09-01"), asOf)).toBe("d90plus");
  });
});

describe("buildReceivables", () => {
  const asOf = new Date("2026-12-31");

  it("lists unpaid and partially paid invoices with their remaining amount", () => {
    const report = buildReceivables(
      [
        inv({ id: 1 }),
        inv({ id: 2, payments: [{ date: new Date("2026-03-01"), amount: dec(40) }] }),
      ],
      asOf
    );
    expect(report.rows.map((r) => [r.invoiceId, r.openRappen])).toEqual([
      [1, 10000],
      [2, 6000],
    ]);
    expect(report.totalOpenRappen).toBe(16000);
  });

  it("ignores payments after the cut-off date", () => {
    const report = buildReceivables(
      [inv({ id: 1, state: "Paid", payments: [{ date: new Date("2027-01-15"), amount: dec(100) }] })],
      asOf
    );
    expect(report.rows[0].openRappen).toBe(10000);
  });

  it("omits fully paid, draft, canceled and later-dated invoices", () => {
    const report = buildReceivables(
      [
        inv({ id: 1, state: "Paid", payments: [{ date: new Date("2026-03-01"), amount: dec(100) }] }),
        inv({ id: 2, state: "Draft" }),
        inv({ id: 3, state: "Canceled" }),
        inv({ id: 4, date: new Date("2027-01-02") }),
      ],
      asOf
    );
    expect(report.rows).toEqual([]);
  });

  it("reports overpayments as credit, not as open amount", () => {
    const report = buildReceivables(
      [inv({ id: 1, state: "Paid", payments: [{ date: new Date("2026-03-01"), amount: dec(110) }] })],
      asOf
    );
    expect(report.rows[0]).toMatchObject({ openRappen: 0, creditRappen: 1000, bucket: null });
    expect(report.totalCreditRappen).toBe(1000);
    expect(report.totalOpenRappen).toBe(0);
  });

  it("sums per age bucket and per customer", () => {
    const report = buildReceivables(
      [
        inv({ id: 1, dueDate: new Date("2026-12-20") }), // d0_30
        inv({ id: 2, dueDate: new Date("2026-06-01"), customer: { ...customer, customerId: 2, company: "Zweite GmbH" } }), // d90plus
      ],
      asOf
    );
    expect(report.bucketTotals.d0_30).toBe(10000);
    expect(report.bucketTotals.d90plus).toBe(10000);
    expect(report.byCustomer.map((c) => [c.customerId, c.openRappen])).toEqual([
      [1, 10000],
      [2, 10000],
    ]);
  });
});
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag prüfen**

Run: `npx vitest run tests/unit/receivables.test.ts`
Expected: FAIL (Modul fehlt).

- [ ] **Step 3: `lib/receivables.ts` implementieren**

```ts
import type { InvoiceState, PrismaClient } from "@prisma/client";
import { customerDisplayName } from "@/lib/customer-display";
import { toRappen } from "@/lib/payments";

export type AgeBucket = "notDue" | "d0_30" | "d31_60" | "d61_90" | "d90plus";

export const AGE_BUCKETS: { key: AgeBucket; label: string }[] = [
  { key: "notDue", label: "Nicht fällig" },
  { key: "d0_30", label: "0–30 Tage" },
  { key: "d31_60", label: "31–60 Tage" },
  { key: "d61_90", label: "61–90 Tage" },
  { key: "d90plus", label: "über 90 Tage" },
];

const DAY_MS = 86_400_000;

function utcDay(d: Date): number {
  return Math.floor(d.getTime() / DAY_MS);
}

/** Days since the due date; an invoice due on the cut-off day counts as 0–30. */
export function ageBucket(dueDate: Date, asOf: Date): AgeBucket {
  const days = utcDay(asOf) - utcDay(dueDate);
  if (days < 0) return "notDue";
  if (days <= 30) return "d0_30";
  if (days <= 60) return "d31_60";
  if (days <= 90) return "d61_90";
  return "d90plus";
}

export type ReceivableInput = {
  id: number;
  documentNumber: string | null;
  state: InvoiceState;
  date: Date;
  dueDate: Date;
  totalAmount: { toNumber(): number };
  customer: {
    customerId: number;
    company: string | null;
    contactPerson: string | null;
    contactInsteadOfCompany: boolean;
  };
  payments: { date: Date; amount: { toNumber(): number } }[];
};

export type ReceivableRow = {
  invoiceId: number;
  documentNumber: string | null;
  customerId: number;
  customerName: string;
  date: Date;
  dueDate: Date;
  totalRappen: number;
  paidRappen: number;
  openRappen: number;
  creditRappen: number;
  bucket: AgeBucket | null;
};

export type ReceivablesReport = {
  asOf: Date;
  rows: ReceivableRow[];
  bucketTotals: Record<AgeBucket, number>;
  totalOpenRappen: number;
  totalCreditRappen: number;
  byCustomer: { customerId: number; customerName: string; openRappen: number; creditRappen: number }[];
};

export function buildReceivables(invoices: ReceivableInput[], asOf: Date): ReceivablesReport {
  const rows: ReceivableRow[] = [];
  const bucketTotals: Record<AgeBucket, number> = {
    notDue: 0, d0_30: 0, d31_60: 0, d61_90: 0, d90plus: 0,
  };
  const customers = new Map<number, { customerName: string; openRappen: number; creditRappen: number }>();

  for (const inv of invoices) {
    if (inv.state === "Draft" || inv.state === "Canceled") continue;
    if (inv.date.getTime() > asOf.getTime()) continue;

    const totalRappen = toRappen(inv.totalAmount);
    const paidRappen = inv.payments
      .filter((p) => p.date.getTime() <= asOf.getTime())
      .reduce((sum, p) => sum + toRappen(p.amount), 0);
    const rest = totalRappen - paidRappen;
    if (rest === 0) continue;

    const openRappen = Math.max(rest, 0);
    const creditRappen = Math.max(-rest, 0);
    const bucket = openRappen > 0 ? ageBucket(inv.dueDate, asOf) : null;
    if (bucket) bucketTotals[bucket] += openRappen;

    const customerName = customerDisplayName(inv.customer);
    const entry = customers.get(inv.customer.customerId) ?? { customerName, openRappen: 0, creditRappen: 0 };
    entry.openRappen += openRappen;
    entry.creditRappen += creditRappen;
    customers.set(inv.customer.customerId, entry);

    rows.push({
      invoiceId: inv.id,
      documentNumber: inv.documentNumber,
      customerId: inv.customer.customerId,
      customerName,
      date: inv.date,
      dueDate: inv.dueDate,
      totalRappen,
      paidRappen,
      openRappen,
      creditRappen,
      bucket,
    });
  }

  return {
    asOf,
    rows,
    bucketTotals,
    totalOpenRappen: rows.reduce((s, r) => s + r.openRappen, 0),
    totalCreditRappen: rows.reduce((s, r) => s + r.creditRappen, 0),
    byCustomer: [...customers.entries()]
      .map(([customerId, c]) => ({ customerId, ...c }))
      .sort((a, b) => a.customerName.localeCompare(b.customerName, "de")),
  };
}

export async function fetchReceivables(prisma: PrismaClient, asOf: Date): Promise<ReceivablesReport> {
  const invoices = await prisma.invoice.findMany({
    where: {
      state: { notIn: ["Draft", "Canceled"] },
      date: { lte: asOf },
    },
    orderBy: [{ dueDate: "asc" }, { id: "asc" }],
    select: {
      id: true,
      documentNumber: true,
      state: true,
      date: true,
      dueDate: true,
      totalAmount: true,
      customer: {
        select: { customerId: true, company: true, contactPerson: true, contactInsteadOfCompany: true },
      },
      payments: { select: { date: true, amount: true } },
    },
  });
  return buildReceivables(invoices, asOf);
}
```

- [ ] **Step 4: Unit-Test laufen lassen**

Run: `npx vitest run tests/unit/receivables.test.ts`
Expected: PASS.

- [ ] **Step 5: Integrationstest für `fetchReceivables`**

`tests/integration/receivables.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { createTestDatabase, createValidTestCustomer } from "../test-utils";
import { fetchReceivables } from "@/lib/receivables";

describe("fetchReceivables against a real database", () => {
  const db = createTestDatabase();

  it("returns the remaining amount as of the cut-off date", async () => {
    const { prisma } = db;
    const customer = await prisma.customer.create({ data: createValidTestCustomer() });
    await prisma.invoice.create({
      data: {
        customerId: customer.customerId,
        documentNumber: "R-1",
        date: new Date("2026-01-10"),
        dueDate: new Date("2026-02-10"),
        totalAmount: 100,
        state: "Paid",
        paidDate: new Date("2027-02-01"),
        payments: {
          create: [
            { date: new Date("2026-06-01"), amount: 30 },
            { date: new Date("2027-02-01"), amount: 70 },
          ],
        },
      },
    });

    const report = await fetchReceivables(prisma, new Date("2026-12-31"));
    expect(report.rows).toHaveLength(1);
    expect(report.rows[0]).toMatchObject({ documentNumber: "R-1", openRappen: 7000, bucket: "d90plus" });

    const later = await fetchReceivables(prisma, new Date("2027-03-01"));
    expect(later.rows).toEqual([]);
  });
});
```

Run: `npx vitest run tests/integration/receivables.test.ts`
Expected: PASS.

- [ ] **Step 6: Seite `receivables/page.tsx`**

Bestehendes Seitenmuster von `app/(app)/accounting/page.tsx` übernehmen (Rollenprüfung per `requireEditor()` aus `@/lib/permissions` am Anfang, Card/Table-Komponenten, `searchParams` als Promise). Inhalt:

```tsx
import Link from "next/link";
import prisma from "@/lib/prisma";
import { requireEditor } from "@/lib/permissions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { formatCurrency, formatDate } from "@/lib/utils";
import { documentLabel } from "@/lib/document-display";
import { AGE_BUCKETS, fetchReceivables } from "@/lib/receivables";

type Props = { searchParams: Promise<{ asOf?: string }> };

function parseAsOf(raw: string | undefined): Date {
  const parsed = raw ? new Date(`${raw}T23:59:59.999Z`) : null;
  if (parsed && !isNaN(parsed.getTime())) return parsed;
  const now = new Date();
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999));
}

export default async function ReceivablesPage({ searchParams }: Props) {
  await requireEditor();
  const { asOf: asOfParam } = await searchParams;
  const asOf = parseAsOf(asOfParam);
  const asOfValue = asOf.toISOString().slice(0, 10);
  const report = await fetchReceivables(prisma, asOf);
  const lastYearEnd = `${new Date().getFullYear() - 1}-12-31`;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Offene Posten</h1>

      <form className="flex flex-wrap items-end gap-3" method="get">
        <div className="space-y-1.5">
          <Label htmlFor="asOf">Stichtag</Label>
          <Input id="asOf" name="asOf" type="date" defaultValue={asOfValue} className="w-40" />
        </div>
        <Button type="submit" variant="outline">Anzeigen</Button>
        <Button variant="ghost" render={<Link href={`?asOf=${lastYearEnd}`} />}>31.12. Vorjahr</Button>
        <Button variant="outline" render={<a href={`/api/export/receivables?asOf=${asOfValue}`} />}>CSV-Export</Button>
      </form>

      <Card>
        <CardHeader><CardTitle className="text-base">Altersstruktur</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                {AGE_BUCKETS.map((b) => <TableHead key={b.key}>{b.label}</TableHead>)}
                <TableHead>Total offen</TableHead>
                <TableHead>Guthaben</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                {AGE_BUCKETS.map((b) => (
                  <TableCell key={b.key}>{formatCurrency(report.bucketTotals[b.key] / 100)}</TableCell>
                ))}
                <TableCell className="font-semibold">{formatCurrency(report.totalOpenRappen / 100)}</TableCell>
                <TableCell>{formatCurrency(report.totalCreditRappen / 100)}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Pro Kunde</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Kunde</TableHead>
                <TableHead>Offen</TableHead>
                <TableHead>Guthaben</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {report.byCustomer.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={3} className="text-center text-gray-500 py-8">
                    Keine offenen Posten zum Stichtag.
                  </TableCell>
                </TableRow>
              ) : (
                report.byCustomer.map((c) => (
                  <TableRow key={c.customerId}>
                    <TableCell>
                      <Link href={`/customers/${c.customerId}`} className="underline">{c.customerName}</Link>
                    </TableCell>
                    <TableCell>{formatCurrency(c.openRappen / 100)}</TableCell>
                    <TableCell>{formatCurrency(c.creditRappen / 100)}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Rechnungen</CardTitle></CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Rechnung</TableHead>
                  <TableHead>Kunde</TableHead>
                  <TableHead>Datum</TableHead>
                  <TableHead>Fällig</TableHead>
                  <TableHead>Total</TableHead>
                  <TableHead>Bezahlt</TableHead>
                  <TableHead>Offen</TableHead>
                  <TableHead>Guthaben</TableHead>
                  <TableHead>Alter</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {report.rows.map((r) => (
                  <TableRow key={r.invoiceId}>
                    <TableCell>
                      <Link href={`/invoices/${r.invoiceId}`} className="underline">
                        {documentLabel(r.documentNumber)}
                      </Link>
                    </TableCell>
                    <TableCell>{r.customerName}</TableCell>
                    <TableCell>{formatDate(r.date)}</TableCell>
                    <TableCell>{formatDate(r.dueDate)}</TableCell>
                    <TableCell>{formatCurrency(r.totalRappen / 100)}</TableCell>
                    <TableCell>{formatCurrency(r.paidRappen / 100)}</TableCell>
                    <TableCell>{r.openRappen > 0 ? formatCurrency(r.openRappen / 100) : ""}</TableCell>
                    <TableCell>{r.creditRappen > 0 ? formatCurrency(r.creditRappen / 100) : ""}</TableCell>
                    <TableCell>{AGE_BUCKETS.find((b) => b.key === r.bucket)?.label ?? ""}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
```

Falls `requireEditor()` ein Session-Objekt statt `void` liefert, stört das nicht. Falls die Button-Komponente `render` nicht für `<a>` mit `href` akzeptiert, das Muster aus `app/(app)/invoices/[id]/page.tsx` („PDF herunterladen“) übernehmen.

- [ ] **Step 7: CSV-Export-Route**

`app/api/export/receivables/route.ts` (Muster von `app/api/export/accounting/route.ts`):

```ts
import { redirect } from "next/navigation";
import prisma from "@/lib/prisma";
import { buildCsv, csvResponse } from "@/lib/csv-export";
import { auth } from "@/lib/auth";
import { documentLabel } from "@/lib/document-display";
import { hasRole } from "@/lib/permissions";
import { UserRole } from "@prisma/client";
import { AGE_BUCKETS, fetchReceivables } from "@/lib/receivables";

export async function GET(request: Request) {
  const session = await auth();
  if (!session) redirect("/login");
  if (!hasRole(session, [UserRole.Admin, UserRole.Editor])) redirect("/dashboard");

  const raw = new URL(request.url).searchParams.get("asOf");
  const parsed = raw ? new Date(`${raw}T23:59:59.999Z`) : null;
  const now = new Date();
  const asOf =
    parsed && !isNaN(parsed.getTime())
      ? parsed
      : new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999));

  const report = await fetchReceivables(prisma, asOf);
  const headers = [
    "Rechnung", "Kunde", "Rechnungsdatum", "Fällig", "Total (CHF)",
    "Bezahlt (CHF)", "Offen (CHF)", "Guthaben (CHF)", "Alter",
  ];
  const rows = report.rows.map((r) => [
    documentLabel(r.documentNumber),
    r.customerName,
    r.date.toLocaleDateString("de-CH"),
    r.dueDate.toLocaleDateString("de-CH"),
    (r.totalRappen / 100).toFixed(2),
    (r.paidRappen / 100).toFixed(2),
    (r.openRappen / 100).toFixed(2),
    (r.creditRappen / 100).toFixed(2),
    AGE_BUCKETS.find((b) => b.key === r.bucket)?.label ?? "",
  ]);

  return csvResponse(buildCsv(headers, rows), `offene-posten-${asOf.toISOString().slice(0, 10)}.csv`);
}
```

- [ ] **Step 8: Lint, Typecheck, manueller Check, Commit**

Run: `npx tsc --noEmit; npm run lint; npx vitest run tests/unit/receivables.test.ts tests/integration/receivables.test.ts`
Expected: alles grün. Manuell: `/accounting/receivables` im Dev-Server öffnen, Stichtag ändern, CSV herunterladen.

```bash
git add lib app tests
git commit -m "feat(receivables): add open items list with age structure and CSV export"
```

---

### Task 7: Seeds, Doku und Gesamtprüfung

**Files:**
- Modify: `prisma/seed.ts`, `scripts/seed-manual-demo.ts`
- Modify: `CLAUDE.md`, `FEATURE_ANALYSE.md`

- [ ] **Step 1: Seeds um Zahlungen erweitern**

Überall, wo Rechnungen mit `state: InvoiceState.Paid` und `paidDate` angelegt werden (`prisma/seed.ts` ~Zeile 168 und ~Zeile 320, `scripts/seed-manual-demo.ts` ~Zeile 116), im `data` der `prisma.invoice.create` ergänzen:

```ts
payments: paidDate
  ? { create: [{ date: paidDate, amount: totalAmount, source: "manual" }] }
  : undefined,
```

(`totalAmount`/`paidDate` sind die dort bereits berechneten Werte; im zweiten Seed-Block mit `priorDue` und `round2(...)`-Betrag analog, den Betrag in eine lokale Variable ziehen, damit Rechnung und Zahlung denselben Wert haben.) Optional im Dev-Seed eine `PartiallyPaid`-Rechnung mit einer Teilzahlung ergänzen.

- [ ] **Step 2: Doku aktualisieren**

- `CLAUDE.md` Abschnitt „Business document workflow“: `Invoice`-Status um `PartiallyPaid` ergänzen (`Draft → Sent → PartiallyPaid → Paid | Overdue | Canceled`) und einen Absatz „Payments“ anfügen: `Payment` ist Quelle der Wahrheit, `lib/payments.ts` berechnet `state`/`paidDate` neu, Einnahmen in GuV/Analytics/Export folgen `Payment.date`, OP-Liste unter `accounting/receivables` (`lib/receivables.ts`).
- `FEATURE_ANALYSE.md`: in der Roadmap Phase 2 Punkt „6. F5 Zahlungen und offene Posten“ als umgesetzt markieren (Hinweis in Klammern „umgesetzt“), Skonto/Debitorenverlust/Kundenguthaben als offene Folgepunkte in F5 vermerken.

- [ ] **Step 3: Gesamtprüfung**

Run: `npx prisma generate; npx tsc --noEmit; npm run lint; npm test; npm run build`
Expected: alles grün. Schlägt ein Test wegen des neuen Verhaltens fehl, Test auf das Soll-Verhalten der Spec anpassen, nicht die Implementierung verbiegen.

Migration auf bestehender Datenbank prüfen: Kopie einer Dev-DB (`data/customermanagement.db`) anlegen, `node scripts/startup.js` mit `DATABASE_URL=file:<Kopie>` laufen lassen und per `npx prisma studio` oder SQL bestätigen, dass jede bisher bezahlte Rechnung genau eine `migration`-Zahlung hat.

- [ ] **Step 4: Commit**

```bash
git add prisma scripts CLAUDE.md FEATURE_ANALYSE.md
git commit -m "docs(payments): seed payments and document payment workflow"
```

---

## Self-Review

- **Spec-Abdeckung:** Schema/Migration und Status-Labels (Task 1), `lib/payments.ts` mit Statusberechnung, Überzahlung, Reminder-Cleanup, Validierung, Audit, Restbetrag in derselben Transaktion, `syncInvoiceState` (Task 2), Umstellung `markInvoicePaid`/CAMT (Betrag der Bankbewegung, Duplikat über `bankReference`)/Budget/Status-Select, Sperre des Statuswechsels, Neuberechnung nach Bearbeiten, Löschsperre bei Zahlungen (Task 3), Zahlungsblock, Button „Als bezahlt markieren“, Bestätigung bei Überzahlung (Task 4), Queries GuV/Analytics/Dashboard/Export (Task 5), OP-Liste mit Stichtag, Altersklassen, Guthaben, CSV (Task 6), Doku/Seeds (Task 7). Mahnwesen bleibt unverändert: `state-manager.ts` und `reminders.ts` fassen nur `Sent` bzw. `Overdue` an und brauchen keine Änderung.
- **Typkonsistenz:** `recordPayment`, `recordRemainingPayment`, `deletePayment`, `syncInvoiceState`, `getPaymentSummary`, `sumOpenAmount`, `toRappen`, `PaymentError` heissen überall gleich; `ImportMatch.amountCents` und `OpenInvoice.openAmount` in Task 3 konsistent zwischen Wizard, Action und Matcher; `IncomeRow.amount`/`invoiceId` in Task 5 passen zur Seite; `ReceivablesReport`-Felder in Task 6 sind in Seite, Export und Tests identisch.
- **Bekannte Lücken (bewusst):** Kategorie-Analytics bleiben rechnungsbasiert (siehe Global Constraints); Summen und Kategorien können bei Teilzahlungen über Jahresgrenzen auseinanderlaufen. Die OP-Liste filtert nach dem heutigen Status: Eine Rechnung, die zum Stichtag offen war und später storniert wurde, fehlt in der historischen Liste (Stornodatum wird nicht gespeichert). Zahlungen werden nicht bearbeitet, nur gelöscht und neu erfasst.
