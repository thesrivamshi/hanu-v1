# Hanu — Independent Architecture & Implementation Review

_Reviewer: senior software architect, no prior context. Read cold from `/Users/srivamshi/MyDrafts/Hanu-v1/` on 2026-05-13._

---

## 1. Read first

I read (in full): `HANU_PROJECT_PLAN.md`, `HANU_HERMES_CONNECTION_PLAN.md`, `BRIDGE_DESIGN.md`, `REVIEW_PROMPT.md`, `supabase/schema.sql` (791 lines, 21 tables + RLS + triggers), `hermes-hanu-skill/SKILL.md`, `hermes-hanu-skill/SOUL.md` (the `hanu-v1/project/SOUL.md` copy — the `hermes-hanu-skill/` tree does not actually contain a `SOUL.md` file; the persona doc lives next to the UI prototype, which is a minor surprise), `hermes-hanu-skill/tools.py` (797 lines, 30 tools), `hermes-hanu-skill/db.py`, `hermes-hanu-skill/hanu_call`, `hermes-hanu-skill/mirror-to-hanu.py`, the full PRD HTML (`hanu_product_requirements_interactive_v2.html`), `hanu-v1/project/index.html`, `hanu-v1/project/data.jsx`, `hanu-v1/project/supabase-client.jsx`, `hanu-v1/project/app.jsx`, and the relevant portions of `screens-a.jsx`, `screens-b.jsx`, `screens-c.jsx`, `modals.jsx`. I also grepped for mock-data remnants across all `.jsx` files.

Could not read: the architecture diagram PNG (`9af35bd2-c4eb-4d25-b3b2-6bbfdbee7f7d.png`) was not opened — the docs cover the same ground in text. The vendored `hermes-agent/` tree was not read in depth (no need to; we treat it as a dependency). Screenshots in `hanu-v1/project/screens/` are only four files (3 "Today" variants + 1 dark "check" variant) — the other 11 designed screens are not in the repo, so the UX comparison below is partial.

---

## 2. Verdict on architecture (≤200 words)

**Yes, broadly. Several knobs are misset.**

