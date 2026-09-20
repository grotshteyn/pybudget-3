-- Issue #39 cleanup: make consolidation safe for the actually deployed legacy schema.
-- The early rules table used occurrence_id rather than plan_id. Occurrences are no
-- longer canonical, so rows without a reusable plan mapping cannot be migrated.
-- On a clean DEV database there are no legacy rows; fail loudly otherwise.
do $$
begin
  if to_regclass('public.transaction_plan_matches') is not null
     and not exists (
       select 1 from information_schema.columns
       where table_schema='public' and table_name='transaction_plan_matches' and column_name='plan_id'
     )
     and exists (select 1 from public.transaction_plan_matches limit 1)
  then
    raise exception 'Legacy transaction_plan_matches contains occurrence-based rows that require explicit migration';
  end if;
end $$;

alter table public.plan_allocations
  drop constraint if exists plan_allocations_rule_id_fkey;
alter table public.plan_allocations
  add constraint plan_allocations_rule_id_fkey
  foreign key (rule_id) references public.transaction_rules(id) on delete set null;

alter table public.plan_allocations
  drop constraint if exists plan_allocation_rule_source;
alter table public.plan_allocations
  drop constraint if exists plan_allocations_source_rule_check;
alter table public.plan_allocations
  add constraint plan_allocations_source_rule_check check (
    (source = 'manual' and rule_id is null) or source = 'rule'
  );

drop table if exists public.transaction_plan_matches;
