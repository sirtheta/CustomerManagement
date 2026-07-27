"use client";

import { useEffect, useRef } from "react";
import { toast } from "sonner";

export type ActionState = {
  success?: boolean;
  error?: string;
  _ts?: number; // timestamp so repeated saves still trigger the effect
};

export function useActionToast(
  state: ActionState | undefined,
  successMessage = "Gespeichert"
) {
  const prevTs = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (!state) return;
    if (state._ts === prevTs.current) return;
    prevTs.current = state._ts;

    if (state.success) toast.success(successMessage);
    else if (state.error) toast.error(state.error);
  }, [state, successMessage]);
}
