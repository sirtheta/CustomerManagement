# F8 Mahnwesen mit Mahnbelegen Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eigener Mahnbeleg-PDF je Stufe (Zahlungserinnerung, 1.–3. Mahnung) mit optionaler Mahngebühr und optionalem Verzugszins; Beträge werden pro Versand in `SentDocument` festgehalten, der Bankabgleich erkennt den Mahn-Total.

**Architecture:** Eine reine Berechnungsfunktion (`lib/reminder-charges.ts`) liefert Restbetrag, Gebühr, Zins und Total in Rappen. `generateDocumentPdf` bekommt eine dritte Dokumentart `"reminder"` mit einer Betragstabelle statt der Positionstabelle, und `lib/pdf/reminder-pdf.ts` mappt Rechnung und Beträge darauf. `sendReminder` berechnet serverseitig, rendert über den bestehenden Weg `renderArchiveAndSend` (einmal rendern, Bytes archivieren, dieselben Bytes mailen) und speichert die Beträge an `SentDocument`. Rechnung, `Payment` und OP-Liste bleiben unverändert.

**Tech Stack:** Next.js 16 Server Actions, Prisma 7 + SQLite, pdfkit + swissqrbill, Vitest (`pdfjs-dist` zum Auslesen von PDF-Text in Tests).

**Spec:** `docs/superpowers/specs/2026-10-01-f8-mahnwesen-design.md`

## Global Constraints

- UI, Belegtexte und Doku sind **auf Deutsch**; Commit-Messages **auf Englisch** im Conventional-Commits-Format, mit der Zeile `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>` am Ende.
- Beträge intern in **Rappen (`Int`)**, CHF nur an der Darstellungsgrenze; Rundung mit `Math.round`.
- Stufen: 1 Zahlungserinnerung (keine Gebühr), 2 = 1. Mahnung, 3 = 2. Mahnung, 4 = 3. Mahnung. Nach Level 4 keine weitere Stufe.
- Gebühr und Zins sind standardmässig **aus** (Gebühren 0, Zinssatz 0). Zins `= Rest × Satz/100 × Tage / 365`, Tage = Kalendertage (UTC-Datumsteile) von Fälligkeit bis Mahndatum, mindestens 0. **Level 1 (Zahlungserinnerung) hat weder Gebühr noch Zins.**
- Rechnung, `Payment` und OP-Liste werden nicht verändert; Gebühr und Zins stehen nur auf dem Beleg, im QR-Betrag und in `SentDocument`. Eine gezahlte Gebühr wird zur Überzahlung (`Payment.amount`) und erscheint so im Journal.
- Beträge werden **immer serverseitig** neu berechnet, nie aus Formulardaten übernommen.
- Nie `logAudit` innerhalb einer `$transaction` aufrufen; nie direkt in `AuditLog` schreiben.
- Betreibung/Inkasso und Forderungsexport sind **nicht** im Umfang.
- **Keine neue Migration anlegen.** Schemaänderungen werden als SQL an die letzte (unveröffentlichte) Migration `20261001120000_invoicing_and_banking` angehängt.
- Der Versand wird verweigert, wenn der Restbetrag 0 ist („Die Rechnung ist bereits beglichen.“).
- Änderungen an Gebühren/Zinssatz werden auditiert (`UPDATE Settings`, ausserhalb jeder Transaktion).
- Bekannt und bewusst nicht behoben: gleichzeitiger Doppelversand derselben Mahnung (zwei Tabs) ist wie schon heute durch kein Claim geschützt.
- Tests: `npx vitest run <datei>`; Integrationstests nutzen `createTestDatabase()` aus `tests/test-utils.ts`.

---

## File Structure

| Datei | Verantwortung |
|---|---|
| `prisma/schema.prisma`, letzte Migration (SQL angehängt) | Einstellungsfelder (Gebühren, Zinssatz) und Betragsspalten an `SentDocument` |
| `lib/reminder-charges.ts` (neu) | `reminderTitle`, `MAX_REMINDER_LEVEL`, `computeReminderCharges` (rein, ohne Prisma) |
| `lib/reminders.ts` | zusätzlich `isLastReminderLevelSent` (gemeinsamer Helper für Action und Liste) |
| `lib/email.ts` | `sendInvoiceEmail` mit optionalem `attachmentName` |
| `lib/import/matching.ts`, `lib/import/queries.ts` | Mahn-Total als Betragstreffer im Bankabgleich |
| `lib/pdf/document-pdf.ts` | `RenderDoc` um `kind: "reminder"` und `amountLines` erweitern, Betragstabelle rendern |
| `lib/pdf/reminder-pdf.ts` (neu) | `generateReminderPdf(invoice, settings, input)` |
| `lib/invoice-dispatch.ts` | `renderArchiveAndSend` mit `renderPdf` und `attachmentName` (ersetzt `pdfOptions`); `sentDocumentData` mit Beträgen |
| `lib/pdf/invoice-pdf.ts` | Option `qrAmount` entfällt (nur Mahnungen nutzten sie) |
| `app/(app)/invoices/reminders/actions.ts` | `sendReminder` berechnet, rendert Mahnbeleg, speichert Beträge, Level-Deckel |
| `app/(app)/invoices/reminders/page.tsx`, `ReminderRow.tsx` | Stufenlabel 1–4, Vorschau Gebühr/Zins/Total, „Letzte Stufe erreicht“ |
| `app/(app)/settings/actions.ts`, `page.tsx`, `SettingsForm.tsx` | Felder „Mahnwesen“ speichern, validieren, anzeigen |
| `CLAUDE.md`, `FEATURE_ANALYSE.md`, `README.md` | Doku nachführen |

---

### Task 1: Schema, Migration und Einstellungen

**Files:**
- Modify: `prisma/schema.prisma` (`ApplicationSettings` nach `reminderCooldownDays`, `SentDocument`)
- Modify: `prisma/migrations/20261001120000_invoicing_and_banking/migration.sql` (SQL anhängen, **keine neue Migration**)
- Modify: `app/(app)/settings/actions.ts`, `app/(app)/settings/page.tsx`, `app/(app)/settings/SettingsForm.tsx`
- Test: `tests/unit/settings-actions.test.ts`

**Interfaces:**
- Produces: `ApplicationSettings.reminderFeeLevel2Rappen | reminderFeeLevel3Rappen | reminderFeeLevel4Rappen: number` (Rappen, Default 0), `ApplicationSettings.reminderInterestPercent: Prisma.Decimal` (Default 0); `SentDocument.openRappen | feeRappen | interestRappen: number | null`, `SentDocument.interestPercent: Prisma.Decimal | null`, `SentDocument.dunningDate: Date | null`.

- [ ] **Step 1: Write the failing tests**

In `tests/unit/settings-actions.test.ts` im Block `describe("saveSettings", …)` nach dem Test „updates existing settings and returns success“ einfügen:

```ts
    it("stores reminder fees in Rappen and the interest rate", async () => {
      vi.mocked(auth).mockResolvedValue(adminSession);
      vi.mocked(prisma.applicationSettings.findFirst).mockResolvedValue({
        applicationSettingsId: 1,
        companyInformationId: 2,
        smtpPassword: null,
        notifyTelegramBotToken: null,
      } as never);
      vi.mocked(prisma.companyInformation.update).mockResolvedValue({} as never);
      vi.mocked(prisma.applicationSettings.update).mockResolvedValue({} as never);

      const result = await saveSettings(
        {},
        form({
          reminderFeeLevel2: "10",
          reminderFeeLevel3: "20.50",
          reminderFeeLevel4: "30",
          reminderInterestPercent: "5",
        })
      );

      expect(result.success).toBe(true);
      expect(prisma.applicationSettings.update).toHaveBeenCalledWith({
        where: { applicationSettingsId: 1 },
        data: expect.objectContaining({
          reminderFeeLevel2Rappen: 1000,
          reminderFeeLevel3Rappen: 2050,
          reminderFeeLevel4Rappen: 3000,
          reminderInterestPercent: 5,
        }),
      });
    });

    it("defaults reminder fees and interest to 0 when the fields are empty", async () => {
      vi.mocked(auth).mockResolvedValue(adminSession);
      vi.mocked(prisma.applicationSettings.findFirst).mockResolvedValue({
        applicationSettingsId: 1,
        companyInformationId: 2,
        smtpPassword: null,
        notifyTelegramBotToken: null,
      } as never);
      vi.mocked(prisma.companyInformation.update).mockResolvedValue({} as never);
      vi.mocked(prisma.applicationSettings.update).mockResolvedValue({} as never);

      await saveSettings({}, form({}));

      expect(prisma.applicationSettings.update).toHaveBeenCalledWith({
        where: { applicationSettingsId: 1 },
        data: expect.objectContaining({
          reminderFeeLevel2Rappen: 0,
          reminderFeeLevel3Rappen: 0,
          reminderFeeLevel4Rappen: 0,
          reminderInterestPercent: 0,
        }),
      });
    });

    it("writes an audit entry when the dunning values change", async () => {
      vi.mocked(auth).mockResolvedValue(adminSession);
      vi.mocked(prisma.applicationSettings.findFirst).mockResolvedValue({
        applicationSettingsId: 1,
        companyInformationId: 2,
        smtpPassword: null,
        notifyTelegramBotToken: null,
        reminderFeeLevel2Rappen: 0,
        reminderFeeLevel3Rappen: 0,
        reminderFeeLevel4Rappen: 0,
        reminderInterestPercent: 0,
      } as never);
      vi.mocked(prisma.companyInformation.update).mockResolvedValue({} as never);
      vi.mocked(prisma.applicationSettings.update).mockResolvedValue({} as never);

      await saveSettings({}, form({ reminderFeeLevel2: "10", reminderInterestPercent: "5" }));

      expect(logAudit).toHaveBeenCalledWith(
        adminSession,
        "UPDATE",
        "Settings",
        1,
        "Mahnwesen",
        expect.objectContaining({ reminderFeeLevel2Rappen: 1000, reminderInterestPercent: 5 })
      );
    });

    it("does not audit when the dunning values stay the same", async () => {
      vi.mocked(auth).mockResolvedValue(adminSession);
      vi.mocked(prisma.applicationSettings.findFirst).mockResolvedValue({
        applicationSettingsId: 1,
        companyInformationId: 2,
        smtpPassword: null,
        notifyTelegramBotToken: null,
        reminderFeeLevel2Rappen: 1000,
        reminderFeeLevel3Rappen: 0,
        reminderFeeLevel4Rappen: 0,
        reminderInterestPercent: 5,
      } as never);
      vi.mocked(prisma.companyInformation.update).mockResolvedValue({} as never);
      vi.mocked(prisma.applicationSettings.update).mockResolvedValue({} as never);

      await saveSettings({}, form({ reminderFeeLevel2: "10", reminderInterestPercent: "5" }));

      expect(logAudit).not.toHaveBeenCalled();
    });

    it("rejects negative reminder fees and an interest rate outside 0-100", async () => {
      vi.mocked(auth).mockResolvedValue(adminSession);
      vi.mocked(prisma.applicationSettings.findFirst).mockResolvedValue(null);

      const negativeFee = await saveSettings({}, form({ reminderFeeLevel2: "-1" }));
      expect(negativeFee.error).toBe("Mahngebühren dürfen nicht negativ sein.");

      const garbage = await saveSettings({}, form({ reminderFeeLevel3: "abc" }));
      expect(garbage.error).toBe("Ungültiger Betrag.");

      const badRate = await saveSettings({}, form({ reminderInterestPercent: "101" }));
      expect(badRate.error).toBe("Der Verzugszins muss zwischen 0 und 100 % liegen.");
    });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/settings-actions.test.ts`
