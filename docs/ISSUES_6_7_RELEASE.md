# Issues 6 and 7 release acceptance

Prepared 2026-09-13. Development database: pybudget-3-dev. Production has not been changed.

## Implemented

- #6: exact-file and overlapping import protection; occurrence-aware parser fingerprints; persistent UUIDs during confident reconciliation; reviewable ambiguity and both resolution actions.
- Additional acceptance fixes: unresolved reviews deduplicate across overlapping files; original pending fingerprints survive reconciliation; import and resolution share a per-user transaction lock; invalid rows return persisted rejection reasons; missing status/amount and unsupported currency are rejected; distinct nonempty references do not fallback-merge.
- #7: complete 50-row pages, deterministic date/creation/UUID ordering, database filters and full-dataset totals in one snapshot; exact-cent aggregate strings; cancelled exclusion; import provenance; explicit unresolved-review warning; independent candidate loading and transport failures in Setup.

## Passing evidence

- npm test: importer, SQL contracts, and synthetic Edge browser tests, including 251 rows, page-invariant totals, search beyond 200, cancellation, review candidate outside the page, transport failure recovery, logout stale responses, and 320–1180px layouts.
- tests/database-acceptance.sql passed on live dev and rolled back. Covers first/repeat/overlap imports, UUID preservation, old pending observations, identical payments with distinct references and no-reference occurrences, invalid-row reasons, atomic rollback, both review actions and review counters, 251 booked rows, purchase-date filters, deterministic pagination, complete search, two-user reads, forged ownership, denied transaction update/delete, anonymous access and RPC denial.
- Two concurrent live dev imports of the same synthetic file returned first-import and already-imported results with exactly one batch and transaction. Temporary smoke user will be removed after preview validation.
- Every public table has RLS. Ledger is SECURITY INVOKER. Import/resolution are intentionally authenticated SECURITY DEFINER RPCs, scope ownership to auth.uid(), use an empty search path, and deny anonymous/PUBLIC execution.

## Release boundaries

#31 remains a follow-up for changed merchant/date/description fields: the fallback matcher remains conservative, preserves truly unmatched pending entries, and does not guess. Category filtering belongs to the category model in #9 and is explicitly unavailable until that model exists. Account balance snapshots and transfer reporting remain #16/#15; ledger movement is not an account balance. Existing personal transactions are not retrospectively merged by this release. Future category/note/plan columns are not overwritten by reconciliation; the current transaction table does not yet contain category/note fields.

## Production steps

1. Verify deployed dev code, login, imports, reviews, pagination and errors; record the tested commit in the promotion PR.
2. Apply existing #6 review/index migrations, then the new issue_6_import_readiness and issue_7_complete_ledger migrations to production in order. They are additive/replayable and preserve ledger data.
3. Merge the verified dev promotion to main and smoke-test production. Keep issues open until release acceptance.
4. Frontend rollback: restore the previous main deployment. Leave additive schema/RPC changes in place; do not drop user data or fingerprint aliases.

Live preview acceptance and production PR are recorded after deployment.
