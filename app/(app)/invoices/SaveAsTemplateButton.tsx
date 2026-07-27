"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { saveAsTemplate } from "./templates/actions";
import { BookmarkPlus } from "lucide-react";

export default function SaveAsTemplateButton({ invoiceId }: { invoiceId: number }) {
  const [isPending, startTransition] = useTransition();
  const [showInput, setShowInput] = useState(false);
  const [name, setName] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  function handleSave() {
    if (!name.trim()) return;
    startTransition(async () => {
      const result = await saveAsTemplate(invoiceId, name);
      if (result.error) {
        setMessage(result.error);
      } else {
        setMessage("Vorlage gespeichert.");
        setShowInput(false);
        setName("");
        setTimeout(() => setMessage(null), 3000);
      }
    });
  }

  if (!showInput) {
    return (
      <Button variant="outline" size="sm" onClick={() => setShowInput(true)}>
        <BookmarkPlus />
        Als Vorlage speichern
      </Button>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <input
        autoFocus
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && handleSave()}
        placeholder="Vorlagenname…"
        className="h-7 rounded-md border border-input bg-background px-2.5 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/50"
      />
      <Button size="sm" onClick={handleSave} disabled={isPending || !name.trim()}>
        {isPending ? "Speichern…" : "Speichern"}
      </Button>
      <Button variant="ghost" size="sm" onClick={() => { setShowInput(false); setName(""); }}>
        Abbrechen
      </Button>
      {message && <span className="text-xs text-muted-foreground">{message}</span>}
    </div>
  );
}
