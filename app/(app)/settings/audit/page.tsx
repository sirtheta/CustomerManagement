import prisma from "@/lib/prisma";
import { requireAdmin } from "@/lib/permissions";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Pagination } from "@/components/ui/pagination";
import Link from "next/link";

const PAGE_SIZE = 50;

const actionLabels: Record<string, string> = {
  CREATE: "Erstellt",
  UPDATE: "Aktualisiert",
  DELETE: "Gelöscht",
  SEND: "Versendet",
  STATUS: "Status geändert",
};

const actionVariants: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  CREATE: "default",
  UPDATE: "secondary",
  DELETE: "destructive",
  SEND: "outline",
  STATUS: "secondary",
};

type Props = {
  searchParams: Promise<{ page?: string }>;
};

export default async function AuditLogPage({ searchParams }: Props) {
  await requireAdmin();

  const { page } = await searchParams;
  const currentPage = Math.max(1, parseInt(page ?? "1", 10) || 1);

  const [logs, totalCount] = await Promise.all([
    prisma.auditLog.findMany({
      orderBy: { createdAt: "desc" },
      skip: (currentPage - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    prisma.auditLog.count(),
  ]);

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const baseHref = "/settings/audit";

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Aktivitätsprotokoll</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Alle Änderungen in der Anwendung</p>
        </div>
        <Link href="/settings" className="text-sm text-muted-foreground hover:text-foreground">
          ← Einstellungen
        </Link>
      </div>

      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Zeitpunkt</TableHead>
              <TableHead>Benutzer</TableHead>
              <TableHead>Aktion</TableHead>
              <TableHead>Entität</TableHead>
              <TableHead>Referenz</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {logs.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                  Noch keine Aktivitäten aufgezeichnet.
                </TableCell>
              </TableRow>
            ) : (
              logs.map((log) => (
                <TableRow key={log.id}>
                  <TableCell className="whitespace-nowrap text-sm">
                    {log.createdAt.toLocaleDateString("de-CH")}{" "}
                    <span className="text-muted-foreground text-xs">
                      {log.createdAt.toLocaleTimeString("de-CH", { hour: "2-digit", minute: "2-digit" })}
                    </span>
                  </TableCell>
                  <TableCell className="text-sm">{log.userName}</TableCell>
                  <TableCell>
                    <Badge variant={actionVariants[log.action] ?? "secondary"}>
                      {actionLabels[log.action] ?? log.action}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">{log.entityType}</TableCell>
                  <TableCell className="text-sm font-medium">{log.entityRef ?? "—"}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <Pagination
        currentPage={currentPage}
        totalPages={totalPages}
        totalCount={totalCount}
        pageSize={PAGE_SIZE}
        baseHref={baseHref}
      />
    </div>
  );
}
