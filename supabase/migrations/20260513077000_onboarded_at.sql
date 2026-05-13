-- Migration: settings.onboarded_at for the first-conversation flow.
-- Per tasks/18-onboarding-first-conversation.md.

alter table public.settings
  add column if not exists onboarded_at timestamptz;
