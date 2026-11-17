import { cn } from "@/lib/utils";

/**
 * The topic ("Thema") of an invoice or quote under its number: a muted line
 * in tables, a normal one on phone cards. Renders nothing without a topic.
 */
export function DocumentTopic({
  topic,
  variant = "table",
  className,
}: {
  topic: string | null | undefined;
  variant?: "table" | "card";
  className?: string;
}) {
  if (!topic) return null;
  return variant === "card" ? (
    <p className={cn("mt-0.5 truncate text-sm", className)}>{topic}</p>
  ) : (
    <div className={cn("max-w-64 truncate text-xs font-normal text-muted-foreground", className)} title={topic}>
      {topic}
    </div>
  );
}
