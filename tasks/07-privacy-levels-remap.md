# 07 — Privacy levels: reconcile 5 PRD levels vs 6 schema values

**Priority:** P2
**Effort:** 2-3 hours
**Depends on:** none
**Status:** TODO
**Risk if skipped:** the UI cannot render a consistent privacy badge; the agent cannot pick a sensible default for sensitive categories; the schema enum has an ambiguity that will compound as the agent writes more memories.

---

## Context

PRD §memory defines **5** privacy levels:

| PRD label | Meaning |
|---|---|
| Private | Only the user. |
| Shareable with approval | Ask user before answering. |
| Shared with person | Visible to one named person. |
| Shared inside space | Visible to a space's members. |
| Never share / sensitive | Protected category. |

Schema `memory_privacy` enum (`supabase/schema.sql:49`) has **6** values:

```sql
create type memory_privacy as enum
  ('private', 'ask_share', 'shared', 'shared_space', 'sensitive', 'never');
```

`sensitive` and `never` collapse to the single PRD level "Never share / sensitive." Two values for one concept means:

- `tools.py` and `SOUL.md` use `'private'` as default but never write `'sensitive'` or `'never'`.
- The UI doesn't know which value means "do not display" vs "display with extra warning."
- The agent has to make a per-call decision that has no documented rule.

Sensitivity should be a separate concern (which **category** is this: health, finance, location, ...) tracked elsewhere (e.g., `settings.sensitive_categories`, or a `memories.sensitive_category` column). The privacy enum should just describe **who can see** the memory.

---

## Acceptance criteria

- `memory_privacy` enum has exactly 5 values aligned to PRD: `private`, `ask_share`, `shared_with_person`, `shared_in_space`, `never_share`.
- `memories.sensitive_category text` column added (nullable, free-text or enum from `settings.sensitive_categories`).
- Existing rows migrated: `'sensitive'` → `(privacy='never_share', sensitive_category=<inferred>)`; `'shared'` → `'shared_with_person'`; `'shared_space'` → `'shared_in_space'`; `'never'` → `'never_share'`.
- `tools.py` and `SOUL.md` updated to reference the new values.
- The UI helpers in `supabase-client.jsx` updated to render the new values.

---

## Implementation steps

### Step 1 — Add the new enum + transitional column

Postgres enum changes are awkward: you can't rename or remove enum values cleanly. Easiest path is to create a new enum, swap columns, drop the old one.

```sql
-- Step 1: new enum
create type memory_privacy_v2 as enum (
  'private', 'ask_share', 'shared_with_person', 'shared_in_space', 'never_share'
);

-- Step 2: add a transitional column on memories + memory_inbox
alter table public.memories add column privacy_v2 memory_privacy_v2;
alter table public.memory_inbox add column suggested_privacy_v2 memory_privacy_v2;

-- Step 3: backfill
update public.memories set privacy_v2 = case privacy
  when 'private'      then 'private'::memory_privacy_v2
  when 'ask_share'    then 'ask_share'::memory_privacy_v2
  when 'shared'       then 'shared_with_person'::memory_privacy_v2
  when 'shared_space' then 'shared_in_space'::memory_privacy_v2
  when 'sensitive'    then 'never_share'::memory_privacy_v2
  when 'never'        then 'never_share'::memory_privacy_v2
end;

update public.memory_inbox set suggested_privacy_v2 = case suggested_privacy
  when 'private'      then 'private'::memory_privacy_v2
  when 'ask_share'    then 'ask_share'::memory_privacy_v2
  when 'shared'       then 'shared_with_person'::memory_privacy_v2
  when 'shared_space' then 'shared_in_space'::memory_privacy_v2
  when 'sensitive'    then 'never_share'::memory_privacy_v2
  when 'never'        then 'never_share'::memory_privacy_v2
end;

-- Step 4: enforce NOT NULL after backfill
alter table public.memories alter column privacy_v2 set not null;
alter table public.memories alter column privacy_v2 set default 'private'::memory_privacy_v2;
alter table public.memory_inbox alter column suggested_privacy_v2 set default 'private'::memory_privacy_v2;

-- Step 5: drop old columns + enum + rename
alter table public.memories drop column privacy;
alter table public.memories rename column privacy_v2 to privacy;
alter table public.memory_inbox drop column suggested_privacy;
alter table public.memory_inbox rename column suggested_privacy_v2 to suggested_privacy;

drop type memory_privacy;
alter type memory_privacy_v2 rename to memory_privacy;

-- Step 6: rebuild indexes that referenced the old column
drop index if exists memories_privacy_idx;
create index memories_privacy_idx on public.memories(user_id, privacy);
```

Run as a single transaction (`begin; ... commit;`) so a failure mid-way doesn't leave the DB in a half-migrated state.

### Step 2 — Add `sensitive_category`

```sql
alter table public.memories
  add column if not exists sensitive_category text;

create index if not exists memories_sensitive_idx
  on public.memories(user_id, sensitive_category)
  where sensitive_category is not null;
```

Free-text for v1. The settable values are whatever the user has in `settings.sensitive_categories` (`Health, Finance, Location, ...`).

### Step 3 — Update `tools.py`

In `hermes-hanu-skill/tools.py`:

