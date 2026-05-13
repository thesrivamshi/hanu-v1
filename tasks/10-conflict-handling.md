# 10 — Conflict handling: `conflicts` table + detection tool

**Priority:** P2 (becomes P0 the moment a second user joins)
**Effort:** 1 day
**Depends on:** 08 (permissions) recommended
**Status:** TODO
**Risk if skipped:** the moment Mother and Father both interact with shared family responsibilities, conflicting updates blindly overwrite. PRD §requests-relay forbids this. The first family-trust incident is one ambiguous edit away.

---

## Context

PRD example: Mother marks Father's tablet as done. Father says he forgot. Hanu must flag the conflict and ask the right person, not silently overwrite.

Today: no `conflicts` table. No conflict-state on `reminders` or `routines`. The agent's `hanu_mark_reminder` overwrites without checking.

---

## Acceptance criteria

- A `conflicts` table records `(target_table, target_id, parties, description, state, created_at, resolved_at)`.
- New MCP tool `hanu_record_conflict(target_table, target_id, party_person_ids, description, suggested_resolver_person_id)` available.
- New tool `hanu_resolve_conflict(id, resolution, resolved_by_person_id)` to close.
- The agent's tool-handling guidance covers: when about to call `hanu_mark_reminder`/`hanu_update_goal`/`hanu_update_open_loop` on a row touched by another person within the last 5 minutes, first check for conflict; create a `conflicts` row instead of overwriting; surface in the UI.
- UI has a "Conflicts" surface (one section in Today, or a tab in Approvals — placement TBD).

---

## Implementation steps

### Step 1 — Schema

```sql
create type conflict_state as enum ('open', 'resolved', 'dismissed');

create table public.conflicts (
  id                       uuid primary key default gen_random_uuid(),
  user_id                  uuid not null references public.profiles(id) on delete cascade,

  target_table             text not null,                 -- 'reminders', 'goals', 'open_loops', 'routines', etc.
  target_id                uuid not null,                  -- row id in target_table

  party_person_ids         uuid[] not null,                -- people involved in the conflict
  description              text not null,                  -- "Mother says done; Father says forgot"
  proposed_resolver_id     uuid references public.people(id) on delete set null,

  state                    conflict_state not null default 'open',
  resolution               text,                           -- agent or user free-text
  resolved_by_person_id    uuid references public.people(id) on delete set null,

  created_at               timestamptz not null default now(),
  resolved_at              timestamptz
);

create index conflicts_user_state_idx on public.conflicts(user_id, state);
create index conflicts_target_idx on public.conflicts(target_table, target_id);

-- RLS
alter table public.conflicts enable row level security;
create policy "conflicts: owner select" on public.conflicts for select using (auth.uid() = user_id);
create policy "conflicts: owner insert" on public.conflicts for insert with check (auth.uid() = user_id);
create policy "conflicts: owner update" on public.conflicts for update using (auth.uid() = user_id);
create policy "conflicts: owner delete" on public.conflicts for delete using (auth.uid() = user_id);
```

### Step 2 — MCP tool implementations

In `hermes-hanu-skill/tools.py`, add:

```python
def hanu_record_conflict(
    target_table: str,
    target_id: str,
    party_person_ids: list[str],
    description: str,
    proposed_resolver_id: Optional[str] = None,
) -> dict:
    try:
        res = sb().table("conflicts").insert({
            "user_id": USER_ID,
            "target_table": target_table,
            "target_id": target_id,
            "party_person_ids": party_person_ids,
            "description": description,
            "proposed_resolver_id": proposed_resolver_id,
            "state": "open",
        }).execute()
        cid = res.data[0]["id"] if res.data else None
        log_activity("conflict_recorded", description[:80], "conflicts", cid)
        return _ok(id=cid)
    except Exception as e:
        return _err(str(e))


def hanu_resolve_conflict(
    id: str,
    resolution: str,
    resolved_by_person_id: Optional[str] = None,
) -> dict:
    try:
        sb().table("conflicts").update({
            "state": "resolved",
            "resolution": resolution,
            "resolved_by_person_id": resolved_by_person_id,
            "resolved_at": now_iso(),
        }).eq("id", id).eq("user_id", USER_ID).execute()
        log_activity("conflict_resolved", f"Resolved conflict {id}", "conflicts", id)
        return _ok(id=id)
    except Exception as e:
        return _err(str(e))


def hanu_list_open_conflicts() -> dict:
    try:
        res = sb().table("conflicts").select("*").eq("user_id", USER_ID).eq(
            "state", "open"
        ).order("created_at", desc=True).limit(20).execute()
        return _ok(conflicts=res.data or [])
    except Exception as e:
        return _err(str(e))
```

