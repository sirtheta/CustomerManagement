import prisma from "@/lib/prisma";
import { requireAdmin } from "@/lib/permissions";
import { resolveTheme } from "@/lib/pdf/theme";
import { SettingsBackLink } from "@/components/settings-back-link";
import DesignForm from "./DesignForm";

export default async function DesignSettingsPage() {
  await requireAdmin();
  const settings = await prisma.applicationSettings.findFirst();
  const theme = resolveTheme(settings?.pdfTheme);

  return (
    <div className="space-y-6">
      <SettingsBackLink />
      <h1 className="text-2xl font-semibold">Dokument-Design</h1>
      <p className="text-sm text-muted-foreground max-w-2xl">
        Passe das Aussehen deiner Rechnungs- und Offerten-PDFs an.
      </p>

      <DesignForm initialTheme={theme} />
    </div>
  );
}
