# 11 — Voice notes: audio storage + transcription pipeline

**Priority:** P2
**Effort:** 1-2 days
**Depends on:** none
**Status:** TODO
**Risk if skipped:** the PRD's "voice-note understanding for quick capture while walking, driving, or thinking" is the third bullet under Conversational Assistant. Today, WhatsApp voice messages either disappear or are processed only if Hermes' built-in audio handling happens to work — there's no audit trail and no UI surfaceability.

---

## Context

The Baileys bridge receives WhatsApp voice notes as audio attachments (OGG/Opus). Today, they likely arrive at Hermes' gateway but there is no schema slot for them. The agent may or may not transcribe and react. Either way, the row in `messages` is at best `content='<voice note>'`, losing the actual audio and any later traceability.

We need:
1. Persist the audio file in Supabase Storage.
2. Transcribe via Whisper (OpenAI) or `whisper.cpp` locally.
3. Store both URL and transcript on the `messages` row.
4. The agent processes the transcript exactly like a text message.

---

## Acceptance criteria

- `messages.voice_audio_url text` and `messages.voice_transcript text` columns exist.
- A Supabase Storage bucket `voice-notes` exists with private access policies (only the owning user can read).
- WhatsApp voice notes arriving at the Baileys bridge get uploaded to the bucket; `voice_audio_url` is set to a signed URL or storage path.
- Whisper transcription runs within 5s of the message arriving; `voice_transcript` is set.
- The agent treats `voice_transcript` as the message content for purposes of `hanu_propose_memory`, `hanu_create_reminder`, etc.
- The UI's "Ask Hanu" search returns voice-derived memories when querying their transcript.

---

## Implementation steps

### Step 1 — Schema additions

```sql
alter table public.messages
  add column if not exists voice_audio_url text,
  add column if not exists voice_transcript text,
  add column if not exists voice_duration_ms integer,
  add column if not exists voice_transcription_state text default 'pending'
    check (voice_transcription_state in ('pending', 'transcribed', 'failed', 'na'));

create index if not exists messages_voice_pending_idx
  on public.messages(created_at)
  where voice_transcription_state = 'pending';
```

`voice_transcription_state = 'na'` for non-voice messages; default is `'pending'` only when audio is present. Default `'na'` on insert is cleaner — let the upload path bump to `'pending'`. Adjust the migration accordingly:

```sql
alter table public.messages
  alter column voice_transcription_state set default 'na';
```

### Step 2 — Storage bucket

In Supabase dashboard or via API:

```bash
# Create the bucket (private)
curl -X POST "${SUPABASE_URL}/storage/v1/bucket" \
  -H "Authorization: Bearer ${SUPABASE_SECRET_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"id":"voice-notes","name":"voice-notes","public":false}'
```

RLS policy on the bucket: only the owner can read. Define a policy keyed off folder structure `voice-notes/<user_id>/...`:

```sql
-- Storage policy (run in Supabase SQL editor):
create policy "voice-notes owner read"
  on storage.objects for select
  using (
    bucket_id = 'voice-notes'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "voice-notes owner insert"
  on storage.objects for insert
  with check (
    bucket_id = 'voice-notes'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
```

### Step 3 — Baileys bridge: upload on receive

The Baileys bridge runs as a Node process. Wherever it currently calls Hermes with a text message, add a branch for audio messages:

```js
// Pseudocode for the message handler inside the Baileys bridge:
async function onMessage(msg) {
  if (msg.message?.audioMessage) {
    const buffer = await downloadAudio(msg);  // Baileys helper
    const path = `${HANU_USER_ID}/${Date.now()}_${msg.key.id}.ogg`;
    await supabase.storage.from('voice-notes').upload(path, buffer, {
      contentType: msg.message.audioMessage.mimetype || 'audio/ogg',
    });
    const { data: { signedUrl } } = await supabase.storage
      .from('voice-notes').createSignedUrl(path, 60 * 60 * 24 * 7);  // 7 days

    // Insert messages row directly (or send a structured event to Hermes
    // that includes voice_audio_url and voice_duration_ms).
    await supabase.from('messages').insert({
      conversation_id: conversationId,
      user_id: HANU_USER_ID,
      role: 'user',
      content: '[voice note]',
      voice_audio_url: signedUrl,
      voice_duration_ms: msg.message.audioMessage.seconds * 1000,
      voice_transcription_state: 'pending',
      channel_message_id: msg.key.id,
      raw_payload: msg,
    });

    // Trigger transcription (next step picks it up async)
  } else {
    // text path, unchanged
  }
}
```

Code structure depends on the actual Baileys bridge file; locate it on the droplet (likely `/root/hanu-baileys/` or similar) and patch the message handler there.

### Step 4 — Transcription worker

`/root/.hermes/skills/hanu-bridge/transcription_worker.py`:

