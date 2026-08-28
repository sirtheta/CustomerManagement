import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { generateQuotePdf } from "@/lib/pdf/invoice-pdf";
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
  const quoteId = parseInt(id, 10);
  if (isNaN(quoteId)) return Response.json({ error: "Bad Request" }, { status: 400 });

  const [quote, settings] = await Promise.all([
    prisma.quote.findUnique({
      where: { id: quoteId },
      include: { customer: true, items: { orderBy: { id: "asc" } } },
    }),
    prisma.applicationSettings.findFirst({
      include: { companyInfo: true },
    }),
  ]);

  if (!quote) return Response.json({ error: "Not Found" }, { status: 404 });
  if (!settings) return Response.json({ error: "Company settings not configured" }, { status: 500 });

  const filename = `offerte-${quote.documentNumber}.pdf`;
  const cacheKey = `quote-${quoteId}-v${quote.version}-t${themeRevision(settings.pdfTheme)}`;
  const cached = await readCache(cacheKey);

  const headers = {
    "Content-Type": "application/pdf",
    "Content-Disposition": `inline; filename="${filename}"`,
    "Cache-Control": "private, no-store",
  };

  if (cached) {
    return new Response(new Uint8Array(cached), { headers });
  }

  const pdf = await generateQuotePdf(quote, settings);
  const buf = Buffer.from(pdf);
  await writeCache(cacheKey, buf);

  return new Response(new Uint8Array(buf), { headers });
}
