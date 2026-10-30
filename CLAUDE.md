# CLAUDE.md

Customer management for Swiss small businesses: Next.js 16 (App Router), TypeScript, React 19, Tailwind 4, Prisma 7 + SQLite. UI, user-facing text and docs are **German**.

## Commands

```bash
npm run dev | build | lint
npm test                    # Vitest; single file: npx vitest run tests/unit/x.test.ts
npm run test:integration | test:coverage | test:watch
npx prisma migrate dev --name <name>   # prisma generate runs on postinstall
npm run db:seed             # faker data, dev only
```

## Architecture

- `app/(auth)/` public (login + optional TOTP); `app/(app)/` protected (dashboard, customers, invoices, quotes, subscriptions, services, time, accounting, analytics, search, profile, settings)
- `app/api/` only for file streaming (PDF, images, downloads) and external endpoints. **Mutations = Server Actions** in co-located `actions.ts`
- `lib/` server utilities; `prisma/schema.prisma` is the data model
- Charts: Recharts `"use client"` components in the feature's `components/`; pages pass serialised data, charts never call Prisma
- Next.js 16 has breaking changes: check `node_modules/next/dist/docs/` before touching routing, middleware (`proxy.ts`) or data fetching

### Auth & permissions
- `lib/auth.ts`: NextAuth v5 Credentials + bcrypt, optional TOTP (`otplib`, backup codes JSON in `User.totpBackupCodes`), in-memory login rate limit, JWT 7 d, renewed every 24 h (`lib/config.ts`). `role` (`Admin|Editor|Viewer`) is in JWT and `session.user.role`
- `lib/permissions.ts`: `requireAdmin()`/`requireEditor()` at top of Server Components/Actions (redirect). UI: `hasRole`, `isEditorSession`; editor-only pages render `<EditorOnlyNotice />`, editor-only buttons hidden for Viewers

### Invoices, credit notes, customers
- Invoice states `Draft → Sent → PartiallyPaid → Paid | Overdue | Canceled`; Quote `Draft → Sent → Accepted | Declined | Expired`
- Only `Draft` is editable/deletable (`DocumentLockedError`); `deleteInvoice` (Admin) also refuses drafts with a number (failed send booking). Manual transitions: `canTransitionInvoice` in `lib/state-manager.ts`; `Canceled` never manual
- Numbers assigned on first send/leaving Draft via `assignDocumentNumber` (`lib/document-number.ts`); drafts have `documentNumber = null` ("Entwurf")
- Credit note = `Invoice` with `creditNoteForId`, stored negated (entered positive) (`lib/credit-notes.ts`). Same number series/prefix. `updateInvoice` uses `alignCreditToOriginal`: total 1–4 Rappen off the original's open amount snaps to it if rounding is on or original total was rounded; ≥5 Rappen = partial credit. Sent credits reduce open amount (`sumCreditedRappen` in `lib/payments.ts`, `lib/receivables.ts`). Excluded from overdue/dunning, payments, analytics. Copies original's sender profile
- Customers with invoices or work entries are archived (`archivedAt`), not deleted (`onDelete: Restrict`). `assertCustomerActive` (`lib/customer-archive.ts`) blocks create invoice/quote/subscription/task and `convertQuoteToInvoice` for archived customers; `updateInvoice`/`updateQuote` only when moving a draft *to* an archived customer. Payments, credits, reminders unaffected

### Sender profiles (`lib/sender-profile.ts`)
- Company data = first profile; `SenderProfile` fields override only when filled (`applySenderProfile`). Address, IBAN, QR creditor never overridden (`buildQrBillData` gets unchanged company data)
- `Invoice/Quote.senderProfileId` (null = company, `Restrict`), validated by `resolveSenderProfileId` (inactive/unknown refused unless already used). Quote→invoice copies it; subscription/work-entry drafts get `null`
- **Every loader passing an invoice/quote to `generateInvoicePdf`/`generateQuotePdf`/`generateReminderPdf`/`sendInvoiceEmail`/`sendQuoteEmail` must `include: { senderProfile: true }`**, else silently ignored
- `companyName` fills `{companyName}` via `senderDisplayName`; subscription job leaves `{companyName}`/`{totalAmount}` unfilled in `PendingEmail`. PDF cache key includes `senderProfileCacheSuffix`. Used profiles can only be deactivated. Audited as `Settings`

