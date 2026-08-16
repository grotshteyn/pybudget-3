create table public.expense_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 120),
  timing_mode text not null check (timing_mode in ('discrete', 'distributed')),
  recurrence_mode text not null check (recurrence_mode in ('one_off', 'recurring')),
  planned_amount_cent bigint not null check (planned_amount_cent > 0),
  currency text not null default 'EUR' check (char_length(currency) = 3),
  frequency text check (frequency in ('weekly', 'monthly', 'quarterly', 'yearly')),
  interval_count integer not null default 1 check (interval_count between 1 and 100),
  starts_on date not null,
  ends_on date,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  check (ends_on is null or ends_on >= starts_on),
  check ((recurrence_mode = 'recurring' and frequency is not null) or
         (recurrence_mode = 'one_off' and frequency is null)),
  check (timing_mode <> 'distributed' or recurrence_mode <> 'one_off' or ends_on is not null)
);

create table public.expense_plan_occurrences (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  plan_id uuid not null,
  period_start date not null,
  period_end date not null,
  expected_on date,
  planned_amount_cent bigint not null check (planned_amount_cent > 0),
  currency text not null default 'EUR' check (char_length(currency) = 3),
  status text not null default 'expected' check (status in ('expected', 'realized', 'cancelled')),
  realized_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (plan_id, user_id) references public.expense_plans(id, user_id) on delete cascade,
  unique (plan_id, period_start),
  check (period_end >= period_start),
  check ((status = 'realized' and realized_at is not null) or
         (status <> 'realized' and realized_at is null))
);

create index expense_plans_user_active_idx on public.expense_plans (user_id, is_active, starts_on);
create index expense_occurrences_user_period_idx on public.expense_plan_occurrences (user_id, period_start);
create index expense_occurrences_user_status_period_idx on public.expense_plan_occurrences (user_id, status, period_start);
create index expense_occurrences_plan_idx on public.expense_plan_occurrences (plan_id);

alter table public.expense_plans enable row level security;
alter table public.expense_plan_occurrences enable row level security;

create policy "Users select their expense plans" on public.expense_plans for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "Users insert their expense plans" on public.expense_plans for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy "Users update their expense plans" on public.expense_plans for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "Users delete their expense plans" on public.expense_plans for delete to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users select their expense occurrences" on public.expense_plan_occurrences for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "Users insert their expense occurrences" on public.expense_plan_occurrences for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy "Users update their expense occurrences" on public.expense_plan_occurrences for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "Users delete their expense occurrences" on public.expense_plan_occurrences for delete to authenticated
  using ((select auth.uid()) = user_id);

revoke all on public.expense_plans from anon, public;
revoke all on public.expense_plan_occurrences from anon, public;
grant select, insert, update, delete on public.expense_plans to authenticated;
grant select, insert, update, delete on public.expense_plan_occurrences to authenticated;
