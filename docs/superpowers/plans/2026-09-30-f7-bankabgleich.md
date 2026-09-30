# F7 Bankabgleich 2.0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** CAMT.053-Import speichert Bankbewegungen (Duplikatschutz, Saldoprüfung), erkennt Rechnungszahlungen robuster und übernimmt angekreuzte Abbuchungen als `Expense`.

**Architecture:** Zwei neue Tabellen (`BankStatementImport`, `BankTransaction`). Reine Logik (Fingerprint, Saldoprüfung, Matching, Ausgaben-Hinweise) liegt in `lib/import/*` und ist unit-getestet. Ein Service `lib/import/bank-import.ts` kapselt die Datenbankzugriffe, die Server Actions in `app/(app)/invoices/import/actions.ts` rufen ihn auf und buchen über das bestehende `recordPayment` bzw. legen `Expense`-Zeilen an. Die Seite liest die offenen Bewegungen aus der DB statt aus dem Ergebnis des letzten Uploads.

**Tech Stack:** Next.js 16 (Server Actions), Prisma 7 + SQLite, Vitest, shadcn/ui (base-ui), fast-xml-parser.

**Spec:** `docs/superpowers/specs/2026-09-30-f7-bankabgleich-design.md`

## Global Constraints

- UI-Texte, Fehlermeldungen und Doku sind **auf Deutsch**. Code, Kommentare und Commit-Messages sind **auf Englisch** (Conventional Commits, z. B. `feat(import): …`).
- Beträge in Rappen als `Int` (`amountRappen`, `amountCents` in Parsern). Datenbank-Beträge von `Payment`/`Expense` sind `Decimal` in Franken.
- Migrationen sind reines SQL (Produktion wendet sie via `scripts/startup.js` ohne Prisma CLI an). Tests bauen die DB mit `prisma db push` aus `schema.prisma`.
- `logAudit`/`logAuditEntry` nie innerhalb eines `$transaction`-Callbacks aufrufen. Nie direkt `prisma.auditLog.create`.
- Alle Actions beginnen mit `requireEditor()`.
- Zustand einer Bewegung ist abgeleitet: offen = `paymentId`, `expenseId` leer und `ignored = false`. Kein Statusfeld.
- Keine Ausgabe ohne ausdrückliche Wahl: Ausgaben sind nur vorausgewählt, wenn die normalisierte Gegenpartei schon eine übernommene Ausgabe hat.
- Vor jedem Commit: `npx vitest run <betroffene Dateien>`; am Ende `npm test`, `npm run lint`, `npm run build`.
- Git-Commits enden mit `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.

## File Structure

| Datei | Verantwortung |
|---|---|
| `prisma/schema.prisma`, `prisma/migrations/<ts>_bank_transactions/migration.sql` | Modelle `BankStatementImport`, `BankTransaction` |
| `tests/test-utils.ts` | Aufräumen der neuen Tabellen |
| `lib/audit.ts` | `AuditEntity` um `BankStatementImport` erweitern |
| `lib/import/dedupe.ts` (neu) | Normalisierung und Fingerprints |
| `lib/import/statement-checks.ts` | zusätzlich Saldo-Vollständigkeit und -Kontinuität |
| `lib/import/document-reference.ts` | tolerantere Erkennung der Rechnungsnummer |
| `lib/import/matching.ts` | generisch über Bewegungstyp, Kundenname als Kandidat |
| `lib/import/bank-import.ts` (neu) | DB-Service: Import, Rückgängig, offene Bewegungen, Ausgaben-Hinweise |
| `lib/import/queries.ts` (neu) | Daten für die Seite (offene Rechnungen, Zuordnungen, Verlauf) |
| `app/(app)/invoices/import/actions.ts` | `uploadStatement`, `bookPayments`, `bookExpenses`, `ignoreTransactions`, `undoStatementImport` |
| `app/(app)/invoices/import/page.tsx`, `ImportWizard.tsx`, `IncomingTable.tsx`, `ExpensesTable.tsx`, `ImportHistory.tsx` | Oberfläche |
| `app/(app)/invoices/actions.ts` | `markInvoicesPaidFromImport`, `ImportMatch`, `ImportMatchResult` entfernen |
| `app/api/external/payments/route.ts`, `lib/payment-matching.ts` | optionales `bankReference` |
| `CLAUDE.md`, `public/benutzerhandbuch.html`, `FEATURE_ANALYSE.md` | Doku |

---

### Task 1: Schema, Migration, Test-Aufräumen, Audit-Entität

**Files:**
- Modify: `prisma/schema.prisma` (am Ende der Modelle, plus Rückrelationen in `Payment` und `Expense`)
- Create: `prisma/migrations/<timestamp>_bank_transactions/migration.sql` (vom Prisma-CLI erzeugt)
- Modify: `tests/test-utils.ts:49-70`
- Modify: `lib/audit.ts:10`

**Interfaces:**
- Produces: Prisma-Modelle `bankStatementImport` und `bankTransaction` mit den Feldern aus dem Spec. `BankTransaction.statementImport` (Relation), `BankTransaction.payment`, `BankTransaction.expense`. `AuditEntity` enthält `"BankStatementImport"`.

- [ ] **Step 1: Modelle in `prisma/schema.prisma` ergänzen**

In `model Payment` nach der Zeile `invoice       Invoice  @relation(...)` einfügen:

```prisma
  bankTransaction BankTransaction?
```

In `model Expense` nach der Zeile `category    Category? @relation(...)` einfügen:

```prisma
  bankTransaction BankTransaction?
```

Am Ende der Datei anhängen:

```prisma
model BankStatementImport {
  id                   Int       @id @default(autoincrement())
  filename             String
  iban                 String?
  currency             String?
  periodFrom           String?   // YYYY-MM-DD
  periodTo             String?   // YYYY-MM-DD
  openingBalanceRappen Int?
  closingBalanceRappen Int?
  /// Balance warnings shown at upload time, kept for the import history.
  balanceWarning       String?
  importedCount        Int
  skippedCount         Int
  userId               Int?
  createdAt            DateTime  @default(now())
  transactions         BankTransaction[]

  @@index([createdAt])
  @@index([iban, periodTo])
}

/// One booked entry of an imported CAMT.053 statement. Open = no payment,
/// no expense and not ignored; there is deliberately no status column that
/// could disagree with the payments (deleting a Payment/Expense sets the
/// link to null and the row is open again).
model BankTransaction {
  id            Int      @id @default(autoincrement())
  importId      Int
  fingerprint   String   @unique
  date          DateTime
  /// Signed Rappen: negative = money out.
  amountRappen  Int
  description   String
  counterparty  String?
  bankReference String?
  ignored       Boolean  @default(false)
  paymentId     Int?     @unique
  expenseId     Int?     @unique
  createdAt     DateTime @default(now())

  statementImport BankStatementImport @relation(fields: [importId], references: [id], onDelete: Restrict)
  payment         Payment?            @relation(fields: [paymentId], references: [id], onDelete: SetNull)
  expense         Expense?            @relation(fields: [expenseId], references: [id], onDelete: SetNull)

  @@index([importId])
  @@index([date])
}
```

- [ ] **Step 2: Migration erzeugen und anwenden**

Run: `npx prisma migrate dev --name bank_transactions`
Expected: neuer Ordner `prisma/migrations/<timestamp>_bank_transactions/` mit `CREATE TABLE "BankStatementImport"`, `CREATE TABLE "BankTransaction"`, `CREATE UNIQUE INDEX "BankTransaction_fingerprint_key"`, `..._paymentId_key`, `..._expenseId_key`. Die Migration wurde auf die lokale DB angewendet und der Prisma Client neu generiert.

Prüfen: `grep -c "BankTransaction" prisma/migrations/*_bank_transactions/migration.sql` liefert eine Zahl > 0.

- [ ] **Step 3: Test-Aufräumen ergänzen**

In `tests/test-utils.ts`, in `beforeEach`, direkt nach `await p.auditLog.deleteMany();` einfügen:

```ts
    await p.bankTransaction.deleteMany();
    await p.bankStatementImport.deleteMany();
```

- [ ] **Step 4: Audit-Entität ergänzen**

In `lib/audit.ts` Zeile 10 `| "SentDocument"` ersetzen durch `| "SentDocument" | "BankStatementImport"`.

- [ ] **Step 5: Bestehende Tests laufen lassen**

Run: `npx vitest run tests/integration/payments.test.ts tests/integration/camt-import-payments.test.ts`
Expected: PASS (Schema-Änderung ist rein additiv).

- [ ] **Step 6: Commit**

```bash
git add prisma tests/test-utils.ts lib/audit.ts
git commit -m "feat(import): add BankStatementImport and BankTransaction models

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Fingerprint (`lib/import/dedupe.ts`)

**Files:**
- Create: `lib/import/dedupe.ts`
- Test: `tests/unit/import-dedupe.test.ts`

**Interfaces:**
- Consumes: `ParsedTransaction` aus `@/lib/import/types`.
- Produces:
  - `normalize(value: string | null): string` (klein, Leerraum gekürzt)
  - `fingerprint(iban: string | null, transaction: ParsedTransaction, occurrence: number): string` (SHA-256 hex)
  - `withFingerprints(iban: string | null, transactions: ParsedTransaction[]): Array<ParsedTransaction & { fingerprint: string }>`

- [ ] **Step 1: Failing Test schreiben** (`tests/unit/import-dedupe.test.ts`)

```ts
import { describe, expect, it } from "vitest";
import { fingerprint, normalize, withFingerprints } from "@/lib/import/dedupe";
import type { ParsedTransaction } from "@/lib/import/types";

function tx(overrides: Partial<ParsedTransaction> = {}): ParsedTransaction {
  return {
    date: "2026-03-01",
    amountCents: -450,
    description: "Kaffee",
    counterparty: "Bäckerei",
    bankReference: null,
    ...overrides,
  };
}

const IBAN = "CH93 0076 2011 6238 5295 7";

describe("normalize", () => {
  it("lowercases and collapses whitespace", () => {
    expect(normalize("  Hallo   WELT ")).toBe("hallo welt");
    expect(normalize(null)).toBe("");
  });
});

describe("fingerprint", () => {
  it("lets the bank reference dominate the hash", () => {
    const a = fingerprint(IBAN, tx({ bankReference: "REF-1", description: "A" }), 0);
    const b = fingerprint(IBAN, tx({ bankReference: "REF-1", description: "B", amountCents: -1 }), 5);
    expect(a).toBe(b);
  });

  it("differs per IBAN and ignores IBAN spacing and case", () => {
    const base = tx({ bankReference: "REF-1" });
    expect(fingerprint(IBAN, base, 0)).toBe(fingerprint("ch9300762011623852957", base, 0));
    expect(fingerprint(IBAN, base, 0)).not.toBe(fingerprint("CH5604835012345678009", base, 0));
  });

  it("without a reference depends on date, amount, text, counterparty and occurrence", () => {
    const base = fingerprint(IBAN, tx(), 0);
    expect(base).toBe(fingerprint(IBAN, tx({ description: "  KAFFEE " }), 0));
    expect(base).not.toBe(fingerprint(IBAN, tx({ date: "2026-03-02" }), 0));
    expect(base).not.toBe(fingerprint(IBAN, tx({ amountCents: -451 }), 0));
    expect(base).not.toBe(fingerprint(IBAN, tx({ counterparty: "Metzger" }), 0));
    expect(base).not.toBe(fingerprint(IBAN, tx(), 1));
  });
});

describe("withFingerprints", () => {
  it("numbers identical bookings so both import, and is stable across runs", () => {
    const list = [tx(), tx(), tx({ description: "Anderes" })];
    const first = withFingerprints(IBAN, list);
    const second = withFingerprints(IBAN, list);
    expect(first[0].fingerprint).not.toBe(first[1].fingerprint);
    expect(first.map((t) => t.fingerprint)).toEqual(second.map((t) => t.fingerprint));
    expect(new Set(first.map((t) => t.fingerprint)).size).toBe(3);
  });

  it("counts only reference-less rows, so a referenced twin does not shift the counter", () => {
    const plain = tx();
    const withRef = tx({ bankReference: "REF-9" });
    const [alone] = withFingerprints(IBAN, [plain]);
    const [, afterTwin] = withFingerprints(IBAN, [withRef, plain]);
    expect(afterTwin.fingerprint).toBe(alone.fingerprint);
  });

  it("keeps the parsed fields", () => {
    const [first] = withFingerprints(IBAN, [tx({ bankReference: "R" })]);
    expect(first.description).toBe("Kaffee");
    expect(first.bankReference).toBe("R");
  });
});
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag prüfen**

Run: `npx vitest run tests/unit/import-dedupe.test.ts`
Expected: FAIL (`Cannot find module '@/lib/import/dedupe'`).

- [ ] **Step 3: Implementierung** (`lib/import/dedupe.ts`)

```ts
import { createHash } from "crypto";
import type { ParsedTransaction } from "@/lib/import/types";

/**
 * Duplicate detection for statement imports. Statements overlap in practice
 * (a month is downloaded twice, period boundaries touch), so the same
 * movement must never be stored twice. The fingerprint is kept in
 * `BankTransaction.fingerprint` under a unique index, which makes the
 * database the last line of defence for concurrent uploads.
 *
 * Same scheme as the Budget app's `lib/import/dedupe.ts`: the bank reference
 * dominates when present; otherwise the hash includes an occurrence counter
 * so two genuinely identical bookings on one day (two CHF 4.50 coffees) both
 * import, while re-importing the same file skips both.
 */

/** Normalises free text so trivial formatting differences don't defeat matching. */
export function normalize(value: string | null): string {
  return (value ?? "").toLowerCase().replace(/\s+/g, " ").trim();
}

const normalizeIban = (iban: string | null) => (iban ?? "").replace(/\s/g, "").toUpperCase();

export function fingerprint(
  iban: string | null,
  transaction: ParsedTransaction,
  occurrence: number
): string {
  const parts = transaction.bankReference
    ? [normalizeIban(iban), transaction.bankReference.trim()]
    : [
        normalizeIban(iban),
        transaction.date,
        transaction.amountCents,
        normalize(transaction.description),
        normalize(transaction.counterparty),
        occurrence,
      ];
  return createHash("sha256").update(parts.join("|")).digest("hex");
}

