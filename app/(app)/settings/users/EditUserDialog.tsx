"use client";

import { useState, useActionState } from "react";
import { UserRole } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { updateUser } from "./actions";

type User = {
  id: number;
  name: string;
  email: string;
  role: UserRole;
  isActive: boolean;
};

const ROLE_LABELS: Record<UserRole, string> = {
  Admin: "Admin",
  Editor: "Editor",
  Viewer: "Leser",
};

export function EditUserDialog({ user }: { user: User }) {
  const [open, setOpen] = useState(false);
  const [role, setRole] = useState<UserRole>(user.role);
  const [isActive, setIsActive] = useState(user.isActive);
  const updateUserById = updateUser.bind(null, user.id);
  const [state, formAction, pending] = useActionState(updateUserById, {});

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" variant="outline" />}>
        Bearbeiten
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{user.name} bearbeiten</DialogTitle>
        </DialogHeader>
        <form action={formAction} className="space-y-4">
          <input type="hidden" name="role" value={role} />
          <input type="hidden" name="isActive" value={String(isActive)} />
          <div className="space-y-2">
            <Label>Name</Label>
            <Input name="name" defaultValue={user.name} required />
          </div>
          <div className="space-y-2">
            <Label>E-Mail</Label>
            <Input value={user.email} disabled className="opacity-60" />
          </div>
          <div className="space-y-2">
            <Label>Rolle</Label>
            <Select value={role} onValueChange={(v) => setRole(v as UserRole)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.values(UserRole).map((r) => (
                  <SelectItem key={r} value={r}>{ROLE_LABELS[r]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id={`active-${user.id}`}
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
              className="size-4"
            />
            <Label htmlFor={`active-${user.id}`}>Aktiv</Label>
          </div>
          {state.error && <p className="text-sm text-red-600">{state.error}</p>}
          <div className="flex gap-2 justify-end">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Abbrechen</Button>
            <Button type="submit" disabled={pending}>{pending ? "Speichern..." : "Speichern"}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
