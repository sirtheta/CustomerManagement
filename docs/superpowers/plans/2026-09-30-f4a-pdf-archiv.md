# F4 Teil A: PDF-Archiv mit SHA-256-Hash — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Jeder Versand einer Rechnung oder Mahnung legt das exakt angehängte PDF unveränderlich unter `data/archive/JJJJ/` ab, mit SHA-256-Hash in der DB; der Versand bricht ab, wenn das Archivieren fehlschlägt.

**Architecture:** Neues Modell `SentDocument` (FK `Restrict`), ein DB-freies Modul `lib/document-archive.ts` (Datei schreiben, Hash, Pfad-Validierung, Verifikation) und ein gemeinsamer Helfer `lib/invoice-dispatch.ts` (PDF erzeugen → archivieren → senden), den die drei Rechnungs-Versandpfade (`sendDocument`, `approvePendingEmail`, `sendReminder`) aufrufen. Ein Download-Route prüft den Hash vor dem Ausliefern; die Rechnungsseite listet die versendeten Dokumente.

**Tech Stack:** Next.js 16 (App Router, Server Actions), Prisma 7 + SQLite (better-sqlite3), Node `fs/promises` + `crypto`, Vitest.

**Spec:** [docs/superpowers/specs/2026-09-30-f4a-pdf-archiv-design.md](../specs/2026-09-30-f4a-pdf-archiv-design.md)

## Global Constraints

- Archiviert werden nur **Rechnungen und Mahnungen** (`kind` = `Invoice` | `Reminder`), keine Offerten. `sendDocument` mit `kind: "quote"` bleibt unverändert.
- **Jeder Versand** erzeugt eine eigene Datei mit eigenem `SentDocument` (keine Deduplizierung).
- Speicherort: Dateisystem `data/archive/JJJJ/`, Override per `ARCHIVE_DIR`; keine BLOBs.
- Schlägt das Archivieren fehl, wird **nicht gesendet** und der Zustand bleibt unverändert (Pending-E-Mail bzw. Mahnstufe bleiben bestehen).
- Dateien werden mit `flag: "wx"` geschrieben (nie überschreiben) und danach `chmod 0444`.
- Pfad kommt nie aus Nutzereingaben: gebaut aus Jahr, normalisierter Dokumentnummer (`[A-Za-z0-9_-]`), `kind` und UTC-Zeitstempel.
- `SentDocument.invoiceId` hat `onDelete: Restrict`. `InvoiceSentLog` bleibt unverändert.
- Download-Route: nur Editor/Admin (Viewer 403), Hash-Prüfung vor Auslieferung, `409` bei fehlender oder veränderter Datei, `Cache-Control: no-store`.
- UI-Texte, Fehlermeldungen und Dokumentation sind **auf Deutsch**; Code, Bezeichner und Commit-Messages **auf Englisch** (Conventional Commits, z. B. `feat(archive): ...`). Jede Commit-Message endet mit der Zeile `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Next.js 16: vor Änderungen an Route-Handlern `node_modules/next/dist/docs/` konsultieren, falls etwas vom bestehenden Muster abweicht. Die neue Route folgt dem Muster von [app/api/invoices/[id]/pdf/route.ts](../../../app/api/invoices/%5Bid%5D/pdf/route.ts).
- Kein neuer Backup-Code (`lib/backup.ts` liegt auf dem Branch `feat/f4c-automatic-backup` und wird hier nicht angefasst).

**Vorbereitung:** Arbeitsbranch anlegen: `git switch -c feat/f4a-pdf-archive` (vom aktuellen HEAD, der die Spec enthält).

## File Structure

| Datei | Verantwortung |
|---|---|
| `prisma/schema.prisma` + neue Migration | Modell `SentDocument`, Relation `Invoice.sentDocuments` |
| `lib/document-archive.ts` (neu) | Archivordner, `archivePdf`, `resolveArchivePath`, `verifyArchived`. Kein Prisma-Import. |
| `lib/invoice-dispatch.ts` (neu) | `renderArchiveAndSend`, `sentDocumentData`, `auditArchived` |
| `lib/audit.ts` | `AuditEntity` um `"SentDocument"` erweitern |
| `lib/document-actions.ts`, `app/(app)/invoices/pending/actions.ts`, `app/(app)/invoices/reminders/actions.ts` | Nutzen den Helfer, schreiben `SentDocument` in ihre Transaktion |
| `app/api/invoices/[id]/archive/[docId]/route.ts` (neu) | Verifizierter PDF-Download |
| `app/(app)/invoices/[id]/page.tsx` | Karte «Versendete Dokumente» |
| `tests/test-utils.ts` | `sentDocument.deleteMany()` vor `invoice.deleteMany()` |
| `app/(app)/customers/actions.ts` | `deleteCustomer` meldet archivierte Rechnungen, statt am `Restrict` zu scheitern |
| Doku: Handbuch, `CLAUDE.md`, `DEPLOYMENT.md`, `FEATURE_ANALYSE.md`, Spec | Task 5 |

---

### Task 1: Datenmodell `SentDocument` und Löschschutz

**Files:**
- Modify: `prisma/schema.prisma` (Modell `Invoice` ca. Zeile 33–58, neues Modell nach `InvoiceSentLog` ca. Zeile 81)
- Create: `prisma/migrations/<timestamp>_sent_document/migration.sql` (von Prisma erzeugt)
- Modify: `lib/audit.ts:9`
- Modify: `tests/test-utils.ts:58`
- Modify: `app/(app)/customers/actions.ts` (`deleteCustomer`, ca. Zeile 161–175)
- Test: `tests/integration/sent-document.test.ts` (neu), `tests/unit/customer-actions.test.ts` (ergänzt)

**Interfaces:**
- Consumes: —
- Produces: Prisma-Modell `SentDocument` mit Feldern `id, invoiceId, kind, reminderLevel?, documentNumber, path, sha256, size, sentTo, subject, createdAt, createdById`; `Invoice.sentDocuments`; `AuditEntity` enthält `"SentDocument"`.

- [ ] **Step 1: Failing Test schreiben**

`tests/integration/sent-document.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { createTestDatabase, createValidTestCustomer } from "../test-utils";

describe("SentDocument", () => {
  const db = createTestDatabase();

  async function seed() {
    const customer = await db.prisma.customer.create({ data: createValidTestCustomer() });
    const invoice = await db.prisma.invoice.create({
      data: {
        customerId: customer.customerId,
        documentNumber: "I-26090001",
        date: new Date(),
        dueDate: new Date(),
        totalAmount: 100,
        state: "Sent",
      },
    });
    const sent = await db.prisma.sentDocument.create({
      data: {
        invoiceId: invoice.id,
        kind: "Invoice",
        documentNumber: "I-26090001",
        path: "2026/I-26090001_Invoice_20260930T101500000Z.pdf",
        sha256: "a".repeat(64),
        size: 123,
        sentTo: "kunde@test.ch",
        subject: "Rechnung",
        createdById: 1,
      },
    });
    return { customer, invoice, sent };
  }

  it("stores a sent document for an invoice", async () => {
    const { invoice, sent } = await seed();
    const found = await db.prisma.invoice.findUnique({
      where: { id: invoice.id },
      include: { sentDocuments: true },
    });
    expect(found!.sentDocuments.map((d) => d.id)).toEqual([sent.id]);
  });

  it("blocks deleting an invoice that has a sent document", async () => {
    const { invoice } = await seed();
    await expect(db.prisma.invoice.delete({ where: { id: invoice.id } })).rejects.toThrow();
    expect(await db.prisma.invoice.count({ where: { id: invoice.id } })).toBe(1);
  });

  it("blocks deleting a customer whose invoice has a sent document (no cascade around Restrict)", async () => {
    const { customer, invoice } = await seed();
    await expect(
      db.prisma.customer.delete({ where: { customerId: customer.customerId } })
    ).rejects.toThrow();
    expect(await db.prisma.invoice.count({ where: { id: invoice.id } })).toBe(1);
  });
});
```

- [ ] **Step 2: Test laufen lassen, muss fehlschlagen**

Run: `npx vitest run tests/integration/sent-document.test.ts`
Expected: FAIL (`db.prisma.sentDocument` ist `undefined` bzw. TypeScript/Prisma kennt das Modell nicht).

- [ ] **Step 3: Schema ergänzen**

In `prisma/schema.prisma` im Modell `Invoice` nach `payments        Payment[]` eine Zeile ergänzen:

```prisma
  sentDocuments   SentDocument[]
```

Nach dem Modell `InvoiceSentLog` einfügen:

```prisma
model SentDocument {
  id             Int      @id @default(autoincrement())
  invoiceId      Int
  kind           String // Invoice | Reminder
  reminderLevel  Int?
  documentNumber String
  path           String // relative to the archive root, e.g. 2026/I-26090001_Invoice_20260930T101500000Z.pdf
  sha256         String
  size           Int
  sentTo         String
  subject        String
  createdAt      DateTime @default(now())
  createdById    Int
  invoice        Invoice  @relation(fields: [invoiceId], references: [id], onDelete: Restrict)

  @@index([invoiceId])
}
```

- [ ] **Step 4: Migration erzeugen**

Run: `npx prisma migrate dev --name sent_document`
Expected: neuer Ordner `prisma/migrations/<timestamp>_sent_document/`. Prüfen: `migration.sql` enthält nur `CREATE TABLE "SentDocument"` (mit `FOREIGN KEY ... ON DELETE RESTRICT`) und `CREATE INDEX "SentDocument_invoiceId_idx"`, keine Änderungen an bestehenden Tabellen.

Run: `npx prisma generate`
(Prisma 7 führt `generate` bei `migrate dev` nicht mehr automatisch aus; ohne diesen Schritt kennt der Client `sentDocument` nicht.)

- [ ] **Step 5: `AuditEntity` und Test-Cleanup erweitern**

`lib/audit.ts:9`: `"Payment"` ergänzen zu `... | "Expense" | "Payment" | "SentDocument";`

`tests/test-utils.ts`: direkt vor `await p.invoice.deleteMany();` einfügen:

```ts
    await p.sentDocument.deleteMany();
