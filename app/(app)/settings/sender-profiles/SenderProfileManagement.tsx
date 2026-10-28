"use client";

import { useActionState, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import Link from "next/link";
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

/** The company data from Einstellungen: the first profile, shown read-only for reference. */
export type FirstProfile = {
  companyName: string | null;
  companyHolderName: string | null;
  companyEmail: string | null;
  companyPhone: string | null;
  hasLogo: boolean;
};

// Empty fields fall back to the company data; showing the actual value makes that visible.
function fallbackHint(value: string | null) {
  return value ? `leer = ${value}` : "leer = wie Firmendaten";
}

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

function CreateForm({ first, onCreated }: { first: FirstProfile; onCreated: () => void }) {
  const [state, formAction, isPending] = useActionState<SenderProfileFormState, FormData>(
    async (prev, formData) => {
      const result = await createSenderProfile(prev, formData);
      if (result.success) onCreated();
      return result;
    },
    {}
  );
  useActionToast(state, "Profil angelegt", { toastErrors: false });

  return (
    <form action={formAction} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="new-name" label="Bezeichnung" name="name" required placeholder="z.B. Erika" />
        <Field id="new-companyName" label="Firmenname" name="companyName" placeholder={fallbackHint(first.companyName)} />
        <Field id="new-holder" label="Inhaber/in" name="companyHolderName" placeholder={fallbackHint(first.companyHolderName)} />
        <Field id="new-email" label="E-Mail" name="companyEmail" placeholder={fallbackHint(first.companyEmail)} />
        <Field id="new-phone" label="Telefon" name="companyPhone" placeholder={fallbackHint(first.companyPhone)} />
        <div className="space-y-1.5">
          <Label htmlFor="new-logo">Logo (leer = Firmenlogo; PNG, JPG, BMP, WebP – max. 2 MB)</Label>
          <Input id="new-logo" name="logo" type="file" accept={LOGO_ACCEPT} className="cursor-pointer" />
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Button type="submit" disabled={isPending}>
          {isPending ? "Anlegen…" : "Profil anlegen"}
        </Button>
        <Button type="button" variant="ghost" onClick={onCreated}>
          Abbrechen
        </Button>
      </div>
      {state.error && <p className="text-sm text-destructive">{state.error}</p>}
    </form>
  );
}

function ProfileCard({ profile, first }: { profile: SenderProfileRow; first: FirstProfile }) {
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
            <Field id={fieldId("companyName")} label="Firmenname" name="companyName" defaultValue={profile.companyName} placeholder={fallbackHint(first.companyName)} />
            <Field id={fieldId("holder")} label="Inhaber/in" name="companyHolderName" defaultValue={profile.companyHolderName} placeholder={fallbackHint(first.companyHolderName)} />
            <Field id={fieldId("email")} label="E-Mail" name="companyEmail" defaultValue={profile.companyEmail} placeholder={fallbackHint(first.companyEmail)} />
            <Field id={fieldId("phone")} label="Telefon" name="companyPhone" defaultValue={profile.companyPhone} placeholder={fallbackHint(first.companyPhone)} />
            <div className="space-y-1.5">
              <Label htmlFor={fieldId("logo")}>{profile.hasLogo ? "Logo ersetzen" : "Logo hochladen"}</Label>
              <Input id={fieldId("logo")} name="logo" type="file" accept={LOGO_ACCEPT} className="cursor-pointer" />
            </div>
          </div>

          {!profile.hasLogo && (
            <p className="text-sm text-muted-foreground">Kein eigenes Logo: Es gilt das Firmenlogo.</p>
          )}
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
            <span>
              Wird in {profile.usageCount} Dokument(en) verwendet und kann nicht gelöscht werden. Änderungen gelten
              auch für Entwürfe und Offerten damit.
            </span>
          ) : (
            <ConfirmDialog
              title="Profil löschen"
              description={`Soll das Profil «${profile.name}» wirklich gelöscht werden? Es wird nirgends verwendet.`}
              confirmLabel="Löschen"
              triggerVariant="ghost"
              triggerSize="sm"
              triggerClassName="text-destructive hover:text-destructive hover:bg-destructive/10"
              onConfirm={async () => {
                const result = await deleteSenderProfile(profile.id);
                if (!result.error) toast.success("Profil gelöscht");
                return result;
              }}
            >
              <Trash2 /> Löschen
            </ConfirmDialog>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function FirstProfileCard({ first }: { first: FirstProfile }) {
  const lines = [first.companyName, first.companyHolderName, first.companyEmail, first.companyPhone].filter(Boolean);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          Profil 1: Firmendaten
          <Badge variant="outline">Standard</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center gap-4">
          {first.hasLogo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src="/api/settings/logo"
              alt="Firmenlogo"
              className="max-h-20 object-contain border rounded p-2 bg-white"
            />
          ) : (
            <p className="text-sm text-muted-foreground">Kein Firmenlogo hinterlegt.</p>
          )}
          <p className="text-sm">{lines.length > 0 ? lines.join(" · ") : "Noch keine Firmendaten erfasst."}</p>
        </div>
        <p className="text-xs text-muted-foreground">
          Gilt, wenn bei einem Dokument kein anderer Absender gewählt ist. Name, Kontaktdaten und Logo änderst du in den{" "}
          <Link href="/settings" className="underline">
            Einstellungen
          </Link>
          ; Adresse und IBAN gelten für alle Profile.
        </p>
      </CardContent>
    </Card>
  );
}

export function SenderProfileManagement({ first, profiles }: { first: FirstProfile; profiles: SenderProfileRow[] }) {
  const [creating, setCreating] = useState(false);
  return (
    <div className="space-y-6 max-w-3xl">
      <FirstProfileCard first={first} />
      {profiles.map((profile) => (
        <ProfileCard key={profile.id} profile={profile} first={first} />
      ))}
      {/* Below the list: a new profile then shows up right above this button, and the form closes. */}
      {creating ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Neues Profil</CardTitle>
          </CardHeader>
          <CardContent>
            <CreateForm first={first} onCreated={() => setCreating(false)} />
          </CardContent>
        </Card>
      ) : (
        <Button variant="outline" onClick={() => setCreating(true)}>
          Weiteres Profil anlegen
        </Button>
      )}
    </div>
  );
}
