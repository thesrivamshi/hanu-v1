# 05 — Reminder firing worker (Supabase → Hermes → WhatsApp)

**Priority:** P1
**Effort:** 1-2 days
**Depends on:** 03 (MCP server) recommended but not strictly required; can run with existing `hanu_call` path during transition.
**Status:** TODO
**Risk if skipped:** reminders set via WhatsApp land in `reminders` with `scheduled_at` but **never fire**. The product silently fails its core promise.

---

## Context

`BRIDGE_DESIGN.md` §9 punts on this: "Hermes itself has a built-in cron scheduler. We'll lean on that to send reminders at their scheduled time, instead of building a separate worker." That punt is incomplete. Hermes' cron is configured per-job from inside Hermes; it doesn't read `reminders.scheduled_at` from Supabase. Today, nothing watches that column.

We need a worker that:
1. Wakes up on a tick (every 60s).
2. Reads pending reminders where `scheduled_at <= now()`.
3. Sends each as a WhatsApp message via Hermes' gateway.
4. Marks the reminder appropriately:
   - `state='snoozed'` with re-fire time, **or**
   - leaves `state='pending'` (so the follow-up worker can re-ping later — task 06).
5. Idempotent: if the worker restarts mid-batch, it doesn't double-send.

---

## Acceptance criteria

- A worker process runs alongside Hermes (separate systemd unit or a cron job) and ticks every 60 seconds.
- Reminders with `scheduled_at <= now()` and `state='pending'` and `fired_at IS NULL` are dispatched.
- Each dispatched reminder gets `fired_at = now()` and an `activity_log` entry `kind='reminder_fired'`.
- Recurring reminders (`recur != 'once'`) are re-scheduled by setting `scheduled_at = next occurrence` and clearing `fired_at`.
- Idempotency: a worker crash mid-batch and restart does not re-send any already-fired reminder.
- Quiet hours from `settings.quiet_hours_*` are respected: a reminder whose `scheduled_at` falls inside quiet hours is held until `quiet_hours_end` unless `priority = 'non_negotiable'`.

---

## Implementation steps

### Step 1 — Add a `fired_at` column

The existing schema has `resolved_at` (set when user acts on a reminder). We need a separate "dispatched" timestamp:

```sql
alter table public.reminders
  add column if not exists fired_at timestamptz,
  add column if not exists fire_attempts integer not null default 0,
  add column if not exists last_fire_error text;

create index if not exists reminders_pending_fire_idx
  on public.reminders (scheduled_at)
  where state = 'pending' and fired_at is null and scheduled_at is not null;
```

### Step 2 — Define "send a WhatsApp message" interface

The Baileys bridge sits between Hermes and WhatsApp. Hermes has an outbound message API; the worker invokes it. Pick one of:

**Option A:** the worker calls Hermes via its CLI or HTTP API:
```
hermes send --channel whatsapp --to <user_lid> --text "<reminder body>"
```

**Option B:** the worker invokes the Baileys bridge directly. The bridge typically exposes a local HTTP endpoint (e.g., `POST http://127.0.0.1:3000/send`).

**Option C** (cleanest if MCP is done — task 03): add an MCP tool `hanu_send_whatsapp(text)` that wraps the gateway send. The worker uses it.

Pick the option that fits the current droplet setup. Confirm by running `hermes --help` or grepping the Hermes config for outbound endpoints.

### Step 3 — Write the worker

`/root/.hermes/skills/hanu-bridge/reminder_worker.py`:

