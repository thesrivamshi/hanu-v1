-- Migration: PRD permission tiers 0-4.
-- Per tasks/08-permission-tiers.md.

alter table public.people
  add column if not exists permission_tier smallint not null default 0;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'people_permission_tier_range') then
    alter table public.people
      add constraint people_permission_tier_range check (permission_tier between 0 and 4);
  end if;
end $$;

create index if not exists people_tier_idx on public.people(user_id, permission_tier);

-- Seed tier capabilities (data, not code; change tier semantics without migrations).
create table if not exists public.tier_capabilities (
  tier        smallint not null check (tier between 0 and 4),
  capability  text not null,
  primary key (tier, capability)
);

insert into public.tier_capabilities (tier, capability) values
  -- Tier 1: can send requests to the user
  (1, 'send_request_to_user'),

  -- Tier 2: shared tasks/reminders (inherits tier-1 grants)
  (2, 'send_request_to_user'),
  (2, 'create_shared_task'),
  (2, 'mark_shared_task_done'),

  -- Tier 3: limited status (inherits tier-2)
  (3, 'send_request_to_user'),
  (3, 'create_shared_task'),
  (3, 'mark_shared_task_done'),
  (3, 'ask_availability'),
  (3, 'ask_shared_task_state'),

  -- Tier 4: shared-space co-manager (inherits tier-3)
  (4, 'send_request_to_user'),
  (4, 'create_shared_task'),
  (4, 'mark_shared_task_done'),
  (4, 'ask_availability'),
  (4, 'ask_shared_task_state'),
  (4, 'manage_shared_routines'),
  (4, 'manage_shared_appointments'),
  (4, 'see_shared_space_activity')
on conflict (tier, capability) do nothing;

-- has_capability(person_id, capability): tier baseline + explicit override.
create or replace function public.has_capability(p_person_id uuid, p_capability text)
returns boolean
language plpgsql
stable
security definer
as $$
declare
  v_tier smallint;
  v_tier_grant boolean;
  v_explicit boolean;
begin
  select permission_tier into v_tier from public.people where id = p_person_id;
  if v_tier is null then
    return false;
  end if;

  v_tier_grant := exists (
    select 1 from public.tier_capabilities
     where tier = v_tier and capability = p_capability
  );

  select granted into v_explicit
    from public.permissions
   where person_id = p_person_id and capability = p_capability
   limit 1;

  if v_explicit is not null then
    return v_explicit;
  end if;

  return v_tier_grant;
end $$;

grant execute on function public.has_capability(uuid, text) to service_role, authenticated;
