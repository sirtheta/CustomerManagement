import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { detectImageMime } from "@/lib/file-validation";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const id = parseInt((await params).id, 10);
  if (Number.isNaN(id)) return Response.json({ error: "Bad Request" }, { status: 400 });

  const profile = await prisma.senderProfile.findUnique({ where: { id }, select: { logo: true, updatedAt: true } });
  if (!profile?.logo) return Response.json({ error: "Not Found" }, { status: 404 });

  // Same rule as the company logo: only raster formats leave the server.
  const bytes = Buffer.from(profile.logo);
  const contentType = detectImageMime(bytes);
  if (!contentType) return Response.json({ error: "Not Found" }, { status: 404 });

  return new Response(bytes, {
    headers: { "Content-Type": contentType, "Cache-Control": "private, no-cache" },
  });
}
