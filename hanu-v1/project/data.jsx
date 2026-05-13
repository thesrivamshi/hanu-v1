/* =====================================================================
 * Hanu data shell — defines window.HANU with empty data + static nav.
 * The actual rows are loaded from Supabase by supabase-client.jsx
 * (which calls window.hanuLoad() and populates these arrays).
 * ===================================================================== */

const HANU = {
  user: { name: "Vamshi", first: "Vamshi", avatar: "V" },

  // People list — empty until you (or Hanu) add someone via WhatsApp.
  people: [],

  // 12 nav screens — static. Counts get updated by hanuLoad().
  nav: [
    { id: "today",     label: "Today",         icon: "sun",      group: "core",       count: 0, alert: false },
    { id: "goals",     label: "Goals",         icon: "target",   group: "core",       count: 0 },
    { id: "reminders", label: "Reminders",     icon: "bell",     group: "core",       count: 0 },
    { id: "loops",     label: "Open Loops",    icon: "loop",     group: "core",       count: 0, alert: false },
    { id: "memory",    label: "Memory Vault",  icon: "vault",    group: "knowledge",  count: 0 },
    { id: "decisions", label: "Decision Log",  icon: "book",     group: "knowledge",  count: 0 },
    { id: "promises",  label: "Promises",      icon: "ring",     group: "knowledge",  count: 0, alert: false },
    { id: "reviews",   label: "Reviews",       icon: "compass",  group: "knowledge" },
    { id: "people",    label: "People & Access", icon: "people", group: "relational", count: 0 },
    { id: "family",    label: "Family Space",  icon: "hearth",   group: "relational" },
    { id: "approvals", label: "Approval Queue", icon: "shield",  group: "relational", count: 0, alert: false },
    { id: "settings",  label: "Settings",      icon: "gear",     group: "system" },
  ],

  goals: [],
  reminders: [],
  remindersMissed: [],
  loops: [],
  memories: [],
  memoryInbox: [],
  approvals: [],
  promises: [],
  decisions: [],
  conflicts: [],

  family: {
    name: "",  // populated when the user names the space via WhatsApp
    members: [],
    sharedReminders: [],
    sharedLoops: [],
    routines: [],
    appointments: [],
  },

  reviews: {
    today: {
      morning: { done: false, note: "" },
      midday: { done: false, note: "" },
      evening: { done: false, note: "" },
    },
    weeklyMisses: [],
    // Canonical DB enum values (public.goal_failure_reason). UI labels in FAILURE_REASON_LABELS below.
    failureReasons: ["forgot", "tired", "avoided", "overplanned", "no_time", "blocked", "wrong_time", "too_big", "not_important_anymore"],
  },

  settings: {
    pauseModes: ["Vacation", "Sick", "Low-energy", "Deep work", "Do not disturb"],
    activePause: "",
    quietHours: { start: "22:00", end: "07:00" },
    followUpIntensity: "Firm",
    accountability: "Strict",
    askBeforeSaving: true,
    askBeforeSharing: true,
    channels: { app: true, whatsapp: true, email: false, sms: false },
    sensitive: ["Health", "Finance", "Location", "Private journal", "Children", "Legal", "Passwords / secrets"],
  },
};

// ============================================================
// Tone copy — Hanu's voice changes based on the tone tweak.
// ============================================================
const TONE_COPY = {
  calm: {
    helloLine2: "Hanu is listening. <em>What matters today?</em>",
    nonnegStamp: "Today's anchor",
    nonnegBody: "Nothing critical is pinned yet. Tell me your most important thing today and I'll hold it for you.",
    suggestionWho: "Hanu · a thought",
    suggestionMsg: "When you're ready, tell me one thing you want to remember or get done. I'll take care of it.",
    suggestPrimary: "Open WhatsApp",
    suggestSecondary: "Not yet",
    suggestThird: "Later",
    nowEyebrow: "Hanu's read",
    nowTitle: "What feels right now?",
    nowBody: "Nothing scheduled. Talk to me on WhatsApp and I'll figure out what's next.",
    nowPrimary: "Open chat",
    nowSecondary: "Not this hour",
    badgeTone: "Calm",
  },
  firm: {
    helloLine2: "Tell me one thing that has to happen today.",
    nonnegStamp: "Today's non-negotiable",
    nonnegBody: "No anchor set yet. Tell me your one non-negotiable on WhatsApp and I'll hold it.",
    suggestionWho: "Hanu · suggestion",
    suggestionMsg: "Send me your top intent on WhatsApp. I'll capture it and check in with you later.",
    suggestPrimary: "Open WhatsApp",
    suggestSecondary: "Not now",
    suggestThird: "Suggest later",
    nowEyebrow: "Hanu's read on right now",
    nowTitle: "What should I do now?",
    nowBody: "Nothing on the docket. Send me one thing and I'll prioritise it.",
    nowPrimary: "Open chat",
    nowSecondary: "Skip this",
    badgeTone: "Firm",
  },
  strict: {
    helloLine2: "One thing only. <em>Pick it. Tell me.</em>",
    nonnegStamp: "Non-negotiable · awaiting",
    nonnegBody: "You haven't named today's anchor yet. Open WhatsApp. Name it. I'll enforce it.",
    suggestionWho: "Hanu · directive",
    suggestionMsg: "No active commit. Open WhatsApp. State the one thing. 25 minutes minimum.",
    suggestPrimary: "Locked.",
    suggestSecondary: "Override",
    suggestThird: "Defer (recorded)",
    nowEyebrow: "Right now",
    nowTitle: "Do this. Now.",
    nowBody: "Nothing pinned. Open WhatsApp. Tell me the one thing.",
    nowPrimary: "Open chat",
    nowSecondary: "Defer (recorded)",
    badgeTone: "Strict",
  },
};

// UI-friendly labels for the canonical failure-reason enum values.
const FAILURE_REASON_LABELS = {
  forgot: "Forgot",
  tired: "Too tired",
  avoided: "Avoided",
  overplanned: "Overplanned",
  no_time: "No time",
  blocked: "Blocked by someone",
  wrong_time: "Wrong time",
  too_big: "Too big",
  not_important_anymore: "Not important anymore",
};

window.TONE_COPY = TONE_COPY;
window.FAILURE_REASON_LABELS = FAILURE_REASON_LABELS;
window.HANU = HANU;
