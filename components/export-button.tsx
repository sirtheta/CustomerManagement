"use client";

import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";

export function ExportButton({ href }: { href: string }) {
  return (
    <Button
      variant="outline"
      size="sm"
      render={<a href={href} download />}
    >
      <Download />
      CSV
    </Button>
  );
}
