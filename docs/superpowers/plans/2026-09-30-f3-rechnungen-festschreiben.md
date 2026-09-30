# F3: Rechnungen festschreiben, Gutschrift und Storno – Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rechnungen sind ab dem Versand nicht mehr änderbar oder löschbar; Korrekturen laufen über Gutschriften, Kunden mit Rechnungen werden archiviert statt gelöscht.

**Architecture:** Eine Gutschrift ist eine `Invoice` mit `creditNoteForId` und negativen Beträgen. Der Restbetrag des Originals wird als Total − Zahlungen − versendete Gutschriften berechnet (zentral in `lib/payments.ts`). Statusübergänge stehen als Tabelle in `lib/state-manager.ts`; Sperren werden serverseitig in den Actions erzwungen, die UI blendet nur aus.

**Tech Stack:** Next.js 16 (Server Actions), Prisma 7 + SQLite (better-sqlite3), Vitest, pdfkit.

**Spec:** `docs/superpowers/specs/2026-09-30-f3-rechnungen-festschreiben-design.md`

## Global Constraints

- UI-Texte, Fehlermeldungen und Handbuch sind **Deutsch** (Schweizer Schreibweise, „ss“ statt „ß“).
- Commit-Messages **Englisch**, Conventional Commits, mit der `Co-Authored-By`-Zeile des ausführenden Modells (in den Beispielen unten steht `Claude Sonnet 5.5` als Platzhalter; durch die eigene Attribution ersetzen).
- Beträge intern in Rappen (Integer) über `toRappen` aus `lib/payments.ts` vergleichen, nie mit `number`-Gleichheit.
- Migration ist reines SQL (`scripts/startup.js` wendet sie ohne Prisma CLI an). Tests nutzen `prisma db push` aus `schema.prisma`; ein eigener Migrationstest spielt die SQL-Ordner ab.
- Nur Rechnungen ändern. Offerten (`Quote`) bleiben unverändert (`Quote.customer` behält `Cascade`).
- Server Actions prüfen Rollen mit `requireEditor()` / `requireAdmin()` aus `lib/permissions.ts`.
- Audit: bestehende `AuditAction`-Werte (`CREATE | UPDATE | DELETE | SEND | STATUS`) wiederverwenden, keine neuen Aktionen.
- Arbeitsbranch: der aktuelle Branch `ccr-742559e2-jlc1nl`.
- Einzeltest: `npx vitest run <datei>`. Gesamtlauf am Ende: `npm run lint`, `npm test`, `npm run build`.

## File Structure

| Datei | Verantwortung |
|---|---|
| `prisma/schema.prisma`, `prisma/migrations/<ts>_invoice_locking_credit_notes/migration.sql` | `creditNoteForId`, `archivedAt`, `Restrict` |
| `lib/state-manager.ts` | Übergangstabelle `canTransitionInvoice` / `allowedInvoiceTargets`; Cron schliesst Gutschriften aus |
| `lib/customer-archive.ts` (neu) | `selectableCustomersWhere(currentId?)` |
| `lib/credit-notes.ts` (neu) | `CreditNoteError`, `createCreditNoteDraft`, `assertCreditWithinOriginal`, `negateDocumentInput` |
| `lib/payments.ts` | `creditedRappen` in Status, Summary, Restbetrag, `sumOpenAmount`; Zahlungen auf Gutschriften abgelehnt |
| `lib/receivables.ts` | Gutschriften im Restbetrag, Gutschriften nicht als eigene Zeile |
| `lib/document-actions.ts` | `DocumentLockedError`, Sperre beim Update, Gutschrift-Versand |
| `lib/pdf/document-pdf.ts`, `lib/pdf/invoice-pdf.ts` | Gutschrift-PDF ohne QR/Fälligkeit |
| `app/(app)/invoices/actions.ts` | Übergangsprüfung, Löschen nur Entwürfe, `createCreditNote`, Update für Gutschriften |
| `app/(app)/customers/actions.ts` | `archiveCustomer`, `restoreCustomer`, `deleteCustomer` gesperrt |
| UI: `InvoiceStatusSelect.tsx`, `[id]/page.tsx`, `[id]/edit/page.tsx`, `InvoiceForm.tsx`, `invoices/page.tsx`, `customers/*` | Anzeige |
| `public/benutzerhandbuch.html`, `CLAUDE.md`, `FEATURE_ANALYSE.md` | Doku |

---

### Task 1: Schema und Migration

**Files:**
- Modify: `prisma/schema.prisma` (Modelle `Customer`, `Invoice`)
- Create: `prisma/migrations/<timestamp>_invoice_locking_credit_notes/migration.sql` (von Prisma erzeugt)
- Create: `tests/integration/invoice-locking-migration.test.ts`
- Modify: `tests/integration/customers.test.ts` (Test „should cascade-delete invoices when customer is deleted“)
- Modify: `tests/test-utils.ts` (Aufräumreihenfolge: Gutschriften vor den Originalen löschen)

**Interfaces:**
- Produces: `Invoice.creditNoteForId: number | null`, Relationen `Invoice.creditNoteFor` / `Invoice.creditNotes` (Relationsname `"CreditNotes"`), `Customer.archivedAt: Date | null`. Alle späteren Tasks nutzen diese Namen.

- [ ] **Step 1: Schema ändern**

In `model Customer` nach `nextInvoiceDate DateTime?` einfügen:

```prisma
  archivedAt              DateTime?
```

und bei den Indizes `@@index([archivedAt])`.

In `model Invoice` nach `paidDate DateTime?` einfügen:

```prisma
  creditNoteForId Int?
```

Die Zeile `customer ... onDelete: Cascade` ersetzen und Relationen ergänzen:

```prisma
  customer       Customer         @relation(fields: [customerId], references: [customerId], onDelete: Restrict)
  creditNoteFor  Invoice?         @relation("CreditNotes", fields: [creditNoteForId], references: [id], onDelete: Restrict)
  creditNotes    Invoice[]        @relation("CreditNotes")
```

und bei den Indizes `@@index([creditNoteForId])`.

- [ ] **Step 2: Migration erzeugen**

Run: `npx prisma migrate dev --create-only --name invoice_locking_credit_notes`
Expected: neuer Ordner unter `prisma/migrations/` mit `migration.sql`. Datei öffnen und prüfen: `ALTER TABLE "Customer" ADD COLUMN "archivedAt" DATETIME;`, ein `RedefineTables`-Block für `Invoice` mit `"creditNoteForId" INTEGER` und beiden Fremdschlüsseln `ON DELETE RESTRICT`, sowie `CREATE INDEX` für `Customer_archivedAt_idx` und `Invoice_creditNoteForId_idx`. Alle bestehenden `Invoice`-Indizes und der Unique-Index auf `documentNumber` müssen im Block neu angelegt werden.
Danach `npx prisma migrate dev` ausführen (lokale DB) und anschliessend `npx prisma generate` (Prisma 7 erzeugt den Client nach `migrate dev` nicht mehr automatisch). Ohne den Client-Lauf kennen die späteren Tasks `creditNoteForId` und `archivedAt` nicht (Typfehler).

- [ ] **Step 3: Migrationstest schreiben**

`tests/integration/invoice-locking-migration.test.ts`:

```ts
import { describe, it, expect, afterAll } from "vitest";
import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { tmpdir } from "os";
import { randomUUID } from "crypto";

// Replays the real migration folders in order (like scripts/startup.js).
// Redefining "Invoice" for the Restrict foreign key must keep every row.
const migrationsDir = path.join(process.cwd(), "prisma", "migrations");
const folders = fs
  .readdirSync(migrationsDir, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name)
  .filter((n) => fs.existsSync(path.join(migrationsDir, n, "migration.sql")))
  .sort();
const MIGRATION = folders.find((n) => n.endsWith("_invoice_locking_credit_notes"))!;

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

  it("keeps invoices, items and payments and switches the foreign keys to RESTRICT", () => {
    expect(MIGRATION).toBeDefined();
    const idx = folders.indexOf(MIGRATION);
    for (const name of folders.slice(0, idx)) applyMigration(db, name);

    db.pragma("foreign_keys = OFF");
    db.prepare(
      `INSERT INTO "Invoice" ("customerId", "documentNumber", "date", "totalAmount", "dueDate", "state")
       VALUES (1, 'R-1', 1700000000000, 100, 1702592000000, 'Sent')`
    ).run();
    db.prepare(
      `INSERT INTO "Item" ("name", "unit", "unitPrice", "quantity", "totalAmount", "invoiceId")
       VALUES ('Beratung', 'Hour', 100, 1, 100, 1)`
    ).run();
    db.prepare(
      `INSERT INTO "Payment" ("invoiceId", "date", "amount") VALUES (1, 1700000000000, 40)`
    ).run();

    applyMigration(db, MIGRATION);

    const invoice = db
      .prepare(`SELECT "documentNumber", "state", "creditNoteForId" FROM "Invoice"`)
      .get() as { documentNumber: string; state: string; creditNoteForId: number | null };
    expect(invoice).toEqual({ documentNumber: "R-1", state: "Sent", creditNoteForId: null });
    expect(db.prepare(`SELECT COUNT(*) AS n FROM "Item"`).get()).toEqual({ n: 1 });
    expect(db.prepare(`SELECT COUNT(*) AS n FROM "Payment"`).get()).toEqual({ n: 1 });

    const fks = db.prepare(`PRAGMA foreign_key_list("Invoice")`).all() as {
      from: string;
      on_delete: string;
    }[];
    expect(fks.find((f) => f.from === "customerId")?.on_delete).toBe("RESTRICT");
    expect(fks.find((f) => f.from === "creditNoteForId")?.on_delete).toBe("RESTRICT");
  });
});
```

- [ ] **Step 4: Migrationstest ausführen**

Run: `npx vitest run tests/integration/invoice-locking-migration.test.ts`
Expected: PASS. Schlägt es fehl, ist die Migration nicht korrekt; nicht den Test anpassen.

- [ ] **Step 5: Cascade-Test auf Restrict umstellen**

In `tests/integration/customers.test.ts` den Test `should cascade-delete invoices when customer is deleted` ersetzen durch:

```ts
  it("should refuse to delete a customer that still has invoices", async () => {
    const { prisma } = db;
    const customer = await prisma.customer.create({
      data: createValidTestCustomer(),
    });

    const invoice = await prisma.invoice.create({
      data: {
        customerId: customer.customerId,
        documentNumber: "I-25060001",
        date: new Date(),
        dueDate: new Date(Date.now() + 30 * 86_400_000),
        totalAmount: 100,
        state: "Draft",
      },
    });

    await expect(
      prisma.customer.delete({ where: { customerId: customer.customerId } })
    ).rejects.toThrow();

    const found = await prisma.invoice.findUnique({ where: { id: invoice.id } });
    expect(found).not.toBeNull();
  });
```

Den Kommentar `// Equivalent: CustomerRepository_DeleteCustomer_ShouldCascadeToInvoices` darüber entfernen.

- [ ] **Step 6: Aufräumen in `tests/test-utils.ts` an die Selbstreferenz anpassen**

SQLite prüft `ON DELETE RESTRICT` sofort pro Zeile, nicht am Ende der Anweisung. `invoice.deleteMany()` löscht in Reihenfolge der IDs: das Original (kleinere ID) fällt zuerst, während seine Gutschrift noch darauf zeigt, und die ganze Anweisung scheitert. Das trifft jede Testsuite, die Gutschriften anlegt (ab Task 5). Deshalb in `tests/test-utils.ts` die Zeile `await p.invoice.deleteMany();` ersetzen durch:

```ts
    // Credit notes reference their original (onDelete: Restrict, checked per row).
    await p.invoice.deleteMany({ where: { creditNoteForId: { not: null } } });
    await p.invoice.deleteMany();
```

Die übrige Reihenfolge stimmt bereits (`invoice.deleteMany()` vor `customer.deleteMany()`).

- [ ] **Step 7: Gesamten Integrationslauf prüfen**

Run: `npm run test:integration`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add prisma tests
git commit -m "feat(invoices): add credit note relation, customer archive flag and restrict deletes

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Übergangstabelle und Statusprüfung

**Files:**
- Modify: `lib/state-manager.ts`
- Modify: `app/(app)/invoices/actions.ts` (`updateInvoiceStatus`)
- Modify: `app/(app)/invoices/InvoiceStatusSelect.tsx`
- Test: `tests/unit/state-manager.test.ts`, `tests/unit/invoice-status-actions.test.ts`, `tests/integration/state-transitions.test.ts`

**Interfaces:**
- Produces: `canTransitionInvoice(from: InvoiceState, to: InvoiceState): boolean`, `allowedInvoiceTargets(from: InvoiceState): InvoiceState[]` (enthält immer `from`).
- Consumes: nichts aus früheren Tasks ausser `creditNoteForId` (Task 1).

- [ ] **Step 1: Unit-Tests für die Tabelle schreiben**

An `tests/unit/state-manager.test.ts` anhängen (Import oben um `canTransitionInvoice, allowedInvoiceTargets` erweitern):

```ts
describe("canTransitionInvoice", () => {
  it.each([
    ["Draft", "Sent"],
    ["Draft", "Paid"],
    ["Sent", "Overdue"],
    ["Sent", "Paid"],
    ["Overdue", "Sent"],
    ["Overdue", "Paid"],
    ["PartiallyPaid", "Paid"],
  ] as const)("allows %s -> %s", (from, to) => {
    expect(canTransitionInvoice(from, to)).toBe(true);
  });

  it.each([
    ["Draft", "Overdue"],
    ["Draft", "Canceled"],
    ["Sent", "Draft"],
    ["Sent", "Canceled"],
    ["Overdue", "Canceled"],
    ["Paid", "Sent"],
    ["Paid", "Draft"],
    ["PartiallyPaid", "Sent"],
    ["Canceled", "Sent"],
    ["Canceled", "Paid"],
  ] as const)("refuses %s -> %s", (from, to) => {
    expect(canTransitionInvoice(from, to)).toBe(false);
  });

  it("treats staying in the same state as allowed", () => {
    expect(canTransitionInvoice("Canceled", "Canceled")).toBe(true);
  });

  it("lists the current state plus the allowed targets", () => {
    expect(allowedInvoiceTargets("Sent")).toEqual(["Sent", "Overdue", "Paid"]);
    expect(allowedInvoiceTargets("Canceled")).toEqual(["Canceled"]);
  });
});
```