Expected: FAIL (Felder fehlen in `data`, Fehlermeldungen unbekannt).

- [ ] **Step 3: Schema und Migration**

In `prisma/schema.prisma`, `ApplicationSettings`, direkt nach der Zeile `reminderCooldownDays     Int                @default(14)`:

```prisma
  reminderFeeLevel2Rappen  Int                @default(0)
  reminderFeeLevel3Rappen  Int                @default(0)
  reminderFeeLevel4Rappen  Int                @default(0)
  reminderInterestPercent  Decimal            @default(0)
```

In `model SentDocument`, direkt nach `createdById    Int`:

```prisma
  // Reminder only (kind = "Reminder"): the amounts printed on the Mahnbeleg.
  openRappen     Int?
  feeRappen      Int?
  interestRappen Int?
  interestPercent Decimal?
  dunningDate    DateTime?
```

Keine neue Migration: Vor dem Anhängen prüfen, dass `20261001120000_invoicing_and_banking` in keinem Release-Tag steckt (`git tag --contains $(git log -1 --format=%h -- prisma/migrations/20261001120000_invoicing_and_banking)` liefert nichts); sonst abbrechen und nachfragen. Dann die SQL an `prisma/migrations/20261001120000_invoicing_and_banking/migration.sql` anhängen (am Dateiende, mit Leerzeile davor). Sie muss genau dem Schema entsprechen; zur Kontrolle einmal `npx prisma migrate dev --name tmp_check --create-only` ausführen, die erzeugten `ALTER TABLE`-Befehle mit den folgenden vergleichen (die Reihenfolge darf abweichen), danach den erzeugten Ordner `…_tmp_check` **löschen**. Angehängt wird:

```sql

-- F8: dunning fees, interest and the amounts printed on a Mahnbeleg
ALTER TABLE "ApplicationSettings" ADD COLUMN "reminderFeeLevel2Rappen" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "ApplicationSettings" ADD COLUMN "reminderFeeLevel3Rappen" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "ApplicationSettings" ADD COLUMN "reminderFeeLevel4Rappen" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "ApplicationSettings" ADD COLUMN "reminderInterestPercent" DECIMAL NOT NULL DEFAULT 0;

ALTER TABLE "SentDocument" ADD COLUMN "dunningDate" DATETIME;
ALTER TABLE "SentDocument" ADD COLUMN "feeRappen" INTEGER;
ALTER TABLE "SentDocument" ADD COLUMN "interestPercent" DECIMAL;
ALTER TABLE "SentDocument" ADD COLUMN "interestRappen" INTEGER;
ALTER TABLE "SentDocument" ADD COLUMN "openRappen" INTEGER;

-- The old code raised the level without a cap; level 4 is now the last one.
UPDATE "PendingReminder" SET "reminderLevel" = 4 WHERE "reminderLevel" > 4;
```

Hinweis: Die Integrationstests bauen die DB mit `prisma db push` (`tests/test-utils.ts`), die Migration selbst läuft nur über `migrate dev` und `scripts/startup.js`. Eine lokale Entwicklungs-DB, die `20261001120000_invoicing_and_banking` schon angewendet hat, meldet danach eine geänderte Prüfsumme. Das Zurücksetzen (`npx prisma migrate reset`) löscht die lokalen Daten, deshalb **vorher beim Nutzer nachfragen**; danach `npx prisma generate`. Ohne Reset läuft `scripts/startup.js` auf einer frischen DB (z. B. `DATABASE_URL=file:./data/tmp-check.db`) zur Kontrolle, dass die ganze Migrationskette durchläuft.

- [ ] **Step 4: `saveSettings` erweitern**

In `app/(app)/settings/actions.ts` die erste Zeile `await requireAdmin();` zu `const session = await requireAdmin();` ändern, `import { logAudit } from "@/lib/audit";` ergänzen (falls noch nicht importiert) und nach der Zeile `const reminderCooldown = parseInt(…);` einfügen:

```ts
  const feeToRappen = (name: string) => {
    const raw = (formData.get(name) as string | null)?.trim().replace(",", ".");
    const value = raw ? Number(raw) : 0;
    return Number.isFinite(value) ? Math.round(value * 100) : NaN;
  };
  const feeLevel2 = feeToRappen("reminderFeeLevel2");
  const feeLevel3 = feeToRappen("reminderFeeLevel3");
  const feeLevel4 = feeToRappen("reminderFeeLevel4");
  const interestRaw = (formData.get("reminderInterestPercent") as string | null)?.trim().replace(",", ".");
  const interestPercent = interestRaw ? Number(interestRaw) : 0;
```

Nach dem Block mit `"Tage-Felder müssen mindestens 1 betragen."` einfügen:

```ts
  if ([feeLevel2, feeLevel3, feeLevel4].some((fee) => Number.isNaN(fee)) || Number.isNaN(interestPercent)) {
    return { error: "Ungültiger Betrag." };
  }
  if ([feeLevel2, feeLevel3, feeLevel4].some((fee) => fee < 0)) {
    return { error: "Mahngebühren dürfen nicht negativ sein." };
  }
  if (interestPercent < 0 || interestPercent > 100) {
    return { error: "Der Verzugszins muss zwischen 0 und 100 % liegen." };
  }
```

In `appData` nach `reminderCooldownDays: …,`:

```ts
    reminderFeeLevel2Rappen: feeLevel2,
    reminderFeeLevel3Rappen: feeLevel3,
    reminderFeeLevel4Rappen: feeLevel4,
    reminderInterestPercent: interestPercent,
```

Direkt vor `revalidatePath("/settings");` in `saveSettings` (nach dem if/else mit `update`/`create`, also ausserhalb jeder Transaktion) einfügen:

```ts
  const dunningChanged =
    (settings?.reminderFeeLevel2Rappen ?? 0) !== feeLevel2 ||
    (settings?.reminderFeeLevel3Rappen ?? 0) !== feeLevel3 ||
    (settings?.reminderFeeLevel4Rappen ?? 0) !== feeLevel4 ||
    Number(settings?.reminderInterestPercent ?? 0) !== interestPercent;
  if (dunningChanged) {
    await logAudit(session, "UPDATE", "Settings", settings?.applicationSettingsId, "Mahnwesen", {
      reminderFeeLevel2Rappen: feeLevel2,
      reminderFeeLevel3Rappen: feeLevel3,
      reminderFeeLevel4Rappen: feeLevel4,
      reminderInterestPercent: interestPercent,
    });
  }
```

- [ ] **Step 5: Formular und Seite**

`app/(app)/settings/page.tsx`: nach `reminderCooldownDays={s?.reminderCooldownDays ?? 14}` ergänzen:

```tsx
          reminderFeeLevel2={(s?.reminderFeeLevel2Rappen ?? 0) / 100}
          reminderFeeLevel3={(s?.reminderFeeLevel3Rappen ?? 0) / 100}
          reminderFeeLevel4={(s?.reminderFeeLevel4Rappen ?? 0) / 100}
          reminderInterestPercent={Number(s?.reminderInterestPercent ?? 0)}
```

`app/(app)/settings/SettingsForm.tsx`: im Props-Typ nach `reminderCooldownDays: number;` ergänzen:

```ts
  reminderFeeLevel2: number;
  reminderFeeLevel3: number;
  reminderFeeLevel4: number;
  reminderInterestPercent: number;
```

Im JSX direkt nach dem `<div className="grid grid-cols-2 gap-4">…</div>`-Block mit dem Cooldown (vor `<div className="flex items-start gap-3 pt-2 border-t">`) einfügen:

```tsx
          <div className="space-y-3 pt-2 border-t">
            <div>
              <p className="text-sm font-medium">Mahngebühren und Verzugszins</p>
              <p className="text-xs text-muted-foreground">
                Standardmässig aus (0). Gebühren und Zins dürfen nur berechnet werden, wenn sie
                vereinbart sind (z. B. in den AGB). Bitte rechtlich klären.
              </p>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              {([
                ["reminderFeeLevel2", "Gebühr 1. Mahnung (CHF)", props.reminderFeeLevel2],
                ["reminderFeeLevel3", "Gebühr 2. Mahnung (CHF)", props.reminderFeeLevel3],
                ["reminderFeeLevel4", "Gebühr 3. Mahnung (CHF)", props.reminderFeeLevel4],
              ] as const).map(([name, label, value]) => (
                <div key={name} className="space-y-1">
                  <Label htmlFor={name}>{label}</Label>
                  <Input id={name} name={name} type="number" min="0" step="0.05" defaultValue={value} />
                </div>
              ))}
              <div className="space-y-1">
                <Label htmlFor="reminderInterestPercent">Verzugszins (% p. a.)</Label>
                <Input
                  id="reminderInterestPercent"
                  name="reminderInterestPercent"
                  type="number"
                  min="0"
                  max="100"
                  step="0.01"
                  defaultValue={props.reminderInterestPercent}
                />
              </div>
            </div>
          </div>
```

