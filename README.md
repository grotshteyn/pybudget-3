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

The importer has no build dependency. Run:

```bash
node tests/importer.test.js
```

All committed fixtures are synthetic. Do not commit real bank exports.

## Planning

- `docs/ROADMAP.md`
- `docs/CURRENT_FEATURE_PLAN.md`