### Quotes
- `Quote.closingText` (≤500 chars) stored per quote; `PdfTheme.quoteClosingText` is only the default prefilled by `quotes/new`, never read at render. Not copied on conversion. Quotes are not archived (re-rendered)

### Money, rounding, dates
- 5-Rappen rounding (`lib/calculations.ts`, `lib/total-options.ts`): opt-in `ApplicationSettings.roundTotalTo5Rappen`. Only the document total after discount is rounded and stored as `totalAmount` (QR, payments, credits, OP need nothing else). Read via `loadTotalOptions()` → `parseDocumentItems(formData, options)`. `generateInvoicePdf` prints stored `totalAmount`, never recomputes. Reminder fee/interest not rounded. Existing docs not recalculated
- `formatCurrency` → `-CHF 1'000.00`; UI dates via `formatDate` (`dd.MM.yyyy`), never `toLocaleDateString`. Calendar days stored as UTC midnight; "today" = `swissToday` (`lib/date.ts`)

### Payments (`lib/payments.ts`)
- `Payment` is the source of truth. All payments (manual, CAMT, Budget API) go through `recordPayment`/`recordRemainingPayment`/`deletePayment`, which recompute `Invoice.state` and `paidDate`. `recordPayment` takes optional `onCreated(tx, paymentId)` hook inside the transaction
- Income (GuV, analytics, export) by `Payment.date`; category split via `allocatePayment`. Open items: `accounting/receivables`, `lib/receivables.ts`
- `deletePaymentAction` = Editor, audited, reopens CAMT `BankTransaction`

### Bank import (`lib/import/`)
- CAMT.053 upload stores `BankStatementImport` + `BankTransaction`, books nothing. `fingerprint` `@unique` (bank ref + date + amount, else hash + occurrence counter, `dedupe.ts`) skips duplicates
- Row is open while `paymentId`, `expenseId`, `ignored` are all empty (no status column; `SetNull` reopens)
- `bookPayments` → `recordPayment` (`source = camt-import`), claims the row in `onCreated`. `bookExpenses` only for ticked rows (nothing preselected except via `buildExpenseHints`), sets `Expense.paidDate`. `reopenTransactions` reopens ignored rows
- Collective bookings split only if every `TxDtls` has `Amt`, otherwise one row + warning (`camt.ts`). Checks in `statement-checks.ts` only warn (`balanceWarning`)
- `undoImport` only if nothing booked and no later overlapping import skipped entries (`pickShadowingImport`, `undoBlockedReason`)
- Matching (`matching.ts`, `document-reference.ts`) tolerant of separators/missing prefix; customer name only suggests. Accepts `OpenInvoice.reminderTotal`. `POST /api/external/payments` takes optional `bankReference`

### Subscriptions (`lib/subscriptions.ts`, `lib/subscription-dates.ts`)
- `Subscription` (Monthly/Quarterly/Yearly, `InvoiceTemplate`, `nextInvoiceDate`, `autoSend`, `active`). Daily `checkSubscriptions`: one Draft + `PendingEmail` + date advance per transaction; missed periods skipped by `advancePast` (`skippedPeriods` in audit, `notifyAdmins`). Month-end days clamp and stay clamped
- `autoSend` (template needs ≥1 item) → `sendPendingInvoice` (`lib/pending-email-send.ts`) as `SYSTEM_ACTOR`; on failure draft stays for approval. If mail went out but booking failed: retry once, then `{ error, mailSent: true }` (never throw — re-approval would double-mail)
- `discardPendingEmail` deletes mail + draft, or only the mail if the invoice is no longer an unnumbered Draft without payments
- Overview `/subscriptions` (`lib/subscription-overview.ts`); editing stays on the customer page

### Reminders (`lib/reminders.ts`, `lib/reminder-charges.ts`, `lib/pdf/reminder-pdf.ts`)
- Levels 1–4 (`MAX_REMINDER_LEVEL`). Overdue (`overdueInvoiceWhere`/`isOverdueInvoice`) = non-credit and `Overdue`, or `PartiallyPaid` with due date < `swissToday`. PartiallyPaid is never switched to Overdue. Total 0 → no reminder
- `recalculateInvoiceState` keeps the `PendingReminder` on partial payment and deletes it only when nothing is open / state leaves Overdue|PartiallyPaid (`keepsReminder`); recreates it when overdue again
- `sendReminder` recomputes server-side (`computeReminderCharges`: open remainder, fee per level `reminderFeeLevel{2,3,4}Rappen`, interest = open × % × days / 365; default 0 = off; level 1 none). Fee/interest never booked. Amounts stored on `SentDocument`. Nothing sent after level 4 (`isLastReminderLevelSent`) or with remainder 0
- Badges/banners (`loadWorkCounts`, `lib/attention-counts.ts`) count only sendable reminders. `dismissReminder` returns `snoozedUntil`; `undoDismissReminder` resets only that snooze. Reminder card toasts from the action result, not an effect

