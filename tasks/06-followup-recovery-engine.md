# 06 — Follow-up + recovery engine

**Priority:** P1
**Effort:** 2-3 days
**Depends on:** 05 (reminder firing worker)
**Status:** TODO
**Risk if skipped:** PRD's "Hanu reminders should not be fire-and-forget" promise is unmet. The product behaves like a calendar app, not an accountability partner.

---

## Context

PRD §reminders specifies a 4-step flow:

1. Reminder sent.
2. No response → Hanu follows up based on priority + user's chosen strictness.
3. Still no response → Hanu asks for reason, marks missed, escalates if permission exists.
4. Recovery: suggest smallest action, honest reschedule, or plan change.

Schema columns exist (`reminders.follow_up_rule`, `reminders.miss_reason`, `goals.recovery_rule`); nothing executes them.

We need:
- **Follow-up worker:** for each fired reminder still in `state='pending'` after `follow_up_rule`'s interval, re-ping. After N re-pings, escalate to "ask reason, mark missed".
- **Recovery flow:** for each missed goal, the LLM proposes a smaller action, honest reschedule, or pause, per the goal's `recovery_rule`.

---

## Acceptance criteria

- A reminder fired at `T0` with `follow_up_rule='Re-ping after 15 min'` that is still pending at `T0+15min` triggers a second message.
- After max re-pings (default 3) without response, reminder transitions to `state='missed'`, and a synthesized LLM message asks for the reason.
- When the user replies with a reason (free text or one of the 9 PRD categories), the reminder gets `miss_reason` set and `activity_log` entry `kind='reminder_missed_with_reason'`.
- For goals: missing a daily check-in for `recovery_rule_max_misses` days in a row triggers a "recovery conversation": LLM proposes (a) smaller action, (b) reschedule, (c) restart minimum.
- All of the above respect quiet hours (escalation cannot fire during quiet hours unless `priority='non_negotiable'`).

---

## Implementation steps

### Step 1 — Extend schema

```sql
-- Follow-up tracking on reminders:
alter table public.reminders
  add column if not exists last_pinged_at timestamptz,
  add column if not exists ping_count integer not null default 0,
  add column if not exists max_pings integer not null default 3;

-- Parsed follow-up interval (we keep follow_up_rule as free text but
-- also cache a parsed seconds value):
alter table public.reminders
  add column if not exists follow_up_interval_s integer;

-- Recovery state on goals:
alter table public.goals
  add column if not exists last_recovery_at timestamptz,
  add column if not exists recovery_max_consecutive_misses integer not null default 3;

create index if not exists reminders_followup_idx
  on public.reminders (last_pinged_at)
  where state = 'pending' and fired_at is not null;
```

### Step 2 — Parse `follow_up_rule` at write time

In `tools.py`, extend `hanu_create_reminder` to set `follow_up_interval_s` from `follow_up_rule`. Naive parser:

```python
_FOLLOWUP_PATTERNS = {
    r"\b(\d+)\s*min": lambda m: int(m.group(1)) * 60,
    r"\b(\d+)\s*hour": lambda m: int(m.group(1)) * 3600,
    r"\b(\d+)\s*h\b": lambda m: int(m.group(1)) * 3600,
}
def _parse_followup_seconds(rule: str | None) -> int | None:
    if not rule:
        return None
    import re
    for pat, fn in _FOLLOWUP_PATTERNS.items():
        m = re.search(pat, rule, re.IGNORECASE)
        if m:
            return fn(m)
    return None
```

Set `follow_up_interval_s` in the insert payload alongside `follow_up_rule`.

### Step 3 — Follow-up tick in the reminder worker

Extend `reminder_worker.py` (task 05). Add a second function called from the same tick:

