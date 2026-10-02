import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => ({ user: { id: "1", name: "Editor", role: "Editor" } })),
}));
vi.mock("@/lib/prisma", () => ({
  default: {
    pendingReminder: { findUnique: vi.fn() },
    applicationSettings: { findFirst: vi.fn() },
  },
}));
vi.mock("@/lib/payments", () => ({ getPaymentSummary: vi.fn(async () => ({ remainingRappen: 10000 })) }));
vi.mock("@/lib/pdf/reminder-pdf", () => ({ generateReminderPdf: vi.fn(async () => Buffer.from("%PDF")) }));
vi.mock("@/lib/reminder-charges", () => ({ computeReminderCharges: vi.fn(() => ({})) }));

import { GET } from "@/app/api/reminders/[id]/pdf/route";
import prisma from "@/lib/prisma";

const req = () => new NextRequest("http://localhost/api/reminders/4/pdf");
const ctx = { params: Promise.resolve({ id: "4" }) };

describe("GET /api/reminders/[id]/pdf", () => {
  beforeEach(() => {
    vi.mocked(prisma.applicationSettings.findFirst).mockResolvedValue({} as never);
  });

  it("keeps quotes and umlauts of the document number out of the header", async () => {
    vi.mocked(prisma.pendingReminder.findUnique).mockResolvedValue({
      invoiceId: 9,
      reminderLevel: 2,
      invoice: { documentNumber: 'Rä-"26"0001', dueDate: new Date(2026, 0, 1) },
    } as never);

    const res = await GET(req(), ctx);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Disposition")).toBe(
      'inline; filename="mahnung-vorschau-R_-_26_0001-stufe2.pdf"'
    );
  });
});
