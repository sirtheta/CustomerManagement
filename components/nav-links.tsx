"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { ChevronDownIcon, MenuIcon, XIcon } from "lucide-react";
import { UserRole } from "@prisma/client";
import { GlobalSearch } from "@/components/global-search";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { ModuleFlags } from "@/lib/modules";
import {
  activeNavHref,
  buildNavigation,
  isEntryActive,
  visibleBadgeCount,
  type NavBadgeCounts,
  type NavEntry,
  type NavLinkItem,
} from "@/lib/navigation";

function CountBadge({ count, floating = false }: { count: number; floating?: boolean }) {
  if (count <= 0) return null;
  return (
    <span
      className={cn(
        "flex items-center justify-center rounded-full bg-destructive text-[10px] font-bold text-destructive-foreground leading-none",
        floating ? "absolute -top-0.5 -right-0.5 size-4" : "ml-2 inline-flex px-1.5 py-0.5"
      )}
    >
      {count > 9 ? "9+" : count}
    </span>
  );
}

const itemClass = (active: boolean) =>
  cn(
    "font-medium transition-colors",
    active ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground hover:bg-accent"
  );

function badgeOf(link: NavLinkItem, counts: NavBadgeCounts): number {
  return link.badge ? counts[link.badge] : 0;
}

/** Desktop group: the label links to the group's main page, the chevron opens the sub-pages. */
function DesktopGroup({
  entry,
  activeHref,
  counts,
}: {
  entry: NavEntry;
  activeHref: string | null;
  counts: NavBadgeCounts;
}) {
  const [open, setOpen] = useState(false);
  const active = isEntryActive(entry, activeHref);
  return (
    <div className={cn("relative flex items-center rounded-md", itemClass(active))}>
      <Link
        href={entry.href}
        aria-current={activeHref === entry.href ? "page" : undefined}
        className="text-sm pl-3 pr-1 py-1.5 whitespace-nowrap"
      >
        {entry.label}
      </Link>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          aria-label={`${entry.label}: weitere Seiten`}
          className="flex items-center self-stretch pr-2 pl-0.5 rounded-r-md"
        >
          <ChevronDownIcon className={cn("size-3.5 transition-transform", open && "rotate-180")} />
        </PopoverTrigger>
        <PopoverContent align="start" className="w-56 gap-0 p-1">
          <nav aria-label={entry.label} className="flex flex-col gap-0.5">
            {entry.children!.map((child) => (
              <Link
                key={child.href}
                href={child.href}
                onClick={() => setOpen(false)}
                aria-current={activeHref === child.href ? "page" : undefined}
                className={cn(
                  "flex items-center justify-between rounded-md px-2 py-1.5 text-sm",
                  itemClass(activeHref === child.href)
                )}
              >
                {child.label}
                <CountBadge count={badgeOf(child, counts)} />
              </Link>
            ))}
          </nav>
        </PopoverContent>
      </Popover>
      <CountBadge count={visibleBadgeCount(entry, counts)} floating />
    </div>
  );
}

export function NavLinks({
  role,
  modules,
  counts,
}: {
  role: UserRole;
  modules: ModuleFlags;
  counts: NavBadgeCounts;
}) {
  const entries = buildNavigation(role, modules);
  const pathname = usePathname();
  const activeHref = activeNavHref(pathname, entries);
  const [menuOpen, setMenuOpen] = useState(false);

  // Close the mobile menu when the route changes, derived during render
  // instead of in an effect.
  const [lastPathname, setLastPathname] = useState(pathname);
  if (pathname !== lastPathname) {
    setLastPathname(pathname);
    setMenuOpen(false);
  }

  return (
    <>
      {/* Desktop nav */}
      <nav className="hidden md:flex items-center gap-0.5">
        {entries.map((entry) =>
          entry.children ? (
            <DesktopGroup key={entry.href} entry={entry} activeHref={activeHref} counts={counts} />
          ) : (
            <Link
              key={entry.href}
              href={entry.href}
              aria-current={activeHref === entry.href ? "page" : undefined}
              className={cn("relative text-sm px-3 py-1.5 rounded-md whitespace-nowrap", itemClass(activeHref === entry.href))}
            >
              {entry.label}
              <CountBadge count={badgeOf(entry, counts)} floating />
            </Link>
          )
        )}
      </nav>

      {/* Mobile hamburger */}
      <div className="md:hidden">
        <button
          type="button"
          onClick={() => setMenuOpen((o) => !o)}
          className="flex items-center justify-center p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          aria-label="Navigation öffnen"
          aria-expanded={menuOpen}
        >
          {menuOpen ? (
            <XIcon className="size-5" />
          ) : (
            <MenuIcon className="size-5" />
          )}
        </button>

        {menuOpen && (
          <div className="fixed inset-x-0 top-14 border-b bg-card shadow-md z-50 max-h-[calc(100dvh-3.5rem)] overflow-y-auto">
            <div className="max-w-7xl mx-auto px-4 pt-3 pb-1">
              <GlobalSearch size="sm" className="flex items-center w-full" />
            </div>
            <nav className="max-w-7xl mx-auto px-4 py-2 flex flex-col gap-0.5">
              {entries.map((entry) =>
                entry.children ? (
                  <div key={entry.href} className="flex flex-col gap-0.5 pt-2">
                    <span className="px-3 pb-0.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground/80">
                      {entry.label}
                    </span>
                    {entry.children.map((child) => (
                      <Link
                        key={child.href}
                        href={child.href}
                        aria-current={activeHref === child.href ? "page" : undefined}
                        className={cn("text-sm pl-6 pr-3 py-2.5 rounded-md", itemClass(activeHref === child.href))}
                      >
                        {child.label}
                        <CountBadge count={badgeOf(child, counts)} />
                      </Link>
                    ))}
                  </div>
                ) : (
                  <Link
                    key={entry.href}
                    href={entry.href}
                    aria-current={activeHref === entry.href ? "page" : undefined}
                    className={cn("text-sm px-3 py-2.5 rounded-md", itemClass(activeHref === entry.href))}
                  >
                    {entry.label}
                    <CountBadge count={badgeOf(entry, counts)} />
                  </Link>
                )
              )}
            </nav>
          </div>
        )}
      </div>
    </>
  );
}
