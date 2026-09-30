# F6 Jahresabschluss-Paket Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Auf der Seite Buchhaltung lädt ein Button das Jahrespaket (ZIP) für das gewählte Jahr herunter: Journal, Jahresübersicht, offene Posten zu beiden Stichtagen, archivierte Rechnungs-PDFs, Prüfsummen und eine LIESMICH.

**Architecture:** Die Logik liegt in `lib/` und kennt kein HTTP. `lib/year-package.ts` holt die Daten, liest die archivierten PDFs nacheinander (`verifyArchived`) und gibt jede Datei über einen Callback ab. `lib/zip.ts` packt diese Dateien mit `fflate` in einen `ReadableStream` mit Backpressure. Die Route `GET /api/export/year-package` prüft Rolle und Jahr, streamt das ZIP und schreibt einen Audit-Eintrag. Journal und OP-Liste sind gemeinsame Bausteine, die auch die bestehenden CSV-Exporte nutzen.

**Tech Stack:** Next.js 16 (Route Handler), Prisma 7 + SQLite, `fflate` (ZIP, rein JS, kommt schon transitiv über `pdfkit`), Vitest.

**Spec:** `docs/superpowers/specs/2026-09-30-f6-jahrespaket-design.md`

## Global Constraints

- UI-Texte, Dateiinhalte (LIESMICH, CSV-Kopfzeilen) und Doku auf Deutsch. Commit-Messages auf Englisch (Conventional Commits, z. B. `feat(export): ...`), jeder Commit endet mit `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Jeder Commit ist grün: `npx tsc --noEmit` und die bis dahin betroffenen Tests laufen durch.
- Beträge werden in Rappen als Integer gerechnet (`toRappen` aus `lib/payments.ts`) und erst für die CSV als `(rappen / 100).toFixed(2)` ausgegeben.
- Journal nach Zahlungseingang (`Payment.date`, Ist-Methode). Kein Kontenplan, keine Zielsoftware, kein PDF-Bericht.
- Ein Paket enthält genau ein Jahr. Einziger Vorjahresbezug sind die offenen Posten per 31.12. des Vorjahres.
- Rollen: nur Admin und Editor (`hasRole(session, [UserRole.Admin, UserRole.Editor])`), wie die anderen Exporte.
- Archivierte PDFs werden nie neu erzeugt und nie verändert. Fehlende oder manipulierte Archivdateien brechen das Paket nicht ab, sie fehlen im ZIP und stehen in `pruefsummen.csv`.
- `logAudit` nie innerhalb einer `$transaction` aufrufen (hier gibt es keine, nur zur Erinnerung).
- Next.js 16: vor Änderungen an Routen `node_modules/next/dist/docs/` prüfen, keine Annahmen aus älteren Versionen.
- Tests: `npx vitest run <datei>`; Integrationstests nutzen `createTestDatabase()` aus `tests/test-utils.ts`.
- Nicht Teil von F6: PDF-Jahresbericht, Ausgabenbelege und Lieferanten (F9), Kreditoren, Privatentnahmen/-einlagen, Offerten, gespeicherte Pakete, Verschlüsselung.

---

### Task 1: ZIP-Stream mit Backpressure (`lib/zip.ts`)

**Files:**
- Modify: `package.json`, `package-lock.json` (fflate als direkte Abhängigkeit)
- Create: `lib/zip.ts`
- Test: `tests/unit/zip.test.ts`

**Interfaces:**
- Consumes: nichts.
- Produces:
  ```ts
  export type ZipAdd = (name: string, data: Uint8Array, options?: { store?: boolean }) => Promise<void>;
  export function zipStream(produce: (add: ZipAdd) => Promise<void>): ReadableStream<Uint8Array>;
  ```
  `store: true` legt die Datei unkomprimiert ab (für PDFs). Wirft `produce`, wird der Stream mit diesem Fehler beendet.

- [ ] **Step 1: Abhängigkeit direkt eintragen**

Run: `npm install fflate@^0.8.3`
Expected: `package.json` enthält `"fflate": "^0.8.3"` unter `dependencies`, Version in `node_modules/fflate` bleibt 0.8.3.

- [ ] **Step 2: Failing test schreiben**

`tests/unit/zip.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { strFromU8, unzipSync } from "fflate";
import { zipStream } from "@/lib/zip";

async function collect(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
const text = (s: string) => new TextEncoder().encode(s);

describe("zipStream", () => {
  it("packs compressed and stored files into a readable archive", async () => {
    const bytes = await collect(
      zipStream(async (add) => {
        await add("a/journal.csv", text("Datum,Betrag\n01.01.2026,10.00"));
        await add("a/rechnungen/x.pdf", new Uint8Array([1, 2, 3, 4]), { store: true });
      })
    );
    const files = unzipSync(bytes);
    expect(Object.keys(files).sort()).toEqual(["a/journal.csv", "a/rechnungen/x.pdf"]);
    expect(strFromU8(files["a/journal.csv"])).toBe("Datum,Betrag\n01.01.2026,10.00");
    expect(Array.from(files["a/rechnungen/x.pdf"])).toEqual([1, 2, 3, 4]);
  });

  it("keeps non-ASCII content intact", async () => {
    const bytes = await collect(
      zipStream(async (add) => {
        await add("a/kunden.csv", text("Müller, Zoë"));
      })
    );
    expect(strFromU8(unzipSync(bytes)["a/kunden.csv"])).toBe("Müller, Zoë");
  });

  it("errors the stream when the producer fails", async () => {
    const stream = zipStream(async (add) => {
      await add("a.txt", text("x"));
      throw new Error("boom");
    });
    await expect(collect(stream)).rejects.toThrow("boom");
  });

  it("streams many entries without loss", async () => {
    const payload = new Uint8Array(20_000).map((_, i) => (i * 31) % 251);
    const bytes = await collect(
      zipStream(async (add) => {
        for (let i = 0; i < 300; i++) await add(`f/${i}.bin`, payload, { store: true });
      })
    );
    const files = unzipSync(bytes);
    expect(Object.keys(files)).toHaveLength(300);
    expect(files["f/299.bin"]).toEqual(payload);
  });
});
```

- [ ] **Step 3: Test laufen lassen, muss fehlschlagen**

Run: `npx vitest run tests/unit/zip.test.ts`
Expected: FAIL, `Cannot find module '@/lib/zip'` (oder ähnlich).

- [ ] **Step 4: Implementierung**

`lib/zip.ts`:

```ts
import { Zip, ZipDeflate, ZipPassThrough } from "fflate";

export type ZipAdd = (name: string, data: Uint8Array, options?: { store?: boolean }) => Promise<void>;

/**
 * Streams a ZIP archive. `produce` adds files one by one via `add`; `add`
 * waits while the consumer is slower than the producer, so a large archive
 * never piles up in memory. If `produce` throws, the stream errors and the
 * download ends without a valid central directory (an incomplete ZIP cannot
 * pass as complete).
 */
export function zipStream(produce: (add: ZipAdd) => Promise<void>): ReadableStream<Uint8Array> {
  let cancelled = false;
  return new ReadableStream<Uint8Array>(
    {
      async start(controller) {
        const zip = new Zip((err, chunk, final) => {
          if (err) {
            controller.error(err);
            return;
          }
          controller.enqueue(chunk);
          if (final) controller.close();
        });

        const add: ZipAdd = async (name, data, options) => {
          if (cancelled) throw new Error("Download abgebrochen");
          const file = options?.store ? new ZipPassThrough(name) : new ZipDeflate(name, { level: 6 });
          zip.add(file);
          file.push(data, true);
          while (!cancelled && (controller.desiredSize ?? 1) <= 0) {
            await new Promise((resolve) => setTimeout(resolve, 5));
          }
        };

        try {
          await produce(add);
          zip.end();
        } catch (err) {
          controller.error(err);
        }
      },
      cancel() {
        cancelled = true;
      },
    },
    new CountQueuingStrategy({ highWaterMark: 16 })
  );
}
```

- [ ] **Step 5: Test laufen lassen, muss grün sein**

Run: `npx vitest run tests/unit/zip.test.ts`
Expected: 4 passed.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json lib/zip.ts tests/unit/zip.test.ts
git commit -m "feat(export): add streaming zip helper

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Journal als gemeinsamer Baustein (`lib/journal.ts`)

**Files:**
- Create: `lib/journal.ts`
- Modify: `app/api/export/accounting/route.ts` (ganze Datei ersetzen)
- Test: `tests/unit/journal.test.ts`

**Interfaces:**
- Consumes: `buildCsv` (`lib/csv-export.ts`), `customerDisplayName` (`lib/customer-display.ts`), `documentLabel` (`lib/document-display.ts`), `toRappen` (`lib/payments.ts`).
- Produces:
  ```ts
  export type JournalRow = {
    id: number; date: Date; documentNumber: string; type: "Einnahme" | "Ausgabe";
    customer: string; category: string; text: string; amountRappen: number;
  };
  export function buildJournal(payments: JournalPayment[], expenses: JournalExpense[]): JournalRow[];
  export async function fetchJournal(prisma: PrismaClient, year: number): Promise<JournalRow[]>;
  export const JOURNAL_HEADERS: string[];
  export function journalCsv(rows: JournalRow[]): string;
  ```

- [ ] **Step 1: Failing test schreiben**

`tests/unit/journal.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildJournal, journalCsv, JOURNAL_HEADERS } from "@/lib/journal";