```python
def hanu_save_memory(
    text: str,
    kind: str = "other",
    privacy: str = "private",  # one of: private, ask_share, shared_with_person, shared_in_space, never_share
    sensitive_category: Optional[str] = None,
    source: str = "conversation",
    pinned: bool = False,
    shared_with_person_id: Optional[str] = None,
    shared_in_space_id: Optional[str] = None,
) -> dict:
    # Defensive: map any legacy values callers might still send
    legacy_map = {"shared": "shared_with_person",
                  "shared_space": "shared_in_space",
                  "sensitive": "never_share",
                  "never": "never_share"}
    privacy = legacy_map.get(privacy, privacy)
    try:
        res = sb().table("memories").insert({
            "user_id": USER_ID,
            "text": text,
            "kind": kind,
            "privacy": privacy,
            "sensitive_category": sensitive_category,
            "source": source,
            "pinned": pinned,
            "shared_with_person_id": shared_with_person_id,
            "shared_in_space_id": shared_in_space_id,
        }).execute()
        ...
```

Apply the same legacy-mapping to `hanu_propose_memory` and `hanu_update_memory`.

### Step 4 — Update `SOUL.md` and `SKILL.md`

Replace `privacy=private` defaults references that used `sensitive` or `never` separately. New rule (in `SOUL.md` privacy section):

```markdown
## Privacy values

- private — only the user can see.
- ask_share — must ask the user before answering.
- shared_with_person — visible to one named person (`shared_with_person_id` set).
- shared_in_space — visible to a named space's members (`shared_in_space_id` set).
- never_share — refuse to share, regardless of who asks.

Sensitivity (Health, Finance, Location, etc.) is a separate `sensitive_category`
field. A memory can be `privacy=shared_with_person AND sensitive_category=Health`
— it's visible to that one person but flagged as sensitive in the UI.
```

### Step 5 — Update UI

`hanu-v1/project/supabase-client.jsx` has `shapeMemory` (around line 112) and `_dbToUi`/`_uiToDb` (around line 54). Update the mapping:

```js
const _privacyDbToUi = (v) => ({
  private: "private",
  ask_share: "ask-share",
  shared_with_person: "shared-with-person",
  shared_in_space: "shared-in-space",
  never_share: "never",
}[v] || "private");

const _privacyUiToDb = (v) => ({
  "private": "private",
  "ask-share": "ask_share",
  "shared-with-person": "shared_with_person",
  "shared-in-space": "shared_in_space",
  "never": "never_share",
}[v] || "private");
```

Use these instead of the generic `_dbToUi/_uiToDb` for privacy fields.

In `modals.jsx`, the memory-edit modal's privacy picker needs the new option labels:
- "Private — only me"
- "Ask first — confirm before sharing"
- "Share with one person"
- "Share inside a space"
- "Never share"

Sensitive category becomes a separate dropdown sourced from `HANU.settings.sensitive` (already an array on the data shape).

---

## Verification

```sql
-- Confirm the new enum values:
select unnest(enum_range(null::memory_privacy));
-- Expected 5 rows: private, ask_share, shared_with_person, shared_in_space, never_share.

-- Confirm no orphan rows:
select privacy, count(*) from public.memories group by privacy;
-- Every row's privacy is in the new enum (it has to be — type check enforces).

-- Smoke: insert one row of each value:
do $$
declare uid uuid := 'd804b9ed-5eaa-497c-8390-86ba02007a33';
begin
  insert into public.memories (user_id, text, kind, privacy) values
    (uid, 'TEST priv', 'other', 'private'),
    (uid, 'TEST ask', 'other', 'ask_share'),
    (uid, 'TEST swp', 'other', 'shared_with_person'),
    (uid, 'TEST sis', 'other', 'shared_in_space'),
    (uid, 'TEST nev', 'other', 'never_share');
  delete from public.memories where text like 'TEST %';
end $$;
```

End-to-end: WhatsApp "remember my doctor's name is Mehta" — agent saves with `privacy='private'`, `sensitive_category='Health'` (the agent should infer the category from PRD's sensitive list). UI displays the memory with a "Private · Health" badge.

---

## Rollback

Only possible **before** step 5 of step 1 (the drop). After that, the old enum is gone and you'd need a manual re-create. Keep the SQL block atomic in a transaction and test on a staging DB first.

If the migration ran cleanly but you want to revert:

```sql
-- This is a destructive revert; do not run unless you have a recent backup.
-- The mapping is lossy (shared_with_person and shared_in_space both came from old 'shared'/'shared_space', so the reverse is fine, but 'never_share' splits ambiguously between old 'sensitive' and 'never').
-- See task 15 for migration discipline that avoids this kind of irreversibility.
```

---

## Files touched

- `supabase/schema.sql` (new enum definition, replace old)
- `hermes-hanu-skill/tools.py` (signatures, legacy mapping)
- `hanu-v1/project/SOUL.md` (privacy values list)
- `hermes-hanu-skill/SKILL.md` (same)
- `hanu-v1/project/supabase-client.jsx` (`_privacyDbToUi`, `_privacyUiToDb`, `shapeMemory`)
- `hanu-v1/project/modals.jsx` (memory edit modal labels + sensitive dropdown)

---

## Notes

- The migration is destructive on the old `memory_privacy` enum. Always run inside an explicit `BEGIN ... COMMIT` block on the live DB, and take a snapshot first (Supabase dashboard → Database → Backups).
- After this task, task 13 (`memories.source_type` enum) and task 14 (general enum tightening) are easier to do because the precedent is set.
