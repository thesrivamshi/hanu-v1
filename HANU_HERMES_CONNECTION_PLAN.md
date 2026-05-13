# Hanu × Hermes — Connection Plan (v0)

_Plain-language plan for how the Hanu UI design connects to the Hermes Agent. Written for someone who is not a coder. No code in this document — just the architecture, the moving parts, and the order we'll build them in._

---

## 1. What we have today

**Hanu UI** — a polished React design with 12 screens (Today, Goals, Reminders, Open Loops, Memory Vault, Decision Log, Promises, Reviews, People & Access, Family Space, Approval Queue, Settings). Right now it runs in a browser with **fake data** baked into a file called `data.jsx`. It also has a product requirements document that describes the *behaviour* Hanu is supposed to have — memory privacy levels, family-space permissions, approval queues, promise tracking, failure-reason logging, modes, etc.

**Hermes Agent** — a real, working open-source AI agent from Nous Research. It already knows how to:

- talk to many AI models (Anthropic, OpenAI, OpenRouter, etc.) and switch between them
- remember things across conversations (its own SQLite memory)
- run scheduled jobs (a built-in cron — "every morning at 8am, do X")
- send and receive messages on WhatsApp, Telegram, Discord, Slack, etc. (its "gateway")
- run "tools" — Python functions we register with it that the AI can call ("look up this goal", "save this memory", "create this reminder")
- self-improve through a "skills" system

What Hermes does **not** know about today: goals, promises, family spaces, approval queues, memory privacy levels, reviews-with-failure-reasons. Those are Hanu's concepts.

---

## 2. The decisions you've already made

1. **Scope for v1** — single-user (you), but the database is designed for multi-user from day one. Adding family members later won't require throwing anything away.
2. **Where it runs** — on a cloud VPS, running 24/7. The UI gets deployed separately (Vercel or similar) so you can open it from any device. WhatsApp integration matters.
3. **How much we lean on Hermes** — maximum reuse. Hermes handles AI reasoning, scheduling, messaging, memory. We don't re-invent any of that.

---

## 3. The architecture in one paragraph

The **Hanu UI** (your React screens) becomes a real web app deployed on Vercel. For everyday data (listing goals, checking off reminders, editing memories, logging in) the UI talks **directly to Supabase**, which is our hosted Postgres database with auth, real-time updates, and `pgvector` for semantic search all bundled together. For *smart* actions — Quick Capture, Ask Hanu, approve-with-reasoning — the UI talks to a small **Hanu Agent API** on your VPS, which orchestrates **Hermes** (the AI brain). Hermes reasons through the task and reads/writes Supabase using new tools we register with it (`hanu_add_goal`, `hanu_save_memory`, `hanu_create_approval`, etc.). Hermes also drives the cron scheduler and WhatsApp gateway so reminders actually reach your phone.

The mental picture: **UI on Vercel → Supabase (for most data + auth + realtime) and → Hanu Agent API on VPS (for AI actions) → Hermes (same VPS) → reads/writes Supabase via tools, and sends WhatsApp via its gateway.**

---

## 4. Why this shape, and not the alternatives

**Why not stuff everything inside Hermes' own SQLite?** Hermes' database is built around conversation sessions. Forcing goals, family spaces, and approval queues into it would bend its schema out of shape, and any future Hermes update could break our additions. Keeping the Hanu data separate gives us a clean line.

**Why not just use Hermes' "memory" feature for everything?** Memory is free-text. UI screens like the Approval Queue or Family Space need structured rows you can sort and filter. Free-text memory can't power those.

**Why not write our own AI brain instead of using Hermes?** We'd lose the model routing, the WhatsApp/Telegram gateway, the cron, the skills system, the self-improvement loop. Years of work, gone. Hermes is the unfair advantage; we use it.

**Why Supabase and not a graph DB, vector DB, or plain SQLite?** Hanu's relationships are shallow (two or three hops) — graph databases are overkill. Vector databases would mean keeping data in two systems and constantly syncing them — `pgvector` inside Postgres gives us semantic search without a second database. SQLite would work, but we'd hand-build user accounts and real-time updates, both of which Supabase gives us for free. Most importantly, Supabase's row-level security is *exactly* the shape of Hanu's family-permission model — we can express "this memory is private" or "this goal is shared with the Battini Family space" as database rules rather than application code.

**Why a small Hanu Agent API in the middle, not the UI talking to Hermes directly?** Hermes' interface is built around chat/CLI, not web endpoints. The Hanu Agent API translates between the web world and the agent world cleanly. It also means we can swap Hermes for something else later if we ever want to.

---

## 5. The pieces, named

