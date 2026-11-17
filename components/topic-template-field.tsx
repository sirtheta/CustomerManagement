import type { ComponentProps, ReactNode } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MAX_TOPIC_LENGTH } from "@/lib/document-topic";

type Props = Omit<ComponentProps<typeof Input>, "name" | "maxLength"> & {
  id: string;
  /** Extra sentence after the `{period}` explanation. */
  note?: ReactNode;
};

/** "Thema" input of templates and subscriptions; `{period}` is filled on subscription invoices. */
export function TopicTemplateField({ id, note, placeholder, ...inputProps }: Props) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>Thema</Label>
      <Input
        id={id}
        name="topic"
        maxLength={MAX_TOPIC_LENGTH}
        placeholder={placeholder ?? "z. B. Hosting {period}"}
        {...inputProps}
      />
      <p className="text-xs text-muted-foreground">
        Optional. {"{period}"} wird bei Abo-Rechnungen durch die Periode ersetzt, z. B. «Hosting {"{period}"}» →
        «Hosting 2027», «Q1 2027» oder «November 2026».{note ? <> {note}</> : null}
      </p>
    </div>
  );
}