const dec = (n: number) => ({ toNumber: () => n });
const cust = { company: "Muster AG", contactPerson: "Anna", contactInsteadOfCompany: false };

const payment = (id: number, date: string, nr: string | null, amount: number) => ({
  id,
  date: new Date(date),
  amount: dec(amount),
  invoice: { documentNumber: nr, customer: cust },
});
const expense = (id: number, date: string, description: string, amount: number, category: string | null) => ({
  id,
  date: new Date(date),
  description,
  amount: dec(amount),
  category: category ? { name: category } : null,
});

describe("buildJournal", () => {
  it("maps payments to Einnahme rows with invoice number and customer", () => {
    const [row] = buildJournal([payment(1, "2026-03-05T10:00:00Z", "I-26030001", 100.5)], []);
    expect(row).toMatchObject({
      type: "Einnahme",
      documentNumber: "I-26030001",
      customer: "Muster AG",
      category: "",
      text: "Zahlung Rechnung I-26030001",
      amountRappen: 10050,
    });
  });

  it("maps expenses to Ausgabe rows with the description as payment reason", () => {
    const [row] = buildJournal([], [expense(7, "2026-03-06T10:00:00Z", "Miete März", 1200, "Miete")]);
    expect(row).toMatchObject({
      type: "Ausgabe",
      documentNumber: "",
      customer: "",
      category: "Miete",
      text: "Miete März",
      amountRappen: 120000,
    });
  });

  it("sorts by date, then Einnahme before Ausgabe, then id", () => {
    const rows = buildJournal(
      [payment(2, "2026-03-05T10:00:00Z", "I-2", 10), payment(1, "2026-03-05T10:00:00Z", "I-1", 10)],
      [expense(9, "2026-03-05T10:00:00Z", "A", 5, null), expense(3, "2026-03-01T10:00:00Z", "B", 5, null)]
    );
    expect(rows.map((r) => [r.type, r.id])).toEqual([
      ["Ausgabe", 3],
      ["Einnahme", 1],
      ["Einnahme", 2],
      ["Ausgabe", 9],
    ]);
  });

  it("labels a payment on an invoice without number as Entwurf", () => {
    const [row] = buildJournal([payment(1, "2026-03-05T10:00:00Z", null, 10)], []);
    expect(row.documentNumber).toBe("");
    expect(row.text).toBe("Zahlung Rechnung Entwurf");
  });
});

describe("journalCsv", () => {
  it("writes the German header and two-decimal amounts", () => {
    const csv = journalCsv(
      buildJournal([payment(1, "2026-03-05T10:00:00Z", "I-1", 10)], [expense(1, "2026-03-06T10:00:00Z", "Porto, Post", 2.5, "Büro")])
    );
    const lines = csv.split("\n");
    expect(lines[0]).toBe(JOURNAL_HEADERS.join(","));
    expect(lines[1]).toContain("I-1,Einnahme,Muster AG,,Zahlung Rechnung I-1,10.00");
    expect(lines[2]).toContain('Ausgabe,,Büro,"Porto, Post",2.50');
  });
});
```

- [ ] **Step 2: Test laufen lassen, muss fehlschlagen**

Run: `npx vitest run tests/unit/journal.test.ts`
Expected: FAIL, `Cannot find module '@/lib/journal'`.

- [ ] **Step 3: Implementierung**

`lib/journal.ts`:

```ts
import type { PrismaClient } from "@prisma/client";
import { buildCsv } from "@/lib/csv-export";
import { customerDisplayName, type CustomerNameFields } from "@/lib/customer-display";
import { documentLabel } from "@/lib/document-display";
import { toRappen } from "@/lib/payments";

type Money = { toNumber(): number };

export type JournalPayment = {
  id: number;
  date: Date;
  amount: Money;
  invoice: { documentNumber: string | null; customer: CustomerNameFields };
};

export type JournalExpense = {
  id: number;
  date: Date;
  description: string;
  amount: Money;
  category: { name: string } | null;
};

export type JournalRow = {
  id: number;
  date: Date;
  documentNumber: string;
  type: "Einnahme" | "Ausgabe";
  customer: string;
  category: string;
  text: string;
  amountRappen: number;
};

const typeOrder = (t: JournalRow["type"]) => (t === "Einnahme" ? 0 : 1);

/**
 * Income is booked by payment date (Ist-Methode), expenses by expense date.
 * Sorted by date, Einnahme before Ausgabe on the same day, then by id.
 */
export function buildJournal(payments: JournalPayment[], expenses: JournalExpense[]): JournalRow[] {
  const rows: JournalRow[] = [
    ...payments.map((p) => ({
      id: p.id,
      date: p.date,
      documentNumber: p.invoice.documentNumber ?? "",
      type: "Einnahme" as const,
      customer: customerDisplayName(p.invoice.customer),
      category: "",
      text: `Zahlung Rechnung ${documentLabel(p.invoice.documentNumber)}`,
      amountRappen: toRappen(p.amount),
    })),
    ...expenses.map((e) => ({
      id: e.id,
      date: e.date,
      documentNumber: "",
      type: "Ausgabe" as const,
      customer: "",
      category: e.category?.name ?? "",
      text: e.description,
      amountRappen: toRappen(e.amount),
    })),
  ];
  return rows.sort(
    (a, b) =>
      a.date.getTime() - b.date.getTime() || typeOrder(a.type) - typeOrder(b.type) || a.id - b.id
  );
}

export async function fetchJournal(prisma: PrismaClient, year: number): Promise<JournalRow[]> {
  const yearStart = new Date(year, 0, 1);
  const yearEnd = new Date(year + 1, 0, 1);
  const [payments, expenses] = await Promise.all([
    prisma.payment.findMany({
      where: { date: { gte: yearStart, lt: yearEnd } },
      select: {
        id: true,
        date: true,
        amount: true,
        invoice: {
          select: {
            documentNumber: true,
            customer: { select: { company: true, contactPerson: true, contactInsteadOfCompany: true } },
          },
        },
      },
    }),
    prisma.expense.findMany({
      where: { date: { gte: yearStart, lt: yearEnd } },
      select: { id: true, date: true, description: true, amount: true, category: { select: { name: true } } },
    }),
  ]);
  return buildJournal(payments, expenses);
}

export const JOURNAL_HEADERS = ["Datum", "Beleg-Nr.", "Typ", "Kunde", "Kategorie", "Text", "Betrag (CHF)"];