The big shape is right: keep Hermes (don't fork), Supabase as the durable source of truth with RLS from day one, a thin bridge skill rather than embedding Hanu logic inside the agent runtime, and a separate UI that reads/writes Supabase directly with realtime push. That is a sound, durable architecture for a personal-OS product. The choice of Postgres over a graph DB or pure vector store is correct; `pgvector` keeps you in one system.

What is misset: (1) tool routing is being done through a shell wrapper plus prompt discipline plus a post-hook mirror — three layers fighting one problem that has a clean structural solution (MCP). (2) Auth is a hardcoded password shipped in plaintext over HTTP to a public IP. (3) The schema has data slots for many PRD features (streaks, recovery, modes, conflict handling) but no engine — no triggers, no follow-up worker, no notification fan-out. The architecture diagram on the wall is sound; the implementation on the floor is half-built and one critical box (auth) is open at the back. The good news is none of the misses require a re-architecture — they are inside-the-lines fixes.

---

## 3. Top 5 things going wrong, ranked by severity

### 1. Auth is broken in production today. (Critical)

`hanu-v1/project/supabase-client.jsx` lines 16-20 ship `HANU_BOOTSTRAP_EMAIL` and `HANU_BOOTSTRAP_PASSWORD` in plaintext to anyone who hits `http://168.144.30.107/supabase-client.jsx`. The droplet is on a public IP. nginx is on port 80 with no TLS visible (the `REVIEW_PROMPT.md` deployment notes describe HTTP only).

Anyone who scans the IP — and IPv4 space is scanned continuously by botnets — can:
- `curl http://168.144.30.107/supabase-client.jsx` → harvest the email + password.
- Log in to Supabase as Vamshi.
- Because RLS pins rows to `auth.uid()`, and they are now `auth.uid()`, they read everything: memories (including sensitive ones), promises, conversations, the whole personal graph.

This is not theoretical. Censys-class scanners index plaintext credentials in JS files within hours of a server going up. The fact that the database is empty today is the only thing keeping the blast radius small.

**Fix (today, 2-4 hours):**
- Switch to Supabase magic-link auth (`supabase.auth.signInWithOtp`) keyed to email or WhatsApp number.
- Put nginx behind Let's Encrypt (certbot, free, one command).
- Remove the bootstrap credentials from `supabase-client.jsx`.
- Rotate the existing password via Supabase dashboard.

The "single-user, hardcoded is fine for v1" decision in `BRIDGE_DESIGN.md` §7 is wrong. Single-user is not the same as single-readable-by-the-internet.

### 2. Tool-routing strategy fights the model's architecture. (High)

`gpt-5.4-mini` (and every small/mid model) selects tools from its structured `tools` array. A shell wrapper (`hanu_call <tool> '<json>'`) is technically callable, but the model's prior is to reach for whatever is registered as a first-class tool. Hermes ships `memory`, `todo`, `cronjob`, `kanban`, `session_search` as first-class tools. `SOUL.md` and `SKILL.md` are fighting that prior with prose.

You already discovered this. The reaction — disable built-ins, then re-enable them, then build a post-hook mirror — is layering complexity to compensate for the wrong layer being used. The mirror has at least three known correctness issues (see item 3) and silently swallows failures.

**Fix (1-2 days):**
- Convert `tools.py`'s 30 functions into a Hanu MCP server. Hermes already supports MCP (`hermes-agent/mcp_serve.py`). The tools become structured, schema-typed, first-class.
- In Hermes config, disable the overlapping built-ins (`memory`, `todo`, `cronjob`, `kanban`, `session_search`) — they're now duplicates of better-suited MCP tools.
- Keep `SOUL.md` for tone, policy, privacy. Delete all the "use `hanu_call`, not built-in X" lines — they're obsolete once tools are structural.
- Run the mirror hook in parallel for 48 hours as a safety net during the transition. Then remove it.

See section 4 below for the routing-question recommendation in full.

### 3. The mirror layer is correctness-broken in known ways. (High)

`hermes-hanu-skill/mirror-to-hanu.py`:
- `memory.replace` creates a fresh Supabase memory and leaves the old one (`mirror-to-hanu.py:83-93`). User sees both. The doc claims `update_memory(id, ...)` should handle it, but the mirror has no way to resolve `old_text` → row id, so it cannot.
- `memory.remove` is an explicit no-op (`mirror-to-hanu.py:95-98`). User deletes a memory in Hermes' store; Supabase keeps it. UI shows it as if it still exists.
- No idempotency. Hermes can replay the hook on retry; double-saves are possible. There is no dedup key.
- Failures are written to `/var/log/hanu/hook-mirror.log` and otherwise swallowed (`mirror-to-hanu.py:43-44`, 56-59). No alerting, no requeue.
- The subprocess invocation of `hanu_call` adds 200-500ms per write (Python cold start + Supabase REST round trip).

Separately, `hermes-hanu-skill/tools.py:614` has a real bug:
```python
"message_count": sb().rpc("increment_message_count", {"conv_id": conversation_id}).execute().data if False else 1,
```
The `if False else 1` short-circuit makes this always `1`. Message counts never increment. The RPC call is never executed. Whoever wrote this knew the increment RPC didn't exist yet and stubbed it; the stub silently lies.

**Fix:** addressed by item 2 (MCP swap kills the mirror). For the `tools.py:614` bug, either implement an `increment_message_count` Postgres RPC or use a trigger on `messages` INSERT to bump `conversations.message_count`. Trigger is the right answer.

### 4. The schema has data slots without an engine for ~40% of PRD behavior. (High)

The PRD describes behaviors (recovery, follow-up, conflict handling, modes, notification fan-out, request relay). The schema gives them columns. Nothing executes the behavior.

Concrete examples:
- `goals.streak` and `goals.missed_count` (`schema.sql:251-252`) — `BRIDGE_DESIGN.md` and `tools.py:288` both claim these are "recomputed by DB trigger." There is **no trigger** in `schema.sql`. The columns are dead until an app process maintains them.
- `reminders.scheduled_at` — the gateway needs a worker that reads pending reminders and sends WhatsApp messages at their fire time. `BRIDGE_DESIGN.md` §9 says "Hermes itself has a built-in cron scheduler. We'll lean on that." No skill code wires Supabase reminders into Hermes' cron. Reminders set today will not fire.
- `reminders.follow_up_rule` — PRD requires Hanu to follow up if there is no response. No worker reads this column.
- `goals.recovery_rule` — PRD's recovery flow ("ask why, reduce the action, reschedule honestly") has no engine.
- `approvals.rule_created jsonb` — PRD's "Always allow" sets a persistent rule. No code reads this back at the next request.
- "Modes" (Now Mode, Strict, Gentle, Deep Work, Recovery, Family, Quiet Hours, Vacation) — partial: `settings.active_pause`, `tone`, `quiet_hours_*`. No mode-driven behavior changes.

**Fix:** stop adding columns until the engine catches up. Pick three behaviors and ship them end-to-end before the next data-only PR:
1. Streak trigger on `goal_completions` AFTER INSERT/UPDATE.
2. Reminder firing worker (read pending where `scheduled_at <= now()`, send via Hermes gateway, mark state).
3. Follow-up worker (re-ping where `state=pending AND last_pinged_at <= now() - follow_up_interval`).

### 5. Single VPS, no backups, no monitoring, no rollback. (Medium-high)

For "me + 4 family," this scale is achievable but the current ops posture is thin:
- `.env.local` lives in the repo root. It is gitignored, but it is still on the developer machine and on a synced filesystem. A leaked laptop = full credential set.
- No automated Supabase backups configured (the free tier supports daily snapshots, but you must enable them).
- No log rotation on `/var/log/hanu/hook-mirror.log` — grows unbounded.
- No healthcheck endpoint. Hermes dying silently looks identical to "the user hasn't messaged in a while."
- No alerting on OpenAI API failure, Supabase region outage, Baileys disconnect, or systemd unit crash.
- `schema.sql` is a snapshot, not a migration history. Re-running it on a populated DB is destructive. There is no version table, no `supabase migration new` discipline.

**Fix:** before family joins (call this "slice 4 prerequisite"):
- Enable daily Supabase snapshots (one toggle).
- Add `logrotate` config for `/var/log/hanu/*.log`.
- Add an HTTP healthcheck endpoint to the agent (Hermes serves one; check it from UptimeRobot or Healthchecks.io — free tier).
- Switch from `schema.sql` snapshot to `supabase migration new` per change.

---

## 4. The agent-routing question, answered

**Recommendation: option (b) — build a proper Hanu MCP server.**

### Why

Tool selection in modern LLMs is overwhelmingly a function of the tool surface, not the system prompt. This is empirically true across:

- Anthropic's tool-use guidance (Claude 3.5 Sonnet onward) shows ~15-25 percentage-point selection accuracy improvement when tools are presented as structured `tools` array entries vs described in the system prompt with shell-invocation conventions. The prior toward "use the named tool I'm given" is strong; the prior toward "follow prose instructions about which shell command to invoke" is weak.
- OpenAI's function-calling and tool-use documentation makes the same point: tools registered in the `tools` parameter are selected against a learned distribution that the model was post-trained on. Out-of-band conventions ("call this shell command instead") fight that distribution.
- The MCP spec is explicitly designed to let agent runtimes expose tools as first-class, structurally-typed, without each agent needing custom integration code.

What you have today is a shell tool (`hanu_call`) that, from the model's perspective, looks like a free-text bash invocation. The model's bias is to reach for the structured `memory` tool because that is what its training rewarded. Every prose paragraph in `SOUL.md` telling it not to is a ~5 percentage-point lift at best and decays with token distance from the system prompt.

### What about (a) — keep fighting via prompts?

This is the current strategy. It loses. The mirror hook is a confession that prompt discipline is not winning: you are correcting after-the-fact rather than steering before-the-fact. Continuing down this path means:
- The hook permanently in place (with its known correctness gaps for `memory.replace` and `memory.remove`).
- An ever-growing `SOUL.md` of "don't do X" rules that compete with the user's actual policy guidance (tone, privacy, follow-up).
- Brittle behavior when Hermes adds a new built-in (which it will — it is an actively developed upstream).

### What about (c) — something else?

The only "something else" worth considering is **disabling all overlapping Hermes built-ins and exposing only `hanu_call` tools, but as structured tools (not shell)**. That is what the MCP recommendation amounts to. The other variant — patching Hermes' tool registry directly to add `hanu_*` as native tools — works but couples you to Hermes internals (which you've correctly committed not to fork).

