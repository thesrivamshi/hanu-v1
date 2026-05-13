/* Shared components: icons, chips, list rows, primitives */

const Icon = ({ name, size = 16 }) => {
  const s = size;
  const stroke = "currentColor";
  const sw = 1.5;
  const common = { width: s, height: s, viewBox: "0 0 24 24", fill: "none", stroke, strokeWidth: sw, strokeLinecap: "round", strokeLinejoin: "round" };
  switch (name) {
    case "sun": return (<svg {...common}><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg>);
    case "target": return (<svg {...common}><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/></svg>);
    case "bell": return (<svg {...common}><path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10 21a2 2 0 0 0 4 0"/></svg>);
    case "loop": return (<svg {...common}><path d="M4 12a8 8 0 1 1 8 8"/><path d="M4 17v-5h5"/></svg>);
    case "vault": return (<svg {...common}><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="14" cy="12" r="3"/><path d="M14 9V8M14 16v-1M17 12h1M10 12h1"/></svg>);
    case "book": return (<svg {...common}><path d="M4 4h12a4 4 0 0 1 4 4v12H8a4 4 0 0 1-4-4z"/><path d="M4 4v12"/></svg>);
    case "ring": return (<svg {...common}><circle cx="12" cy="14" r="6"/><path d="M9 3l3 4 3-4"/></svg>);
    case "compass": return (<svg {...common}><circle cx="12" cy="12" r="9"/><path d="M15.5 8.5l-2 5-5 2 2-5 5-2z"/></svg>);
    case "people": return (<svg {...common}><circle cx="9" cy="8" r="3.5"/><circle cx="17" cy="9" r="2.5"/><path d="M3 19c0-3 2.5-5 6-5s6 2 6 5"/><path d="M14 19c0-2 1.5-3.5 4-3.5s4 1.5 4 3.5"/></svg>);
    case "hearth": return (<svg {...common}><path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z"/><path d="M9 21v-6h6v6"/></svg>);
    case "shield": return (<svg {...common}><path d="M12 3l8 3v6c0 4.5-3.5 8-8 9-4.5-1-8-4.5-8-9V6z"/><path d="M9 12l2 2 4-4"/></svg>);
    case "gear": return (<svg {...common}><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1A1.7 1.7 0 0 0 9 19.4a1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.7 1.7 0 0 0 9 4.6 1.7 1.7 0 0 0 10 3.1V3a2 2 0 1 1 4 0v.1A1.7 1.7 0 0 0 15 4.6a1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8c.2.4.6.7 1.1.8H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>);
    case "plus": return (<svg {...common}><path d="M12 5v14M5 12h14"/></svg>);
    case "search": return (<svg {...common}><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>);
    case "mic": return (<svg {...common}><rect x="9" y="3" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>);
    case "arrow-right": return (<svg {...common}><path d="M5 12h14M13 6l6 6-6 6"/></svg>);
    case "x": return (<svg {...common}><path d="M6 6l12 12M18 6L6 18"/></svg>);
    case "check": return (<svg {...common}><path d="M5 12l5 5 9-12"/></svg>);
    case "chevron-right": return (<svg {...common}><path d="M9 6l6 6-6 6"/></svg>);
    case "chevron-down": return (<svg {...common}><path d="M6 9l6 6 6-6"/></svg>);
    case "moon": return (<svg {...common}><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>);
    case "lock": return (<svg {...common}><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V8a4 4 0 1 1 8 0v3"/></svg>);
    case "eye": return (<svg {...common}><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>);
    case "eye-off": return (<svg {...common}><path d="M3 3l18 18M10.5 6.2A10 10 0 0 1 22 12s-1.4 2.7-4 4.6M6.7 6.7C3.6 8.6 2 12 2 12s3.5 7 10 7c1.8 0 3.4-.5 4.7-1.2"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>);
    case "send": return (<svg {...common}><path d="M22 2L11 13M22 2l-7 20-4-9-9-4z"/></svg>);
    case "edit": return (<svg {...common}><path d="M11 4H4v16h16v-7M18 2l4 4-12 12H6v-4z"/></svg>);
    case "trash": return (<svg {...common}><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></svg>);
    case "more": return (<svg {...common}><circle cx="12" cy="5" r="1.5" fill="currentColor"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/><circle cx="12" cy="19" r="1.5" fill="currentColor"/></svg>);
    case "clock": return (<svg {...common}><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>);
    case "calendar": return (<svg {...common}><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 9h18M8 3v4M16 3v4"/></svg>);
    case "flag": return (<svg {...common}><path d="M4 21V4h12l-2 4 2 4H4"/></svg>);
    case "tag": return (<svg {...common}><path d="M2 11V4h7l11 11-7 7z"/><circle cx="7" cy="8" r="1.2" fill="currentColor"/></svg>);
    case "filter": return (<svg {...common}><path d="M3 5h18l-7 9v6l-4-2v-4z"/></svg>);
    case "sparkle": return (<svg {...common}><path d="M12 3v6M12 15v6M3 12h6M15 12h6M5.6 5.6l4 4M14.4 14.4l4 4M5.6 18.4l4-4M14.4 9.6l4-4"/></svg>);
    case "wave": return (<svg {...common}><path d="M3 12c2 0 2-4 4-4s2 8 4 8 2-8 4-8 2 4 4 4"/></svg>);
    case "heart": return (<svg {...common}><path d="M12 21s-7-4.5-9-9c-1.5-3.5 1-7 4-7 2 0 3 1 4 2 1-1 2-2 4-2 3 0 5.5 3.5 4 7-2 4.5-9 9-9 9z"/></svg>);
    case "phone": return (<svg {...common}><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7l.4 2.6a2 2 0 0 1-.6 1.7L7.6 9.4a16 16 0 0 0 6 6l1.4-1.3a2 2 0 0 1 1.8-.6l2.6.4a2 2 0 0 1 1.7 2z"/></svg>);
    case "spark-2": return (<svg {...common}><path d="M12 2l2.3 6.5L21 11l-6.7 2.5L12 20l-2.3-6.5L3 11l6.7-2.5z"/></svg>);
    case "wand": return (<svg {...common}><path d="M3 21l12-12M14 5l3-3 2 2-3 3M19 10l2 2M16 15l2 2M5 8l1 1"/></svg>);
    default: return (<svg {...common}><circle cx="12" cy="12" r="3"/></svg>);
  }
};

const Chip = ({ children, tone = "", dot = false, className = "" }) => (
  <span className={`chip ${tone} ${dot ? "dot" : ""} ${className}`}>{children}</span>
);

const PriorityChip = ({ level }) => {
  if (!level) return null;
  const map = {
    "non-negotiable": { tone: "crit dot", label: "Non-negotiable" },
    "important":      { tone: "amber dot", label: "Important" },
    "high":           { tone: "amber dot", label: "High" },
    "normal":         { tone: "", label: "Normal" },
    "low":            { tone: "", label: "Low" },
  };
  const c = map[level] || { tone: "", label: level };
  return <Chip tone={c.tone}>{c.label}</Chip>;
};

const Avatar = ({ initials, tone = "", size = "" }) => (
  <span className={`avatar ${tone} ${size}`}>{initials}</span>
);

const Switch = ({ on, onClick }) => (
  <div className={`switch ${on ? "on" : ""}`} onClick={onClick} role="switch" aria-checked={on}></div>
);

const Seg = ({ options, value, onChange, className = "" }) => (
  <div className={`seg ${className}`}>
    {options.map((o, i) => (
      <button
        key={i}
        className={value === (o.value ?? o) ? `active ${className === "commitment" ? "lvl-" + (o.value ?? i) : ""}` : ""}
        onClick={() => onChange(o.value ?? o)}
      >
        {o.label ?? o}
      </button>
    ))}
  </div>
);

const Tabs = ({ items, value, onChange }) => (
  <div className="tabs" role="tablist">
    {items.map(t => (
      <div key={t.value} className={`tab ${value === t.value ? "active" : ""}`} onClick={() => onChange(t.value)}>{t.label}</div>
    ))}
  </div>
);

const PageHead = ({ eyebrow, title, sub, right }) => (
  <div className="page-head">
    <div>
      {eyebrow && <div className="eyebrow">{eyebrow}</div>}
      <h1 className="page-title" dangerouslySetInnerHTML={{ __html: title }} />
      {sub && <p className="page-sub">{sub}</p>}
    </div>
    {right && <div style={{ display: "flex", alignItems: "center", gap: 10 }}>{right}</div>}
  </div>
);

// Tiny sparkline (svg)
const Spark = ({ values, color = "var(--amber)", width = 120, height = 26 }) => {
  const max = Math.max(1, ...values);
  const step = width / (values.length - 1 || 1);
  const points = values.map((v, i) => `${i * step},${height - (v / max) * (height - 4) - 2}`).join(" ");
  return (
    <svg width={width} height={height} style={{ display: "block" }}>
      <polyline points={points} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.85"/>
    </svg>
  );
};

// 30-day streak bar
const StreakBar = ({ data, todayIndex = 29 }) => (
  <div className="streak">
    {data.map((d, i) => (
      <div key={i} className={`day ${d === 1 ? "hit" : d === 0 ? "miss" : ""} ${i === todayIndex ? "today" : ""}`}></div>
    ))}
  </div>
);

const Bar = ({ value, max = 100, tone = "" }) => (
  <div className="bar-track"><div className={`bar-fill ${tone}`} style={{ width: `${Math.min(100, (value / max) * 100)}%` }}></div></div>
);

const personById = (id) => HANU.people.find(p => p.id === id);

// Reusable empty-state block for surfaces with no data yet.
const EmptyState = ({ title, body, icon = "sparkle" }) => (
  <div className="empty-state">
    <Icon name={icon} size={28} />
    {title ? <h3 className="empty-title">{title}</h3> : null}
    <p className="empty-body">{body}</p>
  </div>
);

Object.assign(window, { Icon, Chip, PriorityChip, Avatar, Switch, Seg, Tabs, PageHead, Spark, StreakBar, Bar, personById, EmptyState });