- [ ] **Step 2: Test ausführen, Fehlschlag prüfen**

Run: `npx vitest run tests/unit/state-manager.test.ts`
Expected: FAIL (`canTransitionInvoice is not a function`).

- [ ] **Step 3: Tabelle implementieren**

In `lib/state-manager.ts` die Importzeile ersetzen und oben ergänzen:

```ts
import type { InvoiceState, PrismaClient } from "@prisma/client";

/**
 * Manual status changes an invoice may go through. Choosing Paid books the
 * remaining amount as a payment (see updateInvoiceStatus); PartiallyPaid
 * follows from payments and Canceled from credit notes, so neither is a
 * manual target.
 */
const INVOICE_TRANSITIONS: Record<InvoiceState, readonly InvoiceState[]> = {
  Draft: ["Sent", "Paid"],
  Sent: ["Overdue", "Paid"],
  Overdue: ["Sent", "Paid"],
  PartiallyPaid: ["Paid"],
  Paid: [],
  Canceled: [],
};

export function canTransitionInvoice(from: InvoiceState, to: InvoiceState): boolean {
  return from === to || INVOICE_TRANSITIONS[from].includes(to);
}

export function allowedInvoiceTargets(from: InvoiceState): InvoiceState[] {
  return [from, ...INVOICE_TRANSITIONS[from]];
}
```

Ausserdem in beiden Cron-Funktionen Gutschriften ausschliessen: in `checkAndUpdateDocumentStates` das `where` der Rechnungen zu `{ id: { in: invoiceIds }, state: "Sent", dueDate: { lt: now }, creditNoteForId: null }` und in `checkAndUpdateAllDocumentStates` zu `{ state: "Sent", dueDate: { lt: now }, creditNoteForId: null }` ändern.

- [ ] **Step 4: Test ausführen**

Run: `npx vitest run tests/unit/state-manager.test.ts`
Expected: PASS.

- [ ] **Step 5: `updateInvoiceStatus` absichern (Tests zuerst)**

In `tests/unit/invoice-status-actions.test.ts`:

1. `mockInvoice` erweitern, damit Tests eine Gutschrift simulieren können:

```ts
function mockInvoice(
  state: string,
  documentNumber: string | null,
  totalAmount = 100,
  creditNoteForId: number | null = null
) {
  // Payments exist exactly for Paid/PartiallyPaid invoices in these scenarios.
  vi.mocked(prisma.payment.count).mockResolvedValue(
    state === "Paid" || state === "PartiallyPaid" ? 1 : 0
  );
  vi.mocked(prisma.invoice.findUnique).mockResolvedValue({
    state,
    documentNumber,
    totalAmount,
    creditNoteForId,
  } as never);
}
```

2. Diese drei Tests ersetzen (sie beschreiben Verhalten, das entfällt):
   - `"does not assign a number when a draft is canceled"` → 
     ```ts
     it("refuses Draft -> Canceled and assigns no number", async () => {
       mockInvoice("Draft", null);
       const res = await updateInvoiceStatus(10, "Canceled");
       expect(res.error).toBeTruthy();
       expect(assignDocumentNumber).not.toHaveBeenCalled();
       expect(prisma.invoice.update).not.toHaveBeenCalled();
     });
     ```
   - `"assigns a number when a canceled, unnumbered invoice is sent"` →
     ```ts
     it("refuses to reopen a canceled invoice", async () => {
       mockInvoice("Canceled", null);
       const res = await updateInvoiceStatus(10, "Sent");
       expect(res.error).toBeTruthy();
       expect(assignDocumentNumber).not.toHaveBeenCalled();
       expect(prisma.invoice.update).not.toHaveBeenCalled();
     });
     ```
   - `"does not assign a number when an unnumbered canceled invoice stays canceled"` bleibt unverändert (gleicher Status liefert `{}`).

3. Neue Tests ergänzen:

```ts
  it("refuses Sent -> Canceled and Sent -> Draft", async () => {
    mockInvoice("Sent", "R-26090001");
    expect((await updateInvoiceStatus(1, "Canceled")).error).toBeTruthy();
    expect((await updateInvoiceStatus(1, "Draft")).error).toBeTruthy();
    expect(prisma.invoice.update).not.toHaveBeenCalled();
  });

  it("refuses any manual status change on a credit note", async () => {
    mockInvoice("Sent", "R-26090002", -50, 1);
    const res = await updateInvoiceStatus(2, "Overdue");
    expect(res).toEqual({ error: "Der Status einer Gutschrift ergibt sich aus dem Versand." });
    expect(prisma.invoice.update).not.toHaveBeenCalled();
  });
```

Run: `npx vitest run tests/unit/invoice-status-actions.test.ts` → Expected: FAIL bei den neuen und ersetzten Tests.

- [ ] **Step 6: Implementierung in `updateInvoiceStatus`**

In `app/(app)/invoices/actions.ts`: Import `import { canTransitionInvoice } from "@/lib/state-manager";` ergänzen. Das `select` erweitern und die Prüfungen einfügen:

```ts
  const current = await prisma.invoice.findUnique({
    where: { id },
    select: { state: true, documentNumber: true, totalAmount: true, creditNoteForId: true },
  });
  if (!current) return { error: "Rechnung nicht gefunden." };
  if (current.state === state) return {};
  if (current.creditNoteForId != null) {
    return { error: "Der Status einer Gutschrift ergibt sich aus dem Versand." };
  }
```

Nach dem bestehenden Block `if (state === "Paid" && current.state === "Canceled") { ... }` einfügen:

```ts
  if (!canTransitionInvoice(current.state, state)) {
    return { error: "Dieser Statuswechsel ist nicht erlaubt." };
  }
```

Run: `npx vitest run tests/unit/invoice-status-actions.test.ts` → Expected: PASS.

- [ ] **Step 7: Statusauswahl in der UI einschränken**

In `app/(app)/invoices/InvoiceStatusSelect.tsx` `import { allowedInvoiceTargets } from "@/lib/state-manager";` ergänzen und im Component die Optionen filtern. `stateOptions.map` ersetzen durch:

```tsx
        <SelectContent>
          {stateOptions
            .filter((opt) => allowedInvoiceTargets(currentState).includes(opt.value))
            .map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
        </SelectContent>
```

Der `locked`-Hinweis („Zum Zurücksetzen die Zahlungen löschen.“) bleibt unverändert.

- [ ] **Step 8: Integrationstest für Cron mit Gutschrift**

In `tests/integration/state-transitions.test.ts` innerhalb des bestehenden `describe` ergänzen:

```ts
  it("never marks a credit note as Overdue", async () => {
    const { prisma } = db;
    const customer = await seedCustomer();
    const original = await prisma.invoice.create({
      data: {
        customerId: customer.customerId,
        documentNumber: "R-1",
        date: pastDate(60),
        dueDate: futureDate(30),
        totalAmount: 100,
        state: "Sent",
      },
    });
    const credit = await prisma.invoice.create({
      data: {
        customerId: customer.customerId,
        documentNumber: "R-2",
        date: pastDate(60),
        dueDate: pastDate(30),
        totalAmount: -100,
        state: "Sent",
        creditNoteForId: original.id,
      },
    });

    await checkAndUpdateDocumentStates(prisma, [credit.id], []);

    const after = await prisma.invoice.findUniqueOrThrow({ where: { id: credit.id } });
    expect(after.state).toBe("Sent");
  });
```

Run: `npx vitest run tests/integration/state-transitions.test.ts` → Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add lib/state-manager.ts "app/(app)/invoices" tests
git commit -m "feat(invoices): restrict manual status changes to allowed transitions

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Festschreiben und Löschen nur für Entwürfe

**Files:**
- Modify: `lib/document-actions.ts` (`updateDocumentWithItems`, neue `DocumentLockedError`)
- Modify: `app/(app)/invoices/actions.ts` (`updateInvoice`, `deleteInvoice`)
- Modify: `app/(app)/invoices/[id]/edit/page.tsx`
- Modify: `app/(app)/invoices/[id]/page.tsx` (Buttons „Bearbeiten“, `DeleteInvoiceButton`)
- Test: `tests/unit/document-actions.test.ts`, `tests/unit/invoice-status-actions.test.ts`, `tests/integration/invoices.test.ts`

**Interfaces:**
- Produces: `export class DocumentLockedError extends Error` in `lib/document-actions.ts`. `updateDocumentWithItems(id, input, prisma?)` wirft sie für Rechnungen ausserhalb von `Draft`. Der optionale dritte Parameter `prisma: PrismaClient = defaultPrisma` (Muster wie in `lib/payments.ts`) macht die Sperre gegen eine echte Datenbank testbar.

- [ ] **Step 1: Tests für die Sperre**

In `tests/unit/document-actions.test.ts` den Import um `DocumentLockedError` erweitern und im `describe("updateDocumentWithItems")` ergänzen:

```ts
  const invoiceInput = {
    kind: "invoice" as const,
    customerId: 1,
    customUserText: null,
    date: new Date(),
    dueDate: new Date(),
    totalAmount: 100,
    discountPercent: 0,
    items: [],
  };

  it("refuses to update an invoice that has left Draft", async () => {
    vi.mocked(prisma.invoice.findUnique).mockResolvedValue({ state: "Sent" } as never);

    await expect(updateDocumentWithItems(3, invoiceInput)).rejects.toBeInstanceOf(DocumentLockedError);
    expect(prisma.item.deleteMany).not.toHaveBeenCalled();
    expect(prisma.invoice.update).not.toHaveBeenCalled();
  });

  it("updates a draft invoice", async () => {
    vi.mocked(prisma.invoice.findUnique).mockResolvedValue({ state: "Draft" } as never);
    vi.mocked(prisma.item.deleteMany).mockResolvedValue({ count: 0 } as never);
    vi.mocked(prisma.invoice.update).mockResolvedValue({} as never);

    await updateDocumentWithItems(3, invoiceInput);

    expect(prisma.invoice.update).toHaveBeenCalledTimes(1);
  });
```

Run: `npx vitest run tests/unit/document-actions.test.ts` → Expected: FAIL.

- [ ] **Step 2: Sperre implementieren**

In `lib/document-actions.ts` vor `updateDocumentWithItems` einfügen:

```ts
/** Thrown when someone tries to edit an invoice that already left Draft. */
export class DocumentLockedError extends Error {}
```

Die Signatur um einen optionalen Client erweitern (`PrismaClient` als Typ aus `@prisma/client` mitimportieren) und diesen statt `defaultPrisma` für die Transaktion verwenden:

```ts
export async function updateDocumentWithItems(
  id: number,
  input: UpdateDocumentInput,
  prisma: PrismaClient = defaultPrisma
): Promise<void> {
  await prisma.$transaction(async (tx) => {
```

Im Invoice-Zweig ganz am Anfang (vor `tx.item.deleteMany`):

```ts
      const current = await tx.invoice.findUnique({ where: { id }, select: { state: true } });
      if (!current) throw new Error("Rechnung nicht gefunden.");
      if (current.state !== "Draft") {
        throw new DocumentLockedError(
          "Versendete Rechnungen können nicht mehr bearbeitet werden. Bitte eine Gutschrift erstellen."
        );
      }
```

Run: `npx vitest run tests/unit/document-actions.test.ts` → Expected: PASS.

- [ ] **Step 2b: Integrationstest für die Sperre**

In `tests/integration/invoices.test.ts` (innerhalb des bestehenden `describe` mit `createTestDatabase()`; Import `import { updateDocumentWithItems, DocumentLockedError } from "@/lib/document-actions";` ergänzen) anhängen:

```ts
  it("refuses to edit a sent invoice and leaves items and total unchanged", async () => {
    const { prisma } = db;
    const customer = await prisma.customer.create({ data: createValidTestCustomer() });
    const invoice = await prisma.invoice.create({
      data: {
        customerId: customer.customerId,
        documentNumber: "R-LOCK-1",
        date: new Date(),
        dueDate: new Date(Date.now() + 30 * 86_400_000),
        totalAmount: 200,
        state: "Sent",
        items: { create: createValidItemList() },
      },
      include: { items: true },
    });

    await expect(
      updateDocumentWithItems(
        invoice.id,
        {
          kind: "invoice",
          customerId: customer.customerId,
          customUserText: null,
          date: new Date(),
          dueDate: new Date(),
          totalAmount: 1,
          discountPercent: 0,
          items: [],
        },
        prisma
      )
    ).rejects.toBeInstanceOf(DocumentLockedError);

    const after = await prisma.invoice.findUniqueOrThrow({
      where: { id: invoice.id },
      include: { items: true },
    });
    expect(after.totalAmount.toNumber()).toBe(200);
    expect(after.items).toHaveLength(invoice.items.length);
  });
```

(Falls `createValidItemList` oder `createValidTestCustomer` im File noch nicht importiert sind, aus `../test-utils` ergänzen.)

Run: `npx vitest run tests/integration/invoices.test.ts` → Expected: PASS.

- [ ] **Step 3: `updateInvoice` meldet die Sperre**

In `app/(app)/invoices/actions.ts` `DocumentLockedError` aus `@/lib/document-actions` mitimportieren und den `catch` in `updateInvoice` ersetzen:

```ts
  } catch (err) {
    if (err instanceof DocumentLockedError) return { error: err.message };
    log.error({ id, err }, "updateInvoice failed");
    return { error: "Rechnung konnte nicht gespeichert werden." };
  }
```

- [ ] **Step 4: Tests für `deleteInvoice` nur für Entwürfe**

