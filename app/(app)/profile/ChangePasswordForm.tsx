"use client";

import { useActionState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { changeOwnPassword } from "./actions";
import { useActionToast } from "@/hooks/use-action-toast";

export function ChangePasswordForm() {
  const [state, formAction, pending] = useActionState(changeOwnPassword, {});
  const formRef = useRef<HTMLFormElement>(null);

  useActionToast(state, "Passwort geändert");
  useEffect(() => {
    if (state.success) formRef.current?.reset();
  }, [state]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Passwort ändern</CardTitle>
        <CardDescription>
          Mindestens 8 Zeichen. Nach der Änderung gilt das neue Passwort ab der nächsten Anmeldung.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form ref={formRef} action={formAction} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="currentPassword">Aktuelles Passwort</Label>
            <PasswordInput id="currentPassword" name="currentPassword" required autoComplete="current-password" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="newPassword">Neues Passwort</Label>
            <PasswordInput id="newPassword" name="newPassword" required minLength={8} autoComplete="new-password" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="confirmPassword">Neues Passwort wiederholen</Label>
            <PasswordInput id="confirmPassword" name="confirmPassword" required minLength={8} autoComplete="new-password" />
          </div>
          {state.error && <p className="text-sm text-red-600">{state.error}</p>}
          <div className="flex justify-end">
            <Button type="submit" disabled={pending}>
              {pending ? "Speichern..." : "Passwort ändern"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
