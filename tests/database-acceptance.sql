begin;
insert into auth.users(id,email) values ('00000000-0000-4000-8000-000000000601','release-a@example.invalid'),('00000000-0000-4000-8000-000000000602','release-b@example.invalid');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000601',true);
create function pg_temp.check(ok boolean,label text) returns void language plpgsql as $$begin if ok is distinct from true then raise exception 'FAILED: %',label; end if; end$$;
set local role authenticated;
do $$
declare payload jsonb; result jsonb; original uuid; aid uuid; review uuid; candidate uuid; first jsonb; second jsonb; n integer;
begin
 payload := '[{"external_key":"acceptance-a","transactions":[{"status":"pending","amount_cent":-1234,"transaction_date":"2026-03-01","partner":"Shop","description":"Purchase","fallback_fingerprint":"pending-one","row_sequence":1}]}]';
 result:=public.import_comdirect_transactions('pending',repeat('a',64),null,null,payload);
 perform pg_temp.check((result->>'inserted')::int=1,'first import');
 select id,account_id into original,aid from public.transactions where fallback_fingerprint='pending-one';
 result:=public.import_comdirect_transactions('repeat',repeat('a',64),null,null,payload);
 perform pg_temp.check((result->>'already_imported')::boolean and (result->>'inserted')::int=0 and (result->>'reconciled')::int=0,'exact-file retry reports no new writes');
 payload:=jsonb_set(payload,'{0,transactions,0,status}','"booked"');
 payload:=jsonb_set(payload,'{0,transactions,0,fallback_fingerprint}','"booked-one"');
 payload:=jsonb_set(payload,'{0,transactions,0,bank_reference}','"ref-one"');
 result:=public.import_comdirect_transactions('booked',repeat('b',64),null,null,payload);
 perform pg_temp.check((result->>'reconciled')::int=1 and exists(select 1 from public.transactions where id=original and status='booked'),'stable UUID reconciliation');
 result:=public.import_comdirect_transactions('old-pending',repeat('c',64),null,null,'[{"external_key":"acceptance-a","transactions":[{"status":"pending","amount_cent":-1234,"transaction_date":"2026-03-01","partner":"Shop","description":"Purchase","fallback_fingerprint":"pending-one","row_sequence":1}]}]');
 perform pg_temp.check((result->>'duplicates')::int=1 and (select count(*) from public.transactions)=1,'old pending does not reappear');
 result:=public.import_comdirect_transactions('overlap',repeat('d',64),null,null,payload);
 perform pg_temp.check((result->>'duplicates')::int=1,'overlap booked');
 result:=public.import_comdirect_transactions('repeats',repeat('e',64),null,null,'[{"external_key":"acceptance-a","transactions":[{"status":"booked","amount_cent":-500,"partner":"Repeat","fallback_fingerprint":"occurrence-1","row_sequence":1},{"status":"booked","amount_cent":-500,"partner":"Repeat","fallback_fingerprint":"occurrence-2","row_sequence":2},{"status":"booked","amount_cent":-500,"partner":"Repeat","bank_reference":"different-1","fallback_fingerprint":"occurrence-3","row_sequence":3},{"status":"booked","amount_cent":-500,"partner":"Repeat","bank_reference":"different-2","fallback_fingerprint":"occurrence-4","row_sequence":4}]}]');
 perform pg_temp.check((result->>'inserted')::int=4,'legitimate equal payments remain distinct');
 result:=public.import_comdirect_transactions('bad-row',repeat('f',64),null,null,'[{"external_key":"acceptance-a","transactions":[{"status":null,"amount_cent":1,"fallback_fingerprint":"invalid"}]}]');
 perform pg_temp.check((result->>'rejected')::int=1 and jsonb_array_length(result->'errors')=1,'rejection reason');
 select count(*) into n from public.import_batches;
 begin
   perform public.import_comdirect_transactions('rollback',repeat('1',64),null,null,'[{"external_key":"rollback-account","transactions":[{"status":"booked","amount_cent":1,"fallback_fingerprint":"rollback"}]},{"transactions":[]}]');
   raise exception 'Expected failure';
 exception when others then
   if SQLERRM='Expected failure' then raise;end if;
 end;
 perform pg_temp.check((select count(*) from public.import_batches)=n and not exists(select 1 from public.bank_accounts where external_key='rollback-account'),'atomic rollback');
 result:=public.import_comdirect_transactions('ambiguity',repeat('2',64),null,null,'[{"external_key":"ambiguity","transactions":[{"status":"pending","amount_cent":-700,"transaction_date":"2026-03-01","partner":"Ambiguous","description":"Same","fallback_fingerprint":"amb-1","row_sequence":1},{"status":"pending","amount_cent":-700,"transaction_date":"2026-03-01","partner":"Ambiguous","description":"Same","fallback_fingerprint":"amb-2","row_sequence":2}]}]');
 payload:='[{"external_key":"ambiguity","transactions":[{"status":"booked","amount_cent":-700,"transaction_date":"2026-03-01","partner":"Ambiguous","description":"Same","bank_reference":"amb-ref","fallback_fingerprint":"amb-booked","row_sequence":1}]}]';
 result:=public.import_comdirect_transactions('review',repeat('3',64),null,null,payload);
 perform pg_temp.check((result->>'needs_review')::int=1 and not exists(select 1 from public.transactions where bank_reference='amb-ref'),'ambiguity does not add booked ledger row');
 result:=public.import_comdirect_transactions('overlapping-review',repeat('4',64),null,null,payload);
 perform pg_temp.check((select count(*) from public.reconciliation_reviews)=1,'overlapping review deduplication');
 select id,candidate_transaction_ids[1] into review,candidate from public.reconciliation_reviews where status='open';
 result:=public.read_transaction_ledger();
 perform pg_temp.check((result->>'review_count')::int=1,'ledger discloses unresolved reviews');
 perform public.resolve_reconciliation_review(review,'same',candidate);
 perform pg_temp.check(exists(select 1 from public.transactions where id=candidate and status='booked') and (select review_count from public.import_batches where file_sha256=repeat('3',64))=0,'same resolution preserves UUID and decrements outstanding count');
 -- Separate resolution on another ambiguous expense.
 payload:=jsonb_set(payload,'{0,transactions,0,bank_reference}','"amb-ref-2"');
 payload:=jsonb_set(payload,'{0,transactions,0,fallback_fingerprint}','"amb-booked-2"');
 -- Add a second remaining candidate via a new pending occurrence.
 perform public.import_comdirect_transactions('another-pending',repeat('5',64),null,null,'[{"external_key":"ambiguity","transactions":[{"status":"pending","amount_cent":-700,"transaction_date":"2026-03-01","partner":"Ambiguous","description":"Same","fallback_fingerprint":"amb-3","row_sequence":1}]}]');
 perform public.import_comdirect_transactions('another-review',repeat('6',64),null,null,payload);
 select id into review from public.reconciliation_reviews where status='open';
 perform public.resolve_reconciliation_review(review,'separate',null);
 perform pg_temp.check(exists(select 1 from public.transactions where bank_reference='amb-ref-2'),'separate resolution');