In `tests/unit/invoice-status-actions.test.ts` im `describe("deleteInvoice")`:
- In den Tests „deletes the invoice, writes an audit log, and redirects“ und „returns an error instead of throwing when the delete fails“ die gemockten Rückgaben um `state: "Draft"` ergänzen (`{ documentNumber: "...", state: "Draft" }`).
- Den Test „returns an error and does not delete when payments exist“ so anpassen, dass `findUnique` `{ documentNumber: "I-25060007", state: "Draft" }` liefert (Zahlungsprüfung bleibt).
- Neuen Test ergänzen:

```ts
  it.each(["Sent", "Overdue", "PartiallyPaid", "Paid", "Canceled"])(
    "refuses to delete a %s invoice",
    async (state) => {
      vi.mocked(prisma.invoice.findUnique).mockResolvedValue({
        documentNumber: "I-25060008",
        state,
      } as never);

      const result = await deleteInvoice(1);

      expect(result.error).toBe(
        "Versendete Rechnungen können nicht gelöscht werden. Stattdessen eine Gutschrift erstellen."
      );
      expect(prisma.invoice.delete).not.toHaveBeenCalled();
      expect(redirect).not.toHaveBeenCalled();
    }
  );
```

Run: `npx vitest run tests/unit/invoice-status-actions.test.ts` → Expected: neuer Test FAIL.

- [ ] **Step 5: `deleteInvoice` implementieren**

Am Anfang von `deleteInvoice` ersetzen:

```ts
  const session = await requireAdmin();
  const inv = await prisma.invoice.findUnique({
    where: { id },
    select: { documentNumber: true, state: true },
  });
  if (!inv) return { error: "Rechnung nicht gefunden." };
  if (inv.state !== "Draft") {
    return {
      error: "Versendete Rechnungen können nicht gelöscht werden. Stattdessen eine Gutschrift erstellen.",
    };
  }
  const paymentCount = await prisma.payment.count({ where: { invoiceId: id } });
```

Der Rest der Funktion bleibt (`inv?.documentNumber` → `inv.documentNumber`).

Run: `npx vitest run tests/unit/invoice-status-actions.test.ts` → Expected: PASS.

- [ ] **Step 6: Edit-Seite und Detailseite**

`app/(app)/invoices/[id]/edit/page.tsx`: `import { notFound, redirect } from "next/navigation";` und nach `if (!invoice) notFound();` einfügen:

```ts
  if (invoice.state !== "Draft") redirect(`/invoices/${invoice.id}`);
```

`app/(app)/invoices/[id]/page.tsx`: Den Bearbeiten-Button nur für Entwürfe rendern:

```tsx
          {invoice.state === "Draft" && (
            <Button
              size="sm"
              render={<Link href={`/invoices/${invoice.id}/edit${fromCustomer ? `?from=${fromCustomer}` : ""}`} />}
            >
              Bearbeiten
            </Button>
          )}
```

und unten `<DeleteInvoiceButton invoiceId={invoice.id} />` ersetzen durch:

```tsx
        {invoice.state === "Draft" ? <DeleteInvoiceButton invoiceId={invoice.id} /> : <span />}
```

- [ ] **Step 7: Gesamtlauf der betroffenen Tests und Commit**

Run: `npx vitest run tests/unit/document-actions.test.ts tests/unit/invoice-status-actions.test.ts tests/unit/invoice-sub-actions.test.ts tests/integration/invoices.test.ts`
Expected: PASS.

```bash
git add lib "app/(app)/invoices" tests
git commit -m "feat(invoices): lock invoices after draft and only delete drafts

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Kunden archivieren statt löschen

**Files:**
- Create: `lib/customer-archive.ts`
- Modify: `app/(app)/customers/actions.ts`
- Create: `app/(app)/customers/ArchiveCustomerButton.tsx`
- Modify: `app/(app)/customers/page.tsx`, `app/(app)/customers/[id]/page.tsx`, `app/(app)/customers/DeleteCustomerButton.tsx`
- Modify: `app/(app)/invoices/new/page.tsx`, `invoices/[id]/edit/page.tsx`, `quotes/new/page.tsx`, `quotes/[id]/edit/page.tsx`, `app/(app)/dashboard/page.tsx`, `lib/yearly-invoices.ts`
- Test: `tests/unit/customer-actions.test.ts`, `tests/integration/yearly-invoices.test.ts`, neu `tests/integration/customer-archive.test.ts`

**Interfaces:**
- Produces: `selectableCustomersWhere(currentId?: number): Prisma.CustomerWhereInput`; Actions `archiveCustomer(id: number): Promise<{ error?: string }>`, `restoreCustomer(id: number): Promise<{ error?: string }>`.

- [ ] **Step 1: Hilfsfunktion schreiben**

`lib/customer-archive.ts`:

```ts
import type { Prisma } from "@prisma/client";

/**
 * Customers offered in pickers for new documents: archived ones are hidden,
 * except the one a document already belongs to (so editing a draft of a
 * customer that was archived later still shows its customer).
 */
export function selectableCustomersWhere(currentId?: number): Prisma.CustomerWhereInput {
  return currentId === undefined
    ? { archivedAt: null }
    : { OR: [{ archivedAt: null }, { customerId: currentId }] };
}
```

- [ ] **Step 2: Unit-Tests für die Actions**

In `tests/unit/customer-actions.test.ts`:

1. Prisma-Mock erweitern: `customer: { create, update, delete }`, `invoice: { count: vi.fn() }`, `payment` entfernen (nicht mehr benutzt):

```ts
vi.mock("@/lib/prisma", () => ({
  default: {
    customer: { create: vi.fn(), update: vi.fn(), delete: vi.fn() },
    invoice: { count: vi.fn() },
  },
}));
```

2. `vi.mock("next/cache", () => ({ revalidateTag: vi.fn(), revalidatePath: vi.fn() }));` und Import `archiveCustomer, restoreCustomer` ergänzen.

3. Die beiden `deleteCustomer`-Tests „refuses deletion when the customer's invoices have payments“ und „deletes customer, writes audit log, and redirects“ ersetzen:

```ts
    it("refuses deletion when the customer has invoices", async () => {
      vi.mocked(auth).mockResolvedValue(adminSession);
      vi.mocked(prisma.invoice.count).mockResolvedValue(3);

      const res = await deleteCustomer(7);

      expect(res).toEqual({
        error: "Der Kunde hat Rechnungen und kann nicht gelöscht werden. Bitte archivieren.",
      });
      expect(prisma.invoice.count).toHaveBeenCalledWith({ where: { customerId: 7 } });
      expect(prisma.customer.delete).not.toHaveBeenCalled();
      expect(redirect).not.toHaveBeenCalled();
    });

    it("deletes a customer without invoices, writes audit log, and redirects", async () => {
      vi.mocked(auth).mockResolvedValue(adminSession);
      vi.mocked(prisma.invoice.count).mockResolvedValue(0);
      vi.mocked(prisma.customer.delete).mockResolvedValue({} as never);
      vi.mocked(redirect).mockImplementation(() => {
        throw new Error("REDIRECT:/customers");
      });

      await expect(deleteCustomer(7)).rejects.toThrow("REDIRECT:/customers");
      expect(prisma.customer.delete).toHaveBeenCalledWith({ where: { customerId: 7 } });
      expect(logAudit).toHaveBeenCalledWith(adminSession, "DELETE", "Customer", 7);
    });
```

Den Test „Cascade-deletes …“-Kommentar `expect(revalidateTag)…` entfällt (die Zeile im zweiten Test wurde oben schon nicht mehr aufgenommen).

4. Neuer `describe`:

```ts
  describe("archiveCustomer / restoreCustomer", () => {
    it("rejects Viewer role", async () => {
      vi.mocked(auth).mockResolvedValue(viewerSession);
      vi.mocked(redirect).mockImplementation(() => {
        throw new Error("REDIRECT:/dashboard");
      });
      await expect(archiveCustomer(1)).rejects.toThrow("REDIRECT:/dashboard");
      expect(prisma.customer.update).not.toHaveBeenCalled();
    });

    it("archives, audits, and hides the customer", async () => {
      vi.mocked(auth).mockResolvedValue(editorSession);
      vi.mocked(prisma.customer.update).mockResolvedValue({} as never);

      const res = await archiveCustomer(4);

      expect(res).toEqual({});
      expect(prisma.customer.update).toHaveBeenCalledWith({
        where: { customerId: 4 },
        data: { archivedAt: expect.any(Date) },
      });
      expect(logAudit).toHaveBeenCalledWith(editorSession, "UPDATE", "Customer", 4, undefined, {
        archived: true,
      });
    });

    it("restores and audits", async () => {
      vi.mocked(auth).mockResolvedValue(editorSession);
      vi.mocked(prisma.customer.update).mockResolvedValue({} as never);

      await restoreCustomer(4);

      expect(prisma.customer.update).toHaveBeenCalledWith({
        where: { customerId: 4 },
        data: { archivedAt: null },
      });
      expect(logAudit).toHaveBeenCalledWith(editorSession, "UPDATE", "Customer", 4, undefined, {
        archived: false,
      });
    });
  });
```

Run: `npx vitest run tests/unit/customer-actions.test.ts` → Expected: FAIL.

- [ ] **Step 3: Actions implementieren**

In `app/(app)/customers/actions.ts`: `revalidatePath` aus `next/cache` mitimportieren (dort steht bisher nur `revalidateTag`). `deleteCustomer` ersetzen und die zwei neuen Actions anhängen:

```ts
export async function deleteCustomer(id: number): Promise<{ error?: string }> {
  const session = await requireAdmin();
  // Invoices are booking records: they stay, so the customer is archived instead.
  const invoiceCount = await prisma.invoice.count({ where: { customerId: id } });
  if (invoiceCount > 0) {
    return { error: "Der Kunde hat Rechnungen und kann nicht gelöscht werden. Bitte archivieren." };
  }
  await prisma.customer.delete({ where: { customerId: id } });
  await logAudit(session, "DELETE", "Customer", id);
  revalidateTag(ANALYTICS_CACHE_TAG, { expire: 0 });
  redirect("/customers");
}

export async function archiveCustomer(id: number): Promise<{ error?: string }> {
  const session = await requireEditor();
  await prisma.customer.update({ where: { customerId: id }, data: { archivedAt: new Date() } });
  await logAudit(session, "UPDATE", "Customer", id, undefined, { archived: true });
  revalidatePath("/customers");
  revalidatePath(`/customers/${id}`);
  revalidatePath("/dashboard");
  revalidateTag(ANALYTICS_CACHE_TAG, { expire: 0 });
  return {};
}

export async function restoreCustomer(id: number): Promise<{ error?: string }> {
  const session = await requireEditor();
  await prisma.customer.update({ where: { customerId: id }, data: { archivedAt: null } });
  await logAudit(session, "UPDATE", "Customer", id, undefined, { archived: false });
  revalidatePath("/customers");
  revalidatePath(`/customers/${id}`);
  revalidatePath("/dashboard");
  revalidateTag(ANALYTICS_CACHE_TAG, { expire: 0 });
  return {};
}
```

Run: `npx vitest run tests/unit/customer-actions.test.ts` → Expected: PASS.

- [ ] **Step 4: Integrationstest Archiv und Jahresjob**

`tests/integration/customer-archive.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { createTestDatabase, createValidTestCustomer } from "../test-utils";
import { selectableCustomersWhere } from "@/lib/customer-archive";

describe("selectableCustomersWhere", () => {
  const db = createTestDatabase();

  it("hides archived customers except the one a draft already belongs to", async () => {
    const { prisma } = db;
    const active = await prisma.customer.create({ data: createValidTestCustomer() });
    const archived = await prisma.customer.create({
      data: { ...createValidTestCustomer(), contactPerson: "Archiv", archivedAt: new Date() },
    });

    const plain = await prisma.customer.findMany({ where: selectableCustomersWhere() });
    expect(plain.map((c) => c.customerId)).toEqual([active.customerId]);

    const withCurrent = await prisma.customer.findMany({
      where: selectableCustomersWhere(archived.customerId),
    });
    expect(withCurrent.map((c) => c.customerId).sort()).toEqual(
      [active.customerId, archived.customerId].sort()
    );
  });
});
```

In `tests/integration/yearly-invoices.test.ts` im bestehenden `describe` (Variable `yesterday` und `db` sind dort definiert) ergänzen:

```ts
  it("skips archived customers", async () => {
    const customer = await db.prisma.customer.create({
      data: {
        ...createValidTestCustomer(),
        yearlyInvoice: true,
        nextInvoiceDate: yesterday,
        archivedAt: new Date(),
      },
    });
    await checkYearlyInvoices(db.prisma);

    expect(await db.prisma.invoice.count({ where: { customerId: customer.customerId } })).toBe(0);
  });
```

Run beide: `npx vitest run tests/integration/customer-archive.test.ts tests/integration/yearly-invoices.test.ts`
Expected: yearly-Test FAIL, archive-Test PASS.

- [ ] **Step 5: Jahresjob und Pickers**

`lib/yearly-invoices.ts`: im `customer.findMany`-`where` `archivedAt: null` ergänzen (`yearlyInvoice: true, archivedAt: null, nextInvoiceDate: { lte: today }`).

Picker-Seiten:
- `invoices/new/page.tsx` und `quotes/new/page.tsx`: `prisma.customer.findMany({ where: { archivedAt: null }, orderBy: { contactPerson: "asc" } })`. Ausnahme: ist `defaultCustomerId` gesetzt, `where: selectableCustomersWhere(defaultCustomerId)` verwenden.
- `invoices/[id]/edit/page.tsx` und `quotes/[id]/edit/page.tsx`: Kundenliste erst nach dem Laden des Dokuments holen. Dazu die Kundenabfrage aus dem `Promise.all` nehmen und danach ausführen:

```ts
  const customers = await prisma.customer.findMany({
    where: selectableCustomersWhere(invoice.customerId), // im Quote-Edit: quote.customerId
    orderBy: { contactPerson: "asc" },
  });
