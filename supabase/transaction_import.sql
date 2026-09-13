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
  review_count integer not null default 0,
  created_at timestamptz not null default now(),
  unique (user_id, file_sha256)
);

alter table public.import_batches
  add column if not exists review_count integer not null default 0;

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

alter table public.transactions add column if not exists pending_fingerprints text[] not null default '{}';
alter table public.import_batches add column if not exists rejection_errors jsonb not null default '[]';

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
alter table public.reconciliation_reviews enable row level security;

drop policy if exists "Users read own bank accounts" on public.bank_accounts;
create policy "Users read own bank accounts" on public.bank_accounts
  for select to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "Users update own bank accounts" on public.bank_accounts;
create policy "Users update own bank accounts" on public.bank_accounts
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users read own import batches" on public.import_batches;
create policy "Users read own import batches" on public.import_batches
  for select to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "Users read own transactions" on public.transactions;
create policy "Users read own transactions" on public.transactions
  for select to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "Users read own reconciliation reviews" on public.reconciliation_reviews;
create policy "Users read own reconciliation reviews" on public.reconciliation_reviews
  for select to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "Users read own observations" on public.transaction_observations;
create policy "Users read own observations" on public.transaction_observations
  for select to authenticated using ((select auth.uid()) = user_id);

revoke all on public.bank_accounts from anon, authenticated;
revoke all on public.import_batches from anon, authenticated;
revoke all on public.transactions from anon, authenticated;
revoke all on public.transaction_observations from anon, authenticated;
revoke all on public.reconciliation_reviews from anon, authenticated;
grant select on public.bank_accounts to authenticated;
grant update (display_name, is_active, updated_at) on public.bank_accounts to authenticated;
grant select on public.import_batches to authenticated;
grant select on public.transactions to authenticated;
grant select on public.transaction_observations to authenticated;
grant select on public.reconciliation_reviews to authenticated;

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
  v_review integer := 0;
  v_errors jsonb := '[]';
  v_candidate_ids uuid[];
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
  if p_file_sha256 is null or p_file_sha256 !~ '^[0-9a-fA-F]{64}$' then
    raise exception 'A valid SHA-256 file hash is required';
  end if;
  if p_accounts is null or jsonb_typeof(p_accounts) <> 'array' or jsonb_array_length(p_accounts)=0 then
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
      'rows', 0,
      'inserted', 0,
      'duplicates', 0,
      'reconciled', 0,
      'rejected', 0,
      'needs_review', v_existing_batch.review_count,
      'errors', v_existing_batch.rejection_errors
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
        v_errors := v_errors || jsonb_build_array(jsonb_build_object('row',v_rows,'account',v_account->>'external_key','reason','Invalid status, integer amount, currency, date or fingerprint'));
        continue;
      end;

      if v_status is null or v_status not in ('pending', 'booked') or v_amount is null
         or abs(v_amount::numeric)>9007199254740991 or coalesce(v_tx->>'currency','EUR')<>'EUR'
         or nullif(v_tx->>'fallback_fingerprint', '') is null then
        v_rejected := v_rejected + 1;
        v_errors := v_errors || jsonb_build_array(jsonb_build_object('row',v_rows,'account',v_account->>'external_key','reason','Invalid status, integer amount, currency, date or fingerprint'));
        continue;
      end if;

      if v_status = 'booked' then
        if exists (select 1 from public.reconciliation_reviews r where r.user_id=v_user_id and r.account_id=v_account_id and r.status='open'
          and ((v_reference is not null and r.booked_payload->>'bank_reference'=v_reference)
            or (v_reference is null and r.booked_payload->>'fallback_fingerprint'=v_tx->>'fallback_fingerprint'))) then
          v_duplicates := v_duplicates + 1;
          continue;
        end if;
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
              and amount_cent=v_amount and currency=coalesce(v_tx->>'currency','EUR')
            limit 1;
          end if;

          if v_pending_id is null then
            select count(*), array_agg(id order by created_at)
              into v_candidate_count, v_candidate_ids
            from public.transactions
            where user_id = v_user_id
              and account_id = v_account_id
              and status = 'pending'
              and (bank_reference is null or v_reference is null)
              and currency=coalesce(v_tx->>'currency','EUR')
              and amount_cent = v_amount
              and coalesce(transaction_date, value_date)
                  is not distinct from coalesce(v_transaction_date, v_value_date)
              and lower(coalesce(partner, '')) =
                  lower(coalesce(v_tx->>'partner', ''))
              and lower(coalesce(description, '')) =
                  lower(coalesce(v_tx->>'description', ''));
            if v_candidate_count = 1 then
              v_pending_id := v_candidate_ids[1];
            elsif v_candidate_count > 1 then
              insert into public.reconciliation_reviews (
                user_id, import_batch_id, account_id, source_row_sequence,
                booked_payload, candidate_transaction_ids
              ) values (
                v_user_id, v_batch_id, v_account_id,
                coalesce((v_tx->>'row_sequence')::integer, v_rows),
                v_tx, v_candidate_ids
              )
              on conflict (import_batch_id, account_id, source_row_sequence) do nothing;
              v_review := v_review + 1;
              continue;
            end if;
          end if;

          if v_pending_id is not null then
            update public.transactions set
              pending_fingerprints = array_append(pending_fingerprints,fallback_fingerprint),
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
            and (fallback_fingerprint = v_tx->>'fallback_fingerprint' or v_tx->>'fallback_fingerprint'=any(pending_fingerprints))
            and status in ('pending','booked')
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
    rejected_count = v_rejected,
    review_count = v_review,
    rejection_errors = v_errors
  where id = v_batch_id;

  return jsonb_build_object(
    'batch_id', v_batch_id,
    'already_imported', false,
    'rows', v_rows,
    'inserted', v_inserted,
    'duplicates', v_duplicates,
    'reconciled', v_reconciled,
    'rejected', v_rejected,
    'needs_review', v_review,
    'errors', v_errors
  );
