/* Screens A: Today, Goals, Reminders, Open Loops */

// ============================================================ TODAY
function TodayScreen({ openCapture, openAsk, openGoalDetail, openApproval, openCreate, tone = "firm" }) {
  const goals = HANU.goals;
  const nonneg = goals.find(g => g.priority === "non-negotiable");
  const reminders = HANU.reminders.slice(0, 4);
  const approvals = HANU.approvals.slice(0, 2);
  const loops = HANU.loops.filter(l => l.state === "needs-action" || l.state === "overdue").slice(0, 4);
  const inbox = HANU.memoryInbox.slice(0, 2);
  const copy = TONE_COPY[tone] || TONE_COPY.firm;

  // Deep-empty: no data at all anywhere. We hide the "Suggest" card in this state
  // because its buttons are decorative (no real onClick) and would be misleading.
  const deepEmpty =
    HANU.people.length === 0 &&
    HANU.memories.length === 0 &&
    HANU.goals.length === 0 &&
    HANU.reminders.length === 0 &&
    HANU.loops.length === 0 &&
    HANU.promises.length === 0 &&
    HANU.decisions.length === 0;

  const now = new Date();
  const hour = now.getHours();
  const part = hour < 5 ? "Still up" : hour < 12 ? "Morning" : hour < 17 ? "Afternoon" : hour < 21 ? "Evening" : "Late evening";
  const timeStr = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const today = now.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const totalWaiting = reminders.length + approvals.length + loops.length;

  return (
    <div className="col gap-24">
      {/* Hero / non-negotiable */}
      <div className="hero-card">
        <div className="eyebrow">{part}, {today}</div>
        <h1 className="hello">
          {part}, <em>{HANU.user.first}.</em><br/>
          <span dangerouslySetInnerHTML={{ __html: copy.helloLine2 }}/>
        </h1>
        <div className="time-strip">
          <span>{timeStr}</span>
          <span className="dot"></span>
          <span>{totalWaiting === 0 ? "Nothing waiting yet" : totalWaiting === 1 ? "1 thing waiting on you" : `${totalWaiting} things waiting on you`}</span>
          <span className="dot"></span>
          <span className="tone-pill"><span className="dot"></span>{copy.badgeTone}</span>
        </div>

        {nonneg ? (
          <div className="nonneg">
            <div className="pulse crit" style={{ marginTop: 6 }}></div>
            <div className="flex-1">
              <div className="stamp">{copy.nonnegStamp}</div>
              <h3>{nonneg.title}</h3>
              <p>{nonneg.why || copy.nonnegBody}</p>
              <div className="meta">
                <Chip tone="crit dot">{nonneg.priority}</Chip>
                {nonneg.nextCheckIn && <Chip dot>{String(nonneg.nextCheckIn).slice(11, 16) || nonneg.nextCheckIn}</Chip>}
                {nonneg.promiseTo && nonneg.promiseTo !== "Self" && <Chip>Promised to {nonneg.promiseTo}</Chip>}
                {typeof nonneg.streak === "number" && <Chip tone="amber">Streak: {nonneg.streak} days</Chip>}
              </div>
            </div>
            <button className="btn primary" onClick={() => openGoalDetail(nonneg.id)}>Open</button>
          </div>
        ) : (
          <div className="nonneg" style={{ opacity: 0.85 }}>
            <div className="flex-1">
              <div className="stamp">{copy.nonnegStamp}</div>
              <h3>Nothing pinned yet.</h3>
              <p>{copy.nonnegBody}</p>
              <div className="meta">
                <Chip>WhatsApp Hanu to set today's anchor</Chip>
              </div>
            </div>
          </div>
        )}

        {!deepEmpty && (
          <div className="suggest">
            <div className="badge">H</div>
            <div className="flex-1">
              <div className="who">{copy.suggestionWho}</div>
              <div className="msg">{copy.suggestionMsg}</div>
              <div className="actions">
                <button className="btn primary sm">{copy.suggestPrimary}</button>
                <button className="btn ghost sm">{copy.suggestSecondary}</button>
                <button className="btn ghost sm">{copy.suggestThird}</button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Composer + Ask Hanu */}
      <div className="grid-12">
        <div className="span-8">
          <div className="composer">
            <div className="eyebrow" style={{ marginBottom: 8 }}>Quick capture</div>
            <textarea placeholder="Dump anything. Hanu will sort it into reminders, open loops, memories, or promises…" onFocus={(e) => e.target.rows = 3}></textarea>
            <div className="actions">
              <div style={{ display: "flex", gap: 8 }}>
                <button className="icon-btn" title="Voice"><Icon name="mic"/></button>
                <button className="icon-btn" title="Tag"><Icon name="tag"/></button>
                <button className="icon-btn" title="People"><Icon name="people"/></button>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button className="btn ghost sm" onClick={openCapture}>Open composer</button>
                <button className="btn primary sm" onClick={openCapture}>Capture <Icon name="arrow-right" size={14}/></button>
              </div>
            </div>
          </div>
        </div>
        <div className="span-4">
          <div className="composer" style={{ height: "100%" }}>
            <div className="eyebrow" style={{ marginBottom: 8 }}>Ask Hanu</div>
            <div style={{ display: "flex", gap: 10, alignItems: "center" }} onClick={openAsk}>
              <div className="brand-mark" style={{ width: 28, height: 28, fontSize: 17 }}>H</div>
              <div className="muted" style={{ fontSize: 13.5, cursor: "text" }}>"What did I tell Hanu yesterday?"</div>
            </div>
            <div className="actions" style={{ marginTop: 18 }}>
              <span className="text-mono dim" style={{ fontSize: 11 }}>Ctrl + K</span>
              <button className="btn primary sm" onClick={openAsk}>Ask <Icon name="sparkle" size={13}/></button>
            </div>
          </div>
        </div>
      </div>

      {/* Stack: priorities */}
      <div className="grid-12">
        {/* Time-sensitive */}
        <div className="span-7 surface">
          <div className="row-between mt-8">
            <h2 className="section-title">Time-sensitive <span className="count">today</span></h2>
            <button className="btn ghost sm">View all</button>
          </div>
          <div style={{ display: "flex", flexDirection: "column" }}>
            {reminders.length === 0 ? (
              <EmptyState
                icon="clock"
                body={`Nothing scheduled. Tell Hanu "remind me to ..." on WhatsApp.`}
              />
            ) : reminders.map(r => (
              <div className="list-row" key={r.id}>
                <div className="check"></div>
                <div>
                  <div className="title">{r.title}</div>
                  <div className="sub">
                    <Chip>{r.category}</Chip>
                    {r.person && <Chip dot>For {r.person}</Chip>}
                    {r.priority === "non-negotiable" && <Chip tone="crit dot">Non-negotiable</Chip>}
                    {r.needsConfirm && <Chip tone="amber">Needs confirm</Chip>}
                    {r.recurs !== "—" && <Chip tone="ghost">↻ {r.recurs}</Chip>}
                  </div>
                </div>
                <div className="meta-right">
                  <span className="time-pill"><Icon name="clock" size={11}/> {r.time}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Approvals */}
        <div className="span-5 surface">
          <div className="row-between mt-8">
            <h2 className="section-title">Pending confirmations <span className="count">{HANU.approvals.length}</span></h2>
            <button className="btn ghost sm">Open queue</button>
          </div>
          <div className="col gap-12">
            {approvals.length === 0 && (
              <EmptyState
                icon="shield"
                body="No approvals pending. Family members will appear here when they ask Hanu something."
              />
            )}
            {approvals.map(a => {
              const p = personById(a.from);
              return (
                <div className="approval" key={a.id}>
                  <div className="header">
                    <Avatar initials={p.initials} tone={p.avatarTone} size="" />
                    <div className="flex-1">
                      <div className="text-mono dim" style={{ fontSize: 11, letterSpacing: ".14em", textTransform: "uppercase" }}>{p.name.split(" (")[0]} · asked Hanu</div>
                      <div className="ask">{a.question}</div>
                    </div>
                  </div>
                  <div className="why">{a.context}</div>
                  <div className="controls">
                    <button className="btn primary sm" onClick={() => openApproval(a.id)}>{a.suggested}</button>
                    <button className="btn ghost sm">Deny</button>
                    <button className="btn ghost sm">Always allow</button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="grid-12">
        {/* Open loops */}
        <div className="span-7 surface">
          <div className="row-between">
            <h2 className="section-title">Open loops <span className="count">{loops.length} need you</span></h2>
            <button className="btn ghost sm">All loops</button>
          </div>
          <div style={{ display: "flex", flexDirection: "column" }}>
            {loops.length === 0 ? (
              <EmptyState
                icon="loop"
                body="No open loops. As you tell Hanu about unfinished things, they'll appear here."
              />
            ) : loops.map(l => (
              <div className="list-row" key={l.id}>
                <div className={`pulse ${l.state === "overdue" ? "crit" : ""}`}></div>
                <div>
                  <div className="title">{l.title}</div>
                  <div className="sub">
                    <Chip>Owner: {l.owner}</Chip>
                    {l.state === "overdue" && <Chip tone="crit dot">Overdue · {l.age}d</Chip>}
                    {l.state === "needs-action" && <Chip tone="amber dot">Needs action</Chip>}
                    {l.postponed >= 3 && <Chip tone="warn">Postponed {l.postponed}×</Chip>}
                  </div>
                </div>
                <div className="meta-right">
                  <button className="btn ghost sm">Convert</button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Memory inbox */}
        <div className="span-5 surface">
          <div className="row-between">
            <h2 className="section-title">Memory inbox <span className="count">{HANU.memoryInbox.length}</span></h2>
            <button className="btn ghost sm">Vault</button>
          </div>
          <div className="col gap-12">
            {inbox.length === 0 && (
              <EmptyState
                icon="vault"
                body="Nothing to review. Hanu proposes memories here when it notices something worth keeping."
              />
            )}
            {inbox.map(m => (
              <div className="mem-card" key={m.id}>
                <div className="quote">"{m.text}"</div>
                <div className="row-between">
                  <div className="src"><Icon name="sparkle" size={11}/> Suggested · {Math.round(m.confidence*100)}% match</div>
                  <div style={{ display: "flex", gap: 6 }}>
                    <button className="btn primary sm">Save</button>
                    <button className="btn ghost sm">Edit</button>
                    <button className="btn ghost sm">Discard</button>
                  </div>
                </div>
              </div>
            ))}
            {HANU.memoryInbox.length > 0 && (
              <button className="btn ghost" style={{ alignSelf: "flex-start" }}>Open all {HANU.memoryInbox.length} suggestions</button>
            )}
          </div>
        </div>
      </div>

      {/* What should I do now */}
      <div className="surface" style={{ background: "linear-gradient(135deg, rgba(240,168,104,0.06), rgba(138,123,255,0.04))" }}>
        <div className="row-between">
          <div>
            <div className="eyebrow">{copy.nowEyebrow}</div>
            <h2 className="section-title" style={{ margin: "8px 0 6px" }}>{copy.nowTitle}</h2>
            <p className="muted" style={{ fontSize: 13.5, maxWidth: 720 }}>{copy.nowBody}</p>
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <button className="btn ghost">{copy.nowSecondary}</button>
            <button className="btn primary lg">{copy.nowPrimary} <Icon name="arrow-right" size={14}/></button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================ GOALS
function GoalsScreen({ openGoalDetail, openCreate }) {
  const [tab, setTab] = React.useState("active");
  const goals = HANU.goals;

  return (
    <div className="col gap-16">
      <PageHead
        eyebrow="Goals"
        title="What you've <em>committed</em> to."
        sub="Each goal carries a commitment level. The deeper the commitment, the firmer Hanu becomes."
        right={
          <React.Fragment>
            <Tabs items={[
              { value: "active", label: "Active" },
              { value: "paused", label: "Paused" },
              { value: "completed", label: "Completed" },
              { value: "archive", label: "Archive" },
            ]} value={tab} onChange={setTab}/>
            <button className="btn primary" onClick={openCreate}><Icon name="plus" size={14}/> New goal</button>
          </React.Fragment>
        }
      />

      <div className="grid-12">
        <div className="span-3"><div className="kpi"><div className="label">Active goals</div><div className="value">{goals.length}</div></div></div>
        <div className="span-3"><div className="kpi"><div className="label">Non-negotiable</div><div className="value">{goals.filter(g => g.priority === "non-negotiable").length}</div></div></div>
        <div className="span-3"><div className="kpi"><div className="label">At-risk</div><div className="value amber">{goals.filter(g => g.risk === "medium" || g.risk === "high").length}</div></div></div>
        <div className="span-3"><div className="kpi"><div className="label">Best streak</div><div className="value">{goals.reduce((m, g) => Math.max(m, g.streak || 0), 0)} d</div></div></div>
      </div>

      {goals.length === 0 && (
        <div className="surface">
          <EmptyState
            icon="target"
            body={`No goals yet. Tell Hanu "set a goal to ..." on WhatsApp.`}
          />
        </div>
      )}

      <div className="filter-strip">
        <div className="row gap-8">
          <Chip tone="amber dot">Non-negotiable</Chip>
          <Chip tone="ghost dot">Important</Chip>
          <Chip tone="ghost">Normal</Chip>
        </div>
        <div className="row gap-8">
          <button className="btn ghost sm"><Icon name="filter" size={13}/> Filter</button>
          <button className="btn ghost sm">Sort by risk</button>
        </div>
      </div>

      <div className="grid-12">
        {goals.map(g => (
          <div key={g.id} className={`span-6 goal-card ${g.priority === "non-negotiable" ? "nonneg-card" : ""}`} onClick={() => openGoalDetail(g.id)}>
            <div className="head">
              <div>
                <PriorityChip level={g.priority} />
                <div className="title" style={{ marginTop: 8 }}>{g.title}</div>
                <div className="why">"{g.why}"</div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div className="text-mono dim" style={{ fontSize: 11 }}>STREAK</div>
                <div className="text-serif" style={{ fontSize: 32, lineHeight: 1 }}>{g.streak}<span className="dim" style={{ fontSize: 16 }}>d</span></div>
              </div>
            </div>

            <StreakBar data={g.sparkline.slice(-30)} />

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
              <div>
                <div className="text-mono dim" style={{ fontSize: 10, letterSpacing: ".14em", textTransform: "uppercase" }}>Promise to</div>
                <div style={{ fontSize: 13, marginTop: 3 }}>{g.promiseTo}</div>
              </div>
              <div>
                <div className="text-mono dim" style={{ fontSize: 10, letterSpacing: ".14em", textTransform: "uppercase" }}>Risk</div>
                <div style={{ fontSize: 13, marginTop: 3 }} className={g.risk === "low" ? "" : g.risk === "medium" ? "amber" : "crit"}>{g.risk.toUpperCase()}</div>
              </div>
              <div>
                <div className="text-mono dim" style={{ fontSize: 10, letterSpacing: ".14em", textTransform: "uppercase" }}>Next</div>
                <div style={{ fontSize: 13, marginTop: 3 }}>{g.nextCheckIn}</div>
              </div>
            </div>

            <div style={{ borderTop: "1px solid var(--hairline)", paddingTop: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>
              <Chip dot><Icon name="wave" size={11}/> {g.dailyAction.length > 38 ? g.dailyAction.slice(0, 38) + "…" : g.dailyAction}</Chip>
              {g.missed > 0 && <Chip tone="warn">Missed {g.missed}× this month</Chip>}
            </div>
          </div>
        ))}

        <div className="span-6 goal-card" style={{ borderStyle: "dashed", justifyContent: "center", alignItems: "center", minHeight: 220, cursor: "pointer" }} onClick={openCreate}>
          <div className="center" style={{ width: 44, height: 44, borderRadius: 12, background: "var(--surface-2)", border: "1px solid var(--hairline-2)" }}>
            <Icon name="plus" size={20}/>
          </div>
          <div className="text-serif" style={{ fontSize: 20, marginTop: 6 }}>Commit to something new</div>
          <div className="muted" style={{ fontSize: 12.5, textAlign: "center", maxWidth: 280 }}>Hanu will set commitment strength, daily action, and recovery rules with you.</div>
        </div>
      </div>
    </div>
  );
}

// ============================================================ REMINDERS
function RemindersScreen({ openCreate }) {
  const [tab, setTab] = React.useState("today");
  const all = HANU.reminders;
  const today = all.filter(r => r.when === "Today");
  const upcoming = all.filter(r => r.when !== "Today");
  const missed = HANU.remindersMissed;
  const confirms = all.filter(r => r.needsConfirm);

  const list = tab === "today" ? today : tab === "upcoming" ? upcoming : tab === "missed" ? missed : tab === "confirm" ? confirms : tab === "family" ? all.filter(r => r.category === "Family") : all;

  return (
    <div className="col gap-16">
      <PageHead
        eyebrow="Reminders"
        title="Things Hanu is <em>holding for you.</em>"
        sub="Every reminder has a category, priority, follow-up rule, and recipient — not just a time."
        right={
          <React.Fragment>
            <button className="btn ghost"><Icon name="filter" size={13}/> Filter</button>
            <button className="btn primary" onClick={openCreate}><Icon name="plus" size={14}/> New reminder</button>
          </React.Fragment>
        }
      />

      <div className="grid-12">
        <div className="span-3"><div className="kpi"><div className="label">Today</div><div className="value">{today.length}</div><div className="delta">1 non-negotiable</div></div></div>
        <div className="span-3"><div className="kpi"><div className="label">Awaiting confirm</div><div className="value amber">{confirms.length}</div><div className="delta warn">Hanu will re-ping</div></div></div>
        <div className="span-3"><div className="kpi"><div className="label">Missed (7d)</div><div className="value crit">2</div><div className="delta crit">Below your bar</div></div></div>
        <div className="span-3"><div className="kpi"><div className="label">Family-linked</div><div className="value">{HANU.goals.filter(g => g.family_critical).length}</div><div className="delta">{(() => {
          const familyRelations = ["mother","father","sister","brother","son","daughter","spouse","wife","husband","partner","parent","sibling","child"];
          const familyNames = (HANU.people || [])
            .filter(p => p.id !== "self" && p.relationship && familyRelations.includes(String(p.relationship).toLowerCase()))
            .map(p => p.name.split(" ")[0]);
          return familyNames.length ? familyNames.slice(0, 3).join(" · ") : "—";
        })()}</div></div></div>
      </div>

      <div className="filter-strip">
        <Tabs items={[
          { value: "today", label: `Today (${today.length})` },
          { value: "upcoming", label: `Upcoming (${upcoming.length})` },
          { value: "confirm", label: `Needs confirm (${confirms.length})` },
          { value: "missed", label: `Missed (${missed.length})` },
          { value: "family", label: "Family" },
          { value: "recurring", label: "Recurring" },
        ]} value={tab} onChange={setTab}/>
      </div>

      <div className="surface flush">
        <div style={{ padding: "16px 22px", borderBottom: "1px solid var(--hairline)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div className="text-serif" style={{ fontSize: 20 }}>
            {tab === "today" ? `Today · ${new Date().toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}` : tab === "upcoming" ? "Upcoming" : tab === "missed" ? "Missed" : tab === "confirm" ? "Awaiting confirmation" : tab === "family" ? "Family reminders" : "Recurring"}
          </div>
          <span className="text-mono dim" style={{ fontSize: 11 }}>{list.length} items</span>
        </div>
        <div>
          {list.length === 0 && (
            <EmptyState
              icon="bell"
              body={`No reminders yet. Tell Hanu "remind me to ..." on WhatsApp.`}
            />
          )}
          {list.map(r => (
            <div className="list-row" key={r.id} style={{ borderRadius: 0 }}>
              <div className="check"></div>
              <div>
                <div className="title">{r.title}</div>
                <div className="sub">
                  <Chip dot>{r.category}</Chip>
                  {r.priority && <PriorityChip level={r.priority} />}
                  {r.recurs && r.recurs !== "—" && <Chip tone="ghost">↻ {r.recurs}</Chip>}
                  {r.needsConfirm && <Chip tone="amber dot">Needs confirm</Chip>}
                  {r.followUp && <Chip>Follow-up: {r.followUp}</Chip>}
                  {r.reason !== undefined && <Chip tone="warn">Tell Hanu why</Chip>}
                </div>
              </div>
              <div className="meta-right" style={{ alignItems: "center" }}>
                <span className="time-pill"><Icon name="clock" size={11}/> {r.time}</span>
                <button className="btn ghost sm">Snooze</button>
                <button className="btn ghost sm">Done</button>
                <button className="icon-btn"><Icon name="more"/></button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ============================================================ OPEN LOOPS
function LoopsScreen() {
  const [tab, setTab] = React.useState("all");
  const loops = HANU.loops;
  const filter = (l) => {
    if (tab === "needs") return l.state === "needs-action";
    if (tab === "waiting") return l.state === "waiting";
    if (tab === "overdue") return l.state === "overdue";
    if (tab === "stuck") return l.postponed >= 3;
    return true;
  };
  const filtered = loops.filter(filter);

  return (
    <div className="col gap-16">
      <PageHead
        eyebrow="Open loops"
        title="The things <em>still hanging</em>."
        sub="Raw captured responsibilities. Convert into reminders, goals, or promises — or close them honestly."
        right={
          <React.Fragment>
            <button className="btn ghost"><Icon name="filter" size={13}/> Filter</button>
            <button className="btn primary"><Icon name="plus" size={14}/> Capture loop</button>
          </React.Fragment>
        }
      />

      <div className="grid-12">
        <div className="span-3"><div className="kpi"><div className="label">Needs your action</div><div className="value">{loops.filter(l => l.state === "needs-action").length}</div></div></div>
        <div className="span-3"><div className="kpi"><div className="label">Waiting on others</div><div className="value violet">{loops.filter(l => l.state === "waiting").length}</div></div></div>
        <div className="span-3"><div className="kpi"><div className="label">Overdue</div><div className="value crit">{loops.filter(l => l.state === "overdue").length}</div><div className="delta crit">Hanu will escalate</div></div></div>
        <div className="span-3"><div className="kpi"><div className="label">Postponed 3+×</div><div className="value amber">{loops.filter(l => l.postponed >= 3).length}</div><div className="delta warn">Maybe drop?</div></div></div>
      </div>

      <div className="filter-strip">
        <Tabs items={[
          { value: "all", label: `All (${loops.length})` },
          { value: "needs", label: "Needs my action" },
          { value: "waiting", label: "Waiting on someone" },
          { value: "overdue", label: "Overdue" },
          { value: "stuck", label: "Repeatedly postponed" },
        ]} value={tab} onChange={setTab}/>
      </div>

      <div className="col gap-12">
        {filtered.length === 0 && (
          <div className="surface">
            <EmptyState
              icon="loop"
              body="No open loops yet. Hanu captures unfinished items from your conversations."
            />
          </div>
        )}
        {filtered.map(l => (
          <div className="surface tight" key={l.id} style={{ display: "grid", gridTemplateColumns: "auto 1fr auto", gap: 18, alignItems: "center" }}>
            <div className={`pulse ${l.state === "overdue" ? "crit" : l.state === "waiting" ? "" : ""}`}></div>
            <div>
              <div className="text-serif" style={{ fontSize: 19 }}>{l.title}</div>
              <div className="sub" style={{ marginTop: 6, display: "flex", flexWrap: "wrap", gap: 6 }}>
                <Chip dot>Owner: {l.owner}</Chip>
                {l.state === "overdue" && <Chip tone="crit dot">Overdue · {l.age}d open</Chip>}
                {l.state === "needs-action" && <Chip tone="amber dot">Needs action</Chip>}
                {l.state === "waiting" && <Chip tone="violet dot">Waiting · {l.age}d</Chip>}
                {l.postponed > 0 && <Chip tone={l.postponed >= 3 ? "warn" : ""}>Postponed {l.postponed}×</Chip>}
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <button className="btn ghost sm">→ Reminder</button>
              <button className="btn ghost sm">→ Goal</button>
              <button className="btn ghost sm">→ Promise</button>
              <button className="btn primary sm">Convert</button>
              <button className="icon-btn"><Icon name="x"/></button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

Object.assign(window, { TodayScreen, GoalsScreen, RemindersScreen, LoopsScreen });
