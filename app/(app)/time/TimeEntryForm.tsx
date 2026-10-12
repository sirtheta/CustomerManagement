"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import type { Customer, Unit } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CustomerCombobox } from "@/components/customer-combobox";
import { actionToastFor } from "@/lib/action-toast";
import { submitKeepingInput } from "@/hooks/submit-keeping-input";
import { cn } from "@/lib/utils";
import { MaterialPicker, FREE_TEXT, type MaterialOption } from "./MaterialPicker";
import { QUICK_AMOUNTS, UNIT_LABELS, formatQuantity, parseQuantity } from "@/lib/work-entries";
import { createWorkEntry, deleteWorkEntry, type WorkEntryState } from "./actions";

type ServiceOption = { id: number; name: string; unit: Unit };
type Props = {
  customers: Customer[];
  customerId: number | null;
  timeServices: ServiceOption[];
  materialServices: MaterialOption[];
  recentMaterialIds: number[];
  defaultTimeServiceId: number | null;
  today: string; // YYYY-MM-DD
};

function shiftDay(day: string, delta: number): string {
  const d = new Date(`${day}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}
const roundTo2 = (n: number) => Math.round(n * 100) / 100;

export default function TimeEntryForm({
  customers,
  customerId,
  timeServices,
  materialServices,
  recentMaterialIds,
  defaultTimeServiceId,
  today,
}: Props) {
  const router = useRouter();
  // The picker is uncontrolled, so what it shows is kept here: the prop only changes after the
  // server round trip of router.replace, and a quick save must book on the customer shown.
  const [pickedCustomerId, setPickedCustomerId] = useState<number | null>(customerId);
  const [isNavigating, startNavigation] = useTransition();
  const [state, formAction, isPending] = useActionState<WorkEntryState, FormData>(createWorkEntry, {});
  const prevState = useRef<WorkEntryState | undefined>(undefined);

  const [mode, setMode] = useState<"time" | "material">("time");
  const [date, setDate] = useState(today);
  const [quantity, setQuantity] = useState("");
  const [note, setNote] = useState("");
  const [freeName, setFreeName] = useState("");
  const [freeUnit, setFreeUnit] = useState<"Piece" | "Package">("Piece");

  const onlyTimeService = timeServices.length === 1 ? String(timeServices[0].id) : "";
  const preferred = timeServices.some((s) => s.id === defaultTimeServiceId) ? String(defaultTimeServiceId) : "";
  const [timeServiceId, setTimeServiceId] = useState(onlyTimeService || preferred);
  const [materialServiceId, setMaterialServiceId] = useState(
    String(recentMaterialIds.find((id) => materialServices.some((s) => s.id === id)) ?? materialServices[0]?.id ?? FREE_TEXT),
  );

  const services = mode === "time" ? timeServices : materialServices;
  const serviceId = mode === "time" ? timeServiceId : materialServiceId;
  const service = services.find((s) => String(s.id) === serviceId);
  const unit: Unit | null = mode === "time" ? (service?.unit ?? null) : serviceId === FREE_TEXT ? freeUnit : (service?.unit ?? null);
  const isTime = mode === "time";
  const step = isTime ? 0.25 : 1;
  const parsed = parseQuantity(quantity);
  const canSubmit =
    pickedCustomerId !== null &&
    !isNavigating &&
    parsed !== null &&
    parsed > 0 &&
    (isTime ? service !== undefined : serviceId === FREE_TEXT ? freeName.trim() !== "" : service !== undefined);

  // Toast every new result; a success carries an undo for exactly this entry.
  useEffect(() => {
    const toastFor = actionToastFor(state, prevState.current, "Eintrag gespeichert");
    prevState.current = state;
    if (toastFor?.kind === "error") toast.error(toastFor.message);
    if (toastFor?.kind === "success") {
      const entryId = state.entryId;
      toast.success(toastFor.message, {
        action: entryId
          ? {
              label: "Rückgängig",
              onClick: async () => {
                const result = await deleteWorkEntry(entryId);
                if (result?.error) toast.error(result.error);
                else router.refresh();
              },
            }
          : undefined,
      });
      setQuantity("");
      setNote("");
      setFreeName("");
    }
  }, [state, router]);

  function nudge(delta: number) {
    const next = Math.max(0, roundTo2((parsed ?? 0) + delta));
    setQuantity(next === 0 ? "" : String(next));
  }

  return (
    <form action={formAction} onSubmit={submitKeepingInput(formAction)} className="space-y-4">
      <input type="hidden" name="customerId" value={pickedCustomerId ?? ""} />
      <input type="hidden" name="serviceId" value={serviceId === FREE_TEXT ? "" : serviceId} />
      <input type="hidden" name="quantity" value={quantity} />
      {serviceId === FREE_TEXT && mode === "material" && (
        <>
          <input type="hidden" name="freeName" value={freeName} />
          <input type="hidden" name="freeUnit" value={freeUnit} />
        </>
      )}

      <div className="space-y-1.5">
        <Label htmlFor="time-customer">Kunde</Label>
        <CustomerCombobox
          id="time-customer"
          customers={customers}
          defaultValue={customers.find((c) => c.customerId === customerId) ?? null}
          // "none" keeps the picker empty: without a parameter the page would preselect the last customer again.
          onValueChange={(c) => {
            setPickedCustomerId(c?.customerId ?? null);
            startNavigation(() => router.replace(c ? `/time?customer=${c.customerId}` : "/time?customer=none"));
          }}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="time-date">Datum</Label>
        <div className="flex gap-2">
          {[
            { label: "Heute", value: today },
            { label: "Gestern", value: shiftDay(today, -1) },
            { label: "Vorgestern", value: shiftDay(today, -2) },
          ].map((d) => (
            <Button key={d.label} type="button" variant={date === d.value ? "default" : "outline"} className="h-11 flex-1 text-base" aria-pressed={date === d.value} onClick={() => setDate(d.value)}>
              {d.label}
            </Button>
          ))}
        </div>
        <Input id="time-date" name="date" type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-11 text-base" required />
      </div>

      <div className="grid grid-cols-2 gap-2" role="tablist" aria-label="Art des Eintrags">
        {(["time", "material"] as const).map((m) => (
          <Button
            key={m}
            type="button"
            role="tab"
            aria-selected={mode === m}
            variant={mode === m ? "default" : "outline"}
            className="h-11 text-base"
            onClick={() => {
              setMode(m);
              setQuantity("");
            }}
          >
            {m === "time" ? "Zeit" : "Material"}
          </Button>
        ))}
      </div>

      {mode === "material" ? (
        <MaterialPicker
          services={materialServices}
          recentIds={recentMaterialIds}
          value={materialServiceId}
          onChange={setMaterialServiceId}
          onFreeText={setFreeName}
        />
      ) : services.length === 0 ? (
        <p className="rounded-lg border p-3 text-sm text-muted-foreground">
          Es gibt keine aktive Leistung mit der Einheit Stunde oder Tag.{" "}
          <Link href="/services" className="underline">Leistung im Katalog anlegen</Link>.
        </p>
      ) : (
        <div className="space-y-1.5">
          <Label htmlFor="time-service">Leistung</Label>
          <Select value={serviceId} onValueChange={(v) => setTimeServiceId(v ?? "")}>
            <SelectTrigger id="time-service" className="h-11 w-full text-base">
              <SelectValue>
                {(value: string | null) =>
                  services.find((s) => String(s.id) === value)?.name ?? "Bitte wählen"
                }
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {services.map((s) => (
                <SelectItem key={s.id} value={String(s.id)}>
                  {s.name} ({UNIT_LABELS[s.unit]})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {mode === "material" && serviceId === FREE_TEXT && (
        <div className="grid grid-cols-[1fr_8rem] gap-2">
          <div className="space-y-1.5">
            <Label htmlFor="time-free-name">Bezeichnung</Label>
            <Input id="time-free-name" value={freeName} onChange={(e) => setFreeName(e.target.value)} className="h-11 text-base" maxLength={200} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="time-free-unit">Einheit</Label>
            <Select value={freeUnit} onValueChange={(v) => setFreeUnit((v as "Piece" | "Package") ?? "Piece")}>
              <SelectTrigger id="time-free-unit" className="h-11 w-full text-base">
                <SelectValue>{(value: string | null) => (value === "Package" ? "Pauschal" : "Stück")}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Piece">Stück</SelectItem>
                <SelectItem value="Package">Pauschal</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      )}

      <div className="space-y-2">
        <Label htmlFor="time-quantity">{isTime ? (unit === "Day" ? "Tage" : "Stunden") : "Menge"}</Label>
        {unit && (unit === "Hour" || unit === "Day") && (
          <div className="flex gap-2">
            {QUICK_AMOUNTS[unit].map((v) => (
              <Button
                key={v}
                type="button"
                variant={parsed === v ? "default" : "outline"}
                className="h-12 flex-1 text-base"
                onClick={() => setQuantity(String(v))}
              >
                {formatQuantity(v)}
              </Button>
            ))}
          </div>
        )}
        <div className="flex gap-2">
          <Button type="button" variant="outline" className="h-12 w-14 text-xl" aria-label="Weniger" onClick={() => nudge(-step)}>
            −
          </Button>
          <Input
            id="time-quantity"
            inputMode="decimal"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            className={cn("h-12 text-center text-xl", quantity !== "" && parsed === null && "border-destructive")}
            aria-invalid={quantity !== "" && parsed === null}
            autoComplete="off"
          />
          <Button type="button" variant="outline" className="h-12 w-14 text-xl" aria-label="Mehr" onClick={() => nudge(step)}>
            +
          </Button>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="time-note">Notiz (nur intern)</Label>
        <Textarea id="time-note" name="note" value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={500} />
      </div>

      <Button type="submit" className="h-12 w-full text-base" disabled={!canSubmit || isPending}>
        {isPending ? "Speichert…" : "Speichern"}
      </Button>
    </form>
  );
}
