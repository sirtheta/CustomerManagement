"use client";

import { createContext, useContext, useState } from "react";

type SendDialogControl = { open: boolean; setOpen: (open: boolean) => void };

const SendDialogContext = createContext<SendDialogControl | null>(null);

/**
 * Shares the open state of the invoice send dialog on the detail page, so other
 * parts of the page (the status confirmation's «Stattdessen senden») can open it.
 */
export function SendDialogProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return <SendDialogContext.Provider value={{ open, setOpen }}>{children}</SendDialogContext.Provider>;
}

/** The shared control inside a `SendDialogProvider`, else null. */
export function useSendDialog(): SendDialogControl | null {
  return useContext(SendDialogContext);
}