```python
def _followup_tick():
    settings_row = sb().table("settings").select(
        "quiet_hours_start,quiet_hours_end"
    ).eq("user_id", USER_ID).single().execute().data or {}

    now = _now()
    # Reminders fired but not yet resolved, with an interval set:
    pending = sb().table("reminders").select(
        "id,title,priority,fired_at,last_pinged_at,ping_count,max_pings,follow_up_interval_s"
    ).eq("user_id", USER_ID).eq("state", "pending").not_.is_("fired_at", "null") \
     .not_.is_("follow_up_interval_s", "null").limit(100).execute().data or []

    for r in pending:
        interval = r["follow_up_interval_s"]
        last = r["last_pinged_at"] or r["fired_at"]
        last_dt = datetime.fromisoformat(last.replace("Z", "+00:00"))
        if (now - last_dt).total_seconds() < interval:
            continue

        if _in_quiet_hours(settings_row, now) and r["priority"] != "non_negotiable":
            continue

        if r["ping_count"] >= r["max_pings"]:
            # Escalate to missed; ask the user the reason.
            sb().table("reminders").update({
                "state": "missed",
                "resolved_at": now.isoformat(),
            }).eq("id", r["id"]).execute()
            _send_whatsapp(
                f"You didn't respond to: {r['title']}. "
                "Was it forgotten, too tired, blocked, wrong time, or something else? "
                "(reply with the reason and I'll learn)"
            )
            log_activity("reminder_escalated_missed",
                         f"Escalated reminder: {r['title']}",
                         "reminders", r["id"])
            continue

        # Re-ping
        _send_whatsapp(f"Still pending: {r['title']}")
        sb().table("reminders").update({
            "last_pinged_at": now.isoformat(),
            "ping_count": r["ping_count"] + 1,
        }).eq("id", r["id"]).execute()
        log_activity("reminder_repinged",
                     f"Re-pinged ({r['ping_count']+1}/{r['max_pings']}): {r['title']}",
                     "reminders", r["id"])
```

Call `_followup_tick()` immediately after `_tick()` in the worker's main loop.

### Step 4 — Handle the "user replies with a reason" path

When the user replies to an escalation message, the LLM (Hanu) interprets the response and calls `hanu_mark_reminder(id, state='missed', miss_reason=<reason>)`. The MCP tool already exists (`tools.py`). What's needed is the **agent prompt** so the LLM knows: when an escalation just went out and the user replies in free text, treat that reply as the miss_reason.

Add to `SOUL.md` (after the routing-rule trim from task 03):

```markdown
## Follow-up replies

After Hanu has escalated a missed reminder ("Was it forgotten, too tired, blocked,
wrong time, or something else?"), the user's next free-text reply is the miss reason.
Map their words to the closest of the 9 PRD reasons:
`forgot, tired, avoided, overplanned, no_time, blocked, wrong_time, too_big, not_important_anymore`.
Then call hanu_mark_reminder(id, state='missed', miss_reason='<mapped>').
Acknowledge with one sentence, then propose the recovery action from
the reminder's linked goal if there is one.
```

### Step 5 — Recovery flow for goals

A goal's recovery is conceptually:

1. Detect: `goals.streak == 0 AND missed_count_last_3_days >= goals.recovery_max_consecutive_misses`.
2. Send the user a "recovery conversation" prompt that includes:
   - The goal title and why.
   - The current daily_action.
   - Three options:
     - **Smaller action**: "What's a 30%-sized version you'd actually do tomorrow?"
     - **Honest reschedule**: "When would you realistically restart?"
     - **Restart minimum**: a 1-week ramp from a minimum action.
3. Whatever the user picks, call `hanu_update_goal(id, daily_action=<new>, recovery_rule=<resolved>)` and stamp `last_recovery_at = now()`.

Add a new worker function `_recovery_tick()` (every 6 hours is plenty):

```python
def _recovery_tick():
    # Find goals likely needing recovery.
    today = _now().date()
    goals = sb().table("goals").select(
        "id,title,why,daily_action,recovery_rule,streak,missed_count,last_recovery_at,"
        "recovery_max_consecutive_misses"
    ).eq("user_id", USER_ID).eq("status", "active").execute().data or []

    for g in goals:
        # Skip goals we recently recovered (don't pester)
        if g.get("last_recovery_at"):
            last = datetime.fromisoformat(g["last_recovery_at"].replace("Z", "+00:00"))
            if (_now() - last).days < 3:
                continue

        # Look at last N days of completions
        n = g["recovery_max_consecutive_misses"]
        recent = sb().table("goal_completions").select("on_date,status").eq(
            "goal_id", g["id"]
        ).gte("on_date", (today - timedelta(days=n)).isoformat()).order(
            "on_date", desc=True
        ).execute().data or []

        # Are the last N days all missed?
        if len(recent) < n:
            continue
        if not all(r["status"] == "missed" for r in recent[:n]):
            continue

        # Trigger recovery conversation
        _send_whatsapp(
            f"You've missed '{g['title']}' for {n} days. Let's reset.\n\n"
            f"Three options:\n"
            f"1. Smaller version — give me a 30%-sized daily action you'd actually do.\n"
            f"2. Honest reschedule — when will you restart?\n"
            f"3. Restart minimum — 1-week ramp from the smallest action.\n\n"
            f"Which?"
        )
        sb().table("goals").update({
            "last_recovery_at": _now().isoformat(),
        }).eq("id", g["id"]).execute()
        log_activity("goal_recovery_initiated",
                     f"Recovery for goal: {g['title']}",
                     "goals", g["id"])
```

