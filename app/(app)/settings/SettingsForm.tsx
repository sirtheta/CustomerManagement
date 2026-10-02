"use client";

import { useActionState, useCallback, useEffect, useRef, useState, useTransition, type MouseEvent } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { saveSettings, setSetting, testSmtpConnection, testEmailNotification, testTelegramNotification } from "./actions";
import ImmediateCheckbox from "./ImmediateCheckbox";
import { useActionToast, type ActionState } from "@/hooks/use-action-toast";
import { PasswordInput } from "@/components/ui/password-input";
import { ADDRESS_LIMITS, CREDITOR_COUNTRIES, countryName } from "@/lib/address";

type Props = {
  // Switched-off modules stay in the form as hidden fields: saveSettings reads
  // every field and would reset a missing one to its default.
  showQuotes: boolean;
  showReminders: boolean;
  companyName: string;
  companyHolderName: string;
  companyStreet: string;
  companyHouseNumber: string;
  companyZip: string;
  companyCity: string;
  companyCountry: string;
  companyAddressNeedsReview: boolean;
  companyEmail: string;
  companyPhone: string;
  companyIBAN: string;
  numberFormat: string;
  defaultPaymentTermDays: number;
  defaultQuoteValidityDays: number;
  reminderCooldownDays: number;
  reminderFeeLevel2: number;
  reminderFeeLevel3: number;
  reminderFeeLevel4: number;
  reminderInterestPercent: number;
  invoiceNumberPrefix: string;
  quoteNumberPrefix: string;
  useHolderNameOnQR: boolean;
  roundTotalTo5Rappen: boolean;
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
  const [, startTransition] = useTransition();
  // Test buttons must not use formAction: React 19 resets the form after any form
  // action, which would wipe unsaved input. Dispatch with the current FormData instead.
  const runTest = (action: (payload: FormData) => void) => (e: MouseEvent<HTMLButtonElement>) => {
    if (!e.currentTarget.form) return;
    const data = new FormData(e.currentTarget.form);
    startTransition(() => action(data));
  };
  useActionToast(state, "Einstellungen gespeichert");

  // The form is dirty while its FormData differs from what it held when it was
  // mounted (a save or a discard remounts it through `key`).
  const formEl = useRef<HTMLFormElement | null>(null);
  const savedValues = useRef("");
  const [dirty, setDirty] = useState(false);
  const [discardCount, setDiscardCount] = useState(0);
  const serialize = (form: HTMLFormElement) =>
    JSON.stringify(Array.from(new FormData(form).entries()));
  const checkDirty = () => {
    if (formEl.current) setDirty(serialize(formEl.current) !== savedValues.current);
  };
  const formRef = useCallback((el: HTMLFormElement | null) => {
    formEl.current = el;
    if (!el) return;
    savedValues.current = JSON.stringify(Array.from(new FormData(el).entries()));
    setDirty(false);
  }, []);

  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    // Next.js has no navigation hook for the App Router, so internal links are
    // caught before the router sees the click.
    const onClick = (e: globalThis.MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const link = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!link || link.target === "_blank" || link.origin !== window.location.origin) return;
      if (link.pathname === window.location.pathname && link.search === window.location.search) return;
      if (!window.confirm("Ungespeicherte Änderungen gehen verloren. Seite trotzdem verlassen?")) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    document.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      document.removeEventListener("click", onClick, true);
    };
  }, [dirty]);
  useActionToast(testState, "SMTP-Verbindung erfolgreich", { toastErrors: false });
  useActionToast(testEmailNotifState, "Test-E-Mail erfolgreich gesendet", { toastErrors: false });
  useActionToast(testTelegramState, "Telegram-Test erfolgreich gesendet", { toastErrors: false });

  return (
    <form
      key={`${state?._ts ?? 0}-${discardCount}`}
      ref={formRef}
      action={formAction}
      onInput={checkDirty}
      className="space-y-6"
    >
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
          {props.companyAddressNeedsReview && (
            <p
              role="status"
              className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100"
            >
              Die Adresse wurde automatisch in Strasse und Hausnummer aufgeteilt. Bitte prüfen und
              speichern — die QR-Rechnung verlangt getrennte Felder.
            </p>
          )}
          <div className="grid grid-cols-3 gap-4">
            <div className="col-span-2 space-y-1">
              <Label htmlFor="companyStreet">Strasse</Label>
              <Input id="companyStreet" name="companyStreet" maxLength={ADDRESS_LIMITS.street} defaultValue={props.companyStreet} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="companyHouseNumber">Hausnummer</Label>
              <Input id="companyHouseNumber" name="companyHouseNumber" maxLength={ADDRESS_LIMITS.houseNumber} defaultValue={props.companyHouseNumber} />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-1">
              <Label htmlFor="companyZip">PLZ</Label>
              <Input id="companyZip" name="companyZip" maxLength={ADDRESS_LIMITS.zip} defaultValue={props.companyZip} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="companyCity">Ort</Label>
              <Input id="companyCity" name="companyCity" maxLength={ADDRESS_LIMITS.city} defaultValue={props.companyCity} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="companyCountry">Land</Label>
              <Select
                name="companyCountry"
                defaultValue={props.companyCountry}
                onValueChange={() => setTimeout(checkDirty, 0)}
              >
                <SelectTrigger id="companyCountry" className="w-full">
                  <SelectValue>
                    {(value: string | null) => (value ? countryName(value) : "")}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {CREDITOR_COUNTRIES.map((code) => (
                    <SelectItem key={code} value={code}>
                      {countryName(code)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
            <div className={props.showQuotes ? "space-y-1" : "hidden"}>
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
            <div className={props.showQuotes ? "space-y-1" : "hidden"}>
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
          <div className={props.showReminders ? "space-y-4" : "hidden"}>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label htmlFor="reminderCooldownDays">Frist zwischen Mahnungen (Tage)</Label>
              <Input
                id="reminderCooldownDays"
                name="reminderCooldownDays"
                type="number"
                min="1"
                defaultValue={props.reminderCooldownDays}
              />
              <p className="text-xs text-muted-foreground">
                Zahlungsfrist auf dem Mahnbeleg. So lange bleibt eine versendete oder zurückgestellte Mahnung ausgeblendet, danach erscheint sie wieder unter «Mahnungen».
              </p>
            </div>
          </div>
          <div className="space-y-3 pt-2 border-t">
            <div>
              <p className="text-sm font-medium">Mahngebühren und Verzugszins</p>
              <p className="text-xs text-muted-foreground">
                Standardmässig aus (0). Gebühren und Zins dürfen nur berechnet werden, wenn sie
                vereinbart sind (z. B. in den AGB). Bitte rechtlich klären.
              </p>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              {([
                ["reminderFeeLevel2", "Gebühr 1. Mahnung (CHF)", props.reminderFeeLevel2],
                ["reminderFeeLevel3", "Gebühr 2. Mahnung (CHF)", props.reminderFeeLevel3],
                ["reminderFeeLevel4", "Gebühr 3. Mahnung (CHF)", props.reminderFeeLevel4],
              ] as const).map(([name, label, value]) => (
                <div key={name} className="space-y-1">
                  <Label htmlFor={name}>{label}</Label>
                  <Input id={name} name={name} type="number" min="0" step="0.05" defaultValue={value} />
                </div>
              ))}
              <div className="space-y-1">
                <Label htmlFor="reminderInterestPercent">Verzugszins (% p. a.)</Label>
                <Input
                  id="reminderInterestPercent"
                  name="reminderInterestPercent"
                  type="number"
                  min="0"
                  max="100"
                  step="0.01"
                  defaultValue={props.reminderInterestPercent}
                />
              </div>
            </div>
          </div>
          </div>

          <div className="pt-2 border-t">
            <ImmediateCheckbox
              id="useHolderNameOnQR"
              label="Inhabername auf QR-Rechnung verwenden"
              description={
                <>
                  Aktivieren um «{props.companyHolderName || "Inhabername"}» statt «
                  {props.companyName || "Firmenname"}» als Gläubiger zu drucken. Gilt sofort.
                </>
              }
              checked={props.useHolderNameOnQR}
              save={(next) => setSetting("useHolderNameOnQR", next)}
            />
          </div>

          <div className="pt-2 border-t">
            <ImmediateCheckbox
              id="roundTotalTo5Rappen"
              label="Rechnungsbetrag auf 5 Rappen runden"
              description="Rundet das Gesamttotal neuer und neu gespeicherter Rechnungen und Offerten auf 5 Rappen. Die Differenz steht als Zeile «Rundung» auf dem PDF. Positionen werden nicht gerundet, bereits versendete Rechnungen bleiben unverändert. Gilt sofort."
              checked={props.roundTotalTo5Rappen}
              save={(next) => setSetting("roundTotalTo5Rappen", next)}
            />
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
              placeholder={props.smtpUser || "rechnung@example.com"}
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
              type="button"
              onClick={runTest(testFormAction)}
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
            <ImmediateCheckbox
              id="notifyOverdueEnabled"
              label="Bei neuen überfälligen Rechnungen benachrichtigen"
              labelClassName="cursor-pointer font-normal"
              checked={props.notifyOverdueEnabled}
              save={(next) => setSetting("notifyOverdueEnabled", next)}
            />
            <ImmediateCheckbox
              id="notifyPendingEnabled"
              label="Bei neuen Abo-Rechnungen zur Überprüfung benachrichtigen"
              labelClassName="cursor-pointer font-normal"
              checked={props.notifyPendingEnabled}
              save={(next) => setSetting("notifyPendingEnabled", next)}
            />
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
                type="button"
                onClick={runTest(testEmailNotifAction)}
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
                type="button"
                onClick={runTest(testTelegramAction)}
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

      {dirty && (
        <div
          role="region"
          aria-label="Ungespeicherte Änderungen"
          className="sticky bottom-4 z-10 flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-background/95 px-4 py-3 shadow-lg backdrop-blur"
        >
          <div className="text-sm">
            <p className="font-medium">Ungespeicherte Änderungen</p>
            {state?.error && <p className="text-destructive">{state.error}</p>}
          </div>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={isPending}
              onClick={() => setDiscardCount((n) => n + 1)}
            >
              Verwerfen
            </Button>
            <Button type="submit" size="sm" disabled={isPending}>
              {isPending ? "Speichern…" : "Einstellungen speichern"}
            </Button>
          </div>
        </div>
      )}
    </form>
  );
}
