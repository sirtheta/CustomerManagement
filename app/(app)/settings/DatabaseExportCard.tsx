import { Download } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export default function DatabaseExportCard() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Datenbank</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <p className="text-xs text-muted-foreground">
          Lädt eine vollständige Kopie der Datenbank herunter (z.B. für ein Backup).
        </p>
        <Button
          variant="outline"
          size="sm"
          render={<a href="/api/export/database" download />}
        >
          <Download />
          Datenbank exportieren
        </Button>
      </CardContent>
    </Card>
  );
}
