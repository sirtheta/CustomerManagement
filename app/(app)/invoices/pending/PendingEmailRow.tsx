"use client";

import { useActionState, useTransition } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { approvePendingEmail, discardPendingEmail } from "./actions";
import { useActionToast, type ActionState } from "@/hooks/use-action-toast";
import { SendIcon, Trash2Icon, TriangleAlertIcon, PencilIcon } from "lucide-react";

type Props = {
  id: number;
  invoiceId: number;
  documentNumber: string;
  customerName: string;
  totalAmount: number;
  to: string;
  subject: string;
  body: string;
};

export default function PendingEmailRow(props: Props) {
  const [state, formAction, isPending] = useActionState<ActionState, FormData>(
    approvePendingEmail,
    {}
  );
  const [discarding, startDiscard] = useTransition();

  useActionToast(state, `Rechnung ${props.documentNumber} versendet`);

  const isEmpty = props.totalAmount === 0;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <CardTitle className="text-base">{props.documentNumber}</CardTitle>
            <p className="text-sm text-muted-foreground mt-0.5">{props.customerName}</p>
          </div>
          <Button
            variant="outline"
            size="sm"
            render={<Link href={`/invoices/${props.invoiceId}/edit`} />}
          >
            <PencilIcon className="size-3.5 mr-1.5" />
            Positionen bearbeiten
          </Button>
        </div>
        {isEmpty && (
          <div className="flex items-center gap-2 rounded-md bg-yellow-50 dark:bg-yellow-950/30 border border-yellow-200 dark:border-yellow-800 px-3 py-2 text-sm text-yellow-800 dark:text-yellow-300 mt-1">
            <TriangleAlertIcon className="size-4 shrink-0" />
            Rechnung hat noch keine Positionen (CHF 0.00). Bitte zuerst Positionen eintragen.
          </div>
        )}
      </CardHeader>
      <CardContent>
        <form action={formAction} className="space-y-3">
          <input type="hidden" name="id" value={props.id} />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor={`to-${props.id}`}>Empfänger</Label>
              <Input
                id={`to-${props.id}`}
                name="to"
                type="email"
                required
                defaultValue={props.to}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor={`subject-${props.id}`}>Betreff</Label>
              <Input
                id={`subject-${props.id}`}
                name="subject"
                required
                defaultValue={props.subject}
              />
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor={`body-${props.id}`}>Nachricht</Label>
            <textarea
              id={`body-${props.id}`}
              name="body"
              rows={5}
              required
              defaultValue={props.body}
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
              className="text-destructive hover:text-destructive"
              disabled={discarding}
              onClick={() =>
                startDiscard(() => discardPendingEmail(props.id))
              }
            >
              <Trash2Icon className="size-4 mr-1.5" />
              {discarding ? "Wird verworfen…" : "Verwerfen"}
            </Button>
            <Button type="submit" size="sm" disabled={isPending}>
              <SendIcon className="size-4 mr-1.5" />
              {isPending ? "Wird gesendet…" : "Senden"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
