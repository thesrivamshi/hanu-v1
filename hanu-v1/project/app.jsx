/* Main app shell — sidebar, topbar, screen router, modal dispatcher */

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "tone": "firm",
  "mood": "amber",
  "ambient": "soft"
}/*EDITMODE-END*/;

function Sidebar({ active, onChange }) {
  const groups = [
    { id: "core",       label: "Today" },
    { id: "knowledge",  label: "Memory" },
    { id: "relational", label: "People" },
    { id: "system",     label: "System" },
  ];

  return (
    <aside className="sidebar">
      <div className="brand-row">
        <div className="brand-mark">H</div>
        <div>
          <div className="brand-name">Hanu</div>
          <div className="brand-sub">Personal OS · v1</div>
        </div>
      </div>

      <div className="profile-chip">
        <Avatar initials={HANU.user.avatar || "H"} />
        <div className="flex-1" style={{ lineHeight: 1.25 }}>
          <div className="label">{HANU.user.name}</div>
          <div className="sub">Private profile</div>
        </div>
        <Icon name="chevron-down" size={14}/>
      </div>

      {groups.map(g => (
        <div key={g.id}>
          <div className="nav-section-label">{g.label}</div>
          <div className="nav">
            {HANU.nav.filter(n => n.group === g.id).map(n => (
              <div
                key={n.id}
                className={`nav-item ${active === n.id ? "active" : ""}`}
                onClick={() => onChange(n.id)}
              >
                <span className="icon"><Icon name={n.icon} size={16}/></span>
                <span className="label-txt">{n.label}</span>
                {n.count != null && <span className={`count ${n.alert ? "alert" : ""}`}>{n.count}</span>}
              </div>
            ))}
          </div>
        </div>
      ))}

      <div className="sidebar-footer">
        <div className="mode-pill">
          <span className="dot"></span>
          <span className="mode-txt">Calm mode · until 22:00</span>
        </div>
        <div className="mode-pill" style={{ background: "transparent" }}>
          <Icon name="moon" size={13}/>
          <span className="mode-txt">Quiet hours start 22:00</span>
        </div>
      </div>
    </aside>
  );
}

function Topbar({ openCapture, openAsk, theme, toggleTheme }) {
  return (
    <div className="topbar">
      <div className="search-input" onClick={openAsk}>
        <Icon name="search" size={14}/>
        <input placeholder='Ask Hanu about anything you have told it' readOnly/>
        <span className="kbd">⌘K</span>
      </div>
      <button className="theme-toggle" onClick={toggleTheme} title={theme === "dark" ? "Switch to light" : "Switch to dark"}>
        <Icon name={theme === "dark" ? "sun" : "moon"} size={15}/>
      </button>
      <button className="topbtn" onClick={openCapture}>
        <Icon name="plus" size={14}/> Quick capture
      </button>
      <button className="topbtn primary" onClick={openAsk}>
        <Icon name="sparkle" size={14}/> Ask Hanu
      </button>
    </div>
  );
}

function LoginScreen() {
  const [email, setEmail] = React.useState("");
  const [sending, setSending] = React.useState(false);
  const [sent, setSent] = React.useState(false);
  const [error, setError] = React.useState(null);

  const submit = async (e) => {
    if (e && e.preventDefault) e.preventDefault();
    const trimmed = email.trim();
    if (!trimmed) return;
    setSending(true);
    setError(null);
    try {
      const result = await window.hanu.sendMagicLink(trimmed);
      if (result && result.ok) {
        setSent(true);
      } else {
        const msg = (result && result.error) || "Could not send the magic link.";
        setError(msg);
      }
    } catch (err) {
      console.error("[hanu] magic-link request failed", err);
      setError(err.message || String(err));
    } finally {
      setSending(false);
    }
  };

  return (
    <React.Fragment>
      <Ambient/>
      <div className="login">
        <div className="login-card surface">
          <div className="login-brand">
            <div className="brand-mark">H</div>
            <div>
              <div className="brand-name">Hanu</div>
              <div className="brand-sub">Personal OS · v1</div>
            </div>
          </div>

          {sent ? (
            <div className="login-body">
              <div className="eyebrow">Check your email</div>
              <h2 className="login-title">A magic link is on the way.</h2>
              <p className="muted">
                We sent a sign-in link to <strong>{email.trim()}</strong>. Open it on this device
                to finish signing in. You can close this tab once you click the link.
              </p>
              <button
                className="btn ghost"
                onClick={() => { setSent(false); setEmail(""); }}
                style={{ marginTop: 16 }}
              >
                Use a different email
              </button>
            </div>
          ) : (
            <form className="login-body" onSubmit={submit}>
              <div className="eyebrow">Sign in</div>
              <h2 className="login-title">Welcome back.</h2>
              <p className="muted">Enter your email and we'll send you a one-time link.</p>

              <div className="field" style={{ marginTop: 18 }}>
                <label htmlFor="login-email">Email</label>
                <input
                  id="login-email"
                  className="input"
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  required
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={sending}
                  autoFocus
                />
              </div>

              {error && (
                <div className="login-error" role="alert">{error}</div>
              )}

              <button
                type="submit"
                className="btn primary lg w-full"
                style={{ marginTop: 18 }}
                disabled={sending || !email.trim()}
              >
                {sending ? "Sending link..." : "Send magic link"}
              </button>

              <p className="login-foot muted">
                No passwords. The link expires after one use.
              </p>
            </form>
          )}
        </div>
      </div>
    </React.Fragment>
  );
}