```

  (Der Import: `import { selectableCustomersWhere } from "@/lib/customer-archive";`.) In der Edit-Seite der Rechnung bleibt die `if (!invoice) notFound();`-Prüfung vor dieser Abfrage.
- `dashboard/page.tsx`: `prisma.customer.count()` → `prisma.customer.count({ where: { archivedAt: null } })`. Ausserdem die beiden Abfragen für geplante Jahresrechnungen (`scheduledCustomerCount` und `scheduledCustomers`, jeweils `where: { yearlyInvoice: true, nextInvoiceDate: { not: null } }`) um `archivedAt: null` ergänzen, weil der Jahresjob archivierte Kunden überspringt.

- [ ] **Step 6: Kundenliste mit Archiv-Filter**

`app/(app)/customers/page.tsx`:
- `TableProps` um `archivedOnly: boolean` erweitern; `where` ergänzt um `archivedAt: archivedOnly ? { not: null } : null`.
- `searchParams` um `archived?: string` erweitern, `const archivedOnly = archived === "true";`, an `sortHref`/`baseHref` (`if (archivedOnly) p.set("archived", "true");`) und `CustomersTable` durchreichen.
- Überschrift: `{archivedOnly ? "Archivierte Kunden" : yearlyOnly ? "Geplante Jahresrechnungen" : "Kunden"}`.
- Im Header-Bereich einen Link ergänzen:

```tsx
          <Button variant="outline" render={<Link href={archivedOnly ? "/customers" : "/customers?archived=true"} />}>
            {archivedOnly ? "Aktive Kunden" : "Archiv"}
          </Button>
```

- [ ] **Step 7: Archivieren-Button und Detailseite**

`app/(app)/customers/ArchiveCustomerButton.tsx`:

```tsx
"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { archiveCustomer, restoreCustomer } from "./actions";

type Props = { customerId: number; archived: boolean };

export default function ArchiveCustomerButton({ customerId, archived }: Props) {
  const [isPending, startTransition] = useTransition();

  if (archived) {
    return (
      <Button
        variant="outline"
        size="sm"
        disabled={isPending}
        onClick={() =>
          startTransition(async () => {
            const res = await restoreCustomer(customerId);
            if (res.error) toast.error(res.error);
          })
        }
      >
        Wiederherstellen
      </Button>
    );
  }

  return (
    <ConfirmDialog
      title="Kunde archivieren"
      description="Der Kunde erscheint nicht mehr in der Kundenliste und in Auswahllisten. Rechnungen und Daten bleiben erhalten. Du kannst ihn im Archiv wiederherstellen."
      confirmLabel="Archivieren"
      confirmVariant="default"
      triggerVariant="outline"
      triggerSize="sm"
      onConfirm={() => archiveCustomer(customerId)}
    >
      Archivieren
    </ConfirmDialog>
  );
}
```

`app/(app)/customers/[id]/page.tsx`: `import ArchiveCustomerButton from "../ArchiveCustomerButton";` ergänzen. Die Überschrift (`<h1 className="text-2xl font-semibold">{customerName}</h1>`) in eine Zeile mit Button und Hinweis umbauen:

```tsx
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-semibold">{customerName}</h1>
          {customer.archivedAt && <Badge variant="outline">Archiviert</Badge>}
        </div>
        {canEdit && (
          <ArchiveCustomerButton customerId={customerId} archived={customer.archivedAt !== null} />
        )}
      </div>
```

`app/(app)/customers/DeleteCustomerButton.tsx`: Beschreibung anpassen: `"Soll dieser Kunde wirklich gelöscht werden? Kunden mit Rechnungen können nicht gelöscht, sondern nur archiviert werden."`

- [ ] **Step 8: Tests und Commit**

Run: `npx vitest run tests/unit tests/integration/customer-archive.test.ts tests/integration/yearly-invoices.test.ts tests/integration/customers.test.ts`
Expected: PASS.

```bash
git add lib "app/(app)" tests
git commit -m "feat(customers): archive customers instead of deleting ones with invoices

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Restbetrag mit Gutschriften (`lib/payments.ts`, `lib/receivables.ts`)

**Files:**
- Modify: `lib/payments.ts`, `lib/receivables.ts`
- Test: `tests/unit/payments-state.test.ts`, `tests/unit/receivables.test.ts`, `tests/integration/payments.test.ts`, `tests/integration/receivables.test.ts`

**Interfaces:**
- Produces:
  - `computeInvoiceState({ state, totalRappen, paidRappen, creditedRappen?, dueDate, now? }): InvoiceState`
  - `sumCreditedRappen(db: Db, invoiceId: number): Promise<number>` (Summe |Total| aller Gutschriften mit `state != "Draft"`)
  - `getPaymentSummary(invoiceId, prisma?)` liefert zusätzlich `creditedRappen`; `remainingRappen = max(total − credited − paid, 0)`, `overpaidRappen = max(paid + credited − total, 0)`
  - `ReceivableInput.creditNotes?: { date: Date; totalAmount: { toNumber(): number } }[]`
  - `recordPayment`/`recordRemainingPayment` lehnen Gutschriften ab (`PaymentError`).

- [ ] **Step 1: Unit-Tests für `computeInvoiceState`**

An `tests/unit/payments-state.test.ts` (im `describe("computeInvoiceState")`) anhängen:

```ts
  it("is Canceled when credit notes cover the total and nothing was paid", () => {
    expect(computeInvoiceState({ ...base, state: "Sent", paidRappen: 0, creditedRappen: 10000 })).toBe("Canceled");
    expect(computeInvoiceState({ ...base, state: "Overdue", paidRappen: 0, creditedRappen: 12000 })).toBe("Canceled");
  });
  it("is Paid when payments plus credit notes cover the total", () => {
    expect(computeInvoiceState({ ...base, state: "Sent", paidRappen: 7000, creditedRappen: 3000 })).toBe("Paid");
  });
  it("is Paid when a paid invoice is fully credited (overpaid, refund due)", () => {
    expect(computeInvoiceState({ ...base, state: "Paid", paidRappen: 10000, creditedRappen: 10000 })).toBe("Paid");
  });
  it("stays Sent for a partial credit without payments", () => {
    expect(computeInvoiceState({ ...base, state: "Sent", paidRappen: 0, creditedRappen: 4000 })).toBe("Sent");
  });
  it("is PartiallyPaid when payments plus credit do not cover the total", () => {
    expect(computeInvoiceState({ ...base, state: "Sent", paidRappen: 3000, creditedRappen: 4000 })).toBe("PartiallyPaid");
  });
```

Run: `npx vitest run tests/unit/payments-state.test.ts` → Expected: FAIL.

- [ ] **Step 2: `computeInvoiceState` anpassen**

In `lib/payments.ts` ersetzen:

```ts
export function computeInvoiceState(input: {
  state: InvoiceState;
  totalRappen: number;
  paidRappen: number;
  creditedRappen?: number;
  dueDate: Date;
  now?: Date;
}): InvoiceState {
  const { state, totalRappen, paidRappen, dueDate } = input;
  const creditedRappen = input.creditedRappen ?? 0;
  if (state === "Draft" || state === "Canceled") return state;
  const settledRappen = paidRappen + creditedRappen;
  // Fully credited without any payment: nothing was earned, nothing is open.
  if (creditedRappen > 0 && paidRappen === 0 && settledRappen >= totalRappen) return "Canceled";
  if (settledRappen > 0 && settledRappen >= totalRappen) return "Paid";
  if (paidRappen > 0) return "PartiallyPaid";
  if (state === "Paid" || state === "PartiallyPaid") {
    return dueDate.getTime() < (input.now ?? new Date()).getTime() ? "Overdue" : "Sent";
  }
  return state;
}
```

Run: `npx vitest run tests/unit/payments-state.test.ts` → Expected: PASS (auch die bestehenden Fälle).

- [ ] **Step 3: Integrationstests für Summe, Zahlungen, Sperren**

An `tests/integration/payments.test.ts` (Helfer `seedInvoice` wiederverwenden; Import um `sumOpenAmount` ist schon vorhanden) ergänzen:

```ts
  async function seedCreditNote(originalId: number, customerId: number, total: number, state: "Draft" | "Sent" = "Sent") {
    return db.prisma.invoice.create({
      data: {
        customerId,
        documentNumber: state === "Draft" ? null : `R-${Math.floor(Math.random() * 1e8)}`,
        date: new Date("2026-02-01"),
        dueDate: new Date("2026-02-01"),
        totalAmount: -total,
        state,
        creditNoteForId: originalId,
      },
    });
  }

  it("summary subtracts sent credit notes and ignores draft ones", async () => {
    const inv = await seedInvoice(100);
    await seedCreditNote(inv.id, inv.customerId, 30);
    await seedCreditNote(inv.id, inv.customerId, 50, "Draft");
    expect(await getPaymentSummary(inv.id, db.prisma)).toEqual({
      totalRappen: 10000,
      paidRappen: 0,
      creditedRappen: 3000,
      remainingRappen: 7000,
      overpaidRappen: 0,
    });
  });

  it("syncInvoiceState turns a fully credited unpaid invoice into Canceled", async () => {
    const inv = await seedInvoice(100);
    await seedCreditNote(inv.id, inv.customerId, 100);
    const res = await syncInvoiceState({ invoiceId: inv.id, actor, source: "credit-note" }, db.prisma);
    expect(res.state).toBe("Canceled");
  });

  it("a partial credit then a payment of the rest marks the invoice Paid", async () => {
    const inv = await seedInvoice(100);
    await seedCreditNote(inv.id, inv.customerId, 30);
    await syncInvoiceState({ invoiceId: inv.id, actor, source: "credit-note" }, db.prisma);
    const paid = await recordRemainingPayment(
      { invoiceId: inv.id, date: new Date("2026-03-01"), source: "manual", actor },
      db.prisma
    );
    expect(paid?.state).toBe("Paid");
    const row = await db.prisma.payment.findFirstOrThrow({ where: { invoiceId: inv.id } });
    expect(row.amount.toNumber()).toBe(70);
  });

  it("reports the overpayment of a paid invoice that is credited afterwards", async () => {
    const inv = await seedInvoice(100);
    await recordPayment({ invoiceId: inv.id, amount: 100, date: new Date("2026-03-01"), source: "manual", actor }, db.prisma);
    await seedCreditNote(inv.id, inv.customerId, 100);
    await syncInvoiceState({ invoiceId: inv.id, actor, source: "credit-note" }, db.prisma);
    const summary = await getPaymentSummary(inv.id, db.prisma);
    expect(summary.overpaidRappen).toBe(10000);
    expect((await db.prisma.invoice.findUniqueOrThrow({ where: { id: inv.id } })).state).toBe("Paid");
  });

  it("rejects payments on a credit note", async () => {
    const inv = await seedInvoice(100);
    const credit = await seedCreditNote(inv.id, inv.customerId, 20);
    await expect(
      recordPayment({ invoiceId: credit.id, amount: 5, date: new Date(), source: "manual", actor }, db.prisma)
    ).rejects.toBeInstanceOf(PaymentError);
  });

  it("sumOpenAmount counts the remainder after credit notes and skips credit notes themselves", async () => {
    const inv = await seedInvoice(100);
    await seedCreditNote(inv.id, inv.customerId, 30);
    expect(await sumOpenAmount(db.prisma)).toEqual({ amount: 70, count: 1 });
  });
```

Den bestehenden Test „accepts an overpayment and reports it in the summary“ (`toEqual({... overpaidRappen: 550 })`) um `creditedRappen: 0` ergänzen.

Run: `npx vitest run tests/integration/payments.test.ts` → Expected: FAIL.

- [ ] **Step 4: `lib/payments.ts` implementieren**

Direkt unter `sumPaidRappen` einfügen:

```ts
/** Sum of the amounts (as positive Rappen) of all sent credit notes of an invoice. */
export async function sumCreditedRappen(db: Db, invoiceId: number): Promise<number> {
  const credits = await db.invoice.findMany({
    where: { creditNoteForId: invoiceId, state: { not: "Draft" } },
    select: { totalAmount: true },
  });
  return credits.reduce((sum, c) => sum + Math.abs(toRappen(c.totalAmount)), 0);
}
```

In `recalculateInvoiceState` nach `const paidRappen = ...`:

```ts
  const creditedRappen = await sumCreditedRappen(db, invoiceId);
  const to = computeInvoiceState({
    state: invoice.state,
    totalRappen: toRappen(invoice.totalAmount),
    paidRappen,
    creditedRappen,
    dueDate: invoice.dueDate,
  });
```

`getPaymentSummary` ersetzen:

```ts
export async function getPaymentSummary(invoiceId: number, prisma: PrismaClient = defaultPrisma) {
  const invoice = await prisma.invoice.findUniqueOrThrow({
    where: { id: invoiceId },
    select: { totalAmount: true },
  });
  const totalRappen = toRappen(invoice.totalAmount);
  const paidRappen = await sumPaidRappen(prisma, invoiceId);
  const creditedRappen = await sumCreditedRappen(prisma, invoiceId);
  return {
    totalRappen,
    paidRappen,
    creditedRappen,
    remainingRappen: Math.max(totalRappen - creditedRappen - paidRappen, 0),
    overpaidRappen: Math.max(paidRappen + creditedRappen - totalRappen, 0),
  };
}
```

In `createPayment` innerhalb der Transaktion das `select` erweitern (`select: { state: true, totalAmount: true, creditNoteForId: true }`) und nach dem Nicht-gefunden-Check einfügen:

```ts
    if (invoice.creditNoteForId != null) {
      throw new PaymentError("Auf eine Gutschrift sind keine Zahlungen möglich.");
    }
```

sowie den Restbetrag berechnen mit:

```ts
    const amountRappen =
      params.amount === "remaining"
        ? toRappen(invoice.totalAmount) -
          (await sumCreditedRappen(tx, params.invoiceId)) -
          (await sumPaidRappen(tx, params.invoiceId))
        : toRappen(params.amount);
```

`sumOpenAmount` ersetzen:

