#!/usr/bin/env python3
"""
Hermes post_tool_call shell-hook: mirror built-in memory/todo/kanban
writes into Hanu's Supabase via hanu_call.

Hermes pipes a JSON payload to stdin describing the tool call that just
finished. We dispatch on tool_name and call the matching hanu_call so the
same intent that landed in Hermes' internal store ALSO lands in Supabase
where the UI can see it.

Errors are swallowed (logged) — the agent loop must never crash from a
hook. Hermes also caps us at the configured timeout.

Payload shape (per Hermes docs):
{
  "hook_event_name": "post_tool_call",
  "tool_name":       "memory" | "todo" | "kanban" | ...,
  "tool_input":      { ... tool-specific kwargs ... },
  "session_id":      "sess_...",
  "cwd":             "/root",
  "extra":           { "task_id": "...", "tool_call_id": "...", "result": ... }
}
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import time

LOG_PATH = "/var/log/hanu/hook-mirror.log"
HANU_CALL = "/usr/local/bin/hanu_call"


def log(msg: str) -> None:
    try:
        os.makedirs(os.path.dirname(LOG_PATH), exist_ok=True)
        with open(LOG_PATH, "a", encoding="utf-8") as f:
            f.write(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] {msg}\n")
    except Exception:
        # Never let logging crash the hook.
        pass


def hanu_call(tool: str, args: dict) -> None:
    """Invoke hanu_call as a subprocess. Best-effort; logs failure."""
    try:
        cmd = [HANU_CALL, tool, json.dumps(args, ensure_ascii=False)]
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=15)
        out = (proc.stdout or "").strip()[:300]
        log(f"  -> {tool}: exit={proc.returncode} out={out}")
        if proc.stderr:
            log(f"  -> {tool}: stderr={proc.stderr.strip()[:300]}")
    except subprocess.TimeoutExpired:
        log(f"  -> {tool}: TIMEOUT")
    except Exception as e:
        log(f"  -> {tool}: EXCEPTION {e!r}")


# ----------------------------------------------------------------------
# Per-tool mirror handlers
# ----------------------------------------------------------------------

def mirror_memory(inp: dict) -> None:
    """Hermes' memory tool: actions add / replace / remove."""
    action = (inp.get("action") or "").lower()
    target = (inp.get("target") or "memory").lower()
    text = (inp.get("text") or "").strip()
    old_text = (inp.get("old_text") or "").strip()
    new_text = (inp.get("new_text") or "").strip()

    if action == "add" and text:
        kind = "preference" if target == "user" else "other"
        hanu_call("save_memory", {
            "text": text,
            "kind": kind,
            "privacy": "private",
            "source": "hermes_memory_mirror",
        })

    elif action == "replace" and new_text:
        # We can't easily match old_text to a Supabase memory id from here,
        # so we save the new version as a fresh memory and leave the old
        # one alone. Cleanup is a polish-pass concern.
        kind = "preference" if target == "user" else "other"
        hanu_call("save_memory", {
            "text": new_text,
            "kind": kind,
            "privacy": "private",
            "source": "hermes_memory_mirror(replace)",
        })

    elif action == "remove":
        # No-op on the mirror side. We don't blindly delete Supabase memories
        # based on a text match — too risky.
        log("  -> memory.remove: not mirrored (would need explicit id match)")


def mirror_todo(inp: dict) -> None:
    """Hermes' todo tool: writes an array of {id, content, status}."""
    todos = inp.get("todos") or []
    if not isinstance(todos, list):
        return
    for t in todos:
        if not isinstance(t, dict):
            continue
        content = (t.get("content") or "").strip()
        status = (t.get("status") or "pending").lower()
        if not content:
            continue
        if status in ("pending", "in_progress"):
            hanu_call("create_open_loop", {
                "title": content,
                "state": "needs_action",
                "owner_text": "You",
            })
        # completed / cancelled — we let the activity_log row written by
        # create_open_loop earlier serve as history; no new mirror row needed.


def mirror_kanban(inp: dict) -> None:
    """Hermes' kanban tool: card create/move. Treat card creates as open loops."""
    op = (inp.get("op") or inp.get("operation") or "").lower()
    card = inp.get("card") or {}
    title = (card.get("title") or inp.get("title") or "").strip()
    if op in ("create_card", "add_card", "create") and title:
        hanu_call("create_open_loop", {
            "title": title,
            "state": "needs_action",
            "owner_text": "You",
        })


# Map tool_name -> handler
MIRRORS = {
    "memory": mirror_memory,
    "todo": mirror_todo,
    "kanban": mirror_kanban,
}


def main() -> None:
    # Read stdin payload. Never crash on bad input.
    raw = sys.stdin.read()
    try:
        payload = json.loads(raw) if raw.strip() else {}
    except Exception as e:
        log(f"BAD payload json: {e!r}; raw={raw[:200]}")
        print("{}")
        return

    tool = payload.get("tool_name") or ""
    event = payload.get("hook_event_name") or ""
    inp = payload.get("tool_input") or {}

    handler = MIRRORS.get(tool)
    if not handler:
        # The matcher in config.yaml should already filter to memory|todo|kanban,
        # but defensive double-check costs nothing.
        log(f"skip event={event} tool={tool} (no mirror handler)")
        print("{}")
        return

    log(f"event={event} tool={tool} input_keys={list(inp.keys())[:8]}")
    try:
        handler(inp)
    except Exception as e:
        log(f"  -> handler exception: {e!r}")

    # Always respond with empty JSON so Hermes treats this as a clean no-op.
    print("{}")


if __name__ == "__main__":
    main()