```python
"""
Hanu reminder firing worker.

Polls Supabase every 60s for pending reminders whose scheduled_at has passed,
dispatches each as a WhatsApp message via Hermes, and marks fired_at.
Recurring reminders are rescheduled. Quiet hours are respected.

Run as a systemd unit (preferred) or as a Hermes cron job. Single-instance
locking is via Postgres advisory locks so a duplicate worker process is a
no-op.
"""
from __future__ import annotations

import os
import time
import traceback
from datetime import datetime, timedelta, timezone

from db import USER_ID, sb, log_activity

POLL_INTERVAL_S = 60
ADVISORY_LOCK_KEY = 0x48414E55  # 'HANU'

USER_WHATSAPP_LID = os.environ.get("HANU_USER_LID")  # e.g. "75935407714503@lid"

def _now():
    return datetime.now(timezone.utc)

def _send_whatsapp(text: str) -> bool:
    """Dispatch a message via Hermes/Baileys. Return True on success.
    Implement per the chosen Option A/B/C above. Below is a placeholder.
    """
    import subprocess
    # Option A: Hermes CLI
    r = subprocess.run(
        ["hermes", "send", "--channel", "whatsapp", "--to", USER_WHATSAPP_LID, "--text", text],
        capture_output=True, text=True, timeout=20,
    )
    return r.returncode == 0

def _in_quiet_hours(settings: dict, when: datetime) -> bool:
    qh_start = settings.get("quiet_hours_start")  # "22:00:00"
    qh_end = settings.get("quiet_hours_end")      # "07:00:00"
    if not qh_start or not qh_end:
        return False
    h = when.astimezone().strftime("%H:%M:%S")
    if qh_start <= qh_end:
        return qh_start <= h < qh_end
    else:
        return h >= qh_start or h < qh_end

def _next_occurrence(prev: datetime, recur: str) -> datetime | None:
    """Compute the next scheduled_at for a recurring reminder."""
    if recur == "daily":
        return prev + timedelta(days=1)
    if recur == "weekly":
        return prev + timedelta(weeks=1)
    if recur == "monthly":
        # Naive: add 30 days. Replace with calendar-correct logic in v2.
        return prev + timedelta(days=30)
    if recur == "yearly":
        return prev + timedelta(days=365)
    return None  # 'once' or 'custom' (custom needs an rrule, deferred)

def _tick():
    # Lock so only one worker process actually fires this tick.
    locked = sb().rpc("pg_try_advisory_lock", {"key": ADVISORY_LOCK_KEY}).execute().data
    if not locked:
        return
    try:
        settings_row = sb().table("settings").select(
            "quiet_hours_start,quiet_hours_end"
        ).eq("user_id", USER_ID).single().execute().data or {}

        due = sb().table("reminders").select(
            "id,title,scheduled_at,recur,priority,needs_confirm,person_id,linked_goal_id"
        ).eq("user_id", USER_ID).eq("state", "pending").is_("fired_at", "null").lte(
            "scheduled_at", _now().isoformat()
        ).limit(50).execute().data or []

        for r in due:
            try:
                when = datetime.fromisoformat(r["scheduled_at"].replace("Z", "+00:00"))
                if _in_quiet_hours(settings_row, when) and r["priority"] != "non_negotiable":
                    # Hold until quiet_hours_end; bump scheduled_at forward by one minute past it.
                    # Simple version: skip this tick; re-check at the next tick.
                    continue

                ok = _send_whatsapp(_format_reminder(r))
                if not ok:
                    sb().table("reminders").update({
                        "fire_attempts": (r.get("fire_attempts") or 0) + 1,
                        "last_fire_error": "send failed",
                    }).eq("id", r["id"]).execute()
                    continue

                # Mark fired
                patch = {"fired_at": _now().isoformat()}
                next_at = _next_occurrence(when, r["recur"])
                if next_at:
                    patch["scheduled_at"] = next_at.isoformat()
                    patch["fired_at"] = None  # re-arm for next cycle
                sb().table("reminders").update(patch).eq("id", r["id"]).execute()

                log_activity("reminder_fired", f"Fired reminder: {r['title']}",
                             "reminders", r["id"])
            except Exception as e:
                traceback.print_exc()
                sb().table("reminders").update({
                    "fire_attempts": (r.get("fire_attempts") or 0) + 1,
                    "last_fire_error": str(e)[:300],
                }).eq("id", r["id"]).execute()
    finally:
        sb().rpc("pg_advisory_unlock", {"key": ADVISORY_LOCK_KEY}).execute()

def _format_reminder(r: dict) -> str:
    confirm = " (please confirm done)" if r.get("needs_confirm") else ""
    return f"⏰ {r['title']}{confirm}"

def main():
    while True:
        try:
            _tick()
        except Exception:
            traceback.print_exc()
        time.sleep(POLL_INTERVAL_S)

if __name__ == "__main__":
    main()
```

### Step 4 — Define the advisory-lock RPCs

Postgres has built-in `pg_try_advisory_lock(bigint)` and `pg_advisory_unlock(bigint)`. Supabase exposes them via REST as RPCs only if a wrapper function is defined. Add:

