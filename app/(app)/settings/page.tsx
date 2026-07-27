import prisma from "@/lib/prisma";
import SettingsForm from "./SettingsForm";
import LogoCard from "./LogoCard";
import VersionCard from "./VersionCard";
import DevToolsCard from "./DevToolsCard";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { requireAdmin } from "@/lib/permissions";

export default async function SettingsPage() {
  await requireAdmin();
  const settings = await prisma.applicationSettings.findFirst({
    include: { companyInfo: true },
  });
  const c = settings?.companyInfo;
  const s = settings;

  return (
    <div className="space-y-6">
      <div className="flex items-center flex-wrap gap-x-4 gap-y-2">
        <h1 className="text-2xl font-semibold">Einstellungen</h1>
        <div className="flex items-center flex-wrap gap-2">
          <Button variant="outline" size="sm" render={<Link href="/settings/audit" />}>
            Aktivitätsprotokoll
          </Button>
          <Button variant="outline" size="sm" render={<Link href="/settings/users" />}>
            Benutzer verwalten
          </Button>
          <Button variant="outline" size="sm" render={<Link href="/settings/categories" />}>
            Kategorien
          </Button>
          <Button variant="outline" size="sm" render={<Link href="/settings/design" />}>
            Dokument-Design
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[300px_1fr] gap-6 items-start">
        <div className="space-y-6">
          {/* Logo: eigene Client-Komponente mit eigener <form> — nie verschachtelt */}
          <LogoCard hasLogo={!!c?.companyLogo} />

          <VersionCard />

          {process.env.NODE_ENV !== "production" && <DevToolsCard />}
        </div>

        {/* Settings: eigene Client-Komponente mit eigener <form> */}
        <SettingsForm
          companyName={c?.companyName ?? ""}
          companyHolderName={c?.companyHolderName ?? ""}
          companyAddress={c?.companyAddress ?? ""}
          companyZip={c?.companyZip ?? ""}
          companyCity={c?.companyCity ?? ""}
          companyEmail={c?.companyEmail ?? ""}
          companyPhone={c?.companyPhone ?? ""}
          companyIBAN={c?.companyIBAN ?? ""}
          numberFormat={s?.numberFormat ?? "de-CH"}
          defaultPaymentTermDays={s?.defaultPaymentTermDays ?? 30}
          defaultQuoteValidityDays={s?.defaultQuoteValidityDays ?? 30}
          invoiceNumberPrefix={s?.invoiceNumberPrefix ?? "R-"}
          quoteNumberPrefix={s?.quoteNumberPrefix ?? "A-"}
          useHolderNameOnQR={s?.useHolderNameOnQR ?? false}
          smtpHost={s?.smtpHost ?? ""}
          smtpPort={s?.smtpPort ?? 587}
          smtpUser={s?.smtpUser ?? ""}
          smtpPasswordSet={!!s?.smtpPassword}
          smtpFromName={s?.smtpFromName ?? ""}
          smtpFromAddress={s?.smtpFromAddress ?? ""}
          emailSubjectTemplate={s?.emailSubjectTemplate ?? ""}
          emailBodyTemplate={s?.emailBodyTemplate ?? ""}
          reminderCooldownDays={s?.reminderCooldownDays ?? 14}
          notifyOverdueEnabled={s?.notifyOverdueEnabled ?? false}
          notifyPendingEnabled={s?.notifyPendingEnabled ?? false}
          notifyEmailAddress={s?.notifyEmailAddress ?? ""}
          notifyTelegramBotTokenSet={!!s?.notifyTelegramBotToken}
          notifyTelegramChatId={s?.notifyTelegramChatId ?? ""}
          notifyRepeatIntervalDays={s?.notifyRepeatIntervalDays ?? null}
        />
      </div>
    </div>
  );
}
