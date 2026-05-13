# 04 — Postgres trigger maintaining `goals.streak` / `missed_count` / `risk`

**Priority:** P1
**Effort:** 2-4 hours
**Depends on:** none
**Status:** TODO
**Risk if skipped:** the docs (`BRIDGE_DESIGN.md` §3, `tools.py:288` comment) claim these columns are recomputed by trigger; in fact they are never updated and stay at defaults forever. The UI's "Streak: X days" badge on Today and the goal cards on the Goals screen are permanently lying.

---

## Context

Schema (`supabase/schema.sql:235-262`):

```sql
streak          integer not null default 0,
missed_count    integer not null default 0,
risk            text not null default 'low',
next_check_in_at timestamptz,
```

The `goal_completions` table records daily outcomes. The agent calls `hanu_log_goal_completion(...)` which inserts a row. Nothing then updates `goals`. So:

- `streak` stays at 0 even after 10 consecutive `'done'` days.
- `missed_count` stays at 0 even after 5 misses.
- `risk` stays at `'low'` regardless of recent misses.

This task adds a Postgres trigger on `goal_completions` AFTER INSERT/UPDATE that recomputes the three derived columns on the parent `goals` row.

---

## Acceptance criteria

- Inserting a `goal_completions` row with `status='done'` for today, on a goal with no prior completions, sets `goals.streak = 1`.
- Inserting consecutive daily `'done'` rows extends the streak by 1 per day.
- A `'missed'` row breaks the streak to 0 and increments `missed_count` (within the trailing 30 days).
- `risk` is recomputed: `'high'` if missed ≥ 3 in last 7 days, `'medium'` if 1-2 missed in last 7, `'low'` otherwise.
- Backfill: existing goals get their streak/missed/risk recomputed once after deployment.
- Trigger fires AFTER INSERT/UPDATE on `goal_completions`; no behavior on DELETE for v1.

---

## Implementation steps

### Step 1 — Define the recomputation function

```sql
-- Recompute streak, missed_count, and risk for a single goal.
-- Pure function: reads goal_completions, writes goals. Safe to call from trigger.

create or replace function public.recompute_goal_stats(p_goal_id uuid)
returns void
language plpgsql
security definer
as $$
declare
  v_streak integer := 0;
  v_missed_30 integer := 0;
  v_missed_7  integer := 0;
  v_risk text;
  v_cursor date := current_date;
  v_status text;
begin
  -- Walk back day by day; count consecutive 'done' days ending today.
  -- Stop at the first non-done day or first gap.
  loop
    select status into v_status
      from public.goal_completions
     where goal_id = p_goal_id
       and on_date = v_cursor
     limit 1;
    if v_status is null or v_status != 'done' then
      exit;
    end if;
    v_streak := v_streak + 1;
    v_cursor := v_cursor - 1;
  end loop;

  -- Missed counts (last 30 and last 7 days).
  select count(*) into v_missed_30
    from public.goal_completions
   where goal_id = p_goal_id
     and status = 'missed'
     and on_date >= current_date - 30;

  select count(*) into v_missed_7
    from public.goal_completions
   where goal_id = p_goal_id
     and status = 'missed'
     and on_date >= current_date - 7;

  -- Risk rule:
  if v_missed_7 >= 3 then
    v_risk := 'high';
  elsif v_missed_7 >= 1 then
    v_risk := 'medium';
  else
    v_risk := 'low';
  end if;

  update public.goals
     set streak       = v_streak,
         missed_count = v_missed_30,
         risk         = v_risk,
         updated_at   = now()
   where id = p_goal_id;
end $$;
```

### Step 2 — Define the trigger

```sql
create or replace function public.tg_goal_completions_after_change()
returns trigger
language plpgsql
security definer
as $$
begin
  if TG_OP = 'DELETE' then
    perform public.recompute_goal_stats(OLD.goal_id);
    return OLD;
  else
    perform public.recompute_goal_stats(NEW.goal_id);
    return NEW;
  end if;
end $$;

drop trigger if exists goal_completions_after_change on public.goal_completions;
create trigger goal_completions_after_change
  after insert or update or delete on public.goal_completions
  for each row execute function public.tg_goal_completions_after_change();
```

### Step 3 — Backfill existing data

