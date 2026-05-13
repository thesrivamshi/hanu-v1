# 21 — AI disclosure to family members ("I'm Hanu, an AI assistant ...")

**Priority:** P3 (becomes P0 the moment a non-user family member is contacted by Hanu)
**Effort:** 2-3 hours
**Depends on:** 08 (people + permission_tier) recommended
**Status:** TODO
**Risk if skipped:** when Hanu sends a reminder to Father or responds to Mother's message-relay, Father and Mother believe they're chatting with Vamshi. OpenAI's usage policies and most general AI-ethics frameworks require disclosing that the responder is AI. Beyond policy, the trust violation when a family member realizes it was an AI is much worse than disclosing upfront.

---

## Context

Today, Hanu can act on behalf of Vamshi toward other people (the PRD §requests-relay covers "Tell Vamshi I'll be late" type flows). The architecture supports sending to a `people` row, but nothing in the message envelope identifies the speaker as AI.

Required: on **first contact with any person other than the user**, Hanu's outbound message includes a clear "I'm Hanu, an AI assistant Vamshi set up" line. Subsequent messages in the same thread can drop the preamble (the disclosure is sticky per-conversation).

---

## Acceptance criteria

- A `conversations.first_contact_disclosed_at timestamptz` column tracks whether the first-contact disclosure has been sent.
- The reminder firing worker, request-relay path, and any other outbound-to-person code wraps the outgoing message with a disclosure preamble if `first_contact_disclosed_at IS NULL`.
- Once sent, `first_contact_disclosed_at = now()`; subsequent messages skip the preamble.
- The disclosure text is configurable per-language in `settings.disclosure_template` (or a constant for v1).

---

## Implementation steps

### Step 1 — Schema

```sql
alter table public.conversations
  add column if not exists first_contact_disclosed_at timestamptz;
```

