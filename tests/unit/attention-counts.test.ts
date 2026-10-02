import { describe, it, expect, vi } from "vitest";
import { allModulesEnabled, type ModuleFlags } from "@/lib/modules";
import { attentionBanners, loadAttentionCounts, loadWorkCounts } from "@/lib/attention-counts";

const modulesWith = (off: Partial<ModuleFlags>): ModuleFlags => ({ ...allModulesEnabled(), ...off });

function fakeDb(
  atLastLevel: { id: number; invoiceId: number; reminderLevel: number; createdAt: Date }[] = [],
  levelFourDocs: { invoiceId: number; createdAt: Date }[] = []
) {
  return {
    pendingEmail: { count: vi.fn().mockResolvedValue(2) },
    pendingReminder: { count: vi.fn().mockResolvedValue(3), findMany: vi.fn().mockResolvedValue(atLastLevel) },
    invoice: { count: vi.fn().mockResolvedValue(7) },
    sentDocument: { findMany: vi.fn().mockResolvedValue(levelFourDocs) },
  };
}

describe("loadWorkCounts", () => {
  it("counts pending mails and not-snoozed reminders for editors", async () => {
    const db = fakeDb();
    const now = new Date("2026-10-02T10:00:00Z");
    const notSnoozed = { OR: [{ snoozedUntil: null }, { snoozedUntil: { lte: now } }] };
    expect(await loadWorkCounts(db as never, allModulesEnabled(), true, now)).toEqual({
      pendingEmails: 2,
      dueReminders: 3,
    });
    expect(db.pendingReminder.count).toHaveBeenCalledWith({ where: notSnoozed });
    expect(db.pendingReminder.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { AND: [notSnoozed, { reminderLevel: { gte: 4 } }] } })
    );
    expect(db.sentDocument.findMany).not.toHaveBeenCalled();
  });

  it("does not count reminders whose last level was already sent", async () => {
    const created = new Date("2026-09-01T00:00:00Z");
    const db = fakeDb(
      [
        { id: 1, invoiceId: 10, reminderLevel: 4, createdAt: created }, // level 4 sent → not counted
        { id: 2, invoiceId: 11, reminderLevel: 4, createdAt: created }, // level 4 not sent yet → counted
        { id: 3, invoiceId: 12, reminderLevel: 4, createdAt: created }, // level 4 sent before a restart → counted
      ],
      [
        { invoiceId: 10, createdAt: new Date("2026-09-20T00:00:00Z") },
        { invoiceId: 12, createdAt: new Date("2026-08-01T00:00:00Z") },
      ]
    );
    expect((await loadWorkCounts(db as never, allModulesEnabled(), true)).dueReminders).toBe(2);
  });

  it("returns 0 without querying for Viewers and switched-off modules", async () => {
    const db = fakeDb();
    expect(await loadWorkCounts(db as never, allModulesEnabled(), false)).toEqual({ pendingEmails: 0, dueReminders: 0 });
    expect(await loadWorkCounts(db as never, modulesWith({ subscriptions: false, reminders: false }), true)).toEqual({
      pendingEmails: 0,
      dueReminders: 0,
    });
    expect(db.pendingEmail.count).not.toHaveBeenCalled();
    expect(db.pendingReminder.count).not.toHaveBeenCalled();
  });
});

describe("loadAttentionCounts", () => {
  it("only counts overdue invoices when the reminder list is not available", async () => {
    const db = fakeDb();
    expect((await loadAttentionCounts(db as never, allModulesEnabled(), true)).overdueInvoices).toBe(0);
    expect(db.invoice.count).not.toHaveBeenCalled();
    expect((await loadAttentionCounts(db as never, allModulesEnabled(), false)).overdueInvoices).toBe(7);
  });
});

describe("attentionBanners", () => {
  const counts = { pendingEmails: 2, dueReminders: 1, overdueInvoices: 4 };

  it("gives editors one reminder banner and one approval banner, each with its own target", () => {
    const banners = attentionBanners(counts, allModulesEnabled(), true);
    expect(banners.map((b) => [b.key, b.href])).toEqual([
      ["reminders", "/invoices/reminders"],
      ["pendingEmails", "/invoices/pending"],
    ]);
    expect(banners[0].text).toBe("1 überfällige Rechnung wartet auf eine Mahnung.");
    expect(banners[1].text).toBe("2 Abo-Rechnungen warten auf Freigabe und Versand.");
  });

  it("points Viewers to the filtered invoice list and hides the approval banner", () => {
    const banners = attentionBanners(counts, allModulesEnabled(), false);
    expect(banners).toHaveLength(1);
    expect(banners[0]).toMatchObject({ key: "overdue", href: "/invoices?state=Overdue", text: "4 Rechnungen sind überfällig." });
  });

  it("falls back to the overdue banner when reminders are switched off", () => {
    const banners = attentionBanners(counts, modulesWith({ reminders: false, subscriptions: false }), true);
    expect(banners.map((b) => b.key)).toEqual(["overdue"]);
  });

  it("shows nothing when all counts are 0", () => {
    expect(attentionBanners({ pendingEmails: 0, dueReminders: 0, overdueInvoices: 0 }, allModulesEnabled(), true)).toEqual([]);
  });
});
