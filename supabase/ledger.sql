-- One snapshot supplies the page and totals. Invoker security retains table RLS.
create or replace function public.read_transaction_ledger(
  p_offset integer default 0, p_limit integer default 50,
  p_status text default 'all', p_search text default '',
  p_account uuid default null, p_start date default null,
  p_end date default null, p_direction text default 'all'
) returns jsonb language sql stable security invoker set search_path = '' as $$
with filtered as materialized (
 select t.*, coalesce(t.transaction_date,t.booking_date,t.value_date) as report_date,
        a.display_name as account_name
 from public.transactions t join public.bank_accounts a on a.id=t.account_id
 where t.user_id=(select auth.uid()) and a.user_id=(select auth.uid())
 and (p_status='all' or t.status=p_status)
 and (p_account is null or t.account_id=p_account)
 and (p_start is null or coalesce(t.transaction_date,t.booking_date,t.value_date)>=p_start)
 and (p_end is null or coalesce(t.transaction_date,t.booking_date,t.value_date)<=p_end)
 and (p_direction='all' or (p_direction='income' and t.amount_cent>0) or (p_direction='expense' and t.amount_cent<0))
 and (coalesce(p_search,'')='' or strpos(lower(coalesce(t.partner,'') || ' ' || coalesce(t.description,'') || ' ' || a.display_name),lower(p_search))>0)
), page as (
 select * from filtered order by report_date desc nulls first, created_at desc, id desc
 limit greatest(1,least(coalesce(p_limit,50),100)) offset greatest(0,coalesce(p_offset,0))
)
select jsonb_build_object(
 'rows',coalesce((select jsonb_agg((to_jsonb(page) - 'user_id' - 'fallback_fingerprint' - 'pending_fingerprints') || jsonb_build_object('imports',coalesce((select jsonb_agg(jsonb_build_object('batch_id',b.id,'file_name',b.file_name,'status',o.source_status,'observed_at',o.observed_at) order by o.observed_at) from public.transaction_observations o join public.import_batches b on b.id=o.import_batch_id where o.transaction_id=page.id and o.user_id=(select auth.uid()) and b.user_id=(select auth.uid())),'[]'::jsonb))) from page),'[]'::jsonb),
 'count',(select count(*) from filtered),
 'booked',coalesce((select sum(amount_cent)::text from filtered where status='booked'),'0'),
 'pending',coalesce((select sum(amount_cent)::text from filtered where status='pending'),'0'),
 'review_count',(select count(*) from public.reconciliation_reviews where user_id=(select auth.uid()) and status='open')
);
$$;
revoke all on function public.read_transaction_ledger(integer,integer,text,text,uuid,date,date,text) from public,anon;
grant execute on function public.read_transaction_ledger(integer,integer,text,text,uuid,date,date,text) to authenticated;
create index if not exists transactions_user_report_date_idx on public.transactions
 (user_id,(coalesce(transaction_date,booking_date,value_date)) desc,created_at desc,id desc);

create index if not exists transactions_account_idx on public.transactions(account_id);
create index if not exists observations_transaction_idx on public.transaction_observations(transaction_id);
create index if not exists observations_user_idx on public.transaction_observations(user_id);
