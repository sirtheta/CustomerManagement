"use client";

import { useTheme } from "next-themes";
import { useColorScheme, type ColorScheme } from "./theme-provider";
import { useEffect, useRef, useState } from "react";
import { Monitor, Moon, Palette, Sun } from "lucide-react";
import { cn } from "@/lib/utils";

const colorSchemes: { value: ColorScheme; label: string; color: string }[] = [
  { value: "indigo", label: "Indigo", color: "oklch(0.511 0.216 270.5)" },
  { value: "blue",   label: "Blau",   color: "oklch(0.546 0.209 239)" },
  { value: "green",  label: "Grün",   color: "oklch(0.53 0.18 155)" },
  { value: "rose",   label: "Rose",   color: "oklch(0.56 0.22 10)" },
];

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const { colorScheme, setColorScheme } = useColorScheme();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center justify-center size-8 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
        aria-label="Erscheinungsbild"
        aria-expanded={open}
      >
        <Palette className="size-4" />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 w-52 rounded-lg border bg-card shadow-lg p-3 space-y-3">
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-1.5">Modus</p>
            <div className="flex gap-1">
              {(
                [
                  { value: "light",  Icon: Sun,     label: "Hell" },
                  { value: "dark",   Icon: Moon,    label: "Dunkel" },
                  { value: "system", Icon: Monitor, label: "System" },
                ] as const
              ).map(({ value, Icon, label }) => (
                <button
                  key={value}
                  onClick={() => setTheme(value)}
                  className={cn(
                    "flex-1 flex flex-col items-center gap-1 py-1.5 rounded-md text-xs transition-colors",
                    theme === value
                      ? "bg-primary text-primary-foreground"
                      : "hover:bg-accent text-muted-foreground hover:text-foreground"
                  )}
                >
                  <Icon className="size-3.5" />
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="text-xs font-medium text-muted-foreground mb-1.5">Farbe</p>
            <div className="flex gap-2">
              {colorSchemes.map(({ value, label, color }) => (
                <button
                  key={value}
                  onClick={() => setColorScheme(value)}
                  title={label}
                  className={cn(
                    "size-6 rounded-full transition-all",
                    colorScheme === value
                      ? "ring-2 ring-offset-2 ring-offset-card ring-foreground scale-110"
                      : "hover:scale-110"
                  )}
                  style={{ background: color }}
                />
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
