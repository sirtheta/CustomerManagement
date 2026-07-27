"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import ItemsEditor, { type ItemData } from "@/components/items-editor";
import { updateTemplate } from "../actions";
import { useActionToast, type ActionState } from "@/hooks/use-action-toast";
import Link from "next/link";
import type { Service } from "@prisma/client";

type SerializedService = Omit<Service, "unitPrice"> & { unitPrice: number };

type Props = {
  templateId: number;
  name: string;
  initialItems: ItemData[];
  services: SerializedService[];
};

export default function TemplateEditForm({ templateId, name, initialItems, services }: Props) {
  const action = updateTemplate.bind(null, templateId);
  const [state, formAction, isPending] = useActionState<ActionState, FormData>(action, {});
  useActionToast(state, "Vorlage gespeichert");

  return (
    <form action={formAction} className="space-y-4">
      {state?.error && <p className="text-sm text-destructive">{state.error}</p>}

      <Card>
        <CardHeader>
          <CardTitle>Vorlage bearbeiten</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-1.5">
            <Label htmlFor="name">Name</Label>
            <Input id="name" name="name" defaultValue={name} required className="max-w-sm" />
          </div>
        </CardContent>
      </Card>

      <ItemsEditor services={services} initialItems={initialItems} />

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={isPending}>
          {isPending ? "Speichern…" : "Speichern"}
        </Button>
        <Button variant="outline" render={<Link href="/invoices/templates" />}>
          Abbrechen
        </Button>
      </div>
    </form>
  );
}
