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
import { verifyAuditChain, type ChainVerification } from "@/lib/audit-chain";

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
  searchParams: Promise<{ page?: string; head?: string }>;
};

const brokenReasons: Record<Extract<ChainVerification, { ok: false }>["reason"], string> = {
  "missing-hash": "Eintrag ohne Prüfsumme nach Beginn der Kette",
  "prev-mismatch": "Verkettung unterbrochen (Eintrag fehlt oder wurde eingefügt)",
  "hash-mismatch": "Inhalt des Eintrags wurde nachträglich verändert",
};

function ChainStatus({ chain }: { chain: ChainVerification }) {
  if (!chain.ok) {
    return (
      <div role="alert" className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm">
        <p className="font-medium text-destructive">Integritätsprüfung fehlgeschlagen</p>
        <p className="mt-1">
          Eintrag Nr. {chain.brokenAtId}: {brokenReasons[chain.reason]}. Das Protokoll wurde
          möglicherweise manipuliert. Bitte Datenbank-Backup sichern und prüfen.
        </p>
      </div>
    );
  }
  if (chain.checked === 0) {
    return (
      <div className="rounded-md border p-3 text-sm text-muted-foreground">
        Noch keine verketteten Einträge. Neue Einträge werden ab sofort mit einer Prüfsumme gesichert.
      </div>
    );
  }
  return (
    <div className="rounded-md border p-3 text-sm">
      <p className="font-medium">Integritätsprüfung bestanden</p>
      <p className="mt-1 text-muted-foreground">
        {chain.checked} verkettete Einträge geprüft
        {chain.legacy > 0 ? `, ${chain.legacy} ältere Einträge ohne Prüfsumme` : ""}.
        Aktueller Kopf-Hash (extern aufbewahren):{" "}
        <span className="font-mono break-all">{chain.head}</span>. Die Prüfung erkennt Änderungen
        und Löschungen einzelner Einträge, nicht aber eine vollständige Neuberechnung der Kette
        durch jemanden mit Zugriff auf die Datenbankdatei.
      </p>
    </div>
  );
}

export default async function AuditLogPage({ searchParams }: Props) {
  await requireAdmin();

  const { page, head } = await searchParams;
  const currentPage = Math.max(1, parseInt(page ?? "1", 10) || 1);

  const [logs, totalCount] = await Promise.all([
    prisma.auditLog.findMany({
      orderBy: { createdAt: "desc" },
      skip: (currentPage - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    prisma.auditLog.count(),
  ]);

  let chain: ChainVerification | null = null;
  let chainError = false;
  let headKnown: boolean | null = null;
  if (currentPage === 1) {
    try {
      chain = await verifyAuditChain(prisma);
    } catch {
      chainError = true;
    }
    const wanted = (head ?? "").trim().toLowerCase();
    if (/^[0-9a-f]{64}$/.test(wanted)) {
      headKnown = (await prisma.auditLog.findFirst({ where: { hash: wanted }, select: { id: true } })) !== null;
    }
  }

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

      {chainError && (
        <div role="alert" className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm">
          Die Integritätsprüfung konnte nicht ausgeführt werden. Details im Anwendungslog.
        </div>
      )}
      {chain && <ChainStatus chain={chain} />}
      {headKnown !== null && (
        <div className="rounded-md border p-3 text-sm">
          {headKnown
            ? "Der angefragte Hash kommt in der Kette vor: Einträge bis dahin sind noch vorhanden."
            : "Der angefragte Hash kommt in der Kette nicht vor: Einträge wurden entfernt oder verändert."}
        </div>
      )}

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