Call `_recovery_tick()` from the worker on a less-frequent cadence:

```python
last_recovery = 0
while True:
    try:
        _tick()
        _followup_tick()
        if time.time() - last_recovery > 6 * 3600:
            _recovery_tick()
            last_recovery = time.time()
    except Exception:
        traceback.print_exc()
    time.sleep(POLL_INTERVAL_S)
```

### Step 6 — Agent handling of recovery replies

Add to `SOUL.md`:

```markdown
## Recovery replies

After Hanu has initiated a goal recovery ("Three options: 1. Smaller version, 2.
Honest reschedule, 3. Restart minimum. Which?"), the user's next reply is
their choice + the new daily action (or reschedule date). Call
hanu_update_goal(id, daily_action=<new>, recovery_rule=<one-sentence summary>)
and confirm in one sentence.
```

---

## Verification

```sql
-- Test follow-up: create a reminder that fires in 30s with a 60s follow-up:
do $$
declare uid uuid := 'd804b9ed-5eaa-497c-8390-86ba02007a33';
declare rid uuid;
begin
  insert into public.reminders (
    user_id, title, scheduled_at, scheduled_text, recur, priority, state,
    follow_up_rule, follow_up_interval_s, max_pings
  ) values (
    uid, 'TEST FOLLOWUP', now() + interval '30 seconds', 'soon',
    'once', 'normal', 'pending', 'Re-ping every 1 min', 60, 2
  ) returning id into rid;
  raise notice 'created %', rid;
end $$;

-- Wait 4 minutes. Then:
select title, fired_at, last_pinged_at, ping_count, state, miss_reason
  from public.reminders where title = 'TEST FOLLOWUP';
-- Expected: fired_at within 60s of creation; ping_count = 2; state = 'missed'
-- (because max_pings was 2 and they elapsed without acting).

select kind, summary, created_at from public.activity_log
 where target_id in (select id from public.reminders where title = 'TEST FOLLOWUP')
 order by created_at;
-- Expected: reminder_fired, reminder_repinged x2, reminder_escalated_missed.

-- Cleanup
delete from public.reminders where title = 'TEST FOLLOWUP';
```

Recovery: create a goal, log 3 missed days in a row, wait for the next 6-hour recovery tick (or call `_recovery_tick()` manually from a Python REPL on the droplet). Expect a WhatsApp message and an `activity_log` row `kind='goal_recovery_initiated'`.

---

## Rollback

```sql
-- Remove the added columns if needed (preserves no data dependency):
alter table public.reminders
  drop column if exists last_pinged_at,
  drop column if exists ping_count,
  drop column if exists max_pings,
  drop column if exists follow_up_interval_s;
alter table public.goals
  drop column if exists last_recovery_at,
  drop column if exists recovery_max_consecutive_misses;
```

Stop the worker; remove the follow-up + recovery functions from `reminder_worker.py`.

---

## Files touched

- `supabase/schema.sql` (schema additions)
- `hermes-hanu-skill/tools.py` (parse `follow_up_rule`)
- `hermes-hanu-skill/reminder_worker.py` (add `_followup_tick`, `_recovery_tick`)
- `hanu-v1/project/SOUL.md` (add follow-up-reply and recovery-reply handling sections)

---

## Notes

- Mapping free-text user replies to the 9 PRD reason categories is fragile in v1. Two improvements later: (a) at escalation time, send the 9 categories as numbered options so the user can reply "3"; (b) train a small classifier.
- The recovery tick runs every 6 hours. That's deliberately slow — recovery prompts are heavy and pestering users hurts. Tune per usage.
- Follow-up re-pings during quiet hours are deferred to `quiet_hours_end`. Confirm that the implementation skips, not delays-with-bump — skipping is simpler and the next tick will pick it up at the right time anyway.
- This task implements behavior the PRD specifies. Tune the exact wording of escalation/recovery messages by hand once the user has tried them live — the strings above are placeholders that work but don't sing.
