"use client";

import { UserRole } from "@prisma/client";
import { Badge } from "@/components/ui/badge";
import { CreateUserDialog } from "./CreateUserDialog";
import { EditUserDialog } from "./EditUserDialog";
import { ResetPasswordDialog } from "./ResetPasswordDialog";
import { TotpSetupDialog } from "./TotpSetupDialog";
import { DeleteUserDialog } from "./DeleteUserDialog";

type User = {
  id: number;
  email: string;
  name: string;
  role: UserRole;
  isActive: boolean;
  totpEnabled: boolean;
};

const ROLE_LABELS: Record<UserRole, string> = {
  Admin: "Admin",
  Editor: "Editor",
  Viewer: "Leser",
};

const ROLE_VARIANTS: Record<UserRole, "default" | "secondary" | "outline"> = {
  Admin: "default",
  Editor: "secondary",
  Viewer: "outline",
};

function RoleBadge({ role }: { role: UserRole }) {
  return <Badge variant={ROLE_VARIANTS[role]}>{ROLE_LABELS[role]}</Badge>;
}

export function UserManagement({ users, currentUserId }: { users: User[]; currentUserId: number | null }) {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Benutzer</h2>
          <p className="text-sm text-muted-foreground">{users.length} Benutzer</p>
        </div>
        <CreateUserDialog />
      </div>

      <div className="rounded-lg border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="text-left px-4 py-3 font-medium">Name</th>
              <th className="text-left px-4 py-3 font-medium">E-Mail</th>
              <th className="text-left px-4 py-3 font-medium">Rolle</th>
              <th className="text-left px-4 py-3 font-medium">Status</th>
              <th className="text-left px-4 py-3 font-medium">TOTP</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.id} className="border-t">
                <td className="px-4 py-3 font-medium">{user.name}</td>
                <td className="px-4 py-3 text-muted-foreground">{user.email}</td>
                <td className="px-4 py-3"><RoleBadge role={user.role} /></td>
                <td className="px-4 py-3">
                  <Badge variant={user.isActive ? "default" : "outline"}>
                    {user.isActive ? "Aktiv" : "Inaktiv"}
                  </Badge>
                </td>
                <td className="px-4 py-3">
                  <Badge variant={user.totpEnabled ? "secondary" : "outline"}>
                    {user.totpEnabled ? "Aktiv" : "—"}
                  </Badge>
                </td>
                <td className="px-4 py-3">
                  <div className="flex gap-1.5 flex-wrap justify-end">
                    <EditUserDialog user={user} />
                    {user.id !== currentUserId && <ResetPasswordDialog user={user} />}
                    <TotpSetupDialog user={user} />
                    <DeleteUserDialog user={user} />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
