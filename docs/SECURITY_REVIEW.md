# Security-Review — CustomerManagement.web

Stand: 2026-06-12. Fokus dieses Reviews war die Sicherheit von Geheimnissen:
Benutzer-Passwörter, Einstellungs-Passwörter (SMTP), Tokens und deren
Verschlüsselung. Geprüft wurden zusätzlich Authentifizierung, Autorisierung,
Datei-Uploads und allgemeine Web-Sicherheit.

## Zusammenfassung

Die Anwendung war in den sicherheitskritischen Grundlagen bereits gut
aufgestellt. Die in diesem Review gefundenen Schwachstellen wurden behoben
(siehe „Behobene Punkte“). Einige Restrisiken sind organisatorischer Natur
und werden unter „Akzeptierte Risiken & Empfehlungen“ dokumentiert.

## Bereits korrekt umgesetzt (vor diesem Review)

- **Verschlüsselung at rest** (`lib/crypto.ts`): SMTP-Passwort,
  Telegram-Bot-Token und TOTP-Secrets werden mit AES-256-GCM verschlüsselt
  gespeichert. Der Schlüssel wird per `scrypt` aus `AUTH_SECRET` abgeleitet.
  Eine idempotente Startup-Migration verschlüsselt Alt-Daten aus früheren
  Versionen automatisch.
- **Passwort-Hashing**: bcrypt mit konfigurierbarem Cost-Faktor
  (`config.bcrypt.rounds`, Standard 10).
- **TOTP-Backup-Codes**: bcrypt-gehasht gespeichert, kryptografisch sicher
  generiert (`crypto.randomInt`), Format und Einmal-Verbrauch geprüft.
- **Keine Secret-Leaks ins Frontend**: Das Einstellungs-Formular zeigt für
  gespeicherte Passwörter/Tokens nur ein Boolean-Flag, nie den Klartext.
- **Rollenbasierte Zugriffskontrolle**: durchgängig `requireAdmin()` /
  `requireEditor()` in Server Actions und API-Routen.
- **Keine SQL-Injection**: ausschließlich parametrisierte Prisma-Queries.
- **Eingabevalidierung**: Zod-Schemata auf Formularen und Login.
- **Sicherheits-Header**: `X-Frame-Options`, `X-Content-Type-Options`,
  `Referrer-Policy`.

## Behobene Punkte (dieser Review)

| Schweregrad | Punkt | Behebung |
|---|---|---|
| Hoch | Standard-Admin-Passwort `changeme123`, falls keine Umgebungsvariable gesetzt | Es wird ein zufälliges Passwort generiert und einmalig im Startup-Log ausgegeben (`scripts/startup.js`, `prisma/seed.ts`). |
| Hoch | Login-Timing verriet, ob eine E-Mail existiert (Benutzer-Enumeration) | Bei unbekanntem/inaktivem Benutzer wird ein Dummy-bcrypt-Vergleich ausgeführt (`lib/password.ts`, `lib/auth.ts`, `validate-credentials.ts`). |
| Hoch | Unauthentifizierte Pre-Check-Funktion umging das Login-Rate-Limit | `validateCredentials` nutzt jetzt denselben Rate-Limit-Schlüssel wie der NextAuth-Login. |
| Hoch | Logo-Endpunkt lieferte SVG aus (Stored XSS möglich) | Es werden nur noch PNG/JPEG ausgeliefert; alles andere → 404 (`app/api/settings/logo/route.ts`). |
| Hoch | Datei-Upload prüfte nur die Endung (getarnte Dateien) | Zusätzliche Magic-Byte-Prüfung gegen die deklarierte Endung (`lib/file-validation.ts`). |
| Mittel | Hochgeladene Dokumente wurden inline ausgeliefert | Nicht inline-sichere Formate werden als Download erzwungen (`Content-Disposition: attachment`). |
| Mittel | Benutzerverwaltung ohne Audit-Trail | `logAudit` für Anlegen/Ändern/Löschen/Passwort-Reset/TOTP (`settings/users/actions.ts`). |
| Mittel | Fehlende `HSTS`- und `CSP`-Header | `HSTS` in `next.config.ts`; nonce-basierte `CSP` pro Request in `proxy.ts` (`script-src 'nonce-…' 'strict-dynamic'`, kein `'unsafe-inline'` für Skripte) — schützt echt gegen eingeschleuste Inline-Skripte. |
| Niedrig | Login-Rate-Limit wurde pro Versuch doppelt gezählt | Vorab-Check liest das Limit nur noch und zählt nur eigene Ablehnungen; `authorize()` zählt den Durchreich-Pfad und setzt bei Erfolg zurück (`lib/rate-limit.ts`, `validate-credentials.ts`). |
| Niedrig | Magic-Byte-/Bildtyp-Erkennung an drei Stellen dupliziert | In `lib/file-validation.ts` zentralisiert (`detectImageMime`), genutzt von Logo-Route und PDF-Erzeugung. |
| Niedrig | Passwort-Mindestlänge an drei Stellen dupliziert | In `validatePasswordPolicy` (`lib/password.ts`) zentralisiert. |
| Niedrig | TOTP-Backup-Code-Race bei parallelem Login | Verbrauch erfolgt atomar über bedingtes Update (`lib/auth.ts`). |
| Niedrig | Login-Crash bei korrupten Backup-Code-Daten | `JSON.parse` ist jetzt fehlertolerant. |
| Niedrig | Hartkodierter bcrypt-Cost bei Backup-Codes | Nutzt `config.bcrypt.rounds`. |

