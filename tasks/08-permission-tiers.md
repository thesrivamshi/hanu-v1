# 08 — Permission tiers 0-4 modeled in DB

**Priority:** P2
**Effort:** 4-6 hours
**Depends on:** none
**Status:** TODO
**Risk if skipped:** the PRD's "permission tier" abstraction lives only in agent prompt prose. The UI cannot render "Mother is tier 2"; the agent has no DB-enforced limit; adding a new family member is a hand-crafted permission set per person.

---

## Context

PRD §permissions defines 5 ordered tiers with named "Can do / Cannot do" semantics:

| Tier | Name | Can | Cannot |
|---|---|---|---|
| 0 | Contact only | receive selected messages or reminders | ask about user |
| 1 | Can send requests | ask Hanu to pass a message/task to user | see personal info |
| 2 | Can share tasks/reminders | participate in shared tasks/reminders | read private memories |
| 3 | Can ask limited status | ask allowed status (availability, shared-task state) | access sensitive/private |
| 4 | Shared-space co-manager | manage shared family responsibilities | access private Hanu memories |

Schema models permissions as `(person_id, capability text, granted bool, scope text)`. No tier number is stored, no inheritance ("tier 2 includes 0+1 grants"), no baseline-from-tier rule.

We want: a `people.permission_tier smallint` column that is the **baseline**, plus the existing `permissions` table for per-capability overrides. A SQL function `allowed_capabilities(tier)` returns the implied capability set.

---

## Acceptance criteria

- `people.permission_tier smallint not null default 0` exists with a check constraint `between 0 and 4`.
- A function `public.has_capability(person_id uuid, capability text) returns boolean` that:
  1. Checks for a tier-implied grant via `allowed_capabilities(tier)`.
  2. Checks for an explicit row in `permissions` that overrides the baseline.
  3. Explicit `granted = false` overrides tier grant.
  4. Explicit `granted = true` overrides tier denial.
- `hanu_check_can` in `tools.py` calls `has_capability` via RPC instead of querying `permissions` directly.
- `hanu_add_person` accepts `permission_tier` argument (default 0).
- UI shows tier on every person card and exposes a tier picker on the Add/Edit Person modal.

---

## Implementation steps

### Step 1 — Schema additions

```sql
alter table public.people
  add column if not exists permission_tier smallint not null default 0
  check (permission_tier between 0 and 4);

create index if not exists people_tier_idx on public.people(user_id, permission_tier);
```

### Step 2 — Capability set per tier

The capability strings must match what the agent uses. Document them centrally:

```sql
-- Define which capabilities each tier baseline grants.
-- This is data, not code, so changing tier semantics doesn't require migrations.
create table if not exists public.tier_capabilities (
  tier        smallint not null check (tier between 0 and 4),
  capability  text not null,
  primary key (tier, capability)
);

-- Tier 0: contact only — no asks; bot may send the person scheduled reminders only.
-- Tier 1: can send requests
insert into public.tier_capabilities (tier, capability) values
  (1, 'send_request_to_user')
on conflict do nothing;

-- Tier 2: share tasks/reminders (tier-1 grants + share_task)
insert into public.tier_capabilities (tier, capability) values
  (2, 'send_request_to_user'),
  (2, 'create_shared_task'),
  (2, 'mark_shared_task_done')
on conflict do nothing;

-- Tier 3: ask limited status (tier-2 grants + ask_availability + ask_shared_task_state)
insert into public.tier_capabilities (tier, capability) values
  (3, 'send_request_to_user'),
  (3, 'create_shared_task'),
  (3, 'mark_shared_task_done'),
  (3, 'ask_availability'),
  (3, 'ask_shared_task_state')
on conflict do nothing;

-- Tier 4: co-manager (tier-3 grants + space management)
insert into public.tier_capabilities (tier, capability) values
  (4, 'send_request_to_user'),
  (4, 'create_shared_task'),
  (4, 'mark_shared_task_done'),
  (4, 'ask_availability'),
  (4, 'ask_shared_task_state'),
  (4, 'manage_shared_routines'),
  (4, 'manage_shared_appointments'),
  (4, 'see_shared_space_activity')
on conflict do nothing;
```

`see_private_memories`, `see_journal`, `see_sensitive` deliberately omitted from every tier. They can only be granted by explicit `permissions` overrides.

### Step 3 — `has_capability` function

```sql
create or replace function public.has_capability(p_person_id uuid, p_capability text)
returns boolean
language plpgsql
stable
security definer
as $$
declare
  v_tier smallint;
  v_tier_grant boolean;
  v_explicit boolean;
begin
  -- Baseline from tier
  select permission_tier into v_tier from public.people where id = p_person_id;
  if v_tier is null then
    return false;
  end if;

  v_tier_grant := exists (
    select 1 from public.tier_capabilities
     where tier = v_tier and capability = p_capability
  );

  -- Explicit override (if any)
  select granted into v_explicit
    from public.permissions
   where person_id = p_person_id and capability = p_capability
   limit 1;

  if v_explicit is not null then
    return v_explicit;
  end if;

  return v_tier_grant;
end $$;
```

