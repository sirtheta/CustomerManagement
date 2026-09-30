# F7: Bankabgleich 2.0

Stand: 2026-09-30. Herkunft: Roadmap Phase 3, Punkt F7.

## Ziel

Der Import eines CAMT.053-Kontoauszugs verbucht Zahlungseingänge zuverlässiger als heute und übernimmt die Abbuchungen als Ausgaben. Importierte Bewegungen werden gespeichert, damit dieselbe Bewegung nie zweimal verbucht wird und ein unvollständiger Auszug auffällt.

## Entscheidungen

- **Umfang:** Bewegungen speichern, Duplikatschutz, Saldoprüfung, besseres Matching, Ausgaben als `Expense` übernehmen, ganzen Import rückgängig machen. camt.054 ist nicht Teil davon (camt.053 deckt dasselbe ab).
- **Eigenständig:** Das CRM muss ohne die Budget-App funktionieren. Wer beide nutzt, bekommt die Zahlungen weiter über `POST /api/external/payments`. Diese Schnittstelle bleibt abwärtskompatibel.
- **Vorbild:** Die Duplikaterkennung folgt `lib/import/dedupe.ts` der Budget-App (`C:\Projects\budget`), weil sie dort erprobt ist.
- **Ein gemischtes Konto:** Geschäft und Privat laufen über dasselbe Konto, und privat wird zusätzlich in der Budget-App verwaltet. Darum landet nie etwas automatisch als Ausgabe im CRM: Ausgaben entstehen nur im CRM-Import und nur für ausdrücklich angekreuzte Zeilen. Die Budget-App schickt nur Zahlungseingänge, die zu offenen Rechnungen passen.
- **Keine Buchhaltung:** Es bleibt eine Einnahmen-/Ausgabenrechnung. Es gibt keine Konten, keine Kontierung und keine freie Einnahmenbuchung ohne Rechnung.
- **Status abgeleitet:** Ob eine Bewegung offen, verbucht oder ignoriert ist, ergibt sich aus `paymentId`, `expenseId` und `ignored`. Es gibt kein Statusfeld, das von den Zahlungen abweichen könnte.

## Schema

Die Migration ist reines SQL (Produktion wendet Migrationen über `scripts/startup.js` ohne Prisma CLI an).

- `BankStatementImport`: `id`, `filename`, `iban String?`, `currency String?`, `periodFrom String?`, `periodTo String?` (YYYY-MM-DD), `openingBalanceRappen Int?`, `closingBalanceRappen Int?`, `importedCount Int`, `skippedCount Int`, `userId String?`, `createdAt`. Index auf `createdAt`.
- `BankTransaction`: `id`, `importId` (Relation auf `BankStatementImport`, `onDelete: Restrict`), `fingerprint String @unique`, `date DateTime`, `amountRappen Int` (mit Vorzeichen: negativ = Abbuchung), `description`, `counterparty String?`, `bankReference String?`, `ignored Boolean @default(false)`, `paymentId Int? @unique` (Relation auf `Payment`, `onDelete: SetNull`), `expenseId Int? @unique` (Relation auf `Expense`, `onDelete: SetNull`), `createdAt`. Indizes auf `importId` und `date`.
- Offen = `paymentId`, `expenseId` und `ignored` sind leer. Wird eine `Payment` oder `Expense` gelöscht, wird die Bewegung dadurch automatisch wieder offen.
- `Payment.bankReference` und `Payment.source = "camt-import"` bleiben wie in F5.

## Duplikatschutz (`lib/import/dedupe.ts`)

- `fingerprint` = SHA-256 über IBAN und Bankreferenz, wenn die Bank eine Referenz liefert. Sonst über IBAN, Datum, Betrag, normalisierten Text (klein, Leerzeichen gekürzt), normalisierte Gegenpartei und einen Zähler.
- Der Zähler nummeriert gleiche Bewegungen (gleiches Datum, Betrag, Text, Gegenpartei) in Dateireihenfolge. So werden zwei gleiche Abbuchungen am selben Tag beide importiert, ein erneuter Upload derselben Datei überspringt beide.
- Beim Upload werden bekannte Fingerprints übersprungen (`skippedCount`). Der eindeutige Index ist die letzte Absicherung bei parallelen Uploads: Ein Verstoss (P2002) zählt als übersprungen, nicht als Fehler.
- Der bisherige Schutz über `Payment.bankReference` pro Rechnung bleibt als zweite Sicherung bestehen.

