# 22 — `delete_user_completely(uuid)` SQL function + tested deletion path

**Priority:** P3 (becomes P0 the moment Mother, Father, etc. have their own logins)
**Effort:** half a day
**Depends on:** 15 (migrations) to capture this as a numbered migration
**Status:** TODO
**Risk if skipped:** "delete my data" from a family member becomes a manual, error-prone DB surgery. Cascading deletes wire through `on delete cascade` but no one has tested that the cascade reaches every dependency. No anonymization path means storage of an opted-out user's voice notes lingers indefinitely.

---

## Context

The schema already uses `on delete cascade` for most child rows pointing at `profiles(id)`. In theory, `delete from public.profiles where id = <uid>;` should cascade through `goals`, `memories`, `reminders`, etc. In practice:

- Some FKs use `on delete set null` (e.g., `linked_user_id`, `promise_to_person_id`) — those keep the rows around with a null reference, which is correct *unless* the deletee is the row's owner.
- Voice-note audio files in Supabase Storage are NOT linked by FK to `profiles`. They survive a profile delete.
- `auth.users` deletion is a separate step (uses Supabase admin API).
- `activity_log` rows that mention the deleted user via `actor_person_id` or `visible_to_person_ids` survive but become orphans.

A complete delete needs:

1. Delete all rows owned by the user across every table.
2. Delete storage objects in `voice-notes/<uid>/...`.
3. Delete the `auth.users` row.
4. Optionally anonymize (vs hard-delete) where audit history matters.

---

## Acceptance criteria

- A SQL function `public.delete_user_completely(uuid)` removes every row whose `user_id = <uid>`.
- A companion script removes storage objects in `voice-notes/<uid>/`.
- A test run on a fixture user (with rows across every table) leaves zero traces queryable.
- `auth.users` row is deleted via Supabase admin API.
- Function is reversible only via a fresh restore from snapshot — there is no soft-delete.

---

## Implementation steps

### Step 1 — Inventory tables with `user_id` columns

```sql
select table_name
  from information_schema.columns
 where table_schema = 'public' and column_name = 'user_id'
 order by table_name;
```

Expected list (matches the inventory in `schema.sql:719-724`):

```
activity_log, appointments, approvals, conversations, daily_reviews, decisions,
goal_completions, goals, memories, memory_inbox, messages, open_loops,
people, permissions, promises, reminders, routines, settings, spaces
```

Plus `profiles` (where `id = user_id`).

### Step 2 — Write the function

```sql
create or replace function public.delete_user_completely(p_user_id uuid)
returns void
language plpgsql
security definer
as $$
begin
  -- Order matters only when CASCADE doesn't cover everything.
  -- With cascades wired correctly, deleting profiles last is sufficient.

  -- Defensive deletes for tables in case any CASCADE is missing:
  delete from public.activity_log      where user_id = p_user_id;
  delete from public.appointments      where user_id = p_user_id;
  delete from public.approvals         where user_id = p_user_id;
  delete from public.daily_reviews     where user_id = p_user_id;
  delete from public.decisions         where user_id = p_user_id;
  delete from public.goal_completions  where user_id = p_user_id;
  delete from public.goals             where user_id = p_user_id;
  delete from public.memories          where user_id = p_user_id;
  delete from public.memory_inbox      where user_id = p_user_id;
  delete from public.messages          where user_id = p_user_id;
  delete from public.conversations     where user_id = p_user_id;
  delete from public.open_loops        where user_id = p_user_id;
  delete from public.permissions       where user_id = p_user_id;
  delete from public.people            where user_id = p_user_id;
  delete from public.promises          where user_id = p_user_id;
  delete from public.reminders         where user_id = p_user_id;
  delete from public.routines          where user_id = p_user_id;
  delete from public.settings          where user_id = p_user_id;
  delete from public.spaces            where user_id = p_user_id;
  -- conflicts, approval_rules from later tasks:
  if to_regclass('public.conflicts') is not null then
    execute format('delete from public.conflicts where user_id = %L', p_user_id);
  end if;
  if to_regclass('public.approval_rules') is not null then
    execute format('delete from public.approval_rules where user_id = %L', p_user_id);
  end if;

  -- Profile last (also cascades through any FKs we missed):
  delete from public.profiles where id = p_user_id;

  -- Note: this function does NOT delete auth.users — that requires the
  -- Supabase admin API and runs from application code (see step 4).
  --
  -- It also does NOT delete storage objects — see step 5.
end $$;
```