```sql
create or replace function public.pg_try_advisory_lock(key bigint)
returns boolean language sql security definer as $$
  select pg_try_advisory_lock(key);
$$;

create or replace function public.pg_advisory_unlock(key bigint)
returns boolean language sql security definer as $$
  select pg_advisory_unlock(key);
$$;

grant execute on function public.pg_try_advisory_lock(bigint) to service_role;
grant execute on function public.pg_advisory_unlock(bigint) to service_role;
```

(Or call them via a direct `psql` connection if you prefer to avoid wrapping; the wrapper is simpler.)

### Step 5 — systemd unit

`/etc/systemd/system/hanu-reminder-worker.service`:

```ini
[Unit]
Description=Hanu reminder firing worker
After=network.target hermes-gateway.service
Wants=hermes-gateway.service

[Service]
Type=simple
User=root
EnvironmentFile=/root/.hermes/.env
WorkingDirectory=/root/.hermes/skills/hanu-bridge
ExecStart=/usr/local/lib/hermes-agent/venv/bin/python reminder_worker.py
Restart=always
RestartSec=10
StandardOutput=append:/var/log/hanu/reminder-worker.log
StandardError=append:/var/log/hanu/reminder-worker.log

[Install]
WantedBy=multi-user.target
```

```bash
mkdir -p /var/log/hanu
systemctl daemon-reload
systemctl enable --now hanu-reminder-worker
systemctl status hanu-reminder-worker
```

### Step 6 — Verify against quiet hours

Create a test reminder for "5 minutes from now" via `hanu_create_reminder`. Confirm it fires within 60 seconds of `scheduled_at`. Create a second test reminder for inside quiet hours (e.g., 23:30 if quiet hours are 22:00-07:00). Confirm it does not fire until 07:00.

---

## Verification

```sql
-- Create a fire-soon reminder
do $$
declare uid uuid := 'd804b9ed-5eaa-497c-8390-86ba02007a33';
declare rid uuid;
begin
  insert into public.reminders (user_id, title, scheduled_at, scheduled_text, recur, priority, state)
       values (uid, 'TEST FIRE', now() + interval '70 seconds', 'in 70s', 'once', 'normal', 'pending')
    returning id into rid;
  raise notice 'created %', rid;
end $$;

-- Wait 2 minutes, then check:
select id, title, fired_at, state from public.reminders where title = 'TEST FIRE';
-- Expect: fired_at non-null, state still 'pending' (the user marks it done from chat/UI later).

select kind, summary, created_at from public.activity_log
 where kind = 'reminder_fired' and target_id in (
   select id from public.reminders where title = 'TEST FIRE'
 );
-- Expect: one row.

-- Cleanup
delete from public.reminders where title = 'TEST FIRE';
```

End-to-end: WhatsApp "remind me to test in 2 minutes" → agent calls `hanu_create_reminder` → worker fires after the scheduled time → user sees a WhatsApp message from the bot.

---

## Rollback

```bash
systemctl disable --now hanu-reminder-worker
rm /etc/systemd/system/hanu-reminder-worker.service
systemctl daemon-reload
```

The schema additions (`fired_at`, `fire_attempts`, `last_fire_error`) are non-destructive; leave them in place.

---

## Files touched

- `supabase/schema.sql` — new columns on `reminders`, advisory lock RPCs.
- `hermes-hanu-skill/reminder_worker.py` — new file.
- `/etc/systemd/system/hanu-reminder-worker.service` — new file (droplet only).
- `/var/log/hanu/reminder-worker.log` — created at runtime.

---

## Notes

- The naive `monthly` next-occurrence (`+30 days`) is wrong for calendar months. Replace with `dateutil.relativedelta` or `pg`'s `interval '1 month'` when correctness matters.
- `recur = 'custom'` (with a free-text rule) is deferred. Either reject custom recurrences in `hanu_create_reminder`, or write an rrule parser.
- For higher fidelity than 60s polling, switch to Supabase realtime: subscribe to `reminders` INSERTs and dispatch immediately if `scheduled_at <= now()`, otherwise schedule a one-shot timer. v1 polling is fine.
- The advisory lock prevents two workers from firing the same reminder twice if you accidentally start two. It does NOT prevent a worker crash mid-send from leaving `fired_at = null` after the message actually went out. For that, use a two-phase write: stamp `fired_at` BEFORE calling `_send_whatsapp`, and treat send failures as "marked fired but message lost" — accept the rare lost message in favor of "never duplicate." For non-negotiable reminders, surface send failures in the activity log so the user can manually retry.
