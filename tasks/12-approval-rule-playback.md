# 12 — Approval rule playback: "Always allow" persists

**Priority:** P3
**Effort:** half a day
**Depends on:** 08 (permissions; rules are a richer overlay on the same model)
**Status:** TODO
**Risk if skipped:** the UI's "Always allow" button on the Approval Detail modal sets `approvals.rule_created jsonb` but nothing reads it back. Next time Mother asks the same question, the user gets pinged again. The product feels broken in exactly the place the user trained it.

---

## Context

Schema: `approvals.rule_created jsonb` exists (`schema.sql:445`). UI's `ApprovalDetailModal` (`modals.jsx`) writes a rule shape into the column when the user picks "Always allow." Nothing in `tools.py` or the agent prompt reads from it.

Right behavior: when an approval request arrives, check active rules first; auto-resolve if one matches.

---

## Acceptance criteria

- An `approval_rules` table replaces the ad-hoc `approvals.rule_created jsonb` column. (Keeping it as a JSON blob on the approval row is fine for the UI, but the rule must live as a queryable row for matching.)
- New MCP tool `hanu_check_approval_rule(from_person_id, question_kind, question_text)` returns matching active rule (if any).
- `hanu_request_approval` checks for a matching rule before inserting; if one matches, it inserts an `approvals` row pre-resolved with the rule's resolution.
- UI "Always allow" creates a rule via new MCP tool `hanu_create_approval_rule(...)`.

---

## Implementation steps

### Step 1 — Schema

```sql
create type approval_rule_action as enum ('allow', 'deny', 'always_ask');

create table public.approval_rules (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.profiles(id) on delete cascade,

  -- Matching: who, what kind, optional text-regex
  from_person_id  uuid references public.people(id) on delete cascade,  -- null = any person
  kind            text,                                                  -- null = any kind
  text_match      text,                                                  -- ILIKE pattern, optional

  action          approval_rule_action not null,
  reply_template  text,                                                  -- used when action='allow'

  active          boolean not null default true,
  created_at      timestamptz not null default now(),
  expires_at      timestamptz,

  -- Provenance: which approval row birthed this rule (optional)
  origin_approval_id uuid references public.approvals(id) on delete set null
);

create index approval_rules_lookup_idx
  on public.approval_rules(user_id, from_person_id, kind)
  where active = true;

alter table public.approval_rules enable row level security;
create policy "rules: owner select" on public.approval_rules for select using (auth.uid() = user_id);
create policy "rules: owner insert" on public.approval_rules for insert with check (auth.uid() = user_id);
create policy "rules: owner update" on public.approval_rules for update using (auth.uid() = user_id);
create policy "rules: owner delete" on public.approval_rules for delete using (auth.uid() = user_id);
```

### Step 2 — Matching function

```sql
create or replace function public.match_approval_rule(
  p_from_person_id uuid,
  p_kind text,
  p_text text
) returns table (
  id uuid,
  action approval_rule_action,
  reply_template text
) language sql stable security definer as $$
  select r.id, r.action, r.reply_template
    from public.approval_rules r
   where r.active = true
     and (r.expires_at is null or r.expires_at > now())
     and (r.from_person_id is null or r.from_person_id = p_from_person_id)
     and (r.kind is null or r.kind = p_kind)
     and (r.text_match is null or p_text ilike r.text_match)
   order by
     (case when r.from_person_id is not null then 0 else 1 end),
     (case when r.kind is not null then 0 else 1 end),
     (case when r.text_match is not null then 0 else 1 end),
     r.created_at desc
   limit 1;
$$;
```

Most-specific rule wins (person+kind+text > person+kind > person > any).

### Step 3 — MCP tools

