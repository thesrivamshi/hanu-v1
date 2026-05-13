/* Screens B: Memory Vault, People & Access, Family Space, Approvals */

// ============================================================ MEMORY VAULT
function MemoryScreen({ openMemoryDetail }) {
  const [tab, setTab] = React.useState("all");
  const [view, setView] = React.useState("cards");
  const mems = HANU.memories;
  const filter = (m) => {
    if (tab === "all") return true;
    if (tab === "private") return m.privacy === "private";
    if (tab === "shared") return m.privacy === "shared-space" || m.privacy === "shared";
    if (tab === "sensitive") return m.privacy === "sensitive";
    if (tab === "ask") return m.privacy === "ask-share";
    return m.type === tab;
  };

  const privacyChip = (p) => {
    if (p === "private") return <Chip tone="violet dot">Private</Chip>;
    if (p === "shared-space") return <Chip tone="teal dot">Shared in space</Chip>;
    if (p === "ask-share") return <Chip tone="amber dot">Ask before sharing</Chip>;
    if (p === "shared") return <Chip tone="teal dot">Shared with person</Chip>;
    if (p === "sensitive") return <Chip tone="crit dot">Sensitive</Chip>;
    if (p === "never") return <Chip tone="crit dot">Never share</Chip>;
    return <Chip>Unset</Chip>;
  };

  return (
    <div className="col gap-16">
      <PageHead
        eyebrow="Memory vault"
        title="What Hanu <em>remembers about you</em>."
        sub="Every memory has a source, a privacy level, and an edit history. You can correct, archive, or forget anything."
        right={
          <React.Fragment>
            <button className="btn ghost"><Icon name="search" size={13}/> Search vault</button>
            <button className="btn primary"><Icon name="plus" size={14}/> Save a memory</button>
          </React.Fragment>
        }
      />

      <div className="grid-12">
        <div className="span-3"><div className="kpi"><div className="label">Saved memories</div><div className="value">{HANU.memories.length}</div></div></div>
        <div className="span-3"><div className="kpi"><div className="label">Sensitive</div><div className="value crit">{HANU.memories.filter(m => m.privacy === "sensitive").length}</div></div></div>
        <div className="span-3"><div className="kpi"><div className="label">Inbox suggestions</div><div className="value amber">{HANU.memoryInbox.length}</div>{HANU.memoryInbox.length > 0 && <div className="delta warn">Awaiting your review</div>}</div></div>
        <div className="span-3"><div className="kpi"><div className="label">Pinned</div><div className="value">{HANU.memories.filter(m => m.pinned).length}</div></div></div>
      </div>

      {/* Inbox preview */}
      <div className="surface" style={{ background: "linear-gradient(135deg, rgba(138,123,255,0.08), rgba(240,168,104,0.04))" }}>
        <div className="row-between">
          <h2 className="section-title">Memory inbox <span className="count">{HANU.memoryInbox.length} suggested</span></h2>
          <Tabs items={[{value:"cards",label:"Cards"},{value:"compact",label:"Compact"}]} value={view} onChange={setView}/>
        </div>
        <div className="col gap-12">
          {HANU.memoryInbox.map(m => (
            <div key={m.id} style={{ display: "grid", gridTemplateColumns: "auto 1fr auto", gap: 14, alignItems: "center", padding: "12px 4px", borderTop: "1px solid var(--hairline)" }}>
              <div className="brand-mark" style={{ width: 30, height: 30, fontSize: 17 }}>H</div>
              <div>
                <div className="text-serif" style={{ fontSize: 17, lineHeight: 1.35 }}>{m.text}</div>
                <div style={{ display: "flex", gap: 6, marginTop: 6, alignItems: "center" }}>
                  <Chip>Hanu suggests</Chip>
                  <span className="text-mono dim" style={{ fontSize: 11 }}>{Math.round(m.confidence*100)}% confidence</span>
                </div>
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                <button className="btn primary sm">Save</button>
                <button className="btn ghost sm">Edit & save</button>
                <button className="btn ghost sm">Skip</button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="filter-strip">
        <Tabs items={[
          { value: "all", label: "All" },
          { value: "preference", label: "Preferences" },
          { value: "routine", label: "Routines" },
          { value: "person", label: "People" },
          { value: "decision", label: "Decisions" },
          { value: "important-date", label: "Dates" },
          { value: "boundary", label: "Boundaries" },
        ]} value={tab} onChange={setTab}/>
        <div className="row gap-8">
          <Chip tone="violet dot">Private</Chip>
          <Chip tone="amber dot">Ask</Chip>
          <Chip tone="teal dot">Shared</Chip>
          <Chip tone="crit dot">Sensitive</Chip>
        </div>
      </div>

      <div className="grid-12">
        {mems.filter(filter).map(m => (
          <div key={m.id} className="span-6 mem-card" onClick={() => openMemoryDetail(m.id)}>
            <div className="quote">"{m.text}"</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
              <Chip dot>{m.type.replace("-", " ")}</Chip>
              {privacyChip(m.privacy)}
              {m.pinned && <Chip tone="amber">Pinned</Chip>}
            </div>
            <div className="row-between" style={{ borderTop: "1px solid var(--hairline)", paddingTop: 10 }}>
              <div className="src"><Icon name="sparkle" size={11}/> {m.source}</div>
              <div style={{ display: "flex", gap: 4 }}>
                <button className="icon-btn" title="Edit"><Icon name="edit" size={13}/></button>
                <button className="icon-btn" title="Show why"><Icon name="eye" size={13}/></button>
                <button className="icon-btn" title="Forget"><Icon name="trash" size={13}/></button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ============================================================ PEOPLE & ACCESS
function PeopleScreen({ openPersonDetail, openAddPerson }) {
  const [tab, setTab] = React.useState("all");
  const people = HANU.people;
  const filter = (p) => {
    if (tab === "all") return true;
    if (tab === "family") return p.spaces.some(s => s.includes("Family"));
    if (tab === "trusted") return p.profileStatus === "Trusted circle";
    if (tab === "managed") return p.profileStatus === "Managed family profile";
    if (tab === "external") return p.profileStatus === "External contact";
    return true;
  };

  return (
    <div className="col gap-16">
      <PageHead
        eyebrow="People & access"
        title="People are <em>profiles</em>, not contacts."
        sub="Each person has their own relationship to Hanu, their own permissions, their own notification tone, and their own boundaries."
        right={
          <React.Fragment>
            <button className="btn ghost"><Icon name="filter" size={13}/> Permissions matrix</button>
            <button className="btn primary" onClick={openAddPerson}><Icon name="plus" size={14}/> Add a person</button>
          </React.Fragment>
        }
      />

      <div className="filter-strip">
        <Tabs items={[
          { value: "all", label: `All (${people.length})` },
          { value: "family", label: "Family Space" },
          { value: "trusted", label: "Trusted circle" },
          { value: "managed", label: "Managed profiles" },
          { value: "external", label: "External" },
        ]} value={tab} onChange={setTab}/>
        <div className="row gap-8">
          <Chip tone="amber dot">Full Hanu user</Chip>
          <Chip tone="teal dot">Trusted circle</Chip>
          <Chip tone="violet dot">Managed</Chip>
          <Chip tone="ghost dot">External</Chip>
        </div>
      </div>

      <div className="grid-12">
        {people.filter(filter).map(p => (
          <div key={p.id} className="span-6 person-card" onClick={() => openPersonDetail(p.id)}>
            <div className="head">
              <Avatar initials={p.initials} tone={p.avatarTone} size="lg" />
              <div className="flex-1">
                <div className="name">{p.name}</div>
                <div className="rel">{p.relationship} · {p.profileStatus}</div>
              </div>
              <Chip tone={
                p.profileStatus === "Full Hanu user" ? "amber dot" :
                p.profileStatus === "Trusted circle" ? "teal dot" :
                p.profileStatus === "Managed family profile" ? "violet dot" : "ghost dot"
              }>
                {p.profileStatus.split(" ")[0]}
              </Chip>
            </div>

            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {p.spaces.map(s => <Chip key={s} tone={s.includes("Family") ? "amber" : s.includes("Hanu") ? "teal" : ""}>{s}</Chip>)}
            </div>

            <div>
              <div className="perm-row"><div className="k">Can ask</div><div className="v"></div><div className="v" style={{ textAlign: "right", maxWidth: "65%" }}>{p.canAsk}</div></div>
              <div className="perm-row"><div className="k">Can send</div><div className="v"></div><div className="v" style={{ textAlign: "right", maxWidth: "65%" }}>{p.canSend}</div></div>
              <div className="perm-row"><div className="k">Can see</div><div className="v"></div><div className="v" style={{ textAlign: "right", maxWidth: "65%" }}>{p.canSee}</div></div>
              <div className="perm-row"><div className="k">Approval</div><div className="v"></div><div className="v" style={{ textAlign: "right" }}>
                {p.approval === "Not required" ? <Chip tone="good">No approval</Chip> :
                 p.approval === "Auto-allow project topics" ? <Chip tone="teal">Auto for topics</Chip> :
                 p.approval === "Always ask" ? <Chip tone="crit">Always</Chip> :
                 <Chip tone="amber">{p.approval}</Chip>}
              </div></div>
              <div className="perm-row"><div className="k">Tone</div><div className="v"></div><div className="v" style={{ textAlign: "right" }}>{p.tone}</div></div>
              <div className="perm-row"><div className="k">Quiet hours</div><div className="v"></div><div className="v" style={{ textAlign: "right" }}>{p.quietHours}</div></div>
            </div>

            <div className="muted" style={{ fontSize: 12.5, fontStyle: "italic" }}>{p.note}</div>
          </div>
        ))}

        <div className="span-6 person-card" style={{ borderStyle: "dashed", justifyContent: "center", alignItems: "center", minHeight: 360 }} onClick={openAddPerson}>
          <div className="center" style={{ width: 44, height: 44, borderRadius: 12, background: "var(--surface-2)", border: "1px solid var(--hairline-2)" }}>
            <Icon name="plus" size={20}/>
          </div>
          <div className="text-serif" style={{ fontSize: 20, marginTop: 6 }}>Add a person to Hanu</div>
          <div className="muted" style={{ fontSize: 12.5, textAlign: "center", maxWidth: 280 }}>Invite as a full user, add as managed family, or save as external contact.</div>
        </div>
      </div>
    </div>
  );
}

// ============================================================ FAMILY SPACE
function FamilyScreen({ openPersonDetail }) {
  const fam = HANU.family;
  const members = fam.members.map(personById);

  return (
    <div className="col gap-16">
      <PageHead
        eyebrow="Family space"
        title={`<em>${fam.name}</em>.`}
        sub="Every person has their own private Hanu. The Family Space is shared — only family-relevant memory lives here. Private memory remains private."
        right={
          <React.Fragment>
            <button className="btn ghost">Member roles</button>
            <button className="btn primary"><Icon name="plus" size={14}/> Add to family</button>
          </React.Fragment>
        }
      />

      {/* Model explainer + family graph */}
      <div className="grid-12">
        <div className="span-5 surface">
          <div className="eyebrow">The model</div>
          <h2 className="section-title" style={{ margin: "6px 0 8px" }}>Private. Shared. Honored.</h2>
          <p className="muted" style={{ fontSize: 13.5, lineHeight: 1.55 }}>
            Each member has a <span className="bright">private Hanu</span>. Mother's journal stays with Mother. Your goals stay with you.
            What lives in the <span className="amber">Family Space</span> is the stuff your family genuinely shares — medication routines, shared appointments, important dates, household decisions.
            When someone in the family asks Hanu about you, Hanu doesn't open your private vault. It asks you first.
          </p>
          <div className="col gap-12 mt-16">
            <div style={{ display: "grid", gridTemplateColumns: "16px 1fr", gap: 10, alignItems: "flex-start" }}>
              <Chip tone="violet dot"> </Chip>
              <div style={{ fontSize: 13 }}><span className="bright">Private memory</span> · only the owner. Never crosses into the space without explicit approval.</div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "16px 1fr", gap: 10, alignItems: "flex-start" }}>
              <Chip tone="amber dot"> </Chip>
              <div style={{ fontSize: 13 }}><span className="bright">Shared memory</span> · family-relevant. Routines, appointments, dates, responsibilities, decisions.</div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "16px 1fr", gap: 10, alignItems: "flex-start" }}>
              <Chip tone="teal dot"> </Chip>
              <div style={{ fontSize: 13 }}><span className="bright">Permission-based status</span> · Mother can know you're free tonight, not what you're working on.</div>
            </div>
          </div>
        </div>

        <div className="span-7 surface">
          <div className="row-between">
            <h2 className="section-title">{fam.name || "Family Space"} · members</h2>
            <span className="text-mono dim" style={{ fontSize: 11 }}>{members.length} people · 1 space</span>
          </div>
          {members.length > 0 ? (
            <div className="family-graph">
              {members.map((m, i) => {
                if (!m) return null;
                const angle = (i / members.length) * 2 * Math.PI;
                const left = 50 + 36 * Math.cos(angle);
                const top = 50 + 32 * Math.sin(angle);
                return (
                  <div key={m.id} className="node" style={{ left: `${left}%`, top: `${top}%` }} onClick={() => openPersonDetail && openPersonDetail(m.id)}>
                    <Avatar initials={m.initials} tone={m.avatarTone} size="sm" /> {m.name}
                  </div>
                );
              })}
              <div className="node center" style={{ left: "50%", top: "50%" }}>
                <Icon name="hearth" size={14}/> {fam.name || "Family Space"}
              </div>
            </div>
          ) : (
            <div className="muted" style={{ padding: "40px 12px", fontSize: 14, textAlign: "center" }}>
              No family members added yet.<br/>
              Tell Hanu on WhatsApp — e.g. <em>"Add my mom, her name is Geeta, her WhatsApp is +91…"</em>
            </div>
          )}
        </div>
      </div>

      <div className="grid-12">
        <div className="span-6 surface">
          <div className="row-between">
            <h2 className="section-title">Shared family reminders</h2>
            <button className="btn ghost sm"><Icon name="plus" size={13}/> Add</button>
          </div>
          <div>
            {fam.sharedReminders.map(r => (
              <div className="list-row" key={r.id}>
                <div className="check"></div>
                <div>
                  <div className="title">{r.title}</div>
                  <div className="sub"><Chip dot>Owner: {r.owner}</Chip><span className="time-pill">{r.time}</span></div>
                </div>
                <div className="meta-right"><button className="btn ghost sm">Open</button></div>
              </div>
            ))}
          </div>
        </div>

        <div className="span-6 surface">
          <div className="row-between">
            <h2 className="section-title">Family responsibilities & routines</h2>
            <button className="btn ghost sm"><Icon name="plus" size={13}/> Add</button>
          </div>
          <div className="col gap-12">
            {fam.routines.map(r => (
              <div className="surface tight" key={r.id}>
                <div className="row-between">
                  <div>
                    <div className="text-serif" style={{ fontSize: 18 }}>{r.title}</div>
                    <div className="muted" style={{ fontSize: 12.5, marginTop: 2 }}>{r.cadence} · {r.owner}</div>
                  </div>
                  <Chip tone="amber dot">Recurring</Chip>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid-12">
        <div className="span-7 surface">
          <div className="row-between">
            <h2 className="section-title">Shared open loops</h2>
            <button className="btn ghost sm">All</button>
          </div>
          <div>
            {fam.sharedLoops.map(l => (
              <div className="list-row" key={l.id}>
                <div className="pulse"></div>
                <div>
                  <div className="title">{l.title}</div>
                  <div className="sub"><Chip dot>Owner: {l.owner}</Chip><Chip tone={l.state === "needs-action" ? "amber dot" : ""}>{l.state.replace("-"," ")}</Chip></div>
                </div>
                <div className="meta-right"><button className="btn ghost sm">Discuss</button><button className="btn ghost sm">Convert</button></div>
              </div>
            ))}
          </div>
        </div>

        <div className="span-5 surface">
          <div className="row-between">
            <h2 className="section-title">Upcoming together</h2>
          </div>
          <div className="col gap-12">
            {fam.appointments.map(a => (
              <div className="surface tight" key={a.id}>
                <div className="eyebrow">{a.when}</div>
                <div className="text-serif" style={{ fontSize: 19, margin: "4px 0 4px" }}>{a.title}</div>
                <div className="muted" style={{ fontSize: 12.5 }}>With {a.who}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================ APPROVAL QUEUE
function ApprovalScreen({ openApproval }) {
  const all = HANU.approvals;
  return (
    <div className="col gap-16">
      <PageHead
        eyebrow="Approval queue"
        title="People are <em>asking Hanu</em> about you."
        sub="Hanu never answers for you on sensitive topics. Approve once, set a rule, or reply with a limited answer."
        right={
          <React.Fragment>
            <button className="btn ghost">Approval rules</button>
            <button className="btn primary">Approve all routine</button>
          </React.Fragment>
        }
      />

      <div className="grid-12">
        <div className="span-3"><div className="kpi"><div className="label">Awaiting</div><div className="value amber">{all.length}</div></div></div>
        <div className="span-3"><div className="kpi"><div className="label">Auto-approved today</div><div className="value">—</div></div></div>
        <div className="span-3"><div className="kpi"><div className="label">Denied today</div><div className="value">—</div></div></div>
        <div className="span-3"><div className="kpi"><div className="label">Avg response</div><div className="value">—</div></div></div>
      </div>

      {all.length === 0 && (
        <div className="surface" style={{ textAlign: "center", padding: "40px 20px" }}>
          <div className="muted" style={{ fontSize: 14 }}>
            Nothing waiting for your approval.<br/>
            When someone messages Hanu about you, requests will appear here.
          </div>
        </div>
      )}

      <div className="col gap-16">
        {all.map(a => {
          const p = personById(a.from);
          return (
            <div key={a.id} className="surface" style={{ display: "grid", gridTemplateColumns: "auto 1fr auto", gap: 22, alignItems: "flex-start" }}>
              <Avatar initials={p.initials} tone={p.avatarTone} size="xl" />
              <div>
                <div className="row" style={{ alignItems: "center", gap: 10 }}>
                  <div className="text-serif" style={{ fontSize: 18 }}>{p.name}</div>
                  <Chip tone={p.profileStatus === "Trusted circle" ? "teal dot" : p.profileStatus === "Managed family profile" ? "violet dot" : "amber dot"}>{p.profileStatus}</Chip>
                  <Chip>via Hanu</Chip>
                </div>
                <div className="text-serif" style={{ fontSize: 22, lineHeight: 1.3, margin: "10px 0 8px" }}>{a.question}</div>
                <div className="muted" style={{ fontSize: 13 }}>{a.context}</div>
                <div className="mt-12" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <Chip tone="violet dot">Privacy: limited</Chip>
                  <Chip>Hanu's suggestion: <span className="amber">&nbsp;{a.suggested}</span></Chip>
                </div>
              </div>
              <div className="col gap-8" style={{ minWidth: 220 }}>
                <button className="btn primary" onClick={() => openApproval(a.id)}>Approve once <Icon name="check" size={14}/></button>
                <button className="btn">Reply with limited answer</button>
                <button className="btn ghost">Always allow this type</button>
                <button className="btn ghost">Ask me every time</button>
                <button className="btn danger">Deny</button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

Object.assign(window, { MemoryScreen, PeopleScreen, FamilyScreen, ApprovalScreen });