- [ ] **Step 6: Run tests and typecheck**

Run: `npx vitest run tests/unit/settings-actions.test.ts` → PASS
Run: `npx tsc --noEmit` → keine Fehler (Prüfen, dass alle Stellen, die `SettingsForm` rendern, die neuen Props bekommen).

- [ ] **Step 7: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20261001120000_invoicing_and_banking/migration.sql app/\(app\)/settings tests/unit/settings-actions.test.ts
git commit -m "feat(reminders): add dunning fee and interest settings

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Berechnung der Mahnbeträge

**Files:**
- Create: `lib/reminder-charges.ts`
- Test: `tests/unit/reminder-charges.test.ts`

**Interfaces:**
- Produces:
  - `export const MAX_REMINDER_LEVEL = 4`
  - `export function reminderTitle(level: number): string` (1 → `"Zahlungserinnerung"`, 2 → `"1. Mahnung"`, 3 → `"2. Mahnung"`, ab 4 → `"3. Mahnung"`)
  - `export type ReminderChargeSettings = { reminderFeeLevel2Rappen: number; reminderFeeLevel3Rappen: number; reminderFeeLevel4Rappen: number; reminderInterestPercent: { toNumber(): number } | number }`
  - `export type ReminderCharges = { level: number; openRappen: number; feeRappen: number; interestRappen: number; totalRappen: number; interestPercent: number; overdueDays: number; dunningDate: Date }`
  - `export function computeReminderCharges(input: { level: number; openRappen: number; dueDate: Date; dunningDate: Date; settings: ReminderChargeSettings }): ReminderCharges`

- [ ] **Step 1: Write the failing test**

`tests/unit/reminder-charges.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { computeReminderCharges, reminderTitle, MAX_REMINDER_LEVEL } from "@/lib/reminder-charges";

const settings = {
  reminderFeeLevel2Rappen: 1000,
  reminderFeeLevel3Rappen: 2000,
  reminderFeeLevel4Rappen: 3000,
  reminderInterestPercent: 5,
};
const off = { ...settings, reminderFeeLevel2Rappen: 0, reminderFeeLevel3Rappen: 0, reminderFeeLevel4Rappen: 0, reminderInterestPercent: 0 };
const due = new Date("2026-01-01T00:00:00Z");
const dunning = (days: number) => new Date(due.getTime() + days * 86_400_000);

describe("reminderTitle", () => {
  it("maps the four levels", () => {
    expect(reminderTitle(1)).toBe("Zahlungserinnerung");
    expect(reminderTitle(2)).toBe("1. Mahnung");
    expect(reminderTitle(3)).toBe("2. Mahnung");
    expect(reminderTitle(4)).toBe("3. Mahnung");
    expect(MAX_REMINDER_LEVEL).toBe(4);
  });
});

describe("computeReminderCharges", () => {
  it("adds nothing when fees and interest are off", () => {
    const c = computeReminderCharges({ level: 3, openRappen: 100000, dueDate: due, dunningDate: dunning(40), settings: off });
    expect(c).toMatchObject({ feeRappen: 0, interestRappen: 0, totalRappen: 100000, interestPercent: 0, overdueDays: 40 });
  });

  it("charges neither fee nor interest on the Zahlungserinnerung even if both are set", () => {
    const c = computeReminderCharges({ level: 1, openRappen: 50000, dueDate: due, dunningDate: dunning(10), settings });
    expect(c.feeRappen).toBe(0);
    expect(c.interestRappen).toBe(0);
    expect(c.totalRappen).toBe(50000);
  });

  it("works on a reduced remainder (e.g. after a credit note)", () => {
    // 250.00 CHF x 5 % x 73 / 365 = 2.50 CHF
    const c = computeReminderCharges({ level: 2, openRappen: 25000, dueDate: due, dunningDate: dunning(73), settings });
    expect(c.interestRappen).toBe(250);
    expect(c.totalRappen).toBe(25000 + 1000 + 250);
  });

  it("counts calendar days independent of the time of day and the DST change", () => {
    const c = computeReminderCharges({
      level: 2, openRappen: 100000,
      dueDate: new Date("2026-03-20T00:00:00Z"),
      dunningDate: new Date("2026-04-05T23:30:00Z"),
      settings,
    });
    expect(c.overdueDays).toBe(16);
  });

  it("picks the fee of the level", () => {
    const base = { openRappen: 50000, dueDate: due, dunningDate: dunning(0), settings: { ...settings, reminderInterestPercent: 0 } };
    expect(computeReminderCharges({ ...base, level: 2 }).feeRappen).toBe(1000);
    expect(computeReminderCharges({ ...base, level: 3 }).feeRappen).toBe(2000);
    expect(computeReminderCharges({ ...base, level: 4 }).feeRappen).toBe(3000);
  });

  it("computes interest as open x rate x days / 365, rounded to Rappen", () => {
    // 1000.00 CHF x 5 % x 73 / 365 = 10.00 CHF
    const c = computeReminderCharges({ level: 2, openRappen: 100000, dueDate: due, dunningDate: dunning(73), settings });
    expect(c.interestRappen).toBe(1000);
    expect(c.feeRappen).toBe(1000);
    expect(c.totalRappen).toBe(102000);
    // 333.33 CHF x 5 % x 30 / 365 = 1.3699 -> 1.37 CHF
    const r = computeReminderCharges({ level: 2, openRappen: 33333, dueDate: due, dunningDate: dunning(30), settings });
    expect(r.interestRappen).toBe(137);
  });

  it("charges no interest when the dunning date is not after the due date", () => {
    const c = computeReminderCharges({ level: 2, openRappen: 100000, dueDate: due, dunningDate: dunning(-5), settings });
    expect(c.overdueDays).toBe(0);
    expect(c.interestRappen).toBe(0);
  });

  it("accepts a Decimal-like interest rate", () => {
    const c = computeReminderCharges({
      level: 2, openRappen: 100000, dueDate: due, dunningDate: dunning(73),
      settings: { ...settings, reminderInterestPercent: { toNumber: () => 5 } },
    });
    expect(c.interestRappen).toBe(1000);
    expect(c.interestPercent).toBe(5);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/unit/reminder-charges.test.ts`
Expected: FAIL (Modul fehlt).

- [ ] **Step 3: Implement `lib/reminder-charges.ts`**

```ts
export const MAX_REMINDER_LEVEL = 4;

const TITLES: Record<number, string> = {
  1: "Zahlungserinnerung",
  2: "1. Mahnung",
  3: "2. Mahnung",
  4: "3. Mahnung",
};

export function reminderTitle(level: number): string {
  return TITLES[Math.min(Math.max(level, 1), MAX_REMINDER_LEVEL)];
}

export type ReminderChargeSettings = {
  reminderFeeLevel2Rappen: number;
  reminderFeeLevel3Rappen: number;
  reminderFeeLevel4Rappen: number;
  reminderInterestPercent: { toNumber(): number } | number;
};

export type ReminderCharges = {
  level: number;
  openRappen: number;
  feeRappen: number;
  interestRappen: number;
  totalRappen: number;
  interestPercent: number;
  overdueDays: number;
  dunningDate: Date;
};

const DAY_MS = 86_400_000;

function feeForLevel(level: number, settings: ReminderChargeSettings): number {
  if (level <= 1) return 0;
  if (level === 2) return settings.reminderFeeLevel2Rappen;
  if (level === 3) return settings.reminderFeeLevel3Rappen;
  return settings.reminderFeeLevel4Rappen;
}

/**
 * Amounts printed on a Mahnbeleg. The invoice itself is not changed: fee and
 * interest only appear on the document, on the QR slip and in SentDocument.
 */
export function computeReminderCharges(input: {
  level: number;
  openRappen: number;
  dueDate: Date;
  dunningDate: Date;
  settings: ReminderChargeSettings;
}): ReminderCharges {
  const { level, openRappen, dueDate, dunningDate, settings } = input;
  const rate = settings.reminderInterestPercent;
  const interestPercent = typeof rate === "number" ? rate : rate.toNumber();
  const utcDay = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const overdueDays = Math.max(0, Math.round((utcDay(dunningDate) - utcDay(dueDate)) / DAY_MS));
  const interestRappen =
    level > 1 && interestPercent > 0 && overdueDays > 0
      ? Math.round((openRappen * (interestPercent / 100) * overdueDays) / 365)
      : 0;
  const feeRappen = feeForLevel(level, settings);

  return {
    level,
    openRappen,
    feeRappen,
    interestRappen,
    totalRappen: openRappen + feeRappen + interestRappen,
    interestPercent,
    overdueDays,
    dunningDate,
  };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/unit/reminder-charges.test.ts` → PASS

- [ ] **Step 5: Commit**

```bash
git add lib/reminder-charges.ts tests/unit/reminder-charges.test.ts
git commit -m "feat(reminders): add dunning charge calculation

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Mahnbeleg-PDF

**Files:**
- Modify: `lib/pdf/document-pdf.ts` (`RenderDoc`, Tabellenteil, Summenteil, Schlussnotiz)
- Create: `lib/pdf/reminder-pdf.ts`
- Test: `tests/unit/reminder-pdf.test.ts`

**Interfaces:**
- Consumes: `ReminderCharges`, `reminderTitle` aus `lib/reminder-charges.ts` (Task 2); `buildQrBillData` aus `lib/pdf/qrbill-helpers.ts`; `InvoiceWithDetails` aus `lib/pdf/invoice-pdf.ts`.
- Produces:
  - `RenderDoc.kind` wird `"invoice" | "quote" | "reminder"`; neues optionales Feld `amountLines?: { label: string; amount: number }[]` (CHF) und `overdueNote?: string`.
  - `export async function generateReminderPdf(invoice: InvoiceWithDetails, settings: ApplicationSettings & { companyInfo: CompanyInformation }, charges: ReminderCharges): Promise<Buffer>`

- [ ] **Step 1: Write the failing test**

`tests/unit/reminder-pdf.test.ts` (Hilfsfunktion `extractText` wie in `tests/unit/document-pdf-generation.test.ts`):

```ts
import { describe, it, expect, beforeAll } from "vitest";
import path from "path";
import { generateReminderPdf } from "@/lib/pdf/reminder-pdf";
import { computeReminderCharges } from "@/lib/reminder-charges";

