"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DatePickerInput } from "@/components/ui/date-picker";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useActionToast } from "@/hooks/use-action-toast";
import { INTERVAL_LABELS, type SubscriptionIntervalName } from "@/lib/subscription-dates";
import {
  createSubscription,
  updateSubscription,
  setSubscriptionActive,
  deleteSubscription,
} from "./subscription-actions";

type TemplateOption = { id: number; name: string };
type SubscriptionRecord = {
  id: number;
  interval: SubscriptionIntervalName;
  nextInvoiceDate: string; // "YYYY-MM-DD"
  autoSend: boolean;
  active: boolean;
  templateId: number | null;
  templateName: string | null;
};
type Props = {
  customerId: number;
  subscriptions: SubscriptionRecord[];
  templates: TemplateOption[];
  canEdit: boolean;
};

type FieldValues = {
  interval: SubscriptionIntervalName;
  nextInvoiceDate: string;
  templateId: string;
  autoSend: boolean;
};

function SubscriptionFields({
  idPrefix,
  values,
  onChange,
  templates,
  disabled,
}: {
  idPrefix: string;
  values: FieldValues;
  onChange: (values: FieldValues) => void;
  templates: TemplateOption[];
  disabled: boolean;
}) {
  const noTemplate = values.templateId === "";
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label htmlFor={`${idPrefix}-interval`}>Intervall</Label>
          <Select
            name="interval"
            value={values.interval}
            onValueChange={(v) => onChange({ ...values, interval: v as SubscriptionIntervalName })}
            disabled={disabled}
          >
            <SelectTrigger id={`${idPrefix}-interval`} className="w-full">
              <SelectValue>
                {(value: string | null) =>
                  value ? (INTERVAL_LABELS[value as SubscriptionIntervalName] ?? value) : ""
                }
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {Object.entries(INTERVAL_LABELS).map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor={`${idPrefix}-date`}>Nächstes Rechnungsdatum</Label>
          <DatePickerInput
            id={`${idPrefix}-date`}
            name="nextInvoiceDate"
            value={values.nextInvoiceDate}
            onChange={(nextInvoiceDate) => onChange({ ...values, nextInvoiceDate })}
            disabled={disabled}
          />
        </div>
      </div>
      <div className="space-y-1">
        <Label htmlFor={`${idPrefix}-template`}>Vorlage</Label>
        <Select
          name="templateId"
          value={values.templateId}
          onValueChange={(v) => {
            const templateId = v ?? "";
            onChange({
              ...values,
              templateId,
              autoSend: templateId === "" ? false : values.autoSend,
            });
          }}
          disabled={disabled}
        >
          <SelectTrigger id={`${idPrefix}-template`} className="w-full">
            <SelectValue>
              {(value: string | null) =>
                value ? (templates.find((t) => String(t.id) === value)?.name ?? value) : "Keine Vorlage"
              }
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="">Keine Vorlage</SelectItem>
            {templates.map((t) => (
              <SelectItem key={t.id} value={String(t.id)}>
                {t.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <label className="flex items-center gap-2 text-sm cursor-pointer">
        <input
          type="checkbox"
          name="autoSend"
          checked={values.autoSend && !noTemplate}
          onChange={(e) => onChange({ ...values, autoSend: e.target.checked })}
          disabled={disabled || noTemplate}
          className="h-4 w-4 rounded border-input accent-primary"
        />
        Automatisch versenden
      </label>
    </div>
  );
}

const EMPTY_VALUES: FieldValues = {
  interval: "Yearly",
  nextInvoiceDate: "",
  templateId: "",
  autoSend: false,
};

function NewSubscriptionForm({
  customerId,
  templates,
}: {
  customerId: number;
  templates: TemplateOption[];
}) {
  const [state, formAction, isPending] = useActionState(createSubscription.bind(null, customerId), {});
  const [values, setValues] = useState<FieldValues>(EMPTY_VALUES);
  const prevTs = useRef<number | undefined>(undefined);

  useActionToast(state, "Abo angelegt");

  useEffect(() => {
    if (state.success && state._ts !== prevTs.current) {
      prevTs.current = state._ts;
      setValues(EMPTY_VALUES);
    }
  }, [state]);

  return (
    <form action={formAction} className="space-y-2">
      <SubscriptionFields
        idPrefix="new-sub"
        values={values}
        onChange={setValues}
        templates={templates}
        disabled={isPending}
      />
      <Button type="submit" variant="outline" size="sm" disabled={isPending}>
        {isPending ? "Speichert…" : "Abo anlegen"}
      </Button>
    </form>
  );
}

function SubscriptionItem({
  customerId,
  sub,
  templates,
}: {
  customerId: number;
  sub: SubscriptionRecord;
  templates: TemplateOption[];
}) {
  const [state, formAction, isPending] = useActionState(
    updateSubscription.bind(null, customerId, sub.id),
    {}
  );
  const [values, setValues] = useState<FieldValues>({
    interval: sub.interval,
    nextInvoiceDate: sub.nextInvoiceDate,
    templateId: sub.templateId == null ? "" : String(sub.templateId),
    autoSend: sub.autoSend,
  });
  useActionToast(state, "Abo gespeichert");
  const [isToggling, startToggle] = useTransition();

  return (
    <li className="py-3 space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        {!sub.active && <Badge variant="secondary">Pausiert</Badge>}
        {sub.templateId == null && <Badge variant="destructive">Vorlage fehlt</Badge>}
      </div>
      <form action={formAction} className="space-y-2">
        <input type="hidden" name="loadedNextInvoiceDate" value={sub.nextInvoiceDate} />
        <SubscriptionFields
          idPrefix={`sub-${sub.id}`}
          values={values}
          onChange={setValues}
          templates={templates}
          disabled={isPending}
        />
        <div className="flex items-center gap-1.5">
          <Button type="submit" variant="outline" size="sm" disabled={isPending}>
            {isPending ? "…" : "Speichern"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={isToggling}
            onClick={() =>
              startToggle(async () => {
                try {
                  await setSubscriptionActive(customerId, sub.id, !sub.active);
                } catch {
                  toast.error("Status konnte nicht geändert werden.");
                }
              })
            }
          >
            {sub.active ? "Pausieren" : "Fortsetzen"}
          </Button>
          <ConfirmDialog
            title="Abo löschen"
            description="Soll dieses Abo wirklich gelöscht werden? Bereits erstellte Rechnungen bleiben erhalten."
            confirmLabel="Löschen"
            triggerVariant="ghost"
            triggerSize="sm"
            onConfirm={() => deleteSubscription(customerId, sub.id)}
          >
            Löschen
          </ConfirmDialog>
        </div>
      </form>
    </li>
  );
}

function ReadOnlyItem({ sub }: { sub: SubscriptionRecord }) {
  const [year, month, day] = sub.nextInvoiceDate.split("-");
  return (
    <li className="py-3 text-sm space-y-1">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="font-medium">{INTERVAL_LABELS[sub.interval]}</span>
        {!sub.active && <Badge variant="secondary">Pausiert</Badge>}
        {sub.templateId == null && <Badge variant="destructive">Vorlage fehlt</Badge>}
      </div>
      <p className="text-muted-foreground">
        Nächste Rechnung: {`${day}.${month}.${year}`} · Vorlage: {sub.templateName ?? "–"} · Automatisch
        versenden: {sub.autoSend ? "Ja" : "Nein"}
      </p>
    </li>
  );
}

export default function SubscriptionsSection({ customerId, subscriptions, templates, canEdit }: Props) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Abos</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {canEdit && <NewSubscriptionForm customerId={customerId} templates={templates} />}

        {subscriptions.length === 0 ? (
          <p className="text-sm text-muted-foreground py-1">Noch keine Abos vorhanden.</p>
        ) : (
          <ul className="divide-y divide-border">
            {subscriptions.map((sub) =>
              canEdit ? (
                <SubscriptionItem
                  key={`${sub.id}-${sub.nextInvoiceDate}-${sub.templateId}-${sub.autoSend}-${sub.interval}`}
                  customerId={customerId}
                  sub={sub}
                  templates={templates}
                />
              ) : (
                <ReadOnlyItem key={sub.id} sub={sub} />
              )
            )}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
