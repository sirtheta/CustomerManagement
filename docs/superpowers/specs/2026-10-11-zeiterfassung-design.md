# Zeiterfassung und Materialerfassung — Design

Stand: 2026-10-11.

## Ziel

Wer vor Ort arbeitet, erfasst direkt mobil, wie viel Zeit für einen Kunden aufgewendet und welches Material verbraucht wurde. Wer die Rechnungen erstellt, erzeugt daraus mit einem Klick einen Rechnungsentwurf und bearbeitet ihn im bekannten Rechnungsformular weiter. Die Erfassung ist ein optionales Modul `timeTracking`; wer es nicht braucht, schaltet es unter Einstellungen → Module aus.

Es ist eine Leistungserfassung zum Verrechnen, keine gesetzliche Arbeitszeiterfassung (keine Stempeluhr, keine Überstunden, kein Lohn).

## Nicht im Umfang

- Eigene Rolle «Mitarbeiter» oder eingeschränkte Sichtbarkeit: Beide Personen arbeiten als Editor oder Admin und sehen alles.
- Stundensatz pro Person oder gestaffelte Sätze (Zuschläge sind im Katalog eine eigene Leistung).
- Projekte oder Einsatzorte als eigenes Objekt: Ein Eintrag gehört zu einem Kunden, mehr nicht.
- Offline-Erfassung, Service Worker, lokale Warteschlange.
- Start/Stopp-Timer: Die Dauer wird direkt eingegeben.
- Foto vom Lieferschein am Materialeintrag.
- Nav-Badge oder Dashboard-Karte für offene Erfassungen, Offerten aus Einträgen, Berichte pro Zeitraum.
- Ein Knopf «Einträge wieder freigeben», wenn im Entwurf eine Position gelöscht wird (die Einträge bleiben verrechnet).

## Entscheidungen

- **Eine Tabelle `WorkEntry`** für Zeit und Material. Zeit oder Material ergibt sich aus der Einheit: `Hour`/`Day` ist Zeit, `Piece`/`Package` ist Material.
- **Stundensätze und Materialpreise stehen im Leistungskatalog** (`Service`). Ein einheitlicher Satz ist eine Leistung, mehrere Sätze sind mehrere Leistungen mit Einheit `Hour`.
- **Der Preis wird beim Verrechnen gelesen, nicht beim Erfassen.** Bei der Erfassung werden keine Preise angezeigt.
- **Auf der Rechnung zusammengefasst pro Leistung**, nicht pro Eintrag.
- **Eintrag = Kunde, Datum, Dauer/Menge, Leistung, optionale interne Notiz.**

## Datenmodell

Neues Modell `WorkEntry`:

| Feld | Typ | Bedeutung |
|---|---|---|
| `id` | `Int @id @default(autoincrement())` | |
| `customerId` | `Int` | Relation auf `Customer`, `onDelete: Restrict` (Kunden mit Daten werden archiviert) |
| `date` | `DateTime` | Kalendertag als UTC-Mitternacht wie `Payment.date`; «heute» ist `swissToday` |
| `serviceId` | `Int?` | Relation auf `Service`, `onDelete: SetNull`; leer bei Freitext |
| `name` | `String` | Bezeichnung als Snapshot (aus dem Katalog oder Freitext) |
| `unit` | `Unit` | `Hour`, `Day`, `Piece`, `Package` |
| `quantity` | `Decimal` | Menge in der Einheit |
| `note` | `String?` | interne Notiz, nie auf der Rechnung |
| `invoiceId` | `Int?` | Relation auf `Invoice`, `onDelete: SetNull`; gesetzt = verrechnet |
| `createdById` | `Int` | wie `SentDocument.createdById` ohne Relation auf `User` |
| `createdAt`, `updatedAt` | `DateTime` | |

Indizes auf `customerId`, `date`, `invoiceId`. Rückrelationen `workEntries` auf `Customer`, `Service` und `Invoice`.

`ApplicationSettings.moduleTimeTracking Boolean @default(true)`.

**Kunden löschen:** `WorkEntry.customer` ist `Restrict`. Kunden mit Einträgen (offen oder verrechnet) werden deshalb wie Kunden mit Rechnungen behandelt: `deleteCustomer` lehnt sie ab («Der Kunde hat erfasste Leistungen und kann nicht gelöscht werden. Bitte archivieren.»), und `DeleteCustomerButton` bietet in der Kundenliste und auf der Kundenseite das Archivieren an.