Grant execute to a role that the deletion runner uses (or simply use service_role from a script):

```sql
revoke all on function public.delete_user_completely(uuid) from public;
-- service_role can call it without explicit grant
```

### Step 3 — Cross-reference cleanup

Some columns reference users without owning the rows. Sweep them too:

```sql
-- people.linked_user_id, promise_to_person_id, etc. are SET NULL on delete cascade,
-- which is correct for OTHER users referencing the deleted user.

-- activity_log.actor_person_id and visible_to_person_ids[] are not auto-cleaned
-- because they reference people, not profiles. If you fully scrub:
update public.activity_log
   set actor_person_id = null
 where actor_person_id in (select id from public.people where user_id = p_user_id);
```

Add this to the function above if your privacy posture demands it.

### Step 4 — App-side runner

Hanu doesn't yet have an admin UI for deletion. For v1, a one-off script:

`/root/.hermes/skills/hanu-bridge/admin_delete_user.py`:

```python
"""
Delete every trace of a user.

Usage: python admin_delete_user.py <user_id>

Performs, in order:
  1. delete_user_completely(user_id) on Postgres.
  2. Remove storage objects under voice-notes/<user_id>/.
  3. Delete auth.users row via Supabase admin API.
"""
import os
import sys
import requests
from db import sb

def delete_storage(user_id: str):
    # List, then bulk delete
    url = f"{os.environ['SUPABASE_URL']}/storage/v1/object/list/voice-notes"
    headers = {
        "Authorization": f"Bearer {os.environ['SUPABASE_SECRET_KEY']}",
        "Content-Type": "application/json",
    }
    r = requests.post(url, json={"prefix": f"{user_id}/", "limit": 1000}, headers=headers, timeout=30)
    r.raise_for_status()
    files = [f["name"] for f in r.json()]
    if files:
        del_url = f"{os.environ['SUPABASE_URL']}/storage/v1/object/voice-notes"
        rr = requests.delete(del_url, json={"prefixes": [f"{user_id}/{f}" for f in files]},
                              headers=headers, timeout=30)
        rr.raise_for_status()

def delete_auth_user(user_id: str):
    url = f"{os.environ['SUPABASE_URL']}/auth/v1/admin/users/{user_id}"
    headers = {"Authorization": f"Bearer {os.environ['SUPABASE_SECRET_KEY']}"}
    r = requests.delete(url, headers=headers, timeout=30)
    if r.status_code not in (200, 204):
        raise RuntimeError(f"auth delete failed: {r.status_code} {r.text}")

def main():
    if len(sys.argv) != 2:
        print("Usage: admin_delete_user.py <user_id>")
        sys.exit(2)
    uid = sys.argv[1]

    print(f"[1/3] DB rows for user {uid} ...")
    sb().rpc("delete_user_completely", {"p_user_id": uid}).execute()

    print(f"[2/3] Storage objects under voice-notes/{uid}/ ...")
    delete_storage(uid)

    print(f"[3/3] auth.users row {uid} ...")
    delete_auth_user(uid)

    print("Done.")

if __name__ == "__main__":
    main()
```

### Step 5 — Test fixture

A reusable test that creates a user with rows in every table, runs deletion, and asserts nothing remains:

```sql
do $$
declare uid uuid := gen_random_uuid();
declare pid uuid;
declare gid uuid;
declare rid uuid;
declare cid uuid;
begin
  -- Create a fake profile (we can't insert into auth.users directly from SQL
  -- without the admin API; for the test, use an existing test profile id).

  -- Insert rows in every table for `uid`:
  insert into public.profiles (id, display_name, first_name) values (uid, 'X', 'X');
  insert into public.spaces (user_id, name, kind) values (uid, 'sp', 'private');
  insert into public.people (user_id, name) values (uid, 'p') returning id into pid;
  insert into public.settings (user_id) values (uid);
  insert into public.memories (user_id, text, kind, privacy) values (uid, 'm', 'other', 'private');
  insert into public.goals (user_id, title) values (uid, 'g') returning id into gid;
  insert into public.goal_completions (goal_id, user_id, on_date, status) values (gid, uid, current_date, 'done');
  insert into public.reminders (user_id, title) values (uid, 'r') returning id into rid;
  insert into public.open_loops (user_id, title) values (uid, 'l');
  insert into public.promises (user_id, text, to_text) values (uid, 'pr', 'Self');
  insert into public.decisions (user_id, title) values (uid, 'd');
  insert into public.conversations (user_id, channel) values (uid, 'whatsapp') returning id into cid;
  insert into public.messages (conversation_id, user_id, role, content) values (cid, uid, 'user', 'hi');
  insert into public.activity_log (user_id, kind, summary) values (uid, 'test', 's');

  -- Run deletion:
  perform public.delete_user_completely(uid);

  -- Assert nothing left:
  if exists (select 1 from public.profiles where id = uid) then raise exception 'profile leaked'; end if;
  if exists (select 1 from public.memories where user_id = uid) then raise exception 'memory leaked'; end if;
  if exists (select 1 from public.messages where user_id = uid) then raise exception 'messages leaked'; end if;
  if exists (select 1 from public.activity_log where user_id = uid) then raise exception 'activity leaked'; end if;

  raise notice 'delete_user_completely test PASSED';
end $$;
```

---

## Verification

Run the test SQL block in step 5. It should print `delete_user_completely test PASSED`.

For the storage and auth steps, test against a throwaway user account created in Supabase dashboard:

```bash
python admin_delete_user.py <throwaway-uid>
```

Then:

```bash
# Storage list should return empty for the prefix:
curl -X POST "${SUPABASE_URL}/storage/v1/object/list/voice-notes" \
  -H "Authorization: Bearer ${SUPABASE_SECRET_KEY}" \
  -H "Content-Type: application/json" \
  -d "{\"prefix\":\"<throwaway-uid>/\"}"

# Auth lookup should 404:
curl -i "${SUPABASE_URL}/auth/v1/admin/users/<throwaway-uid>" \
  -H "Authorization: Bearer ${SUPABASE_SECRET_KEY}"
```

---

## Rollback

There is no rollback. Restore from a Supabase snapshot if a delete was issued in error. Document this in the script's `--confirm` flag (force interactive confirmation):

```python
if "--confirm" not in sys.argv:
    print("Refusing to delete without --confirm. This action is irreversible.")
    sys.exit(2)
```

---

## Files touched

- `supabase/schema.sql` (function definition)
- `hermes-hanu-skill/admin_delete_user.py` (new)
- `BRIDGE_DESIGN.md` (document the deletion path)

---

## Notes

- "Anonymization" (replace name with "Deleted user", keep audit rows) is an alternative to hard delete. For personal-use Hanu, hard delete is simpler and matches user expectation. For shared-space contexts (Family Space, conflict history), anonymization may matter — add a second function `anonymize_user_completely(uuid)` when that need arises.
- The cascade behavior depends on the FK definitions in `schema.sql`. If new tables are added without `on delete cascade` on the `user_id` FK, the function above silently leaves orphans. Add a CI check: query `information_schema.referential_constraints` and assert every `user_id` FK has `delete_rule='CASCADE'`.
- For GDPR-like compliance, also delete logs (nginx access logs, journalctl entries) that contain the user's WhatsApp number or email. The function only handles DB rows.