```sql
do $$
declare gid uuid;
begin
  for gid in select id from public.goals loop
    perform public.recompute_goal_stats(gid);
  end loop;
end $$;
```

This is idempotent and safe to re-run.

### Step 4 — Optional: nightly safety-net job

Streak is dependent on the calendar advancing. If a goal had `streak=5` on 2026-05-13 and the user did **nothing** on 2026-05-14, the streak should drop to 0 the moment 2026-05-15 starts (since no `'done'` row for 2026-05-14). The trigger only fires when `goal_completions` changes, so it won't catch this.

Add a daily Postgres job (via Hermes' cron or `pg_cron` extension if enabled on your Supabase tier) that re-runs `recompute_goal_stats` for every active goal:

```sql
-- Run daily at 00:05 user time. If pg_cron is unavailable, run from Hermes' cron.
do $$
declare gid uuid;
begin
  for gid in select id from public.goals where status = 'active' loop
    perform public.recompute_goal_stats(gid);
  end loop;
end $$;
```

In Hermes' cron, schedule this as a daily job that calls a small Python script invoking the MCP tool `hanu_recompute_all_goals` (which you can add to `tools.py` as a wrapper around the SQL block).

---

## Verification

```sql
-- Set up a test goal:
do $$
declare gid uuid;
declare uid uuid := 'd804b9ed-5eaa-497c-8390-86ba02007a33';
begin
  insert into public.goals (user_id, title, why, priority, commitment, daily_action)
       values (uid, 'TEST: post daily', 'verify trigger', 'normal', 'planned', 'one post')
    returning id into gid;

  -- 5 consecutive done days ending today:
  insert into public.goal_completions (goal_id, user_id, on_date, status)
       values (gid, uid, current_date,     'done'),
              (gid, uid, current_date - 1, 'done'),
              (gid, uid, current_date - 2, 'done'),
              (gid, uid, current_date - 3, 'done'),
              (gid, uid, current_date - 4, 'done');

  perform pg_sleep(0.1);
  raise notice 'streak = % (expect 5)',
               (select streak from public.goals where id = gid);

  -- Break the streak with a miss two days ago:
  insert into public.goal_completions (goal_id, user_id, on_date, status, reason)
       values (gid, uid, current_date - 5, 'missed', 'tired')
    on conflict (goal_id, on_date) do update set status = 'missed', reason = 'tired';

  -- Streak from today back is still 5 (the miss is 5 days back), but missed_count = 1
  raise notice 'streak after miss-5d = %, missed = % (expect 5, 1)',
               (select streak from public.goals where id = gid),
               (select missed_count from public.goals where id = gid);

  -- Add a miss today; streak should reset to 0
  insert into public.goal_completions (goal_id, user_id, on_date, status, reason)
       values (gid, uid, current_date, 'missed', 'forgot')
    on conflict (goal_id, on_date) do update set status = 'missed', reason = 'forgot';

  raise notice 'streak after miss-today = % (expect 0)',
               (select streak from public.goals where id = gid);
  raise notice 'risk = % (expect medium or high)',
               (select risk from public.goals where id = gid);

  -- Cleanup
  delete from public.goals where id = gid;
end $$;
```

---

## Rollback

```sql
drop trigger if exists goal_completions_after_change on public.goal_completions;
drop function if exists public.tg_goal_completions_after_change();
drop function if exists public.recompute_goal_stats(uuid);
```

Backfilled values stay in `goals.streak` etc. — that's fine.

---

## Files touched

- `supabase/schema.sql` (add the function + trigger block)
- Optional: `hermes-hanu-skill/tools.py` to expose `hanu_recompute_all_goals` for cron use.

---

## Notes

- The "streak" definition here is "consecutive `'done'` days ending **today**." If the user has no entry for today yet (mid-day), `recompute_goal_stats` will return `streak = 0`. Decide whether to start counting from `current_date - 1` instead — the answer depends on UI expectations. Document the choice in `BRIDGE_DESIGN.md`.
- `recompute_goal_stats` is `security definer`. Make sure the function is owned by the schema owner so it can update `goals` regardless of RLS. The trigger runs only in response to legitimate `goal_completions` writes that already passed RLS.
- The current `risk` calculation is a simple heuristic. The PRD mentions richer risk signals (e.g., commitment level, days-until-deadline). Wire them in once data exists to validate the rule.
