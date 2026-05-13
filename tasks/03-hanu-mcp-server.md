# 03 — Build Hanu MCP server; retire `hanu_call` + `mirror-to-hanu.py`

**Priority:** P1 (largest leverage on agent behavior)
**Effort:** 1-2 focused days
**Depends on:** none — runs in parallel with 01 and 02
**Status:** TODO
**Risk if skipped:** model continues reaching for Hermes' built-in `memory`/`todo`/`cronjob`/`kanban` tools; the mirror layer accumulates correctness debt; `SOUL.md` grows ever-longer routing rules; behavior remains brittle.

---

## Context

`gpt-5.4-mini` selects tools from its structured `tools` array first; a shell wrapper (`hanu_call <name> '<json>'`) sits below that priority and only gets reached when the prompt is fighting hard. The current design tries to fight via:

1. `SOUL.md` rules telling the model not to use built-ins.
2. `mirror-to-hanu.py` post-hook that catches built-in writes and replays them into Supabase via `hanu_call`.

This loses three ways:
- Mirror has unfixable correctness gaps for `memory.replace` (creates duplicate) and `memory.remove` (no-op).
- Subprocess `hanu_call` adds ~200-500ms per write.
- Routing prose decays over conversation length.

The fix is to make Hanu's tools first-class structured tools in the same shape the model already prefers. **Model Context Protocol (MCP)** is the right interop layer: Hermes natively supports MCP (`hermes-agent/mcp_serve.py`), so we expose the existing `tools.py` functions as MCP tools and disable the overlapping Hermes built-ins. The model now picks `hanu_save_memory` over `memory.add` because both are presented identically — same schema shape, same registration mechanism — and there is only one tool that writes to the durable store.

---

## Acceptance criteria

- An MCP server `hanu_mcp_server.py` runs as a Hermes-registered MCP server with **all 30 tools** from `_TOOL_REGISTRY` in `tools.py` exposed as MCP `Tool` definitions with proper JSON Schema input shapes.
- Hermes' built-in `memory`, `todo`, `cronjob`, `kanban`, `session_search` toolsets are disabled in the active Hermes config.
- A test WhatsApp message "remember that I prefer concise replies" results in a `memories` row in Supabase via the MCP path (visible in `activity_log` as `actor='hanu'`, `kind='memory_saved'`).
- A test "set a reminder to call mom tomorrow at 6pm" results in a `reminders` row with non-null `scheduled_at`.
- `mirror-to-hanu.py` is still installed but logs zero invocations over a 48-hour observation window (no Hermes built-in tool is being called).
- After the 48-hour window, the hook and `hanu_call` are removed and `SOUL.md` no longer contains the "do not use built-in X" lines.

---

## Implementation steps

### Step 1 — Pick an MCP transport

Hermes supports both stdio and HTTP MCP servers. **Use stdio** for v1: simpler, no port to manage, lower latency. The MCP server is a child process of Hermes.

### Step 2 — Write `hanu_mcp_server.py`

Create `hermes-hanu-skill/hanu_mcp_server.py`. The file is a thin wrapper around `_TOOL_REGISTRY`. Skeleton:

```python
"""
Hanu MCP server.

Exposes every function in `tools._TOOL_REGISTRY` as a first-class MCP tool
with a JSON Schema input shape. Hermes registers this as an MCP server in
its config; the LLM sees tools like `hanu_save_memory`, `hanu_create_reminder`,
etc., as structured tools alongside (or instead of) Hermes' built-ins.

Run as stdio: `python hanu_mcp_server.py` reads JSON-RPC on stdin, writes
on stdout. Hermes manages the lifecycle.
"""
from __future__ import annotations

import asyncio
import inspect
import json
import sys
from typing import Any, get_type_hints

# The official MCP Python SDK
from mcp.server import Server
from mcp.server.stdio import stdio_server
from mcp.types import Tool, TextContent

import tools as hanu_tools  # local tools.py

server = Server("hanu-bridge")

# --- Schema generation ---------------------------------------------------

# Map Python type hints to JSON Schema types.
_PY_TO_JSON = {
    str: "string", int: "integer", float: "number",
    bool: "boolean", list: "array", dict: "object",
}

def _python_to_json_schema(fn) -> dict:
    """Inspect fn's signature and synthesize a JSON Schema input object."""
    sig = inspect.signature(fn)
    hints = get_type_hints(fn)
    props: dict[str, dict] = {}
    required: list[str] = []
    for name, param in sig.parameters.items():
        ann = hints.get(name, str)
        origin = getattr(ann, "__origin__", None)
        # Optional[X] -> X with not-required
        is_optional = False
        if origin is not None:
            args = getattr(ann, "__args__", ())
            non_none = [a for a in args if a is not type(None)]
            if len(non_none) == 1:
                ann = non_none[0]
                is_optional = type(None) in args
        json_type = _PY_TO_JSON.get(ann, "string")
        schema: dict[str, Any] = {"type": json_type}
        if param.default is inspect.Parameter.empty and not is_optional:
            required.append(name)
        props[name] = schema
    return {"type": "object", "properties": props, "required": required}

# --- MCP handlers --------------------------------------------------------

@server.list_tools()
async def list_tools() -> list[Tool]:
    out: list[Tool] = []
    for name, fn in hanu_tools._TOOL_REGISTRY.items():
        out.append(Tool(
            name=f"hanu_{name}",
            description=(fn.__doc__ or "").strip().split("\n")[0] or f"Hanu tool: {name}",
            inputSchema=_python_to_json_schema(fn),
        ))
    return out

@server.call_tool()
async def call_tool(name: str, arguments: dict | None) -> list[TextContent]:
    # MCP names are prefixed with `hanu_`; strip and look up.
    if not name.startswith("hanu_"):
        raise ValueError(f"Unknown MCP tool: {name}")
    key = name[len("hanu_"):]
    fn = hanu_tools._TOOL_REGISTRY.get(key)
    if fn is None:
        raise ValueError(f"Unknown Hanu tool: {key}")
    args = arguments or {}
    try:
        result = fn(**args)
    except TypeError as e:
        result = {"ok": False, "error": f"bad arguments: {e}"}
    except Exception as e:
        result = {"ok": False, "error": str(e)}
    return [TextContent(type="text", text=json.dumps(result, default=str, ensure_ascii=False))]

async def main():
    async with stdio_server() as (read, write):
        await server.run(read, write, server.create_initialization_options())

if __name__ == "__main__":
    asyncio.run(main())
```

