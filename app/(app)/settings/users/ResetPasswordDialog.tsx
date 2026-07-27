"use client";

import { useState, useActionState } from "react";
import { Button } from "@/components/ui/button";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { resetPassword } from "./actions";
import { useActionToast } from "@/hooks/use-action-toast";

type User = { id: number; name: string };

export function ResetPasswordDialog({ user }: { user: User }) {
  const [open, setOpen] = useState(false);
  const resetById = resetPassword.bind(null, user.id);
  const [state, formAction, pending] = useActionState(resetById, {});

  useActionToast(state, "Passwort gespeichert");
  // Close the dialog once the reset succeeds, derived from the action
  // result timestamp during render rather than in an effect.
  const [seenResultTs, setSeenResultTs] = useState(state._ts);
  if (state._ts !== seenResultTs) {
    setSeenResultTs(state._ts);
    if (state.success) setOpen(false);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" variant="outline" />}>
        Passwort
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Passwort zurücksetzen — {user.name}</DialogTitle>
        </DialogHeader>
        <form action={formAction} className="space-y-4">
          <div className="space-y-2">
            <Label>Neues Passwort</Label>
            <PasswordInput name="password" required minLength={8} />
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
