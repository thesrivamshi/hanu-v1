"""
Hanu model router.

Picks {model, max_tokens} per inbound message via cheap keyword heuristics.
Falls back to the `default` in `model_routes.yaml`. Drop-in for Hermes'
gateway: import `pick_route_for(message_text)` and pass the returned dict
to the LLM call.

Heuristics live here intentionally — a one-LLM-call classifier is cleaner but
adds latency + cost; the keyword version handles 90% of intents at zero cost.
Tune `_classify` as needed.
"""
from __future__ import annotations

import os
import re
from functools import lru_cache
from typing import Any

try:
    import yaml  # PyYAML; usually already in the Hermes venv
except ImportError:  # pragma: no cover
    yaml = None  # type: ignore


_DEFAULT_ROUTES = {
    "default": "gpt-5.4-mini",
    "routes": [],
}


@lru_cache(maxsize=1)
def _load_table() -> dict[str, Any]:
    if yaml is None:
        return _DEFAULT_ROUTES
    path = os.environ.get(
        "HANU_MODEL_ROUTES",
        os.path.join(os.path.dirname(__file__), "model_routes.yaml"),
    )
    try:
        with open(path, "r", encoding="utf-8") as f:
            return yaml.safe_load(f) or _DEFAULT_ROUTES
    except FileNotFoundError:
        return _DEFAULT_ROUTES


# ---------------------------------------------------------------------------
# Intent classification
# ---------------------------------------------------------------------------

_ROUTINE_CRUD_KEYS = (
    "remind", "set a", "save", "i promised", "i decided", "open loop",
    "add my", "add a", "create a", "log a", "mark ", "delete",
)
_ASK_KEYS = (
    "ask hanu", "what did i", "what do you remember", "tell me about",
    "search", "find ", "remind me what", "show me",
)
_SYNTHESIS_KEYS = (
    "review", "weekly review", "monthly review", "how am i doing",
    "summarize my", "what's my pattern",
)


def _classify(message: str) -> str:
    m = (message or "").lower()
    if not m.strip():
        return "default"
    if any(k in m for k in _SYNTHESIS_KEYS):
        return "synthesis"
    if any(k in m for k in _ASK_KEYS):
        return "ask_hanu"
    if any(k in m for k in _ROUTINE_CRUD_KEYS):
        return "routine_crud"
    if len(m.split()) > 30:
        return "thought_dump"
    return "default"


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def pick_route_for(message: str, override_intent: str | None = None) -> dict[str, Any]:
    """Return {model, max_tokens, intent}. Falls back to the table's `default`
    if no rule matches. `override_intent` lets callers force a route (useful for
    the recovery worker calling synthesis explicitly)."""
    cfg = _load_table()
    intent = override_intent or _classify(message)
    for rule in cfg.get("routes") or []:
        match = (rule or {}).get("match") or {}
        if match.get("intent") == intent:
            return {
                "model": rule.get("model") or cfg.get("default", "gpt-5.4-mini"),
                "max_tokens": rule.get("max_tokens", 1024),
                "intent": intent,
            }
    return {
        "model": cfg.get("default", "gpt-5.4-mini"),
        "max_tokens": 1024,
        "intent": intent,
    }


if __name__ == "__main__":  # smoke test
    import json
    examples = [
        "remind me to call mom at 7pm",
        "what did I tell you about pricing last month?",
        "give me a weekly review",
        ("Razorpay, pricing, talk to Aman, payment gateway, " * 5),
        "hi",
    ]
    for ex in examples:
        print(json.dumps({"input": ex[:60], "route": pick_route_for(ex)}, default=str))
