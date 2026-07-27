"use server";

import prisma from "@/lib/prisma";

export async function generateInvoiceNumber(): Promise<string> {
  const settings = await prisma.applicationSettings.findFirst();
  const prefix = settings?.invoiceNumberPrefix ?? "R-";
  return generateNumber(prefix, "invoice");
}

export async function generateQuoteNumber(): Promise<string> {
  const settings = await prisma.applicationSettings.findFirst();
  const prefix = settings?.quoteNumberPrefix ?? "O-";
  return generateNumber(prefix, "quote");
}

async function generateNumber(
  prefix: string,
  type: "invoice" | "quote"
): Promise<string> {
  const now = new Date();
  const yy = String(now.getFullYear()).slice(-2);
  const mm = String(now.getMonth() + 1).padStart(2, "0");

  let maxSeq = 0;

  if (type === "invoice") {
    const latest = await prisma.invoice.findMany({
      where: { documentNumber: { startsWith: `${prefix}${yy}${mm}` } },
      select: { documentNumber: true },
    });
    for (const inv of latest) {
      const seq = parseInt(inv.documentNumber.slice(-4), 10);
      if (!isNaN(seq) && seq > maxSeq) maxSeq = seq;
    }
  } else {
    const latest = await prisma.quote.findMany({
      where: { documentNumber: { startsWith: `${prefix}${yy}${mm}` } },
      select: { documentNumber: true },
    });
    for (const q of latest) {
      const seq = parseInt(q.documentNumber.slice(-4), 10);
      if (!isNaN(seq) && seq > maxSeq) maxSeq = seq;
    }
  }

  const next = String(maxSeq + 1).padStart(4, "0");
  return `${prefix}${yy}${mm}${next}`;
}
