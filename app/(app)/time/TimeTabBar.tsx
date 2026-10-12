"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ClockIcon, ListChecksIcon } from "lucide-react";
import { cn } from "@/lib/utils";

const TABS = [
  { href: "/time", label: "Erfassen", Icon: ClockIcon, match: (p: string) => p === "/time" },
  { href: "/time/open", label: "Offen", Icon: ListChecksIcon, match: (p: string) => p.startsWith("/time/open") },
];

/** Bottom tab bar of the time pages on phones; on larger screens the header navigation is used. */
export function TimeTabBar() {
  const pathname = usePathname();
  return (
    <nav aria-label="Zeiterfassung" className="fixed inset-x-0 bottom-0 z-20 border-t bg-card pb-[env(safe-area-inset-bottom)] lg:hidden">
      <div className="mx-auto flex max-w-xl">
        {TABS.map(({ href, label, Icon, match }) => {
          const active = match(pathname);
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-xs font-medium",
                active ? "text-primary" : "text-muted-foreground",
              )}
            >
              <Icon className="size-6" aria-hidden="true" />
              {label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
