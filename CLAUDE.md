# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Overview

This is a customer management system built for Swiss small businesses, implemented as a Next.js 16 web dashboard (TypeScript, React 19, Tailwind CSS 4, Prisma + SQLite).

The UI, user-facing text, and documentation are **in German**.

---

## Web Application

### Commands

```bash
# Development
npm run dev            # Start dev server at localhost:3000
npm run build          # Production build (standalone output)
npm run lint           # ESLint check

# Database
npx prisma migrate dev --name <name>   # Create and apply a new migration
npx prisma studio                       # GUI to inspect the DB
npm run db:seed                         # Seed with faker data (dev only)

# Tests
npm test               # Run all tests (Vitest)
npm run test:watch     # Watch mode
npm run test:coverage  # Coverage report (v8)
npm run test:integration  # Integration tests only
# Run a single test file:
npx vitest run tests/unit/calculations.test.ts
```

> **Note:** `prisma generate` runs automatically via `postinstall`. After pulling schema changes, run `npx prisma migrate dev` to keep the local DB in sync.

### Architecture

**Next.js App Router layout:**

- `app/(auth)/` — Public routes (login with optional TOTP 2FA)
- `app/(app)/` — Protected routes; all require an active session
  - `analytics/` — Revenue charts, category breakdowns, top-customers (Recharts)
  - `accounting/` — Expense tracking + income statement (GuV) with monthly P&L chart (Recharts)
  - `invoices/`, `quotes/` — Document management with PDF generation
  - `customers/` — Customer records, notes, file attachments
  - `settings/` — Company info, SMTP, user management, audit log
- `app/api/` — REST endpoints (PDF generation, file uploads, export, logo)
- `lib/` — Shared server-side utilities (auth, Prisma client, email, PDF, audit, permissions)
- `prisma/schema.prisma` — Single source of truth for the data model

