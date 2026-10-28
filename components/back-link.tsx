import Link from "next/link";
import { ArrowLeft } from "lucide-react";

// Back link for pages reached from an overview page (same look everywhere)
export function BackLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-1.5 py-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
    >
      <ArrowLeft className="size-4 shrink-0" />
      {children}
    </Link>
  );
}
