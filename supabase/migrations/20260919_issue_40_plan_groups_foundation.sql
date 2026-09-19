-- Issue #40 batch 1: recursive Plan Group persistence and database safety.
create table public.plan_groups (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
 name text not null check (btrim(name) <> ''), parent_group_id uuid, sort_order bigint not null default 0,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 constraint plan_groups_not_own_parent check (parent_group_id is null or parent_group_id <> id),
 constraint plan_groups_id_user_unique unique (id, user_id),
 constraint plan_groups_parent_same_user_fkey foreign key (parent_group_id, user_id) references public.plan_groups(id, user_id) deferrable initially immediate
);
create index plan_groups_user_parent_order_idx on public.plan_groups(user_id, parent_group_id, sort_order, id);
alter table public.plans add column group_id uuid;
alter table public.plans add constraint plans_id_user_unique unique (id, user_id);
alter table public.plans add constraint plans_group_same_user_fkey foreign key (group_id, user_id) references public.plan_groups(id, user_id) deferrable initially immediate;
create index plans_user_group_idx on public.plans(user_id, group_id, id);
create or replace function public.check_plan_group_cycle() returns trigger language plpgsql security invoker set search_path = '' as $$
begin
 if new.parent_group_id is null then return new; end if;
 if new.parent_group_id = new.id then raise exception 'plan group cannot be its own parent'; end if;
 if exists (with recursive descendants as (
   select g.id from public.plan_groups g where g.parent_group_id = new.id and g.user_id = new.user_id
   union all select g.id from public.plan_groups g join descendants d on g.parent_group_id = d.id where g.user_id = new.user_id
 ) select 1 from descendants where id = new.parent_group_id) then raise exception 'plan group cycle is not allowed'; end if;
 return new;
end; $$;
create trigger plan_groups_prevent_cycle before insert or update of parent_group_id, user_id on public.plan_groups for each row execute function public.check_plan_group_cycle();
create or replace function public.delete_plan_group(p_group_id uuid) returns void language plpgsql security invoker set search_path = '' as $$
declare v_user uuid := auth.uid(); v_parent uuid;
begin
 if v_user is null then raise exception 'authentication required'; end if;
 select parent_group_id into v_parent from public.plan_groups where id = p_group_id and user_id = v_user for update;
 if not found then raise exception 'plan group not found'; end if;
 perform 1 from public.plan_groups where user_id = v_user and parent_group_id = p_group_id for update;
 perform 1 from public.plans where user_id = v_user and group_id = p_group_id for update;
 update public.plan_groups set parent_group_id = v_parent, updated_at = now() where user_id = v_user and parent_group_id = p_group_id;
 update public.plans set group_id = v_parent, updated_at = now() where user_id = v_user and group_id = p_group_id;
 delete from public.plan_groups where id = p_group_id and user_id = v_user;
end; $$;
alter table public.plan_groups enable row level security;
revoke all on table public.plan_groups from anon;
grant select, insert, update, delete on table public.plan_groups to authenticated;
create policy "Users read their own plan groups" on public.plan_groups for select to authenticated using ((select auth.uid()) = user_id);
create policy "Users create their own plan groups" on public.plan_groups for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Users update their own plan groups" on public.plan_groups for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "Users delete their own plan groups" on public.plan_groups for delete to authenticated using ((select auth.uid()) = user_id);
revoke all on function public.delete_plan_group(uuid) from public, anon;
grant execute on function public.delete_plan_group(uuid) to authenticated;
revoke all on function public.check_plan_group_cycle() from public, anon, authenticated;
