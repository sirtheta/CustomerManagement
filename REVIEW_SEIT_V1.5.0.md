# Review seit v1.5.0

Stand: 2026-10-02. Basis: `customer-management-v1.5.0..HEAD` (29 Commits, 276 Dateien).
Sechs Opus-Reviews (vier Code, ein UX mit Playwright, ein Aufräumen). Die Findings sind nicht einzeln
nachgeprüft: vor dem Fix kurz am Code bestätigen. Schweregrad aus Sicht des Agents, `[Q]` = von mehreren
Reviews unabhängig gefunden.

Legende: `[ ]` offen, `[x]` erledigt, `[-]` bewusst übersprungen.

## 1. Vor dem nächsten Release

### Versandpfad: Mail raus, aber nicht verbucht / Doppelversand [Q]
- [x] `sendDocument` (`lib/document-actions.ts:237-257`): scheitert das Verbuchen nach `renderArchiveAndSend`, bleibt die Rechnung ein Draft (bearbeitbar, löschbar), kein `SentDocument`/`InvoiceSentLog`. Zweiter Klick mailt nochmals.
- [x] `sendReminder` (`app/(app)/invoices/reminders/actions.ts:47-111`): gleiche Lücke. Zusätzlich wirft `pendingReminder.update` P2025, wenn währenddessen bezahlt wurde (`lib/payments.ts:88` löscht den `PendingReminder`). Mail raus, kein SentDocument, kein Audit. Fix: `updateMany`.
- [x] Mahnversand nicht atomar: Doppelklick/zwei Tabs senden dieselbe Mahnung doppelt, Stufe steigt nur um 1. Fix: Stufe per bedingtem `updateMany` vor dem Versand beanspruchen.
- [x] `sendPendingInvoice` (`lib/pending-email-send.ts:30-69`): kein Claim vor dem Versand, Tagesjob und Admin-Freigabe können gleichzeitig mailen. Erledigt über die Sperre. Die Prüfung `invoice.state` wurde bewusst nicht ergänzt: `tests/unit/invoice-sub-actions.test.ts` lässt die Freigabe für Paid/PartiallyPaid/Canceled ausdrücklich zu. Da die `PendingEmail` jetzt beim Senden und Statuswechsel gelöscht wird, bleiben nur Altlasten.
- [x] Wird ein Abo-Entwurf direkt über «Senden» oder per Status-Dropdown verschickt, bleibt die `PendingEmail` stehen; spätere Freigabe sendet nochmals (`document-actions.ts`, `invoices/actions.ts:209-230`).
- [x] Gutschrift-Limit nicht race-sicher (`document-actions.ts:200-211`): Prüfung ausserhalb der Status-Transaktion.
- Umgesetzt (kein gemeinsames `dispatchAndRecord`, die drei Wege buchen zu unterschiedlich): `lib/send-lock.ts` (Sperre pro Rechnung, bei Gutschriften auf dem Original, nur innerhalb eines Prozesses) und `recordSend` in `lib/invoice-dispatch.ts` (einmal wiederholen, sonst «bereits versendet, nicht erneut senden»). Tests: `tests/integration/send-path-safety.test.ts`.
- Offen innerhalb dieser Gruppe: Status-Dropdown nummeriert und sperrt einen Entwurf ohne Rückfrage (siehe UX).

### Falsche Zahlen
- [x] Gutschrift-PDF mit Gesamtrabatt: `roundCents` rundet negative Halbwerte nicht gespiegelt, `splitTotals` druckt «Rabatt - CHF -10,01» und eine Phantomzeile «Rundung» (`lib/calculations.ts:7-9,55-64`, `lib/pdf/document-pdf.ts:387-409`). PDF wird unveränderlich archiviert. Fix: mit Absolutwerten rechnen, Vorzeichen danach.
- [x] Überzahlungs-Rückfrage ignoriert Gutschriften (`app/(app)/invoices/payments/actions.ts:47`): `creditedRappen` mitzählen.
- [x] «Einnahmen nach Kategorie» liest `Invoice.paidDate` statt Zahlungen (`app/(app)/analytics/lib/analytics-queries.ts:142,319`) [Q]. Teilzahlungen fehlen, Summe weicht vom Jahresumsatz ab. Danach `Invoice.paidDate` + Index entfernen.
- [x] Zahlungsdatum an der Jahresgrenze: `new Date()` mit Uhrzeit bzw. UTC-Tag (`payments/actions.ts:64`, `invoices/actions.ts:219`, `PaymentsPanel.tsx:43`). Als Kalendertag in Schweizer Zeit normalisieren.
- [x] Aus Bankimport übernommene Ausgaben stehen als «Offen» (`bookExpenses` setzt kein `paidDate`).
- [x] Gutschrift-Validierung prüft nur die Menge: negativer Stückpreis ergibt belastenden Beleg (`invoices/actions.ts:133`, `lib/credit-notes.ts:98`).
- [ ] Rundungs-Schalter zwischen Original und Gutschrift kann 2 Rappen Rest lassen (`lib/credit-notes.ts:110`).
- [ ] Stornierte Rechnung lässt sich erneut senden, QR über vollen Betrag (`document-actions.ts:187-257`).
- [x] Budget-API kann bei gleichzeitigen Requests doppelt buchen (`lib/payment-matching.ts:44-69`). Entschieden: bleibt optional (Spec F7, FEATURE_ANALYSE).

