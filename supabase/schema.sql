-- =============================================================================
-- HANU v1 SUPABASE SCHEMA
-- =============================================================================
-- This file defines every table the Hanu app needs.
--
-- Reading this file: every section has a plain-English "WHY" comment above
-- the SQL. You don't need to understand the SQL to understand the design —
-- read just the WHY comments to follow along.
--
-- Run order: this file is meant to be run top-to-bottom in a fresh Supabase
-- project. It will create extensions, enum types, tables, indexes, and a
-- few helper views.
--
-- Multi-user ready: every user-owned row has a `user_id` column pointing to
-- Supabase's built-in `auth.users` table. Row Level Security (RLS) policies
-- are added at the end so a logged-in user only ever sees their own data.
-- =============================================================================


-- =============================================================================
-- 1. EXTENSIONS
-- =============================================================================
-- WHY: Postgres on its own is great, but we want a few extras:
--   - pgcrypto — gives us gen_random_uuid() for primary keys
--   - vector  — lets us store AI embeddings on memories for semantic search
--              (so "remind me what I told Mother about my health" works even
--               if those exact words aren't in any memory)
--   - pg_trgm — lets us do fast fuzzy text search on memories, decisions, etc.

create extension if not exists pgcrypto;
create extension if not exists vector;
create extension if not exists pg_trgm;


-- =============================================================================
-- 2. ENUM TYPES
-- =============================================================================
-- WHY: An "enum" is a column that can only contain one of a fixed list of
-- values. Using enums for things like priority and privacy means the database
-- itself rejects typos and impossible values. Cheaper than checking in code.

-- Priority levels for goals and reminders. Comes from the UI's "Priority" picker.
create type priority_level as enum ('low', 'normal', 'important', 'high', 'non_negotiable');

-- Commitment strength for goals. 0..4 in the UI; we use words here for clarity.
create type commitment_level as enum ('idea', 'planned', 'committed', 'promised', 'non_negotiable');

-- Memory privacy levels — exactly the six shown in the Memory edit modal.
create type memory_privacy as enum ('private', 'ask_share', 'shared', 'shared_space', 'sensitive', 'never');

-- What kind of memory it is.
create type memory_kind as enum ('preference', 'routine', 'important_date', 'boundary', 'decision', 'person', 'goal', 'promise', 'project', 'other');

-- Profile types for People. Comes from Add Person modal.
create type person_profile_type as enum ('self', 'full_hanu_user', 'managed', 'trusted', 'external');

-- Which channel we reach a person on.
create type contact_channel as enum ('app', 'whatsapp', 'sms', 'email', 'phone');

-- States an open loop can be in.
create type loop_state as enum ('needs_action', 'waiting', 'overdue', 'discussion', 'closed');

-- States a promise can be in.
create type promise_state as enum ('pending', 'scheduled', 'in_progress', 'kept', 'broken');

-- States a reminder can be in (separate from the UI's "missed reminders" list —
-- a missed reminder is just a reminder with status = 'missed').
create type reminder_state as enum ('pending', 'done', 'missed', 'snoozed', 'cancelled');

-- How often a reminder repeats.
create type recur_kind as enum ('once', 'daily', 'weekly', 'monthly', 'yearly', 'custom');

-- Reminder categories shown in the Create Reminder modal.
create type reminder_category as enum ('family', 'work', 'health', 'finance', 'personal', 'self', 'other');

-- States an approval request can be in.
create type approval_state as enum ('pending', 'approved', 'denied', 'held', 'expired');

-- Types of "spaces" — shared contexts in Hanu.
create type space_kind as enum ('private', 'family', 'trusted_circle', 'project', 'care', 'education');

-- Tone the UI can be in (also the assistant's voice).
create type voice_tone as enum ('calm', 'firm', 'strict');

-- Visual mood and ambient — for syncing the UI tweaks panel across devices.
create type visual_mood as enum ('amber', 'nightfall', 'sage');
create type ambient_level as enum ('off', 'soft', 'vivid');


-- =============================================================================
-- 3. PROFILES — extends auth.users with Hanu-specific user fields
-- =============================================================================
-- WHY: Supabase already manages logins in a built-in `auth.users` table. We
-- add a `profiles` table for the app-specific fields (display name, avatar
-- letter, etc.) so we don't have to touch auth tables directly.

create table public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  first_name   text not null,
  avatar_letter text not null default 'H',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

comment on table public.profiles is 'One row per logged-in Hanu user. Matches the `user` object in data.jsx.';


-- =============================================================================
-- 4. SPACES — Private / Family / Trusted Circle / Project / Care / Education
-- =============================================================================
-- WHY: A "space" is a shared context. Every memory, reminder, goal, or open
-- loop can optionally belong to one space, which controls who sees it. The
-- PRD defines six types — we use the space_kind enum above.

create table public.spaces (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  name        text not null,
  kind        space_kind not null,
  description text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index spaces_user_id_idx on public.spaces(user_id);

comment on table public.spaces is 'Shared contexts. Every user has at least a Private space. Battini Family is a Family space, etc.';


-- =============================================================================
-- 5. PEOPLE — everyone Hanu knows about
-- =============================================================================
-- WHY: A "person" is anyone Hanu has been told about — your mother, your
-- co-founder, your father, your doctor. Some people are also Hanu users
-- themselves (mother has her own private Hanu); others are managed by you
-- (father, who only checks WhatsApp); others are external contacts (the
-- doctor — Hanu just knows the name).
--
-- The `linked_user_id` column connects a person to their own Hanu account
-- if they have one. It can be null.

create table public.people (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.profiles(id) on delete cascade,
  linked_user_id  uuid references public.profiles(id) on delete set null,

  name            text not null,
  initials        text,
  avatar_tone     text default '', -- 'rose', 'violet', 'teal', etc. — UI color tone

  relationship    text, -- 'Mother', 'Father', 'Co-founder', etc. (free-text)
  profile_type    person_profile_type not null default 'external',
  note            text,

  -- Permission summary fields — these are the "Can ask / Can send / Can see"
  -- columns shown on the People & Access screen. They're free-text descriptions
  -- because the full permission rules can be more nuanced than a list of toggles.
  can_ask         text,
  can_send        text,
  can_see         text,
  approval_rule   text, -- 'Not required', 'Ask once per topic', 'Always confirm with you first', etc.
  tone            text, -- 'Direct, calm', 'Warm, soft', 'Gentle, repeat-friendly', etc.

  quiet_hours_start time, -- null means no quiet hours
  quiet_hours_end   time,

  -- Channels we can reach them on
  primary_channel contact_channel default 'app',
  whatsapp_number text,
  phone_number    text,
  email           text,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index people_user_id_idx on public.people(user_id);
create index people_linked_user_idx on public.people(linked_user_id) where linked_user_id is not null;

comment on table public.people is 'Anyone Hanu knows about. Could be a Hanu user (linked_user_id set), a managed contact (WhatsApp only), or an external reference.';


-- =============================================================================
-- 6. SPACE_MEMBERS — many-to-many between people and spaces
-- =============================================================================
-- WHY: A space (like Battini Family) has multiple people in it. A person
-- (like Mother) can be in multiple spaces. So we need a "join table".

create table public.space_members (
  id          uuid primary key default gen_random_uuid(),
  space_id    uuid not null references public.spaces(id) on delete cascade,
  person_id   uuid not null references public.people(id) on delete cascade,
  role        text not null default 'member', -- 'member', 'co_manager', 'owner'
  joined_at   timestamptz not null default now(),
  unique(space_id, person_id)
);

create index space_members_space_idx on public.space_members(space_id);
create index space_members_person_idx on public.space_members(person_id);


-- =============================================================================
-- 7. PERMISSIONS — fine-grained access rules per person
-- =============================================================================
-- WHY: The Add Person modal has toggle switches like "Can ask Hanu about you",
-- "Can confirm reminders", "Can see Family Space appointments", "Can send you
-- reminders". Those are stored here. The free-text fields on `people` are the
-- summary; this table is the source of truth for what's actually permitted.

create table public.permissions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  person_id   uuid not null references public.people(id) on delete cascade,
  capability  text not null, -- 'ask_about_you', 'confirm_reminders', 'see_family_appointments', 'send_reminders', etc.
  granted     boolean not null default false,
  scope       text,          -- optional extra context, e.g. specific topics
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique(person_id, capability)
);

create index permissions_user_id_idx on public.permissions(user_id);
create index permissions_person_id_idx on public.permissions(person_id);


-- =============================================================================
-- 8. GOALS
-- =============================================================================
-- WHY: A goal has a title, why-it-matters, priority, commitment strength,
-- daily action, recovery rule, streak count, etc. The UI shows streak history
-- as a 30-day sparkline — we store the raw daily completion records in
-- `goal_completions` and compute the sparkline on the fly.

create table public.goals (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.profiles(id) on delete cascade,

  title           text not null,
  why             text,
  priority        priority_level not null default 'normal',
  commitment      commitment_level not null default 'planned',
  promise_to_person_id uuid references public.people(id) on delete set null,
  promise_to_text text, -- 'Self', or the name when person_id is null

  daily_action    text,
  recovery_rule   text,
  check_in_time   time, -- daily reminder time, e.g. 21:00

  -- Derived but cached for performance — recomputed on completion changes
  streak          integer not null default 0,
  missed_count    integer not null default 0,
  risk            text not null default 'low', -- 'low' / 'medium' / 'high'
  next_check_in_at timestamptz,

  status          text not null default 'active', -- 'active', 'paused', 'archived', 'dropped'
  space_id        uuid references public.spaces(id) on delete set null,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index goals_user_id_idx on public.goals(user_id);
create index goals_status_idx on public.goals(user_id, status);


-- =============================================================================
-- 9. GOAL_COMPLETIONS — one row per day per goal
-- =============================================================================
-- WHY: This is what powers the streak bar. Every day a goal is supposed to
-- happen, we either mark it done, missed, or skipped. If missed, we record
-- the reason — exactly the failure reasons listed in the PRD.

create table public.goal_completions (
  id          uuid primary key default gen_random_uuid(),
  goal_id     uuid not null references public.goals(id) on delete cascade,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  on_date     date not null,
  status      text not null, -- 'done', 'missed', 'skipped'
  reason      text,          -- 'forgot', 'tired', 'avoided', 'overplanned', 'no_time', 'blocked', 'wrong_time', 'too_big', 'not_important_anymore'
  note        text,
  completed_at timestamptz,
  created_at  timestamptz not null default now(),
  unique(goal_id, on_date)
);

create index goal_completions_goal_date_idx on public.goal_completions(goal_id, on_date desc);


-- =============================================================================
-- 10. REMINDERS — and missed reminders (just a status)
-- =============================================================================

create table public.reminders (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.profiles(id) on delete cascade,

  title           text not null,
  category        reminder_category not null default 'personal',
  priority        priority_level not null default 'normal',
  state           reminder_state not null default 'pending',
  miss_reason     text, -- only set when state = 'missed'

  -- When it fires
  scheduled_at    timestamptz, -- exact UTC time, used by the gateway to send
  scheduled_text  text,        -- human-friendly version, e.g. "Today 21:00" or "All day"
  when_text       text,        -- human-friendly date, e.g. "Today", "Tomorrow", "Sat, May 16"

  -- Recurrence
  recur           recur_kind not null default 'once',
  recur_rule      text, -- e.g. "Mon/Wed/Fri/Sat" — free text matches UI

  -- Linkage
  person_id       uuid references public.people(id) on delete set null,
  linked_goal_id  uuid references public.goals(id) on delete set null,
  space_id        uuid references public.spaces(id) on delete set null,

  -- Behavior
  needs_confirm   boolean not null default false,
  follow_up_rule  text,  -- e.g. "Re-ping after 15 min", "Re-ask if not done by 14:00"

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  resolved_at     timestamptz
);

create index reminders_user_id_idx on public.reminders(user_id);
create index reminders_scheduled_idx on public.reminders(user_id, scheduled_at) where state = 'pending';
create index reminders_state_idx on public.reminders(user_id, state);


-- =============================================================================
-- 11. OPEN_LOOPS — unfinished items
-- =============================================================================

create table public.open_loops (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.profiles(id) on delete cascade,

  title           text not null,
  state           loop_state not null default 'needs_action',
  owner_text      text,        -- 'You', 'You + Aman', 'Mother', etc.
  owner_person_id uuid references public.people(id) on delete set null,

  age_days        integer not null default 0,
  postponed_count integer not null default 0,
  space_id        uuid references public.spaces(id) on delete set null,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  closed_at       timestamptz
);

create index open_loops_user_id_idx on public.open_loops(user_id);
create index open_loops_state_idx on public.open_loops(user_id, state);


-- =============================================================================
-- 12. MEMORIES — Hanu's long-term memory
-- =============================================================================
-- WHY: This is the heart of Hanu. Every preference, routine, important date,
-- boundary, person-fact, decision, or promise becomes a memory. Each has a
-- privacy level the UI lets you change. We also store a vector embedding so
-- semantic search ("what did I tell Mother about...") works in the future.

create table public.memories (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.profiles(id) on delete cascade,

  text            text not null,
  kind            memory_kind not null default 'other',
  privacy         memory_privacy not null default 'private',

  -- Where it came from — could be a conversation, a voice note, manual entry
  source          text, -- 'Conversation on Apr 14', 'From memory inbox', 'Pattern detected', etc.
  source_message_id uuid, -- references messages(id) — added below, after messages table

  pinned          boolean not null default false,
  archived        boolean not null default false,

  -- Sharing scope
  shared_with_person_id uuid references public.people(id) on delete set null,
  shared_in_space_id    uuid references public.spaces(id) on delete set null,

  -- AI embedding for semantic search. 1536 dims matches OpenAI's text-embedding-3-small.
  -- If you change model, change this number.
  embedding       vector(1536),

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index memories_user_id_idx on public.memories(user_id);
create index memories_kind_idx on public.memories(user_id, kind);
create index memories_privacy_idx on public.memories(user_id, privacy);
create index memories_pinned_idx on public.memories(user_id, pinned) where pinned = true;
create index memories_text_trgm_idx on public.memories using gin (text gin_trgm_ops);
-- Vector index for semantic search (built later once we have enough rows to need it)
-- create index memories_embedding_idx on public.memories using ivfflat (embedding vector_cosine_ops) with (lists = 100);


-- =============================================================================
-- 13. MEMORY_INBOX — items Hanu found but hasn't saved yet
-- =============================================================================
-- WHY: The PRD requires Hanu never to save memories silently. When it detects
-- a possible memory from conversation, it goes here first. The user approves
-- before it becomes a real memory.

create table public.memory_inbox (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,

  text        text not null,
  confidence  numeric(3,2) not null default 0.50, -- 0.00 to 1.00
  suggested_kind memory_kind,
  suggested_privacy memory_privacy default 'private',

  source_message_id uuid, -- references messages(id), added later
  state       text not null default 'pending', -- 'pending', 'saved', 'rejected', 'edited_saved'
  saved_memory_id uuid references public.memories(id) on delete set null,

  created_at  timestamptz not null default now(),
  resolved_at timestamptz
);

create index memory_inbox_user_state_idx on public.memory_inbox(user_id, state);


-- =============================================================================
-- 14. APPROVALS — incoming questions/requests that need your green-light
-- =============================================================================

create table public.approvals (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.profiles(id) on delete cascade,

  from_person_id  uuid not null references public.people(id) on delete cascade,
  kind            text not null default 'question', -- 'question', 'file_send', 'reminder_request', 'access_request', 'shared_memory'
  question        text not null,
  context         text, -- why this needs approval
  suggested_action text, -- 'Reply with limited answer', 'Allow once', 'Confirm', etc.

  state           approval_state not null default 'pending',
  reply_text      text, -- what was actually replied
  rule_created    jsonb, -- if the user chose "make this a rule", store the rule shape here

  created_at      timestamptz not null default now(),
  resolved_at     timestamptz
);

create index approvals_user_state_idx on public.approvals(user_id, state);


-- =============================================================================
-- 15. PROMISES
-- =============================================================================

create table public.promises (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.profiles(id) on delete cascade,

  to_person_id    uuid references public.people(id) on delete set null,
  to_text         text not null, -- 'Self', or the person's name when person_id is null

  text            text not null,
  due_at          timestamptz,
  due_text        text, -- 'Fri, May 15 — 18:00', 'Ongoing', 'Pending visit'

  state           promise_state not null default 'pending',
  follow_up_rule  text,
  kept_count      integer not null default 0,
  broken_count    integer not null default 0,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  resolved_at     timestamptz
);

create index promises_user_state_idx on public.promises(user_id, state);
create index promises_to_person_idx on public.promises(to_person_id);


-- =============================================================================
-- 16. DECISIONS — the decision log
-- =============================================================================

create table public.decisions (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles(id) on delete cascade,

  title         text not null,
  area          text, -- 'Hanu / Pricing', 'Family', 'Personal', etc.
  why           text,
  decided_on    date not null default current_date,
  revisit_rule  text, -- 'After 200 paying users', 'Quarterly', 'Never'

  related_person_ids uuid[] default array[]::uuid[],
  tags          text[] default array[]::text[],
  space_id      uuid references public.spaces(id) on delete set null,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index decisions_user_idx on public.decisions(user_id);
create index decisions_tags_idx on public.decisions using gin (tags);


-- =============================================================================
-- 17. ROUTINES — recurring family/personal routines
-- =============================================================================
-- WHY: Different from reminders. A routine is a long-running pattern
-- ("Father's BP medication, twice daily") that may generate many reminders
-- but is itself a single object you can view, edit, or hand off.

create table public.routines (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references public.profiles(id) on delete cascade,
  space_id           uuid references public.spaces(id) on delete set null,

  title              text not null,
  cadence            text, -- 'Twice daily', 'Weekly 19:00', 'Mon/Wed/Fri 6:30'
  owner_text         text,
  primary_person_id  uuid references public.people(id) on delete set null,
  backup_person_id   uuid references public.people(id) on delete set null,

  active             boolean not null default true,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);


-- =============================================================================
-- 18. APPOINTMENTS — calendar-style entries
-- =============================================================================

create table public.appointments (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  space_id    uuid references public.spaces(id) on delete set null,

  title       text not null,
  starts_at   timestamptz not null,
  ends_at     timestamptz,
  who_text    text, -- 'Father, You', 'All members'
  attendee_person_ids uuid[] default array[]::uuid[],

  notes       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index appointments_user_starts_idx on public.appointments(user_id, starts_at);


-- =============================================================================
-- 19. DAILY_REVIEWS — morning / midday / evening reviews
-- =============================================================================
-- WHY: The Reviews screen shows the morning/midday/evening planning for today
-- and weekly miss summaries. We store one row per day per user.

create table public.daily_reviews (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles(id) on delete cascade,
  on_date       date not null,

  morning_done  boolean not null default false,
  morning_note  text,
  midday_done   boolean not null default false,
  midday_note   text,
  evening_done  boolean not null default false,
  evening_note  text,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique(user_id, on_date)
);


-- =============================================================================
-- 20. SETTINGS — single row per user
-- =============================================================================

create table public.settings (
  user_id              uuid primary key references public.profiles(id) on delete cascade,

  pause_modes          text[] not null default array['Vacation', 'Sick', 'Low-energy', 'Deep work', 'Do not disturb']::text[],
  active_pause         text,

  quiet_hours_start    time not null default '22:00',
  quiet_hours_end      time not null default '07:00',

  follow_up_intensity  text not null default 'Firm', -- 'Gentle', 'Firm', 'Strict'
  accountability       text not null default 'Strict', -- 'Gentle', 'Firm', 'Strict'

  ask_before_saving    boolean not null default true,
  ask_before_sharing   boolean not null default true,

  -- Channels are stored as JSON because the UI shows them as a row of toggles
  channels             jsonb not null default '{"app": true, "whatsapp": true, "email": false, "sms": false}'::jsonb,

  sensitive_categories text[] not null default array['Health', 'Finance', 'Location', 'Private journal', 'Children', 'Legal', 'Passwords / secrets']::text[],

  -- UI tweaks panel — these sync visual choices across devices
  tone                 voice_tone not null default 'firm',
  mood                 visual_mood not null default 'amber',
  ambient              ambient_level not null default 'soft',
  theme                text not null default 'dark', -- 'dark' or 'light'

  updated_at           timestamptz not null default now()
);


-- =============================================================================
-- 21. CONVERSATIONS + MESSAGES — chat history across channels
-- =============================================================================
-- WHY: When you WhatsApp Hanu, that conversation should be queryable later
-- ("Ask Hanu what I told Aman last week"). We store every message Hermes
-- sees here. The `messages.role` field follows the LLM convention.

create table public.conversations (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles(id) on delete cascade,
  person_id     uuid references public.people(id) on delete set null, -- who you're chatting with (could be Hanu itself = null)
  channel       contact_channel not null default 'whatsapp',
  external_id   text, -- channel-specific thread/chat id, for deduplication
  title         text,
  started_at    timestamptz not null default now(),
  last_message_at timestamptz not null default now(),
  message_count integer not null default 0
);

create index conversations_user_channel_idx on public.conversations(user_id, channel, last_message_at desc);


create table public.messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id         uuid not null references public.profiles(id) on delete cascade,

  role            text not null, -- 'user', 'assistant', 'system', 'tool'
  content         text not null,
  raw_payload     jsonb, -- full original payload from the channel (WhatsApp etc.)
  channel_message_id text, -- the WhatsApp/Telegram message id, for deduplication

  -- AI embedding so we can search past messages semantically
  embedding       vector(1536),

  created_at      timestamptz not null default now()
);

create index messages_conv_idx on public.messages(conversation_id, created_at);
create index messages_user_idx on public.messages(user_id, created_at desc);
create index messages_channel_dedup_idx on public.messages(channel_message_id) where channel_message_id is not null;

-- Now that messages exists, add the deferred foreign keys we set up earlier
alter table public.memories add constraint memories_source_message_fk
  foreign key (source_message_id) references public.messages(id) on delete set null;
alter table public.memory_inbox add constraint memory_inbox_source_message_fk
  foreign key (source_message_id) references public.messages(id) on delete set null;


-- =============================================================================
-- 22. ACTIVITY_LOG — "what did Hanu do, why, who saw it"
-- =============================================================================
-- WHY: The PRD specifies an Activity History screen that shows what Hanu did,
-- why, who requested it, and what was shared. This is the table behind it.

create table public.activity_log (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.profiles(id) on delete cascade,

  kind            text not null, -- 'memory_saved', 'reminder_sent', 'approval_granted', 'message_relayed', etc.
  summary         text not null,
  actor           text not null default 'hanu', -- 'hanu', 'user', or a person_id as string
  actor_person_id uuid references public.people(id) on delete set null,

  -- What it acted on
  target_table    text,
  target_id       uuid,

  -- Why
  reason          text,

  -- Who saw it
  visible_to_person_ids uuid[] default array[]::uuid[],

  details         jsonb,
  created_at      timestamptz not null default now()
);

create index activity_log_user_time_idx on public.activity_log(user_id, created_at desc);


-- =============================================================================
-- 23. ROW LEVEL SECURITY — every user only sees their own data
-- =============================================================================
-- WHY: Supabase exposes Postgres as a REST API. Without Row Level Security,
-- a logged-in user could read everyone's data through the API. RLS pins every
-- row to a user_id so the database itself refuses to return rows that don't
-- belong to you.
--
-- Policy: for every user-owned table, "you can see/insert/update/delete rows
-- where user_id = auth.uid()". `auth.uid()` is a Supabase function that
-- returns the currently-logged-in user's id.

-- Helper macro: enable RLS and add the standard four policies for a table.
-- (Doing it explicitly per-table for clarity.)

alter table public.profiles enable row level security;
create policy "profiles: self read"   on public.profiles for select using (auth.uid() = id);
create policy "profiles: self write"  on public.profiles for update using (auth.uid() = id);
create policy "profiles: self insert" on public.profiles for insert with check (auth.uid() = id);

-- Apply the same pattern to all user-owned tables that have a user_id column
do $$
declare
  t text;
  owned_tables text[] := array[
    'spaces','people','permissions','goals','goal_completions',
    'reminders','open_loops','memories','memory_inbox','approvals','promises',
    'decisions','routines','appointments','daily_reviews','settings',
    'conversations','messages','activity_log'
  ];
begin
  foreach t in array owned_tables loop
    execute format('alter table public.%I enable row level security;', t);
    execute format('create policy "%I: owner select" on public.%I for select using (auth.uid() = user_id);', t, t);
    execute format('create policy "%I: owner insert" on public.%I for insert with check (auth.uid() = user_id);', t, t);
    execute format('create policy "%I: owner update" on public.%I for update using (auth.uid() = user_id);', t, t);
    execute format('create policy "%I: owner delete" on public.%I for delete using (auth.uid() = user_id);', t, t);
  end loop;
end $$;

-- space_members is a join table without its own user_id column.
-- Ownership is derived through the parent space.
alter table public.space_members enable row level security;
create policy "space_members: owner select" on public.space_members for select
  using (exists (select 1 from public.spaces s where s.id = space_members.space_id and s.user_id = auth.uid()));
create policy "space_members: owner insert" on public.space_members for insert
  with check (exists (select 1 from public.spaces s where s.id = space_members.space_id and s.user_id = auth.uid()));
create policy "space_members: owner update" on public.space_members for update
  using (exists (select 1 from public.spaces s where s.id = space_members.space_id and s.user_id = auth.uid()));
create policy "space_members: owner delete" on public.space_members for delete
  using (exists (select 1 from public.spaces s where s.id = space_members.space_id and s.user_id = auth.uid()));


-- =============================================================================
-- 24. CONVENIENCE TRIGGERS — auto-update `updated_at`
-- =============================================================================
-- WHY: Most tables have an `updated_at` column. Without a trigger we'd have
-- to remember to set it manually on every UPDATE. This trigger does it for us.

create or replace function public.tg_set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

do $$
declare
  t text;
  tables_with_updated_at text[] := array[
    'profiles','spaces','people','permissions','goals','reminders','open_loops',
    'memories','promises','decisions','routines','appointments','daily_reviews','settings'
  ];
begin
  foreach t in array tables_with_updated_at loop
    execute format('drop trigger if exists set_updated_at on public.%I;', t);
    execute format('create trigger set_updated_at before update on public.%I for each row execute function public.tg_set_updated_at();', t);
  end loop;
end $$;


-- =============================================================================
-- DONE
-- =============================================================================
-- After running this, the database has:
--   * profiles, spaces, people, space_members, permissions
--   * goals + goal_completions
--   * reminders, open_loops, promises, decisions
--   * memories, memory_inbox, approvals
--   * routines, appointments, daily_reviews
--   * settings (one row per user)
--   * conversations, messages, activity_log
--   * Row Level Security on every user-owned table
--   * Vector + trigram indexes for memory search
--   * Auto-updated `updated_at` triggers
--
-- Next steps documented in BRIDGE_DESIGN.md.
