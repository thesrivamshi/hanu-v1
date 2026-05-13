# 16 — UI: sweep mock-data remnants + add per-surface empty states

**Priority:** P1 (visible-to-user, embarrassing-on-first-use)
**Effort:** 1 day
**Depends on:** none
**Status:** TODO
**Risk if skipped:** new family members open the app and see Aarav, Aman, Geeta, Ramesh, Ishita, Dr. Mehta — names from the original mock prototype. Most surfaces render as silent empty `<div>`s with `count: 0`. The product looks broken or fake.

---

## Context

A grep through `hanu-v1/project/` shows these still-shipped mock references:

| File | Line | Snippet | Severity |
|---|---|---|---|
| `screens-a.jsx` | 378 | KPI card hardcoded `<div className="value">4</div><div className="delta">Geeta · Ramesh</div>` ("Family-linked") | H |
| `modals.jsx` | 129 | AskHanuModal demo answer about Aman + pricing deck | H |
| `modals.jsx` | 135 | Memory card quote "Aman to send signed founder agreement" | H |
| `modals.jsx` | 192 | Promise-to picker hardcoded `["Self","Mother","Aman","Ishita"]` | H |
| `modals.jsx` | 268 | Create-reminder modal `defaultValue="Confirm Dr. Mehta appointment for Father"` | H |
| `modals.jsx` | 291 | Reminder person picker `Seg options={["—","Mother","Father","Aman","Ishita"]} value="Father"` | H |
| `modals.jsx` | 346 | Add-person modal `defaultValue="Ramesh Battini"` | H |
| `modals.jsx` | 422 | Approval-detail textarea `defaultValue="Aarav is free after 19:00 tomorrow..."` | H |
| `modals.jsx` | 432 | Approval option "I'll ask Aarav and get back to you. (defer)" | H |
| `data.jsx` | 40 | `family: { name: "Battini Family", ... }` — derive from user instead | L |