export function journalCsv(rows: JournalRow[]): string {
  return buildCsv(
    JOURNAL_HEADERS,
    rows.map((r) => [
      r.date.toLocaleDateString("de-CH"),
      r.documentNumber,
      r.type,
      r.customer,
      r.category,
      r.text,
      (r.amountRappen / 100).toFixed(2),
    ])
  );
}
```

- [ ] **Step 4: Test laufen lassen, muss grün sein**

Run: `npx vitest run tests/unit/journal.test.ts`
Expected: 5 passed.

- [ ] **Step 5: Bestehenden Export auf `lib/journal.ts` umstellen**

`app/api/export/accounting/route.ts` komplett ersetzen:

```ts
import { redirect } from "next/navigation";
import prisma from "@/lib/prisma";
import { csvResponse } from "@/lib/csv-export";
import { auth } from "@/lib/auth";
import { hasRole } from "@/lib/permissions";
import { UserRole } from "@prisma/client";
import { fetchJournal, journalCsv } from "@/lib/journal";

export async function GET(request: Request) {
  const session = await auth();
  if (!session) redirect("/login");
  if (!hasRole(session, [UserRole.Admin, UserRole.Editor])) redirect("/dashboard");

  const url = new URL(request.url);
  const yearParam = url.searchParams.get("year");
  const parsedYear = yearParam ? parseInt(yearParam, 10) : NaN;
  const year = Number.isInteger(parsedYear) ? parsedYear : new Date().getFullYear();

  const journal = await fetchJournal(prisma, year);
  const today = new Date().toISOString().slice(0, 10);
  return csvResponse(journalCsv(journal), `accounting-${today}.csv`);
}
```

- [ ] **Step 6: Typen und bestehende Tests prüfen**

Run: `npx tsc --noEmit && npx vitest run tests/unit/journal.test.ts tests/integration/income-statement.test.ts`
Expected: keine Typfehler, alles grün.

- [ ] **Step 7: Commit**

```bash
git add lib/journal.ts tests/unit/journal.test.ts app/api/export/accounting/route.ts
git commit -m "feat(export): add shared journal with invoice number and customer

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Adresse in der OP-Liste und gemeinsamer OP-CSV-Builder

**Files:**
- Modify: `lib/receivables.ts` (Typen `ReceivableInput`, `ReceivableRow`, Zeile im `rows.push`, Select in `fetchReceivables`)
- Create: `lib/receivables-csv.ts`
- Modify: `app/api/export/receivables/route.ts`
- Test: `tests/unit/receivables.test.ts` (erweitern), `tests/unit/receivables-csv.test.ts` (neu)

**Interfaces:**
- Consumes: `COUNTRIES` (`lib/address.ts`), `documentLabel`, `buildCsv`, `AGE_BUCKETS`.
- Produces:
  ```ts
  // ReceivableRow erhält:
  customerAddress: { street: string; zip: string; city: string; country: string };
  // lib/receivables-csv.ts
  export const RECEIVABLES_HEADERS: string[];
  export function receivablesCsv(report: ReceivablesReport): string;
  ```

- [ ] **Step 1: Failing test für die Adresse in `buildReceivables`**

An `tests/unit/receivables.test.ts` am Ende des bestehenden `describe("buildReceivables", …)` (oder als neues `describe`) anhängen; `inv` und `customer` sind dort schon definiert:

```ts
describe("buildReceivables customer address", () => {
  it("carries the customer address on each row", () => {
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
          },
        }),
      ],
      new Date("2026-12-31")
    );
    expect(report.rows[0].customerAddress).toEqual({
      street: "Seestrasse 100",
      zip: "3011",
      city: "Bern",
      country: "CH",
    });
  });

  it("falls back to empty strings when the input has no address", () => {
    const report = buildReceivables([inv({ id: 1 })], new Date("2026-12-31"));
    expect(report.rows[0].customerAddress).toEqual({ street: "", zip: "", city: "", country: "" });
  });
});
```

- [ ] **Step 2: Test laufen lassen, muss fehlschlagen**

Run: `npx vitest run tests/unit/receivables.test.ts`
Expected: FAIL (Typfehler bzw. `customerAddress` undefined).

- [ ] **Step 3: `lib/receivables.ts` anpassen**

In `ReceivableInput.customer` die optionalen Felder ergänzen:

```ts
  customer: {
    customerId: number;
    company: string | null;
    contactPerson: string | null;
    contactInsteadOfCompany: boolean;
    street?: string;
    houseNumber?: string | null;
    zipCode?: string;
    city?: string;
    country?: string;
  };
```

In `ReceivableRow` nach `customerName` einfügen:

```ts
  customerAddress: { street: string; zip: string; city: string; country: string };
```

Im `rows.push({ … })` nach `customerName,` einfügen:

```ts
      customerAddress: {
        street: [inv.customer.street, inv.customer.houseNumber].filter(Boolean).join(" "),
        zip: inv.customer.zipCode ?? "",
        city: inv.customer.city ?? "",
        country: inv.customer.country ?? "",
      },
```

In `fetchReceivables` den Customer-Select erweitern:

```ts
      customer: {
        select: {
          customerId: true,
          company: true,
          contactPerson: true,
          contactInsteadOfCompany: true,
          street: true,
          houseNumber: true,
          zipCode: true,
          city: true,
          country: true,
        },
      },
```

- [ ] **Step 4: Test laufen lassen, muss grün sein**

Run: `npx vitest run tests/unit/receivables.test.ts tests/integration/receivables.test.ts`
Expected: alles grün.

- [ ] **Step 5: Failing test für den CSV-Builder**

`tests/unit/receivables-csv.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildReceivables } from "@/lib/receivables";
import { receivablesCsv, RECEIVABLES_HEADERS } from "@/lib/receivables-csv";

const dec = (n: number) => ({ toNumber: () => n });

describe("receivablesCsv", () => {
  it("lists each open invoice with the customer address", () => {
    const report = buildReceivables(
      [
        {
          id: 1,
          documentNumber: "I-26010001",
          state: "Sent",
          date: new Date("2026-01-10"),
          dueDate: new Date("2026-02-10"),
          totalAmount: dec(100),
          customer: {
            customerId: 1,
            company: "Muster AG",
            contactPerson: "Anna",
            contactInsteadOfCompany: false,
            street: "Seestrasse",
            houseNumber: "100",
            zipCode: "3011",
            city: "Bern",
            country: "CH",
          },
          payments: [{ date: new Date("2026-03-01"), amount: dec(30) }],
        },
      ],
      new Date("2026-12-31")
    );
    const lines = receivablesCsv(report).split("\n");
    expect(lines[0]).toBe(RECEIVABLES_HEADERS.join(","));
    expect(lines[1]).toBe(
      "I-26010001,Muster AG,Seestrasse 100,3011,Bern,Schweiz,10.01.2026,10.02.2026,100.00,30.00,70.00,0.00,über 90 Tage"
    );
  });

  it("writes only the header for an empty report", () => {
    expect(receivablesCsv(buildReceivables([], new Date("2026-12-31")))).toBe(RECEIVABLES_HEADERS.join(","));
  });
});
```

- [ ] **Step 6: Test laufen lassen, muss fehlschlagen**

Run: `npx vitest run tests/unit/receivables-csv.test.ts`
Expected: FAIL, `Cannot find module '@/lib/receivables-csv'`.

- [ ] **Step 7: Implementierung**

`lib/receivables-csv.ts`:

```ts
import { buildCsv } from "@/lib/csv-export";
import { COUNTRIES } from "@/lib/address";
import { documentLabel } from "@/lib/document-display";
import { AGE_BUCKETS, type ReceivablesReport } from "@/lib/receivables";

export const RECEIVABLES_HEADERS = [
  "Rechnung", "Kunde", "Strasse", "PLZ", "Ort", "Land", "Rechnungsdatum", "Fällig",
  "Total (CHF)", "Bezahlt (CHF)", "Offen (CHF)", "Guthaben (CHF)", "Alter",
];

const chf = (rappen: number) => (rappen / 100).toFixed(2);

/** Debtor list: every open invoice with customer name and address (global totals are not enough for the tax office). */
export function receivablesCsv(report: ReceivablesReport): string {
  return buildCsv(
    RECEIVABLES_HEADERS,
    report.rows.map((r) => [
      documentLabel(r.documentNumber),
      r.customerName,
      r.customerAddress.street,
      r.customerAddress.zip,
      r.customerAddress.city,
      COUNTRIES[r.customerAddress.country] ?? r.customerAddress.country,
      r.date.toLocaleDateString("de-CH"),
      r.dueDate.toLocaleDateString("de-CH"),
      chf(r.totalRappen),
      chf(r.paidRappen),
      chf(r.openRappen),
      chf(r.creditRappen),
      AGE_BUCKETS.find((b) => b.key === r.bucket)?.label ?? "",
    ])
  );
}
```