let pdfjsLib: typeof import("pdfjs-dist/legacy/build/pdf.mjs");
let standardFontDataUrl: string;

beforeAll(async () => {
  pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");
  standardFontDataUrl =
    path
      .join(path.dirname(require.resolve("pdfjs-dist/package.json")), "standard_fonts")
      .split(path.sep)
      .join("/") + "/";
});

async function extractText(buf: Buffer): Promise<{ numPages: number; pageText: string[] }> {
  const doc = await pdfjsLib.getDocument({ data: new Uint8Array(buf), standardFontDataUrl }).promise;
  const pageText: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    pageText.push(content.items.map((it) => ("str" in it ? it.str : "")).join(" "));
  }
  return { numPages: doc.numPages, pageText };
}

const customer = {
  customerId: 1, contactInsteadOfCompany: false, company: "Muster AG", contactPerson: "Anna Beispiel",
  street: "Weg", houseNumber: "1", zipCode: "8000", city: "Zürich", country: "CH", email: "a@b.ch",
};
const invoice = {
  id: 1, documentNumber: "I-26010001", customerId: 1, date: new Date("2026-01-01"),
  dueDate: new Date("2026-01-31"), totalAmount: 1000, discountPercent: 0, customUserText: null,
  creditNoteForId: null, state: "Overdue", customer, items: [],
} as never;
const settings = {
  numberFormat: "de-CH", pdfTheme: null, useHolderNameOnQR: false, reminderCooldownDays: 14,
  reminderFeeLevel2Rappen: 1000, reminderFeeLevel3Rappen: 2000, reminderFeeLevel4Rappen: 3000,
  reminderInterestPercent: 5,
  companyInfo: {
    companyName: "Firma AG", companyHolderName: "Inhaber", companyStreet: "Bahnhofstrasse",
    companyHouseNumber: "1", companyZip: "8000", companyCity: "Zürich", companyCountry: "CH",
    companyIBAN: "CH9300762011623852957",
  },
} as never;

function charges(level: number, days = 73) {
  const due = new Date("2026-01-31T00:00:00Z");
  return computeReminderCharges({
    level, openRappen: 100000, dueDate: due,
    dunningDate: new Date(due.getTime() + days * 86_400_000),
    settings: settings as never,
  });
}

describe("generateReminderPdf", () => {
  it.each([[1, "Zahlungserinnerung"], [2, "1. Mahnung"], [3, "2. Mahnung"], [4, "3. Mahnung"]])(
    "level %i is titled %s and not Rechnung",
    async (level, title) => {
      const buf = await generateReminderPdf(invoice, settings, charges(level));
      const { pageText } = await extractText(buf);
      expect(pageText[0]).toContain(title);
      expect(pageText[0]).not.toContain("Beschreibung"); // no items table
      expect(pageText[0]).not.toContain("Menge");
      expect(pageText[0]).toContain("I-26010001");
    }
  );

  it("shows open amount, fee, interest and the total, and puts the total on the QR slip", async () => {
    const buf = await generateReminderPdf(invoice, settings, charges(2));
    const { numPages, pageText } = await extractText(buf);
    const first = pageText[0];
    expect(first).toContain("Offener Betrag");
    expect(first).toContain("Mahngebühr");
    expect(first).toContain("Verzugszins");
    expect(first).toContain("1’020.00");
    expect(numPages).toBe(2);
    expect(pageText[1]).toContain("1 020.00");
  });

  it("prints no overdue note when the due date is the dunning date", async () => {
    const due = new Date("2026-01-31T00:00:00Z");
    const c = computeReminderCharges({ level: 2, openRappen: 100000, dueDate: due, dunningDate: due, settings: settings as never });
    const { pageText } = await extractText(await generateReminderPdf(invoice, settings, c));
    expect(pageText[0]).not.toContain("überfällig");
  });

  it("omits fee and interest lines when they are zero", async () => {
    const off = { ...(settings as object), reminderFeeLevel2Rappen: 0, reminderInterestPercent: 0 } as never;
    const c = computeReminderCharges({
      level: 2, openRappen: 100000, dueDate: new Date("2026-01-31"), dunningDate: new Date("2026-03-15"), settings: off,
    });
    const { pageText } = await extractText(await generateReminderPdf(invoice, off, c));
    expect(pageText[0]).not.toContain("Mahngebühr");
    expect(pageText[0]).not.toContain("Verzugszins");
    expect(pageText[0]).toContain("Offener Betrag");
  });
});
```

Hinweis: die Tausendertrenner von `Intl.NumberFormat("de-CH")` (`’`) und die QR-Seite (`1 020.00` mit schmalem Leerzeichen) hängen von der ICU-Version ab. Läuft der Test rot wegen der Formatierung, den tatsächlichen Text einmal mit `console.log(pageText)` ansehen und die zwei Erwartungen auf die ausgegebene Schreibweise anpassen; die inhaltliche Aussage (Total 1020.00 steht auf Seite 1 und auf dem QR-Teil) bleibt.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/unit/reminder-pdf.test.ts`
Expected: FAIL (Modul fehlt).

- [ ] **Step 3: `RenderDoc` erweitern**

In `lib/pdf/document-pdf.ts`:

`kind: "invoice" | "quote";` ersetzen durch `kind: "invoice" | "quote" | "reminder";` und nach dem Feld `draft: boolean;` im Typ ergänzen:

```ts
  /** Reminder only: replaces the items table by label/amount rows (CHF). */
  amountLines?: { label: string; amount: number }[];
  /** Reminder only: one line printed under the document details, e.g. the days overdue. */
  overdueNote?: string;
```

In `detailRows` ist `["Bezug:", doc.referenceLine]` bereits vorhanden; keine Änderung.

Direkt vor dem Kommentar `// ── Items table header ──` einen Zweig einfügen, der für `reminder` die Betragstabelle zeichnet und die Positionstabelle und Summen überspringt. Dafür den gesamten Abschnitt von `// ── Items table header ──` bis einschliesslich der Zeile `rule(y, 1.5); y += 16;` (Ende von „Totals“) in einen `if (doc.kind !== "reminder") { … }`-Block fassen und davor/danach den Reminder-Zweig einfügen:

```ts
    if (doc.kind === "reminder") {
      if (doc.overdueNote) {
        pdf.font(FONT).fontSize(BASE).fillColor(TEXT_COLOR);
        pdf.text(doc.overdueNote, MARGIN, y, { width: CONTENT_W });
        y += pdf.heightOfString(doc.overdueNote, { width: CONTENT_W }) + 12;
      }
      rule(y, 0.5);
      y += 8;
      pdf.font(FONT).fontSize(BASE).fillColor(TEXT_COLOR);
      for (const line of doc.amountLines ?? []) {
        pdf.text(line.label, MARGIN, y);
        pdf.text(`CHF ${fmt(line.amount, locale)}`, MARGIN, y, { width: CONTENT_W, align: "right" });
        y += LINE_HEIGHT + 4;
      }
      y += 2;
      rule(y, 0.5);
      y += 8;
      pdf.font(BOLD).fontSize(TOTAL).fillColor(TEXT_COLOR);
      pdf.text("Gesamtbetrag", MARGIN, y);
      pdf.text(`CHF ${fmt(doc.totalAmount, locale)}`, MARGIN, y, { width: CONTENT_W, align: "right" });
      y += TOTAL + 7;
      rule(y, 1.5);
      y += 16;
    } else {
      /* bestehender Code von „Items table header“ bis „Totals“, unverändert eingerückt */
    }
```

Der Rest (`Payment note + optional closing block`, QR-Seite) bleibt unverändert und gilt auch für den Mahnbeleg: `closingNoteLabel` wird als „Zahlbar bis:“ ausgegeben, wenn `dueDate !== null`.

- [ ] **Step 4: `lib/pdf/reminder-pdf.ts` schreiben**

```ts
import type { ApplicationSettings, CompanyInformation } from "@prisma/client";
import { buildQrBillData } from "@/lib/pdf/qrbill-helpers";
import { generateDocumentPdf, type RenderDoc } from "@/lib/pdf/document-pdf";
import type { InvoiceWithDetails } from "@/lib/pdf/invoice-pdf";
import { reminderTitle, type ReminderCharges } from "@/lib/reminder-charges";

type Settings = ApplicationSettings & { companyInfo: CompanyInformation };

const DAY_MS = 86_400_000;

function formatDate(date: Date, locale: string): string {
  return new Intl.DateTimeFormat(locale, { day: "2-digit", month: "2-digit", year: "numeric" }).format(date);
}

/**
 * Mahnbeleg for an overdue invoice. The QR slip requests the total (open amount
 * plus fee and interest); the invoice itself is not changed.
 */
export async function generateReminderPdf(
  invoice: InvoiceWithDetails,
  settings: Settings,
  charges: ReminderCharges
): Promise<Buffer> {
  if (!invoice.documentNumber) throw new Error("Rechnung hat noch keine Nummer.");
  const company = settings.companyInfo;
  const locale = settings.numberFormat ?? "de-CH";
  const total = charges.totalRappen / 100;

  const amountLines: { label: string; amount: number }[] = [
    { label: "Offener Betrag", amount: charges.openRappen / 100 },
  ];
  if (charges.feeRappen > 0) amountLines.push({ label: "Mahngebühr", amount: charges.feeRappen / 100 });
  if (charges.interestRappen > 0) {
    amountLines.push({
      label: `Verzugszins (${charges.interestPercent} % p. a., ${charges.overdueDays} Tage)`,
      amount: charges.interestRappen / 100,
    });
  }

  const paymentDeadline = new Date(charges.dunningDate.getTime() + (settings.reminderCooldownDays ?? 14) * DAY_MS);

  const doc: RenderDoc = {
    kind: "reminder",
    title: reminderTitle(charges.level),
    documentNumber: invoice.documentNumber,
    numberLabel: "Rechnungs-Nr.:",
    date: charges.dunningDate,
    dueDate: paymentDeadline,
    dueLabel: "Zahlbar bis:",
    closingNoteLabel: "Zahlbar bis:",
    referenceLine: `Rechnung ${invoice.documentNumber} vom ${formatDate(invoice.date, locale)}, fällig am ${formatDate(invoice.dueDate, locale)}`,
    overdueNote:
      charges.overdueDays > 0
        ? `Die Rechnung ist seit ${charges.overdueDays} Tagen überfällig. Bitte überweisen Sie den offenen Betrag bis zum angegebenen Datum.`
        : undefined,
    customUserText: null,
    totalAmount: total,
    customer: invoice.customer,
    items: [],
    amountLines,
    qr: buildQrBillData({
      invoice: { documentNumber: invoice.documentNumber, totalAmount: total },
      company: { ...company, useHolderNameOnQR: settings.useHolderNameOnQR },
      customer: invoice.customer,
    }),
    draft: false,
  };

  return generateDocumentPdf(doc, company, locale, settings.pdfTheme);
}
```

