import { auth } from "@/lib/auth";
import { requireAdmin } from "@/lib/permissions";
import prisma from "@/lib/prisma";
import { UserManagement } from "./UserManagement";
import { SettingsBackLink } from "@/components/settings-back-link";

export default async function UsersPage() {
  await requireAdmin();
  const session = await auth();
  const currentUserId = session?.user?.id ? Number(session.user.id) : null;

  const users = await prisma.user.findMany({
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      isActive: true,
      totpEnabled: true,
    },
    orderBy: { createdAt: "asc" },
  });

  return (
    <div className="space-y-6">
      <SettingsBackLink />
      <div>
        <h1 className="text-2xl font-semibold">Benutzerverwaltung</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Benutzer anlegen, Rollen verwalten und TOTP konfigurieren.
        </p>
      </div>
      <UserManagement users={users} currentUserId={currentUserId} />
    </div>
  );
}
