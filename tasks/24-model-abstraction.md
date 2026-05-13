# 24 — Tiered model routing: cheap for extraction, premium for synthesis

**Priority:** P4
**Effort:** half a day
**Depends on:** 03 (MCP server, since tool routing dominates model selection)
**Status:** TODO
**Risk if skipped:** all traffic routes to a single model (`gpt-5.4-mini`). Cost scales linearly with usage. Deprecation cycles (~12 months) hit hard without abstraction. Worse, you can't tune quality differently for different paths (e.g., promise reasoning deserves premium; reminder logging doesn't).

---

## Context

Hermes currently routes everything through one provider config (`ai-gateway` overriding base_url to OpenAI). The model is set in env / Hermes config. Path-by-path model selection requires:

- A small router that picks the model based on the task kind.
- A config block that maps task kinds to models.
- A thin wrapper around Hermes' LLM call so the router has a chokepoint to influence.

This is **not urgent for v1** at single-user scale (the cost is trivial). Build it once cost matters or once you want to use a premium model for synthesis (e.g., recovery conversations, weekly reviews).

---

## Acceptance criteria

- A `model_routes.yaml` (or equivalent) maps task kinds to model IDs.
- The router is consulted before every Hermes turn: it inspects the inbound message and selects the model.
- Task kinds: `extraction` (parsing user dumps), `routine` (reminder/goal CRUD), `synthesis` (weekly review, recovery conversation, ask_hanu).
- Default route still works: any unmatched intent uses `gpt-5.4-mini`.
- Model can be overridden at runtime via a `--model` arg on the agent CLI.

---

## Implementation steps

### Step 1 — Define the route table

`/root/.hermes/skills/hanu-bridge/model_routes.yaml`:

```yaml
default: gpt-5.4-mini

routes:
  # When the user dumps thoughts that need parsing, use a small fast model:
  - match:
      intent: thought_dump
    model: gpt-5.4-mini
    max_tokens: 1024

  # Routine CRUD (set a reminder, save a memory, mark a promise) — small model:
  - match:
      intent: routine_crud
    model: gpt-5.4-mini
    max_tokens: 256

  # Weekly review and recovery flows — use the bigger model:
  - match:
      intent: synthesis
    model: gpt-5.4
    max_tokens: 4096

  # User asking a question that needs reasoning over many memories:
  - match:
      intent: ask_hanu
    model: gpt-5.4
    max_tokens: 2048
```

### Step 2 — Intent classifier

A tiny upstream classifier picks the intent. Two options:

**Option A — keyword heuristics:** dirt-cheap, fast, opaque rules:

```python
def classify_intent(message: str) -> str:
    m = message.lower()
    if any(k in m for k in ["remind", "set a", "save", "i promised", "i decided", "open loop"]):
        return "routine_crud"
    if any(k in m for k in ["ask hanu", "what did i", "what do you remember", "search", "tell me about"]):
        return "ask_hanu"
    if any(k in m for k in ["review", "how am i doing", "weekly", "monthly"]):
        return "synthesis"
    if len(message.split()) > 30:
        return "thought_dump"
    return "default"
```

**Option B — one cheap LLM call to classify:** more accurate, costs ~$0.0001 per turn (small Haiku-tier or gpt-5.4-mini call with a fixed 50-token prompt). For v1 the heuristics are fine.

### Step 3 — Router

```python
import yaml

class ModelRouter:
    def __init__(self, path="model_routes.yaml"):
        with open(path) as f:
            self.cfg = yaml.safe_load(f)

    def pick(self, intent: str) -> dict:
        for rule in self.cfg.get("routes", []):
            if rule["match"].get("intent") == intent:
                return {"model": rule["model"], "max_tokens": rule.get("max_tokens", 1024)}
        return {"model": self.cfg.get("default", "gpt-5.4-mini"), "max_tokens": 1024}

router = ModelRouter()

# Gateway entry point:
def handle_inbound(message: str):
    intent = classify_intent(message)
    routing = router.pick(intent)
    response = hermes_llm_call(model=routing["model"], max_tokens=routing["max_tokens"], message=message)
    return response
```

The exact integration depends on Hermes' API. Look in `hermes-agent/gateway/` for the message-handling chokepoint. Patch the LLM-invocation function to accept a model override.

### Step 4 — Track per-route costs

Log the chosen model + token usage to `activity_log` for observability:

```python
log_activity("llm_call",
             f"model={routing['model']} intent={intent} in_tokens={... } out_tokens={...}",
             actor="hanu", details={"model": routing["model"], "intent": intent, ...})
```

A daily report:

```sql
select details->>'model' as model,
       count(*)::int as calls,
       sum((details->>'in_tokens')::int)  as in_tokens,
       sum((details->>'out_tokens')::int) as out_tokens
  from public.activity_log
 where kind = 'llm_call' and created_at >= now() - interval '7 days'
 group by 1
 order by in_tokens desc;
```

### Step 5 — Override hatch

Add a CLI arg or chat slash-command:

```
/model gpt-5.4   # use the big model for the next turn
/model auto      # back to routed
```

Useful for the user to force-upgrade a critical turn.

---

## Verification

```bash
# Send a routine reminder request:
# WhatsApp: "remind me to call mom at 6pm"
# Then check:
select details->>'model' from public.activity_log
 where kind='llm_call' order by created_at desc limit 1;
# Expected: gpt-5.4-mini

# Send a synthesis request:
# WhatsApp: "give me a weekly review"
select details->>'model' from public.activity_log
 where kind='llm_call' order by created_at desc limit 1;
# Expected: gpt-5.4
```

---

## Rollback

Set `default: gpt-5.4-mini` and clear `routes:` in `model_routes.yaml`. All traffic falls back to the default model. The router is non-destructive; reverting the config reverts behavior.

---

## Files touched

- `hermes-hanu-skill/model_routes.yaml` (new)
- `hermes-hanu-skill/router.py` (new)
- Hermes gateway integration (patch the LLM invocation point)
- `BRIDGE_DESIGN.md` (document the routing strategy)

---

## Notes

- The right balance of cheap vs premium models will shift as new models release. Don't optimize too hard for current pricing. The point of this task is the **abstraction**, not the specific assignments.
- If routing logic gets complex enough that the classifier is a bottleneck, consider letting the agent self-route: a one-line system prompt "if your task is synthesis, request the big model" via a `request_model` tool.
- For multi-tenant scaling (slice 6), the route table becomes per-user: paid tier gets premium routing, free tier gets cheap-only.
- This task is intentionally P4 — single-user costs at current prices are under $10/month even on the premium model. Don't over-engineer before usage justifies it.
