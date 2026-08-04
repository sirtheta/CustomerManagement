"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { login } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function LoginPage() {
  const [state, formAction, pending] = useActionState(login, undefined);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  // "Went back" overrides a totp-required result from a previous submission;
  // reset on the next submit so a re-attempt can show the code step again.
  const [wentBack, setWentBack] = useState(false);
  const totpStep = !wentBack && !!state?.totpRequired;

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-2xl text-center">Anmelden</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            action={formAction}
            onSubmit={() => setWentBack(false)}
            className="space-y-4"
          >
            {totpStep ? (
              <p className="text-sm text-muted-foreground text-center">
                Authenticator-Code für <strong>{email}</strong>
              </p>
            ) : (
              <>
                <div className="space-y-2" suppressHydrationWarning>
                  <Label htmlFor="email">E-Mail</Label>
                  <Input
                    id="email"
                    name="email"
                    type="email"
                    required
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    suppressHydrationWarning
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="password">Passwort</Label>
                  <PasswordInput
                    id="password"
                    name="password"
                    required
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </div>
                <Link
                  href="/forgot-password"
                  className="block text-right text-sm text-muted-foreground hover:underline"
                >
                  Passwort vergessen?
                </Link>
              </>
            )}
            {totpStep && (
              <>
                {/* Kept in the DOM (hidden) so the resubmit still carries them */}
                <input type="hidden" name="email" value={email} readOnly />
                <input type="hidden" name="password" value={password} readOnly />
                <div className="space-y-2">
                  <Label htmlFor="totpCode">Authenticator- oder Backup-Code</Label>
                  <Input
                    id="totpCode"
                    name="totpCode"
                    type="text"
                    inputMode="text"
                    maxLength={9}
                    required
                    autoComplete="off"
                    data-1p-ignore
                    data-lpignore="true"
                    data-bwignore
                    placeholder="123456"
                    autoFocus
                  />
                </div>
              </>
            )}
            {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
            <Button type="submit" className="w-full" disabled={pending}>
              {pending ? (totpStep ? "Anmelden..." : "Prüfen...") : totpStep ? "Anmelden" : "Weiter"}
            </Button>
            {totpStep && (
              <Button
                type="button"
                variant="ghost"
                className="w-full"
                onClick={() => setWentBack(true)}
                disabled={pending}
              >
                Zurück
              </Button>
            )}
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
