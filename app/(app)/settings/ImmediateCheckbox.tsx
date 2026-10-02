"use client";

import { useOptimistic, useTransition, type ReactNode } from "react";
import { toast } from "sonner";
import { Label } from "@/components/ui/label";
import type { ActionState } from "@/hooks/use-action-toast";

type Props = {
  id: string;
  label: ReactNode;
  description?: ReactNode;
  checked: boolean;
  save: (next: boolean) => Promise<ActionState>;
  successMessage?: string;
  labelClassName?: string;
};

/**
 * A checkbox that is saved the moment it is clicked. It shows the new value at
 * once and falls back to the stored one when the server refuses or fails.
 * It carries no `name`, so it never ends up in a surrounding form's FormData.
 */
export default function ImmediateCheckbox({
  id,
  label,
  description,
  checked,
  save,
  successMessage = "Gespeichert",
  labelClassName = "cursor-pointer font-medium",
}: Props) {
  const [value, setValue] = useOptimistic(checked);
  const [pending, startTransition] = useTransition();

  const onChange = (next: boolean) => {
    startTransition(async () => {
      setValue(next);
      try {
        const result = await save(next);
        if (result.error) toast.error(result.error);
        else toast.success(successMessage);
      } catch {
        toast.error("Speichern fehlgeschlagen.");
      }
    });
  };

  return (
    <div className="flex items-start gap-3">
      <input
        type="checkbox"
        id={id}
        checked={value}
        disabled={pending}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-4 w-4 accent-primary"
      />
      <div>
        <Label htmlFor={id} className={labelClassName}>
          {label}
        </Label>
        {description && <p className="text-xs text-muted-foreground mt-0.5">{description}</p>}
      </div>
    </div>
  );
}
