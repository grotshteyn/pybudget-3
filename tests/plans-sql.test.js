import fs from "node:fs";
import assert from "node:assert/strict";

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