In addition, every screen that can be empty (Today's surrounding cards, Memory, Goals, Reminders, Loops, Promises, Decisions, Approvals, Family) renders an empty `<div>` with section title + count `0`. Only `screens-b.jsx:282` has a good empty-state pattern ("Tell Hanu on WhatsApp — e.g. _Add my mom, her name is Geeta..._"). Apply that pattern everywhere.

---

## Acceptance criteria

- `grep -rE "Aarav|Geeta|Ramesh|Aman|Ishita|Mehta|Battini" hanu-v1/project/*.jsx` returns zero results.
- Every input field's `defaultValue` for personal names, free-text, or fake demos is empty or a placeholder hint.
- Every `Seg options={[...]}` that contained a hard list of names now sources from `HANU.people` or a small static fallback that doesn't include real-sounding names.
- Every screen that can be empty has a per-surface CTA pointing the user to WhatsApp.
- Hero "Suggest" card has working onClick handlers or is hidden in the empty state.
- KPI hardcodes are computed from `HANU.*` arrays.

---

## Implementation steps

### Step 1 — Sweep `modals.jsx`

#### 1a — Replace hardcoded demo answers in AskHanuModal (~line 110-180)

The current `AskHanuModal` shows a hand-crafted Aman-pricing-deck answer. Replace with a real flow: input → fetch from a new MCP tool `hanu_ask` (which the agent backend will populate, or for v1, call `hanu_search_memories` and format the result).

Minimal change:

```jsx
function AskHanuModal({ onClose }) {
  const [q, setQ] = React.useState("");
  const [results, setResults] = React.useState(null);
  const [loading, setLoading] = React.useState(false);

  async function ask() {
    setLoading(true);
    try {
      const r = await window.hanu.searchMemories(q);  // wraps supabase + ilike
      setResults(r || []);
    } finally { setLoading(false); }
  }

  return (
    <Modal onClose={onClose} title="Ask Hanu">
      <input
        autoFocus
        className="input"
        placeholder="What did I tell Hanu about..."
        value={q}
        onChange={e => setQ(e.target.value)}
        onKeyDown={e => e.key === "Enter" && ask()}
      />
      {loading && <div className="muted">Thinking…</div>}
      {results === null && (
        <div className="empty">
          <p>Hanu can answer questions about anything you've shared with it on WhatsApp.</p>
          <p className="muted">e.g., "what's mother's birthday?" or "what did I decide about pricing?"</p>
        </div>
      )}
      {results !== null && results.length === 0 && (
        <div className="empty">
          <p>Nothing found yet. {window.HANU.memories.length === 0
            ? "Talk to Hanu on WhatsApp and try again."
            : "Try different words."}</p>
        </div>
      )}
      {results !== null && results.length > 0 && (
        <ul className="results">
          {results.map(m => (
            <li key={m.id}>
              <div>{m.text}</div>
              <div className="muted small">{m.source}</div>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
```

Add `window.hanu.searchMemories` to `supabase-client.jsx`:

```js
window.hanu.searchMemories = async function (q) {
  if (!q) return [];
  const { data, error } = await sb.from("memories")
    .select("id,text,source,created_at,kind,privacy")
    .ilike("text", `%${q}%`)
    .eq("archived", false)
    .order("created_at", { ascending: false })
    .limit(10);
  if (error) { console.error(error); return []; }
  return data;
};
```

#### 1b — Replace `Seg options=[...]` person pickers

Locate every `Seg options={[...]}` containing hard names (lines ~192, 291, 432). Replace with:

```jsx
<Seg
  options={["Self", ...HANU.people.map(p => p.name)]}
  value={value}
  onChange={onChange}
/>
```

If `HANU.people.length === 0`, render just "Self" + an inline hint: "_Add people by telling Hanu on WhatsApp_".

#### 1c — Empty `defaultValue=` on inputs

Sweep all `defaultValue="..."` in `modals.jsx`. Replace with `defaultValue=""` (or remove the attribute entirely if the parent state should drive it). Replace any placeholder text:

```jsx
<input className="input" placeholder="e.g. Confirm a meeting, send a doc, call someone" />
```

(Generic placeholders, no real names.)

#### 1d — Approval-detail textarea

`modals.jsx:422`: remove `defaultValue="Aarav is free…"`. Wire to component state:

```jsx
const [reply, setReply] = React.useState(approval.suggested_action || "");
<textarea
  className="textarea mt-8"
  value={reply}
  onChange={e => setReply(e.target.value)}
  placeholder="Type a reply, or leave blank to defer to you."
/>
```

`modals.jsx:432`: replace the "I'll ask Aarav…" hardcoded option with a templated version:

```jsx
<button className="btn ghost" onClick={() => setReply(`I'll ask ${HANU.user.name} and get back to you.`)}>
  Defer to me
</button>
```

#### 1e — AddPerson modal

`modals.jsx:346`: remove `defaultValue="Ramesh Battini"`. Empty input.

### Step 2 — Sweep `screens-a.jsx`

#### 2a — Family-linked KPI

`screens-a.jsx:378`. Replace with a live count:

```jsx
<div className="span-3">
  <div className="kpi">
    <div className="label">Family-linked</div>
    <div className="value">
      {goals.filter(g => g.family_critical).length}
    </div>
    <div className="delta">
      {HANU.people.filter(p => /family/i.test(p.relationship || ""))
                  .map(p => p.name.split(" ")[0]).slice(0, 2).join(" · ")
        || "—"}
    </div>
  </div>
</div>
```

#### 2b — Suggest card buttons

`screens-a.jsx:66-76` — the `<div className="suggest">` block has buttons with no handlers. Either wire them, or hide the block when `totalWaiting === 0`. Recommended: hide it on the deep-empty state (no people, no memories, no anything).

### Step 3 — Sweep `data.jsx`

`data.jsx:40`:

```js
family: {
  name: HANU?.user?.lastName ? `${HANU.user.lastName} Family` : "Family",
  members: [],
  ...
}
```

Or, simpler, leave it blank until the user names their family space:

```js
family: {
  name: "",  // populated when the user names their family space
  members: [],
  ...
}
```

The Family Space screen should show a setup CTA if `family.name === ""`.

### Step 4 — Empty-state pattern, applied everywhere

The pattern from `screens-b.jsx:282`:

```jsx
<div className="empty-state">
  <Icon name="..." size={32} />
  <h3>Nothing here yet</h3>
  <p>Tell Hanu on WhatsApp — e.g. <em>"Add my mom, her name is Geeta, her WhatsApp is +91…"</em></p>
</div>
```

Apply per surface with surface-appropriate copy:

| Screen | Section | Empty copy |
|---|---|---|
| Today | Time-sensitive | `Nothing scheduled. Tell Hanu "remind me to ..." on WhatsApp.` |
| Today | Pending confirmations | `No approvals pending. Family members will appear here when they ask Hanu something.` |
| Today | Open loops | `No open loops. As you tell Hanu about unfinished things, they'll appear here.` |
| Today | Memory inbox | `Nothing to review. Hanu adds proposals here when it notices something worth remembering.` |
| Goals | (list) | `No goals yet. Tell Hanu "set a goal to ..." on WhatsApp.` |
| Reminders | (list) | `No reminders yet. Tell Hanu "remind me to ..." on WhatsApp.` |
| Open Loops | (list) | `No open loops yet. Hanu captures unfinished items from your conversations.` |
| Memory | (list) | `No memories yet. Hanu remembers what you tell it on WhatsApp.` |
| Memory Inbox | (list) | `Nothing to review yet.` |
| People | (list) | `No people yet. Tell Hanu "add my mom, her name is ..." on WhatsApp.` |
| Family | (everything) | `No family space yet. Tell Hanu "set up the family space, my last name is ..." on WhatsApp.` |
| Approvals | (list) | `No approval requests yet.` |
| Promises | (list) | `No promises yet. Tell Hanu "I promised X to ..." on WhatsApp.` |
| Decisions | (list) | `No decisions logged yet. Tell Hanu "I decided to ..." on WhatsApp.` |
| Reviews | (today) | `Mark this slot done when you've reflected. Hanu can prompt you on WhatsApp.` |

Build a reusable `<EmptyState icon="..." title="..." cta="..." />` component in `shared.jsx` to keep all surfaces consistent.

### Step 5 — Verify

```bash
cd /Users/srivamshi/MyDrafts/Hanu-v1
grep -rE "Aarav|Geeta|Ramesh|Aman|Ishita|Mehta|Battini" hanu-v1/project/*.jsx
# Expected: no matches

grep -E 'defaultValue="[^"]+"' hanu-v1/project/modals.jsx
# Expected: zero (or only short generic placeholders left intentionally)

grep -E 'Seg options=\["[^"]+","[^"]+","[^"]+","[^"]+"\]' hanu-v1/project/modals.jsx
# Expected: zero (no hardcoded multi-option person lists)
```

Open the deployed UI in a fresh browser with an empty DB. Visit every screen. Confirm each empty surface has a CTA. Open every modal. Confirm no fictional names appear anywhere.

---

## Rollback

```bash
git checkout -- hanu-v1/project/modals.jsx hanu-v1/project/screens-a.jsx hanu-v1/project/data.jsx
```

Useful only as a last resort — the mock data is what we are intentionally removing.

---

## Files touched

- `hanu-v1/project/modals.jsx` (heavy)
- `hanu-v1/project/screens-a.jsx`
- `hanu-v1/project/data.jsx`
- `hanu-v1/project/shared.jsx` (new `EmptyState` component)
- `hanu-v1/project/supabase-client.jsx` (`hanu.searchMemories`)
- `hanu-v1/project/styles.css` (`.empty-state` rules)

---

## Notes

- Once `EmptyState` exists, audit `screens-b.jsx` and `screens-c.jsx` for surfaces that still don't use it.
- Hero "Suggest" card on Today is a candidate for deletion if it can't be wired meaningfully. Three unclickable buttons that pretend to be functional is worse than no buttons.
- The Aman/Ishita/Mehta strings might also linger in CSS comments or stylesheet snippets. `grep -r` includes `.css`, but a separate sweep of `styles.css` is worth it.
