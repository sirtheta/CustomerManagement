export type ActionState = {
  success?: boolean;
  error?: string;
  _ts?: number; // kept for callers that reset their form on success; the toast no longer needs it
};

export type ActionToast = { kind: "success" | "error"; message: string };

export type ActionToastOptions = {
  /** false when the caller already renders `state.error` inline next to the form. */
  toastErrors?: boolean;
};

/**
 * Decides which toast a new action state needs. useActionState hands out a new object per
 * action result and the same object on re-renders, so identity tells new results apart —
 * also errors returned without `_ts`, which a `_ts` comparison silently skipped.
 */
export function actionToastFor(
  state: ActionState | undefined,
  prev: ActionState | undefined,
  successMessage: string,
  { toastErrors = true }: ActionToastOptions = {}
): ActionToast | null {
  if (!state || state === prev) return null;
  if (state.success) return { kind: "success", message: successMessage };
  if (state.error && toastErrors) return { kind: "error", message: state.error };
  return null;
}
