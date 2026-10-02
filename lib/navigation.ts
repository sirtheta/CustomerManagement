import { UserRole } from "@prisma/client";
import type { ModuleFlags, ModuleKey } from "@/lib/modules";

/** Which counter a navigation link carries (see `NavBadgeCounts`). */
export type NavBadge = "pendingEmails" | "dueReminders";

export type NavBadgeCounts = Record<NavBadge, number>;

export type NavLinkItem = {
  href: string;
  label: string;
  badge?: NavBadge;
};

/** A top-level entry; with `children` it is a group whose own link is the first child. */
export type NavEntry = NavLinkItem & { children?: NavLinkItem[] };

type Access = "all" | "editor" | "admin";

type NavDefinition = NavLinkItem & {
  access: Access;
  module?: ModuleKey;
  children?: NavDefinition[];
};

/**
 * The menu. Access mirrors the page guards: an entry is only shown to roles
 * that can actually use the page (pages that render `<EditorOnlyNotice />`
 * for Viewers count as editor-only here).
 */
const NAV_DEFINITION: NavDefinition[] = [
  { href: "/dashboard", label: "Dashboard", access: "all" },
  { href: "/customers", label: "Kunden", access: "all" },
  {
    href: "/invoices",
    label: "Rechnungen",
    access: "all",
    children: [
      { href: "/invoices", label: "Alle Rechnungen", access: "all" },
      { href: "/invoices/pending", label: "Ausstehende E-Mails", access: "editor", module: "subscriptions", badge: "pendingEmails" },
      { href: "/invoices/reminders", label: "Mahnungen", access: "editor", module: "reminders", badge: "dueReminders" },
      { href: "/invoices/import", label: "Bankimport", access: "editor", module: "bankImport" },
      { href: "/subscriptions", label: "Abos", access: "all", module: "subscriptions" },
    ],
  },
  { href: "/quotes", label: "Offerten", access: "all", module: "quotes" },
  { href: "/analytics", label: "Auswertung", access: "all", module: "analytics" },
  {
    href: "/accounting",
    label: "Buchhaltung",
    access: "editor",
    module: "accounting",
    children: [
      { href: "/accounting", label: "Ausgaben & GuV", access: "editor" },
      { href: "/accounting/receivables", label: "Offene Posten", access: "editor" },
    ],
  },
  { href: "/services", label: "Leistungen", access: "all" },
  { href: "/settings", label: "Einstellungen", access: "admin" },
];

function allowed(access: Access, role: UserRole): boolean {
  if (access === "admin") return role === UserRole.Admin;
  if (access === "editor") return role !== UserRole.Viewer;
  return true;
}

function visible(def: NavDefinition, role: UserRole, modules: ModuleFlags): boolean {
  return allowed(def.access, role) && (!def.module || modules[def.module]);
}

function toLink({ href, label, badge }: NavDefinition): NavLinkItem {
  return badge ? { href, label, badge } : { href, label };
}

/**
 * The entries a role sees with the given modules. A group left with a single
 * child collapses into a plain link (a Viewer without Abos just sees
 * «Rechnungen»).
 */
export function buildNavigation(role: UserRole, modules: ModuleFlags): NavEntry[] {
  const entries: NavEntry[] = [];
  for (const def of NAV_DEFINITION) {
    if (!visible(def, role, modules)) continue;
    const children = (def.children ?? []).filter((c) => visible(c, role, modules)).map(toLink);
    entries.push(children.length > 1 ? { ...toLink(def), children } : toLink(def));
  }
  return entries;
}

/** Badge counts the role may see; counts of hidden links are 0. */
export function visibleBadgeCount(entry: NavEntry, counts: NavBadgeCounts): number {
  const links = entry.children ?? [entry];
  return links.reduce((sum, l) => sum + (l.badge ? counts[l.badge] : 0), 0);
}

function allHrefs(entries: NavEntry[]): string[] {
  return entries.flatMap((e) => [e.href, ...(e.children ?? []).map((c) => c.href)]);
}

function matches(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(href + "/");
}

/**
 * The single link that is active for `pathname`: the longest matching href,
 * so `/invoices/reminders` marks «Mahnungen», not «Alle Rechnungen», while
 * `/invoices/42` still marks «Alle Rechnungen». `/` counts as the dashboard.
 */
export function activeNavHref(pathname: string, entries: NavEntry[]): string | null {
  const path = pathname === "/" ? "/dashboard" : pathname;
  let best: string | null = null;
  for (const href of allHrefs(entries)) {
    if (matches(path, href) && (!best || href.length > best.length)) best = href;
  }
  return best;
}

/** True when the entry itself or one of its children is the active link. */
export function isEntryActive(entry: NavEntry, activeHref: string | null): boolean {
  if (!activeHref) return false;
  return entry.href === activeHref || (entry.children ?? []).some((c) => c.href === activeHref);
}
