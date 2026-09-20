-- Issue #38, increment 1: Plans persistence and allocation foundation.
-- Rules already store plan UUIDs; this migration makes those references concrete.

create table if not exists public.plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (btrim(name) <> ''),
  amount_cent bigint not null check (amount_cent > 0),
  direction text not null check (direction in ('expense', 'income')),
  schedule_type text not null check (schedule_type in ('one_time', 'weekly', 'monthly', 'yearly')),
  start_date date not null,
  end_date date,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint plans_date_range check (end_date is null or end_date >= start_date)
);

create index if not exists plans_user_active_idx
  on public.plans(user_id, is_active, start_date, id);

create table if not exists public.plan_allocations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  plan_id uuid not null references public.plans(id) on delete cascade,
  transaction_id uuid not null references public.transactions(id) on delete cascade,
  amount_cent bigint not null check (amount_cent > 0),
  source text not null default 'manual' check (source in ('manual', 'rule')),
  rule_id uuid references public.transaction_rules(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint plan_allocation_rule_source check (
    (source = 'rule' and rule_id is not null) or
    (source = 'manual' and rule_id is null)
  ),
  unique (plan_id, transaction_id, source, rule_id)
);

create index if not exists plan_allocations_user_plan_idx
  on public.plan_allocations(user_id, plan_id);
create index if not exists plan_allocations_user_transaction_idx
  on public.plan_allocations(user_id, transaction_id);

-- Issue #37 intentionally deferred these foreign keys until Plans existed.
alter table public.transaction_rules
  drop constraint if exists transaction_rules_plan_id_fkey;
alter table public.transaction_rules
  add constraint transaction_rules_plan_id_fkey
  foreign key (plan_id) references public.plans(id) on delete cascade;

alter table public.transaction_plan_matches
  drop constraint if exists transaction_plan_matches_plan_id_fkey;
alter table public.transaction_plan_matches
  add constraint transaction_plan_matches_plan_id_fkey
  foreign key (plan_id) references public.plans(id) on delete cascade;

alter table public.plans enable row level security;
alter table public.plan_allocations enable row level security;

revoke all on table public.plans from anon;
revoke all on table public.plan_allocations from anon;
grant select, insert, update, delete on table public.plans to authenticated;
grant select, insert, update, delete on table public.plan_allocations to authenticated;

drop policy if exists "Users manage their own plans" on public.plans;
create policy "Users manage their own plans"
on public.plans for all to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "Users manage their own plan allocations" on public.plan_allocations;
create policy "Users manage their own plan allocations"
on public.plan_allocations for all to authenticated
using (
  (select auth.uid()) = user_id
  and exists (
    select 1 from public.plans p
    where p.id = plan_id and p.user_id = (select auth.uid())
  )
  and exists (
    select 1 from public.transactions t
    where t.id = transaction_id and t.user_id = (select auth.uid())
  )
)
with check (
  (select auth.uid()) = user_id
  and exists (
    select 1 from public.plans p
    where p.id = plan_id and p.user_id = (select auth.uid())
  )
  and exists (
    select 1 from public.transactions t
    where t.id = transaction_id and t.user_id = (select auth.uid())
  )
  and (
    source = 'manual'
    or exists (
      select 1 from public.transaction_rules r
      where r.id = rule_id
        and r.user_id = (select auth.uid())
        and r.plan_id = plan_allocations.plan_id
    )
  )
);