### Zugriff und Audit
- [x] Viewer öffnet `/accounting/[id]` und `/accounting/new` per Direkt-URL: `requireEditor()` fehlt.
- [x] Kein Audit für IBAN, SMTP, Nummernpräfix, Notify-Adresse, Telegram (`settings/actions.ts:160-188`).
- [x] Kein Audit für Rechnungsvorlagen (`invoices/templates/actions.ts`), obwohl sie den Auto-Versand steuern.
- [x] Kundenverlauf ignoriert Modul-Schalter (`lib/customer-history.ts:41-96`).
- [x] Beleg-Download: kein `moduleDisabledResponse`, `no-cache` statt `no-store` (`app/api/expenses/receipts/[id]/route.ts`).
- [x] Backup-/Log-Download nicht auditiert.
- [x] `convertQuoteToInvoice` ohne Audit.
- [x] Kontakt-Audit ohne `customerId`, `createContact` prüft Kunde nicht.
- [x] Unsanitierter Dateiname im Header (`app/api/reminders/[id]/pdf/route.ts:56`).
- [ ] Archivierte Kunden nur in der UI gefiltert (`createInvoice`, `updateInvoice`, `convertQuoteToInvoice`).

Stand 2026-10-02: Commits `04f46a4`, `f5148b1`, `aec19c9`, `82b2cc5`, `06453fd`. Offen aus der Fix-Runde: `Invoice.paidDate` entfernen (nur noch geschrieben, eigene Migration), Altdaten mit positiven «Gutschriften» (`sumCreditedRappen` rechnet mit `Math.abs`), Budget-API und OP-Stichtag nutzen noch UTC-Tag/Uhrzeit, `/quotes/[id]` und `/services/[id]` ohne Viewer-Handling, Navi-Badge für Viewer.

## 2. UX (High)
- [x] Fehler verschwinden lautlos: `useActionToast` überspringt Zustände ohne `_ts`; `createTask`/`createSubscription` geben Fehler ohne `_ts` zurück, Eingabe weg. Pflichtfelder mit * markieren.
- [x] Viewer sieht Formulare für Senden/Anlegen (Mahnungen, ausstehende Mails, Kundenseite, `/invoices/new`), Klick leitet kommentarlos aufs Dashboard.
- [x] Status-Dropdown: «Versendet»/«Bezahlt» bei Entwurf nummeriert und sperrt ohne Rückfrage und ohne Mail.
- [x] Zahlungseingang «Ignorieren» ohne Rückfrage, ohne Rückweg (kein «Bisher ignoriert» für Eingänge).
- [x] Bankimport ohne Treffer: keine Rechnungsauswahl; Kandidatenliste zeigt nur Nummern (Kunde + offener Betrag ergänzen); falscher Hinweistext; Button «als bezahlt markieren» für Teilzahlungen.
- [x] Mahnwesen: Rechnungs-Knopf führt in leere Liste; «Ignorieren» = 14 Tage zurückstellen; gleicher Text für alle Stufen; Karte zeigt nicht, wann die letzte Stufe ging.
- [x] Navigation: Mahnungen, Bankimport, OP-Liste, Abos, ausstehende Mails fehlen im Menü; Dashboard-Banner (57) und `/invoices`-Banner (39) nennen zwei Zahlen mit zwei Zielen.

