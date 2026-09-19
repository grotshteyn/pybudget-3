-- Issue #37: transaction matching rules.
-- Rules intentionally target plan UUIDs without a foreign key until the planning
-- persistence migration lands. Ownership and provenance are still enforced here.

create table if not exists public.transaction_rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  plan_id uuid not null,
  name text not null default '',
  enabled boolean not null default true,
  priority integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.transaction_rule_conditions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  rule_id uuid not null references public.transaction_rules(id) on delete cascade,
  field text not null check (field in ('partner','description','amount','account')),
  operator text not null check (operator in ('equals','contains')),
  value text not null check (btrim(value) <> ''),
  created_at timestamptz not null default now(),
  constraint amount_rule_only_equals check (field <> 'amount' or operator = 'equals')
);

create table if not exists public.transaction_plan_matches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  transaction_id uuid not null references public.transactions(id) on delete cascade,
  plan_id uuid not null,
  rule_id uuid references public.transaction_rules(id) on delete set null,
  source text not null check (source in ('rule','manual')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint rule_match_requires_rule check (
    (source = 'rule' and rule_id is not null) or
    (source = 'manual' and rule_id is null)
  ),
  unique (transaction_id)
);

create index if not exists transaction_rules_user_priority_idx
  on public.transaction_rules(user_id, enabled, priority desc, id);
create index if not exists transaction_rule_conditions_rule_idx
  on public.transaction_rule_conditions(rule_id);
create index if not exists transaction_plan_matches_user_plan_idx
  on public.transaction_plan_matches(user_id, plan_id);
create index if not exists transaction_plan_matches_rule_idx
  on public.transaction_plan_matches(rule_id);

alter table public.transaction_rules enable row level security;
alter table public.transaction_rule_conditions enable row level security;
alter table public.transaction_plan_matches enable row level security;

revoke all on table public.transaction_rules from anon;
revoke all on table public.transaction_rule_conditions from anon;
revoke all on table public.transaction_plan_matches from anon;
grant select, insert, update, delete on table public.transaction_rules to authenticated;
grant select, insert, update, delete on table public.transaction_rule_conditions to authenticated;
grant select, insert, update, delete on table public.transaction_plan_matches to authenticated;

drop policy if exists "Users manage their own transaction rules" on public.transaction_rules;
create policy "Users manage their own transaction rules"
on public.transaction_rules for all to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "Users manage their own rule conditions" on public.transaction_rule_conditions;
create policy "Users manage their own rule conditions"
on public.transaction_rule_conditions for all to authenticated
using (
  (select auth.uid()) = user_id
  and exists (
    select 1 from public.transaction_rules r
    where r.id = rule_id and r.user_id = (select auth.uid())
  )
)
with check (
  (select auth.uid()) = user_id
  and exists (
    select 1 from public.transaction_rules r
    where r.id = rule_id and r.user_id = (select auth.uid())
  )
);

drop policy if exists "Users manage their own transaction plan matches" on public.transaction_plan_matches;
create policy "Users manage their own transaction plan matches"
on public.transaction_plan_matches for all to authenticated
using (
  (select auth.uid()) = user_id
  and exists (
    select 1 from public.transactions t
    where t.id = transaction_id and t.user_id = (select auth.uid())
  )
)
with check (
  (select auth.uid()) = user_id
  and exists (
    select 1 from public.transactions t
    where t.id = transaction_id and t.user_id = (select auth.uid())
  )
  and (
    source = 'manual'
    or exists (
      select 1 from public.transaction_rules r
      where r.id = rule_id and r.user_id = (select auth.uid()) and r.plan_id = transaction_plan_matches.plan_id
    )
  )
);