end$$;
reset role;
-- Large ledger: 251 booked + pending + cancelled, same dates exercise tie ordering.
insert into public.transactions(user_id,account_id,status,amount_cent,booking_date,transaction_date,partner,fallback_fingerprint)
select '00000000-0000-4000-8000-000000000601',id,'booked',100,'2026-04-02','2026-04-01',case when g=251 then 'Beyond page 200' else 'Large ledger' end,'large-'||g
from public.bank_accounts cross join generate_series(1,251) g where external_key='acceptance-a';
insert into public.transactions(user_id,account_id,status,amount_cent,partner,fallback_fingerprint)
select user_id,id,'cancelled',-99999,'Cancelled','cancelled' from public.bank_accounts where external_key='acceptance-a';
set local role authenticated;
do $$declare first jsonb;second jsonb; aid uuid;begin
 select id into aid from public.bank_accounts where external_key='acceptance-a';
 first:=public.read_transaction_ledger(0,50,'booked','',aid,'2026-04-01','2026-04-01','income');
 second:=public.read_transaction_ledger(50,50,'booked','',aid,'2026-04-01','2026-04-01','income');
 perform pg_temp.check((first->>'count')::int=251 and first->>'booked'='25100' and first->>'booked'=second->>'booked','full dataset totals and purchase date');
 perform pg_temp.check(jsonb_array_length(first->'rows')=50 and not exists(select 1 from jsonb_array_elements(first->'rows') a join jsonb_array_elements(second->'rows') b on a->>'id'=b->>'id'),'deterministic pages do not overlap');
 perform pg_temp.check((public.read_transaction_ledger(0,50,'all','Beyond page 200')->>'count')::int=1,'full dataset search');
 perform pg_temp.check(public.read_transaction_ledger(0,50,'cancelled')->>'booked'='0','cancelled excluded');
end$$;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000602',true);
do $$begin
 perform pg_temp.check((select count(*) from public.transactions)=0 and (select count(*) from public.bank_accounts)=0 and (select count(*) from public.reconciliation_reviews)=0,'two-user RLS reads');
 perform pg_temp.check((public.read_transaction_ledger()->>'count')::int=0,'ledger isolation');
 begin
   perform public.resolve_reconciliation_review((select id from public.reconciliation_reviews limit 1),'separate',null);
   raise exception 'Expected denied';
 exception when others then if SQLERRM='Expected denied' then raise;end if;end;
 perform public.import_comdirect_transactions('same-hash-other-user',repeat('a',64),null,null,'[{"external_key":"acceptance-a","user_id":"00000000-0000-4000-8000-000000000601","transactions":[{"user_id":"00000000-0000-4000-8000-000000000601","status":"booked","amount_cent":1,"fallback_fingerprint":"forged"}]}]');
 perform pg_temp.check((select count(*) from public.transactions)=1 and (select user_id=auth.uid() from public.transactions limit 1),'forged ownership ignored and hash scoped to user');
 begin update public.transactions set amount_cent=999;raise exception 'Expected denied';exception when insufficient_privilege then null;end;
 begin delete from public.transactions;raise exception 'Expected denied';exception when insufficient_privilege then null;end;
end$$;
reset role;
set local role anon;
do $$begin
 begin perform public.read_transaction_ledger();raise exception 'Expected denied';exception when insufficient_privilege then null;end;
 begin perform public.import_comdirect_transactions('anon',repeat('9',64),null,null,'[]');raise exception 'Expected denied';exception when insufficient_privilege then null;end;
 begin perform count(*) from public.transactions;raise exception 'Expected denied';exception when insufficient_privilege then null;end;
end$$;
reset role;
select 'Issue 6 and 7 transactional acceptance passed' as result;
rollback;
