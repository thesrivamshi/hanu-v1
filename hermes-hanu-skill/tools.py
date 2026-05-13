"""
Hanu bridge tools. Each function maps to one of the operations described in
SKILL.md / BRIDGE_DESIGN.md and writes through to Supabase.

Design notes:
- Every function returns a dict ({"ok": True, "id": "..."} on success,
  {"ok": False, "error": "..."} on failure). Hermes can print the dict to
  the user; it's also easy to compose with other tools.
- Every function that writes also appends an activity_log row.
- Every function fetches USER_ID from db.py — no caller needs to pass it.
- Inputs are kept as close to the SKILL.md signatures as possible, with
  generous defaults so Hermes' tool calls succeed with minimal arguments.
- For natural-language inputs (e.g. `when="tomorrow at 6pm"`), we currently
  store the human-readable string AND attempt a basic ISO parse via the
  `dateparser` library when present. If `dateparser` isn't installed,
  scheduled_at stays NULL and Hermes' own scheduler can pick it up later.
"""

from __future__ import annotations

import os
import sys
from typing import Any, Optional

from db import USER_ID, log_activity, now_iso, sb


# -----------------------------------------------------------------------------
# Date parsing helpers (best-effort, no hard dependency)
# -----------------------------------------------------------------------------

def _try_parse_when(text: str) -> Optional[str]:
    """Convert a free-text 'when' string to an ISO UTC timestamp.
    Returns None if parsing fails — caller should store the original text
    in scheduled_text and leave scheduled_at NULL.
    """
    if not text:
        return None
    try:
        import dateparser  # type: ignore
    except ImportError:
        return None
    dt = dateparser.parse(
        text,
        settings={
            "TIMEZONE": "Asia/Kolkata",  # Hanu's default user is in India
            "RETURN_AS_TIMEZONE_AWARE": True,
            "PREFER_DATES_FROM": "future",
        },
    )
    if not dt:
        return None
    return dt.astimezone().isoformat()


def _ok(**fields) -> dict:
    return {"ok": True, **fields}


def _err(msg: str) -> dict:
    return {"ok": False, "error": msg}


# =============================================================================
# MEMORY
# =============================================================================

def hanu_save_memory(
    text: str,
    kind: str = "other",
    privacy: str = "private",
    source: str = "conversation",
    pinned: bool = False,
    shared_with_person_id: Optional[str] = None,
    shared_in_space_id: Optional[str] = None,
) -> dict:
    """Save a memory explicitly. Use when the user said 'remember X' or 'save this'."""
    try:
        res = sb().table("memories").insert({
            "user_id": USER_ID,
            "text": text,
            "kind": kind,
            "privacy": privacy,
            "source": source,
            "pinned": pinned,
            "shared_with_person_id": shared_with_person_id,
            "shared_in_space_id": shared_in_space_id,
        }).execute()
        mid = res.data[0]["id"] if res.data else None
        log_activity("memory_saved", f"Saved memory: {text[:80]}", "memories", mid)
        return _ok(id=mid)
    except Exception as e:
        return _err(str(e))


def hanu_propose_memory(
    text: str,
    suggested_kind: str = "other",
    confidence: float = 0.7,
    suggested_privacy: str = "private",
) -> dict:
    """Add to the memory inbox. User reviews and approves later."""
    try:
        res = sb().table("memory_inbox").insert({
            "user_id": USER_ID,
            "text": text,
            "suggested_kind": suggested_kind,
            "confidence": round(confidence, 2),
            "suggested_privacy": suggested_privacy,
            "state": "pending",
        }).execute()
        mid = res.data[0]["id"] if res.data else None
        log_activity("memory_proposed", f"Proposed memory: {text[:80]}", "memory_inbox", mid)
        return _ok(id=mid)
    except Exception as e:
        return _err(str(e))


def hanu_update_memory(
    id: str,
    text: Optional[str] = None,
    privacy: Optional[str] = None,
    pinned: Optional[bool] = None,
) -> dict:
    try:
        patch: dict[str, Any] = {}
        if text is not None: patch["text"] = text
        if privacy is not None: patch["privacy"] = privacy
        if pinned is not None: patch["pinned"] = pinned
        if not patch:
            return _err("nothing to update")
        sb().table("memories").update(patch).eq("id", id).eq("user_id", USER_ID).execute()
        log_activity("memory_updated", f"Updated memory {id}", "memories", id)
        return _ok(id=id)
    except Exception as e:
        return _err(str(e))


