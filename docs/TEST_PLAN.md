# Deferred Test Plan: Transaction Import

## Purpose

This test plan records the validation intentionally deferred when the first transaction-import feature is merged. It must be completed before relying on PyBudget for authoritative financial balances or enabling the feature for additional users.

## Test environment

- Use a dedicated Supabase development project.
- Use a development branch and the GitHub Pages `/dev/` preview.
- Never commit real bank exports, credentials, access tokens, or personal transaction data.
- Prefer synthetic CSV fixtures. If a real export is used manually, delete local copies after testing.
- Record the application commit, SQL migration version, browser, device, and test date.

## Preconditions

- Email/password signup, confirmation, login, session restoration, and logout work.
- The transaction SQL migration has been applied successfully.
- RLS is enabled on every user-owned table.
- At least two isolated test users are available for security tests.
- Synthetic exports exist for booked, pending, overlapping, repeated, malformed, and ambiguous cases.

## 1. Parser tests

### Encoding and CSV structure

- [ ] ISO-8859-1 characters decode correctly.
- [ ] Semicolon delimiters and quoted delimiters parse correctly.
- [ ] Multiple account sections are detected.
- [ ] Empty rows and summary rows are ignored.
- [ ] Malformed amounts and dates are rejected without guessing.
- [ ] German decimal amounts become exact signed integer cents.

### Transaction normalization

- [ ] Booking, value, and transaction dates remain distinct.
- [ ] Missing booking dates remain null.
- [ ] Pending rows are classified as pending.
- [ ] Booked rows are classified as booked.
- [ ] Dedicated bank references are extracted.
- [ ] Embedded references are extracted.
- [ ] Stable account keys are identical across repeated parses.
- [ ] Repeated parsing produces identical normalized output and hashes.

## 2. First-import persistence

- [ ] A valid file previews the correct account and transaction counts.
- [ ] Import creates one persistent account per account section.
- [ ] Valid normalized transactions are stored.
- [ ] Pending rows are stored immediately.
- [ ] Import-batch counters match database records.
- [ ] Transaction observations reference the correct batch and transaction.
- [ ] The UI refreshes and displays the imported ledger.
- [ ] Amount, status, partner, account, and dates match the source.

## 3. Duplicate protection

### Exact file

- [ ] Import the same file twice.
- [ ] The second import reports that the file was already imported.
- [ ] The second import adds zero ledger transactions.
- [ ] No duplicate account is created.
- [ ] Existing transaction IDs remain unchanged.

### Overlapping exports

- [ ] Import an initial period.
- [ ] Import a later export containing old and new rows.
- [ ] Previously imported booked transactions remain single records.
- [ ] Only genuinely new rows are inserted.
- [ ] Duplicate and inserted counters are correct.

### Similar legitimate transactions

- [ ] Two payments with the same date, amount, and partner but different bank references remain separate.
- [ ] Repeated identical-looking rows without references use occurrence-aware handling.
- [ ] Concurrent imports cannot bypass database uniqueness.

## 4. Pending reconciliation

- [ ] Import a pending expense and confirm it affects the pending total.
- [ ] Import its later booked representation.
- [ ] The original transaction ID is retained.
- [ ] Status changes from pending to booked.
- [ ] Final dates and reference are filled.
- [ ] The transaction is counted once, not twice.
- [ ] A repeated pending observation does not create another active pending row.
- [ ] A missing pending row in a later export is not silently deleted.
- [ ] An ambiguous pending match is rejected or surfaced rather than guessed.

## 5. Balance consistency

- [ ] Booked totals equal the sum of booked rows.
- [ ] Pending totals equal the sum of pending rows.
- [ ] Combined totals equal booked plus pending.
- [ ] Running balances from supported exports are used to detect missing, duplicated, or incorrectly ordered rows.
- [ ] Multiple accounts remain independent.
- [ ] Internal transfers are documented as not yet specially classified.

## 6. Security and isolation

- [ ] Anonymous users cannot read accounts, batches, transactions, or observations.
- [ ] Anonymous users cannot call the import RPC successfully.
- [ ] User A cannot read User B's records.
- [ ] User A cannot update or delete User B's records.
- [ ] User A and User B may import identical file hashes without conflict.
- [ ] Forged user IDs are ignored or rejected.
- [ ] Browser code contains no secret or service-role key.
- [ ] Error messages do not expose another user's data.

## 7. Failure and recovery

- [ ] Unsupported files fail with a useful message.
- [ ] Empty files do not create a batch or ledger data.
- [ ] Partial invalid files report rejected rows.
- [ ] Unexpected RPC failure rolls back the complete import.
- [ ] Network interruption does not leave a falsely completed batch.
- [ ] Retrying safely produces one correct result.
- [ ] Large supported exports complete on a representative phone.

## 8. UI and mobile checks

- [ ] Logged-out users see only authentication.
- [ ] Logged-in users see only the authenticated application.
- [ ] Navigation works without a full-page reload.
- [ ] Ledger cards fit narrow phone screens without horizontal overflow.
- [ ] Pending status is visually clear.
- [ ] Buttons, inputs, messages, and totals are keyboard and screen-reader usable.
- [ ] Loading, success, empty, and error states are understandable.
- [ ] Refreshing restores the session and correct view.

## Exit criteria

The deferred test phase is complete when:

1. Every critical checkbox above passes.
2. Any failed case has a documented issue and resolution.
3. Same-file, overlap, and pending-to-booked cases are verified against database rows.
4. Two-user RLS isolation is verified.
5. No real bank data or secrets are committed.
6. The production migration and frontend commit are identified and reproducible.
