import prisma from "@/lib/prisma";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { requireAdmin } from "@/lib/permissions";
import { resolveTheme } from "@/lib/pdf/theme";
import { Breadcrumb } from "@/components/ui/breadcrumb";
import DesignForm from "./DesignForm";

export default async function DesignSettingsPage() {
  await requireAdmin();
  const settings = await prisma.applicationSettings.findFirst();
  const theme = resolveTheme(settings?.pdfTheme);

  return (
    <div className="space-y-6">
      <Breadcrumb
        items={[{ label: "Einstellungen", href: "/settings" }, { label: "Dokument-Design" }]}
      />
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-2xl font-semibold">Dokument-Design</h1>
        <Button variant="outline" size="sm" render={<Link href="/settings" />}>
          Zurück
        </Button>
      </div>
      <p className="text-sm text-muted-foreground max-w-2xl">
        Passe das Aussehen deiner Rechnungs- und Offerten-PDFs an.
      </p>

      <DesignForm initialTheme={theme} />
    </div>
  );
}