Install the MCP Python SDK in the Hermes venv:

```bash
/usr/local/lib/hermes-agent/venv/bin/pip install mcp
```

### Step 3 — Register the MCP server with Hermes

Hermes' MCP server config is typically in `cli-config.yaml` (see `hermes-agent/cli-config.yaml.example`). Add a stanza under the `mcp_servers` section:

```yaml
mcp_servers:
  hanu:
    command: /usr/local/lib/hermes-agent/venv/bin/python
    args:
      - /root/.hermes/skills/hanu-bridge/hanu_mcp_server.py
    env:
      SUPABASE_URL: "${SUPABASE_URL}"
      SUPABASE_SECRET_KEY: "${SUPABASE_SECRET_KEY}"
      HANU_USER_ID: "${HANU_USER_ID}"
    cwd: /root/.hermes/skills/hanu-bridge
```

The exact YAML schema may differ in your Hermes version — `hermes-agent/cli-config.yaml.example` is authoritative. The principle: stdio command + args + env. Hermes will spawn the subprocess at gateway start, do the MCP handshake, and add the tools to the LLM's structured tools array.

### Step 4 — Disable overlapping Hermes built-ins

Hermes built-ins are configured in `cli-config.yaml` under `tools` (or via runtime flags). Disable:

- `memory`
- `todo`
- `cronjob`
- `kanban`
- `session_search`

Exact key names depend on your Hermes version — grep `hermes-agent/toolsets.py` and `toolset_distributions.py` for the registered names and check `cli-config.yaml.example` for the disable-list syntax. Typical pattern:

```yaml
tools:
  disabled:
    - memory
    - todo
    - cronjob
    - kanban
    - session_search
```

Keep `bash`, `web`, `file`, `terminal` enabled — those are general-purpose and not Hanu-domain-overlapping.

### Step 5 — Restart Hermes and verify tool registration

```bash
systemctl --user restart hermes-gateway
sleep 2
journalctl --user -u hermes-gateway --since "30 seconds ago" | grep -i "mcp\|hanu" | head -40
```

Expected log lines: "MCP server `hanu` started", "Registered 30 tools from hanu". Failure modes:
- "Cannot import mcp" → pip install missed; re-run step 2.
- "Connection closed" during handshake → the server crashed at startup; run it manually `python hanu_mcp_server.py < /dev/null` and read the traceback.
- "Tool name collision" → check that you removed the built-ins in step 4.

### Step 6 — Smoke test from WhatsApp

Send "remember that I prefer concise replies" to the bot. Then:

```sql
select id, text, kind, privacy, source, created_at
  from public.memories
 where user_id = 'd804b9ed-5eaa-497c-8390-86ba02007a33'
 order by created_at desc
 limit 3;

select kind, summary, actor, created_at
  from public.activity_log
 where user_id = 'd804b9ed-5eaa-497c-8390-86ba02007a33'
 order by created_at desc
 limit 5;
```

Expect a row in `memories` with `text` matching the message and `source='conversation'` (or similar). Expect a corresponding `activity_log` row with `kind='memory_saved'`.

### Step 7 — Observation window (48 hours)

Leave `mirror-to-hanu.py` in place. Tail its log to confirm it's not firing:

```bash
tail -f /var/log/hanu/hook-mirror.log
```