/** Attaches a fingerprint to every transaction, numbering identical ones in reading order. */
export function withFingerprints(
  iban: string | null,
  transactions: ParsedTransaction[]
): Array<ParsedTransaction & { fingerprint: string }> {
  const seen = new Map<string, number>();
  return transactions.map((transaction) => {
    const key = [
      transaction.date,
      transaction.amountCents,
      normalize(transaction.description),
      normalize(transaction.counterparty),
    ].join("|");
    // Rows with a bank reference are fingerprinted by it and must not shift
    // the counter of reference-less twins (another export may omit the reference).
    let occurrence = 0;
    if (!transaction.bankReference) {
      occurrence = seen.get(key) ?? 0;
      seen.set(key, occurrence + 1);
    }
    return { ...transaction, fingerprint: fingerprint(iban, transaction, occurrence) };
  });
}
```

- [ ] **Step 4: Test laufen lassen**

Run: `npx vitest run tests/unit/import-dedupe.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/import/dedupe.ts tests/unit/import-dedupe.test.ts
git commit -m "feat(import): add bank transaction fingerprints

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Saldoprüfung (`lib/import/statement-checks.ts`)

**Files:**
- Modify: `lib/import/statement-checks.ts` (Funktionen anhängen)
- Test: `tests/unit/import-statement-checks.test.ts`

**Interfaces:**
- Produces:
  - `checkBalanceCompleteness(statement: { openingBalanceCents: number | null; closingBalanceCents: number | null; transactions: { amountCents: number }[] }): string[]`
  - `checkBalanceContinuity(openingBalanceCents: number | null, previous: { closingBalanceRappen: number | null; periodTo: string | null } | null): string[]`

- [ ] **Step 1: Failing Test schreiben** (`tests/unit/import-statement-checks.test.ts`)

```ts
import { describe, expect, it } from "vitest";
import { checkBalanceCompleteness, checkBalanceContinuity } from "@/lib/import/statement-checks";

describe("checkBalanceCompleteness", () => {
  const base = { openingBalanceCents: 100000, closingBalanceCents: 99550 };

  it("passes when opening plus movements equals closing", () => {
    expect(
      checkBalanceCompleteness({ ...base, transactions: [{ amountCents: -450 }] })
    ).toEqual([]);
  });

  it("warns with the difference when the statement is incomplete", () => {
    const [warning] = checkBalanceCompleteness({
      ...base,
      transactions: [{ amountCents: -200 }],
    });
    expect(warning).toContain("Saldo");
    expect(warning).toContain("2.50");
  });

  it("skips the check when a balance is missing", () => {
    expect(
      checkBalanceCompleteness({ openingBalanceCents: null, closingBalanceCents: 1, transactions: [] })
    ).toEqual([]);
    expect(
      checkBalanceCompleteness({ openingBalanceCents: 1, closingBalanceCents: null, transactions: [] })
    ).toEqual([]);
  });
});

describe("checkBalanceContinuity", () => {
  it("passes when the opening balance equals the previous closing balance", () => {
    expect(
      checkBalanceContinuity(5000, { closingBalanceRappen: 5000, periodTo: "2026-02-28" })
    ).toEqual([]);
  });

  it("warns that a period may be missing when they differ", () => {
    const [warning] = checkBalanceContinuity(5000, {
      closingBalanceRappen: 4000,
      periodTo: "2026-02-28",
    });
    expect(warning).toContain("fehlt");
    expect(warning).toContain("10.00");
  });

  it("does nothing without a previous import or opening balance", () => {
    expect(checkBalanceContinuity(5000, null)).toEqual([]);
    expect(
      checkBalanceContinuity(null, { closingBalanceRappen: 1, periodTo: null })
    ).toEqual([]);
    expect(
      checkBalanceContinuity(5000, { closingBalanceRappen: null, periodTo: null })
    ).toEqual([]);
  });
});
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag prüfen**

Run: `npx vitest run tests/unit/import-statement-checks.test.ts`
Expected: FAIL (Funktionen nicht exportiert).

- [ ] **Step 3: Implementierung** – ans Ende von `lib/import/statement-checks.ts` anhängen:

```ts

const chf = (cents: number) => (Math.abs(cents) / 100).toFixed(2);

/**
 * Opening balance plus all movements must equal the closing balance,
 * otherwise entries are missing from (or were skipped in) the file.
 */
export function checkBalanceCompleteness(statement: {
  openingBalanceCents: number | null;
  closingBalanceCents: number | null;
  transactions: { amountCents: number }[];
}): string[] {
  if (statement.openingBalanceCents === null || statement.closingBalanceCents === null) return [];
  const sum = statement.transactions.reduce((total, t) => total + t.amountCents, 0);
  const difference = statement.closingBalanceCents - (statement.openingBalanceCents + sum);
  if (difference === 0) return [];
  return [
    `Saldoprüfung: Anfangssaldo plus Bewegungen ergibt nicht den Endsaldo (Differenz CHF ${chf(difference)}). Der Kontoauszug ist vermutlich unvollständig.`,
  ];
}

/**
 * The opening balance should continue where the previous import for the same
 * account ended; a gap usually means a month was never imported.
 */
export function checkBalanceContinuity(
  openingBalanceCents: number | null,
  previous: { closingBalanceRappen: number | null; periodTo: string | null } | null
): string[] {
  if (openingBalanceCents === null || !previous || previous.closingBalanceRappen === null) {
    return [];
  }
  if (openingBalanceCents === previous.closingBalanceRappen) return [];
  const difference = openingBalanceCents - previous.closingBalanceRappen;
  return [
    `Der Anfangssaldo weicht vom Endsaldo des letzten Imports${previous.periodTo ? ` (bis ${previous.periodTo})` : ""} ab (Differenz CHF ${chf(difference)}). Möglicherweise fehlt ein Zeitraum.`,
  ];
}
```

- [ ] **Step 4: Test laufen lassen**

Run: `npx vitest run tests/unit/import-statement-checks.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/import/statement-checks.ts tests/unit/import-statement-checks.test.ts
git commit -m "feat(import): check statement balances for completeness and continuity

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Robusteres Matching (Nummer, Kundenname)

**Files:**
- Modify: `lib/import/document-reference.ts`
- Modify: `lib/import/matching.ts`
- Test: `tests/unit/import-document-reference.test.ts` (neu), `tests/unit/import-matching.test.ts` (ergänzen)

**Interfaces:**
- Produces:
  - `extractDocumentNumberCandidates(description: string, prefix: string): string[]` – liefert **kanonische** Nummern `prefix + 8 Ziffern` (auch wenn der Text Leerzeichen/Trennzeichen enthält oder das Präfix fehlt). Wird weiterhin von `lib/payment-matching.ts` genutzt.
  - `OpenInvoice` bekommt `customerNames?: string[]`.
  - `MatchConfidence = "reference" | "amount" | "name" | "none"`.
  - `matchStatementToInvoices<T extends ParsedTransaction>(transactions: T[], openInvoices: OpenInvoice[], prefix: string): MatchedTransaction<T>[]`; `MatchedTransaction<T>.transaction: T`.

- [ ] **Step 1: Failing Tests für die Nummernerkennung** (`tests/unit/import-document-reference.test.ts`)

```ts
import { describe, expect, it } from "vitest";
import { extractDocumentNumberCandidates } from "@/lib/import/document-reference";

const P = "I-";

describe("extractDocumentNumberCandidates", () => {
  it("finds the canonical number in plain text", () => {
    expect(extractDocumentNumberCandidates("Zahlung I-26010042 danke", P)).toEqual(["I-26010042"]);
  });

  it("normalises case", () => {
    expect(extractDocumentNumberCandidates("rechnung i-26010042", P)).toEqual(["I-26010042"]);
  });

  it("tolerates spaces and separators between prefix and digits", () => {
    expect(extractDocumentNumberCandidates("Rg I 26010042", P)).toEqual(["I-26010042"]);
    expect(extractDocumentNumberCandidates("Rg I-2601 0042", P)).toEqual(["I-26010042"]);
    expect(extractDocumentNumberCandidates("Rg I-2601.0042", P)).toEqual(["I-26010042"]);
  });

  it("accepts the eight digits without the prefix when delimited", () => {
    expect(extractDocumentNumberCandidates("Rechnung 26010042 vom Januar", P)).toEqual(["I-26010042"]);
  });

  it("does not take eight digits out of a longer digit run", () => {
    expect(extractDocumentNumberCandidates("CH9300762011623852957", P)).toEqual([]);
    expect(extractDocumentNumberCandidates("Ref 1260100421", P)).toEqual([]);
  });

  it("does not match a prefix that is the tail of another word", () => {
    expect(extractDocumentNumberCandidates("BILDI-26010042", P)).toEqual([]);
  });

  it("does not take the digits of another document type such as a quote number", () => {
    expect(extractDocumentNumberCandidates("Offerte Q-26010003", P)).toEqual([]);
    expect(extractDocumentNumberCandidates("Offerte Q26010003", P)).toEqual([]);
  });

  it("returns each number once, prefix form first", () => {
    expect(
      extractDocumentNumberCandidates("I-26010042 und 26010042 sowie I-26010099", P)
    ).toEqual(["I-26010042", "I-26010099"]);
  });
});
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag prüfen**

Run: `npx vitest run tests/unit/import-document-reference.test.ts`
Expected: FAIL (mehrere Fälle, z. B. Leerzeichen und Ziffern ohne Präfix).

- [ ] **Step 3: Implementierung** – `lib/import/document-reference.ts` komplett ersetzen:

```ts
/**
 * Invoice numbers (`<prefix><8 digits>`) mentioned in a free-text payment
 * description, returned in canonical form (`prefix` + digits).
 *
 * Payers retype the QR-bill reference, so the match is tolerant: any case,
 * whitespace/dots/dashes between prefix and digits or inside the digits, and
 * the bare eight digits without the prefix. The result is only ever used to
 * look up real open invoices, so a false candidate is harmless unless it
 * equals an existing number.
 *
 * Pure and prefix-driven, with no import of `@/lib/prisma` or anything else
 * heavy — shared by the automatic Budget-import matcher
 * (`lib/payment-matching.ts`) and the interactive CAMT-import preview
 * (`lib/import/matching.ts`).
 */

const SEPARATOR = "[\\s.\\-_]";

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function extractDocumentNumberCandidates(description: string, prefix: string): string[] {
  const found: string[] = [];
  const add = (digits: string) => {
    const number = `${prefix}${digits.replace(/\D/g, "")}`;
    if (!found.includes(number)) found.push(number);
  };

  // Separators in the configured prefix ("I-") are optional in the text.
  const prefixChars = Array.from(prefix.replace(/[\s.\-_]+/g, ""));
  if (prefixChars.length > 0) {
    const withPrefix = new RegExp(
      `(?<![A-Za-z0-9])${prefixChars.map(escapeRegex).join(`${SEPARATOR}*`)}${SEPARATOR}*(\\d(?:${SEPARATOR}?\\d){7})(?!\\d)`,
      "gi"
    );
    for (const match of description.matchAll(withPrefix)) add(match[1]);
  }

  // Bare digits: delimited by non-digits and not directly behind a letter
  // ("Q-26010003" is a quote number, not an invoice number).
  for (const match of description.matchAll(/(?<![A-Za-z][.\-_]?)(?<!\d)\d{8}(?!\d)/g)) add(match[0]);

  return found;
}
```

- [ ] **Step 4: Test laufen lassen**

Run: `npx vitest run tests/unit/import-document-reference.test.ts tests/unit/import-matching.test.ts tests/integration/payment-matching.test.ts`
Expected: Neue Tests PASS. Die bestehenden Matching-Tests bleiben PASS (kanonische Nummer wird case-insensitive verglichen). Schlägt ein bestehender Test fehl, weil er das alte „Text wie getippt“-Format erwartete, den Test auf die kanonische Form anpassen und den Grund im Commit nennen.

- [ ] **Step 5: Failing Tests für das Matching ergänzen** – in `tests/unit/import-matching.test.ts` innerhalb des `describe("matchStatementToInvoices", …)` einfügen:

```ts
  it("recognises the number with spaces and without the prefix", () => {
    const [spaced] = matchStatementToInvoices(
      [tx({ description: "Rg I 2601 0042" })],
      [INVOICE_A],
      PREFIX
    );
    expect(spaced.confidence).toBe("reference");
    expect(spaced.preselectedInvoiceId).toBe(1);

    const [bare] = matchStatementToInvoices(
      [tx({ description: "Rechnung 26010042" })],
      [INVOICE_A],
      PREFIX
    );
    expect(bare.preselectedInvoiceId).toBe(1);
  });

  it("suggests the invoices of a customer named in the counterparty, but never pre-selects", () => {
    const invoice: OpenInvoice = {
      id: 7,
      documentNumber: "I-26010077",
      openAmount: 500,
      customerNames: ["Müller Bau AG", "Hans Müller"],
    };
    const [result] = matchStatementToInvoices(
      [tx({ amountCents: 40000, description: "Überweisung", counterparty: "MUELLER BAU AG" })],
      [invoice],
      PREFIX
    );
    // "MUELLER" vs "Müller" differ after normalisation; use the exact spelling below.
    expect(result.confidence).toBe("none");

    const [hit] = matchStatementToInvoices(
      [tx({ amountCents: 40000, description: "Überweisung", counterparty: "Müller Bau AG" })],
      [invoice],
      PREFIX
    );
    expect(hit.confidence).toBe("name");
    expect(hit.preselectedInvoiceId).toBeNull();
    expect(hit.candidates).toEqual([{ invoiceId: 7, documentNumber: "I-26010077" }]);
  });

  it("puts amount matches of the named customer first", () => {
    const named = (id: number, number: string, open: number): OpenInvoice => ({
      id,
      documentNumber: number,
      openAmount: open,
      customerNames: ["Acme GmbH"],
    });
    const [result] = matchStatementToInvoices(
      [tx({ amountCents: 20000, description: "Zahlung", counterparty: "Acme GmbH" })],
      [named(1, "I-26010001", 300), named(2, "I-26010002", 200)],
      PREFIX
    );
    expect(result.confidence).toBe("amount");
    expect(result.candidates.map((c) => c.invoiceId)).toEqual([2, 1]);
  });

  it("ignores very short customer names", () => {
    const [result] = matchStatementToInvoices(
      [tx({ amountCents: 1, description: "x", counterparty: "AG Bank" })],
      [{ id: 3, documentNumber: "I-26010003", openAmount: 9, customerNames: ["AG"] }],
      PREFIX
    );
    expect(result.confidence).toBe("none");
  });
```

Hinweis: Der erste Fall im Namen-Test (`MUELLER`) dokumentiert, dass nur diakritische Zeichen, Gross-/Kleinschreibung und Satzzeichen normalisiert werden, keine Umschreibung ü→ue.

- [ ] **Step 6: Test laufen lassen, Fehlschlag prüfen**

Run: `npx vitest run tests/unit/import-matching.test.ts`
Expected: FAIL (`customerNames` unbekannt / `"name"` nicht vorhanden).

- [ ] **Step 7: Implementierung** – `lib/import/matching.ts` komplett ersetzen:

```ts
import type { ParsedTransaction } from "@/lib/import/types";
import { extractDocumentNumberCandidates } from "@/lib/import/document-reference";

