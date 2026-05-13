"""
Hanu healthcheck endpoint.

GET /healthz -> 200 {"ok": true, "at": <epoch>} when everything is nominal.
            -> 503 {"ok": false, "error": "..."} when Supabase is unreachable
               or the hermes-gateway heartbeat is stale.

Run as systemd unit hanu-healthz.service; proxy from nginx at /healthz.
External monitor (Healthchecks.io / UptimeRobot) pings every 5 minutes; alerts
fire to email after 2 consecutive failures.

Heartbeat contract: hermes-gateway is expected to `touch /var/run/hermes-gateway.heartbeat`
at least every 60s (via systemd timer hermes-heartbeat.timer in ops/systemd).
"""
from __future__ import annotations

import os
import time
from typing import Any

from fastapi import FastAPI
from fastapi.responses import JSONResponse

try:
    from supabase import create_client
except ImportError as e:  # pragma: no cover
    raise SystemExit(
        "supabase-py not installed in the venv used by hanu-healthz; "
        "run `/usr/local/lib/hermes-agent/venv/bin/pip install supabase fastapi uvicorn`."
    ) from e

app = FastAPI()
_LAST_OK: dict[str, Any] = {"at": 0}
_HEARTBEAT_PATH = "/var/run/hermes-gateway.heartbeat"
_HEARTBEAT_MAX_AGE_S = 120


def _sb_client():
    url = os.environ["SUPABASE_URL"]
    key = os.environ.get("SUPABASE_SECRET_KEY") or os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    return create_client(url, key)


@app.get("/healthz")
def healthz() -> JSONResponse:
    # 1) Supabase reachable?
    try:
        _sb_client().table("profiles").select("id").limit(1).execute()
    except Exception as e:  # noqa: BLE001
        return JSONResponse({"ok": False, "error": f"supabase: {e}"}, status_code=503)

    # 2) Hermes gateway heartbeat fresh?
    if os.path.exists(_HEARTBEAT_PATH):
        age = time.time() - os.stat(_HEARTBEAT_PATH).st_mtime
        if age > _HEARTBEAT_MAX_AGE_S:
            return JSONResponse(
                {"ok": False, "error": f"hermes heartbeat stale: {age:.0f}s"},
                status_code=503,
            )

    _LAST_OK["at"] = time.time()
    return JSONResponse({"ok": True, "at": _LAST_OK["at"]})