def hanu_forget_memory(id: str) -> dict:
    """Soft delete (archived=true). Hard delete only on second confirmation."""
    try:
        sb().table("memories").update({"archived": True}).eq("id", id).eq("user_id", USER_ID).execute()
        log_activity("memory_forgotten", f"Archived memory {id}", "memories", id)
        return _ok(id=id)
    except Exception as e:
        return _err(str(e))


def hanu_search_memories(
    query: str,
    kind: Optional[str] = None,
    privacy_max: str = "shared_space",
    limit: int = 10,
) -> dict:
    """Keyword search across the user's memories (vector search added later)."""
    try:
        q = sb().table("memories").select(
            "id,text,kind,privacy,source,pinned,created_at"
        ).eq("user_id", USER_ID).eq("archived", False).ilike("text", f"%{query}%")
        if kind:
            q = q.eq("kind", kind)
        q = q.limit(limit).order("created_at", desc=True)
        res = q.execute()
        return _ok(matches=res.data or [])
    except Exception as e:
        return _err(str(e))


# =============================================================================
# REMINDERS
# =============================================================================

def hanu_create_reminder(
    title: str,
    when: str = "",
    recur: str = "once",
    priority: str = "normal",
    category: str = "personal",
    person_id: Optional[str] = None,
    needs_confirm: bool = False,
    follow_up_rule: Optional[str] = None,
    linked_goal_id: Optional[str] = None,
) -> dict:
    """Create a reminder. `when` is parsed best-effort; the original text is also kept."""
    try:
        scheduled_at = _try_parse_when(when)
        res = sb().table("reminders").insert({
            "user_id": USER_ID,
            "title": title,
            "category": category,
            "priority": priority,
            "state": "pending",
            "scheduled_at": scheduled_at,
            "scheduled_text": when,
            "recur": recur,
            "person_id": person_id,
            "linked_goal_id": linked_goal_id,
            "needs_confirm": needs_confirm,
            "follow_up_rule": follow_up_rule,
        }).execute()
        rid = res.data[0]["id"] if res.data else None
        log_activity("reminder_created", f"Reminder: {title}", "reminders", rid)
        return _ok(id=rid, parsed_time=scheduled_at)
    except Exception as e:
        return _err(str(e))


def hanu_mark_reminder(id: str, state: str, miss_reason: Optional[str] = None) -> dict:
    """state: done | missed | snoozed | cancelled."""
    try:
        patch = {"state": state, "resolved_at": now_iso()}
        if miss_reason:
            patch["miss_reason"] = miss_reason
        sb().table("reminders").update(patch).eq("id", id).eq("user_id", USER_ID).execute()
        log_activity(f"reminder_{state}", f"Reminder {id} -> {state}", "reminders", id)
        return _ok(id=id)
    except Exception as e:
        return _err(str(e))


def hanu_list_reminders(when: str = "today") -> dict:
    """Pending reminders. `when` is informational only for now — returns all pending."""
    try:
        res = sb().table("reminders").select(
            "id,title,category,priority,scheduled_at,scheduled_text,recur,needs_confirm"
        ).eq("user_id", USER_ID).eq("state", "pending").order("scheduled_at").limit(50).execute()
        return _ok(reminders=res.data or [])
    except Exception as e:
        return _err(str(e))


# =============================================================================
# GOALS
# =============================================================================

def hanu_create_goal(
    title: str,
    why: str = "",
    priority: str = "normal",
    commitment: str = "planned",
    daily_action: str = "",
    recovery_rule: str = "",
    check_in_time: Optional[str] = None,
    promise_to_person_id: Optional[str] = None,
    promise_to_text: Optional[str] = "Self",
) -> dict:
    try:
        res = sb().table("goals").insert({
            "user_id": USER_ID,
            "title": title,
            "why": why,
            "priority": priority,
            "commitment": commitment,
            "daily_action": daily_action,
            "recovery_rule": recovery_rule,
            "check_in_time": check_in_time,
            "promise_to_person_id": promise_to_person_id,
            "promise_to_text": promise_to_text,
            "status": "active",
        }).execute()
        gid = res.data[0]["id"] if res.data else None
        log_activity("goal_created", f"Goal: {title}", "goals", gid)
        return _ok(id=gid)
    except Exception as e:
        return _err(str(e))


