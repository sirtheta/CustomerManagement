"use client";

import { useActionState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { uploadLogo, removeLogo } from "./actions";
import { useActionToast } from "@/hooks/use-action-toast";

type Props = { hasLogo: boolean };

export default function LogoCard({ hasLogo }: Props) {
  const [uploadState, uploadAction, uploadPending] = useActionState(uploadLogo, {});
  const [removePending, startRemove] = useTransition();
  useActionToast(uploadState, "Logo hochgeladen");

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Firmenlogo</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {hasLogo && (
          <div className="flex items-center gap-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/api/settings/logo"
              alt="Firmenlogo"
              className="max-h-20 object-contain border rounded p-2 bg-white"
            />
            <Button
              type="button"
              variant="destructive"
              size="sm"
              disabled={removePending}
              onClick={() => startRemove(async () => { await removeLogo(); })}
            >
              {removePending ? "Entfernen…" : "Logo entfernen"}
            </Button>
          </div>
        )}

        {/* Upload — eigene separate form, NICHT verschachtelt */}
        <form action={uploadAction} className="space-y-2">
          <Label htmlFor="logo-upload">
            {hasLogo ? "Logo ersetzen" : "Logo hochladen"} (PNG, JPG, BMP — max. 2 MB)
          </Label>
          <div className="flex items-center gap-2">
            <Input
              id="logo-upload"
              name="logo"
              type="file"
              accept="image/png,image/jpeg,image/jpg,image/bmp,image/webp"
              className="cursor-pointer flex-1"
            />
            <Button type="submit" variant="outline" size="sm" disabled={uploadPending}>
              {uploadPending ? "Lädt…" : "Hochladen"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
