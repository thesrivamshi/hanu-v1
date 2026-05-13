-- Migration: schema tightening (enums + FTS + advisory-lock RPCs + nullable approvals.from_person_id).
-- Per tasks/14-schema-tightening-enums-and-fts.md.
--
-- This is a defensive migration: every alter is idempotent and falls back to
-- text-to-enum casts via a transitional column.

-- ---------------------------------------------------------------------------
-- 1. goal_completion_status enum
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'goal_completion_status') then
    create type public.goal_completion_status as enum ('done', 'missed', 'skipped');
  end if;
end $$;

-- Only migrate if the column is still text-typed.
do $$
declare v_type text;
begin
  select udt_name into v_type from information_schema.columns
   where table_schema = 'public' and table_name = 'goal_completions' and column_name = 'status';

  if v_type = 'text' then
    alter table public.goal_completions add column if not exists status_v2 public.goal_completion_status;
    update public.goal_completions set status_v2 = case status
      when 'done' then 'done'::public.goal_completion_status
      when 'missed' then 'missed'::public.goal_completion_status
      when 'skipped' then 'skipped'::public.goal_completion_status
    end where status_v2 is null;
    if exists (select 1 from public.goal_completions where status_v2 is null) then
      raise exception 'goal_completions has unmapped status values; refusing to drop';
    end if;
    alter table public.goal_completions drop column status;
    alter table public.goal_completions rename column status_v2 to status;
    alter table public.goal_completions alter column status set not null;
  end if;
end $$;


-- ---------------------------------------------------------------------------
-- 2. memory_inbox_state enum
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'memory_inbox_state') then
    create type public.memory_inbox_state as enum ('pending', 'saved', 'rejected', 'edited_saved');
  end if;
end $$;

do $$
declare v_type text;
begin
  select udt_name into v_type from information_schema.columns
   where table_schema = 'public' and table_name = 'memory_inbox' and column_name = 'state';

  if v_type = 'text' then
    alter table public.memory_inbox add column if not exists state_v2 public.memory_inbox_state default 'pending';
    update public.memory_inbox set state_v2 = case state
      when 'pending' then 'pending'::public.memory_inbox_state
      when 'saved' then 'saved'::public.memory_inbox_state
      when 'rejected' then 'rejected'::public.memory_inbox_state
      when 'edited_saved' then 'edited_saved'::public.memory_inbox_state
      else 'pending'::public.memory_inbox_state
    end where state_v2 is null or state is null;
    alter table public.memory_inbox drop column state;
    alter table public.memory_inbox rename column state_v2 to state;
    alter table public.memory_inbox alter column state set not null;
    alter table public.memory_inbox alter column state set default 'pending';
  end if;
end $$;


-- ---------------------------------------------------------------------------
-- 3. space_member_role enum
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'space_member_role') then
    create type public.space_member_role as enum ('member', 'co_manager', 'owner');
  end if;
end $$;

do $$
declare v_type text;
begin
  select udt_name into v_type from information_schema.columns
   where table_schema = 'public' and table_name = 'space_members' and column_name = 'role';

  if v_type = 'text' then
    alter table public.space_members add column if not exists role_v2 public.space_member_role default 'member';
    update public.space_members set role_v2 = case role
      when 'member' then 'member'::public.space_member_role
      when 'co_manager' then 'co_manager'::public.space_member_role
      when 'owner' then 'owner'::public.space_member_role
      else 'member'::public.space_member_role
    end where role_v2 is null or role is null;
    alter table public.space_members drop column role;
    alter table public.space_members rename column role_v2 to role;
    alter table public.space_members alter column role set not null;
    alter table public.space_members alter column role set default 'member';
  end if;
end $$;


-- ---------------------------------------------------------------------------
-- 4. approvals.from_person_id nullable + from_actor enum-checked column
-- ---------------------------------------------------------------------------
alter table public.approvals
  alter column from_person_id drop not null;

alter table public.approvals
  add column if not exists from_actor text not null default 'person';

do $$
begin
  if not exists (
    select 1 from information_schema.table_constraints
     where table_schema = 'public' and table_name = 'approvals'
       and constraint_name = 'approvals_from_actor_check'
  ) then
    alter table public.approvals
      add constraint approvals_from_actor_check
      check (from_actor in ('person', 'hanu_self', 'system'));
  end if;
end $$;


-- ---------------------------------------------------------------------------
-- 5. FTS trigram indexes on messages
-- ---------------------------------------------------------------------------
create extension if not exists pg_trgm;

create index if not exists messages_content_trgm_idx
  on public.messages using gin (content gin_trgm_ops);

-- voice_transcript may not exist yet (task 11 adds it). Guard the index.
do $$
begin
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'messages'
                and column_name = 'voice_transcript') then
    execute 'create index if not exists messages_voice_transcript_trgm_idx
             on public.messages using gin (voice_transcript gin_trgm_ops)
             where voice_transcript is not null';
  end if;
end $$;


-- ---------------------------------------------------------------------------
-- 6. Advisory-lock RPC wrappers (used by reminder_worker; task 05)
-- ---------------------------------------------------------------------------
create or replace function public.pg_try_advisory_lock(key bigint)
returns boolean language sql security definer as $$
  select pg_try_advisory_lock(key);
$$;

create or replace function public.pg_advisory_unlock(key bigint)
returns boolean language sql security definer as $$
  select pg_advisory_unlock(key);
$$;

grant execute on function public.pg_try_advisory_lock(bigint) to service_role;
grant execute on function public.pg_advisory_unlock(bigint) to service_role;
