# 18 — Onboarding: 5-minute first WhatsApp conversation seeds 3 real rows

**Priority:** P3
**Effort:** half a day
**Depends on:** 03 (MCP server) for clean tool routing, 16 (mock sweep) to avoid the empty UI looking broken
**Status:** TODO
**Risk if skipped:** the UI on first run has 0 memories, 0 reminders, 0 people, 0 promises. The dashboard reads as broken even after task 16's empty-state CTAs. The user's first chat with Hanu should leave the dashboard with at least *something* real.

---

## Context

Today, the system is "everything from scratch — talk to Hanu and slowly accumulate." That's correct architecturally and it's what the PRD specifies ("the database starts EMPTY"). But the experience is barren. A short, conversational onboarding flow gives Hanu a chance to seed three concrete rows in five minutes:

1. The user's first name (memory of kind `preference`).
2. The most important person in their life right now (a `people` row).
3. The one thing they want to remember to do this week (an `open_loops` or `reminders` row).

This is not a survey — it's a four-message exchange where Hanu does most of the work.

---

## Acceptance criteria

- The first time the user WhatsApps Hanu (detected by an empty `memories` table for `user_id`), Hanu opens with a calibrated onboarding script.
- The script asks three questions over four messages, no more.
- On each user reply, the corresponding MCP tool (`hanu_save_memory`, `hanu_add_person`, `hanu_create_open_loop`/`hanu_create_reminder`) is called.
- After the four messages, Hanu transitions to normal operation with a "I'm ready" line.
- A flag (e.g., `settings.onboarded_at`) records that onboarding has completed so re-runs don't happen.

---

## Implementation steps

### Step 1 — Add `settings.onboarded_at`

```sql
alter table public.settings
  add column if not exists onboarded_at timestamptz;
```

### Step 2 — `SOUL.md` onboarding section

Add to `hanu-v1/project/SOUL.md` (the persona doc) above the existing "How you grow" section:

```markdown
## First conversation (onboarding)

If hanu_get_settings().onboarded_at is null, the user is meeting Hanu for the
first time. Run this exact script over four turns:

**Turn 1 — opening (you initiate or respond to their first message):**
"Hey. I'm Hanu. I'll remember things for you, hold your promises, and follow up.
Three quick questions to get oriented, then I'm out of your way.

First: what should I call you? (just your first name)"

**Turn 2 — after user replies with their name:**
Call hanu_save_memory(text="Goes by <name>", kind="preference",
  privacy="private", source_type="conversation").
Then ask:
"Got it, <name>. Who's the most important person in your life right now —
the one whose name I should know first? (Just their name and how you know
them — e.g., 'my mom Geeta' or 'my co-founder Aman'.)"

**Turn 3 — after user names a person:**
Call hanu_add_person(name=<extracted>, relationship=<extracted>,
  profile_type="managed" if a family member else "external",
  primary_channel="whatsapp").
Then ask:
"Saved <name> as <relationship>. Last one: what's the single thing
you want to make sure you do this week?"

**Turn 4 — after user replies with the one thing:**
Decide: is this a reminder (time-bound), an open loop (something to finish),
a goal (recurring intent), or a promise (made to someone)? Pick the most
specific. Then call the matching tool with sensible defaults.
Finally:
"Locked in. From now on, just talk to me normally — I'll capture, organize,
and follow up. The dashboard at https://<HANU_HOST>/ shows everything I've
remembered. Anytime."

After turn 4, call hanu_update_setting("onboarded_at", now_iso()).

Never extend onboarding past 4 turns. If the user goes off-script, abandon
the script and behave normally — the dashboard surfaces empty-state CTAs
that point them back to you.
```

### Step 3 — Detect onboarding at start of every turn

Two implementation options:

**Option A — agent-level check (recommended):** rely on the prompt to call `hanu_get_settings` at session start and follow the script if `onboarded_at is null`. This is what SOUL.md asks for. Fragile if the agent skips the check.

**Option B — gateway-level interceptor:** before passing the user's message to the LLM, the gateway checks `settings.onboarded_at`. If null and `messages` count for the user < 5, prepend a synthesized system instruction "this is turn N of onboarding; do X." More reliable but couples the gateway to Hanu specifics.

Pick Option A for v1. Promote to Option B if the agent demonstrably skips onboarding on cold start.

### Step 4 — Tool affordances

`hanu_update_setting` already exists. Add `onboarded_at` to its `allowed` field set in `tools.py:653-658`:

```python
allowed = {
    "active_pause", "quiet_hours_start", "quiet_hours_end",
    "follow_up_intensity", "accountability",
    "ask_before_saving", "ask_before_sharing",
    "tone", "mood", "ambient", "theme",
    "onboarded_at",
}
```

### Step 5 — Dashboard "still in onboarding" indicator

If `settings.onboarded_at is null`, the UI's Today screen hero shows:

```jsx
{HANU.settings.onboardedAt ? null : (
  <div className="onboarding-banner">
    Hanu is getting to know you on WhatsApp. Three quick questions; check
    here when done.
  </div>
)}
```

After completion, the banner disappears; the dashboard renders normally with 1 memory + 1 person + 1 reminder/loop seeded.

---

## Verification

End-to-end on a fresh DB:

1. Reset: `delete from public.memories, people, reminders, open_loops, settings where user_id = '<uid>'` (and re-insert default `settings` row).
2. Send "hi" to the bot via WhatsApp.
3. Reply to each of Hanu's three questions.
4. After turn 4, verify:

```sql
select onboarded_at from public.settings where user_id = '<uid>';
-- non-null

select count(*) from public.memories where user_id = '<uid>';      -- expect 1+
select count(*) from public.people   where user_id = '<uid>';      -- expect 1+
-- One of:
select count(*) from public.reminders  where user_id = '<uid>';
select count(*) from public.open_loops where user_id = '<uid>';
-- Expect 1+ in one of the two.
```

UI: refresh the dashboard; the Today hero shows the new "non-negotiable" or "time-sensitive" item; the People screen shows the saved person; Memory shows the preference.

---

## Rollback

```sql
update public.settings set onboarded_at = null;
delete from public.memories where user_id = '<uid>';
delete from public.people    where user_id = '<uid>';
delete from public.reminders where user_id = '<uid>';
delete from public.open_loops where user_id = '<uid>';
```

(For testing/re-running onboarding.)

Remove the SOUL.md section if the script is abandoned.

---

## Files touched

- `supabase/schema.sql` (`onboarded_at`)
- `hermes-hanu-skill/tools.py` (allow `onboarded_at` in `update_setting`)
- `hanu-v1/project/SOUL.md`
- `hanu-v1/project/supabase-client.jsx` (`shapeSettings` exposes `onboardedAt`)
- `hanu-v1/project/screens-a.jsx` (banner)
- `hanu-v1/project/styles.css` (`.onboarding-banner`)

---

## Notes

- The script wording matters. Iterate from feedback after the first real run; the version above is a starting point.
- The PRD distinguishes "ask before saving" (default true). Onboarding bypasses this for the three seed rows since the user is explicitly answering Hanu's prompts — make this explicit in `SOUL.md` so the model doesn't second-guess and ask "should I save this?" for each onboarding answer.
- If you later add multilingual support, make the script translatable (`SOUL.md` has the English version; have a `SOUL.<lang>.md` per language).
- Onboarding state lives in `settings.onboarded_at`. If a user wants to restart onboarding (rare), expose a "Start over" button in Settings that nulls the column and clears the three seed rows.
