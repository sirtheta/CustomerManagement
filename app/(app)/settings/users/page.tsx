import { auth } from "@/lib/auth";
import { requireAdmin } from "@/lib/permissions";
import prisma from "@/lib/prisma";
import { UserManagement } from "./UserManagement";

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
      <div>
        <h1 className="text-2xl font-bold">Benutzerverwaltung</h1>
        <p className="text-muted-foreground mt-1">
          Benutzer anlegen, Rollen verwalten und TOTP konfigurieren.
        </p>
      </div>
      <UserManagement users={users} currentUserId={currentUserId} />
    </div>
  );
}
