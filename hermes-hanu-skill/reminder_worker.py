"""
Hanu reminder firing + follow-up + recovery worker.

Three responsibilities, all driven from a 60-second poll loop:

1. FIRE: reminders with scheduled_at <= now, state=pending, fired_at IS NULL
   -> dispatch via Hermes/Baileys, stamp fired_at; recurring reminders are
      re-armed by bumping scheduled_at and clearing fired_at.

2. FOLLOW-UP: reminders that fired but didn't get marked done
   (state=pending AND fired_at IS NOT NULL AND now - max(last_pinged_at, fired_at) >= follow_up_interval_s)
   -> re-ping up to max_pings times; on overflow, transition state to 'missed'
      and ask the user the reason.

3. RECOVERY: goals with the trailing recovery_max_consecutive_misses days
   all marked 'missed' -> send a one-shot recovery conversation; stamp
   last_recovery_at to avoid pestering.

Single-instance via Postgres advisory lock (key 0x48414E55 = 'HANU').
Quiet hours from settings.quiet_hours_* are respected; non-negotiable
priority bypasses them.

Run as systemd unit; see tasks/05-reminder-firing-worker.md docstring
template at the end of this file.
"""
from __future__ import annotations

import os
import re
import subprocess
import time
import traceback
from datetime import datetime, timedelta, timezone

from db import USER_ID, log_activity, sb

POLL_INTERVAL_S = 60
ADVISORY_LOCK_KEY = 0x48414E55  # 'HANU'
USER_WHATSAPP_LID = os.environ.get("HANU_USER_LID")  # e.g. "75935407714503@lid"
RECOVERY_TICK_INTERVAL_S = 6 * 3600


def _now() -> datetime:
    return datetime.now(timezone.utc)


# ---------------------------------------------------------------------------
# Outbound send. Adjust to whatever Hermes/Baileys exposes on this droplet.
# ---------------------------------------------------------------------------

def _send_whatsapp(text: str, urgent: bool = False) -> bool:
    """Send a WhatsApp message to the configured user. Returns True on success."""
    if not USER_WHATSAPP_LID:
        print("[reminder_worker] HANU_USER_LID not set; cannot send", flush=True)
        return False
    try:
        cmd = ["hermes", "send", "--channel", "whatsapp", "--to", USER_WHATSAPP_LID, "--text", text]
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=20)
        if r.returncode == 0:
            return True
        print(f"[reminder_worker] send failed: rc={r.returncode} stderr={r.stderr[:200]}",
              flush=True)
        return False
    except Exception as e:
        print(f"[reminder_worker] send exception: {e!r}", flush=True)
        return False


# ---------------------------------------------------------------------------
# Quiet hours
# ---------------------------------------------------------------------------

def _in_quiet_hours(settings: dict, when: datetime) -> bool:
    qh_start = settings.get("quiet_hours_start")
    qh_end = settings.get("quiet_hours_end")
    if not qh_start or not qh_end:
        return False
    h = when.astimezone().strftime("%H:%M:%S")
    if qh_start <= qh_end:
        return qh_start <= h < qh_end
    return h >= qh_start or h < qh_end


# ---------------------------------------------------------------------------
# Recurrence
# ---------------------------------------------------------------------------

def _next_occurrence(prev: datetime, recur: str) -> datetime | None:
    if recur == "daily":
        return prev + timedelta(days=1)
    if recur == "weekly":
        return prev + timedelta(weeks=1)
    if recur == "monthly":
        # Naive calendar-month; replace with dateutil.relativedelta when correctness matters.
        return prev + timedelta(days=30)
    if recur == "yearly":
        return prev + timedelta(days=365)
    return None  # 'once' or 'custom'


# ---------------------------------------------------------------------------
# Advisory lock
# ---------------------------------------------------------------------------

def _try_lock() -> bool:
    try:
        r = sb().rpc("pg_try_advisory_lock", {"key": ADVISORY_LOCK_KEY}).execute()
        return bool(r.data)
    except Exception:
        return True  # if locking fails, default to running (fewer false skips)


def _unlock() -> None:
    try:
        sb().rpc("pg_advisory_unlock", {"key": ADVISORY_LOCK_KEY}).execute()
    except Exception:
        pass


# ---------------------------------------------------------------------------
# Tick: dispatch due reminders
# ---------------------------------------------------------------------------

def _fire_tick() -> None:
    settings_row = sb().table("settings").select(
        "quiet_hours_start,quiet_hours_end"
    ).eq("user_id", USER_ID).limit(1).execute().data or [{}]
    settings_row = settings_row[0] if settings_row else {}

    due = sb().table("reminders").select(
        "id,title,scheduled_at,recur,priority,needs_confirm,fire_attempts"
    ).eq("user_id", USER_ID).eq("state", "pending").is_(
        "fired_at", "null"
    ).lte("scheduled_at", _now().isoformat()).limit(50).execute().data or []

    for r in due:
        try:
            when = datetime.fromisoformat(r["scheduled_at"].replace("Z", "+00:00"))
            if _in_quiet_hours(settings_row, _now()) and r["priority"] != "non_negotiable":
                continue

            ok = _send_whatsapp(_format_reminder(r), urgent=(r["priority"] == "non_negotiable"))
            if not ok:
                sb().table("reminders").update({
                    "fire_attempts": (r.get("fire_attempts") or 0) + 1,
                    "last_fire_error": "send failed",
                }).eq("id", r["id"]).execute()
                continue

            patch: dict = {"fired_at": _now().isoformat()}
            next_at = _next_occurrence(when, r["recur"])
            if next_at:
                patch["scheduled_at"] = next_at.isoformat()
                patch["fired_at"] = None  # re-arm for next cycle
                patch["last_pinged_at"] = None
                patch["ping_count"] = 0
            sb().table("reminders").update(patch).eq("id", r["id"]).execute()
            log_activity("reminder_fired", f"Fired reminder: {r['title']}", "reminders", r["id"])
        except Exception as e:
            traceback.print_exc()
            sb().table("reminders").update({
                "fire_attempts": (r.get("fire_attempts") or 0) + 1,
                "last_fire_error": str(e)[:300],
            }).eq("id", r["id"]).execute()


