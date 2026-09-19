import fs from "node:fs"; import assert from "node:assert/strict";
const sql=fs.readFileSync("supabase/migrations/20260919_issue_40_plan_groups_foundation.sql","utf8");
for(const token of ["create table public.plan_groups","parent_group_id uuid","sort_order bigint not null default 0","plans_group_same_user_fkey","plan_groups_parent_same_user_fkey","public.check_plan_group_cycle()","plan group cycle is not allowed","public.delete_plan_group","set parent_group_id = v_parent","set group_id = v_parent","alter table public.plan_groups enable row level security"]) assert.ok(sql.includes(token),token);
assert.match(sql,/foreign key \(parent_group_id, user_id\).*references public\.plan_groups\(id, user_id\)/s);
assert.match(sql,/foreign key \(group_id, user_id\).*references public\.plan_groups\(id, user_id\)/s);
assert.match(sql,/security invoker/g); assert.doesNotMatch(sql,/security definer/i);
console.log("Issue #40 Plan Group foundation SQL contract tests passed");