def hanu_log_goal_completion(
    goal_id: str,
    status: str,
    reason: Optional[str] = None,
    note: Optional[str] = None,
    on_date: Optional[str] = None,
) -> dict:
    """status: done | missed | skipped."""
    try:
        from datetime import date as _date
        d = on_date or _date.today().isoformat()
        res = sb().table("goal_completions").upsert({
            "goal_id": goal_id,
            "user_id": USER_ID,
            "on_date": d,
            "status": status,
            "reason": reason,
            "note": note,
            "completed_at": now_iso() if status == "done" else None,
        }, on_conflict="goal_id,on_date").execute()
        cid = res.data[0]["id"] if res.data else None
        log_activity(f"goal_{status}", f"Goal {goal_id} {status} on {d}", "goal_completions", cid)
        return _ok(id=cid)
    except Exception as e:
        return _err(str(e))


def hanu_update_goal(id: str, **fields) -> dict:
    allowed = {
        "title", "why", "priority", "commitment", "daily_action", "recovery_rule",
        "check_in_time", "status", "risk", "next_check_in_at", "space_id"
    }
    patch = {k: v for k, v in fields.items() if k in allowed}
    if not patch:
        return _err("nothing to update")
    try:
        sb().table("goals").update(patch).eq("id", id).eq("user_id", USER_ID).execute()
        log_activity("goal_updated", f"Updated goal {id}", "goals", id)
        return _ok(id=id)
    except Exception as e:
        return _err(str(e))


# =============================================================================
# OPEN LOOPS
# =============================================================================

def hanu_create_open_loop(
    title: str,
    state: str = "needs_action",
    owner_text: str = "You",
    owner_person_id: Optional[str] = None,
) -> dict:
    try:
        res = sb().table("open_loops").insert({
            "user_id": USER_ID,
            "title": title,
            "state": state,
            "owner_text": owner_text,
            "owner_person_id": owner_person_id,
        }).execute()
        lid = res.data[0]["id"] if res.data else None
        log_activity("open_loop_created", f"Loop: {title}", "open_loops", lid)
        return _ok(id=lid)
    except Exception as e:
        return _err(str(e))


def hanu_update_open_loop(id: str, state: Optional[str] = None, postponed_count: Optional[int] = None) -> dict:
    patch = {}
    if state is not None: patch["state"] = state
    if postponed_count is not None: patch["postponed_count"] = postponed_count
    if state == "closed": patch["closed_at"] = now_iso()
    if not patch: return _err("nothing to update")
    try:
        sb().table("open_loops").update(patch).eq("id", id).eq("user_id", USER_ID).execute()
        log_activity("open_loop_updated", f"Loop {id} -> {state}", "open_loops", id)
        return _ok(id=id)
    except Exception as e:
        return _err(str(e))


def hanu_detect_open_loops(text: str) -> dict:
    """Parse a thought dump into candidate items.
    For v1 we use a simple sentence-splitter heuristic and ask Hermes' LLM
    to do the actual extraction via a structured prompt. The bridge just
    returns the raw text; Hermes is expected to extract + then call
    hanu_propose_memory / hanu_create_reminder / hanu_create_open_loop
    based on what it finds.
    """
    return _ok(
        raw_text=text,
        hint="Extract candidate items: open_loops, memories, reminders, promises, decisions. "
             "Then call hanu_propose_memory / hanu_create_open_loop / hanu_create_reminder / "
             "hanu_create_promise as appropriate, after user confirms.",
    )


# =============================================================================
# PROMISES + DECISIONS
# =============================================================================

def hanu_create_promise(
    text: str,
    to_person_id: Optional[str] = None,
    to_text: str = "Self",
    due_at: Optional[str] = None,
    due_text: Optional[str] = None,
    follow_up_rule: Optional[str] = None,
) -> dict:
    try:
        parsed_due = _try_parse_when(due_text or "") if due_text and not due_at else due_at
        res = sb().table("promises").insert({
            "user_id": USER_ID,
            "text": text,
            "to_person_id": to_person_id,
            "to_text": to_text,
            "due_at": parsed_due,
            "due_text": due_text,
            "state": "pending",
            "follow_up_rule": follow_up_rule,
        }).execute()
        pid = res.data[0]["id"] if res.data else None
        log_activity("promise_created", f"Promise: {text[:80]}", "promises", pid)
        return _ok(id=pid)
    except Exception as e:
        return _err(str(e))


