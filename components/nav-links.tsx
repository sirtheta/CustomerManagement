"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { MenuIcon, XIcon } from "lucide-react";
import { UserRole } from "@prisma/client";
import { GlobalSearch } from "@/components/global-search";

const navItems = [
  { href: "/dashboard",   label: "Dashboard",     adminOnly: false, editorOnly: false },
  { href: "/customers",   label: "Kunden",        adminOnly: false, editorOnly: false },
  { href: "/invoices",    label: "Rechnungen",    adminOnly: false, editorOnly: false },
  { href: "/quotes",      label: "Offerten",      adminOnly: false, editorOnly: false },
  { href: "/analytics",   label: "Auswertung",    adminOnly: false, editorOnly: false },
  { href: "/accounting",  label: "Buchhaltung",   adminOnly: false, editorOnly: true  },
  { href: "/services",    label: "Leistungen",    adminOnly: false, editorOnly: false },
  { href: "/settings",    label: "Einstellungen", adminOnly: true,  editorOnly: false },
];

export function NavLinks({ role, pendingCount = 0, reminderCount = 0 }: { role: UserRole; pendingCount?: number; reminderCount?: number }) {
  const visibleItems = navItems.filter(
    (item) =>
      (!item.adminOnly || role === UserRole.Admin) &&
      (!item.editorOnly || role !== UserRole.Viewer)
  );
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);

  // Close the mobile menu when the route changes, derived during render
  // instead of in an effect.
  const [lastPathname, setLastPathname] = useState(pathname);
  if (pathname !== lastPathname) {
    setLastPathname(pathname);
    setMenuOpen(false);
  }

  function isActive(href: string) {
    return href === "/dashboard"
      ? pathname === "/dashboard" || pathname === "/"
      : pathname.startsWith(href);
  }

  return (
    <>
      {/* Desktop nav */}
      <nav className="hidden md:flex items-center gap-0.5">
        {visibleItems.map(({ href, label }) => (
          <Link
            key={href}
            href={href}
            className={cn(
              "relative text-sm px-3 py-1.5 rounded-md whitespace-nowrap transition-colors font-medium",
              isActive(href)
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:text-foreground hover:bg-accent"
            )}
          >
            {label}
            {href === "/invoices" && (pendingCount + reminderCount) > 0 && (
              <span className="absolute -top-0.5 -right-0.5 flex size-4 items-center justify-center rounded-full bg-destructive text-[10px] font-bold text-destructive-foreground leading-none">
                {(pendingCount + reminderCount) > 9 ? "9+" : (pendingCount + reminderCount)}
              </span>
            )}
          </Link>
        ))}
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
          <div className="fixed inset-x-0 top-14 border-b bg-card shadow-md z-50">
            <div className="max-w-7xl mx-auto px-4 pt-3 pb-1">
              <GlobalSearch size="sm" className="flex items-center w-full" />
            </div>
            <nav className="max-w-7xl mx-auto px-4 py-2 flex flex-col gap-0.5">
              {visibleItems.map(({ href, label }) => (
                <Link
                  key={href}
                  href={href}
                  className={cn(
                    "relative text-sm px-3 py-2.5 rounded-md font-medium transition-colors",
                    isActive(href)
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground hover:text-foreground hover:bg-accent"
                  )}
                >
                  {label}
                  {href === "/invoices" && (pendingCount + reminderCount) > 0 && (
                    <span className="ml-2 inline-flex items-center justify-center rounded-full bg-destructive px-1.5 py-0.5 text-[10px] font-bold text-destructive-foreground leading-none">
                      {(pendingCount + reminderCount) > 9 ? "9+" : (pendingCount + reminderCount)}
                    </span>
                  )}
                </Link>
              ))}
            </nav>
          </div>
        )}
      </div>
    </>
  );
}