## Saldoprüfung (`lib/import/statement-checks.ts`)

- **Vollständigkeit:** Anfangssaldo plus Summe aller Bewegungen der Datei (vor dem Überspringen von Duplikaten) muss den Endsaldo ergeben. Sonst Warnung. Fehlen Salden im Auszug, entfällt die Prüfung ohne Warnung.
- **Kontinuität:** Der Anfangssaldo wird mit dem Endsaldo des letzten Imports derselben IBAN verglichen, dessen `periodTo` vor dem `periodFrom` der neuen Datei liegt. Weicht er ab, Warnung (vermutlich fehlt ein Zeitraum).
- Beide Prüfungen sind Warnungen und blockieren den Import nicht. Die IBAN- und Währungswarnung (`checkStatementAccount`) bleibt unverändert.

## Matching (`lib/import/matching.ts`)

- **Nummer erkennen:** Statt der Regex `Präfix + 8 Ziffern` wird jede offene Rechnung gesucht. Text und Rechnungsnummer werden normalisiert (Gross-/Kleinschreibung egal, Leerzeichen, Bindestriche und Punkte entfernt), dann wird geprüft, ob die Nummer im Text steckt. Zusätzlich gilt ein Treffer auf den reinen Ziffernteil ohne Präfix, wenn er von Nichtziffern begrenzt ist (sonst träfe eine Ziffernfolge innerhalb einer IBAN).
- **Vorauswahl:** Nur wenn die Nummer erkannt wird und der Betrag dem Restbetrag entspricht. Das ist die heutige Regel.
- **Kundenname:** Steckt der Kundenname (Firma oder Vor- und Nachname) in der Gegenpartei, werden die offenen Rechnungen dieses Kunden als Kandidaten vorgeschlagen, bevorzugt die mit passendem Betrag. Der Name führt nie zu einer Vorauswahl.
- `lib/import/document-reference.ts` behält `extractDocumentNumberCandidates` für `lib/payment-matching.ts` (Budget-Schnittstelle). Diese nutzt für die Nummernerkennung dieselbe neue Normalisierung und bleibt sonst unverändert (bucht nur bei exakt passendem Restbetrag).

## Externe Schnittstelle

`POST /api/external/payments` akzeptiert zusätzlich ein optionales Feld `bankReference` (String, max. 100 Zeichen). Es landet in `Payment.bankReference`, und eine Zahlung mit derselben Referenz auf derselben Rechnung wird nicht noch einmal gebucht. Ohne das Feld verhält sich die Schnittstelle wie bisher.

## Ablauf und Oberfläche (`app/(app)/invoices/import/*`)

1. **Hochladen** (`parseStatement`, `requireEditor`): Die Datei wird geparst, `BankStatementImport` und die neuen `BankTransaction`-Zeilen werden in einer Transaktion gespeichert, bekannte Bewegungen übersprungen. Das Ergebnis zeigt Warnungen (Saldo, IBAN, Währung) und die Zahl neuer und übersprungener Bewegungen.
2. **Offene Bewegungen** (alle Importe, nicht nur der letzte, damit man später weitermachen kann):
   - **Eingänge:** wie heute mit Kandidaten und Vorauswahl. Zusätzlich „Ignorieren“. Ein Eingang ohne offene Rechnung kann nur ignoriert werden. Ein Hinweis erklärt, dass er schon über die Budget-App verbucht sein kann.
   - **Ausgaben:** je Zeile ein Kontrollkästchen, Datum, Betrag, Gegenpartei, Text und eine Kategorie-Auswahl (leer erlaubt). Geschäft und Privat laufen über ein Konto, daher ist **nichts vorausgewählt**: Nur angekreuzte Zeilen werden beim Bestätigen zu Ausgaben, der Rest bleibt offen und unverändert. Eine Ausgabe entsteht nie ohne diese ausdrückliche Wahl.
     - **Bekannte Empfänger:** Hat eine normalisierte Gegenpartei schon eine übernommene Ausgabe (`BankTransaction.expenseId` gesetzt), ist die Zeile vorausgewählt und die Kategorie vorbelegt (zuletzt verwendete Kategorie). Hat sie nur ignorierte Bewegungen, steht die Zeile ausgegraut in einem eingeklappten Bereich „Bisher ignoriert“. So bleibt die Liste nach den ersten Monaten kurz, ohne eigene Regel-Tabelle.
     - **Sammelaktion:** „Alle sichtbaren ignorieren“ für den Rest, der privat ist.
     - Ausgaben werden **nicht** automatisch vorausgewählt, wenn die Gegenpartei neu ist.