def _format_reminder(r: dict) -> str:
    confirm = " (please confirm done)" if r.get("needs_confirm") else ""
    return f"⏰ {r['title']}{confirm}"


# ---------------------------------------------------------------------------
# Tick: follow up on un-acted reminders
# ---------------------------------------------------------------------------

def _followup_tick() -> None:
    settings_row = sb().table("settings").select(
        "quiet_hours_start,quiet_hours_end"
    ).eq("user_id", USER_ID).limit(1).execute().data or [{}]
    settings_row = settings_row[0] if settings_row else {}

    now = _now()
    pending = sb().table("reminders").select(
        "id,title,priority,fired_at,last_pinged_at,ping_count,max_pings,follow_up_interval_s"
    ).eq("user_id", USER_ID).eq("state", "pending").not_.is_(
        "fired_at", "null"
    ).not_.is_("follow_up_interval_s", "null").limit(100).execute().data or []

    for r in pending:
        interval = r["follow_up_interval_s"]
        last_ts = r["last_pinged_at"] or r["fired_at"]
        last_dt = datetime.fromisoformat(last_ts.replace("Z", "+00:00"))
        if (now - last_dt).total_seconds() < interval:
            continue
        if _in_quiet_hours(settings_row, now) and r["priority"] != "non_negotiable":
            continue

        if r["ping_count"] >= r["max_pings"]:
            sb().table("reminders").update({
                "state": "missed",
                "resolved_at": now.isoformat(),
            }).eq("id", r["id"]).execute()
            _send_whatsapp(
                f"You didn't respond to: {r['title']}. "
                "Was it forgotten, too tired, blocked, wrong time, or something else? "
                "Reply with the reason and I'll learn."
            )
            log_activity("reminder_escalated_missed",
                         f"Escalated reminder: {r['title']}",
                         "reminders", r["id"])
            continue

        _send_whatsapp(f"Still pending: {r['title']}")
        sb().table("reminders").update({
            "last_pinged_at": now.isoformat(),
            "ping_count": r["ping_count"] + 1,
        }).eq("id", r["id"]).execute()
        log_activity("reminder_repinged",
                     f"Re-pinged ({r['ping_count'] + 1}/{r['max_pings']}): {r['title']}",
                     "reminders", r["id"])


# ---------------------------------------------------------------------------
# Tick: goal recovery conversation
# ---------------------------------------------------------------------------

def _recovery_tick() -> None:
    today = _now().date()
    goals = sb().table("goals").select(
        "id,title,why,daily_action,recovery_rule,streak,missed_count,last_recovery_at,"
        "recovery_max_consecutive_misses"
    ).eq("user_id", USER_ID).eq("status", "active").execute().data or []

    for g in goals:
        if g.get("last_recovery_at"):
            last = datetime.fromisoformat(g["last_recovery_at"].replace("Z", "+00:00"))
            if (_now() - last).days < 3:
                continue

        n = g["recovery_max_consecutive_misses"]
        recent = sb().table("goal_completions").select("on_date,status").eq(
            "goal_id", g["id"]
        ).gte("on_date", (today - timedelta(days=n)).isoformat()).order(
            "on_date", desc=True
        ).execute().data or []
        if len(recent) < n:
            continue
        if not all(r["status"] == "missed" for r in recent[:n]):
            continue

        _send_whatsapp(
            f"You've missed '{g['title']}' for {n} days. Let's reset.\n\n"
            "Three options:\n"
            "1. Smaller version — give me a 30%-sized daily action you'd actually do.\n"
            "2. Honest reschedule — when will you restart?\n"
            "3. Restart minimum — 1-week ramp from the smallest action.\n\n"
            "Which?"
        )
        sb().table("goals").update({
            "last_recovery_at": _now().isoformat(),
        }).eq("id", g["id"]).execute()
        log_activity("goal_recovery_initiated",
                     f"Recovery for goal: {g['title']}", "goals", g["id"])


# ---------------------------------------------------------------------------
# Optional: parse follow_up_rule -> seconds (called by tools.py hanu_create_reminder)
# ---------------------------------------------------------------------------

_FOLLOWUP_PATTERNS = [
    (re.compile(r"\b(\d+)\s*min", re.IGNORECASE), lambda m: int(m.group(1)) * 60),
    (re.compile(r"\b(\d+)\s*hour", re.IGNORECASE), lambda m: int(m.group(1)) * 3600),
    (re.compile(r"\b(\d+)\s*h\b", re.IGNORECASE),  lambda m: int(m.group(1)) * 3600),
]


def parse_followup_seconds(rule: str | None) -> int | None:
    if not rule:
        return None
    for pat, fn in _FOLLOWUP_PATTERNS:
        m = pat.search(rule)
        if m:
            return fn(m)
    return None


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    last_recovery = 0.0
    while True:
        if _try_lock():
            try:
                _fire_tick()
                _followup_tick()
                if time.time() - last_recovery > RECOVERY_TICK_INTERVAL_S:
                    _recovery_tick()
                    last_recovery = time.time()
            except Exception:
                traceback.print_exc()
            finally:
                _unlock()
        time.sleep(POLL_INTERVAL_S)


if __name__ == "__main__":
    main()
