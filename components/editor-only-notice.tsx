import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * Shown instead of a page whose actions all need requireEditor(), so a Viewer gets an
 * explanation instead of a form that silently redirects to the dashboard on submit.
 */
export function EditorOnlyNotice({ backHref = "/dashboard", backLabel = "Zum Dashboard" }: {
  backHref?: string;
  backLabel?: string;
}) {
  return (
    <Card className="max-w-xl">
      <CardHeader>
        <CardTitle>Keine Berechtigung</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Diese Seite ist nur für Bearbeiter. Mit der Rolle «Leser» können Sie Daten ansehen, aber nichts
          anlegen, ändern oder versenden. Wenden Sie sich an einen Administrator, wenn Sie mehr Rechte brauchen.
        </p>
        <Button variant="outline" size="sm" render={<Link href={backHref} />}>
          {backLabel}
        </Button>
      </CardContent>
    </Card>
  );
}