```

- [ ] **Step 6: Test laufen lassen, muss bestehen**

Run: `npx vitest run tests/integration/sent-document.test.ts`
Expected: PASS (3 Tests). better-sqlite3 13 ist mit `SQLITE_DEFAULT_FOREIGN_KEYS=1` gebaut (geprüft: `PRAGMA foreign_keys` liefert 1), `Restrict` greift also auch in der per `prisma db push` erzeugten Test-DB. Falls «blocks deleting a customer» trotzdem fehlschlägt (Kunde wird per Cascade gelöscht), STOPPEN und melden, statt den Test abzuschwächen.

- [ ] **Step 7: Kunden-Löschung sauber abfangen**

`deleteCustomer` in `app/(app)/customers/actions.ts` löscht den Kunden direkt; mit `Restrict` würde das bei einer Rechnung mit Archiv als unbehandelter Prisma-Fehler (500) enden. (`deleteInvoice` fängt den FK-Fehler bereits ab und meldet «Es bestehen noch verknüpfte Daten», dort ist nichts zu tun.)

Test zuerst, in `tests/unit/customer-actions.test.ts`: im Prisma-Mock `sentDocument: { count: vi.fn() },` neben `payment` ergänzen und im `describe("deleteCustomer")` einfügen:

```ts
    it("refuses deletion when an invoice of the customer has an archived sent document", async () => {
      vi.mocked(auth).mockResolvedValue(adminSession);
      vi.mocked(prisma.payment.count).mockResolvedValue(0);
      vi.mocked(prisma.sentDocument.count).mockResolvedValue(1);

      const res = await deleteCustomer(7);

      expect(res).toEqual({
        error: "Der Kunde hat versendete, archivierte Rechnungen und kann nicht gelöscht werden.",
      });
      expect(prisma.sentDocument.count).toHaveBeenCalledWith({ where: { invoice: { customerId: 7 } } });
      expect(prisma.customer.delete).not.toHaveBeenCalled();
    });
```

Im bestehenden Test «deletes customer, writes audit log, and redirects» zusätzlich `vi.mocked(prisma.sentDocument.count).mockResolvedValue(0);` setzen (Implementierungen aus früheren Tests überleben `vi.clearAllMocks()`).

Run: `npx vitest run tests/unit/customer-actions.test.ts` → FAIL (neuer Test).

Dann in `deleteCustomer` direkt nach der `paymentCount`-Prüfung einfügen:

```ts
  // SentDocument.invoiceId is onDelete: Restrict; the cascade from the customer would hit it.
  const archivedCount = await prisma.sentDocument.count({ where: { invoice: { customerId: id } } });
  if (archivedCount > 0) {
    return { error: "Der Kunde hat versendete, archivierte Rechnungen und kann nicht gelöscht werden." };
  }
```

Run: `npx vitest run tests/unit/customer-actions.test.ts` → PASS.

- [ ] **Step 8: Bestehende Tests prüfen**

Run: `npm run test:integration` und `npx vitest run tests/unit`
Expected: alles grün.

- [ ] **Step 9: Commit**

```bash
git add prisma/schema.prisma prisma/migrations lib/audit.ts tests/test-utils.ts tests/integration/sent-document.test.ts "app/(app)/customers/actions.ts" tests/unit/customer-actions.test.ts
git commit -m "feat(archive): add SentDocument model with restrict delete

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: `lib/document-archive.ts`

**Files:**
- Create: `lib/document-archive.ts`
- Test: `tests/unit/document-archive.test.ts` (neu)

**Interfaces:**
- Consumes: —
- Produces (alle in `lib/document-archive.ts`):
  - `type ArchiveKind = "Invoice" | "Reminder"`
  - `interface ArchiveResult { path: string; sha256: string; size: number }`
  - `archiveRootDir(): string`
  - `sha256Hex(data: Uint8Array): string`
  - `archivePdf(input: { documentNumber: string; kind: ArchiveKind; pdf: Uint8Array; now?: Date }): Promise<ArchiveResult>`
  - `resolveArchivePath(relPath: string): string | null`
  - `type VerifyResult = { ok: true; data: Buffer } | { ok: false; reason: "missing" | "mismatch" }`
  - `verifyArchived(record: { path: string; sha256: string; size: number }): Promise<VerifyResult>`

Abweichung von der Spec: `archivePdf` bekommt die Dokumentnummer statt der ganzen Rechnung, und `verifyArchived` nimmt den DB-Datensatz statt einer ID und liefert bei Erfolg die gelesenen Bytes mit. Beides hält das Modul DB-frei; die Spec wird in Task 5 angepasst.

- [ ] **Step 1: Failing Tests schreiben**

`tests/unit/document-archive.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, chmodSync, statSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  archivePdf,
  archiveRootDir,
  resolveArchivePath,
  sha256Hex,
  verifyArchived,
} from "@/lib/document-archive";

let dir: string;
const pdf = Buffer.from("%PDF-1.4 test bytes");

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "archive-test-"));
  process.env.ARCHIVE_DIR = dir;
});

afterEach(() => {
  delete process.env.ARCHIVE_DIR;
  rmSync(dir, { recursive: true, force: true });
});

describe("archiveRootDir", () => {
  it("uses ARCHIVE_DIR when set", () => {
    expect(archiveRootDir()).toBe(dir);
  });

  it("defaults to an archive folder next to the database file", () => {
    delete process.env.ARCHIVE_DIR;
    const prev = process.env.DATABASE_URL;
    process.env.DATABASE_URL = "file:./somewhere/app.db";
    try {
      expect(archiveRootDir().replace(/\\/g, "/")).toMatch(/\/somewhere\/archive$/);
    } finally {
      if (prev === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = prev;
    }
  });
});

describe("archivePdf", () => {
  const now = new Date(2026, 8, 30, 10, 15, 0, 123); // local time, September 2026

  it("writes the file and returns path, hash and size", async () => {
    const result = await archivePdf({ documentNumber: "I-26090001", kind: "Invoice", pdf, now });
    expect(result.path).toMatch(/^2026\/I-26090001_Invoice_\d{8}T\d{9}Z\.pdf$/);
    expect(result.size).toBe(pdf.byteLength);
    expect(result.sha256).toBe(sha256Hex(pdf));
    expect(readFileSync(join(dir, result.path))).toEqual(pdf);
  });

  it("makes the file read-only", async () => {
    const result = await archivePdf({ documentNumber: "I-1", kind: "Invoice", pdf, now });
    expect(statSync(join(dir, result.path)).mode & 0o200).toBe(0);
  });

  it("normalises unsafe characters in the document number", async () => {
    const result = await archivePdf({ documentNumber: "../../etc/pass wd", kind: "Reminder", pdf, now });
    expect(result.path.startsWith("2026/")).toBe(true);
    expect(result.path).not.toContain("..");
    expect(result.path.split("/")).toHaveLength(2);
    expect(result.path).toContain("_Reminder_");
  });

  it("never overwrites an existing file", async () => {
    const fixed = new Date(2026, 8, 30, 10, 15, 0, 123);
    const first = await archivePdf({ documentNumber: "I-1", kind: "Invoice", pdf, now: fixed });
    await expect(
      archivePdf({ documentNumber: "I-1", kind: "Invoice", pdf: Buffer.from("other"), now: fixed })
    ).rejects.toThrow();
    expect(readFileSync(join(dir, first.path))).toEqual(pdf);
  });

  it("creates a distinct file for a second send", async () => {
    const a = await archivePdf({ documentNumber: "I-1", kind: "Invoice", pdf, now });
    const b = await archivePdf({
      documentNumber: "I-1",
      kind: "Invoice",
      pdf,
      now: new Date(now.getTime() + 5),
    });
    expect(a.path).not.toBe(b.path);
  });
});

describe("resolveArchivePath", () => {
  it("resolves a relative path inside the root", () => {
    expect(resolveArchivePath("2026/a.pdf")).toBe(join(dir, "2026", "a.pdf"));
  });

  it.each(["../x.pdf", "2026/../../x.pdf", "/etc/passwd", "C:\\Windows\\x.pdf", "", "."])(
    "rejects %s",
    (p) => {
      expect(resolveArchivePath(p)).toBeNull();
    }
  );
});

describe("verifyArchived", () => {
  it("returns the bytes when hash and size match", async () => {
    const a = await archivePdf({ documentNumber: "I-1", kind: "Invoice", pdf });
    const result = await verifyArchived(a);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).toEqual(pdf);
  });

  it("reports a missing file", async () => {
    const a = await archivePdf({ documentNumber: "I-1", kind: "Invoice", pdf });
    rmSync(join(dir, a.path));
    expect(await verifyArchived(a)).toEqual({ ok: false, reason: "missing" });
  });

  it("reports a path outside the root as missing", async () => {
    expect(await verifyArchived({ path: "../x.pdf", sha256: "a".repeat(64), size: 1 })).toEqual({
      ok: false,
      reason: "missing",
    });
  });

  it("reports a manipulated file", async () => {
    const a = await archivePdf({ documentNumber: "I-1", kind: "Invoice", pdf });
    const abs = join(dir, a.path);
    chmodSync(abs, 0o644);
    writeFileSync(abs, "%PDF-1.4 tampered bytes");
    expect(await verifyArchived(a)).toEqual({ ok: false, reason: "mismatch" });
  });
});
```

- [ ] **Step 2: Tests laufen lassen, müssen fehlschlagen**

Run: `npx vitest run tests/unit/document-archive.test.ts`
Expected: FAIL (Modul `@/lib/document-archive` nicht gefunden).

- [ ] **Step 3: Implementieren**

`lib/document-archive.ts`:

