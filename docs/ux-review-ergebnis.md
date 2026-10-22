# UX-Review: Ergebnis (21.10.2026)

Durchgeführt auf einer isolierten Instanz (leere DB `data-ux-review/ux.db`, nur Admin, Port 3200, `DISABLE_EMAIL=true`) im eingebauten Browser, Desktop 1280 px und Handy 375x812. Gesehen wurde v1.8.3.

**Belege:** Screenshots liegen unter
`C:\Users\micha\.claude\projects\C--Projects-CustomerManagement\c6d6ad80-8c16-42b5-8fe6-987d506e09e2\tool-results\` und sind unten als `SS/<datei>` abgekürzt. Die gerenderten PDFs (Entwurf, versendet) liegen im Scratchpad unter `...\scratchpad\pdfs\`.

---

## 1. Kurzfazit

Eine neue Person scheitert am wahrscheinlichsten ganz am Anfang: das Dashboard ist leer und sagt nicht, dass zuerst Firmendaten und IBAN hinterlegt werden müssen; vergisst sie die IBAN, gehen Rechnungen **ohne QR-Einzahlungsschein** raus, ohne jeden Hinweis. Beim Einrichten selbst gehen bei einem Tippfehler (z.B. IBAN) **alle eingegebenen Firmendaten verloren**. Bei Rechnungen führt die Positionsliste mit «Gesamt» ohne Gesamtrabatt und ein Preisfeld, das «85,50» stillschweigend zu 8'550 macht, zu falschen Beträgen. Gut funktionieren: der Versand-Dialog (zeigt Empfänger, voraussichtliche Nummer und Mailvorschau), Toasts nach Senden/Zahlung, die Bestätigung «Ohne Versand als … markieren?», die Kunden-Validierung mit Fehler am Feld, die globale Suche und die mobile Zeiterfassung. Leerzustände sind bei Kunden und Rechnungen vorbildlich, bei Leistungen und Offerten fehlt der Erstellen-Knopf.

---

## 2. Befunde

### Blocker

#### B1 Fehlende IBAN führt still zu Rechnungen ohne QR-Einzahlungsschein
- **Wo:** `/settings` (Firmendaten), Versand unter `/invoices/[id]`; `lib/pdf/qrbill-helpers.ts:61` (`if (!company.companyIBAN) return null`), `lib/pdf/invoice-pdf.ts:41`. Kein IBAN-Hinweis in `app/(app)/invoices/**` (grep «IBAN|QR»: nur Bankimport).
- **Was passiert:** Firmendaten haben keine Pflichtfelder, man kann ohne IBAN speichern. Danach lässt sich jede Rechnung normal senden; das PDF hat dann schlicht keine zweite Seite mit QR-Teil. Der Entwurf-PDF zeigt nie einen QR-Teil (absichtlich), also sieht die Person auch in der Vorschau nicht, dass er fehlen wird.
- **Warum verwirrend:** Rückmeldung (stilles Versagen), Vertrauen. Hauptziel der Zielgruppe ist «Rechnung mit QR-Einzahlungsschein».
- **Vorschlag:** (a) Im Senden-Dialog und auf der Rechnungsseite, solange keine IBAN hinterlegt ist, ein Warnbanner: «Keine IBAN hinterlegt: Die Rechnung wird ohne QR-Einzahlungsschein versendet. → IBAN in den Einstellungen erfassen». (b) Im Entwurf-PDF unten den Hinweis «QR-Einzahlungsschein wird beim Senden angefügt» bzw. «… fehlt: keine IBAN hinterlegt».
- **Beleg:** Code (oben); Entwurf-PDF `scratchpad\pdfs\invoice-1-draft.pdf` (keine QR-Seite), versendet `invoice-1-sent.pdf` (mit IBAN: QR-Seite vorhanden).

#### B2 Kein Einstieg für den ersten Start
- **Wo:** `/dashboard` (leer), `/invoices/new` ohne Kunden.
- **Was passiert:** Nach dem Login sieht man nur Nullen («Kunden 0», «Offene Rechnungen 0», «Keine Abos geplant.»). Kein Hinweis, dass Firmendaten/IBAN/SMTP fehlen, kein «So startest du». Wer direkt «Erste Rechnung erstellen» klickt, landet im Rechnungsformular, das Kundenfeld zeigt nur «Keine Kunden gefunden.» ohne Link zum Anlegen; man muss das Formular abbrechen.
- **Warum verwirrend:** Orientierung (kein nächster Schritt), Leerzustände.
- **Vorschlag:** Auf dem Dashboard eine Checkliste, die verschwindet, sobald erledigt: «1. Firmendaten und IBAN erfassen (Einstellungen) · 2. E-Mail-Versand einrichten · 3. Ersten Kunden anlegen · 4. Erste Rechnung schreiben». In der Kunden-Combobox bei leerem Ergebnis: «Keine Kunden gefunden. **+ Neuen Kunden anlegen**».
- **Beleg:** `SS/mcp-Claude_Browser-blob-1792612429859-hwg5iz.jpg`, `SS/...-1792612456320-8u9ra0.jpg`; `components/customer-combobox.tsx:51`.

### Hoch

#### H1 Einstellungen: ein Fehler löscht alle Eingaben
- **Wo:** `/settings`, `app/(app)/settings/SettingsForm.tsx:140-146` (Formular mit `key={state._ts…}` und `action={formAction}`, kein `submitKeepingInput`).
- **Was passiert:** Firmenname und eine zu kurze IBAN eingegeben, «Einstellungen speichern»: Toast «Ungültige IBAN: Die IBAN muss 21 Zeichen lang sein.», aber **alle Felder sind danach leer** (per JS geprüft: `companyName=` leer). Die Speicherleiste zeigt weiter «Ungespeicherte Änderungen», obwohl nichts mehr eingegeben ist. Die Fehlermeldung steht nur im Toast/Leiste, nicht am IBAN-Feld.
- **Warum verwirrend:** Formulare (Eingaben gehen verloren), Rückmeldung (Fehler nicht am Feld).
- **Vorschlag:** `submitKeepingInput` wie in den anderen Formularen verwenden; Fehler zusätzlich unter dem IBAN-Feld zeigen («Die IBAN muss 21 Zeichen lang sein, z.B. CH93 0076 2011 6238 5295 7»).
- **Beleg:** `SS/...-1792612485627-v7w8po.jpg`.

#### H2 Preisfelder verwerfen das Komma: «85,50» wird zu CHF 8'550.00
- **Wo:** `/services/new`, `app/(app)/services/ServiceForm.tsx:129` (`type="number"`); gleiche Bauart im Positionen-Editor (`components/items-editor.tsx`).
- **Was passiert:** In «Preis (CHF)» «85,50» getippt, gespeichert: Liste zeigt **CHF 8'550.00**. Im Eingabefeld wird das Komma beim Tippen verworfen (Wert danach `855` bei «85,5»), ohne Fehlermeldung. Browser-Sprache war de/de-CH.
- **Warum verwirrend:** Formulare, Rückmeldung. Komma ist die übliche Eingabe vieler Nutzer (Excel-Gewohnheit); der Fehler fällt erst auf der Rechnung auf.
- **Vorschlag:** Textfeld mit `inputmode="decimal"`, Komma und Punkt akzeptieren und in Punkt umwandeln; nach dem Speichern Toast «Leistung gespeichert: Malerarbeiten, CHF 85.50 / Stunde».
- **Beleg:** `SS/...-1792612546387-rdm4xv.jpg`.

#### H3 «Gesamt» im Rechnungsformular ignoriert den Gesamtrabatt
- **Wo:** `/invoices/new`, `/invoices/[id]/edit`, Gutschrift-Editor; `components/items-editor.tsx:382` und `:449`; Rabattkarte `app/(app)/invoices/InvoiceForm.tsx:281`.
- **Was passiert:** 8 h à 85.50, «Rabatt auf Gesamtrechnung» 10 %: das Formular zeigt weiter «Gesamt: CHF 684.00»; gespeichert wird CHF 615.60. Beim Gutschrift-Entwurf fehlt die Rabattkarte ganz, das Formular zeigt «Gesamt: CHF 684.00», gespeichert wird -615.60 (der Rabatt wird unsichtbar übernommen).
- **Warum verwirrend:** Vorhersehbarkeit, Vertrauen (Betrag vor dem Speichern falsch).
- **Vorschlag:** Unter den Positionen «Zwischensumme / Rabatt 10 % / Total» wie im PDF anzeigen; im Gutschrift-Editor den übernommenen Rabatt sichtbar machen («Rabatt der Originalrechnung: 10 %»).
- **Beleg:** `SS/...-1792612667481-l1ktpo.jpg`, `SS/...-1792612822111-0ymal5.jpg`, `SS/...-1792612831756-ckzvyk.jpg`.

#### H4 Offerte lässt sich mehrfach in Rechnungen umwandeln
- **Wo:** `/quotes/[id]`, `app/(app)/quotes/ConvertToInvoiceButton.tsx:30`, `app/(app)/quotes/actions.ts:195` (`convertQuoteToInvoice`, keine Prüfung auf bereits umgewandelt).
- **Was passiert:** Nach «Konvertieren» springt man in den Rechnungsentwurf; zurück auf der Offerte (Status «Angenommen») steht «Zu Rechnung konvertieren» weiterhin da, ohne Hinweis oder Link auf die bereits erzeugte Rechnung. Ein zweiter Klick erzeugt laut Code eine zweite Rechnung. Auch die Rechnung zeigt nicht, aus welcher Offerte sie stammt.
- **Warum verwirrend:** Vorhersehbarkeit, Orientierung; doppelte Rechnungen sind wahrscheinlich.
- **Vorschlag:** Nach der Umwandlung auf der Offerte «Umgewandelt in Rechnung [Entwurf/Nr.] →» zeigen und den Knopf ausblenden oder mit Rückfrage «Diese Offerte wurde bereits in eine Rechnung umgewandelt. Trotzdem eine weitere erstellen?». Auf der Rechnung «Aus Offerte Q-… ». Dialogtext ergänzen: «Es wird ein Rechnungsentwurf erstellt; die Offerte wird auf ‹Angenommen› gesetzt. Versendet wird noch nichts.»
- **Beleg:** `SS/...-1792612912266-c3zyt8.jpg`; Seitentext der Offerte nach Umwandlung (Status «Angenommen», Knopf weiter vorhanden).

#### H5 Senden ohne SMTP verbraucht eine Rechnungsnummer
- **Wo:** `lib/document-actions.ts:301-323` (Nummer wird vor dem Mailversand vergeben), `lib/smtp.ts:49`. Senden-Dialog zeigt keinen SMTP-Hinweis.
- **Was passiert (aus Code, nicht live, da `DISABLE_EMAIL=true`):** Ohne SMTP-Daten erhält die Rechnung beim Klick auf «Senden» ihre Nummer, das PDF wird archiviert, dann scheitert der Versand mit «SMTP nicht konfiguriert. Bitte SMTP-Einstellungen hinterlegen.». Die Rechnung bleibt ein nummerierter Entwurf, den man laut `deleteInvoice` nicht mehr löschen kann.
- **Warum verwirrend:** Vorhersehbarkeit (Knopf geht, obwohl er nicht gehen kann), Rückmeldung.
- **Vorschlag:** SMTP-Prüfung vor der Nummernvergabe; im Dialog bei fehlendem SMTP: «E-Mail-Versand ist noch nicht eingerichtet (Einstellungen → E-Mail Versand). Du kannst die Rechnung als PDF herunterladen und per Post schicken (Status ‹Versendet› setzen).» und «Senden» deaktivieren.
- **Beleg:** Code wie oben.

#### H6 Sperre nach dem Senden wird nicht angekündigt und nicht erklärt
- **Wo:** Senden-Dialog `/invoices/[id]`; Seite nach dem Versand. Hinweis existiert nur im Status-Dialog (`InvoiceStatusSelect.tsx:114`).
- **Was passiert:** Der Dialog sagt «Die Nummer wird beim Senden vergeben (voraussichtlich I-26100001).», aber nicht, dass die Rechnung danach nicht mehr änderbar ist. Nach dem Senden verschwindet «Bearbeiten» kommentarlos. «Entwurf» wird nirgends erklärt.
- **Warum verwirrend:** Vorhersehbarkeit («Verhalten richtig, Erklärung fehlt»), Wortwahl.
- **Vorschlag:** Im Dialog über «Senden»: «Nach dem Senden ist die Rechnung festgeschrieben und kann nicht mehr geändert werden. Korrekturen machst du mit einer Gutschrift.» Auf versendeten Rechnungen an der Stelle von «Bearbeiten»: «Versendete Rechnungen sind gesperrt. Fehler korrigieren: Gutschrift erstellen». Am Entwurf-Badge Tooltip «Entwurf: noch nicht versendet, ohne Nummer, frei änderbar».
- **Beleg:** `SS/...-1792612744375-on6t9i.jpg`, `SS/...-1792612779055-v5o0dr.jpg`.

#### H7 Positionen mit Preis 0 oder ohne Bezeichnung werden ohne Warnung gespeichert und versendet
- **Wo:** Offerte/Rechnung (`/quotes/new`), Rechnungsentwurf aus Zeiterfassung (`/invoices/4`).
- **Was passiert:** Eine «Eigene Position» ohne Bezeichnung und mit Preis 0 wurde gespeichert (Offerte mit CHF 0.00). Aus der Zeiterfassung entsteht für Freitext-Material eine Position «2 × Stück à CHF 0.00»; die Markierung «Preis im Entwurf ergänzen» aus der Vorschau erscheint im Entwurf nicht mehr. Senden prüft nur «keine Positionen».
- **Warum verwirrend:** Formulare, Vertrauen.
- **Vorschlag:** Bezeichnung als Pflicht markieren; im Entwurf und im Senden-Dialog Warnung «1 Position hat Preis 0 (Farbe weiss 10 l). Trotzdem senden?».
- **Beleg:** `SS/...-1792612872813-w0rod0.jpg`, `SS/...-1792612977511-sepn51.jpg`.

### Mittel

#### M1 Klick-Einstellungen auf frischer Installation: «Bitte zuerst die Einstellungen speichern.»
- **Wo:** `/settings`, `ImmediateCheckbox` («Rechnungsbetrag auf 5 Rappen runden», Module), `settings/actions.ts:535`, Logo `:237` («Keine Einstellungen gefunden»).
- **Was passiert:** Checkbox mit «Gilt sofort» anklicken → Fehler-Toast. Es gibt aber noch nichts zu speichern; der Speicherknopf erscheint erst nach einer Textänderung.
- **Vorschlag:** Einstellungszeile beim ersten Aufruf anlegen, oder Text: «Bitte zuerst oben die Firmendaten speichern.»
- **Beleg:** `SS/...-1792612504252-424i12.jpg`.

#### M2 PDF ohne Einstellungen: englische Rohantwort
- **Wo:** `app/api/invoices/[id]/pdf/route.ts:34` (`"Company settings not configured"`, Status 500, JSON). Aus Code.
- **Vorschlag:** Seite mit «Bitte zuerst die Firmendaten in den Einstellungen erfassen» oder den PDF-Knopf mit diesem Hinweis deaktivieren.

#### M3 Kundenseite: Hauptaktion versteckt, viel gleichzeitig offen
- **Wo:** `/customers/[id]`.
- **Was passiert:** Oben nur «Archivieren». Danach offene Eingabeformulare für Abo, Aufgabe, Dokument-Upload, Notiz; «Rechnungen / Neue Rechnung» erst weit unten. Nach dem Anlegen landet man in der Liste, nicht beim Kunden.
- **Warum verwirrend:** Orientierung (kein Hauptknopf), Informationsdichte.
- **Vorschlag:** Kopfzeile «Neue Rechnung» (primär), «Neue Offerte»; Abo-/Aufgaben-/Notizformulare hinter «+ hinzufügen» einklappen; nach «Speichern» auf die Kundenseite weiterleiten mit Toast «Kunde angelegt».
- **Beleg:** `SS/...-1792612638913-xdrdoo.jpg`.

#### M4 E-Mail beim Kunden ist Pflicht
- **Wo:** `/customers/new`, `app/(app)/customers/actions.ts:45`.
- **Was passiert:** Ohne E-Mail lässt sich kein Kunde speichern. Privatkunden im Handwerk haben oft keine oder man schickt per Post.
- **Vorschlag:** E-Mail optional; Senden-Dialog fordert sie erst beim Mailversand («Für diesen Kunden ist keine E-Mail hinterlegt»). Falls bewusst Pflicht: Hilfetext «Wird für den Rechnungsversand gebraucht».

#### M5 «PDF herunterladen» lädt nicht herunter, ist aber die einzige Vorschau
- **Wo:** `app/(app)/invoices/[id]/page.tsx:464`, `quotes/[id]/page.tsx:234` (öffnet in neuem Tab, `inline`).
- **Vorschlag:** «PDF ansehen». Im Senden-Dialog unter «Vorschau» zusätzlich «Anhang: rechnung-I-26100001.pdf (ansehen)», damit klar ist, dass das PDF mitgeht.
- **Beleg:** `SS/...-1792612771226-tig6nw.jpg` (Mailvorschau ohne Anhangsangabe).

#### M6 Status nach voller Gutschrift: «Bezahlt» statt «Storniert»
- **Wo:** `/invoices/1` nach Teilzahlung 300 + Gutschrift über den Gesamtbetrag.
- **Was passiert:** Rechnung zeigt «Bezahlt», «Überzahlt um CHF 300.00», OP-Liste «Guthaben CHF 300.00»; die Gutschrift erscheint in der OP-Tabelle nicht als Spalte. Der Dialog hatte die Überzahlung angekündigt (gut), aber «Bezahlt» widerspricht der Erwartung «storniert».
- **Vorschlag:** Badge-Text in diesem Fall «Erledigt (gutgeschrieben)» oder Zusatz «inkl. Gutschrift CHF 615.60»; OP-Liste Spalte «Gutgeschrieben». Im Gutschrift-Dialog ein Satz vorab: «Eine Gutschrift verringert oder streicht den Rechnungsbetrag, z.B. bei Fehlern oder Preisnachlass.»
- **Beleg:** `SS/...-1792612814783-dubun2.jpg`, Seitentext `/invoices/1`, `SS/...-1792613055681-0of5wj.jpg`.

#### M7 Offerte: Status-Auswahl zeigt nach dem Senden weiter «Entwurf»
- **Wo:** `app/(app)/quotes/QuoteStatusSelect.tsx:38` (`defaultValue` statt `value`; Konsole: «changing the default value state of an uncontrolled Select»).
- **Was passiert:** Badge oben «Versendet», Auswahl «Status ändern» unten «Entwurf».
- **Vorschlag:** kontrolliert machen wie `InvoiceStatusSelect` (`useOptimistic`).
- **Beleg:** `SS/...-1792612899466-e7s4qn.jpg`.

#### M8 Kategorie-Feld fehlt, solange keine Kategorie existiert
- **Wo:** `/services/new`, `ServiceForm.tsx:142` (`categories.length > 0 &&`).
- **Was passiert:** Liste hat Spalte «Kategorie», das Formular aber kein Feld und keinen Hinweis; Kategorien liegen unter Einstellungen → Kategorien.
- **Vorschlag:** Feld immer zeigen, leer mit «Noch keine Kategorien. **Kategorien verwalten →**».
- **Beleg:** `SS/...-1792612532194-2oxtfd.jpg`.

#### M9 «Rechnung senden» bleibt Hauptknopf auf versendeten und bezahlten Rechnungen
- **Wo:** `/invoices/[id]` nach Versand/Zahlung.
- **Vorschlag:** Nach dem Versand «Erneut senden» (sekundär); Hauptaktion «Zahlung erfassen». Bei «Bezahlt» kein blauer Senden-Knopf.
- **Beleg:** `SS/...-1792612790680-jeusl6.jpg`.

#### M10 Mobile: Listen als breite Tabellen
- **Wo:** `/customers`, `/invoices`, Vorschau in `/time/open/[customerId]` (375 px).
- **Was passiert:** Betrag/Status bzw. E-Mail sind abgeschnitten, man muss seitlich wischen; zwei Entwürfe desselben Kunden sind ohne Betrag nicht unterscheidbar. In der Abrechnungsvorschau ist «Preis im Entwurf ergänzen» abgeschnitten.
- **Vorschlag:** Auf Handys Karten (wie `/time/open` es schon macht): Nummer/Entwurf, Kunde, Betrag, Status.
- **Beleg:** `SS/...-1792612982748-0zurp3.jpg`, `SS/...-1792612986506-4q0tyf.jpg`, `SS/...-1792612968821-81dkkl.png`.

#### M11 Entwickler- und Englischbegriffe in der Oberfläche
- **Wo:** Browser-Tab/Logo «Nemicomp Quote & Invoice» (`lib/app-name.ts:2`); Aktivitätsprotokoll Spalte «Entität» mit «Invoice», «SentDocument», «WorkEntry», «Quote», «Payment», «Customer» (`settings/audit/page.tsx:156`); Rechnung «Prüfsumme (SHA-256)» (`invoices/[id]/page.tsx:313`); «Zu Rechnung konvertieren»; Präfixe «I-»/«Q-».
- **Vorschlag:** siehe Wortliste.

### Niedrig

- **N1 Leerzustände ohne Knopf:** `/services` «Keine Leistungen vorhanden.» (`services/page.tsx:113`), `/quotes` «Keine Offerten vorhanden.» (`quotes/page.tsx:227`). Vorschlag: wie Rechnungen «Noch keine Leistungen erfasst. [Erste Leistung anlegen]». Beleg `SS/...-1792612526536-bvlvcl.jpg`.
- **N2 Enter speichert keine Zahlung:** `PaymentsPanel.tsx:148` (kein `<form>`); Enter im Betragsfeld tut nichts. Vorschlag: Formular mit Submit.
- **N3 Kein Erfolgs-Toast** nach Leistung anlegen/ändern und Kunde anlegen (nur Weiterleitung).
- **N4 «Pause zwischen Mahnungen (Tage)»** mit Hilfetext, der mit «Zahlungsfrist auf dem Mahnbeleg» beginnt (`SettingsForm.tsx:268/277`): zwei Bedeutungen in einem Feld. Vorschlag Label «Frist nach einer Mahnung (Tage)», Hilfe «So viele Tage hat der Kunde nach einer Mahnung Zeit; erst danach erscheint die Rechnung wieder unter ‹Mahnungen›.»
- **N5 Mahnungen:** Stufe 1 heisst «Zahlungserinnerung», der Knopf «Mahnung senden» (`ReminderRow.tsx:221`); «Zurückstellen (14 Tage)» ohne Erklärung; «Mahnbeleg-Vorschau». Leere Liste erklärt nicht, wann Einträge erscheinen. Beleg `SS/...-1792613035543-gts68n.jpg`.
- **N6 Gleiche Seite, zwei Namen:** Menü «Ausstehende E-Mails» (`lib/navigation.ts:40`), Knopf auf `/subscriptions` «Ausstehende Abo-Rechnungen». Vorschlag überall «Abo-Rechnungen freigeben».
- **N7 «1 Kategorien»** (`CategoryManagement.tsx:179`); Checkbox «Aktiv» plus Badge «Aktiv» doppelt.
- **N8 Zeiterfassung Handy:** Erfolgs-Toast liegt über der unteren Tab-Leiste; Tipp auf «Offen» traf den Toast. Beleg `SS/...-1792612956524-269c4m.jpg`. «Einsatztage» wird auch bei Material in die Beschreibung geschrieben (`lib/work-billing.ts:78`).
- **N9 Nummernkreis ohne Beispiel:** «Rechnungspräfix I-» zeigt nicht, wie die Nummer aussieht (I-26100001). Hilfetext «Beispiel: I-26100001 (Präfix + JJMM + laufende Nummer)».
- **N10 Desktop-Navigation 1280 px:** mit Update-Banner wird die Menüleiste seitlich verschoben, das Logo ist angeschnitten («icomp Quote & Invoice»). Beleg `SS/...-1792613055681-0of5wj.jpg`.
- **N11 Kunden-Liste:** einziger Zeilenknopf ist ein roter «Löschen» (bei Kunden mit Rechnungen wird archiviert); Vorschlag Knopf «Öffnen», Löschen ins Detail.
- **N12 MWST:** Es gibt kein MWST-Feld. Für MWST-pflichtige Betriebe ist das ein Ausschlusskriterium; ein Satz in Einstellungen («Rechnungen werden ohne MWST ausgewiesen») würde falsche Annahmen verhindern. (Produktentscheid, nur Erklärung fehlt.)
- **N13 Dashboard zeigt Entwürfe nicht als offene Arbeit** («Offene Rechnungen 1» bei zusätzlichem Entwurf); Kachel «Entwürfe, noch nicht versendet: 1».

---

## 3. Wortliste

| Begriff heute | Problem | Vorschlag |
|---|---|---|
| Nemicomp Quote & Invoice | Englisch, Produktname statt Zweck | Firmenname aus Einstellungen oder «Kundenverwaltung» |
| Entwurf | Unklar, dass ohne Nummer und änderbar | Tooltip: «Noch nicht versendet, frei änderbar» |
| Zu Rechnung konvertieren / Konvertieren | Anglizismus | «In Rechnung umwandeln» |
| PDF herunterladen | öffnet Vorschau | «PDF ansehen» |
| Gutschrift | für Laien unklar wann | Untertitel «Rechnung ganz oder teilweise zurücknehmen» |
| Offene Posten, Stichtag, Altersstruktur | Buchhaltungsjargon | «Unbezahlte Rechnungen», «Stand per», «Wie lange schon offen» |
| Guthaben (OP-Liste) | Wessen Guthaben? | «Zu viel bezahlt (Guthaben Kunde)» |
| GuV (Menü «Ausgaben & GuV») | Abkürzung | «Ausgaben & Erfolgsrechnung» |
| Zahlungserinnerung / Mahnung / Stufe | Knopf sagt immer «Mahnung» | Knopf passend zur Stufe: «Zahlungserinnerung senden», «1. Mahnung senden» |
| Zurückstellen | unklar | «14 Tage später erinnern» |
| Mahnbeleg-Vorschau | Jargon | «Mahnung als PDF ansehen» |
| Pause zwischen Mahnungen | zwei Bedeutungen | «Frist nach einer Mahnung (Tage)» |
| Ausstehende E-Mails / Ausstehende Abo-Rechnungen | zwei Namen | «Abo-Rechnungen freigeben» |
| Entität, Invoice, SentDocument, WorkEntry, Quote, Payment, Customer, Settings | Entwickler-/Englischbegriffe | «Bereich»: Rechnung, Versand-PDF, Zeiteintrag, Offerte, Zahlung, Kunde, Einstellungen |
| Prüfsumme (SHA-256) | Technik | ausblenden oder «Fälschungsschutz: geprüft ✓» |
| Rechnungspräfix «I-», Offertenpräfix «Q-» | Englische Abkürzung als Vorgabe | Vorgabe «R-» / «O-» oder Beispiel anzeigen |
| UID | für Private unbekannt | «UID (Unternehmens-Nr., nur Firmen)» |
| Einsatztage (bei Material) | passt nicht | bei Material «Geliefert am» oder weglassen |
| camt.053 | Dateiformat | «Kontoauszug-Datei (camt.053, im E-Banking unter Export)» |
| Archivieren / Archiv | ok, aber Wirkung unklar | Hilfetext «Kunde wird ausgeblendet, Rechnungen bleiben erhalten» |
| Verwerfen (Einstellungen) | ok | ggf. «Änderungen verwerfen» |

---

## 4. Quick Wins

1. IBAN-Warnung im Senden-Dialog und auf der Rechnungsseite, wenn keine IBAN hinterlegt (B1).
2. `submitKeepingInput` im Einstellungsformular + IBAN-Fehler am Feld (H1).
3. Preisfelder als Textfeld mit `inputmode="decimal"`, Komma → Punkt (H2).
4. Zwischensumme / Gesamtrabatt / Total im Positionen-Editor anzeigen (H3).
5. «Zu Rechnung konvertieren» nach Umwandlung durch Link auf die Rechnung ersetzen (H4).
6. Satz im Senden-Dialog: «Nach dem Senden ist die Rechnung gesperrt; Korrekturen per Gutschrift.» (H6).
7. Dashboard-Checkliste für den ersten Start + «Neuen Kunden anlegen» in der leeren Kunden-Combobox (B2).
8. SMTP-Prüfung vor der Nummernvergabe, Hinweis im Dialog (H5).
9. `QuoteStatusSelect` kontrolliert machen (M7).
10. Leerzustände Leistungen/Offerten mit Erstellen-Knopf; «PDF herunterladen» → «PDF ansehen»; «Zu Rechnung konvertieren» → «In Rechnung umwandeln» (N1, M5, M11).

---

## 5. Nicht geprüft

- **Logo-Upload:** der eingebaute Browser kann keine Dateien hochladen.
- **Bankimport:** keine CAMT-Datei vorhanden; nur Leerzustand angesehen.
- **Echter Mailversand / SMTP-Fehlerfall:** `DISABLE_EMAIL=true`; H5 ist aus dem Code abgeleitet.
- **PDF im Browser:** Der Klick auf ein PDF löste im eingebauten Browser einen Speichern-Dialog aus (dieser kann abgebrochen werden); PDFs wurden stattdessen per Skript gerendert und gelesen. Mahnbeleg-PDF nicht angesehen.
- **Mahnung senden, Abo anlegen/Freigabe, Erfolgsrechnung, Auswertung, Jahrespaket, Benutzerverwaltung, 2FA, Rollen Editor/Viewer:** aus Zeitgründen nur angesehen bzw. ausgelassen.
- **Barrierefreiheit:** nur stichprobenweise (Labels am Kundenformular korrekt verknüpft; Kontrast/Fokus nicht systematisch geprüft).
- **Hinweis zur Durchführung:** Weil auf Port 3000 bereits ein `next dev` desselben Projekts lief (Next.js 16 sperrt `.next/dev`), lief die Review-Instanz aus einer Kopie der Quellen im Scratchpad (`--webpack`), mit `node_modules` als Verknüpfung. Für die Mahnung wurde in der Review-DB das Fälligkeitsdatum einer Rechnung zurückgesetzt und der Dev-Knopf «Benachrichtigungscheck jetzt auslösen» genutzt.
