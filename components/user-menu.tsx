"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { LogOutIcon, UserIcon } from "lucide-react";

type Props = {
  name: string;
  signOutAction: () => Promise<void>;
};

export function UserMenu({ name, signOutAction }: Props) {
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

  const initials = name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center justify-center size-8 rounded-full bg-primary/10 text-primary text-xs font-semibold hover:bg-primary/20 transition-colors"
        aria-label="Benutzermenu"
        aria-expanded={open}
      >
        {initials || <UserIcon className="size-4" />}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 w-48 rounded-lg border bg-card shadow-lg py-1">
          <div className="px-3 py-2 border-b">
            <p className="text-xs font-medium truncate">{name}</p>
          </div>
          <div className="p-1 border-b">
            <Link
              href="/profile"
              onClick={() => setOpen(false)}
              className="w-full flex items-center gap-2 px-2 py-1.5 text-sm rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            >
              <UserIcon className="size-4 shrink-0" />
              Profil
            </Link>
          </div>
          <form action={signOutAction} className="p-1">
            <button
              type="submit"
              className="w-full flex items-center gap-2 px-2 py-1.5 text-sm rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            >
              <LogOutIcon className="size-4 shrink-0" />
              Abmelden
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
