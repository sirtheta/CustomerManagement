import { checkForUpdate } from "@/lib/check-update";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { RELEASES_URL } from "@/lib/release-links";
import pkg from "../../../package.json";

export default async function VersionCard() {
  const result = await checkForUpdate();
  const currentVersion = result?.currentVersion ?? pkg.version;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Version</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">
            v{currentVersion}
          </span>
          {result === null && <Badge variant="outline">Status unbekannt</Badge>}
          {result && !result.hasUpdate && <Badge variant="secondary">Aktuell</Badge>}
          {result?.hasUpdate && <Badge>Update verfügbar</Badge>}
        </div>

        <a
          href={RELEASES_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-primary hover:underline block"
        >
          {result?.hasUpdate ? `v${result.latestVersion} ansehen →` : "Changelog →"}
        </a>

        {result === null && (
          <p className="text-xs text-muted-foreground">
            Update-Check fehlgeschlagen — GitHub nicht erreichbar.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