Register in `_TOOL_REGISTRY`.

### Step 3 — Detection helper

To detect "another person touched this in the last 5 minutes," add:

```python
def hanu_recent_writers(target_table: str, target_id: str, within_seconds: int = 300) -> dict:
    """Return person_ids who appear in activity_log against this target recently."""
    try:
        since = (datetime.now(timezone.utc) - timedelta(seconds=within_seconds)).isoformat()
        res = sb().table("activity_log").select(
            "actor_person_id,actor,kind,created_at"
        ).eq("target_table", target_table).eq("target_id", target_id).gte(
            "created_at", since
        ).execute()
        person_ids = sorted({r["actor_person_id"] for r in (res.data or []) if r.get("actor_person_id")})
        return _ok(recent_person_ids=person_ids, raw=res.data or [])
    except Exception as e:
        return _err(str(e))
```

### Step 4 — Agent prompt updates

In `SOUL.md`, after the routing-rule trim from task 03:

```markdown
## Conflict handling

Before calling hanu_mark_reminder, hanu_update_goal, hanu_update_open_loop on
a row that was already touched by another person in the last 5 minutes, call
hanu_recent_writers(target_table, target_id) first.

If recent_person_ids contains any person id other than the current actor:
1. Do NOT make the change.
2. Call hanu_record_conflict(target_table, target_id, party_person_ids=[…], description="…").
3. Ask the user (in chat) which party to side with.
4. Once the user decides, call hanu_resolve_conflict and only THEN apply the
   original change.
```

### Step 5 — UI surface

Add a "Conflicts" subsection on the Today screen between "Pending confirmations" and "Open loops." Each conflict card shows:
- Description.
- Parties (avatars).
- Two buttons: "Side with [party A]" / "Side with [party B]". Tapping either calls `hanu_resolve_conflict` + applies the change.

If a placement of "Conflicts" on Today is too crowded, put it as a tab in the Approval Queue screen.

---

## Verification

```sql
-- Create a synthetic conflict
do $$
declare uid uuid := 'd804b9ed-5eaa-497c-8390-86ba02007a33';
declare rid uuid;
declare cid uuid;
declare mom uuid;
declare dad uuid;
begin
  insert into public.people (user_id, name, relationship, profile_type) values (uid, 'TEST Mom', 'Mother', 'managed') returning id into mom;
  insert into public.people (user_id, name, relationship, profile_type) values (uid, 'TEST Dad', 'Father', 'managed') returning id into dad;

  insert into public.reminders (user_id, title, scheduled_at, state)
       values (uid, 'TEST tablet', now(), 'pending') returning id into rid;

  insert into public.conflicts (user_id, target_table, target_id, party_person_ids, description)
       values (uid, 'reminders', rid, array[mom, dad], 'Mother says done; Father says forgot')
    returning id into cid;

  raise notice 'created conflict %', cid;

  -- Resolve
  perform public.hanu_resolve_conflict_dummy_test(cid);
  -- (or via supabase REST equivalent)

  delete from public.conflicts where id = cid;
  delete from public.reminders where id = rid;
  delete from public.people where id in (mom, dad);
end $$;
```

End-to-end (manual): set up two `people` rows for Mother and Father. Manually insert a conflict row. Confirm the Today / Approvals UI renders it.

---

## Rollback

```sql
drop table if exists public.conflicts;
drop type if exists conflict_state;
```

Remove the new tools from `_TOOL_REGISTRY`.

---

## Files touched

- `supabase/schema.sql`
- `hermes-hanu-skill/tools.py`
- `hanu-v1/project/SOUL.md`
- `hanu-v1/project/supabase-client.jsx` (load conflicts, shape, subscribe)
- `hanu-v1/project/data.jsx` (add `conflicts: []` to `window.HANU`)
- `hanu-v1/project/screens-a.jsx` or `screens-b.jsx` (UI section)

---

## Notes

- The "5 minutes" window is a heuristic. The PRD example implies a longer window (mother and father might disagree hours apart). Consider lengthening to 24h, or making it configurable per `target_table`.
- For shared `routines` and `appointments` (family-space coordination), conflicts will be the norm during the family-onboarding phase. Expect to surface dozens of these in week 1 and trim with rules ("Father's word always wins for his own medication routine").
- The current `proposed_resolver_id` is a hint; the actual resolver is whoever the user (Vamshi) sides with. In a multi-user setup, every party may need their own resolution view; v1 only Vamshi sees conflicts.
