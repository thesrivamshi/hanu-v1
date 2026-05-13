# Hanu Tasks — Execution Index

Derived from `../REVIEW_RESPONSE.md`. Each file is self-contained: a future Claude (or human) can pick one up and execute it without re-reading the review.

**Conventions inside every task file:**
- `Priority` — P0 critical, P1 high, P2 medium, P3 low, P4 deferrable.
- `Depends on` — must complete those tasks first.
- `Acceptance criteria` — verifiable conditions for done.
- `Verification` — exact commands/queries to confirm done.
- `Rollback` — how to revert.
- File paths use absolute repo paths anchored at `/Users/srivamshi/MyDrafts/Hanu-v1/`.

**Environment facts referenced by all tasks:**
- Droplet: `168.144.30.107`, Ubuntu 24.04, user `root`.
- Hermes install: `/usr/local/lib/hermes-agent/venv/`, config `/root/.hermes/.env`, systemd unit `hermes-gateway.service` (user unit, lingering enabled).
- Hanu skill on droplet: `/root/.hermes/skills/hanu-bridge/` (mirrors this repo's `hermes-hanu-skill/`).
- `hanu_call` wrapper installed at `/usr/local/bin/hanu_call` symlinked to the skill dir.
- Supabase project: `lcayzfqmemitlbjugbsq`, region `ap-south-1` (Mumbai). 21 tables, RLS enabled on all user-owned tables.
- User profile id: `d804b9ed-5eaa-497c-8390-86ba02007a33`. Auth email: `desk.mightyminds@gmail.com`.
- LLM: OpenAI `gpt-5.4-mini` via Hermes `ai-gateway` provider (base_url overridden to `https://api.openai.com/v1`).
- WhatsApp: Baileys bridge, bot number `+919100410143`, allowlist LID `75935407714503@lid`.
- UI: nginx on the droplet, port 80, serves `hanu-v1/project/` static files.

---

## Execution order

### P0 — Security & known correctness bugs (do this week)
1. `01-auth-https-magic-link.md` — Remove hardcoded password from UI, magic-link auth, HTTPS via certbot.
2. `02-fix-message-count-bug.md` — `tools.py:614` short-circuits to literal `1`; replace with a Postgres trigger that maintains `conversations.message_count`.

### P1 — Tool routing & engine (do this month)
3. `03-hanu-mcp-server.md` — Convert `tools.py` 30 functions to an MCP server, disable overlapping Hermes built-ins, retire `mirror-to-hanu.py` and `hanu_call`, trim `SOUL.md` routing rules.
4. `04-goal-streak-trigger.md` — Postgres trigger maintaining `goals.streak`, `goals.missed_count`, `goals.risk` from `goal_completions` changes.
5. `05-reminder-firing-worker.md` — Worker that reads pending reminders where `scheduled_at <= now()` and dispatches via Hermes gateway.
6. `06-followup-recovery-engine.md` — Worker for `follow_up_rule` (no-response re-ping) and `recovery_rule` (missed-goal flow).

### P2 — Data model corrections
7. `07-privacy-levels-remap.md` — Resolve 5 PRD levels vs 6 enum values.
8. `08-permission-tiers.md` — Add tier integer + capability-from-tier function.
9. `09-commitment-and-failure-reason-enums.md` — Extend commitment enum, convert `goal_completions.reason` to enum, add `goals.family_critical`.
10. `10-conflict-handling.md` — `conflicts` table + MCP tool.
11. `11-voice-notes.md` — `messages.voice_audio_url` + transcript field + Whisper pipeline.
12. `12-approval-rule-playback.md` — Persisted "always allow" rules read at request time.
13. `13-memory-source-provenance.md` — `memories.source_type` enum + UI display.
14. `14-schema-tightening-enums-and-fts.md` — Tighten free-text status fields to enums; FTS index on `messages`; nullable `approvals.from_person_id`.
15. `15-supabase-migrations.md` — Move from `schema.sql` snapshot to migration files.

### P3 — UI & UX
16. `16-ui-mock-sweep-empty-states.md` — Strip Aarav/Aman/Geeta/Ramesh/Ishita/Mehta/Battini-Family hardcodes; per-surface empty states.
17. `17-vite-refactor.md` — Move from Babel-in-browser to Vite build pipeline.
18. `18-onboarding-first-conversation.md` — 5-minute first chat that seeds 3 real rows.
19. `19-simplify-ia-12-to-5.md` — Reduce sidebar from 12 to 5 top-level screens.

### P4 — Ops & not-yet-surfaced risk
20. `20-baileys-humanize.md` — Randomized response delay + typing indicator.
21. `21-ai-disclosure-family.md` — First-contact "I'm Hanu, an AI" disclosure.
22. `22-deletion-forget-me.md` — `delete_user_completely(uuid)` function + tested path.
23. `23-monitoring-backups-logrotate.md` — Daily snapshots, log rotation, healthcheck endpoint, external uptime monitor.
24. `24-model-abstraction.md` — Tiered model routing (cheap for extraction, premium for synthesis).
25. `25-conversation-archival.md` — Archive `messages` older than 12 months; cold-store path.

---

## How to use these files

1. Pick the highest-priority unstarted task.
2. Read the task file in full.
3. Confirm `Depends on` is satisfied.
4. Execute `Implementation steps` in order.
5. Run every command in `Verification`.
6. Mark the file's `Status: DONE` at the top and commit (if the repo is tracked).
7. If anything in the task is wrong, edit the file before moving on — these documents are the source of truth, not the review doc.
