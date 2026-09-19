# Issue #41 — comdirect connection test (pre-deployment)

This branch contains a deliberately disabled diagnostic scaffold. It must not be deployed until the current comdirect private-customer authentication/session contract has been verified.

## Safety invariants

- Test is read-only with respect to comdirect banking resources.
- No pyBudget database writes or transaction ingestion.
- No transfer/payment/order/depot endpoints.
- Provider requests are restricted to an explicit endpoint allowlist.
- Client secret, access number, PIN, TAN, OAuth tokens and Session-TAN must never be logged or returned in diagnostics.
- No reusable comdirect authentication material is persisted.
- Responses use `Cache-Control: no-store`.
- The first live test stops after authentication/account discovery; transaction retrieval is enabled only after that succeeds.
- Session termination/invalidation must be attempted and verified before calling the live test complete.
- Production Supabase and the main branch are out of bounds.

## Intended live sequence

1. Authenticated DEV pyBudget user opens the diagnostic UI.
2. User enters client ID, client secret, access number and PIN.
3. Browser sends those values once over HTTPS to the DEV Edge Function.
4. Server authenticates with comdirect and guides the required 2FA/session activation.
5. First test retrieves only account metadata/counts.
6. Server terminates the temporary comdirect session and discards credentials/tokens.
7. Browser receives only sanitized diagnostics.
8. After review, a second test may retrieve a small transaction window but still performs no pyBudget import.
9. Only a later, separately approved test may feed records into the DEV importer.

## Before deployment

- Verify current official comdirect token/session endpoints, required headers, challenge types and termination semantics.
- Add authenticated-user enforcement to the Edge Function.
- Add strict CORS for the DEV preview origin.
- Implement the multi-step challenge state without persisting PIN/TAN/token material in normal tables.
- Add fetch-boundary tests proving the endpoint allowlist blocks banking actions.
- Add redaction tests for thrown provider errors and logs.
- Review generated diff and run the complete regression suite.
- Deploy only to DEV after explicit approval.
