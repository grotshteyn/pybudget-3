# Current Feature Plan: Import, Deduplication, and Persistence

## Objective

Deliver the first production-shaped workflow:

1. An authenticated user selects a supported bank CSV.
2. The browser parses and previews its account sections and transactions.
3. One atomic Supabase RPC persists accounts, import metadata, transactions, and observations.
4. Identical and overlapping exports do not duplicate booked transactions.
5. Pending transactions are stored and counted immediately.
6. A later booked row reconciles with its pending version without double counting.
7. The user receives a deterministic import summary.

This plan covers import, deduplication, pending reconciliation, and persistence only.

## Scope

### Included

- Comdirect CSV.
- Browser-side parsing.
- Multiple account sections.
- Exact-file duplicate detection.
- Dedicated and embedded bank-reference extraction.
- Persistent account resolution.
- Pending and booked transaction states.
- Database-enforced deduplication.
- Pending-to-booked reconciliation.
- Atomic persistence through Supabase RPC.
- Import provenance and summaries.
- RLS and cross-user isolation.
- Synthetic tests.

### Excluded

- Other bank formats.
- Generic column mapping.
- Categories, budgets, forecasts, and reporting.
- FastAPI and background jobs.
- Automatic cancellation of missing pending transactions.
- Storage of complete raw bank files.

## Processing flow

```text
CSV in browser
  -> decode and parse
  -> normalize accounts and rows
  -> validate and preview
  -> call import_comdirect_transactions(payload)
  -> PostgreSQL transaction:
       resolve accounts
       detect repeated file
       deduplicate booked rows
       reconcile pending rows
       store observations
       return summary
```

The complete file stays in the browser. Only normalized rows and minimal private provenance are sent to Supabase.

## Data model

All user-owned tables have RLS. Ownership comes from `auth.uid()`; client-supplied user IDs are never trusted.

### bank_accounts

- `id uuid primary key`
- `user_id uuid references auth.users`
- `source text`
- `external_key text`
- `display_name text`
- `currency text default 'EUR'`
- `is_active boolean default true`
- `created_at timestamptz`
- `updated_at timestamptz`

Constraint:

```text
unique(user_id, source, external_key)
```

The same CSV account section must always resolve to the same account. New account IDs must not be generated for every import.

### import_batches

- `id uuid primary key`
- `user_id uuid`
- `source text`
- `file_name text`
- `file_sha256 text`
- `period_start date`
- `period_end date`
- `status text`: processing, completed, or failed
- row, inserted, duplicate, reconciled, and rejected counters
- `created_at timestamptz`

Constraint:

```text
unique(user_id, file_sha256)
```

An identical file returns the prior result without repeating persistence work.

### transactions

- `id uuid primary key`
- `user_id uuid`
- `account_id uuid`
- `status text`: pending, booked, or cancelled
- `amount_cent bigint`
- `currency text`
- `booking_date date null`
- `value_date date null`
- `transaction_date date null`
- `booking_type text`
- `description text`
- `partner text`
- `bank_reference text null`
- `fallback_fingerprint text`
- `first_seen_at timestamptz`
- `last_seen_at timestamptz`
- `booked_at timestamptz null`
- `created_at timestamptz`
- `updated_at timestamptz`

Booked uniqueness:

```text
unique(user_id, account_id, bank_reference)
where bank_reference is not null and status = 'booked'
```

### transaction_observations

An observation records which import supplied a representation without adding another ledger transaction.

- `id uuid primary key`
- `user_id uuid`
- `import_batch_id uuid`
- `transaction_id uuid`
- `source_status text`
- `bank_reference text null`
- `raw_row jsonb`
- `observed_at timestamptz`

Constraint:

```text
unique(import_batch_id, transaction_id, source_status)
```

## CSV parsing

### Encoding and structure

- Decode ISO-8859-1.
- Use a real CSV parser with semicolon delimiter and quoted-field handling.
- Do not split rows naively.
- Detect each account section separately.
- Detect the header for each section.
- Preserve row order and a row sequence number.
- Ignore empty and bank-summary lines deliberately.

### Amounts

- Parse German decimal notation.
- Convert immediately to signed integer cents.
- Reject malformed amounts instead of guessing.
- Never use floating point for persisted money.

### Dates and status

- `offen`, `--`, and an empty booking date mean pending.
- A valid booking date means booked.
- Keep booking, value, and transaction dates separate.
- Never replace a missing booking date with today's date.

### Bank references

Use the first valid source:

1. Dedicated `Referenz` field.
2. Embedded identifier following `Ref.` in description text.
3. Otherwise use fallback handling.

Trim surrounding whitespace but treat bank identifiers as opaque values.

### Account identity

Build `external_key` from the bank source and stable account-section information. Preserve masked card suffixes where they distinguish accounts. Display names can become editable later; external keys remain stable.

