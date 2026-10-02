"use client";

import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { actionToastFor, type ActionState, type ActionToastOptions } from "@/lib/action-toast";

export type { ActionState } from "@/lib/action-toast";

export function useActionToast(
  state: ActionState | undefined,
  successMessage = "Gespeichert",
  options?: ActionToastOptions
) {
  // The ref survives Strict Mode's effect re-run, so the same state is never toasted twice.
  const prevState = useRef<ActionState | undefined>(undefined);
  const toastErrors = options?.toastErrors ?? true;

  useEffect(() => {
    const next = actionToastFor(state, prevState.current, successMessage, { toastErrors });
    prevState.current = state;
    if (next?.kind === "success") toast.success(next.message);
    else if (next?.kind === "error") toast.error(next.message);
  }, [state, successMessage, toastErrors]);
}
