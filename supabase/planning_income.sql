alter table public.expense_plans
  add column if not exists flow_type text not null default 'expense';

alter table public.expense_plans
  drop constraint if exists expense_plans_flow_type_check;

alter table public.expense_plans
  add constraint expense_plans_flow_type_check
  check (flow_type in ('expense', 'income'));
