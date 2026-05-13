# 02 — Fix `message_count` always-1 bug + add trigger

**Priority:** P0 (live data corruption — silent)
**Effort:** 1-2 hours
**Depends on:** none (independent of MCP swap)
**Status:** TODO
**Risk if skipped:** every conversation's `message_count` stays stuck at `1` regardless of true volume. Downstream UI that ranks conversations by activity is wrong. `conversations.last_message_at` is correct; only `message_count` is broken.

---

## Context

`hermes-hanu-skill/tools.py:612-615`:

```python
sb().table("conversations").update({
    "last_message_at": now_iso(),
    "message_count": sb().rpc("increment_message_count", {"conv_id": conversation_id}).execute().data if False else 1,
}).eq("id", conversation_id).execute()
```

The expression `<rpc>.data if False else 1` is Python's conditional. `False` is constant, so this evaluates to literal `1`, **always**. The RPC is never invoked. Whoever wrote it was stubbing the path; the stub silently lies.

Worse: even if you removed the `if False else 1` and the RPC existed, doing the increment in a separate REST round-trip from the insert is racy. Two concurrent message inserts can both read `count = N`, both write `count = N + 1`, and the final value is `N + 1` instead of `N + 2`.

Right fix: maintain `conversations.message_count` from a Postgres trigger on `messages` INSERT/DELETE. The DB sees writes serially and there is no race. Application code does not have to maintain the counter at all.

---

## Acceptance criteria

- `messages` INSERT bumps `conversations.message_count` by 1 and updates `conversations.last_message_at`.
- `messages` DELETE decrements `conversations.message_count` by 1 (clamped at 0).
- `hanu_log_message` no longer mentions `message_count`.
- The `if False else 1` antipattern is gone.
- A test insert of 3 messages results in `message_count = 3`, not `1`.

---

## Implementation steps

### Step 1 — Add the trigger to the schema

Append to `supabase/schema.sql` (or, better, create the first real migration file — see task 15):

```sql
-- =============================================================================
-- TRIGGER: maintain conversations.message_count and last_message_at
-- =============================================================================
-- Replaces the broken application-side counter in tools.py.

create or replace function public.tg_messages_after_change()
returns trigger language plpgsql security definer as $$
begin
  if (TG_OP = 'INSERT') then
    update public.conversations
       set message_count = coalesce(message_count, 0) + 1,
           last_message_at = greatest(coalesce(last_message_at, NEW.created_at), NEW.created_at)
     where id = NEW.conversation_id;
    return NEW;

  elsif (TG_OP = 'DELETE') then
    update public.conversations
       set message_count = greatest(coalesce(message_count, 1) - 1, 0)
     where id = OLD.conversation_id;
    return OLD;
  end if;
  return null;
end $$;

drop trigger if exists messages_after_change on public.messages;
create trigger messages_after_change
  after insert or delete on public.messages
  for each row execute function public.tg_messages_after_change();
```

Apply against the live DB:

```bash
psql "$SUPABASE_DB_URL" -f supabase/schema.sql
# OR run only the new block via psql heredoc, see below
```

If running the whole file is too risky against a populated DB, run only the new block:

```bash
psql "$SUPABASE_DB_URL" <<'SQL'
create or replace function public.tg_messages_after_change() returns trigger ...
-- (paste the block above)
SQL
```

### Step 2 — Patch `tools.py`

Edit `hermes-hanu-skill/tools.py:596-618`. The `hanu_log_message` function becomes:

```python
def hanu_log_message(
    conversation_id: str,
    role: str,
    content: str,
    raw_payload: Optional[dict] = None,
    channel_message_id: Optional[str] = None,
) -> dict:
    try:
        sb().table("messages").insert({
            "conversation_id": conversation_id,
            "user_id": USER_ID,
            "role": role,
            "content": content,
            "raw_payload": raw_payload or {},
            "channel_message_id": channel_message_id,
        }).execute()
        # message_count and last_message_at are maintained by the
        # messages_after_change trigger in Postgres. Application code does
        # not write these columns.
        return _ok()
    except Exception as e:
        return _err(str(e))
```

Remove the `sb().table("conversations").update({...})` block entirely.

### Step 3 — Backfill existing counts

If the DB already has messages with wrong counts, recompute once:

```sql
update public.conversations c
   set message_count = sub.cnt,
       last_message_at = sub.last_at
  from (
    select conversation_id,
           count(*)::int as cnt,
           max(created_at) as last_at
      from public.messages
     group by conversation_id
  ) sub
 where c.id = sub.conversation_id;

-- Conversations with zero messages need their count zeroed too:
update public.conversations
   set message_count = 0
 where id not in (select conversation_id from public.messages);
```

### Step 4 — Deploy

Sync the skill changes to the droplet:

```bash
rsync -av hermes-hanu-skill/ root@168.144.30.107:/root/.hermes/skills/hanu-bridge/
systemctl --user restart hermes-gateway
# (or: ssh into droplet and run the same commands locally)
```

---

## Verification

```sql
-- Insert 3 test messages into a fresh conversation:
do $$
declare cid uuid;
begin
  insert into public.conversations (user_id, channel)
       values ('d804b9ed-5eaa-497c-8390-86ba02007a33', 'whatsapp')
    returning id into cid;

  insert into public.messages (conversation_id, user_id, role, content)
       values (cid, 'd804b9ed-5eaa-497c-8390-86ba02007a33', 'user', 'one'),
              (cid, 'd804b9ed-5eaa-497c-8390-86ba02007a33', 'user', 'two'),
              (cid, 'd804b9ed-5eaa-497c-8390-86ba02007a33', 'user', 'three');

  perform pg_sleep(0.1);
  raise notice 'message_count = %', (select message_count from public.conversations where id = cid);
  -- Expected: 3

  delete from public.messages where conversation_id = cid;
  raise notice 'after delete, message_count = %', (select message_count from public.conversations where id = cid);
  -- Expected: 0

  delete from public.conversations where id = cid;
end $$;
```

End-to-end: send 5 WhatsApp messages to Hanu. Then:

```sql
select id, message_count, last_message_at
  from public.conversations
 where user_id = 'd804b9ed-5eaa-497c-8390-86ba02007a33'
 order by last_message_at desc
 limit 5;
```

`message_count` should be ≥ 5 on the row that received them. `last_message_at` should be within the last few minutes.

---

## Rollback

```sql
drop trigger if exists messages_after_change on public.messages;
drop function if exists public.tg_messages_after_change();
```

Restore the previous `hanu_log_message` code if you also need the (broken) old behavior back — but you don't, because that path was broken.

---

## Files touched

- `supabase/schema.sql` (add trigger block)
- `hermes-hanu-skill/tools.py` (remove the broken conversations update from `hanu_log_message`)

---

## Notes

- Trigger uses `security definer` so it can update `conversations` regardless of RLS. The function is owned by the schema owner; `auth.uid()` checks are bypassed for this internal counter. This is correct because the trigger only runs in response to a legitimate `messages` INSERT/DELETE that already passed RLS.
- If you later add per-user partitioning, revisit this trigger to ensure cross-partition counts still work.
