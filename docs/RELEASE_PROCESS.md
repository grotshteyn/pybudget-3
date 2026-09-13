# Release process: dev before production

Every application or database change goes to the development environment first. The production site and production Supabase project are promoted only after the development version has been tested and accepted. A passing local test or a mergeable pull request does not replace the dev check.

## Environments

| Environment | Pages path | Source | Supabase project |
| --- | --- | --- | --- |
| Development | `/pybudget-3/dev/` | `feature/rule-based-matching` (the branch currently selected in `.github/workflows/deploy-pages.yml`) | `pybudget-3-dev` |
| Production | `/pybudget-3/` | `main` | `pybudget-3` |

The Pages workflow packages **both** paths on a push to `main` or a manual run. A push to the development source branch alone does not publish a new dev preview. Confirm the workflow has completed and that `/dev/` contains the expected commit before asking anyone to test. Do not assume that a preview built from a different feature branch contains the fix.

## Promotion steps

1. Implement the change on a feature branch and run appropriate local tests using synthetic fixtures. For schema changes, prepare and review a migration; do not apply it to production yet.
2. Put the exact change on the configured development preview branch. Publish the dev preview with the Pages workflow's manual dispatch, without merging the feature into `main`. If the preview branch is changed, update the workflow and this document together.
3. Verify the live `/dev/` page uses the intended code and the development Supabase project. Test login, the affected workflow, error paths, and relevant regression cases there. For imports, check preview row counts, sequential overlapping files, repeat imports, pending-to-booked reconciliation, and persisted ledger IDs and totals. Keep real bank data and credentials out of the repository and public issues.
4. Record the tested dev commit and results in the production pull request. If the code changes after the dev test, publish and test the new version on dev again.
5. Only after dev acceptance, merge the reviewed pull request into `main` and allow Pages to publish the production path. Apply any approved production database migration in its planned release window. Smoke-test the live production login and affected workflow without importing private test data unnecessarily.

The currently published dev branch is a temporary feature branch, so check the workflow's `ref` on every release. Ideally it should become a stable `dev` branch; that branch change is separate work and must be published and tested before relying on it.

## If production was updated first

Do not describe the change as dev-tested. Publish the same change to the development preview promptly, verify it there, and record the resulting gap and test outcome in the relevant issue or pull request. If production behavior is broken, use the previous known-good commit or deployment according to the incident decision; avoid changing production data to compensate for an untested frontend release.
