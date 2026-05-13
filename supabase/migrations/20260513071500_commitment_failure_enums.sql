-- Migration: extend commitment_level enum, add goal_failure_reason enum,
-- convert goal_completions.reason to enum, add goals.family_critical bool.
-- Per tasks/09-commitment-and-failure-reason-enums.md.

-- 1. Extend commitment_level with 'maybe' (between 'idea' and 'planned').
do $$
begin
  if not exists (select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
                  where t.typname = 'commitment_level' and e.enumlabel = 'maybe') then
    alter type commitment_level add value 'maybe' before 'planned';
  end if;
end $$;

-- 2. goals.family_critical
alter table public.goals
  add column if not exists family_critical boolean not null default false;

create index if not exists goals_family_critical_idx
  on public.goals(user_id, family_critical)
  where family_critical = true;

-- 3. goal_failure_reason enum + migrate goal_completions.reason
do $$
begin
  if not exists (select 1 from pg_type where typname = 'goal_failure_reason') then
    create type public.goal_failure_reason as enum (
      'forgot', 'tired', 'avoided', 'overplanned',
      'no_time', 'blocked', 'wrong_time', 'too_big', 'not_important_anymore'
    );
  end if;
end $$;

do $$
declare v_type text;
begin
  select udt_name into v_type from information_schema.columns
   where table_schema = 'public' and table_name = 'goal_completions' and column_name = 'reason';
  if v_type = 'text' then
    alter table public.goal_completions add column if not exists reason_v2 public.goal_failure_reason;
    update public.goal_completions set reason_v2 = case
      when reason is null                        then null
      when reason ilike 'forgot'                 then 'forgot'::public.goal_failure_reason
      when reason ilike 'tired%'                 then 'tired'::public.goal_failure_reason
      when reason ilike 'too tired%'             then 'tired'::public.goal_failure_reason
      when reason ilike 'avoid%'                 then 'avoided'::public.goal_failure_reason
      when reason ilike 'overplan%'              then 'overplanned'::public.goal_failure_reason
      when reason ilike 'no_time'                then 'no_time'::public.goal_failure_reason
      when reason ilike 'no time%'               then 'no_time'::public.goal_failure_reason
      when reason ilike '%blocked%'              then 'blocked'::public.goal_failure_reason
      when reason ilike 'wrong_time'             then 'wrong_time'::public.goal_failure_reason
      when reason ilike 'wrong time%'            then 'wrong_time'::public.goal_failure_reason
      when reason ilike 'too_big'                then 'too_big'::public.goal_failure_reason
      when reason ilike 'too big%'               then 'too_big'::public.goal_failure_reason
      when reason ilike 'not_important%'         then 'not_important_anymore'::public.goal_failure_reason
      when reason ilike 'not important%'         then 'not_important_anymore'::public.goal_failure_reason
      else null
    end;
    alter table public.goal_completions drop column reason;
    alter table public.goal_completions rename column reason_v2 to reason;
  end if;
end $$;
