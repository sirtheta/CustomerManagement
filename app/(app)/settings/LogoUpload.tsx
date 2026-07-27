"use client";

import { useActionState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { uploadLogo } from "./actions";
import { useActionToast } from "@/hooks/use-action-toast";

type Props = {
  hasLogo: boolean;
};

export default function LogoUpload({ hasLogo }: Props) {
  const [state, formAction, isPending] = useActionState(uploadLogo, {});
  const inputRef = useRef<HTMLInputElement>(null);
  useActionToast(state, "Logo hochgeladen");

  return (
    <form action={formAction} className="space-y-2">
      <Label htmlFor="logo-upload">
        {hasLogo ? "Logo ersetzen" : "Logo hochladen"} (PNG, JPG — max. 2 MB)
      </Label>
      <div className="flex items-center gap-2">
        <Input
          ref={inputRef}
          id="logo-upload"
          name="logo"
          type="file"
          accept="image/png,image/jpeg,image/jpg,image/bmp,image/webp"
          className="cursor-pointer flex-1"
        />
        <Button type="submit" variant="outline" size="sm" disabled={isPending}>
          {isPending ? "Lädt…" : "Hochladen"}
        </Button>
      </div>
    </form>
  );
}
