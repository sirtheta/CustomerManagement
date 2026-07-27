"use client";

import { useActionState, useEffect, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { createNote, deleteNote, updateNote } from "./note-actions";
import { useActionToast } from "@/hooks/use-action-toast";

type NoteRecord = {
  noteId: number;
  title: string;
  content: string;
  updatedAt: Date;
};

type Props = {
  customerId: number;
  notes: NoteRecord[];
};

const textareaClass =
  "w-full text-sm rounded-lg border border-input bg-transparent px-2.5 py-1.5 placeholder:text-muted-foreground focus-visible:outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 resize-y overflow-hidden dark:bg-input/30";

function autoGrow(el: HTMLTextAreaElement) {
  el.style.height = "auto";
  el.style.height = `${el.scrollHeight}px`;
}

function downloadAsTxt(title: string, content: string) {
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${title || "Notiz"}.txt`;
  a.click();
  URL.revokeObjectURL(url);
}

function NewNoteForm({ customerId }: { customerId: number }) {
  const [state, formAction, isPending] = useActionState(
    createNote.bind(null, customerId),
    {}
  );
  const formRef = useRef<HTMLFormElement>(null);
  const contentRef = useRef<HTMLTextAreaElement>(null);
  const prevTs = useRef<number | undefined>(undefined);

  useActionToast(state, "Notiz erstellt");

  useEffect(() => {
    if (state.success && state._ts !== prevTs.current) {
      prevTs.current = state._ts;
      formRef.current?.reset();
      if (contentRef.current) contentRef.current.style.height = "auto";
    }
  }, [state]);

  return (
    <form ref={formRef} action={formAction} className="space-y-2">
      <Input name="title" placeholder="Titel (z.B. Zugangsdaten Server)" disabled={isPending} />
      <textarea
        ref={contentRef}
        name="content"
        placeholder="Notiz…"
        rows={3}
        className={textareaClass}
        disabled={isPending}
        onInput={(e) => autoGrow(e.currentTarget)}
      />
      <Button type="submit" variant="outline" size="sm" disabled={isPending}>
        {isPending ? "Speichert…" : "Notiz erstellen"}
      </Button>
    </form>
  );
}

function NoteItem({
  customerId,
  note,
}: {
  customerId: number;
  note: NoteRecord;
}) {
  const [state, formAction, isPending] = useActionState(
    updateNote.bind(null, customerId, note.noteId),
    {}
  );
  useActionToast(state, "Notiz gespeichert");

  const titleRef = useRef<HTMLInputElement>(null);
  const contentRef = useRef<HTMLTextAreaElement>(null);
  const date = new Date(note.updatedAt).toLocaleDateString("de-CH");

  useEffect(() => {
    if (contentRef.current) autoGrow(contentRef.current);
  }, []);

  return (
    <li className="py-3 space-y-2">
      <form action={formAction} className="space-y-2">
        <div className="flex items-center gap-2 min-w-0">
          <Input
            ref={titleRef}
            name="title"
            defaultValue={note.title}
            className="flex-1 min-w-0"
            disabled={isPending}
          />
          <span className="text-xs text-muted-foreground shrink-0">{date}</span>
        </div>
        <textarea
          ref={contentRef}
          name="content"
          defaultValue={note.content}
          rows={2}
          className={textareaClass}
          disabled={isPending}
          onInput={(e) => autoGrow(e.currentTarget)}
        />
        <div className="flex items-center gap-1.5">
          <Button type="submit" variant="outline" size="sm" disabled={isPending}>
            {isPending ? "…" : "Speichern"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => downloadAsTxt(note.title, note.content)}
          >
            Als TXT herunterladen
          </Button>
          <ConfirmDialog
            title="Notiz löschen"
            description="Soll diese Notiz wirklich gelöscht werden?"
            confirmLabel="Löschen"
            triggerVariant="ghost"
            triggerSize="sm"
            onConfirm={() => deleteNote(customerId, note.noteId)}
          >
            Löschen
          </ConfirmDialog>
        </div>
      </form>
    </li>
  );
}

export default function NotesSection({ customerId, notes }: Props) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Notizen</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <NewNoteForm customerId={customerId} />

        {notes.length === 0 ? (
          <p className="text-sm text-muted-foreground py-1">
            Noch keine Notizen vorhanden.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {notes.map((note) => (
              <NoteItem key={note.noteId} customerId={customerId} note={note} />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
