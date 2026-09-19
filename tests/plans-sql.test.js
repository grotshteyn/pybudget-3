import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const foundation = fs.readFileSync("supabase/migrations/20260918_issue_38_plans_foundation.sql", "utf8");
const schedule = fs.readFileSync("supabase/migrations/20260918_issue_38_plan_scheduling.sql", "utf8");

for (const token of [
  "create table if not exists public.plans",
  "create table if not exists public.plan_allocations",
  "foreign key (plan_id) references public.plans(id)",
  "alter table public.plans enable row level security",
  "alter table public.plan_allocations enable row level security",
  "amount_cent bigint not null check (amount_cent > 0)",
  "schedule_type text not null check (schedule_type in ('one_time', 'weekly', 'monthly', 'yearly'))",
]) assert.ok(foundation.includes(token), token);

for (const token of [
  "create or replace function public.plan_occurrences_for_month(p_month date)",
  "interval '7 days'",
  "interval '1 month'",
  "least(",
  "e.end_date is null",
  "where p.user_id = auth.uid()",
  "and p.is_active",
]) assert.ok(schedule.includes(token), token);

assert.ok(!schedule.includes("insert into public.plan_occurrences"), "occurrences must not be materialized");
console.log("Plan foundation and scheduling SQL contract tests passed");

const allocationSql = fs.readFileSync(path.join(root, "supabase/migrations/20260918_issue_38_plan_allocations.sql"), "utf8");
assert.match(allocationSql, /allocate_transaction_to_plan/);
assert.match(allocationSql, /for update/i);
assert.match(allocationSql, /cancelled transactions cannot be allocated/i);
assert.match(allocationSql, /allocation exceeds transaction amount/i);
assert.match(allocationSql, /plan_allocations_manual_unique_idx/);
assert.match(allocationSql, /on delete cascade/i);
assert.match(allocationSql, /security invoker/i);
assert.match(allocationSql, /p_source text default null/i);
assert.match(allocationSql, /p_source is null or source = p_source/i);
assert.match(allocationSql, /where id = p_transaction_id and user_id = v_user/i);
assert.match(allocationSql, /where id = p_plan_id and user_id = v_user and is_active/i);
console.log("Plan allocation SQL contracts passed.");


const stateSql = fs.readFileSync(path.join(root, "supabase/migrations/20260919_issue_39_plan_states.sql"), "utf8");
assert.match(stateSql, /plan_states_for_month/);
assert.match(stateSql, /plan_occurrences_for_month\(p_month\)/);
assert.match(stateSql, /sum\(o\.amount_cent\).*planned_cent/s);
assert.match(stateSql, /sum\(a\.amount_cent\).*actual_cent/s);
assert.match(stateSql, /t\.status <> 'cancelled'/);
assert.match(stateSql, /coalesce\(t\.transaction_date, t\.booking_date, t\.value_date\)/);
assert.match(stateSql, /greatest\(o\.planned_cent - coalesce\(a\.actual_cent, 0\), 0\).*earmarked_cent/s);
assert.match(stateSql, /greatest\(coalesce\(a\.actual_cent, 0\) - o\.planned_cent, 0\).*overrun_cent/s);
assert.doesNotMatch(stateSql, /t\.status = 'booked'/);
assert.doesNotMatch(stateSql, /insert into public\.plan_occurrences/);
console.log("Plan state SQL contracts passed.");
