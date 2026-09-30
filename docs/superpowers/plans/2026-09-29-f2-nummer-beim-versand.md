# F2 Nummer beim Versand – Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rechnungen und Offerten erhalten ihre Nummer erst beim ersten Versand (bzw. beim Statuswechsel aus „Entwurf“), nicht mehr beim Anlegen.

**Architecture:** `documentNumber` wird nullable. Eine zentrale, idempotente Funktion `assignDocumentNumber` in `lib/document-number.ts` vergibt die Nummer in einer eigenen Transaktion mit Kollisions-Retry. Alle Versand- und Statuswechselpfade rufen sie auf, bevor PDF oder Mail erzeugt werden. Die Anzeige läuft über eine kleine Hilfe `documentLabel`, die für `null` „Entwurf“ liefert.

**Tech Stack:** Next.js 16 (Server Actions), Prisma 7 + SQLite (better-sqlite3 adapter), Vitest, pdfkit.

**Spec:** `docs/superpowers/specs/2026-09-29-f2-nummer-beim-versand-design.md`

## Global Constraints

- UI-Texte deutsch, Commit-Messages englisch nach Conventional Commits, jede Commit-Message endet mit `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Anzeigewert für Dokumente ohne Nummer: exakt `Entwurf`.
- Platzhalter in Mails: exakt `{documentNumber}`.
- Bestehende Nummern bleiben unverändert, keine Datenmigration.
- PDF-GET-Routen haben keine Seiteneffekte (keine Nummernvergabe).
- Jede Task endet mit grünem `npx vitest run`, `npx tsc --noEmit` und `npm run lint`.
- Line endings: bestehende Dateien sind CRLF oder LF gemischt; beim Editieren die vorhandene Konvention der Datei beibehalten.

## Abweichung von der Spec (wird in Task 3 in der Spec nachgeführt)

Die Spec nennt `assignDocumentNumber(tx, kind, id)`. Weil ein Retry nach Kollision eine *neue* Transaktion braucht, öffnet die Funktion ihre Transaktion selbst: `assignDocumentNumber(kind, id, options?)`. Zusätzlich aus der Codeanalyse ergänzt: der PDF-Cache-Key enthält die Nummer (sonst liefert der Cache nach der Vergabe das alte Entwurfs-PDF), und Entwürfe ohne Nummer bekommen keinen QR-Zahlteil (niemand soll einen Entwurf bezahlen).

## File Structure

| Datei | Verantwortung |
|---|---|
| `lib/document-display.ts` (neu) | `DRAFT_LABEL`, `documentLabel()`, `fillDocumentNumber()` – reine Funktionen |
| `lib/document-number.ts` | Nummernberechnung, `isDocumentNumberCollision` (verschoben), `assignDocumentNumber` (neu) |
| `lib/document-actions.ts` | Anlegen ohne Nummer, `sendDocument` vergibt Nummer |
| `app/(app)/invoices/pending/actions.ts` | Pending-Mail vergibt Nummer, ersetzt Platzhalter |
| `lib/yearly-invoices.ts` | Entwurf ohne Nummer, `{documentNumber}` bleibt roh |
| `app/(app)/invoices/actions.ts`, `app/(app)/quotes/actions.ts` | Statuswechsel vergibt Nummer, Konvertierung ohne Nummer |
| `lib/pdf/*`, `app/api/*/pdf/route.ts` | Entwurfsvorschau mit Wasserzeichen, Cache-Key mit Nummer |
| `prisma/schema.prisma` + neue Migration | Spalte nullable |
| Anzeige-Dateien (Listen, Detail, Suche, Export) | `documentLabel()` statt Rohwert |

---

### Task 1: Anzeigehilfen `documentLabel` und `fillDocumentNumber`

**Files:**
- Create: `lib/document-display.ts`
- Test: `tests/unit/document-display.test.ts`

**Interfaces:**
- Produces:
  - `export const DRAFT_LABEL = "Entwurf";`
  - `export function documentLabel(documentNumber: string | null | undefined): string`
  - `export function fillDocumentNumber(text: string, documentNumber: string): string` – ersetzt alle `{documentNumber}`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/document-display.test.ts
import { describe, it, expect } from "vitest";
import { DRAFT_LABEL, documentLabel, fillDocumentNumber } from "@/lib/document-display";

describe("documentLabel", () => {
  it("returns the number when set", () => {
    expect(documentLabel("R-26090001")).toBe("R-26090001");
  });

  it.each([[null], [undefined], [""]])("returns 'Entwurf' for %s", (value) => {
    expect(documentLabel(value)).toBe(DRAFT_LABEL);
    expect(DRAFT_LABEL).toBe("Entwurf");
  });
});

describe("fillDocumentNumber", () => {
  it("replaces every placeholder occurrence", () => {
    expect(
      fillDocumentNumber("Rechnung {documentNumber} / Ref {documentNumber}", "R-26090001")
    ).toBe("Rechnung R-26090001 / Ref R-26090001");
  });

  it("leaves text without placeholder unchanged", () => {
    expect(fillDocumentNumber("Guten Tag", "R-1")).toBe("Guten Tag");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/document-display.test.ts`
Expected: FAIL, `Cannot find package '@/lib/document-display'`

- [ ] **Step 3: Write minimal implementation**

```ts
// lib/document-display.ts
export const DRAFT_LABEL = "Entwurf";

/** Display value for a document number; drafts have none until they are sent. */
export function documentLabel(documentNumber: string | null | undefined): string {
  return documentNumber || DRAFT_LABEL;
}

/** Replaces the {documentNumber} placeholder once the number is known (at send time). */
export function fillDocumentNumber(text: string, documentNumber: string): string {
  return text.replace(/\{documentNumber\}/g, documentNumber);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/document-display.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/document-display.ts tests/unit/document-display.test.ts
git commit -m "feat(documents): add draft label and number placeholder helpers"
```

