"""
Hanu voice-note transcription worker.

Polls `messages` rows with `voice_transcription_state = 'pending'` every 5s,
downloads the audio at `voice_audio_url`, sends it to OpenAI Whisper, writes
the transcript back, flips state to 'transcribed'. On failure flips to 'failed'.

Pre-conditions:
- The Baileys bridge has already uploaded the audio to Supabase Storage
  (`voice-notes/<user_id>/<msg-id>.ogg`) and inserted a row in `messages` with
  `voice_audio_url` (signed URL or storage path), `voice_duration_ms`, and
  `voice_transcription_state = 'pending'`.

Run as a systemd unit:

    # /etc/systemd/system/hanu-transcription-worker.service
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
"""
from __future__ import annotations

import io
import os
import time
import traceback
from typing import Any

import requests

from db import USER_ID, log_activity, sb

POLL_INTERVAL_S = 5
WHISPER_MODEL = os.environ.get("HANU_WHISPER_MODEL", "whisper-1")


def _openai_transcribe(audio_bytes: bytes, filename: str = "voice.ogg") -> str:
    """Call OpenAI's transcription endpoint. Returns the transcript text.
    Raises on any failure; the caller marks the row as 'failed'.
    """
    try:
        from openai import OpenAI  # imported lazily so the worker still
        # starts if the dependency is missing; the first call surfaces it.
    except ImportError as e:
        raise RuntimeError(
            "OpenAI SDK not installed; run "
            "`/usr/local/lib/hermes-agent/venv/bin/pip install openai requests`"
        ) from e

    client = OpenAI(api_key=os.environ["OPENAI_API_KEY"])
    fh = io.BytesIO(audio_bytes)
    fh.name = filename  # the SDK reads .name to pick a MIME type
    tr = client.audio.transcriptions.create(
        model=WHISPER_MODEL,
        file=fh,
    )
    return (tr.text or "").strip()


def _tick() -> None:
    pending = (
        sb()
        .table("messages")
        .select("id,voice_audio_url")
        .eq("voice_transcription_state", "pending")
        .eq("user_id", USER_ID)
        .limit(10)
        .execute()
        .data
        or []
    )
    for m in pending:
        try:
            r = requests.get(m["voice_audio_url"], timeout=30)
            r.raise_for_status()
            transcript = _openai_transcribe(r.content)
            sb().table("messages").update(
                {
                    "voice_transcript": transcript,
                    "voice_transcription_state": "transcribed",
                    "content": f"[voice] {transcript}" if transcript else "[voice]",
                }
            ).eq("id", m["id"]).execute()
            log_activity(
                "voice_transcribed",
                f"Transcribed voice note: {transcript[:80]}",
                "messages",
                m["id"],
            )
        except Exception:
            traceback.print_exc()
            try:
                sb().table("messages").update(
                    {"voice_transcription_state": "failed"}
                ).eq("id", m["id"]).execute()
            except Exception:
                traceback.print_exc()


def main() -> None:
    while True:
        try:
            _tick()
        except Exception:
            traceback.print_exc()
        time.sleep(POLL_INTERVAL_S)


if __name__ == "__main__":
    main()