def hanu_mark_promise(id: str, kept_or_broken: str) -> dict:
    """kept_or_broken: 'kept' or 'broken'."""
    try:
        row = sb().table("promises").select("kept_count,broken_count").eq("id", id).single().execute().data or {}
        kept = (row.get("kept_count") or 0) + (1 if kept_or_broken == "kept" else 0)
        broken = (row.get("broken_count") or 0) + (1 if kept_or_broken == "broken" else 0)
        sb().table("promises").update({
            "state": "kept" if kept_or_broken == "kept" else "broken",
            "kept_count": kept,
            "broken_count": broken,
            "resolved_at": now_iso(),
        }).eq("id", id).eq("user_id", USER_ID).execute()
        log_activity(f"promise_{kept_or_broken}", f"Promise {id} -> {kept_or_broken}", "promises", id)
        return _ok(id=id)
    except Exception as e:
        return _err(str(e))


def hanu_log_decision(
    title: str,
    area: str = "",
    why: str = "",
    revisit_rule: Optional[str] = None,
    related_person_ids: Optional[list[str]] = None,
    tags: Optional[list[str]] = None,
) -> dict:
    try:
        res = sb().table("decisions").insert({
            "user_id": USER_ID,
            "title": title,
            "area": area,
            "why": why,
            "revisit_rule": revisit_rule,
            "related_person_ids": related_person_ids or [],
            "tags": tags or [],
        }).execute()
        did = res.data[0]["id"] if res.data else None
        log_activity("decision_logged", f"Decision: {title}", "decisions", did)
        return _ok(id=did)
    except Exception as e:
        return _err(str(e))


# =============================================================================
# PEOPLE + PERMISSIONS
# =============================================================================

def hanu_add_person(
    name: str,
    relationship: str = "",
    profile_type: str = "external",
    primary_channel: str = "whatsapp",
    whatsapp_number: Optional[str] = None,
    tone: Optional[str] = None,
    initials: Optional[str] = None,
    note: Optional[str] = None,
) -> dict:
    try:
        if not initials:
            initials = "".join([w[0] for w in name.split()[:2]]).upper()
        res = sb().table("people").insert({
            "user_id": USER_ID,
            "name": name,
            "relationship": relationship,
            "profile_type": profile_type,
            "primary_channel": primary_channel,
            "whatsapp_number": whatsapp_number,
            "tone": tone,
            "initials": initials,
            "note": note,
        }).execute()
        pid = res.data[0]["id"] if res.data else None
        log_activity("person_added", f"Added person: {name} ({relationship})", "people", pid)
        return _ok(id=pid)
    except Exception as e:
        return _err(str(e))


def hanu_update_person(id: str, **fields) -> dict:
    allowed = {
        "name", "relationship", "profile_type", "primary_channel", "whatsapp_number",
        "phone_number", "email", "tone", "quiet_hours_start", "quiet_hours_end",
        "can_ask", "can_send", "can_see", "approval_rule", "note", "avatar_tone"
    }
    patch = {k: v for k, v in fields.items() if k in allowed}
    if not patch: return _err("nothing to update")
    try:
        sb().table("people").update(patch).eq("id", id).eq("user_id", USER_ID).execute()
        log_activity("person_updated", f"Updated person {id}", "people", id)
        return _ok(id=id)
    except Exception as e:
        return _err(str(e))


def hanu_set_permission(
    person_id: str,
    capability: str,
    granted: bool = True,
    scope: Optional[str] = None,
) -> dict:
    try:
        sb().table("permissions").upsert({
            "user_id": USER_ID,
            "person_id": person_id,
            "capability": capability,
            "granted": granted,
            "scope": scope,
        }, on_conflict="person_id,capability").execute()
        log_activity(
            "permission_set",
            f"{'Grant' if granted else 'Deny'} {capability} for {person_id}",
            "permissions", None,
        )
        return _ok()
    except Exception as e:
        return _err(str(e))


def hanu_check_can(person_id: str, capability: str) -> dict:
    """Return whether `person_id` is granted `capability`. Default: deny."""
    try:
        res = sb().table("permissions").select("granted,scope").eq(
            "person_id", person_id
        ).eq("capability", capability).limit(1).execute()
        rows = res.data or []
        granted = bool(rows and rows[0].get("granted"))
        return _ok(granted=granted, scope=rows[0].get("scope") if rows else None)
    except Exception as e:
        return _err(str(e))


# =============================================================================
# APPROVALS
# =============================================================================