---

### Task 2: `documentNumber` nullable (Schema, Migration, alle Konsumenten)

Verhalten ändert sich in dieser Task **nicht**: beim Anlegen wird weiterhin eine Nummer vergeben. Die Task macht nur den Typ nullable und alle Stellen `null`-sicher. `tsc` zeigt jede betroffene Stelle.

**Files:**
- Modify: `prisma/schema.prisma` (Invoice Zeile ~33, Quote Zeile ~88)
- Create: `prisma/migrations/<timestamp>_nullable_document_number/migration.sql` (generiert)
- Create: `tests/integration/nullable-document-number.test.ts`
- Modify (null-sicher machen, Liste aus `npx tsc --noEmit`; erwartet):
  - `lib/document-number.ts` (`generateNumber`: `inv.documentNumber?.slice(-4) ?? ""`)
  - `lib/email.ts` (Zeilen 35, 70, 90, 154)
  - `lib/pdf/invoice-pdf.ts`, `lib/pdf/qrbill-helpers.ts`, `lib/pdf/document-pdf.ts`
  - `lib/search.ts`, `lib/payment-matching.ts`, `lib/import/matching.ts`
  - `app/(app)/invoices/import/actions.ts`, `app/(app)/invoices/actions.ts`, `app/(app)/quotes/actions.ts`
  - `app/api/export/{accounting,invoices,quotes}/route.ts`, `app/api/{invoices,quotes}/[id]/pdf/route.ts`
  - alle `.tsx` aus `grep -rn "documentNumber" app components --include=*.tsx`
  - `lib/audit.ts` bleibt unverändert (`entityRef?: string` → Aufrufer übergeben `documentNumber ?? undefined`)

**Interfaces:**
- Consumes: `documentLabel`, `DRAFT_LABEL` aus Task 1
- Produces: Prisma-Typen `Invoice.documentNumber: string | null`, `Quote.documentNumber: string | null`

- [ ] **Step 1: Write the failing test**

```ts
// tests/integration/nullable-document-number.test.ts
import { describe, it, expect } from "vitest";
import { createTestDatabase, createValidTestCustomer } from "../test-utils";

describe("documents without a number", () => {
  const db = createTestDatabase();

  it("allows several invoice drafts without a documentNumber", async () => {
    const customer = await db.prisma.customer.create({ data: createValidTestCustomer() });
    const base = {
      customerId: customer.customerId,
      date: new Date(),
      dueDate: new Date(),
      totalAmount: 100,
      state: "Draft" as const,
    };
    await db.prisma.invoice.create({ data: base });
    await db.prisma.invoice.create({ data: base });

    const drafts = await db.prisma.invoice.findMany({ where: { documentNumber: null } });
    expect(drafts).toHaveLength(2);
  });

  it("allows several quote drafts without a documentNumber", async () => {
    const customer = await db.prisma.customer.create({ data: createValidTestCustomer() });
    const base = {
      customerId: customer.customerId,
      date: new Date(),
      validUntil: new Date(),
      totalAmount: 100,
      state: "Draft" as const,
    };
    await db.prisma.quote.create({ data: base });
    await db.prisma.quote.create({ data: base });

    const drafts = await db.prisma.quote.findMany({ where: { documentNumber: null } });
    expect(drafts).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/integration/nullable-document-number.test.ts`
Expected: FAIL (Prisma validation: `Argument documentNumber is missing` bzw. `NOT NULL constraint failed`)

- [ ] **Step 3: Schema ändern und Migration generieren**

In `prisma/schema.prisma` bei `model Invoice` und `model Quote`:

```prisma
  documentNumber String?
```

`@@unique([documentNumber])` bleibt stehen.

Migration nur erzeugen, nicht gegen eine fremde DB anwenden:

```bash
npx prisma migrate dev --create-only --name nullable_document_number
npx prisma migrate dev
```

Prüfen: Die generierte `migration.sql` baut `Invoice` und `Quote` per `CREATE TABLE "new_…"` / `INSERT INTO "new_…" SELECT …` / `DROP TABLE` / `ALTER TABLE … RENAME` neu auf, beginnt mit `PRAGMA defer_foreign_keys=ON; PRAGMA foreign_keys=OFF;`, endet mit `PRAGMA foreign_keys=ON; PRAGMA defer_foreign_keys=OFF;` und legt `Invoice_documentNumber_key`, `Quote_documentNumber_key` sowie alle bisherigen Indizes neu an. Enthält sie ein `DELETE` oder `UPDATE` auf Daten: abbrechen und melden.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/integration/nullable-document-number.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Konsumenten null-sicher machen**

Run: `npx tsc --noEmit` und jede Meldung nach diesen Regeln beheben:

- **Anzeige** (JSX, Breadcrumbs, Toasts, CSV-Spalten, PDF-Titel): `documentLabel(x.documentNumber)` aus `@/lib/document-display`. Props-Typen wie `documentNumber: string` in `PendingEmailRow.tsx`, `ReminderRow.tsx`, `SendInvoiceButton.tsx`, `SendQuoteButton.tsx` werden `string | null`; innen `documentLabel(...)`.
- **Audit-Aufrufe:** `logAudit(..., x.documentNumber ?? undefined, ...)`.
- **E-Mail-Versand** (`lib/email.ts`, `sendInvoiceEmail`, `sendQuoteEmail`): am Funktionsanfang
  ```ts
  if (!invoice.documentNumber) throw new Error("Rechnung hat noch keine Nummer.");
  ```
  bzw. `"Offerte hat noch keine Nummer."`; danach ist der Typ `string`.
