import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sql = fs.readFileSync(
  path.join(root, "supabase/migrations/20260918_issue_39_rules_plan_allocations.sql"),
  "utf8",
);

assert.match(sql, /references public\.transaction_rules\(id\) on delete set null/i);
assert.match(sql, /insert into public\.plan_allocations/i);
assert.match(sql, /from public\.transaction_plan_matches/i);
assert.match(sql, /drop table if exists public\.transaction_plan_matches/i);
assert.match(sql, /source = 'rule'/i);
console.log("Issue #39 allocation consolidation SQL contracts passed.");


const cleanupSql = fs.readFileSync(
  path.join(root, "supabase/migrations/20260919_issue_39_cleanup_legacy_matches.sql"),
  "utf8",
);
assert.match(cleanupSql, /on delete set null/i);
assert.match(cleanupSql, /drop table if exists public\.transaction_plan_matches/i);
assert.match(cleanupSql, /require explicit migration/i);
assert.match(cleanupSql, /source = 'manual' and rule_id is null/i);
assert.match(cleanupSql, /or source = 'rule'/i);
console.log("Issue #39 deployed-schema cleanup contracts passed.");
