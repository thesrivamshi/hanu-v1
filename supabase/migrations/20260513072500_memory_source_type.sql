-- Migration: add memory_source_type enum + memories.source_type column.
-- Per tasks/13-memory-source-provenance.md.

do $$
begin
  if not exists (select 1 from pg_type where typname = 'memory_source_type') then
    create type public.memory_source_type as enum (
      'conversation', 'voice_note', 'approved_inbox', 'pattern_detected', 'manual_entry', 'imported'
    );
  end if;
end $$;

alter table public.memories
  add column if not exists source_type public.memory_source_type not null default 'conversation';

-- Backfill heuristics for any pre-existing rows.
update public.memories set source_type = case
  when source ilike '%voice%' then 'voice_note'::public.memory_source_type
  when source ilike '%inbox%' then 'approved_inbox'::public.memory_source_type
  when source ilike '%pattern%' then 'pattern_detected'::public.memory_source_type
  when source ilike '%manual%' then 'manual_entry'::public.memory_source_type
  when source ilike '%import%' then 'imported'::public.memory_source_type
  else 'conversation'::public.memory_source_type
end
where source is not null and source_type = 'conversation';
