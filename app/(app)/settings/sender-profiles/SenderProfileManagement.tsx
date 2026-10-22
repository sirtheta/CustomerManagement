"use client";

import { useActionState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Trash2 } from "lucide-react";
import { useActionToast } from "@/hooks/use-action-toast";
import {
  createSenderProfile,
  deleteSenderProfile,
  updateSenderProfile,
  type SenderProfileFormState,
} from "./actions";

export type SenderProfileRow = {
  id: number;
  name: string;
  companyName: string | null;
  companyHolderName: string | null;
  companyEmail: string | null;
  companyPhone: string | null;
  hasLogo: boolean;
  isActive: boolean;
  updatedAt: number;
  usageCount: number;
};

const LOGO_ACCEPT = "image/png,image/jpeg,image/jpg,image/bmp,image/webp";

function Field({
  id,
  label,
  name,
  defaultValue,
  placeholder,
  required,
}: {
  id: string;
  label: string;
  name: string;
  defaultValue?: string | null;
  placeholder?: string;
  required?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} name={name} defaultValue={defaultValue ?? ""} placeholder={placeholder} required={required} />
    </div>
  );
}

function CreateForm() {
  const [state, formAction, isPending] = useActionState<SenderProfileFormState, FormData>(createSenderProfile, {});
  useActionToast(state, "Profil angelegt", { toastErrors: false });

  return (
    <form action={formAction} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="new-name" label="Bezeichnung" name="name" required placeholder="z.B. Erika" />
        <Field id="new-companyName" label="Firmenname" name="companyName" placeholder="leer = wie Firmendaten" />
        <Field id="new-holder" label="Inhaber/in" name="companyHolderName" placeholder="leer = wie Firmendaten" />
        <Field id="new-email" label="E-Mail" name="companyEmail" placeholder="leer = wie Firmendaten" />
        <Field id="new-phone" label="Telefon" name="companyPhone" placeholder="leer = wie Firmendaten" />
        <div className="space-y-1.5">
          <Label htmlFor="new-logo">Logo (PNG, JPG, BMP, WebP – max. 2 MB)</Label>
          <Input id="new-logo" name="logo" type="file" accept={LOGO_ACCEPT} className="cursor-pointer" />
        </div>
      </div>
      <Button type="submit" disabled={isPending}>
        {isPending ? "Anlegen…" : "Profil anlegen"}
      </Button>
      {state.error && <p className="text-sm text-destructive">{state.error}</p>}
    </form>
  );
}

function ProfileCard({ profile }: { profile: SenderProfileRow }) {
  const [state, formAction, isPending] = useActionState<SenderProfileFormState, FormData>(
    updateSenderProfile.bind(null, profile.id),
    {}
  );
  useActionToast(state, "Profil gespeichert", { toastErrors: false });
  const fieldId = (key: string) => `profile-${profile.id}-${key}`;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          {profile.name}
          {!profile.isActive && <Badge variant="outline">Inaktiv</Badge>}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <form action={formAction} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id={fieldId("name")} label="Bezeichnung" name="name" required defaultValue={profile.name} />
            <Field id={fieldId("companyName")} label="Firmenname" name="companyName" defaultValue={profile.companyName} placeholder="leer = wie Firmendaten" />
            <Field id={fieldId("holder")} label="Inhaber/in" name="companyHolderName" defaultValue={profile.companyHolderName} placeholder="leer = wie Firmendaten" />
            <Field id={fieldId("email")} label="E-Mail" name="companyEmail" defaultValue={profile.companyEmail} placeholder="leer = wie Firmendaten" />
            <Field id={fieldId("phone")} label="Telefon" name="companyPhone" defaultValue={profile.companyPhone} placeholder="leer = wie Firmendaten" />
            <div className="space-y-1.5">
              <Label htmlFor={fieldId("logo")}>{profile.hasLogo ? "Logo ersetzen" : "Logo hochladen"}</Label>
              <Input id={fieldId("logo")} name="logo" type="file" accept={LOGO_ACCEPT} className="cursor-pointer" />
            </div>
          </div>

          {profile.hasLogo && (
            <div className="flex items-center gap-4">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`/api/settings/sender-profiles/${profile.id}/logo?v=${profile.updatedAt}`}
                alt={`Logo ${profile.name}`}
                className="max-h-20 object-contain border rounded p-2 bg-white"
              />
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input type="checkbox" name="removeLogo" className="h-4 w-4 rounded border-input accent-primary" />
                Logo entfernen (dann gilt das Firmenlogo)
              </label>
            </div>
          )}

          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              name="isActive"
              defaultChecked={profile.isActive}
              className="h-4 w-4 rounded border-input accent-primary"
            />
            Aktiv (bei neuen Dokumenten wählbar)
          </label>

          <div className="flex items-center gap-3 flex-wrap">
            <Button type="submit" variant="outline" size="sm" disabled={isPending}>
              {isPending ? "Speichern…" : "Speichern"}
            </Button>
            {state.error && <p className="text-sm text-destructive">{state.error}</p>}
          </div>
        </form>

        <div className="text-xs text-muted-foreground">
          {profile.usageCount > 0 ? (
            <span>Wird in {profile.usageCount} Dokument(en) verwendet und kann nicht gelöscht werden.</span>
          ) : (
            <ConfirmDialog
              title="Profil löschen"
              description={`Soll das Profil «${profile.name}» wirklich gelöscht werden? Es wird nirgends verwendet.`}
              confirmLabel="Löschen"
              triggerVariant="ghost"
              triggerSize="sm"
              triggerClassName="text-destructive hover:text-destructive hover:bg-destructive/10"
              onConfirm={() => deleteSenderProfile(profile.id)}
            >
              <Trash2 /> Löschen
            </ConfirmDialog>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export function SenderProfileManagement({ profiles }: { profiles: SenderProfileRow[] }) {
  return (
    <div className="space-y-6 max-w-3xl">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Neues Profil</CardTitle>
        </CardHeader>
        <CardContent>
          <CreateForm />
        </CardContent>
      </Card>
      {profiles.map((profile) => (
        <ProfileCard key={profile.id} profile={profile} />
      ))}
    </div>
  );
}