Hinweis: `detailRows` in `document-pdf.ts` gibt `doc.date` unter „Datum:“ aus (hier das Mahndatum), `dueLabel`/`dueDate` die Zahlungsfrist und `referenceLine` unter „Bezug:“ die Rechnung.

- [ ] **Step 5: Run to verify it passes**

Run: `npx vitest run tests/unit/reminder-pdf.test.ts tests/unit/document-pdf-generation.test.ts`
Expected: PASS (die bestehenden Rechnungs- und Offerten-Tests dürfen sich nicht ändern).

- [ ] **Step 6: Commit**

```bash
git add lib/pdf/document-pdf.ts lib/pdf/reminder-pdf.ts tests/unit/reminder-pdf.test.ts
git commit -m "feat(reminders): render a dedicated dunning notice PDF

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Versand mit Mahnbeleg und gespeicherten Beträgen

**Files:**
- Modify: `lib/invoice-dispatch.ts` (`renderArchiveAndSend`, `sentDocumentData`)
- Modify: `lib/email.ts` (Anhangname in `sendInvoiceEmail`)
- Modify: `lib/reminders.ts` (`isLastReminderLevelSent`)
- Modify: `lib/pdf/invoice-pdf.ts` (Option `qrAmount` entfernen)
- Modify: `app/(app)/invoices/reminders/actions.ts` (`sendReminder`)
- Test: `tests/unit/invoice-dispatch.test.ts`, `tests/unit/invoice-sub-actions.test.ts`, `tests/unit/email-send.test.ts`, `tests/unit/document-pdf-generation.test.ts`, `tests/integration/invoice-dispatch.test.ts`, `tests/integration/reminders.test.ts`

**Interfaces:**
- Consumes: `computeReminderCharges`, `MAX_REMINDER_LEVEL`, `ReminderCharges` (Task 2); `generateReminderPdf` (Task 3); `getPaymentSummary(invoiceId).remainingRappen`; die neuen Spalten aus Task 1.
- Produces:
  - `renderArchiveAndSend` akzeptiert `renderPdf?: () => Promise<Buffer>` und `attachmentName?: string`; `renderPdf` ersetzt das Rendern von `generateInvoicePdf`. Der bisherige Parameter `pdfOptions` (und `qrAmount` in `generateInvoicePdf`) entfällt, weil nur Mahnungen ihn nutzten.
  - `sendInvoiceEmail(invoice, settings, pdf, overrides?: { to?; subject?; body?; attachmentName? })`.
  - `sentDocumentData` akzeptiert zusätzlich `charges?: ReminderCharges` und schreibt `openRappen`, `feeRappen`, `interestRappen`, `interestPercent`, `dunningDate` **nur**, wenn `charges` gesetzt ist (sonst fehlen die Schlüssel, damit das bestehende `toEqual` für Rechnungen gültig bleibt).
  - `isLastReminderLevelSent(prisma: PrismaClient, reminder: { invoiceId: number; reminderLevel: number; createdAt: Date }): Promise<boolean>` in `lib/reminders.ts`.

- [ ] **Step 1: Write the failing tests**

`tests/unit/invoice-dispatch.test.ts`: den Test „forwards PDF options such as the QR amount“ **löschen**. Daneben ergänzen (die Datei mockt `generateInvoicePdf`, `archivePdf` und `sendInvoiceEmail` bereits; `invoice`, `settings`, `mail` und `archive`/`actor` stammen aus dem bestehenden Aufbau der Datei):

```ts
  it("uses renderPdf instead of generateInvoicePdf when provided", async () => {
    const custom = Buffer.from("%PDF-reminder");
    const renderPdf = vi.fn().mockResolvedValue(custom);
    await renderArchiveAndSend({ invoice, settings, kind: "Reminder", mail, renderPdf });
    expect(renderPdf).toHaveBeenCalledTimes(1);
    expect(generateInvoicePdf).not.toHaveBeenCalled();
    expect(sendInvoiceEmail).toHaveBeenCalledWith(invoice, settings, custom, mail);
    expect(archivePdf).toHaveBeenCalledWith(expect.objectContaining({ kind: "Reminder", pdf: custom }));
  });

  it("passes the attachment name to the mail", async () => {
    const renderPdf = vi.fn().mockResolvedValue(Buffer.from("%PDF"));
    await renderArchiveAndSend({ invoice, settings, kind: "Reminder", mail, renderPdf, attachmentName: "mahnung-X-stufe2.pdf" });
    expect(sendInvoiceEmail).toHaveBeenCalledWith(invoice, settings, expect.any(Buffer), {
      ...mail,
      attachmentName: "mahnung-X-stufe2.pdf",
    });
  });
```

Im `describe("sentDocumentData", …)` derselben Datei bleibt der Test „builds the create input including the acting user“ unverändert (ohne `charges` fehlen die neuen Schlüssel). Ergänzen:

```ts
  it("stores the reminder amounts when charges are given", () => {
    const dunningDate = new Date("2026-03-01");
    const data = sentDocumentData({
      invoiceId: 1, documentNumber: "I-26090001", kind: "Reminder", reminderLevel: 2, archive,
      sentTo: "a@b.ch", subject: "Mahnung", actor,
      charges: { level: 2, openRappen: 100000, feeRappen: 1000, interestRappen: 250, totalRappen: 101250, interestPercent: 5, overdueDays: 20, dunningDate },
    });
    expect(data).toMatchObject({ openRappen: 100000, feeRappen: 1000, interestRappen: 250, interestPercent: 5, dunningDate });
  });
```

`tests/unit/email-send.test.ts` im Block `describe("sendInvoiceEmail", …)` ergänzen:

```ts
    it("uses the attachment name override (reminders)", async () => {
      await sendInvoiceEmail(makeInvoice(), makeSettings(), Buffer.from("pdf"), { attachmentName: "mahnung-R-2026-001-stufe2.pdf" });
      expect(mockSendMail.mock.calls[0][0].attachments[0].filename).toBe("mahnung-R-2026-001-stufe2.pdf");
    });
```

`tests/unit/document-pdf-generation.test.ts`: den Test „uses qrAmount instead of the invoice total on the QR slip“ löschen.

`tests/unit/invoice-sub-actions.test.ts`:
1. Mocks ergänzen: `vi.mock("@/lib/pdf/reminder-pdf", () => ({ generateReminderPdf: vi.fn() }));` und `import { generateReminderPdf } from "@/lib/pdf/reminder-pdf";`. `getPaymentSummary`-Mock bleibt.
2. `mockInvoice` erhält `dueDate: new Date("2026-01-01")`, `date: new Date("2025-12-01")`; `mockSettings` erhält `reminderFeeLevel2Rappen: 0, reminderFeeLevel3Rappen: 0, reminderFeeLevel4Rappen: 0, reminderInterestPercent: 0`.
3. In allen `sendReminder`-Tests `generateInvoicePdf`-Mocks durch `generateReminderPdf` ersetzen (`vi.mocked(generateReminderPdf).mockResolvedValue(Buffer.from("pdf") as never)`; im Fehlerfall `.mockRejectedValue(new Error("PDF error"))`; Erwartung „expect(generateInvoicePdf).toHaveBeenCalled()“ wird `expect(generateReminderPdf).toHaveBeenCalled()`).
4. Den Test „requests only the remaining amount (after credit notes) on the QR slip“ ersetzen durch:

```ts
    it("renders the Mahnbeleg for the open remainder plus the level's fee", async () => {
      vi.mocked(auth).mockResolvedValue(editorSession);
      vi.mocked(prisma.pendingReminder.findUnique).mockResolvedValue({
        id: 1, invoiceId: 1, reminderLevel: 2, invoice: mockInvoice,
      } as never);
      vi.mocked(prisma.applicationSettings.findFirst).mockResolvedValue(
        { ...mockSettings, reminderFeeLevel2Rappen: 1000 } as never
      );
      vi.mocked(getPaymentSummary).mockResolvedValueOnce({ remainingRappen: 60000 } as never);
      vi.mocked(generateReminderPdf).mockResolvedValue(Buffer.from("pdf"));
      vi.mocked(sendInvoiceEmail).mockResolvedValue(undefined);
      vi.mocked(prisma.$transaction).mockResolvedValue([{}, {}, { id: 1 }] as never);
      await sendReminder({}, form({ reminderId: "1", to: "x@x.ch", subject: "s", body: "b" }));
      expect(generateReminderPdf).toHaveBeenCalledWith(
        mockInvoice,
        expect.objectContaining({ reminderFeeLevel2Rappen: 1000 }),
        expect.objectContaining({ level: 2, openRappen: 60000, feeRappen: 1000, totalRappen: 61000 })
      );
    });

    it("refuses to send when nothing is open any more", async () => {
      vi.mocked(auth).mockResolvedValue(editorSession);
      vi.mocked(prisma.pendingReminder.findUnique).mockResolvedValue({
        id: 1, invoiceId: 1, reminderLevel: 2, invoice: mockInvoice,
      } as never);
      vi.mocked(prisma.applicationSettings.findFirst).mockResolvedValue(mockSettings as never);
      vi.mocked(getPaymentSummary).mockResolvedValueOnce({ remainingRappen: 0 } as never);
      const result = await sendReminder({}, form({ reminderId: "1", to: "x@x.ch", subject: "s", body: "b" }));
      expect(result.error).toBe("Die Rechnung ist bereits beglichen.");
      expect(sendInvoiceEmail).not.toHaveBeenCalled();
    });

    it("refuses another reminder after the last level", async () => {
      vi.mocked(auth).mockResolvedValue(editorSession);
      vi.mocked(prisma.pendingReminder.findUnique).mockResolvedValue({
        id: 1, invoiceId: 1, reminderLevel: 5, invoice: mockInvoice,
      } as never);
      vi.mocked(prisma.applicationSettings.findFirst).mockResolvedValue(mockSettings as never);
      const result = await sendReminder({}, form({ reminderId: "1", to: "x@x.ch", subject: "s", body: "b" }));
      expect(result.error).toBe("Die letzte Mahnstufe wurde bereits versendet.");
      expect(sendInvoiceEmail).not.toHaveBeenCalled();
    });
