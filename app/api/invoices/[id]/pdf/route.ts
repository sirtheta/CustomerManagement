import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { generateInvoicePdf } from "@/lib/pdf/invoice-pdf";
import { readCache, writeCache } from "@/lib/pdf/pdf-cache";
import { themeRevision } from "@/lib/pdf/theme";
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
      include: { customer: true, items: { orderBy: { id: "asc" } } },
    }),
    prisma.applicationSettings.findFirst({
      include: { companyInfo: true },
    }),
  ]);

  if (!invoice) return Response.json({ error: "Not Found" }, { status: 404 });
  if (!settings) return Response.json({ error: "Company settings not configured" }, { status: 500 });

  const filename = `rechnung-${invoice.documentNumber}.pdf`;
  const cacheKey = `inv-${invoiceId}-v${invoice.version}-t${themeRevision(settings.pdfTheme)}`;
  const cached = await readCache(cacheKey);

  const headers = {
    "Content-Type": "application/pdf",
    "Content-Disposition": `inline; filename="${filename}"`,
    "Cache-Control": "private, max-age=600",
  };

  if (cached) {
    return new Response(new Uint8Array(cached), { headers });
  }

  const pdf = await generateInvoicePdf(invoice, settings);
  const buf = Buffer.from(pdf);
  await writeCache(cacheKey, buf);

  return new Response(new Uint8Array(buf), { headers });
}