/**
 * Matches CAMT.053 statement entries to open invoices, so a bank export can
 * be reviewed and confirmed as payments without a bookkeeping ledger.
 *
 * Signals, strongest first:
 *  - the invoice number in the text (`extractDocumentNumberCandidates`, tolerant
 *    of spaces and a missing prefix) together with the open amount → pre-selected;
 *  - the open amount alone, or the number with a different amount → manual pick;
 *  - the customer's name in the counterparty → suggestion only, never pre-selected.
 */

export interface OpenInvoice {
  id: number;
  documentNumber: string;
  /** Francs still open: total minus recorded payments. */
  openAmount: number;
  /** Names the customer may appear under on a statement (company, contact person). */
  customerNames?: string[];
}

export interface MatchCandidate {
  invoiceId: number;
  documentNumber: string;
}

export type MatchConfidence = "reference" | "amount" | "name" | "none";

export interface MatchedTransaction<T extends ParsedTransaction = ParsedTransaction> {
  transaction: T;
  candidates: MatchCandidate[];
  confidence: MatchConfidence;
  /** Invoice id to pre-check in the preview, only set when confidence is "reference". */
  preselectedInvoiceId: number | null;
}

const MIN_NAME_LENGTH = 4;

function centsOf(francs: number): number {
  return Math.round(francs * 100);
}

function toCandidate(invoice: OpenInvoice): MatchCandidate {
  return { invoiceId: invoice.id, documentNumber: invoice.documentNumber };
}

