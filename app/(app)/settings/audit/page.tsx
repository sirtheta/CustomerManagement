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
  EXPORT: "Exportiert",
};

const actionVariants: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  CREATE: "default",
  UPDATE: "secondary",
  DELETE: "destructive",
  SEND: "outline",
  STATUS: "secondary",
  EXPORT: "outline",
};

type Props = {
  searchParams: Promise<{ page?: string; head?: string }>;
};

const brokenReasons: Record<Extract<ChainVerification, { ok: false }>["reason"], (id: number) => string> = {
  "missing-hash": (id) => `Eintrag Nr. ${id} hat keine Prüfsumme, obwohl die Prüfung bereits aktiv war.`,
  "prev-mismatch": (id) => `Eintrag Nr. ${id} fehlt oder wurde nachträglich eingefügt.`,
  "hash-mismatch": (id) => `Eintrag Nr. ${id} wurde nachträglich geändert.`,
};

function ChainStatus({ chain }: { chain: ChainVerification }) {
  if (!chain.ok) {
    return (
      <div role="alert" className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm">
        <p className="font-medium text-destructive">⚠ Das Protokoll wurde verändert</p>
        <p className="mt-1">{brokenReasons[chain.reason](chain.brokenAtId)}</p>
        <p className="mt-1">
          Bitte sichern Sie sofort ein Datenbank-Backup und informieren Sie Ihren Administrator.
        </p>
      </div>
    );
  }
  if (chain.checked === 0) {
    return (
      <div className="rounded-md border p-3 text-sm text-muted-foreground">
        Noch keine geprüften Einträge. Neue Einträge werden ab sofort gegen nachträgliche Änderungen gesichert.
      </div>
    );
  }
  return (
    <div className="rounded-md border p-3 text-sm">
      <p className="font-medium">✓ Protokoll unverändert</p>
      <p className="mt-1 text-muted-foreground">
        {chain.legacy > 0
          ? `Alle ${chain.checked} neuen Einträge sind unverändert. ${chain.legacy} ältere Einträge stammen aus der Zeit vor der Prüfung und können nicht geprüft werden.`
          : `Alle ${chain.checked} Einträge sind lückenlos und wurden nicht nachträglich verändert.`}
      </p>
      <details className="mt-2 text-muted-foreground">
        <summary className="cursor-pointer">Technische Details</summary>
        <p className="mt-1">
          Prüfcode: <span className="font-mono break-all">{chain.head}</span>
        </p>
        <p className="mt-1">
          Wer diesen Code an einem sicheren Ort notiert, kann später nachweisen, dass keine Einträge
          entfernt wurden (Adresse mit <span className="font-mono">?head=&lt;Prüfcode&gt;</span> aufrufen).
          Die Prüfung erkennt einzelne Änderungen und Löschungen. Wer direkten Zugriff auf die
          Datenbankdatei hat, könnte das Protokoll aber komplett neu aufbauen.
        </p>
      </details>
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
          Die Prüfung des Protokolls konnte nicht ausgeführt werden. Details im Anwendungslog.
        </div>
      )}
      {chain && <ChainStatus chain={chain} />}
      {headKnown !== null && (
        <div className="rounded-md border p-3 text-sm">
          {headKnown
            ? "Der angegebene Prüfcode ist im Protokoll vorhanden: Die Einträge bis dahin sind noch vollständig."
            : "Der angegebene Prüfcode ist im Protokoll nicht vorhanden: Einträge wurden entfernt oder verändert."}
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