**Charts** use [Recharts](https://recharts.org/) as `"use client"` components under each feature's `components/` directory. Server pages pass serialised data down; charts never call Prisma directly.

**Data mutations** use Next.js Server Actions (`actions.ts` files co-located with routes), not API routes. API routes are reserved for file streaming (PDFs, images, downloads) and external-facing endpoints.

**Authentication** (`lib/auth.ts`):
- NextAuth v5 Credentials provider with bcrypt password validation
- Optional TOTP 2FA (`otplib`); backup codes stored as a JSON array in `User.totpBackupCodes`
- In-memory rate limiting on login attempts
- JWT sessions, 8-hour max age
- `user.role` (`Admin | Editor | Viewer`) is embedded in the JWT and carried into `session.user.role`

**Authorization** (`lib/permissions.ts`):
- `requireAdmin()` / `requireEditor()` — call at the top of Server Components or Server Actions that need role gating; redirects on failure
- `hasRole(session, roles)` — synchronous check for UI rendering

**Business document workflow:**
- `Invoice` states: `Draft → Sent → PartiallyPaid → Paid | Overdue | Canceled`
- **Locking and credit notes:** only `Draft` invoices are editable or deletable (`updateDocumentWithItems` throws `DocumentLockedError`, `deleteInvoice` refuses others). Manual status changes follow the table in `lib/state-manager.ts` (`canTransitionInvoice`); `Canceled` is never a manual target. A credit note is an `Invoice` with `creditNoteForId` and negative amounts (`lib/credit-notes.ts`); its sent amounts reduce the original's open amount in `lib/payments.ts` (`sumCreditedRappen`) and `lib/receivables.ts`. Credit notes are excluded from overdue/dunning, payments and analytics. Customers with invoices are archived (`Customer.archivedAt`), not deleted (`Invoice.customer` is `onDelete: Restrict`)
- `Quote` states: `Draft → Sent → Accepted | Declined | Expired`
- Document numbers use configurable prefixes (e.g. `I-`, `Q-`) tracked via `lib/document-number.ts`. Numbers are assigned on first send / status change out of Draft via `assignDocumentNumber` in that file; drafts have `documentNumber = null` (shown as "Entwurf")
- **Payments** (`lib/payments.ts`): the `Payment` model is the source of truth for what has been paid. `recordPayment` / `recordRemainingPayment` / `deletePayment` recalculate `Invoice.state` (→ `PartiallyPaid` → `Paid`) and `paidDate` from the payments; manual, CAMT and Budget payments all go through it. Income in the income statement, analytics and export follows `Payment.date`. The open items list (OP-Liste, age structure, CSV export) lives at `accounting/receivables` (`lib/receivables.ts`)
- **Bank import** (`lib/import/`, `app/(app)/invoices/import/`): an uploaded CAMT.053 statement is stored as `BankStatementImport` + `BankTransaction` rows (`importStatement` in `bank-import.ts`); nothing is booked on upload. `BankTransaction.fingerprint` is `@unique` (a bank reference together with date and amount, because payers reuse EndToEndIds; without a reference a hash of date/amount/text/counterparty plus an occurrence counter, see `dedupe.ts`), so re-uploads and overlapping statements skip known entries. A row is open while `paymentId`, `expenseId` and `ignored` are all empty; there is no status column, and deleting the `Payment`/`Expense` (`onDelete: SetNull`) opens it again. `bookPayments` goes through `recordPayment` (`source = camt-import`) and re-checks entry and invoice state; `recordPayment` takes an optional `onCreated(tx, paymentId)` hook that runs inside the payment transaction and is used to claim the `BankTransaction` atomically. `bookExpenses` creates an `Expense` only for explicitly ticked rows (household and business share one account, so nothing is pre-selected unless the newest decision for that counterparty was taking it over as an expense, see `buildExpenseHints`; rows whose counterparty was most recently ignored sit in a collapsed "Bisher ignoriert" section, and each row can be ignored individually or all unticked ones at once). Account/currency and balance checks (`statement-checks.ts`) only warn; `BankStatementImport.balanceWarning` keeps all of them for the history (passed to `importStatement` as `accountWarnings`). `undoImport` only works while no entry of the import is booked. Matching (`matching.ts`, `document-reference.ts`) tolerates spaces/separators and a missing prefix in the invoice number; the customer name only suggests candidates, never pre-selects. `POST /api/external/payments` (Budget app) keeps working and takes an optional `bankReference`
- `lib/yearly-invoices.ts` handles automatic recurring invoice creation
- `lib/reminders.ts` + `PendingReminder` model manage overdue payment reminders
- **PDF archive** (`lib/document-archive.ts`, `lib/invoice-dispatch.ts`): every invoice and reminder mail goes through `renderArchiveAndSend` — render the PDF once, write those exact bytes to `data/archive/<year>/` (`wx`, read-only), then attach the same bytes. If archiving fails nothing is sent. The `SentDocument` row (path, SHA-256, size) is created in the send transaction next to `InvoiceSentLog`, with `onDelete: Restrict` on the invoice, and an audit entry `CREATE SentDocument` records hash and path. Quotes are not archived. `GET /api/invoices/[id]/archive/[docId]` verifies the hash before serving (409 on mismatch or missing file)

**PDF generation** (`lib/pdf/`): Server-side only, using `pdfkit` + `swissqrbill` for Swiss QR payment slips. Triggered via `GET /api/invoices/[id]/pdf`.

**Email** (`lib/email.ts`): Nodemailer SMTP. Outgoing emails are queued via the `PendingEmail` model before sending, and logged in `InvoiceSentLog`.

**Audit logging** (`lib/audit.ts`, `lib/audit-chain.ts`): All significant mutations call `logAudit(...)` (or `logAuditEntry(...)` when there is no session), both never-throw. Every row is hash-chained: `hash = SHA-256([prevHash, userId, userName, action, entityType, entityId, entityRef, details, createdAt])`, `prevHash` is `@unique` so the chain stays linear (writers collide on P2002 and retry), the first chained row uses the `"GENESIS"` sentinel, rows written before the chain existed keep `hash = null`. Never write to `AuditLog` directly (`prisma.auditLog.create`) — always go through `appendAuditEntry`, otherwise the chain breaks. `verifyAuditChain` runs on Einstellungen → Aktivitätsprotokoll and reports the first broken row. Never call `logAudit`/`logAuditEntry` inside a `$transaction` callback (the adapter serialises interactive transactions with a mutex, so the nested write waits on the outer one and times out). The hash is unkeyed: edits/deletions of single rows are detected, a full recompute of the chain by someone with file access is not, and deleting the *last* rows is only detectable if the head hash shown there was stored externally (`?head=<hash>` checks it).

**Logs** (`lib/log-capture.ts`, `lib/logs.ts`): `startLogCapture()` tees `process.stdout`/`process.stderr` to `logs/app.log` in the data volume, so a file ends up with everything `docker logs` would show — not just what happens to go through the shared pino logger. It lives in its own `lib/log-capture.ts`, with no import of `lib/logger`, and `instrumentation.ts` calls it as the very first thing in `register()`: pino writes straight to file descriptor 1/2 via a `SonicBoom`, bypassing `process.stdout`/`stderr.write` entirely, *unless* those methods were already reassigned before the first `pino()` call anywhere in the process (`hasBeenTampered`) — importing `lib/logs` (or anything else that imports `lib/logger`) before `startLogCapture()` runs silently breaks capture, with nothing but an empty downloaded file to show for it. A nightly job copy-truncates `app.log` to `app-<date>.log` (rename would leave the already-open write stream writing into the renamed file) and prunes files older than `LOG_MAX_KEEP_DAYS` (default 14; `DISABLE_LOG_ROTATION=true` turns rotation off). Admins download files from Einstellungen → Logs (`GET /api/logs/[filename]`, filename validated against the exact `app.log` / `app-YYYY-MM-DD.log` shape before touching the filesystem).

**Backups** (`lib/backup.ts`): `startBackupScheduler()` (called from `instrumentation.ts`, after `startLogCapture()`) writes a nightly SQLite snapshot to `backups/db-YYYY-MM-DD.db` next to the database file (`VACUUM INTO` a `.tmp` file, then an atomic rename). `pruneBackups` runs only after a successful snapshot, deletes backups older than `BACKUP_KEEP_DAYS` (default 30, `0` = keep all, compared by calendar day) and always keeps the newest one. A failure is logged and sent to the admin notification channels (notify e-mail address and Telegram, via `notifyAdmins` in `lib/notifications.ts`). `lib/backup.ts` loads Prisma and `lib/notifications` only lazily in that failure path, and takes the DB path from the dependency-free `lib/db-path.ts`. Admins download backups under Einstellungen → Logs & Backups (`GET /api/backups/[filename]`, filename validated against the exact `db-YYYY-MM-DD.db` shape). Restore = stop the app, copy the file over `customermanagement.db` and delete any `-wal`/`-shm` next to it, start the app (steps in `DEPLOYMENT.md`). Off-site copies are out of scope for the app (rsync/rclone on `BACKUP_DIR`).

**Production startup** (`scripts/startup.js`): In the Docker image, this script applies pending Prisma migrations directly via `better-sqlite3` (no Prisma CLI in the image) and seeds the first Admin user from env vars before the Next.js server starts.

### Key Environment Variables

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | No | SQLite path, defaults to `file:./data/customermanagement.db` |
| `AUTH_SECRET` | Production only | NextAuth JWT signing key (min 32 chars) |
| `AUTH_URL` | Production only | Full URL for auth redirects |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | First run | Bootstraps the initial admin user |
| `ADMIN_PASSWORD_HASH` | First run | Pre-hashed bcrypt alternative to `ADMIN_PASSWORD` |
| `LOG_ROTATE_CRON_SCHEDULE` / `LOG_MAX_KEEP_DAYS` | No | Nightly log rotation schedule (default `35 2 * * *`) and retention in days (default `14`, `0` = keep all) |
| `BACKUP_DIR` / `BACKUP_CRON_SCHEDULE` / `BACKUP_KEEP_DAYS` / `DISABLE_BACKUP` | No | Nightly DB backup: target directory (default `<data>/backups`), schedule in server time (default `15 2 * * *`; the container is UTC unless `TZ` is set), retention in days (default `30`, `0` = keep all), `true` turns the job off |
| `ARCHIVE_DIR` | No | Root of the PDF archive, defaults to an `archive` folder next to the SQLite file (`data/archive`) |

### Testing

Tests live in `tests/unit/` and `tests/integration/`. Integration tests use an in-memory or temp SQLite database (configured in `tests/setup.ts`). Coverage is collected only for `lib/**/*.ts` and `app/api/**/*.ts`.

---

## Commit Conventions

All commit messages must be **in English** and follow the [Conventional Commits](https://www.conventionalcommits.org/) spec, which `release-please` uses to determine version bumps and generate changelogs:

- `feat: <description>` — new feature → minor version bump
- `fix: <description>` — bug fix → patch version bump
- `feat!:` / `fix!:` or `BREAKING CHANGE:` footer — breaking change → major version bump
- `chore:`, `docs:`, `test:`, `refactor:`, `build:`, `ci:` — no release triggered

The scope is optional but encouraged, e.g. `feat(invoices): add PDF download button`.

---

## CI/CD

The **`ci.yml`** workflow runs Vitest and the build on pull requests. The **`release.yml`** workflow runs on pushes to `main`: it drives `release-please`, then (once a release is created) re-runs lint/tests/e2e and builds and pushes a Docker image to `ghcr.io/sirtheta/customer-management` (ARM64 target: Raspberry Pi 5).

Versioning is managed by `release-please` (config: `release-please-config.json`).

---

## Next.js Version Note

This project uses **Next.js 16**, which has breaking changes from earlier versions. Before modifying routing, middleware, or data-fetching patterns, check `node_modules/next/dist/docs/` for current API conventions — do not assume behavior from older Next.js knowledge.