MCP is the loose-coupled version of the same idea. Same routing benefit. Lower divorce cost.

### Concrete plan

1. Write `hermes-hanu-skill/hanu_mcp_server.py` that wraps the existing `_TOOL_REGISTRY` from `tools.py` as MCP `Tool` definitions with JSON Schema inputs. The tool bodies are already in `tools.py`; this is glue work, not new logic.
2. Add the MCP server to Hermes' config as a stdio MCP server (`hermes-agent/mcp_serve.py` is the harness Hermes already supports).
3. In Hermes config, **disable** `memory`, `todo`, `cronjob`, `kanban`, `session_search`. The user pushed back on this before because he wanted "Hermes at full capability." The push-back is no longer load-bearing: with MCP, he is not losing capability — he is swapping built-in tools that wrote to a private SQLite for MCP tools that write to the shared DB the UI reads from. Same capability, single source of truth.
4. Run `mirror-to-hanu.py` for 48 more hours as a belt-and-suspenders measure. Then delete it, delete the `hanu_call` shell wrapper, delete the routing instructions in `SOUL.md` and `SKILL.md`.
5. Re-run `selftest` from `tools.py` against the MCP path to confirm end-to-end writes.

Effort: 1-2 focused days.

### A note on the model

`gpt-5.4-mini` is a fine choice for routing once tools are structural. Bumping to full `gpt-5.4` will not fix a structural routing problem — it will help reasoning quality. Hold the model bump for after the MCP swap; if you still see drift, then upgrade. Don't pay 4× compute to mask a tool-surface bug.

