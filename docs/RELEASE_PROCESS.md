# Release process: dev before production

Every application or database change goes to the development environment first. The production site and production Supabase project are promoted only after the development version has been tested and accepted. A passing local test or a mergeable pull request does not replace the dev check.

## Environments

| Environment | Pages path | Source | Supabase project |
| --- | --- | --- | --- |
| Development | `/pybudget-3/dev/` | `dev` | `pybudget-3-dev` |
| Production | `/pybudget-3/` | `main` | `pybudget-3` |

The Pages workflow packages both paths on pushes to `dev` or `main`, and can also be run manually. Production is always built from `main`; the development preview is always built from `dev`.

## Promotion steps

1. Implement the change on a feature branch and run appropriate local tests using synthetic fixtures. For schema changes, prepare and review a migration; do not apply it to production yet.
2. Merge the reviewed feature change into `dev`. The push publishes the development preview without changing production.
3. Verify the live `/dev/` page uses the intended code and the development Supabase project. Test login, the affected workflow, error paths, and relevant regression cases there. For imports, check preview row counts, sequential overlapping files, repeat imports, pending-to-booked reconciliation, and persisted ledger IDs and totals. Keep real bank data and credentials out of the repository and public issues.
4. Record the tested dev commit and results in the production pull request. If the code changes after the dev test, publish and test the new version on dev again.
5. Only after dev acceptance, merge `dev` into `main`. The push then publishes production while retaining the same tested `dev` content. Apply any approved production database migration in its planned release window and smoke-test the live production workflow.

Normal flow: **feature branch → dev → live dev verification → main → production**.

## If production was updated first

Do not describe the change as dev-tested. Put the same change on `dev`, verify it there, and record the gap and test outcome in the relevant issue or pull request. If production behavior is broken, use the previous known-good commit or deployment according to the incident decision; avoid changing production data to compensate for an untested frontend release.