```ts
export async function sumOpenAmount(
  prisma: PrismaClient = defaultPrisma
): Promise<{ amount: number; count: number }> {
  const invoices = await prisma.invoice.findMany({
    where: { state: { in: ["Sent", "Overdue", "PartiallyPaid"] }, creditNoteForId: null },
    select: {
      totalAmount: true,
      payments: { select: { amount: true } },
      creditNotes: { where: { state: { not: "Draft" } }, select: { totalAmount: true } },
    },
  });
  let rappen = 0;
  for (const inv of invoices) {
    const paid = inv.payments.reduce((s, p) => s + toRappen(p.amount), 0);
    const credited = inv.creditNotes.reduce((s, c) => s + Math.abs(toRappen(c.totalAmount)), 0);
    rappen += Math.max(toRappen(inv.totalAmount) - credited - paid, 0);
  }
  return { amount: rappen / 100, count: invoices.length };
}
```

Run: `npx vitest run tests/integration/payments.test.ts tests/unit/payments-state.test.ts` → Expected: PASS.

- [ ] **Step 5: OP-Liste (`lib/receivables.ts`)**

Unit-Test in `tests/unit/receivables.test.ts` (Helfer `inv`, `dec`, `asOf` sind im File vorhanden):

```ts
  it("subtracts credit notes dated up to the cut-off and keeps a credited invoice with a remainder", () => {
    const report = buildReceivables(
      [
        inv({
          id: 1,
          creditNotes: [
            { date: new Date("2026-03-01"), totalAmount: dec(-30) },
            { date: new Date("2027-01-15"), totalAmount: dec(-20) },
          ],
        }),
      ],
      asOf
    );
    expect(report.rows).toHaveLength(1);
    expect(report.rows[0].openRappen).toBe(7000);
  });

  it("drops an invoice that credit notes settled completely", () => {
    const report = buildReceivables(
      [inv({ id: 1, state: "Canceled", creditNotes: [{ date: new Date("2026-03-01"), totalAmount: dec(-100) }] })],
      asOf
    );
    expect(report.rows).toHaveLength(0);
  });

  it("still skips a legacy Canceled invoice without credit notes", () => {
    expect(buildReceivables([inv({ id: 1, state: "Canceled" })], asOf).rows).toHaveLength(0);
  });
```

Run → FAIL. Dann `lib/receivables.ts` ändern:

- `ReceivableInput` um `creditNotes?: { date: Date; totalAmount: { toNumber(): number } }[];`
- `ReceivableRow` bleibt unverändert. Achtung: Das bestehende Feld `creditRappen` bedeutet **Guthaben** (Überzahlung), nicht Gutschrift. Die Gutschriftssumme heisst in der Schleife deshalb `creditNoteRappen` und wird nicht als eigenes Feld ausgegeben.
- In `buildReceivables` die ersten beiden Zeilen der Schleife und die Restberechnung ersetzen:

```ts
  for (const inv of invoices) {
    const creditNotes = inv.creditNotes ?? [];
    if (inv.state === "Draft") continue;
    // Legacy: a manually canceled invoice has no credit notes and never counts.
    if (inv.state === "Canceled" && creditNotes.length === 0) continue;
    if (inv.date.getTime() > asOf.getTime()) continue;

    const totalRappen = toRappen(inv.totalAmount);
    const paidRappen = inv.payments
      .filter((p) => p.date.getTime() <= asOf.getTime())
      .reduce((sum, p) => sum + toRappen(p.amount), 0);
    const creditNoteRappen = creditNotes
      .filter((c) => c.date.getTime() <= asOf.getTime())
      .reduce((sum, c) => sum + Math.abs(toRappen(c.totalAmount)), 0);
    const rest = totalRappen - paidRappen - creditNoteRappen;
    if (rest === 0) continue;
```

`rows.push({ ... })` bleibt unverändert. In `fetchReceivables`: `where: { state: { not: "Draft" }, creditNoteForId: null, date: { lte: asOf } }` und im `select` `creditNotes: { where: { state: { not: "Draft" } }, select: { date: true, totalAmount: true } },` ergänzen.

Integrationstest `tests/integration/receivables.test.ts`: einen Fall ergänzen (Original 100, versendete Gutschrift 100 mit Datum vor dem Stichtag, Stichtag danach → keine Zeile; Stichtag vor dem Gutschriftsdatum → Zeile mit 10000 Rappen offen). Helfer des Files wiederverwenden.

Run: `npx vitest run tests/unit/receivables.test.ts tests/integration/receivables.test.ts` → Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib tests
git commit -m "feat(payments): subtract sent credit notes from the open amount

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Gutschrift erstellen und bearbeiten

**Files:**
- Create: `lib/credit-notes.ts`
- Modify: `app/(app)/invoices/actions.ts` (`createCreditNote`, `updateInvoice`)
- Test: neu `tests/unit/credit-notes.test.ts`, neu `tests/integration/credit-notes.test.ts`

**Interfaces:**
- Consumes: `toRappen`, `sumCreditedRappen` aus `lib/payments.ts` (Task 5); `creditNoteForId` (Task 1).
- Produces:
  - `class CreditNoteError extends Error` (Meldung ist UI-tauglich)
  - `createCreditNoteDraft(originalId: number, prisma?: PrismaClient): Promise<number>` – ID der neuen Gutschrift
  - `assertCreditWithinOriginal(db: Db, creditNote: { id: number; creditNoteForId: number; totalAmount: { toNumber(): number } | number }): Promise<void>` – wirft `CreditNoteError`
  - `negateDocumentInput<T extends { items: ItemData[]; totalAmount: number }>(input: T): T`
  - Server Action `createCreditNote(invoiceId: number): Promise<{ error?: string }>` (leitet bei Erfolg auf `/invoices/<neueId>/edit` um)

- [ ] **Step 1: Unit-Test für `negateDocumentInput`**

`tests/unit/credit-notes.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { negateDocumentInput } from "@/lib/credit-notes";

const item = {
  name: "Beratung",
  description: "",
  unit: "Hour" as const,
  unitPrice: 100,
  quantity: 2,
  discountPercent: 10,
  totalAmount: 180,
  customText: "",
  categoryId: null,
};

describe("negateDocumentInput", () => {
  it("negates quantities, item totals and the document total but keeps unit prices and discounts", () => {
    const out = negateDocumentInput({ items: [item], totalAmount: 180, discountPercent: 0 });
    expect(out.totalAmount).toBe(-180);
    expect(out.items[0].quantity).toBe(-2);
    expect(out.items[0].totalAmount).toBe(-180);
    expect(out.items[0].unitPrice).toBe(100);
    expect(out.items[0].discountPercent).toBe(10);
  });

  it("does not turn zero into negative zero", () => {
    const out = negateDocumentInput({ items: [], totalAmount: 0 });
    expect(Object.is(out.totalAmount, -0)).toBe(false);
  });
});
```

Run: `npx vitest run tests/unit/credit-notes.test.ts` → Expected: FAIL (Modul fehlt).

- [ ] **Step 2: `lib/credit-notes.ts` schreiben**

```ts
import defaultPrisma from "@/lib/prisma";
import type { Prisma, PrismaClient } from "@prisma/client";
import type { ItemData } from "@/components/items-editor-schema";
import { sumCreditedRappen, toRappen } from "@/lib/payments";

// Deliberately no "use server": plain helpers, used from actions only.

type Db = PrismaClient | Prisma.TransactionClient;

/** Validation error whose message is safe to show in the UI. */
export class CreditNoteError extends Error {}

/**
 * The form shows credit notes with positive amounts; the database stores them
 * negative (quantity, item totals and document total). Unit price and
 * discounts stay as they are.
 */
export function negateDocumentInput<T extends { items: ItemData[]; totalAmount: number }>(input: T): T {
  const neg = (n: number) => (n === 0 ? 0 : -n);
  return {
    ...input,
    totalAmount: neg(input.totalAmount),
    items: input.items.map((item) => ({
      ...item,
      quantity: neg(item.quantity),
      totalAmount: neg(item.totalAmount),
    })),
  };
}

/**
 * Creates a credit note draft for a sent invoice, copying all items with
 * negated quantities. The user then removes or adjusts items (partial credit)
 * and sends it.
 */
export async function createCreditNoteDraft(
  originalId: number,
  prisma: PrismaClient = defaultPrisma
): Promise<number> {
  return prisma.$transaction(async (tx) => {
    const original = await tx.invoice.findUnique({
      where: { id: originalId },
      include: { items: { orderBy: { id: "asc" } } },
    });
    if (!original) throw new CreditNoteError("Rechnung nicht gefunden.");
    if (original.creditNoteForId != null) {
      throw new CreditNoteError("Zu einer Gutschrift kann keine weitere Gutschrift erstellt werden.");
    }
    if (original.state === "Draft") {
      throw new CreditNoteError("Entwürfe lassen sich direkt bearbeiten oder löschen.");
    }
    if (original.state === "Canceled") {
      throw new CreditNoteError("Die Rechnung ist bereits vollständig gutgeschrieben.");
    }

    const now = new Date();
    const credit = await tx.invoice.create({
      data: {
        customerId: original.customerId,
        customUserText: original.customUserText,
        date: now,
        // A credit note has nothing to pay; the column is required, so reuse the date.
        dueDate: now,
        totalAmount: original.totalAmount.negated(),
        discountPercent: original.discountPercent,
        state: "Draft",
        creditNoteForId: original.id,
      },
    });
    if (original.items.length > 0) {
      await tx.item.createMany({
        data: original.items.map((item) => ({
          invoiceId: credit.id,
          name: item.name,
          description: item.description,
          unit: item.unit,
          unitPrice: item.unitPrice,
          quantity: item.quantity.negated(),
          discountPercent: item.discountPercent,
          totalAmount: item.totalAmount.negated(),
          customText: item.customText,
          categoryId: item.categoryId,
        })),
      });
    }
    return credit.id;
  });
}

/**
 * Credit notes of an invoice together must not exceed the original total.
 * Counts the already sent credit notes plus the one being saved or sent.
 */
export async function assertCreditWithinOriginal(
  db: Db,
  creditNote: { id: number; creditNoteForId: number; totalAmount: { toNumber(): number } | number }
): Promise<void> {
  const ownRappen = Math.abs(toRappen(creditNote.totalAmount));
  if (ownRappen === 0) throw new CreditNoteError("Die Gutschrift muss einen Betrag haben.");

  const original = await db.invoice.findUniqueOrThrow({
    where: { id: creditNote.creditNoteForId },
    select: { totalAmount: true },
  });
  // The credit note itself counts through ownRappen, so exclude it when it is already sent.
  const sentRappen = await sumCreditedRappen(db, creditNote.creditNoteForId);
  const self = await db.invoice.findUnique({ where: { id: creditNote.id }, select: { state: true, totalAmount: true } });
  const alreadyCounted = self && self.state !== "Draft" ? Math.abs(toRappen(self.totalAmount)) : 0;

  if (sentRappen - alreadyCounted + ownRappen > toRappen(original.totalAmount)) {
    throw new CreditNoteError("Die Gutschriften dürfen zusammen den Rechnungsbetrag nicht übersteigen.");
  }
}
```

Run: `npx vitest run tests/unit/credit-notes.test.ts` → Expected: PASS.

- [ ] **Step 3: Integrationstests für Erstellen und Obergrenze**

`tests/integration/credit-notes.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { createTestDatabase, createValidTestCustomer, createValidItemList } from "../test-utils";
import { createCreditNoteDraft, assertCreditWithinOriginal, CreditNoteError } from "@/lib/credit-notes";

describe("credit notes against a real database", () => {
  const db = createTestDatabase();

  async function seedInvoice(state: "Draft" | "Sent" | "Canceled" = "Sent", total = 200) {
    const customer = await db.prisma.customer.create({ data: createValidTestCustomer() });
    return db.prisma.invoice.create({
      data: {
        customerId: customer.customerId,
        documentNumber: state === "Draft" ? null : `R-${Math.floor(Math.random() * 1e8)}`,
        date: new Date("2026-01-01"),
        dueDate: new Date("2099-01-01"),
        totalAmount: total,
        state,
        items: { create: createValidItemList() },
      },
    });
  }

  it("copies the items negated into a draft credit note", async () => {
    const original = await seedInvoice();
    const id = await createCreditNoteDraft(original.id, db.prisma);

    const credit = await db.prisma.invoice.findUniqueOrThrow({ where: { id }, include: { items: true } });
    expect(credit.state).toBe("Draft");
    expect(credit.documentNumber).toBeNull();
    expect(credit.creditNoteForId).toBe(original.id);
    expect(credit.totalAmount.toNumber()).toBe(-200);
    expect(credit.items.length).toBeGreaterThan(0);
    expect(credit.items.every((i) => i.quantity.toNumber() < 0 && i.totalAmount.toNumber() < 0)).toBe(true);
  });

  it.each(["Draft", "Canceled"] as const)("refuses a credit note for a %s invoice", async (state) => {
    const original = await seedInvoice(state);
    await expect(createCreditNoteDraft(original.id, db.prisma)).rejects.toBeInstanceOf(CreditNoteError);
  });

  it("refuses a credit note for a credit note", async () => {
    const original = await seedInvoice();
    const creditId = await createCreditNoteDraft(original.id, db.prisma);
    await db.prisma.invoice.update({ where: { id: creditId }, data: { state: "Sent", documentNumber: "R-CN1" } });
    await expect(createCreditNoteDraft(creditId, db.prisma)).rejects.toBeInstanceOf(CreditNoteError);
  });

  it("caps the sum of credit notes at the original total", async () => {
    const original = await seedInvoice("Sent", 100);
    await db.prisma.invoice.create({
      data: {
        customerId: original.customerId,
        documentNumber: "R-CN-A",
        date: new Date(),
        dueDate: new Date(),
        totalAmount: -70,
        state: "Sent",
        creditNoteForId: original.id,
      },
    });
    const draft = await db.prisma.invoice.create({
      data: {
        customerId: original.customerId,
        date: new Date(),
        dueDate: new Date(),
        totalAmount: -40,
        state: "Draft",
        creditNoteForId: original.id,
      },
    });

    await expect(
      assertCreditWithinOriginal(db.prisma, { id: draft.id, creditNoteForId: original.id, totalAmount: -40 })
    ).rejects.toThrow("Die Gutschriften dürfen zusammen den Rechnungsbetrag nicht übersteigen.");
    await expect(
      assertCreditWithinOriginal(db.prisma, { id: draft.id, creditNoteForId: original.id, totalAmount: -30 })
    ).resolves.toBeUndefined();
  });

  it("does not count an already sent credit note twice when it is checked again", async () => {
    const original = await seedInvoice("Sent", 100);
    const sent = await db.prisma.invoice.create({
      data: {
        customerId: original.customerId,
        documentNumber: "R-CN-B",
        date: new Date(),
        dueDate: new Date(),
        totalAmount: -100,
        state: "Sent",
        creditNoteForId: original.id,
      },
    });
    await expect(
      assertCreditWithinOriginal(db.prisma, { id: sent.id, creditNoteForId: original.id, totalAmount: -100 })
    ).resolves.toBeUndefined();
  });

  it("refuses a credit note without an amount", async () => {
    const original = await seedInvoice();
    const draft = await db.prisma.invoice.create({
      data: {
        customerId: original.customerId,
        date: new Date(),
        dueDate: new Date(),
        totalAmount: 0,
        state: "Draft",
        creditNoteForId: original.id,
      },
    });
    await expect(
      assertCreditWithinOriginal(db.prisma, { id: draft.id, creditNoteForId: original.id, totalAmount: 0 })
    ).rejects.toThrow("Die Gutschrift muss einen Betrag haben.");
  });
});
```

