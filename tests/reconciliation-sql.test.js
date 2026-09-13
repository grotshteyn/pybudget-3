import fs from "node:fs";
import assert from "node:assert/strict";

const sql = fs.readFileSync(new URL("../supabase/transaction_import.sql", import.meta.url), "utf8");
const migration = fs.readFileSync(new URL("../supabase/migrations/20260913_issue_6_reconciliation_reviews.sql", import.meta.url), "utf8");

assert.match(migration, /add column if not exists review_count/);
assert.match(migration, /create table if not exists public\.reconciliation_reviews/);
assert.match(migration, /enable row level security/);
assert.match(migration, /for select to authenticated using \(\(select auth\.uid\(\)\) = user_id\)/);
assert.match(sql, /'needs_review', v_existing_batch\.review_count/);
assert.match(sql, /'needs_review', v_review/);
assert.match(sql, /elsif v_candidate_count > 1 then[\s\S]*insert into public\.reconciliation_reviews[\s\S]*continue;/);
assert.match(sql, /if v_candidate_count = 1 then[\s\S]*v_pending_id := v_candidate_ids\[1\]/);
assert.match(sql, /pg_advisory_xact_lock\(hashtext\(v_user_id::text\)\)/);
assert.match(sql, /unique \(user_id, file_sha256\)/);
assert.match(sql, /revoke all on function public\.import_comdirect_transactions[\s\S]*from public, anon/);

console.log("reconciliation SQL contract tests passed");
