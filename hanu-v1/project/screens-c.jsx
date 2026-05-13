/* Screens C: Promises, Decisions, Reviews, Settings */

// ============================================================ PROMISES
function PromisesScreen() {
  const [tab, setTab] = React.useState("active");
  const p = HANU.promises;
  const filter = (x) => tab === "active" ? x.status !== "kept" : tab === "kept" ? x.status === "kept" : tab === "broken" ? x.broken > 0 : true;

  return (
    <div className="col gap-16">
      <PageHead
        eyebrow="Promises"
        title="A promise is <em>not a reminder</em>."
        sub="Promises live separately. They have a person attached. Breaking one costs Hanu's trust meter — both for you and them."
        right={<button className="btn primary"><Icon name="plus" size={14}/> Make a promise</button>}
      />

      <div className="grid-12">
        <div className="span-3"><div className="kpi"><div className="label">Active</div><div className="value">{p.filter(x => x.status === "in-progress" || x.status === "pending" || x.status === "scheduled").length}</div></div></div>
        <div className="span-3"><div className="kpi"><div className="label">Kept</div><div className="value good">{p.reduce((s, x) => s + (x.kept || 0), 0)}</div></div></div>
        <div className="span-3"><div className="kpi"><div className="label">Broken</div><div className="value crit">{p.reduce((s, x) => s + (x.broken || 0), 0)}</div></div></div>
        <div className="span-3"><div className="kpi"><div className="label">Total</div><div className="value">{p.length}</div></div></div>
      </div>

      <div className="filter-strip">
        <Tabs items={[
          { value: "active", label: "Active" },
          { value: "kept", label: "Kept" },
          { value: "broken", label: "Broken" },
          { value: "all", label: "All" },
        ]} value={tab} onChange={setTab}/>
      </div>

      {p.length === 0 && (
        <div className="surface">
          <EmptyState
            icon="ring"
            body={`No promises yet. Tell Hanu "I promised X to ..." on WhatsApp.`}
          />
        </div>
      )}

      <div className="col gap-12">
        {p.filter(filter).map(pr => {
          const rate = Math.round((pr.kept / Math.max(1, pr.kept + pr.broken)) * 100);
          return (
            <div key={pr.id} className="surface" style={{ display: "grid", gridTemplateColumns: "auto 1fr auto", gap: 22, alignItems: "center" }}>
              <div className="center" style={{ width: 56, height: 56, borderRadius: "50%", border: "1.5px solid var(--hairline-2)", background: "var(--surface-2)" }}>
                <Icon name="ring" size={22}/>
              </div>
              <div>
                <div className="text-mono dim" style={{ fontSize: 11, letterSpacing: ".14em", textTransform: "uppercase" }}>Promised to {pr.to}</div>
                <div className="text-serif" style={{ fontSize: 22, margin: "4px 0 8px", letterSpacing: "-0.005em" }}>"{pr.text}"</div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                  <Chip dot><Icon name="calendar" size={11}/> Due {pr.due}</Chip>
                  <Chip tone={pr.status === "in-progress" ? "amber dot" : pr.status === "scheduled" ? "teal dot" : ""}>{pr.status.replace("-"," ")}</Chip>
                  <Chip>Follow-up: {pr.followUp}</Chip>
                </div>
              </div>
              <div style={{ minWidth: 200, textAlign: "right" }}>
                <div className="text-mono dim" style={{ fontSize: 11, letterSpacing: ".14em", textTransform: "uppercase" }}>Kept rate</div>
                <div className="text-serif" style={{ fontSize: 28, lineHeight: 1.1 }}>{rate}%</div>
                <div className="muted" style={{ fontSize: 12 }}>{pr.kept} kept · {pr.broken} broken</div>
                <div style={{ display: "flex", gap: 6, marginTop: 10, justifyContent: "flex-end" }}>
                  <button className="btn ghost sm">→ Reminder</button>
                  <button className="btn primary sm">Mark kept</button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ============================================================ DECISION LOG
function DecisionsScreen() {
  const [area, setArea] = React.useState("all");
  const d = HANU.decisions;
  const filter = (x) => area === "all" || x.area.toLowerCase().includes(area);

  return (
    <div className="col gap-16">
      <PageHead
        eyebrow="Decision log"
        title="The decisions that <em>still hold</em>."
        sub="Not a notes app. Hanu remembers what you decided, why, what it depends on, and when to revisit it."
        right={<button className="btn primary"><Icon name="plus" size={14}/> Log a decision</button>}
      />

      <div className="filter-strip">
        <Tabs items={[
          { value: "all", label: "All areas" },
          { value: "hanu", label: "Hanu (product)" },
          { value: "family", label: "Family" },
          { value: "personal", label: "Personal" },
        ]} value={area} onChange={setArea}/>
        <div className="row gap-8">
          <Chip>By date</Chip>
          <Chip>By area</Chip>
          <Chip tone="amber">Up for revisit</Chip>
        </div>
      </div>

      {d.length === 0 && (
        <div className="surface">
          <EmptyState
            icon="book"
            body={`No decisions logged yet. Tell Hanu "I decided to ..." on WhatsApp.`}
          />
        </div>
      )}

      <div className="col gap-12">
        {d.filter(filter).map(x => (
          <div key={x.id} className="decision-card">
            <div className="row-between" style={{ alignItems: "flex-start" }}>
              <div className="flex-1">
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <Chip dot tone="amber">{x.area}</Chip>
                  <span className="text-mono dim" style={{ fontSize: 11 }}>{x.date}</span>
                  {x.tags.map(t => <Chip key={t} tone="ghost">#{t}</Chip>)}
                </div>
                <div className="text-serif" style={{ fontSize: 26, letterSpacing: "-0.01em", margin: "10px 0 8px" }}>{x.title}</div>
                <div style={{ fontSize: 14, lineHeight: 1.6, color: "var(--ink-80)", maxWidth: 720 }}>
                  <span className="dim text-mono" style={{ fontSize: 11, letterSpacing: ".14em", textTransform: "uppercase" }}>Why · </span>
                  {x.why}
                </div>
                <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                  <Chip dot><Icon name="clock" size={11}/> Revisit: {x.revisit}</Chip>
                  {x.related.length > 0 && <Chip dot><Icon name="people" size={11}/> Related: {x.related.join(", ")}</Chip>}
                </div>
              </div>
              <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                <button className="icon-btn"><Icon name="edit"/></button>
                <button className="icon-btn"><Icon name="more"/></button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ============================================================ REVIEWS
function ReviewsScreen({ openMissReview }) {
  const r = HANU.reviews;
  const [reviewModal, setReviewModal] = React.useState(false);

  return (
    <div className="col gap-16">
      <PageHead
        eyebrow="Reviews"
        title="Three check-ins. <em>One honest week.</em>"
        sub="Morning sets the intent. Midday adjusts. Evening tells the truth. Weekly review names the pattern."
        right={<button className="btn primary">Start evening review <Icon name="arrow-right" size={14}/></button>}
      />

      {/* Three check-ins today */}
      <div className="grid-12">
        {[
          { key: "morning", label: "Morning plan", time: "07:00", state: r.today.morning },
          { key: "midday", label: "Midday check-in", time: "13:30", state: r.today.midday },
          { key: "evening", label: "Evening review", time: "21:30", state: r.today.evening },
        ].map(c => (
          <div className="span-4 surface" key={c.key} style={c.state.done ? {} : { borderColor: "rgba(240,168,104,0.3)" }}>
            <div className="row-between">
              <div className="eyebrow">{c.label}</div>
              {c.state.done ? <Chip tone="good dot">Done · {c.time}</Chip> : <Chip tone="amber dot">Pending · {c.time}</Chip>}
            </div>
            <div className="text-serif" style={{ fontSize: 18, lineHeight: 1.4, margin: "10px 0 0" }}>
              {c.state.note || <span className="muted" style={{ fontStyle: "italic" }}>Mark this slot done when you've reflected. Hanu can prompt you on WhatsApp.</span>}
            </div>
            <div className="mt-16">
              {c.state.done ? <button className="btn ghost sm">Re-open</button> : <button className="btn primary sm" onClick={() => setReviewModal(true)}>Start now</button>}
            </div>
          </div>
        ))}
      </div>

      {/* Weekly review summary — only shown once we have enough data */}
      <div className="surface">
        <div className="row-between">
          <h2 className="section-title">Weekly review</h2>
          <Chip tone="ghost">Builds up over time</Chip>
        </div>
        <div className="muted mt-12" style={{ fontSize: 14 }}>
          Hanu generates a weekly summary once you've recorded at least a week of daily reviews and goal completions.
          Use the three check-ins above each day; the rollup will appear here next Sunday.
        </div>
      </div>

      {/* Missed pattern */}
      <div className="surface" style={r.weeklyMisses.length === 0 ? { display: "none" } : {}}>
        <div className="row-between">
          <h2 className="section-title">Missed this week <span className="count">{r.weeklyMisses.length}</span></h2>
          <span className="muted text-mono" style={{ fontSize: 11 }}>Tell Hanu the real reason — it changes how you're nudged.</span>
        </div>
        <div className="col gap-12">
          {r.weeklyMisses.map((m, i) => (
            <div key={i} className="surface tight" style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 18, alignItems: "center" }}>
              <div>
                <div className="text-serif" style={{ fontSize: 19 }}>{m.goal}</div>
                <div className="muted" style={{ fontSize: 12.5, marginTop: 2 }}>Missed {m.missed}× this week</div>
                <div className="mt-12">
                  <div className="eyebrow" style={{ marginBottom: 8 }}>Why was it missed?</div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {r.failureReasons.map(f => (
                      <Chip key={f} tone={f === m.reason ? "amber dot" : "ghost"} className={f === m.reason ? "" : ""}>{f}</Chip>
                    ))}
                  </div>
                </div>
                <div className="mt-12">
                  <span className="text-mono dim" style={{ fontSize: 11, letterSpacing: ".14em", textTransform: "uppercase" }}>Hanu suggests · </span>
                  <span className="amber">{m.suggestion}</span>
                </div>
              </div>
              <div className="col gap-8">
                <button className="btn primary sm">Accept suggestion</button>
                <button className="btn ghost sm">Edit goal</button>
                <button className="btn ghost sm">Drop honestly</button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {reviewModal && (
        <div className="modal-backdrop" onClick={() => setReviewModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-head">
              <div>
                <div className="eyebrow">Evening review</div>
                <h2>What's the truth about today?</h2>
                <p>Three short questions. Be honest — Hanu doesn't judge, just adapts.</p>
              </div>
              <button className="icon-btn" onClick={() => setReviewModal(false)}><Icon name="x"/></button>
            </div>
            <div className="col gap-16">
              <div className="field">
                <label>Did you do the non-negotiable?</label>
                <Seg options={["Yes, clean", "Yes, late", "No"]} value="Yes, clean" onChange={() => {}} />
              </div>
              <div className="field">
                <label>What slipped, and why?</label>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {r.failureReasons.map(f => <Chip key={f} tone={f === "tired" ? "amber dot" : "ghost"}>{f}</Chip>)}
                </div>
              </div>
              <div className="field">
                <label>One thing for tomorrow's morning version</label>
                <textarea className="textarea" placeholder="Tomorrow morning, do the…" />
              </div>
            </div>
            <div className="modal-foot">
              <span className="muted text-mono" style={{ fontSize: 11 }}>Auto-saves to Memory Vault · private</span>
              <div className="row gap-8"><button className="btn ghost" onClick={() => setReviewModal(false)}>Skip</button><button className="btn primary" onClick={() => setReviewModal(false)}>Save review</button></div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================ SETTINGS
function SettingsScreen() {
  const s = HANU.settings;
  const [pause, setPause] = React.useState(s.activePause);
  const [askSave, setAskSave] = React.useState(s.askBeforeSaving);
  const [askShare, setAskShare] = React.useState(s.askBeforeSharing);
  const [intensity, setIntensity] = React.useState(s.followUpIntensity);
  const [strictness, setStrictness] = React.useState(s.accountability);
  const [channels, setChannels] = React.useState(s.channels);

  return (
    <div className="col gap-16">
      <PageHead
        eyebrow="Settings & permissions"
        title="How Hanu <em>behaves with you</em>."
        sub="Defaults are firm but not cold. You can soften, sharpen, or pause anywhere."
      />

      {/* Pause modes */}
      <div className="surface">
        <div className="row-between">
          <div>
            <h2 className="section-title">Pause modes</h2>
            <div className="muted" style={{ fontSize: 13 }}>One tap. Reminders soften, follow-ups stop, only non-negotiables stay loud.</div>
          </div>
          {pause ? <Chip tone="amber dot">{pause} active</Chip> : <Chip tone="good dot">All systems calm</Chip>}
        </div>
        <div className="mt-16" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Chip tone={pause === "" ? "amber dot" : "ghost"} className="cursor" onClick={() => setPause("")}>Normal</Chip>
          {s.pauseModes.map(m => (
            <button key={m} className={`btn ${pause === m ? "primary" : "ghost"} sm`} onClick={() => setPause(pause === m ? "" : m)}>{m}</button>
          ))}
        </div>
      </div>

      <div className="grid-12">
        <div className="span-6 surface">
          <h2 className="section-title">Memory behavior</h2>
          <div className="col gap-12">
            <div className="row-between" style={{ alignItems: "center" }}>
              <div>
                <div style={{ fontSize: 14 }}>Ask before saving anything</div>
                <div className="muted" style={{ fontSize: 12.5 }}>Hanu will confirm before adding to your vault.</div>
              </div>
              <Switch on={askSave} onClick={() => setAskSave(!askSave)} />
            </div>
            <div className="divider"></div>
            <div className="row-between" style={{ alignItems: "center" }}>
              <div>
                <div style={{ fontSize: 14 }}>Ask before sharing with anyone</div>
                <div className="muted" style={{ fontSize: 12.5 }}>Even with people on auto-allow. You stay in the loop.</div>
              </div>
              <Switch on={askShare} onClick={() => setAskShare(!askShare)} />
            </div>
            <div className="divider"></div>
            <div>
              <div style={{ fontSize: 14, marginBottom: 8 }}>Auto-suggest memories from chats</div>
              <Seg options={["Off", "Subtle", "Active"]} value="Subtle" onChange={() => {}} />
            </div>
          </div>
        </div>

        <div className="span-6 surface">
          <h2 className="section-title">Accountability</h2>
          <div className="col gap-16">
            <div>
              <div className="eyebrow" style={{ marginBottom: 8 }}>Follow-up intensity</div>
              <Seg options={["Light", "Steady", "Firm", "Strict"]} value={intensity} onChange={setIntensity}/>
              <div className="muted mt-8" style={{ fontSize: 12.5 }}>Firm: Hanu re-pings missed non-negotiables once. Asks why. Doesn't nag.</div>
            </div>
            <div>
              <div className="eyebrow" style={{ marginBottom: 8 }}>Strictness for non-negotiables</div>
              <Seg options={["Gentle", "Steady", "Strict", "Unforgiving"]} value={strictness} onChange={setStrictness}/>
            </div>
            <div>
              <div className="eyebrow" style={{ marginBottom: 8 }}>Quiet hours</div>
              <div className="row gap-8" style={{ alignItems: "center" }}>
                <input className="input" defaultValue={s.quietHours.start} style={{ maxWidth: 100 }}/>
                <span className="dim">→</span>
                <input className="input" defaultValue={s.quietHours.end} style={{ maxWidth: 100 }}/>
                <span className="muted" style={{ fontSize: 12.5 }}>Only Family-critical breaks through.</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="grid-12">
        <div className="span-7 surface">
          <h2 className="section-title">Sensitive categories</h2>
          <div className="muted" style={{ fontSize: 13, maxWidth: 560 }}>These categories require explicit confirmation before saving or sharing. Hanu treats them with extra caution by default.</div>
          <div className="mt-16">
            <table className="matrix">
              <thead><tr><th>Category</th><th>Save</th><th>Share</th><th>Behavior</th></tr></thead>
              <tbody>
                {s.sensitive.map(cat => (
                  <tr key={cat}>
                    <td>{cat}</td>
                    <td><Chip tone="amber dot">Always ask</Chip></td>
                    <td><Chip tone="crit dot">Never auto</Chip></td>
                    <td className="muted">{cat === "Passwords / secrets" ? "Refuse always — Hanu won't store secrets." : cat === "Health" ? "Sensitive — only the user reads." : "Confirm per share."}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="span-5 surface">
          <h2 className="section-title">Notification channels</h2>
          <div className="col gap-12">
            {Object.keys(channels).map(c => (
              <div className="row-between" key={c}>
                <div>
                  <div style={{ fontSize: 14, textTransform: "capitalize" }}>{c}</div>
                  <div className="muted" style={{ fontSize: 12.5 }}>{c === "whatsapp" ? "Used for managed-profile confirmations." : c === "app" ? "In-app only." : c === "email" ? "Daily digest." : "SMS for non-negotiables only."}</div>
                </div>
                <Switch on={channels[c]} onClick={() => setChannels({ ...channels, [c]: !channels[c] })}/>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="surface">
        <div className="row-between">
          <h2 className="section-title">Connected people · per-person access</h2>
          <button className="btn ghost sm">Edit on People & Access →</button>
        </div>
        <table className="matrix">
          <thead><tr><th>Person</th><th>Status</th><th>Can ask</th><th>Can send</th><th>Approval</th><th>Tone</th></tr></thead>
          <tbody>
            {HANU.people.filter(p => p.id !== "self").map(p => (
              <tr key={p.id}>
                <td><div style={{ display: "flex", alignItems: "center", gap: 10 }}><Avatar initials={p.initials} tone={p.avatarTone} size="sm"/> {p.name}</div></td>
                <td className="muted">{p.profileStatus}</td>
                <td className="muted">{p.canAsk.length > 32 ? p.canAsk.slice(0, 32) + "…" : p.canAsk}</td>
                <td className="muted">{p.canSend.length > 32 ? p.canSend.slice(0, 32) + "…" : p.canSend}</td>
                <td><Chip tone={p.approval === "Not required" ? "good" : p.approval === "Always ask" ? "crit" : "amber"}>{p.approval}</Chip></td>
                <td className="muted">{p.tone}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

Object.assign(window, { PromisesScreen, DecisionsScreen, ReviewsScreen, SettingsScreen });