| Piece | What it is | Where it lives | Why it's there |
|---|---|---|---|
| **Hanu UI** | The React screens you designed | Deployed on Vercel | Public web app you open from any device |
| **Supabase** | Hosted Postgres + auth + realtime + pgvector | Supabase cloud (free tier) | Owns all Hanu data, handles login, pushes live updates to the UI, semantic memory search |
| **Hanu Agent API** | A small Python web service (FastAPI), ~5 endpoints | On your VPS | Bridge between the UI and Hermes for AI-powered actions (Quick Capture, Ask Hanu) |
| **Hermes Agent** | The existing Nous Research agent | Same VPS | AI reasoning, scheduling, messaging |
| **Hanu tools for Hermes** | A handful of new Python files in Hermes' `tools/` folder | Inside Hermes' repo | So Hermes can read/write Supabase when reasoning |
| **WhatsApp gateway** | Hermes' built-in gateway, configured for WhatsApp Business | Same VPS | Delivers reminders, accepts voice memos |

That's it. Six labelled boxes, but the heavy lifting (data, auth, realtime, vectors) all collapses into Supabase.

---

## 6. The order we'll build it in (proposed)

**Phase 0 — Plan agreed.** (This document.)

**Phase 1 — Supabase project + database schema.** Create the Supabase project. I draft the schema (tables, columns, relationships, row-level security policies) in plain English first. Every table has a `user_id` column from day one so multi-user is a future migration, not a future rewrite. Once you sign off, I create the tables in Supabase and enable row-level security policies.

**Phase 2 — Hanu Agent API skeleton.** A small Python FastAPI service on your VPS exposing the AI-powered endpoints the UI needs (Quick Capture, Ask Hanu, Approve-with-reasoning). Reads/writes Supabase using the `supabase-py` library.

**Phase 3 — Hanu tools for Hermes.** I write `hanu_add_goal`, `hanu_save_memory`, `hanu_create_approval`, `hanu_list_promises`, etc. as Python functions in Hermes' `tools/` folder. These also talk to Supabase. We test by chatting with Hermes from the terminal: "Hanu, save a goal: ship v1 by November" — and verify the row appears in Supabase.

**Phase 4 — Wire UI to Supabase + Agent API.** Take the React prototype out of "Babel in the browser" and turn it into a proper Vite + React app. For most screens (Goals, Reminders, Memory Vault, Decision Log, Promises, People), point at Supabase directly using `supabase-js`. For Quick Capture and Ask Hanu, point at the Hanu Agent API. Subscribe to Supabase realtime so the UI updates when Hermes writes.

**Phase 5 — Deploy.** Hanu Agent API + Hermes to your VPS (with HTTPS). UI to Vercel. Supabase is already cloud-hosted. Auth is already done by Supabase Auth.

**Phase 6 — WhatsApp Business gateway.** Configure Hermes' WhatsApp adapter against your WhatsApp Business number (this needs a few days of verification by Meta — we'll start it early in parallel with the other phases).

**Phase 7 — Family Space (v2).** Add the second user. Because the database already has `user_id` everywhere and Supabase row-level security is already in place, this becomes mostly about *new screens and new permission rules*, not a database rewrite. Each family member signs up with Supabase Auth and gets their own private Hanu; shared spaces are just rows linking them.

---

## 7. Decisions locked in so far

| Decision | Choice |
|---|---|
| Scope for v1 | Single user (you), DB designed multi-user from day one |
| Where it runs | Cloud VPS, 24/7. UI on Vercel |
| Hermes integration | Maximum reuse — Hermes is the brain, scheduler, and messenger |
| **Database** | **Supabase (hosted Postgres + auth + realtime + pgvector)** |
| VPS | You already have one (provider/OS to confirm) |
| Domain | Free temporary URL for now, real domain later |
| Hermes install | Already running with API keys configured |
| WhatsApp | Real WhatsApp Business number (deferred to Phase 6 — needs WhatsApp Business API setup, ~few days verification) |

## 8. Three small things I still need to know

These don't block Phase 1 (schema design), but I'll need them soon:

1. **VPS details** — which provider (Hetzner, DigitalOcean, AWS, etc.) and what OS is on it (Ubuntu 22.04 is the easiest). Also: is Hermes running on the VPS already, or only on your Mac?
2. **Where Hermes is installed** — the standard install path is `~/.hermes/` on Linux/Mac. Knowing this helps me write the new Hanu tools into the right place.
3. **Which AI model you're using** with Hermes (Claude, GPT, etc.) — this only matters for budget; the plan works the same regardless.

## 9. What happens next

**Phase 1: Database schema design** — I draft, in plain English, every table the Hanu DB needs (goals, reminders, promises, decisions, memories, people, spaces, approvals, reviews) and the columns on each. You read it like a spec sheet, push back on anything that doesn't match your mental model, and once you're happy I turn it into a real database.

---

_This document is a living plan. We'll edit it as we go. Last updated 2026-05-12._