**Migration:** Eine neue, rückwärtskompatible Migration (`npx prisma migrate dev --name add_work_entries`). Anhängen an `20261001120000_invoicing_and_banking` ist nicht zulässig, weil sie im Tag `customer-management-v1.6.0` steckt. Es gibt keine Datenmigration. `scripts/startup.js` wendet sie in Produktion an und legt vorher den üblichen `pre-migration-*.db`-Snapshot an.

## Modul

- `lib/modules.ts`: `timeTracking` in `MODULE_KEYS`, `MODULE_FIELDS` (`moduleTimeTracking`) und `MODULE_INFO` (Label «Zeiterfassung»). Ausgeschaltet wird nur versteckt, die Daten bleiben. Kein `MODULE_BLOCKER`, kein Daily Job.
- `lib/navigation.ts`: Eintrag «Zeiterfassung» (`module: "timeTracking"`, Zugriff Editor) mit den Unterseiten «Erfassen» (`/time`) und «Offene Erfassungen» (`/time/open`).
- Jede Seite und jede Server Action unter `app/(app)/time/` ruft `requireModule("timeTracking")` auf.
- `tests/unit/module-guard-coverage.test.ts`: `timeTracking: ["(app)/time"]` in `MODULE_PATHS`.
- Rechte: Editor und Admin erfassen, ändern, löschen und verrechnen (`requireEditor`). Viewer sehen weder den Navigationseintrag noch die Seiten; ein direkter Aufruf zeigt `<EditorOnlyNotice />`.

## Erfassung (`/time`)

Eine mobile Seite im bestehenden `(app)`-Layout (responsiv mit Hamburger-Menü vorhanden). Alles ist auf einem Bildschirm, mit grossen Tippflächen:

- **Kunde:** Combobox wie in den Formularen (`autoHighlight`), vorbelegt mit dem Kunden des zuletzt erfassten Eintrags (serverseitig aus `WorkEntry`, nur wenn die URL keinen `?customer=` trägt). Leert man die Auswahl, bleibt sie leer (`?customer=none`), und «Speichern» ist gesperrt. Archivierte Kunden fehlen.
- **Datum:** Standard heute (`swissToday`), änderbar für nachträgliches Erfassen.
- **Umschalter «Zeit | Material»:**
  - Zeit: Leistung aus dem Katalog (aktiv, Einheit `Hour` oder `Day`). Gibt es nur eine, ist sie vorgewählt, sonst die zuletzt benutzte. Menge über Schnellwahl (Stunden 0,5 / 1 / 2 / 4 / 8, Tage 0,5 / 1), Stepper in 0,25-Schritten oder freie Eingabe.
  - Material: Katalogartikel (aktiv, `Piece` oder `Package`) oder Freitext (Bezeichnung, Einheit Stück oder Pauschale) plus Menge.
- **Notiz:** optional.
- **Speichern:** Kunde und Datum bleiben, Menge und Notiz werden geleert. Der Toast bestätigt mit «Rückgängig» (löscht genau diesen Eintrag, solange er nicht verrechnet ist). Bei einem Fehler bleibt die Eingabe über `submitKeepingInput` stehen; die Ergebnisse laufen über `useActionToast`.
- **«Erfasst, noch nicht verrechnet»:** Liste der nicht verrechneten Einträge des gewählten Kunden (die letzten 30) mit Bearbeiten und Löschen. Bearbeitet werden Datum, Menge und Notiz; Leistung oder Kunde ändert man durch Löschen und Neuerfassen. Der Bearbeiten-Dialog behält die Eingabe bei einem Fehler. Verrechnete Einträge sind schreibgeschützt.

### Validierung (serverseitig, `lib/work-entries.ts`)

- Menge > 0, höchstens 2 Nachkommastellen, Obergrenze 9999,99.
- Stunden höchstens 24 pro Eintrag (Schutz vor Tippfehlern); Stunden und Tage nur in Viertel-Schritten.
- Mit `serviceId`: Die Leistung muss aktiv sein und ihre Einheit muss zur Einheit des Eintrags passen. Name und Einheit werden vom Server aus der Leistung übernommen, nicht vom Client.
- Der Kunde muss aktiv sein (`assertCustomerActive`).
- Ein verrechneter Eintrag lässt sich serverseitig weder ändern noch löschen.