def hanu_request_approval(
    from_person_id: str,
    question: str,
    context: str = "",
    suggested_action: str = "",
    kind: str = "question",
) -> dict:
    try:
        res = sb().table("approvals").insert({
            "user_id": USER_ID,
            "from_person_id": from_person_id,
            "kind": kind,
            "question": question,
            "context": context,
            "suggested_action": suggested_action,
            "state": "pending",
        }).execute()
        aid = res.data[0]["id"] if res.data else None
        log_activity("approval_requested", f"From {from_person_id}: {question[:80]}", "approvals", aid)
        return _ok(id=aid)
    except Exception as e:
        return _err(str(e))


def hanu_list_pending_approvals() -> dict:
    try:
        res = sb().table("approvals").select(
            "id,from_person_id,question,context,suggested_action,created_at"
        ).eq("user_id", USER_ID).eq("state", "pending").order("created_at", desc=True).limit(20).execute()
        return _ok(approvals=res.data or [])
    except Exception as e:
        return _err(str(e))


# =============================================================================
# CONVERSATIONS + MESSAGES
# =============================================================================

def hanu_get_or_create_conversation(
    person_id: Optional[str],
    channel: str = "whatsapp",
    external_id: Optional[str] = None,
) -> dict:
    try:
        q = sb().table("conversations").select("id").eq("user_id", USER_ID).eq("channel", channel)
        if external_id:
            q = q.eq("external_id", external_id)
        elif person_id:
            q = q.eq("person_id", person_id)
        existing = q.limit(1).execute()
        if existing.data:
            return _ok(id=existing.data[0]["id"], created=False)
        res = sb().table("conversations").insert({
            "user_id": USER_ID,
            "person_id": person_id,
            "channel": channel,
            "external_id": external_id,
        }).execute()
        cid = res.data[0]["id"] if res.data else None
        return _ok(id=cid, created=True)
    except Exception as e:
        return _err(str(e))


def hanu_log_message(
    conversation_id: str,
    role: str,
    content: str,
    raw_payload: Optional[dict] = None,
    channel_message_id: Optional[str] = None,
) -> dict:
    try:
        sb().table("messages").insert({
            "conversation_id": conversation_id,
            "user_id": USER_ID,
            "role": role,
            "content": content,
            "raw_payload": raw_payload or {},
            "channel_message_id": channel_message_id,
        }).execute()
        sb().table("conversations").update({
            "last_message_at": now_iso(),
            "message_count": sb().rpc("increment_message_count", {"conv_id": conversation_id}).execute().data if False else 1,
        }).eq("id", conversation_id).execute()
        return _ok()
    except Exception as e:
        return _err(str(e))


# =============================================================================
# MISC
# =============================================================================

def hanu_record_daily_review(slot: str, done: bool, note: str = "") -> dict:
    """slot ∈ {morning, midday, evening}."""
    try:
        from datetime import date as _date
        today = _date.today().isoformat()
        col_done = f"{slot}_done"
        col_note = f"{slot}_note"
        sb().table("daily_reviews").upsert({
            "user_id": USER_ID,
            "on_date": today,
            col_done: done,
            col_note: note,
        }, on_conflict="user_id,on_date").execute()
        log_activity("daily_review", f"{slot} review {'done' if done else 'open'}", "daily_reviews", None)
        return _ok()
    except Exception as e:
        return _err(str(e))


def hanu_get_settings() -> dict:
    try:
        res = sb().table("settings").select("*").eq("user_id", USER_ID).limit(1).execute()
        return _ok(settings=(res.data[0] if res.data else None))
    except Exception as e:
        return _err(str(e))


def hanu_update_setting(field: str, value: Any) -> dict:
    allowed = {
        "active_pause", "quiet_hours_start", "quiet_hours_end",
        "follow_up_intensity", "accountability",
        "ask_before_saving", "ask_before_sharing",
        "tone", "mood", "ambient", "theme",
    }
    if field not in allowed:
        return _err(f"field '{field}' is not user-updatable here")
    try:
        sb().table("settings").update({field: value}).eq("user_id", USER_ID).execute()
        log_activity("setting_updated", f"{field} = {value}", "settings", None)
        return _ok()
    except Exception as e:
        return _err(str(e))


def hanu_log_activity_freeform(
    kind: str,
    summary: str,
    target_table: Optional[str] = None,
    target_id: Optional[str] = None,
    reason: Optional[str] = None,
    visible_to: Optional[list[str]] = None,
) -> dict:
    log_activity(kind, summary, target_table, target_id, reason, visible_to)
    return _ok()


