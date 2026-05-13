# Hanu Bridge Design — How Hermes, Supabase, and the UI Talk

A plain-English design doc for the layer that connects the three parts of Hanu.

This document is the design, not the code. After you approve it, the next step is to actually write the Hermes skill, deploy everything, and wire the UI.

---

## 1. The shape of the system, in one paragraph

The Hermes agent runs on your DigitalOcean droplet, listening on WhatsApp and the terminal. Hermes keeps its internal SQLite database untouched — that's its own bookkeeping (sessions, FTS5 search, internal skills state). Beside Hermes runs a small "Hanu skill" — a Python module that gives Hermes a set of tools like `save_memory`, `create_reminder`, `log_decision`. When you WhatsApp "remind me to call mom at 7pm," Hermes uses the `create_reminder` tool, which writes a row to your Supabase Postgres database. The UI — the React app you already designed — talks to Supabase directly through Supabase's auto-generated REST API. When you tap something in the UI to mark a reminder done, Supabase emits a real-time event; the Hermes skill subscribes to those events and reacts. The result is one source of truth (Supabase), one agent (Hermes), and one UI — all kept in sync without any custom backend.

---

## 2. Who writes what, where

There are three "writers" in this system. Knowing which writer is responsible for what avoids race conditions.

**Hermes (the WhatsApp agent)** writes to: `messages`, `conversations`, `memories`, `memory_inbox`, `reminders`, `open_loops`, `goals`, `goal_completions`, `promises`, `decisions`, `approvals`, `routines`, `appointments`, `daily_reviews`, `activity_log`. Hermes triggers on incoming WhatsApp messages and on its own internal scheduler.

**The UI (you tapping)** writes to: every table listed above EXCEPT `messages` and `conversations`. The UI never writes raw messages — those only come from Hermes. The UI does write user-initiated edits: marking reminders done, editing memories, approving requests, creating goals, changing settings.

**Supabase (the database)** writes nothing on its own. But it has triggers we configure — for example, when a memory is saved we auto-compute its embedding (via a Postgres function calling an embedding API) so semantic search works.

---

## 3. The Hanu skill — Hermes's hands

A Hermes "skill" is a Python folder that drops into Hermes's skills directory. We'll create `~/.hermes/skills/hanu-bridge/`. It contains:

- `SKILL.md` — instructions Hermes reads to know when to use the skill
- `tools.py` — Python functions Hermes can call
- `db.py` — Supabase connection helpers
- `events.py` — Supabase real-time event subscribers
- `__init__.py` — wires it all up

The skill exposes the tools below. Every tool writes to Supabase, returns a structured success/error response to Hermes, and writes an `activity_log` row so we can see what Hermes did and why.

### Memory tools

`save_memory(text, kind, privacy="private", source="conversation", pinned=False)` — writes to `memories`. Use when the user explicitly says "remember that..." or "save this..."

`propose_memory(text, kind, confidence, suggested_privacy="private")` — writes to `memory_inbox` (not directly to `memories`). Use when Hermes notices something memory-worthy in conversation but the user didn't explicitly ask to save it. The user later approves or rejects from the Memory Inbox in the UI.

`update_memory(id, text=None, privacy=None, pinned=None)` — used when the user says "actually, that was wrong" or "make that private."

`forget_memory(id)` — soft delete; sets `archived = true`. Hard delete only on explicit double-confirmed request.

`search_memories(query, kind=None, privacy_max="shared_space", limit=10)` — semantic + keyword search across user's memories. Returns text + metadata. Used to give Hermes the context it needs to answer questions like "what did I tell Mother about..."

### Reminder tools

`create_reminder(title, when, recur="once", priority="normal", category="personal", person_id=None, needs_confirm=False, follow_up_rule=None)` — writes to `reminders`. Parses `when` (free text like "today 21:00", "tomorrow morning", "Fri 18:00") into both `scheduled_at` (UTC timestamp) and `scheduled_text` (human-friendly).

`mark_reminder(id, status, miss_reason=None)` — set status to done/missed/snoozed/cancelled.

`list_reminders(when="today")` — pull pending reminders for a time window so Hermes can list them when asked.

### Goal tools

`create_goal(title, why, priority, commitment, daily_action, recovery_rule, check_in_time, promise_to_person_id=None)` — writes to `goals`.

`log_goal_completion(goal_id, status, reason=None, note=None)` — writes a row to `goal_completions`. The streak/missed_count fields on `goals` are recomputed by a Postgres trigger.

`update_goal(id, ...)` — edits.

### Open-loop tools

`detect_open_loops(message_text)` — analyzes a "dump" message and proposes open loops. Writes proposals to `memory_inbox` (with `suggested_kind = 'project'` or similar). User approves to convert into real `open_loops` rows.

