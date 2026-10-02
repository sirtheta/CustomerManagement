import type { ApplicationSettings, PrismaClient } from "@prisma/client";

/**
 * Optional features an admin can switch off under Einstellungen → Module.
 * Switching a module off only hides it (navigation, pages, daily jobs); the
 * data stays and is back as soon as the module is switched on again.
 * Customers, invoices, settings and the audit log are the core and not listed.
 */
export const MODULE_KEYS = [
  "tasks",
  "subscriptions",
  "quotes",
  "reminders",
  "bankImport",
  "accounting",
  "analytics",
] as const;

export type ModuleKey = (typeof MODULE_KEYS)[number];
export type ModuleFlags = Record<ModuleKey, boolean>;

type ModuleField =
  | "moduleTasks"
  | "moduleSubscriptions"
  | "moduleQuotes"
  | "moduleReminders"
  | "moduleBankImport"
  | "moduleAccounting"
  | "moduleAnalytics";

export const MODULE_FIELDS: Record<ModuleKey, ModuleField> = {
  tasks: "moduleTasks",
  subscriptions: "moduleSubscriptions",
  quotes: "moduleQuotes",
  reminders: "moduleReminders",
  bankImport: "moduleBankImport",
  accounting: "moduleAccounting",
  analytics: "moduleAnalytics",
};

export const MODULE_INFO: Record<ModuleKey, { label: string; description: string }> = {
  tasks: {
    label: "Aufgaben",
    description: "Aufgaben bei Kunden, Nachfass-Aufgaben nach dem Offertenversand und die Aufgabenliste im Dashboard.",
  },
  subscriptions: {
    label: "Abos",
    description: "Wiederkehrende Rechnungen (Abos) bei Kunden samt Freigabe-Liste und täglichem Erstellen der Entwürfe.",
  },
  quotes: {
    label: "Offerten",
    description: "Offerten erstellen und versenden, in Navigation, Kundenseite, Dashboard und Suche.",
  },
  reminders: {
    label: "Mahnungen",
    description: "Zahlungserinnerungen und Mahnungen, inklusive Mahnliste und Mahngebühren in den Einstellungen.",
  },
  bankImport: {
    label: "Bankimport",
    description: "Zahlungen aus einem CAMT.053-Kontoauszug einlesen und verbuchen.",
  },
  accounting: {
    label: "Buchhaltung",
    description: "Ausgaben, Erfolgsrechnung, Offene-Posten-Liste und Jahrespaket.",
  },
  analytics: {
    label: "Auswertung",
    description: "Umsatz-Diagramme, Kategorien und Top-Kunden.",
  },
};

export function allModulesEnabled(): ModuleFlags {
  return Object.fromEntries(MODULE_KEYS.map((key) => [key, true])) as ModuleFlags;
}

/** No settings row yet (fresh install) means everything is on. */
export function modulesFromSettings(
  settings: Partial<Pick<ApplicationSettings, ModuleField>> | null | undefined
): ModuleFlags {
  const flags = allModulesEnabled();
  if (!settings) return flags;
  for (const key of MODULE_KEYS) {
    flags[key] = settings[MODULE_FIELDS[key]] ?? true;
  }
  return flags;
}

/**
 * Takes the client as an argument (like the other `lib/` jobs), so the daily
 * scheduler can use it without importing the shared Prisma singleton.
 */
export async function getEnabledModules(
  prisma: Pick<PrismaClient, "applicationSettings">
): Promise<ModuleFlags> {
  const settings = await prisma.applicationSettings.findFirst({
    select: Object.fromEntries(MODULE_KEYS.map((key) => [MODULE_FIELDS[key], true])) as Record<ModuleField, true>,
  });
  return modulesFromSettings(settings);
}

export async function isModuleEnabled(
  prisma: Pick<PrismaClient, "applicationSettings">,
  key: ModuleKey
): Promise<boolean> {
  return (await getEnabledModules(prisma))[key];
}
