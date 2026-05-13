"""
Hanu MCP server.

Exposes every callable in `tools._TOOL_REGISTRY` as a first-class MCP tool with
a JSON Schema input shape. Hermes registers this as an `mcp_servers` entry in
its config; the LLM sees `hanu_save_memory`, `hanu_create_reminder`, etc. as
structured tools alongside (or instead of) Hermes' built-ins.

Transport: stdio. Hermes spawns this as a child process and speaks MCP JSON-RPC
on stdin/stdout. There is no port to manage.

Install (on the droplet):

    /usr/local/lib/hermes-agent/venv/bin/pip install "mcp>=1.0"

Hermes config (cli-config.yaml or equivalent — exact key may differ by version):

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

In the same config, disable Hermes built-ins that overlap Hanu's domain so the
model doesn't have two competing tools for "save a memory":

    tools:
      disabled: [memory, todo, cronjob, kanban, session_search]

The post_tool_call mirror (`mirror-to-hanu.py`) becomes redundant once this
server is registered and the built-ins are disabled. Keep the mirror running
for the first 48 hours as a belt-and-suspenders, then remove it.

Verify manually (after install, before wiring into Hermes):

    /usr/local/lib/hermes-agent/venv/bin/python - <<'PY'
    import asyncio, json
    from mcp import ClientSession, StdioServerParameters
    from mcp.client.stdio import stdio_client
    async def main():
        params = StdioServerParameters(
            command="/usr/local/lib/hermes-agent/venv/bin/python",
            args=["/root/.hermes/skills/hanu-bridge/hanu_mcp_server.py"],
        )
        async with stdio_client(params) as (r, w):
            async with ClientSession(r, w) as s:
                await s.initialize()
                tools = await s.list_tools()
                print("count =", len(tools.tools))
                out = await s.call_tool("hanu_get_settings", {})
                print(out.content[0].text)
    asyncio.run(main())
    PY

Expected: count ~ 40 tools, then a JSON dict echoing the user's settings row.
"""
from __future__ import annotations

import asyncio
import inspect
import json
import sys
import typing
from typing import Any, get_type_hints

# MCP Python SDK
from mcp.server import Server
from mcp.server.stdio import stdio_server
from mcp.types import TextContent, Tool

# Local tool registry. Importing this module triggers a Supabase client
# initialization; the MCP server logs an error and exits with non-zero status
# if the SUPABASE_* env vars aren't set.
import tools as hanu_tools  # type: ignore

server: Server = Server("hanu-bridge")


# ---------------------------------------------------------------------------
# Type-hint -> JSON Schema
# ---------------------------------------------------------------------------

_PY_TO_JSON: dict[type, str] = {
    str: "string",
    int: "integer",
    float: "number",
    bool: "boolean",
    list: "array",
    dict: "object",
}


def _unwrap_optional(ann: Any) -> tuple[Any, bool]:
    """Strip Optional[T] / Union[T, None] -> (T, is_optional)."""
    origin = typing.get_origin(ann)
    if origin in (typing.Union, getattr(typing, "UnionType", None)):
        args = [a for a in typing.get_args(ann) if a is not type(None)]
        if len(args) == 1:
            return args[0], True
    return ann, False


def _ann_to_schema(ann: Any) -> dict[str, Any]:
    """Best-effort JSON Schema fragment for an annotation."""
    ann, _ = _unwrap_optional(ann)
    origin = typing.get_origin(ann)
    if origin in (list, typing.List):  # type: ignore[attr-defined]
        inner = (typing.get_args(ann) or [str])[0]
        return {"type": "array", "items": _ann_to_schema(inner)}
    if origin in (dict, typing.Dict):  # type: ignore[attr-defined]
        return {"type": "object"}
    return {"type": _PY_TO_JSON.get(ann, "string")}


def _build_input_schema(fn: Any) -> dict[str, Any]:
    """Inspect fn's signature and synthesize a JSON Schema input object."""
    sig = inspect.signature(fn)
    hints = get_type_hints(fn)
    props: dict[str, dict[str, Any]] = {}
    required: list[str] = []
    for name, param in sig.parameters.items():
        if name == "self":
            continue
        ann = hints.get(name, str)
        _, is_optional = _unwrap_optional(ann)
        schema = _ann_to_schema(ann)
        if param.default is inspect.Parameter.empty and not is_optional:
            required.append(name)
        # Surface the default value when it's JSON-serializable, to hint the LLM.
        if param.default is not inspect.Parameter.empty and isinstance(
            param.default, (str, int, float, bool, type(None))
        ):
            schema["default"] = param.default
        props[name] = schema
    out: dict[str, Any] = {"type": "object", "properties": props}
    if required:
        out["required"] = required
    return out


# ---------------------------------------------------------------------------
# MCP handlers
# ---------------------------------------------------------------------------

@server.list_tools()
async def _list_tools() -> list[Tool]:
    out: list[Tool] = []
    for name, fn in hanu_tools._TOOL_REGISTRY.items():
        first_line = (fn.__doc__ or "").strip().split("\n")[0]
        out.append(
            Tool(
                name=f"hanu_{name}",
                description=first_line or f"Hanu tool: {name}",
                inputSchema=_build_input_schema(fn),
            )
        )
    return out


@server.call_tool()
async def _call_tool(name: str, arguments: dict[str, Any] | None) -> list[TextContent]:
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
    except Exception as e:  # noqa: BLE001
        result = {"ok": False, "error": str(e)}
    body = json.dumps(result, default=str, ensure_ascii=False)
    return [TextContent(type="text", text=body)]


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

async def main() -> None:
    async with stdio_server() as (read, write):
        await server.run(read, write, server.create_initialization_options())


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        sys.exit(0)
