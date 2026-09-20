import assert from "node:assert/strict";
import fs from "node:fs";

const sql = fs.readFileSync(new URL("../supabase/migrations/20260918_issue_37_transaction_rules.sql", import.meta.url), "utf8");

for (const table of ["transaction_rules","transaction_rule_conditions","transaction_plan_matches"]) {
  assert.match(sql, new RegExp("create table if not exists public\\." + table));
  assert.match(sql, new RegExp("alter table public\\." + table + " enable row level security"));
}
assert.match(sql, /unique \(transaction_id\)/);
assert.match(sql, /source in \('rule','manual'\)/);
assert.match(sql, /amount_rule_only_equals/);
assert.match(sql, /on delete set null/);
assert.match(sql, /exists \(\s*select 1 from public\.transactions/s);
assert.match(sql, /exists \(\s*select 1 from public\.transaction_rules/s);

console.log("Rule SQL tests passed.");