- [ ] **Step 8: OP-Route auf den Builder umstellen**

`app/api/export/receivables/route.ts` komplett ersetzen:

```ts
import { redirect } from "next/navigation";
import prisma from "@/lib/prisma";
import { csvResponse } from "@/lib/csv-export";
import { auth } from "@/lib/auth";
import { hasRole } from "@/lib/permissions";
import { UserRole } from "@prisma/client";
import { fetchReceivables } from "@/lib/receivables";
import { receivablesCsv } from "@/lib/receivables-csv";

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
  return csvResponse(receivablesCsv(report), `offene-posten-${asOf.toISOString().slice(0, 10)}.csv`);
}
```

- [ ] **Step 9: Alles prüfen**

Run: `npx tsc --noEmit && npx vitest run tests/unit/receivables.test.ts tests/unit/receivables-csv.test.ts tests/integration/receivables.test.ts`
Expected: keine Typfehler (falls eine Seite `ReceivableRow` konstruiert, `customerAddress` dort ergänzen), alles grün.

- [ ] **Step 10: Commit**

```bash
git add lib/receivables.ts lib/receivables-csv.ts app/api/export/receivables/route.ts tests/unit/receivables.test.ts tests/unit/receivables-csv.test.ts
git commit -m "feat(receivables): add customer address to open items export

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Paketinhalt (`lib/year-package.ts`)

**Files:**
- Create: `lib/year-package.ts`
- Test: `tests/unit/year-package-unit.test.ts`, `tests/integration/year-package.test.ts`

**Interfaces:**
- Consumes: `fetchJournal`, `journalCsv`, `JournalRow` (Task 2); `fetchReceivables`, `ReceivablesReport` (`lib/receivables.ts`), `receivablesCsv` (Task 3); `verifyArchived` (`lib/document-archive.ts`); `buildCsv`; `documentLabel`.
- Produces:
  ```ts
  export type PackageEntry = { name: string; data: Uint8Array };
  export type PackageSummary = {
    fileCount: number; pdfOk: number; pdfMissing: number; pdfMismatch: number; withoutPdf: number;
  };
  export function parseYearParam(raw: string | null, now: Date): number | null;
  export function buildYearPackage(
    prisma: PrismaClient, year: number, now: Date,
    emit: (entry: PackageEntry) => void | Promise<void>
  ): Promise<PackageSummary>;
  ```
  Die Namen in `PackageEntry` beginnen mit `jahrespaket-<Jahr>/`. PDFs liegen unter `jahrespaket-<Jahr>/rechnungen/`.

- [ ] **Step 1: Failing Unit-Test für Jahr-Parser, Stichtage und Jahresübersicht**

`tests/unit/year-package-unit.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parseYearParam, stichtage, overviewCsv } from "@/lib/year-package";
import { buildJournal } from "@/lib/journal";
import { buildReceivables } from "@/lib/receivables";

const dec = (n: number) => ({ toNumber: () => n });
const now = new Date("2026-09-30T12:00:00Z");

describe("parseYearParam", () => {
  it.each([
    ["2026", 2026],
    ["2000", 2000],
    ["2027", 2027],
  ])("accepts %s", (raw, expected) => {
    expect(parseYearParam(raw, now)).toBe(expected);
  });

  it.each([null, "", "abc", "1999", "2028", "20260", "26", "2026.5", "-2026"])("rejects %s", (raw) => {
    expect(parseYearParam(raw, now)).toBeNull();
  });
});

describe("stichtage", () => {
  it("uses 31.12. for finished years", () => {
    const { prev, end } = stichtage(2025, now);
    expect(prev.toISOString()).toBe("2024-12-31T23:59:59.999Z");
    expect(end.toISOString()).toBe("2025-12-31T23:59:59.999Z");
  });

  it("uses today for the current year", () => {
    expect(stichtage(2026, now).end.toISOString()).toBe("2026-09-30T23:59:59.999Z");
  });
});

describe("overviewCsv", () => {
  it("sums income, expenses per category, result and debtor change", () => {
    const journal = buildJournal(
      [{ id: 1, date: new Date("2026-03-05T10:00:00Z"), amount: dec(300), invoice: { documentNumber: "I-1", customer: { company: "A", contactPerson: "x", contactInsteadOfCompany: false } } }],
      [
        { id: 1, date: new Date("2026-03-06T10:00:00Z"), description: "Miete", amount: dec(100), category: { name: "Miete" } },
        { id: 2, date: new Date("2026-03-07T10:00:00Z"), description: "Kaffee", amount: dec(20), category: null },
        { id: 3, date: new Date("2026-03-08T10:00:00Z"), description: "Miete 2", amount: dec(100), category: { name: "Miete" } },
      ]
    );
    const invoice = (id: number, total: number) => ({
      id,
      documentNumber: `I-${id}`,
      state: "Sent" as const,
      date: new Date("2025-06-01"),
      dueDate: new Date("2025-07-01"),
      totalAmount: dec(total),
      customer: { customerId: 1, company: "A", contactPerson: "x", contactInsteadOfCompany: false },
      payments: [],
    });
    const prev = buildReceivables([invoice(1, 100)], new Date("2025-12-31"));
    const end = buildReceivables([invoice(1, 100), invoice(2, 250)], new Date("2026-12-31"));

    const csv = overviewCsv(journal, prev, end, "31.12.2025", "31.12.2026");
    expect(csv.split("\n")).toEqual([
      "Position,Betrag (CHF)",
      "Einnahmen gesamt,300.00",
      "Ausgaben Miete,200.00",
      "Ausgaben ohne Kategorie,20.00",
      "Ausgaben gesamt,220.00",
      "Ergebnis,80.00",
      "Debitoren offen per 31.12.2025,100.00",
      "Debitoren offen per 31.12.2026,350.00",
      "Veränderung Debitoren,250.00",
    ]);
  });
});
```

- [ ] **Step 2: Test laufen lassen, muss fehlschlagen**

Run: `npx vitest run tests/unit/year-package-unit.test.ts`
Expected: FAIL, `Cannot find module '@/lib/year-package'`.

- [ ] **Step 3: `lib/year-package.ts` implementieren**

```ts
import type { PrismaClient } from "@prisma/client";
import { buildCsv } from "@/lib/csv-export";
import { verifyArchived } from "@/lib/document-archive";
import { documentLabel } from "@/lib/document-display";
import { fetchJournal, journalCsv, type JournalRow } from "@/lib/journal";
import { fetchReceivables, type ReceivablesReport } from "@/lib/receivables";
import { receivablesCsv } from "@/lib/receivables-csv";

export type PackageEntry = { name: string; data: Uint8Array };

export type PackageSummary = {
  fileCount: number;
  pdfOk: number;
  pdfMissing: number;
  pdfMismatch: number;
  withoutPdf: number;
};

const MIN_YEAR = 2000;

/** Four-digit year between 2000 and next year, or `null` (the route answers 400). */
export function parseYearParam(raw: string | null, now: Date): number | null {
  if (!raw || !/^\d{4}$/.test(raw)) return null;
  const year = Number(raw);
  return year >= MIN_YEAR && year <= now.getFullYear() + 1 ? year : null;
}

const endOfDay = (y: number, m: number, d: number) => new Date(Date.UTC(y, m, d, 23, 59, 59, 999));

