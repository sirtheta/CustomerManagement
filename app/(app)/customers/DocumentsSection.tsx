"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  uploadDocument,
  deleteDocument,
  updateDocumentNote,
} from "./document-actions";
import { useActionToast } from "@/hooks/use-action-toast";
import { cn } from "@/lib/utils";

type DocumentRecord = {
  documentId: number;
  name: string;
  fileType: string;
  uploadDate: Date;
  note: string | null;
};

type Props = {
  customerId: number;
  documents: DocumentRecord[];
};

function fileLabel(ext: string): { label: string; color: string } {
  switch (ext) {
    case ".pdf":  return { label: "PDF",  color: "text-red-500" };
    case ".jpg":
    case ".jpeg":
    case ".png":
    case ".gif":
    case ".bmp":  return { label: "IMG",  color: "text-blue-500" };
    case ".docx": return { label: "DOC",  color: "text-green-600" };
    case ".txt":
    case ".md":   return { label: "TXT",  color: "text-gray-500" };
    case ".xlsx": return { label: "XLS",  color: "text-emerald-600" };
    case ".pptx": return { label: "PPT",  color: "text-orange-500" };
    case ".zip":
    case ".rar":
    case ".7z":   return { label: "ZIP",  color: "text-yellow-600" };
    default:      return { label: "FILE", color: "text-muted-foreground" };
  }
}

const ACCEPTED = ".pdf,.jpg,.jpeg,.png,.gif,.bmp,.docx,.txt,.md,.xlsx,.pptx,.zip,.rar,.7z";

function UploadForm({ customerId }: { customerId: number }) {
  const [formState, formAction, isPendingForm] = useActionState(
    uploadDocument.bind(null, customerId),
    {}
  );
  const [isPending, startTransition] = useTransition();
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const prevTs = useRef<number | undefined>(undefined);

  useActionToast(formState, "Dokument hochgeladen");

  useEffect(() => {
    if (formState.success && formState._ts !== prevTs.current) {
      prevTs.current = formState._ts;
      if (inputRef.current) inputRef.current.value = "";
    }
  }, [formState]);

  const isLoading = isPendingForm || isPending;

  function onDragOver(e: React.DragEvent) {
    e.preventDefault();
    setIsDragging(true);
  }

  function onDragLeave(e: React.DragEvent) {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setIsDragging(false);
    }
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setIsDragging(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length === 0) return;

    startTransition(async () => {
      for (const file of files) {
        const fd = new FormData();
        fd.append("file", file);
        const result = await uploadDocument(customerId, {}, fd);
        if (result.success) toast.success(`"${file.name}" hochgeladen`);
        else if (result.error) toast.error(result.error);
      }
    });
  }

  return (
    <div
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className={cn(
        "rounded-lg border-2 border-dashed p-3 transition-colors",
        isDragging ? "border-primary bg-primary/5" : "border-border"
      )}
    >
      <form action={formAction} className="flex items-center gap-2">
        <Input
          ref={inputRef}
          name="file"
          type="file"
          accept={ACCEPTED}
          className="cursor-pointer flex-1"
          disabled={isLoading}
        />
        <Button type="submit" variant="outline" size="sm" disabled={isLoading}>
          {isLoading ? "Lädt…" : "Hochladen"}
        </Button>
      </form>
      <p className="text-xs text-muted-foreground mt-1.5 text-center">
        {isDragging ? "Dateien hier ablegen…" : "oder per Drag & Drop ablegen"}
      </p>
    </div>
  );
}

function NoteForm({
  customerId,
  documentId,
  initialNote,
}: {
  customerId: number;
  documentId: number;
  initialNote: string;
}) {
  const [state, formAction, isPending] = useActionState(
    updateDocumentNote.bind(null, customerId, documentId),
    {}
  );
  useActionToast(state, "Notiz gespeichert");

  return (
    <form action={formAction} className="flex gap-1.5 items-end">
      <textarea
        key={initialNote}
        name="note"
        defaultValue={initialNote}
        placeholder="Notiz…"
        rows={2}
        className="flex-1 min-w-0 text-sm rounded-lg border border-input bg-transparent px-2.5 py-1.5 placeholder:text-muted-foreground focus-visible:outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 resize-none dark:bg-input/30"
      />
      <Button type="submit" variant="outline" size="sm" disabled={isPending}>
        {isPending ? "…" : "Speichern"}
      </Button>
    </form>
  );
}

export default function DocumentsSection({ customerId, documents }: Props) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Dokumente</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <UploadForm customerId={customerId} />

        {documents.length === 0 ? (
          <p className="text-sm text-muted-foreground py-1">
            Noch keine Dokumente vorhanden.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {documents.map((doc) => {
              const { label, color } = fileLabel(doc.fileType);
              const date = new Date(doc.uploadDate).toLocaleDateString("de-CH");

              return (
                <li key={doc.documentId} className="py-3 space-y-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className={`text-xs font-bold w-8 shrink-0 ${color}`}>
                      {label}
                    </span>
                    <a
                      href={`/api/documents/${doc.documentId}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex-1 text-sm font-medium hover:underline truncate"
                      title={doc.name}
                    >
                      {doc.name}
                    </a>
                    <span className="text-xs text-muted-foreground shrink-0">
                      {date}
                    </span>
                    <ConfirmDialog
                      title="Dokument löschen"
                      description="Soll dieses Dokument wirklich gelöscht werden?"
                      confirmLabel="Löschen"
                      triggerVariant="ghost"
                      triggerSize="sm"
                      onConfirm={() => deleteDocument(customerId, doc.documentId)}
                    >
                      Löschen
                    </ConfirmDialog>
                  </div>
                  <NoteForm
                    customerId={customerId}
                    documentId={doc.documentId}
                    initialNote={doc.note ?? ""}
                  />
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
