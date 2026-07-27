import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { signOut } from "@/lib/auth";
import { NavLinks } from "@/components/nav-links";
import { ThemeToggle } from "@/components/theme-toggle";
import { UserMenu } from "@/components/user-menu";
import Link from "next/link";
import pkg from "../../package.json";
import prisma from "@/lib/prisma";
import { GlobalSearch } from "@/components/global-search";
import { UpdateNotification } from "@/components/update-notification";
import { hasRole } from "@/lib/permissions";
import { UserRole } from "@prisma/client";
import { Suspense } from "react";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session) redirect("/login");

  const now = new Date();
  const [pendingCount, reminderCount] = await Promise.all([
    prisma.pendingEmail.count(),
    prisma.pendingReminder.count({
      where: {
        OR: [{ snoozedUntil: null }, { snoozedUntil: { lte: now } }],
      },
    }),
  ]);

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <header className="border-b bg-card sticky top-0 z-10 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex h-14 items-center justify-between gap-4">
          <div className="flex items-center gap-1 min-w-0 flex-1 overflow-hidden">
            <Link
              href="/dashboard"
              className="font-bold text-sm text-primary mr-3 shrink-0 hidden md:block tracking-tight"
            >
              CustomerManagement
            </Link>
            <NavLinks role={session.user.role} pendingCount={pendingCount} reminderCount={reminderCount} />
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <ThemeToggle />
            <UserMenu
              name={session.user.name ?? ""}
              signOutAction={async () => {
                "use server";
                await signOut({ redirectTo: "/login" });
              }}
            />
          </div>
        </div>
        <div className="hidden md:block border-t">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-1.5">
            <Suspense fallback={null}>
              <GlobalSearch size="sm" className="flex items-center w-72" />
            </Suspense>
          </div>
        </div>
      </header>
      {hasRole(session, [UserRole.Admin]) && <UpdateNotification />}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {children}
      </main>
      <footer className="border-t py-3">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center text-xs text-muted-foreground">
          v{pkg.version}
        </div>
      </footer>
    </div>
  );
}
