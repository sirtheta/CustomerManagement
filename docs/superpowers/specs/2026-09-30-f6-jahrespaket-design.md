# F6 · Jahresabschluss-Paket für die Selbstveranlagung: Design

Stand: 2026-09-30. Bezug: `FEATURE_ANALYSE.md` F6, Abschnitt 7.3.

## Ziel

Ein Klick auf der Seite Buchhaltung erzeugt für das **dort gewählte Jahr** ein ZIP mit allem, was eine Einzelfirma (Umsatz unter CHF 500'000, vereinfachte Buchführung nach Art. 957 Abs. 2 OR) für die Steuererklärung und die 10-jährige Aufbewahrung braucht. Es gibt keinen Treuhänder, keinen Kontenplan und keine Zielsoftware.

**Geltungsbereich:** Ein Paket enthält genau ein Jahr, nämlich das in der Jahresauswahl gewählte. Vorjahre werden nicht mit eingepackt. Einziger Vorjahresbezug sind die offenen Posten per 31.12. des Vorjahres (Anfangsbestand der Debitoren). Wer mehrere Jahre braucht, lädt pro Jahr ein eigenes Paket. Rechnungen, die sich über den Jahreswechsel erstrecken (versendet im Dezember, bezahlt im Januar), liegen bewusst in beiden Paketen, damit jedes für sich prüfbar ist. Ein Mehrjahres-Gesamtpaket ist nicht vorgesehen.

## Grundlagen (Quellen)

- Kanton Zürich, [Merkblatt zum Hilfsblatt A](https://www.zh.ch/content/dam/zhweb/bilder-dokumente/themen/steuern-finanzen/steuern/natuerlichepersonen/2022/est-wegleitungen/321_merkbl_selbst_zh_2022_bf_def.pdf) (2022): Einnahmen nach Ist-Methode (Zahlung) oder Soll-Methode (Leistung) wählbar. Bei Soll bestehen die Einnahmen aus Zahlungseingängen und der Debitorenveränderung. Belege zehn Jahre, jeder Buchungsvorfall muss sich vom Beleg bis zum Abschluss prüfen lassen.
- Kanton Bern, [Zusatz-Wegleitung 2018](https://www.wegleitung.sv.fin.be.ch/content/dam/sv_fin/dokumente/de/wegleitungen/2018/wl_selbststaendige-erwerbstaetigkeit_2018_de.pdf), Ziffer 1 und 4: Aufstellungen über Aktiven/Passiven, Einnahmen/Ausgaben, Privatentnahmen/-einlagen. Bei Einnahmen und Ausgaben Datum und Name des Leistenden bzw. Empfängers, bei Ausgaben der Zahlungsgrund. Debitoren und Kreditoren einzeln mit Name, Adresse und Betrag, Globalbeträge genügen nicht. Formular 9 führt Debitoren am Anfang und am Ende des Jahres.

## Entscheidungen

1. **Journal nach Zahlungseingang** (`Payment.date`, Ist-Methode), wie der heutige Export.
2. **Debitoren zu zwei Stichtagen** (31.12. Vorjahr und 31.12. des Jahres) mit Veränderung in der Jahresübersicht. Damit sind beide Methoden bedient, ohne dass die App die gewählte kennt.
3. **GuV nur als CSV**, kein PDF-Bericht.
4. **Archivierte Original-PDFs** aus `SentDocument` (F4), nicht neu gerendert. Auswahl: Rechnungen, Mahnungen und Gutschriften, die im Jahr versendet wurden **oder** im Jahr eine Zahlung hatten **oder** per 31.12. offen sind. Jedes Dokument einmal.
5. **Mängel bricht das Paket nicht ab.** Fehlende oder manipulierte Archivdateien fehlen im ZIP und stehen in `pruefsummen.csv` und `LIESMICH.txt`.

## Inhalt des ZIP

```
jahrespaket-2026/
  journal-2026.csv
  jahresuebersicht-2026.csv
  offene-posten-2025-12-31.csv
  offene-posten-2026-12-31.csv
  rechnungen/<archivierte PDFs, Dateiname wie im Archiv>
  pruefsummen.csv
  LIESMICH.txt
```

- **journal-2026.csv:** Datum, Beleg-Nr., Typ (Einnahme/Ausgabe), Kunde, Kategorie, Text, Betrag (CHF). Einnahmen: Beleg-Nr. = Rechnungsnummer, Kunde = Anzeigename, Text = Rechnungsbezeichnung. Ausgaben: Beleg-Nr. und Kunde leer, Text = `description` (Zahlungsgrund). Chronologisch, bei gleichem Datum Einnahmen vor Ausgaben, dann nach Id.
- **jahresuebersicht-2026.csv:** Zeilen `Einnahmen gesamt`, je Kategorie `Ausgaben <Kategorie>`, `Ausgaben gesamt`, `Ergebnis`, `Debitoren 31.12.<Vorjahr>`, `Debitoren 31.12.<Jahr>`, `Veränderung Debitoren`. Werte aus `fetchIncomeStatement` bzw. `fetchReceivables`.
- **offene-posten-<Stichtag>.csv:** Spalten wie der bestehende OP-Export, zusätzlich Strasse, PLZ, Ort, Land. Bei laufendem Jahr gilt als zweiter Stichtag der heutige Tag (Dateiname entsprechend).
- **rechnungen/:** Nur Dateien, deren `verifyArchived` erfolgreich ist.
- **pruefsummen.csv:** Datei, SHA-256, Grösse, Status (`OK`, `FEHLT`, `HASH ABWEICHEND`). Zusätzlich `ohne archiviertes PDF` für Rechnungen der Auswahl ohne `SentDocument`, etwa weil sie vor F4 versendet wurden.
- **LIESMICH.txt:** Erstellungsdatum, Jahr, Bedeutung jeder Datei, Hinweis auf die Ist-Methode des Journals, Lücken (keine Privatentnahmen/-einlagen, keine Kreditoren, kein Lieferantenname bei Ausgaben, keine Ausgabenbelege, keine Offerten), Hinweis auf 10 Jahre Aufbewahrung und darauf, dass die Steuerbehörde des Kantons massgebend ist. Kein Rechtsrat.

## Code

| Einheit | Aufgabe |
|---|---|
| `lib/year-package.ts` (neu) | `buildYearPackage(prisma, year, now)` liefert Dateiliste und Mängelliste, kein HTTP. PDFs werden sequentiell gelesen, nie alle gleichzeitig im RAM. |
| `lib/journal.ts` (neu) | Reine Funktion `buildJournal(payments, expenses)`. |
| `lib/zip.ts` (neu) | Wrapper um eine rein-JS-ZIP-Bibliothek (`fflate` oder `archiver`, Wahl im Plan), liefert einen Stream. |
| `app/api/export/year-package/route.ts` (neu) | Rollencheck (Admin, Editor), Jahr parsen, Stream, Audit `EXPORT YearPackage` mit Jahr und Dateianzahl, ausserhalb jeder Transaktion. |
| `app/api/export/accounting/route.ts` | Nutzt `buildJournal`. Die Spalten ändern sich (Beleg-Nr., Kunde kommen dazu). |
| `lib/receivables.ts`, `app/api/export/receivables/route.ts` | `ReceivableRow.customerAddress`, neue CSV-Spalten. |
| `app/(app)/accounting/page.tsx` | Button "Jahrespaket (ZIP)". |

## Fehlerfälle

- Jahr nicht ganzzahlig oder ausserhalb 2000 bis laufendes Jahr + 1: **400**.
- Nicht eingeloggt: Redirect `/login`. Falsche Rolle: Redirect `/dashboard` (wie die anderen Exporte).
- Archivdatei fehlt oder Hash abweichend: siehe Entscheidung 5.
- Stream bricht ab: Fehler loggen. Das ZIP hat kein gültiges Zentralverzeichnis und gilt als kaputter Download.

## Tests (Vitest)

- Unit: `buildJournal` (Reihenfolge, Rappen, Kunde, Zahlungsgrund), CSV-Escape, PDF-Auswahlregel (alle drei Kriterien, Duplikate, Entwürfe ausgeschlossen).
- Integration: `buildYearPackage` mit temporärer DB und temporärem Archiv, inklusive manipulierter und gelöschter Datei, Gutschrift und Rechnung ohne `SentDocument`.
- Route: Viewer abgewiesen, ungültiges Jahr 400, Antwort `application/zip`, ZIP entpacken und Inhalt vergleichen.
- Regression: `accounting`-Export und OP-Export mit den neuen Spalten.

## Nicht Teil von F6

PDF-Jahresbericht, Ausgabenbelege und Lieferanten (F9), Kreditoren, Privatentnahmen/-einlagen, Offerten, gespeicherte oder zeitgesteuerte Pakete, Verschlüsselung, Kontenplan und Zielformate (Banana, bexio, Abacus).
