# 19 — Simplify nav: 12-screen sidebar to 5 top-level screens

**Priority:** P3
**Effort:** half a day
**Depends on:** 16 (per-surface empty states already exist) recommended
**Status:** TODO
**Risk if skipped:** the 12-screen IA from the design (Today, Goals, Reminders, Open Loops, Memory Vault, Decision Log, Promises, Reviews, People & Access, Family Space, Approval Queue, Settings) over-fits each PRD section. With an empty DB, 7 of 12 screens are mostly empty. Cognitive cost is high; payoff is low.

---

## Context

PRD describes capabilities ("Today Command", "Memory Control", "People & Access", etc.). The current sidebar treats each as a dedicated screen. A leaner IA collapses related capabilities under one screen with filters/tabs:

- **Today** — what matters now: non-negotiable goal, time-sensitive reminders, pending approvals, open loops, memory inbox.
- **Memory** — everything Hanu remembers: tabbed view (All / Goals / Promises / Decisions / Loops / Memory) — same data, different filter.
- **People** — people, permissions, approvals, conflicts (the relational view).
- **Reviews** — morning/midday/evening reviews, weekly miss summary, failure-reason aggregations.
- **Settings** — tone, modes, channels, rules.

5 screens. The PRD requirements are still met — they live under filters rather than separate sections.

---

## Acceptance criteria

- Sidebar has 5 items: Today, Memory, People, Reviews, Settings.
- The Memory screen has a tab strip: All / Goals / Reminders / Open Loops / Promises / Decisions / Memory Vault.
- The People screen has a tab strip: People / Family Space / Approvals / Conflicts.
- All existing screen content survives (no functional regression); the URL/nav state just collapses.
- The old screen ids still work as deep links (e.g., a saved bookmark to `/#goals` lands on Memory → Goals tab).

---

## Implementation steps

### Step 1 — New sidebar config

`hanu-v1/project/data.jsx`:

```js
nav: [
  { id: "today",    label: "Today",    icon: "sun",    group: "core" },
  { id: "memory",   label: "Memory",   icon: "vault",  group: "core" },
  { id: "people",   label: "People",   icon: "people", group: "core" },
  { id: "reviews",  label: "Reviews",  icon: "compass", group: "core" },
  { id: "settings", label: "Settings", icon: "gear",   group: "system" },
],
```

Drop the `group: "knowledge"`, `group: "relational"` distinctions — flatten.

### Step 2 — Wrap existing screens in tabbed containers

`hanu-v1/project/screens-b.jsx` (or wherever Memory lives) gets a new container:

```jsx
function MemoryScreen({ openMemoryDetail }) {
  const [tab, setTab] = React.useState("all");
  return (
    <div>
      <TabStrip
        tabs={[
          { id: "all",       label: "All", count: HANU.memories.length + HANU.goals.length + HANU.reminders.length + HANU.loops.length + HANU.promises.length + HANU.decisions.length },
          { id: "goals",     label: "Goals", count: HANU.goals.length },
          { id: "reminders", label: "Reminders", count: HANU.reminders.length },
          { id: "loops",     label: "Open Loops", count: HANU.loops.length },
          { id: "promises",  label: "Promises", count: HANU.promises.length },
          { id: "decisions", label: "Decisions", count: HANU.decisions.length },
          { id: "vault",     label: "Memory Vault", count: HANU.memories.length },
        ]}
        active={tab}
        onChange={setTab}
      />
      {tab === "all"       && <UnifiedTimeline/>}
      {tab === "goals"     && <GoalsList/>}
      {tab === "reminders" && <RemindersList/>}
      {tab === "loops"     && <LoopsList/>}
      {tab === "promises"  && <PromisesList/>}
      {tab === "decisions" && <DecisionsList/>}
      {tab === "vault"     && <MemoryVaultList openMemoryDetail={openMemoryDetail}/>}
    </div>
  );
}
```

`PeopleScreen` similarly:

