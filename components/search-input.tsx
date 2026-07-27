"use client";

import { useRef, useState } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { Input } from "@/components/ui/input";

type Props = {
  defaultValue?: string;
  placeholder?: string;
  className?: string;
};

export function SearchInput({ defaultValue = "", placeholder = "Suchen…", className }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [value, setValue] = useState(defaultValue);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const next = e.target.value;
    setValue(next);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      const params = new URLSearchParams(searchParams.toString());
      if (next) params.set("search", next);
      else params.delete("search");
      router.replace(pathname + (params.size ? "?" + params.toString() : ""), { scroll: false });
    }, 300);
  }

  return (
    <Input
      value={value}
      onChange={handleChange}
      placeholder={placeholder}
      className={className}
      autoComplete="search"
      data-lpignore="true"
      data-1p-ignore
      data-bwignore
      data-form-type="other"
    />
  );
}
