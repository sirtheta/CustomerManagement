import Link from "next/link";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

/**
 * Mobile list card whose whole surface opens the detail page.
 *
 * Pattern: the primary link inside the card is a `CardLink` (stretched link: its
 * ::after covers the `relative` card). It stays a real `<a>`, so middle click,
 * "open in new tab" and keyboard/screen readers keep working. Any other link or
 * button inside the card must sit above the overlay: use `cardInteractiveClass`.
 *
 * `isolate` keeps that z-10 inside the card; without it the lifted elements would
 * paint over the sticky app header while scrolling. The tap highlight is driven by
 * the card link only, so tapping a lifted button does not flash the card.
 */
export function ListCard({ className, ...props }: ComponentProps<"li">) {
  return (
    <li
      className={cn(
        "relative isolate rounded-lg border p-3 transition-colors has-[[data-card-link]:active]:bg-muted/60",
        className,
      )}
      {...props}
    />
  );
}

/**
 * Borderless variant for compact lists inside an existing Card (dashboard): same
 * stretched-link pattern. The tap highlight is a pseudo-element bleeding 0.5rem past
 * the content edge, so the li box (and the divide-y lines of the list) keep their shape.
 */
export function ListRow({ className, ...props }: ComponentProps<"li">) {
  return (
    <li
      className={cn(
        "relative isolate before:absolute before:inset-y-0 before:-inset-x-2 before:-z-10 before:rounded-lg before:transition-colors has-[[data-card-link]:active]:before:bg-muted/60",
        className,
      )}
      {...props}
    />
  );
}

export function CardLink({ className, ...props }: ComponentProps<typeof Link>) {
  return (
    <Link
      data-card-link=""
      className={cn(
        "after:absolute after:inset-0 after:rounded-lg focus-visible:outline-hidden focus-visible:after:ring-2 focus-visible:after:ring-ring/60",
        className,
      )}
      {...props}
    />
  );
}

/** For links/buttons inside a ListCard that must keep their own target. */
export const cardInteractiveClass = "relative z-10";