### Step 4 — Update `hanu_check_can`

```python
def hanu_check_can(person_id: str, capability: str) -> dict:
    """Return whether `person_id` is granted `capability`. Tier + explicit override."""
    try:
        res = sb().rpc("has_capability", {
            "p_person_id": person_id,
            "p_capability": capability,
        }).execute()
        return _ok(granted=bool(res.data))
    except Exception as e:
        return _err(str(e))
```

### Step 5 — Update `hanu_add_person`

Add `permission_tier: int = 0` to the signature and pass it through to the insert.

### Step 6 — UI

`hanu-v1/project/modals.jsx` — `AddPersonModal` and `EditPersonModal`:

```jsx
<div className="field">
  <label>Permission tier</label>
  <select value={tier} onChange={e => setTier(Number(e.target.value))}>
    <option value="0">0 — Contact only</option>
    <option value="1">1 — Can send requests</option>
    <option value="2">2 — Can share tasks/reminders</option>
    <option value="3">3 — Can ask limited status</option>
    <option value="4">4 — Shared-space co-manager</option>
  </select>
</div>
```

People-screen card: display tier badge alongside name.

`hanu-v1/project/supabase-client.jsx` — `shapePerson` (around line 130-something): add `tier: row.permission_tier`.

### Step 7 — Update `SOUL.md` permission guidance

Replace the existing prose with:

```markdown
## Permissions

Every person has a tier (0-4) plus optional per-capability overrides.
Before answering any question from someone other than the user, call
hanu_check_can(person_id, capability) — it consults both tier and overrides.

Capabilities the agent commonly checks:
- ask_availability — "is Vamshi free?"
- ask_shared_task_state — "did Vamshi do X?"
- create_shared_task / mark_shared_task_done — operations on family tasks
- see_private_memories, see_journal, see_sensitive — never granted by tier;
  require an explicit allow per capability per person

When asked about a capability and denied: respond with a limited answer,
or use hanu_request_approval to forward the question to the user.
Never reveal private memories regardless of tier.
```

---

## Verification

```sql
-- Set up:
do $$
declare uid uuid := 'd804b9ed-5eaa-497c-8390-86ba02007a33';
declare mom uuid;
begin
  insert into public.people (user_id, name, relationship, profile_type, permission_tier)
       values (uid, 'TEST MOM', 'Mother', 'managed', 3)
    returning id into mom;

  -- Tier 3 includes ask_availability:
  raise notice 'mom can ask_availability = %', public.has_capability(mom, 'ask_availability');
  -- Expected: true

  -- Tier 3 does NOT include see_private_memories:
  raise notice 'mom can see_private_memories = %', public.has_capability(mom, 'see_private_memories');
  -- Expected: false

  -- Explicit deny overrides tier grant:
  insert into public.permissions (user_id, person_id, capability, granted)
       values (uid, mom, 'ask_availability', false);
  raise notice 'mom can ask_availability after explicit deny = %',
                public.has_capability(mom, 'ask_availability');
  -- Expected: false

  -- Explicit grant of a non-tier capability:
  insert into public.permissions (user_id, person_id, capability, granted)
       values (uid, mom, 'see_journal', true);
  raise notice 'mom can see_journal after explicit grant = %',
                public.has_capability(mom, 'see_journal');
  -- Expected: true

  delete from public.permissions where person_id = mom;
  delete from public.people where id = mom;
end $$;
```

End-to-end: in the UI, set Mother to tier 2; confirm the People screen badge shows "Tier 2" and that the agent (via `hanu_check_can`) denies `ask_availability` because tier 2 doesn't include it.

---

## Rollback

```sql
drop function if exists public.has_capability(uuid, text);
drop table if exists public.tier_capabilities;
alter table public.people drop column if exists permission_tier;
```

The agent reverts to the prior behavior of querying `permissions` directly.

---

## Files touched

- `supabase/schema.sql` (additions)
- `hermes-hanu-skill/tools.py` (`hanu_check_can`, `hanu_add_person`)
- `hanu-v1/project/SOUL.md` (Permissions section)
- `hermes-hanu-skill/SKILL.md` (Permissions section)
- `hanu-v1/project/modals.jsx` (AddPerson + EditPerson + PersonDetail)
- `hanu-v1/project/screens-b.jsx` (People screen badge)
- `hanu-v1/project/supabase-client.jsx` (`shapePerson`)

---

## Notes

- Tier capability names should match what the agent uses in `hanu_check_can` calls. If the agent uses other strings (e.g., `ask_about_you` per current `SKILL.md`), either add aliases or update the agent's vocabulary. Pick one canonical set and document it in `SOUL.md`.
- Tier 0 doesn't grant anything but still serves as a person record so Hanu can address them in reminders or relays. Don't conflate "tier 0" with "doesn't exist."
- Inheritance is explicit in the `tier_capabilities` data (tier 2 re-lists tier 1 capabilities). That's clearer than a recursive function but means a tier-policy change requires inserting all the rows. Trade-off accepted for v1.
