# PyBudget Roadmap

## Product goal

PyBudget should show what money is actually available, including pending transactions that many banking apps omit from their displayed balance. It should import bank exports safely, preserve an auditable ledger, prevent duplicate imports, and gradually add categorization, planning, and forecasting.

## Architecture

### Initial system

- Static browser frontend deployed from GitHub `main` through GitHub Pages.
- Supabase Auth for email/password authentication and browser sessions.
- Supabase PostgreSQL for user-owned data.
- Row Level Security on every user-owned table.
- Direct Supabase queries for ordinary CRUD.
- PostgreSQL RPC functions for atomic imports and database-centered calculations.
- Only the Supabase publishable key in browser code.

### Optional backend

Add a separately deployed FastAPI service only when Python-specific parsers, secret third-party credentials, background jobs, scheduled processing, or long-running work justify it. Supabase remains the authentication and PostgreSQL platform.

## Product principles

1. Pending spending affects available money immediately.
2. Imports are idempotent.
3. Financial records are never silently deleted.
4. Ambiguous reconciliation is surfaced rather than guessed.
5. Money is stored as signed integer cents, never floating point.
6. Every record belongs to an authenticated user and is protected by RLS.
7. Import provenance is retained privately.
8. Prefer the simplest architecture that meets current requirements.

## Planned application navigation

Keep the primary navigation small:

- **Overview**: answers how much money is really available and what is about to happen.
- **Transactions**: complete searchable ledger.
- **Setup**: bank accounts, CSV import, import history, account settings, password actions, and logout.

Until Overview is implemented, the application may expose only Transactions and Setup. Account does not need a separate primary menu entry while its actions fit clearly inside Setup.

## Phase 0: Foundation

Status: implemented.

- [x] GitHub Pages deployment from `main`.
- [x] Responsive static frontend.
- [x] Supabase registration, confirmation, login, logout, and session restoration.
- [x] User-owned test data protected by RLS.
- [x] Authenticated persistence proven through a private test field.

## Phase 1: Import, deduplication, and persistence

The detailed specification is `docs/CURRENT_FEATURE_PLAN.md`.

- [ ] Persistent bank accounts per user.
- [ ] Import batches with SHA-256 file hashes.
- [ ] Comdirect CSV parsing in the browser.
- [ ] ISO-8859-1 and semicolon-separated CSV support.
- [ ] Multiple account sections per export.
- [ ] Bank-reference extraction from dedicated and embedded fields.
- [ ] Explicit pending, booked, and cancelled statuses.
- [ ] Database-enforced booked-transaction deduplication.
- [ ] Pending-to-booked reconciliation without double counting.
- [ ] Atomic import RPC.
- [ ] Import summary with inserted, duplicate, reconciled, and rejected counts.
- [ ] Private raw-row provenance.
- [ ] Synthetic parser and import tests.

## Phase 2: Transaction ledger

- [ ] Authenticated transaction list with pagination.
- [ ] Clear pending badges.
- [ ] Separate booked and pending totals.
- [ ] Available-after-pending balance.
- [ ] Filters for account, date, status, income/expense, and category.
- [ ] Search across partner, description, and reference.
- [ ] Transaction details with import provenance.
- [ ] Manual transaction entry.
- [ ] Editable personal note and category.
- [ ] Immutable bank-sourced financial fields after booking.
- [ ] Import-history screen.
- [ ] Reconciliation review for ambiguous cases.

## Phase 3: Accounts, balances, and Overview

### Overview first version

The first Overview should be phone-first and should not duplicate the complete transaction ledger.

- [ ] Real available money as the primary figure.
- [ ] Latest booked balance.
- [ ] Pending transaction total.
- [ ] Available balance after pending.
- [ ] Per-account cards with latest balance, pending amount, and last update date.
- [ ] Five most recent transactions with clear pending indicators.
- [ ] Link from recent activity to the complete transaction ledger.
- [ ] Last successful import and imported-row count.
- [ ] Stale-data warning when an account has not been updated recently.