```

5. In „archives the reminder PDF and records a SentDocument …“ die Erwartung erweitern: `data: expect.objectContaining({ invoiceId: 10, kind: "Reminder", reminderLevel: 2, openRappen: 50000, feeRappen: 0, interestRappen: 0 })`. Weil `vi.clearAllMocks()` Implementierungen nicht zurücksetzt, im `beforeEach` des Blocks `describe("invoices/reminders actions", …)` zusätzlich `vi.mocked(getPaymentSummary).mockResolvedValue({ remainingRappen: 50000 } as never);` setzen; alle neuen Tests nutzen `mockResolvedValueOnce`.

`tests/integration/invoice-dispatch.test.ts`:
1. Mock `vi.mock("@/lib/pdf/reminder-pdf", () => ({ generateReminderPdf: vi.fn() }));`, Import ergänzen, in `beforeEach` `vi.mocked(generateReminderPdf).mockResolvedValue(pdf);` setzen.
2. Test „sendReminder archives with the reminder level at send time“ erweitern (`expectArchivedAndAttached` liest die Mail-Bytes aus `sendInvoiceEmail`, das bleibt gültig):

```ts
    expect(row.openRappen).toBe(10000);
    expect(row.feeRappen).toBe(0);
    expect(row.interestRappen).toBe(0);
    expect(row.dunningDate).not.toBeNull();
    expect(generateInvoicePdf).not.toHaveBeenCalled();
```

3. Neue Tests:

```ts
  it("sendReminder stores fee and interest on the SentDocument", async () => {
    await db.prisma.applicationSettings.updateMany({
      data: { reminderFeeLevel2Rappen: 1000, reminderInterestPercent: 5 },
    });
    const invoice = await seedInvoice();
    await db.prisma.invoice.update({
      where: { id: invoice.id },
      data: { dueDate: new Date(Date.now() - 73 * 86_400_000), totalAmount: 1000 },
    });
    const reminder = await db.prisma.pendingReminder.create({ data: { invoiceId: invoice.id, reminderLevel: 2 } });

    const result = await sendReminder({}, form({ reminderId: String(reminder.id), to: "a@b.ch", subject: "M", body: "T" }));

    expect(result.success).toBe(true);
    const row = await db.prisma.sentDocument.findFirstOrThrow();
    expect(row.openRappen).toBe(100000);
    expect(row.feeRappen).toBe(1000);
    expect(row.interestRappen).toBeGreaterThan(900); // 5 % x 73 Tage, +-1 Tag je nach Uhrzeit
    expect(row.interestRappen).toBeLessThan(1100);
    expect(Number(row.interestPercent)).toBe(5);
  });

  it("sendReminder stops after the last level and keeps level 4", async () => {
    const invoice = await seedInvoice();
    const reminder = await db.prisma.pendingReminder.create({ data: { invoiceId: invoice.id, reminderLevel: 4 } });

    const first = await sendReminder({}, form({ reminderId: String(reminder.id), to: "a@b.ch", subject: "M", body: "T" }));
    expect(first.success).toBe(true);
    expect((await db.prisma.pendingReminder.findUniqueOrThrow({ where: { id: reminder.id } })).reminderLevel).toBe(4);

    const second = await sendReminder({}, form({ reminderId: String(reminder.id), to: "a@b.ch", subject: "M", body: "T" }));
    expect(second.error).toBe("Die letzte Mahnstufe wurde bereits versendet.");
    expect(await db.prisma.sentDocument.count()).toBe(1);
  });

  it("sendReminder names the attachment after the level", async () => {
    const invoice = await seedInvoice();
    const reminder = await db.prisma.pendingReminder.create({ data: { invoiceId: invoice.id, reminderLevel: 2 } });
    await sendReminder({}, form({ reminderId: String(reminder.id), to: "a@b.ch", subject: "M", body: "T" }));
    expect(vi.mocked(sendInvoiceEmail).mock.calls[0][3]).toMatchObject({ attachmentName: "mahnung-I-26090001-stufe2.pdf" });
  });
```

Damit der zweite Aufruf „letzte Stufe bereits versendet“ erkennt, bleibt der Zustand nach dem Versand von Level 4 an der `SentDocument`-Zeile erkennbar: `isLastReminderLevelSent` (Step 3) zählt die Zeilen mit `kind = "Reminder"` und `reminderLevel = 4` seit `PendingReminder.createdAt`. Der Unit-Test oben (`reminderLevel: 5`) deckt „Level über Deckel“ ab, der Integrationstest „Level 4 schon gesendet“. Im Unit-Test deshalb `sentDocument: { create: …, count: vi.fn().mockResolvedValue(0) }` in den Prisma-Mock aufnehmen (der Helper `isLastReminderLevelSent` ruft `count` erst ab Level 4 auf, Level 5 ist ohne Abfrage „gesperrt“).

- [ ] **Step 2: Run to verify the tests fail**

Run: `npx vitest run tests/unit/invoice-dispatch.test.ts tests/unit/invoice-sub-actions.test.ts tests/integration/invoice-dispatch.test.ts`
Expected: FAIL.

- [ ] **Step 3: `lib/reminders.ts`, `lib/email.ts`, `lib/pdf/invoice-pdf.ts`, `lib/invoice-dispatch.ts`**

`lib/reminders.ts`: Import `import { MAX_REMINDER_LEVEL } from "@/lib/reminder-charges";` ergänzen und am Dateiende einfügen:

```ts
/**
 * True once the last level (4) has been sent for this reminder. Counted from the
 * reminder's creation on, so a reminder that restarts after a reset (payment
 * deleted, status back to Sent) is not blocked by an older level-4 notice.
 */
export async function isLastReminderLevelSent(
  prisma: PrismaClient,
  reminder: { invoiceId: number; reminderLevel: number; createdAt: Date }
): Promise<boolean> {
  if (reminder.reminderLevel > MAX_REMINDER_LEVEL) return true;
  if (reminder.reminderLevel < MAX_REMINDER_LEVEL) return false;
  const sent = await prisma.sentDocument.count({
    where: {
      invoiceId: reminder.invoiceId,
      kind: "Reminder",
      reminderLevel: MAX_REMINDER_LEVEL,
      createdAt: { gte: reminder.createdAt },
    },
  });
  return sent > 0;
}
```

Test dazu in `tests/integration/reminders.test.ts` (neuer eigener `describe`, der Import der Datei wird zu `import { checkOverdueInvoices, isLastReminderLevelSent } from "@/lib/reminders";`):

```ts
describe("isLastReminderLevelSent", () => {
  const db = createTestDatabase();

  async function seed() {
    const customer = await db.prisma.customer.create({ data: createValidTestCustomer() });
    return db.prisma.invoice.create({
      data: {
        customerId: customer.customerId, documentNumber: "I-26090001", date: new Date(),
        dueDate: new Date(Date.now() - 5 * 86_400_000), totalAmount: 500, state: "Overdue",
      },
    });
  }
  function sentLevel4(invoiceId: number, createdAt: Date) {
    return db.prisma.sentDocument.create({
      data: {
        invoiceId, kind: "Reminder", reminderLevel: 4, documentNumber: "I-26090001",
        path: `2026/x-${createdAt.getTime()}.pdf`, sha256: "a".repeat(64), size: 1,
        sentTo: "a@b.ch", subject: "M", createdById: 1, createdAt,
      },
    });
  }

  it("is false below level 4 and true above it", async () => {
    const inv = await seed();
    const r = await db.prisma.pendingReminder.create({ data: { invoiceId: inv.id, reminderLevel: 3 } });
    expect(await isLastReminderLevelSent(db.prisma, r)).toBe(false);
    expect(await isLastReminderLevelSent(db.prisma, { ...r, reminderLevel: 5 })).toBe(true);
  });

  it("is true once a level-4 notice was sent for this reminder", async () => {
    const inv = await seed();
    const r = await db.prisma.pendingReminder.create({ data: { invoiceId: inv.id, reminderLevel: 4 } });
    expect(await isLastReminderLevelSent(db.prisma, r)).toBe(false);
    await sentLevel4(inv.id, new Date(r.createdAt.getTime() + 1000));
    expect(await isLastReminderLevelSent(db.prisma, r)).toBe(true);
  });

  it("ignores a level-4 notice from before the reminder was recreated", async () => {
    const inv = await seed();
    await sentLevel4(inv.id, new Date(Date.now() - 60_000));
    const fresh = await db.prisma.pendingReminder.create({ data: { invoiceId: inv.id, reminderLevel: 4 } });
    expect(await isLastReminderLevelSent(db.prisma, fresh)).toBe(false);
  });
});
```

`lib/email.ts`: `overrides?: { to?: string; subject?: string; body?: string }` ersetzen durch `overrides?: { to?: string; subject?: string; body?: string; attachmentName?: string }` und die Zeile `const filename = …` durch:

```ts
  const filename =
    overrides?.attachmentName ?? `${isCreditNote ? "gutschrift" : "rechnung"}-${invoice.documentNumber}.pdf`;
