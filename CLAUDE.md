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
- `Invoice` states: `Draft → Sent → Paid | Overdue | Canceled`
- `Quote` states: `Draft → Sent → Accepted | Declined | Expired`
- Document numbers use configurable prefixes (e.g. `I-`, `Q-`) tracked via `lib/document-number.ts`
- `lib/yearly-invoices.ts` handles automatic recurring invoice creation
- `lib/reminders.ts` + `PendingReminder` model manage overdue payment reminders

**PDF generation** (`lib/pdf/`): Server-side only, using `pdfkit` + `swissqrbill` for Swiss QR payment slips. Triggered via `GET /api/invoices/[id]/pdf`.

**Email** (`lib/email.ts`): Nodemailer SMTP. Outgoing emails are queued via the `PendingEmail` model before sending, and logged in `InvoiceSentLog`.

**Audit logging** (`lib/audit.ts`): All significant mutations call `createAuditLog(...)` which writes to `AuditLog`.

**Logs** (`lib/logs.ts`): `startLogCapture()` tees `process.stdout`/`process.stderr` to `logs/app.log` in the data volume, so a file ends up with everything `docker logs` would show — not just what happens to go through the shared pino logger — without `lib/logger.ts` itself needing to import `fs`. A nightly job copy-truncates `app.log` to `app-<date>.log` (rename would leave the already-open write stream writing into the renamed file) and prunes files older than `LOG_MAX_KEEP_DAYS` (default 14; `DISABLE_LOG_ROTATION=true` turns rotation off). Admins download files from Einstellungen → Logs (`GET /api/logs/[filename]`, filename validated against the exact `app.log` / `app-YYYY-MM-DD.log` shape before touching the filesystem).

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
