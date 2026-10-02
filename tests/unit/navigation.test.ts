import { describe, it, expect } from "vitest";
import { UserRole } from "@prisma/client";
import { allModulesEnabled, type ModuleFlags } from "@/lib/modules";
import { activeNavHref, buildNavigation, isEntryActive, visibleBadgeCount, type NavEntry } from "@/lib/navigation";

function hrefs(entries: NavEntry[]): string[] {
  return entries.flatMap((e) => [e.href, ...(e.children ?? []).map((c) => `${e.href} > ${c.href}`)]);
}

const modulesWith = (off: Partial<ModuleFlags>): ModuleFlags => ({ ...allModulesEnabled(), ...off });

describe("buildNavigation", () => {
  it("groups the invoice work lists and accounting pages for editors", () => {
    const nav = buildNavigation(UserRole.Editor, allModulesEnabled());
    const invoices = nav.find((e) => e.href === "/invoices")!;
    expect(invoices.children!.map((c) => c.href)).toEqual([
      "/invoices",
      "/invoices/pending",
      "/invoices/reminders",
      "/invoices/import",
      "/subscriptions",
    ]);
    const accounting = nav.find((e) => e.href === "/accounting")!;
    expect(accounting.children!.map((c) => c.href)).toEqual(["/accounting", "/accounting/receivables"]);
    expect(nav.some((e) => e.href === "/settings")).toBe(false);
  });

  it("shows settings to admins only", () => {
    expect(buildNavigation(UserRole.Admin, allModulesEnabled()).some((e) => e.href === "/settings")).toBe(true);
  });

  it("gives Viewers only the pages they can use", () => {
    const nav = buildNavigation(UserRole.Viewer, allModulesEnabled());
    const all = hrefs(nav);
    expect(all).toContain("/invoices > /subscriptions");
    for (const hidden of ["/invoices/pending", "/invoices/reminders", "/invoices/import", "/accounting"]) {
      expect(all.some((h) => h.endsWith(hidden))).toBe(false);
    }
  });

  it("drops entries of switched-off modules", () => {
    const nav = buildNavigation(
      UserRole.Admin,
      modulesWith({ reminders: false, bankImport: false, subscriptions: false, accounting: false, quotes: false })
    );
    const all = hrefs(nav);
    for (const hidden of ["/invoices/reminders", "/invoices/import", "/invoices/pending", "/subscriptions", "/accounting", "/quotes"]) {
      expect(all.some((h) => h.endsWith(hidden))).toBe(false);
    }
  });

  it("collapses a group with a single remaining child into a plain link", () => {
    const nav = buildNavigation(UserRole.Viewer, modulesWith({ subscriptions: false }));
    const invoices = nav.find((e) => e.href === "/invoices")!;
    expect(invoices.children).toBeUndefined();
    expect(invoices.label).toBe("Rechnungen");
  });
});

describe("activeNavHref / isEntryActive", () => {
  const nav = buildNavigation(UserRole.Admin, allModulesEnabled());
  const invoices = nav.find((e) => e.href === "/invoices")!;

  it("picks the most specific link", () => {
    expect(activeNavHref("/invoices/reminders", nav)).toBe("/invoices/reminders");
    expect(activeNavHref("/invoices/42/edit", nav)).toBe("/invoices");
    expect(activeNavHref("/accounting/receivables", nav)).toBe("/accounting/receivables");
    expect(activeNavHref("/accounting/new", nav)).toBe("/accounting");
    expect(activeNavHref("/", nav)).toBe("/dashboard");
    expect(activeNavHref("/profile", nav)).toBeNull();
  });

  it("does not match on a mere prefix of the segment", () => {
    expect(activeNavHref("/invoicesx", nav)).toBeNull();
  });

  it("marks the group when one of its children is active", () => {
    expect(isEntryActive(invoices, activeNavHref("/subscriptions", nav))).toBe(true);
    expect(isEntryActive(invoices, activeNavHref("/customers", nav))).toBe(false);
  });
});

describe("visibleBadgeCount", () => {
  const counts = { pendingEmails: 2, dueReminders: 3 };

  it("sums the badges of the visible children", () => {
    const invoices = buildNavigation(UserRole.Editor, allModulesEnabled()).find((e) => e.href === "/invoices")!;
    expect(visibleBadgeCount(invoices, counts)).toBe(5);
  });

  it("shows no badge to Viewers, whose work-list links are hidden", () => {
    const invoices = buildNavigation(UserRole.Viewer, allModulesEnabled()).find((e) => e.href === "/invoices")!;
    expect(visibleBadgeCount(invoices, counts)).toBe(0);
  });
});
