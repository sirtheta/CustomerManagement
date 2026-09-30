import Link from "next/link";
import prisma from "@/lib/prisma";
import { requireEditor } from "@/lib/permissions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { formatCurrency, formatDate } from "@/lib/utils";
import { documentLabel } from "@/lib/document-display";
import { AGE_BUCKETS, fetchReceivables } from "@/lib/receivables";

type Props = { searchParams: Promise<{ asOf?: string }> };

function parseAsOf(raw: string | undefined): Date {
  const parsed = raw ? new Date(`${raw}T23:59:59.999Z`) : null;
  if (parsed && !isNaN(parsed.getTime())) return parsed;
  const now = new Date();
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999));
}

export default async function ReceivablesPage({ searchParams }: Props) {
  await requireEditor();
  const { asOf: asOfParam } = await searchParams;
  const asOf = parseAsOf(asOfParam);
  const asOfValue = asOf.toISOString().slice(0, 10);
  const report = await fetchReceivables(prisma, asOf);
  const lastYearEnd = `${new Date().getFullYear() - 1}-12-31`;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Offene Posten</h1>

      <form className="flex flex-wrap items-end gap-3" method="get">
        <div className="space-y-1.5">
          <Label htmlFor="asOf">Stichtag</Label>
          <Input id="asOf" name="asOf" type="date" defaultValue={asOfValue} className="w-40" />
        </div>
        <Button type="submit" variant="outline">Anzeigen</Button>
        <Button variant="ghost" render={<Link href={`?asOf=${lastYearEnd}`} />}>31.12. Vorjahr</Button>
        <Button variant="outline" render={<a href={`/api/export/receivables?asOf=${asOfValue}`} />}>CSV-Export</Button>
      </form>

      <Card>
        <CardHeader><CardTitle className="text-base">Altersstruktur</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                {AGE_BUCKETS.map((b) => <TableHead key={b.key}>{b.label}</TableHead>)}
                <TableHead>Total offen</TableHead>
                <TableHead>Guthaben</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                {AGE_BUCKETS.map((b) => (
                  <TableCell key={b.key}>{formatCurrency(report.bucketTotals[b.key] / 100)}</TableCell>
                ))}
                <TableCell className="font-semibold">{formatCurrency(report.totalOpenRappen / 100)}</TableCell>
                <TableCell>{formatCurrency(report.totalCreditRappen / 100)}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Pro Kunde</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Kunde</TableHead>
                <TableHead>Offen</TableHead>
                <TableHead>Guthaben</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {report.byCustomer.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={3} className="text-center text-gray-500 py-8">
                    Keine offenen Posten zum Stichtag.
                  </TableCell>
                </TableRow>
              ) : (
                report.byCustomer.map((c) => (
                  <TableRow key={c.customerId}>
                    <TableCell>
                      <Link href={`/customers/${c.customerId}`} className="underline">{c.customerName}</Link>
                    </TableCell>
                    <TableCell>{formatCurrency(c.openRappen / 100)}</TableCell>
                    <TableCell>{formatCurrency(c.creditRappen / 100)}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Rechnungen</CardTitle></CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Rechnung</TableHead>
                  <TableHead>Kunde</TableHead>
                  <TableHead>Datum</TableHead>
                  <TableHead>Fällig</TableHead>
                  <TableHead>Total</TableHead>
                  <TableHead>Bezahlt</TableHead>
                  <TableHead>Offen</TableHead>
                  <TableHead>Guthaben</TableHead>
                  <TableHead>Alter</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {report.rows.map((r) => (
                  <TableRow key={r.invoiceId}>
                    <TableCell>
                      <Link href={`/invoices/${r.invoiceId}`} className="underline">
                        {documentLabel(r.documentNumber)}
                      </Link>
                    </TableCell>
                    <TableCell>{r.customerName}</TableCell>
                    <TableCell>{formatDate(r.date)}</TableCell>
                    <TableCell>{formatDate(r.dueDate)}</TableCell>
                    <TableCell>{formatCurrency(r.totalRappen / 100)}</TableCell>
                    <TableCell>{formatCurrency(r.paidRappen / 100)}</TableCell>
                    <TableCell>{r.openRappen > 0 ? formatCurrency(r.openRappen / 100) : ""}</TableCell>
                    <TableCell>{r.creditRappen > 0 ? formatCurrency(r.creditRappen / 100) : ""}</TableCell>
                    <TableCell>{AGE_BUCKETS.find((b) => b.key === r.bucket)?.label ?? ""}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