```ts
import { createHash } from "crypto";
import { chmod, mkdir, readFile, writeFile } from "fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "path";

/**
 * Archive of the exact PDFs that were attached to sent invoices and reminders.
 * Deliberately free of any Prisma import: the DB record (`SentDocument`) is
 * written by the caller, so this module stays testable with a temp directory.
 */

export type ArchiveKind = "Invoice" | "Reminder";

export interface ArchiveResult {
  /** Relative to `archiveRootDir()`, always with forward slashes. */
  path: string;
  sha256: string;
  size: number;
}

/** Archive root: `ARCHIVE_DIR`, else an `archive` folder next to the SQLite file (inside the data volume). */
export function archiveRootDir(): string {
  if (process.env.ARCHIVE_DIR) return resolve(process.env.ARCHIVE_DIR);
  const dbPath = (process.env.DATABASE_URL ?? "file:./data/customermanagement.db").replace(/^file:/, "");
  return resolve(dirname(dbPath), "archive");
}

export function sha256Hex(data: Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

function safeSegment(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]/g, "_");
}

/** `2026-09-30T10:15:00.123Z` → `20260930T101500123Z` */
function timestamp(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace(".", "");
}

/**
 * Writes the PDF to `<root>/<year>/<number>_<kind>_<timestamp>.pdf`. The path is
 * built from the arguments only, never from user input. `wx` refuses to
 * overwrite, and the file is made read-only afterwards.
 */
export async function archivePdf(input: {
  documentNumber: string;
  kind: ArchiveKind;
  pdf: Uint8Array;
  now?: Date;
}): Promise<ArchiveResult> {
  const now = input.now ?? new Date();
  const relPath = `${now.getFullYear()}/${safeSegment(input.documentNumber)}_${input.kind}_${timestamp(now)}.pdf`;
  const absPath = join(archiveRootDir(), relPath);

  await mkdir(dirname(absPath), { recursive: true });
  await writeFile(absPath, input.pdf, { flag: "wx" });
  await chmod(absPath, 0o444);

  return { path: relPath, sha256: sha256Hex(input.pdf), size: input.pdf.byteLength };
}

/** Resolves a stored relative path against the archive root; `null` if it would leave the root. */
export function resolveArchivePath(relPath: string): string | null {
  // Stored paths always use forward slashes. Backslashes and drive letters are
  // rejected explicitly because on Linux `isAbsolute("C:\\x")` is false and
  // `resolve` would treat the whole string as one file name inside the root.
  if (relPath === "" || isAbsolute(relPath) || /[\\\0]/.test(relPath) || /^[A-Za-z]:/.test(relPath)) {
    return null;
  }
  const root = archiveRootDir();
  const abs = resolve(root, relPath);
  const rel = relative(root, abs);
  if (rel === "" || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return null;
  return abs;
}

export type VerifyResult =
  | { ok: true; data: Buffer }
  | { ok: false; reason: "missing" | "mismatch" };

/** Reads the archived file and compares size and SHA-256 with the stored record. */
export async function verifyArchived(record: {
  path: string;
  sha256: string;
  size: number;
}): Promise<VerifyResult> {
  const abs = resolveArchivePath(record.path);
  if (!abs) return { ok: false, reason: "missing" };

  let data: Buffer;
  try {
    data = await readFile(abs);
  } catch {
    return { ok: false, reason: "missing" };
  }
  if (data.byteLength !== record.size || sha256Hex(data) !== record.sha256) {
    return { ok: false, reason: "mismatch" };
  }
  return { ok: true, data };
}
```

- [ ] **Step 4: Tests laufen lassen, müssen bestehen**

Run: `npx vitest run tests/unit/document-archive.test.ts`
Expected: PASS, auf Windows (lokal) und Linux (CI). Auf Windows mit Node 24 geprüft: `chmod 0o444` setzt das Read-only-Attribut, `statSync().mode & 0o777` liefert `444`, Schreiben scheitert mit `EPERM`, und `rmSync` (einzeln wie rekursiv mit `force`) entfernt die Datei trotzdem. Der Fall `"C:\\Windows\\x.pdf"` in `resolveArchivePath` ist nur dank der expliziten Backslash-/Laufwerksprüfung auch unter Linux `null`.

- [ ] **Step 5: Commit**

```bash
git add lib/document-archive.ts tests/unit/document-archive.test.ts
git commit -m "feat(archive): add PDF archive with SHA-256 hash and verification

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Versand-Helfer und Anbindung der drei Versandpfade

**Files:**
- Create: `lib/invoice-dispatch.ts`
- Modify: `lib/document-actions.ts:11-12` (Imports) und `:189-213` (Rechnungszweig von `sendDocument`)
- Modify: `app/(app)/invoices/pending/actions.ts:6-7` und `:54-77`
- Modify: `app/(app)/invoices/reminders/actions.ts:6-7`, `:41-47` und `:52-68`
- Modify (Mocks ergänzen): `tests/unit/document-actions.test.ts`, `tests/unit/invoice-sub-actions.test.ts`
- Test: `tests/unit/invoice-dispatch.test.ts` (neu), `tests/integration/invoice-dispatch.test.ts` (neu)

**Interfaces:**
- Consumes: `generateInvoicePdf(invoice: InvoiceWithDetails, settings): Promise<Buffer>` aus `lib/pdf/invoice-pdf.ts`; `sendInvoiceEmail(invoice, settings, pdf: Buffer, overrides?: { to?, subject?, body? }): Promise<void>` aus `lib/email.ts`; `archivePdf`, `ArchiveKind`, `ArchiveResult` aus Task 2; Modell `SentDocument` und `AuditEntity "SentDocument"` aus Task 1.
- Produces (in `lib/invoice-dispatch.ts`):
  - `renderArchiveAndSend(params: { invoice: InvoiceWithDetails; settings: DispatchSettings; kind: ArchiveKind; mail: { to: string; subject: string; body: string } }): Promise<ArchiveResult>`
  - `sentDocumentData(params: { invoiceId: number; documentNumber: string; kind: ArchiveKind; reminderLevel?: number; archive: ArchiveResult; sentTo: string; subject: string; actor: Session }): Prisma.SentDocumentUncheckedCreateInput`
  - `auditArchived(actor: Session, sent: { id: number }, documentNumber: string, archive: ArchiveResult): Promise<void>`

Fehlersemantik von `renderArchiveAndSend`: Fehler beim PDF-Erzeugen und beim Senden werden **unverändert** weitergereicht (bestehende Tests erwarten z. B. `"PDF error"`). Nur ein Archivfehler wird zu `Error("PDF konnte nicht archiviert werden. Die E-Mail wurde nicht versendet.")`.

- [ ] **Step 1: Failing Unit-Tests für den Helfer schreiben**

`tests/unit/invoice-dispatch.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/pdf/invoice-pdf", () => ({ generateInvoicePdf: vi.fn() }));
vi.mock("@/lib/email", () => ({ sendInvoiceEmail: vi.fn() }));
vi.mock("@/lib/document-archive", () => ({ archivePdf: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }));
vi.mock("@/lib/logger", () => ({
  default: { child: () => ({ error: () => {}, info: () => {}, warn: () => {} }) },
}));

import { renderArchiveAndSend, sentDocumentData, auditArchived } from "@/lib/invoice-dispatch";
import { generateInvoicePdf } from "@/lib/pdf/invoice-pdf";
import { sendInvoiceEmail } from "@/lib/email";
import { archivePdf } from "@/lib/document-archive";
import { logAudit } from "@/lib/audit";

const actor = { user: { id: "7", name: "Editor", email: "e@test.ch", role: "Editor" } } as never;
const invoice = { id: 1, documentNumber: "I-26090001", customer: {}, items: [] } as never;
const settings = { companyInfo: {} } as never;
const mail = { to: "a@b.ch", subject: "s", body: "b" };
const archive = { path: "2026/x.pdf", sha256: "a".repeat(64), size: 3 };

describe("renderArchiveAndSend", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(generateInvoicePdf).mockResolvedValue(Buffer.from("pdf"));
    vi.mocked(archivePdf).mockResolvedValue(archive);
    vi.mocked(sendInvoiceEmail).mockResolvedValue(undefined);
  });

  it("archives the exact bytes before sending them", async () => {
    const result = await renderArchiveAndSend({ invoice, settings, kind: "Invoice", mail });

    expect(result).toEqual(archive);
    expect(vi.mocked(archivePdf).mock.calls[0][0]).toMatchObject({
      documentNumber: "I-26090001",
      kind: "Invoice",
    });
    expect(vi.mocked(archivePdf).mock.calls[0][0].pdf).toEqual(Buffer.from("pdf"));
    expect(vi.mocked(sendInvoiceEmail).mock.calls[0][2]).toEqual(Buffer.from("pdf"));
    expect(vi.mocked(archivePdf).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(sendInvoiceEmail).mock.invocationCallOrder[0]
    );
  });

  it("does not send when archiving fails", async () => {
    vi.mocked(archivePdf).mockRejectedValue(new Error("EACCES"));

    await expect(renderArchiveAndSend({ invoice, settings, kind: "Invoice", mail })).rejects.toThrow(
      "PDF konnte nicht archiviert werden. Die E-Mail wurde nicht versendet."
    );
    expect(sendInvoiceEmail).not.toHaveBeenCalled();
  });

  it("passes a PDF generation error through unchanged and archives nothing", async () => {
    vi.mocked(generateInvoicePdf).mockRejectedValue(new Error("PDF error"));

    await expect(renderArchiveAndSend({ invoice, settings, kind: "Invoice", mail })).rejects.toThrow("PDF error");
    expect(archivePdf).not.toHaveBeenCalled();
    expect(sendInvoiceEmail).not.toHaveBeenCalled();
  });

  it("passes a send error through unchanged", async () => {
    vi.mocked(sendInvoiceEmail).mockRejectedValue(new Error("SMTP down"));

    await expect(renderArchiveAndSend({ invoice, settings, kind: "Reminder", mail })).rejects.toThrow("SMTP down");
  });

  it("refuses an invoice without a number", async () => {
    await expect(
      renderArchiveAndSend({ invoice: { id: 1, documentNumber: null } as never, settings, kind: "Invoice", mail })
    ).rejects.toThrow("Rechnung hat noch keine Nummer.");
    expect(archivePdf).not.toHaveBeenCalled();
  });
});

describe("sentDocumentData", () => {
  it("builds the create input including the acting user", () => {
    expect(
      sentDocumentData({
        invoiceId: 1,
        documentNumber: "I-26090001",
        kind: "Reminder",
        reminderLevel: 2,
        archive,
        sentTo: "a@b.ch",
        subject: "Mahnung",
        actor,
      })
    ).toEqual({
      invoiceId: 1,
      kind: "Reminder",
      reminderLevel: 2,
      documentNumber: "I-26090001",
      path: "2026/x.pdf",
      sha256: "a".repeat(64),
      size: 3,
      sentTo: "a@b.ch",
      subject: "Mahnung",
      createdById: 7,
    });
  });

  it("stores no reminder level for an invoice", () => {
    const data = sentDocumentData({
      invoiceId: 1,
      documentNumber: "I-1",
      kind: "Invoice",
      archive,
      sentTo: "a@b.ch",
      subject: "s",
      actor,
    });
    expect(data.reminderLevel).toBeNull();
  });
});

