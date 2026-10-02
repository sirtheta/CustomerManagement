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
import { documentLabel } from "@/lib/document-display";
import { useSendDialog } from "./SendDialogContext";

type Props = {
  invoiceId: number;
  customerEmail: string;
  documentNumber: string | null;
  defaultSubject: string;
  defaultBody: string;
  isCreditNote?: boolean;
  /** For drafts: the number the next numbering would assign (shown only, never sent). */
  expectedDocumentNumber?: string | null;
};

const NUMBER_PLACEHOLDER = "{documentNumber}";
const NUMBER_PENDING_TEXT = "(wird beim Senden vergeben)";

const replaceAllText = (text: string, search: string, replacement: string) =>
  text.split(search).join(replacement);

export default function SendInvoiceButton({
  invoiceId,
  customerEmail,
  documentNumber,
  defaultSubject,
  defaultBody,
  isCreditNote = false,
  expectedDocumentNumber = null,
}: Props) {
  const noun = isCreditNote ? "Gutschrift" : "Rechnung";
  // Shared with the page when it provides one (status confirmation → «Stattdessen senden»).
  const shared = useSendDialog();
  const [localOpen, setLocalOpen] = useState(false);
  const open = shared ? shared.open : localOpen;
  const setOpen = shared ? shared.setOpen : setLocalOpen;
  const [tab, setTab] = useState<"edit" | "preview">("edit");
  const [to, setTo] = useState(customerEmail);
  // A draft has no number yet: the dialog shows the expected number (or a note) in place
  // of the placeholder, and the submitted text carries the placeholder again, so the server
  // fills in the number it really assigns when sending.
  const shownNumber = documentNumber ? null : (expectedDocumentNumber ?? NUMBER_PENDING_TEXT);
  const toDisplay = (text: string) =>
    shownNumber ? replaceAllText(text, NUMBER_PLACEHOLDER, shownNumber) : text;
  const toSubmit = (text: string) =>
    shownNumber ? replaceAllText(text, shownNumber, NUMBER_PLACEHOLDER) : text;
  const [subject, setSubject] = useState(() => toDisplay(defaultSubject));
  const [body, setBody] = useState(() => toDisplay(defaultBody));

  const [state, formAction, isPending] = useActionState<ActionState, FormData>(
    sendInvoice,
    {}
  );

  useActionToast(state, `${noun} ${documentLabel(documentNumber)} versendet`, { toastErrors: false });

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
      setSubject(toDisplay(defaultSubject));
      setBody(toDisplay(defaultBody));
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button variant="default" size="sm">
            <SendIcon className="size-4 mr-1.5" />
            {noun} senden
          </Button>
        }
      />
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{noun} per E-Mail senden</DialogTitle>
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
          {tab === "preview" && <input type="hidden" name="to" value={to} />}
          {/* Subject and body are always submitted from here, with the number placeholder restored. */}
          <input type="hidden" name="subject" value={toSubmit(subject)} />
          <input type="hidden" name="body" value={toSubmit(body)} />

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
                required
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
              />
              {shownNumber && (
                <p className="text-xs text-muted-foreground">
                  {expectedDocumentNumber
                    ? `Die Nummer wird beim Senden vergeben (voraussichtlich ${expectedDocumentNumber}).`
                    : "Die Nummer wird beim Senden vergeben."}
                </p>
              )}
            </div>
            <div className="space-y-1">
              <Label htmlFor="send-body">Nachricht</Label>
              <textarea
                id="send-body"
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
