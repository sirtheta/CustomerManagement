"use client";

import { useRouter } from "next/navigation";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type Props = {
  availableYears: number[];
  selectedYear: number;
};

export function YearSelector({ availableYears, selectedYear }: Props) {
  const router = useRouter();

  return (
    <Select
      value={String(selectedYear)}
      onValueChange={(val) => router.push(`/accounting?year=${val}`)}
    >
      <SelectTrigger className="w-28">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {availableYears.map((year) => (
          <SelectItem key={year} value={String(year)}>
            {year}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