describe("auditArchived", () => {
  it("logs a CREATE entry for the SentDocument with hash and path", async () => {
    await auditArchived(actor, { id: 42 }, "I-26090001", archive);
    expect(logAudit).toHaveBeenCalledWith(actor, "CREATE", "SentDocument", 42, "I-26090001", {
      sha256: "a".repeat(64),
      path: "2026/x.pdf",
    });
  });
});
```

- [ ] **Step 2: Tests laufen lassen, müssen fehlschlagen**

Run: `npx vitest run tests/unit/invoice-dispatch.test.ts`
Expected: FAIL (Modul `@/lib/invoice-dispatch` nicht gefunden).

- [ ] **Step 3: Helfer implementieren**

`lib/invoice-dispatch.ts`:

```ts
import type { ApplicationSettings, CompanyInformation, Prisma } from "@prisma/client";
import type { Session } from "next-auth";
import { generateInvoicePdf, type InvoiceWithDetails } from "@/lib/pdf/invoice-pdf";
import { sendInvoiceEmail } from "@/lib/email";
import { archivePdf, type ArchiveKind, type ArchiveResult } from "@/lib/document-archive";
import { logAudit } from "@/lib/audit";
import logger from "@/lib/logger";

const log = logger.child({ module: "invoice-dispatch" });

export type DispatchSettings = ApplicationSettings & { companyInfo: CompanyInformation };

/**
 * Shared by every path that mails an invoice PDF (send, approve pending e-mail,
 * reminder): render once, archive those exact bytes, then attach the same bytes.
 * If archiving fails nothing is sent, so there is never a sent document without
 * an archive copy. PDF and mail errors pass through unchanged for the callers.
 */
export async function renderArchiveAndSend(params: {
  invoice: InvoiceWithDetails;
  settings: DispatchSettings;
  kind: ArchiveKind;
  mail: { to: string; subject: string; body: string };
}): Promise<ArchiveResult> {
  const { invoice, settings, kind, mail } = params;
  if (!invoice.documentNumber) throw new Error("Rechnung hat noch keine Nummer.");

  const pdf = await generateInvoicePdf(invoice, settings);

  let archive: ArchiveResult;
  try {
    archive = await archivePdf({ documentNumber: invoice.documentNumber, kind, pdf });
  } catch (err) {
    log.error({ invoiceId: invoice.id, kind, err }, "Archiving the PDF failed, not sending");
    throw new Error("PDF konnte nicht archiviert werden. Die E-Mail wurde nicht versendet.");
  }

  await sendInvoiceEmail(invoice, settings, pdf, mail);
  return archive;
}

/** Create input for the `SentDocument` row that callers add to their existing send transaction. */
export function sentDocumentData(params: {
  invoiceId: number;
  documentNumber: string;
  kind: ArchiveKind;
  reminderLevel?: number;
  archive: ArchiveResult;
  sentTo: string;
  subject: string;
  actor: Session;
}): Prisma.SentDocumentUncheckedCreateInput {
  return {
    invoiceId: params.invoiceId,
    kind: params.kind,
    reminderLevel: params.reminderLevel ?? null,
    documentNumber: params.documentNumber,
    path: params.archive.path,
    sha256: params.archive.sha256,
    size: params.archive.size,
    sentTo: params.sentTo,
    subject: params.subject,
    createdById: parseInt(params.actor.user.id, 10),
  };
}

export async function auditArchived(
  actor: Session,
  sent: { id: number },
  documentNumber: string,
  archive: ArchiveResult
): Promise<void> {
  await logAudit(actor, "CREATE", "SentDocument", sent.id, documentNumber, {
    sha256: archive.sha256,
    path: archive.path,
  });
}
```

- [ ] **Step 4: Unit-Tests des Helfers laufen lassen**

Run: `npx vitest run tests/unit/invoice-dispatch.test.ts`
Expected: PASS.

- [ ] **Step 5: `sendDocument` (Rechnungszweig) umstellen**

In `lib/document-actions.ts` die Import-Zeilen 11–12 (`import { generateInvoicePdf, generateQuotePdf } ...` und `import { sendInvoiceEmail, sendQuoteEmail } ...`) ersetzen durch die folgenden vier Zeilen. `generateInvoicePdf` und `sendInvoiceEmail` braucht die Datei danach nicht mehr (nur noch der Offertenzweig rendert und sendet selbst):

```ts
import { generateQuotePdf } from "@/lib/pdf/invoice-pdf";
import { sendQuoteEmail } from "@/lib/email";
import { renderArchiveAndSend, sentDocumentData, auditArchived } from "@/lib/invoice-dispatch";
import type { ArchiveResult } from "@/lib/document-archive";
```

Den `try`-Block und die Transaktion im Rechnungszweig (Zeilen 189–213: `try { const pdf = await generateInvoicePdf(...) ... }` bis einschliesslich `await logAudit(input.actor, "SEND", "Invoice", ...)`) ersetzen durch:

```ts
    let archive: ArchiveResult;
    try {
      archive = await renderArchiveAndSend({
        invoice: numbered,
        settings,
        kind: "Invoice",
        mail: { to: input.to, subject, body },
      });
    } catch (err) {
      log.error({ invoiceId: input.id, to: input.to, err }, "sendDocument (invoice) failed");
      return { error: err instanceof Error ? err.message : "Unbekannter Fehler" };
    }

    const [, , sentDocument] = await defaultPrisma.$transaction([
      // Paid/PartiallyPaid/Canceled keep their state: it is derived from payments.
      defaultPrisma.invoice.updateMany({
        where: { id: input.id, state: { in: ["Draft", "Sent", "Overdue"] } },
        data: { state: "Sent" },
      }),
      defaultPrisma.invoiceSentLog.create({
        data: { invoiceId: input.id, sentTo: input.to, subject },
      }),
      defaultPrisma.sentDocument.create({
        data: sentDocumentData({
          invoiceId: input.id,
          documentNumber,
          kind: "Invoice",
          archive,
          sentTo: input.to,
          subject,
          actor: input.actor,
        }),
      }),
    ]);
    await logAudit(input.actor, "SEND", "Invoice", input.id, documentNumber, {
      to: input.to,
    });
    await auditArchived(input.actor, sentDocument, documentNumber, archive);
```

Die folgenden Zeilen (`revalidatePath`, `revalidateTag`) bleiben. Der Offertenzweig bleibt unverändert.

- [ ] **Step 6: `approvePendingEmail` umstellen**

In `app/(app)/invoices/pending/actions.ts`: die Import-Zeilen 6–7 (`generateInvoicePdf`, `sendInvoiceEmail`) ersetzen durch

```ts
import { renderArchiveAndSend, sentDocumentData, auditArchived } from "@/lib/invoice-dispatch";
import type { ArchiveResult } from "@/lib/document-archive";
```

Den Block von `try { const pdf = ...` bis einschliesslich `await logAudit(session, "SEND", "Invoice", ...)` (Zeilen 54–77) ersetzen durch:

```ts
  let archive: ArchiveResult;
  try {
    archive = await renderArchiveAndSend({
      invoice,
      settings,
      kind: "Invoice",
      mail: { to, subject: finalSubject, body: finalBody },
    });
  } catch (err) {
    log.error({ pendingId: id, to, err }, "approvePendingEmail failed");
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
        actor: session,
      }),
    }),
  ]);

  await logAudit(session, "SEND", "Invoice", pending.invoiceId, documentNumber, {
    to,
    subject: finalSubject,
  });
  await auditArchived(session, sentDocument, documentNumber, archive);
```

- [ ] **Step 7: `sendReminder` umstellen**

In `app/(app)/invoices/reminders/actions.ts`: die Import-Zeilen 6–7 (`generateInvoicePdf`, `sendInvoiceEmail`) ersetzen durch

```ts
import { renderArchiveAndSend, sentDocumentData, auditArchived } from "@/lib/invoice-dispatch";
import type { ArchiveResult } from "@/lib/document-archive";
```

Den `try`-Block (Zeilen 41–47) ersetzen durch:

```ts
  let archive: ArchiveResult;
  try {
    archive = await renderArchiveAndSend({
      invoice: reminder.invoice,
      settings,
      kind: "Reminder",
      mail: { to, subject, body },
    });
  } catch (err) {
    log.error({ reminderId, to, err }, "sendReminder failed");
    return { error: err instanceof Error ? err.message : "Fehler beim Senden." };
  }
```

Die `cooldownDays`/`snoozedUntil`-Zeilen bleiben. Die Transaktion und den Audit-Aufruf (Zeilen 52–68) ersetzen durch:

```ts
  const [, , sentDocument] = await prisma.$transaction([
    prisma.invoiceSentLog.create({
      data: { invoiceId: reminder.invoiceId, sentTo: to, subject },
    }),
    prisma.pendingReminder.update({
      where: { id: reminderId },
      data: {
        reminderLevel: reminder.reminderLevel + 1,
        snoozedUntil,
      },
    }),
    prisma.sentDocument.create({
      data: sentDocumentData({
        invoiceId: reminder.invoiceId,
        documentNumber: reminder.invoice.documentNumber!,
        kind: "Reminder",
        reminderLevel: reminder.reminderLevel,
        archive,
        sentTo: to,
        subject,
        actor: session,
      }),
    }),
  ]);

  await logAudit(session, "SEND", "Reminder", reminder.invoiceId, reminder.invoice.documentNumber ?? undefined, {
    to,
    level: reminder.reminderLevel,
  });
  await auditArchived(session, sentDocument, reminder.invoice.documentNumber!, archive);