### UX (Medium/Low)
- [x] Senden-Dialog zeigt `{documentNumber}`, kein Hinweis auf Sperre nach Versand, englischer «Close»-Button. (Nummer und «Schliessen» erledigt; Offerten-Dialog zeigt bei Entwürfen noch den Platzhalter)
- [ ] Einstellungen: Klick-speichert und Speichern-Leiste vermischen sich, Toast verdeckt die Leiste; «Gilt sofort» nur bei zwei von vier.
- [ ] Abo mit Datum in der Vergangenheit erzeugt sofort leeren Entwurf über CHF 0.00; kein Link «Vorlage anlegen».
- [ ] Mobil (390px): `/invoices/import` 475px, `/accounting` 644px, Listen nur seitlich scrollbar.
- [ ] Gutschrift auf teilbezahlte Rechnung: keine Warnung, Nummer nicht verlinkt, Präfix `I-`, Format «CHF-1'000.00», Verlauf sagt «Rechnung … gesendet».
- [ ] Mahnliste mit 39 aufgeklappten Formularen, kein Sammelversand.
- [ ] Kundenauswahl: Enter übernimmt einzigen Treffer nicht.
- [ ] Ausgabe speichern: kein Toast, Weiterleitung an den Listenanfang; Formular mit doppelten Feldern (Bezahlt / Bezahlt am / Fällig am).
- [ ] Zahlungen-Panel: «Zahlung erfassen» und «Als bezahlt markieren» tun dasselbe.
- [ ] «Import rückgängig» deaktiviert, Grund nur im `title`.
- [ ] Fachchinesisch in Bankimport-Fehlern (CAMT.054, «Budget-App»).
- [ ] Begriffe: Mahnwesen/Ausstehende Mahnungen, «Mahnungs-Cooldown», «Version: 1».
- [ ] Datumsformat Dashboard `5.10.2026` vs. `05.10.2026`.
- [ ] Kundenformular: Kundennummer zeigt «automatisch» statt der Nummer.
- [ ] Offerte «Angenommen»: Hauptaktion bleibt «Offerte senden».
- [ ] Modul Abos abschalten: keine Sammelaktion «Alle pausieren».
- [ ] `window.confirm` statt eigener Dialoge (Bankimport, Einstellungen).
- [ ] Accessibility: Labels im Positionseditor, globale Suche, Datei-Input; Toasts verdecken Buttons.
- [ ] Console: Hydration-Mismatch `/invoices/178/edit`, Base-UI-Warnung im Kundenformular.

## 3. Weitere Code-Findings (Low)
- [x] `undoImport` löscht Einträge, die ein späterer überlappender Import übersprungen hat (`lib/import/bank-import.ts:159-196`).
- [ ] Jahrespaket kann `EXPORT`-Audit für abgebrochenen Download schreiben (`lib/zip.ts:31-33`).
- [ ] «Alle nicht angehakten ignorieren» scheitert bei > 1000 Zeilen (`import/actions.ts:22,233`).
- [ ] Abo-Nachholen überspringt verpasste Perioden ohne Hinweis (`lib/subscription-dates.ts:31-35`).
- [ ] Fällige Aufgaben werden als gemeldet markiert, auch wenn kein Kanal zustellte (`lib/tasks.ts:80-90`).
- [ ] CAMT-Sammelbuchung ohne `TxDtls/Amt` vervielfacht den Betrag (`lib/import/camt.ts`).
- [ ] Nachfass-Aufgabe bleibt offen, wenn die Offerte gelöscht wird (`Task.quote onDelete: SetNull`).
- [ ] «Jährliche Rechnung» ohne Datum geht bei der Migration verloren (optional pausiertes Abo anlegen).
- [x] «Verwerfen» bei Abo-Entwürfen löscht nur `PendingEmail`, Audit sagt «DELETE Invoice». (`discardPendingEmail` löscht jetzt Entwurf + Positionen + `PendingEmail` in einer Transaktion, mit Bestätigungsdialog; ist die Rechnung kein unnummerierter Entwurf mehr, nur die `PendingEmail`, Audit dann «DELETE PendingEmail».)

- [ ] `deleteInvoice` löscht die Positionen nicht mit (`Item.invoice` ohne `onDelete`, Migration `SET NULL`): verwaiste `Item`-Zeilen (`app/(app)/invoices/actions.ts`).
- [ ] `PendingEmailRow`: Erfolgs-Toast nach «Senden» läuft über `useActionToast` und erscheint vermutlich nie, weil die Zeile nach der Revalidierung weg ist (Muster wie in `ReminderRow`).
- [ ] Überfällige Rechnung über CHF 0 bekommt vom Tagesjob eine Mahnung, deren Versand abgelehnt wird («bereits beglichen»).
- [ ] Offerten-Senden-Dialog zeigt bei Entwürfen `{documentNumber}`; Sperrtext bei «Rückgängig» macht Zeilen im Importverlauf hoch.