# =============================================================================
# CLI dispatcher — how Hermes invokes these tools
# =============================================================================
# Hermes' skills system gives the LLM a `bash` tool. Skills tell the LLM what
# shell command to run. So we expose every tool above as a CLI subcommand
# that accepts a single JSON argument and prints a JSON response.
#
# Usage from inside Hermes:
#     hanu_call save_memory '{"text":"…","kind":"preference"}'
#
# `hanu_call` is a tiny shell wrapper installed alongside this file.

import json

# Public tool registry — only functions in this list are callable from the CLI.
_TOOL_REGISTRY = {
    # Memory
    "save_memory": hanu_save_memory,
    "propose_memory": hanu_propose_memory,
    "update_memory": hanu_update_memory,
    "forget_memory": hanu_forget_memory,
    "search_memories": hanu_search_memories,
    # Reminders
    "create_reminder": hanu_create_reminder,
    "mark_reminder": hanu_mark_reminder,
    "list_reminders": hanu_list_reminders,
    # Goals
    "create_goal": hanu_create_goal,
    "log_goal_completion": hanu_log_goal_completion,
    "update_goal": hanu_update_goal,
    # Open loops
    "create_open_loop": hanu_create_open_loop,
    "update_open_loop": hanu_update_open_loop,
    "detect_open_loops": hanu_detect_open_loops,
    # Promises + decisions
    "create_promise": hanu_create_promise,
    "mark_promise": hanu_mark_promise,
    "log_decision": hanu_log_decision,
    # People + permissions
    "add_person": hanu_add_person,
    "update_person": hanu_update_person,
    "set_permission": hanu_set_permission,
    "check_can": hanu_check_can,
    # Approvals
    "request_approval": hanu_request_approval,
    "list_pending_approvals": hanu_list_pending_approvals,
    # Conversations
    "get_or_create_conversation": hanu_get_or_create_conversation,
    "log_message": hanu_log_message,
    # Misc
    "record_daily_review": hanu_record_daily_review,
    "get_settings": hanu_get_settings,
    "update_setting": hanu_update_setting,
    "log_activity": hanu_log_activity_freeform,
}


def _cli_help() -> str:
    names = sorted(_TOOL_REGISTRY.keys())
    return (
        "Hanu bridge CLI\n"
        "Usage:  python tools.py <tool_name> '<json_args>'\n"
        "        python tools.py selftest\n"
        "        python tools.py list\n\n"
        "Available tools:\n  " + "\n  ".join(names)
    )


if __name__ == "__main__":
    args = sys.argv[1:]
    if not args or args[0] in ("-h", "--help", "help"):
        print(_cli_help())
        sys.exit(0)

    cmd = args[0]

    if cmd == "list":
        for name in sorted(_TOOL_REGISTRY.keys()):
            print(name)
        sys.exit(0)

    if cmd == "selftest":
        try:
            print(json.dumps(hanu_get_settings(), default=str))
            print(json.dumps(hanu_list_reminders(), default=str))
            print(json.dumps(hanu_list_pending_approvals(), default=str))
            print("\n✅ Bridge connectivity OK.", file=sys.stderr)
            sys.exit(0)
        except Exception as e:
            print(json.dumps({"ok": False, "error": str(e)}))
            sys.exit(1)

    fn = _TOOL_REGISTRY.get(cmd)
    if fn is None:
        print(json.dumps({"ok": False, "error": f"unknown tool: {cmd}"}))
        sys.exit(2)

    # Parse the JSON args (default to empty object so zero-arg calls work)
    raw_json = args[1] if len(args) > 1 else "{}"
    try:
        kwargs = json.loads(raw_json)
        if not isinstance(kwargs, dict):
            raise ValueError("args must be a JSON object")
    except Exception as e:
        print(json.dumps({"ok": False, "error": f"bad json args: {e}"}))
        sys.exit(2)

    try:
        result = fn(**kwargs)
        print(json.dumps(result, default=str, ensure_ascii=False))
        sys.exit(0 if (isinstance(result, dict) and result.get("ok") is not False) else 3)
    except TypeError as e:
        print(json.dumps({"ok": False, "error": f"bad arguments for {cmd}: {e}"}))
        sys.exit(2)
    except Exception as e:
        print(json.dumps({"ok": False, "error": str(e)}))
        sys.exit(1)
