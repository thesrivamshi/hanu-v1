# 13 — Memory provenance: `source_type` enum + UI display

**Priority:** P3
**Effort:** 2-3 hours
**Depends on:** none (11 if you want voice-source rendering)
**Status:** TODO
**Risk if skipped:** the PRD's "Show why Hanu knows something" stays as free-text `source` strings that don't render consistently. Provenance auditing is by hand-greppable substring.

---

## Context

Schema: `memories.source text` (free) + `memories.source_message_id uuid` (FK to messages). Today, `tools.py:84` sets `source='conversation'` by default; the mirror hook sets `source='hermes_memory_mirror'`. The UI can't render an icon because the values aren't structured.

We want a small enum that the UI can map to icons and labels.

---

## Acceptance criteria

- `memory_source_type` enum with values: `conversation`, `voice_note`, `approved_inbox`, `pattern_detected`, `manual_entry`, `imported`.
- `memories.source_type memory_source_type not null default 'conversation'`.
- Backfill: existing `source` strings mapped to enum values where possible; unmatched rows get `'conversation'`.
- `tools.py` accepts `source_type` and stops relying on the free-text `source` for provenance kind.
- UI renders an icon next to each memory based on `source_type`.

---

## Implementation steps

### Step 1 — Schema

```sql
create type memory_source_type as enum (
  'conversation', 'voice_note', 'approved_inbox', 'pattern_detected', 'manual_entry', 'imported'
);

alter table public.memories
  add column source_type memory_source_type not null default 'conversation';

-- Backfill heuristics:
update public.memories set source_type = case
  when source ilike '%voice%' then 'voice_note'::memory_source_type
  when source ilike '%inbox%' then 'approved_inbox'::memory_source_type
  when source ilike '%pattern%' then 'pattern_detected'::memory_source_type
  when source ilike '%manual%' then 'manual_entry'::memory_source_type
  when source ilike '%import%' then 'imported'::memory_source_type
  else 'conversation'::memory_source_type
end;
```

### Step 2 — `tools.py`

```python
def hanu_save_memory(
    text: str,
    kind: str = "other",
    privacy: str = "private",
    source_type: str = "conversation",  # NEW
    source: Optional[str] = None,        # human-readable detail, e.g. "Conversation on May 13"
    pinned: bool = False,
    shared_with_person_id: Optional[str] = None,
    shared_in_space_id: Optional[str] = None,
    sensitive_category: Optional[str] = None,
    source_message_id: Optional[str] = None,
) -> dict:
    ...
    sb().table("memories").insert({
        ...
        "source_type": source_type,
        "source": source or _default_source_text(source_type),
        "source_message_id": source_message_id,
        ...
    }).execute()
```

Helper:

```python
def _default_source_text(source_type: str) -> str:
    from datetime import date as _date
    today = _date.today().strftime("%b %-d")
    return {
        "conversation": f"Conversation on {today}",
        "voice_note": f"Voice note on {today}",
        "approved_inbox": "Approved from inbox",
        "pattern_detected": "Pattern Hanu noticed",
        "manual_entry": "You added it",
        "imported": "Imported",
    }.get(source_type, "Conversation")
```

### Step 3 — UI

`hanu-v1/project/supabase-client.jsx` — `shapeMemory`:

```js
function shapeMemory(m) {
  return {
    id: m.id,
    text: m.text,
    type: _dbToUi(m.kind || "other"),
    privacy: m.privacy,
    sourceType: m.source_type || "conversation",
    source: m.source || "",
    pinned: !!m.pinned,
    sourceMessageId: m.source_message_id,
  };
}
```

Memory card component (likely in `screens-b.jsx` or `modals.jsx`): render an icon based on `sourceType`:

```jsx
const SOURCE_ICONS = {
  conversation: "chat",
  voice_note: "mic",
  approved_inbox: "inbox",
  pattern_detected: "sparkle",
  manual_entry: "edit",
  imported: "upload",
};
// ...
<Icon name={SOURCE_ICONS[m.sourceType] || "chat"} size={12} />
<span className="source-label">{m.source}</span>
```

---

## Verification

```sql
select source_type, count(*) from public.memories group by source_type;
-- All rows accounted for in the enum

do $$
declare uid uuid := 'd804b9ed-5eaa-497c-8390-86ba02007a33';
begin
  insert into public.memories (user_id, text, kind, privacy, source_type)
       values (uid, 'TEST voice', 'other', 'private', 'voice_note');
  insert into public.memories (user_id, text, kind, privacy, source_type)
       values (uid, 'TEST inbox', 'other', 'private', 'approved_inbox');
  delete from public.memories where text like 'TEST %';
end $$;
```

End-to-end: save a memory via voice and via "remember X" text; confirm icons differ in the UI.

---

## Rollback

```sql
alter table public.memories drop column if exists source_type;
drop type if exists memory_source_type;
```

---

## Files touched

- `supabase/schema.sql`
- `hermes-hanu-skill/tools.py`
- `hanu-v1/project/supabase-client.jsx`
- Memory card / detail modal rendering in `screens-*.jsx` / `modals.jsx`

---

## Notes

- The free-text `source` column stays for human-readable display. The new `source_type` is for UI icon + agent reasoning. Both can coexist.
- `'pattern_detected'` requires a separate worker that notices recurrence ("you mentioned eating poorly 3 weeks in a row → save a pattern memory"). Defer building it; the column accepts the value for when you do.
- `'imported'` is for the eventual export/import path (slice 6).
