import { BackLink } from "@/components/back-link";

// Same back link on every page reachable from Einstellungen
export function SettingsBackLink() {
  return <BackLink href="/settings">Einstellungen</BackLink>;
}