## Deduplication

### Exact file

Calculate SHA-256 over original file bytes. A completed matching batch for the same user performs no new writes.

### Booked transaction

For every booked row:

1. Resolve the persistent account.
2. Look up account plus bank reference.
3. If booked already exists, add an observation and count a duplicate.
4. Otherwise try pending reconciliation.
5. If no pending match exists, insert a new booked row.

The partial unique index is the concurrency-safe final guard.

### Pending transaction

Persist pending rows immediately so they affect available money.

Pending identity uses:

1. Stable bank reference where available.
2. Otherwise account, amount, transaction date, normalized partner and description, booking type, plus an occurrence number among identical rows.

A repeated observation updates `last_seen_at` instead of creating another active pending row.

### Pending to booked

Match a new booked row in this order:

1. Same account and bank reference.
2. Same account, amount, transaction date, and normalized descriptive fields within a configured booking window.
3. Occurrence-aware one-to-one matching.

For one confident match:

- Keep the pending row's internal ID.
- Change status to booked.
- Fill final dates, reference, and text.
- Set `booked_at` and `last_seen_at`.
- Preserve future user metadata such as category and notes.
- Add the booked observation.
- Do not insert another ledger row.

If matching is ambiguous, do not silently merge. For this release, reject the ambiguous row with a structured reason for future review.

### Missing pending rows

Disappearance from one later export does not prove cancellation. Keep the transaction pending and retain `last_seen_at`. Cancellation policy is deferred.

## RPC contract

Proposed function:

```text
import_comdirect_transactions(
  p_file_name text,
  p_file_sha256 text,
  p_period_start date,
  p_period_end date,
  p_accounts jsonb
) returns jsonb
```

The function must:

- Require authentication.
- Derive ownership from `auth.uid()`.
- Run atomically.
- Resolve accounts.
- detect repeated files.
- Deduplicate and reconcile.
- Store observations.
- Complete batch counters.
- Return a structured result.
- Roll back on unexpected failure.

Example result:

```json
{
  "batch_id": "uuid",
  "already_imported": false,
  "rows": 100,
  "inserted": 80,
  "duplicates": 15,
  "reconciled": 5,
  "rejected": 0,
  "errors": []
}
```

## Security

- RLS on every table.
- No anonymous read or write access.
- Users access only their own rows.
- RPC ignores forged ownership fields.
- No secret/service-role key in the browser.
- Raw observations are excluded from normal list queries.
- Cross-user tests prove isolation.

## Frontend deliverables

- CSV picker.
- Local parse progress.
- Detected-account and row-count preview.
- Clear pending indicators.
- Validation warnings.
- Import action.
- Import-result summary.
- Friendly exact-file reimport result.
- Transaction-list refresh after success.

## Database deliverables

- Version-controlled SQL migration.
- Tables, foreign keys, constraints, and indexes.
- Grants and RLS policies.
- Atomic import RPC.
- Migration notes.
- No dashboard-only schema edits missing from Git.

## Tests

### Parser

- Multiple account sections.
- Dedicated and embedded reference extraction.
- ISO-8859-1 characters.
- German amounts.
- Pending rows.
- Empty and summary lines.
- Malformed row rejection.
- Stable account keys and repeated parse output.

### Persistence

- First import inserts all valid rows.
- Same file inserts nothing.
- Overlapping export inserts only new references.
- Equal amount/date/merchant rows with different references remain separate.
- Parallel imports cannot bypass uniqueness.
- Pending row persists immediately.
- Repeated pending observation does not duplicate.
- Booked version updates the pending row.
- Ambiguous matching is rejected.
- Different users never conflict.

### Security

- Anonymous access denied.
- User A cannot access User B data.
- Forged user IDs are ignored or rejected.
- Direct client writes cannot bypass import invariants.

## Acceptance criteria

1. A supported CSV parses on a phone.
2. Account sections resolve persistently.
3. Valid transactions persist with provenance.
4. Same-file reimport adds no ledger rows.
5. Overlapping exports add only new booked transactions.
6. Similar payments with distinct bank references remain separate.
7. Pending spending appears immediately.
8. Later booking retains the pending row's internal identity.
9. Pending and booked forms are never double-counted.
10. Import is atomic and returns a complete summary.
11. Two-user RLS isolation is verified.
12. No real bank export or secret is committed publicly.

## Implementation order

1. Add database migration and RLS.
2. Implement parser normalization and reference extraction.
3. Add synthetic parser tests.
4. Implement account resolution and file-hash detection.
5. Implement booked deduplication.
6. Implement pending persistence and reconciliation.
7. Add observations and summaries.
8. Build frontend picker, preview, and result UI.
9. Run overlapping-export and cross-user tests.
10. Plan the transaction-list feature separately.
