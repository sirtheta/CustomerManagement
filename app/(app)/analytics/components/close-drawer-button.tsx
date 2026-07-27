"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { X } from "lucide-react";

export function CloseDrawerButton({ asBackdrop }: { asBackdrop?: boolean }) {
  const router = useRouter();
  const searchParams = useSearchParams();

  function close() {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("drillMonth");
    params.delete("drillStatus");
    params.delete("drillCustomer");
    params.delete("drillIncomeCategory");
    params.delete("drillExpenseCategory");
    params.delete("drillCombinedCategory");
    const qs = params.toString();
    router.push(qs ? `?${qs}` : window.location.pathname);
  }

  if (asBackdrop) {
    return (
      <div
        className="fixed inset-0 bg-black/30 z-40"
        onClick={close}
        aria-hidden="true"
      />
    );
  }

  return (
    <button
      onClick={close}
      className="p-1.5 rounded-md hover:bg-muted transition-colors"
      aria-label="Schließen"
    >
      <X className="w-5 h-5" />
    </button>
  );
}