- **QR** (`lib/pdf/qrbill-helpers.ts`): `QrBillInput.invoice.documentNumber: string | null`, `message: invoice.documentNumber ?? undefined`.
- **PDF** (`lib/pdf/invoice-pdf.ts`): `documentNumber: documentLabel(invoice.documentNumber)` (Task 7 ersetzt das durch echte Entwurfsbehandlung).
- **PDF-Routen:** Dateiname `rechnung-${invoice.documentNumber ?? `entwurf-${invoice.id}`}.pdf` (analog `offerte-…`).
- **Bankimport** (`app/(app)/invoices/import/actions.ts`): vor `matchStatementToInvoices`
  ```ts
  openInvoices
    .filter((invoice): invoice is typeof invoice & { documentNumber: string } => invoice.documentNumber !== null)
    .map(...)
  ```
- **`markInvoicePaid`/`lib/payment-matching.ts`:** Parametertyp `documentNumber: string | null`, Audit mit `?? undefined`.
- **Suche** (`lib/search.ts`): Result-Typ `documentNumber: string | null`; Anzeige in `app/(app)/search/page.tsx` und `components/global-search-dropdown.tsx` über `documentLabel`.
- **Mail-Vorbefüllung** auf `app/(app)/invoices/[id]/page.tsx` (Zeilen ~75–80) und `app/(app)/quotes/[id]/page.tsx` (~64–65): statt `invoice.documentNumber` den Wert `invoice.documentNumber ?? "{documentNumber}"` einsetzen. So bleibt der Platzhalter für Entwürfe im Dialog stehen und wird beim Versand ersetzt (Task 4).
- **Reminder-Seite** (`app/(app)/invoices/reminders/page.tsx`): `documentLabel(inv.documentNumber)`.

Weiter bis `npx tsc --noEmit` leer ist.

- [ ] **Step 6: Volle Prüfung**

Run: `npx vitest run; npx tsc --noEmit; npm run lint`
Expected: alle Tests grün, keine tsc-Fehler, keine Lint-Fehler. Schlagen bestehende Tests fehl, weil sie `documentNumber` als `string` erwarten: Testdaten anpassen, nicht die Logik.

- [ ] **Step 7: Commit**

```bash
git add prisma tests/integration/nullable-document-number.test.ts lib app components tests
git commit -m "refactor(documents): make documentNumber nullable"
```

---

### Task 3: `assignDocumentNumber`

**Files:**
- Modify: `lib/document-number.ts`
- Modify: `lib/document-actions.ts` (`isDocumentNumberCollision` wird re-exportiert)
- Modify: `docs/superpowers/specs/2026-09-29-f2-nummer-beim-versand-design.md` (Signatur, Cache-Key, QR – siehe „Abweichung“ oben)
- Test: `tests/integration/assign-document-number.test.ts`

**Interfaces:**
- Consumes: `generateInvoiceNumber(db)`, `generateQuoteNumber(db)` (bestehend)
- Produces:
  ```ts
  export type DocumentKind = "invoice" | "quote";
  export function isDocumentNumberCollision(err: unknown): boolean; // verschoben aus document-actions
  export async function assignDocumentNumber(
    kind: DocumentKind,
    id: number,
    options?: { actor?: Session; client?: PrismaClient }
  ): Promise<string>;
  ```
  Verhalten: gibt eine bestehende Nummer unverändert zurück; sonst Vergabe in eigener Transaktion, `updateMany where { id, documentNumber: null }` (verliert ein paralleler Aufruf, wird die Gewinner-Nummer gelesen und zurückgegeben), ein Retry bei `isDocumentNumberCollision`. Wirft `Error("Dokument nicht gefunden.")`, wenn die ID nicht existiert. Bei neuer Vergabe und gesetztem `actor`: `logAudit(actor, "UPDATE", "Invoice" | "Quote", id, number, { documentNumber: number }, client)`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/integration/assign-document-number.test.ts
import { describe, it, expect, vi } from "vitest";
import { createTestDatabase, createValidTestCustomer } from "../test-utils";
import { assignDocumentNumber } from "@/lib/document-number";

vi.mock("@/lib/logger", () => ({
  default: { child: () => ({ error: () => {}, info: () => {}, warn: () => {} }) },
}));

const actor = { user: { id: "1", name: "Editor", email: "e@test.ch", role: "Editor" } } as never;

