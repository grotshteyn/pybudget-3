create table if not exists public.bank_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source text not null,
  external_key text not null,
  display_name text not null,
  currency text not null default 'EUR',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, source, external_key)
);

create table if not exists public.import_batches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source text not null,
  file_name text,
  file_sha256 text not null,
  period_start date,
  period_end date,
  status text not null default 'processing' check (status in ('processing', 'completed', 'failed')),
  row_count integer not null default 0,
  inserted_count integer not null default 0,
  duplicate_count integer not null default 0,
  reconciled_count integer not null default 0,
  rejected_count integer not null default 0,
  created_at timestamptz not null default now(),
  unique (user_id, file_sha256)
);

create table if not exists public.transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  account_id uuid not null references public.bank_accounts(id) on delete cascade,
  status text not null check (status in ('pending', 'booked', 'cancelled')),
  amount_cent bigint not null,
  currency text not null default 'EUR',
  booking_date date,
  value_date date,
  transaction_date date,
  booking_type text,
  description text,
  partner text,
  bank_reference text,
  fallback_fingerprint text not null,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  booked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists transactions_booked_reference_unique
  on public.transactions (user_id, account_id, bank_reference)
  where bank_reference is not null and status = 'booked';

create unique index if not exists transactions_booked_fallback_unique
  on public.transactions (user_id, account_id, fallback_fingerprint)
  where bank_reference is null and status = 'booked';

create unique index if not exists transactions_pending_reference_unique
  on public.transactions (user_id, account_id, bank_reference)
  where bank_reference is not null and status = 'pending';

create unique index if not exists transactions_pending_fallback_unique
  on public.transactions (user_id, account_id, fallback_fingerprint)
  where bank_reference is null and status = 'pending';

create index if not exists transactions_user_date_idx
  on public.transactions (user_id, booking_date desc);

create table if not exists public.transaction_observations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  import_batch_id uuid not null references public.import_batches(id) on delete cascade,
  transaction_id uuid not null references public.transactions(id) on delete cascade,
  account_external_key text not null,
  row_sequence integer not null,
  source_status text not null check (source_status in ('pending', 'booked')),
  bank_reference text,
  raw_row jsonb not null default '{}'::jsonb,
  observed_at timestamptz not null default now(),
  unique (import_batch_id, account_external_key, row_sequence)
);

alter table public.bank_accounts enable row level security;
alter table public.import_batches enable row level security;
alter table public.transactions enable row level security;
alter table public.transaction_observations enable row level security;

drop policy if exists "Users read own bank accounts" on public.bank_accounts;
create policy "Users read own bank accounts" on public.bank_accounts
  for select to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "Users read own import batches" on public.import_batches;
create policy "Users read own import batches" on public.import_batches
  for select to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "Users read own transactions" on public.transactions;
create policy "Users read own transactions" on public.transactions
  for select to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "Users read own observations" on public.transaction_observations;
create policy "Users read own observations" on public.transaction_observations
  for select to authenticated using ((select auth.uid()) = user_id);

revoke all on public.bank_accounts from anon, authenticated;
revoke all on public.import_batches from anon, authenticated;
revoke all on public.transactions from anon, authenticated;
revoke all on public.transaction_observations from anon, authenticated;
grant select on public.bank_accounts to authenticated;
grant select on public.import_batches to authenticated;
grant select on public.transactions to authenticated;
grant select on public.transaction_observations to authenticated;