```jsx
function PeopleScreen(ctx) {
  const [tab, setTab] = React.useState("people");
  return (
    <div>
      <TabStrip
        tabs={[
          { id: "people",     label: "People",       count: HANU.people.length },
          { id: "family",     label: "Family Space", count: HANU.family?.members?.length || 0 },
          { id: "approvals",  label: "Approvals",    count: HANU.approvals.length },
          { id: "conflicts",  label: "Conflicts",    count: HANU.conflicts?.length || 0 },
        ]}
        active={tab}
        onChange={setTab}
      />
      {tab === "people"    && <PeopleList {...ctx}/>}
      {tab === "family"    && <FamilyScreen {...ctx}/>}
      {tab === "approvals" && <ApprovalScreen openApproval={ctx.openApproval}/>}
      {tab === "conflicts" && <ConflictsScreen/>}
    </div>
  );
}
```

### Step 3 — Add a small `TabStrip` to `shared.jsx`

```jsx
export function TabStrip({ tabs, active, onChange }) {
  return (
    <div className="tab-strip">
      {tabs.map(t => (
        <button key={t.id}
                className={`tab ${active === t.id ? "active" : ""}`}
                onClick={() => onChange(t.id)}>
          {t.label}
          {t.count !== undefined && <span className="count">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}
```

And the matching CSS in `styles.css`.

### Step 4 — Update App router

`hanu-v1/project/app.jsx`:

```jsx
const renderScreen = () => {
  switch (screen) {
    case "today":    return <TodayScreen {...ctx}/>;
    case "memory":   return <MemoryScreen {...ctx}/>;
    case "people":   return <PeopleScreen {...ctx}/>;
    case "reviews":  return <ReviewsScreen/>;
    case "settings": return <SettingsScreen/>;
    default:         return <TodayScreen {...ctx}/>;
  }
};
```

### Step 5 — Back-compat deep links

Old links like `#goals` should land on `memory` with the `goals` tab pre-selected. Wire URL hash parsing:

```jsx
// In app.jsx useEffect:
React.useEffect(() => {
  const hash = window.location.hash.slice(1) || "today";
  const remap = {
    goals:      ["memory", "goals"],
    reminders:  ["memory", "reminders"],
    loops:      ["memory", "loops"],
    promises:   ["memory", "promises"],
    decisions:  ["memory", "decisions"],
    family:     ["people", "family"],
    approvals:  ["people", "approvals"],
  };
  const target = remap[hash] || [hash, null];
  setScreen(target[0]);
  if (target[1]) window.localStorage.setItem(`hanu-tab-${target[0]}`, target[1]);
}, []);
```

`MemoryScreen` and `PeopleScreen` read the initial tab from localStorage on mount, then drive state from there.

### Step 6 — Remove obsolete `data.jsx` nav entries

The pre-existing `nav` array had 12 entries with `group` partitioning. After step 1 it has 5. Strip out the old.

---

## Verification

Visit each tab on each screen; confirm content matches what the previous separate screen showed. Test deep links:

- `https://${HANU_HOST}/#goals` → Memory screen, Goals tab active.
- `https://${HANU_HOST}/#approvals` → People screen, Approvals tab active.

Search the codebase for `screen === "goals"`, `screen === "reminders"`, etc. — they should all be obsolete:

```bash
grep -n "screen === \"goals\"\|screen === \"reminders\"\|screen === \"loops\"\|screen === \"promises\"\|screen === \"decisions\"\|screen === \"family\"\|screen === \"approvals\"" hanu-v1/project/*.jsx
# Expected: zero matches
```

---

## Rollback

Restore the previous `data.jsx` nav array and the per-screen `switch` cases. The original screen components don't need changes; only `app.jsx`'s router does.

---

## Files touched

- `hanu-v1/project/data.jsx` (nav array)
- `hanu-v1/project/app.jsx` (router, deep-link remap)
- `hanu-v1/project/screens-b.jsx` (MemoryScreen, PeopleScreen wrappers)
- `hanu-v1/project/shared.jsx` (`TabStrip`)
- `hanu-v1/project/styles.css` (`.tab-strip`, `.tab`)

---

## Notes

- The decision to fold Approvals under People is debatable — Approvals is also a Today-screen surface. Decide based on user feedback; the IA is reversible.
- An "All" tab on the Memory screen unifies the timeline. Optional but useful; if you skip it, drop the `<UnifiedTimeline/>` component.
- After this task, the 12-screen design from the original mock is no longer the production target. Note this in `BRIDGE_DESIGN.md` so future contributors don't assume the design files are the source of truth.
