"use client";

import { UserRole } from "@prisma/client";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CreateUserDialog } from "./CreateUserDialog";
import { EditUserDialog } from "./EditUserDialog";
import { ResetPasswordDialog } from "./ResetPasswordDialog";
import { TotpSetupDialog } from "./TotpSetupDialog";
import { DeleteUserDialog } from "./DeleteUserDialog";
import { activeBadge } from "@/lib/document-states";

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

      {/* Phones get cards instead of a table that scrolls sideways */}
      <ul className="space-y-3 md:hidden">
        {users.map((user) => (
          <li key={user.id} className="rounded-lg border p-3 space-y-2">
            <div>
              <p className="font-medium">{user.name}</p>
              <p className="break-all text-sm text-muted-foreground">{user.email}</p>
            </div>
            <div className="flex flex-wrap gap-1.5">
              <RoleBadge role={user.role} />
              <Badge variant={activeBadge(user.isActive).variant}>{activeBadge(user.isActive).label}</Badge>
              <Badge variant={user.totpEnabled ? "secondary" : "outline"}>
                {user.totpEnabled ? "TOTP aktiv" : "Kein TOTP"}
              </Badge>
            </div>
            <div className="flex gap-1.5 flex-wrap">
              <EditUserDialog user={user} />
              {user.id !== currentUserId && <ResetPasswordDialog user={user} />}
              <TotpSetupDialog user={user} />
              <DeleteUserDialog user={user} />
            </div>
          </li>
        ))}
      </ul>

      <div className="hidden rounded-lg border overflow-hidden md:block">
        <Table>
          <TableHeader className="bg-muted/50">
            <TableRow>
              <TableHead className="px-4">Name</TableHead>
              <TableHead className="px-4">E-Mail</TableHead>
              <TableHead className="px-4">Rolle</TableHead>
              <TableHead className="px-4">Status</TableHead>
              <TableHead className="px-4">TOTP</TableHead>
              <TableHead className="px-4" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.map((user) => (
              <TableRow key={user.id}>
                <TableCell className="px-4 py-3 font-medium">{user.name}</TableCell>
                <TableCell className="px-4 py-3 text-muted-foreground">{user.email}</TableCell>
                <TableCell className="px-4 py-3"><RoleBadge role={user.role} /></TableCell>
                <TableCell className="px-4 py-3">
                  <Badge variant={activeBadge(user.isActive).variant}>{activeBadge(user.isActive).label}</Badge>
                </TableCell>
                <TableCell className="px-4 py-3">
                  <Badge variant={user.totpEnabled ? "secondary" : "outline"}>
                    {user.totpEnabled ? "Aktiv" : "Aus"}
                  </Badge>
                </TableCell>
                <TableCell className="px-4 py-3">
                  <div className="flex gap-1.5 flex-wrap justify-end">
                    <EditUserDialog user={user} />
                    {user.id !== currentUserId && <ResetPasswordDialog user={user} />}
                    <TotpSetupDialog user={user} />
                    <DeleteUserDialog user={user} />
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