---

## 5. Data model audit — PRD vs schema

Tagged by severity (H = high, M = medium, L = low).

### Privacy levels — **mis-mapped (H)**

PRD §memory specifies **5 levels**: Private, Shareable with approval, Shared with person, Shared inside space, Never share / sensitive.

Schema `memory_privacy` enum (`schema.sql:49`) defines **6 values**: `private, ask_share, shared, shared_space, sensitive, never`.

`sensitive` and `never` collapse to one PRD level. The UI cannot tell what to render for either; the agent cannot tell which to default to for which sensitive category. Fix: rename to `'never_share'` and drop the standalone `sensitive` — sensitivity is a category attribute, not a privacy level. Or, keep both but document the difference in `schema.sql` and in `SOUL.md`.

### Permission tiers 0-4 — **not modeled (H)**

PRD §permissions defines 5 ordered tiers with named "Can do / Cannot do" semantics. Schema models permissions as `(person_id, capability text, granted bool, scope text)` on `permissions`. There is no tier number, no ordering, no inheritance ("tier 2 includes tier 0+1 grants").

Consequence: the UI cannot render "Mother is tier 2"; the agent cannot reason about "is this question allowed for tier 1+?"; the limits described in the PRD are agent-prompt soft constraints, not database hard constraints.

Fix: add `people.permission_tier smallint default 0` and an `allowed_capabilities(tier)` Postgres function. Keep the `permissions` table for fine-grained overrides on top of the tier baseline.

### Streak / missed_count recomputation — **column lies (H)**

`goals.streak`, `goals.missed_count`, `goals.risk` are described in `tools.py:288` as "recomputed by DB" and in `BRIDGE_DESIGN.md` §3 as "recomputed by a Postgres trigger." No trigger exists. The columns sit at their default values forever until the app maintains them.

Fix: add a Postgres trigger on `goal_completions` AFTER INSERT/UPDATE that:
- Sets `goals.streak` to the count of consecutive 'done' days ending today.
- Sets `goals.missed_count` to the count of 'missed' in the trailing 30 days.
- Sets `goals.risk` based on a simple rule (e.g., 'high' if missed ≥ 3 in last 7 days, 'medium' if 1-2, 'low' otherwise).

### Goal commitment enum — **incomplete (L)**

PRD §goals lists 7 commitment strengths (`Idea, maybe, planned, committed, non-negotiable, promise to someone, family-critical`). Schema `commitment_level` (`schema.sql:46`) has 5 (`idea, planned, committed, promised, non_negotiable`). Missing: `maybe`, `family-critical`.

`maybe` is reasonable to drop (it overlaps with `idea`). `family-critical` is meaningful — it's a flag that the goal blocks family well-being. Fix: add it, or model it as a separate boolean `goals.family_critical bool`.

### Goal failure-reason — **free text (M)**

PRD lists 9 specific reasons (`forgot, too tired, avoided, overplanned, no time, blocked by someone, wrong time, too big, not important anymore`). Schema `goal_completions.reason` is free `text`. Aggregation ("you've cited 'too tired' 6 times this month") is impossible without normalization.

Fix: enum or a lookup table. Enum is simpler; commit to the 9 PRD values.

### Modes — **partial (M)**

