# Absender-Profile — Design

Stand: 2026-10-22.

## Ziel

Eine Rechnung oder Offerte kann mit einem zweiten Absender erstellt werden, zum Beispiel wenn zwei Personen einer Familie unter eigenem Logo arbeiten. Die Firmendaten und das Firmenlogo aus den Einstellungen sind das erste Profil. Wird nichts gewählt, ändert sich nichts.

## Nicht im Umfang

- Eigene Adresse, IBAN oder QR-Rechnungs-Empfänger pro Profil: Beide arbeiten auf dasselbe Konto. Adresse, IBAN und QR-Creditor kommen immer aus den Firmendaten.
- Eigener SMTP-Absender oder eigene Mail-Signatur: Nur der Firmenname des Profils füllt `{companyName}` in Betreff und Text.
- Standardprofil pro Kunde oder pro Abo.
- Auswertungen nach Profil.

## Entscheidungen

- **Firmendaten sind das erste Profil.** Es gibt keine Migration des bestehenden Logos. `SenderProfile` hält nur weitere Absender.
- **Leere Felder fallen auf die Firmendaten zurück**, feldweise (`applySenderProfile`). Ein Profil nur mit Logo druckt also die Firmendaten mit dem anderen Logo.
- **Die Wahl steht am Dokument** (`Invoice.senderProfileId`, `Quote.senderProfileId`, `null` = erstes Profil), weil Entwürfe und Offerten bei jedem Aufruf neu gerendert werden.
- **Vererbung:** Gutschrift = Profil der Originalrechnung (das Formular bietet keine Wahl), Rechnung aus Offerte = Profil der Offerte, Mahnung = Profil der Rechnung. Abo- und Zeiterfassungs-Entwürfe starten mit dem ersten Profil und können im Entwurf geändert werden.
- **Löschen nur ungebraucht** (`onDelete: Restrict`), sonst «Inaktiv». Inaktive Profile sind für neue Dokumente nicht wählbar, bleiben aber an Dokumenten, die sie schon verwenden.
- **Änderungen am Profil wirken auf Entwürfe und Offerten**, die es verwenden. Versendete Rechnungen und Mahnungen bleiben unverändert, weil sie aus dem PDF-Archiv kommen.
- **Abo-Mails** lassen `{companyName}` im gespeicherten Text offen und lösen es beim Versand auf (wie `{totalAmount}`), damit ein später gewähltes Profil auch in Betreff und Signatur gilt.

## Datenmodell

`SenderProfile`: `id`, `name` (Bezeichnung in der Auswahl), `companyName?`, `companyHolderName?`, `companyEmail?`, `companyPhone?`, `logo?` (PNG, höchstens 300 px), `isActive`, `createdAt`, `updatedAt`. Rückrelationen `invoices`, `quotes`. Migration (zusammengefasst mit Offerten-Verknüpfung und Schlusstext in `20261023100000_sender_profiles_quote_link`): neue Tabelle und zwei nullable Spalten mit Fremdschlüssel.

## Umsetzung

- `lib/sender-profile.ts`: `applySenderProfile`, `senderDisplayName`, `senderProfileCacheSuffix`, `resolveSenderProfileId`.
- Alle Stellen, die eine Rechnung oder Offerte rendern oder mailen, laden `senderProfile: true` (PDF-Routen, `sendDocument`, `sendPendingInvoice`, `sendReminder`). `tests/integration/sender-profile-send.test.ts` sichert das ab.
- Verwaltung unter Einstellungen → Absender-Profile (nur Admin), Auswahl im Rechnungs- und Offertenformular (`SenderProfileSelect`, nur sichtbar mit mindestens einem Profil).
- PDF-Cache-Key der Rechnungs- und Offerten-Route enthält `senderProfileCacheSuffix`.
- Audit: `CREATE`/`UPDATE`/`DELETE Settings` mit «Absender-Profil <Name>».