```

(`renderArchiveAndSend` wirft bereits vorher, wenn die Nummer fehlt; das `!` ist an dieser Stelle deshalb sicher.)

- [ ] **Step 8: Bestehende Unit-Tests anpassen und Verhalten ergänzen**

`tests/unit/document-actions.test.ts`: im Prisma-Mock `sentDocument` ergänzen und das Archiv mocken.

```ts
    sentDocument: { create: vi.fn().mockResolvedValue({ id: 1 }) },
```
(in das Objekt unter `vi.mock("@/lib/prisma", ...)`, neben `invoiceSentLog`), plus nach den anderen `vi.mock`-Zeilen:

```ts
vi.mock("@/lib/document-archive", () => ({
  archivePdf: vi.fn().mockResolvedValue({ path: "2026/x.pdf", sha256: "a".repeat(64), size: 3 }),
}));
```

Im `describe("sendDocument")` diese Tests ergänzen (Imports: `archivePdf` aus `@/lib/document-archive`):

```ts
  it("archives the invoice PDF and records a SentDocument in the same transaction", async () => {
    vi.mocked(prisma.applicationSettings.findFirst).mockResolvedValue({ companyInfo: {} } as never);
    vi.mocked(prisma.invoice.findUnique).mockResolvedValue({ id: 1, documentNumber: "I-1", customer: {}, items: [] } as never);
    vi.mocked(assignDocumentNumber).mockResolvedValue("I-1");
    vi.mocked(generateInvoicePdf).mockResolvedValue(Buffer.from("pdf"));
    vi.mocked(sendInvoiceEmail).mockResolvedValue(undefined);

    await sendDocument({ kind: "invoice", id: 1, to: "a@b.ch", subject: "s", body: "b", actor });

    expect(archivePdf).toHaveBeenCalledWith(expect.objectContaining({ documentNumber: "I-1", kind: "Invoice" }));
    expect(prisma.sentDocument.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ invoiceId: 1, kind: "Invoice", sha256: "a".repeat(64), createdById: 1 }),
    });
  });

  it("does not send or change state when archiving fails", async () => {
    vi.mocked(prisma.applicationSettings.findFirst).mockResolvedValue({ companyInfo: {} } as never);
    vi.mocked(prisma.invoice.findUnique).mockResolvedValue({ id: 1, documentNumber: "I-1", customer: {}, items: [] } as never);
    vi.mocked(assignDocumentNumber).mockResolvedValue("I-1");
    vi.mocked(generateInvoicePdf).mockResolvedValue(Buffer.from("pdf"));
    vi.mocked(archivePdf).mockRejectedValueOnce(new Error("EACCES"));

    const result = await sendDocument({ kind: "invoice", id: 1, to: "a@b.ch", subject: "s", body: "b", actor });

    expect(result.error).toBe("PDF konnte nicht archiviert werden. Die E-Mail wurde nicht versendet.");
    expect(sendInvoiceEmail).not.toHaveBeenCalled();
    expect(prisma.invoice.updateMany).not.toHaveBeenCalled();
    expect(prisma.sentDocument.create).not.toHaveBeenCalled();
  });
```

Hinweis (in der installierten Vitest 5.0.0 geprüft, `@vitest/spy` `mockClear`): `vi.clearAllMocks()` im `beforeEach` löscht nur Aufrufe und Ergebnisse, nicht die per `mockResolvedValue` gesetzten Implementierungen und auch keine noch nicht verbrauchten `…Once`-Implementierungen. Die Vorgaben für `archivePdf` und `sentDocument.create` aus der Mock-Factory bleiben also erhalten; umgekehrt muss jedes `mockRejectedValueOnce(...)` im selben Test auch wirklich verbraucht werden (in den Tests unten ist das der Fall, weil der Pfad bis `archivePdf` durchläuft).

`tests/unit/invoice-sub-actions.test.ts`: im Prisma-Mock `sentDocument: { create: vi.fn().mockResolvedValue({ id: 1 }) },` ergänzen und nach den anderen `vi.mock`-Zeilen:

```ts
vi.mock("@/lib/document-archive", () => ({
  archivePdf: vi.fn().mockResolvedValue({ path: "2026/x.pdf", sha256: "a".repeat(64), size: 3 }),
}));
```

und `import { archivePdf } from "@/lib/document-archive";`. Im `describe("sendReminder")` ergänzen:

```ts
    it("archives the reminder PDF and records a SentDocument with the reminder level", async () => {
      vi.mocked(auth).mockResolvedValue(editorSession);
      vi.mocked(prisma.pendingReminder.findUnique).mockResolvedValue({
        id: 1,
        invoiceId: 10,
        reminderLevel: 2,
        invoice: { ...mockInvoice, documentNumber: "R-2026-010" },
      } as never);
      vi.mocked(prisma.applicationSettings.findFirst).mockResolvedValue(mockSettings as never);
      vi.mocked(generateInvoicePdf).mockResolvedValue(Buffer.from("pdf") as never);
      vi.mocked(sendInvoiceEmail).mockResolvedValue(undefined);
      vi.mocked(prisma.$transaction).mockImplementation((arg: unknown) => Promise.all(arg as Promise<unknown>[]) as never);

      const result = await sendReminder({}, form({ reminderId: "1", to: "kunde@test.ch", subject: "Mahnung", body: "Text" }));

      expect(result.success).toBe(true);
      expect(archivePdf).toHaveBeenCalledWith(expect.objectContaining({ documentNumber: "R-2026-010", kind: "Reminder" }));
      expect(prisma.sentDocument.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ invoiceId: 10, kind: "Reminder", reminderLevel: 2 }),
      });
    });

    it("keeps the reminder untouched and does not send when archiving fails", async () => {
      vi.mocked(auth).mockResolvedValue(editorSession);
      vi.mocked(prisma.pendingReminder.findUnique).mockResolvedValue({
        id: 1, invoiceId: 10, reminderLevel: 1,
        invoice: { ...mockInvoice, documentNumber: "R-2026-010" },
      } as never);
      vi.mocked(prisma.applicationSettings.findFirst).mockResolvedValue(mockSettings as never);
      vi.mocked(generateInvoicePdf).mockResolvedValue(Buffer.from("pdf") as never);
      vi.mocked(archivePdf).mockRejectedValueOnce(new Error("EACCES"));

      const result = await sendReminder({}, form({ reminderId: "1", to: "k@test.ch", subject: "M", body: "T" }));

      expect(result.error).toBe("PDF konnte nicht archiviert werden. Die E-Mail wurde nicht versendet.");
      expect(sendInvoiceEmail).not.toHaveBeenCalled();
      expect(prisma.pendingReminder.update).not.toHaveBeenCalled();
      expect(prisma.sentDocument.create).not.toHaveBeenCalled();
    });
```

Im `describe("approvePendingEmail")` ergänzen (Vorbild: der bestehende Test «only moves Draft/Sent/Overdue …» weiter unten, dessen Mock-Aufbau man kopiert):

```ts
    it("keeps the pending e-mail and does not send when archiving fails", async () => {
      vi.mocked(auth).mockResolvedValue(editorSession);
      vi.mocked(prisma.pendingEmail.findUnique).mockResolvedValue({ id: 1, invoiceId: 10, invoice: mockInvoice } as never);
      vi.mocked(prisma.applicationSettings.findFirst).mockResolvedValue(mockSettings as never);
      vi.mocked(assignDocumentNumber).mockResolvedValue("R-2026-010");
      vi.mocked(generateInvoicePdf).mockResolvedValue(Buffer.from("pdf") as never);
      vi.mocked(archivePdf).mockRejectedValueOnce(new Error("EACCES"));

      const result = await approvePendingEmail({}, form({ id: "1", to: "x@x.ch", subject: "s", body: "b" }));

      expect(result.error).toBe("PDF konnte nicht archiviert werden. Die E-Mail wurde nicht versendet.");
      expect(sendInvoiceEmail).not.toHaveBeenCalled();
      expect(prisma.pendingEmail.delete).not.toHaveBeenCalled();
      expect(prisma.sentDocument.create).not.toHaveBeenCalled();
    });

    it("records a SentDocument when the pending e-mail is approved", async () => {
      vi.mocked(auth).mockResolvedValue(editorSession);
      vi.mocked(prisma.pendingEmail.findUnique).mockResolvedValue({ id: 1, invoiceId: 10, invoice: mockInvoice } as never);
      vi.mocked(prisma.applicationSettings.findFirst).mockResolvedValue(mockSettings as never);
      vi.mocked(assignDocumentNumber).mockResolvedValue("R-2026-010");
      vi.mocked(generateInvoicePdf).mockResolvedValue(Buffer.from("pdf") as never);
      vi.mocked(sendInvoiceEmail).mockResolvedValue(undefined);
      vi.mocked(prisma.$transaction).mockImplementation((arg: unknown) => Promise.all(arg as Promise<unknown>[]) as never);

      const result = await approvePendingEmail({}, form({ id: "1", to: "x@x.ch", subject: "s", body: "b" }));

      expect(result.success).toBe(true);
      expect(prisma.sentDocument.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ invoiceId: 10, kind: "Invoice", documentNumber: "R-2026-010" }),
      });
    });
```

- [ ] **Step 9: Unit-Tests laufen lassen**

Run: `npx vitest run tests/unit/invoice-dispatch.test.ts tests/unit/document-actions.test.ts tests/unit/invoice-sub-actions.test.ts`
Expected: PASS, auch alle bereits bestehenden Tests in diesen Dateien (z. B. `"PDF error"` und `"PDF failed"` bleiben unverändert).

- [ ] **Step 10: Integrationstest der drei Versandpfade mit echtem Dateisystem und echter DB**

Die Server Actions nutzen die globale Prisma-Instanz. Wie in `tests/integration/camt-import-payments.test.ts` wird `@/lib/prisma` per Proxy auf die Test-DB umgeleitet; gemockt werden nur PDF-Erzeugung, E-Mail, Rechteprüfung, `next/cache` und Logger. `lib/document-archive.ts`, `lib/invoice-dispatch.ts`, `lib/document-number.ts` und `lib/audit.ts` laufen echt.

`tests/integration/invoice-dispatch.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, readdirSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { createTestDatabase, createValidTestCustomer } from "../test-utils";

