-- Migration: conflicts table for shared-responsibility disagreements.
-- Per tasks/10-conflict-handling.md.

do $$
begin
  if not exists (select 1 from pg_type where typname = 'conflict_state') then
    create type public.conflict_state as enum ('open', 'resolved', 'dismissed');
  end if;
end $$;

create table if not exists public.conflicts (
  id                       uuid primary key default gen_random_uuid(),
  user_id                  uuid not null references public.profiles(id) on delete cascade,
  target_table             text not null,
  target_id                uuid not null,
  party_person_ids         uuid[] not null,
  description              text not null,
  proposed_resolver_id     uuid references public.people(id) on delete set null,
  state                    public.conflict_state not null default 'open',
  resolution               text,
  resolved_by_person_id    uuid references public.people(id) on delete set null,
  created_at               timestamptz not null default now(),
  resolved_at              timestamptz
);

create index if not exists conflicts_user_state_idx on public.conflicts(user_id, state);
create index if not exists conflicts_target_idx on public.conflicts(target_table, target_id);

alter table public.conflicts enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'conflicts' and policyname = 'conflicts: owner select') then
    create policy "conflicts: owner select" on public.conflicts for select using (auth.uid() = user_id);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'conflicts' and policyname = 'conflicts: owner insert') then
    create policy "conflicts: owner insert" on public.conflicts for insert with check (auth.uid() = user_id);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'conflicts' and policyname = 'conflicts: owner update') then
    create policy "conflicts: owner update" on public.conflicts for update using (auth.uid() = user_id);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'conflicts' and policyname = 'conflicts: owner delete') then
    create policy "conflicts: owner delete" on public.conflicts for delete using (auth.uid() = user_id);
  end if;
end $$;
