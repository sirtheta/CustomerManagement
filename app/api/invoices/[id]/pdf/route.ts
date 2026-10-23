import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { generateInvoicePdf } from "@/lib/pdf/invoice-pdf";
import { readCache, writeCache } from "@/lib/pdf/pdf-cache";
import { themeRevision } from "@/lib/pdf/theme";
import { senderProfileCacheSuffix } from "@/lib/sender-profile";
import { NextRequest } from "next/server";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const invoiceId = parseInt(id, 10);
  if (isNaN(invoiceId)) return Response.json({ error: "Bad Request" }, { status: 400 });

  const [invoice, settings] = await Promise.all([
    prisma.invoice.findUnique({
      where: { id: invoiceId },
      include: {
        customer: true,
        senderProfile: true,
        items: { orderBy: { id: "asc" } },
        creditNoteFor: { select: { documentNumber: true } },
      },
    }),
    prisma.applicationSettings.findFirst({
      include: { companyInfo: true },
    }),
  ]);

  if (!invoice) return Response.json({ error: "Not Found" }, { status: 404 });
  if (!settings) return new Response("Bitte zuerst die Firmendaten in den Einstellungen erfassen und speichern.", {
      status: 409,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });

  const prefix = invoice.creditNoteForId != null ? "gutschrift" : "rechnung";
  const filename = invoice.documentNumber
    ? `${prefix}-${invoice.documentNumber}.pdf`
    : `entwurf-${invoice.id}.pdf`;
  const cacheKey = `inv-${invoiceId}-v${invoice.version}-n${invoice.documentNumber ?? "draft"}-t${themeRevision(settings.pdfTheme)}${senderProfileCacheSuffix(invoice.senderProfile)}`;
  const cached = await readCache(cacheKey);

  const headers = {
    "Content-Type": "application/pdf",
    "Content-Disposition": `inline; filename="${filename}"`,
    "Cache-Control": "private, no-store",
  };

  if (cached) {
    return new Response(new Uint8Array(cached), { headers });
  }

  const pdf = await generateInvoicePdf(invoice, settings);
  const buf = Buffer.from(pdf);
  await writeCache(cacheKey, buf);

  return new Response(new Uint8Array(buf), { headers });
}