/** Cut-off for the debtors at the start (31.12. of the previous year) and end of the year (today for the running year). */
export function stichtage(year: number, now: Date): { prev: Date; end: Date } {
  const prev = endOfDay(year - 1, 11, 31);
  const end =
    year === now.getFullYear() ? endOfDay(now.getFullYear(), now.getMonth(), now.getDate()) : endOfDay(year, 11, 31);
  return { prev, end };
}

const iso = (d: Date) => d.toISOString().slice(0, 10);
const fmtCh = (d: Date) => {
  const [y, m, day] = iso(d).split("-");
  return `${day}.${m}.${y}`;
};
const chf = (rappen: number) => (rappen / 100).toFixed(2);

export function overviewCsv(
  journal: JournalRow[],
  prev: ReceivablesReport,
  end: ReceivablesReport,
  prevLabel: string,
  endLabel: string
): string {
  let income = 0;
  const byCategory = new Map<string, number>();
  for (const row of journal) {
    if (row.type === "Einnahme") income += row.amountRappen;
    else byCategory.set(row.category, (byCategory.get(row.category) ?? 0) + row.amountRappen);
  }
  const expenses = [...byCategory.values()].reduce((s, v) => s + v, 0);
  const categories = [...byCategory.entries()].sort(([a], [b]) => a.localeCompare(b, "de"));

  return buildCsv(
    ["Position", "Betrag (CHF)"],
    [
      ["Einnahmen gesamt", chf(income)],
      ...categories.map(([name, rappen]) => [`Ausgaben ${name || "ohne Kategorie"}`, chf(rappen)]),
      ["Ausgaben gesamt", chf(expenses)],
      ["Ergebnis", chf(income - expenses)],
      [`Debitoren offen per ${prevLabel}`, chf(prev.totalOpenRappen)],
      [`Debitoren offen per ${endLabel}`, chf(end.totalOpenRappen)],
      ["Veränderung Debitoren", chf(end.totalOpenRappen - prev.totalOpenRappen)],
    ]
  );
}

/**
 * Documents that belong in the package: everything sent in the year, plus
 * every document of an invoice that had a payment or a send-log entry in the
 * year or is still open at the cut-off. Invoices of that second group without
 * any archived PDF (sent before the archive existed) are reported separately.
 */
async function selectDocuments(prisma: PrismaClient, year: number, openInvoiceIds: number[]) {
  const yearStart = new Date(year, 0, 1);
  const yearEnd = new Date(year + 1, 0, 1);
  const [paid, sentLogs] = await Promise.all([
    prisma.payment.findMany({
      where: { date: { gte: yearStart, lt: yearEnd } },
      select: { invoiceId: true },
      distinct: ["invoiceId"],
    }),
    prisma.invoiceSentLog.findMany({
      where: { sentAt: { gte: yearStart, lt: yearEnd } },
      select: { invoiceId: true },
      distinct: ["invoiceId"],
    }),
  ]);
  const candidateIds = [
    ...new Set([...paid.map((p) => p.invoiceId), ...sentLogs.map((s) => s.invoiceId), ...openInvoiceIds]),
  ];

  const docs = await prisma.sentDocument.findMany({
    where: { OR: [{ createdAt: { gte: yearStart, lt: yearEnd } }, { invoiceId: { in: candidateIds } }] },
    orderBy: { id: "asc" },
  });
  const archivedInvoiceIds = new Set(docs.map((d) => d.invoiceId));
  const unarchived = await prisma.invoice.findMany({
    where: { id: { in: candidateIds.filter((id) => !archivedInvoiceIds.has(id)) }, state: { not: "Draft" } },
    select: { id: true, documentNumber: true },
    orderBy: { id: "asc" },
  });
  return { docs, unarchived };
}

function readme(year: number, now: Date, prevAsOf: Date, endAsOf: Date, s: PackageSummary): string {
  const lines = [
    `Jahrespaket ${year}`,
    `Erstellt am ${fmtCh(now)}`,
    "",
    "Inhalt",
    `- journal-${year}.csv: Einnahmen nach Zahlungseingang (Ist-Methode) und Ausgaben des Jahres, chronologisch.`,
    `- jahresuebersicht-${year}.csv: Einnahmen, Ausgaben je Kategorie, Ergebnis und Veränderung der Debitoren.`,
    `- offene-posten-${iso(prevAsOf)}.csv und offene-posten-${iso(endAsOf)}.csv: offene Kundenrechnungen (Debitoren) am Anfang und am Ende des Jahres, je Rechnung mit Kundenadresse.`,
    "- rechnungen/: die beim Versand archivierten Original-PDFs (Rechnungen, Mahnungen, Gutschriften), die im Jahr versendet wurden, im Jahr eine Zahlung hatten oder am Stichtag noch offen waren. Eine Rechnung über den Jahreswechsel liegt bewusst in beiden Jahrespaketen.",
    '- pruefsummen.csv: SHA-256 jeder PDF-Datei und ihr Status. "FEHLT" und "HASH ABWEICHEND" bedeuten, dass die Archivdatei nicht mehr vorhanden oder verändert ist und deshalb nicht im Paket liegt. "ohne archiviertes PDF" sind Rechnungen, die vor Einführung des Belegarchivs versendet wurden.',
    "",
    "Hinweise",
    `- Stichtag der Debitoren am Ende: ${fmtCh(endAsOf)}.`,
    "- Nicht enthalten: Privatentnahmen und -einlagen, Kreditoren (offene Lieferantenrechnungen), der Name des Lieferanten bei Ausgaben, Belege zu Ausgaben und Offerten.",
    "- Belege, Geschäftsbücher und Rechnungsdoppel sind zehn Jahre aufzubewahren (Art. 958f OR).",
    "- Dieses Paket ist eine Datengrundlage und kein Rechtsrat. Massgebend sind die Vorgaben der Steuerverwaltung Ihres Kantons.",
  ];
  if (s.pdfMissing + s.pdfMismatch + s.withoutPdf > 0) {
    lines.push(
      "",
      `ACHTUNG: ${s.pdfMissing} Archivdatei(en) fehlen, ${s.pdfMismatch} weichen von der Prüfsumme ab, ${s.withoutPdf} Rechnung(en) haben kein archiviertes PDF. Einzelheiten in pruefsummen.csv.`
    );
  }
  return lines.join("\n") + "\n";
}

/**
 * Produces the files of the year package one by one. Archived PDFs are read
 * sequentially so that they never sit in memory all at once.
 */
export async function buildYearPackage(
  prisma: PrismaClient,
  year: number,
  now: Date,
  emit: (entry: PackageEntry) => void | Promise<void>
): Promise<PackageSummary> {
  const folder = `jahrespaket-${year}`;
  const encoder = new TextEncoder();
  const summary: PackageSummary = { fileCount: 0, pdfOk: 0, pdfMissing: 0, pdfMismatch: 0, withoutPdf: 0 };
  const push = async (name: string, data: string | Uint8Array) => {
    await emit({ name: `${folder}/${name}`, data: typeof data === "string" ? encoder.encode(data) : data });
    summary.fileCount++;
  };

  const { prev, end } = stichtage(year, now);
  const [journal, prevReport, endReport] = await Promise.all([
    fetchJournal(prisma, year),
    fetchReceivables(prisma, prev),
    fetchReceivables(prisma, end),
  ]);

  await push(`journal-${year}.csv`, journalCsv(journal));
  await push(`jahresuebersicht-${year}.csv`, overviewCsv(journal, prevReport, endReport, fmtCh(prev), fmtCh(end)));
  await push(`offene-posten-${iso(prev)}.csv`, receivablesCsv(prevReport));
  await push(`offene-posten-${iso(end)}.csv`, receivablesCsv(endReport));

  const { docs, unarchived } = await selectDocuments(
    prisma,
    year,
    endReport.rows.map((r) => r.invoiceId)
  );

  const checksums: string[][] = [];
  for (const doc of docs) {
    const fileName = doc.path.split("/").pop() ?? doc.path;
    const result = await verifyArchived(doc);
    if (result.ok) {
      await push(`rechnungen/${fileName}`, new Uint8Array(result.data));
      summary.pdfOk++;
      checksums.push([fileName, doc.sha256, String(doc.size), "OK"]);
    } else if (result.reason === "missing") {
      summary.pdfMissing++;
      checksums.push([fileName, doc.sha256, String(doc.size), "FEHLT"]);
    } else {
      summary.pdfMismatch++;
      checksums.push([fileName, doc.sha256, String(doc.size), "HASH ABWEICHEND"]);
    }
  }
  for (const inv of unarchived) {
    summary.withoutPdf++;
    checksums.push([documentLabel(inv.documentNumber), "", "", "ohne archiviertes PDF"]);
  }

  await push("pruefsummen.csv", buildCsv(["Datei", "SHA-256", "Grösse (Bytes)", "Status"], checksums));
  await push("LIESMICH.txt", readme(year, now, prev, end, summary));
  return summary;
}
```

- [ ] **Step 4: Unit-Test laufen lassen, muss grün sein**

Run: `npx vitest run tests/unit/year-package-unit.test.ts`
Expected: alles grün.

- [ ] **Step 5: Failing Integrationstest schreiben**

`tests/integration/year-package.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, chmodSync, unlinkSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { createTestDatabase, createValidTestCustomer } from "../test-utils";
import { archivePdf, archiveRootDir } from "@/lib/document-archive";
import { buildYearPackage, type PackageEntry } from "@/lib/year-package";

