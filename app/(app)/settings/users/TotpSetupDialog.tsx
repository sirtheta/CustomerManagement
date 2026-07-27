"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { generateTotpSetup, confirmTotpSetup, disableTotp } from "./actions";

type User = { id: number; name: string; totpEnabled: boolean };

export function TotpSetupDialog({ user }: { user: User }) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<"generate" | "confirm" | "backup">("generate");
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [backupCodes, setBackupCodes] = useState<string[] | null>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleClose() {
    setOpen(false);
    setStep("generate");
    setQrCode(null);
    setSecret(null);
    setBackupCodes(null);
    setConfirmError(null);
  }

  function handleGenerate() {
    setConfirmError(null);
    startTransition(async () => {
      const result = await generateTotpSetup(user.id);
      if ("error" in result) {
        setConfirmError(result.error);
        return;
      }
      setQrCode(result.qrCodeDataUrl);
      setSecret(result.secret);
      setStep("confirm");
    });
  }

  function handleConfirm(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const token = (e.currentTarget.elements.namedItem("token") as HTMLInputElement).value;
    setConfirmError(null);
    startTransition(async () => {
      const result = await confirmTotpSetup(user.id, token);
      if (result.error) {
        setConfirmError(result.error);
      } else if (result.backupCodes) {
        setBackupCodes(result.backupCodes);
        setStep("backup");
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose(); else setOpen(true); }}>
      <DialogTrigger render={<Button size="sm" variant={user.totpEnabled ? "destructive" : "outline"} />}>
        {user.totpEnabled ? "2FA deaktivieren" : "2FA einrichten"}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {user.totpEnabled ? "2FA deaktivieren" : "2FA einrichten"} — {user.name}
          </DialogTitle>
        </DialogHeader>
        {step === "backup" ? (
          <div className="space-y-4">
            <p className="text-sm font-medium">Backup-Codes</p>
            <p className="text-sm text-muted-foreground">
              Diese Codes jetzt sicher aufbewahren — sie werden nur einmal angezeigt. Jeder Code kann einmalig statt des Authenticator-Codes verwendet werden.
            </p>
            <div className="grid grid-cols-2 gap-1.5 rounded-md border bg-muted p-3 font-mono text-sm">
              {backupCodes?.map((code) => <span key={code}>{code}</span>)}
            </div>
            <div className="flex justify-end">
              <Button onClick={handleClose}>Codes gespeichert — schliessen</Button>
            </div>
          </div>
        ) : user.totpEnabled ? (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">TOTP für diesen Benutzer wirklich deaktivieren?</p>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={handleClose}>Abbrechen</Button>
              <Button
                variant="destructive"
                disabled={isPending}
                onClick={() => startTransition(async () => { await disableTotp(user.id); handleClose(); })}
              >
                {isPending ? "Deaktivieren..." : "Deaktivieren"}
              </Button>
            </div>
          </div>
        ) : step === "generate" ? (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">QR-Code generieren und in Authenticator-App scannen.</p>
            {confirmError && <p className="text-sm text-red-600">{confirmError}</p>}
            <Button onClick={handleGenerate} disabled={isPending} className="w-full">
              {isPending ? "Generieren..." : "QR-Code generieren"}
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            {qrCode && (
              <div className="flex flex-col items-center gap-2">
                {/* eslint-disable-next-line @next/next/no-img-element -- inline base64 QR data URL, next/image adds no value */}
                <img src={qrCode} alt="TOTP QR Code" className="size-48" />
                <p className="text-xs text-muted-foreground font-mono break-all text-center">{secret}</p>
              </div>
            )}
            <p className="text-sm text-muted-foreground text-center">
              QR-Code mit Authenticator-App scannen, dann Code bestätigen:
            </p>
            <form onSubmit={handleConfirm} className="space-y-4">
              <Input
                name="token"
                type="text"
                inputMode="numeric"
                pattern="[0-9]{6}"
                maxLength={6}
                autoComplete="off"
                data-1p-ignore
                data-lpignore="true"
                data-bwignore
                placeholder="123456"
                autoFocus
              />
              {confirmError && <p className="text-sm text-red-600">{confirmError}</p>}
              <div className="flex gap-2 justify-end">
                <Button type="button" variant="outline" onClick={() => setStep("generate")}>Zurück</Button>
                <Button type="submit" disabled={isPending}>{isPending ? "Prüfen..." : "Bestätigen"}</Button>
              </div>
            </form>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
