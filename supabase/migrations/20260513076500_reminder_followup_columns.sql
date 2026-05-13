-- Migration: reminders fire/follow-up state columns.
-- Per tasks/05-reminder-firing-worker.md and tasks/06-followup-recovery-engine.md.

alter table public.reminders
  add column if not exists fired_at              timestamptz,
  add column if not exists fire_attempts         integer not null default 0,
  add column if not exists last_fire_error       text,
  add column if not exists last_pinged_at        timestamptz,
  add column if not exists ping_count            integer not null default 0,
  add column if not exists max_pings             integer not null default 3,
  add column if not exists follow_up_interval_s  integer;

create index if not exists reminders_pending_fire_idx
  on public.reminders (scheduled_at)
  where state = 'pending' and fired_at is null and scheduled_at is not null;

create index if not exists reminders_followup_idx
  on public.reminders (last_pinged_at)
  where state = 'pending' and fired_at is not null;

-- Recovery state on goals (task 06).
alter table public.goals
  add column if not exists last_recovery_at                  timestamptz,
  add column if not exists recovery_max_consecutive_misses   integer not null default 3;
