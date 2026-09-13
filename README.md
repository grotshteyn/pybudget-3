# pybudget-3

PyBudget is a phone-friendly budgeting application using a static GitHub Pages frontend and Supabase for authentication and PostgreSQL persistence.

## Current capabilities

- Email/password registration and login
- User-isolated test storage
- Browser-side Comdirect CSV parsing
- Multiple accounts in one export
- Pending and booked transaction states
- Database-enforced import idempotency
- Bank-reference deduplication
- Pending-to-booked reconciliation
- Recent transaction ledger and pending totals
- Responsive navigation: Overview, Transactions, Budget, Reports, and Setup
- Direct links and retained transaction status/search and report selection across refresh and login
- Account rename, archive, and reactivation in Setup

## Supabase setup

1. Create a Supabase project and configure `config.js` with the project URL and publishable key.
2. Run `supabase/schema.sql` in the Supabase SQL Editor for the original storage test.
3. Run `supabase/transaction_import.sql` in the SQL Editor for accounts, imports, transactions, RLS, and the atomic import RPC.
4. Never put a secret, service-role key, or database password in frontend code.

The transaction migration deliberately grants authenticated clients read-only table access. Import writes go through `import_comdirect_transactions`, which derives ownership from the logged-in Supabase user.

## GitHub Pages

GitHub Pages deploys the root files from `main`. Configure Supabase Auth:

- Site URL: `https://grotshteyn.github.io/pybudget-3/`
- Redirect URL: `https://grotshteyn.github.io/pybudget-3/**`

## Tests

The static frontend has no build step. Run the importer checks directly:

```bash
node tests/importer.test.js
```

Run the synthetic browser regression checks with Node.js 20 or newer:

```bash
npm ci
npx playwright install chromium
npm test
```

To use an installed Edge browser instead, set `TEST_BROWSER_CHANNEL=msedge` when running the tests. Browser tests intercept Supabase and use synthetic fixtures; they do not access a live database.

## Navigation

Use links such as `#transactions?status=pending&q=shop` or `#reports?report=settlement`. Recognized views are `overview`, `transactions`, `budget`, `reports`, and `setup`. Links take precedence over saved state. State is retained in the URL and session storage for the current browser tab, including through logout/login. Filter text is part of the link, so check it before sharing a URL.

Overview provides shortcuts. Balance calculations, monthly budgets, category management (in Setup), expense summaries, and settlement reports are explicitly marked as planned. The transaction view reads at most 200 recent rows; displayed totals apply to its filters and are not account balances.

Live Supabase authentication, persistence, and RLS verification remain deferred while the project is paused (see `docs/TEST_PLAN.md`).

All committed fixtures are synthetic. Do not commit real bank exports.

## Planning

- `docs/ROADMAP.md`
- `docs/CURRENT_FEATURE_PLAN.md`