/** Lowercase, without diacritics or punctuation, single-spaced. */
function nameKey(value: string | null | undefined): string {
  return (value ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function mentionsCustomer(counterparty: string | null, invoice: OpenInvoice): boolean {
  const haystack = ` ${nameKey(counterparty)} `;
  if (haystack.trim() === "") return false;
  return (invoice.customerNames ?? []).some((name) => {
    const key = nameKey(name);
    return key.length >= MIN_NAME_LENGTH && haystack.includes(` ${key} `);
  });
}

function findReferencedInvoice(
  transaction: ParsedTransaction,
  openInvoices: OpenInvoice[],
  prefix: string
): OpenInvoice | null {
  const haystack = `${transaction.description} ${transaction.counterparty ?? ""}`;
  for (const documentNumber of extractDocumentNumberCandidates(haystack, prefix)) {
    const invoice = openInvoices.find(
      (inv) => inv.documentNumber.toUpperCase() === documentNumber.toUpperCase()
    );
    if (invoice) return invoice;
  }
  return null;
}

/**
 * Matches every incoming (credit) entry against the given open invoices
 * (callers pass invoices with `state` in `Sent`/`Overdue`/`PartiallyPaid`
 * only). Outgoing entries are dropped — they can never be an invoice payment.
 * `prefix` is `ApplicationSettings.invoiceNumberPrefix`.
 */
export function matchStatementToInvoices<T extends ParsedTransaction>(
  transactions: T[],
  openInvoices: OpenInvoice[],
  prefix: string
): MatchedTransaction<T>[] {
  return transactions
    .filter((transaction) => transaction.amountCents > 0)
    .map((transaction): MatchedTransaction<T> => {
      const referenced = findReferencedInvoice(transaction, openInvoices, prefix);
      const amountMatches = openInvoices.filter(
        (invoice) => centsOf(invoice.openAmount) === transaction.amountCents
      );
      const nameMatches = openInvoices.filter((invoice) =>
        mentionsCustomer(transaction.counterparty, invoice)
      );

      // Number and amount line up on the same invoice: safe to pre-select,
      // the user only has to confirm.
      if (referenced && centsOf(referenced.openAmount) === transaction.amountCents) {
        return {
          transaction,
          candidates: [toCandidate(referenced)],
          confidence: "reference",
          preselectedInvoiceId: referenced.id,
        };
      }

      const namedIds = new Set(nameMatches.map((invoice) => invoice.id));
      // Amount matches of a customer named in the text come first.
      const orderedAmount = [
        ...amountMatches.filter((invoice) => namedIds.has(invoice.id)),
        ...amountMatches.filter((invoice) => !namedIds.has(invoice.id)),
      ];
      const strong = referenced
        ? [referenced, ...orderedAmount.filter((invoice) => invoice.id !== referenced.id)]
        : orderedAmount;

      if (strong.length > 0) {
        const rest = nameMatches.filter((invoice) => !strong.some((s) => s.id === invoice.id));
        return {
          transaction,
          candidates: [...strong, ...rest].map(toCandidate),
          confidence: "amount",
          preselectedInvoiceId: null,
        };
      }

      if (nameMatches.length > 0) {
        return {
          transaction,
          candidates: nameMatches.map(toCandidate),
          confidence: "name",
          preselectedInvoiceId: null,
        };
      }

      return { transaction, candidates: [], confidence: "none", preselectedInvoiceId: null };
    });
}
```

- [ ] **Step 8: Test laufen lassen**

Run: `npx vitest run tests/unit/import-matching.test.ts tests/unit/import-document-reference.test.ts`
Expected: PASS. Hinweis: Der Test „suggests the invoices of a customer …" erwartet für `"MUELLER BAU AG"` `none`, weil `nameKey("Müller Bau AG")` = `muller bau ag` ≠ `mueller bau ag`.

- [ ] **Step 9: Commit**

```bash
git add lib/import tests/unit/import-matching.test.ts tests/unit/import-document-reference.test.ts
git commit -m "feat(import): tolerant invoice number detection and customer name suggestions

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Service `lib/import/bank-import.ts`

**Files:**
- Create: `lib/import/bank-import.ts`
- Test: `tests/unit/import-expense-hints.test.ts` (rein), `tests/integration/bank-import.test.ts` (DB)

**Interfaces:**
- Consumes: `withFingerprints` (Task 2), `checkBalanceCompleteness`/`checkBalanceContinuity` (Task 3), `normalize` (Task 2), `logAudit`, `ParsedStatement`.
- Produces:
  - `class BankImportError extends Error`
  - `importStatement(params: { statement: ParsedStatement; filename: string; actor: Session }, prisma?: PrismaClient): Promise<{ importId: number | null; importedCount: number; skippedCount: number; warnings: string[] }>` – `warnings` = Saldowarnungen. `importId` ist `null`, wenn nichts Neues importiert wurde.
  - `undoImport(params: { importId: number; actor: Session }, prisma?): Promise<void>` – wirft `BankImportError`, wenn schon etwas verbucht ist.
  - `interface OpenTransaction { id: number; date: string; amountCents: number; description: string; counterparty: string | null; bankReference: string | null }`
  - `listOpenTransactions(prisma?): Promise<OpenTransaction[]>`
  - `interface ExpenseHint { preselect: boolean; categoryId: number | null; previouslyIgnored: boolean }`
  - `interface CounterpartyHistoryRow { counterparty: string; ignored: boolean; hasExpense: boolean; expenseCategoryId: number | null }` (Eingabe neueste zuerst)
  - `buildExpenseHints(open: OpenTransaction[], history: CounterpartyHistoryRow[]): Record<number, ExpenseHint>` (rein, Schlüssel = Bewegungs-ID)
  - `expenseHints(open: OpenTransaction[], prisma?): Promise<Record<number, ExpenseHint>>`

- [ ] **Step 1: Failing Test für die Ausgaben-Hinweise** (`tests/unit/import-expense-hints.test.ts`)

```ts
import { describe, expect, it } from "vitest";
import {
  buildExpenseHints,
  type CounterpartyHistoryRow,
  type OpenTransaction,
} from "@/lib/import/bank-import";

function open(id: number, counterparty: string | null): OpenTransaction {
  return {
    id,
    date: "2026-03-01",
    amountCents: -1000,
    description: "x",
    counterparty,
    bankReference: null,
  };
}

describe("buildExpenseHints", () => {
  it("never pre-selects a counterparty without history", () => {
    expect(buildExpenseHints([open(1, "Neuer Laden")], [])).toEqual({
      1: { preselect: false, categoryId: null, previouslyIgnored: false },
    });
  });

  it("pre-selects a known business counterparty with its latest category", () => {
    const history: CounterpartyHistoryRow[] = [
      { counterparty: "Swisscom AG", ignored: false, hasExpense: true, expenseCategoryId: 7 },
      { counterparty: "Swisscom AG", ignored: false, hasExpense: true, expenseCategoryId: 3 },
    ];
    expect(buildExpenseHints([open(1, "SWISSCOM  AG")], history)[1]).toEqual({
      preselect: true,
      categoryId: 7,
      previouslyIgnored: false,
    });
  });

  it("marks a counterparty that was only ever ignored", () => {
    const history: CounterpartyHistoryRow[] = [
      { counterparty: "Migros", ignored: true, hasExpense: false, expenseCategoryId: null },
    ];
    expect(buildExpenseHints([open(1, "Migros")], history)[1]).toEqual({
      preselect: false,
      categoryId: null,
      previouslyIgnored: true,
    });
  });

  it("an earlier expense beats ignored bookings of the same counterparty", () => {
    const history: CounterpartyHistoryRow[] = [
      { counterparty: "Coop", ignored: true, hasExpense: false, expenseCategoryId: null },
      { counterparty: "Coop", ignored: false, hasExpense: true, expenseCategoryId: null },
    ];
    expect(buildExpenseHints([open(1, "Coop")], history)[1]).toEqual({
      preselect: true,
      categoryId: null,
      previouslyIgnored: false,
    });
  });

  it("handles missing counterparties", () => {
    expect(buildExpenseHints([open(1, null)], [])[1].preselect).toBe(false);
  });
});
```

- [ ] **Step 2: Failing Integrationstest** (`tests/integration/bank-import.test.ts`)

```ts
import { describe, it, expect, vi } from "vitest";
import type { Session } from "next-auth";
import { createTestDatabase } from "../test-utils";

vi.mock("@/lib/logger", () => ({
  default: { child: () => ({ error: () => {}, info: () => {}, warn: () => {} }) },
}));

import {
  BankImportError,
  expenseHints,
  importStatement,
  listOpenTransactions,
  undoImport,
} from "@/lib/import/bank-import";
import type { ParsedStatement, ParsedTransaction } from "@/lib/import/types";

const actor = { user: { id: "1", name: "Editor", email: "e@test.ch", role: "Editor" } } as Session;
const IBAN = "CH9300762011623852957";

function tx(overrides: Partial<ParsedTransaction> = {}): ParsedTransaction {
  return {
    date: "2026-03-01",
    amountCents: -450,
    description: "Kaffee",
    counterparty: "Bäckerei",
    bankReference: null,
    ...overrides,
  };
}

function statement(
  transactions: ParsedTransaction[],
  overrides: Partial<ParsedStatement> = {}
): ParsedStatement {
  return {
    transactions,
    iban: IBAN,
    currency: "CHF",
    openingBalanceCents: null,
    closingBalanceCents: null,
    periodFrom: "2026-03-01",
    periodTo: "2026-03-31",
    warnings: [],
    ...overrides,
  };
}

describe("bank import service against a real database", () => {
  const db = createTestDatabase();

  it("stores new transactions and skips known ones on re-upload", async () => {
    const file = statement([tx({ bankReference: "R1" }), tx({ bankReference: "R2", amountCents: 1000 })]);

    const first = await importStatement({ statement: file, filename: "m.xml", actor }, db.prisma);
    expect(first).toMatchObject({ importedCount: 2, skippedCount: 0 });
    expect(first.importId).not.toBeNull();

    const again = await importStatement({ statement: file, filename: "m.xml", actor }, db.prisma);
    expect(again).toMatchObject({ importId: null, importedCount: 0, skippedCount: 2 });
    expect(await db.prisma.bankStatementImport.count()).toBe(1);
    expect(await db.prisma.bankTransaction.count()).toBe(2);
  });

  it("imports only the new rows of an overlapping statement", async () => {
    await importStatement(
      { statement: statement([tx({ bankReference: "R1" })]), filename: "a.xml", actor },
      db.prisma
    );
    const result = await importStatement(
      {
        statement: statement([tx({ bankReference: "R1" }), tx({ bankReference: "R2" })]),
        filename: "b.xml",
        actor,
      },
      db.prisma
    );
    expect(result).toMatchObject({ importedCount: 1, skippedCount: 1 });
  });

  it("keeps two identical bookings without reference apart", async () => {
    const result = await importStatement(
      { statement: statement([tx(), tx()]), filename: "a.xml", actor },
      db.prisma
    );
    expect(result.importedCount).toBe(2);
    const again = await importStatement(
      { statement: statement([tx(), tx()]), filename: "a.xml", actor },
      db.prisma
    );
    expect(again.importedCount).toBe(0);
  });

  it("warns when the balances do not add up", async () => {
    const result = await importStatement(
      {
        statement: statement([tx()], { openingBalanceCents: 10000, closingBalanceCents: 9000 }),
        filename: "a.xml",
        actor,
      },
      db.prisma
    );
    expect(result.warnings.some((w) => w.includes("Saldo"))).toBe(true);
    const stored = await db.prisma.bankStatementImport.findUniqueOrThrow({ where: { id: result.importId! } });
    expect(stored.balanceWarning).toContain("Saldo");
  });

  it("does not leave an empty import behind when two uploads of the same file run at once", async () => {
    const file = statement([tx({ bankReference: "P1" }), tx({ bankReference: "P2" })]);
    const [a, b] = await Promise.all([
      importStatement({ statement: file, filename: "p.xml", actor }, db.prisma),
      importStatement({ statement: file, filename: "p.xml", actor }, db.prisma),
    ]);
    expect(a.importedCount + b.importedCount).toBe(2);
    expect(a.skippedCount + b.skippedCount).toBe(2);
    expect(await db.prisma.bankTransaction.count()).toBe(2);
    expect(await db.prisma.bankStatementImport.count()).toBe(1);
  });

  it("skips the continuity check when an overlapping import exists", async () => {
    await importStatement(
      {
        statement: statement([tx({ bankReference: "A" })], {
          periodFrom: "2026-03-01",
          periodTo: "2026-03-31",
          openingBalanceCents: 10000,
          closingBalanceCents: 9550,
        }),
        filename: "mar.xml",
        actor,
      },
      db.prisma
    );
    const overlap = await importStatement(
      {
        statement: statement([tx({ bankReference: "B", amountCents: -100 })], {
          periodFrom: "2026-03-15",
          periodTo: "2026-04-15",
          openingBalanceCents: 7000,
          closingBalanceCents: 6900,
        }),
        filename: "overlap.xml",
        actor,
      },
      db.prisma
    );
    expect(overlap.warnings).toEqual([]);
  });

  it("warns when the opening balance does not continue the previous import", async () => {
    await importStatement(
      {
        statement: statement([tx({ bankReference: "A" })], {
          periodFrom: "2026-02-01",
          periodTo: "2026-02-28",
          openingBalanceCents: 10000,
          closingBalanceCents: 9550,
        }),
        filename: "feb.xml",
        actor,
      },
      db.prisma
    );
    const march = await importStatement(
      {
        statement: statement([tx({ bankReference: "B", amountCents: -100 })], {
          openingBalanceCents: 8000,
          closingBalanceCents: 7900,
        }),
        filename: "mar.xml",
        actor,
      },
      db.prisma
    );
    expect(march.warnings.some((w) => w.includes("fehlt"))).toBe(true);
  });

  it("lists open transactions only, oldest first", async () => {
    await importStatement(
      {
        statement: statement([
          tx({ date: "2026-03-05", bankReference: "B" }),
          tx({ date: "2026-03-01", bankReference: "A" }),
          tx({ date: "2026-03-09", bankReference: "C" }),
        ]),
        filename: "a.xml",
        actor,
      },
      db.prisma
    );
    const all = await db.prisma.bankTransaction.findMany({ orderBy: { id: "asc" } });
    await db.prisma.bankTransaction.update({ where: { id: all[2].id }, data: { ignored: true } });

    const open = await listOpenTransactions(db.prisma);
    expect(open.map((o) => o.date)).toEqual(["2026-03-01", "2026-03-05"]);
    expect(open[0]).toMatchObject({ amountCents: -450, counterparty: "Bäckerei" });
  });

  it("derives expense hints from earlier bookings and ignores", async () => {
    const category = await db.prisma.category.create({ data: { name: "Telefon" } });
    const first = await importStatement(
      {
        statement: statement([
          tx({ bankReference: "S1", counterparty: "Swisscom AG" }),
          tx({ bankReference: "M1", counterparty: "Migros" }),
        ]),
        filename: "feb.xml",
        actor,
      },
      db.prisma
    );
    const rows = await db.prisma.bankTransaction.findMany({
      where: { importId: first.importId! },
      orderBy: { id: "asc" },
    });
    const expense = await db.prisma.expense.create({
      data: { date: new Date("2026-03-01"), description: "Swisscom", amount: 4.5, categoryId: category.categoryId },
    });
    await db.prisma.bankTransaction.update({ where: { id: rows[0].id }, data: { expenseId: expense.id } });
    await db.prisma.bankTransaction.update({ where: { id: rows[1].id }, data: { ignored: true } });

    await importStatement(
      {
        statement: statement(
          [
            tx({ bankReference: "S2", counterparty: "Swisscom AG", date: "2026-04-01" }),
            tx({ bankReference: "M2", counterparty: "Migros", date: "2026-04-02" }),
            tx({ bankReference: "N2", counterparty: "Neu GmbH", date: "2026-04-03" }),
          ],
          { periodFrom: "2026-04-01", periodTo: "2026-04-30" }
        ),
        filename: "mar.xml",
        actor,
      },
      db.prisma
    );
    const open = await listOpenTransactions(db.prisma);
    const hints = await expenseHints(open, db.prisma);
    const byName = Object.fromEntries(open.map((o) => [o.counterparty, hints[o.id]]));
    expect(byName["Swisscom AG"]).toEqual({
      preselect: true,
      categoryId: category.categoryId,
      previouslyIgnored: false,
    });
    expect(byName["Migros"]).toMatchObject({ preselect: false, previouslyIgnored: true });
    expect(byName["Neu GmbH"]).toMatchObject({ preselect: false, previouslyIgnored: false });
  });

  it("undoes an import whose transactions are all open or ignored", async () => {
    const result = await importStatement(
      { statement: statement([tx({ bankReference: "A" }), tx({ bankReference: "B" })]), filename: "a.xml", actor },
      db.prisma
    );
    const first = await db.prisma.bankTransaction.findFirstOrThrow();
    await db.prisma.bankTransaction.update({ where: { id: first.id }, data: { ignored: true } });

    await undoImport({ importId: result.importId!, actor }, db.prisma);
    expect(await db.prisma.bankTransaction.count()).toBe(0);
    expect(await db.prisma.bankStatementImport.count()).toBe(0);
  });

  it("refuses to undo an import that already has a booked expense", async () => {
    const result = await importStatement(
      { statement: statement([tx({ bankReference: "A" })]), filename: "a.xml", actor },
      db.prisma
    );
    const row = await db.prisma.bankTransaction.findFirstOrThrow();
    const expense = await db.prisma.expense.create({
      data: { date: new Date("2026-03-01"), description: "x", amount: 4.5 },
    });
    await db.prisma.bankTransaction.update({ where: { id: row.id }, data: { expenseId: expense.id } });

    await expect(undoImport({ importId: result.importId!, actor }, db.prisma)).rejects.toBeInstanceOf(
      BankImportError
    );
    expect(await db.prisma.bankTransaction.count()).toBe(1);
  });

  it("makes a transaction open again when its expense is deleted", async () => {
    await importStatement(
      { statement: statement([tx({ bankReference: "A" })]), filename: "a.xml", actor },
      db.prisma
    );
    const row = await db.prisma.bankTransaction.findFirstOrThrow();
    const expense = await db.prisma.expense.create({
      data: { date: new Date("2026-03-01"), description: "x", amount: 4.5 },
    });
    await db.prisma.bankTransaction.update({ where: { id: row.id }, data: { expenseId: expense.id } });
    expect(await listOpenTransactions(db.prisma)).toHaveLength(0);

    await db.prisma.expense.delete({ where: { id: expense.id } });
    expect(await listOpenTransactions(db.prisma)).toHaveLength(1);
  });
});
```

- [ ] **Step 3: Tests laufen lassen, Fehlschlag prüfen**

Run: `npx vitest run tests/unit/import-expense-hints.test.ts tests/integration/bank-import.test.ts`
Expected: FAIL (`Cannot find module '@/lib/import/bank-import'`).

- [ ] **Step 4: Implementierung** (`lib/import/bank-import.ts`)

```ts
import defaultPrisma from "@/lib/prisma";
import { Prisma, type PrismaClient } from "@prisma/client";
import type { Session } from "next-auth";
import { logAudit } from "@/lib/audit";
import { normalize, withFingerprints } from "@/lib/import/dedupe";
import { checkBalanceCompleteness, checkBalanceContinuity } from "@/lib/import/statement-checks";
import type { ParsedStatement } from "@/lib/import/types";

/** A user-facing, expected failure (German message). */
export class BankImportError extends Error {}

export interface ImportResult {
  /** `null` when nothing new was imported (every entry was already known). */
  importId: number | null;
  importedCount: number;
  skippedCount: number;
  /** Balance warnings; account/currency warnings are added by the caller. */
  warnings: string[];
}

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}

/**
 * Stores the new entries of a parsed statement. Entries whose fingerprint is
 * already known are skipped; the unique index catches the rest when two
 * uploads run at once.
 */
export async function importStatement(
  params: { statement: ParsedStatement; filename: string; actor: Session },
  prisma: PrismaClient = defaultPrisma
): Promise<ImportResult> {
  const { statement, filename, actor } = params;
  const hashed = withFingerprints(statement.iban, statement.transactions);

  const existing = await prisma.bankTransaction.findMany({
    where: { fingerprint: { in: hashed.map((t) => t.fingerprint) } },
    select: { fingerprint: true },
  });
  const known = new Set(existing.map((row) => row.fingerprint));
  const fresh = hashed.filter((t) => !known.has(t.fingerprint));

  if (fresh.length === 0) {
    return { importId: null, importedCount: 0, skippedCount: hashed.length, warnings: [] };
  }

  // With an overlapping import for the same account the "previous" import is
  // ambiguous, so the continuity check is skipped rather than raising a false alarm.
  const overlapping =
    statement.iban && statement.periodFrom
      ? await prisma.bankStatementImport.findFirst({
          where: { iban: statement.iban, periodTo: { gt: statement.periodFrom } },
          select: { id: true },
        })
      : null;
  const previous = statement.iban && !overlapping
    ? await prisma.bankStatementImport.findFirst({
        where: {
          iban: statement.iban,
          closingBalanceRappen: { not: null },
          ...(statement.periodFrom ? { periodTo: { lte: statement.periodFrom } } : {}),
        },
        orderBy: { periodTo: "desc" },
        select: { closingBalanceRappen: true, periodTo: true },
      })
    : null;
  const warnings = [
    ...checkBalanceCompleteness(statement),
    ...checkBalanceContinuity(statement.openingBalanceCents, previous),
  ];

  const result = await prisma.$transaction(
    async (tx) => {
      const created = await tx.bankStatementImport.create({
        data: {
          filename,
          iban: statement.iban,
          currency: statement.currency,
          periodFrom: statement.periodFrom,
          periodTo: statement.periodTo,
          openingBalanceRappen: statement.openingBalanceCents,
          closingBalanceRappen: statement.closingBalanceCents,
          balanceWarning: warnings.length > 0 ? warnings.join(" ") : null,
          importedCount: 0,
          skippedCount: 0,
          userId: parseInt(actor.user.id, 10) || null,
        },
      });

      let imported = 0;
      let skipped = hashed.length - fresh.length;
      for (const t of fresh) {
        try {
          await tx.bankTransaction.create({
            data: {
              importId: created.id,
              fingerprint: t.fingerprint,
              date: new Date(t.date),
              amountRappen: t.amountCents,
              description: t.description,
              counterparty: t.counterparty,
              bankReference: t.bankReference,
            },
          });
          imported++;
        } catch (err) {
          if (!isUniqueViolation(err)) throw err;
          skipped++;
        }
      }

      if (imported === 0) {
        await tx.bankStatementImport.delete({ where: { id: created.id } });
        return { importId: null, imported, skipped };
      }
      await tx.bankStatementImport.update({
        where: { id: created.id },
        data: { importedCount: imported, skippedCount: skipped },
      });
      return { importId: created.id, imported, skipped };
    },
    { timeout: 30_000 }
  );

  if (result.importId !== null) {
    await logAudit(
      actor,
      "CREATE",
      "BankStatementImport",
      result.importId,
      filename,
      {
        imported: result.imported,
        skipped: result.skipped,
        periodFrom: statement.periodFrom,
        periodTo: statement.periodTo,
      },
      prisma
    );
  }

  return {
    importId: result.importId,
    importedCount: result.imported,
    skippedCount: result.skipped,
    warnings,
  };
}

/** Deletes an import with all its entries, as long as none of them was booked. */
export async function undoImport(
  params: { importId: number; actor: Session },
  prisma: PrismaClient = defaultPrisma
): Promise<void> {
  const existing = await prisma.bankStatementImport.findUnique({
    where: { id: params.importId },
    include: { transactions: { select: { paymentId: true, expenseId: true } } },
  });
  if (!existing) throw new BankImportError("Import nicht gefunden.");
  if (existing.transactions.some((t) => t.paymentId !== null || t.expenseId !== null)) {
    throw new BankImportError(
      "Aus diesem Import sind bereits Zahlungen oder Ausgaben verbucht. Bitte zuerst diese löschen."
    );
  }

  // The check above is only for the message; the delete re-checks inside the
  // transaction so an entry booked in between is never silently unlinked.
  await prisma.$transaction(async (tx) => {
    const removed = await tx.bankTransaction.deleteMany({
      where: { importId: existing.id, paymentId: null, expenseId: null },
    });
    if (removed.count !== existing.transactions.length) {
      throw new BankImportError(
        "Aus diesem Import sind bereits Zahlungen oder Ausgaben verbucht. Bitte zuerst diese löschen."
      );
    }
    await tx.bankStatementImport.delete({ where: { id: existing.id } });
  });
  await logAudit(
    params.actor,
    "DELETE",
    "BankStatementImport",
    existing.id,
    existing.filename,
    { transactions: existing.transactions.length },
    prisma
  );
}

export interface OpenTransaction {
  id: number;
  /** YYYY-MM-DD */
  date: string;
  /** Signed Rappen. */
  amountCents: number;
  description: string;
  counterparty: string | null;
  bankReference: string | null;
}

/** Entries that are neither booked as payment/expense nor ignored. */
export async function listOpenTransactions(
  prisma: PrismaClient = defaultPrisma
): Promise<OpenTransaction[]> {
  const rows = await prisma.bankTransaction.findMany({
    where: { ignored: false, paymentId: null, expenseId: null },
    orderBy: [{ date: "asc" }, { id: "asc" }],
  });
  return rows.map((row) => ({
    id: row.id,
    date: row.date.toISOString().slice(0, 10),
    amountCents: row.amountRappen,
    description: row.description,
    counterparty: row.counterparty,
    bankReference: row.bankReference,
  }));
}

export interface ExpenseHint {
  /** Only true when this counterparty was already taken over as an expense. */
  preselect: boolean;
  categoryId: number | null;
  /** The counterparty was ignored before and never taken over. */
  previouslyIgnored: boolean;
}

/** One earlier booked-as-expense or ignored entry; callers pass newest first. */
export interface CounterpartyHistoryRow {
  counterparty: string;
  ignored: boolean;
  hasExpense: boolean;
  expenseCategoryId: number | null;
}

/**
 * Household and business share one account, so nothing is pre-selected for a
 * counterparty that was never taken over as an expense before.
 */
export function buildExpenseHints(
  open: OpenTransaction[],
  history: CounterpartyHistoryRow[]
): Record<number, ExpenseHint> {
  const byCounterparty = new Map<string, { expense: CounterpartyHistoryRow | null; ignored: boolean }>();
  for (const row of history) {
    const key = normalize(row.counterparty);
    const entry = byCounterparty.get(key) ?? { expense: null, ignored: false };
    if (row.hasExpense && !entry.expense) entry.expense = row;
    if (row.ignored) entry.ignored = true;
    byCounterparty.set(key, entry);
  }

  const hints: Record<number, ExpenseHint> = {};
  for (const transaction of open) {
    const entry = byCounterparty.get(normalize(transaction.counterparty));
    hints[transaction.id] = entry?.expense
      ? { preselect: true, categoryId: entry.expense.expenseCategoryId, previouslyIgnored: false }
      : { preselect: false, categoryId: null, previouslyIgnored: !!entry?.ignored };
  }
  return hints;
}

export async function expenseHints(
  open: OpenTransaction[],
  prisma: PrismaClient = defaultPrisma
): Promise<Record<number, ExpenseHint>> {
  const rows = await prisma.bankTransaction.findMany({
    // Outgoing only: an ignored incoming payment says nothing about expenses.
    where: {
      counterparty: { not: null },
      amountRappen: { lt: 0 },
      OR: [{ expenseId: { not: null } }, { ignored: true }],
    },
    select: {
      counterparty: true,
      ignored: true,
      expenseId: true,
      expense: { select: { categoryId: true } },
    },
    orderBy: [{ date: "desc" }, { id: "desc" }],
  });
  return buildExpenseHints(
    open,
    rows.map((row) => ({
      counterparty: row.counterparty as string,
      ignored: row.ignored,
      hasExpense: row.expenseId !== null,
      expenseCategoryId: row.expense?.categoryId ?? null,
    }))
  );
}
```

- [ ] **Step 5: Tests laufen lassen**

Run: `npx vitest run tests/unit/import-expense-hints.test.ts tests/integration/bank-import.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/import/bank-import.ts tests/unit/import-expense-hints.test.ts tests/integration/bank-import.test.ts
git commit -m "feat(import): store bank statements with dedupe, undo and expense hints

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Server Actions, Abfragen und Ablösung von `markInvoicesPaidFromImport`

**Files:**
- Create: `lib/import/queries.ts`
- Modify: `app/(app)/invoices/import/actions.ts` (komplett ersetzen)
- Modify: `lib/payments.ts` (`RecordParams` um `onCreated` erweitern, in `createPayment` aufrufen)
- Modify: `app/(app)/invoices/actions.ts` (Zeilen ab `export type ImportMatch` bis Ende von `markInvoicesPaidFromImport` entfernen; Import von `PaymentError` bleibt, wenn sonst noch genutzt, sonst entfernen)
- Modify: `tests/integration/camt-import-payments.test.ts` (ersetzen)

**Interfaces:**
- Consumes: `importStatement`, `undoImport`, `BankImportError`, `listOpenTransactions`, `expenseHints` (Task 5), `matchStatementToInvoices` (Task 4), `checkStatementAccount`, `recordPayment` (mit neuem `onCreated`), `PaymentError`, `toRappen`, `customerDisplayName`.
- Produces (Server Actions, alle `requireEditor`):
  - `uploadStatement(_prev: UploadStatementState, formData: FormData): Promise<UploadStatementState>` mit `UploadStatementState = { error?: string; warnings?: string[]; importedCount?: number; skippedCount?: number }`
  - `bookPayments(items: { transactionId: number; invoiceId: number }[]): Promise<{ error?: string; paidCount?: number }>`
  - `bookExpenses(items: { transactionId: number; categoryId: number | null }[]): Promise<{ error?: string; expenseCount?: number }>`
  - `ignoreTransactions(ids: number[]): Promise<{ error?: string; ignoredCount?: number }>`
  - `undoStatementImport(importId: number): Promise<{ error?: string }>`
- Produces (`lib/import/queries.ts`): `loadOpenInvoices(prisma?): Promise<OpenInvoice[]>`, `loadImportOverview(prisma?): Promise<ImportOverview>` mit

```ts
export interface ImportOverview {
  incoming: Array<MatchedTransaction<OpenTransaction & { id: number }>>;
  expenses: Array<{ transaction: OpenTransaction; hint: ExpenseHint }>;
  categories: Array<{ categoryId: number; name: string }>;
  imports: Array<{
    id: number; filename: string; iban: string | null; periodFrom: string | null;
    periodTo: string | null; importedCount: number; skippedCount: number;
    bookedCount: number; balanceWarning: string | null; createdAt: string;
  }>;
}
```

- [ ] **Step 1: `lib/import/queries.ts` schreiben**

```ts
import defaultPrisma from "@/lib/prisma";
import type { PrismaClient } from "@prisma/client";
import { customerDisplayName } from "@/lib/customer-display";
import { toRappen } from "@/lib/payments";
import {
  expenseHints,
  listOpenTransactions,
  type ExpenseHint,
  type OpenTransaction,
} from "@/lib/import/bank-import";
import {
  matchStatementToInvoices,
  type MatchedTransaction,
  type OpenInvoice,
} from "@/lib/import/matching";

/** Invoices still awaiting money, with the remaining amount after payments and credit notes. */
export async function loadOpenInvoices(
  prisma: PrismaClient = defaultPrisma
): Promise<OpenInvoice[]> {
  const invoices = await prisma.invoice.findMany({
    where: { state: { in: ["Sent", "Overdue", "PartiallyPaid"] }, creditNoteForId: null },
    select: {
      id: true,
      documentNumber: true,
      totalAmount: true,
      customer: { select: { company: true, contactPerson: true, contactInsteadOfCompany: true } },
      payments: { select: { amount: true } },
      creditNotes: { where: { state: { not: "Draft" } }, select: { totalAmount: true } },
    },
  });

  return invoices
    .filter((invoice): invoice is typeof invoice & { documentNumber: string } => invoice.documentNumber !== null)
    .map((invoice) => {
      const paidRappen = invoice.payments.reduce((s, p) => s + toRappen(p.amount), 0);
      const creditedRappen = invoice.creditNotes.reduce((s, c) => s + Math.abs(toRappen(c.totalAmount)), 0);
      const names = [
        customerDisplayName(invoice.customer),
        invoice.customer.company ?? "",
        invoice.customer.contactPerson ?? "",
      ].filter((name, index, all) => name && all.indexOf(name) === index);
      return {
        id: invoice.id,
        documentNumber: invoice.documentNumber,
        openAmount: Math.max(toRappen(invoice.totalAmount) - creditedRappen - paidRappen, 0) / 100,
        customerNames: names,
      };
    });
}

export interface ImportOverview {
  incoming: Array<MatchedTransaction<OpenTransaction>>;
  expenses: Array<{ transaction: OpenTransaction; hint: ExpenseHint }>;
  categories: Array<{ categoryId: number; name: string }>;
  imports: Array<{
    id: number;
    filename: string;
    iban: string | null;
    periodFrom: string | null;
    periodTo: string | null;
    importedCount: number;
    skippedCount: number;
    bookedCount: number;
    balanceWarning: string | null;
    createdAt: string;
  }>;
}

export async function loadImportOverview(
  prisma: PrismaClient = defaultPrisma
): Promise<ImportOverview> {
  const [open, openInvoices, settings, categories, imports, booked] = await Promise.all([
    listOpenTransactions(prisma),
    loadOpenInvoices(prisma),
    prisma.applicationSettings.findFirst({ select: { invoiceNumberPrefix: true } }),
    prisma.category.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      select: { categoryId: true, name: true },
    }),
    prisma.bankStatementImport.findMany({ orderBy: { createdAt: "desc" }, take: 20 }),
    prisma.bankTransaction.groupBy({
      by: ["importId"],
      where: { OR: [{ paymentId: { not: null } }, { expenseId: { not: null } }] },
      _count: { _all: true },
    }),
  ]);

  const outgoing = open.filter((t) => t.amountCents < 0);
  const hints = await expenseHints(outgoing, prisma);
  const bookedByImport = new Map(booked.map((row) => [row.importId, row._count._all]));

  return {
    incoming: matchStatementToInvoices(open, openInvoices, settings?.invoiceNumberPrefix ?? "R-"),
    expenses: outgoing.map((transaction) => ({ transaction, hint: hints[transaction.id] })),
    categories,
    imports: imports.map((row) => ({
      id: row.id,
      filename: row.filename,
      iban: row.iban,
      periodFrom: row.periodFrom,
      periodTo: row.periodTo,
      importedCount: row.importedCount,
      skippedCount: row.skippedCount,
      bookedCount: bookedByImport.get(row.id) ?? 0,
      balanceWarning: row.balanceWarning,
      createdAt: row.createdAt.toISOString(),
    })),
  };
}
```

- [ ] **Step 2: Failing Integrationstest schreiben** – `tests/integration/camt-import-payments.test.ts` komplett ersetzen:

```ts
import { describe, it, expect, vi } from "vitest";
import { createTestDatabase, createValidTestCustomer } from "../test-utils";

