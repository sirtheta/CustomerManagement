"use client";

import { useActionState, useTransition } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { sendReminder, dismissReminder } from "./actions";
import { useActionToast, type ActionState } from "@/hooks/use-action-toast";
import { SendIcon, Trash2Icon } from "lucide-react";
import { formatCurrency } from "@/lib/utils";

const levelLabels: Record<number, string> = {
  1: "Zahlungserinnerung",
  2: "1. Mahnung",
  3: "2. Mahnung",
};

type Props = {
  reminderId: number;
  invoiceId: number;
  documentNumber: string;
  customerName: string;
  totalAmount: number;
  dueDate: string;
  customerEmail: string;
  reminderLevel: number;
  defaultSubject: string;
  defaultBody: string;
};

export default function ReminderRow(props: Props) {
  const [state, formAction, isPending] = useActionState<ActionState, FormData>(
    sendReminder,
    {}
  );
  const [dismissing, startDismiss] = useTransition();

  useActionToast(state, `Mahnung für ${props.documentNumber} versendet`);

  const levelLabel = levelLabels[props.reminderLevel] ?? `Mahnung ${props.reminderLevel}`;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <CardTitle className="text-base">
              {props.documentNumber}{" "}
              <span className="text-xs font-normal text-muted-foreground">· {levelLabel}</span>
            </CardTitle>
            <p className="text-sm text-muted-foreground mt-0.5">
              {props.customerName} · Fällig:{" "}
              <span className="text-destructive font-medium">{props.dueDate}</span> ·{" "}
              {formatCurrency(props.totalAmount)}
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            render={<Link href={`/invoices/${props.invoiceId}`} />}
          >
            Rechnung anzeigen
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="space-y-3">
          <input type="hidden" name="reminderId" value={props.reminderId} />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor={`to-${props.reminderId}`}>Empfänger</Label>
              <Input
                id={`to-${props.reminderId}`}
                name="to"
                type="email"
                required
                defaultValue={props.customerEmail}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor={`subject-${props.reminderId}`}>Betreff</Label>
              <Input
                id={`subject-${props.reminderId}`}
                name="subject"
                required
                defaultValue={props.defaultSubject}
              />
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor={`body-${props.reminderId}`}>Nachricht</Label>
            <textarea
              id={`body-${props.reminderId}`}
              name="body"
              rows={5}
              required
              defaultValue={props.defaultBody}
              className="w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 resize-y"
            />
          </div>
          {state?.error && (
            <p className="text-sm text-destructive">{state.error}</p>
          )}
          <div className="flex justify-between items-center gap-2 pt-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-muted-foreground"
              disabled={dismissing}
              onClick={() => startDismiss(() => dismissReminder(props.reminderId))}
            >
              <Trash2Icon className="size-4 mr-1.5" />
              {dismissing ? "Wird verworfen…" : "Ignorieren"}
            </Button>
            <Button type="submit" size="sm" disabled={isPending}>
              <SendIcon className="size-4 mr-1.5" />
              {isPending ? "Wird gesendet…" : "Mahnung senden"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
