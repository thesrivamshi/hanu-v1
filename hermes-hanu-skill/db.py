"""
Supabase connection helpers for the Hanu bridge.

This module exposes:
- `sb()` — singleton Supabase client (service_role key — bypasses RLS).
- `USER_ID` — the Hanu user's profile UUID; needed for the user_id column.
- `log_activity(...)` — convenience for the activity_log table.

Environment variables it reads (from ~/.hermes/.env or process env):
- SUPABASE_URL
- SUPABASE_SECRET_KEY  (the sb_secret_... key from .env.local)
- HANU_USER_ID  (the auth.users id we provisioned for the human user)
"""

from __future__ import annotations

import os
import time
from functools import lru_cache
from typing import Any, Optional

# The supabase-py client. Installed via `uv pip install supabase`.
from supabase import Client, create_client

# Optional: load .env in case Hermes' systemd unit doesn't already inject vars.
try:
    from dotenv import load_dotenv  # type: ignore
    load_dotenv(os.path.expanduser("~/.hermes/.env"), override=False)
except Exception:
    pass


SUPABASE_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
SUPABASE_SECRET_KEY = (
    os.environ.get("SUPABASE_SECRET_KEY")
    or os.environ.get("SUPABASE_SERVICE_ROLE_KEY")  # legacy name
)
USER_ID = os.environ.get("HANU_USER_ID") or os.environ.get("HERMES_HANU_USER_ID")


class HanuConfigError(RuntimeError):
    """Raised when the bridge can't reach Supabase because config is missing."""


def _validate_config() -> None:
    missing = []
    if not SUPABASE_URL:
        missing.append("SUPABASE_URL")
    if not SUPABASE_SECRET_KEY:
        missing.append("SUPABASE_SECRET_KEY")
    if not USER_ID:
        missing.append("HANU_USER_ID")
    if missing:
        raise HanuConfigError(
            "Hanu bridge config incomplete. Missing: "
            + ", ".join(missing)
            + ". Set these in ~/.hermes/.env on the VPS."
        )


@lru_cache(maxsize=1)
def sb() -> Client:
    """Return a singleton service-role Supabase client.

    The service_role key bypasses Row Level Security. This is correct
    because Hermes acts on behalf of the user — there is no second user
    we need RLS to protect against in this process. The UI uses the
    anon/publishable key and goes through RLS normally.
    """
    _validate_config()
    return create_client(SUPABASE_URL, SUPABASE_SECRET_KEY)


def log_activity(
    kind: str,
    summary: str,
    target_table: Optional[str] = None,
    target_id: Optional[str] = None,
    reason: Optional[str] = None,
    visible_to: Optional[list[str]] = None,
    actor: str = "hanu",
    details: Optional[dict[str, Any]] = None,
) -> None:
    """Append an activity_log row. Failures here are swallowed so they
    don't bring down a tool call — activity logging is best-effort.
    """
    try:
        row = {
            "user_id": USER_ID,
            "kind": kind,
            "summary": summary,
            "actor": actor,
            "target_table": target_table,
            "target_id": target_id,
            "reason": reason,
            "visible_to_person_ids": visible_to or [],
            "details": details or {},
        }
        sb().table("activity_log").insert(row).execute()
    except Exception:
        # Logged via stderr if Hermes captures it; never crash the parent tool.
        import traceback, sys
        print("[hanu_bridge] activity_log failed:", file=sys.stderr)
        traceback.print_exc(file=sys.stderr)


def now_iso() -> str:
    """UTC timestamp in ISO 8601 with seconds precision."""
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