const now = new Date("2027-03-01T12:00:00Z");
const text = (e: PackageEntry) => new TextDecoder().decode(e.data);

describe("buildYearPackage", () => {
  const db = createTestDatabase();
  let dir: string;
  let tick = 0;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "year-package-"));
    process.env.ARCHIVE_DIR = dir;
    tick = 0;
  });
  afterEach(() => {
    delete process.env.ARCHIVE_DIR;
    rmSync(dir, { recursive: true, force: true });
  });

  async function invoice(
    number: string,
    date: string,
    extra: { state?: "Sent" | "Paid" | "Canceled"; creditNoteForId?: number; totalAmount?: number } = {}
  ) {
    const customer =
      (await db.prisma.customer.findFirst()) ?? (await db.prisma.customer.create({ data: createValidTestCustomer() }));
    return db.prisma.invoice.create({
      data: {
        customerId: customer.customerId,
        documentNumber: number,
        date: new Date(date),
        dueDate: new Date(new Date(date).getTime() + 30 * 86_400_000),
        totalAmount: 100,
        state: "Sent",
        ...extra,
      },
    });
  }

  async function archive(invoiceId: number, number: string, createdAt: string, kind: "Invoice" | "Reminder" = "Invoice") {
    const pdf = Buffer.from(`%PDF-1.4 ${number} ${kind}`);
    const a = await archivePdf({ documentNumber: number, kind, pdf, now: new Date(Date.UTC(2026, 0, 1, 0, 0, tick++)) });
    const row = await db.prisma.sentDocument.create({
      data: {
        invoiceId, kind, documentNumber: number, ...a,
        sentTo: "k@test.ch", subject: "Rechnung", createdById: 1, createdAt: new Date(createdAt),
      },
    });
    return { row, fileName: a.path.split("/").pop()! };
  }

  async function run(year: number) {
    const entries: PackageEntry[] = [];
    const summary = await buildYearPackage(db.prisma, year, now, (e) => {
      entries.push(e);
    });
    const byName = (suffix: string) => entries.find((e) => e.name.endsWith(suffix));
    return { entries, summary, byName, names: entries.map((e) => e.name) };
  }

  it("selects PDFs by send date, payment in the year and open at the cut-off", async () => {
    const dec = await invoice("I-DEC", "2025-12-20");
    const decDoc = await archive(dec.id, "I-DEC", "2025-12-20T10:00:00Z");
    await db.prisma.payment.create({ data: { invoiceId: dec.id, date: new Date("2026-01-15T10:00:00Z"), amount: 100 } });
    await db.prisma.invoice.update({ where: { id: dec.id }, data: { state: "Paid", paidDate: new Date("2026-01-15T10:00:00Z") } });

    const open = await invoice("I-OPEN", "2026-03-01");
    const openDoc = await archive(open.id, "I-OPEN", "2026-03-01T10:00:00Z");
    const openReminder = await archive(open.id, "I-OPEN", "2026-05-01T10:00:00Z", "Reminder");

    const old = await invoice("I-OLD", "2024-05-01", { state: "Paid" });
    const oldDoc = await archive(old.id, "I-OLD", "2024-05-01T10:00:00Z");
    await db.prisma.payment.create({ data: { invoiceId: old.id, date: new Date("2024-06-01T10:00:00Z"), amount: 100 } });

    const { names, summary } = await run(2026);

    expect(names).toContain(`jahrespaket-2026/rechnungen/${decDoc.fileName}`);
    expect(names).toContain(`jahrespaket-2026/rechnungen/${openDoc.fileName}`);
    expect(names).toContain(`jahrespaket-2026/rechnungen/${openReminder.fileName}`);
    expect(names.some((n) => n.includes(oldDoc.fileName))).toBe(false);
    expect(summary).toMatchObject({ pdfOk: 3, pdfMissing: 0, pdfMismatch: 0, withoutPdf: 0 });
  });

  it("emits the fixed files with the expected names and stichtage", async () => {
    const { names } = await run(2026);
    expect(names).toEqual(
      expect.arrayContaining([
        "jahrespaket-2026/journal-2026.csv",
        "jahrespaket-2026/jahresuebersicht-2026.csv",
        "jahrespaket-2026/offene-posten-2025-12-31.csv",
        "jahrespaket-2026/offene-posten-2026-12-31.csv",
        "jahrespaket-2026/pruefsummen.csv",
        "jahrespaket-2026/LIESMICH.txt",
      ])
    );
  });

  it("puts payments and expenses in the journal and debtors in the overview", async () => {
    const inv = await invoice("I-J1", "2026-02-01");
    await db.prisma.payment.create({ data: { invoiceId: inv.id, date: new Date("2026-02-20T10:00:00Z"), amount: 40 } });
    const cat = await db.prisma.category.create({ data: { name: "Miete" } });
    await db.prisma.expense.create({
      data: { date: new Date("2026-02-21T10:00:00Z"), description: "Büromiete", amount: 25, categoryId: cat.categoryId },
    });

    const { byName } = await run(2026);
    const journal = text(byName("journal-2026.csv")!).split("\n");
    expect(journal).toHaveLength(3);
    expect(journal[1]).toContain("I-J1,Einnahme,Client AG,,Zahlung Rechnung I-J1,40.00");
    expect(journal[2]).toContain("Ausgabe,,Miete,Büromiete,25.00");

    const overview = text(byName("jahresuebersicht-2026.csv")!);
    expect(overview).toContain("Einnahmen gesamt,40.00");
    expect(overview).toContain("Ausgaben Miete,25.00");
    expect(overview).toContain("Ergebnis,15.00");
    expect(overview).toContain("Debitoren offen per 31.12.2025,0.00");
    expect(overview).toContain("Debitoren offen per 31.12.2026,60.00");

    const openItems = text(byName("offene-posten-2026-12-31.csv")!);
    expect(openItems).toContain("I-J1,Client AG,Seestrasse 100,8002,Zürich");
  });

  it("reports a deleted archive file as FEHLT and leaves it out of the zip", async () => {
    const inv = await invoice("I-GONE", "2026-04-01");
    const doc = await archive(inv.id, "I-GONE", "2026-04-01T10:00:00Z");
    const abs = join(archiveRootDir(), doc.row.path);
    chmodSync(abs, 0o666);
    unlinkSync(abs);

    const { names, byName, summary } = await run(2026);
    expect(names.some((n) => n.includes(doc.fileName))).toBe(false);
    expect(text(byName("pruefsummen.csv")!)).toContain(`${doc.fileName},${doc.row.sha256},${doc.row.size},FEHLT`);
    expect(text(byName("LIESMICH.txt")!)).toContain("ACHTUNG: 1 Archivdatei(en) fehlen");
    expect(summary.pdfMissing).toBe(1);
  });

  it("reports a tampered archive file as HASH ABWEICHEND and leaves it out of the zip", async () => {
    const inv = await invoice("I-BAD", "2026-04-02");
    const doc = await archive(inv.id, "I-BAD", "2026-04-02T10:00:00Z");
    const abs = join(archiveRootDir(), doc.row.path);
    chmodSync(abs, 0o666);
    writeFileSync(abs, "tampered");

    const { names, byName, summary } = await run(2026);
    expect(names.some((n) => n.includes(doc.fileName))).toBe(false);
    expect(text(byName("pruefsummen.csv")!)).toContain("HASH ABWEICHEND");
    expect(summary.pdfMismatch).toBe(1);
  });

  it("lists invoices sent in the year without an archived PDF", async () => {
    const inv = await invoice("I-PRE", "2026-05-01");
    await db.prisma.invoiceSentLog.create({
      data: { invoiceId: inv.id, sentAt: new Date("2026-05-01T10:00:00Z"), sentTo: "k@test.ch", subject: "Rechnung" },
    });

    const { byName, summary } = await run(2026);
    expect(text(byName("pruefsummen.csv")!)).toContain("I-PRE,,,ohne archiviertes PDF");
    expect(summary.withoutPdf).toBe(1);
  });

  it("includes credit notes sent in the year", async () => {
    const orig = await invoice("I-ORIG", "2025-11-01", { state: "Canceled" });
    const credit = await invoice("G-1", "2026-06-01", { creditNoteForId: orig.id, totalAmount: -100 });
    const doc = await archive(credit.id, "G-1", "2026-06-01T10:00:00Z");

    const { names } = await run(2026);
    expect(names).toContain(`jahrespaket-2026/rechnungen/${doc.fileName}`);
  });

  it("counts every emitted file in the summary", async () => {
    const { entries, summary } = await run(2026);
    expect(summary.fileCount).toBe(entries.length);
    expect(summary.fileCount).toBe(6);
  });
});
```

- [ ] **Step 6: Integrationstest laufen lassen**

Run: `npx vitest run tests/integration/year-package.test.ts`
Expected: alles grün. Schlägt etwas fehl, zuerst klären, ob der Test oder `selectDocuments` falsch liegt. Gegen die Spec prüfen, nicht die Implementierung verbiegen, bis ein Test besteht.

- [ ] **Step 7: Typen und Lint prüfen**

Run: `npx tsc --noEmit && npx eslint lib/year-package.ts lib/zip.ts lib/journal.ts lib/receivables-csv.ts`
Expected: sauber.

- [ ] **Step 8: Commit**

```bash
git add lib/year-package.ts tests/unit/year-package-unit.test.ts tests/integration/year-package.test.ts
git commit -m "feat(export): build year package contents from archive and payments

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Route `GET /api/export/year-package` und Audit-Eintrag

