"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { useActionToast, type ActionState } from "@/hooks/use-action-toast";
import { savePdfTheme } from "./actions";
import { PDF_FONTS, type PdfFont, type PdfTheme } from "@/lib/pdf/theme";

const COLOR_PALETTE = [
  "#000000", "#64748b", "#ef4444", "#f97316", "#f59e0b", "#eab308", "#84cc16",
  "#22c55e", "#14b8a6", "#06b6d4", "#3b82f6", "#6366f1", "#8b5cf6", "#ec4899",
];

const FONT_LABELS: Record<PdfFont, string> = {
  Helvetica: "Helvetica (serifenlos)",
  "Times-Roman": "Times (mit Serifen)",
  Lato: "Lato (serifenlos)",
  Roboto: "Roboto (serifenlos)",
  Montserrat: "Montserrat (serifenlos)",
  Lora: "Lora (mit Serifen)",
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function NumberField({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
}) {
  return (
    <Field label={label}>
      <Input
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-28"
      />
    </Field>
  );
}

function CheckboxField({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-sm cursor-pointer">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 rounded border-input accent-primary"
      />
      {label}
    </label>
  );
}

export default function DesignForm({ initialTheme }: { initialTheme: PdfTheme }) {
  const [theme, setTheme] = useState<PdfTheme>(initialTheme);
  const [previewType, setPreviewType] = useState<"invoice" | "quote">("invoice");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState(false);
  const objectUrlRef = useRef<string | null>(null);

  const [state, formAction, isPending] = useActionState<ActionState, FormData>(
    savePdfTheme,
    {}
  );
  useActionToast(state, "Design gespeichert");

  function set<K extends keyof PdfTheme>(key: K, value: PdfTheme[K]) {
    setTheme((t) => ({ ...t, [key]: value }));
  }

  // Debounced live preview: render the real PDF server-side with the draft theme.
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const res = await fetch("/api/settings/pdf-preview", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type: previewType, theme }),
          signal: controller.signal,
        });
        if (!res.ok) throw new Error("preview failed");
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = url;
        setPreviewUrl(url);
        setPreviewError(false);
      } catch (e) {
        if (!(e instanceof DOMException && e.name === "AbortError")) setPreviewError(true);
      }
    }, 400);

    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [theme, previewType]);

  useEffect(() => {
    return () => {
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    };
  }, []);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
      {/* ── Controls ──────────────────────────────────────────────── */}
      <form action={formAction} className="space-y-6">
        <input type="hidden" name="theme" value={JSON.stringify(theme)} readOnly />

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Farbe &amp; Schrift</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Field label="Akzentfarbe (Titel, Linien)">
              <div className="flex items-center gap-2 flex-wrap">
                {COLOR_PALETTE.map((color) => (
                  <button
                    key={color}
                    type="button"
                    onClick={() => set("accentColor", color)}
                    aria-label={`Farbe ${color}`}
                    aria-pressed={theme.accentColor.toLowerCase() === color.toLowerCase()}
                    title={color}
                    className={cn(
                      "size-7 rounded-full transition focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      theme.accentColor.toLowerCase() === color.toLowerCase()
                        ? "ring-2 ring-offset-2 ring-foreground"
                        : "ring-1 ring-black/10 hover:scale-110"
                    )}
                    style={{ backgroundColor: color }}
                  />
                ))}
                <input
                  type="color"
                  value={theme.accentColor}
                  onChange={(e) => set("accentColor", e.target.value)}
                  aria-label="Eigene Farbe"
                  className="size-7 rounded cursor-pointer border border-input bg-transparent p-0"
                />
              </div>
            </Field>

            <Field label="Schriftart">
              <select
                value={theme.fontFamily}
                onChange={(e) => set("fontFamily", e.target.value as PdfFont)}
                className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
              >
                {PDF_FONTS.map((f) => (
                  <option key={f} value={f}>
                    {FONT_LABELS[f]}
                  </option>
                ))}
              </select>
            </Field>

            <NumberField
              label="Basis-Schriftgrösse (pt)"
              value={theme.baseFontSize}
              min={7}
              max={14}
              onChange={(v) => set("baseFontSize", v)}
            />

            <CheckboxField
              label="Tabellenkopf mit Akzentfarbe hinterlegen"
              checked={theme.tableHeaderFill}
              onChange={(v) => set("tableHeaderFill", v)}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Layout &amp; Logo</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex gap-4 flex-wrap">
              <NumberField
                label="Seitenrand (pt)"
                value={theme.margin}
                min={20}
                max={70}
                onChange={(v) => set("margin", v)}
              />
              <NumberField
                label="Logo-Grösse (pt)"
                value={theme.logoMaxSize}
                min={40}
                max={160}
                onChange={(v) => set("logoMaxSize", v)}
              />
            </div>
            <Field label="Logo-Position">
              <select
                value={theme.logoPosition}
                onChange={(e) => set("logoPosition", e.target.value as "left" | "right")}
                className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
              >
                <option value="left">Links</option>
                <option value="right">Rechts</option>
              </select>
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Inhalte</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <CheckboxField label="Telefonnummer anzeigen" checked={theme.showPhone} onChange={(v) => set("showPhone", v)} />
              <CheckboxField label="E-Mail-Adresse anzeigen" checked={theme.showEmail} onChange={(v) => set("showEmail", v)} />
              <CheckboxField label="Grussformel-Block anzeigen" checked={theme.showFooter} onChange={(v) => set("showFooter", v)} />
            </div>
            <Field label="Grussformel">
              <Input
                value={theme.closingSalutation}
                onChange={(e) => set("closingSalutation", e.target.value)}
                disabled={!theme.showFooter}
              />
            </Field>
            <Field label="Fusstext (optional)">
              <Textarea
                value={theme.footerNote}
                onChange={(e) => set("footerNote", e.target.value)}
                disabled={!theme.showFooter}
                rows={2}
              />
            </Field>
          </CardContent>
        </Card>

        <div className="flex items-center gap-3">
          <Button type="submit" disabled={isPending}>
            {isPending ? "Speichern…" : "Design speichern"}
          </Button>
          <Button type="button" variant="outline" onClick={() => setTheme(initialTheme)}>
            Zurücksetzen
          </Button>
        </div>
      </form>

      {/* ── Live preview ──────────────────────────────────────────── */}
      <div className="lg:sticky lg:top-4 space-y-2">
        <div className="flex items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant={previewType === "invoice" ? "default" : "outline"}
            onClick={() => setPreviewType("invoice")}
          >
            Rechnung
          </Button>
          <Button
            type="button"
            size="sm"
            variant={previewType === "quote" ? "default" : "outline"}
            onClick={() => setPreviewType("quote")}
          >
            Offerte
          </Button>
        </div>
        <div className="rounded-lg border overflow-hidden bg-muted/30" style={{ height: "80vh" }}>
          {previewError ? (
            <div className="flex h-full items-center justify-center text-sm text-destructive">
              Vorschau konnte nicht erstellt werden.
            </div>
          ) : previewUrl ? (
            <iframe src={previewUrl} title="PDF-Vorschau" className="w-full h-full" />
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              Vorschau wird geladen…
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
