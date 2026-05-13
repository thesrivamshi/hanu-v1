# Prompt: Independent Review of Hanu Architecture & Implementation

> Paste this into a fresh Claude session (Claude.ai web, Claude Code in this folder, or any other Claude tool with file access). Attach or share access to the `/Users/srivamshi/MyDrafts/Hanu-v1/` folder so the reviewer can read every file referenced below.

---

## Who you are

You are a senior software architect with experience in AI agents, MCP, real-time systems, and product/engineering trade-offs. You have no prior context from this codebase — you are reviewing it cold and independently.

Your job: read the materials, understand what we're trying to build, then tell us **where we are going wrong** — architectural, behavioral, UX, and security. Be direct. We are not looking for compliments. We are looking for a brutally honest critique by someone who has built this kind of system before.

## What we are trying to build (in one paragraph)

**Hanu** — a self-evolving personal memory, reminder, accountability, relationship and execution assistant for a single user (and eventually their family). The user (Vamshi) chats with Hanu primarily via **WhatsApp**. Hanu remembers preferences, tracks goals, holds promises, schedules reminders, logs decisions, knows people (mother, father, co-founder, partner), and respects privacy levels. A **React web UI** shows everything Hanu has captured — the user views and edits but does not enter raw data there; the database fills up *through conversation*. Everything is meant to evolve naturally: the database starts empty, and the more the user talks to Hanu, the richer the model of their life becomes.

## Where everything lives in the repo

```
/Users/srivamshi/MyDrafts/Hanu-v1/
├── HANU_PROJECT_PLAN.md           — long-form plan (read this first)
├── BRIDGE_DESIGN.md               — how Hermes, Supabase, and UI connect
├── 9af35bd2-...png                — production V1 architecture diagram
├── hanu_product_requirements_interactive_v2.html  — full PRD (read this!)
├── supabase/
│   └── schema.sql                 — 23-table Supabase schema with RLS
├── hermes-hanu-skill/             — bridge skill installed inside Hermes
│   ├── SKILL.md                   — instructions to the LLM about Hanu's tools
│   ├── tools.py                   — Python tool implementations
│   ├── db.py                      — Supabase connection helpers
│   ├── hanu_call                  — shell wrapper for the LLM to invoke
│   ├── SOUL.md                    — Hanu's persona / hard rules
│   └── mirror-to-hanu.py          — post_tool_call shell-hook that mirrors
│                                    Hermes' built-in memory/todo/kanban writes
│                                    into Supabase via hanu_call
├── hanu-v1/                       — Anthropic design handoff
│   ├── README.md                  — design-handoff instructions
│   └── project/                   — the actual UI prototype
│       ├── index.html
│       ├── data.jsx               — defines window.HANU shape (empty arrays)
│       ├── supabase-client.jsx    — connects to Supabase, signs in,
│       │                            loads/subscribes, defines write helpers
│       ├── app.jsx, shared.jsx, screens-a/b/c.jsx, modals.jsx,
│       │ ambient.jsx, tweaks-panel.jsx, styles.css
│       └── screens/               — design reference screenshots
├── hermes-agent/                  — Nous Research Hermes agent source
│                                    (we treat it as a dependency we don't fork)
├── .env.local                     — Supabase + OpenAI + droplet credentials
│                                    (do NOT echo secrets; read only for context)
└── FILL_IN_HERE.txt               — user-filled credentials sheet
```

## Live deployment

- **Hermes agent**: running on a DigitalOcean Ubuntu 24.04 droplet at `168.144.30.107`. Talks WhatsApp via Baileys bridge, connected to `+919100410143` as the bot number, allowlist locked to the user's LID (`75935407714503@lid`). Systemd-supervised as `hermes-gateway.service` (user unit, lingering enabled).
- **LLM**: OpenAI `gpt-5.4-mini` accessed via Hermes' `ai-gateway` provider with base_url overridden to `https://api.openai.com/v1` (so the OpenAI API key works directly without Vercel AI Gateway).
- **Supabase**: project `hanu-v1` (ref `lcayzfqmemitlbjugbsq`), region `ap-south-1` (Mumbai). 21 tables, RLS on every user-owned table. One auth user provisioned (`desk.mightyminds@gmail.com`, profile id `d804b9ed-5eaa-497c-8390-86ba02007a33`). DB intentionally starts empty.
- **UI**: served by nginx on the same droplet at `http://168.144.30.107/`. The static React+Babel-in-browser bundle auto-signs in via the bootstrap email/password, fetches all rows, subscribes to real-time changes.