function App() {
  const [screen, setScreen] = React.useState("today");
  const [modal, setModal] = React.useState(null); // { kind, payload }
  const [theme, setTheme] = React.useState(() => localStorage.getItem("hanu-theme") || "dark");
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);
  // Bumped whenever live data refreshes — forces a re-render so screens see updated HANU.
  const [dataVersion, setDataVersion] = React.useState(0);
  const [loadError, setLoadError] = React.useState(null);
  const [needsAuth, setNeedsAuth] = React.useState(false);

  // Wire up live data on mount.
  React.useEffect(() => {
    let unsubscribe = null;
    let mounted = true;

    (async () => {
      try {
        await window.hanuLoad();
        if (!mounted) return;
        setNeedsAuth(false);
        setDataVersion(v => v + 1);
        unsubscribe = window.hanuSubscribe(() => {
          if (mounted) setDataVersion(v => v + 1);
        });
      } catch (e) {
        if (e && e.message === "AUTH_REQUIRED") {
          // Not an error — just means the user isn't signed in yet.
          if (mounted) setNeedsAuth(true);
          return;
        }
        console.error("[hanu] initial load failed", e);
        if (mounted) setLoadError(e.message || String(e));
      }
    })();

    return () => {
      mounted = false;
      if (typeof unsubscribe === "function") unsubscribe();
    };
  }, []);

  React.useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("hanu-theme", theme);
  }, [theme]);

  React.useEffect(() => {
    document.documentElement.setAttribute("data-mood", t.mood);
    document.documentElement.setAttribute("data-ambient", t.ambient);
    document.documentElement.setAttribute("data-tone", t.tone);
  }, [t.mood, t.ambient, t.tone]);

  const toggleTheme = () => setTheme(prev => prev === "dark" ? "light" : "dark");

  const open  = (kind, payload = null) => setModal({ kind, payload });
  const close = () => setModal(null);

  const goto = (id) => {
    setScreen(id);
    document.querySelector(".canvas")?.scrollTo({ top: 0 });
  };

  // helpers passed down
  const ctx = {
    openCapture: () => open("capture"),
    openAsk: () => open("ask"),
    openCreate: () => open("create-goal"),
    openCreateReminder: () => open("create-reminder"),
    openAddPerson: () => open("add-person"),
    openApproval: (id) => open("approval", id),
    openGoalDetail: (id) => open("goal-detail", id),
    openMemoryDetail: (id) => open("memory-detail", id),
    openPersonDetail: (id) => open("person-detail", id),
    tone: t.tone,
  };

  const renderScreen = () => {
    switch (screen) {
      case "today":     return <TodayScreen {...ctx}/>;
      case "goals":     return <GoalsScreen {...ctx}/>;
      case "reminders": return <RemindersScreen openCreate={ctx.openCreateReminder}/>;
      case "loops":     return <LoopsScreen/>;
      case "memory":    return <MemoryScreen openMemoryDetail={ctx.openMemoryDetail}/>;
      case "people":    return <PeopleScreen {...ctx}/>;
      case "family":    return <FamilyScreen {...ctx}/>;
      case "approvals": return <ApprovalScreen openApproval={ctx.openApproval}/>;
      case "promises":  return <PromisesScreen/>;
      case "decisions": return <DecisionsScreen/>;
      case "reviews":   return <ReviewsScreen/>;
      case "settings":  return <SettingsScreen/>;
      default:          return <TodayScreen {...ctx}/>;
    }
  };

  React.useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); open("ask"); }
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (needsAuth) {
    return <LoginScreen/>;
  }

  return (
    <React.Fragment>
      <Ambient/>
      <div className="app">
        <Sidebar active={screen} onChange={goto}/>
        <div className="main">
          <Topbar openCapture={ctx.openCapture} openAsk={ctx.openAsk} theme={theme} toggleTheme={toggleTheme}/>
          <div className="canvas">{renderScreen()}</div>
        </div>
      </div>

      {modal?.kind === "capture"        && <QuickCaptureModal onClose={close}/>}
      {modal?.kind === "ask"            && <AskHanuModal onClose={close}/>}
      {modal?.kind === "create-goal"    && <CreateGoalModal onClose={close}/>}
      {modal?.kind === "create-reminder" && <CreateReminderModal onClose={close}/>}
      {modal?.kind === "add-person"     && <AddPersonModal onClose={close}/>}
      {modal?.kind === "approval"       && <ApprovalDetailModal id={modal.payload} onClose={close}/>}
      {modal?.kind === "goal-detail"    && <GoalDetailDrawer id={modal.payload} onClose={close}/>}
      {modal?.kind === "memory-detail"  && <MemoryDetailModal id={modal.payload} onClose={close}/>}

      <TweaksPanel title="Tweaks">
        <TweakSection label="Hanu's voice"/>
        <TweakRadio
          label="Tone"
          value={t.tone}
          options={[
            { value: "calm",   label: "Calm" },
            { value: "firm",   label: "Firm" },
            { value: "strict", label: "Strict" },
          ]}
          onChange={(v) => setTweak("tone", v)}
        />

        <TweakSection label="Visual mood"/>
        <TweakRadio
          label="Palette"
          value={t.mood}
          options={[
            { value: "amber",     label: "Amber" },
            { value: "nightfall", label: "Night" },
            { value: "sage",      label: "Sage" },
          ]}
          onChange={(v) => setTweak("mood", v)}
        />

        <TweakSection label="Atmosphere"/>
        <TweakRadio
          label="Ambient layer"
          value={t.ambient}
          options={[
            { value: "off",   label: "Off" },
            { value: "soft",  label: "Soft" },
            { value: "vivid", label: "Vivid" },
          ]}
          onChange={(v) => setTweak("ambient", v)}
        />
      </TweaksPanel>
    </React.Fragment>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App/>);
