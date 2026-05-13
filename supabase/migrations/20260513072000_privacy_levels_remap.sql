-- Migration: memory_privacy 6→5 values + memories.sensitive_category.
-- Per tasks/07-privacy-levels-remap.md.
--
-- The old enum had two values collapsing to the PRD's "Never share / sensitive"
-- level: `sensitive` and `never`. The new enum unifies them as `never_share`,
-- and sensitivity (Health, Finance, etc.) becomes a separate
-- `memories.sensitive_category text` column.
--
-- Mapping:
--   private      -> private
--   ask_share    -> ask_share
--   shared       -> shared_with_person
--   shared_space -> shared_in_space
--   sensitive    -> never_share (sensitive_category populated by hand later)
--   never        -> never_share

create type public.memory_privacy_v2 as enum (
  'private', 'ask_share', 'shared_with_person', 'shared_in_space', 'never_share'
);

-- memories
alter table public.memories add column privacy_v2 public.memory_privacy_v2;
update public.memories set privacy_v2 = case privacy
  when 'private'      then 'private'::public.memory_privacy_v2
  when 'ask_share'    then 'ask_share'::public.memory_privacy_v2
  when 'shared'       then 'shared_with_person'::public.memory_privacy_v2
  when 'shared_space' then 'shared_in_space'::public.memory_privacy_v2
  when 'sensitive'    then 'never_share'::public.memory_privacy_v2
  when 'never'        then 'never_share'::public.memory_privacy_v2
end;

drop index if exists memories_privacy_idx;
alter table public.memories drop column privacy;
alter table public.memories rename column privacy_v2 to privacy;
alter table public.memories alter column privacy set not null;
alter table public.memories alter column privacy set default 'private'::public.memory_privacy_v2;
create index memories_privacy_idx on public.memories(user_id, privacy);

-- memory_inbox.suggested_privacy
alter table public.memory_inbox add column suggested_privacy_v2 public.memory_privacy_v2;
update public.memory_inbox set suggested_privacy_v2 = case suggested_privacy
  when 'private'      then 'private'::public.memory_privacy_v2
  when 'ask_share'    then 'ask_share'::public.memory_privacy_v2
  when 'shared'       then 'shared_with_person'::public.memory_privacy_v2
  when 'shared_space' then 'shared_in_space'::public.memory_privacy_v2
  when 'sensitive'    then 'never_share'::public.memory_privacy_v2
  when 'never'        then 'never_share'::public.memory_privacy_v2
end;
alter table public.memory_inbox drop column suggested_privacy;
alter table public.memory_inbox rename column suggested_privacy_v2 to suggested_privacy;
alter table public.memory_inbox alter column suggested_privacy set default 'private'::public.memory_privacy_v2;

-- Swap enum names: drop old type, rename v2 to memory_privacy.
drop type public.memory_privacy;
alter type public.memory_privacy_v2 rename to memory_privacy;

-- Sensitive category (free text for v1; enum/lookup later).
alter table public.memories
  add column if not exists sensitive_category text;

create index if not exists memories_sensitive_idx
  on public.memories(user_id, sensitive_category)
  where sensitive_category is not null;