// The actions use the default prisma singleton (also inside lib/payments).
// Route it to the per-suite test database via a proxy.
const holder = vi.hoisted(() => ({ prisma: null as unknown }));

vi.mock("@/lib/prisma", () => ({
  default: new Proxy(
    {},
    { get: (_t, prop) => (holder.prisma as Record<string | symbol, unknown>)[prop] }
  ),
}));
vi.mock("@/lib/permissions", () => ({
  requireEditor: vi.fn(async () => ({
    user: { id: "1", name: "Editor", email: "e@test.ch", role: "Editor" },
  })),
  requireAdmin: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/logger", () => ({
  default: { child: () => ({ error: () => {}, info: () => {}, warn: () => {} }) },
}));

import {
  bookExpenses,
  bookPayments,
  ignoreTransactions,
  undoStatementImport,
} from "@/app/(app)/invoices/import/actions";
import { importStatement } from "@/lib/import/bank-import";
import type { ParsedTransaction } from "@/lib/import/types";
import type { Session } from "next-auth";

const actor = { user: { id: "1", name: "Editor", email: "e@test.ch", role: "Editor" } } as Session;

describe("CAMT import actions against a real database", () => {
  const db = createTestDatabase();

  async function seedInvoice(state: "Sent" | "Paid" | "Draft" = "Sent", total = 100) {
    holder.prisma = db.prisma;
    const customer = await db.prisma.customer.create({ data: createValidTestCustomer() });
    return db.prisma.invoice.create({
      data: {
        customerId: customer.customerId,
        documentNumber: state === "Draft" ? null : `R-${Math.floor(Math.random() * 1e8)}`,
        date: new Date("2026-01-01"),
        dueDate: new Date("2099-01-01"),
        totalAmount: total,
        state,
        paidDate: state === "Paid" ? new Date("2026-02-01") : null,
      },
    });
  }

  /** Stores the given entries through the real import and returns their ids in order. */
  async function seedTransactions(entries: Array<Partial<ParsedTransaction>>) {
    holder.prisma = db.prisma;
    const result = await importStatement(
      {
        statement: {
          transactions: entries.map((e, i) => ({
            date: "2026-03-01",
            amountCents: 4000,
            description: "Zahlung",
            counterparty: null,
            bankReference: `REF-${i}-${Math.random()}`,
            ...e,
          })),
          iban: "CH9300762011623852957",
          currency: "CHF",
          openingBalanceCents: null,
          closingBalanceCents: null,
          periodFrom: "2026-03-01",
          periodTo: "2026-03-31",
          warnings: [],
        },
        filename: "t.xml",
        actor,
      },
      db.prisma
    );
    const rows = await db.prisma.bankTransaction.findMany({
      where: { importId: result.importId! },
      orderBy: { id: "asc" },
    });
    return { importId: result.importId!, ids: rows.map((r) => r.id) };
  }

  it("books a partial payment, ignores a duplicate confirmation, and completes with the rest", async () => {
    const inv = await seedInvoice();
    const { ids } = await seedTransactions([
      { amountCents: 4000, bankReference: "REF-A", date: "2026-03-01" },
      { amountCents: 6000, bankReference: "REF-B", date: "2026-03-15" },
    ]);

    expect(await bookPayments([{ transactionId: ids[0], invoiceId: inv.id }])).toEqual({ paidCount: 1 });
    let row = await db.prisma.invoice.findUniqueOrThrow({ where: { id: inv.id } });
    expect(row.state).toBe("PartiallyPaid");
    const payments = await db.prisma.payment.findMany({ where: { invoiceId: inv.id } });
    expect(payments).toHaveLength(1);
    expect(payments[0].amount.toNumber()).toBe(40);
    expect(payments[0].source).toBe("camt-import");
    expect(payments[0].bankReference).toBe("REF-A");
    const linked = await db.prisma.bankTransaction.findUniqueOrThrow({ where: { id: ids[0] } });
    expect(linked.paymentId).toBe(payments[0].id);

    // Same entry confirmed again (second tab): no second payment.
    expect(await bookPayments([{ transactionId: ids[0], invoiceId: inv.id }])).toEqual({ paidCount: 0 });
    expect(await db.prisma.payment.count({ where: { invoiceId: inv.id } })).toBe(1);

    expect(await bookPayments([{ transactionId: ids[1], invoiceId: inv.id }])).toEqual({ paidCount: 1 });
    row = await db.prisma.invoice.findUniqueOrThrow({ where: { id: inv.id } });
    expect(row.state).toBe("Paid");
    expect(row.paidDate?.toISOString().slice(0, 10)).toBe("2026-03-15");
  });

  it.each(["Paid", "Draft"] as const)("skips a %s invoice", async (state) => {
    const inv = await seedInvoice(state);
    const { ids } = await seedTransactions([{ amountCents: 10000, bankReference: "REF-X" }]);

    expect(await bookPayments([{ transactionId: ids[0], invoiceId: inv.id }])).toEqual({ paidCount: 0 });
    expect(await db.prisma.payment.count({ where: { invoiceId: inv.id } })).toBe(0);
  });

  it("does not book an outgoing or ignored entry as a payment", async () => {
    const inv = await seedInvoice();
    const { ids } = await seedTransactions([{ amountCents: -5000 }, { amountCents: 5000 }]);
    await ignoreTransactions([ids[1]]);

    expect(
      await bookPayments([
        { transactionId: ids[0], invoiceId: inv.id },
        { transactionId: ids[1], invoiceId: inv.id },
      ])
    ).toEqual({ paidCount: 0 });
  });

  it("turns the entry open again when its payment is deleted", async () => {
    const inv = await seedInvoice();
    const { ids } = await seedTransactions([{ amountCents: 10000 }]);
    await bookPayments([{ transactionId: ids[0], invoiceId: inv.id }]);
    await db.prisma.payment.deleteMany({ where: { invoiceId: inv.id } });

    const row = await db.prisma.bankTransaction.findUniqueOrThrow({ where: { id: ids[0] } });
    expect(row.paymentId).toBeNull();
  });

  it("books only the selected outgoing entries as expenses", async () => {
    const category = await db.prisma.category.create({ data: { name: "Telefon" } });
    const { ids } = await seedTransactions([
      { amountCents: -8990, counterparty: "Swisscom AG", description: "Rechnung März", date: "2026-03-03" },
      { amountCents: -2000, counterparty: "Migros", description: "Einkauf" },
    ]);

    expect(
      await bookExpenses([{ transactionId: ids[0], categoryId: category.categoryId }])
    ).toEqual({ expenseCount: 1 });

    const expenses = await db.prisma.expense.findMany();
    expect(expenses).toHaveLength(1);
    expect(expenses[0].amount.toNumber()).toBe(89.9);
    expect(expenses[0].description).toBe("Swisscom AG – Rechnung März");
    expect(expenses[0].categoryId).toBe(category.categoryId);
    expect(expenses[0].date.toISOString().slice(0, 10)).toBe("2026-03-03");
    const linked = await db.prisma.bankTransaction.findUniqueOrThrow({ where: { id: ids[0] } });
    expect(linked.expenseId).toBe(expenses[0].id);
    const untouched = await db.prisma.bankTransaction.findUniqueOrThrow({ where: { id: ids[1] } });
    expect(untouched.expenseId).toBeNull();
    expect(untouched.ignored).toBe(false);

    // Booking the same entry twice creates nothing.
    expect(await bookExpenses([{ transactionId: ids[0], categoryId: null }])).toEqual({ expenseCount: 0 });
    expect(await db.prisma.expense.count()).toBe(1);
  });

  it("does not book an incoming entry as an expense and allows no category", async () => {
    const { ids } = await seedTransactions([
      { amountCents: 5000 },
      { amountCents: -700, counterparty: "Kiosk" },
    ]);
    expect(
      await bookExpenses([
        { transactionId: ids[0], categoryId: null },
        { transactionId: ids[1], categoryId: null },
      ])
    ).toEqual({ expenseCount: 1 });
    const [expense] = await db.prisma.expense.findMany();
    expect(expense.categoryId).toBeNull();
  });

  it("ignores only open entries", async () => {
    const { ids } = await seedTransactions([{ amountCents: -100 }, { amountCents: -200 }]);
    const category = await db.prisma.category.create({ data: { name: "X" } });
    await bookExpenses([{ transactionId: ids[0], categoryId: category.categoryId }]);

    expect(await ignoreTransactions(ids)).toEqual({ ignoredCount: 1 });
    const first = await db.prisma.bankTransaction.findUniqueOrThrow({ where: { id: ids[0] } });
    expect(first.ignored).toBe(false);
  });

  it("undoes an untouched import and refuses one with a booked entry", async () => {
    const untouched = await seedTransactions([{ amountCents: -100 }]);
    expect(await undoStatementImport(untouched.importId)).toEqual({});
    expect(await db.prisma.bankTransaction.count()).toBe(0);

    const booked = await seedTransactions([{ amountCents: -300 }]);
    await bookExpenses([{ transactionId: booked.ids[0], categoryId: null }]);
    const result = await undoStatementImport(booked.importId);
    expect(result.error).toContain("verbucht");
    expect(await db.prisma.bankTransaction.count()).toBe(1);
  });
});
```

- [ ] **Step 3: Test laufen lassen, Fehlschlag prüfen**

Run: `npx vitest run tests/integration/camt-import-payments.test.ts`
Expected: FAIL (Actions nicht exportiert).

- [ ] **Step 3b: Hook in `lib/payments.ts`**

Damit Zahlung und Verknüpfung mit der Bankbewegung **atomar** entstehen (kein Absturz dazwischen, kein Doppelbuchen, kein Audit-Rauschen), bekommt `createPayment` einen optionalen Rückruf innerhalb der Transaktion.

In `RecordParams` ergänzen:

```ts
  /** Runs inside the payment transaction right after the payment row exists; throw to roll back. */
  onCreated?: (tx: Parameters<typeof recalculateInvoiceState>[0], paymentId: number) => Promise<void>;
