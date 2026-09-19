-- Issue #38, increment 2: deterministic plan occurrence calculation.
-- Occurrences are derived at read time; future rows are never materialized.

create or replace function public.plan_occurrences_for_month(p_month date)
returns table (
  plan_id uuid,
  occurrence_date date,
  amount_cent bigint,
  direction text
)
language sql
stable
security invoker
set search_path = ''
as $$
  with bounds as (
    select
      date_trunc('month', p_month::timestamp)::date as month_start,
      (date_trunc('month', p_month::timestamp) + interval '1 month - 1 day')::date as month_end
  ),
  eligible as (
    select p.*, b.month_start, b.month_end
    from public.plans p
    cross join bounds b
    where p.user_id = auth.uid()
      and p.is_active
      and p.start_date <= b.month_end
      and (p.end_date is null or p.end_date >= b.month_start)
  ),
  occurrences as (
    select e.id as plan_id, e.start_date as occurrence_date, e.amount_cent, e.direction
    from eligible e
    where e.schedule_type = 'one_time'
      and e.start_date between e.month_start and e.month_end

    union all

    select e.id, g::date, e.amount_cent, e.direction
    from eligible e
    cross join lateral generate_series(
      e.start_date::timestamp,
      e.month_end::timestamp,
      interval '7 days'
    ) g
    where e.schedule_type = 'weekly'
      and g::date between e.month_start and e.month_end
      and (e.end_date is null or g::date <= e.end_date)

    union all

    select e.id,
      (
        date_trunc('month', m)::date
        + (least(
            extract(day from e.start_date)::integer,
            extract(day from (date_trunc('month', m) + interval '1 month - 1 day'))::integer
          ) - 1)
      )::date,
      e.amount_cent, e.direction
    from eligible e
    cross join lateral generate_series(
      date_trunc('month', e.start_date::timestamp),
      date_trunc('month', e.month_end::timestamp),
      interval '1 month'
    ) m
    where e.schedule_type = 'monthly'
      and date_trunc('month', m)::date = e.month_start
      and (
        date_trunc('month', m)::date
        + (least(
            extract(day from e.start_date)::integer,
            extract(day from (date_trunc('month', m) + interval '1 month - 1 day'))::integer
          ) - 1)
      )::date >= e.start_date
      and (
        e.end_date is null or
        (
          date_trunc('month', m)::date
          + (least(
              extract(day from e.start_date)::integer,
              extract(day from (date_trunc('month', m) + interval '1 month - 1 day'))::integer
            ) - 1)
        )::date <= e.end_date
      )

    union all

    select e.id,
      make_date(
        extract(year from e.month_start)::integer,
        extract(month from e.start_date)::integer,
        least(
          extract(day from e.start_date)::integer,
          extract(day from (
            date_trunc('month', make_date(
              extract(year from e.month_start)::integer,
              extract(month from e.start_date)::integer,
              1
            )::timestamp) + interval '1 month - 1 day'
          ))::integer
        )
      ),
      e.amount_cent, e.direction
    from eligible e
    where e.schedule_type = 'yearly'
      and extract(month from e.month_start) = extract(month from e.start_date)
      and make_date(
        extract(year from e.month_start)::integer,
        extract(month from e.start_date)::integer,
        least(
          extract(day from e.start_date)::integer,
          extract(day from (
            date_trunc('month', make_date(
              extract(year from e.month_start)::integer,
              extract(month from e.start_date)::integer,
              1
            )::timestamp) + interval '1 month - 1 day'
          ))::integer
        )
      ) >= e.start_date
      and (
        e.end_date is null or
        make_date(
          extract(year from e.month_start)::integer,
          extract(month from e.start_date)::integer,
          least(
            extract(day from e.start_date)::integer,
            extract(day from (
              date_trunc('month', make_date(
                extract(year from e.month_start)::integer,
                extract(month from e.start_date)::integer,
                1
              )::timestamp) + interval '1 month - 1 day'
            ))::integer
          )
        ) <= e.end_date
      )
  )
  select o.plan_id, o.occurrence_date, o.amount_cent, o.direction
  from occurrences o
  order by o.occurrence_date, o.plan_id;
$$;

revoke all on function public.plan_occurrences_for_month(date) from public, anon;
grant execute on function public.plan_occurrences_for_month(date) to authenticated;
