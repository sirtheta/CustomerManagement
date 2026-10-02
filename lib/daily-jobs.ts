import type { PrismaClient } from "@prisma/client";
import logger from "@/lib/logger";
import { checkAndUpdateAllDocumentStates } from "@/lib/state-manager";
import { checkOverdueInvoices } from "@/lib/reminders";
import { checkSubscriptions } from "@/lib/subscriptions";
import { closeAnsweredFollowUps, notifyDueTasks } from "@/lib/tasks";
import { sendAdminNotifications } from "@/lib/notifications";
import { getEnabledModules } from "@/lib/modules";

const log = logger.child({ module: "daily-jobs" });

export type DailyJobFailure = { step: string; error: string };

type Step = [name: string, run: () => Promise<unknown>];

/**
 * The daily jobs, in order. Used by the cron (`startNotificationScheduler`) and
 * the dev button (`triggerNotificationCheck`). Switched-off modules
 * (Einstellungen → Module) are skipped. A failing step is logged and the
 * remaining steps still run; the failures are returned.
 */
export async function runDailyJobs(prisma: PrismaClient): Promise<DailyJobFailure[]> {
  const modules = await getEnabledModules(prisma);
  const loadSettings = () =>
    prisma.applicationSettings.findFirst({ include: { companyInfo: true } });

  const steps: Step[] = [
    ["checkAndUpdateAllDocumentStates", () => checkAndUpdateAllDocumentStates(prisma)],
  ];
  if (modules.reminders) steps.push(["checkOverdueInvoices", () => checkOverdueInvoices(prisma)]);
  if (modules.subscriptions) steps.push(["checkSubscriptions", () => checkSubscriptions(prisma)]);
  if (modules.tasks) {
    steps.push(
      ["closeAnsweredFollowUps", () => closeAnsweredFollowUps(prisma)],
      ["notifyDueTasks", async () => notifyDueTasks(prisma, await loadSettings())]
    );
  }
  steps.push([
    "sendAdminNotifications",
    async () => sendAdminNotifications(prisma, await loadSettings()),
  ]);

  const failures: DailyJobFailure[] = [];
  for (const [name, step] of steps) {
    try {
      await step();
    } catch (err) {
      log.error({ err, step: name }, "Daily job step failed");
      failures.push({ step: name, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return failures;
}