(For the user's own conversation with Hanu, this column stays null; we never disclose to the user — Vamshi knows Hanu is AI.)

### Step 2 — Define the disclosure template

```python
# In tools.py or a separate constants module:
DISCLOSURE_TEMPLATE = (
    "Hi — I'm Hanu, an AI assistant {user_first} set up to help me reach them "
    "and to manage shared family responsibilities. I'll be sending you reminders "
    "and relaying your messages to them. You can reply normally; I'll pass it on.\n\n"
    "If you'd rather only deal with {user_first} directly, just say 'stop' and I'll "
    "stop messaging you here.\n\n"
)

def _disclosure_for_user(user_first_name: str) -> str:
    return DISCLOSURE_TEMPLATE.format(user_first=user_first_name)
```

### Step 3 — Wrap the send path

Identify every code path that sends a WhatsApp message to a `people` row (not to the user). Likely places:

- `reminder_worker.py` sending reminders to a person's WhatsApp.
- A future message-relay tool (`hanu_relay_message(to_person_id, text)`).
- Any approval-resolution that sends an outbound reply to the requesting person.

For each, wrap with a helper:

```python
def _send_to_person_with_disclosure(person_id: str, text: str, conversation_id: str) -> bool:
    """Send `text` to the person's WhatsApp. Prepend disclosure if first contact."""
    conv = sb().table("conversations").select(
        "first_contact_disclosed_at"
    ).eq("id", conversation_id).single().execute().data
    needs_disclosure = conv is None or conv.get("first_contact_disclosed_at") is None

    # Look up the person's WhatsApp number:
    person = sb().table("people").select(
        "name,whatsapp_number,permission_tier"
    ).eq("id", person_id).single().execute().data
    if not person or not person.get("whatsapp_number"):
        return False

    # Look up the user's first name:
    profile = sb().table("profiles").select("first_name").eq(
        "id", USER_ID
    ).single().execute().data or {}
    user_first = profile.get("first_name", "the user")

    body = (_disclosure_for_user(user_first) + text) if needs_disclosure else text

    # Dispatch via Hermes / Baileys (whichever interface from task 05 step 2):
    ok = _send_whatsapp_to_number(person["whatsapp_number"], body)
    if not ok:
        return False

    if needs_disclosure:
        sb().table("conversations").update({
            "first_contact_disclosed_at": now_iso(),
        }).eq("id", conversation_id).execute()
        log_activity("disclosure_sent",
                     f"First-contact disclosure sent to {person['name']}",
                     "conversations", conversation_id)
    return True
```

### Step 4 — Handle "stop" replies

The disclosure offers an opt-out. Honor it:

```python
def _handle_inbound_message(person_id: str, text: str):
    if text.strip().lower() in {"stop", "unsubscribe", "leave me alone"}:
        # Mark the person as opted-out
        sb().table("people").update({
            "opted_out_at": now_iso(),
        }).eq("id", person_id).execute()
        _send_to_person_with_disclosure(
            person_id,
            "Got it. I won't message you here anymore. " +
            "You can reach Vamshi directly at any time.",
            conversation_id,
        )
        return True  # short-circuit; don't proceed to LLM
    return False
```

Add the `people.opted_out_at` column:

```sql
alter table public.people
  add column if not exists opted_out_at timestamptz;
```

Subsequent outbound sends to an opted-out person are blocked at the `_send_to_person_with_disclosure` helper:

```python
if person.get("opted_out_at"):
    log_activity("send_blocked_opted_out",
                 f"Outbound to {person['name']} blocked: opted out",
                 "people", person_id)
    return False
```

### Step 5 — Settings-screen visibility

`hanu-v1/project/screens-c.jsx` (Settings): add a "Disclosures" section that lists people Hanu has disclosed to (with the timestamp). Optional v1 polish; clearly useful when family scales.

---

## Verification

End-to-end:

1. Add a test person via `hanu_add_person` with a WhatsApp number you control (a second phone or a friend who can help test).
2. Trigger a reminder addressed to that person (`hanu_create_reminder(... person_id=<test>)`).
3. Confirm the first outbound message contains the disclosure preamble.
4. Trigger a second reminder to the same person; confirm the disclosure is omitted.
5. Reply "stop" from the test phone. Confirm Hanu acknowledges and that `people.opted_out_at` is set.
6. Trigger a third reminder; confirm it's not delivered.

```sql
select p.name, c.first_contact_disclosed_at, p.opted_out_at
  from public.conversations c join public.people p on p.id = c.person_id
 where c.user_id = '<uid>'
   and c.person_id is not null;
```

---

## Rollback

```sql
alter table public.conversations drop column if exists first_contact_disclosed_at;
alter table public.people        drop column if exists opted_out_at;
```

Remove the `_send_to_person_with_disclosure` wrapper, revert to direct `_send_whatsapp_to_number` calls.

---

## Files touched

- `supabase/schema.sql`
- `hermes-hanu-skill/tools.py` (or a new `outbound.py` helper module)
- `hermes-hanu-skill/reminder_worker.py` (use new helper)
- `hanu-v1/project/screens-c.jsx` (optional Settings → Disclosures section)
- `BRIDGE_DESIGN.md` (document the disclosure policy)

---

## Notes

- The disclosure wording is a starting point. Localize per language as you add family members in non-English households.
- "Stop" detection is a substring match for v1. A second-version classifier reduces false positives ("don't stop messaging me, I love these reminders" — current code would opt them out wrongly). For v1, the false-positive rate is low and the cost of mis-opting-out is recoverable (the user can un-opt-out from Settings).
- This task is also a precondition for any future "Hanu speaks to a non-family contact" feature (Doctor's office, client, vendor). Disclosure is universal.
- Document the policy publicly somewhere visible (e.g., a `https://${HANU_HOST}/about` static page) so people who Google the bot number see "this is an AI assistant operated by Vamshi" and don't feel deceived.