create or replace function public.import_comdirect_transactions(
  p_file_name text,
  p_file_sha256 text,
  p_period_start date,
  p_period_end date,
  p_accounts jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_batch_id uuid;
  v_existing_batch public.import_batches%rowtype;
  v_account jsonb;
  v_tx jsonb;
  v_account_id uuid;
  v_transaction_id uuid;
  v_pending_id uuid;
  v_candidate_count integer;
  v_rows integer := 0;
  v_inserted integer := 0;
  v_duplicates integer := 0;
  v_reconciled integer := 0;
  v_rejected integer := 0;
  v_status text;
  v_reference text;
  v_booking_date date;
  v_value_date date;
  v_transaction_date date;
  v_amount bigint;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;
  perform pg_advisory_xact_lock(hashtext(v_user_id::text));
  if p_file_sha256 is null or length(p_file_sha256) <> 64 then
    raise exception 'A valid SHA-256 file hash is required';
  end if;
  if jsonb_typeof(p_accounts) <> 'array' then
    raise exception 'Accounts payload must be an array';
  end if;

  insert into public.import_batches (
    user_id, source, file_name, file_sha256, period_start, period_end
  ) values (
    v_user_id, 'comdirect', p_file_name, p_file_sha256, p_period_start, p_period_end
  )
  on conflict (user_id, file_sha256) do nothing
  returning id into v_batch_id;

  if v_batch_id is null then
    select * into v_existing_batch
    from public.import_batches
    where user_id = v_user_id and file_sha256 = p_file_sha256;
    return jsonb_build_object(
      'batch_id', v_existing_batch.id,
      'already_imported', true,
      'rows', v_existing_batch.row_count,
      'inserted', v_existing_batch.inserted_count,
      'duplicates', v_existing_batch.duplicate_count,
      'reconciled', v_existing_batch.reconciled_count,
      'rejected', v_existing_batch.rejected_count,
      'errors', '[]'::jsonb
    );
  end if;

  for v_account in select value from jsonb_array_elements(p_accounts)
  loop
    if nullif(v_account->>'external_key', '') is null then
      raise exception 'Account external_key is required';
    end if;

    insert into public.bank_accounts (
      user_id, source, external_key, display_name, currency
    ) values (
      v_user_id,
      'comdirect',
      v_account->>'external_key',
      coalesce(nullif(v_account->>'display_name', ''), v_account->>'external_key'),
      coalesce(nullif(v_account->>'currency', ''), 'EUR')
    )
    on conflict (user_id, source, external_key)
    do update set
      display_name = excluded.display_name,
      updated_at = now()
    returning id into v_account_id;

    for v_tx in select value from jsonb_array_elements(coalesce(v_account->'transactions', '[]'::jsonb))
    loop
      v_rows := v_rows + 1;
      v_transaction_id := null;
      v_pending_id := null;
      v_status := v_tx->>'status';
      v_reference := nullif(btrim(v_tx->>'bank_reference'), '');

      begin
        v_amount := (v_tx->>'amount_cent')::bigint;
        v_booking_date := nullif(v_tx->>'booking_date', '')::date;
        v_value_date := nullif(v_tx->>'value_date', '')::date;
        v_transaction_date := nullif(v_tx->>'transaction_date', '')::date;
      exception when others then
        v_rejected := v_rejected + 1;
        continue;
      end;

      if v_status not in ('pending', 'booked')
         or nullif(v_tx->>'fallback_fingerprint', '') is null then
        v_rejected := v_rejected + 1;
        continue;
      end if;

      if v_status = 'booked' then
        if v_reference is not null then
          select id into v_transaction_id
          from public.transactions
          where user_id = v_user_id
            and account_id = v_account_id
            and bank_reference = v_reference
            and status = 'booked'
          limit 1;
        else
          select id into v_transaction_id
          from public.transactions
          where user_id = v_user_id
            and account_id = v_account_id
            and fallback_fingerprint = v_tx->>'fallback_fingerprint'
            and status = 'booked'
          limit 1;
        end if;

        if v_transaction_id is not null then
          v_duplicates := v_duplicates + 1;
          update public.transactions set last_seen_at = now(), updated_at = now()
          where id = v_transaction_id;
        else
          if v_reference is not null then
            select id into v_pending_id
            from public.transactions
            where user_id = v_user_id
              and account_id = v_account_id
              and bank_reference = v_reference
              and status = 'pending'
            limit 1;
          end if;

          if v_pending_id is null then
            select count(*), (array_agg(id order by created_at))[1]
              into v_candidate_count, v_pending_id
            from public.transactions
            where user_id = v_user_id
              and account_id = v_account_id
              and status = 'pending'
              and amount_cent = v_amount
              and coalesce(transaction_date, value_date)
                  is not distinct from coalesce(v_transaction_date, v_value_date)
              and lower(coalesce(partner, '')) =
                  lower(coalesce(v_tx->>'partner', ''))
              and lower(coalesce(description, '')) =
                  lower(coalesce(v_tx->>'description', ''));
            if v_candidate_count <> 1 then
              v_pending_id := null;
            end if;
          end if;

          if v_pending_id is not null then
            update public.transactions set
              status = 'booked',
              booking_date = v_booking_date,
              value_date = v_value_date,
              transaction_date = v_transaction_date,
              booking_type = nullif(v_tx->>'booking_type', ''),
              description = nullif(v_tx->>'description', ''),
              partner = nullif(v_tx->>'partner', ''),
              bank_reference = v_reference,
              fallback_fingerprint = v_tx->>'fallback_fingerprint',
              last_seen_at = now(),
              booked_at = now(),
              updated_at = now()
            where id = v_pending_id
            returning id into v_transaction_id;
            v_reconciled := v_reconciled + 1;
          else
            begin
              insert into public.transactions (
                user_id, account_id, status, amount_cent, currency,
                booking_date, value_date, transaction_date, booking_type,
                description, partner, bank_reference, fallback_fingerprint,
                booked_at
              ) values (
                v_user_id, v_account_id, 'booked', v_amount,
                coalesce(nullif(v_tx->>'currency', ''), 'EUR'),
                v_booking_date, v_value_date, v_transaction_date,
                nullif(v_tx->>'booking_type', ''),
                nullif(v_tx->>'description', ''),
                nullif(v_tx->>'partner', ''),
                v_reference,
                v_tx->>'fallback_fingerprint',
                now()
              ) returning id into v_transaction_id;
              v_inserted := v_inserted + 1;
            exception when unique_violation then
              if v_reference is not null then
                select id into v_transaction_id
                from public.transactions
                where user_id = v_user_id
                  and account_id = v_account_id
                  and bank_reference = v_reference
                  and status = 'booked'
                limit 1;
              else
                select id into v_transaction_id
                from public.transactions
                where user_id = v_user_id
                  and account_id = v_account_id
                  and fallback_fingerprint = v_tx->>'fallback_fingerprint'
                  and status = 'booked'
                limit 1;
              end if;
              v_duplicates := v_duplicates + 1;
            end;
          end if;
        end if;
      else
        if v_reference is not null then
          select id into v_transaction_id
          from public.transactions
          where user_id = v_user_id
            and account_id = v_account_id
            and bank_reference = v_reference
            and status in ('pending', 'booked')
          order by case when status = 'booked' then 0 else 1 end
          limit 1;
        else
          select id into v_transaction_id
          from public.transactions
          where user_id = v_user_id
            and account_id = v_account_id
            and fallback_fingerprint = v_tx->>'fallback_fingerprint'
            and status = 'pending'
          limit 1;
        end if;

        if v_transaction_id is not null then
          v_duplicates := v_duplicates + 1;
          update public.transactions set last_seen_at = now(), updated_at = now()
          where id = v_transaction_id;
        else
          insert into public.transactions (
            user_id, account_id, status, amount_cent, currency,
            booking_date, value_date, transaction_date, booking_type,
            description, partner, bank_reference, fallback_fingerprint
          ) values (
            v_user_id, v_account_id, 'pending', v_amount,
            coalesce(nullif(v_tx->>'currency', ''), 'EUR'),
            null, v_value_date, v_transaction_date,
            nullif(v_tx->>'booking_type', ''),
            nullif(v_tx->>'description', ''),
            nullif(v_tx->>'partner', ''),
            v_reference,
            v_tx->>'fallback_fingerprint'
          ) returning id into v_transaction_id;
          v_inserted := v_inserted + 1;
        end if;
      end if;

      if v_transaction_id is not null then
        insert into public.transaction_observations (
          user_id, import_batch_id, transaction_id, account_external_key,
          row_sequence, source_status, bank_reference, raw_row
        ) values (
          v_user_id, v_batch_id, v_transaction_id,
          v_account->>'external_key',
          coalesce((v_tx->>'row_sequence')::integer, v_rows),
          v_status, v_reference, coalesce(v_tx->'raw_row', '{}'::jsonb)
        ) on conflict do nothing;
      end if;
    end loop;
  end loop;

  update public.import_batches set
    status = 'completed',
    row_count = v_rows,
    inserted_count = v_inserted,
    duplicate_count = v_duplicates,
    reconciled_count = v_reconciled,
    rejected_count = v_rejected
  where id = v_batch_id;

  return jsonb_build_object(
    'batch_id', v_batch_id,
    'already_imported', false,
    'rows', v_rows,
    'inserted', v_inserted,
    'duplicates', v_duplicates,
    'reconciled', v_reconciled,
    'rejected', v_rejected,
    'errors', '[]'::jsonb
  );
end;
$$;

revoke all on function public.import_comdirect_transactions(text, text, date, date, jsonb) from public, anon;
grant execute on function public.import_comdirect_transactions(text, text, date, date, jsonb) to authenticated;
