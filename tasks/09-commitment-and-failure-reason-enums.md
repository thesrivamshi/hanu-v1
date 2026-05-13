# 09 — Commitment enum + goal failure-reason enum + `family_critical`

**Priority:** P2
**Effort:** 2-3 hours
**Depends on:** 04 (the trigger function reads `goal_completions.status`/`reason` — keep them compatible)
**Status:** TODO
**Risk if skipped:** "Maybe" / "family-critical" commitment levels from the PRD have no representation. Goal failure reasons are free text so "you cited 'too tired' 6 times this month" insights are impossible.

---

## Context

PRD §goals lists 7 commitment strengths:
> Idea, maybe, planned, committed, non-negotiable, promise to someone, family-critical.

Schema `commitment_level` (`supabase/schema.sql:46`) has 5: `idea, planned, committed, promised, non_negotiable`. Missing: `maybe`, `family-critical`.

PRD §goals lists 9 failure reasons:
> Forgot, Too tired, Avoided, Overplanned, No time, Blocked by someone, Wrong time, Too big, Not important anymore.

Schema `goal_completions.reason text` is free-text.

The right modeling decision differs by attribute:

- **`maybe`**: legitimately a new commitment level. Add to enum.
- **`family-critical`**: a flag, not a commitment level. A goal can be `commitment='committed'` AND `family_critical=true` simultaneously. Add as a boolean column.
- **`promise to someone`**: already captured by `goals.promise_to_person_id`. Skip; it's a relationship, not a commitment level.
- **failure reason**: enum so we can aggregate.

---

## Acceptance criteria

- `commitment_level` enum has 6 values: `idea, maybe, planned, committed, promised, non_negotiable`.
- `goals.family_critical boolean not null default false` exists.
- `goal_failure_reason` enum exists with the 9 PRD values.
- `goal_completions.reason` is the new enum type (nullable; only set when `status='missed'`).
- `tools.py` and the UI accept the new values without breaking.

---

## Implementation steps

### Step 1 — Extend commitment enum

```sql
-- Postgres lets us ADD a value to an existing enum:
alter type commitment_level add value if not exists 'maybe' before 'planned';
```

Verify:

```sql
select unnest(enum_range(null::commitment_level));
-- Expect: idea, maybe, planned, committed, promised, non_negotiable
```

### Step 2 — Add `family_critical`

```sql
alter table public.goals
  add column if not exists family_critical boolean not null default false;

create index if not exists goals_family_critical_idx
  on public.goals(user_id, family_critical)
  where family_critical = true;
```

### Step 3 — Define failure-reason enum + migrate

```sql
create type goal_failure_reason as enum (
  'forgot', 'tired', 'avoided', 'overplanned',
  'no_time', 'blocked', 'wrong_time', 'too_big', 'not_important_anymore'
);

-- Transitional column
alter table public.goal_completions
  add column reason_v2 goal_failure_reason;

-- Backfill from free text. Conservative mapping; unknowns stay null.
update public.goal_completions set reason_v2 = case
  when reason ilike 'forgot'              then 'forgot'::goal_failure_reason
  when reason ilike 'tired%'              then 'tired'::goal_failure_reason
  when reason ilike 'too tired%'          then 'tired'::goal_failure_reason
  when reason ilike 'avoid%'              then 'avoided'::goal_failure_reason
  when reason ilike 'overplan%'           then 'overplanned'::goal_failure_reason
  when reason ilike 'no time%'            then 'no_time'::goal_failure_reason
  when reason ilike 'no_time'             then 'no_time'::goal_failure_reason
  when reason ilike '%blocked%'           then 'blocked'::goal_failure_reason
  when reason ilike 'wrong time%'         then 'wrong_time'::goal_failure_reason
  when reason ilike 'wrong_time'          then 'wrong_time'::goal_failure_reason
  when reason ilike 'too big%'            then 'too_big'::goal_failure_reason
  when reason ilike 'too_big'             then 'too_big'::goal_failure_reason
  when reason ilike 'not important%'      then 'not_important_anymore'::goal_failure_reason
  when reason ilike 'not_important%'      then 'not_important_anymore'::goal_failure_reason
  else null
end;

alter table public.goal_completions drop column reason;
alter table public.goal_completions rename column reason_v2 to reason;
```

### Step 4 — Optional: enum for `goal_completions.status`

While here, harden `status text` → enum:

```sql
create type goal_completion_status as enum ('done', 'missed', 'skipped');

alter table public.goal_completions
  add column status_v2 goal_completion_status;

update public.goal_completions set status_v2 = case status
  when 'done'    then 'done'::goal_completion_status
  when 'missed'  then 'missed'::goal_completion_status
  when 'skipped' then 'skipped'::goal_completion_status
end;

-- Status is required; ensure backfill is total before dropping the old col
do $$
begin
  if exists (select 1 from public.goal_completions where status_v2 is null) then
    raise exception 'unmapped goal_completions.status values exist; refusing to drop';
  end if;
end $$;

alter table public.goal_completions drop column status;
alter table public.goal_completions rename column status_v2 to status;
alter table public.goal_completions alter column status set not null;
```

### Step 5 — Update `tools.py`

`hanu_log_goal_completion`: typed `reason` accepts the enum string set; raise an error on invalid input.

```python
_VALID_REASONS = {
    "forgot", "tired", "avoided", "overplanned", "no_time",
    "blocked", "wrong_time", "too_big", "not_important_anymore",
}

def hanu_log_goal_completion(goal_id, status, reason=None, note=None, on_date=None):
    if reason and reason not in _VALID_REASONS:
        return _err(f"reason must be one of {sorted(_VALID_REASONS)}")
    ...
```

`hanu_create_goal`: accept `family_critical: bool = False` and `commitment` from the extended set.

### Step 6 — Update UI

`hanu-v1/project/data.jsx:55` has the failure-reason list. Replace with the canonical 9-value list (matching enum strings, not their UI-pretty labels):

```js
failureReasons: ["forgot", "tired", "avoided", "overplanned", "no_time",
                 "blocked", "wrong_time", "too_big", "not_important_anymore"],
```

Add a UI-only map for human-readable labels:

```js
const FAILURE_REASON_LABELS = {
  forgot: "Forgot",
  tired: "Too tired",
  avoided: "Avoided",
  overplanned: "Overplanned",
  no_time: "No time",
  blocked: "Blocked by someone",
  wrong_time: "Wrong time",
  too_big: "Too big",
  not_important_anymore: "Not important anymore",
};
window.FAILURE_REASON_LABELS = FAILURE_REASON_LABELS;
```

`modals.jsx` — `CreateGoalModal`: add a `Family-critical` toggle next to commitment. The `maybe` commitment level fits into the existing commitment picker (it has 5 segments today; bump to 6).

Reviews screen: render failure reasons via `FAILURE_REASON_LABELS[reason]`.

---

## Verification

```sql
-- commitment
select unnest(enum_range(null::commitment_level));
-- 6 values

-- failure reason
select unnest(enum_range(null::goal_failure_reason));
-- 9 values

-- family_critical column
select column_name, data_type, column_default
  from information_schema.columns
 where table_name = 'goals' and column_name = 'family_critical';
-- one row, boolean, default false

-- Smoke insert (covers all the new enum values):
do $$
declare uid uuid := 'd804b9ed-5eaa-497c-8390-86ba02007a33';
declare gid uuid;
begin
  insert into public.goals (user_id, title, priority, commitment, family_critical)
       values (uid, 'TEST', 'normal', 'maybe', true)
    returning id into gid;
  insert into public.goal_completions (goal_id, user_id, on_date, status, reason)
       values (gid, uid, current_date, 'missed', 'tired');
  delete from public.goals where id = gid;
end $$;
```

---

## Rollback

Removing enum values is not directly supported in Postgres without rebuilding the type. Practical rollback: leave the enum extensions in place; revert the column changes via the same drop+rename pattern.

```sql
-- family_critical
alter table public.goals drop column if exists family_critical;

-- failure reason: only safe if no row has used the new enum values
-- (else you lose data). Skip rollback in practice; manage via app code.
```

---

## Files touched

- `supabase/schema.sql`
- `hermes-hanu-skill/tools.py`
- `hanu-v1/project/data.jsx`
- `hanu-v1/project/modals.jsx`
- `hanu-v1/project/screens-c.jsx` (Reviews screen failure-reason rendering)
- `hanu-v1/project/supabase-client.jsx` (`shapeGoal`)

---

## Notes

- The mapping in step 3 is best-effort. If the DB has nontrivial free-text reasons that don't fit, write them as-is to an `activity_log` note before the alter and inspect by hand.
- `goal_completion_status` enum is optional; current code already restricts to `{done, missed, skipped}` via SOUL.md guidance. The enum makes the DB self-defending. Recommended.
- The PRD's "promise to someone" commitment level is intentionally NOT a new enum value. It's modeled via `goals.promise_to_person_id` being non-null. Document this in `SOUL.md` so the agent doesn't try to create `commitment='promise_to_someone'`.