**Files:**
- Modify: `lib/audit.ts` (Typen), `app/(app)/settings/audit/page.tsx` (Labels für `EXPORT`)
- Create: `app/api/export/year-package/route.ts`
- Test: `tests/unit/year-package-route.test.ts`

**Interfaces:**
- Consumes: `zipStream`, `ZipAdd` (Task 1); `buildYearPackage`, `parseYearParam`, `PackageSummary` (Task 4); `logAudit` (`lib/audit.ts`).
- Produces: `GET /api/export/year-package?year=YYYY` liefert `application/zip`, `Content-Disposition: attachment; filename="jahrespaket-YYYY.zip"`. Audit: Aktion `EXPORT`, Entität `YearPackage`, `entityRef` = Jahr, Details = `PackageSummary`.

- [ ] **Step 1: Audit-Typen und Labels erweitern**

`lib/audit.ts` Zeilen 9 und 10:

```ts
export type AuditAction = "CREATE" | "UPDATE" | "DELETE" | "SEND" | "STATUS" | "EXPORT";
export type AuditEntity = "Customer" | "Invoice" | "Quote" | "Reminder" | "Service" | "User" | "Settings" | "CustomerNote" | "Expense" | "Payment" | "SentDocument" | "YearPackage";
```

`app/(app)/settings/audit/page.tsx`: in `actionLabels` nach `STATUS` ergänzen `EXPORT: "Exportiert",` und in `actionVariants` `EXPORT: "outline",`. Danach in derselben Datei prüfen, ob es eine Liste oder Map der Entitätsnamen gibt (Suche nach `SentDocument`); falls ja, dort `YearPackage: "Jahrespaket"` ergänzen, sonst nichts weiter.

- [ ] **Step 2: Failing Route-Test schreiben**

`tests/unit/year-package-route.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { unzipSync, strFromU8 } from "fflate";
import type { Session } from "next-auth";

let currentSession: Session | null;
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => currentSession) }));
vi.mock("@/lib/prisma", () => ({ default: {} }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(async () => {}) }));
vi.mock("@/lib/logger", () => ({
  default: { child: () => ({ error: () => {}, info: () => {}, warn: () => {} }) },
}));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));
vi.mock("@/lib/year-package", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/year-package")>()),
  buildYearPackage: vi.fn(async (_prisma, _year, _now, emit) => {
    await emit({ name: "jahrespaket-2026/journal-2026.csv", data: new TextEncoder().encode("Datum") });
    await emit({ name: "jahrespaket-2026/rechnungen/a.pdf", data: new Uint8Array([1, 2, 3]) });
    return { fileCount: 2, pdfOk: 1, pdfMissing: 0, pdfMismatch: 0, withoutPdf: 0 };
  }),
}));

import { GET } from "@/app/api/export/year-package/route";
import { logAudit } from "@/lib/audit";
import { buildYearPackage } from "@/lib/year-package";

function sessionFor(role: "Admin" | "Editor" | "Viewer"): Session {
  return { user: { id: "1", name: "Test", email: "t@example.com", role }, expires: "2099-01-01" } as Session;
}
const req = (query = "year=2026") => new Request(`http://localhost/api/export/year-package?${query}`);

beforeEach(() => {
  vi.clearAllMocks();
  currentSession = sessionFor("Editor");
});

