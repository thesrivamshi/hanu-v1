-- Migration: compiled_truth + timeline events shape on memories.
-- Per tasks/26-compiled-truth-timeline-memory.md.

alter table public.memories
  add column if not exists compiled_truth text;

update public.memories
   set compiled_truth = text
 where compiled_truth is null;

create table if not exists public.memory_timeline_events (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references public.profiles(id) on delete cascade,
  memory_id         uuid not null references public.memories(id) on delete cascade,
  on_date           date not null default current_date,
  event_text        text not null,
  source_message_id uuid references public.messages(id) on delete set null,
  created_at        timestamptz not null default now()
);

create index if not exists memory_timeline_memory_idx
  on public.memory_timeline_events(memory_id, on_date desc);

alter table public.memory_timeline_events enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public'
                  and tablename='memory_timeline_events'
                  and policyname='memory_timeline_owner') then
    create policy memory_timeline_owner on public.memory_timeline_events
      using (user_id = auth.uid()) with check (user_id = auth.uid());
  end if;
end $$;
