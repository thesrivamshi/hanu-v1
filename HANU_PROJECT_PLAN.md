# Hanu Project Plan

A plain-English plan to build Hanu — the self-evolving personal memory and execution assistant — on top of the Hermes agent, with a WhatsApp front door, a Supabase database, and a UI.

Written for someone who does not code. Anything that sounds like jargon is explained the first time it appears.

---

## 1. The one-paragraph version

You want three things connected: (a) the Hermes agent that already lives in your folder, which can chat over WhatsApp; (b) a database where every conversation, memory, reminder, goal, and approval is stored; and (c) a UI based on a design file from Anthropic. The good news is that Hermes already speaks WhatsApp natively and already has its own internal database — so we are not building from zero. The work is to add a second database (Supabase) as the "shared brain", bridge Hermes to it, build the UI on top of it, and then implement the Hanu-specific behaviors from your product requirements document (memory inbox, family spaces, permissions, approvals, modes, etc.). All of this is technically possible. Realistically, it is a multi-month project broken into small slices. We can ship something useful at the end of every slice.

---

## 2. What you already have in this folder

**The Hermes agent source code** — at `hermes-agent/`. This is the open-source agent by Nous Research. It already supports terminal chat, Telegram, Discord, Slack, WhatsApp, Signal, voice notes, memory, scheduled tasks, and skills. Its WhatsApp bridge does not need a Meta Business account — it uses a "linked device" pairing (you scan a QR code with your phone, exactly like WhatsApp Web).

**Your Hanu Product Requirements document** — `hanu_product_requirements_interactive_v2.html`. A very detailed spec covering memory with privacy levels, goals with recovery, reminders with follow-up, family/shared spaces, permission tiers 0 through 4, approval queue, message relay, promises, decision log, inboxes, modes, and control center capabilities. The document explicitly states it is the behavior spec, not the visual design.

**The architecture diagram** — `9af35bd2-...png`. The "Hanu Production V1 Architecture (Hermes-Centric)" picture. Shows clients (WhatsApp, mobile app, admin dashboard) at the top, Hermes Core Runtime in the middle, and PostgreSQL plus a vector database plus object storage at the bottom. This is the system we are building.

**The design file** — currently unreadable. The Anthropic URL you shared returns a compressed binary bundle that my tools cannot unwrap. To unblock the UI work I will need either screenshots of each screen saved into this folder, or an export from the design viewer (look for a Download or Copy Code button), or the design pasted in another viewable format.

---

## 3. Honest scope assessment

Reading your product requirements end-to-end, this is a real product. Comparable products (Mem, Reflect, Rewind, Notion AI, Saner, even pieces of Notion itself) had teams of multiple engineers and designers working for many months. The smallest useful version — "WhatsApp messages flow into a database and show up on a screen" — is one to two weeks of focused work. The full Hanu vision with family spaces, permissions, approvals, modes, recovery, decision logs, and relationship maintenance is many months of work.

Because you do not code, the way this works is: I write the code, you make the decisions (which accounts to create, what to name things, where to host, how strict the privacy defaults should be), and you test each slice in the real world. Every slice produces something you can actually use. We do not build the whole thing in the dark and reveal it at the end.

Two important constraints to keep in mind throughout:

**Hermes is not Anthropic's software.** It is built by Nous Research and is MIT-licensed open source. We can modify it freely. We can also choose to leave it untouched and put Hanu on top — which I recommend, because Hermes gets active updates we want to benefit from.

**WhatsApp's "linked device" approach has a small ban risk.** Hermes' bridge emulates WhatsApp Web, which is not officially sanctioned for bots. The Hermes documentation specifically warns to use a dedicated phone number (not your personal one), keep usage conversational, and never send bulk outbound messages. For a personal Hanu used by you and family, this is acceptable. For a product sold to many users, we eventually move to the official WhatsApp Business API, which costs money and requires Meta verification but cannot be banned.

---

## 4. The phased plan

Six slices. Each slice ends with something you can actually use. After each slice we pause, review, and decide whether to continue to the next.

---

### Slice 0 — Decisions and accounts (~1 day, no coding)