Zusätzlich (Benutzerwunsch, kein Sicherheitsmangel): **Selbstbedienung
„Passwort ändern“** unter `/profile` — verlangt das aktuelle Passwort, ist
pro Benutzer rate-limitiert und wird im Audit-Log erfasst.

## Akzeptierte Risiken & Empfehlungen (kein Code geändert)

- **SQLite unverschlüsselt at rest**: Die einzelnen Geheimnisse sind
  verschlüsselt, die Datenbankdatei selbst (Kundendaten, Rechnungen) jedoch
  nicht. Empfehlung: verschlüsseltes Dateisystem (z. B. LUKS) auf dem
  Raspberry Pi und verschlüsselte Backups. Wer Lese-Zugriff auf das
  Dateisystem **und** `AUTH_SECRET` hat, kann auch die Geheimnisse
  entschlüsseln — `AUTH_SECRET` daher streng schützen.
- **`AUTH_SECRET`-Rotation**: Ein Wechsel macht bestehende verschlüsselte
  Geheimnisse unlesbar (`decryptSecret` gibt dann `""` zurück). Nach einer
  Rotation müssen SMTP-Passwort, Telegram-Token und TOTP neu eingegeben
  werden. Vor Rotation Geheimnisse notieren.
- **Rate-Limiting im Arbeitsspeicher** (`lib/rate-limit.ts`): Für den
  Single-Instance-Betrieb (Raspberry Pi) ausreichend. Es wird bei jedem
  Neustart zurückgesetzt und greift nicht über mehrere Instanzen. Bei
  horizontaler Skalierung auf einen geteilten Speicher (z. B. Redis)
  umstellen.
- **Single-Tenant-Datenmodell**: Alle angemeldeten Mitarbeiter sehen alle
  Firmendaten (Kunden, Rechnungen, Dokumente). Das ist eine bewusste
  Designentscheidung für ein Einzelunternehmen, kein Fehler. Falls künftig
  mehrere Mandanten unterstützt werden, ist eine kundenbezogene
  Zugriffsbeschränkung nötig.
- **Passwort-Policy**: Mindestlänge 8 Zeichen, keine Komplexitätsregeln.
  Das entspricht der aktuellen Empfehlung (NIST/BSI: Länge vor
  Komplexität). Optional Mindestlänge auf 12 anheben und einen Abgleich
  gegen bekannte geleakte Passwörter ergänzen.
