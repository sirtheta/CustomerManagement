import { describe, it, expect } from "vitest";
import { DEFAULT_THEME, resolveTheme, themeRevision } from "@/lib/pdf/theme";

describe("resolveTheme", () => {
  it("returns the default theme for empty/invalid input", () => {
    expect(resolveTheme(undefined)).toEqual(DEFAULT_THEME);
    expect(resolveTheme(null)).toEqual(DEFAULT_THEME);
    expect(resolveTheme("nope")).toEqual(DEFAULT_THEME);
    expect(resolveTheme(42)).toEqual(DEFAULT_THEME);
  });

  it("keeps the legacy look by default (black accent, Helvetica, no header fill)", () => {
    expect(DEFAULT_THEME.accentColor).toBe("#000000");
    expect(DEFAULT_THEME.fontFamily).toBe("Helvetica");
    expect(DEFAULT_THEME.tableHeaderFill).toBe(false);
    expect(DEFAULT_THEME.margin).toBe(40);
  });

  it("merges valid partial fields over defaults", () => {
    const t = resolveTheme({ accentColor: "#3b82f6", logoPosition: "right", showPhone: false });
    expect(t.accentColor).toBe("#3b82f6");
    expect(t.logoPosition).toBe("right");
    expect(t.showPhone).toBe(false);
    // untouched fields fall back to defaults
    expect(t.fontFamily).toBe("Helvetica");
    expect(t.margin).toBe(40);
  });

  it("rejects invalid hex colors", () => {
    expect(resolveTheme({ accentColor: "blue" }).accentColor).toBe("#000000");
    expect(resolveTheme({ accentColor: "#fff" }).accentColor).toBe("#000000");
    expect(resolveTheme({ accentColor: "#3b82f6ff" }).accentColor).toBe("#000000");
  });

  it("rejects fonts outside the whitelist", () => {
    expect(resolveTheme({ fontFamily: "Comic Sans" }).fontFamily).toBe("Helvetica");
    expect(resolveTheme({ fontFamily: "Times-Roman" }).fontFamily).toBe("Times-Roman");
  });

  it("clamps numeric fields into their valid ranges", () => {
    expect(resolveTheme({ baseFontSize: 999 }).baseFontSize).toBe(14);
    expect(resolveTheme({ baseFontSize: 1 }).baseFontSize).toBe(7);
    expect(resolveTheme({ margin: 5 }).margin).toBe(20);
    expect(resolveTheme({ margin: 500 }).margin).toBe(70);
    expect(resolveTheme({ logoMaxSize: 10 }).logoMaxSize).toBe(40);
    expect(resolveTheme({ baseFontSize: "abc" }).baseFontSize).toBe(DEFAULT_THEME.baseFontSize);
  });

  it("caps overly long text fields", () => {
    const long = "x".repeat(500);
    expect(resolveTheme({ footerNote: long }).footerNote.length).toBe(200);
  });

  it("falls back to left for an invalid logo position", () => {
    expect(resolveTheme({ logoPosition: "middle" }).logoPosition).toBe("left");
  });
});

describe("themeRevision", () => {
  it("is stable for equivalent themes and changes when the theme changes", () => {
    const a = themeRevision({ accentColor: "#3b82f6" });
    const b = themeRevision({ accentColor: "#3b82f6" });
    const c = themeRevision({ accentColor: "#ef4444" });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  it("treats invalid input the same as the default theme", () => {
    expect(themeRevision(undefined)).toBe(themeRevision(DEFAULT_THEME));
  });
});
