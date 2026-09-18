-- Issue #39: consolidate rule assignments on canonical plan_allocations.
-- Preserve historical allocations when their originating rule is later deleted.

alter table public.plan_allocations
  drop constraint if exists plan_allocations_rule_id_fkey;

alter table public.plan_allocations
  add constraint plan_allocations_rule_id_fkey
  foreign key (rule_id) references public.transaction_rules(id) on delete set null;

alter table public.plan_allocations
  drop constraint if exists plan_allocations_source_rule_check;

alter table public.plan_allocations
  add constraint plan_allocations_source_rule_check check (
    (source = 'manual' and rule_id is null)
    or source = 'rule'
  );

-- Migrate any legacy assignment state that is not already represented as an allocation.
-- Amount defaults to the transaction's full absolute amount, matching the original
-- transaction_plan_matches whole-transaction semantics.
insert into public.plan_allocations(user_id, plan_id, transaction_id, amount_cent, source, rule_id)
select
  m.user_id,
  m.plan_id,
  m.transaction_id,
  abs(t.amount_cent),
  m.source,
  m.rule_id
from public.transaction_plan_matches m
join public.transactions t
  on t.id = m.transaction_id and t.user_id = m.user_id
join public.plans p
  on p.id = m.plan_id and p.user_id = m.user_id
where t.status <> 'cancelled'
  and not exists (
    select 1
    from public.plan_allocations a
    where a.user_id = m.user_id
      and a.transaction_id = m.transaction_id
  );

drop table if exists public.transaction_plan_matches;
