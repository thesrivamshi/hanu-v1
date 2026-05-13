# 14 — Schema tightening: enums, nullable approvals.from_person_id, FTS index

**Priority:** P2
**Effort:** 3-4 hours
**Depends on:** 02, 07, 09, 12, 13 (covers many small enum changes; bundling them lets you do one migration)
**Status:** TODO
**Risk if skipped:** several free-text status/state fields permit invalid values; the `approvals.from_person_id NOT NULL` constraint blocks legitimate "Hanu proactively asks the user" approvals; "Ask Hanu" full-text search is slow.

---

## Context

Loose ends from REVIEW_RESPONSE §5 not covered by the prior task files:

- `goal_completions.status text` should be enum (`done|missed|skipped`).
- `memory_inbox.state text` should be enum.
- `space_members.role text` should be enum.
- `approvals.from_person_id` is NOT NULL but the PRD allows Hanu-initiated approvals (asks for the user's confirmation about a save). Make it nullable.
- No FTS index on `messages`. `pg_trgm` exists for `memories.text` already.
- The advisory-lock RPC wrappers from task 05 belong here too.
- The `increment_message_count` trigger from task 02 already covers count maintenance.

---

## Acceptance criteria

- `goal_completion_status`, `memory_inbox_state`, `space_member_role` enums exist; corresponding columns use them.
- `approvals.from_person_id` is nullable; documentation in `BRIDGE_DESIGN.md` notes the null case = "Hanu-initiated".
- `messages` has a GIN trigram index on `content` (and `voice_transcript`, if task 11 is done).
- All free-text status/state columns across the schema have been audited; remaining ones are documented.

---

## Implementation steps

### Step 1 — `goal_completion_status`

Done if task 09 was applied. Otherwise:

```sql
create type goal_completion_status as enum ('done', 'missed', 'skipped');
alter table public.goal_completions add column status_v2 goal_completion_status;
update public.goal_completions set status_v2 = case status
  when 'done' then 'done'::goal_completion_status
  when 'missed' then 'missed'::goal_completion_status
  when 'skipped' then 'skipped'::goal_completion_status
end;
alter table public.goal_completions drop column status;
alter table public.goal_completions rename column status_v2 to status;
alter table public.goal_completions alter column status set not null;
```

### Step 2 — `memory_inbox_state`

```sql
create type memory_inbox_state as enum ('pending', 'saved', 'rejected', 'edited_saved');

alter table public.memory_inbox add column state_v2 memory_inbox_state;
update public.memory_inbox set state_v2 = case state
  when 'pending' then 'pending'::memory_inbox_state
  when 'saved' then 'saved'::memory_inbox_state
  when 'rejected' then 'rejected'::memory_inbox_state
  when 'edited_saved' then 'edited_saved'::memory_inbox_state
end;
alter table public.memory_inbox drop column state;
alter table public.memory_inbox rename column state_v2 to state;
alter table public.memory_inbox alter column state set not null;
alter table public.memory_inbox alter column state set default 'pending';
```

### Step 3 — `space_member_role`

```sql
create type space_member_role as enum ('member', 'co_manager', 'owner');

alter table public.space_members add column role_v2 space_member_role;
update public.space_members set role_v2 = case role
  when 'member' then 'member'::space_member_role
  when 'co_manager' then 'co_manager'::space_member_role
  when 'owner' then 'owner'::space_member_role
  else 'member'::space_member_role
end;
alter table public.space_members drop column role;
alter table public.space_members rename column role_v2 to role;
alter table public.space_members alter column role set not null;
alter table public.space_members alter column role set default 'member';
```

### Step 4 — Nullable `approvals.from_person_id`

```sql
alter table public.approvals
  alter column from_person_id drop not null;

-- Add a CHECK so we know a "system-initiated" approval has a clear marker:
alter table public.approvals
  add column if not exists from_actor text not null default 'person'
  check (from_actor in ('person', 'hanu_self', 'system'));

-- Hanu-initiated approvals set from_person_id = null AND from_actor = 'hanu_self'.
```

Backfill is trivial: all existing rows have `from_person_id IS NOT NULL`, so `from_actor='person'` is correct for them.

Update `hanu_request_approval` in `tools.py` to accept `from_actor` and a nullable `from_person_id`:

```python
def hanu_request_approval(
    question: str,
    context: str = "",
    suggested_action: str = "",
    kind: str = "question",
    from_person_id: Optional[str] = None,
    from_actor: str = "person",
) -> dict:
    ...
```

### Step 5 — FTS index on `messages`

```sql
-- Trigram index (matches the pattern used on memories.text)
create index if not exists messages_content_trgm_idx
  on public.messages using gin (content gin_trgm_ops);

-- If task 11 was applied:
create index if not exists messages_voice_transcript_trgm_idx
  on public.messages using gin (voice_transcript gin_trgm_ops)
  where voice_transcript is not null;
```

This lets the "Ask Hanu" search use `ILIKE '%query%'` over message content with a real index (rather than seq-scanning).

### Step 6 — Advisory-lock RPC wrappers (from task 05)

```sql
create or replace function public.pg_try_advisory_lock(key bigint)
returns boolean language sql security definer as $$ select pg_try_advisory_lock(key); $$;
create or replace function public.pg_advisory_unlock(key bigint)
returns boolean language sql security definer as $$ select pg_advisory_unlock(key); $$;
grant execute on function public.pg_try_advisory_lock(bigint) to service_role;
grant execute on function public.pg_advisory_unlock(bigint) to service_role;
```

### Step 7 — Documentation updates

In `BRIDGE_DESIGN.md`, add a section explicitly listing every status/state enum to keep the schema self-documenting:

```
## Enum Inventory

- priority_level: low|normal|important|high|non_negotiable
- commitment_level: idea|maybe|planned|committed|promised|non_negotiable
- memory_privacy: private|ask_share|shared_with_person|shared_in_space|never_share
- memory_kind: preference|routine|important_date|boundary|decision|person|goal|promise|project|other
- memory_source_type: conversation|voice_note|approved_inbox|pattern_detected|manual_entry|imported
- memory_inbox_state: pending|saved|rejected|edited_saved
- person_profile_type: self|full_hanu_user|managed|trusted|external
- contact_channel: app|whatsapp|sms|email|phone
- loop_state: needs_action|waiting|overdue|discussion|closed
- promise_state: pending|scheduled|in_progress|kept|broken
- reminder_state: pending|done|missed|snoozed|cancelled
- recur_kind: once|daily|weekly|monthly|yearly|custom
- reminder_category: family|work|health|finance|personal|self|other
- approval_state: pending|approved|denied|held|expired
- approval_rule_action: allow|deny|always_ask
- space_kind: private|family|trusted_circle|project|care|education
- space_member_role: member|co_manager|owner
- voice_tone: calm|firm|strict
- visual_mood: amber|nightfall|sage
- ambient_level: off|soft|vivid
- goal_completion_status: done|missed|skipped
- goal_failure_reason: forgot|tired|avoided|overplanned|no_time|blocked|wrong_time|too_big|not_important_anymore
- conflict_state: open|resolved|dismissed
```

---

## Verification

```sql
-- All enum types and value counts:
select t.typname, count(e.*)::int as values
  from pg_type t join pg_enum e on e.enumtypid = t.oid
 where t.typtype = 'e'
 group by t.typname
 order by t.typname;

-- Confirm the new indexes:
select schemaname, indexname from pg_indexes
 where indexname in ('messages_content_trgm_idx', 'messages_voice_transcript_trgm_idx');

-- Confirm nullable
select column_name, is_nullable from information_schema.columns
 where table_name = 'approvals' and column_name = 'from_person_id';
-- is_nullable = 'YES'

-- Smoke a Hanu-initiated approval insert:
do $$
declare uid uuid := 'd804b9ed-5eaa-497c-8390-86ba02007a33';
begin
  insert into public.approvals (user_id, kind, question, from_actor)
       values (uid, 'system_check', 'Save this memory?', 'hanu_self');
  delete from public.approvals where kind = 'system_check';
end $$;
```

---

## Rollback

Each step has a corresponding undo (drop the new column / re-add NOT NULL / drop the index). Don't roll back individual steps; instead, restore from a Supabase snapshot if a step breaks production.

---

## Files touched

- `supabase/schema.sql`
- `hermes-hanu-skill/tools.py` (`hanu_request_approval` signature)
- `BRIDGE_DESIGN.md` (enum inventory section)

---

## Notes

- Bundling several small enum changes into one migration limits the migration-file count. With migration discipline (task 15), each of these should be its own numbered file.
- The trigram index on `messages.content` will speed up `ILIKE` searches by 100×+ on a few-thousand-row table. Build it early, ideally before the first heavy "Ask Hanu" usage.
- `from_actor='hanu_self'` is the sentinel for system-initiated approvals. Document it in `BRIDGE_DESIGN.md` and `SOUL.md` so the agent and UI handle the null `from_person_id` gracefully (no avatar; show "Hanu" as the asker).
