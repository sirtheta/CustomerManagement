import Link from "next/link";
import { ChevronUp, ChevronDown, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";

type Props = {
  href: string;
  active: boolean;
  direction: "asc" | "desc";
  children: React.ReactNode;
  className?: string;
};

export function SortableColumn({ href, active, direction, children, className }: Props) {
  return (
    <Link
      href={href}
      className={cn(
        "inline-flex items-center gap-1 hover:text-foreground transition-colors",
        active ? "text-foreground" : "text-muted-foreground",
        className
      )}
    >
      {children}
      {active ? (
        direction === "asc" ? (
          <ChevronUp className="size-3.5" />
        ) : (
          <ChevronDown className="size-3.5" />
        )
      ) : (
        <ChevronsUpDown className="size-3.5 opacity-50" />
      )}
    </Link>
  );
}
