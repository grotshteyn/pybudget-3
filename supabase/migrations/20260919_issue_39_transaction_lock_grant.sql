-- Issue #39 follow-up: canonical allocation RPC locks the user's transaction.
-- RLS already restricts rows, but SELECT alone is insufficient for SELECT ... FOR UPDATE.
grant update on table public.transactions to authenticated;
