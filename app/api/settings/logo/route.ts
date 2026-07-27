import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { detectImageMime } from "@/lib/file-validation";

export async function GET() {
  const session = await auth();
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const settings = await prisma.applicationSettings.findFirst({
    include: { companyInfo: true },
  });

  const logo = settings?.companyInfo?.companyLogo;
  if (!logo) return Response.json({ error: "Not Found" }, { status: 404 });

  // Uploads are normalized to PNG by sharp; only serve raster formats.
  // Anything else (e.g. legacy SVG data, which could carry scripts) is
  // refused rather than handed to the browser.
  const bytes = Buffer.from(logo);
  const contentType = detectImageMime(bytes);
  if (!contentType) return Response.json({ error: "Not Found" }, { status: 404 });

  return new Response(bytes, {
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "private, max-age=3600",
    },
  });
}
