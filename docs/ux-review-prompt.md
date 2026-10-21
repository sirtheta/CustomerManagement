# UX-Review: Verständlichkeit für neue Kunden

## Ausgangslage

Wir haben einem neuen Kunden beim ersten Einsatz der Kundenverwaltung zugesehen. Das UX war für ihn nicht durchgehend verständlich: an mehreren Stellen war unklar, was als Nächstes zu tun ist, was ein Begriff oder Knopf bewirkt oder ob eine Aktion geklappt hat. Wir wissen noch nicht, welche Stellen genau das sind. Deine Aufgabe ist, sie zu finden.

Die App ist ein Kundenverwaltungssystem für Schweizer Kleinbetriebe (Next.js 16, Deutsch, Prisma/SQLite). Lies zuerst `CLAUDE.md` im Projektroot, damit du die Module und Abläufe kennst (Kunden, Rechnungen, Offerten, Zahlungen, Abos, Mahnungen, Bankimport, Zeiterfassung, Einstellungen).

## Rolle

Du bist kein Entwickler, der Code prüft, sondern eine Person, die die App zum ersten Mal sieht: Inhaberin oder Inhaber eines Kleinbetriebs (Handwerk, Dienstleistung, 1 bis 5 Mitarbeitende), nicht technisch, kennt Word und Excel, keine Buchhaltungsausbildung, will Rechnungen mit QR-Einzahlungsschein schreiben und wissen, wer bezahlt hat. Sie liest nicht die Doku, sie klickt.

## Wie du vorgehst

### 1. App starten (isoliert, nie die Entwicklungsdaten anfassen)

Starte eine eigene Instanz mit eigener Datenbank. Nutze die Ports und Pfade unten, damit nichts mit `data/` oder der laufenden Dev-Instanz kollidiert.

- Datenbank: `data-ux-review/ux.db` (neu anlegen, `npx prisma migrate deploy` mit `DATABASE_URL=file:<absoluter Pfad>`).
- Server: `next dev -p 3200` mit `DATABASE_URL`, `AUTH_SECRET=ux-review-secret-not-used-in-production-32chars`, `ADMIN_EMAIL=admin@ux.local`, `ADMIN_PASSWORD=ux-review-password`, `DISABLE_EMAIL=true`, `DISABLE_TELEGRAM=true`. Wie `playwright.config.ts` und `prisma/seed.ts` den Admin anlegen, kannst du dort nachlesen.
- Bevorzugt eine **leere** Datenbank, denn der Kunde stand vor einer leeren App. Falls der Admin nur über das Seed-Skript entsteht, nimm das Seed und prüfe die Leerzustände zusätzlich im Code (`EmptyState`, «Noch keine …»-Texte).
- Browser: nutze den eingebauten Browser (`mcp__Claude_Browser__*`, `preview_start` mit URL). Wenn er nicht verfügbar ist, schreibe ein Playwright-Skript im Scratchpad und sieh dir die Screenshots an. Ohne gesehene Oberfläche ist das Review wertlos: Texte allein im Code zu lesen reicht nicht.

### 2. Aufgaben aus Sicht der neuen Person durchspielen

Führe jede Aufgabe so durch, als wüsstest du nichts. Halte bei jedem Schritt fest, wo du gezögert hättest. Die Aufgaben, in dieser Reihenfolge:

1. **Erster Start:** Anmelden, Dashboard ansehen. Verstehe ich, was ich als Erstes tun soll? Ist die Navigation selbsterklärend?
2. **Firma einrichten:** Firmendaten, Logo, IBAN/QR-Rechnung, Nummernkreise, Zahlungsfrist. Was ist Pflicht, was nicht? Was passiert, wenn ich etwas vergesse (Fehlermeldung, Hinweis, stilles Versagen)?
3. **Leistungen/Artikel anlegen** (`/services`), inkl. Einheiten und Kategorien.
4. **Ersten Kunden anlegen**, auch mit abweichender Rechnungsadresse, und danach wiederfinden.
5. **Erste Rechnung erstellen, prüfen, senden:** Entwurf, Positionen, Rabatt, Vorschau/PDF, Senden-Dialog, Status danach. Ist klar, was «Entwurf» heisst, wann die Rechnungsnummer vergeben wird und warum sie danach nicht mehr bearbeitbar ist?
6. **Zahlung erfassen** (manuell) und dann eine Gutschrift auf eine Rechnung.
7. **Offerte** erstellen, senden, in Rechnung umwandeln.
8. **Zeiterfassung** auf einem Handy-Viewport (375x812): Erfassen, später abrechnen.
9. **Danach**, wenn Zeit bleibt: Abo, Mahnung, Bankimport, OP-Liste, Aktivitätsprotokoll.

Prüfe jede Aufgabe auf Desktop (1280 px) und mindestens die Aufgaben 4, 5 und 8 auf dem Handy (375 px).

### 3. Worauf du achtest

Bewerte jede Stelle gegen diese Fragen, nicht gegen Geschmack:

- **Orientierung:** Weiss ich, wo ich bin und was der nächste Schritt ist? Gibt es einen erkennbaren Hauptknopf pro Seite?
- **Wortwahl:** Versteht eine Nicht-Buchhalterin «OP-Liste», «Debitor», «Gutschrift», «Stufe», «Rundung», «Archivieren», «Verwerfen»? Sind Begriffe überall gleich (Rechnung/Faktura, Kunde/Debitor)? Gibt es Fachjargon oder Entwicklerjargon in der Oberfläche?
- **Rückmeldung:** Sehe ich nach jeder Aktion, dass sie geklappt hat (Toast, Statuswechsel)? Sind Fehlermeldungen konkret («Die E-Mail-Adresse fehlt»), sagen sie, was zu tun ist, und stehen sie neben dem betroffenen Feld?
- **Vorhersehbarkeit:** Ist vor einer Aktion klar, was sie bewirkt (Senden, Archivieren, Verwerfen, Gutschrift)? Sind unumkehrbare Aktionen bestätigt und sind die Bestätigungstexte verständlich? Sind Knöpfe, die nicht gehen, erklärt (statt nur grau)?
- **Formulare:** Pflichtfelder erkennbar? Sinnvolle Vorgaben? Muss ich Dinge doppelt eingeben? Gehen Eingaben bei einem Fehler verloren? Tastaturbedienung (Enter, Tab)?
- **Leerzustände:** Sagt eine leere Liste, was sie ist und wie ich den ersten Eintrag anlege?
- **Informationsdichte:** Zu viele Optionen auf einmal? Gehören Spezialfunktionen (Module, Rundung, Mahngebühren) hinter eine zweite Ebene? Werden Module, die ich nicht brauche, versteckt?
- **Konsistenz:** Gleiche Dinge sehen gleich aus und heissen gleich (Datumsformat, Währung, Knopfplatzierung, Status-Badges).
- **Mobile:** Sind Touch-Ziele gross genug, ist nichts abgeschnitten, ist Tabellen-Scrollen nötig, wo Karten besser wären?
- **Barrierefreiheit (kurz):** Kontrast, Fokus sichtbar, Labels an Feldern, Status nicht nur über Farbe.
- **Vertrauen:** Fühlt sich eine Rechnung versenden sicher an? Sehe ich vorher, was der Empfänger bekommt?

Ignoriere reine Optik (Farbwahl, Abstände), ausser sie verhindert Verständlichkeit.

### 4. Regeln

- **Nur lesen und bedienen, nichts im Repository ändern, nichts committen.** Kein `git`-Schreibbefehl, keine Edits an Quelldateien. Du darfst im Scratchpad Skripte und Screenshots ablegen und `data-ux-review/` anlegen.
- Nichts senden, was ausserhalb des lokalen Rechners ankommt (`DISABLE_EMAIL=true` ist gesetzt, trotzdem keine echten Adressen verwenden; nimm `@example.com`).
- Keine echten Zugangsdaten verwenden; die oben genannten Testwerte gehören zu dieser lokalen Instanz.
- Stoppe den Dev-Server am Ende wieder.
- Erfinde keine Probleme. Nur was du gesehen oder im Code nachgelesen hast, kommt in den Bericht. Markiere Vermutungen als solche.
- Prüfe vor jedem Befund, ob es sich um absichtliches Verhalten handelt (siehe `CLAUDE.md`, z.B. gesperrte Rechnungen ausser Entwurf). Absichtliches Verhalten kann trotzdem schlecht erklärt sein; das ist dann ein UX-Befund («Verhalten richtig, Erklärung fehlt»).

## Bericht

Schreibe den Bericht auf **Deutsch** in `docs/ux-review-ergebnis.md` (die einzige Datei, die du anlegen darfst), und gib am Ende in der Antwort eine Zusammenfassung von höchstens 15 Zeilen.

Struktur:

1. **Kurzfazit** (5 Sätze): Wo scheitert eine neue Person am wahrscheinlichsten? Was funktioniert schon gut?
2. **Befunde**, sortiert nach Schwere. Pro Befund:
   - **Titel** und **Schwere**: *Blocker* (Aufgabe nicht ohne Hilfe lösbar), *Hoch* (Fehler oder falsche Annahme wahrscheinlich), *Mittel* (Zögern, Rückfrage nötig), *Niedrig* (Politur).
   - **Wo:** Route und, wenn möglich, `datei:zeile` der Komponente oder des Textes.
   - **Was passiert:** konkret aus Sicht der neuen Person (was sie sieht, was sie erwartet, was sie tut).
   - **Warum verwirrend:** eine Frage aus Abschnitt 3 benennen.
   - **Vorschlag:** konkrete Änderung, bei Texten mit dem neuen Wortlaut. Klein halten; keine Neugestaltung vorschlagen, wenn ein Satz reicht.
   - **Beleg:** Screenshot-Pfad oder Zitat des Textes.
3. **Wortliste:** alle Begriffe, die erklärt, umbenannt oder vereinheitlicht werden sollten, mit Vorschlag.
4. **Quick Wins:** die zehn Änderungen mit dem besten Verhältnis aus Wirkung und Aufwand.
5. **Nicht geprüft:** was du ausgelassen hast und warum (z.B. Bankimport mangels CAMT-Datei).

Mach den Bericht so kurz wie möglich, aber vollständig bei den Blockern und hohen Befunden. Keine Wiederholungen derselben Ursache: gleichartige Befunde zu einem zusammenfassen und die Fundstellen auflisten.
