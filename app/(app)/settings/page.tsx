import prisma from "@/lib/prisma";
import SettingsForm from "./SettingsForm";
import LogoCard from "./LogoCard";
import VersionCard from "./VersionCard";
import DatabaseExportCard from "./DatabaseExportCard";
import DevToolsCard from "./DevToolsCard";
import ModulesCard from "./ModulesCard";
import { modulesFromSettings } from "@/lib/modules";
import { DEFAULT_PREFIXES } from "@/lib/document-number";
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
  const modules = modulesFromSettings(s);
  // Only these two keep the Abos module from being switched off.
  const [activeSubscriptions, pendingEmails] = modules.subscriptions
    ? await Promise.all([prisma.subscription.count({ where: { active: true } }), prisma.pendingEmail.count()])
    : [0, 0];

  return (
    <div className="space-y-6">
      <div className="flex items-center flex-wrap gap-x-4 gap-y-2">
        <h1 className="text-2xl font-semibold">Einstellungen</h1>
        <div className="flex items-center flex-wrap gap-2">
          <Button variant="outline" size="sm" render={<Link href="/settings/audit" />}>
            Aktivitätsprotokoll
          </Button>
          <Button variant="outline" size="sm" render={<Link href="/settings/logs" />}>
            Logs &amp; Backups
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

          <ModulesCard modules={modules} activeSubscriptions={activeSubscriptions} pendingEmails={pendingEmails} />

          <VersionCard />

          <DatabaseExportCard />

          {process.env.NODE_ENV !== "production" && <DevToolsCard />}
        </div>

        {/* Settings: eigene Client-Komponente mit eigener <form> */}
        <SettingsForm
          showQuotes={modules.quotes}
          showReminders={modules.reminders}
          companyName={c?.companyName ?? ""}
          companyHolderName={c?.companyHolderName ?? ""}
          companyStreet={c?.companyStreet ?? ""}
          companyHouseNumber={c?.companyHouseNumber ?? ""}
          companyZip={c?.companyZip ?? ""}
          companyCity={c?.companyCity ?? ""}
          companyCountry={c?.companyCountry ?? "CH"}
          companyAddressNeedsReview={c?.companyAddressNeedsReview ?? false}
          companyEmail={c?.companyEmail ?? ""}
          companyPhone={c?.companyPhone ?? ""}
          companyIBAN={c?.companyIBAN ?? ""}
          numberFormat={s?.numberFormat ?? "de-CH"}
          defaultPaymentTermDays={s?.defaultPaymentTermDays ?? 30}
          defaultQuoteValidityDays={s?.defaultQuoteValidityDays ?? 30}
          invoiceNumberPrefix={s?.invoiceNumberPrefix ?? DEFAULT_PREFIXES.invoice}
          quoteNumberPrefix={s?.quoteNumberPrefix ?? DEFAULT_PREFIXES.quote}
          useHolderNameOnQR={s?.useHolderNameOnQR ?? false}
          roundTotalTo5Rappen={s?.roundTotalTo5Rappen ?? false}
          smtpHost={s?.smtpHost ?? ""}
          smtpPort={s?.smtpPort ?? 587}
          smtpUser={s?.smtpUser ?? ""}
          smtpPasswordSet={!!s?.smtpPassword}
          smtpFromName={s?.smtpFromName ?? ""}
          smtpFromAddress={s?.smtpFromAddress ?? ""}
          emailSubjectTemplate={s?.emailSubjectTemplate ?? ""}
          emailBodyTemplate={s?.emailBodyTemplate ?? ""}
          reminderCooldownDays={s?.reminderCooldownDays ?? 14}
          reminderFeeLevel2={(s?.reminderFeeLevel2Rappen ?? 0) / 100}
          reminderFeeLevel3={(s?.reminderFeeLevel3Rappen ?? 0) / 100}
          reminderFeeLevel4={(s?.reminderFeeLevel4Rappen ?? 0) / 100}
          reminderInterestPercent={Number(s?.reminderInterestPercent ?? 0)}
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
