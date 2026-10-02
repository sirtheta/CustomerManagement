"use client";

import { startTransition, type FormEvent } from "react";

/**
 * onSubmit handler for a `<form action={formAction}>` that must keep its input when the action
 * returns an error. React 19 resets uncontrolled fields after every form action, also one that
 * returned `{ error }`. Preventing the default and dispatching in our own transition skips that
 * reset (React then runs no action of its own); callers reset the form themselves on success.
 * Keep `action={formAction}` on the form so a submit before hydration still works.
 */
export function submitKeepingInput(formAction: (payload: FormData) => void) {
  return (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    startTransition(() => formAction(data));
  };
}
