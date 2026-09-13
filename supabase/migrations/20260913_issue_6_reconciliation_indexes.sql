-- Keep foreign-key lookups on reconciliation reviews efficient.
create index if not exists reconciliation_reviews_account_idx
  on public.reconciliation_reviews (account_id);

create index if not exists reconciliation_reviews_resolved_transaction_idx
  on public.reconciliation_reviews (resolved_transaction_id)
  where resolved_transaction_id is not null;
