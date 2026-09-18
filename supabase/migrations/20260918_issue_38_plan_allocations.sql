-- Issue #38, increment 5: canonical transaction allocation operations.
-- Actual budget usage is recorded in plan_allocations; rule match rows remain matching/audit state.

alter table public.plan_allocations
  drop constraint if exists plan_allocations_plan_id_transaction_id_source_rule_id_key;

drop index if exists public.plan_allocations_manual_unique_idx;
create unique index plan_allocations_manual_unique_idx
  on public.plan_allocations(plan_id, transaction_id)
  where source = 'manual';

drop index if exists public.plan_allocations_rule_unique_idx;
create unique index plan_allocations_rule_unique_idx
  on public.plan_allocations(plan_id, transaction_id, rule_id)
  where source = 'rule';

alter table public.plan_allocations
  drop constraint if exists plan_allocations_rule_id_fkey;
alter table public.plan_allocations
  add constraint plan_allocations_rule_id_fkey
  foreign key (rule_id) references public.transaction_rules(id) on delete cascade;

create or replace function public.allocate_transaction_to_plan(
  p_transaction_id uuid,
  p_plan_id uuid,
  p_amount_cent bigint default null,
  p_source text default 'manual',
  p_rule_id uuid default null
)
returns public.plan_allocations
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_transaction public.transactions;
  v_amount bigint;
  v_allocated bigint;
  v_result public.plan_allocations;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  if p_source not in ('manual', 'rule') then raise exception 'Invalid allocation source'; end if;
  if (p_source = 'manual' and p_rule_id is not null) or (p_source = 'rule' and p_rule_id is null) then
    raise exception 'Invalid rule/source combination';
  end if;

  select * into v_transaction
  from public.transactions
  where id = p_transaction_id and user_id = v_user
  for update;
  if not found then raise exception 'Transaction not found'; end if;
  if v_transaction.status = 'cancelled' then raise exception 'Cancelled transactions cannot be allocated'; end if;

  if not exists (select 1 from public.plans where id = p_plan_id and user_id = v_user and is_active) then
    raise exception 'Plan not found';
  end if;
  if p_source = 'rule' and not exists (
    select 1 from public.transaction_rules
    where id = p_rule_id and user_id = v_user and plan_id = p_plan_id
  ) then raise exception 'Rule does not target this plan'; end if;

  v_amount := coalesce(p_amount_cent, abs(v_transaction.amount_cent));
  if v_amount <= 0 then raise exception 'Allocation amount must be positive'; end if;
  select coalesce(sum(amount_cent), 0) into v_allocated
  from public.plan_allocations
  where transaction_id = p_transaction_id
    and user_id = v_user
    and not (plan_id = p_plan_id and source = p_source and rule_id is not distinct from p_rule_id);
  if v_allocated + v_amount > abs(v_transaction.amount_cent) then
    raise exception 'Allocation exceeds transaction amount';
  end if;

  if p_source = 'manual' then
    insert into public.plan_allocations(user_id, plan_id, transaction_id, amount_cent, source, rule_id)
    values (v_user, p_plan_id, p_transaction_id, v_amount, 'manual', null)
    on conflict (plan_id, transaction_id) where source = 'manual'
    do update set amount_cent = excluded.amount_cent, updated_at = now()
    returning * into v_result;
  else
    insert into public.plan_allocations(user_id, plan_id, transaction_id, amount_cent, source, rule_id)
    values (v_user, p_plan_id, p_transaction_id, v_amount, 'rule', p_rule_id)
    on conflict (plan_id, transaction_id, rule_id) where source = 'rule'
    do update set amount_cent = excluded.amount_cent, updated_at = now()
    returning * into v_result;
  end if;
  return v_result;
end;
$$;

revoke all on function public.allocate_transaction_to_plan(uuid, uuid, bigint, text, uuid) from public, anon;
grant execute on function public.allocate_transaction_to_plan(uuid, uuid, bigint, text, uuid) to authenticated;

create or replace function public.unallocate_transaction_from_plan(p_transaction_id uuid, p_plan_id uuid)
returns bigint
language plpgsql
security invoker
set search_path = ''
as $$
declare v_count bigint;
begin
  delete from public.plan_allocations
  where user_id = auth.uid() and transaction_id = p_transaction_id and plan_id = p_plan_id;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
revoke all on function public.unallocate_transaction_from_plan(uuid, uuid) from public, anon;
grant execute on function public.unallocate_transaction_from_plan(uuid, uuid) to authenticated;
