"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { DatePickerInput } from "@/components/ui/date-picker";
import { Button } from "@/components/ui/button";
import { X } from "lucide-react";

export function DateRangeFilter() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const dateFrom = searchParams.get("dateFrom") ?? "";
  const dateTo = searchParams.get("dateTo") ?? "";

  function update(key: "dateFrom" | "dateTo", value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set(key, value);
    else params.delete(key);
    params.delete("page");
    router.replace(pathname + (params.size ? "?" + params.toString() : ""), { scroll: false });
  }

  function clear() {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("dateFrom");
    params.delete("dateTo");
    params.delete("page");
    router.replace(pathname + (params.size ? "?" + params.toString() : ""), { scroll: false });
  }

  const hasFilter = dateFrom || dateTo;

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-sm text-muted-foreground whitespace-nowrap">Zeitraum:</span>
      <DatePickerInput
        value={dateFrom}
        onChange={(v) => update("dateFrom", v)}
        className="w-40"
        aria-label="Von Datum"
      />
      <span className="text-sm text-muted-foreground">–</span>
      <DatePickerInput
        value={dateTo}
        onChange={(v) => update("dateTo", v)}
        className="w-40"
        aria-label="Bis Datum"
      />
      {hasFilter && (
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={clear}
          aria-label="Datumsfilter zurücksetzen"
        >
          <X />
        </Button>
      )}
    </div>
  );
}