```python
"""
Hanu transcription worker.

Polls messages with voice_transcription_state='pending' every 5 seconds,
downloads the audio, sends it to OpenAI Whisper API, writes the transcript
back. On failure, marks state='failed'.
"""
import io
import os
import time
import traceback
import requests
from openai import OpenAI

from db import sb, USER_ID, log_activity

POLL_INTERVAL_S = 5
client = OpenAI(api_key=os.environ["OPENAI_API_KEY"])

def _tick():
    pending = sb().table("messages").select(
        "id,voice_audio_url"
    ).eq("voice_transcription_state", "pending").eq("user_id", USER_ID).limit(10).execute().data or []

    for m in pending:
        try:
            r = requests.get(m["voice_audio_url"], timeout=30)
            r.raise_for_status()
            audio = io.BytesIO(r.content)
            audio.name = "voice.ogg"
            tr = client.audio.transcriptions.create(
                model="whisper-1",
                file=audio,
                language="en",
                # Optional: response_format='json'
            )
            transcript = tr.text.strip()

            sb().table("messages").update({
                "voice_transcript": transcript,
                "voice_transcription_state": "transcribed",
                "content": f"[voice] {transcript}",  # so existing 'content' downstream just works
            }).eq("id", m["id"]).execute()

            log_activity("voice_transcribed",
                         f"Transcribed voice note: {transcript[:80]}",
                         "messages", m["id"])
        except Exception as e:
            traceback.print_exc()
            sb().table("messages").update({
                "voice_transcription_state": "failed",
            }).eq("id", m["id"]).execute()

def main():
    while True:
        try:
            _tick()
        except Exception:
            traceback.print_exc()
        time.sleep(POLL_INTERVAL_S)

if __name__ == "__main__":
    main()
```

systemd unit `/etc/systemd/system/hanu-transcription-worker.service`:

```ini
[Unit]
Description=Hanu voice-note transcription worker
After=network.target
[Service]
Type=simple
User=root
EnvironmentFile=/root/.hermes/.env
WorkingDirectory=/root/.hermes/skills/hanu-bridge
ExecStart=/usr/local/lib/hermes-agent/venv/bin/python transcription_worker.py
Restart=always
RestartSec=10
StandardOutput=append:/var/log/hanu/transcription-worker.log
StandardError=append:/var/log/hanu/transcription-worker.log
[Install]
WantedBy=multi-user.target
```

```bash
systemctl daemon-reload
systemctl enable --now hanu-transcription-worker
```

### Step 5 — Agent wakes when transcription completes

Two options:

**Option A (simple, latency ~5s):** the bridge sends the message to Hermes immediately after upload with `content='[voice note pending]'`. The agent waits for transcription before reacting — write a tool `hanu_wait_for_transcript(message_id, timeout_s=30)` that blocks. The agent calls it when it sees `[voice note]` content.

**Option B (cleaner):** the transcription worker, on success, publishes a message to Hermes' inbound queue so the agent runs as if a fresh text message arrived with the transcript as content. This requires a Hermes API for "inject a turn" — check `hermes-agent/cli.py` and `gateway/` for how the gateway accepts inbound messages.

Option B is correct long-term; option A is fine for v1. Document the choice.

### Step 6 — UI shows voice provenance

`hanu-v1/project/supabase-client.jsx` — `shapeMemory` or wherever memories are loaded: if a memory's `source_message_id` points to a message with `voice_transcript IS NOT NULL`, render a 🎙 icon and link to playback (signed URL).

---

## Verification

Send a WhatsApp voice note to the bot. Within 10 seconds:

```sql
select id, content, voice_audio_url, voice_transcript, voice_transcription_state, created_at
  from public.messages
 where user_id = 'd804b9ed-5eaa-497c-8390-86ba02007a33'
   and voice_audio_url is not null
 order by created_at desc
 limit 1;
```

Expected: `voice_transcription_state='transcribed'`, `voice_transcript` non-empty.

Also: the agent should react to the voice content as if it had been typed.

---

## Rollback

```sql
alter table public.messages
  drop column if exists voice_audio_url,
  drop column if exists voice_transcript,
  drop column if exists voice_duration_ms,
  drop column if exists voice_transcription_state;
```

```bash
systemctl disable --now hanu-transcription-worker
rm /etc/systemd/system/hanu-transcription-worker.service
```

Leave the storage bucket for later use.

---

## Files touched

- `supabase/schema.sql` (columns)
- Supabase Storage bucket + policies (dashboard or API)
- Baileys bridge (Node) — message handler
- `hermes-hanu-skill/transcription_worker.py` — new file
- `/etc/systemd/system/hanu-transcription-worker.service` — new file (droplet)
- `hanu-v1/project/supabase-client.jsx` — voice provenance in shapeMemory
- `hanu-v1/project/modals.jsx` — memory-detail modal renders 🎙 + playback link

---

## Notes

- OpenAI Whisper API cost: ~$0.006/min. 10 voice notes × 30s/day = ~$0.03/day. Negligible.
- For privacy-sensitive users, switch to `whisper.cpp` running locally on the droplet. ~200ms/sec of audio on a 2-CPU droplet for the base model. Free, slower, no API call.
- Signed URLs expire (we set 7 days above). Either re-sign on demand from the UI, or store the storage path and generate signed URLs at view time.
- For multi-language users (Telugu, Hindi), set `language=None` so Whisper auto-detects; pricing is the same.