## 4. Tests
- [x] Kein Test der 5-Rappen-Rundung für `createInvoice`/`updateInvoice`. `tests/integration/invoice-actions-db.test.ts` (echte Test-DB): aus = exakt, ein = Total nach Rabatt gerundet (Positionen nicht), Draft-Update rechnet neu, Gutschrift rundet gespiegelt, Umschalten via `setSetting` lässt bestehende Dokumente stehen.
- [x] Kein Test vergleicht Migrationen mit `schema.prisma` (`prisma migrate diff`). `tests/integration/migrations-match-schema.test.ts`: Neuinstallation und Upgrade ab v1.5.0 per SQL wie `startup.js`, dann `migrate diff --from-config-datasource --to-schema --exit-code` = 0; Gegenprobe mit Drift = 2 (~2 s).
- [x] Migrationstest bildet v1.5.0 nicht korrekt nach (`legacyDb()` lässt `2_add_password_reset_token` aus). Jetzt feste Liste der v1.5.0-Migrationen, danach alle neueren; neue Fälle für Item-Waisen, `defaultYearlyInvoice` und Passwort-Reset-Tokens.
- [x] Kein Test, dass Actions/Routen den Modul-Guard aufrufen (`tests/setup.ts` mockt ihn). `tests/integration/module-guard-wiring.test.ts` (echter Guard, tabellengetrieben, Daten-Snapshot unverändert, Gegenprobe mit Modul an) und `tests/unit/module-guard-coverage.test.ts` (jede exportierte Action, Page und Route der Modulpfade ruft den Guard). Tasks, Abos, Bankimport und Auswertung haben keine API-Route; Auswertung auch keine Action (Page getestet).
- [x] `assign-document-number.test.ts`: Datum aus Modul-Load, flaky am Monatswechsel. Feste Systemzeit pro Test (`vi.setSystemTime`, nur `Date` gefälscht), Jahreswechsel 31.12. 23:59 / 1.1. 00:00 Schweizer Zeit mit `TZ=Europe/Zurich` geprüft.
- [x] Seed erzeugt `Canceled` ohne Gutschrift und `Overdue` mit zukünftigem Fälligkeitsdatum. Canceled bekommt eine versendete Gutschrift über den vollen Betrag, Overdue ein Fälligkeitsdatum in der Vergangenheit; `tests/integration/seed.test.ts` lässt den Seed gegen eine Temp-DB laufen und prüft die Invarianten (~5 s).
- [x] Flaky: `pdf-cache.test.ts`. Ursache war die 50-ms-Lebensdauer im Test (nicht die mtime-Auflösung): unter Last liefen `evict-b/c` vor dem Lesen ab. Jetzt mtimes per `utimes` gesetzt, keine Pausen mehr.
- [x] Vite-Warnung: ESM-Syntax in `vitest.config.ts`. Umbenannt in `vitest.config.mts` (`__dirname` → `import.meta.url`), `package.json` unverändert.

## 5. Aufräumen
Löschen (per Grep belegt):
- [x] `scripts/migrate-data.mjs`
- [x] `app/(app)/settings/LogoUpload.tsx`
- [x] `checkAndUpdateDocumentStates` (`lib/state-manager.ts`, Tests auf `checkAndUpdateAllDocumentStates` umstellen)
- [x] `splitStreetLine` (`lib/address.ts`) samt Test
- [x] `createTemplate` (`invoices/templates/actions.ts`)
- [x] `ApplicationSettings.defaultYearlyInvoice` (in die noch unveröffentlichte Migration `20261001120000` aufgenommen, kein neuer Migrationsschritt)
- [x] Abhängigkeiten: `@auth/prisma-adapter`, `@radix-ui/react-{dialog,dropdown-menu,label,select,slot}`, `jimp` (+ `next.config.ts`)
- [x] Dockerfile: nur `scripts/startup.js` ins Image kopieren

Zusammenführen:
- [x] Mail-Platzhalter/Standardtexte in `lib/mail-templates.ts` (4 Implementierungen, weichen schon ab) (`lib/mail-templates.ts`; Abweichungen angeglichen: leere Betreff-Vorlage, `{customerName}` in Abo-Mails, `$&` in Namen)
- [x] SMTP-Transport (4× `createTransport`, 5× `DISABLE_EMAIL`) (`lib/smtp.ts`, je 1× `createTransport` und `DISABLE_EMAIL`)
- [x] `customerDisplayName` statt 16 Inline-Kopien (17 Stellen; Gutschrift-Maske zeigte bei «Kontaktperson statt Firma» die Firma)
- [x] Präfix-Defaults (`I-`/`Q-` Schema vs. `R-`/`A-`/`O-` Fallbacks) als `DEFAULT_PREFIXES` (`DEFAULT_PREFIXES` = `I-`/`Q-`)
- [x] `runDailyJobs(prisma)` für Cron und `triggerNotificationCheck` (`lib/daily-jobs.ts`; Dev-Button läuft jetzt in Cron-Reihenfolge und bricht nicht beim ersten Fehler ab)
- [x] `CreateDocumentInput`/`UpdateDocumentInput`, zwei `SYSTEM_ACTOR`, Snooze-Berechnung, `centsOf`/`toRappen`, zwei Testdateien `statement-checks` (`DocumentInput`, `lib/system-actor.ts`, `reminderSnoozedUntil`, `toRappen` in `calculations.ts`; `roundCents`/`roundTo5Rappen`/CAMT-Parsing bewusst getrennt)
- [x] Seed: `PENDING_YEARLY_COUNT`/`seedPendingYearlyInvoices` umbenennen; Kommentar `analytics-queries.ts:284`