### Later budgeting expansion

Preserve the useful concepts from the previous PyBudget overview after categories and planning exist:

- [ ] Year and month selector.
- [ ] Current balance.
- [ ] Spending still expected.
- [ ] Income still expected.
- [ ] Projected balance.
- [ ] Category actual-versus-planned progress.
- [ ] Month-progress marker on category budgets.
- [ ] Over-budget warning state.
- [ ] Planned and actual transaction sections.
- [ ] Category drill-down.
- [ ] Year-to-date actual and projected figures.

### Accounts and balances

- [ ] Multiple current accounts, cards, savings accounts, and cash accounts.
- [ ] Persistent bank identifiers.
- [ ] Booked and available-after-pending balances.
- [ ] Account activation and archival.
- [ ] Internal transfer recognition.
- [ ] Transfers excluded from income and expense totals.
- [ ] Balance-chain validation for formats that provide running balances.
- [ ] Currency per account and a defined foreign-currency policy.

## Phase 4: Categories and rules

- [ ] User-owned hierarchical categories.
- [ ] Income and expense category types.
- [ ] Manual categorization.
- [ ] Rules based on partner, description, reference, amount, and booking type.
- [ ] Rule priority and all/any matching.
- [ ] Rule preview.
- [ ] Automatic application to new imports.
- [ ] Safe reapplication without overriding manual choices.
- [ ] Category and rule management interfaces.

## Phase 5: Budget planning

- [ ] Monthly category budgets.
- [ ] One-time and recurring plans.
- [ ] Fixed-date and full-period schedules.
- [ ] Planned income and expenses.
- [ ] Actual-versus-plan comparison.
- [ ] Transaction-to-plan matching.
- [ ] Paid/unpaid planned items.
- [ ] Carryover policies.

## Phase 6: Reporting and forecasting

- [ ] Monthly income and expense summaries.
- [ ] Category roll-ups.
- [ ] Cash-flow timeline.
- [ ] Expected end-of-month balance.
- [ ] Immediate inclusion of pending spending.
- [ ] Discrete and continuous spending models.
- [ ] Historical category profiles.
- [ ] Forecast ranges and uncertainty indicators.
- [ ] PostgreSQL views/RPCs for large aggregations.
- [ ] Useful CSV/PDF exports.

## Phase 7: Import expansion and automation

- [ ] Additional bank CSV/XLSX formats.
- [ ] Importer registry and automatic format detection.
- [ ] User-assisted column mapping for unknown formats.
- [ ] Versioned importer behavior.
- [ ] Duplicate-safe reprocessing after parser improvements.
- [ ] Optional raw-file storage with explicit consent.
- [ ] FastAPI extraction if Python reuse outweighs browser-only simplicity.
- [ ] Background imports for large files.
- [ ] Scheduled profile and forecast updates.

## Phase 8: Product hardening

- [ ] RLS tests for every table and RPC.
- [ ] Import fuzzing and malformed-file handling.
- [ ] Rate limiting and abuse protection.
- [ ] Content Security Policy and pinned dependencies.
- [ ] Error reporting without financial-data leakage.
- [ ] Accessibility and phone-first workflow review.
- [ ] Version-controlled database migrations.
- [ ] Backup and restore strategy.
- [ ] User data export.
- [ ] Account deletion and full data erasure.
- [ ] Privacy and retention policies.
- [ ] Deployment and import monitoring.

## Near-term sequence

1. Implement Phase 1 tables, indexes, RLS, and import RPC.
2. Implement and test the Comdirect parser with synthetic fixtures.
3. Add file selection, preview, and import summary.
4. Add the transaction ledger with pending badges.
5. Verify same-file and overlapping-file idempotency.
6. Verify pending-to-booked reconciliation.
7. Add account totals.
8. Begin categories only after persistence is reliable.

## First useful release

A user can register, import a supported CSV, see all transactions including pending ones, reimport overlapping exports without duplicates, and see a booked transaction replace its earlier pending representation without being counted twice.
