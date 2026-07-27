"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { toast } from "sonner";

type Props = {
  title: string;
  description: string;
  confirmLabel?: string;
  confirmVariant?: "destructive" | "default";
  onConfirm: () => void | { error?: string } | Promise<void | { error?: string }>;
  children: React.ReactNode;
  triggerVariant?: "destructive" | "outline" | "ghost" | "default";
  triggerSize?: "sm" | "default" | "lg";
  triggerDisabled?: boolean;
};

export function ConfirmDialog({
  title,
  description,
  confirmLabel = "Bestätigen",
  confirmVariant = "destructive",
  onConfirm,
  children,
  triggerVariant = "destructive",
  triggerSize = "default",
  triggerDisabled,
}: Props) {
  const [open, setOpen] = useState(false);
  const [isPending, setIsPending] = useState(false);

  async function handleConfirm() {
    setIsPending(true);
    try {
      const result = await onConfirm();
      if (result?.error) {
        toast.error(result.error);
        return;
      }
      setOpen(false);
    } catch (err) {
      // A server action's redirect() throws internally; let Next.js's own
      // navigation handling deal with it instead of showing an error toast.
      const digest = (err as { digest?: string } | undefined)?.digest;
      if (typeof digest === "string" && digest.startsWith("NEXT_REDIRECT")) {
        throw err;
      }
      // In production, Next.js strips the real message from errors thrown
      // out of a Server Action, so this fallback is all we can show.
      toast.error("Aktion fehlgeschlagen. Bitte erneut versuchen.");
    } finally {
      setIsPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={<Button variant={triggerVariant} size={triggerSize} type="button" />}
        disabled={triggerDisabled}
      >
        {children}
      </DialogTrigger>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />} disabled={isPending}>
            Abbrechen
          </DialogClose>
          <Button variant={confirmVariant} onClick={handleConfirm} disabled={isPending}>
            {isPending ? "…" : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
