# Feature Plan: Planned Expenses

## Objective

Build planning around the question:

> Relative to what I planned, how much spending is still expected and how much has already happened?

PyBudget should not treat the bank balance as the planning baseline. Imported transactions are actual financial events. Expense plans describe expected spending. The application combines both without counting realized spending twice.

## Terminology

The original terms "one time" and "continuous" describe how an expense happens within its planning period. The clearer product terms are:

### Timing mode

- **Discrete**: expected as one identifiable purchase or charge at a point in time.
- **Distributed**: expected to accumulate across a date range through one or more transactions.

### Recurrence

- **One-off**: exists for one occurrence or planning period.
- **Recurring**: generates a new occurrence repeatedly according to a schedule.

This creates four plan types:

| Timing | Recurrence | Example | Meaning |
|---|---|---|---|
| Discrete | One-off | Buy a television | One identifiable future expense |
| Discrete | Recurring | Monthly rent | One identifiable charge per recurrence |
| Distributed | One-off | Vacation | Spending accumulates across one defined period |
| Distributed | Recurring | Monthly food budget | Spending accumulates during every recurrence period |

Suggested UI wording:

- **Single expense** for discrete
- **Spending budget** for distributed
- **One-off** or **Recurring** for recurrence

The database can retain precise values such as `discrete`, `distributed`, `one_off`, and `recurring`.

## Core model

Separate planning into three levels.

### 1. Plan definition

The reusable intention or template.

Examples:

- "Buy a television"
- "Rent"
- "Summer vacation"
- "Groceries"

A recurring definition remains active after an individual month is realized.

### 2. Plan occurrence

A dated instance of the definition.

Examples:

- Rent for September 2026
- Groceries for September 2026
- Summer vacation from 12 to 22 July 2027
- Television purchase expected in November 2026

Every recurrence produces its own occurrence. Realizing September rent must not mark October rent as realized.

### 3. Transaction allocation

A link between an imported transaction and an occurrence. The allocation records how much of that transaction realizes the plan.

This supports:

- One transaction fully realizing rent
- Several transactions consuming a grocery budget
- Several vacation transactions realizing one vacation plan
- One transaction split between multiple plans later

## Realization state

A binary status on the reusable definition is insufficient. State belongs primarily to each occurrence.

Use these occurrence states:

- **Expected**: no linked realized amount yet.
- **Partially realized**: some amount is linked, but less than planned.
- **Realized**: the planned amount has been fully covered or the user explicitly closes it.
- **Cancelled**: no longer expected and excluded from forecasts.

The state should usually be derived from amounts:

```text
realized_amount = sum(transaction allocations)
remaining_amount = max(planned_amount - realized_amount, 0)
```

Derived state:

```text
realized_amount = 0                  -> expected
0 < realized_amount < planned       -> partially_realized
realized_amount >= planned           -> realized
explicit cancellation                -> cancelled
```

For a discrete expense, the user may explicitly mark an occurrence realized even when the final amount differs from the original estimate. The actual linked amount remains the truth.

For a distributed budget, exceeding the planned amount produces an overrun rather than hiding the additional spending.

## Forecasting rules

The central rule is:

> Actual transactions are counted as actuals. Only the unrealized part of active occurrences is added as expected future spending.

This prevents double counting.

For one occurrence:

```text
actual spending = sum linked booked and pending transactions
future expected spending = max(planned amount - actual spending, 0)
projected total spending = actual spending + future expected spending
overrun = max(actual spending - planned amount, 0)
```

### Discrete occurrence

Before realization, its remaining estimated amount is included in the forecast.

After realization, the planned estimate is removed from future spending because the linked transaction is already part of actual spending.

### Distributed occurrence

Linked transactions reduce the remaining budget throughout the occurrence period.

The UI also compares elapsed time with budget consumption:

```text
time progress = elapsed days / occurrence days
spending progress = actual spending / planned amount
```

This comparison is a pacing indicator, not an instruction that spending must be perfectly linear.

### Pending transactions

Pending transactions count as realized spending immediately for planning purposes. When a pending transaction becomes booked, its existing transaction identity and plan allocation must be retained so it is not counted twice.

### Income

This feature is initially limited to expenses. Planned income should later use the same definition, occurrence, and allocation model with its own forecasting presentation.

