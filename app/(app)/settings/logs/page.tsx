import Link from "next/link";
import { requireAdmin } from "@/lib/permissions";
import { listLogFiles } from "@/lib/logs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

function formatDateCH(str: string): string {
  const [y, m, d] = str.split("-");
  return `${d}.${m}.${y}`;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default async function LogsPage() {
  await requireAdmin();

  const files = listLogFiles();

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Logs</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Anwendungs-Logs zum Herunterladen — bisher nur über <code>docker logs</code> einsehbar.
            Die laufende Datei wird täglich abgeschnitten; ältere Tage bleiben so lange, wie die
            Aufbewahrungsfrist es erlaubt.
          </p>
        </div>
        <Link href="/settings" className="text-sm text-muted-foreground hover:text-foreground">
          ← Einstellungen
        </Link>
      </div>

      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Datum</TableHead>
              <TableHead>Datei</TableHead>
              <TableHead>Grösse</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {files.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="text-center text-muted-foreground py-8">
                  Noch keine Logdateien vorhanden.
                </TableCell>
              </TableRow>
            ) : (
              files.map((file) => (
                <TableRow key={file.name}>
                  <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                    {formatDateCH(file.date)}
                  </TableCell>
                  <TableCell className="text-sm">
                    {file.name}
                    {file.current && (
                      <Badge variant="outline" className="ml-2">
                        Laufend
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {formatSize(file.sizeBytes)}
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="outline"
                      size="sm"
                      render={<a href={`/api/logs/${encodeURIComponent(file.name)}`} />}
                    >
                      Herunterladen
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
