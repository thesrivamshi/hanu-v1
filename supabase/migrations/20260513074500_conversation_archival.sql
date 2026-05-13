-- Migration: conversation archival.
-- Per tasks/25-conversation-archival.md.

create table if not exists public.messages_archive (
  id              uuid primary key,
  conversation_id uuid not null,
  user_id         uuid not null,
  role            text not null,
  content         text not null,
  raw_payload     jsonb,
  channel_message_id text,
  archived_at     timestamptz not null default now(),
  created_at      timestamptz not null
);

create index if not exists messages_archive_user_time_idx
  on public.messages_archive(user_id, created_at desc);

alter table public.messages_archive enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'messages_archive'
       and policyname = 'messages_archive: owner select'
  ) then
    create policy "messages_archive: owner select"
      on public.messages_archive for select using (auth.uid() = user_id);
  end if;
end $$;

alter table public.settings
  add column if not exists archive_after_days integer not null default 365;

create or replace function public.archive_old_messages(p_user_id uuid)
returns integer
language plpgsql
security definer
as $$
declare
  v_cutoff timestamptz;
  v_days integer;
  v_moved integer;
begin
  select archive_after_days into v_days from public.settings where user_id = p_user_id;
  if v_days is null or v_days <= 0 then
    return 0;
  end if;
  v_cutoff := now() - (v_days || ' days')::interval;

  with moved as (
    delete from public.messages
     where user_id = p_user_id and created_at < v_cutoff
    returning id, conversation_id, user_id, role, content, raw_payload,
              channel_message_id, created_at
  )
  insert into public.messages_archive (
    id, conversation_id, user_id, role, content, raw_payload,
    channel_message_id, created_at
  )
  select * from moved;

  get diagnostics v_moved = row_count;
  return v_moved;
end $$;