describe("GET /api/export/year-package", () => {
  it("redirects an unauthenticated request to the login", async () => {
    currentSession = null;
    await expect(GET(req())).rejects.toThrow("REDIRECT:/login");
  });

  it("redirects a viewer to the dashboard", async () => {
    currentSession = sessionFor("Viewer");
    await expect(GET(req())).rejects.toThrow("REDIRECT:/dashboard");
    expect(buildYearPackage).not.toHaveBeenCalled();
  });

  it.each(["", "year=abc", "year=1999", "year=2099"])("answers 400 for %s", async (query) => {
    const res = await GET(req(query));
    expect(res.status).toBe(400);
    expect(buildYearPackage).not.toHaveBeenCalled();
  });

  it("streams a zip with the produced files", async () => {
    const res = await GET(req("year=2026"));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/zip");
    expect(res.headers.get("Content-Disposition")).toBe('attachment; filename="jahrespaket-2026.zip"');

    const files = unzipSync(new Uint8Array(await res.arrayBuffer()));
    expect(Object.keys(files).sort()).toEqual([
      "jahrespaket-2026/journal-2026.csv",
      "jahrespaket-2026/rechnungen/a.pdf",
    ]);
    expect(strFromU8(files["jahrespaket-2026/journal-2026.csv"])).toBe("Datum");
  });

  it("writes an audit entry with the summary", async () => {
    const res = await GET(req("year=2026"));
    await res.arrayBuffer();
    expect(logAudit).toHaveBeenCalledWith(
      currentSession,
      "EXPORT",
      "YearPackage",
      undefined,
      "2026",
      { fileCount: 2, pdfOk: 1, pdfMissing: 0, pdfMismatch: 0, withoutPdf: 0 }
    );
  });

  it("fails the stream when building the package fails", async () => {
    vi.mocked(buildYearPackage).mockRejectedValueOnce(new Error("db down"));
    const res = await GET(req("year=2026"));
    await expect(res.arrayBuffer()).rejects.toThrow("db down");
    expect(logAudit).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Test laufen lassen, muss fehlschlagen**

Run: `npx vitest run tests/unit/year-package-route.test.ts`
Expected: FAIL, `Cannot find module '@/app/api/export/year-package/route'`.

- [ ] **Step 4: Route implementieren**

`app/api/export/year-package/route.ts`:

```ts
import { redirect } from "next/navigation";
import prisma from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { hasRole } from "@/lib/permissions";
import { logAudit } from "@/lib/audit";
import logger from "@/lib/logger";
import { UserRole } from "@prisma/client";
import { buildYearPackage, parseYearParam } from "@/lib/year-package";
import { zipStream } from "@/lib/zip";

const log = logger.child({ module: "api.year-package" });

export async function GET(request: Request) {
  const session = await auth();
  if (!session) redirect("/login");
  if (!hasRole(session, [UserRole.Admin, UserRole.Editor])) redirect("/dashboard");

  const now = new Date();
  const year = parseYearParam(new URL(request.url).searchParams.get("year"), now);
  if (year === null) return Response.json({ error: "Bad Request" }, { status: 400 });

  const stream = zipStream(async (add) => {
    try {
      const summary = await buildYearPackage(prisma, year, now, (entry) =>
        add(entry.name, entry.data, { store: entry.name.endsWith(".pdf") })
      );
      await logAudit(session, "EXPORT", "YearPackage", undefined, String(year), { ...summary });
    } catch (err) {
      log.error({ err, year }, "Year package failed");
      throw err;
    }
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="jahrespaket-${year}.zip"`,
    },
  });
}
```

- [ ] **Step 5: Test laufen lassen, muss grün sein**

Run: `npx vitest run tests/unit/year-package-route.test.ts`
Expected: alles grün. Falls `year=2099` nicht 400 liefert, liegt es an `parseYearParam` (oberes Limit ist `now.getFullYear() + 1`).

- [ ] **Step 6: Typen und Audit-Tests prüfen**

Run: `npx tsc --noEmit && npx vitest run tests/integration/audit-chain.test.ts tests/unit/year-package-route.test.ts`
Expected: grün.

- [ ] **Step 7: Commit**

```bash
git add lib/audit.ts "app/(app)/settings/audit/page.tsx" app/api/export/year-package/route.ts tests/unit/year-package-route.test.ts
git commit -m "feat(export): add year package download route with audit entry

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Button, Doku und Gesamtprüfung

**Files:**
- Modify: `app/(app)/accounting/page.tsx`, `CLAUDE.md`, `README.md`, `FEATURE_ANALYSE.md`

**Interfaces:**
- Consumes: Route aus Task 5.
- Produces: sichtbarer Button "Jahrespaket (ZIP)" neben "CSV-Export".

- [ ] **Step 1: Button einbauen**

In `app/(app)/accounting/page.tsx` nach dem bestehenden "CSV-Export"-Button einfügen:

```tsx
          <Button
            variant="outline"
            render={<a href={`/api/export/year-package?year=${selectedYear}`} download />}
          >
            Jahrespaket (ZIP)
          </Button>
```

- [ ] **Step 2: Doku ergänzen**

`CLAUDE.md`, im Abschnitt "Business document workflow" nach dem Absatz **PDF archive** einfügen:

```
- **Year package** (`lib/year-package.ts`, `lib/zip.ts`, `lib/journal.ts`): `GET /api/export/year-package?year=YYYY` (Admin/Editor) streams a ZIP for the selected year: journal (payments by `Payment.date`, expenses), yearly overview, open items at 31.12. of the previous year and of the year (customer name and address per invoice), the archived PDFs from `SentDocument` (sent in the year, paid in the year, or open at the cut-off), `pruefsummen.csv` and `LIESMICH.txt`. PDFs are read sequentially through `verifyArchived`; a missing or tampered file is left out and reported, never regenerated. The route writes an `EXPORT YearPackage` audit entry after the stream. `zipStream` (fflate) applies backpressure, so the archive does not pile up in memory. No chart of accounts or target format on purpose: there is no trustee (see `FEATURE_ANALYSE.md` F6).
```

`README.md` bei der Zeile mit "CSV-Export" (Zeile 31) ergänzen:

```
- 📤 **CSV-Export** von Kunden, Rechnungen und Offerten sowie ein **Jahrespaket (ZIP)** für die Steuererklärung (Journal, Jahresübersicht, offene Posten, archivierte Rechnungs-PDFs)
```

`FEATURE_ANALYSE.md`: In der Roadmap die Checkbox der Zeile "F6 Jahresabschluss-Paket" abhaken (Muster der bereits erledigten Zeile F5 übernehmen, vorher `grep -n "F6" FEATURE_ANALYSE.md` ausführen) und im Abschnitt F6 eine Zeile "Status: umgesetzt" nach dem Muster von F5 hinzufügen.

- [ ] **Step 3: Gesamtprüfung**

Run: `npx tsc --noEmit && npm run lint && npm test`
Expected: alles grün, keine neuen Lint-Fehler. Erwartete Log-Zeilen wie "deleteInvoice failed" aus bestehenden Tests sind kein Fehler.

- [ ] **Step 4: Manuelle Prüfung im laufenden System**

Run: `npm run dev`, dann als Admin einloggen, unter Buchhaltung ein Jahr mit Daten wählen und "Jahrespaket (ZIP)" klicken.
Expected: Download `jahrespaket-<Jahr>.zip`. Das ZIP entpacken und prüfen: sechs feste Dateien, `rechnungen/` mit PDFs, `pruefsummen.csv` ohne `FEHLT`, Journal öffnet sich in Excel oder LibreOffice korrekt (Umlaute, Kommas in Texten). Danach unter Einstellungen → Aktivitätsprotokoll den Eintrag "Exportiert / YearPackage" und die Kettenprüfung kontrollieren. Ist kein Testdatensatz vorhanden, vorher `npm run db:seed` ausführen und eine Rechnung versenden oder das Testarchiv nutzen. Ist die manuelle Prüfung nicht möglich, das im Abschlussbericht so sagen.

- [ ] **Step 5: Commit**

```bash
git add "app/(app)/accounting/page.tsx" CLAUDE.md README.md FEATURE_ANALYSE.md
git commit -m "feat(accounting): add year package button and document F6

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Self-Review (vom Planautor ausgeführt)

- **Spec-Abdeckung:** Journal mit Beleg-Nr., Kunde, Zahlungsgrund (Task 2). Jahresübersicht mit Kategorien und Debitorenveränderung (Task 4 `overviewCsv`). OP-Listen zu beiden Stichtagen, mit Adresse, laufendes Jahr = heute (Task 3, Task 4 `stichtage`). PDF-Auswahl in drei Kriterien und Duplikate nur einmal (Task 4 `selectDocuments`, Test "selects PDFs…"). Mängel bricht nicht ab, `FEHLT` / `HASH ABWEICHEND` / `ohne archiviertes PDF` (Task 4, Tests). `LIESMICH.txt` mit Lücken und 10-Jahres-Hinweis (Task 4 `readme`). Rolle und 400 bei ungültigem Jahr, Audit `EXPORT YearPackage`, Stream mit Backpressure (Task 1 und 5). Button, Doku (Task 6). Regression der bestehenden Exporte: beide Routen nutzen die neuen Bausteine (Task 2 und 3), Typcheck und Tests in den jeweiligen Schritten.
- **Platzhalter:** keine. Der Hinweis zur Entitätenliste im Audit-Seitenfile (Task 5 Schritt 1) ist eine bedingte Anweisung mit klarem Suchkriterium, keine offene Stelle.
- **Typkonsistenz:** `ZipAdd`, `PackageEntry`, `PackageSummary`, `JournalRow`, `ReceivableRow.customerAddress`, `stichtage`, `overviewCsv` und `parseYearParam` haben in allen Tasks dieselben Namen und Signaturen. `overviewCsv(journal, prev, end, prevLabel, endLabel)` stimmt mit dem Aufruf in `buildYearPackage` überein.
