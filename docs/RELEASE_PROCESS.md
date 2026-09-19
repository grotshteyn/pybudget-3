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


## Deployment integrity: ES module dependencies

The GitHub Pages development preview is assembled explicitly in `.github/workflows/deploy-pages.yml`. Any JavaScript module imported by `app.js` (directly or transitively) must therefore be present in the deployed `site/dev/` artifact.

This has caused repeated failures: source code and CI regressions can be green while the live preview is unusable because a newly imported module was not copied by the deployment workflow. When an ES module import returns 404, the browser does not execute `app.js` at all. A typical symptom is a page that renders but appears completely inert: Log in does nothing, Register/Sign up does nothing, and unrelated buttons have no handlers.

### Required prevention check

Whenever a frontend module is added, renamed, removed, or newly imported:

1. inspect the complete static import graph rooted at `app.js`;
2. update the Pages packaging step so every required local module is included in `site/dev/`;
3. verify the deployed artifact, not only the repository checkout;
4. smoke-test the live DEV page starting at the login screen: switch Login/Register, submit authentication, then exercise the changed feature;
5. do not call a feature complete solely because regression CI and the Pages deployment job are green.

A successful Pages workflow means the artifact was uploaded successfully; it does **not** prove that the browser can resolve every module in that artifact.

### 2026-09-19 recurrence

Issue #40 introduced imports of `plan-read-model.js` and `plan-group-service.js` from `app.js`, but the DEV packaging step did not copy those modules. The deployment workflow reported success and regression CI was green, yet the live DEV application stopped before registering any UI event handlers. The fix was commit `ddb1a04c`, which added both modules to the DEV artifact.

Treat an inert login screen after an otherwise successful deployment as a high-signal indication of a JavaScript bootstrap/module-loading failure and inspect the deployed module graph first.
