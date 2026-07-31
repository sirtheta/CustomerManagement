"use client";

import Link from "next/link";
import { useActionState } from "react";
import { requestPasswordResetAction } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function ForgotPasswordPage() {
  const [state, formAction, pending] = useActionState(requestPasswordResetAction, undefined);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-2xl text-center">Passwort vergessen</CardTitle>
        </CardHeader>
        <CardContent>
          {state?.success ? (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Falls ein Konto mit dieser Adresse existiert, wurde eine E-Mail mit dem
                Zurücksetzungslink verschickt. Bitte prüfe auch den Spam-Ordner.
              </p>
              <Button
                variant="outline"
                className="w-full"
                render={<Link href="/login" />}
              >
                Zurück zur Anmeldung
              </Button>
            </div>
          ) : (
            <form action={formAction} className="space-y-4">
              <div className="space-y-2" suppressHydrationWarning>
                <Label htmlFor="email">E-Mail</Label>
                <Input id="email" name="email" type="email" autoComplete="email" required />
              </div>
              {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
              <Button type="submit" className="w-full" disabled={pending}>
                {pending ? "Wird gesendet..." : "Link anfordern"}
              </Button>
              <Link
                href="/login"
                className="block text-center text-sm text-muted-foreground hover:underline"
              >
                Zurück zur Anmeldung
              </Link>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
