import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { generateQuotePdf } from "@/lib/pdf/invoice-pdf";
import { readCache, writeCache } from "@/lib/pdf/pdf-cache";
import { themeRevision } from "@/lib/pdf/theme";
import { senderProfileCacheSuffix } from "@/lib/sender-profile";
import { NextRequest } from "next/server";
import { moduleDisabledResponse } from "@/lib/module-guard";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const disabled = await moduleDisabledResponse("quotes");
  if (disabled) return disabled;

  const { id } = await params;
  const quoteId = parseInt(id, 10);
  if (isNaN(quoteId)) return Response.json({ error: "Bad Request" }, { status: 400 });

  const [quote, settings] = await Promise.all([
    prisma.quote.findUnique({
      where: { id: quoteId },
      include: { customer: true, senderProfile: true, items: { orderBy: { id: "asc" } } },
    }),
    prisma.applicationSettings.findFirst({
      include: { companyInfo: true },
    }),
  ]);

  if (!quote) return Response.json({ error: "Not Found" }, { status: 404 });
  if (!settings) return new Response("Bitte zuerst die Firmendaten in den Einstellungen erfassen und speichern.", {
      status: 409,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });

  const filename = quote.documentNumber
    ? `offerte-${quote.documentNumber}.pdf`
    : `entwurf-${quote.id}.pdf`;
  const cacheKey = `quote-${quoteId}-v${quote.version}-n${quote.documentNumber ?? "draft"}-t${themeRevision(settings.pdfTheme)}${senderProfileCacheSuffix(quote.senderProfile)}`;
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
