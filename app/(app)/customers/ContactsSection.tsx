"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { createContact, deleteContact, updateContact } from "./contact-actions";
import { useActionToast } from "@/hooks/use-action-toast";
import { submitKeepingInput } from "@/hooks/submit-keeping-input";

type ContactRecord = {
  contactId: number;
  name: string;
  role: string | null;
  email: string | null;
  phone: string | null;
};

type Props = {
  customerId: number;
  canEdit: boolean;
  contacts: ContactRecord[];
};

function ContactFields({ contact, disabled }: { contact?: ContactRecord; disabled: boolean }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
      <Input name="name" placeholder="Name" required defaultValue={contact?.name ?? ""} disabled={disabled} />
      <Input name="role" placeholder="Rolle (z.B. Buchhaltung)" defaultValue={contact?.role ?? ""} disabled={disabled} />
      <Input name="email" type="email" placeholder="E-Mail" defaultValue={contact?.email ?? ""} disabled={disabled} />
      <Input name="phone" type="tel" placeholder="Telefon" defaultValue={contact?.phone ?? ""} disabled={disabled} />
    </div>
  );
}

function NewContactForm({ customerId }: { customerId: number }) {
  const [state, formAction, isPending] = useActionState(createContact.bind(null, customerId), {});
  const formRef = useRef<HTMLFormElement>(null);
  const prevTs = useRef<number | undefined>(undefined);

  useActionToast(state, "Kontakt hinzugefügt");

  useEffect(() => {
    if (state.success && state._ts !== prevTs.current) {
      prevTs.current = state._ts;
      formRef.current?.reset();
    }
  }, [state]);

  return (
    <form ref={formRef} action={formAction} onSubmit={submitKeepingInput(formAction)} className="space-y-2">
      <ContactFields disabled={isPending} />
      <Button type="submit" variant="outline" size="sm" disabled={isPending}>
        {isPending ? "Speichert…" : "Kontakt hinzufügen"}
      </Button>
    </form>
  );
}

function EditableContact({ customerId, contact }: { customerId: number; contact: ContactRecord }) {
  const [state, formAction, isPending] = useActionState(
    updateContact.bind(null, customerId, contact.contactId),
    {}
  );
  useActionToast(state, "Kontakt gespeichert");

  return (
    <li className="py-3">
      <form action={formAction} onSubmit={submitKeepingInput(formAction)} className="space-y-2">
        <ContactFields contact={contact} disabled={isPending} />
        <div className="flex items-center gap-1.5">
          <Button type="submit" variant="outline" size="sm" disabled={isPending}>
            {isPending ? "…" : "Speichern"}
          </Button>
          <ConfirmDialog
            title="Kontakt löschen"
            description="Soll dieser Kontakt wirklich gelöscht werden?"
            confirmLabel="Löschen"
            triggerVariant="ghost"
            triggerSize="sm"
            onConfirm={() => deleteContact(customerId, contact.contactId)}
          >
            Löschen
          </ConfirmDialog>
        </div>
      </form>
    </li>
  );
}

function ReadOnlyContact({ contact }: { contact: ContactRecord }) {
  return (
    <li className="py-3 text-sm">
      <div className="font-medium">
        {contact.name}
        {contact.role && <span className="ml-2 font-normal text-muted-foreground">{contact.role}</span>}
      </div>
      {(contact.email || contact.phone) && (
        <div className="text-muted-foreground">{[contact.email, contact.phone].filter(Boolean).join(" · ")}</div>
      )}
    </li>
  );
}

export default function ContactsSection({ customerId, canEdit, contacts }: Props) {
  // Collapsed state is only a display matter; the card stays visible so contacts are findable.
  const [showAdd, setShowAdd] = useState(false);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Kontakte</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {contacts.length === 0 ? (
          <p className="text-sm text-muted-foreground py-1">Keine weiteren Kontakte vorhanden.</p>
        ) : (
          <ul className="divide-y divide-border">
            {contacts.map((c) =>
              canEdit ? (
                <EditableContact key={c.contactId} customerId={customerId} contact={c} />
              ) : (
                <ReadOnlyContact key={c.contactId} contact={c} />
              )
            )}
          </ul>
        )}
        {canEdit &&
          (showAdd ? (
            <NewContactForm customerId={customerId} />
          ) : (
            <Button variant="outline" size="sm" onClick={() => setShowAdd(true)}>
              Kontakt hinzufügen
            </Button>
          ))}
      </CardContent>
    </Card>
  );
}