```

`lib/pdf/invoice-pdf.ts`: Parameter `options: { qrAmount?: number } = {}` samt Kommentar entfernen, `totalAmount: options.qrAmount ?? total` zu `totalAmount: total` ändern.

`lib/invoice-dispatch.ts`: Import `import type { ReminderCharges } from "@/lib/reminder-charges";` ergänzen. In `renderArchiveAndSend` den Parameter `pdfOptions?: { qrAmount?: number };` samt Kommentar ersetzen durch:

```ts
  /** Replaces the default invoice rendering (reminders pass the Mahnbeleg renderer). */
  renderPdf?: () => Promise<Buffer>;
  /** Attachment file name; defaults to the invoice naming in `sendInvoiceEmail`. */
  attachmentName?: string;
```

Destrukturierung `const { invoice, settings, kind, mail, renderPdf, attachmentName } = params;`, das Rendern ersetzen durch

```ts
  const pdf = renderPdf ? await renderPdf() : await generateInvoicePdf(invoice, settings);
```

und den Versand `await sendInvoiceEmail(invoice, settings, pdf, mail);` ersetzen durch

```ts
  await sendInvoiceEmail(invoice, settings, pdf, attachmentName ? { ...mail, attachmentName } : mail);
```

`sentDocumentData`: Parameter `charges?: ReminderCharges;` und im zurückgegebenen Objekt ergänzen:

```ts
    openRappen: params.charges?.openRappen ?? null,
    feeRappen: params.charges?.feeRappen ?? null,
    interestRappen: params.charges?.interestRappen ?? null,
    interestPercent: params.charges ? params.charges.interestPercent : null,
    dunningDate: params.charges?.dunningDate ?? null,
```

- [ ] **Step 4: `sendReminder`**

In `app/(app)/invoices/reminders/actions.ts` Imports ergänzen:

```ts
import { generateReminderPdf } from "@/lib/pdf/reminder-pdf";
import { computeReminderCharges, MAX_REMINDER_LEVEL } from "@/lib/reminder-charges";
import { isLastReminderLevelSent } from "@/lib/reminders";
```

Nach `if (!settings) return { error: "Einstellungen nicht konfiguriert." };` einfügen:

```ts
  if (await isLastReminderLevelSent(prisma, reminder)) {
    return { error: "Die letzte Mahnstufe wurde bereits versendet." };
  }
```

Den Block `let archive: ArchiveResult; try { … }` ersetzen durch (der Rest-0-Check liegt vor dem Rendern):

```ts
  let archive: ArchiveResult;
  let charges: ReturnType<typeof computeReminderCharges>;
  try {
    const { remainingRappen } = await getPaymentSummary(reminder.invoiceId);
    if (remainingRappen <= 0) return { error: "Die Rechnung ist bereits beglichen." };
    charges = computeReminderCharges({
      level: reminder.reminderLevel,
      openRappen: remainingRappen,
      dueDate: reminder.invoice.dueDate,
      dunningDate: new Date(),
      settings,
    });
    archive = await renderArchiveAndSend({
      invoice: reminder.invoice,
      settings,
      kind: "Reminder",
      mail: { to, subject, body },
      renderPdf: () => generateReminderPdf(reminder.invoice, settings, charges),
      attachmentName: `mahnung-${reminder.invoice.documentNumber}-stufe${reminder.reminderLevel}.pdf`,
    });
  } catch (err) {
    log.error({ reminderId, to, err }, "sendReminder failed");
    return { error: err instanceof Error ? err.message : "Fehler beim Senden." };
  }
```

In der Transaktion `reminderLevel: reminder.reminderLevel + 1` ersetzen durch `reminderLevel: Math.min(reminder.reminderLevel + 1, MAX_REMINDER_LEVEL)` und im `sentDocumentData({…})`-Aufruf `charges,` ergänzen. Im `logAudit(… "SEND", "Reminder", …)`-Details-Objekt `feeRappen: charges.feeRappen, interestRappen: charges.interestRappen,` ergänzen.

Hinweis: Level 4 bleibt nach dem Versand auf 4 stehen und `snoozedUntil` wird gesetzt wie bei jeder Mahnung; der Zähler auf `SentDocument` verhindert den erneuten Versand (siehe Test).

- [ ] **Step 5: Run to verify tests pass**

Run: `npx vitest run tests/unit/invoice-dispatch.test.ts tests/unit/invoice-sub-actions.test.ts tests/integration/invoice-dispatch.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add lib/invoice-dispatch.ts app/\(app\)/invoices/reminders/actions.ts tests/unit/invoice-dispatch.test.ts tests/unit/invoice-sub-actions.test.ts tests/integration/invoice-dispatch.test.ts
git commit -m "feat(reminders): send the dunning notice and store its amounts

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Mahnliste (Stufen, Vorschau, letzte Stufe)

**Files:**
- Modify: `app/(app)/invoices/reminders/page.tsx`, `app/(app)/invoices/reminders/ReminderRow.tsx`

**Interfaces:**
- Consumes: `reminderTitle`, `computeReminderCharges` (Task 2); `isLastReminderLevelSent` (Task 4).
- Produces: `ReminderRow` bekommt die Props `feeRappen: number`, `interestRappen: number`, `lastLevelSent: boolean`.

Es gibt keine Komponententests für diese Seite; Prüfung über Typecheck, Lint und die Smoke-Prüfung in Step 4.

- [ ] **Step 1: `page.tsx`**

Imports: `import { computeReminderCharges, reminderTitle } from "@/lib/reminder-charges";`.

Import `import { isLastReminderLevelSent } from "@/lib/reminders";` ergänzen und nach der Berechnung von `remainingByInvoice` die gesperrten Mahnungen ermitteln (derselbe Helper wie in `sendReminder`):

```ts
  const lastLevelSentIds = new Set(
    (
      await Promise.all(
        reminders.map(async (r) => ((await isLastReminderLevelSent(prisma, r)) ? r.id : null))
      )
    ).filter((id): id is number => id !== null)
  );
```

Den Block `const levelLabel = r.reminderLevel === 1 ? … : "2. Mahnung";` ersetzen durch:

```tsx
            const levelLabel = reminderTitle(r.reminderLevel);
            const remainingRappen = Math.round((remainingByInvoice.get(inv.id) ?? inv.totalAmount.toNumber()) * 100);
            const charges = settings
              ? computeReminderCharges({
                  level: r.reminderLevel,
                  openRappen: remainingRappen,
                  dueDate: inv.dueDate,
                  dunningDate: now,
                  settings,
                })
              : null;
```

und beim `<ReminderRow …>` ergänzen:

```tsx
                feeRappen={charges?.feeRappen ?? 0}
                interestRappen={charges?.interestRappen ?? 0}
                lastLevelSent={lastLevelSentIds.has(r.id)}
```

Der bestehende `defaultBody` bleibt unverändert (`Betrag:` zeigt weiterhin den offenen Betrag); ergänzen, wenn Gebühr oder Zins > 0 sind, eine Zeile im Text:

```ts
            const extra = charges && (charges.feeRappen > 0 || charges.interestRappen > 0)
              ? `\nMahngebühr: ${formatCurrency(charges.feeRappen / 100)}\nVerzugszins: ${formatCurrency(charges.interestRappen / 100)}\nTotal: ${formatCurrency(charges.totalRappen / 100)}`
              : "";
```

und in `defaultBody` direkt nach `Betrag: ${formatCurrency(remaining)}` den Platzhalter `${extra}` einfügen.

- [ ] **Step 2: `ReminderRow.tsx`**

Den lokalen `levelLabels`-Block durch `import { reminderTitle } from "@/lib/reminder-charges";` ersetzen und `const levelLabel = reminderTitle(props.reminderLevel);` verwenden. Props erweitern (`feeRappen: number; interestRappen: number; lastLevelSent: boolean;`). Unter dem `<p>` mit Kunde/Fällig/Betrag in `CardHeader` ergänzen:

```tsx
            {(props.feeRappen > 0 || props.interestRappen > 0) && (
              <p className="text-xs text-muted-foreground mt-0.5">
                + Mahngebühr {formatCurrency(props.feeRappen / 100)} · Verzugszins{" "}
                {formatCurrency(props.interestRappen / 100)} (auf dem Beleg)
              </p>
            )}
```

Wenn `props.lastLevelSent` gilt, statt `<form …>…</form>` im `CardContent` nur ausgeben, mit dem bestehenden Ignorieren-Button darunter:

```tsx
        {props.lastLevelSent ? (
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm text-muted-foreground">
              Letzte Stufe erreicht. Weitere Schritte (z. B. Betreibung) erfolgen ausserhalb der App.
            </p>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-muted-foreground"
              disabled={dismissing}
              onClick={() => startDismiss(() => dismissReminder(props.reminderId))}
            >
              <Trash2Icon className="size-4 mr-1.5" />
              {dismissing ? "Wird verworfen…" : "Ignorieren"}
            </Button>
          </div>
        ) : (
          <form …>… bestehendes Formular unverändert …</form>
        )}
```

- [ ] **Step 3: Typecheck und Lint**

Run: `npx tsc --noEmit` → keine Fehler
Run: `npm run lint` → keine neuen Fehler

- [ ] **Step 4: Smoke-Prüfung (manuell, kurz)**

`npm run dev`, in Einstellungen Gebühr 1. Mahnung = 10 und Zins = 5 setzen, eine überfällige Rechnung mit `PendingReminder` in `/invoices/reminders` öffnen und die Vorschau „+ Mahngebühr … · Verzugszins …“ prüfen. Den PDF-Anhang mit dem lokalen SMTP-Setup oder über `data/archive/<jahr>/` öffnen und Titel, Beträge und QR-Betrag ansehen. Kann die UI nicht gestartet werden, das im Abschlussbericht ausdrücklich sagen und nicht „geprüft“ behaupten.

- [ ] **Step 5: Commit**

