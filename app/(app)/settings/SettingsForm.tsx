"use client";

import { useActionState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { saveSettings, testSmtpConnection, testEmailNotification, testTelegramNotification } from "./actions";
import { useActionToast, type ActionState } from "@/hooks/use-action-toast";
import { PasswordInput } from "@/components/ui/password-input";

type Props = {
  companyName: string;
  companyHolderName: string;
  companyAddress: string;
  companyZip: string;
  companyCity: string;
  companyEmail: string;
  companyPhone: string;
  companyIBAN: string;
  numberFormat: string;
  defaultPaymentTermDays: number;
  defaultQuoteValidityDays: number;
  reminderCooldownDays: number;
  invoiceNumberPrefix: string;
  quoteNumberPrefix: string;
  useHolderNameOnQR: boolean;
  smtpHost: string;
  smtpPort: number;
  smtpUser: string;
  smtpPasswordSet: boolean;
  smtpFromName: string;
  smtpFromAddress: string;
  emailSubjectTemplate: string;
  emailBodyTemplate: string;
  notifyOverdueEnabled: boolean;
  notifyPendingEnabled: boolean;
  notifyEmailAddress: string;
  notifyTelegramBotTokenSet: boolean;
  notifyTelegramChatId: string;
  notifyRepeatIntervalDays: number | null;
};

export default function SettingsForm(props: Props) {
  const [state, formAction, isPending] = useActionState<ActionState, FormData>(
    saveSettings,
    {}
  );
  const [testState, testFormAction, testPending] = useActionState<ActionState, FormData>(
    testSmtpConnection,
    {}
  );
  const [testEmailNotifState, testEmailNotifAction, testEmailNotifPending] =
    useActionState<ActionState, FormData>(testEmailNotification, {});
  const [testTelegramState, testTelegramAction, testTelegramPending] =
    useActionState<ActionState, FormData>(testTelegramNotification, {});
  useActionToast(state, "Einstellungen gespeichert");
  useActionToast(testState, "SMTP-Verbindung erfolgreich");
  useActionToast(testEmailNotifState, "Test-E-Mail erfolgreich gesendet");
  useActionToast(testTelegramState, "Telegram-Test erfolgreich gesendet");

  return (
    <form key={state?._ts ?? 0} action={formAction} className="space-y-6">
      {/* Firmendaten */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Firmendaten</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label htmlFor="companyName">Firmenname</Label>
              <Input id="companyName" name="companyName" defaultValue={props.companyName} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="companyHolderName">Inhaber / Name</Label>
              <Input id="companyHolderName" name="companyHolderName" defaultValue={props.companyHolderName} />
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="companyAddress">Adresse</Label>
            <Input id="companyAddress" name="companyAddress" defaultValue={props.companyAddress} />
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-1">
              <Label htmlFor="companyZip">PLZ</Label>
              <Input id="companyZip" name="companyZip" defaultValue={props.companyZip} />
            </div>
            <div className="col-span-2 space-y-1">
              <Label htmlFor="companyCity">Ort</Label>
              <Input id="companyCity" name="companyCity" defaultValue={props.companyCity} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label htmlFor="companyEmail">E-Mail</Label>
              <Input id="companyEmail" name="companyEmail" type="email" defaultValue={props.companyEmail} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="companyPhone">Telefon</Label>
              <Input id="companyPhone" name="companyPhone" defaultValue={props.companyPhone} />
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="companyIBAN">IBAN (für Swiss QR-Bill)</Label>
            <Input
              id="companyIBAN"
              name="companyIBAN"
              defaultValue={props.companyIBAN}
              placeholder="CH00 0000 0000 0000 0000 0"
              className="font-mono"
            />
          </div>
        </CardContent>
      </Card>

      {/* App settings */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Anwendungseinstellungen</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label htmlFor="invoiceNumberPrefix">Rechnungspräfix</Label>
              <Input id="invoiceNumberPrefix" name="invoiceNumberPrefix" defaultValue={props.invoiceNumberPrefix} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="quoteNumberPrefix">Offertenpräfix</Label>
              <Input id="quoteNumberPrefix" name="quoteNumberPrefix" defaultValue={props.quoteNumberPrefix} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label htmlFor="defaultPaymentTermDays">Zahlungsfrist (Tage)</Label>
              <Input
                id="defaultPaymentTermDays"
                name="defaultPaymentTermDays"
                type="number"
                min="1"
                defaultValue={props.defaultPaymentTermDays}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="defaultQuoteValidityDays">Offerten-Gültigkeit (Tage)</Label>
              <Input
                id="defaultQuoteValidityDays"
                name="defaultQuoteValidityDays"
                type="number"
                min="1"
                defaultValue={props.defaultQuoteValidityDays}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label htmlFor="reminderCooldownDays">Mahnungs-Cooldown (Tage)</Label>
              <Input
                id="reminderCooldownDays"
                name="reminderCooldownDays"
                type="number"
                min="1"
                defaultValue={props.reminderCooldownDays}
              />
              <p className="text-xs text-muted-foreground">
                Wartezeit nach einer Mahnung, bevor dieselbe Rechnung wieder erscheint
              </p>
            </div>
          </div>

          <div className="flex items-start gap-3 pt-2 border-t">
            <input
              type="checkbox"
              id="useHolderNameOnQR"
              name="useHolderNameOnQR"
              defaultChecked={props.useHolderNameOnQR}
              className="mt-0.5 h-4 w-4 accent-primary"
            />
            <div>
              <Label htmlFor="useHolderNameOnQR" className="cursor-pointer font-medium">
                Inhabername auf QR-Rechnung verwenden
              </Label>
              <p className="text-xs text-muted-foreground mt-0.5">
                Aktivieren um «{props.companyHolderName || "Inhabername"}» statt
                «{props.companyName || "Firmenname"}» als Gläubiger zu drucken.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* SMTP */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">E-Mail Versand (SMTP)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-3 gap-4">
            <div className="col-span-2 space-y-1">
              <Label htmlFor="smtpHost">SMTP-Server</Label>
              <Input id="smtpHost" name="smtpHost" placeholder="smtp.gmail.com" defaultValue={props.smtpHost} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="smtpPort">Port</Label>
              <Input id="smtpPort" name="smtpPort" type="number" placeholder="587" defaultValue={props.smtpPort || ""} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label htmlFor="smtpUser">Benutzername</Label>
              <Input id="smtpUser" name="smtpUser" autoComplete="off" defaultValue={props.smtpUser} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="smtpPassword">Passwort</Label>
              <PasswordInput
                id="smtpPassword"
                name="smtpPassword"
                autoComplete="new-password"
                placeholder={props.smtpPasswordSet ? "••••••••  (gespeichert)" : ""}
              />
              {props.smtpPasswordSet && (
                <p className="text-xs text-muted-foreground">
                  Leer lassen, um das gespeicherte Passwort zu behalten
                </p>
              )}
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="smtpFromName">Absendername</Label>
            <Input id="smtpFromName" name="smtpFromName" placeholder={props.companyName || "Muster AG"} defaultValue={props.smtpFromName} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="smtpFromAddress">
              Absender-E-Mail <span className="text-muted-foreground">(leer lassen = gleich wie Benutzername)</span>
            </Label>
            <Input
              id="smtpFromAddress"
              name="smtpFromAddress"
              type="email"
              placeholder={props.smtpUser || "sanitaet@firma.ch"}
              defaultValue={props.smtpFromAddress}
            />
            <p className="text-xs text-muted-foreground">
              Wird als Absenderadresse verwendet, falls sie sich vom SMTP-Benutzernamen oben unterscheidet.
              Funktioniert nur, wenn der Mailserver das für die angegebene Domain zulässt.
            </p>
          </div>
          <div className="space-y-1">
            <Label htmlFor="emailSubjectTemplate">Betreff-Vorlage</Label>
            <Input
              id="emailSubjectTemplate"
              name="emailSubjectTemplate"
              placeholder="Rechnung Nr. {documentNumber} – {companyName}"
              defaultValue={props.emailSubjectTemplate}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="emailBodyTemplate">Text-Vorlage</Label>
            <textarea
              id="emailBodyTemplate"
              name="emailBodyTemplate"
              rows={6}
              placeholder={"Guten Tag {contactPerson}\n\nanbei erhalten Sie die Rechnung Nr. {documentNumber}.\n\nMit freundlichen Grüssen\n{companyName}"}
              defaultValue={props.emailBodyTemplate}
              className="w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 resize-y"
            />
            <p className="text-xs text-muted-foreground">
              Platzhalter: {"{documentNumber}"}, {"{contactPerson}"}, {"{companyName}"}, {"{totalAmount}"}, {"{date}"}, {"{dueDate}"}, {"{customUserText}"}
            </p>
          </div>

          <div className="flex items-center gap-3 pt-1 border-t">
            <Button
              type="submit"
              formAction={testFormAction}
              variant="outline"
              size="sm"
              disabled={testPending}
            >
              {testPending ? "Wird geprüft…" : "Verbindung testen"}
            </Button>
            {testState?.error && (
              <p className="text-xs text-destructive">{testState.error}</p>
            )}
            {testState?.success && (
              <p className="text-xs text-green-600 dark:text-green-400">Verbindung erfolgreich</p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Benachrichtigungen */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Benachrichtigungen</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="notifyEmailAddress">Benachrichtigungs-E-Mail</Label>
            <Input
              id="notifyEmailAddress"
              name="notifyEmailAddress"
              type="email"
              placeholder="admin@example.com"
              defaultValue={props.notifyEmailAddress}
            />
            <p className="text-xs text-muted-foreground">
              Empfängeradresse für Admin-Benachrichtigungen (separate von der Kunden-E-Mail)
            </p>
          </div>

          <div className="space-y-3 pt-2 border-t">
            <div className="flex items-start gap-3">
              <input
                type="checkbox"
                id="notifyOverdueEnabled"
                name="notifyOverdueEnabled"
                defaultChecked={props.notifyOverdueEnabled}
                className="mt-0.5 h-4 w-4 accent-primary"
              />
              <Label htmlFor="notifyOverdueEnabled" className="cursor-pointer font-normal">
                Bei neuen überfälligen Rechnungen benachrichtigen
              </Label>
            </div>
            <div className="flex items-start gap-3">
              <input
                type="checkbox"
                id="notifyPendingEnabled"
                name="notifyPendingEnabled"
                defaultChecked={props.notifyPendingEnabled}
                className="mt-0.5 h-4 w-4 accent-primary"
              />
              <Label htmlFor="notifyPendingEnabled" className="cursor-pointer font-normal">
                Bei neuen Jahresrechnungen zur Überprüfung benachrichtigen
              </Label>
            </div>
          </div>

          <div className="space-y-1 pt-2 border-t">
            <Label htmlFor="notifyRepeatIntervalDays">Wiederholungs-Intervall (Tage)</Label>
            <Input
              id="notifyRepeatIntervalDays"
              name="notifyRepeatIntervalDays"
              type="number"
              min="1"
              placeholder="–"
              defaultValue={props.notifyRepeatIntervalDays ?? ""}
            />
            <p className="text-xs text-muted-foreground">
              Nach wie vielen Tagen wird erneut benachrichtigt, wenn ein Element noch offen ist. Leer lassen für keine Wiederholung.
            </p>
          </div>

          <div className="space-y-4 pt-2 border-t">
            <p className="text-sm font-medium">Telegram (optional)</p>
            <div className="space-y-1">
              <Label htmlFor="notifyTelegramBotToken">Bot-Token</Label>
              <PasswordInput
                id="notifyTelegramBotToken"
                name="notifyTelegramBotToken"
                autoComplete="off"
                placeholder={props.notifyTelegramBotTokenSet ? "••••••••  (gespeichert)" : ""}
              />
              {props.notifyTelegramBotTokenSet && (
                <p className="text-xs text-muted-foreground">
                  Leer lassen, um den gespeicherten Token zu behalten
                </p>
              )}
            </div>
            <div className="space-y-1">
              <Label htmlFor="notifyTelegramChatId">Chat-ID</Label>
              <Input
                id="notifyTelegramChatId"
                name="notifyTelegramChatId"
                placeholder="-100123456789"
                defaultValue={props.notifyTelegramChatId}
              />
              <p className="text-xs text-muted-foreground">
                User-ID oder Gruppen-ID (z.B. –100123456789). Über @userinfobot abrufbar.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-4 pt-1 border-t">
            <div className="flex items-center gap-3">
              <Button
                type="submit"
                formAction={testEmailNotifAction}
                variant="outline"
                size="sm"
                disabled={testEmailNotifPending}
              >
                {testEmailNotifPending ? "Wird gesendet…" : "Test-E-Mail senden"}
              </Button>
              {testEmailNotifState?.error && (
                <p className="text-xs text-destructive">{testEmailNotifState.error}</p>
              )}
              {testEmailNotifState?.success && (
                <p className="text-xs text-green-600 dark:text-green-400">E-Mail gesendet</p>
              )}
            </div>
            <div className="flex items-center gap-3">
              <Button
                type="submit"
                formAction={testTelegramAction}
                variant="outline"
                size="sm"
                disabled={testTelegramPending}
              >
                {testTelegramPending ? "Wird gesendet…" : "Telegram testen"}
              </Button>
              {testTelegramState?.error && (
                <p className="text-xs text-destructive">{testTelegramState.error}</p>
              )}
              {testTelegramState?.success && (
                <p className="text-xs text-green-600 dark:text-green-400">Nachricht gesendet</p>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {state?.error && (
        <p className="text-sm text-destructive">{state.error}</p>
      )}

      <Button type="submit" className="w-full sm:w-auto" disabled={isPending}>
        {isPending ? "Speichern…" : "Einstellungen speichern"}
      </Button>
    </form>
  );
}
