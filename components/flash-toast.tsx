"use client";

import { useEffect } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";

/** Messages a server action can ask for through `?flash=<key>` after its redirect (keys only, no free text). */
const FLASH_MESSAGES: Record<string, string> = {
  "customer-created": "Kunde angelegt",
  "service-created": "Leistung angelegt",
  "service-updated": "Leistung gespeichert",
};

/** Shows the toast named in `?flash=` once and removes the parameter from the URL. */
export function FlashToast() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const flash = params.get("flash");

  useEffect(() => {
    if (!flash) return;
    const message = FLASH_MESSAGES[flash];
    if (message) toast.success(message, { id: flash });
    const next = new URLSearchParams(params.toString());
    next.delete("flash");
    const query = next.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }, [flash, params, pathname, router]);

  return null;
}
