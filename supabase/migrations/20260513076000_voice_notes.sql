-- Migration: voice-note columns on messages.
-- Per tasks/11-voice-notes.md.
-- Baileys bridge uploads to Storage bucket 'voice-notes/<uid>/...' and inserts
-- the messages row with state='pending'. The transcription worker
-- (hermes-hanu-skill/transcription_worker.py) polls and fills voice_transcript.

alter table public.messages
  add column if not exists voice_audio_url       text,
  add column if not exists voice_transcript      text,
  add column if not exists voice_duration_ms     integer,
  add column if not exists voice_transcription_state text not null default 'na';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'messages_voice_transcription_state_check'
  ) then
    alter table public.messages
      add constraint messages_voice_transcription_state_check
      check (voice_transcription_state in ('pending','transcribed','failed','na'));
  end if;
end $$;

create index if not exists messages_voice_pending_idx
  on public.messages(created_at)
  where voice_transcription_state = 'pending';

-- Trigram FTS over transcripts (the conditional sibling from task 14).
create index if not exists messages_voice_transcript_trgm_idx
  on public.messages using gin (voice_transcript gin_trgm_ops)
  where voice_transcript is not null;