// The actions use the default prisma singleton; route it to the per-suite test DB.
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
vi.mock("@/lib/pdf/invoice-pdf", () => ({ generateInvoicePdf: vi.fn(), generateQuotePdf: vi.fn() }));
vi.mock("@/lib/email", () => ({ sendInvoiceEmail: vi.fn(), sendQuoteEmail: vi.fn() }));

import { sendDocument } from "@/lib/document-actions";
import { approvePendingEmail } from "@/app/(app)/invoices/pending/actions";
import { sendReminder } from "@/app/(app)/invoices/reminders/actions";
import { verifyArchived, sha256Hex } from "@/lib/document-archive";
import { generateInvoicePdf } from "@/lib/pdf/invoice-pdf";
import { sendInvoiceEmail } from "@/lib/email";

const actor = { user: { id: "1", name: "Editor", email: "e@test.ch", role: "Editor" } } as never;
const pdf = Buffer.from("%PDF-1.4 integration bytes");
const ARCHIVE_ERROR = "PDF konnte nicht archiviert werden. Die E-Mail wurde nicht versendet.";

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

describe("invoice send paths with real archive and database", () => {
  const db = createTestDatabase();
  let dir: string;

  beforeEach(async () => {
    holder.prisma = db.prisma;
    vi.clearAllMocks();
    vi.mocked(generateInvoicePdf).mockResolvedValue(pdf);
    vi.mocked(sendInvoiceEmail).mockResolvedValue(undefined);
    dir = mkdtempSync(join(tmpdir(), "dispatch-test-"));
    process.env.ARCHIVE_DIR = dir;
    await db.prisma.applicationSettings.create({ data: { companyInfo: { create: {} } } });
  });

  afterEach(() => {
    delete process.env.ARCHIVE_DIR;
    rmSync(dir, { recursive: true, force: true });
  });

  async function seedInvoice() {
    const customer = await db.prisma.customer.create({ data: createValidTestCustomer() });
    return db.prisma.invoice.create({
      data: {
        customerId: customer.customerId,
        documentNumber: "I-26090001",
        date: new Date(),
        dueDate: new Date(),
        totalAmount: 100,
        state: "Overdue",
      },
    });
  }

  /** Makes mkdir of the year folder fail on every platform (a file sits where the folder belongs). */
  function blockArchive() {
    writeFileSync(join(dir, String(new Date().getFullYear())), "not a directory");
  }

  async function expectArchivedAndAttached(kind: "Invoice" | "Reminder") {
    const rows = await db.prisma.sentDocument.findMany();
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.kind).toBe(kind);
    const attached = vi.mocked(sendInvoiceEmail).mock.calls[0][2];
    expect(row.sha256).toBe(sha256Hex(attached));
    expect(readFileSync(join(dir, row.path))).toEqual(attached);
    expect((await verifyArchived(row)).ok).toBe(true);
    expect(await db.prisma.invoiceSentLog.count()).toBe(1);
    return row;
  }

  it("sendDocument archives the attached bytes and writes SentDocument and InvoiceSentLog", async () => {
    const invoice = await seedInvoice();

    const result = await sendDocument({ kind: "invoice", id: invoice.id, to: "a@b.ch", subject: "s", body: "b", actor });

    expect(result).toEqual({ success: true });
    await expectArchivedAndAttached("Invoice");
    expect((await db.prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } })).state).toBe("Sent");
  });

  it("approvePendingEmail archives, records and removes the pending e-mail", async () => {
    const invoice = await seedInvoice();
    await db.prisma.pendingEmail.create({
      data: { invoiceId: invoice.id, to: "a@b.ch", subject: "s", body: "b" },
    });
    const pending = await db.prisma.pendingEmail.findFirstOrThrow();

    const result = await approvePendingEmail({}, form({ id: String(pending.id), to: "a@b.ch", subject: "s", body: "b" }));

    expect(result.success).toBe(true);
    await expectArchivedAndAttached("Invoice");
    expect(await db.prisma.pendingEmail.count()).toBe(0);
  });

  it("sendReminder archives with the reminder level at send time", async () => {
    const invoice = await seedInvoice();
    const reminder = await db.prisma.pendingReminder.create({ data: { invoiceId: invoice.id, reminderLevel: 2 } });

    const result = await sendReminder({}, form({ reminderId: String(reminder.id), to: "a@b.ch", subject: "M", body: "T" }));

    expect(result.success).toBe(true);
    const row = await expectArchivedAndAttached("Reminder");
    expect(row.reminderLevel).toBe(2);
    expect((await db.prisma.pendingReminder.findUniqueOrThrow({ where: { id: reminder.id } })).reminderLevel).toBe(3);
  });

  it("sendDocument sends nothing and changes nothing when the archive is not writable", async () => {
    const invoice = await seedInvoice();
    blockArchive();

    const result = await sendDocument({ kind: "invoice", id: invoice.id, to: "a@b.ch", subject: "s", body: "b", actor });

    expect(result.error).toBe(ARCHIVE_ERROR);
    expect(sendInvoiceEmail).not.toHaveBeenCalled();
    expect(await db.prisma.sentDocument.count()).toBe(0);
    expect(await db.prisma.invoiceSentLog.count()).toBe(0);
    expect((await db.prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } })).state).toBe("Overdue");
  });

  it("approvePendingEmail keeps the pending e-mail when the archive is not writable", async () => {
    const invoice = await seedInvoice();
    const pending = await db.prisma.pendingEmail.create({
      data: { invoiceId: invoice.id, to: "a@b.ch", subject: "s", body: "b" },
    });
    blockArchive();

    const result = await approvePendingEmail({}, form({ id: String(pending.id), to: "a@b.ch", subject: "s", body: "b" }));

    expect(result.error).toBe(ARCHIVE_ERROR);
    expect(sendInvoiceEmail).not.toHaveBeenCalled();
    expect(await db.prisma.pendingEmail.count()).toBe(1);
    expect(await db.prisma.sentDocument.count()).toBe(0);
  });

  it("sendReminder keeps the reminder level when the archive is not writable", async () => {
    const invoice = await seedInvoice();
    const reminder = await db.prisma.pendingReminder.create({ data: { invoiceId: invoice.id, reminderLevel: 1 } });
    blockArchive();

    const result = await sendReminder({}, form({ reminderId: String(reminder.id), to: "a@b.ch", subject: "M", body: "T" }));

    expect(result.error).toBe(ARCHIVE_ERROR);
    expect(sendInvoiceEmail).not.toHaveBeenCalled();
    expect((await db.prisma.pendingReminder.findUniqueOrThrow({ where: { id: reminder.id } })).reminderLevel).toBe(1);
    expect(await db.prisma.sentDocument.count()).toBe(0);
  });

  it("leaves an orphaned archive file but no DB row when sending fails after archiving", async () => {
    const invoice = await seedInvoice();
    vi.mocked(sendInvoiceEmail).mockRejectedValue(new Error("SMTP down"));

    const result = await sendDocument({ kind: "invoice", id: invoice.id, to: "a@b.ch", subject: "s", body: "b", actor });

    expect(result.error).toBe("SMTP down");
    expect(await db.prisma.sentDocument.count()).toBe(0);
    expect(await db.prisma.invoiceSentLog.count()).toBe(0);
    expect(readdirSync(join(dir, String(new Date().getFullYear())))).toHaveLength(1);
  });
});
```

Run: `npx vitest run tests/integration/invoice-dispatch.test.ts`
Expected: PASS (7 Tests). Falls ein Test an der Proxy-Umleitung scheitert (z. B. Prisma-internes `this`), nicht die Assertions abschwächen, sondern den Fehler melden.

- [ ] **Step 11: Gesamte Suite**

Run: `npm test`
Expected: alles grün. Danach `npm run lint`, erwartet ohne neue Fehler (unbenutzte Imports in den drei Action-Dateien entfernt).

- [ ] **Step 12: Commit**

```bash
git add lib/invoice-dispatch.ts lib/document-actions.ts "app/(app)/invoices/pending/actions.ts" "app/(app)/invoices/reminders/actions.ts" tests/unit/invoice-dispatch.test.ts tests/unit/document-actions.test.ts tests/unit/invoice-sub-actions.test.ts tests/integration/invoice-dispatch.test.ts
git commit -m "feat(archive): archive invoice and reminder PDFs before sending

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Download-Route und Anzeige auf der Rechnungsseite

**Files:**
- Create: `app/api/invoices/[id]/archive/[docId]/route.ts`
- Modify: `app/(app)/invoices/[id]/page.tsx` (Query ca. Zeile 65–72, neue Karte nach der Karte «Versandhistorie» ca. Zeile 205–235)
- Test: `tests/unit/invoice-archive-route.test.ts` (neu)

**Interfaces:**
- Consumes: `verifyArchived(record)` und `VerifyResult` aus Task 2; Modell `SentDocument` aus Task 1; `hasRole` aus `lib/permissions.ts`; `auth` aus `lib/auth`.
- Produces: `GET /api/invoices/[id]/archive/[docId]` (Antworten 200 `application/pdf`, 400, 401, 403, 404, 409).

- [ ] **Step 1: Failing Route-Tests schreiben**

