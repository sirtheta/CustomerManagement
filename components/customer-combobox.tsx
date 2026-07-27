"use client"

import { Combobox } from "@base-ui/react/combobox"
import type { Customer } from "@prisma/client"
import {
  Combobox as ComboboxRoot,
  ComboboxInputGroup,
  ComboboxInput,
  ComboboxClear,
  ComboboxTrigger,
  ComboboxContent,
  ComboboxItem,
} from "@/components/ui/combobox"
import { customerDisplayName } from "@/lib/search"

function customerSearchText(c: Customer) {
  return `${customerDisplayName(c)} ${c.zipCode} ${c.city}`
}

type Props = {
  id?: string
  name?: string
  customers: Customer[]
  defaultValue?: Customer | null
  required?: boolean
}

export function CustomerCombobox({ id, name, customers, defaultValue, required }: Props) {
  const textFilter = Combobox.useFilter({ sensitivity: "base" })

  return (
    <ComboboxRoot<Customer>
      items={customers}
      defaultValue={defaultValue ?? null}
      itemToStringLabel={customerDisplayName}
      itemToStringValue={(c) => c.customerId.toString()}
      isItemEqualToValue={(a, b) => a.customerId === b.customerId}
      filter={(item, query) => textFilter.contains(item, query, customerSearchText)}
      name={name}
      required={required}
    >
      <ComboboxInputGroup>
        <ComboboxInput id={id} placeholder="Kunde suchen…" />
        <ComboboxClear />
        <ComboboxTrigger />
      </ComboboxInputGroup>
      <ComboboxContent empty="Keine Kunden gefunden.">
        {(c: Customer) => (
          <ComboboxItem key={c.customerId} value={c}>
            <span className="min-w-0 flex-1 truncate">{customerDisplayName(c)}</span>
            <span className="shrink-0 text-xs text-muted-foreground">
              {c.zipCode} {c.city}
            </span>
          </ComboboxItem>
        )}
      </ComboboxContent>
    </ComboboxRoot>
  )
}