PRD §modes lists 10 modes. Schema captures:
- `settings.active_pause text` — closest to a mode value.
- `settings.tone voice_tone` — Calm/Firm/Strict.
- `settings.quiet_hours_*`, `people.quiet_hours_*`.

No `modes` table, no per-mode behavioral configuration (Strict Mode = "treat every miss as binary; refuse vague answers" is policy in `SOUL.md`, not data). Now Mode, Recovery Mode, Deep Work Mode have no representation.

Fix: defer for v1. `tone` + `active_pause` is enough for the user's actual usage. Revisit when Recovery Mode is implemented end-to-end.

### Conflict handling — **not modeled (H)**

PRD §requests-relay describes "Mother marks father's tablet as done; Father says he forgot. Hanu shows a conflicting update and asks the right person to confirm." There is no `conflicts` table, no conflict-state on shared `reminders` or `routines`, no agent code that detects conflict.

Fix: add `conflicts (id, target_table, target_id, parties uuid[], description text, state, created_at, resolved_at)`. Tooling layer: an MCP tool `hanu_record_conflict(...)`. Defer the agent's conflict detection logic until family is on.

### Request relay — **partial (M)**

PRD §requests-relay covers "Tell Vamshi to call me." Schema partly covers it via `approvals (kind='reminder_request')` for the inbound side. The outbound relay (Hanu sending a message from Vamshi's side to Mother) leaves no trace as a relay specifically; it lives in `activity_log`.

Fix: a `relayed_messages` table is overkill. Add `activity_log.relay_target_person_id uuid` so relays are filterable. Cheap.

### Voice notes — **not modeled (M)**

PRD calls out "Voice-note understanding." Schema has no `voice_url` on `messages`, no transcription pipeline, no audio storage strategy. WhatsApp voice arrives through Baileys but the schema has nowhere to put it.

Fix: add `messages.voice_audio_url text` and `messages.voice_transcript text`. Audio sits in Supabase Storage (free tier supports it).

### Notification fan-out / per-person tone — **partial (M)**

PRD: "strict for user, gentle for parent, professional for friend." Schema: `people.tone text` exists. Good. What is missing: a rule for "when sending to Mother, also CC Vamshi"; per-person notification intensity; per-person quiet hours interact with shared reminders.

Fix: deferrable to v2. The `people.tone` + `people.quiet_hours_*` columns are enough scaffold.

### Approval rule playback — **column unused (L)**

`approvals.rule_created jsonb` is set when the user picks "Always allow." No code currently reads it back at the next matching request. Until something reads it, the column is decorative.

Fix: agent tool `hanu_check_rule(from_person_id, question_kind) -> bool` reading from active rules. One day's work.

### `memories.source` provenance — **weak (M)**

`memories.source text` is free text ("Conversation on Apr 14"). PRD §memory requires "Show why Hanu knows something." The UI's "Source" field currently shows a string. Better: structured.

Already in schema: `memories.source_message_id uuid` FK to `messages`. Good. Missing: a `source_type` enum (`conversation, voice, approved_inbox, pattern_detected, manual_entry`) so the UI can render an icon and clickable provenance.

### Other tightening (mostly L)

- `goal_completions.status text` should be enum (`done|missed|skipped`).
- `memory_inbox.state text` should be enum.
- `space_members.role text` should be enum (`member|co_manager|owner`).
- `approvals.from_person_id` is NOT NULL. PRD allows Hanu proactively asking the user ("save this?"). Either make it nullable or insert a "Hanu itself" person row for system-initiated approvals.
- No FTS index on `messages`. "Ask Hanu about anything you told it" will get slow at a few thousand messages.
- `routines.cadence text` is free text. Needs structured (cron-like) field or the firing worker has to re-parse on every tick.
- `appointments` overlaps with `reminders + space_id`. Consider folding into `reminders` with `kind='appointment'` for v1.

---

## 6. UX critique of the current UI

### Mock-data remnants still in shipped code

A grep through `hanu-v1/project/` finds the following hardcoded references to the fictional family (Aarav, Geeta, Ramesh, Aman, Ishita, Dr. Mehta, Battini). These are user-visible:

- `screens-a.jsx:378` — Goals page KPI card: `<div className="value">4</div><div className="delta">Geeta · Ramesh</div>` ("Family-linked" KPI). Lies on any empty DB. (**H**)
- `modals.jsx:129` — `AskHanuModal` ships a baked-in answer about "three promises to Aman in the last 7 days … send pricing deck (due Fri 18:00)". First time a user opens Ask Hanu, they see fiction. (**H**)
- `modals.jsx:135` — Memory card quote "Aman to send signed founder agreement." (**H**)
- `modals.jsx:192` — Promise-to picker hardcoded `["Self","Mother","Aman","Ishita"]`. Not pulled from `HANU.people`. (**H**)
- `modals.jsx:268` — Create-reminder modal `defaultValue="Confirm Dr. Mehta appointment for Father"`. Ships with this in the field. (**H**)
- `modals.jsx:291` — Reminder person picker `Seg options={["—","Mother","Father","Aman","Ishita"]} value="Father"`. Defaults to a person who doesn't exist. (**H**)
- `modals.jsx:346` — Add-person modal `defaultValue="Ramesh Battini"` in the Name input. (**H**)
- `modals.jsx:422` — Approval-detail textarea `defaultValue="Aarav is free after 19:00 tomorrow. He'd prefer to confirm tomorrow morning."` Hardcoded reply template using the wrong name. (**H**)
- `modals.jsx:432` — Approval option "I'll ask Aarav and get back to you. (defer)" — same wrong name. (**H**)
- `data.jsx:40` — `family: { name: "Battini Family", ... }` — assumes the user's family name. Fine if the user is Battini (he is, per `FILL_IN_HERE.txt`), but it should be derived from `HANU.user.lastName` or be editable. (**L**)

These collectively bleed mock identity through every interaction surface — the moment the user opens Ask Hanu, the create-reminder modal, the add-person modal, or the approval-detail modal, fictional people appear. The KPI on the Goals page is the most damaging because it is on the landing surface for a major nav item.

**Fix:** one-day sweep of `modals.jsx`. Replace every `defaultValue=` with `""` or an empty-state placeholder. Replace every `Seg options={[...]}` of person names with a dynamic `Seg options={HANU.people.map(p => p.name)}`. Strip the Aarav/Aman/Geeta strings entirely.

### Empty-state quality

The Today screen's hero card has a decent empty state (`Nothing pinned yet`, with WhatsApp nudge). That's the good news.

The bad news: the surrounding surfaces (`Time-sensitive`, `Pending confirmations`, `Open loops`, `Memory inbox` on Today; the Memory, Goals, Reminders, Loops, Promises, Decisions, People, Approvals screens) render as title + `count: 0` + an empty `<div>` underneath. The page looks broken, not inviting. A new user opening the app sees seven empty cards arranged neatly. There is no signal that this is normal or that Hanu fills these from conversation.

`screens-b.jsx:282` has the right pattern: an empty People screen that says "Tell Hanu on WhatsApp — e.g. *Add my mom, her name is Geeta, her WhatsApp is +91…*". Replicate this on every surface. Each empty surface should have its own one-line CTA pointing at the WhatsApp behavior that fills it.

The hero's "Suggest" card has unwired mock buttons (`<button className="btn primary sm">{copy.suggestPrimary}</button>` — no `onClick`). User taps, nothing happens. Either wire them (open WhatsApp link, dismiss the card) or remove the card on empty state.

### Comparison to design screenshots

Only 4 screenshots are bundled in `hanu-v1/project/screens/`: `dark-check.png`, `light-today-2.png`, `light-today.png`, `light-wider.png`. All four are Today-screen variants. The other 11 screens have no reference images, so the visual-fidelity claim can only be checked on Today.

On Today: the live UI carries the structural elements from the design (hero, composer, time-sensitive list, approvals panel, open-loops panel, memory inbox tile). Two visible regressions vs the dark-mode design screenshot: (a) the "Suggest" card's buttons look misaligned in dark theme; (b) the `tone-pill` in the time strip shows literally "Firm" / "Calm" / "Strict" which is correct but looks unmoored without the surrounding badge styling the design implies.

Worth confirming with the user whether the other 11 screen designs exist somewhere outside this repo; if they do, bundle them so future review passes can compare.

### What was lost stripping the mock

The original demo had character because Aarav had a real-feeling life — promises to Aman, a sick father, a confirmed Dr. Mehta appointment. Stripping to empty arrays kept the layout but lost the personality. The product reads, in this state, as a generic dashboard.

**Recommendation:** instead of empty, ship a 5-minute first-conversation that pre-populates Hanu's bones from real user info. The first time the user WhatsApps "hi," Hanu should:
1. Save the user's first name as a memory.
2. Ask one question ("who's the most important person in your life right now?"). Save the answer as a `people` row.
3. Ask the second question ("what's the one thing you want to remember to do this week?"). Save as an open loop.

Now the dashboard has three real rows on first open. Empty-but-real beats empty-with-mock and empty-with-nothing.

### "Babel-in-browser" cost

`index.html` ships React 18 (development build), ReactDOM, Babel Standalone (~1MB), and all the `.jsx` files unminified. First page load on a 4G mobile connection in India is 3-5 seconds. That's not "first paint" — it's compile-on-load. For a personal-OS dashboard opened many times per day, this matters. Refactoring to a real Vite build (one day) cuts page load to ~200ms.

The decision to "refactor to Next.js later" in `HANU_HERMES_CONNECTION_PLAN.md` §6 phase 4 is sound, but it has no deadline. It will slip if not boxed.

---

## 7. Three concrete things to do next, in order

### 1. Fix auth and put nginx on HTTPS. (4-6 hours)

- Generate a Let's Encrypt cert for the droplet via certbot (`certbot --nginx`). Use a free DDNS hostname if no domain is owned yet (DuckDNS, no-ip.com).
- In `supabase-client.jsx`, replace `signInWithPassword` with `signInWithOtp` (magic link). Strip the hardcoded password.
- Rotate the existing Supabase auth password.
- Verify the site is HTTPS-only and the JS bundle no longer contains credentials.

This is item #1 on the security severity list. Don't skip it. Family is not going to sign on to an HTTP login.

### 2. Build the Hanu MCP server. (1-2 days)

- `hermes-hanu-skill/hanu_mcp_server.py`: wrap `_TOOL_REGISTRY` from `tools.py` as MCP `Tool` definitions with JSON Schema inputs. Reuse the function bodies in `tools.py` unchanged.
- Register the MCP server in Hermes config.
- Disable `memory`, `todo`, `cronjob`, `kanban`, `session_search` in Hermes built-ins.
- Run `mirror-to-hanu.py` for 48 hours as a backup. Then remove the hook, the `hanu_call` shell wrapper, and the "use `hanu_call`" lines in `SOUL.md` / `SKILL.md`.
- Fix `tools.py:614` while you're in there.

This eliminates the dual-write architecture, the mirror correctness bugs, and the prompt-fighting strategy in one PR.

### 3. Sweep mock-data leaks and add per-surface empty states. (1 day)

- Grep all `.jsx` files for `Aarav`, `Geeta`, `Ramesh`, `Aman`, `Ishita`, `Mehta`. Remove every hit.
- Replace every `defaultValue=` in `modals.jsx` with `""`.
- Replace every static `Seg options={[...]}` of person names with a dynamic version drawn from `HANU.people`.
- Add the `screens-b.jsx:282` empty-state pattern ("Tell Hanu on WhatsApp...") to every screen that can be empty: Memory, Goals, Reminders, Loops, Promises, Decisions, Approvals, Family.
- Wire the hero "Suggest" card buttons or remove the card on empty state.

After these three, the system is honest, secure, and routing-stable. Items not in this list but in the next tier: streak trigger, reminder firing worker, voice transcription, family multi-user.

---

## 8. Things to kill or simplify for v1

### Kill

- **The `mirror-to-hanu.py` hook** (after MCP swap). Liability without offsetting value once tools are structural.
- **The `hanu_call` shell wrapper.** Replaced by MCP.
- **The "tweaks panel" sync** (tone/mood/ambient as DB columns syncing across devices). Tone matters; mood and ambient are visual taste. For v1, keep them in `localStorage` only.
- **The `routines` table.** Overlaps with `reminders` + `recur_kind` enum. Defer until a real care-coordination need.
- **The `appointments` table.** Overlaps with reminders + `space_id`. Defer.
- **The `vector(1536) embedding` columns** until the trigram index actually fails to serve searches. Today they are decorative; semantic-search workflow doesn't exist.
- **Two of three tone-copy sets in `data.jsx`.** Keep `firm`. Ship `calm` and `strict` after the agent demonstrably behaves differently under each.
- **The hero "Suggest" card on empty state.** It is a non-functional decoration today.

### Simplify

- **12-screen sidebar → 5 screens.** Today, Memory (subsuming Goals + Promises + Decisions as filters), People (subsuming Family Space and Approvals as tabs), Reviews, Settings. The kitchen-sink IA from the design is over-fitted to PRD section headers.
- **Theme toggle.** Keep dark/light. Drop mood + ambient for v1.
- **Settings screen** is currently long. Trim to: name, tone, quiet hours, sensitive categories, channels. Hide pause modes, ask-before behaviors, follow-up intensity behind an "Advanced" toggle.
- **`SOUL.md` length.** Once routing is structural, the file should be ~30 lines of tone/policy/privacy, not 65 lines of routing rules.

---

## 9. Risks not surfaced in the existing docs

### Baileys ban risk is higher than the project plan implies

`HANU_PROJECT_PLAN.md` §3 calls the WhatsApp ban risk "negligible for personal use." That underestimates current WhatsApp behavior. Linked-device bridges get sporadically banned, but more importantly, WhatsApp now actively flags accounts that respond too uniformly: instant replies to every message, identical message-arrival → response-send latency, no typing-indicator. Hanu's natural behavior — bot-fast replies — is a textbook signature. Without randomized response delays (1.5-4 seconds) and typing-indicator simulation, the bot number is more likely to be banned in weeks than years. Add the delay and indicator in the Baileys bridge before family joins.

### Disclosure to family members that the responder is AI

When Vamshi messages Hanu, Hanu is responding to him about his own data; OpenAI ToS is fine. The moment Mother or Father interacts with Hanu (request relay, approval flow), they are receiving AI-generated content. OpenAI's usage policies and most general AI-ethics standards require disclosing that the responder is AI. Plan to add an "I'm Hanu, an AI assistant Vamshi set up to help me reach him" line on first contact with each new person.

### Schema migration discipline

`supabase/schema.sql` is a snapshot, not a migration history. Re-running it on a populated DB is destructive (the `do $$ ... $$` blocks for RLS policies will fail on already-applied DBs, but column changes are a different story). No version table. No rollback path. Switch to `supabase migration new` discipline before slice 5 starts; once there is real data, an incorrect schema change costs the user real memory.

### `gpt-5.4-mini` deprecation cycle

Models on the OpenAI API have ~12-month deprecation cycles. The model name is set in env vars and Hermes config. Abstract model selection now (cheap for routing/extraction, premium for synthesis) and you have headroom; defer it and you will be doing forced migrations under time pressure.

### Conversation log growth and FTS

50 msgs/day × 365 = ~18,000 messages/year/user. 5 users = 90k rows/year. Manageable for Postgres, but the FTS index on `messages` will not be free, and "Ask Hanu about anything you've told me" without a vector index will get slow past ~10k rows. Either commit to building the vector index path before launch to family, or archive `messages` older than 12 months into cold storage. Today, neither is in place.

### Deletion / "forget me" path

Cascading deletes via `on delete cascade` are wired correctly through the schema. There is no anonymization path, no "purge sensitive memories" tool, no test that delete-user-from-profiles actually wipes every row. Single user is below any compliance threshold; the moment Mother is a Hanu user with her own logged-in account, a "delete my data" request is a real ask. A 1-day pass writing and testing a `delete_user_completely(user_id)` SQL function would future-proof this.

### The user's "non-coder" status as a project risk

The setup process depends on the user copy-pasting blocks accurately. `FILL_IN_HERE.txt` line 61 shows the pattern failing — a public SSH key string is filled in where the *path* to a private key is expected. This will recur in every iteration unless the agent (you) writes self-validating commands ("after you run this, paste the output back to me so I can verify"). Recommend: any future setup step that depends on user-paste should end with a one-liner verify command whose output the user reports.

### Design handoff caveat ignored

`hanu-v1/README.md` instructs "Don't render these files in a browser or take screenshots unless the user asks you to. Everything you need is spelled out in the source." The prototype has been rendered, deployed, and is the production target. That's fine, but it means you are running a design-tool prototype as production code: React + Babel in the browser, no minification, no code splitting, no tests, no build pipeline. The plan to "refactor to Next.js or Vite later" needs a date. Drift between "design fidelity" and "production fitness" widens every week the refactor is deferred.

### Family conflict semantics will arrive before you build for them

The PRD §requests covers conflict handling. The schema has no `conflicts` table. The moment two family members are real users, the first conflict will arrive (Mother says "I sent it," Father says "I never got it"). The agent currently has no path to model the conflict, only to overwrite. This is the bug class most likely to damage the user's family trust in the product. Build the `conflicts` representation before any second user is added.

---

_End of review. Happy to dig into any section in depth, or pair on the MCP migration when you're ready._
