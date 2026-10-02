import { redirect } from "next/navigation";
import prisma from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { hasRole } from "@/lib/permissions";
import { logAudit } from "@/lib/audit";
import logger from "@/lib/logger";
import { UserRole } from "@prisma/client";
import { buildYearPackage, parseYearParam } from "@/lib/year-package";
import { zipStream } from "@/lib/zip";
import { moduleDisabledResponse } from "@/lib/module-guard";

const log = logger.child({ module: "api.year-package" });

export async function GET(request: Request) {
  const session = await auth();
  if (!session) redirect("/login");
  if (!hasRole(session, [UserRole.Admin, UserRole.Editor])) redirect("/dashboard");

  const disabled = await moduleDisabledResponse("accounting");
  if (disabled) return disabled;

  const now = new Date();
  const year = parseYearParam(new URL(request.url).searchParams.get("year"), now);
  if (year === null) return Response.json({ error: "Bad Request" }, { status: 400 });

  const stream = zipStream(async (add) => {
    try {
      const summary = await buildYearPackage(prisma, year, now, (entry) =>
        add(entry.name, entry.data, { store: entry.name.endsWith(".pdf") })
      );
      await logAudit(session, "EXPORT", "YearPackage", undefined, String(year), { ...summary });
    } catch (err) {
      log.error({ err, year }, "Year package failed");
      throw err;
    }
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="jahrespaket-${year}.zip"`,
      // Customer names, addresses and invoices: never cache (same as the archive route).
      "Cache-Control": "private, no-store",
    },
  });
}
