create table if not exists public.user_test_data (
  user_id uuid primary key references auth.users(id) on delete cascade,
  value text not null default '',
  updated_at timestamptz not null default now()
);

alter table public.user_test_data enable row level security;

revoke all on table public.user_test_data from anon;
grant select, insert, update, delete on table public.user_test_data to authenticated;

drop policy if exists "Users manage their own test data" on public.user_test_data;
create policy "Users manage their own test data"
on public.user_test_data
for all
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);
