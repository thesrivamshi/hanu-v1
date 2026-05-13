-- Migration: AI-disclosure scaffolding.
-- Per tasks/21-ai-disclosure-family.md.

alter table public.conversations
  add column if not exists first_contact_disclosed_at timestamptz;

alter table public.people
  add column if not exists opted_out_at timestamptz;

-- The disclosure preamble itself is sent from the outbound helper in
-- hermes-hanu-skill/tools.py (hanu_send_with_disclosure / hanu_register_opt_out)
-- — no Postgres trigger needed.
