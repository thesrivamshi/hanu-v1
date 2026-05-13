/* Modals: Quick Capture, Ask Hanu, Create Goal, Create Reminder, Add Person, Approval detail, Memory edit, Goal detail drawer */

// ============================================================ Quick Capture (Flow 5)
function QuickCaptureModal({ onClose }) {
  const [text, setText] = React.useState("");
  const [extracted, setExtracted] = React.useState(false);

  const items = [];

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal wide" onClick={e => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <div className="eyebrow">Quick capture</div>
            <h2>Dump it all. Hanu will sort.</h2>
            <p>Type, paste, or hit mic. Hanu extracts reminders, open loops, memories, and promises. You decide what's saved.</p>
          </div>
          <button className="icon-btn" onClick={onClose}><Icon name="x"/></button>
        </div>

        <div className="composer">
          <textarea value={text} onChange={e => setText(e.target.value)} style={{ minHeight: 110, fontSize: 16 }}/>
          <div className="actions">
            <div style={{ display: "flex", gap: 8 }}>
              <button className="icon-btn" title="Voice"><Icon name="mic"/></button>
              <button className="icon-btn" title="Tag"><Icon name="tag"/></button>
              <button className="icon-btn" title="People"><Icon name="people"/></button>
            </div>
            <button className="btn primary sm" onClick={() => setExtracted(true)}>Extract <Icon name="sparkle" size={13}/></button>
          </div>
        </div>

        {extracted && (
          <div className="mt-16">
            <div className="row-between mt-8">
              <h3 className="section-title" style={{ fontSize: 17 }}>Hanu found {items.length} things <span className="count">5</span></h3>
              <span className="text-mono dim" style={{ fontSize: 11 }}>Confirm what gets saved</span>
            </div>
            <div className="extracted">
              {items.map((it, i) => (
                <div className="ex-row" key={i}>
                  <span className="typ">{it.type}</span>
                  <span className="flex-1">{it.text}</span>
                  <span className="muted" style={{ fontSize: 12 }}>{it.attach}</span>
                  <button className="btn ghost sm">Edit</button>
                  <button className="btn primary sm">Save</button>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="modal-foot">
          <span className="muted text-mono" style={{ fontSize: 11 }}>Hanu won't save anything until you confirm.</span>
          <div className="row gap-8">
            <button className="btn ghost" onClick={onClose}>Cancel</button>
            <button className="btn primary" onClick={onClose}>Save all 5</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================ Ask Hanu
function AskHanuModal({ onClose }) {
  const [q, setQ] = React.useState("");
  const [answered, setAnswered] = React.useState(false);
  const examples = [
    "What did I tell Hanu yesterday?",
    "Show me everything tagged sensitive.",
    "What decisions have I logged this month?",
    "What's pending right now?",
  ];

  const submit = (text) => {
    setQ(text);
    setAnswered(true);
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal wide" onClick={e => e.stopPropagation()}>
        <div className="modal-head">
          <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
            <div className="brand-mark" style={{ width: 36, height: 36, fontSize: 22 }}>H</div>
            <div>
              <h2 style={{ margin: 0 }}>Ask Hanu</h2>
              <p>Anything you've ever told Hanu. Anything Hanu has ever seen.</p>
            </div>
          </div>
          <button className="icon-btn" onClick={onClose}><Icon name="x"/></button>
        </div>

        <div className="composer">
          <input
            className="input"
            autoFocus
            placeholder="Ask Hanu about your memory, decisions, people, goals…"
            value={q}
            onChange={e => setQ(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter" && q.trim()) submit(q); }}
            style={{ background: "transparent", border: 0, fontSize: 18, padding: "8px 0" }}
          />
        </div>

        {!answered && (
          <div className="mt-16">
            <div className="eyebrow">Try</div>
            <div className="col gap-8 mt-8">
              {examples.map(ex => (
                <div key={ex} className="list-row" onClick={() => submit(ex)} style={{ gridTemplateColumns: "auto 1fr auto" }}>
                  <Icon name="sparkle" size={14}/>
                  <div className="title text-serif" style={{ fontSize: 17 }}>"{ex}"</div>
                  <Icon name="arrow-right" size={14}/>
                </div>
              ))}
            </div>
          </div>
        )}

        {answered && (
          <div className="mt-16 col gap-16">
            <EmptyState
              icon="sparkle"
              title="Nothing here yet."
              body="Tell Hanu about something on WhatsApp — promises, decisions, reminders. Once there's memory to search, your answers will appear here with sources."
            />
          </div>
        )}

        <div className="modal-foot">
          <span className="muted text-mono" style={{ fontSize: 11 }}>Press Enter to ask · Esc to close</span>
          <div className="row gap-8">
            <button className="btn ghost" onClick={onClose}>Close</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================ Create Goal (Flow 1)
function CreateGoalModal({ onClose }) {
  const [commitment, setCommitment] = React.useState(4);
  const [priority, setPriority] = React.useState("non-negotiable");
  const [promiseTo, setPromiseTo] = React.useState("Self");
  const [title, setTitle] = React.useState("");

  // Build "Promise to" segment options dynamically from family-relation people.
  // Falls back to a Self-only option when there's nobody added yet.
  const familyPeople = (HANU.people || []).filter(p => p.id !== "self" && (p.spaces || []).some(s => s.includes("Family")));
  const promiseToOptions = ["Self", ...familyPeople.map(p => p.name.split(" (")[0])];

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal wide" onClick={e => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <div className="eyebrow">New goal</div>
            <h2>What are you committing to?</h2>
            <p>Hanu's behavior changes based on how serious you are. Choose carefully.</p>
          </div>
          <button className="icon-btn" onClick={onClose}><Icon name="x"/></button>
        </div>

        <div className="col gap-16">
          <div className="field">
            <label>The goal, in one sentence</label>
            <input className="input" value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Run 4× per week"/>
          </div>

          <div className="field">
            <label>Why does this matter</label>
            <textarea className="textarea" placeholder="Hanu will remind you of this on hard days. Be honest."/>
          </div>

          <div className="grid-12">
            <div className="span-6">
              <div className="field">
                <label>Priority</label>
                <Seg options={["normal", "important", "non-negotiable"]} value={priority} onChange={setPriority}/>
              </div>
            </div>
            <div className="span-6">
              <div className="field">
                <label>Promise to</label>
                <Seg options={promiseToOptions} value={promiseTo} onChange={setPromiseTo}/>
              </div>
            </div>
          </div>

          <div className="field">
            <label>Commitment strength</label>
            <Seg className="commitment" options={[
              { value: 0, label: "Just an idea" },
              { value: 1, label: "Planned" },
              { value: 2, label: "Committed" },
              { value: 3, label: "Promised to someone" },
              { value: 4, label: "Non-negotiable" },
            ]} value={commitment} onChange={setCommitment}/>
            <div className="muted" style={{ fontSize: 12.5, marginTop: 6 }}>
              {commitment === 4 && <span><span className="crit">Non-negotiable.</span> Hanu will be strict. Quiet hours don't override. Missed = recovery action required.</span>}
              {commitment === 3 && <span><span className="amber">Promised to {promiseTo}.</span> Misses are tracked against your promise history.</span>}
              {commitment === 2 && <span>Committed. Hanu will check in daily and follow up firmly.</span>}
              {commitment === 1 && <span>Planned. Hanu will surface it but won't push hard.</span>}
              {commitment === 0 && <span>Just an idea. Hanu remembers but doesn't nudge.</span>}
            </div>
          </div>

          <div className="field">
            <label>Daily action</label>
            <input className="input" placeholder="What you'll do each day, in one line."/>
          </div>

          <div className="grid-12">
            <div className="span-6">
              <div className="field">
                <label>Recovery rule (if missed)</label>
                <input className="input" placeholder="The smaller version you'll still do — to keep the streak alive."/>
              </div>
            </div>
            <div className="span-6">
              <div className="field">
                <label>Daily check-in time</label>
                <input className="input" placeholder="e.g. 21:00"/>
              </div>
            </div>
          </div>
        </div>

        <div className="modal-foot">
          <span className="muted text-mono" style={{ fontSize: 11 }}>Hanu will treat this as <span className="amber">{["idea","plan","commitment","promise","non-negotiable"][commitment]}</span>.</span>
          <div className="row gap-8">
            <button className="btn ghost" onClick={onClose}>Cancel</button>
            <button className="btn primary" onClick={onClose}>Commit to it</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================ Create Reminder (Flow 2)
function CreateReminderModal({ onClose }) {
  const [needsConfirm, setNeedsConfirm] = React.useState(true);
  const [followUp, setFollowUp] = React.useState(true);

  // Dynamic "Linked person" options from HANU.people (Self-only fallback when empty).
  const peopleNames = (HANU.people || []).filter(p => p.id !== "self").map(p => p.name.split(" (")[0]);
  const linkedPersonOptions = ["—", ...peopleNames];

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal wide" onClick={e => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <div className="eyebrow">New reminder</div>
            <h2>Set a reminder Hanu won't drop.</h2>
            <p>Confirmation + follow-up turns a reminder into a closed loop.</p>
          </div>
          <button className="icon-btn" onClick={onClose}><Icon name="x"/></button>
        </div>

        <div className="col gap-16">
          <div className="field">
            <label>Remind me to</label>
            <input className="input" placeholder="e.g. Call the doctor's office to confirm tomorrow's slot."/>
          </div>

          <div className="grid-12">
            <div className="span-4">
              <div className="field"><label>When</label><input className="input" placeholder="e.g. Today, 11:30"/></div>
            </div>
            <div className="span-4">
              <div className="field"><label>Recur</label>
                <Seg options={["Once", "Daily", "Weekly", "Monthly"]} value="Once" onChange={()=>{}}/>
              </div>
            </div>
            <div className="span-4">
              <div className="field"><label>Priority</label><Seg options={["normal","important","non-negotiable"]} value="important" onChange={()=>{}}/></div>
            </div>
          </div>

          <div className="grid-12">
            <div className="span-6">
              <div className="field"><label>Category</label><Seg options={["Family","Work","Health","Finance","Personal"]} value="Family" onChange={()=>{}}/></div>
            </div>
            <div className="span-6">
              <div className="field"><label>Linked person</label>
                <Seg options={linkedPersonOptions} value="—" onChange={()=>{}}/>
              </div>
            </div>
          </div>

          <div className="surface tight">
            <div className="row-between">
              <div>
                <div style={{ fontSize: 14 }}>Needs confirmation</div>
                <div className="muted" style={{ fontSize: 12.5 }}>Hanu will ask "Did you do this?" — if no answer, it re-pings once.</div>
              </div>
              <Switch on={needsConfirm} onClick={() => setNeedsConfirm(!needsConfirm)}/>
            </div>
            <div className="divider"></div>
            <div className="row-between">
              <div>
                <div style={{ fontSize: 14 }}>Follow-up rule</div>
                <div className="muted" style={{ fontSize: 12.5 }}>If not done by 14:00, mark as open loop and add to tomorrow's intent.</div>
              </div>
              <Switch on={followUp} onClick={() => setFollowUp(!followUp)}/>
            </div>
          </div>
        </div>

        <div className="modal-foot">
          <span className="muted text-mono" style={{ fontSize: 11 }}>Hanu will hold this until you close it honestly.</span>
          <div className="row gap-8">
            <button className="btn ghost" onClick={onClose}>Cancel</button>
            <button className="btn primary" onClick={onClose}>Set reminder</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================ Add Person (Flow 4)
function AddPersonModal({ onClose }) {
  const [profile, setProfile] = React.useState("managed");
  const [channel, setChannel] = React.useState("whatsapp");

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal wide" onClick={e => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <div className="eyebrow">Add a person</div>
            <h2>Add someone to your circle.</h2>
            <p>Managed profiles don't have their own Hanu — you set the tone, reminders flow through a channel they use.</p>
          </div>
          <button className="icon-btn" onClick={onClose}><Icon name="x"/></button>
        </div>

        <div className="col gap-16">
          <div className="grid-12">
            <div className="span-6"><div className="field"><label>Name</label><input className="input" placeholder="Full name"/></div></div>
            <div className="span-6"><div className="field"><label>Relationship</label><input className="input" placeholder="e.g. Mother, Father, Partner, Friend"/></div></div>
          </div>

          <div className="field">
            <label>Profile type</label>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8 }}>
              {[
                { v: "full", l: "Full Hanu user", s: "Has own private Hanu" },
                { v: "managed", l: "Managed family", s: "You set it up; lives on WhatsApp/SMS" },
                { v: "trusted", l: "Trusted circle", s: "Can ask Hanu about you" },
                { v: "external", l: "External contact", s: "No access; reference only" },
              ].map(o => (
                <div key={o.v} className={`surface tight ${profile === o.v ? "" : ""}`} style={{ cursor: "pointer", borderColor: profile === o.v ? "var(--amber)" : "var(--hairline)" }} onClick={() => setProfile(o.v)}>
                  <div style={{ fontSize: 13.5, fontWeight: 500 }}>{o.l}</div>
                  <div className="muted" style={{ fontSize: 11.5, marginTop: 4 }}>{o.s}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="field">
            <label>Reach them via</label>
            <Seg options={["whatsapp","sms","email","app"]} value={channel} onChange={setChannel}/>
            <div className="muted" style={{ fontSize: 12.5, marginTop: 6 }}>Pick the channel they actually check. Hanu will send confirmations there with the tone you set below.</div>
          </div>

          <div className="grid-12">
            <div className="span-6"><div className="field"><label>Tone</label><Seg options={["Direct","Warm","Gentle, repeat-friendly","Formal"]} value="Gentle, repeat-friendly" onChange={()=>{}}/></div></div>
            <div className="span-6"><div className="field"><label>Quiet hours</label><input className="input" defaultValue="21:00 → 07:00"/></div></div>
          </div>

          <div className="field">
            <label>What they can see / send / ask</label>
            <div className="surface tight">
              <div className="perm-row"><div className="k">Can ask Hanu about you</div><div></div><Switch on={false} onClick={()=>{}}/></div>
              <div className="perm-row"><div className="k">Can confirm reminders</div><div></div><Switch on={true} onClick={()=>{}}/></div>
              <div className="perm-row"><div className="k">Can see Family Space appointments</div><div></div><Switch on={true} onClick={()=>{}}/></div>
              <div className="perm-row"><div className="k">Can send you reminders</div><div></div><Switch on={false} onClick={()=>{}}/></div>
            </div>
          </div>
        </div>

        <div className="modal-foot">
          <span className="muted text-mono" style={{ fontSize: 11 }}>Hanu will send a soft intro message before any reminders.</span>
          <div className="row gap-8">
            <button className="btn ghost" onClick={onClose}>Cancel</button>
            <button className="btn primary" onClick={onClose}>Add to family</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================ Approval detail (Flow 3)
function ApprovalDetailModal({ id, onClose }) {
  // NOTE (out of scope): if HANU.approvals is empty this will throw — but the modal
  // is only opened from rows in the approvals queue, so it's defensive only.
  const a = HANU.approvals.find(x => x.id === id) || HANU.approvals[0];
  const p = personById(a.from);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal wide" onClick={e => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <div className="eyebrow">Approval · from {p.name.split(" (")[0]}</div>
            <h2>"{a.question}"</h2>
            <p>{a.context}</p>
          </div>
          <button className="icon-btn" onClick={onClose}><Icon name="x"/></button>
        </div>

        <div className="grid-12">
          <div className="span-7 col gap-12">
            <div className="surface tight">
              <div className="eyebrow">Reply with a limited answer</div>
              <textarea className="textarea mt-8" placeholder="Write a reply that answers the question without revealing more than you want to share."/>
              <div className="row gap-8 mt-8">
                <Chip dot>Doesn't reveal calendar</Chip>
                <Chip dot>Doesn't reveal what else is going on</Chip>
              </div>
            </div>
            <div className="surface tight">
              <div className="eyebrow">Or pick one</div>
              <div className="col gap-8 mt-8">
                <button className="btn ghost" style={{ justifyContent: "flex-start" }}>"Yes, free after 19:00." (limited)</button>
                <button className="btn ghost" style={{ justifyContent: "flex-start" }}>{`"I'll ask ${HANU.user.name} and get back to you." (defer)`}</button>
                <button className="btn ghost" style={{ justifyContent: "flex-start" }}>"Busy tomorrow." (vague no)</button>
              </div>
            </div>
          </div>
          <div className="span-5 col gap-12">
            <div className="surface tight">
              <div className="eyebrow">Why this is sensitive</div>
              <ul style={{ paddingLeft: 18, margin: "8px 0 0", fontSize: 13.5, color: "var(--ink-80)", lineHeight: 1.65 }}>
                <li>Calendar is a private memory — Mother has limited access.</li>
                <li>Default rule for {p.name.split(" (")[0]}: <span className="amber">Ask once per topic.</span></li>
                <li>You've shared dinner plans 4× this month — pattern looks fine.</li>
              </ul>
            </div>
            <div className="surface tight">
              <div className="eyebrow">Make this a rule?</div>
              <div className="col gap-8 mt-8">
                <button className="btn ghost" style={{ justifyContent: "flex-start" }}>Always allow Mother to ask about evening availability</button>
                <button className="btn ghost" style={{ justifyContent: "flex-start" }}>Never share exact times — only "free / not free"</button>
                <button className="btn ghost" style={{ justifyContent: "flex-start" }}>Always ask me first</button>
              </div>
            </div>
          </div>
        </div>

        <div className="modal-foot">
          <button className="btn danger">Deny</button>
          <div className="row gap-8">
            <button className="btn ghost" onClick={onClose}>Hold for now</button>
            <button className="btn primary" onClick={onClose}>Send reply</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================ Goal detail (Drawer)
function GoalDetailDrawer({ id, onClose }) {
  const g = HANU.goals.find(x => x.id === id) || HANU.goals[0];

  return (
    <React.Fragment>
      <div className="drawer-backdrop" onClick={onClose}></div>
      <aside className="drawer">
        <div className="row-between">
          <div>
            <div className="eyebrow">Goal</div>
            <h2 className="text-serif" style={{ fontSize: 30, margin: "6px 0 4px", letterSpacing: "-0.01em", fontWeight: 400 }}>{g.title}</h2>
            <div className="why muted" style={{ fontSize: 13, fontStyle: "italic", maxWidth: 360 }}>"{g.why}"</div>
          </div>
          <button className="icon-btn" onClick={onClose}><Icon name="x"/></button>
        </div>

        <div className="mt-16" style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <PriorityChip level={g.priority}/>
          <Chip dot>Promise to {g.promiseTo}</Chip>
          <Chip tone={g.risk === "low" ? "good dot" : g.risk === "medium" ? "amber dot" : "crit dot"}>Risk: {g.risk}</Chip>
        </div>

        <div className="surface tight mt-16">
          <div className="eyebrow">Streak — last 30 days</div>
          <div className="row-between mt-8">
            <div className="text-serif" style={{ fontSize: 40, lineHeight: 1 }}>{g.streak}<span className="dim" style={{ fontSize: 18 }}> days</span></div>
            <div className="muted" style={{ fontSize: 12.5, textAlign: "right" }}>{g.missed} missed this month<br/><Spark values={g.sparkline} /></div>
          </div>
          <div className="mt-12"><StreakBar data={g.sparkline.slice(-30)}/></div>
        </div>

        <div className="col gap-12 mt-16">
          <div>
            <div className="eyebrow">Daily action</div>
            <div className="mt-8" style={{ fontSize: 14 }}>{g.dailyAction}</div>
          </div>
          <div>
            <div className="eyebrow">Recovery rule</div>
            <div className="mt-8" style={{ fontSize: 14 }}>{g.recovery}</div>
          </div>
          <div>
            <div className="eyebrow">Next check-in</div>
            <div className="mt-8" style={{ fontSize: 14 }}>{g.nextCheckIn}</div>
          </div>
        </div>

        <div className="divider"></div>

        <div className="col gap-8">
          <div className="eyebrow">Activity</div>
          <div className="muted" style={{ fontSize: 12.5 }}>Yesterday · ✓ Done, on time</div>
          <div className="muted" style={{ fontSize: 12.5 }}>Mon May 10 · ✓ Done, late by 12 min — Hanu re-pinged once</div>
          <div className="muted" style={{ fontSize: 12.5 }}>Sun May 9 · ✗ Missed — reason: <span className="amber">tired</span> · recovery used</div>
        </div>

        <div className="col gap-8 mt-16">
          <button className="btn primary"><Icon name="check" size={14}/> Mark today done</button>
          <button className="btn">Edit goal</button>
          <button className="btn ghost">Soften — drop to "Important"</button>
          <button className="btn danger">Drop honestly</button>
        </div>
      </aside>
    </React.Fragment>
  );
}

// ============================================================ Memory edit (Flow 7)
function MemoryDetailModal({ id, onClose }) {
  const m = HANU.memories.find(x => x.id === id) || HANU.memories[0];
  const [privacy, setPrivacy] = React.useState(m.privacy);
  const opts = [
    { value: "private", label: "Private" },
    { value: "ask-share", label: "Ask before sharing" },
    { value: "shared", label: "Shared with person" },
    { value: "shared-space", label: "Shared in space" },
    { value: "sensitive", label: "Sensitive" },
    { value: "never", label: "Never share" },
  ];

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <div className="eyebrow">Memory · {m.type.replace("-", " ")}</div>
            <h2 style={{ fontSize: 22, fontFamily: "var(--font-serif)" }}>"{m.text}"</h2>
            <p>From: {m.source}</p>
          </div>
          <button className="icon-btn" onClick={onClose}><Icon name="x"/></button>
        </div>

        <div className="col gap-16">
          <div className="field">
            <label>Correct the memory</label>
            <textarea className="textarea" defaultValue={m.text}/>
          </div>

          <div className="field">
            <label>Privacy level</label>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 8 }}>
              {opts.map(o => (
                <div key={o.value} className="surface tight" style={{ cursor: "pointer", borderColor: privacy === o.value ? "var(--amber)" : "var(--hairline)", padding: "10px 14px" }} onClick={() => setPrivacy(o.value)}>
                  <div style={{ fontSize: 13 }}>{o.label}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="surface tight">
            <div className="eyebrow">What will change</div>
            <div className="muted mt-8" style={{ fontSize: 13, lineHeight: 1.5 }}>
              {privacy === "private" && "Only you. Hanu will not surface this in any shared context — even if asked."}
              {privacy === "ask-share" && "Hanu will ask you every time someone's question would touch this memory."}
              {privacy === "shared" && "Visible to the person you select. Not anyone else."}
              {privacy === "shared-space" && "Visible to members of the space you select. Family Space, Project Space, etc."}
              {privacy === "sensitive" && "Treated as protected. Requires explicit confirmation to save or share."}
              {privacy === "never" && "Hanu will refuse any share request that touches this. Cannot be relaxed without re-confirming."}
            </div>
          </div>
        </div>

        <div className="modal-foot">
          <button className="btn danger">Forget memory</button>
          <div className="row gap-8">
            <button className="btn ghost" onClick={onClose}>Cancel</button>
            <button className="btn primary" onClick={onClose}>Save changes</button>
          </div>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, {
  QuickCaptureModal, AskHanuModal, CreateGoalModal, CreateReminderModal,
  AddPersonModal, ApprovalDetailModal, GoalDetailDrawer, MemoryDetailModal
});