## The architecture as currently wired

```
WhatsApp (user's phone)
     │
     ▼
Baileys bridge (Node) ──► Hermes Gateway (Python systemd unit on the VPS)
                                   │
                                   ├── LLM = gpt-5.4-mini via OpenAI
                                   ├── Tools: ALL Hermes built-ins enabled
                                   │   (memory, todo, cronjob, kanban,
                                   │    file, terminal, web, etc.)
                                   ├── PLUS our hanu_call shell wrapper
                                   │   (callable via bash, exposes 30+ tools
                                   │    that all write to Supabase)
                                   ├── SKILL.md (loads from hermes skills)
                                   ├── SOUL.md (persona; tells agent which
                                   │   tools to prefer for Hanu's domain)
                                   └── post_tool_call shell-hook:
                                       mirror-to-hanu.py listens for
                                       memory/todo/kanban tool calls and
                                       mirrors them into Supabase via
                                       hanu_call so the UI sees them
                                                       │
                                                       ▼
                              Supabase Postgres + Realtime (Mumbai)
                                                       │
                          Real-time WebSocket subscription
                                                       │
                                                       ▼
                                            UI in browser
                                            (signed-in client)
```

## What's working

- Hermes installed cleanly. WhatsApp paired. Bot replies in the user's chat.
- LLM (`gpt-5.4-mini`) responds with reasonable, on-tone messages.
- `hanu_call` end-to-end works: CLI test from the droplet writes to Supabase, search returns the row.
- UI auto-signs-in, loads from Supabase, would re-render on real-time push.
- nginx serves the UI publicly at port 80 with correct MIME types.
- Schema RLS verified (anon role cannot read other users' data).
- The post_tool_call shell hook is registered, dry-run tested, and confirmed to mirror Hermes' `memory.add` writes into Supabase via `hanu_call save_memory`.

## What is NOT working (the pain points we want you to verify and dig into)

1. **Agent tool routing.** Even after writing a strong SOUL.md telling the agent to prefer `hanu_call` for memory/goals/reminders/promises/decisions, gpt-5.4-mini consistently reaches for Hermes' first-class structured tools (`memory`, `todo`, `cronjob`) instead of `hanu_call` (which is shell-invoked, higher friction). We tried:
   - Strengthening SOUL.md with explicit lists of forbidden tools.
   - Disabling Hermes' built-in `memory`, `todo`, `cronjob`, `kanban`, `session_search` toolsets surgically.
   - Re-enabling them after the user pushed back (he wants Hermes at full capability).
   - Adding a `post_tool_call` shell hook that mirrors Hermes' built-in writes into Supabase via `hanu_call`. (This is the current state — installed and working in dry-run, not yet validated on a real WhatsApp turn end-to-end.)
   We feel like we are fighting the model's instincts. Is this the right strategy? Should we instead expose Hanu's tools as a proper MCP server so they sit alongside Hermes' built-ins as first-class structured tools? What are we missing?

2. **UI fidelity to the design vs the empty-database reality.** The original prototype was built around a richly populated mock (Aarav with mother Geeta, father Ramesh, Aman, Ishita, Dr. Mehta, hardcoded streaks, fake KPIs). We swept through and stripped hardcoded values — most KPIs are now live counts and empty states say "talk to Hanu on WhatsApp." But the user can probably still see remnants. Find them. Also assess: is the empty-state UX actually inviting, or does the UI feel broken when the DB is empty? Suggest concrete improvements.

3. **Latency / mirror correctness.** The current mirror is best-effort, async-ish (subprocess invocation of `hanu_call`). What can go wrong? Idempotency? Out-of-order writes? Mirror failures silently swallowed? How should we handle Hermes' `memory.replace` and `memory.remove` actions, which currently don't have safe mirror semantics? Same question for cronjob and the bidirectional aspect (UI edits flowing back to Hermes).

4. **Authentication.** The UI hardcodes the bootstrap email + password and auto-signs in. For single-user v1 we said this is fine. Is it? What are the realistic attack vectors? Suggest a cleaner v1 auth that's still usable from the user's phone with minimal friction.

5. **Data model gaps.** Read the PRD HTML carefully and the schema.sql. Does the schema cover what the PRD calls for? Missing tables? Misnamed columns? Privacy levels mapped correctly? Are there features in the PRD that have no DB representation? List specific gaps with severity.

6. **The "Hanu character / persona" problem.** The user wants Hanu to feel like a distinct character, not a generic chatbot wearing a name tag. Read SOUL.md. Is that enough? What's missing in how we're shaping the agent's behavior, tone, proactivity, follow-up discipline (per the PRD), recovery behavior, etc.? Suggest concrete changes.

7. **Hermes vs Hanu tension.** Hermes is built by Nous Research for general-purpose self-improving agent use. We're using it as the runtime for a specific personal-OS product. Where does that bend at the joints? When Hermes updates upstream, what breaks? Is our skill + shell-hook + SKILL/SOUL approach durable, or are we accumulating tech debt?

8. **Production-readiness for "for me and my family"** (the user's near-term scope). The user does NOT want this to be a startup product yet — it's personal. But it should be robust enough for him + 4 family members. What's missing for that scale specifically (multi-user isolation, family-space data sharing, per-person tone, notification fan-out, backup, monitoring, rollback)?

## Constraints / decisions already locked

- Hermes stays. Not forking it.
- WhatsApp is the primary chat surface (via Baileys, not Meta Business API).
- Supabase is the durable database.
- React UI from the Anthropic design handoff is the user-facing dashboard. We can refactor it into Next.js later; right now it's static HTML+JSX+CSS served by nginx.
- DigitalOcean droplet (single VPS). May add more later.
- OpenAI `gpt-5.4-mini` is the current LLM. Willing to bump to `gpt-5.4` (full) if it clearly helps.

## What we want from you

A single response with these sections, in order:

1. **Read first**: confirm you read `HANU_PROJECT_PLAN.md`, `BRIDGE_DESIGN.md`, `supabase/schema.sql`, `hermes-hanu-skill/SKILL.md`, `hermes-hanu-skill/SOUL.md`, `hermes-hanu-skill/tools.py`, `hermes-hanu-skill/mirror-to-hanu.py`, the PRD HTML, and at least `hanu-v1/project/supabase-client.jsx` + `app.jsx`. Note any file you couldn't read.

2. **Verdict on architecture** (≤ 200 words). Are we headed in the right direction overall? Yes/no with one-paragraph why.

3. **Top 5 things going wrong, ranked by severity.** For each: what's broken, why it matters, what to do about it. Concrete file paths and code suggestions where possible.

4. **The agent-routing question specifically.** Should we:
   - (a) keep fighting via prompts (SOUL.md + SKILL.md + mirror hook),
   - (b) build a proper Hanu MCP server,
   - (c) something else?
   Recommend with reasoning. What does the literature on tool-routing for small/mid-size LLMs say? Cite specifics if you can.

5. **Data model audit.** Run through the PRD section by section and the schema table by table. List every PRD feature that has no schema representation or is mis-modeled. Severity-tagged.

6. **UX critique of the current UI.** Open the design files (jsx) and the design screenshots (`hanu-v1/project/screens/*.png`). Compare what's deployed to what was designed. What's lost, what's broken, what should be fixed first.

7. **Three concrete things to do next, in order.** No fluff. Just: do X first, then Y, then Z. With effort estimates.

8. **Things we should kill or simplify.** What's over-engineered for v1? What can be removed without losing essential function?

9. **Risks we haven't thought about.** Things that haven't come up in our conversation but should.

Be direct. Use plain English. The user is a non-coder; he'll read your critique. Be careful not to use jargon without unpacking it. But be technically rigorous in your reasoning — engineers will read it too.

Skip pleasantries. Start with section 1.