Doku:
- [x] CLAUDE.md: JWT 7 Tage statt 8 Stunden; `PendingEmail` nur für Abo-Rechnungen; Analytics-Aussage nach dem Kategorie-Fix. Analytics-Aussage (Payments-Absatz) war schon korrekt, unverändert; Email-Absatz nennt zusätzlich `QuoteSentLog` und Mahnungen in `InvoiceSentLog`.
- [x] README: nur arm64; neue Features ergänzen. README behauptete amd64 + arm64, `release.yml` baut nur `linux/arm64`; Hinweis zum Selbstbau ergänzt. Gleicher Fehler in FEATURE_ANALYSE.md Z. 19 mitkorrigiert.
- [x] DEPLOYMENT.md: `TOTP_SECRET` nur Dev-Seed (einzig gelesen in `prisma/seed.ts`)
- [x] `.env.example`: `ARCHIVE_DIR`, `TRUST_PROXY_HEADERS` (wirkt nur auf das Rate-Limit von Passwort vergessen/zurücksetzen; Login limitiert pro E-Mail)
- [x] FEATURE_ANALYSE.md Z. 20: `lib/yearly-invoices.ts` existiert nicht mehr (→ `lib/subscriptions.ts`; die übrigen Erwähnungen in R6/Z7/F2/F11 sind historisch und bleiben)
- [x] Übergangscode (`?subscription=true`-Redirect, `deleteMany` in `lib/reminders.ts`) bis zum nächsten Major behalten

## 6. Entscheidungen
- [x] Teilzahlung auf überfälliger Rechnung nimmt sie dauerhaft aus dem Mahnwesen (`lib/payments.ts:33,88`). Spec-Entscheid, nicht in CLAUDE.md. Weiter mahnen bei Restbetrag > 0? Entschieden: weiter mahnen. Teilzahlung behält `PendingReminder` (Stufe, Belege, Zurückstellung), Status bleibt `PartiallyPaid`; Tagesjob legt für überfällige teilbezahlte Rechnungen eine an (`overdueInvoiceWhere`); Mahnbeleg/Karte zeigen Rest; Viewer-Banner und Filter «Überfällig» zählen sie mit. Tests: `tests/integration/reminders-partial-payment.test.ts`.
- [x] Editoren dürfen Zahlungen löschen (auch CAMT/Budget). Admin-only machen oder in CLAUDE.md dokumentieren? Entschieden: Editoren dürfen, in CLAUDE.md dokumentiert.
- [x] «Verwerfen» bei Abo-Entwürfen: Entwurf mitlöschen oder nur Audit-Aktion korrigieren? Entschieden: Entwurf mitlöschen (Abo-Periode wird übersprungen; bleibt Editor-Aufgabe).
- [ ] Budget-API (`POST /api/external/payments`) weiter betreiben? Sonst entfällt ein Matching-Weg.
- [x] `InvoiceSentLog` und `SentDocument` sind inhaltlich doppelt. Agent rät: vorerst behalten (Datenmigration nötig). Entschieden: beide behalten, Unterschied in CLAUDE.md. Zusammenlegen frühestens als eigene Migration nach dem Major-Release.

## Übersprungen
- [-] Migration setzt `PendingReminder.reminderLevel > 4` auf 4 (`migration.sql:300`). v1.5.0 hatte Stufen, aber die aktuelle Installation hat keine offenen Mahnungen, daher ohne Wirkung. Nur relevant, falls eine weitere Installation mit Altdaten Stufe ≥ 5 hat.

## Nicht geprüft
Mailversand, PDF-Darstellung (Rechnung, Mahnbeleg, QR-Teil, Jahrespaket-Inhalt), 2FA-Login, Logs und Backups im UI, Aktivitätsprotokoll, Benutzerverwaltung, abgeschaltete Module ausser Offerten, mobile Dialoge und Datepicker.