## Recurrence

A recurring plan requires:

- Frequency: weekly, monthly, quarterly, or yearly
- Interval: every 1, 2, or N periods
- Start date
- Optional end date
- Occurrence timing:
  - expected day for discrete plans
  - start and end boundaries for distributed plans
- Planned amount per occurrence

Occurrences should be generated deterministically for a bounded date window. Re-running generation must not create duplicates.

A unique key should combine the definition and occurrence period.

Editing a recurring definition must offer a clear effective scope later:

- This occurrence only
- This and future occurrences
- Entire series

For the first release, editing the definition may affect only future, unrealized occurrences. Realized historical occurrences remain unchanged.

## Data model

All tables are user-owned, protected with RLS, and use `auth.uid()` ownership checks.

### expense_plans

Reusable plan definitions.

- `id uuid primary key`
- `user_id uuid not null`
- `name text not null`
- `timing_mode text`: discrete or distributed
- `recurrence_mode text`: one_off or recurring
- `planned_amount_cent bigint not null`
- `currency text not null default 'EUR'`
- `frequency text null`: weekly, monthly, quarterly, yearly
- `interval_count integer null default 1`
- `starts_on date not null`
- `ends_on date null`
- `expected_day integer null`
- `duration_days integer null`
- `is_active boolean not null default true`
- `created_at timestamptz`
- `updated_at timestamptz`

Constraints must enforce:

- Positive interval count
- Non-negative planned amount
- Recurrence fields present only when relevant
- End date not earlier than start date
- Discrete and distributed timing fields remain internally consistent

### expense_plan_occurrences

Dated plan instances.

- `id uuid primary key`
- `user_id uuid not null`
- `plan_id uuid not null references expense_plans`
- `period_start date not null`
- `period_end date not null`
- `expected_on date null`
- `planned_amount_cent bigint not null`
- `currency text not null`
- `status_override text null`: realized or cancelled
- `closed_at timestamptz null`
- `created_at timestamptz`
- `updated_at timestamptz`

Constraint:

```text
unique(plan_id, period_start, period_end)
```

The planned amount is copied to the occurrence so historical plans do not change when the template changes.

### expense_plan_allocations

Links transaction amounts to occurrences.

- `id uuid primary key`
- `user_id uuid not null`
- `occurrence_id uuid not null references expense_plan_occurrences`
- `transaction_id uuid not null references transactions`
- `amount_cent bigint not null`
- `created_at timestamptz`
- `updated_at timestamptz`

Initial constraint:

```text
unique(occurrence_id, transaction_id)
```

The sum allocated from one transaction must not exceed the transaction's applicable expense amount. The first UI may allocate a complete transaction to one occurrence while keeping the schema ready for later splits.

## Categories

Plans and categories serve different purposes:

- A category says what a transaction is.
- A plan says what spending was expected.

The first planned-expense release may work without a full category system by linking transactions directly to occurrences. A later categorization and rules feature can automatically propose or apply those links.

A future optional `category_id` can connect plans and transactions without replacing occurrence-based realization.

## User workflows

### Create a television plan

1. Choose Single expense.
2. Choose One-off.
3. Enter name, expected amount, and expected date.
4. Save one occurrence.
5. Link the eventual television transaction.
6. The occurrence becomes realized and disappears from future expected spending.

### Create rent

1. Choose Single expense.
2. Choose Recurring.
3. Enter amount, monthly frequency, start date, and expected day.
4. Generate separate monthly occurrences.
5. Link each month's rent transaction to its occurrence.
6. Only that month's occurrence becomes realized.

### Create a vacation budget

1. Choose Spending budget.
2. Choose One-off.
3. Enter total amount and vacation date range.
4. Link travel, accommodation, food, and activity transactions.
5. Show actual, remaining, overrun, and time progress for the vacation occurrence.

### Create a food budget

1. Choose Spending budget.
2. Choose Recurring.
3. Enter monthly amount and start month.
4. Generate one occurrence per month.
5. Link food transactions throughout the month.
6. Show amount spent, remaining, overrun, and month progress.

## Matching transactions

### First release