end;
$$;

revoke all on function public.import_comdirect_transactions(text, text, date, date, jsonb) from public, anon;
grant execute on function public.import_comdirect_transactions(text, text, date, date, jsonb) to authenticated;


create or replace function public.resolve_reconciliation_review(
  p_review_id uuid,
  p_action text,
  p_candidate_transaction_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_review public.reconciliation_reviews%rowtype;
  v_payload jsonb;
  v_transaction_id uuid;
  v_account_external_key text;
  v_reference text;
  v_amount bigint;
  v_booking_date date;
  v_value_date date;
  v_transaction_date date;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;
  if p_action is null or p_action not in ('same', 'separate') then
    raise exception 'Resolution action must be same or separate';
  end if;

  perform pg_advisory_xact_lock(hashtext(v_user_id::text));
  select * into v_review
  from public.reconciliation_reviews
  where id = p_review_id and user_id = v_user_id
  for update;

  if not found then
    raise exception 'Reconciliation review not found';
  end if;
  if v_review.status <> 'open' then
    raise exception 'Reconciliation review is already resolved';
  end if;

  v_payload := v_review.booked_payload;
  v_reference := nullif(btrim(v_payload->>'bank_reference'), '');
  v_amount := (v_payload->>'amount_cent')::bigint;
  v_booking_date := nullif(v_payload->>'booking_date', '')::date;
  v_value_date := nullif(v_payload->>'value_date', '')::date;
  v_transaction_date := nullif(v_payload->>'transaction_date', '')::date;

  select external_key into v_account_external_key
  from public.bank_accounts
  where id = v_review.account_id and user_id = v_user_id;

  if p_action = 'same' then
    if p_candidate_transaction_id is null
       or not (p_candidate_transaction_id = any(v_review.candidate_transaction_ids)) then
      raise exception 'A valid candidate transaction is required';
    end if;

    update public.transactions set
      pending_fingerprints = array_append(pending_fingerprints,fallback_fingerprint),
      status = 'booked',
      booking_date = v_booking_date,
      value_date = v_value_date,
      transaction_date = v_transaction_date,
      booking_type = nullif(v_payload->>'booking_type', ''),
      description = nullif(v_payload->>'description', ''),
      partner = nullif(v_payload->>'partner', ''),
      bank_reference = v_reference,
      fallback_fingerprint = v_payload->>'fallback_fingerprint',
      last_seen_at = now(),
      booked_at = now(),
      updated_at = now()
    where id = p_candidate_transaction_id
      and user_id = v_user_id
      and account_id = v_review.account_id
      and status = 'pending'
    returning id into v_transaction_id;

    if v_transaction_id is null then
      raise exception 'Candidate transaction is no longer pending';
    end if;

    update public.reconciliation_reviews set
      status = 'resolved_same',
      resolved_transaction_id = v_transaction_id,
      resolved_at = now()
    where id = v_review.id;
  else
    insert into public.transactions (
      user_id, account_id, status, amount_cent, currency,
      booking_date, value_date, transaction_date, booking_type,
      description, partner, bank_reference, fallback_fingerprint,
      booked_at
    ) values (
      v_user_id, v_review.account_id, 'booked', v_amount,
      coalesce(nullif(v_payload->>'currency', ''), 'EUR'),
      v_booking_date, v_value_date, v_transaction_date,
      nullif(v_payload->>'booking_type', ''),
      nullif(v_payload->>'description', ''),
      nullif(v_payload->>'partner', ''),
      v_reference,
      v_payload->>'fallback_fingerprint',
      now()
    ) returning id into v_transaction_id;

    update public.reconciliation_reviews set
      status = 'resolved_separate',
      resolved_transaction_id = v_transaction_id,
      resolved_at = now()
    where id = v_review.id;
  end if;

  update public.import_batches
  set review_count = greatest(review_count - 1, 0)
  where id = v_review.import_batch_id
    and user_id = v_user_id;

  insert into public.transaction_observations (
    user_id, import_batch_id, transaction_id, account_external_key,
    row_sequence, source_status, bank_reference, raw_row
  ) values (
    v_user_id, v_review.import_batch_id, v_transaction_id,
    v_account_external_key, v_review.source_row_sequence,
    'booked', v_reference, coalesce(v_payload->'raw_row', '{}'::jsonb)
  ) on conflict do nothing;

  return jsonb_build_object(
    'review_id', v_review.id,
    'action', p_action,
    'transaction_id', v_transaction_id
  );
end;
$$;

revoke all on function public.resolve_reconciliation_review(uuid, text, uuid) from public, anon;
grant execute on function public.resolve_reconciliation_review(uuid, text, uuid) to authenticated;
