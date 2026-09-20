-- Issue #39, batch 3: derive monthly plan financial state from calculated
-- occurrences and canonical allocations. No occurrence rows are persisted.
create or replace function public.plan_states_for_month(p_month date)
returns table (
  plan_id uuid,
  planned_cent bigint,
  actual_cent bigint,
  earmarked_cent bigint,
  overrun_cent bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  with bounds as (
    select
      date_trunc('month', p_month::timestamp)::date as month_start,
      (date_trunc('month', p_month::timestamp) + interval '1 month')::date as next_month
  ),
  occurrence_totals as (
    select o.plan_id, sum(o.amount_cent)::bigint as planned_cent
    from public.plan_occurrences_for_month(p_month) o
    group by o.plan_id
  ),
  allocation_totals as (
    select
      a.plan_id,
      sum(a.amount_cent)::bigint as actual_cent
    from public.plan_allocations a
    join public.transactions t
      on t.id = a.transaction_id
     and t.user_id = auth.uid()
    cross join bounds b
    where a.user_id = auth.uid()
      and t.status <> 'cancelled'
      and coalesce(t.transaction_date, t.booking_date, t.value_date) >= b.month_start
      and coalesce(t.transaction_date, t.booking_date, t.value_date) < b.next_month
    group by a.plan_id
  )
  select
    o.plan_id,
    o.planned_cent,
    coalesce(a.actual_cent, 0)::bigint as actual_cent,
    greatest(o.planned_cent - coalesce(a.actual_cent, 0), 0)::bigint as earmarked_cent,
    greatest(coalesce(a.actual_cent, 0) - o.planned_cent, 0)::bigint as overrun_cent
  from occurrence_totals o
  left join allocation_totals a using (plan_id)
  order by o.plan_id;
$$;

revoke all on function public.plan_states_for_month(date) from public, anon;
grant execute on function public.plan_states_for_month(date) to authenticated;
