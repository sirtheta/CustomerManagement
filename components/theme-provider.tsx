"use client";

import { ThemeProvider as NextThemesProvider, useTheme } from "next-themes";
import { createContext, useContext, useEffect, useState } from "react";

export type ColorScheme = "indigo" | "blue" | "green" | "rose";

type Vars = Record<string, string>;
type SchemeMode = { light: Vars; dark: Vars };

const SCHEME_VARS: Record<ColorScheme, SchemeMode> = {
  indigo: {
    light: {
      "--background": "oklch(0.99 0.002 270)",
      "--foreground": "oklch(0.16 0.02 270)",
      "--card": "oklch(1 0 0)",
      "--card-foreground": "oklch(0.16 0.02 270)",
      "--popover": "oklch(1 0 0)",
      "--popover-foreground": "oklch(0.16 0.02 270)",
      "--primary": "oklch(0.511 0.216 270.5)",
      "--primary-foreground": "oklch(0.98 0.005 270)",
      "--secondary": "oklch(0.955 0.018 270)",
      "--secondary-foreground": "oklch(0.32 0.06 270)",
      "--muted": "oklch(0.96 0.01 270)",
      "--muted-foreground": "oklch(0.52 0.025 270)",
      "--accent": "oklch(0.93 0.03 270)",
      "--accent-foreground": "oklch(0.32 0.06 270)",
      "--border": "oklch(0.905 0.018 270)",
      "--input": "oklch(0.905 0.018 270)",
      "--ring": "oklch(0.511 0.216 270.5)",
      "--chart-1": "oklch(0.511 0.216 270.5)",
      "--sidebar": "oklch(0.975 0.01 270)",
      "--sidebar-foreground": "oklch(0.16 0.02 270)",
      "--sidebar-primary": "oklch(0.511 0.216 270.5)",
      "--sidebar-primary-foreground": "oklch(0.98 0.005 270)",
      "--sidebar-accent": "oklch(0.93 0.03 270)",
      "--sidebar-accent-foreground": "oklch(0.32 0.06 270)",
      "--sidebar-border": "oklch(0.905 0.018 270)",
      "--sidebar-ring": "oklch(0.511 0.216 270.5)",
    },
    dark: {
      "--background": "oklch(0.13 0.02 270)",
      "--foreground": "oklch(0.96 0.008 270)",
      "--card": "oklch(0.18 0.025 270)",
      "--card-foreground": "oklch(0.96 0.008 270)",
      "--popover": "oklch(0.18 0.025 270)",
      "--popover-foreground": "oklch(0.96 0.008 270)",
      "--primary": "oklch(0.62 0.22 270)",
      "--primary-foreground": "oklch(0.13 0.02 270)",
      "--secondary": "oklch(0.24 0.035 270)",
      "--secondary-foreground": "oklch(0.96 0.008 270)",
      "--muted": "oklch(0.22 0.03 270)",
      "--muted-foreground": "oklch(0.65 0.025 270)",
      "--accent": "oklch(0.28 0.05 270)",
      "--accent-foreground": "oklch(0.96 0.008 270)",
      "--border": "oklch(1 0 0 / 12%)",
      "--input": "oklch(1 0 0 / 15%)",
      "--ring": "oklch(0.62 0.22 270)",
      "--chart-1": "oklch(0.62 0.22 270)",
      "--sidebar": "oklch(0.16 0.025 270)",
      "--sidebar-foreground": "oklch(0.96 0.008 270)",
      "--sidebar-primary": "oklch(0.62 0.22 270)",
      "--sidebar-primary-foreground": "oklch(0.13 0.02 270)",
      "--sidebar-accent": "oklch(0.28 0.05 270)",
      "--sidebar-accent-foreground": "oklch(0.96 0.008 270)",
      "--sidebar-border": "oklch(1 0 0 / 12%)",
      "--sidebar-ring": "oklch(0.62 0.22 270)",
    },
  },
  blue: {
    light: {
      "--background": "oklch(0.99 0.002 220)",
      "--foreground": "oklch(0.16 0.02 220)",
      "--card": "oklch(1 0 0)",
      "--card-foreground": "oklch(0.16 0.02 220)",
      "--popover": "oklch(1 0 0)",
      "--popover-foreground": "oklch(0.16 0.02 220)",
      "--primary": "oklch(0.546 0.209 239)",
      "--primary-foreground": "oklch(0.98 0.005 220)",
      "--secondary": "oklch(0.955 0.018 220)",
      "--secondary-foreground": "oklch(0.32 0.06 220)",
      "--muted": "oklch(0.96 0.01 220)",
      "--muted-foreground": "oklch(0.52 0.025 220)",
      "--accent": "oklch(0.93 0.03 220)",
      "--accent-foreground": "oklch(0.32 0.06 220)",
      "--border": "oklch(0.905 0.018 220)",
      "--input": "oklch(0.905 0.018 220)",
      "--ring": "oklch(0.546 0.209 239)",
      "--chart-1": "oklch(0.546 0.209 239)",
      "--sidebar": "oklch(0.975 0.01 220)",
      "--sidebar-foreground": "oklch(0.16 0.02 220)",
      "--sidebar-primary": "oklch(0.546 0.209 239)",
      "--sidebar-primary-foreground": "oklch(0.98 0.005 220)",
      "--sidebar-accent": "oklch(0.93 0.03 220)",
      "--sidebar-accent-foreground": "oklch(0.32 0.06 220)",
      "--sidebar-border": "oklch(0.905 0.018 220)",
      "--sidebar-ring": "oklch(0.546 0.209 239)",
    },
    dark: {
      "--background": "oklch(0.13 0.02 220)",
      "--foreground": "oklch(0.96 0.008 220)",
      "--card": "oklch(0.18 0.025 220)",
      "--card-foreground": "oklch(0.96 0.008 220)",
      "--popover": "oklch(0.18 0.025 220)",
      "--popover-foreground": "oklch(0.96 0.008 220)",
      "--primary": "oklch(0.65 0.20 239)",
      "--primary-foreground": "oklch(0.13 0.02 220)",
      "--secondary": "oklch(0.24 0.035 220)",
      "--secondary-foreground": "oklch(0.96 0.008 220)",
      "--muted": "oklch(0.22 0.03 220)",
      "--muted-foreground": "oklch(0.65 0.025 220)",
      "--accent": "oklch(0.28 0.05 220)",
      "--accent-foreground": "oklch(0.96 0.008 220)",
      "--border": "oklch(1 0 0 / 12%)",
      "--input": "oklch(1 0 0 / 15%)",
      "--ring": "oklch(0.65 0.20 239)",
      "--chart-1": "oklch(0.65 0.20 239)",
      "--sidebar": "oklch(0.16 0.025 220)",
      "--sidebar-foreground": "oklch(0.96 0.008 220)",
      "--sidebar-primary": "oklch(0.65 0.20 239)",
      "--sidebar-primary-foreground": "oklch(0.13 0.02 220)",
      "--sidebar-accent": "oklch(0.28 0.05 220)",
      "--sidebar-accent-foreground": "oklch(0.96 0.008 220)",
      "--sidebar-border": "oklch(1 0 0 / 12%)",
      "--sidebar-ring": "oklch(0.65 0.20 239)",
    },
  },
  green: {
    light: {
      "--background": "oklch(0.99 0.002 155)",
      "--foreground": "oklch(0.16 0.02 155)",
      "--card": "oklch(1 0 0)",
      "--card-foreground": "oklch(0.16 0.02 155)",
      "--popover": "oklch(1 0 0)",
      "--popover-foreground": "oklch(0.16 0.02 155)",
      "--primary": "oklch(0.53 0.18 155)",
      "--primary-foreground": "oklch(0.98 0.005 155)",
      "--secondary": "oklch(0.955 0.018 155)",
      "--secondary-foreground": "oklch(0.32 0.06 155)",
      "--muted": "oklch(0.96 0.01 155)",
      "--muted-foreground": "oklch(0.52 0.025 155)",
      "--accent": "oklch(0.93 0.03 155)",
      "--accent-foreground": "oklch(0.32 0.06 155)",
      "--border": "oklch(0.905 0.018 155)",
      "--input": "oklch(0.905 0.018 155)",
      "--ring": "oklch(0.53 0.18 155)",
      "--chart-1": "oklch(0.53 0.18 155)",
      "--sidebar": "oklch(0.975 0.01 155)",
      "--sidebar-foreground": "oklch(0.16 0.02 155)",
      "--sidebar-primary": "oklch(0.53 0.18 155)",
      "--sidebar-primary-foreground": "oklch(0.98 0.005 155)",
      "--sidebar-accent": "oklch(0.93 0.03 155)",
      "--sidebar-accent-foreground": "oklch(0.32 0.06 155)",
      "--sidebar-border": "oklch(0.905 0.018 155)",
      "--sidebar-ring": "oklch(0.53 0.18 155)",
    },
    dark: {
      "--background": "oklch(0.13 0.02 155)",
      "--foreground": "oklch(0.96 0.008 155)",
      "--card": "oklch(0.18 0.025 155)",
      "--card-foreground": "oklch(0.96 0.008 155)",
      "--popover": "oklch(0.18 0.025 155)",
      "--popover-foreground": "oklch(0.96 0.008 155)",
      "--primary": "oklch(0.65 0.18 155)",
      "--primary-foreground": "oklch(0.13 0.02 155)",
      "--secondary": "oklch(0.24 0.035 155)",
      "--secondary-foreground": "oklch(0.96 0.008 155)",
      "--muted": "oklch(0.22 0.03 155)",
      "--muted-foreground": "oklch(0.65 0.025 155)",
      "--accent": "oklch(0.28 0.05 155)",
      "--accent-foreground": "oklch(0.96 0.008 155)",
      "--border": "oklch(1 0 0 / 12%)",
      "--input": "oklch(1 0 0 / 15%)",
      "--ring": "oklch(0.65 0.18 155)",
      "--chart-1": "oklch(0.65 0.18 155)",
      "--sidebar": "oklch(0.16 0.025 155)",
      "--sidebar-foreground": "oklch(0.96 0.008 155)",
      "--sidebar-primary": "oklch(0.65 0.18 155)",
      "--sidebar-primary-foreground": "oklch(0.13 0.02 155)",
      "--sidebar-accent": "oklch(0.28 0.05 155)",
      "--sidebar-accent-foreground": "oklch(0.96 0.008 155)",
      "--sidebar-border": "oklch(1 0 0 / 12%)",
      "--sidebar-ring": "oklch(0.65 0.18 155)",
    },
  },
  rose: {
    light: {
      "--background": "oklch(0.99 0.002 10)",
      "--foreground": "oklch(0.16 0.02 10)",
      "--card": "oklch(1 0 0)",
      "--card-foreground": "oklch(0.16 0.02 10)",
      "--popover": "oklch(1 0 0)",
      "--popover-foreground": "oklch(0.16 0.02 10)",
      "--primary": "oklch(0.56 0.22 10)",
      "--primary-foreground": "oklch(0.98 0.005 10)",
      "--secondary": "oklch(0.955 0.018 10)",
      "--secondary-foreground": "oklch(0.32 0.06 10)",
      "--muted": "oklch(0.96 0.01 10)",
      "--muted-foreground": "oklch(0.52 0.025 10)",
      "--accent": "oklch(0.93 0.03 10)",
      "--accent-foreground": "oklch(0.32 0.06 10)",
      "--border": "oklch(0.905 0.018 10)",
      "--input": "oklch(0.905 0.018 10)",
      "--ring": "oklch(0.56 0.22 10)",
      "--chart-1": "oklch(0.56 0.22 10)",
      "--sidebar": "oklch(0.975 0.01 10)",
      "--sidebar-foreground": "oklch(0.16 0.02 10)",
      "--sidebar-primary": "oklch(0.56 0.22 10)",
      "--sidebar-primary-foreground": "oklch(0.98 0.005 10)",
      "--sidebar-accent": "oklch(0.93 0.03 10)",
      "--sidebar-accent-foreground": "oklch(0.32 0.06 10)",
      "--sidebar-border": "oklch(0.905 0.018 10)",
      "--sidebar-ring": "oklch(0.56 0.22 10)",
    },
    dark: {
      "--background": "oklch(0.13 0.02 10)",
      "--foreground": "oklch(0.96 0.008 10)",
      "--card": "oklch(0.18 0.025 10)",
      "--card-foreground": "oklch(0.96 0.008 10)",
      "--popover": "oklch(0.18 0.025 10)",
      "--popover-foreground": "oklch(0.96 0.008 10)",
      "--primary": "oklch(0.67 0.22 10)",
      "--primary-foreground": "oklch(0.13 0.02 10)",
      "--secondary": "oklch(0.24 0.035 10)",
      "--secondary-foreground": "oklch(0.96 0.008 10)",
      "--muted": "oklch(0.22 0.03 10)",
      "--muted-foreground": "oklch(0.65 0.025 10)",
      "--accent": "oklch(0.28 0.05 10)",
      "--accent-foreground": "oklch(0.96 0.008 10)",
      "--border": "oklch(1 0 0 / 12%)",
      "--input": "oklch(1 0 0 / 15%)",
      "--ring": "oklch(0.67 0.22 10)",
      "--chart-1": "oklch(0.67 0.22 10)",
      "--sidebar": "oklch(0.16 0.025 10)",
      "--sidebar-foreground": "oklch(0.96 0.008 10)",
      "--sidebar-primary": "oklch(0.67 0.22 10)",
      "--sidebar-primary-foreground": "oklch(0.13 0.02 10)",
      "--sidebar-accent": "oklch(0.28 0.05 10)",
      "--sidebar-accent-foreground": "oklch(0.96 0.008 10)",
      "--sidebar-border": "oklch(1 0 0 / 12%)",
      "--sidebar-ring": "oklch(0.67 0.22 10)",
    },
  },
};

