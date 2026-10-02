import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { hasRole } from "@/lib/permissions";
import { getPaymentSummary } from "@/lib/payments";
import { generateReminderPdf } from "@/lib/pdf/reminder-pdf";
import { computeReminderCharges } from "@/lib/reminder-charges";
import { UserRole } from "@prisma/client";
import { NextRequest } from "next/server";
import { moduleDisabledResponse } from "@/lib/module-guard";

// Preview of the notice as it would be sent now (amounts recomputed like sendReminder).
// Nothing is archived or booked.
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasRole(session, [UserRole.Admin, UserRole.Editor])) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const disabled = await moduleDisabledResponse("reminders");
  if (disabled) return disabled;

  const { id } = await params;
  const reminderId = parseInt(id, 10);
  if (isNaN(reminderId)) return Response.json({ error: "Bad Request" }, { status: 400 });

  const [reminder, settings] = await Promise.all([
    prisma.pendingReminder.findUnique({
      where: { id: reminderId },
      include: {
        invoice: { include: { customer: true, items: { orderBy: { id: "asc" } } } },
      },
    }),
    prisma.applicationSettings.findFirst({ include: { companyInfo: true } }),
  ]);

  if (!reminder) return Response.json({ error: "Not Found" }, { status: 404 });
  if (!settings) return Response.json({ error: "Company settings not configured" }, { status: 500 });

  const { remainingRappen } = await getPaymentSummary(reminder.invoiceId);
  const charges = computeReminderCharges({
    level: reminder.reminderLevel,
    openRappen: remainingRappen,
    dueDate: reminder.invoice.dueDate,
    dunningDate: new Date(),
    settings,
  });
  const pdf = await generateReminderPdf(reminder.invoice, settings, charges);

  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="mahnung-vorschau-${reminder.invoice.documentNumber}-stufe${reminder.reminderLevel}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}
