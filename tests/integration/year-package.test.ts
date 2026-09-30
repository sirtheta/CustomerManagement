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

    // Only criterion "open at the cut-off": sent 2025, no payment, still open on 31.12.2026.
    const late = await invoice("I-LATE", "2025-10-01");
    const lateDoc = await archive(late.id, "I-LATE", "2025-10-01T10:00:00Z");

    const old = await invoice("I-OLD", "2024-05-01", { state: "Paid" });
    const oldDoc = await archive(old.id, "I-OLD", "2024-05-01T10:00:00Z");
    await db.prisma.payment.create({ data: { invoiceId: old.id, date: new Date("2024-06-01T10:00:00Z"), amount: 100 } });

    const { names, summary } = await run(2026);

    expect(names).toContain(`jahrespaket-2026/rechnungen/${decDoc.fileName}`);
    expect(names).toContain(`jahrespaket-2026/rechnungen/${openDoc.fileName}`);
    expect(names).toContain(`jahrespaket-2026/rechnungen/${openReminder.fileName}`);
    expect(names).toContain(`jahrespaket-2026/rechnungen/${lateDoc.fileName}`);
    expect(names.some((n) => n.includes(oldDoc.fileName))).toBe(false);
    // I-OPEN is both sent in the year and open: every document only once.
    expect(new Set(names).size).toBe(names.length);
    expect(summary).toMatchObject({ pdfOk: 4, pdfMissing: 0, pdfMismatch: 0, withoutPdf: 0 });
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
