import Link from "next/link";
import { ArrowLeft } from "lucide-react";

// Same back link on every page reachable from Einstellungen
export function SettingsBackLink() {
  return (
    <Link
      href="/settings"
      className="inline-flex items-center gap-1.5 py-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
    >
      <ArrowLeft className="size-4 shrink-0" />
      Einstellungen
    </Link>
  );
}
