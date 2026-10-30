"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  SALUTATION_KINDS,
  SALUTATION_KINDS_NEEDING_TITLE,
  SALUTATION_LABELS,
  SALUTATION_TEXT_MAX,
  TITLE_VALUES,
  buildSalutation,
  isSalutationKind,
  type SalutationKind,
} from "@/lib/salutation";

type Props = {
  title: string;
  salutationKind: string;
  salutationText: string;
  contactPerson: string;
  fieldErrors: Record<string, string>;
};

const NO_TITLE = "none";

/** Anrede (Herr/Frau) and Briefanrede (preset or free text) of a customer; the form action reads the named fields. */
export default function SalutationFields({ title, salutationKind, salutationText, contactPerson, fieldErrors }: Props) {
  const [titleValue, setTitleValue] = useState(title || NO_TITLE);
  const [kind, setKind] = useState<SalutationKind>(isSalutationKind(salutationKind) ? salutationKind : "hello");
  const [text, setText] = useState(salutationText);

  const preview = buildSalutation({
    contactPerson: contactPerson || "Max Muster",
    title: titleValue === NO_TITLE ? null : titleValue,
    salutationKind: kind,
    salutationText: text,
  });
  const needsTitle = SALUTATION_KINDS_NEEDING_TITLE.includes(kind) && titleValue === NO_TITLE;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
      <div className="space-y-1.5">
        <Label htmlFor="title">Anrede</Label>
        <Select name="title" value={titleValue} onValueChange={(v) => setTitleValue(v ?? NO_TITLE)}>
          <SelectTrigger id="title" className="w-full">
            <SelectValue>{(value: string | null) => (value && value !== NO_TITLE ? value : "–")}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NO_TITLE}>–</SelectItem>
            {TITLE_VALUES.map((t) => (
              <SelectItem key={t} value={t}>
                {t}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5 sm:col-span-2">
        <Label htmlFor="salutationKind">Briefanrede</Label>
        <Select name="salutationKind" value={kind} onValueChange={(v) => setKind(isSalutationKind(v) ? v : "hello")}>
          <SelectTrigger id="salutationKind" className="w-full">
            <SelectValue>{(value: string | null) => (isSalutationKind(value) ? SALUTATION_LABELS[value] : "")}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {SALUTATION_KINDS.map((k) => (
              <SelectItem key={k} value={k}>
                {SALUTATION_LABELS[k]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {kind !== "custom" && text && <input type="hidden" name="salutationText" value={text} />}

      {kind === "custom" && (
        <div className="space-y-1.5 sm:col-span-3">
          <Label htmlFor="salutationText">Eigene Briefanrede</Label>
          <Input
            id="salutationText"
            name="salutationText"
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={SALUTATION_TEXT_MAX}
            placeholder="Sehr geehrte Frau Dr. Muster"
            aria-invalid={!!fieldErrors.salutationText}
            aria-describedby={fieldErrors.salutationText ? "salutationText-error" : undefined}
          />
          {fieldErrors.salutationText && (
            <p id="salutationText-error" className="text-xs text-destructive mt-1" role="alert">
              {fieldErrors.salutationText}
            </p>
          )}
        </div>
      )}

      <p className="text-xs text-muted-foreground sm:col-span-3" aria-live="polite">
        Vorschau in Mails: «{preview}»
        {needsTitle && " – ohne Anrede (Herr/Frau) wird «Guten Tag …» verwendet."}
      </p>
    </div>
  );
}