const ColorSchemeContext = createContext<{
  colorScheme: ColorScheme;
  setColorScheme: (s: ColorScheme) => void;
}>({ colorScheme: "indigo", setColorScheme: () => {} });

export function useColorScheme() {
  return useContext(ColorSchemeContext);
}

function ColorSchemeProvider({ children }: { children: React.ReactNode }) {
  const { resolvedTheme } = useTheme();
  const [colorScheme, setColorSchemeState] = useState<ColorScheme>("indigo");

  useEffect(() => {
    // Read the persisted scheme only after mount: localStorage is unavailable
    // during SSR, so doing this in a lazy initializer would cause a hydration
    // mismatch. The effect is the SSR-safe place for this one-time sync.
    const saved = localStorage.getItem("color-scheme") as ColorScheme | null;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (saved && saved in SCHEME_VARS) setColorSchemeState(saved);
  }, []);

  // Apply CSS variables via inline style whenever scheme or dark mode changes.
  // Inline style overrides any compiled CSS, so no recompilation is needed.
  useEffect(() => {
    if (!resolvedTheme) return;
    const vars = SCHEME_VARS[colorScheme][resolvedTheme === "dark" ? "dark" : "light"];
    const root = document.documentElement;
    root.setAttribute("data-color", colorScheme);
    Object.entries(vars).forEach(([k, v]) => root.style.setProperty(k, v));
  }, [colorScheme, resolvedTheme]);

  function setColorScheme(scheme: ColorScheme) {
    setColorSchemeState(scheme);
    localStorage.setItem("color-scheme", scheme);
  }

  return (
    <ColorSchemeContext.Provider value={{ colorScheme, setColorScheme }}>
      {children}
    </ColorSchemeContext.Provider>
  );
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemesProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <ColorSchemeProvider>{children}</ColorSchemeProvider>
    </NextThemesProvider>
  );
}