```python
def hanu_create_approval_rule(
    action: str,                    # 'allow' | 'deny' | 'always_ask'
    from_person_id: Optional[str] = None,
    kind: Optional[str] = None,
    text_match: Optional[str] = None,
    reply_template: Optional[str] = None,
    expires_at: Optional[str] = None,
    origin_approval_id: Optional[str] = None,
) -> dict:
    try:
        res = sb().table("approval_rules").insert({
            "user_id": USER_ID,
            "from_person_id": from_person_id,
            "kind": kind,
            "text_match": text_match,
            "action": action,
            "reply_template": reply_template,
            "expires_at": expires_at,
            "origin_approval_id": origin_approval_id,
        }).execute()
        rid = res.data[0]["id"] if res.data else None
        log_activity("approval_rule_created",
                     f"Rule: {action} for kind={kind} person={from_person_id}",
                     "approval_rules", rid)
        return _ok(id=rid)
    except Exception as e:
        return _err(str(e))


def hanu_check_approval_rule(
    from_person_id: str,
    kind: str,
    text: str = "",
) -> dict:
    try:
        res = sb().rpc("match_approval_rule", {
            "p_from_person_id": from_person_id,
            "p_kind": kind,
            "p_text": text,
        }).execute()
        row = res.data[0] if res.data else None
        return _ok(matched=row)
    except Exception as e:
        return _err(str(e))
```

Update `hanu_request_approval` to consult the rule first:

```python
def hanu_request_approval(from_person_id, question, context="", suggested_action="", kind="question"):
    try:
        # Look for an active rule
        match = sb().rpc("match_approval_rule", {
            "p_from_person_id": from_person_id,
            "p_kind": kind,
            "p_text": question,
        }).execute().data
        rule = match[0] if match else None

        approval_state = "pending"
        reply_text = None
        if rule:
            if rule["action"] == "allow":
                approval_state = "approved"
                reply_text = rule.get("reply_template")
            elif rule["action"] == "deny":
                approval_state = "denied"
                reply_text = "[auto-denied by rule]"
            # 'always_ask' → behaves like no rule
        # ...
        res = sb().table("approvals").insert({
            "user_id": USER_ID,
            "from_person_id": from_person_id,
            "kind": kind,
            "question": question,
            "context": context,
            "suggested_action": suggested_action,
            "state": approval_state,
            "reply_text": reply_text,
            "resolved_at": now_iso() if approval_state != "pending" else None,
        }).execute()
        # log activity, etc.
```

### Step 4 — UI

`hanu-v1/project/modals.jsx` — `ApprovalDetailModal`: the existing "Always allow" button now writes via `hanu_create_approval_rule` with `from_person_id=approval.from_person_id`, `kind=approval.kind`, `action='allow'`, `origin_approval_id=approval.id`.

`SettingsScreen` — add a "Rules" section listing active rules with a "Revoke" button.

---

## Verification

```sql
do $$
declare uid uuid := 'd804b9ed-5eaa-497c-8390-86ba02007a33';
declare mom uuid;
declare rid uuid;
begin
  insert into public.people (user_id, name, profile_type) values (uid, 'TEST Mom', 'managed') returning id into mom;
  insert into public.approval_rules (user_id, from_person_id, kind, action, reply_template)
       values (uid, mom, 'reminder_request', 'allow', 'Sure, I will pass it on.')
    returning id into rid;

  -- Test the matcher
  select * from public.match_approval_rule(mom, 'reminder_request', '');
  -- Expect one row with action='allow'

  delete from public.approval_rules where id = rid;
  delete from public.people where id = mom;
end $$;
```

End-to-end: in the UI, click "Always allow" on a pending approval. Confirm an `approval_rules` row is created. Have the agent receive another request from the same person, same kind: it should auto-resolve and NOT show up in the pending queue.

---

## Rollback

```sql
drop function if exists public.match_approval_rule(uuid, text, text);
drop table if exists public.approval_rules;
drop type if exists approval_rule_action;
```

`approvals.rule_created jsonb` stays as-is (still works for the legacy path).

---

## Files touched

- `supabase/schema.sql`
- `hermes-hanu-skill/tools.py`
- `hanu-v1/project/modals.jsx` (ApprovalDetailModal "Always allow" wiring)
- `hanu-v1/project/screens-c.jsx` (Settings → Rules section)
- `hanu-v1/project/supabase-client.jsx` (load rules into HANU.rules)
- `hanu-v1/project/data.jsx` (`rules: []` placeholder)

---

## Notes

- The `text_match` ILIKE pattern is a v1 affordance. For more nuance (regex, semantic), defer to v2.
- Rules with `from_person_id IS NULL` apply to any person — useful for "Always deny see_journal" type blanket rules.
- The "always_ask" action exists for completeness; it's a no-op match (treated as no rule) but documents that the user explicitly considered the case.
- Expiring rules (`expires_at`) is useful for "Allow Mother to ask about Father's medication for the next 30 days."
