"use client";

import { useState, useActionState } from "react";
import { UserRole } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { createUser } from "./actions";

const ROLE_LABELS: Record<UserRole, string> = {
  Admin: "Admin",
  Editor: "Editor",
  Viewer: "Leser",
};

export function CreateUserDialog() {
  const [open, setOpen] = useState(false);
  const [role, setRole] = useState<UserRole>(UserRole.Viewer);
  const [state, formAction, pending] = useActionState(createUser, {});

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" />}>
        Benutzer erstellen
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Neuer Benutzer</DialogTitle>
        </DialogHeader>
        <form action={formAction} className="space-y-4">
          <input type="hidden" name="role" value={role} />
          <div className="space-y-2">
            <Label>Name</Label>
            <Input name="name" required />
          </div>
          <div className="space-y-2">
            <Label>E-Mail</Label>
            <Input name="email" type="email" required />
          </div>
          <div className="space-y-2">
            <Label>Passwort (optional)</Label>
            <PasswordInput name="password" minLength={8} />
            <p className="text-sm text-muted-foreground">
              Leer lassen, damit der Benutzer eine E-Mail mit einem Link erhält, um selbst ein
              Passwort zu setzen.
            </p>
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
          {state.error && <p className="text-sm text-red-600">{state.error}</p>}
          <div className="flex gap-2 justify-end">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Abbrechen</Button>
            <Button type="submit" disabled={pending}>{pending ? "Erstellen..." : "Erstellen"}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