`tests/unit/invoice-archive-route.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import type { Session } from "next-auth";
import { mkdtempSync, rmSync, chmodSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

let currentSession: Session | null;
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => currentSession) }));
vi.mock("@/lib/prisma", () => ({
  default: { sentDocument: { findFirst: vi.fn() } },
}));
vi.mock("@/lib/logger", () => ({
  default: { child: () => ({ error: () => {}, info: () => {}, warn: () => {} }) },
}));

import { GET } from "@/app/api/invoices/[id]/archive/[docId]/route";
import prisma from "@/lib/prisma";
import { archivePdf } from "@/lib/document-archive";

function sessionFor(role: "Admin" | "Editor" | "Viewer"): Session {
  return { user: { id: "1", name: "Test", email: "t@example.com", role }, expires: "2099-01-01" } as Session;
}
const req = () => new NextRequest("http://localhost/api/invoices/1/archive/5");
const ctx = (id: string, docId: string) => ({ params: Promise.resolve({ id, docId }) });

const pdf = Buffer.from("%PDF-1.4 route bytes");
let dir: string;
let row: { id: number; invoiceId: number; kind: string; documentNumber: string; path: string; sha256: string; size: number; createdAt: Date };

beforeEach(async () => {
  vi.clearAllMocks();
  dir = mkdtempSync(join(tmpdir(), "route-archive-"));
  process.env.ARCHIVE_DIR = dir;
  currentSession = sessionFor("Editor");
  const a = await archivePdf({ documentNumber: "I-26090001", kind: "Invoice", pdf });
  row = { id: 5, invoiceId: 1, kind: "Invoice", documentNumber: "I-26090001", createdAt: new Date(2026, 8, 30), ...a };
  vi.mocked(prisma.sentDocument.findFirst).mockResolvedValue(row as never);
});

afterEach(() => {
  delete process.env.ARCHIVE_DIR;
  rmSync(dir, { recursive: true, force: true });
});

describe("GET /api/invoices/[id]/archive/[docId]", () => {
  it("rejects an unauthenticated request", async () => {
    currentSession = null;
    expect((await GET(req(), ctx("1", "5"))).status).toBe(401);
  });

  it("rejects a viewer", async () => {
    currentSession = sessionFor("Viewer");
    expect((await GET(req(), ctx("1", "5"))).status).toBe(403);
  });

  it("rejects non-numeric ids", async () => {
    expect((await GET(req(), ctx("x", "5"))).status).toBe(400);
    expect((await GET(req(), ctx("1", "y"))).status).toBe(400);
  });

  it("looks the document up by both ids so a foreign docId gives 404", async () => {
    vi.mocked(prisma.sentDocument.findFirst).mockResolvedValue(null);
    const res = await GET(req(), ctx("2", "5"));
    expect(res.status).toBe(404);
    expect(prisma.sentDocument.findFirst).toHaveBeenCalledWith({ where: { id: 5, invoiceId: 2 } });
  });

  it("serves the verified PDF to an editor", async () => {
    const res = await GET(req(), ctx("1", "5"));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/pdf");
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(res.headers.get("Content-Disposition")).toContain("I-26090001_Invoice_2026-09-30.pdf");
    expect(Buffer.from(await res.arrayBuffer())).toEqual(pdf);
  });

  it("serves the PDF to an admin", async () => {
    currentSession = sessionFor("Admin");
    expect((await GET(req(), ctx("1", "5"))).status).toBe(200);
  });

  it("answers 409 when the archived file was changed", async () => {
    chmodSync(join(dir, row.path), 0o644);
    writeFileSync(join(dir, row.path), "tampered");
    const res = await GET(req(), ctx("1", "5"));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toContain("Prüfsumme");
  });

  it("answers 409 when the archived file is missing", async () => {
    rmSync(join(dir, row.path));
    const res = await GET(req(), ctx("1", "5"));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toContain("fehlt");
  });
});
```

- [ ] **Step 2: Tests laufen lassen, müssen fehlschlagen**

Run: `npx vitest run tests/unit/invoice-archive-route.test.ts`
Expected: FAIL (Route nicht gefunden).

- [ ] **Step 3: Route implementieren**

`app/api/invoices/[id]/archive/[docId]/route.ts`:

```ts
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { hasRole } from "@/lib/permissions";
import { verifyArchived } from "@/lib/document-archive";
import { UserRole } from "@prisma/client";
import { NextRequest } from "next/server";
import logger from "@/lib/logger";

const log = logger.child({ module: "api.invoice-archive" });

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; docId: string }> }
) {
  const session = await auth();
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasRole(session, [UserRole.Admin, UserRole.Editor])) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id, docId } = await params;
  const invoiceId = parseInt(id, 10);
  const sentDocumentId = parseInt(docId, 10);
  if (isNaN(invoiceId) || isNaN(sentDocumentId)) {
    return Response.json({ error: "Bad Request" }, { status: 400 });
  }

  const doc = await prisma.sentDocument.findFirst({
    where: { id: sentDocumentId, invoiceId },
  });
  if (!doc) return Response.json({ error: "Not Found" }, { status: 404 });

  const result = await verifyArchived(doc);
  if (!result.ok) {
    log.error({ sentDocumentId, invoiceId, reason: result.reason }, "Archived PDF failed verification");
    return Response.json(
      {
        error:
          result.reason === "missing"
            ? "Die Archivdatei fehlt."
            : "Die Archivdatei stimmt nicht mehr mit der gespeicherten Prüfsumme überein.",
      },
      { status: 409 }
    );
  }

  const date = doc.createdAt.toLocaleDateString("sv-SE"); // YYYY-MM-DD in server time
  const safeNumber = doc.documentNumber.replace(/[^A-Za-z0-9_-]/g, "_");
  return new Response(new Uint8Array(result.data), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${safeNumber}_${doc.kind}_${date}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}
```

- [ ] **Step 4: Route-Tests laufen lassen**

Run: `npx vitest run tests/unit/invoice-archive-route.test.ts`
Expected: PASS (8 Tests). Falls `toLocaleDateString("sv-SE")` in der Node-Version ein anderes Format liefert, durch `toDateString` aus `lib/date` (siehe `lib/logs.ts`) ersetzen.

- [ ] **Step 5: Rechnungsseite erweitern**

In `app/(app)/invoices/[id]/page.tsx` im `include` der Query nach `sentLogs: { orderBy: { sentAt: "desc" } },` ergänzen:

```ts
        sentDocuments: { orderBy: { createdAt: "desc" } },
```

Direkt nach der schliessenden `)}` der Karte «Versandhistorie» (`{invoice.sentLogs.length > 0 && ( ... )}`) einfügen:

```tsx
      {canEdit && invoice.sentDocuments.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Versendete Dokumente</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Datum</TableHead>
                    <TableHead>Art</TableHead>
                    <TableHead>Empfänger</TableHead>
                    <TableHead>Prüfsumme (SHA-256)</TableHead>
                    <TableHead>PDF</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {invoice.sentDocuments.map((doc) => (
                    <TableRow key={doc.id}>
                      <TableCell className="whitespace-nowrap">{formatDate(doc.createdAt)}</TableCell>
                      <TableCell>
                        {doc.kind === "Reminder" ? `Mahnung Stufe ${doc.reminderLevel ?? 1}` : "Rechnung"}
                      </TableCell>
                      <TableCell>{doc.sentTo}</TableCell>
                      <TableCell className="font-mono text-xs" title={doc.sha256}>
                        {doc.sha256.slice(0, 12)}…
                      </TableCell>
                      <TableCell>
                        <a
                          href={`/api/invoices/${invoice.id}/archive/${doc.id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-primary underline"
                        >
                          Öffnen
                        </a>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}
```

- [ ] **Step 6: Typen, Lint und Build prüfen**

Run: `npx tsc --noEmit` und `npm run lint`
Expected: keine neuen Fehler.

Run: `npm run build`
Expected: erfolgreich (die neue Route und die Seite kompilieren).

- [ ] **Step 7: Manuell prüfen**

Run: `npm run dev`, dann als Editor eine Rechnung versenden (mit `DISABLE_EMAIL=true` in `.env.local`, damit kein SMTP nötig ist). Erwartet: `data/archive/<Jahr>/…pdf` existiert, auf der Rechnungsseite erscheint die Karte «Versendete Dokumente», «Öffnen» zeigt das PDF; nach Änderung der Datei (Read-only-Attribut entfernen, Byte ändern) liefert «Öffnen» `409` mit der Meldung. Falls dieser manuelle Test nicht möglich ist, im Abschlussbericht ausdrücklich vermerken.

- [ ] **Step 8: Commit**

```bash
git add "app/api/invoices/[id]/archive" "app/(app)/invoices/[id]/page.tsx" tests/unit/invoice-archive-route.test.ts
git commit -m "feat(archive): verified PDF download and sent documents list

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Dokumentation, Handbuch, Spec-Angleichung und Feature-Analyse

**Files:**
- Modify: `public/benutzerhandbuch.html` (vor Zeile 573 neuer Unterabschnitt; Zeile ~577 Listeneintrag «Ausstehende Mahnungen»; Rollen-Übersicht ab Zeile ~418 nur falls dort Funktionen pro Rolle stehen)
- Modify: `CLAUDE.md` (Abschnitt «Business document workflow», Env-Tabelle)
- Modify: `DEPLOYMENT.md` (Abschnitt «3. Daten & Backup», ab Zeile 85)
- Modify: `FEATURE_ANALYSE.md:220-222`
- Modify: `docs/superpowers/specs/2026-09-30-f4a-pdf-archiv-design.md` (Signaturen, Pfadbeispiel, Dateiname, Löschschutz, Testdateien; siehe Step 7)

**Interfaces:** keine.

- [ ] **Step 1: Handbuch, neuer Unterabschnitt**

`public/benutzerhandbuch.html` enthält base64-Bilder und ist sehr gross: **nie komplett lesen oder umformatieren**, nur mit `grep -n` und `sed -n 'A,Bp' … | cut -c1-300` gezielt ansehen und mit `Edit` ändern. Diese eindeutige Zeile als Anker verwenden:

`      <h3 class="sub">Ausstehende E-Mails, Mahnungen &amp; Vorlagen</h3>`

Direkt **davor** (mit einer Leerzeile dazwischen) einfügen:

```html
      <h3 class="sub" id="archiv">Versendete Dokumente &amp; Archiv</h3>
      <p>Jedes Mal, wenn eine Rechnung oder eine Mahnung per E-Mail verschickt wird, speichert das System das <strong>exakte PDF</strong> mit einer Prüfsumme (SHA-256) im Archiv. So lässt sich später belegen, was wann an wen ging und dass die Datei seither nicht verändert wurde. Offerten werden nicht archiviert.</p>
      <ul>
        <li><strong>Liste</strong> – auf der Rechnungsseite zeigt die Karte «Versendete Dokumente» Datum, Art (Rechnung oder Mahnung mit Stufe), Empfänger und die ersten Zeichen der Prüfsumme.</li>
        <li><strong>Öffnen</strong> – der Link «Öffnen» lädt das archivierte PDF. Vorher wird die Prüfsumme kontrolliert. Sichtbar und abrufbar ist das für Editor und Admin, nicht für Viewer.</li>
        <li><strong>Mehrfacher Versand</strong> – wird dieselbe Rechnung erneut verschickt, entsteht ein eigener Archiveintrag pro Versand.</li>
        <li><strong>Löschen</strong> – Rechnungen mit archivierten Dokumenten und Kunden mit solchen Rechnungen lassen sich nicht löschen; das Archiv bleibt vollständig.</li>
      </ul>
      <div class="callout warn">
        <div class="ic">⚠️</div>
        <div><strong>Archiv nicht schreibbar</strong> Kann das PDF nicht archiviert werden (z.&nbsp;B. Datenträger voll), wird die E-Mail <strong>nicht versendet</strong> und es erscheint eine Fehlermeldung. Rechnung, ausstehende E-Mail oder Mahnung bleiben unverändert und lassen sich nach der Behebung erneut versenden.</div>
      </div>
      <div class="callout warn">
        <div class="ic">⚠️</div>
        <div><strong>Meldung «Prüfsumme stimmt nicht überein»</strong> Beim Öffnen bedeutet dies, dass die Archivdatei verändert wurde oder fehlt. Bitte den Administrator informieren und die Datei aus einer Datensicherung wiederherstellen.</div>
      </div>

```