Before any code, we need to make a few choices and create a few accounts. Everything that follows depends on these.

**What we decide:**

- **Where Hermes runs.** Options: (a) on your Mac, where it stops when your Mac is asleep — fine for testing; (b) on a small cloud server costing about $5/month, runs 24/7 — needed for real use. Recommend (a) for slice 1, move to (b) before slice 4.
- **Which LLM provider Hermes uses.** Hermes can use Anthropic Claude, OpenAI, Google Gemini, OpenRouter (which gives access to 200+ models from one bill), or many others. Recommend OpenRouter to start, because one signup gives us flexibility.
- **WhatsApp number.** Personal number (fastest, you message yourself) or a dedicated second number (cleaner, lower ban risk). For testing recommend the personal "self-chat" mode. For real use get a second number — easiest in India is a prepaid SIM, in the US Google Voice is free.
- **Project name in databases.** "Hanu" or something else? Affects all naming downstream.

**What you sign up for:**

- **OpenRouter** at openrouter.ai — for AI model access. Free to sign up, pay-as-you-go after. Budget $5–20/month for personal use to start.
- **Supabase** at supabase.com — for the shared database (we use this in slice 2). Free tier is generous and almost certainly enough for personal use.
- **A GitHub account** if you don't already have one — for hosting code and deploying things. Free.

**What I produce:** A short decisions document with everything chosen, plus a checklist of accounts created and credentials saved. Nothing is built yet.

**Hard parts:** None really. This is paperwork.

---

### Slice 1 — Hermes + WhatsApp working on your Mac (~3-5 days)

**Goal:** You send a WhatsApp message and Hermes replies. The agent uses your chosen LLM. Memory works locally.

**End-user result:** You open WhatsApp, message your bot number, and have a real conversation with Hermes. It remembers things across messages.

**What I do:**

- Walk you through installing Hermes (it has a one-line installer).
- Help you run `hermes setup` to configure the LLM and basic settings.
- Help you run `hermes whatsapp` to pair the WhatsApp bridge — you scan a QR code with your phone and you're connected.
- Help you start `hermes gateway` so messages flow.
- Set sensible defaults from your PRD: a system prompt that tells Hermes its name is Hanu, it should clarify whether something is a note/task/reminder/memory, and basic privacy defaults.

**What you do:** Install on your Mac (with my step-by-step instructions). Provide your OpenRouter API key. Hold up your phone to scan the QR.

**Accounts/signups required:** OpenRouter (slice 0). A WhatsApp account.

**Hard parts:**

- **Terminal nervousness.** You will use Terminal app a few times to type commands. I will write them out exactly and explain each one. There is nothing dangerous if you copy-paste what I give you.
- **Mac-asleep problem.** If your Mac sleeps, the bot stops. For slice 1 this is fine; for real daily use we need to move to a cloud server (slice 4).
- **WhatsApp ban risk.** Negligible for personal use, but real. If you use a dedicated number we keep this near zero.

**Time:** Two to three sessions of one to two hours each. The first session is installation and configuration. The second is WhatsApp pairing and testing.

---

### Slice 2 — Supabase database and bridge (~1-2 weeks)

**Goal:** Every message Hermes sees, every memory it creates, every reminder it sets, also lands in a Supabase database that we control. This becomes the "single source of truth" for the UI.

**End-user result:** No visible change in WhatsApp behavior. But behind the scenes, everything is now mirrored to Supabase, and you can open the Supabase dashboard in your browser and see your data in tables.

**What I build:**

- **Database schema** — the set of tables that match your product requirements: `users`, `people`, `spaces`, `space_memberships`, `permissions`, `conversations`, `messages`, `memories`, `memory_privacy_levels`, `reminders`, `goals`, `goal_actions`, `promises`, `decisions`, `open_loops`, `approvals`, `activity_log`, `modes`. I will draft this from your PRD and explain each table to you in plain English before we create them.
- **Bridge service** — a small Python program that runs alongside Hermes. It listens for events ("new message received", "memory saved", "reminder created") and writes them to Supabase.
- **Reverse direction** — if you change something in Supabase (or later in the UI), Hermes picks up the change.