Audit: `CREATE`, `UPDATE`, `DELETE` auf `WorkEntry` über `logAudit` (nie innerhalb einer Transaktion).

## PWA

- `app/manifest.ts`: Name «CustomerManagement» und Kurzname «Kunden» (neutral, weil das Manifest für die ganze App gilt, auch für Viewer und bei ausgeschaltetem Modul), `display: standalone`, `start_url: /time`, Icons 192, 512 und maskable in `public/icons/` (erzeugt mit `npm run pwa:icons`).
- Kein Service Worker, keine Offline-Funktion.
- `proxy.ts` leitet nicht angemeldete Anfragen auf `/login` um. Der Browser lädt das Manifest ohne Cookies, deshalb werden `/manifest.webmanifest` und die Icon-Dateien von diesem Redirect ausgenommen. Es sind öffentliche Dateien ohne sensible Inhalte.
- Die Sitzung bleibt wie bisher 7 Tage gültig und verlängert sich bei Nutzung.

## Verrechnung

### Seiten

- `/time/open`: Kunden mit nicht verrechneten Einträgen (Anzahl, Stunden gesamt, Anzahl Materialpositionen, ältester Eintrag). Archivierte Kunden erscheinen mit dem Badge «archiviert», ihre Einträge werden nicht ausgeblendet.
- `/time/open/[customerId]`: Tabelle der offenen Einträge (Datum, Leistung, Menge, Notiz), standardmässig alle angehakt, einzelne abwählbar; Korrigieren (derselbe Dialog wie auf `/time`) und Löschen sind hier möglich. Bei einem archivierten Kunden ist das Erstellen gesperrt. Darunter die Vorschau der Rechnungspositionen mit Preisen; Positionen ohne Preis sind markiert («Preis im Entwurf ergänzen»). Der Button «Rechnungsentwurf erstellen» legt den Entwurf an und öffnet `/invoices/[id]`.

### Positionen (`lib/work-billing.ts`, rein und ohne Prisma)

- Einträge mit `serviceId` werden pro Leistung summiert. Name, Beschreibung, Einheit, Preis und Kategorie kommen aus dem Katalog zum Zeitpunkt der Verrechnung.
- Einträge ohne Leistung (Freitext, oder Leistung inzwischen gelöscht) werden pro Bezeichnung und Einheit summiert, mit Preis 0.
- Hat sich die Einheit der Leistung im Katalog nach dem Erfassen geändert (Stunden würden sonst als Tage oder Stück zum neuen Preis verrechnet), wird der Eintrag wie Freitext behandelt: eigene Position in der erfassten Einheit, Preis 0.
- Positionen ohne verwendbare Katalogleistung sind in der Vorschau als «Preis im Entwurf ergänzen» markiert; eine Katalogleistung mit Preis 0 gilt nicht als fehlend.
- Die Positionsbeschreibung enthält die Einsatztage (z. B. «Einsatztage: 12.10., 14.10., 20.10.», als `dd.MM.` aus dem UTC-Tag, ohne Jahr). Sie lässt sich im Entwurf löschen.
- Beträge: `calculateItemTotal` und `calculateInvoiceTotal` mit `loadTotalOptions()`, die 5-Rappen-Rundung greift also wie bei jeder Rechnung. Rabatt 0.
- Rechnungsdatum ist heute (`swissToday`), die Fälligkeit kommt aus `effectivePaymentTermDays(customer, settings.defaultPaymentTermDays)`.

### Atomares Verknüpfen

`createDocumentWithItems` (`lib/document-actions.ts`) bekommt einen optionalen Hook `onCreated(tx, id)`, wie ihn `recordPayment` schon kennt; bestehende Aufrufer bleiben unverändert. Der Hook setzt in derselben Transaktion `invoiceId` per `updateMany` auf die Einträge, die `invoiceId = null` haben, zum gewählten Kunden gehören, in der Auswahl sind und seit dem Lesen unverändert sind (`updatedAt` stimmt mit dem gelesenen Stand überein, weil die Positionen aus genau diesem Stand gebaut wurden). Stimmt die Zahl der aktualisierten Zeilen nicht mit der Auswahl überein (Doppelklick, zwei Tabs, fremder Kunde, zwischenzeitlich geänderter Eintrag), wird die Transaktion zurückgerollt, es entsteht keine Rechnung, und es erscheint eine Fehlermeldung. `assertCustomerActive` gilt wie bei `createInvoice`.

