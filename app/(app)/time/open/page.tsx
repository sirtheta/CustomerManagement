import Link from "next/link";
import prisma from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { requireModule } from "@/lib/module-guard";
import { isEditorSession } from "@/lib/permissions";
import { EditorOnlyNotice } from "@/components/editor-only-notice";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate } from "@/lib/utils";
import { listOpenWork } from "@/lib/work-overview";
import { formatQuantity } from "@/lib/work-entries";
import { ChevronRightIcon } from "lucide-react";
import { BackLink } from "@/components/back-link";

export default async function OpenWorkPage() {
  await requireModule("timeTracking");
  const session = await auth();
  if (!isEditorSession(session)) return <EditorOnlyNotice />;

  const rows = await listOpenWork(prisma);
  const timeText = (r: (typeof rows)[number]) =>
    [r.hours > 0 && `${formatQuantity(r.hours)} h`, r.days > 0 && `${formatQuantity(r.days)} Tg.`].filter(Boolean).join(" + ");

  return (
    <div className="space-y-4">
      <BackLink href="/time">Zeiterfassung</BackLink>
      <div>
        <h1 className="text-2xl font-semibold">Offene Erfassungen</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Erfasste Zeit und erfasstes Material, das noch nicht verrechnet ist.</p>
      </div>
      {/* Phones: one card per customer; the table needs more width than they have. */}
      <ul className="space-y-3 lg:hidden">
        {rows.length === 0 && <li className="py-12 text-center text-muted-foreground">Keine offenen Erfassungen.</li>}
        {rows.map((r) => (
          <li key={r.customerId}>
            <Link
              href={`/time/open/${r.customerId}`}
              className="flex min-h-20 items-center gap-3 rounded-xl border bg-card px-4 py-3 transition-colors hover:bg-muted"
            >
              <span className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="flex items-center gap-2">
                  <span className="truncate text-base font-semibold">{r.customerName}</span>
                  {r.archived && <Badge variant="secondary">archiviert</Badge>}
                </span>
                <span className="text-sm text-muted-foreground">
                  {r.entryCount} {r.entryCount === 1 ? "Eintrag" : "Einträge"} · seit {formatDate(r.oldest)}
                </span>
              </span>
              <span className="flex flex-col items-end text-sm">
                <span className="font-semibold">{timeText(r) || "–"}</span>
                {r.materialCount > 0 && <span className="text-muted-foreground">{r.materialCount} Material</span>}
              </span>
              <ChevronRightIcon className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
            </Link>
          </li>
        ))}
      </ul>
      <div className="hidden overflow-x-auto lg:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Kunde</TableHead>
              <TableHead>Einträge</TableHead>
              <TableHead>Zeit</TableHead>
              <TableHead>Material</TableHead>
              <TableHead>Ältester Eintrag</TableHead>
              <TableHead className="w-40" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="py-12 text-center text-muted-foreground">
                  Keine offenen Erfassungen.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((r) => (
                <TableRow key={r.customerId}>
                  <TableCell className="font-medium">
                    {r.customerName}
                    {r.archived && (
                      <Badge variant="secondary" className="ml-2">
                        archiviert
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>{r.entryCount}</TableCell>
                  <TableCell className="whitespace-nowrap">
                    {[r.hours > 0 && `${formatQuantity(r.hours)} h`, r.days > 0 && `${formatQuantity(r.days)} Tg.`]
                      .filter(Boolean)
                      .join(" + ") || "–"}
                  </TableCell>
                  <TableCell>{r.materialCount || "–"}</TableCell>
                  <TableCell className="whitespace-nowrap">{formatDate(r.oldest)}</TableCell>
                  <TableCell>
                    <Button size="sm" render={<Link href={`/time/open/${r.customerId}`} />}>
                      Verrechnen
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
