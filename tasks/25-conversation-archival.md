# 25 — Conversation archival: cold-store messages older than 12 months

**Priority:** P4
**Effort:** 4-6 hours
**Depends on:** 15 (migrations) so the columns + jobs are tracked
**Status:** TODO
**Risk if skipped:** the `messages` table grows ~18k rows/year/user. Five family users = ~90k/year. Manageable, but the trigram FTS index on `content` (task 14) and the per-message audio metadata (task 11) compound. "Ask Hanu" queries against an unbounded table degrade. Index rebuild costs grow.

---

## Context

Most of `messages` is historical chatter that's never queried after 30 days. Cold-storing it preserves audit history without bloating the hot path. Two reasonable strategies:

1. **Partitioning** (Postgres native): partition `messages` by month. Drop or detach old partitions. Built-in, no application changes.
2. **Archive table**: move old rows to `messages_archive` (no indexes, columnar-ish layout). "Ask Hanu" only queries the hot table; rare queries can union with the archive.

For v1, the archive-table approach is simpler. Partitioning is the right long-term answer but requires app changes (queries become per-partition or against a parent table).

---

## Acceptance criteria

- `messages_archive` table exists with the same shape as `messages` (no indexes except `(user_id, created_at)`).
- A monthly job moves rows from `messages` older than 12 months to `messages_archive`.
- "Ask Hanu" search hits `messages` only.
- An admin tool `hanu_search_archive(query, since, until)` queries the archive on demand.
- The 12-month threshold is configurable via `settings.archive_after_days`.

---

## Implementation steps

### Step 1 — Schema

```sql
-- Archive table: same shape, fewer indexes, no FK to conversations
-- (so we can rotate independently and not block on cascade deletes).
create table public.messages_archive (
  id              uuid primary key,
  conversation_id uuid not null,
  user_id         uuid not null,
  role            text not null,
  content         text not null,
  raw_payload     jsonb,
  channel_message_id text,
  voice_audio_url text,
  voice_transcript text,
  voice_duration_ms integer,
  archived_at     timestamptz not null default now(),
  created_at      timestamptz not null
);

create index messages_archive_user_time_idx
  on public.messages_archive(user_id, created_at desc);

-- RLS
alter table public.messages_archive enable row level security;
create policy "messages_archive: owner select"
  on public.messages_archive for select using (auth.uid() = user_id);
-- No INSERT/UPDATE/DELETE policies for the user — archive is service-managed.

alter table public.settings
  add column if not exists archive_after_days integer not null default 365;
```

### Step 2 — Archival function

```sql
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
              channel_message_id, voice_audio_url, voice_transcript,
              voice_duration_ms, created_at
  )
  insert into public.messages_archive (
    id, conversation_id, user_id, role, content, raw_payload,
    channel_message_id, voice_audio_url, voice_transcript,
    voice_duration_ms, created_at
  )
  select * from moved;

  get diagnostics v_moved = row_count;
  return v_moved;
end $$;
```

### Step 3 — Monthly cron

If `pg_cron` is available on your Supabase tier:

```sql
select cron.schedule(
  'archive-old-messages-monthly',
  '0 4 1 * *',  -- 04:00 on the 1st of each month
  $$ select public.archive_old_messages(user_id) from public.profiles; $$
);
```

If not, run from Hermes' cron. Add a tool `hanu_archive_old_messages_all` that iterates `profiles`:

```python
def hanu_archive_old_messages_all() -> dict:
    try:
        users = sb().table("profiles").select("id").execute().data or []
        total = 0
        for u in users:
            r = sb().rpc("archive_old_messages", {"p_user_id": u["id"]}).execute()
            total += (r.data or 0)
        return _ok(moved=total)
    except Exception as e:
        return _err(str(e))
```

Schedule it monthly via Hermes' built-in cron scheduler.

### Step 4 — Archive search tool

```python
def hanu_search_archive(query: str, limit: int = 20) -> dict:
    try:
        res = sb().table("messages_archive").select(
            "id,conversation_id,created_at,content"
        ).eq("user_id", USER_ID).ilike("content", f"%{query}%").order(
            "created_at", desc=True
        ).limit(limit).execute()
        return _ok(matches=res.data or [])
    except Exception as e:
        return _err(str(e))
```

Register in `_TOOL_REGISTRY`. The agent only calls this when explicitly asked about old conversations (e.g., "what did I tell you last year about ...?").

### Step 5 — Voice file lifecycle

Voice audio files in Supabase Storage are referenced by archived rows. Two policies:

- **Keep storage**: archive rows preserve `voice_audio_url`; user can still play old voice notes from the dashboard's archive view (if any). Storage cost is ~$0.021/GB/month.
- **Delete storage**: at archive time, delete the underlying audio. Saves storage cost; loses replay. Reasonable for personal-Hanu.

Pick one. For v1, keep storage. Revisit if cost matters.

---

## Verification

```sql
-- Seed: insert old messages
do $$
declare uid uuid := 'd804b9ed-5eaa-497c-8390-86ba02007a33';
declare cid uuid;
begin
  insert into public.conversations (user_id, channel) values (uid, 'whatsapp')
    returning id into cid;
  insert into public.messages (conversation_id, user_id, role, content, created_at)
    values (cid, uid, 'user', 'OLD msg 1', now() - interval '400 days'),
           (cid, uid, 'user', 'OLD msg 2', now() - interval '500 days'),
           (cid, uid, 'user', 'RECENT', now());

  -- Set archive_after_days
  update public.settings set archive_after_days = 365 where user_id = uid;

  -- Run
  raise notice 'moved = %', public.archive_old_messages(uid);
  -- Expected: 2

  -- Verify
  raise notice 'remaining in messages = %', (select count(*) from public.messages where user_id = uid and content like 'OLD%');
  -- Expected: 0
  raise notice 'in archive = %', (select count(*) from public.messages_archive where user_id = uid and content like 'OLD%');
  -- Expected: 2

  -- Cleanup
  delete from public.messages_archive where conversation_id = cid;
  delete from public.messages         where conversation_id = cid;
  delete from public.conversations    where id = cid;
end $$;
```

End-to-end: call `hanu_archive_old_messages_all` once. Inspect counts before and after.

---

## Rollback

```sql
drop function if exists public.archive_old_messages(uuid);
drop table   if exists public.messages_archive;
alter table public.settings drop column if exists archive_after_days;
```

Any already-archived rows are lost on table drop. Either move them back first or restore from snapshot.

---

## Files touched

- `supabase/schema.sql`
- `hermes-hanu-skill/tools.py` (`hanu_search_archive`, `hanu_archive_old_messages_all`)
- Hermes cron config (schedule monthly run)
- `BRIDGE_DESIGN.md` (document the lifecycle)

---

## Notes

- 365 days is a reasonable default for the cutoff. The user can shorten (privacy) or lengthen (memory) per their preference.
- The archive_after_days column lives on `settings`; you could move it to `profiles` if it's truly never user-tunable. Settings is fine.
- For long-term scale (years of family-Hanu), revisit partitioning. `pg_partman` automates monthly partition creation and drop. Don't pre-partition v1 — it's complexity without payoff.
- The archive table has no embedding column even if you eventually wire vector search on `memories`. Old `messages_archive` rows are intended for occasional grep, not for ongoing semantic recall.