Run: `npx vitest run tests/integration/credit-notes.test.ts` → Expected: PASS (Implementierung steht aus Step 2). Falls `createValidItemList` keine `unit` liefert, die Fixture in `tests/test-utils.ts` ansehen; sie liefert `unit: "Piece"`.

- [ ] **Step 4: Action `createCreditNote` und `updateInvoice` für Gutschriften**

In `app/(app)/invoices/actions.ts` Imports ergänzen:

```ts
import {
  CreditNoteError,
  assertCreditWithinOriginal,
  createCreditNoteDraft,
  negateDocumentInput,
} from "@/lib/credit-notes";
```

Neue Action (unter `deleteInvoice`):

```ts
export async function createCreditNote(invoiceId: number): Promise<{ error?: string }> {
  const session = await requireEditor();
  let creditId: number;
  try {
    creditId = await createCreditNoteDraft(invoiceId);
  } catch (err) {
    if (err instanceof CreditNoteError) return { error: err.message };
    log.error({ invoiceId, err }, "createCreditNote failed");
    return { error: "Gutschrift konnte nicht erstellt werden." };
  }
  await logAudit(session, "CREATE", "Invoice", creditId, undefined, { creditNoteFor: invoiceId });
  revalidatePath(`/invoices/${invoiceId}`);
  revalidatePath("/invoices");
  redirect(`/invoices/${creditId}/edit`);
}
```

`updateInvoice` anpassen: Direkt nach `const session = await requireEditor();` die Rechnung laden, und die Pflichtfeldprüfung für `dueDate` bei Gutschriften auslassen:

```ts
  const existing = await prisma.invoice.findUnique({
    where: { id },
    select: { creditNoteForId: true, customerId: true },
  });
  if (!existing) return { error: "Rechnung nicht gefunden." };
  const isCreditNote = existing.creditNoteForId != null;
  ...
  if (!customerIdRaw || !dateRaw || (!isCreditNote && !dueDateRaw)) {
    return { error: "Bitte alle Pflichtfelder ausfüllen." };
  }

  // A credit note always belongs to the customer of its original; the form
  // only sends a hidden field, which must not be trusted.
  const customerId = isCreditNote ? existing.customerId : parseInt(customerIdRaw, 10);
```

(Die bisherige Zeile `const customerId = parseInt(customerIdRaw, 10);` entfällt dafür. `existing.customerId` ist der Kunde des Originals, weil `createCreditNoteDraft` ihn von dort übernimmt.)

Nach dem Parsen der Positionen und vor dem `updateDocumentWithItems`-Aufruf (die `let items/totalAmount/discountPercent` bleiben; `updateDocumentWithItems`-Input wird über eine Zwischenvariable gebaut):

```ts
  let input = {
    kind: "invoice" as const,
    customerId,
    customUserText: customUserText || null,
    date: new Date(dateRaw),
    dueDate: isCreditNote ? new Date(dateRaw) : new Date(dueDateRaw),
    totalAmount,
    discountPercent,
    items,
  };
  if (isCreditNote) {
    if (items.length === 0 || items.some((item) => item.quantity <= 0)) {
      return { error: "Eine Gutschrift braucht mindestens eine Position mit positiver Menge." };
    }
    input = negateDocumentInput(input);
    try {
      await assertCreditWithinOriginal(prisma, {
        id,
        creditNoteForId: existing.creditNoteForId!,
        totalAmount: input.totalAmount,
      });
    } catch (err) {
      if (err instanceof CreditNoteError) return { error: err.message };
      throw err;
    }
  }

  try {
    await updateDocumentWithItems(id, input);
  } catch (err) {
    ...
```

Der bisherige direkte Aufruf `updateDocumentWithItems(id, { kind: "invoice", ... })` wird durch den obigen ersetzt; der `catch`-Block bleibt (mit `DocumentLockedError`-Zweig aus Task 3). Das `syncInvoiceState`-Aufruf danach bleibt und gilt für Gutschriften nicht relevant, ist aber unschädlich, weil Drafts unverändert bleiben (`computeInvoiceState` gibt `Draft` zurück).

- [ ] **Step 5: Unit-Test für die Actions**

In `tests/unit/invoice-sub-actions.test.ts` oder einer neuen Datei `tests/unit/credit-note-actions.test.ts` (Mocks nach dem Muster von `tests/unit/invoice-status-actions.test.ts`: `@/lib/prisma`, `@/lib/auth`, `next/navigation`, `next/cache`, `@/lib/audit`, `@/lib/credit-notes`, `@/lib/document-actions`, `@/lib/payments`, `@/lib/document-number`) zwei Tests:

```ts
  it("createCreditNote audits, then redirects to the edit page", async () => {
    vi.mocked(auth).mockResolvedValue(editorSession);
    vi.mocked(createCreditNoteDraft).mockResolvedValue(42);
    vi.mocked(redirect).mockImplementation(() => {
      throw new Error("REDIRECT:/invoices/42/edit");
    });

    await expect(createCreditNote(7)).rejects.toThrow("REDIRECT:/invoices/42/edit");
    expect(logAudit).toHaveBeenCalledWith(editorSession, "CREATE", "Invoice", 42, undefined, {
      creditNoteFor: 7,
    });
  });

  it("createCreditNote returns the validation message", async () => {
    vi.mocked(auth).mockResolvedValue(editorSession);
    vi.mocked(createCreditNoteDraft).mockRejectedValue(new CreditNoteError("Nicht möglich."));

    expect(await createCreditNote(7)).toEqual({ error: "Nicht möglich." });
    expect(redirect).not.toHaveBeenCalled();
  });
```

(`CreditNoteError` in der `vi.mock("@/lib/credit-notes", ...)`-Factory als echte Klasse bereitstellen: `CreditNoteError: class extends Error {}` und dieselbe Klasse aus dem Modul importieren.)

Run: `npx vitest run tests/unit/credit-note-actions.test.ts tests/integration/credit-notes.test.ts` → Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib "app/(app)/invoices/actions.ts" tests
git commit -m "feat(invoices): create and edit credit note drafts

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Gutschrift versenden, PDF und Ausschlüsse

**Files:**
- Modify: `lib/document-actions.ts` (`sendDocument`)
- Modify: `lib/pdf/document-pdf.ts`, `lib/pdf/invoice-pdf.ts`, `app/api/invoices/[id]/pdf/route.ts`
- Modify: `app/(app)/invoices/import/actions.ts`, `lib/reminders.ts`, `app/(app)/analytics/lib/analytics-queries.ts`
- Test: `tests/unit/document-actions.test.ts`, `tests/unit/document-pdf-generation.test.ts`, `tests/integration/credit-notes.test.ts`, `tests/integration/reminders.test.ts`

**Interfaces:**
- Consumes: `assertCreditWithinOriginal`, `CreditNoteError` (Task 6); `syncInvoiceState` (existiert, Task 5-Logik).
- Produces: `RenderDoc.dueDate: Date | string | null` (bei `null` entfallen Fälligkeitszeile und Schlusszeile), optionales `RenderDoc.referenceLine?: string` (Zeile „Zu Rechnung R-…“ unter dem Datum).

- [ ] **Step 1: PDF-Test für die Gutschrift**

In `tests/unit/document-pdf-generation.test.ts` (Helfer `baseDoc`, `extractText`, `company` sind im File vorhanden) einen Test ergänzen:

```ts
  it("renders a credit note without due date and without a QR bill page", async () => {
    const buf = await generateDocumentPdf(
      baseDoc({
        title: "Gutschrift",
        numberLabel: "Gutschrift-Nr.:",
        documentNumber: "I-26010002",
        referenceLine: "Zu Rechnung I-26010001",
        dueDate: null,
        totalAmount: -180,
        qr: null,
      }),
      company,
      "de-CH"
    );
    const { numPages, pageText } = await extractText(buf);
    const text = pageText.join(" ");
    expect(numPages).toBe(1);
    expect(text).toContain("Gutschrift");
    expect(text).toContain("Zu Rechnung I-26010001");
    expect(text).not.toContain("Fälligkeit");
    expect(text).not.toContain("Zahlbar bis");
  });
```

Run: `npx vitest run tests/unit/document-pdf-generation.test.ts` → Expected: FAIL (Typfehler/Inhalt).

- [ ] **Step 2: Renderer erweitern**

In `lib/pdf/document-pdf.ts`:
- `RenderDoc`: `dueDate: Date | string | null;` (mit Kommentar `// null for credit notes`) und `referenceLine?: string;` ergänzen.
- `detailRows` ersetzen:

```ts
    const detailRows: string[][] = [
      [doc.numberLabel, doc.documentNumber],
      ["Datum:", fmtDate(doc.date, locale)],
    ];
    if (doc.dueDate !== null) detailRows.push([doc.dueLabel, fmtDate(doc.dueDate, locale)]);
    if (doc.referenceLine) detailRows.push(["Bezug:", doc.referenceLine]);
```

- Die Schlusszeile nur bei Fälligkeit zeichnen:

```ts
    if (doc.dueDate !== null) {
      pdf.text(`${doc.closingNoteLabel} ${fmtDate(doc.dueDate, locale)}`, MARGIN, y);
      y += LINE_HEIGHT + 20;
    }
```

  (Die `CLOSING_H`-Berechnung darüber bleibt; sie darf grosszügig sein.)

Run: `npx vitest run tests/unit/document-pdf-generation.test.ts` → Expected: PASS. Falls `fmtDate` oder andere Stellen im File `doc.dueDate` ohne Null-Prüfung verwenden (`grep -n "doc.dueDate" lib/pdf/document-pdf.ts`), dort ebenfalls absichern.

- [ ] **Step 3: `generateInvoicePdf` für Gutschriften**

In `lib/pdf/invoice-pdf.ts`: `InvoiceWithDetails` erweitern um `creditNoteFor?: { documentNumber: string | null } | null`. In `generateInvoicePdf` nach `const draft = ...`:

```ts
  const isCreditNote = invoice.creditNoteForId != null;
  const qr = draft || isCreditNote
    ? null
    : buildQrBillData({ ... });   // bestehender Aufruf unverändert
```

und im `doc`-Objekt:

```ts
    title: isCreditNote ? "Gutschrift" : "Rechnung",
    numberLabel: isCreditNote ? "Gutschrift-Nr.:" : "Rechnungs-Nr.:",
    dueDate: isCreditNote ? null : invoice.dueDate,
    referenceLine: isCreditNote && invoice.creditNoteFor
      ? `Zu Rechnung ${documentLabel(invoice.creditNoteFor.documentNumber)}`
      : undefined,
```

Die Summe für Gutschriften: `calculateInvoiceTotal` rechnet `quantity * unitPrice`, negative Mengen ergeben negative Summen; der QR-Zweig entfällt dafür. Kein weiterer Eingriff.

`app/api/invoices/[id]/pdf/route.ts`: Rechnung mit `include: { customer: true, items: {...}, creditNoteFor: { select: { documentNumber: true } } }` laden und den Dateinamen anpassen:

```ts
  const prefix = invoice.creditNoteForId != null ? "gutschrift" : "rechnung";
  const filename = invoice.documentNumber
    ? `${prefix}-${invoice.documentNumber}.pdf`
    : `entwurf-${invoice.id}.pdf`;
```

Ausserdem `sendDocument` (Step 4) muss beim Laden der Rechnung ebenfalls `creditNoteFor` mitladen.

- [ ] **Step 4: Tests für `sendDocument` mit Gutschrift**

In `tests/unit/document-actions.test.ts`:
1. Mocks ergänzen: `vi.mock("@/lib/credit-notes", async () => ({ CreditNoteError: class extends Error {}, assertCreditWithinOriginal: vi.fn() }));` und `vi.mock("@/lib/payments", () => ({ syncInvoiceState: vi.fn() }));` (Import der Mocks im Testfile: `import { assertCreditWithinOriginal, CreditNoteError } from "@/lib/credit-notes";` und `import { syncInvoiceState } from "@/lib/payments";`).
2. Tests im `describe("sendDocument")`:

```ts
  it("sends a credit note, then recalculates the original invoice", async () => {
    vi.mocked(prisma.applicationSettings.findFirst).mockResolvedValue({ companyInfo: {} } as never);
    vi.mocked(prisma.invoice.findUnique).mockResolvedValue({
      id: 5,
      documentNumber: null,
      creditNoteForId: 1,
      totalAmount: -50,
      customer: {},
      items: [],
    } as never);
    vi.mocked(assignDocumentNumber).mockResolvedValue("I-2026-002");
    vi.mocked(generateInvoicePdf).mockResolvedValue(Buffer.from("pdf"));
    vi.mocked(sendInvoiceEmail).mockResolvedValue(undefined);

    const result = await sendDocument({ kind: "invoice", id: 5, to: "a@b.ch", subject: "s", body: "b", actor });

    expect(result.success).toBe(true);
    expect(assertCreditWithinOriginal).toHaveBeenCalled();
    expect(syncInvoiceState).toHaveBeenCalledWith({ invoiceId: 1, actor, source: "credit-note" });
    // the send must not have assigned a number before the check passed
    expect(vi.mocked(assertCreditWithinOriginal).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(assignDocumentNumber).mock.invocationCallOrder[0]
    );
  });

  it("does not send or number a credit note that exceeds the original", async () => {
    vi.mocked(prisma.applicationSettings.findFirst).mockResolvedValue({ companyInfo: {} } as never);
    vi.mocked(prisma.invoice.findUnique).mockResolvedValue({
      id: 5, documentNumber: null, creditNoteForId: 1, totalAmount: -500, customer: {}, items: [],
    } as never);
    vi.mocked(assertCreditWithinOriginal).mockRejectedValue(new CreditNoteError("Zu hoch."));

    const result = await sendDocument({ kind: "invoice", id: 5, to: "a@b.ch", subject: "s", body: "b", actor });

    expect(result).toEqual({ error: "Zu hoch." });
    expect(assignDocumentNumber).not.toHaveBeenCalled();
    expect(sendInvoiceEmail).not.toHaveBeenCalled();
  });
```

Run → Expected: FAIL.

- [ ] **Step 5: `sendDocument` erweitern**

In `lib/document-actions.ts` Imports `import { CreditNoteError, assertCreditWithinOriginal } from "@/lib/credit-notes";` und `import { syncInvoiceState } from "@/lib/payments";`. Im Invoice-Zweig:
- `findUnique` `include` um `creditNoteFor: { select: { documentNumber: true } }` erweitern.
- Nach `if (!invoice) return { error: "Rechnung nicht gefunden." };` und **vor** `assignDocumentNumber`:

```ts
    if (invoice.creditNoteForId != null) {
      try {
        await assertCreditWithinOriginal(defaultPrisma, {
          id: invoice.id,
          creditNoteForId: invoice.creditNoteForId,
          totalAmount: invoice.totalAmount,
        });
      } catch (err) {
        if (err instanceof CreditNoteError) return { error: err.message };
        throw err;
      }
    }
```

- Nach dem bestehenden `logAudit(...)` des Invoice-Zweigs:

```ts
    if (invoice.creditNoteForId != null) {
      await syncInvoiceState({ invoiceId: invoice.creditNoteForId, actor: input.actor, source: "credit-note" });
      revalidatePath(`/invoices/${invoice.creditNoteForId}`);
      revalidatePath("/accounting/receivables");
      revalidatePath("/dashboard");
    }
```

Hinweis: Der Statuswechsel der Gutschrift zu `Sent` läuft über die bestehende `updateMany`-Transaktion (Draft → Sent). Danach zählt sie in `sumCreditedRappen`.

Run: `npx vitest run tests/unit/document-actions.test.ts` → Expected: PASS.

- [ ] **Step 6: Integrationstest Gutschrift bis Restbetrag**

An `tests/integration/credit-notes.test.ts` ergänzen (Import `syncInvoiceState`, `getPaymentSummary`, `recordPayment` aus `@/lib/payments`, `Session` aus `next-auth`, `actor` wie in `payments.test.ts`):

```ts
  it("a sent full credit note cancels the unpaid original; a partial one lowers the open amount", async () => {
    const full = await seedInvoice("Sent", 100);
    await db.prisma.invoice.create({
      data: {
        customerId: full.customerId, documentNumber: "R-CN-F", date: new Date(), dueDate: new Date(),
        totalAmount: -100, state: "Sent", creditNoteForId: full.id,
      },
    });
    expect((await syncInvoiceState({ invoiceId: full.id, actor, source: "credit-note" }, db.prisma)).state).toBe("Canceled");

    const partial = await seedInvoice("Sent", 100);
    await db.prisma.invoice.create({
      data: {
        customerId: partial.customerId, documentNumber: "R-CN-P", date: new Date(), dueDate: new Date(),
        totalAmount: -25, state: "Sent", creditNoteForId: partial.id,
      },
    });
    expect((await syncInvoiceState({ invoiceId: partial.id, actor, source: "credit-note" }, db.prisma)).state).toBe("Sent");
    expect((await getPaymentSummary(partial.id, db.prisma)).remainingRappen).toBe(7500);
  });
```

Run: `npx vitest run tests/integration/credit-notes.test.ts` → Expected: PASS.

- [ ] **Step 7: Mahnwesen, Bankimport und Analytics schliessen Gutschriften aus**

- `lib/reminders.ts` (`checkOverdueInvoices`): im `findMany` für überfällige Rechnungen `creditNoteForId: null` ergänzen (`where: { state: "Overdue", pendingReminder: null, creditNoteForId: null }`).
- `app/(app)/invoices/import/actions.ts` (`parseStatement`): im `prisma.invoice.findMany` `where: { state: { in: ["Sent", "Overdue", "PartiallyPaid"] }, creditNoteForId: null }` und im `select` ergänzen: `creditNotes: { where: { state: { not: "Draft" } }, select: { totalAmount: true } },`. Im `.map` ersetzen:

```ts
      .map((invoice) => {
        const paidRappen = invoice.payments.reduce((s, p) => s + toRappen(p.amount), 0);
        const creditedRappen = invoice.creditNotes.reduce((s, c) => s + Math.abs(toRappen(c.totalAmount)), 0);
        return {
          id: invoice.id,
          documentNumber: invoice.documentNumber,
          openAmount: Math.max(toRappen(invoice.totalAmount) - creditedRappen - paidRappen, 0) / 100,
        };
      }),
```
- `app/(app)/analytics/lib/analytics-queries.ts`: Gutschriften aus den Rechnungs-Kennzahlen und Drilldowns ausnehmen. In der Abfrage `prisma.invoice.findMany({ where: { state: { notIn: [InvoiceState.Draft] }, date: ... }, select: { state: true, totalAmount: true } })` (Kennzahlen Durchschnitt und Zahlungsquote) sowie in den drei `fetchDrilldownInvoices`-Zweigen `creditNoteForId: null` in das `where` aufnehmen.

Test: in `tests/integration/reminders.test.ts` im bestehenden `describe("checkOverdueInvoices")` (Helfer `seedCustomer`, `seedOverdueInvoice`, `pastDate` sind dort definiert) ergänzen:

```ts
  it("creates no PendingReminder for a credit note", async () => {
    const { prisma } = db;
    const customer = await seedCustomer();
    const original = await seedOverdueInvoice(customer.customerId, "R-240010");
    const credit = await prisma.invoice.create({
      data: {
        customerId: customer.customerId,
        documentNumber: "R-240011",
        date: pastDate(40),
        dueDate: pastDate(5),
        totalAmount: -100,
        state: "Overdue",
        creditNoteForId: original.id,
      },
    });

    await checkOverdueInvoices(prisma);

    expect(await prisma.pendingReminder.findUnique({ where: { invoiceId: credit.id } })).toBeNull();
    expect(await prisma.pendingReminder.findUnique({ where: { invoiceId: original.id } })).not.toBeNull();
  });
```

Run: `npx vitest run tests/integration tests/unit/analytics-queries.test.ts tests/unit/analytics-payments.test.ts` → Expected: PASS. Falls ein Analytics-Unit-Test das `where` per `toHaveBeenCalledWith` exakt prüft, den erwarteten Wert um `creditNoteForId: null` ergänzen.

- [ ] **Step 8: Commit**

```bash
git add lib "app/(app)" app/api tests
git commit -m "feat(invoices): send credit notes and keep them out of dunning and analytics

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 8: UI für Gutschriften

**Files:**
- Create: `app/(app)/invoices/CreateCreditNoteButton.tsx`
- Modify: `app/(app)/invoices/[id]/page.tsx`, `app/(app)/invoices/[id]/edit/page.tsx`, `app/(app)/invoices/InvoiceForm.tsx`, `app/(app)/invoices/page.tsx`, `app/(app)/customers/[id]/page.tsx`, `app/api/export/invoices/route.ts`
- Test: `tests/unit` bzw. manuelle Prüfung (siehe Step 6)

**Interfaces:**
- Consumes: `createCreditNote(invoiceId)` (Task 6).

- [ ] **Step 1: Button „Gutschrift erstellen“**

`app/(app)/invoices/CreateCreditNoteButton.tsx`:

```tsx
"use client";

import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { createCreditNote } from "./actions";

export default function CreateCreditNoteButton({ invoiceId }: { invoiceId: number }) {
  return (
    <ConfirmDialog
      title="Gutschrift erstellen"
      description="Es wird ein Gutschrift-Entwurf mit allen Positionen dieser Rechnung angelegt. Du kannst Positionen streichen oder anpassen, bevor du die Gutschrift versendest."
      confirmLabel="Gutschrift erstellen"
      confirmVariant="default"
      triggerVariant="outline"
      onConfirm={() => createCreditNote(invoiceId)}
    >
      Gutschrift erstellen
    </ConfirmDialog>
  );
}
```

- [ ] **Step 2: Detailseite**

`app/(app)/invoices/[id]/page.tsx`:

1. Import `CreateCreditNoteButton`. Das Laden erweitern:

```ts
      include: {
        customer: true,
        items: true,
        sentLogs: { orderBy: { sentAt: "desc" } },
        payments: { orderBy: [{ date: "asc" }, { id: "asc" }] },
        creditNoteFor: { select: { id: true, documentNumber: true } },
        creditNotes: {
          where: { state: { not: "Draft" } },
          orderBy: { date: "asc" },
          select: { id: true, documentNumber: true, date: true, totalAmount: true },
        },
      },
```

2. `const isCreditNote = invoice.creditNoteForId !== null;` und die Summenberechnung erweitern:

```ts
  const creditedRappen = invoice.creditNotes.reduce((sum, c) => sum + Math.abs(toRappen(c.totalAmount)), 0);
  const summary = {
    total: totalRappen / 100,
    paid: paidRappen / 100,
    remaining: Math.max(totalRappen - creditedRappen - paidRappen, 0) / 100,
    overpaid: Math.max(paidRappen + creditedRappen - totalRappen, 0) / 100,
  };
```

3. Kopfzeile: für Gutschriften Titel `Gutschrift ${documentLabel(...)}` und darunter Link zum Original:

```tsx
          <h1 className="text-2xl font-semibold">
            {isCreditNote ? "Gutschrift " : ""}{documentLabel(invoice.documentNumber)}
          </h1>
          {invoice.creditNoteFor && (
            <p className="text-sm text-gray-500">
              Zu Rechnung{" "}
              <Link href={`/invoices/${invoice.creditNoteFor.id}`} className="hover:underline">
                {documentLabel(invoice.creditNoteFor.documentNumber)}
              </Link>
            </p>
          )}
```

4. Karte „Details“: Feld „Fällig am“ nur wenn `!isCreditNote`.

5. Neue Karte „Gutschriften“ (nur wenn `invoice.creditNotes.length > 0`), Tabelle mit Nummer (Link), Datum, Betrag; darunter Zeile „Offener Betrag“ mit `summary.remaining`.

6. Zahlungen-Karte nur für `!isCreditNote && invoice.state !== "Draft" && invoice.state !== "Canceled"`. „Status ändern“-Karte nur für `!isCreditNote`.

7. Button „Gutschrift erstellen“ neben „PDF herunterladen“ für Editor: `{canEdit && !isCreditNote && invoice.state !== "Draft" && invoice.state !== "Canceled" && <CreateCreditNoteButton invoiceId={invoice.id} />}`.

8. „Als Vorlage speichern“ nur für `!isCreditNote`. Das Versenden (`SendInvoiceButton`) bleibt für Gutschriften (Betreff/Text: der Standardtext spricht von „Rechnung Nr. … über …“). Für Gutschriften eigene Defaults:

```ts
  const defaultSubject = isCreditNote
    ? `Gutschrift Nr. ${numberOrPlaceholder} – ${companyName}`
    : (settings?.emailSubjectTemplate?.replace(...)... /* bestehende Logik */);
  const defaultBody = isCreditNote
    ? `Guten Tag ${invoice.customer.contactPerson}\n\nanbei erhalten Sie die Gutschrift Nr. ${numberOrPlaceholder} vom ${formatDate(invoice.date)} über ${formatCurrency(Math.abs(invoice.totalAmount.toNumber()))}.\n\nMit freundlichen Grüssen\n${companyName}`
    : /* bestehende Logik */;
```

(Die bestehende Berechnung für Rechnungen unverändert in den else-Zweig setzen; nicht neu formulieren.)

- [ ] **Step 3: Edit-Seite und Formular**

`edit/page.tsx`: Original laden, wenn Gutschrift, und Beträge für das Formular positiv machen:

```ts
  const isCreditNote = invoice.creditNoteForId !== null;
  const original = isCreditNote
    ? await prisma.invoice.findUnique({
        where: { id: invoice.creditNoteForId! },
        select: { id: true, documentNumber: true },
      })
    : null;
  const sign = isCreditNote ? -1 : 1;
  const serializedInvoice = {
    ...invoice,
    totalAmount: invoice.totalAmount.toNumber() * sign,
    discountPercent: invoice.discountPercent.toNumber(),
    items: invoice.items.map((item) => ({
      ...item,
      unitPrice: item.unitPrice.toNumber(),
      quantity: item.quantity.toNumber() * sign,
      discountPercent: item.discountPercent.toNumber(),
      totalAmount: item.totalAmount.toNumber() * sign,
    })),
  };