### Danach

- Der Entwurf wird im bekannten Formular bearbeitet. Die Einträge hängen an der Rechnung und nicht an den Positionen, Änderungen im Entwurf berühren sie nicht.
- Wird der Entwurf gelöscht (`deleteInvoice`, nur Admin), werden die Einträge über `SetNull` wieder frei. Ein Editor kann den Entwurf nur bearbeiten.
- Wird im Entwurf eine Position gelöscht, bleiben die zugehörigen Einträge verrechnet (bewusst in Kauf genommen).
- Audit: `CREATE Invoice` mit dem Vermerk «aus N Erfassungen» (die genaue Form richtet sich nach der Signatur von `logAudit`).

## Fehlerfälle

| Fall | Verhalten |
|---|---|
| Doppelverrechnung | Rollback, Fehlermeldung, keine Rechnung |
| Leistung später gelöscht | Name bleibt als Snapshot, Preis 0, in der Vorschau markiert |
| Leistung später deaktiviert | Der Eintrag wird mit dem Katalogpreis verrechnet |
| Einheit der Leistung später geändert | Der Eintrag wird wie Freitext in der erfassten Einheit mit Preis 0 verrechnet, in der Vorschau markiert |
| Eintrag zwischen Lesen und Verrechnen geändert | Rollback, Fehlermeldung, keine Rechnung |
| Kunde mit Einträgen löschen | `deleteCustomer` lehnt ab, die Oberfläche bietet Archivieren an |
| Kunde archiviert | Erfassen und Verrechnen werden mit der Meldung von `assertCustomerActive` abgelehnt |
| Verrechneten Eintrag ändern oder löschen | serverseitig abgelehnt, auch aus einem alten Tab |
| Modul ausgeschaltet | Navigation, Seiten und Actions versteckt, Daten bleiben |

## Tests (Vitest)

- Unit: Gruppierung und Preise in `lib/work-billing.ts` (Summen, Freitext mit Preis 0, geänderte Einheit, Katalogleistung mit Preis 0, Tagesliste, 5-Rappen-Rundung mit einem Betrag, den die Rundung wirklich ändert, Mengengenauigkeit); Validierungsregeln in `lib/work-entries.ts`.
- Integration (temporäre SQLite): Verrechnen markiert die Einträge atomar; ein zweiter Versuch schlägt fehl und legt keine Rechnung an; ein nach dem Lesen geänderter Eintrag wird nicht verrechnet; Einträge eines anderen Kunden in der Auswahl werden abgelehnt; archivierter Kunde wird abgelehnt; das Löschen des Entwurfs gibt die Einträge frei; verrechnete Einträge sind serverseitig gesperrt; ein Kunde mit Einträgen lässt sich nicht löschen; `listOpenWork` kennzeichnet archivierte Kunden.
- Actions: Viewer werden abgelehnt, bei ausgeschaltetem Modul erfolgt ein Redirect.
- Statisch: `module-guard-coverage` mit `timeTracking`; Navigation blendet den Eintrag bei ausgeschaltetem Modul aus.
- Proxy: `/manifest.webmanifest` und die Icons sind ohne Anmeldung erreichbar, alle anderen Pfade nicht.

## Doku

- Neuer Abschnitt «Zeiterfassung» im `public/benutzerhandbuch.html` auf Deutsch; die Versionsmarker pflegt `release-please`.
- Ein Absatz in `CLAUDE.md` unter «Business document workflow» und die Modulliste ergänzen.
- Commits auf Englisch im Format `feat(time-tracking): …`, ein Commit pro Umsetzungsschritt.

## Umsetzungsreihenfolge

1. Schema, Migration und Modul-Anbindung.
2. Erfassung (`lib/work-entries.ts`, Actions, Maske).
3. PWA und Proxy-Ausnahme.
4. Verrechnung (`lib/work-billing.ts`, `onCreated`-Hook, Seiten).
5. Handbuch und `CLAUDE.md`.