- Manual linking from a transaction to a plan occurrence
- Manual unlinking
- Clear display of unassigned transactions
- Suggested candidate occurrences filtered by date, amount direction, and open state
- Pending-to-booked reconciliation preserves allocations

### Later

- Category-based automatic matching
- Rules based on partner, description, booking type, and amount
- Recurring discrete matching by expected date and amount
- Confidence score and review queue
- Never silently assign an ambiguous transaction

## User interface

Primary navigation remains:

- Overview
- Transactions
- Setup

Planning appears through:

### Overview

- Planned expenses for the selected period
- Realized spending, including pending transactions
- Remaining expected spending
- Overruns
- Progress by active occurrence
- Unassigned transaction count

### Plan management

- List of plan definitions
- Filter by active, completed, and recurring
- Create and edit plan form
- Four-type selector using examples
- Upcoming occurrences
- Pause or end a recurring definition

### Occurrence details

- Planned amount
- Realized amount
- Remaining amount
- Overrun
- Date or date range
- Linked transactions
- Manual realize, reopen, or cancel actions

### Transactions

- Assigned plan or occurrence
- Assign and unassign action
- Filter for unassigned transactions

## Supabase operations

Use direct RLS-protected CRUD for ordinary plan definition edits.

Use PostgreSQL RPC functions where atomic consistency matters:

- Generate occurrences for a bounded date range
- Allocate or reallocate transaction amounts
- Close or reopen an occurrence
- Produce a period planning summary without double counting

Any `SECURITY DEFINER` function must:

- Check `auth.uid()` explicitly
- Derive ownership from the authenticated user
- Use `set search_path = ''`
- Revoke execution from `public` and `anon`
- Grant only to `authenticated`
- Never trust client-supplied user IDs

## Security

- RLS enabled on every planning table.
- Every select, insert, update, and delete policy checks ownership.
- Foreign-key targets must belong to the same user.
- Client code cannot allocate another user's transaction.
- Historical realized occurrences are not silently rewritten.
- Financial amounts use signed integer cents.
- Foreign-key and common period-query columns are indexed.
- No service-role or secret key in the browser.

## First release scope

### Included

- Four plan types
- One-off and recurring definitions
- Deterministic occurrence generation
- Expected, partially realized, realized, and cancelled occurrence states
- Manual transaction allocation
- Pending transactions counted immediately
- Actual, remaining, and overrun calculations
- Basic period summary
- Phone-first plan creation and occurrence views
- RLS and cross-user isolation

### Excluded

- Planned income
- Automatic category system
- Automatic matching rules
- Transaction splitting across multiple plans in the UI
- Editing realized history in bulk
- Carryover between distributed recurring budgets
- Bank-balance calculations
- Multi-currency conversion
- Notifications

## Acceptance criteria

1. All four plan types can be created from a phone.
2. A recurring definition creates separate, duplicate-safe occurrences.
3. Realizing one recurring occurrence does not close the series.
4. A transaction can realize a discrete occurrence.
5. Multiple transactions can partially or fully realize a distributed occurrence.
6. Pending spending is included immediately.
7. Pending-to-booked reconciliation does not lose or duplicate allocations.
8. Realized amounts are never added again as future expected spending.
9. Overruns remain visible.
10. Cancelling an occurrence removes it from forecasts without deleting history.
11. Users cannot access or link another user's planning data.
12. Historical occurrences retain their copied planned amounts when a definition changes.

## Implementation order

1. Create planning tables, constraints, indexes, grants, and RLS.
2. Implement the four-type plan form.
3. Implement deterministic occurrence generation.
4. Add plan and occurrence lists.
5. Add manual transaction allocation and unlinking.
6. Add derived realization states and calculations.
7. Add period summary RPC.
8. Add Overview planning cards.
9. Add unassigned-transaction workflow.
10. Add synthetic recurrence, allocation, pending, and RLS tests.

## Open product decisions

Resolve during implementation:

1. Whether discrete occurrences require an exact expected date or allow a month-only target.
2. Whether a distributed one-off budget may have an open-ended date range.
3. Whether over-realization automatically closes a discrete occurrence.
4. Whether users may manually close a distributed budget below its planned amount.
5. Which recurrence edit scopes are included in the first release.
6. Whether transaction allocations store positive expense magnitudes or signed transaction amounts.
