"use client";

import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export type SenderProfileOption = { id: number; name: string; isActive: boolean };

type Props = {
  profiles: SenderProfileOption[];
  /** Currently saved profile of the document (`null` = company data). */
  value: number | null;
};

const FIRST_PROFILE_LABEL = "Standard (Firmendaten)";

/** Absender choice of an invoice or quote form; renders nothing while no extra profile exists. */
export function SenderProfileSelect({ profiles, value }: Props) {
  if (profiles.length === 0) return null;
  // An inactive profile stays selectable only for the document that already uses it.
  const options = profiles.filter((p) => p.isActive || p.id === value);
  return (
    <div className="space-y-1.5">
      <Label htmlFor="senderProfileId">Absender</Label>
      <Select name="senderProfileId" defaultValue={value?.toString() ?? ""}>
        <SelectTrigger id="senderProfileId" className="w-full sm:w-72">
          <SelectValue>
            {(selected: string | null) =>
              selected ? (profiles.find((p) => p.id.toString() === selected)?.name ?? selected) : FIRST_PROFILE_LABEL
            }
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="">{FIRST_PROFILE_LABEL}</SelectItem>
          {options.map((p) => (
            <SelectItem key={p.id} value={p.id.toString()}>
              {p.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