describe("assignDocumentNumber", () => {
  const db = createTestDatabase();
  const yy = String(new Date().getFullYear()).slice(-2);
  const mm = String(new Date().getMonth() + 1).padStart(2, "0");

  async function draftInvoice(documentNumber: string | null = null) {
    const customer = await db.prisma.customer.create({ data: createValidTestCustomer() });
    return db.prisma.invoice.create({
      data: {
        customerId: customer.customerId,
        documentNumber,
        date: new Date(),
        dueDate: new Date(),
        totalAmount: 100,
        state: "Draft",
      },
    });
  }

  it("assigns the next number of the current month to an invoice draft", async () => {
    await db.prisma.applicationSettings.deleteMany();
    const invoice = await draftInvoice();

    const number = await assignDocumentNumber("invoice", invoice.id, { client: db.prisma });

    expect(number).toBe(`R-${yy}${mm}0001`);
    const stored = await db.prisma.invoice.findUnique({ where: { id: invoice.id } });
    expect(stored?.documentNumber).toBe(number);
  });

  it("is idempotent: a second call returns the same number", async () => {
    const invoice = await draftInvoice();
    const first = await assignDocumentNumber("invoice", invoice.id, { client: db.prisma });
    const second = await assignDocumentNumber("invoice", invoice.id, { client: db.prisma });
    expect(second).toBe(first);
  });

  it("keeps an existing (legacy) number", async () => {
    const invoice = await draftInvoice("R-25010007");
    expect(await assignDocumentNumber("invoice", invoice.id, { client: db.prisma })).toBe("R-25010007");
  });

  it("does not leave a gap when an unnumbered draft is deleted", async () => {
    const deleted = await draftInvoice();
    const kept = await draftInvoice();
    await db.prisma.invoice.delete({ where: { id: deleted.id } });

    expect(await assignDocumentNumber("invoice", kept.id, { client: db.prisma })).toBe(`R-${yy}${mm}0001`);
  });

  it("numbers sequentially across concurrent calls", async () => {
    const a = await draftInvoice();
    const b = await draftInvoice();
    const numbers = await Promise.all([
      assignDocumentNumber("invoice", a.id, { client: db.prisma }),
      assignDocumentNumber("invoice", b.id, { client: db.prisma }),
    ]);
    expect(new Set(numbers).size).toBe(2);
  });

  it("assigns quote numbers with the quote prefix", async () => {
    const customer = await db.prisma.customer.create({ data: createValidTestCustomer() });
    const quote = await db.prisma.quote.create({
      data: {
        customerId: customer.customerId,
        date: new Date(),
        validUntil: new Date(),
        totalAmount: 100,
        state: "Draft",
      },
    });
    expect(await assignDocumentNumber("quote", quote.id, { client: db.prisma })).toBe(`O-${yy}${mm}0001`);
  });

  it("writes an UPDATE audit entry only when a number is newly assigned", async () => {
    const invoice = await draftInvoice();
    await assignDocumentNumber("invoice", invoice.id, { client: db.prisma, actor });
    await assignDocumentNumber("invoice", invoice.id, { client: db.prisma, actor });

    const entries = await db.prisma.auditLog.findMany();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ action: "UPDATE", entityType: "Invoice", entityId: invoice.id });
  });

  it("throws for an unknown id", async () => {
    await expect(assignDocumentNumber("invoice", 999_999, { client: db.prisma })).rejects.toThrow(
      "Dokument nicht gefunden."
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/integration/assign-document-number.test.ts`
Expected: FAIL, `assignDocumentNumber is not a function` / not exported

- [ ] **Step 3: Write minimal implementation**

In `lib/document-number.ts` ergänzen (Imports oben zusammenführen):

```ts
import { Prisma, type PrismaClient } from "@prisma/client";
import type { Session } from "next-auth";
import { logAudit } from "@/lib/audit";

export type DocumentKind = "invoice" | "quote";

export function isDocumentNumberCollision(err: unknown): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError &&
    err.code === "P2002" &&
    ((err.meta?.target as string[] | undefined)?.includes("documentNumber") ?? false)
  );
}

/**
 * Gives a draft its final number, at the moment it first leaves the house
 * (send, pending-mail approval, manual status change). Idempotent: an
 * already numbered document keeps its number. Runs its own transaction so a
 * number collision can be retried in a fresh one.
 */
export async function assignDocumentNumber(
  kind: DocumentKind,
  id: number,
  options: { actor?: Session; client?: PrismaClient } = {}
): Promise<string> {
  const client = options.client ?? prisma;

  const attempt = () =>
    client.$transaction(async (tx) => {
      const current =
        kind === "invoice"
          ? await tx.invoice.findUnique({ where: { id }, select: { documentNumber: true } })
          : await tx.quote.findUnique({ where: { id }, select: { documentNumber: true } });
      if (!current) throw new Error("Dokument nicht gefunden.");
      if (current.documentNumber) return { documentNumber: current.documentNumber, assigned: false };

      const documentNumber =
        kind === "invoice" ? await generateInvoiceNumber(tx) : await generateQuoteNumber(tx);
      const where = { id, documentNumber: null };
      const { count } =
        kind === "invoice"
          ? await tx.invoice.updateMany({ where, data: { documentNumber } })
          : await tx.quote.updateMany({ where, data: { documentNumber } });

      if (count === 0) {
        // A concurrent call numbered it first; return the winner's number.
        const winner =
          kind === "invoice"
            ? await tx.invoice.findUnique({ where: { id }, select: { documentNumber: true } })
            : await tx.quote.findUnique({ where: { id }, select: { documentNumber: true } });
        return { documentNumber: winner!.documentNumber!, assigned: false };
      }
      return { documentNumber, assigned: true };
    });

  let result;
  try {
    result = await attempt();
  } catch (err) {
    if (!isDocumentNumberCollision(err)) throw err;
    result = await attempt();
  }

  if (result.assigned && options.actor) {
    await logAudit(
      options.actor,
      "UPDATE",
      kind === "invoice" ? "Invoice" : "Quote",
      id,
      result.documentNumber,
      { documentNumber: result.documentNumber },
      client
    );
  }
  return result.documentNumber;
}
```

In `lib/document-actions.ts`: die lokale Funktion `isDocumentNumberCollision` löschen und ersetzen durch

```ts
import { generateInvoiceNumber, generateQuoteNumber, isDocumentNumberCollision } from "@/lib/document-number";
export { isDocumentNumberCollision };
```

(`type DocumentKind` dort durch `import type { DocumentKind } from "@/lib/document-number"` ersetzen.)

Falls `lib/audit.ts` einen Zirkelimport erzeugt (audit → prisma, document-number → audit: kein Zyklus erwartet), mit `npx tsc --noEmit` und dem Test prüfen.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/integration/assign-document-number.test.ts tests/unit/document-number.test.ts tests/unit/document-actions.test.ts`
Expected: PASS. `tests/unit/document-number.test.ts` mockt `@/lib/prisma` ohne `$transaction`; falls der Import von `@/lib/audit` dort stört, `vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }))` ergänzen.

- [ ] **Step 5: Spec nachführen**

In der Spec den Abschnitt „Kern“ auf die Signatur `assignDocumentNumber(kind, id, { actor?, client? })` ändern und unter „Anzeige und Konsumenten“ ergänzen:
- „PDF-Cache-Key enthält die Nummer (`n<Nummer>` bzw. `ndraft`).“
- „Entwürfe ohne Nummer erhalten keinen QR-Zahlteil.“

- [ ] **Step 6: Commit**

```bash
git add lib/document-number.ts lib/document-actions.ts tests/integration/assign-document-number.test.ts tests/unit docs/superpowers/specs
git commit -m "feat(documents): add idempotent assignDocumentNumber"
```

---

### Task 4: `sendDocument` vergibt die Nummer vor PDF und Mail

**Files:**
- Modify: `lib/document-actions.ts` (`sendDocument`)
- Test: `tests/unit/document-actions.test.ts`

**Interfaces:**
- Consumes: `assignDocumentNumber` (Task 3), `fillDocumentNumber` (Task 1)
- Produces: unverändertes `sendDocument(input: SendDocumentInput): Promise<SendDocumentResult>`

- [ ] **Step 1: Write the failing test**

In `tests/unit/document-actions.test.ts` den Mock von `@/lib/document-number` erweitern:

```ts
vi.mock("@/lib/document-number", async () => {
  const actual = await vi.importActual<typeof import("@/lib/document-number")>("@/lib/document-number");
  return {
    isDocumentNumberCollision: actual.isDocumentNumberCollision,
    generateInvoiceNumber: vi.fn(),
    generateQuoteNumber: vi.fn(),
    assignDocumentNumber: vi.fn(),
  };
});
```

`assignDocumentNumber` zum Import aus `@/lib/document-number` hinzufügen. Im `describe("sendDocument")` ergänzen:

```ts
  it("assigns the number before rendering and fills the placeholder", async () => {
    vi.mocked(prisma.applicationSettings.findFirst).mockResolvedValue({ companyInfo: {} } as never);
    vi.mocked(prisma.invoice.findUnique).mockResolvedValue({
      id: 1,
      documentNumber: null,
      customer: {},
      items: [],
    } as never);
    vi.mocked(assignDocumentNumber).mockResolvedValue("R-26090001");
    vi.mocked(generateInvoicePdf).mockResolvedValue(Buffer.from("pdf"));
    vi.mocked(sendInvoiceEmail).mockResolvedValue(undefined);

    const result = await sendDocument({
      kind: "invoice",
      id: 1,
      to: "a@b.ch",
      subject: "Rechnung {documentNumber}",
      body: "Nr. {documentNumber}",
      actor,
    });

    expect(result.success).toBe(true);
    expect(assignDocumentNumber).toHaveBeenCalledWith("invoice", 1, { actor });
    expect(vi.mocked(assignDocumentNumber).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(generateInvoicePdf).mock.invocationCallOrder[0]
    );
    expect(vi.mocked(generateInvoicePdf).mock.calls[0][0]).toMatchObject({ documentNumber: "R-26090001" });
    expect(sendInvoiceEmail).toHaveBeenCalledWith(
      expect.objectContaining({ documentNumber: "R-26090001" }),
      expect.anything(),
      expect.anything(),
      { to: "a@b.ch", subject: "Rechnung R-26090001", body: "Nr. R-26090001" }
    );
    expect(prisma.invoiceSentLog.create).toHaveBeenCalledWith({
      data: { invoiceId: 1, sentTo: "a@b.ch", subject: "Rechnung R-26090001" },
    });
  });

  it("keeps the assigned number when the mail fails", async () => {
    vi.mocked(prisma.applicationSettings.findFirst).mockResolvedValue({ companyInfo: {} } as never);
    vi.mocked(prisma.quote.findUnique).mockResolvedValue({
      id: 2,
      documentNumber: null,
      customer: {},
      items: [],
    } as never);
    vi.mocked(assignDocumentNumber).mockResolvedValue("O-26090001");
    vi.mocked(generateQuotePdf).mockResolvedValue(Buffer.from("pdf"));
    vi.mocked(sendQuoteEmail).mockRejectedValue(new Error("SMTP down"));

    const result = await sendDocument({ kind: "quote", id: 2, to: "a@b.ch", subject: "s", body: "b", actor });

    expect(result.error).toBe("SMTP down");
    expect(assignDocumentNumber).toHaveBeenCalledWith("quote", 2, { actor });
    expect(prisma.quote.update).not.toHaveBeenCalled();
  });
```

In den zwei bestehenden sendDocument-Tests zusätzlich `vi.mocked(assignDocumentNumber).mockResolvedValue("I-2026-001")` bzw. `"Q-2026-001"` setzen.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/document-actions.test.ts`
Expected: FAIL, `expected "assignDocumentNumber" to be called`

- [ ] **Step 3: Write minimal implementation**

In `sendDocument`, Rechnungszweig, direkt nach `if (!invoice) return …`:

```ts
    let documentNumber: string;
    try {
      documentNumber = await assignDocumentNumber("invoice", input.id, { actor: input.actor });
    } catch (err) {
      log.error({ invoiceId: input.id, err }, "sendDocument (invoice): number assignment failed");
      return { error: "Rechnungsnummer konnte nicht vergeben werden." };
    }
    const numbered = { ...invoice, documentNumber };
    const subject = fillDocumentNumber(input.subject, documentNumber);
    const body = fillDocumentNumber(input.body, documentNumber);
```

Danach im Rechnungszweig `invoice` → `numbered`, `input.subject` → `subject`, `input.body` → `body` (in `generateInvoicePdf`, `sendInvoiceEmail`, `invoiceSentLog.create`, `logAudit(..., documentNumber, ...)`). Offertenzweig identisch mit `"quote"`, `"Offertennummer konnte nicht vergeben werden."`, `quoteSentLog`. Imports: `assignDocumentNumber` aus `@/lib/document-number`, `fillDocumentNumber` aus `@/lib/document-display`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/document-actions.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/document-actions.ts tests/unit/document-actions.test.ts
git commit -m "feat(documents): assign document number when sending"
```

---

### Task 5: Pending-Mail und Jahresrechnung

**Files:**
- Modify: `app/(app)/invoices/pending/actions.ts` (`approvePendingEmail`)
- Modify: `lib/yearly-invoices.ts`
- Test: `tests/unit/invoice-sub-actions.test.ts`, `tests/integration/yearly-invoices.test.ts`

**Interfaces:**
- Consumes: `assignDocumentNumber`, `fillDocumentNumber`
- Produces: `checkYearlyInvoices(prisma)` erzeugt Entwürfe mit `documentNumber: null` und `PendingEmail.subject/body` mit rohem `{documentNumber}`

- [ ] **Step 1: Write the failing tests**

`tests/unit/invoice-sub-actions.test.ts`: oben ergänzen

```ts
vi.mock("@/lib/document-number", () => ({ assignDocumentNumber: vi.fn() }));
// …
import { assignDocumentNumber } from "@/lib/document-number";
```

Im `describe("approvePendingEmail")` neuen Test:

```ts
    it("assigns the number before rendering and fills placeholders", async () => {
      vi.mocked(auth).mockResolvedValue(editorSession);
      vi.mocked(prisma.pendingEmail.findUnique).mockResolvedValue({
        id: 1,
        invoiceId: 10,
        invoice: { ...mockInvoice, documentNumber: null },
      } as never);
      vi.mocked(prisma.applicationSettings.findFirst).mockResolvedValue(mockSettings as never);
      vi.mocked(assignDocumentNumber).mockResolvedValue("R-26090001");
      vi.mocked(generateInvoicePdf).mockResolvedValue(Buffer.from("pdf") as never);
      vi.mocked(sendInvoiceEmail).mockResolvedValue(undefined);
      vi.mocked(prisma.$transaction).mockImplementation((arg: ((tx: typeof prisma) => Promise<unknown>) | Promise<unknown>[]) =>
        Array.isArray(arg) ? Promise.all(arg) as never : arg(prisma) as never
      );

      await approvePendingEmail(
        {},
        form({ id: "1", to: "k@test.ch", subject: "Rechnung {documentNumber}", body: "Nr. {documentNumber}" })
      );

      expect(assignDocumentNumber).toHaveBeenCalledWith("invoice", 10, { actor: editorSession });
      expect(vi.mocked(generateInvoicePdf).mock.calls[0][0]).toMatchObject({ documentNumber: "R-26090001" });
      expect(sendInvoiceEmail).toHaveBeenCalledWith(
        expect.objectContaining({ documentNumber: "R-26090001" }),
        expect.anything(),
        expect.anything(),
        { to: "k@test.ch", subject: "Rechnung R-26090001", body: "Nr. R-26090001" }
      );
    });
```

In den bestehenden approvePendingEmail-Tests, die bis zum Versand kommen, `vi.mocked(assignDocumentNumber).mockResolvedValue("R-2026-010")` setzen.

`tests/integration/yearly-invoices.test.ts`, im Test „creates an invoice and pending email for a due customer“ ergänzen:

```ts
    expect(invoices[0].documentNumber).toBeNull();
    expect(pending[0].subject).toContain("{documentNumber}");
    expect(pending[0].body).toContain("{documentNumber}");
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/invoice-sub-actions.test.ts tests/integration/yearly-invoices.test.ts`
Expected: FAIL (assign nicht aufgerufen; `documentNumber` ist gesetzt; Platzhalter ersetzt)

- [ ] **Step 3: Implement**

`approvePendingEmail`, nach der Settings-Prüfung und vor dem `try`:

```ts
  let documentNumber: string;
  try {
    documentNumber = await assignDocumentNumber("invoice", pending.invoiceId, { actor: session });
  } catch (err) {
    log.error({ pendingId: id, err }, "approvePendingEmail: number assignment failed");
    return { error: "Rechnungsnummer konnte nicht vergeben werden." };
  }
  const invoice = { ...pending.invoice, documentNumber };
  const finalSubject = fillDocumentNumber(subject, documentNumber);
  const finalBody = fillDocumentNumber(body, documentNumber);
```

Danach `pending.invoice` → `invoice`, `subject`/`body` → `finalSubject`/`finalBody` in PDF, Mail, `invoiceSentLog.create` und `logAudit(…, documentNumber, { to, subject: finalSubject })`.

`lib/yearly-invoices.ts`: Import `generateInvoiceNumber` entfernen, `const documentNumber = await generateInvoiceNumber(tx);` löschen, `documentNumber` aus `invoice.create` entfernen und in `vars` den Eintrag ersetzen durch

```ts
        // Kept as placeholder: the number is only assigned when the mail is approved.
        documentNumber: "{documentNumber}",
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/invoice-sub-actions.test.ts tests/integration/yearly-invoices.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add "app/(app)/invoices/pending/actions.ts" lib/yearly-invoices.ts tests/unit/invoice-sub-actions.test.ts tests/integration/yearly-invoices.test.ts
git commit -m "feat(invoices): number yearly invoices when the pending mail is approved"
```

---

### Task 6: Statuswechsel vergibt Nummer, Anlegen und Konvertieren ohne Nummer

Regeln:
- Rechnung: Wechsel aus `Draft` nach `Sent`, `Overdue` oder `Paid` vergibt die Nummer. `Draft → Canceled` nicht.
- Offerte: Wechsel aus `Draft` nach `Sent` oder `Accepted` vergibt die Nummer.
- `createDocumentWithItems` und `convertQuoteToInvoice` legen Entwürfe ohne Nummer an.

**Files:**
- Modify: `app/(app)/invoices/actions.ts` (`updateInvoiceStatus`, `createInvoice` Audit)
- Modify: `app/(app)/quotes/actions.ts` (`updateQuoteStatus`, `convertQuoteToInvoice`, `createQuote` Audit)
- Modify: `lib/document-actions.ts` (`createDocumentWithItems`)
- Test: `tests/unit/document-actions.test.ts`, `tests/integration/state-transitions.test.ts` oder `tests/unit/invoice-paid-date.test.ts`/`tests/unit/quote-actions.test.ts` (jeweils dort, wo `updateInvoiceStatus` bzw. `updateQuoteStatus` heute getestet wird: `grep -rln "updateInvoiceStatus\|updateQuoteStatus" tests`), `tests/integration/convert-quote.test.ts`

**Interfaces:**
- Consumes: `assignDocumentNumber`
- Produces: `createDocumentWithItems(input): Promise<{ id: number; documentNumber: null }>`

- [ ] **Step 1: Write the failing tests**

`tests/unit/document-actions.test.ts`, `describe("createDocumentWithItems")`: die drei Kollisions-Retry-Tests löschen (die Retry-Logik lebt jetzt in `assignDocumentNumber`, Task 3) und ersetzen durch

```ts
  it("creates an invoice draft without a number", async () => {
    vi.mocked(prisma.invoice.create).mockResolvedValue({ id: 7 } as never);
    const result = await createDocumentWithItems({
      kind: "invoice",
      customerId: 1,
      customUserText: null,
      date: new Date(),
      dueDate: new Date(),
      totalAmount: 0,
      discountPercent: 0,
      items: [],
    });
    expect(result).toEqual({ id: 7, documentNumber: null });
    expect(generateInvoiceNumber).not.toHaveBeenCalled();
    expect(vi.mocked(prisma.invoice.create).mock.calls[0][0].data).not.toHaveProperty("documentNumber");
  });
```

Den Test „does not retry on a non-collision error“ behalten, aber so anpassen, dass `prisma.invoice.create` wirft und `$transaction` genau einmal aufgerufen wird.

Für `updateInvoiceStatus` (in der Datei, die ihn heute testet; dort `@/lib/document-number` mit `assignDocumentNumber: vi.fn()` mocken):

```ts
  it("assigns a number when a draft leaves Draft", async () => {
    vi.mocked(auth).mockResolvedValue(editorSession);
    vi.mocked(prisma.invoice.findUnique).mockResolvedValue({ state: "Draft", documentNumber: null } as never);
    vi.mocked(assignDocumentNumber).mockResolvedValue("R-26090001");
    await updateInvoiceStatus(10, "Sent");
    expect(assignDocumentNumber).toHaveBeenCalledWith("invoice", 10, { actor: editorSession });
  });

  it("does not assign a number when a draft is canceled", async () => {
    vi.mocked(auth).mockResolvedValue(editorSession);
    vi.mocked(prisma.invoice.findUnique).mockResolvedValue({ state: "Draft", documentNumber: null } as never);
    await updateInvoiceStatus(10, "Canceled");
    expect(assignDocumentNumber).not.toHaveBeenCalled();
  });
```

Für `updateQuoteStatus` analog (`"quote"`, `Draft → Sent` vergibt, `Draft → Declined` nicht; `prisma.quote.findUnique` mocken).

`tests/integration/convert-quote.test.ts`: im bestehenden Erfolgstest ergänzen

```ts
    expect(invoice.documentNumber).toBeNull();
```

(Variable an den dort geladenen Rechnungsnamen anpassen.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit tests/integration/convert-quote.test.ts`
Expected: FAIL in den neuen Tests

- [ ] **Step 3: Implement**

`lib/document-actions.ts`, `createDocumentWithItems`: Retry-Block, `let documentNumber`, `generateInvoiceNumber`/`generateQuoteNumber`-Aufrufe und `documentNumber` im `data` entfernen; Rückgabe `{ id, documentNumber: null }`, Rückgabetyp `Promise<{ id: number; documentNumber: null }>`. Nicht mehr genutzte Imports entfernen.

`app/(app)/invoices/actions.ts` `updateInvoiceStatus`, direkt nach `if (!current) return;`:

```ts
  const NUMBERED_STATES: InvoiceState[] = ["Sent", "Overdue", "Paid"];
  let documentNumber = current.documentNumber;
  if (current.state === "Draft" && NUMBERED_STATES.includes(state)) {
    documentNumber = await assignDocumentNumber("invoice", id, { actor: session });
  }
```

und im `logAudit` `documentNumber ?? undefined` statt `current.documentNumber` verwenden.

`app/(app)/quotes/actions.ts` `updateQuoteStatus`:

```ts
export async function updateQuoteStatus(id: number, state: QuoteState): Promise<void> {
  const session = await requireEditor();
  const current = await prisma.quote.findUnique({ where: { id }, select: { state: true } });
  if (!current) return;
  if (current.state === "Draft" && (state === "Sent" || state === "Accepted")) {
    await assignDocumentNumber("quote", id, { actor: session });
  }
  await prisma.quote.update({ where: { id }, data: { state } });
}
```

`convertQuoteToInvoice`: `generateInvoiceNumber`-Aufruf und `documentNumber` im `invoice.create` entfernen, Import entfernen.

`createInvoice`/`createQuote`: `logAudit(session, "CREATE", …, newId, documentNumber)` → `logAudit(session, "CREATE", …, newId)`; die Variable `documentNumber` entfällt.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run; npx tsc --noEmit; npm run lint`
Expected: alles grün. `tests/integration/document-number-race.test.ts` testet `generateInvoiceNumber` direkt und muss unverändert grün bleiben.

- [ ] **Step 5: Commit**

```bash
git add lib/document-actions.ts "app/(app)/invoices/actions.ts" "app/(app)/quotes/actions.ts" tests
git commit -m "feat(documents): create drafts without number and assign on status change"
```

---

### Task 7: PDF-Vorschau „ENTWURF“ und Cache-Key

**Files:**
- Modify: `lib/pdf/document-pdf.ts` (`RenderDoc`, Wasserzeichen)
- Modify: `lib/pdf/invoice-pdf.ts`
- Modify: `app/api/invoices/[id]/pdf/route.ts`, `app/api/quotes/[id]/pdf/route.ts`
- Test: `tests/unit/document-pdf-generation.test.ts`, `tests/unit/invoice-pdf-route.test.ts`

**Interfaces:**
- Consumes: `documentLabel`, `DRAFT_LABEL`
- Produces: `RenderDoc.draft: boolean` (neues Pflichtfeld; `app/api/settings/pdf-preview/route.ts` setzt `draft: false`)

- [ ] **Step 1: Write the failing tests**

`tests/unit/document-pdf-generation.test.ts` – dort gibt es bereits einen Aufbau für `generateInvoicePdf` mit Testdaten. Neue Tests mit denselben Fixtures (Name der dortigen Fixture-Funktion verwenden, z. B. `makeInvoice()`):

```ts
  it("renders a draft without number and without QR slip", async () => {
    const pdf = await generateInvoicePdf({ ...makeInvoice(), documentNumber: null }, makeSettings());
    const text = pdf.toString("latin1");
    expect(text).toContain("(Rechnung Entwurf)"); // PDF Title metadata
    expect(buildQrBillDataSpy).not.toHaveBeenCalled();
  });
```

Wenn die Datei keinen Spy auf `buildQrBillData` hat: stattdessen `vi.spyOn(qrHelpers, "buildQrBillData")` mit `import * as qrHelpers from "@/lib/pdf/qrbill-helpers"` anlegen. Wenn die PDF-Metadaten komprimiert sind und der Titel nicht als Klartext erscheint, den Test auf `generateDocumentPdf` umstellen: `vi.spyOn(documentPdf, "generateDocumentPdf")` und prüfen, dass das übergebene `RenderDoc` `{ draft: true, documentNumber: "Entwurf", qr: null }` enthält.

`tests/unit/invoice-pdf-route.test.ts`:

```ts
  it("uses a draft file name and a cache key without number for drafts", async () => {
    // Setup wie in den bestehenden Tests, mit invoice.documentNumber = null, id = 5, version = 1
    const res = await GET(req, { params: Promise.resolve({ id: "5" }) });
    expect(res.headers.get("Content-Disposition")).toContain('filename="entwurf-5.pdf"');
    expect(readCache).toHaveBeenCalledWith(expect.stringContaining("-ndraft-"));
  });

  it("includes the number in the cache key once assigned", async () => {
    // Setup mit documentNumber = "R-26090001"
    const res = await GET(req, { params: Promise.resolve({ id: "5" }) });
    expect(res.headers.get("Content-Disposition")).toContain('filename="rechnung-R-26090001.pdf"');
    expect(readCache).toHaveBeenCalledWith(expect.stringContaining("-nR-26090001-"));
  });
```

(Setup-Zeilen aus den bestehenden Tests der Datei übernehmen; `readCache` ist dort gemockt.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/document-pdf-generation.test.ts tests/unit/invoice-pdf-route.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement**

`lib/pdf/document-pdf.ts`: in `RenderDoc` ergänzen

```ts
  /** True for an unnumbered draft: renders a diagonal "ENTWURF" watermark. */
  draft: boolean;
```

Nach dem Anlegen von `pdf` und `applyFonts` (vor dem Logo) sowie auf jeder weiteren Seite (`pdf.on("pageAdded", drawWatermark)`):

```ts
    const drawWatermark = () => {
      if (!doc.draft) return;
      pdf.save();
      pdf.rotate(-45, { origin: [PAGE_W / 2, 421] });
      pdf.font(BOLD).fontSize(96).fillColor("#cccccc").fillOpacity(0.35);
      pdf.text("ENTWURF", 0, 380, { width: PAGE_W, align: "center", lineBreak: false });
      pdf.restore();
      pdf.fillOpacity(1).fillColor(TEXT_COLOR);
    };
    drawWatermark();
    pdf.on("pageAdded", drawWatermark);
```

`lib/pdf/invoice-pdf.ts`:

```ts
  const draft = !invoice.documentNumber;
  const qr = draft
    ? null
    : buildQrBillData({ invoice: { documentNumber: invoice.documentNumber, totalAmount: total }, company: …, customer: … });
  // RenderDoc:
    documentNumber: documentLabel(invoice.documentNumber),
    draft,
```

Offerte analog: `documentNumber: documentLabel(quote.documentNumber)`, `draft: !quote.documentNumber`.

`app/api/settings/pdf-preview/route.ts`: `draft: false` im `RenderDoc` ergänzen.

PDF-Routen:

```ts
  const filename = invoice.documentNumber
    ? `rechnung-${invoice.documentNumber}.pdf`
    : `entwurf-${invoice.id}.pdf`;
  const cacheKey = `inv-${invoiceId}-v${invoice.version}-n${invoice.documentNumber ?? "draft"}-t${themeRevision(settings.pdfTheme)}`;
```

Offerten-Route analog mit `offerte-` und dem dort bestehenden Key-Präfix.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run; npx tsc --noEmit; npm run lint`
Expected: alles grün

- [ ] **Step 5: Manuelle Sichtprüfung**

`npm run dev`, Entwurfsrechnung anlegen, PDF öffnen: Wasserzeichen „ENTWURF“ auf allen Seiten, kein QR-Teil, Titel „Entwurf“. Rechnung versenden (SMTP-Testkonto oder Mailpit), erneut PDF öffnen: Nummer gesetzt, kein Wasserzeichen, QR-Teil vorhanden.

- [ ] **Step 6: Commit**

```bash
git add lib/pdf app/api tests/unit
git commit -m "feat(pdf): render unnumbered drafts as watermarked preview"
```

---

### Task 8: Abschluss

- [ ] **Step 1:** `npx vitest run; npx tsc --noEmit; npm run lint; npm run build` – alles grün.
- [ ] **Step 2:** `grep -rn "\.documentNumber" app lib components --include=*.ts --include=*.tsx` durchsehen: jede Anzeige läuft über `documentLabel`, jede Mail/PDF-Nutzung über eine bereits vergebene Nummer.
- [ ] **Step 3:** superpowers:requesting-code-review, danach superpowers:finishing-a-development-branch.