```

und `<InvoiceForm ... creditNoteFor={original ? { id: original.id, documentNumber: original.documentNumber } : undefined} />`.

`InvoiceForm.tsx`: Prop `creditNoteFor?: { id: number; documentNumber: string | null }` ergänzen; `SerializedInvoice` kennt `creditNoteForId` schon über `Omit<Invoice, ...>`. Anpassungen:
- Überschrift: `invoice ? \`${creditNoteFor ? "Gutschrift" : "Rechnung"} ${documentLabel(invoice.documentNumber)}\` : "Neue Rechnung"`; bei `creditNoteFor` darunter `<p className="text-sm text-muted-foreground">Zu Rechnung {documentLabel(creditNoteFor.documentNumber)}. Erfasse die gutzuschreibenden Beträge positiv.</p>`.
- Kundenfeld: bei `creditNoteFor` statt `CustomerCombobox` ein `<input type="hidden" name="customerId" value={invoice!.customerId} />` und den Kundennamen als Text (`defaultCustomer` ist vorhanden; Anzeige `defaultCustomer?.company || defaultCustomer?.contactPerson`).
- Das Feld „Fälligkeitsdatum“ nur `{!creditNoteFor && (...)}`; die `dueDate`-Steuerung bleibt sonst unverändert (der Server ignoriert das Feld bei Gutschriften).
- Kartentitel „Rechnungsdaten“ → `creditNoteFor ? "Gutschriftsdaten" : "Rechnungsdaten"`; Karte „Rabatt auf Gesamtrechnung“ bleibt.

- [ ] **Step 4: Rechnungsliste und Kundenseite**

`app/(app)/invoices/page.tsx`: In der Nummernzelle (innerhalb `invoices.map((inv) => ...)`, `<TableCell className="font-medium">`) nach dem `</Link>` ergänzen:

```tsx
                    {inv.creditNoteForId !== null && (
                      <span className="ml-2 text-xs font-normal text-muted-foreground">Gutschrift</span>
                    )}
```

Der Betrag bleibt negativ (`formatCurrency(inv.totalAmount.toNumber())`). In `app/(app)/customers/[id]/page.tsx` dasselbe in der Nummernzelle der Rechnungstabelle (`<TableCell className="font-medium">` in `invoices.map((inv) => ...)`) ergänzen; dort die Nummer ebenfalls mit `documentLabel(inv.documentNumber)` ausgeben, falls sie es nicht schon tut.

- [ ] **Step 5: CSV-Export**

`app/api/export/invoices/route.ts`: `include: { customer: true, creditNoteFor: { select: { documentNumber: true } } }`, Header um `"Gutschrift zu"` erweitern und pro Zeile `inv.creditNoteFor ? documentLabel(inv.creditNoteFor.documentNumber) : ""` anhängen. Falls ein Test den Header prüft (`grep -rn "Betrag (CHF)" tests`), diesen anpassen.

- [ ] **Step 6: Prüfen (Build, Lint, Sichtprüfung)**

Run: `npm run lint` → Expected: keine Fehler.
Run: `npx tsc --noEmit` → Expected: keine Fehler.
Run: `npm run dev` und manuell prüfen (mit `npm run db:seed` gefüllte DB): 1. Versendete Rechnung öffnen: „Bearbeiten“ und „Rechnung löschen“ fehlen, „Gutschrift erstellen“ ist da. 2. Gutschrift erstellen → Edit-Seite zeigt positive Beträge, kein Fälligkeitsdatum; Position streichen, speichern. 3. Gutschrift versenden (PDF prüfen: Titel „Gutschrift“, kein QR-Zahlteil, keine Fälligkeit). 4. Original zeigt Karte „Gutschriften“ und reduzierten Offen-Betrag; nach Vollgutschrift Status „Storniert“. 5. Kunde mit Rechnungen: „Archivieren“ funktioniert, „Löschen“ zeigt die Fehlermeldung. Ergebnis kurz notieren; wenn ein Punkt nicht klappt, Ursache beheben statt weitergehen.

- [ ] **Step 7: Commit**

```bash
git add "app/(app)" app/api
git commit -m "feat(invoices): credit note UI on detail, edit, list and export

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Benutzerhandbuch und Doku

**Files:**
- Modify: `public/benutzerhandbuch.html`
- Modify: `CLAUDE.md`, `FEATURE_ANALYSE.md`

Das Handbuch ist eine einzelne HTML-Datei mit eingebetteten Base64-Screenshots. Beim Bearbeiten **nie die ganze Datei lesen oder ausgeben**; mit `Grep` (Zeilennummern) und `Edit` auf kurze, eindeutige Textstellen arbeiten. Neue Screenshots sind nicht Teil dieser Aufgabe (sie entstehen aus einer laufenden Demo-Instanz über `scripts/manual-screenshots.ts`); der Text braucht keine Bilder.

- [ ] **Step 1: Status-Legende korrigieren**

Mit `Edit` in `public/benutzerhandbuch.html` ersetzen:
`<strong>Storniert</strong><span>Ungültig gemacht</span>` → `<strong>Storniert</strong><span>Vollständig gutgeschrieben</span>`

- [ ] **Step 2: Neuen Abschnitt „Festschreiben, Gutschrift & Storno“ einfügen**

Direkt **vor** `<h3 class="sub">Ausstehende E-Mails, Mahnungen &amp; Vorlagen</h3>` (mit `Edit` diese Zeile als `old_string` verwenden und den neuen Block plus die Zeile als `new_string`):

```html
      <h3 class="sub" id="festschreiben">Festschreiben, Gutschrift &amp; Storno</h3>
      <p>Eine Rechnung lässt sich nur bearbeiten, solange sie ein <strong>Entwurf</strong> ist. Sobald sie versendet ist, ist sie festgeschrieben: Es gibt keinen Button «Bearbeiten» mehr, und die Rechnung lässt sich nicht löschen. So bleibt nachvollziehbar, was der Kundin oder dem Kunden tatsächlich zugestellt wurde. Nur Entwürfe (Rechnungen ohne Nummer) können gelöscht werden.</p>
      <p>Der <strong>Status</strong> lässt sich nur noch entlang sinnvoller Übergänge ändern: Entwurf → Versendet oder Bezahlt, Versendet ↔ Überfällig, und «Bezahlt» über eine erfasste Zahlung. Zurück zum Entwurf oder von Hand auf «Storniert» geht nicht. «Storniert» ergibt sich nur aus einer Gutschrift.</p>
      <p>Um eine versendete Rechnung zu korrigieren, erstellst du eine <strong>Gutschrift</strong>:</p>
      <ol class="steps">
        <li><strong>Gutschrift erstellen</strong> – auf der Rechnungsseite die Schaltfläche «Gutschrift erstellen» wählen. Es entsteht ein Entwurf mit allen Positionen der Rechnung.</li>
        <li><strong>Anpassen</strong> – Positionen streichen oder Mengen und Beträge ändern, wenn nur ein Teil gutgeschrieben werden soll. Die Beträge erfasst du positiv; die Gutschrift wird automatisch als Minusbetrag geführt. Alle Gutschriften zusammen dürfen den Rechnungsbetrag nicht übersteigen.</li>
        <li><strong>Versenden</strong> – wie eine Rechnung, per E-Mail mit PDF. Erst beim Versand erhält die Gutschrift ihre Nummer aus derselben Reihe wie die Rechnungen. Das PDF trägt den Titel «Gutschrift» und verweist auf die Rechnung; es hat keinen Zahlteil.</li>
      </ol>
      <p>Auf der Originalrechnung erscheint der Block «Gutschriften». Der <strong>offene Betrag</strong> ist Rechnungsbetrag minus Zahlungen minus versendete Gutschriften, und so erscheint er auch in der Offene-Posten-Liste. Wird die ganze Rechnung gutgeschrieben und war noch nichts bezahlt, wechselt sie auf «Storniert». Wurde schon bezahlt, weist die Offene-Posten-Liste den zu viel bezahlten Betrag als Guthaben aus.</p>
      <div class="callout warn">
        <div class="ic">⚠️</div>
        <div><strong>Rückzahlungen</strong> Eine Gutschrift verändert die Einnahmen der Buchhaltung nicht. Ein Betrag, den du der Kundschaft zurückzahlst, wird derzeit nicht erfasst.</div>
      </div>
```

- [ ] **Step 3: Kunden-Abschnitt ergänzen**

Im Abschnitt `id="kunden"` nach der Liste `Rechnungen &amp; Offerten – alle mit diesem Kunden verknüpften Dokumente auf einen Blick.</li>\n      </ol>` (Ende der `<ol class="steps">` von «Kundendetail»; mit `Grep` auf `alle mit diesem Kunden verknüpften Dokumente` die Stelle finden) einfügen:

```html
      <h3 class="sub" id="kunden-archiv">Kunden archivieren</h3>
      <p>Kundinnen und Kunden, die Rechnungen haben, lassen sich <strong>nicht löschen</strong>, weil die Rechnungen als Belege erhalten bleiben müssen. Stattdessen wählst du auf der Kundenseite <strong>«Archivieren»</strong>. Archivierte Kunden verschwinden aus der Kundenliste und aus den Auswahllisten für neue Rechnungen und Offerten; für sie werden auch keine Jahresrechnungen mehr erstellt. Über die Schaltfläche <strong>«Archiv»</strong> oben in der Kundenliste findest du sie wieder und kannst sie mit «Wiederherstellen» reaktivieren. Kunden ohne Rechnungen kann ein Admin weiterhin löschen.</p>
```

- [ ] **Step 4: Bestehende Handbuchtexte auf Widersprüche prüfen**

Run (Grep-Tool, `output_mode: content`, nur kurze Trefferzeilen; Bildzeilen enthalten diese Wörter nicht): Suche in `public/benutzerhandbuch.html` nach `löschen`, `Bearbeiten`, `storniert`, `Storno`, `Canceled`. Jede Textstelle lesen, die behauptet, versendete Rechnungen seien bearbeitbar oder löschbar oder «Storniert» sei von Hand wählbar, und korrigieren (z. B. im Absatz zu Zahlungen: «Rechnungen mit Zahlungen können nicht gelöscht werden» → ergänzen, dass versendete Rechnungen generell nicht gelöscht werden können). Zeilen mit `data:image` nie ausgeben (`--max-columns`/Kürzung mit `cut -c1-300`).

- [ ] **Step 5: Handbuch prüfen**

Run: `npx tsx -e "const fs=require('fs');const h=fs.readFileSync('public/benutzerhandbuch.html','utf8');for(const id of ['festschreiben','kunden-archiv']){console.log(id, h.includes('id=\"'+id+'\"'))}"`
Expected: beide `true`. Datei im Browser öffnen (`public/benutzerhandbuch.html`, oder `npm run dev` und `/benutzerhandbuch.html`) und die zwei neuen Abschnitte auf Darstellung prüfen (Steps-Liste und Callout wie in den Nachbarabschnitten).

- [ ] **Step 6: `CLAUDE.md` und `FEATURE_ANALYSE.md`**

`CLAUDE.md`, Abschnitt «Business document workflow»: Nach der Zeile zu `Invoice`-States ergänzen:

```
- **Locking and credit notes:** only `Draft` invoices are editable or deletable (`updateDocumentWithItems` throws `DocumentLockedError`, `deleteInvoice` refuses others). Manual status changes follow the table in `lib/state-manager.ts` (`canTransitionInvoice`); `Canceled` is never a manual target. A credit note is an `Invoice` with `creditNoteForId` and negative amounts (`lib/credit-notes.ts`); its sent amounts reduce the original's open amount in `lib/payments.ts` (`sumCreditedRappen`) and `lib/receivables.ts`. Credit notes are excluded from overdue/dunning, payments and analytics. Customers with invoices are archived (`Customer.archivedAt`), not deleted (`Invoice.customer` is `onDelete: Restrict`)
```

`FEATURE_ANALYSE.md`:
- Roadmap Phase 1: Zeile `- [ ] 2. F3 Festschreiben, ...` → `- [x] 2. F3 Festschreiben, Gutschrift, keine Cascade-Löschung von Rechnungen (#<PR-Nummer nach dem Merge ergänzen>)` (den Klammerhinweis mit den offenen Punkten entfernen).
- Tabelle 2.3: In den Zeilen `U1`–`U4` am Anfang des Befunds `~~…~~ **Erledigt mit F3.**` nach dem Muster von R4/R6 (Befundtext durchgestrichen, Beleg-Spalte kurz mit den neuen Stellen ersetzt: `lib/document-actions.ts` (`DocumentLockedError`), `lib/state-manager.ts`, `lib/credit-notes.ts`).

- [ ] **Step 7: Commit**

```bash
git add public/benutzerhandbuch.html CLAUDE.md FEATURE_ANALYSE.md
git commit -m "docs: document invoice locking, credit notes and customer archive

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Gesamtprüfung

**Files:** keine neuen.

- [ ] **Step 1: Lint, Typen, Tests, Build**

Run: `npm run lint` → Expected: 0 Fehler.
Run: `npx tsc --noEmit` → Expected: keine Fehler.
Run: `npm test` → Expected: alle Tests grün (Unit + Integration).
Run: `npm run build` → Expected: erfolgreicher Production-Build.

Scheitert etwas, Ursache beheben (nicht Tests abschwächen) und den betroffenen Task-Commit bzw. einen Fix-Commit `fix: ...` anlegen.

- [ ] **Step 2: Spec-Abgleich**

Die Spec `docs/superpowers/specs/2026-09-30-f3-rechnungen-festschreiben-design.md` Abschnitt für Abschnitt gegen die Umsetzung prüfen: Festschreiben (Task 3), Statusübergänge (Task 2), Löschen und Kunden (Tasks 3, 4), Gutschrift (Tasks 6, 7, 8), Wirkung auf das Original (Tasks 5, 7), Audit (Tasks 4, 6, 7), Tests (jeweils im Task), Handbuch (Task 9). Lücken als weiteren Task nachtragen und umsetzen.

- [ ] **Step 3: Übergabe**

Zusammenfassung für den Nutzer: was gebaut ist, welche Tests laufen, dass Rückzahlungen bewusst fehlen, dass die Handbuch-Screenshots nicht neu erzeugt wurden. Danach `superpowers:finishing-a-development-branch` anbieten.
