"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { sendInvoice } from "./actions";
import { useActionToast, type ActionState } from "@/hooks/use-action-toast";
import { SendIcon } from "lucide-react";
import { cn } from "@/lib/utils";

type Props = {
  invoiceId: number;
  customerEmail: string;
  documentNumber: string;
  defaultSubject: string;
  defaultBody: string;
};

export default function SendInvoiceButton({
  invoiceId,
  customerEmail,
  documentNumber,
  defaultSubject,
  defaultBody,
}: Props) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"edit" | "preview">("edit");
  const [to, setTo] = useState(customerEmail);
  const [subject, setSubject] = useState(defaultSubject);
  const [body, setBody] = useState(defaultBody);

  const [state, formAction, isPending] = useActionState<ActionState, FormData>(
    sendInvoice,
    {}
  );

  useActionToast(state, `Rechnung ${documentNumber} versendet`);

  // Close the dialog once a send succeeds, derived from the action result
  // timestamp during render rather than in an effect.
  const [seenResultTs, setSeenResultTs] = useState(state?._ts);
  if (state?._ts !== seenResultTs) {
    setSeenResultTs(state?._ts);
    if (state?.success) setOpen(false);
  }

  // Reset the form fields each time the dialog opens.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setTab("edit");
      setTo(customerEmail);
      setSubject(defaultSubject);
      setBody(defaultBody);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button variant="default" size="sm">
            <SendIcon className="size-4 mr-1.5" />
            Rechnung senden
          </Button>
        }
      />
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Rechnung per E-Mail senden</DialogTitle>
        </DialogHeader>

        {/* Tabs */}
        <div className="flex gap-1 border-b -mt-2">
          <button
            type="button"
            onClick={() => setTab("edit")}
            className={cn(
              "px-3 py-1.5 text-sm transition-colors",
              tab === "edit"
                ? "border-b-2 border-primary text-foreground font-medium -mb-px"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            Bearbeiten
          </button>
          <button
            type="button"
            onClick={() => setTab("preview")}
            className={cn(
              "px-3 py-1.5 text-sm transition-colors",
              tab === "preview"
                ? "border-b-2 border-primary text-foreground font-medium -mb-px"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            Vorschau
          </button>
        </div>

        <form action={formAction} className="space-y-4">
          <input type="hidden" name="invoiceId" value={invoiceId} />

          {/* Hidden inputs carry values when in preview mode */}
          {tab === "preview" && (
            <>
              <input type="hidden" name="to" value={to} />
              <input type="hidden" name="subject" value={subject} />
              <input type="hidden" name="body" value={body} />
            </>
          )}

          {/* Edit tab */}
          <div className={tab === "edit" ? "space-y-4" : "hidden"}>
            <div className="space-y-1">
              <Label htmlFor="send-to">Empfänger</Label>
              <Input
                id="send-to"
                name="to"
                type="email"
                required
                value={to}
                onChange={(e) => setTo(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="send-subject">Betreff</Label>
              <Input
                id="send-subject"
                name="subject"
                required
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="send-body">Nachricht</Label>
              <textarea
                id="send-body"
                name="body"
                rows={7}
                required
                value={body}
                onChange={(e) => setBody(e.target.value)}
                className="w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 resize-y"
              />
            </div>
          </div>

          {/* Preview tab */}
          {tab === "preview" && (
            <div className="rounded-lg border bg-card text-sm overflow-hidden">
              <div className="border-b bg-muted/40 px-4 py-2 space-y-1">
                <div className="flex gap-2">
                  <span className="text-muted-foreground w-14 shrink-0">An:</span>
                  <span>{to}</span>
                </div>
                <div className="flex gap-2">
                  <span className="text-muted-foreground w-14 shrink-0">Betreff:</span>
                  <span className="font-medium">{subject}</span>
                </div>
              </div>
              <pre className="whitespace-pre-wrap font-sans px-4 py-3 text-sm leading-relaxed max-h-64 overflow-y-auto">
                {body}
              </pre>
            </div>
          )}

          {state?.error && (
            <p className="text-sm text-destructive">{state.error}</p>
          )}
          <DialogFooter showCloseButton>
            <Button type="submit" disabled={isPending}>
              {isPending ? "Wird gesendet…" : "Senden"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
