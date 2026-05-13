# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo actually is

This is **not a single buildable application**. It is a planning + design + integration workspace for **Hanu** — a personal memory / reminder / accountability / relationship assistant for a single user (Vamshi, +family later). The runtime lives on a remote VPS; this repo holds the artifacts that get pushed there plus the design docs that describe what's being built.

Four distinct sub-trees live here, each with its own purpose:

| Path | Purpose | Runtime |
|---|---|---|
| `hanu-v1/project/` | React UI prototype (Babel-in-browser, single-page) handed off from Anthropic's design tool. Talks directly to Supabase. | Served by nginx on the VPS at `http://168.144.30.107/`. No build step. |
| `hermes-hanu-skill/` | The "Hanu bridge" — a Hermes skill (Python) that exposes ~30 `hanu_*` tools writing to Supabase. Plus `mirror-to-hanu.py`, a `post_tool_call` shell hook that mirrors Hermes' built-in memory/todo/kanban writes into Supabase. | Deployed under `~/.hermes/skills/hanu-bridge/` on the VPS, called via `/usr/local/bin/hanu_call`. |
| `hermes-agent/` | Vendored Nous Research Hermes source. **Treat as a read-only dependency** — we do not fork it; we add capability via the skill above. | Runs on the VPS as systemd unit `hermes-gateway.service`. |
| `supabase/schema.sql` | 21-table Postgres schema (goals, reminders, memories, people, permissions, approvals, promises, decisions, etc.) with enums and RLS. | Applied to Supabase project `lcayzfqmemitlbjugbsq` (region `ap-south-1`). |

The four planning docs at the repo root are the source of truth for intent — read them before touching anything substantive:

- `HANU_PROJECT_PLAN.md` — phased plan (slices 0-6), explained for a non-coder.
- `HANU_HERMES_CONNECTION_PLAN.md` — architectural rationale (why Hermes + Supabase + Vercel-UI shape).
- `BRIDGE_DESIGN.md` — exact contract for the Hermes ↔ Supabase ↔ UI bridge.
- `REVIEW_PROMPT.md` — current-state snapshot, including pain points the user wants critiqued.
- `hanu_product_requirements_interactive_v2.html` — full PRD (memory privacy levels, family spaces, approval queue, modes, recovery rules, permission tiers 0-4).

## Live deployment facts (don't re-derive these)

- **VPS**: DigitalOcean droplet, Ubuntu 24.04, `168.144.30.107`. Hermes installed at `/usr/local/lib/hermes-agent/venv/`, config at `/root/.hermes/.env`.
- **Hermes**: systemd user unit `hermes-gateway.service`, lingering enabled.
- **WhatsApp**: Baileys bridge (linked-device, **not** Meta Business API). Bot number `+919100410143`. Allowlist locked to user LID `75935407714503@lid`.
- **LLM**: OpenAI `gpt-5.4-mini` via Hermes' `ai-gateway` provider, base_url forced to `https://api.openai.com/v1`.
- **Supabase**: project ref `lcayzfqmemitlbjugbsq`, Mumbai. One auth user (`desk.mightyminds@gmail.com`, profile `d804b9ed-5eaa-497c-8390-86ba02007a33`). DB starts empty — data accumulates from conversation.
- **UI**: served by nginx at port 80 from the same droplet.

Secrets live in `.env.local` (gitignored, root of repo). Read for context, **never echo back to the user**.

## Architecture in one sentence

WhatsApp → Baileys → Hermes Gateway (Python systemd) → either Hermes' built-in tools (mirrored to Supabase via `post_tool_call` hook) or our `hanu_call` shell wrapper (direct write) → Supabase Postgres + Realtime → UI in browser via `@supabase/supabase-js` (anon key, RLS-enforced).

## Common operations

Almost everything runs on the **remote droplet**. Locally there is no `npm install`, no test suite, no build. Typical commands:

```bash
# On the droplet (root):
systemctl --user status hermes-gateway       # check the bot
systemctl --user restart hermes-gateway      # after editing skill files
journalctl --user -u hermes-gateway -f       # tail logs
tail -f /var/log/hanu/hook-mirror.log        # mirror-to-hanu.py hook output

# Test the bridge end-to-end from the droplet:
hanu_call save_memory '{"text":"test","kind":"other","privacy":"private"}'
hanu_call list_reminders '{}'

# Apply schema changes (against the Supabase project):
psql "$SUPABASE_DB_URL" -f supabase/schema.sql
```

The UI is **static HTML+JSX served raw** — Babel compiles in-browser. To "build" it, you just edit the `.jsx` files in `hanu-v1/project/` and push them to nginx's docroot on the droplet. No bundler.

## Things that bite

1. **Agent tool routing is the central unsolved problem.** `gpt-5.4-mini` ignores `SOUL.md`/`SKILL.md` and reaches for Hermes' first-class structured tools (`memory`, `todo`, `cronjob`, `kanban`) instead of the shell-based `hanu_call`. Mitigation today: the `mirror-to-hanu.py` `post_tool_call` hook (in `hermes-hanu-skill/`) tails those built-in writes and replays them into Supabase. This is best-effort, async (subprocess), and **`memory.remove` / `memory.replace` do not have safe mirror semantics** — replace creates a new row, remove is a no-op. See `REVIEW_PROMPT.md` §1 for the open question about whether to switch to a proper MCP server.

2. **The UI prototype assumes a populated mock.** The original `data.jsx` had a fictional family (Aarav with Geeta, Ramesh, Aman, Ishita, Dr. Mehta) and hardcoded streaks/KPIs. Most have been stripped, but **always check for remnants** when editing screens — empty-state UX is brittle.

3. **Service-role key only on the VPS.** `db.py` uses Supabase's service-role key (bypasses RLS) because Hermes acts on behalf of the single user. The UI uses the anon/publishable key and goes through RLS. Never put the service-role key in `hanu-v1/project/` files.

4. **Two writers, one DB.** Hermes writes (`messages`, `conversations`, `memories`, `memory_inbox`, `reminders`, `open_loops`, `goals`, `goal_completions`, `promises`, `decisions`, `approvals`, `routines`, `appointments`, `daily_reviews`, `activity_log`). UI writes everything EXCEPT `messages`/`conversations`. Real-time push goes UI ← Supabase ← Hermes. UI-edited approvals trigger Hermes via Supabase realtime subscriptions in `events.py` (planned; not all paths wired yet).

5. **`hermes-agent/AGENTS.md` is upstream Nous Research's spec for Hermes itself.** Do not edit; it gets overwritten on Hermes updates. Hanu-specific instructions to the LLM live in `hermes-hanu-skill/SKILL.md` and `hanu-v1/project/SOUL.md` (which is deployed to the VPS as the system prompt).

6. **The PRD is the behavior spec, not the visual design.** Privacy defaults, permission tiers 0-4, "ask before saving", quiet hours, modes (calm/firm/strict), follow-up + recovery rules — all live in the PRD HTML and are only partially implemented. When asked to implement a behavior, check the PRD first.

## Editing conventions specific to this repo

- The `hermes-agent/` subtree has its own `.git/` and is treated as vendored — don't commit changes inside it.
- When adding a new `hanu_call` tool: signature in `tools.py`, doc in `SKILL.md`, optionally a mirror handler in `mirror-to-hanu.py` if a Hermes built-in could trigger the same intent.
- `supabase/schema.sql` is meant to be **idempotently re-runnable** on a fresh project. New tables go at the bottom; new columns via `alter table` blocks at the end (or a real migration file once we have `supabase migration new`).
- `hanu-v1/project/` files are loaded in the order declared by `index.html`. `data.jsx` defines `window.HANU` shape; `supabase-client.jsx` overwrites it from real data; screen files read from it.