```

In `createPayment` direkt nach `const payment = await tx.payment.create({ … });` einfügen:

```ts
    await params.onCreated?.(tx, payment.id);
```

Zusätzlicher Test in `tests/integration/camt-import-payments.test.ts` (im `describe` ergänzen):

```ts
  it("books an entry only once when two confirmations run at the same time", async () => {
    const inv = await seedInvoice();
    const { ids } = await seedTransactions([{ amountCents: 4000 }]);

    const results = await Promise.all([
      bookPayments([{ transactionId: ids[0], invoiceId: inv.id }]),
      bookPayments([{ transactionId: ids[0], invoiceId: inv.id }]),
    ]);
    expect(results.map((r) => r.paidCount).sort()).toEqual([0, 1]);
    expect(await db.prisma.payment.count({ where: { invoiceId: inv.id } })).toBe(1);
  });
```

- [ ] **Step 4: Actions implementieren** – `app/(app)/invoices/import/actions.ts` komplett ersetzen:

```ts
"use server";

import prisma from "@/lib/prisma";
import { revalidatePath, revalidateTag } from "next/cache";
import { requireEditor } from "@/lib/permissions";
import { ANALYTICS_CACHE_TAG } from "@/lib/cache-tags";
import { logAudit } from "@/lib/audit";
import { parseCamt053 } from "@/lib/import/camt";
import { BankImportError, importStatement, undoImport } from "@/lib/import/bank-import";
import { checkStatementAccount } from "@/lib/import/statement-checks";
import { PaymentError, recordPayment } from "@/lib/payments";
import logger from "@/lib/logger";

const log = logger.child({ module: "invoices.import" });

const MAX_FILE_BYTES = 10 * 1024 * 1024;

export type UploadStatementState = {
  error?: string;
  warnings?: string[];
  importedCount?: number;
  skippedCount?: number;
};

function revalidateImport() {
  revalidatePath("/invoices/import");
  revalidatePath("/invoices");
  revalidatePath("/invoices/reminders");
  revalidatePath("/accounting");
  revalidatePath("/accounting/receivables");
  revalidatePath("/dashboard");
  revalidateTag(ANALYTICS_CACHE_TAG, { expire: 0 });
}

/**
 * Parses an uploaded CAMT.053 file and stores its new entries. Nothing is
 * booked here: payments and expenses only arise from the explicit
 * confirmations below.
 */
export async function uploadStatement(
  _prev: UploadStatementState,
  formData: FormData
): Promise<UploadStatementState> {
  const session = await requireEditor();

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "Bitte eine CAMT.053-Datei (.xml) auswählen." };
  }
  if (file.size > MAX_FILE_BYTES) {
    return { error: "Die Datei ist zu gross (maximal 10 MB)." };
  }

  let statement;
  try {
    statement = parseCamt053(await file.text());
  } catch (err) {
    log.error({ err }, "uploadStatement: CAMT parse failed");
    return { error: err instanceof Error ? err.message : "Datei konnte nicht gelesen werden." };
  }

  const settings = await prisma.applicationSettings.findFirst({
    select: { companyInfo: { select: { companyIBAN: true } } },
  });
  const result = await importStatement({ statement, filename: file.name, actor: session });

  revalidateImport();
  return {
    importedCount: result.importedCount,
    skippedCount: result.skippedCount,
    warnings: [
      ...checkStatementAccount(statement, settings?.companyInfo?.companyIBAN ?? null),
      ...result.warnings,
      ...statement.warnings,
    ],
  };
}

const isOpen = { paymentId: null, expenseId: null, ignored: false } as const;

class AlreadyBooked extends Error {}

/**
 * Books the confirmed incoming entries as payments. Every entry and invoice
 * is re-checked against its current state rather than trusting the preview:
 * a second tab or an invoice edited in between must not double-book, such
 * rows are skipped instead of failing the batch.
 */
export async function bookPayments(
  items: { transactionId: number; invoiceId: number }[]
): Promise<{ error?: string; paidCount?: number }> {
  const session = await requireEditor();
  if (items.length === 0) return { error: "Keine Zuordnung ausgewählt." };

  let paidCount = 0;
  for (const item of items) {
    const entry = await prisma.bankTransaction.findUnique({ where: { id: item.transactionId } });
    if (!entry || entry.ignored || entry.paymentId !== null || entry.expenseId !== null) continue;
    if (entry.amountRappen <= 0) continue;

    const invoice = await prisma.invoice.findUnique({
      where: { id: item.invoiceId },
      select: { state: true },
    });
    if (!invoice || !["Sent", "Overdue", "PartiallyPaid"].includes(invoice.state)) continue;
    if (
      entry.bankReference &&
      (await prisma.payment.count({
        where: { invoiceId: item.invoiceId, bankReference: entry.bankReference },
      })) > 0
    ) {
      continue;
    }

    try {
      await recordPayment({
        invoiceId: item.invoiceId,
        amount: entry.amountRappen / 100,
        date: entry.date,
        source: "camt-import",
        bankReference: entry.bankReference,
        actor: session,
        // Claim the entry inside the payment transaction: a concurrent second
        // confirmation matches no row, throws, and its payment is rolled back.
        onCreated: async (tx, paymentId) => {
          const claimed = await tx.bankTransaction.updateMany({
            where: { id: entry.id, ...isOpen },
            data: { paymentId },
          });
          if (claimed.count === 0) throw new AlreadyBooked();
        },
      });
      paidCount++;
    } catch (err) {
      if (err instanceof AlreadyBooked) continue;
      if (!(err instanceof PaymentError)) throw err;
    }
  }

  revalidateImport();
  return { paidCount };
}

/** Books the ticked outgoing entries as expenses (category optional). */
export async function bookExpenses(
  items: { transactionId: number; categoryId: number | null }[]
): Promise<{ error?: string; expenseCount?: number }> {
  const session = await requireEditor();
  if (items.length === 0) return { error: "Keine Ausgabe ausgewählt." };

  let expenseCount = 0;
  for (const item of items) {
    const entry = await prisma.bankTransaction.findUnique({ where: { id: item.transactionId } });
    if (!entry || entry.ignored || entry.paymentId !== null || entry.expenseId !== null) continue;
    if (entry.amountRappen >= 0) continue;

    const categoryId =
      item.categoryId !== null &&
      (await prisma.category.count({ where: { categoryId: item.categoryId } })) > 0
        ? item.categoryId
        : null;
    const description = entry.counterparty
      ? `${entry.counterparty} – ${entry.description}`
      : entry.description;

    let expense;
    try {
      expense = await prisma.$transaction(async (tx) => {
        const created = await tx.expense.create({
          data: {
            date: entry.date,
            description,
            amount: Math.abs(entry.amountRappen) / 100,
            categoryId,
          },
        });
        const claimed = await tx.bankTransaction.updateMany({
          where: { id: entry.id, ...isOpen },
          data: { expenseId: created.id },
        });
        // Lost a race with a second confirmation: throwing rolls the expense back.
        if (claimed.count === 0) throw new AlreadyBooked();
        return created;
      });
    } catch (err) {
      if (err instanceof AlreadyBooked) continue;
      throw err;
    }

    await logAudit(session, "CREATE", "Expense", expense.id, expense.description, {
      source: "camt-import",
      bankTransactionId: entry.id,
    });
    expenseCount++;
  }

  revalidateImport();
  return { expenseCount };
}

/** Marks open entries as ignored (private bookings, transfers). */
export async function ignoreTransactions(
  ids: number[]
): Promise<{ error?: string; ignoredCount?: number }> {
  await requireEditor();
  if (ids.length === 0) return { error: "Keine Bewegung ausgewählt." };

  const result = await prisma.bankTransaction.updateMany({
    where: { id: { in: ids }, ...isOpen },
    data: { ignored: true },
  });
  revalidatePath("/invoices/import");
  return { ignoredCount: result.count };
}