### Tasks & history (`lib/tasks.ts`, `lib/customer-history.ts`)
- Sending a quote creates a follow-up task (`createQuoteFollowUp`, never throws, one open per quote). Daily: `closeAnsweredFollowUps`, `notifyDueTasks` (stamps `notifiedAt` only if a channel delivered). `deleteQuote` closes follow-ups in its transaction (`Task.quote` is SetNull)
- `loadCustomerHistory` builds history from existing data (note titles only, contents encrypted)

### Time tracking (`lib/work-*.ts`, `app/(app)/time/`, module `timeTracking`, Editor+)
- `WorkEntry` holds time (`Hour`/`Day`, `TIME_UNITS`) and material; `invoiceId` set = billed. Name/unit come from the catalog `Service`, never the client; `validateQuantity` limits. Price not stored, read from catalog at billing
- `buildBillingLines` (pure, shared with client preview) groups per service; missing/changed-unit services → price 0 flagged. `billingTotal` applies rounding
- `createInvoiceFromWorkEntries` claims entries in `onCreated` via `claimWorkEntries` (`id IN (...)` + `updateMany`, **no OR list** — SQLite expression depth limit; compares `updatedAt`); mismatch throws and rolls back
- Billed entries immutable (`invoiceId: null` filters); deleting the draft frees them (SetNull). PWA = `app/manifest.ts` + `public/icons/`, no service worker; `proxy.ts` lets manifest/icons through without session

