-- Issue #6: make ambiguous pending-to-booked reconciliation reviewable.
-- Apply to the development Supabase project first.

alter table public.import_batches
  add column if not exists review_count integer not null default 0;

create table if not exists public.reconciliation_reviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  import_batch_id uuid not null references public.import_batches(id) on delete cascade,
  account_id uuid not null references public.bank_accounts(id) on delete cascade,
  source_row_sequence integer not null,
  booked_payload jsonb not null,
  candidate_transaction_ids uuid[] not null,
  status text not null default 'open' check (status in ('open', 'resolved_same', 'resolved_separate')),
  resolved_transaction_id uuid references public.transactions(id) on delete set null,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  unique (import_batch_id, account_id, source_row_sequence)
);

create index if not exists reconciliation_reviews_user_status_idx
  on public.reconciliation_reviews (user_id, status, created_at);

alter table public.reconciliation_reviews enable row level security;

drop policy if exists "Users read own reconciliation reviews" on public.reconciliation_reviews;
create policy "Users read own reconciliation reviews" on public.reconciliation_reviews
  for select to authenticated using ((select auth.uid()) = user_id);

revoke all on public.reconciliation_reviews from anon, authenticated;
grant select on public.reconciliation_reviews to authenticated;