export async function undoStatementImport(importId: number): Promise<{ error?: string }> {
  const session = await requireEditor();
  try {
    await undoImport({ importId, actor: session });
  } catch (err) {
    if (err instanceof BankImportError) return { error: err.message };
    throw err;
  }
  revalidatePath("/invoices/import");
  return {};
}
```

- [ ] **Step 5: Alten Code entfernen**

In `app/(app)/invoices/actions.ts` den Block von `export type ImportMatch = {` bis zum Ende der Funktion `markInvoicesPaidFromImport` (bis vor `export async function deleteInvoice`) löschen, samt dem Kommentar davor. Danach prüfen, ob `PaymentError` und `recordPayment` dort noch genutzt werden (`grep -n "PaymentError\|recordPayment(" "app/(app)/invoices/actions.ts"`); ungenutzte Imports entfernen.

- [ ] **Step 6: Tests und Typen prüfen**

Run: `npx vitest run tests/integration/camt-import-payments.test.ts tests/integration/bank-import.test.ts`
Expected: PASS.
Run: `npx tsc --noEmit`
Expected: Fehler nur noch in `ImportWizard.tsx` (nutzt die entfernten Exporte, wird in Task 7 ersetzt). Andere Fehler beheben.

- [ ] **Step 7: Commit**

```bash
git add lib/import/queries.ts "app/(app)/invoices" tests/integration/camt-import-payments.test.ts
git commit -m "feat(import): book stored bank entries as payments or expenses

Replaces markInvoicesPaidFromImport with actions that work on stored
BankTransaction rows.

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

(Der Commit enthält vorübergehend einen kaputten `ImportWizard.tsx`; Task 7 folgt direkt. Wer einen grünen Zwischenstand will, führt Task 6 und 7 vor dem Commit zusammen.)

---

### Task 7: Oberfläche

**Files:**
- Modify: `app/(app)/invoices/import/page.tsx`
- Replace: `app/(app)/invoices/import/ImportWizard.tsx` (nur Upload-Formular und Warnungen)
- Create: `app/(app)/invoices/import/IncomingTable.tsx`, `ExpensesTable.tsx`, `ImportHistory.tsx`
- Create: `tests/fixtures/camt053-sample.xml` (für die manuelle Prüfung)

**Interfaces:**
- Consumes: `loadImportOverview`/`ImportOverview` (Task 6), Actions aus Task 6, `MatchConfidence` mit `"name"`.

- [ ] **Step 1: Seite** – `page.tsx` komplett ersetzen:

```tsx
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { requireEditor } from "@/lib/permissions";
import { loadImportOverview } from "@/lib/import/queries";
import { ImportWizard } from "./ImportWizard";
import { IncomingTable } from "./IncomingTable";
import { ExpensesTable } from "./ExpensesTable";
import { ImportHistory } from "./ImportHistory";

export default async function InvoicesImportPage() {
  await requireEditor();
  const overview = await loadImportOverview();

  return (
    <div className="max-w-5xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Bankimport</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            CAMT.053-Kontoauszug hochladen, Zahlungseingänge Rechnungen zuordnen und Geschäftsausgaben übernehmen
          </p>
        </div>
        <Button variant="outline" size="sm" render={<Link href="/invoices" />}>
          Zurück
        </Button>
      </div>

      <ImportWizard />

      <section className="space-y-2">
        <h2 className="text-lg font-medium">Zahlungseingänge</h2>
        {/* Keyed on the row ids: the tables derive their initial selection from the rows,
            so a new upload or a booking must remount them instead of keeping stale state. */}
        <IncomingTable
          key={overview.incoming.map((r) => r.transaction.id).join(",")}
          rows={overview.incoming}
        />
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-medium">Ausgaben</h2>
        <p className="text-sm text-muted-foreground">
          Es werden nur angekreuzte Zeilen als Ausgabe übernommen. Privates lässt du offen oder ignorierst es.
        </p>
        <ExpensesTable
          key={overview.expenses.map((r) => r.transaction.id).join(",")}
          rows={overview.expenses}
          categories={overview.categories}
        />
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-medium">Importverlauf</h2>
        <ImportHistory imports={overview.imports} />
      </section>
    </div>
  );
}
```

- [ ] **Step 2: Upload-Formular** – `ImportWizard.tsx` komplett ersetzen:

```tsx
"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { uploadStatement, type UploadStatementState } from "./actions";

export function ImportWizard() {
  const [state, action, isPending] = useActionState<UploadStatementState, FormData>(
    uploadStatement,
    {}
  );

  return (
    <div className="space-y-3">
      <form action={action} className="flex items-center gap-2">
        <input
          type="file"
          name="file"
          accept=".xml"
          required
          className="text-sm file:mr-3 file:rounded-md file:border-0 file:bg-secondary file:px-3 file:py-1.5 file:text-sm file:font-medium"
        />
        <Button type="submit" disabled={isPending}>
          {isPending ? "Wird gelesen…" : "Datei importieren"}
        </Button>
      </form>

      {state.error && <p className="text-sm text-destructive">{state.error}</p>}

      {state.importedCount !== undefined && (
        <p className="text-sm">
          {state.importedCount === 0
            ? "Keine neuen Bewegungen: alle Einträge der Datei waren schon importiert."
            : `${state.importedCount} neue Bewegung${state.importedCount === 1 ? "" : "en"} importiert`}
          {state.skippedCount ? `, ${state.skippedCount} bereits bekannt übersprungen.` : "."}
        </p>
      )}

      {state.warnings && state.warnings.length > 0 && (
        <ul className="text-sm text-muted-foreground list-disc pl-5 space-y-0.5">
          {state.warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Eingänge** – `IncomingTable.tsx`:

```tsx
"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatCurrency, formatDate } from "@/lib/utils";
import type { MatchConfidence, MatchedTransaction } from "@/lib/import/matching";
import type { OpenTransaction } from "@/lib/import/bank-import";
import { bookPayments, ignoreTransactions } from "./actions";

const confidenceLabels: Record<MatchConfidence, string> = {
  reference: "Referenz gefunden",
  amount: "nur Betrag oder Nummer passt",
  name: "Kundenname passt",
  none: "keine Zuordnung",
};

type Selection = { checked: boolean; invoiceId: number | null };

export function IncomingTable({ rows }: { rows: MatchedTransaction<OpenTransaction>[] }) {
  const [selections, setSelections] = useState<Record<number, Selection>>(() =>
    Object.fromEntries(
      rows.map((row) => [
        row.transaction.id,
        {
          checked: row.confidence === "reference",
          invoiceId: row.preselectedInvoiceId ?? row.candidates[0]?.invoiceId ?? null,
        },
      ])
    )
  );
  const [isPending, startTransition] = useTransition();

  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground py-4">Keine offenen Zahlungseingänge.</p>;
  }

  function update(id: number, patch: Partial<Selection>) {
    setSelections((prev) => ({
      ...prev,
      [id]: { ...(prev[id] ?? { checked: false, invoiceId: null }), ...patch },
    }));
  }

  const chosen = rows.filter((row) => {
    const s = selections[row.transaction.id];
    return s?.checked && s.invoiceId !== null;
  });

  function confirm() {
    startTransition(async () => {
      const result = await bookPayments(
        chosen.map((row) => ({
          transactionId: row.transaction.id,
          invoiceId: selections[row.transaction.id].invoiceId as number,
        }))
      );
      if (result.error) toast.error(result.error);
      else toast.success(`${result.paidCount ?? 0} Zahlung(en) verbucht.`);
    });
  }

  function ignore(id: number) {
    startTransition(async () => {
      const result = await ignoreTransactions([id]);
      if (result.error) toast.error(result.error);
    });
  }

  return (
    <div className="space-y-2">
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10"></TableHead>
              <TableHead>Datum</TableHead>
              <TableHead>Beschreibung</TableHead>
              <TableHead>Betrag</TableHead>
              <TableHead>Zuordnung</TableHead>
              <TableHead className="w-24"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map(({ transaction, candidates, confidence }) => {
              const selection = selections[transaction.id];
              return (
                <TableRow key={transaction.id}>
                  <TableCell>
                    {candidates.length > 0 && (
                      <input
                        type="checkbox"
                        className="h-4 w-4 rounded border-input accent-primary"
                        checked={selection?.checked ?? false}
                        onChange={(e) => update(transaction.id, { checked: e.target.checked })}
                      />
                    )}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">{formatDate(transaction.date)}</TableCell>
                  <TableCell className="max-w-xs truncate" title={transaction.description}>
                    {transaction.description}
                    {transaction.counterparty && (
                      <span className="text-muted-foreground"> · {transaction.counterparty}</span>
                    )}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    {formatCurrency(transaction.amountCents / 100)}
                  </TableCell>
                  <TableCell>
                    {candidates.length > 0 ? (
                      <Select
                        value={selection?.invoiceId ? String(selection.invoiceId) : undefined}
                        onValueChange={(value) => value && update(transaction.id, { invoiceId: Number(value) })}
                      >
                        <SelectTrigger className="w-56">
                          <SelectValue placeholder="Rechnung wählen">
                            {(value: string | null) =>
                              value
                                ? (candidates.find((c) => String(c.invoiceId) === value)?.documentNumber ?? value)
                                : "Rechnung wählen"
                            }
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          {candidates.map((candidate) => (
                            <SelectItem key={candidate.invoiceId} value={String(candidate.invoiceId)}>
                              {candidate.documentNumber}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <span className="text-sm text-muted-foreground">{confidenceLabels.none}</span>
                    )}
                    {candidates.length > 0 && confidence !== "reference" && (
                      <span className="block text-xs text-muted-foreground mt-0.5">
                        {confidenceLabels[confidence]}
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Button variant="ghost" size="sm" disabled={isPending} onClick={() => ignore(transaction.id)}>
                      Ignorieren
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
      <p className="text-xs text-muted-foreground">
        Eingänge ohne offene Rechnung können nur ignoriert werden. Wurde eine Zahlung schon über die
        Budget-App verbucht, hier ignorieren.
      </p>
      <div className="flex justify-end">
        <Button onClick={confirm} disabled={isPending || chosen.length === 0}>
          {isPending
            ? "Wird gespeichert…"
            : `${chosen.length} Rechnung${chosen.length === 1 ? "" : "en"} als bezahlt markieren`}
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Ausgaben** – `ExpensesTable.tsx`:

```tsx
"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatCurrency, formatDate } from "@/lib/utils";
import type { ExpenseHint, OpenTransaction } from "@/lib/import/bank-import";
import { bookExpenses, ignoreTransactions } from "./actions";

type Row = { transaction: OpenTransaction; hint: ExpenseHint };
type Category = { categoryId: number; name: string };
type Selection = { checked: boolean; categoryId: number | null };

const NO_CATEGORY = "none";

export function ExpensesTable({ rows, categories }: { rows: Row[]; categories: Category[] }) {
  const [selections, setSelections] = useState<Record<number, Selection>>(() =>
    Object.fromEntries(
      rows.map(({ transaction, hint }) => [
        transaction.id,
        { checked: hint.preselect, categoryId: hint.categoryId },
      ])
    )
  );
  const [isPending, startTransition] = useTransition();

  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground py-4">Keine offenen Abbuchungen.</p>;
  }

  const visible = rows.filter((row) => !row.hint.previouslyIgnored);
  const previouslyIgnored = rows.filter((row) => row.hint.previouslyIgnored);
  const chosen = rows.filter((row) => selections[row.transaction.id]?.checked);
  const unticked = visible.filter((row) => !selections[row.transaction.id]?.checked);

  function update(id: number, patch: Partial<Selection>) {
    setSelections((prev) => ({
      ...prev,
      [id]: { ...(prev[id] ?? { checked: false, categoryId: null }), ...patch },
    }));
  }

  function take() {
    startTransition(async () => {
      const result = await bookExpenses(
        chosen.map((row) => ({
          transactionId: row.transaction.id,
          categoryId: selections[row.transaction.id].categoryId,
        }))
      );
      if (result.error) toast.error(result.error);
      else toast.success(`${result.expenseCount ?? 0} Ausgabe(n) übernommen.`);
    });
  }

  function ignoreUnticked() {
    startTransition(async () => {
      const result = await ignoreTransactions(unticked.map((row) => row.transaction.id));
      if (result.error) toast.error(result.error);
      else toast.success(`${result.ignoredCount ?? 0} Bewegung(en) ignoriert.`);
    });
  }

  function ignoreOne(id: number) {
    startTransition(async () => {
      const result = await ignoreTransactions([id]);
      if (result.error) toast.error(result.error);
    });
  }

  function renderRow({ transaction }: Row) {
    const selection = selections[transaction.id];
    return (
      <TableRow key={transaction.id}>
        <TableCell>
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-input accent-primary"
            checked={selection?.checked ?? false}
            onChange={(e) => update(transaction.id, { checked: e.target.checked })}
          />
        </TableCell>
        <TableCell className="whitespace-nowrap">{formatDate(transaction.date)}</TableCell>
        <TableCell className="max-w-xs truncate" title={transaction.description}>
          {transaction.counterparty && <span className="font-medium">{transaction.counterparty} · </span>}
          {transaction.description}
        </TableCell>
        <TableCell className="whitespace-nowrap">
          {formatCurrency(Math.abs(transaction.amountCents) / 100)}
        </TableCell>
        <TableCell>
          <Select
            value={selection?.categoryId ? String(selection.categoryId) : NO_CATEGORY}
            onValueChange={(value) =>
              update(transaction.id, { categoryId: !value || value === NO_CATEGORY ? null : Number(value) })
            }
          >
            <SelectTrigger className="w-48">
              <SelectValue placeholder="Kategorie">
                {(value: string | null) =>
                  !value || value === NO_CATEGORY
                    ? "Ohne Kategorie"
                    : (categories.find((c) => String(c.categoryId) === value)?.name ?? value)
                }
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_CATEGORY}>Ohne Kategorie</SelectItem>
              {categories.map((category) => (
                <SelectItem key={category.categoryId} value={String(category.categoryId)}>
                  {category.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </TableCell>
        <TableCell>
          <Button variant="ghost" size="sm" disabled={isPending} onClick={() => ignoreOne(transaction.id)}>
            Ignorieren
          </Button>
        </TableCell>
      </TableRow>
    );
  }

  const header = (
    <TableHeader>
      <TableRow>
        <TableHead className="w-10"></TableHead>
        <TableHead>Datum</TableHead>
        <TableHead>Empfänger</TableHead>
        <TableHead>Betrag</TableHead>
        <TableHead>Kategorie</TableHead>
        <TableHead className="w-24"></TableHead>
      </TableRow>
    </TableHeader>
  );

  return (
    <div className="space-y-3">
      {visible.length > 0 && (
        <div className="overflow-x-auto">
          <Table>
            {header}
            <TableBody>{visible.map(renderRow)}</TableBody>
          </Table>
        </div>
      )}

      {previouslyIgnored.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer text-muted-foreground">
            Bisher ignoriert ({previouslyIgnored.length})
          </summary>
          <div className="overflow-x-auto mt-2 opacity-70">
            <Table>
              {header}
              <TableBody>{previouslyIgnored.map(renderRow)}</TableBody>
            </Table>
          </div>
        </details>
      )}

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={ignoreUnticked} disabled={isPending || unticked.length === 0}>
          Nicht angekreuzte ignorieren ({unticked.length})
        </Button>
        <Button onClick={take} disabled={isPending || chosen.length === 0}>
          {chosen.length} als Ausgabe{chosen.length === 1 ? "" : "n"} übernehmen
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Verlauf** – `ImportHistory.tsx`:

```tsx
"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate } from "@/lib/utils";
import type { ImportOverview } from "@/lib/import/queries";
import { undoStatementImport } from "./actions";

export function ImportHistory({ imports }: { imports: ImportOverview["imports"] }) {
  const [isPending, startTransition] = useTransition();

  if (imports.length === 0) {
    return <p className="text-sm text-muted-foreground py-4">Noch keine Importe.</p>;
  }

  function undo(id: number) {
    if (!window.confirm("Diesen Import mit allen seinen Bewegungen rückgängig machen?")) return;
    startTransition(async () => {
      const result = await undoStatementImport(id);
      if (result.error) toast.error(result.error);
      else toast.success("Import rückgängig gemacht.");
    });
  }

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Importiert am</TableHead>
            <TableHead>Datei</TableHead>
            <TableHead>Zeitraum</TableHead>
            <TableHead>Bewegungen</TableHead>
            <TableHead>Verbucht</TableHead>
            <TableHead>Saldoprüfung</TableHead>
            <TableHead className="w-28"></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {imports.map((entry) => (
            <TableRow key={entry.id}>
              <TableCell className="whitespace-nowrap">{formatDate(entry.createdAt)}</TableCell>
              <TableCell>{entry.filename}</TableCell>
              <TableCell className="whitespace-nowrap">
                {entry.periodFrom && entry.periodTo
                  ? `${formatDate(entry.periodFrom)} – ${formatDate(entry.periodTo)}`
                  : "–"}
              </TableCell>
              <TableCell>{entry.importedCount}</TableCell>
              <TableCell>{entry.bookedCount}</TableCell>
              <TableCell className="max-w-xs text-xs" title={entry.balanceWarning ?? undefined}>
                {entry.balanceWarning ? (
                  <span className="text-destructive">Warnung: {entry.balanceWarning}</span>
                ) : (
                  <span className="text-muted-foreground">in Ordnung</span>
                )}
              </TableCell>
              <TableCell>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={isPending || entry.bookedCount > 0}
                  title={entry.bookedCount > 0 ? "Es sind bereits Bewegungen verbucht." : undefined}
                  onClick={() => undo(entry.id)}
                >
                  Rückgängig
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
```

- [ ] **Step 6: Typen, Lint, Build**

Run: `npx tsc --noEmit && npm run lint`
Expected: keine Fehler. (Schlägt `formatDate` bei ISO-Zeitstempeln fehl, prüfen, was `lib/utils.ts` akzeptiert, und `entry.createdAt.slice(0, 10)` übergeben.)

- [ ] **Step 7: Testfixture anlegen** (`tests/fixtures/camt053-sample.xml`) – zwei Eingänge, zwei Ausgaben, Salden stimmen (Anfang 1000.00, Ende 1039.10):

```xml
<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.04">
  <BkToCstmrStmt>
    <Stmt>
      <Id>STMT-1</Id>
      <FrToDt><FrDtTm>2026-03-01T00:00:00</FrDtTm><ToDtTm>2026-03-31T23:59:59</ToDtTm></FrToDt>
      <Acct><Id><IBAN>CH9300762011623852957</IBAN></Id><Ccy>CHF</Ccy></Acct>
      <Bal><Tp><CdOrPrtry><Cd>OPBD</Cd></CdOrPrtry></Tp><Amt Ccy="CHF">1000.00</Amt><CdtDbtInd>CRDT</CdtDbtInd><Dt><Dt>2026-03-01</Dt></Dt></Bal>
      <Bal><Tp><CdOrPrtry><Cd>CLBD</Cd></CdOrPrtry></Tp><Amt Ccy="CHF">1039.10</Amt><CdtDbtInd>CRDT</CdtDbtInd><Dt><Dt>2026-03-31</Dt></Dt></Bal>
      <Ntry><Amt Ccy="CHF">100.00</Amt><CdtDbtInd>CRDT</CdtDbtInd><Sts>BOOK</Sts><BookgDt><Dt>2026-03-05</Dt></BookgDt>
        <NtryDtls><TxDtls><Refs><AcctSvcrRef>SAMPLE-IN-1</AcctSvcrRef></Refs><RltdPties><Dbtr><Nm>Muster AG</Nm></Dbtr></RltdPties><RmtInf><Ustrd>Rechnung R 2603 0001</Ustrd></RmtInf></TxDtls></NtryDtls></Ntry>
      <Ntry><Amt Ccy="CHF">50.00</Amt><CdtDbtInd>CRDT</CdtDbtInd><Sts>BOOK</Sts><BookgDt><Dt>2026-03-08</Dt></BookgDt>
        <NtryDtls><TxDtls><Refs><AcctSvcrRef>SAMPLE-IN-2</AcctSvcrRef></Refs><RltdPties><Dbtr><Nm>Unbekannt</Nm></Dbtr></RltdPties><RmtInf><Ustrd>Geschenk</Ustrd></RmtInf></TxDtls></NtryDtls></Ntry>
      <Ntry><Amt Ccy="CHF">89.90</Amt><CdtDbtInd>DBIT</CdtDbtInd><Sts>BOOK</Sts><BookgDt><Dt>2026-03-10</Dt></BookgDt>
        <NtryDtls><TxDtls><Refs><AcctSvcrRef>SAMPLE-OUT-1</AcctSvcrRef></Refs><RltdPties><Cdtr><Nm>Swisscom AG</Nm></Cdtr></RltdPties><RmtInf><Ustrd>Mobile Abo März</Ustrd></RmtInf></TxDtls></NtryDtls></Ntry>
      <Ntry><Amt Ccy="CHF">21.00</Amt><CdtDbtInd>DBIT</CdtDbtInd><Sts>BOOK</Sts><BookgDt><Dt>2026-03-12</Dt></BookgDt>
        <NtryDtls><TxDtls><Refs><AcctSvcrRef>SAMPLE-OUT-2</AcctSvcrRef></Refs><RltdPties><Cdtr><Nm>Migros</Nm></Cdtr></RltdPties><RmtInf><Ustrd>Einkauf</Ustrd></RmtInf></TxDtls></NtryDtls></Ntry>
    </Stmt>
  </BkToCstmrStmt>
</Document>
```

Rechnung: 1000.00 + 100.00 + 50.00 − 89.90 − 21.00 = 1039.10.

- [ ] **Step 8: Manuelle Prüfung im Browser**

Run: `npm run dev`, als Admin anmelden, eine `Sent`-Rechnung mit Nummer `R-26030001` über CHF 100 anlegen (oder per Prisma Studio), unter Rechnungen → „Zahlungen importieren“ die Fixture hochladen. Erwartet:
- Meldung „4 neue Bewegungen importiert“, **keine** Saldowarnung (Verlauf: „in Ordnung“). Die Vorauswahlen sind direkt nach dem Upload ohne Seitenreload gesetzt (Regression: Tabellen werden über den Key neu montiert).
- Eingänge: Zeile „Rechnung R 2603 0001“ ist vorausgewählt und der Rechnung `R-26030001` zugeordnet (Leerzeichen-Variante). Zeile „Geschenk“ hat keine Zuordnung.
- Ausgaben: beide Zeilen **nicht** angekreuzt. Swisscom ankreuzen, Kategorie wählen, „übernehmen“ → Zeile verschwindet, unter Buchhaltung → Ausgaben erscheint „Swisscom AG – Mobile Abo März“, CHF 89.90.
- Datei erneut hochladen → „Keine neuen Bewegungen …“, Verlauf bleibt bei einem Eintrag.
- Zweiter Auszug mit „Swisscom AG“ (Fixture kopieren, Referenzen ändern): Zeile ist vorausgewählt, Kategorie vorbelegt. „Migros“ vorher ignorieren → erscheint unter „Bisher ignoriert“.
- Verlauf: „Rückgängig“ ist bei einem Import mit verbuchten Bewegungen deaktiviert.

- [ ] **Step 9: Commit**

```bash
git add "app/(app)/invoices/import" tests/fixtures
git commit -m "feat(import): show stored bank entries with payment matching and opt-in expenses

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Bankreferenz in der externen Schnittstelle

**Files:**
- Modify: `app/api/external/payments/route.ts` (Schema)
- Modify: `lib/payment-matching.ts` (Parameter, Duplikatprüfung, Weitergabe)
- Test: `tests/unit/external-payments-route.test.ts`, `tests/integration/payment-matching.test.ts`

**Interfaces:**
- Produces: `matchAndMarkPaid(params: { description: string; amountRappen: number; bookingDate?: string; bankReference?: string })`.

- [ ] **Step 1: Failing Tests**

In `tests/unit/external-payments-route.test.ts` im `describe` ergänzen (Stil der Nachbartests übernehmen, `matchAndMarkPaid` ist gemockt):

```ts
  it("passes an optional bankReference through and rejects an oversized one", async () => {
    vi.mocked(matchAndMarkPaid).mockResolvedValue({ matched: false });

    const ok = await POST(
      req(
        { description: "R-2607", amountRappen: 100, bankReference: "REF-1" },
        { "x-api-key": API_KEY }
      )
    );
    expect(ok.status).toBe(200);
    expect(matchAndMarkPaid).toHaveBeenCalledWith(
      expect.objectContaining({ bankReference: "REF-1" })
    );

    const tooLong = await POST(
      req(
        { description: "R-2607", amountRappen: 100, bankReference: "x".repeat(101) },
        { "x-api-key": API_KEY }
      )
    );
    expect(tooLong.status).toBe(400);
  });
```

In `tests/integration/payment-matching.test.ts` (die Datei hat nur `seedCustomer()`, die Rechnung wird inline angelegt; vorher `sed -n 1,40p` ansehen und `db`, `seedCustomer` und den Import von `recordPayment` an den Bestand anpassen):

```ts
  it("stores the bank reference and does not book the same reference twice", async () => {
    const customer = await seedCustomer();
    const invoice = await db.prisma.invoice.create({
      data: {
        customerId: customer.customerId,
        documentNumber: "R-26030001",
        date: new Date("2026-03-01"),
        dueDate: new Date("2099-01-01"),
        totalAmount: 100,
        state: "Sent",
      },
    });
    const actor = { user: { id: "1", name: "T", email: "t@test.ch", role: "Editor" } } as Session;
    // A first partial payment already carries the reference.
    await recordPayment(
      { invoiceId: invoice.id, amount: 40, date: new Date("2026-03-02"), source: "manual", bankReference: "REF-API", actor },
      db.prisma
    );

    // The remainder with the same reference is the same bank entry: not booked again.
    const duplicate = await matchAndMarkPaid(
      { description: "Zahlung R-26030001", amountRappen: 6000, bankReference: "REF-API" },
      db.prisma
    );
    expect(duplicate.matched).toBe(false);
    expect(await db.prisma.payment.count({ where: { invoiceId: invoice.id } })).toBe(1);

    // A different reference books the remainder and stores the reference.
    const booked = await matchAndMarkPaid(
      { description: "Zahlung R-26030001", amountRappen: 6000, bankReference: "REF-API-2" },
      db.prisma
    );
    expect(booked.matched).toBe(true);
    const payments = await db.prisma.payment.findMany({ where: { invoiceId: invoice.id }, orderBy: { id: "asc" } });
    expect(payments[1].bankReference).toBe("REF-API-2");
  });
```

- [ ] **Step 2: Fehlschlag prüfen**

Run: `npx vitest run tests/unit/external-payments-route.test.ts tests/integration/payment-matching.test.ts`
Expected: FAIL (Feld unbekannt, `bankReference` nicht gespeichert).

- [ ] **Step 3: Implementierung**

`route.ts`: im `bodySchema` ergänzen `bankReference: z.string().max(100).optional(),`.

`lib/payment-matching.ts`: Parametertyp von `matchAndMarkPaid` um `bankReference?: string` erweitern. In der Schleife nach `const { remainingRappen } = …` und der Betragsprüfung einfügen:

```ts
    if (
      params.bankReference &&
      (await prisma.payment.count({
        where: { invoiceId: invoice.id, bankReference: params.bankReference },
      })) > 0
    ) {
      continue;
    }
```

und im `recordPayment`-Aufruf `bankReference: params.bankReference,` ergänzen.

- [ ] **Step 4: Tests laufen lassen**

Run: `npx vitest run tests/unit/external-payments-route.test.ts tests/integration/payment-matching.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/api/external lib/payment-matching.ts tests
git commit -m "feat(import): accept an optional bank reference on the external payments API

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Dokumentation und Abschluss

**Files:**
- Modify: `CLAUDE.md`
- Modify: `public/benutzerhandbuch.html`
- Modify: `FEATURE_ANALYSE.md`
- Modify: `docs/superpowers/specs/2026-09-30-f7-bankabgleich-design.md` (eine Zeile)

- [ ] **Step 1: Spec-Zeilen angleichen** – in der Spec `userId String?` zu `userId Int?` ändern (wie `AuditLog.userId`), `BankStatementImport` um `balanceWarning String?` ergänzen und den Verlauf um die Saldoprüfung-Spalte. Außerdem den Punkt „**Sammelaktion:** „Alle sichtbaren ignorieren“ …“ ersetzen durch: „**Sammelaktion:** „Nicht angekreuzte ignorieren“ für den privaten Rest (nur die sichtbaren, nicht die eingeklappten Zeilen).“

- [ ] **Step 2: CLAUDE.md** – im Abschnitt „Business document workflow“ nach dem Punkt „Payments“ einen Absatz einfügen:

```
- **Bank import** (`lib/import/`, `app/(app)/invoices/import/`): an uploaded CAMT.053 statement is stored as `BankStatementImport` + `BankTransaction` rows (`importStatement` in `bank-import.ts`); nothing is booked on upload. `BankTransaction.fingerprint` is `@unique` (bank reference wins, otherwise hash of date/amount/text/counterparty plus an occurrence counter, see `dedupe.ts`), so re-uploads and overlapping statements skip known entries. A row is open while `paymentId`, `expenseId` and `ignored` are all empty; there is no status column, and deleting the `Payment`/`Expense` (`onDelete: SetNull`) opens it again. `bookPayments` goes through `recordPayment` (`source = camt-import`) and re-checks entry and invoice state, `bookExpenses` creates an `Expense` only for explicitly ticked rows (household and business share one account, so nothing is pre-selected unless the counterparty was taken over as an expense before, see `buildExpenseHints`). Balance checks (`statement-checks.ts`) only warn. `undoImport` only works while no entry of the import is booked. Matching (`matching.ts`, `document-reference.ts`) tolerates spaces/separators and a missing prefix in the invoice number; the customer name only suggests candidates, never pre-selects. `POST /api/external/payments` (Budget app) keeps working and takes an optional `bankReference`.
```

- [ ] **Step 3: Benutzerhandbuch** – `grep -n "Zahlungen importieren\|CAMT\|Kontoauszug" public/benutzerhandbuch.html`, den bestehenden Abschnitt zum Import finden und im selben Stil (HTML-Struktur, Überschriften, Liste) ergänzen: Hochladen speichert die Bewegungen; erneutes Hochladen überspringt Bekanntes; Warnung bei Saldoabweichung; Eingänge (Vorauswahl nur bei Nummer plus Betrag, Kundenname nur als Vorschlag, „Ignorieren“); Ausgaben nur mit Kreuz, bekannte Empfänger vorausgewählt, „Bisher ignoriert“, „Nicht angekreuzte ignorieren“; Importverlauf mit „Rückgängig“ (nur ohne verbuchte Bewegungen). Keine Screenshots (Skript `scripts/manual-screenshots.ts` nicht anfassen).

- [ ] **Step 4: Roadmap** – in `FEATURE_ANALYSE.md` Zeile `- [ ] 8. F7 Bankabgleich 2.0` auf `- [x] 8. F7 Bankabgleich 2.0` ändern. In der F7-Beschreibung (Zeile ~159) hinter „**Aufwand:** mittel“ keinen weiteren Text ändern; den Hinweis „camt.054 ist bewusst nicht umgesetzt (camt.053 deckt es ab)“ als neue Zeile nach `- **Code:** …` ergänzen. In den offenen Fragen (Zeile ~259) zur Budget-App notieren: „Seit F7 eigenständig im CRM; die Budget-Schnittstelle bleibt optional.“

- [ ] **Step 5: Gesamtprüfung**

Run: `npm test`
Expected: alle Tests PASS.
Run: `npm run lint`
Expected: keine Fehler.
Run: `npm run build`
Expected: Build erfolgreich.

- [ ] **Step 6: Commit**

```bash
git add CLAUDE.md public/benutzerhandbuch.html FEATURE_ANALYSE.md docs/superpowers/specs
git commit -m "docs: document F7 bank reconciliation and mark it done

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Self-Review

- **Spec-Abdeckung:** Schema (Task 1), Duplikatschutz (2), Saldoprüfung Vollständigkeit/Kontinuität (3, eingebunden in 5), Matching Nummer/Kundenname/Vorauswahlregel (4), externe Schnittstelle (8), Ablauf Upload/Eingänge/Ausgaben/Ignorieren/Bestätigen/Verlauf/Rückgängig (5–7), Audit und `requireEditor` (5, 6), Auswirkungen auf Auswertungen (`revalidateImport`, 6), Tests (in jedem Task), Dokumentation (9). Bekannte Empfänger/„Bisher ignoriert“/Sammelaktion (5, 7).
- **Typkonsistenz:** `OpenTransaction`, `ExpenseHint`, `MatchedTransaction<T>` werden in Task 5/4 definiert und in 6/7 unverändert genutzt. `bookPayments`/`bookExpenses`/`ignoreTransactions`/`undoStatementImport` heissen in Task 6 und 7 gleich. `importStatement`-Rückgabe `{ importId, importedCount, skippedCount, warnings }` stimmt in 5 und 6 überein.
- **Bewusste Lücke:** Eine fälschlich ignorierte Bewegung lässt sich nicht einzeln wiederherstellen, nur über „Rückgängig“ des ganzen Imports (Spec nennt keine Wiederherstellung).
