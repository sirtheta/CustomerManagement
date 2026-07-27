"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-svh items-center justify-center p-8">
      <div className="text-center space-y-4 max-w-sm">
        <h1 className="text-2xl font-semibold">Fehler aufgetreten</h1>
        <p className="text-muted-foreground text-sm">
          Ein unerwarteter Fehler ist aufgetreten. Bitte versuchen Sie es erneut.
        </p>
        {error.digest && (
          <p className="text-xs text-muted-foreground font-mono">
            Fehler-ID: {error.digest}
          </p>
        )}
        <Button onClick={reset}>Erneut versuchen</Button>
      </div>
    </div>
  );
}
