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
  // Named categories alphabetically, expenses without category last.
  const categories = [...byCategory.entries()].sort(
    ([a], [b]) => Number(a === "") - Number(b === "") || a.localeCompare(b, "de")
  );

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