`create_open_loop(title, owner_text, state, owner_person_id=None)` — direct creation.

`update_open_loop(id, state=None, postponed_count=None)` — for postponing or closing.

### Promise + decision tools

`create_promise(text, to_person_id, due_at=None, due_text=None, follow_up_rule=None)` — writes to `promises`.

`mark_promise(id, kept_or_broken)` — sets state and increments counter.

`log_decision(title, area, why, revisit_rule, related_person_ids=[], tags=[])` — writes to `decisions`.

### People + permissions tools

`add_person(name, relationship, profile_type, primary_channel="whatsapp", whatsapp_number=None, tone=None)` — writes to `people`. If profile_type is `managed`, also creates a default permission set (can_confirm_reminders=true, others=false).

`update_person(id, ...)` — edits.

`set_permission(person_id, capability, granted, scope=None)` — writes to `permissions`.

`check_can(person_id, capability)` — returns true/false. Hermes calls this before answering any cross-person question. This is how the PRD's "permission tiers 0–4" actually get enforced.

### Approval tools

`request_approval(from_person_id, question, context, suggested_action)` — writes to `approvals` with state=pending. Hermes calls this when an external person (like Mother) asks Hermes something that needs your green-light.

`respond_to_approval(id, action, reply_text=None, rule_to_create=None)` — when the user taps approve/deny in the UI, the UI writes directly to `approvals`. The Hermes side just reads the resolved approval and acts on the reply.

### Conversation tools

`log_message(conversation_id, role, content, raw_payload=None, channel_message_id=None)` — every WhatsApp message in or out goes here. This is what powers "Ask Hanu" search later.

`get_or_create_conversation(person_id, channel, external_id)` — used when a new chat thread starts.

### Other

`record_daily_review(date, slot, done, note)` — for morning/midday/evening reviews. `slot` is one of 'morning', 'midday', 'evening'.

`update_settings(field, value)` — when the user says "quiet hours start at 11 from now on" in chat.

`log_activity(kind, summary, target_table, target_id, reason=None, visible_to=[])` — every other tool already does this internally, but the agent can also log freeform activity.

---

## 4. How Hermes decides to use the tools

The Hanu skill's `SKILL.md` is the instruction file Hermes reads. It tells Hermes:

