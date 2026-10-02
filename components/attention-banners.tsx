import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { AttentionBanner } from "@/lib/attention-counts";

const TONES: Record<AttentionBanner["tone"], { box: string; icon: string; text: string }> = {
  danger: {
    box: "border-red-300 bg-red-50 dark:border-red-800 dark:bg-red-950/30",
    icon: "text-red-600 dark:text-red-400",
    text: "text-red-900 dark:text-red-200",
  },
  warning: {
    box: "border-yellow-300 bg-yellow-50 dark:border-yellow-800 dark:bg-yellow-950/30",
    icon: "text-yellow-600 dark:text-yellow-400",
    text: "text-yellow-900 dark:text-yellow-200",
  },
};

/** Banners from `attentionBanners()`: one statement, one button, one target each. */
export function AttentionBanners({ banners }: { banners: AttentionBanner[] }) {
  if (banners.length === 0) return null;
  return (
    <div className="space-y-2">
      {banners.map((b) => {
        const tone = TONES[b.tone];
        return (
          <div
            key={b.key}
            className={cn("flex items-center justify-between gap-3 rounded-lg border px-4 py-3", tone.box)}
          >
            <div className="flex items-center gap-2.5">
              <AlertTriangle className={cn("size-4 shrink-0", tone.icon)} />
              <p className={cn("text-sm font-medium", tone.text)}>{b.text}</p>
            </div>
            <Button size="sm" variant="outline" className="shrink-0" render={<Link href={b.href} />}>
              {b.action}
            </Button>
          </div>
        );
      })}
    </div>
  );
}
