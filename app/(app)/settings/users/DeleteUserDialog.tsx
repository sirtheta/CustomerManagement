"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { deleteUser } from "./actions";
import { toast } from "sonner";

type User = { id: number; name: string };

export function DeleteUserDialog({ user }: { user: User }) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" variant="destructive" />}>
        Löschen
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Benutzer löschen — {user.name}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Benutzer &quot;{user.name}&quot; wirklich löschen?
          </p>
          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={() => setOpen(false)}>Abbrechen</Button>
            <Button
              variant="destructive"
              disabled={isPending}
              onClick={() =>
                startTransition(async () => {
                  const result = await deleteUser(user.id);
                  if (result.error) {
                    toast.error(result.error);
                  } else {
                    setOpen(false);
                  }
                })
              }
            >
              {isPending ? "Löschen..." : "Löschen"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
