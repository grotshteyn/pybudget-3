do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'bank_accounts_id_user_unique' and conrelid = 'public.bank_accounts'::regclass) then
    alter table public.bank_accounts add constraint bank_accounts_id_user_unique unique (id, user_id);
  end if;
end $$;

create table if not exists public.matching_rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  plan_id uuid not null,
  name text not null check (char_length(trim(name)) between 1 and 120),
  enabled boolean not null default true,
  priority integer not null default 100 check (priority between 0 and 10000),
  use_partner boolean not null default false,
  partner_value text,
  use_description boolean not null default false,
  description_value text,
  use_amount boolean not null default false,
  amount_cent bigint check (amount_cent is null or amount_cent > 0),
  use_account boolean not null default false,
  account_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  foreign key (plan_id, user_id) references public.expense_plans(id, user_id) on delete cascade,
  foreign key (account_id, user_id) references public.bank_accounts(id, user_id) on delete cascade,
  check (use_partner or use_description or use_amount or use_account),
  check (not use_partner or nullif(trim(partner_value), '') is not null),
  check (not use_description or nullif(trim(description_value), '') is not null),
  check (not use_amount or amount_cent is not null),
  check (not use_account or account_id is not null)
);

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'transactions_id_user_unique' and conrelid = 'public.transactions'::regclass) then
    alter table public.transactions add constraint transactions_id_user_unique unique (id, user_id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'expense_occurrences_id_user_unique' and conrelid = 'public.expense_plan_occurrences'::regclass) then
    alter table public.expense_plan_occurrences add constraint expense_occurrences_id_user_unique unique (id, user_id);
  end if;
end $$;

create table if not exists public.transaction_plan_matches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  transaction_id uuid not null,
  occurrence_id uuid not null,
  rule_id uuid,
  source text not null check (source in ('manual', 'rule')),
  allocated_amount_cent bigint not null check (allocated_amount_cent > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (transaction_id),
  foreign key (transaction_id, user_id) references public.transactions(id, user_id) on delete cascade,
  foreign key (occurrence_id, user_id) references public.expense_plan_occurrences(id, user_id) on delete cascade,
  foreign key (rule_id, user_id) references public.matching_rules(id, user_id) on delete set null (rule_id)
);

create index if not exists matching_rules_user_enabled_idx on public.matching_rules (user_id, enabled, priority);
create index if not exists matching_rules_plan_user_idx on public.matching_rules (plan_id, user_id);
create index if not exists matching_rules_account_idx on public.matching_rules (account_id) where account_id is not null;
create index if not exists transaction_matches_user_idx on public.transaction_plan_matches (user_id, transaction_id);
create index if not exists transaction_matches_occurrence_user_idx on public.transaction_plan_matches (occurrence_id, user_id);
create index if not exists transaction_matches_rule_user_idx on public.transaction_plan_matches (rule_id, user_id) where rule_id is not null;

alter table public.matching_rules enable row level security;
alter table public.transaction_plan_matches enable row level security;

create policy "Users select their matching rules" on public.matching_rules for select to authenticated using ((select auth.uid()) = user_id);
create policy "Users insert their matching rules" on public.matching_rules for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Users update their matching rules" on public.matching_rules for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "Users delete their matching rules" on public.matching_rules for delete to authenticated using ((select auth.uid()) = user_id);
create policy "Users select their transaction matches" on public.transaction_plan_matches for select to authenticated using ((select auth.uid()) = user_id);
create policy "Users insert their transaction matches" on public.transaction_plan_matches for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Users update their transaction matches" on public.transaction_plan_matches for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "Users delete their transaction matches" on public.transaction_plan_matches for delete to authenticated using ((select auth.uid()) = user_id);

revoke all on public.matching_rules from public, anon, authenticated;
revoke all on public.transaction_plan_matches from public, anon, authenticated;
grant select, insert, update, delete on public.matching_rules to authenticated;
grant select, insert, update, delete on public.transaction_plan_matches to authenticated;

create or replace function public.run_matching_rules(p_rule_id uuid default null)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_inserted integer := 0;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;

  with candidates as (
    select
      t.id as transaction_id,
      t.user_id,
      t.amount_cent,
      coalesce(t.booking_date, t.transaction_date, t.value_date, current_date) as transaction_day,
      r.id as rule_id,
      r.plan_id,
      count(*) over (partition by t.id) as rule_count
    from public.transactions t
    join public.matching_rules r on r.user_id = t.user_id and r.enabled
    join public.expense_plans p on p.id = r.plan_id and p.user_id = r.user_id and p.is_active
    left join public.transaction_plan_matches existing on existing.transaction_id = t.id
    where t.user_id = v_user_id
      and existing.id is null
      and ((p.flow_type = 'income' and t.amount_cent > 0) or (p.flow_type = 'expense' and t.amount_cent < 0))
      and (not r.use_partner or lower(trim(coalesce(t.partner, ''))) = lower(trim(r.partner_value)))
      and (not r.use_description or lower(trim(coalesce(t.description, ''))) = lower(trim(r.description_value)))
      and (not r.use_amount or abs(t.amount_cent) = r.amount_cent)
      and (not r.use_account or t.account_id = r.account_id)
  ), selected as (
    select c.*, occurrence.id as occurrence_id
    from candidates c
    join lateral (
      select o.id
      from public.expense_plan_occurrences o
      join public.expense_plans p on p.id = o.plan_id and p.user_id = o.user_id
      where o.user_id = c.user_id and o.plan_id = c.plan_id and o.status = 'expected'
        and (
          (p.timing_mode = 'distributed' and c.transaction_day between o.period_start and o.period_end)
          or
          (p.timing_mode = 'discrete' and not exists (
            select 1 from public.transaction_plan_matches used where used.occurrence_id = o.id
          ))
        )
      order by
        case when c.transaction_day between o.period_start and o.period_end then 0 else 1 end,
        abs(c.transaction_day - coalesce(o.expected_on, o.period_start)),
        o.period_start
      limit 1
    ) occurrence on true
    where c.rule_count = 1 and (p_rule_id is null or c.rule_id = p_rule_id)
  )
  insert into public.transaction_plan_matches (
    user_id, transaction_id, occurrence_id, rule_id, source, allocated_amount_cent
  )
  select user_id, transaction_id, occurrence_id, rule_id, 'rule', abs(amount_cent)
  from selected
  on conflict (transaction_id) do nothing;

  get diagnostics v_inserted = row_count;

  update public.expense_plan_occurrences o
  set status = 'realized', realized_at = coalesce(o.realized_at, now()), updated_at = now()
  from public.expense_plans p
  where p.id = o.plan_id and p.user_id = o.user_id
    and o.user_id = v_user_id and o.status = 'expected' and p.timing_mode = 'discrete'
    and exists (select 1 from public.transaction_plan_matches m where m.occurrence_id = o.id);

  return jsonb_build_object('matched', v_inserted);
end;
$$;

revoke all on function public.run_matching_rules(uuid) from public, anon;
grant execute on function public.run_matching_rules(uuid) to authenticated;