**What you do:** Create a Supabase project (one click on supabase.com). Share the project URL and "service role key" with me (or let me read them from a file you save locally). Review the schema before we apply it — I will give you a plain-English description of every table.

**Hard parts:**

- **Designing the schema right the first time.** The PRD is ambitious. We will not capture every nuance in one shot. I will design v1 to be "good enough to extend later, not impossible to migrate." This is the kind of decision where I will ask you many small questions ("Should a memory belong to a person or to a space or both?").
- **Bridging without duplicating work.** Hermes already has its own internal database (SQLite). We are not replacing it — we are mirroring relevant parts to Supabase. The bridge has to handle conflicts (what if Supabase and Hermes' SQLite disagree?).
- **Privacy categories from the PRD.** Your PRD specifies five privacy levels (private, shareable with approval, shared with person, shared inside space, never share). We bake these into the schema from day one, even though the UI to manage them comes later.

**Time:** Three to four sessions over one to two weeks. Most of the time is decisions, not typing.

---

### Slice 3 — Build the UI as a read-only window (~2-3 weeks)

**Goal:** Build the screens from your design as a working web app that you can open on your phone or laptop. It reads from Supabase and shows your conversations, memories, today's reminders, goals, people, and approvals. Read-only — no editing yet.

**End-user result:** You open a URL on your phone. You see "Today" (what matters now), your memory list, your reminders, your people and spaces, and your activity history. Everything updates within seconds of new WhatsApp activity.

**What I need from you before I can start this slice:** The design file in a viewable format. Screenshots saved into the folder are the easiest. Or, if you can find a "Copy code" or "Export" button in the design viewer, the exported HTML.

**What I build:**

- A web app using **Next.js** (a popular framework for building web apps that also work like mobile apps). I will explain why I am choosing it. Alternatives are Astro, plain HTML, or React Native if you want a real mobile app — but Next.js is the best starting point and we can ship a mobile app later.
- Each screen from your design, faithfully.
- The screens connect to Supabase and show real data.
- Deploy to **Vercel** (free tier, owned by the company that makes Next.js) so the app is available at a real URL.

**What you do:** Provide the design. Review each screen as I build it. Test on your phone. Give honest feedback on what feels right and what feels wrong.

**Accounts/signups required:** Vercel (free). Nothing else.

**Hard parts:**

- **Designs versus reality.** Designs always have edge cases the designer did not consider. "What if the user has zero memories?" "What if a reminder has no due time?" I will ask many small questions during this phase.
- **Mobile feel.** Your PRD implies the product is mostly used on the phone. Next.js does a fine job for this but it is not a "real" mobile app. If you need install-on-phone-from-app-store experience, that is a later slice.
- **Speed.** Reading from Supabase is fast. Reading the right things in the right order so the page loads instantly takes care.

**Time:** Three to five sessions over two to three weeks, depending on design complexity.

---

### Slice 4 — Make the UI two-way + move Hermes to the cloud (~2-3 weeks)

**Goal:** You can edit, approve, delete, pin memories from the UI. The approval queue actually works (you tap "approve" in the UI and Hermes sees it). The agent runs 24/7 on a small cloud server so it works when your Mac is asleep.

**End-user result:** Hanu is now actually useful. WhatsApp works any time, the UI is live, you have a control center, and edits in either place stay in sync.

**What I build:**

- Editable UI screens — buttons that actually change things.
- An API (a small set of URLs the UI can call) that lets the UI tell Hermes to do things ("create this reminder", "forget this memory", "approve this request").
- Migrate Hermes from your Mac to a cloud server (recommend a $5/month server on Hetzner, DigitalOcean, or Railway).
- Set up automatic deploys: when I make code changes, they roll out without you doing anything.

**What you do:** Make a small payment for the cloud server (about $5/month). Choose a domain name if you want hanu.yourname.com instead of a free Vercel URL.

**Accounts/signups required:** A cloud hosting account (recommend Railway or Hetzner). Optionally a domain registrar (Namecheap, Porkbun).

**Hard parts:**

- **The first time anything runs in the cloud is fragile.** Permissions, environment variables, secrets — getting them all right takes patience.
- **Sync conflicts.** If you edit a memory in the UI at the same time Hermes is editing it from a WhatsApp message, who wins? We need rules. The PRD already hints at conflict-handling for shared responsibilities.
- **Costs.** Once we are in the cloud, we are paying for things — small amounts but real. Budget $10–30/month total for cloud + OpenRouter + miscellaneous.

**Time:** Three to four sessions over two to three weeks.

---

### Slice 5 — Hanu-specific behaviors (~ongoing, in small chunks)

This is where we start implementing the PRD features one at a time. Each is a small project on its own. Order is rough — we can rearrange based on what you need most.

**5a. Memory Inbox + Open-Loop Inbox.** The "holding area" your PRD describes. Hermes captures possible memories and open loops from conversations, you approve them in the UI before they become permanent.

**5b. Five privacy levels enforced.** Hermes refuses to share private info, asks before sharing approval-required info, etc. UI shows the level on every memory.

**5c. Reminders with follow-up and recovery.** Not fire-and-forget. Hermes follows up if you don't respond, asks why, suggests smaller actions.

**5d. Goals with breakdown, streaks, and failure-reason tracking.** All the goal behavior from the PRD.

**5e. People, relationships, permissions tiers 0–4.** Add another person to Hanu, set their permission level, see what they can see/ask/do.

**5f. Family Space.** Shared reminders, shared appointments, conflict handling between family members.

**5g. Request relay between people.** "Tell Vamshi to call me" — Hanu relays it without leaking private info.

**5h. Approval queue.** The control-center approvals from the PRD work end to end.

**5i. Promises, decisions, relationship maintenance.** The longer-term tracking the PRD calls out.

**5j. Modes — Now Mode, Strict, Gentle, Deep Work, Quiet Hours.** Behavioral changes based on user state.

**5k. Today Command + Life Areas.** Cleaner "what matters now" view and life-area organization.

Each of these is one to three weeks of work on its own. Most are independent — we can ship them in any order, in whatever order matters most to you.

**Hard parts across all of 5:** Behavior design. The PRD describes what should happen, but does not specify exact wording, timing, sensitivity to user mood, etc. We will discover details by using it and adjusting.

---

### Slice 6 — Mobile app, multi-user, payments (only if you want to ship to others)

Up to this point we are building "Hanu for you and your family." Going further — letting strangers sign up, taking payments, supporting multiple separate Hanu accounts — is a different scale of project. We can talk about that if and when you want to.

This involves: a real mobile app on the App Store and Play Store, payment processing (Stripe or Razorpay), user authentication at scale, multi-tenant data isolation, support, terms of service, privacy policy, possibly App Store review pain, possibly moving WhatsApp from "linked device" to the official Business API.

Not for the first six months. Possibly never if Hanu remains a personal project.

---

## 5. Big-picture decisions you need to make soon

These shape everything downstream. We do not need answers today, but before slice 2 they have to be settled.

**Who is Hanu for?** Only you? You and family? Eventually strangers? Affects how seriously we treat authentication, privacy isolation, and ban risk.

**English only or multilingual?** Your name suggests potentially Telugu/Hindi/regional. Hermes' underlying LLMs handle most major languages, but the UI and prompts need translation. Adds work.

**Where is your data stored — region?** Supabase lets you pick a region. India (Mumbai) has slightly higher latency from US-hosted LLM APIs but better for India-only users. US-East is fastest for most LLMs.

**How private is "private"?** Your PRD specifies privacy levels but does not specify defaults. Should new memories default to private or shareable-with-approval? Defaults shape the product.

**Voice memos.** Hermes can transcribe WhatsApp voice notes. Do you want that on day one? Adds a small monthly cost (transcription) but is mentioned in the PRD.

**Visual style.** The PRD doc you have uses a warm cream/brown palette. The architecture diagram uses cooler greys. The design file presumably has its own. The UI inherits from the design file — but if the design isn't usable we pick a direction.

---

## 6. Time and cost summary

| Slice | Time | Cost to set up | Ongoing cost |
|-------|------|----------------|--------------|
| 0. Decisions/accounts | 1 day | $0 | $0 |
| 1. Hermes + WhatsApp on Mac | 3–5 days | $0 (or $5 for a SIM) | $5–20/mo for LLM use |
| 2. Supabase + bridge | 1–2 weeks | $0 | Free tier, then $25/mo if you grow |
| 3. UI (read-only) | 2–3 weeks | $0 | $0 (Vercel free tier) |
| 4. UI (two-way) + cloud Hermes | 2–3 weeks | $0 | +$5–10/mo for server |
| 5. PRD features (each) | 1–3 weeks each | $0 | small increases over time |
| 6. Mobile + multi-user | Months | $99/year Apple + $25 Google | $25+/mo more |

**Total realistic cost to run a personal Hanu for you and family at the end of slice 4:** $15–40/month, depending on how much you chat with it.

**Total time to get to "useful for me daily":** Roughly six to ten weeks of part-time work together, assuming we work two to three sessions a week.

---

## 7. The honest risk list

Things that could go wrong, in rough order of likelihood:

**WhatsApp ban.** Likelihood: low for personal use, real for bulk use. Mitigation: dedicated number, conversational style only, no outbound spam.

**WhatsApp Web protocol changes break the bridge.** Likelihood: happens once or twice a year. Mitigation: Hermes updates its bridge — we just `git pull` and re-pair. Out-of-pocket time, not money.

**Supabase free tier limits get hit.** Likelihood: only if usage grows. Mitigation: upgrade tier when needed, or move to self-hosted Postgres later.

**LLM costs surprise.** Likelihood: medium. Mitigation: use Hermes' built-in usage tracking, set monthly limits in OpenRouter, switch to cheaper models if needed.

**Schema mistakes need migration later.** Likelihood: high — we will get the schema imperfect on first try. Mitigation: I write migrations carefully, but expect one or two painful weeks somewhere in slice 5 where we restructure things.

**You decide halfway through the product should be different.** Likelihood: high — this is normal. Mitigation: every slice is its own deliverable, so changing direction does not throw away earlier work.

**I am wrong about something.** Likelihood: I make mistakes. Mitigation: every slice has a test step where you actually use the thing and tell me what's broken.

---

## 8. What I need from you to start

If you decide to proceed, here is the smallest possible first step.

**For slice 0 (decisions and accounts):**

1. Confirm you want to proceed with this plan, or push back on any of it.
2. Decide: dedicated WhatsApp number or personal self-chat for testing?
3. Sign up for OpenRouter at openrouter.ai. Save the API key somewhere you can find again.
4. Sign up for Supabase at supabase.com (don't create a project yet — we'll do that together).
5. Tell me your preferred name for the project in databases ("Hanu", "hanu_v1", something else).

Once those are done, we move to slice 1 — installation and WhatsApp pairing — and you will have a working Hermes/Hanu on WhatsApp within a session or two.

**Separately, to unblock the UI work later:** open the Anthropic design link in your browser, take screenshots of every screen, and save them into this folder. Or look for a Download / Export / Copy code button in the design viewer and save whatever that produces.

---

## 9. What this plan does not cover

In the interest of honesty:

- **App Store distribution.** Out of scope until slice 6.
- **Compliance.** GDPR, India's DPDPA, HIPAA, etc. Personal use is fine. The moment we share with anyone else we need to think about it.
- **Backups.** I will set up automatic Supabase backups in slice 2, but a personal backup strategy is your call.
- **Analytics.** "How often is each feature used" — we can add Posthog or similar in slice 5 if you want to see usage patterns.
- **AI safety / behavioral guardrails for your family members.** If non-tech-savvy family members use Hanu, we need extra care around what it will and won't do unprompted. I will raise this when we get to slice 5f (Family Space).

---

That's the plan. The shortest sentence summary: **everything you described is buildable, the WhatsApp piece is easier than you think because Hermes already does it, the rest is months of careful work in small slices, and the first meaningful version of "WhatsApp → database → UI" is achievable in roughly six to ten weeks of part-time work together.**