- This is Hanu. Your job is to help the user manage memory, reminders, goals, promises, people, and approvals.
- Use these tools instead of your own internal memory/reminder system. (We'll disable Hermes' built-in memory tool for this skill so there's no conflict.)
- When the user says "remember X" → `save_memory`. When you notice something memory-worthy unprompted → `propose_memory`. Never save silently to memories without going through propose.
- When the user dumps a thought ("Razorpay, call Aman, pricing..."), use `detect_open_loops` to extract candidates, then ASK the user which to save.
- Before sharing any information about the user with another person (e.g. Mother asks "Is Aarav free?"), always check `check_can` for the relevant permission. If denied, use the limited-answer pattern from the PRD.
- For every action you take that affects another person (sending a reminder, relaying a message), call `log_activity` so the user can audit it.
- Tone follows the user's `settings.tone` value (calm/firm/strict). Tone copy is in `TONE_COPY` from the UI and we'll mirror it in the skill.

This is how the behavior from the PRD actually shows up in real conversations.

---

## 5. How the UI talks to Supabase

The UI does not need a separate backend. Supabase provides three things out of the box:

**Auto-generated REST API.** Every table is automatically a REST endpoint. The UI uses the `@supabase/supabase-js` library and writes things like `supabase.from('memories').select('*').eq('user_id', currentUser.id)`. Row Level Security (enabled in the schema) makes sure each user only sees their own rows even though the API is the same for everyone.

**Real-time subscriptions.** The UI subscribes to changes: `supabase.from('reminders').on('INSERT', handler)`. When Hermes inserts a new reminder, the UI sees it within milliseconds — no polling, no refresh needed.

**Auth.** Supabase handles login (magic link email, Google, Apple, etc.). The UI uses `supabase.auth.signInWithOtp(...)` and the user gets an email; clicking it logs them in. This becomes important when family members eventually have their own logins.

For v1 — you alone — we hard-code a single user account, skip auth UI complexity, and revisit when family joins.

---

## 6. Real-time loop: UI → Supabase → Hermes

The "two-way" magic works like this. When you tap "approve" on an approval card in the UI:

1. UI calls `supabase.from('approvals').update({state: 'approved', reply_text: '...'}).eq('id', id)`.
2. Supabase updates the row. RLS verifies you own it.
3. Supabase emits a real-time event on the `approvals` table.
4. The Hanu skill's `events.py` is subscribed to `approvals UPDATE WHERE state = 'approved'`. It sees the event.
5. The skill sends the reply to the relevant person over WhatsApp via Hermes' gateway.
6. The skill writes an `activity_log` row recording what was sent and to whom.

Same pattern works for: marking reminders done, editing memories (Hermes re-embeds them), approving inbox items (Hermes promotes them to real memories), pausing/resuming modes.

---

## 7. Authentication for v1 (single-user)

For now: one user (you), one droplet, one Supabase project. We create your Supabase user manually in the Supabase dashboard. Hermes uses a Supabase "service role key" stored in `~/.hermes/.env` — that key bypasses RLS so Hermes can write on your behalf. The UI uses your normal user JWT after login.

Service role key stays on the VPS only. It is never sent to the browser. This is the standard Supabase pattern.

---

## 8. Migrations and seed data

Two SQL files in `supabase/`:

- `schema.sql` — the file I just wrote. Creates everything from scratch.
- `seed.sql` (to be created next slice) — inserts your profile, the Battini Family space, your starting people (Mother, Father, Aman, Ishita, Dr. Mehta), default settings, and maybe a few starter memories so the UI isn't empty on first load.

When we change the schema later, we use Supabase's migration tool (`supabase migration new`) so changes are tracked and reversible.

---

## 9. What's deliberately NOT in v1

To stay focused on the "WhatsApp → Hermes → Supabase → UI two-way" goal you set:

- **Vector embeddings are wired up but the embedding job is deferred.** The column exists. The Postgres trigger that calls an embedding API on insert is documented but not built until you actually need semantic search. Initial search is keyword-only via the trigram index.
- **Audit log triggers are simple.** Every tool writes its own `activity_log` row. We're not adding fancy change-tracking via Postgres triggers in v1 — too much complexity for too little benefit at this stage.
- **No background worker / cron yet.** Hermes itself has a built-in cron scheduler. We'll lean on that to send reminders at their scheduled time, instead of building a separate worker.
- **No family multi-user yet.** The schema is multi-user ready (RLS, user_id columns) but only you have an account in v1. Mother, Father, etc. are `people` rows but not `auth.users` rows.
- **No push notifications to phones beyond WhatsApp.** WhatsApp IS the notification channel for v1. App push, SMS, email come later.

---

## 10. Files this design produces

```
/Users/srivamshi/MyDrafts/Hanu-v1/
├── supabase/
│   ├── schema.sql          ← DONE (the schema)
│   ├── seed.sql            ← next: insert your starter data
│   └── README.md           ← next: how to apply this to a real Supabase project
├── hermes-hanu-skill/      ← next: the actual Hanu skill code
│   ├── SKILL.md
│   ├── tools.py
│   ├── db.py
│   ├── events.py
│   └── __init__.py
├── ui-wiring/              ← next: the JS that replaces mock HANU object with Supabase calls
│   └── supabase-client.js
└── deploy/                 ← next: setup scripts for the DO VPS
    ├── install-hermes.sh
    └── README.md
```

---

## 11. Decisions still open

Before I start building, three small open questions. These are quick to decide:

**(a) Embedding model and provider.** Postgres vector column is sized at 1536 dimensions — that's OpenAI's `text-embedding-3-small`, which is cheap and good. Alternatives: Voyage AI (faster, comparable price), or use whatever model Hermes is configured with. Recommend OpenAI text-embedding-3-small for v1; can swap later. ($0.02 per 1M tokens — basically free at personal scale.)

**(b) Where Hermes' service-role secret lives.** Options: stored in `~/.hermes/.env` on the VPS (simplest), or in DigitalOcean's secrets manager. For v1, `.env` is fine. Lock the file to 600 perms.

**(c) Migration to a different LLM for Hermes itself.** Hermes can run on Anthropic, OpenAI, Gemini, GLM, MiniMax, etc. through OpenRouter. The PRD doesn't specify; you said earlier "Claude" tone implicitly. Recommend `anthropic/claude-sonnet-4.6` via OpenRouter as the default Hermes model — best tool-use behavior at reasonable cost.

---

## 12. What I need from you to start building

Once you've read the schema and this doc:

1. Confirm the schema captures everything from the UI data model you care about. If there's any field missing, point it out and I'll add it.
2. Confirm the three open decisions above (or override with your own answers).
3. Send me the DigitalOcean droplet IP + how I should give you commands (I can't SSH directly — I write you copy-paste blocks, you run them on your terminal, paste back the output).
4. Create the empty Supabase project (just sign in to supabase.com, click New Project, pick the closest region, set a strong DB password). Don't run schema.sql yet — we'll do it together once everything is connected.

After those four things, I can deploy Hermes, run the schema, build the Hanu skill, and wire the UI. Realistic time: one focused 6–8 hour session, plus a polish session afterward.
