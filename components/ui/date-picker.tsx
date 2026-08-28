"use client";

import * as React from "react";
import { de } from "react-day-picker/locale";
import { CalendarIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { parseDate, toDateString } from "@/lib/date";
import { cn } from "@/lib/utils";

interface DatePickerInputProps {
  id?: string;
  name?: string;
  defaultValue?: string;
  value?: string;
  onChange?: (value: string) => void;
  disabled?: boolean;
  "aria-label"?: string;
  className?: string;
}

export function DatePickerInput({
  id,
  name,
  defaultValue,
  value,
  onChange,
  disabled,
  "aria-label": ariaLabel,
  className,
}: DatePickerInputProps) {
  const isControlled = value !== undefined;
  const [internalValue, setInternalValue] = React.useState(defaultValue ?? "");
  const [open, setOpen] = React.useState(false);

  const currentValue = isControlled ? value : internalValue;
  const selectedDate = parseDate(currentValue);

  function handleSelect(date: Date | undefined) {
    if (!date) return;
    const str = toDateString(date);
    if (!isControlled) setInternalValue(str);
    onChange?.(str);
    setOpen(false);
  }

  const displayText = selectedDate
    ? selectedDate.toLocaleDateString("de-CH")
    : "Datum wählen";

  return (
    <>
      {name && (
        <input type="hidden" name={name} value={currentValue} readOnly />
      )}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={
            <Button
              id={id}
              type="button"
              disabled={disabled}
              aria-label={ariaLabel}
              variant="outline"
              className={cn(
                "w-full justify-start text-left font-normal",
                !currentValue && "text-muted-foreground",
                className
              )}
            />
          }
        >
          <CalendarIcon className="mr-2 size-4 shrink-0" />
          {displayText}
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="single"
            selected={selectedDate}
            onSelect={handleSelect}
            locale={de}
            captionLayout="dropdown"
            defaultMonth={selectedDate ?? new Date()}
          />
        </PopoverContent>
      </Popover>
    </>
  );
}