3. **Bestätigen:**
   - Eingang → `recordPayment` (`source = "camt-import"`, `bankReference` der Bewegung), dann `BankTransaction.paymentId` setzen. Der Betrag ist der der Bewegung, nicht der Restbetrag (Vorschau bietet auch abweichende Beträge an, wie in F5).
   - Ausgabe → `Expense` mit Datum, Beschreibung (Gegenpartei und Text), Betrag als Absolutwert und Kategorie anlegen, dann `expenseId` setzen.
   - Jede Bewegung wird nur verbucht, wenn sie noch offen ist. Bereits verbuchte Zeilen (zweiter Tab, Doppelklick) werden übersprungen.
4. **Importverlauf:** Liste der Importe mit Datum, Datei, Zeitraum, Anzahl und Saldowarnung. „Rückgängig“ löscht den Import samt seinen Bewegungen, aber nur wenn keine davon verbucht ist (`paymentId`/`expenseId` leer). Ignorierte Bewegungen dürfen gelöscht werden. Sonst Fehlermeldung mit Hinweis, erst die Zahlungen oder Ausgaben zu löschen.

## Audit und Berechtigungen

- Alle Aktionen verlangen `requireEditor()`.
- Audit-Einträge: `CREATE BankStatementImport` (Datei, Zeitraum, Anzahlen), `CREATE Expense` je übernommener Ausgabe, `DELETE BankStatementImport` beim Rückgängigmachen. Zahlungen schreiben ihren Eintrag selbst über `recordPayment`.
- `logAudit` wird nie innerhalb eines `$transaction`-Callbacks aufgerufen, sondern danach.

## Auswirkungen auf Auswertungen

Übernommene Ausgaben sind normale `Expense`-Zeilen. Erfolgsrechnung, Analysen, Export und das F6-Jahrespaket brauchen keine Änderung. Neu gebuchte Zahlungen und Ausgaben lösen dieselben `revalidatePath`/`revalidateTag`-Aufrufe aus wie `markInvoicesPaidFromImport` heute.

## Tests

- **Unit:** Fingerprint (Referenz vorrangig, Zähler für identische Buchungen, stabil bei erneutem Import), Saldoprüfung (stimmt, weicht ab, Salden fehlen, Kontinuität), Matching (Nummer mit Leerzeichen, ohne Präfix, Ziffern in längerer Zahl kein Treffer, Kundenname nur Kandidat, Vorauswahl nur bei Nummer plus Betrag), Kategorie-Vorschlag, Vorauswahl nur bei bekannter Gegenpartei (neue Gegenpartei nie vorausgewählt, nur ignorierte Gegenpartei eingeklappt).
- **Integration** (Muster `tests/integration/camt-import-payments.test.ts`): Upload speichert und überspringt Duplikate, überlappende Auszüge, parallele Uploads (P2002), Eingang verbuchen setzt `paymentId` und Status, Ausgabe legt `Expense` an, Löschen der `Payment` macht die Bewegung wieder offen, Rückgängig nur ohne verbuchte Bewegungen, Schnittstelle mit und ohne `bankReference`.

## Dokumentation

CLAUDE.md (Abschnitt Bankimport, Fingerprint, Saldoprüfung, Schnittstelle), Benutzerhandbuch (`public/benutzerhandbuch.html`), Roadmap-Checkbox in `FEATURE_ANALYSE.md` und die Frage zur Budget-App in den offenen Fragen.

## Nicht Teil von F7

camt.054 und MT940, Importregeln per Muster (wie in der Budget-App), freie Einnahmenbuchung ohne Rechnung, Zuordnung einer Bewegung zu mehreren Rechnungen (Sammelzahlung), Fremdwährungen, Kontoverwaltung. Kundenguthaben und Skonto gehören zu späteren Zahlungsarten aus F5.