### Sending, archive, export
- `sendDocument`, `sendPendingInvoice`, `sendReminder` take a per-invoice in-process lock (`lib/send-lock.ts`; credit notes lock their original) and refuse `Canceled` (credit notes exempt), invoices without items and invalid recipients **before numbering**. After mail is out, booking retries once, then reports "bereits versendet" instead of throwing. Send/status change removes waiting `PendingEmail`
- PDF archive: every invoice/reminder mail goes through `renderArchiveAndSend` (`lib/invoice-dispatch.ts`): render once → write to `data/archive/<year>/` (`wx`, read-only) → attach same bytes; archive failure = no send. `SentDocument` (path, SHA-256, `Restrict`) created in the send transaction alongside `InvoiceSentLog` (intentional overlap, don't merge). Quotes not archived. Archive route verifies hash (409). Archived PDFs never re-rendered
- Year package `GET /api/export/year-package?year=` (`lib/year-package.ts`, `lib/zip.ts` with backpressure, `lib/journal.ts`): missing/tampered PDFs reported, never regenerated. Writes `EXPORT YearPackage` audit after all files added, outside transactions

### Customer model (`lib/customer-billing.ts`, `customer-uid.ts`, `customer-number.ts`, `salutation.ts`)
- `customerNumber` from 1001 (max+1, retry on P2002), immutable after creation. `uid` normalized `CHE-…` with mod-11 check. Billing address kept only if street, zip and city set; `billingName` ≤70 chars. `paymentTermDays` null = default
- Always use helpers: `billingRecipient` (invoice/reminder PDFs, QR debtor), `billingEmail` (invoice/reminder/subscription mails), `effectivePaymentTermDays`. Quotes use `customerRecipient` + `customer.email`
- `buildSalutation` fills `{salutation}` in mails (not PDFs); `salutationKind` default `hello` stored as `null`, `salutationText` only for `custom` (≤100). `CustomerContact` is informational only

### Settings, modules, misc
- Categories: `deleteCategory` only if unused (`countCategoryUsage`, incl. `TemplateItem.categoryId` which has no relation); otherwise deactivate
- Units: all labels only in `lib/units.ts` (`UNIT_VALUES` = zod + fixed order). New unit = enum value + one row there (no migration). Dropdowns order by usage via `loadUnitOrder` → `unitOrder` prop
- Action feedback: `useActionToast` (`{ toastErrors: false }` for inline errors); `submitKeepingInput` prevents React 19 field reset on error
- Settings form: click-to-save checkboxes use `ImmediateCheckbox` → `setSetting` (whitelist `IMMEDIATE_SETTINGS`), have no `name`, and are not read by `saveSettings`. New click-to-save field → add to whitelist. `ImmediateCheckbox` prints «Gilt sofort» itself. Test buttons use unsaved values on purpose
- Company data completeness (`lib/company-completeness.ts`): `missingCompanyFields` drives the dashboard checklist: IBAN + address always; without company name also holder name (then QR creditor), with company name also e-mail, phone, logo. `useHolderNameOnQR` can only be switched on when holder name, IBAN and address are saved (`holderNameOnQrBlocker`), is forced on while there is no company name (`holderNameOnQrForced`), and the holder name cannot be emptied while it is on; enforced in `setSetting`/`saveSettings`, mirrored by a disabled checkbox
- Modules (`lib/modules.ts` takes Prisma as argument, no `lib/prisma` import; request helpers in `lib/module-guard.ts`): `tasks, subscriptions, quotes, reminders, bankImport, accounting, analytics, timeTracking`, default on. Off = hidden only. Pages/actions call `requireModule(key)`, API routes `moduleDisabledResponse(key)`, daily jobs skip (`runDailyJobs`, `lib/daily-jobs.ts`). `setModule` checks `MODULE_BLOCKERS`. Hidden module fields stay as hidden inputs in the settings form (else `saveSettings` resets them). `tests/setup.ts` mocks the guard all-on; guard tests use `vi.importActual`
- PDF (`lib/pdf/`): pdfkit + swissqrbill, all kinds via `generateDocumentPdf`; `PdfTheme.addressWindow` (`none|left|right`)
- Email: transport + `DISABLE_EMAIL` only in `lib/smtp.ts`; placeholders and default texts only in `lib/mail-templates.ts`. Only subscription invoices are queued as `PendingEmail`. Logs: `InvoiceSentLog`, `QuoteSentLog`

### Audit (`lib/audit.ts`, `lib/audit-chain.ts`)
- Use `logAudit` / `logAuditEntry` (no session); both never throw. Hash-chained, `prevHash @unique`. **Never `prisma.auditLog.create` directly** (use `appendAuditEntry`). **Never call them inside a `$transaction` callback** (adapter mutex → timeout). Verified by `verifyAuditChain`

### Logs & backups
- `startLogCapture()` (`lib/log-capture.ts`, must not import `lib/logger`) tees stdout/stderr to `logs/app.log`. **It must be the first call in `instrumentation.ts` `register()`** — any earlier import of `lib/logger` makes pino bypass capture. Nightly copy-truncate rotation (not rename)
- `lib/backup.ts`: nightly `VACUUM INTO` snapshot, lazy-loads Prisma/notifications, path from `lib/db-path.ts`. Download routes validate exact filename shapes
- `scripts/startup.js` (Docker): applies migrations via `better-sqlite3`, snapshots `pre-migration-<name>.db` first, seeds admin from env. Only runs when executed directly

## Environment

`DATABASE_URL` (default `file:./data/customermanagement.db`), `AUTH_SECRET` (prod, ≥32 chars), `AUTH_URL` (prod), `ADMIN_EMAIL` + `ADMIN_PASSWORD`|`ADMIN_PASSWORD_HASH` (first run), `ARCHIVE_DIR`, `BACKUP_DIR`/`BACKUP_CRON_SCHEDULE`/`BACKUP_KEEP_DAYS`/`DISABLE_BACKUP`, `LOG_ROTATE_CRON_SCHEDULE`/`LOG_MAX_KEEP_DAYS`/`DISABLE_LOG_ROTATION`, `SESSION_MAX_AGE_SEC`/`SESSION_UPDATE_AGE_SEC`, `DISABLE_EMAIL`, `BUDGET_INTEGRATION_API_KEY`. Full list: `.env.example`

## Testing

`tests/unit/`, `tests/integration/` (temp SQLite, `tests/setup.ts`). Coverage: `lib/**/*.ts`, `app/api/**/*.ts`.

## Commits & CI

English Conventional Commits (release-please): `feat:` minor, `fix:` patch, `!`/`BREAKING CHANGE:` major; `chore|docs|test|refactor|build|ci` no release. Scope encouraged.
`ci.yml`: tests + build on PRs. `release.yml` on `main`: release-please, then lint/tests/e2e and ARM64 Docker image to `ghcr.io/sirtheta/customer-management`.