Vorher prüfen, dass die Callout-Klasse `warn` im Dokument existiert: `grep -c 'class="callout warn"' public/benutzerhandbuch.html`. Falls 0, `tip` (existiert, siehe «Überzahlung») oder die im Dokument tatsächlich vorhandene Warn-Klasse verwenden.

- [ ] **Step 2: Handbuch, Mahnungen und Rollen**

Die Listenzeile `<li><strong>Ausstehende Mahnungen</strong> – …</li>` per `Edit` erweitern: vor dem schliessenden `</li>` den Satz ergänzen: ` Auch verschickte Mahnungen und freigegebene E-Mails werden archiviert (siehe «Versendete Dokumente &amp; Archiv»).`

Rollen-Übersicht prüfen: `sed -n '418,447p' public/benutzerhandbuch.html | cut -c1-300`. Steht dort eine Tabelle oder Liste mit Funktionen pro Rolle, eine Zeile «Archivierte Rechnungs-PDFs öffnen: Admin, Editor» im Stil der vorhandenen Zeilen ergänzen. Steht dort keine solche Aufstellung, nichts ändern.

Screenshot: optional `npm run manual:screenshots` gefolgt von `npm run manual:splice`, nur wenn der Playwright-Aufbau lokal läuft. Sonst im Abschlussbericht vermerken, dass keine Screenshots neu erstellt wurden.

- [ ] **Step 3: Handbuch-Diff prüfen**

Run: `git diff --stat public/benutzerhandbuch.html`
Expected: eine Datei, wenige eingefügte Zeilen (rund 20), keine gelöschten grossen Blöcke. Die base64-Bilder müssen unverändert sein.

- [ ] **Step 4: `CLAUDE.md`**

Im Abschnitt «Business document workflow» nach dem Punkt zu `lib/reminders.ts` ergänzen:

```
- **PDF archive** (`lib/document-archive.ts`, `lib/invoice-dispatch.ts`): every invoice and reminder mail goes through `renderArchiveAndSend` — render the PDF once, write those exact bytes to `data/archive/<year>/` (`wx`, read-only), then attach the same bytes. If archiving fails nothing is sent. The `SentDocument` row (path, SHA-256, size) is created in the send transaction next to `InvoiceSentLog`, with `onDelete: Restrict` on the invoice. Quotes are not archived. `GET /api/invoices/[id]/archive/[docId]` verifies the hash before serving (409 on mismatch or missing file)
```

In der Env-Tabelle eine Zeile ergänzen:

```
| `ARCHIVE_DIR` | No | Root of the PDF archive, defaults to an `archive` folder next to the SQLite file (`data/archive`) |
```

- [ ] **Step 5: `DEPLOYMENT.md`**

Abschnitt «3. Daten & Backup» (ab Zeile 85, vorher `sed -n '85,140p' DEPLOYMENT.md` lesen und den Stil übernehmen) um einen Absatz «PDF-Archiv» ergänzen, auf Deutsch, mit diesem Inhalt:

- Versendete Rechnungs- und Mahnungs-PDFs liegen unter `data/archive/<Jahr>/` im Datenvolume (überschreibbar per `ARCHIVE_DIR`); die Prüfsumme steht in der Datenbank.
- Der Ordner gehört zu den Daten, die aufbewahrt werden müssen: zusammen mit der Datenbanksicherung auch `data/archive/` off-site sichern (z. B. `rsync -a data/archive/ <Ziel>/archive/`). Die Dateien werden nie verändert, ein inkrementelles Kopieren genügt.
- Wenn das Archiv nicht beschreibbar ist (Platte voll, Rechte), versendet die App keine Rechnungen und Mahnungen mehr; die Fehlermeldung erscheint beim Versand.
- Wird ein Versand nach dem Archivieren abgelehnt (z. B. SMTP-Fehler), bleibt die Datei liegen, ohne Datenbankeintrag. Solche verwaisten Dateien sind harmlos und können bei Bedarf gelöscht werden.

- [ ] **Step 6: `FEATURE_ANALYSE.md`**

Vor dem Bearbeiten `git diff FEATURE_ANALYSE.md` prüfen und fremde, nicht committete Änderungen nicht mitcommitten. Zeile 220 ändern zu:

```
- [ ] 4. F4 Belegarchiv und automatisches Backup (Teil C Backup und Teil A PDF-Archiv erledigt; offen: keine Hash-Kette im Audit-Log)
```

und Zeile 222 zu `  - [x] A PDF-Archiv mit SHA-256-Hash (`lib/document-archive.ts`, `SentDocument`)`.

- [ ] **Step 7: Spec angleichen**

In `docs/superpowers/specs/2026-09-30-f4a-pdf-archiv-design.md` angleichen:

- Abschnitt «`lib/document-archive.ts` (neu)»: `archivePdf({ documentNumber, kind, pdf, now? })` (statt `invoice`) und `verifyArchived({ path, sha256, size })` mit Rückgabe `{ ok: true, data } | { ok: false, reason: "missing" | "mismatch" }` (statt `verifyArchived(id)`), jeweils mit dem Zusatz, dass das Modul dadurch ohne Prisma auskommt.
- Datenmodell-Tabelle, Beispiel bei `path`: Zeitstempel mit Millisekunden, also `2026/I-26090001_Invoice_20260930T101500123Z.pdf`.
- «Gemeinsamer Versand-Helfer», Punkt 4: `renderArchiveAndSend` liefert direkt das `ArchiveResult` (`{ path, sha256, size }`), nicht `{ archive }`.
- «UI und API»: Dateiname der Auslieferung `<Nr>_<Art>_<Datum>.pdf` (z. B. `I-26090001_Invoice_2026-09-30.pdf`).
- Datenmodell, letzter Absatz: «F3 sperrt das für Nicht-Entwürfe ohnehin» ersetzen durch den Hinweis, dass `deleteCustomer` den Fall vorab prüft und meldet und `deleteInvoice` den FK-Fehler abfängt.
- «Tests», Integration: Datei `tests/integration/invoice-dispatch.test.ts`; der `Restrict`-Fall steht in `tests/integration/sent-document.test.ts`.

- [ ] **Step 8: Abschluss-Check**

Run: `npm test`
Expected: alles grün.

Run: `git diff --stat`
Expected: nur die fünf genannten Dateien.

- [ ] **Step 9: Commit**

```bash
git add CLAUDE.md DEPLOYMENT.md public/benutzerhandbuch.html FEATURE_ANALYSE.md docs/superpowers/specs/2026-09-30-f4a-pdf-archiv-design.md
git commit -m "docs(archive): document PDF archive in manual, deployment guide and CLAUDE.md

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Self-Review (gegen die Spec)

- **Datenmodell** (`SentDocument`, `Restrict`, `AuditEntity`): Task 1. Die Löschtests inkl. Kunde stehen in Task 1.
- **`lib/document-archive.ts`** (Root, `wx`, `chmod`, Pfadbau, Traversal, Verify): Task 2, mit Abweichung bei Signaturen (in Task 5 Step 7 in die Spec zurückgeführt).
- **Gemeinsamer Helfer und drei Versandpfade**: Task 3 (`renderArchiveAndSend`, Anbindung Steps 5–7).
- **Fehlerverhalten** (Archivfehler bricht ab, Pending/Mahnung bleiben, verwaiste Datei bei Sendefehler): Unit-Tests in Task 3 (`does not send…`, `keeps the pending e-mail…`, `keeps the reminder untouched…`) und Integrationstests in Task 3 Step 10 für alle drei Pfade mit echtem Archivordner und echter DB (nicht beschreibbar; Sendefehler nach Archivierung: Datei bleibt, kein DB-Eintrag).
- **Löschschutz**: `Restrict` in Task 1 (Rechnung und Kunde, Integrationstest); `deleteCustomer` meldet den Fall statt eines 500 (Task 1 Step 7); `deleteInvoice` fängt den FK-Fehler bereits ab.
- **Audit `CREATE SentDocument` mit Hash**: `auditArchived` (Task 3), Test im Helfer.
- **UI und Download-Route** inkl. Rollen, 409, ID-Zuordnung: Task 4.
- **Backup**: kein Code, nur Doku (Task 5 Step 5).
- **Handbuch, CLAUDE.md, DEPLOYMENT.md, FEATURE_ANALYSE.md**: Task 5.
- **Integrationstests der drei Versandpfade**: Task 3 Step 10 ruft `sendDocument`, `approvePendingEmail` und `sendReminder` gegen die Test-DB auf (Proxy auf `@/lib/prisma` wie in `camt-import-payments.test.ts`); nur PDF und E-Mail sind gemockt. Die Datei heisst `tests/integration/invoice-dispatch.test.ts` statt `document-archive.test.ts` (Spec, in Task 5 Step 7 angeglichen).
- **Typkonsistenz**: `ArchiveResult`, `ArchiveKind`, `VerifyResult`, `renderArchiveAndSend`, `sentDocumentData`, `auditArchived` heissen in allen Tasks gleich; Tupel-Indizes der `$transaction`-Ergebnisse (`[, , sentDocument]` bei Rechnung und Mahnung, `[, , , sentDocument]` bei Pending) entsprechen der Reihenfolge der Array-Einträge.