In 48 hours of normal use, expect either zero entries or only "skip event=... tool=... (no mirror handler)" lines. If you see "event=post_tool_call tool=memory" lines, the model is still calling Hermes' built-in `memory` — investigate (disable list incomplete, or tool name mismatch).

### Step 8 — Remove the legacy path

After the observation window:

```bash
# 1) Disable the hook in Hermes config (remove the post_tool_call entry that
#    invokes mirror-to-hanu.py).

# 2) Delete the hook script:
rm /root/.hermes/skills/hanu-bridge/mirror-to-hanu.py
rm /var/log/hanu/hook-mirror.log

# 3) Delete the shell wrapper (and its symlink):
rm /usr/local/bin/hanu_call
rm /root/.hermes/skills/hanu-bridge/hanu_call

# 4) In the repo: delete the same files from hermes-hanu-skill/.

# 5) Trim SOUL.md (hanu-v1/project/SOUL.md): remove sections 1, 2, 3 ("ALWAYS
#    use hanu_call", "NEVER use these built-in Hermes tools", "One Hanu tool
#    per intent"). Keep Identity, Privacy, Tone, "How you grow", and the
#    five-second check (rewording the check to drop the hanu_call mention).

# 6) Trim SKILL.md (hermes-hanu-skill/SKILL.md): remove "The first rule" and
#    "How to call these tools" sections; remove all `hanu_call <name>`
#    invocation examples. The tool list stays.

systemctl --user restart hermes-gateway
```

### Step 9 — Update docs

- `BRIDGE_DESIGN.md` — strike sections 3 ("The Hanu skill — Hermes's hands") references to shell-invocation; replace with "tools are exposed via the hanu MCP server."
- `CLAUDE.md` — strike the "tool routing tension" gotcha.

---

## Verification

```bash
# 1) MCP server alive
systemctl --user status hermes-gateway
journalctl --user -u hermes-gateway --since today | grep -c "MCP server `hanu`"   # >0

# 2) Tools are listed by Hermes
# Use Hermes' CLI to dump active tools (exact command depends on version):
hermes tools list | grep hanu_   # should show 30 entries

# 3) End-to-end write test (from droplet, as root, no shell wrapper anymore)
/usr/local/lib/hermes-agent/venv/bin/python -c "
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client
import asyncio, json
async def main():
    params = StdioServerParameters(command='/usr/local/lib/hermes-agent/venv/bin/python',
                                    args=['/root/.hermes/skills/hanu-bridge/hanu_mcp_server.py'])
    async with stdio_client(params) as (r, w):
        async with ClientSession(r, w) as s:
            await s.initialize()
            tools = await s.list_tools()
            print('count =', len(tools.tools))
            out = await s.call_tool('hanu_get_settings', {})
            print(out.content[0].text)
asyncio.run(main())
"
# Expect: count = 30, then a JSON response with the user's settings row.
```

End-to-end: a fresh WhatsApp turn results in a write to Supabase visible in `activity_log` with no `hook-mirror.log` entry produced.

---

## Rollback

The mirror + shell wrapper are intentionally kept during the 48-hour window so rollback is just:

1. Re-enable Hermes' built-in toolsets (revert `cli-config.yaml`).
2. Remove the `hanu` MCP server entry from `cli-config.yaml`.
3. `systemctl --user restart hermes-gateway`.

If you've already completed step 8, you'll need to restore `mirror-to-hanu.py` and `hanu_call` from git history before rolling back. Don't skip the observation window.

---

## Files touched

**New:**
- `hermes-hanu-skill/hanu_mcp_server.py`

**Modified:**
- Hermes config on droplet (`cli-config.yaml` or equivalent) — add MCP server, disable built-ins.
- `hanu-v1/project/SOUL.md` — trim routing rules.
- `hermes-hanu-skill/SKILL.md` — trim routing instructions.
- `BRIDGE_DESIGN.md`, `CLAUDE.md` — update narrative.

**Deleted after window:**
- `hermes-hanu-skill/mirror-to-hanu.py`
- `hermes-hanu-skill/hanu_call`
- `/usr/local/bin/hanu_call` symlink
- `/var/log/hanu/hook-mirror.log`

---

## Notes

- If the Hermes version on the droplet is older than the MCP support landed in upstream Nous Research's repo, upgrade first (`cd hermes-agent && git pull && pip install -e .` in the Hermes venv, then restart). Confirm `mcp_serve.py` exists.
- The schema generation in step 2 is intentionally permissive (everything is `string`). Tighten per-tool schemas in a follow-up pass — e.g., `hanu_save_memory.privacy` should be an enum of the six privacy values, `hanu_create_reminder.recur` should be an enum of `once|daily|weekly|monthly|yearly|custom`. Enum-typed inputs further improve model selection accuracy.
- After step 8, the architecture diagram in `CLAUDE.md` becomes: `WhatsApp → Baileys → Hermes → MCP(hanu) → Supabase → realtime → UI`. Single write path; no mirror layer.