```bash
git add app/\(app\)/invoices/reminders
git commit -m "feat(reminders): show dunning levels, charges preview and last level

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Bankabgleich erkennt den Mahn-Total

**Files:**
- Modify: `lib/import/matching.ts`, `lib/import/queries.ts`
- Test: `tests/unit/import-matching.test.ts`, `tests/integration/bank-import.test.ts`

**Interfaces:**
- Produces: `OpenInvoice.reminderTotal?: number` (CHF), gesetzt von `loadOpenInvoices`, wenn die zuletzt versendete Mahnung einen Total über dem offenen Betrag hat.

- [ ] **Step 1: Write the failing tests**

In `tests/unit/import-matching.test.ts` im `describe("matchStatementToInvoices", …)` ergänzen:

```ts
  it("treats the total of the latest Mahnbeleg as an amount match and pre-selects with the reference", () => {
    const invoice: OpenInvoice = { id: 1, documentNumber: "I-26010042", openAmount: 123.45, reminderTotal: 133.45 };
    const [withRef] = matchStatementToInvoices(
      [tx({ amountCents: 13345, description: "Rechnung I-26010042" })],
      [invoice],
      PREFIX
    );
    expect(withRef.confidence).toBe("reference");
    expect(withRef.preselectedInvoiceId).toBe(1);

    const [amountOnly] = matchStatementToInvoices([tx({ amountCents: 13345 })], [invoice], PREFIX);
    expect(amountOnly.confidence).toBe("amount");
    expect(amountOnly.candidates).toEqual([{ invoiceId: 1, documentNumber: "I-26010042" }]);
  });

  it("still matches the plain open amount when a reminder total exists", () => {
    const invoice: OpenInvoice = { id: 1, documentNumber: "I-26010042", openAmount: 123.45, reminderTotal: 133.45 };
    const [result] = matchStatementToInvoices([tx({ amountCents: 12345 })], [invoice], PREFIX);
    expect(result.confidence).toBe("amount");
  });
```

In `tests/integration/bank-import.test.ts` einen Test ergänzen, der `loadOpenInvoices` aus `@/lib/import/queries` aufruft (Setup wie in den bestehenden Tests der Datei lesen und wiederverwenden: Kunde und Rechnung `Overdue` über CHF 100 anlegen), dann eine `SentDocument`-Zeile `kind: "Reminder"`, `reminderLevel: 2`, `openRappen: 10000`, `feeRappen: 1000`, `interestRappen: 250` (Pflichtfelder `documentNumber`, `path`, `sha256`, `size`, `sentTo`, `subject`, `createdById` wie im Integrationstest `tests/integration/reminders.test.ts` unter `sentLevel4` gesetzt) erzeugen und prüfen:

```ts
    const [open] = await loadOpenInvoices(db.prisma);
    expect(open.openAmount).toBe(100);
    expect(open.reminderTotal).toBe(112.5);
```

und einen zweiten Fall ohne Mahnung: `reminderTotal` ist `undefined`.

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/unit/import-matching.test.ts tests/integration/bank-import.test.ts`
Expected: FAIL.

- [ ] **Step 3: `lib/import/matching.ts`**

Im Interface `OpenInvoice` nach `openAmount` ergänzen:

```ts
  /** Francs requested by the latest Mahnbeleg (open + fee + interest); only set when above `openAmount`. */
  reminderTotal?: number;
```

Nach `centsOf` einfügen:

```ts
/** The open amount, or the total printed on the latest Mahnbeleg, is a payment of this invoice. */
function acceptsAmount(invoice: OpenInvoice, cents: number): boolean {
  return (
    centsOf(invoice.openAmount) === cents ||
    (invoice.reminderTotal != null && centsOf(invoice.reminderTotal) === cents)
  );
}
```

Die zwei Vergleiche ersetzen:
- `(invoice) => centsOf(invoice.openAmount) === transaction.amountCents` → `(invoice) => acceptsAmount(invoice, transaction.amountCents)`
- `centsOf(referenced.openAmount) === transaction.amountCents` → `acceptsAmount(referenced, transaction.amountCents)`

Den Kopfkommentar um den Punkt „… or the total of the latest Mahnbeleg“ bei „open amount“ ergänzen.

- [ ] **Step 4: `lib/import/queries.ts`**

In `loadOpenInvoices` im `select` ergänzen:

```ts
      sentDocuments: {
        where: { kind: "Reminder" },
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { openRappen: true, feeRappen: true, interestRappen: true },
      },
```

und im `.map` nach `const names = …`:

```ts
      const openRappen = Math.max(toRappen(invoice.totalAmount) - creditedRappen - paidRappen, 0);
      const lastReminder = invoice.sentDocuments[0];
      const reminderRappen = lastReminder
        ? (lastReminder.openRappen ?? 0) + (lastReminder.feeRappen ?? 0) + (lastReminder.interestRappen ?? 0)
        : 0;
```

Das zurückgegebene Objekt: `openAmount: openRappen / 100,` und

```ts
        ...(reminderRappen > openRappen ? { reminderTotal: reminderRappen / 100 } : {}),
```

- [ ] **Step 5: Run to verify they pass**

Run: `npx vitest run tests/unit/import-matching.test.ts tests/integration/bank-import.test.ts tests/integration/camt-import-payments.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/import/matching.ts lib/import/queries.ts tests/unit/import-matching.test.ts tests/integration/bank-import.test.ts
git commit -m "feat(import): match the dunning notice total in bank import

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Doku und Gesamtprüfung

**Files:**
- Modify: `CLAUDE.md`, `FEATURE_ANALYSE.md`, `README.md`

- [ ] **Step 1: `CLAUDE.md`**

Im Abschnitt „Business document workflow“ den Eintrag `` `lib/reminders.ts` + `PendingReminder` model manage overdue payment reminders `` ersetzen durch:

```
- **Reminders** (`lib/reminders.ts`, `lib/reminder-charges.ts`, `lib/pdf/reminder-pdf.ts`, `app/(app)/invoices/reminders/`): `PendingReminder` manages overdue reminders with four levels (1 Zahlungserinnerung, 2–4 = 1.–3. Mahnung, `MAX_REMINDER_LEVEL = 4`). `sendReminder` recomputes the amounts server-side (`computeReminderCharges`: open remainder from `getPaymentSummary`, fee per level from `ApplicationSettings.reminderFeeLevel{2,3,4}Rappen`, interest = open × `reminderInterestPercent` × days overdue / 365; all default 0 = off) and renders a dedicated Mahnbeleg (`generateReminderPdf`, the QR slip requests open + fee + interest; level 1 carries neither fee nor interest; the attachment is named `mahnung-<number>-stufe<level>.pdf`) through `renderArchiveAndSend` with `renderPdf`. Fee and interest are not booked: the invoice, `Payment` and the open items list stay unchanged, and a payment above the remainder becomes an overpayment. The amounts and the dunning date are stored on the `SentDocument` row (`openRappen`, `feeRappen`, `interestRappen`, `interestPercent`, `dunningDate`). After level 4 no further reminder is sent (`isLastReminderLevelSent` in `lib/reminders.ts`, counted from `PendingReminder.createdAt`; the list shows "Letzte Stufe erreicht"), and nothing is sent when the remainder is 0. The bank import also accepts the latest reminder total as an amount match (`OpenInvoice.reminderTotal`). Changes to fees/interest are audited (`UPDATE Settings`). No Betreibung/Inkasso state or export yet
```

- [ ] **Step 2: `FEATURE_ANALYSE.md`**

Bei Z5 die Befundzeile mit `**Erledigt mit F8:** …` einleiten (analog zu Z7), im Abschnitt F8 nach der `- **Rechtliches:**`-Zeile ergänzen: `- **Umgesetzt:** Mahnbeleg-PDF je Stufe (Zahlungserinnerung, 1.–3. Mahnung), Mahngebühr je Stufe und Verzugszins konfigurierbar (standardmässig aus), nur auf dem Beleg und im QR-Betrag. Betreibung/Inkasso-Status und Forderungsexport sind nicht umgesetzt. Spec: docs/superpowers/specs/2026-10-01-f8-mahnwesen-design.md.` und in der Checkliste (Zeile `- [ ] 10. F8 Mahnwesen mit Mahnbelegen`) das Kästchen mit `[x]` abhaken sowie ` (ohne Betreibung)` anhängen.

- [ ] **Step 3: `README.md`**

Die Zeile `- ⏰ **Zahlungserinnerungen / Mahnwesen** mit mehreren Stufen` ersetzen durch `- ⏰ **Zahlungserinnerungen / Mahnwesen** mit eigenem Mahnbeleg je Stufe (optional mit Mahngebühr und Verzugszins)`.

- [ ] **Step 4: Gesamtprüfung**

Run: `npm test` → alle Tests grün
Run: `npm run lint` und `npx tsc --noEmit` → sauber
Run: `npm run build` → Build erfolgreich

Schlägt etwas fehl, Ursache beheben (nicht überspringen) und das Ergebnis im Abschlussbericht ehrlich nennen.

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md FEATURE_ANALYSE.md README.md
git commit -m "docs: document the dunning notices (F8)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Self-Review

- **Spec-Abdeckung:** Stufen und Level-Deckel (Task 2, 4, 5), Datenmodell (Task 1), Berechnung (Task 2), Mahnbeleg-PDF (Task 3), Versand und Speicherung (Task 4), Mahnliste (Task 5), Einstellungen inkl. Rechtshinweis und Validierung (Task 1), Tests (je Task), Doku (Task 6). Nicht im Umfang bleiben Betreibung/Export und Verrechnung als Forderung.
- **Typkonsistenz:** `ReminderCharges`, `computeReminderCharges`, `reminderTitle`, `MAX_REMINDER_LEVEL` (Task 2) werden in Task 3–5 mit denselben Namen verwendet; die Feldnamen `reminderFeeLevel{2,3,4}Rappen` und `reminderInterestPercent` stimmen zwischen Schema, Formular (`reminderFeeLevel2/3/4`, `reminderInterestPercent`), `saveSettings` und `computeReminderCharges` überein.
- **Designhinweis:** Der „letzte Stufe“-Zustand wird über eine `SentDocument`-Zeile mit `reminderLevel = 4` seit `PendingReminder.createdAt` erkannt (kein Schema-Feld auf `PendingReminder`); die Spec beschreibt dasselbe.
- **Review-Befunde eingearbeitet** (Opus-Review vom 2026-10-01): Tests mit `toEqual`/Mock-Zustand, Reset-sichere Stufensperre, Rest-0-Schutz, Settings-Audit, Anhangname, Bankabgleich-Total, Level 1 ohne Zins, kalendertagbasierte Zinstage, `pdfOptions`/`qrAmount` entfernt.
