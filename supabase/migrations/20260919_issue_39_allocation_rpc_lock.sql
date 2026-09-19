-- Issue #39 follow-up: allocation RPC needs row locking, but transactions are
-- intentionally client read-only. SECURITY DEFINER permits the lock while explicit
-- ownership checks preserve the authorization boundary.
revoke update on table public.transactions from authenticated;

create or replace function public.allocate_transaction_to_plan(
  p_transaction_id uuid,
  p_plan_id uuid,
  p_amount_cent bigint default null,
  p_source text default 'manual',
  p_rule_id uuid default null
)
returns public.plan_allocations
language plpgsql
security definer
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
  where transaction_id = p_transaction_id and user_id = v_user
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
