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
  if p_action not in ('same', 'separate') then
    raise exception 'Resolution action must be same or separate';
  end if;

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
