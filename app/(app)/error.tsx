"use client";

import { useEffect } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function AppError({
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
    <div className="flex flex-col items-center justify-center min-h-[60vh] p-8 space-y-4">
      <div className="text-center space-y-2 max-w-sm">
        <h1 className="text-xl font-semibold">Etwas ist schiefgelaufen</h1>
        <p className="text-muted-foreground text-sm">
          Ein Fehler ist aufgetreten. Bitte versuchen Sie es erneut oder kehren Sie zum Dashboard zurück.
        </p>
        {error.digest && (
          <p className="text-xs text-muted-foreground font-mono">
            Fehler-ID: {error.digest}
          </p>
        )}
      </div>
      <div className="flex gap-2">
        <Button variant="outline" render={<Link href="/dashboard" />}>
          Zum Dashboard
        </Button>
        <Button onClick={reset}>Erneut versuchen</Button>
      </div>
    </div>
  );
}
