/*
 * Hanu Supabase client.
 * Initializes the Supabase JS client, signs in the user, and exposes
 *  - window.sb         (the Supabase client)
 *  - window.HANU_USER_ID
 *  - window.hanuLoad() — fetches all rows + populates window.HANU.*
 *  - window.hanuSubscribe(cb) — wires real-time listeners; cb fires on every change
 *  - window.hanu       — namespaced write helpers (createGoal, createReminder, ...)
 *
 * Notes:
 *  - We use the PUBLISHABLE (anon) key here. It is safe to expose in the browser.
 *  - Row Level Security pins every read/write to the signed-in user.
 *  - Auth is magic-link only. No long-lived secrets in this file.
 *    `ensureSignedIn()` throws AUTH_REQUIRED when there is no session;
 *    the app's render layer catches that and renders the LoginScreen.
 */

const SUPABASE_URL = "https://lcayzfqmemitlbjugbsq.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_NS72CcCYk7THrdm0JzCIMw_UG2Joy3j";
const HANU_USER_ID = "d804b9ed-5eaa-497c-8390-86ba02007a33";

// supabase global comes from the CDN script loaded in index.html
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, storageKey: "hanu-auth" },
  realtime: { params: { eventsPerSecond: 5 } },
});

window.sb = sb;
window.HANU_USER_ID = HANU_USER_ID;

// -----------------------------------------------------------------------------
// Auth: magic-link only. If there's no session, throw a sentinel error so the
// React render layer can swap in the LoginScreen instead of treating it as a
// load failure. No passwords are ever held in this file.
// -----------------------------------------------------------------------------
async function ensureSignedIn() {
  const { data: { session } } = await sb.auth.getSession();
  if (session && session.user) return session;
  throw new Error("AUTH_REQUIRED");
}
window.ensureSignedIn = ensureSignedIn;

// -----------------------------------------------------------------------------
// Helpers: map DB enums (underscore) <-> UI strings (hyphen) where needed.
// -----------------------------------------------------------------------------
const _dbToUi = (v) => (typeof v === "string" ? v.replaceAll("_", "-") : v);
const _uiToDb = (v) => (typeof v === "string" ? v.replaceAll("-", "_") : v);

function shapeGoal(row, completions = []) {
  // Build sparkline from last 30 days completions, default all 1s
  const today = new Date();
  const startMs = today.getTime() - 29 * 86400000;
  const spark = Array(30).fill(1);
  for (const c of completions) {
    const d = new Date(c.on_date);
    const idx = Math.floor((d.getTime() - startMs) / 86400000);
    if (idx >= 0 && idx < 30) spark[idx] = c.status === "done" ? 1 : 0;
  }
  return {
    id: row.id,
    title: row.title,
    why: row.why || "",
    priority: _dbToUi(row.priority),
    commitment: ["idea","planned","committed","promised","non_negotiable"].indexOf(row.commitment),
    promiseTo: row.promise_to_text || "Self",
    dailyAction: row.daily_action || "",
    streak: row.streak ?? 0,
    missed: row.missed_count ?? 0,
    risk: row.risk || "low",
    nextCheckIn: row.next_check_in_at || "",
    recovery: row.recovery_rule || "",
    sparkline: spark,
  };
}

function shapeReminder(r) {
  return {
    id: r.id,
    title: r.title,
    time: r.scheduled_text || "",
    when: r.when_text || "",
    category: (r.category || "").charAt(0).toUpperCase() + (r.category || "").slice(1),
    priority: _dbToUi(r.priority),
    recurs: (r.recur || "once") === "once" ? "—" : (r.recur || "").charAt(0).toUpperCase() + (r.recur || "").slice(1),
    needsConfirm: !!r.needs_confirm,
    person: r.person_id ? String(r.person_id) : undefined,
    followUp: r.follow_up_rule || "",
    reason: r.miss_reason || "",
  };
}

function shapeLoop(l) {
  const ageDays = l.age_days ?? Math.floor((Date.now() - new Date(l.created_at).getTime()) / 86400000);
  return {
    id: l.id,
    title: l.title,
    owner: l.owner_text || "You",
    state: _dbToUi(l.state),
    age: ageDays,
    postponed: l.postponed_count ?? 0,
  };
}

function shapeMemory(m) {
  return {
    id: m.id,
    text: m.text,
    type: _dbToUi(m.kind || "other"),
    privacy: _dbToUi(m.privacy || "private"),
    source: m.source || "",
    sourceType: m.source_type || "conversation",
    sensitiveCategory: m.sensitive_category || null,
    pinned: !!m.pinned,
  };
}

function shapeInboxItem(i) {
  return {
    id: i.id,
    text: i.text,
    confidence: i.confidence ?? 0,
  };
}

function shapeApproval(a, peopleById) {
  const fromPerson = peopleById[a.from_person_id];
  return {
    id: a.id,
    from: a.from_person_id,
    fromName: fromPerson ? fromPerson.name : "Someone",
    question: a.question,
    context: a.context || "",
    suggested: a.suggested_action || "",
  };
}

function shapePromise(p, peopleById) {
  const toName = p.to_person_id && peopleById[p.to_person_id] ? peopleById[p.to_person_id].name : (p.to_text || "Self");
  return {
    id: p.id,
    to: toName,
    text: p.text,
    due: p.due_text || (p.due_at ? new Date(p.due_at).toLocaleDateString() : ""),
    status: _dbToUi(p.state || "pending"),
    followUp: p.follow_up_rule || "",
    kept: p.kept_count ?? 0,
    broken: p.broken_count ?? 0,
  };
}

function shapeDecision(d) {
  return {
    id: d.id,
    title: d.title,
    area: d.area || "",
    date: d.decided_on || "",
    why: d.why || "",
    revisit: d.revisit_rule || "",
    related: d.related_person_ids || [],
    tags: d.tags || [],
  };
}

function shapePerson(p) {
  return {
    id: p.id,
    name: p.name,
    initials: p.initials || (p.name ? p.name.split(" ").map(w => w[0]).slice(0, 2).join("").toUpperCase() : "?"),
    avatarTone: p.avatar_tone || "",
    relationship: p.relationship || "",
    profileStatus: p.profile_type === "full_hanu_user" ? "Full Hanu user"
                 : p.profile_type === "managed" ? "Managed family profile"
                 : p.profile_type === "trusted" ? "Trusted circle"
                 : p.profile_type === "self"    ? "Private profile"
                 : "External contact",
    tier: typeof p.permission_tier === "number" ? p.permission_tier : 0,
    spaces: [],
    canAsk: p.can_ask || "",
    canSend: p.can_send || "",
    canSee: p.can_see || "",
    approval: p.approval_rule || "",
    tone: p.tone || "",
    quietHours: (p.quiet_hours_start && p.quiet_hours_end) ? `${p.quiet_hours_start} – ${p.quiet_hours_end}` : "—",
    note: p.note || "",
  };
}

function shapeSettings(s) {
  if (!s) return { tone: "firm", pauseModes: [], activePause: "", quietHours: { start: "22:00", end: "07:00" }, followUpIntensity: "Firm", accountability: "Strict", askBeforeSaving: true, askBeforeSharing: true, channels: { app: true, whatsapp: true, email: false, sms: false }, sensitive: [] };
  return {
    pauseModes: s.pause_modes || [],
    activePause: s.active_pause || "",
    quietHours: { start: (s.quiet_hours_start || "22:00:00").slice(0, 5), end: (s.quiet_hours_end || "07:00:00").slice(0, 5) },
    followUpIntensity: s.follow_up_intensity || "Firm",
    accountability: s.accountability || "Strict",
    askBeforeSaving: !!s.ask_before_saving,
    askBeforeSharing: !!s.ask_before_sharing,
    channels: s.channels || { app: true, whatsapp: true, email: false, sms: false },
    sensitive: s.sensitive_categories || [],
    tone: s.tone || "firm",
    mood: s.mood || "amber",
    ambient: s.ambient || "soft",
    theme: s.theme || "dark",
  };
}

// -----------------------------------------------------------------------------
// Load all rows in parallel and populate window.HANU
// -----------------------------------------------------------------------------
async function hanuLoad() {
  // Propagate AUTH_REQUIRED so the App can render the LoginScreen.
  // Any other auth error is also fatal — without a session, RLS blocks every read.
  await ensureSignedIn();

  const [
    profileRes, settingsRes, peopleRes, goalsRes, completionsRes,
    remindersRes, loopsRes, memoriesRes, inboxRes, approvalsRes,
    promisesRes, decisionsRes,
  ] = await Promise.all([
    sb.from("profiles").select("*").eq("id", HANU_USER_ID).single(),
    sb.from("settings").select("*").eq("user_id", HANU_USER_ID).maybeSingle(),
    sb.from("people").select("*").eq("user_id", HANU_USER_ID),
    sb.from("goals").select("*").eq("user_id", HANU_USER_ID).neq("status", "archived"),
    sb.from("goal_completions").select("*").eq("user_id", HANU_USER_ID).order("on_date", { ascending: false }).limit(500),
    sb.from("reminders").select("*").eq("user_id", HANU_USER_ID).order("scheduled_at", { ascending: true }),
    sb.from("open_loops").select("*").eq("user_id", HANU_USER_ID).neq("state", "closed"),
    sb.from("memories").select("*").eq("user_id", HANU_USER_ID).eq("archived", false).order("created_at", { ascending: false }),
    sb.from("memory_inbox").select("*").eq("user_id", HANU_USER_ID).eq("state", "pending"),
    sb.from("approvals").select("*").eq("user_id", HANU_USER_ID).eq("state", "pending"),
    sb.from("promises").select("*").eq("user_id", HANU_USER_ID),
    sb.from("decisions").select("*").eq("user_id", HANU_USER_ID).order("decided_on", { ascending: false }),
  ]);

  const completionsByGoal = {};
  for (const c of completionsRes.data || []) {
    (completionsByGoal[c.goal_id] ||= []).push(c);
  }

  const people = (peopleRes.data || []).map(shapePerson);
  const peopleById = Object.fromEntries(people.map(p => [p.id, p]));

  const profile = profileRes.data || { first_name: "Friend", display_name: "Friend", avatar_letter: "H" };

  // Populate
  window.HANU.user = { name: profile.display_name, first: profile.first_name, avatar: profile.avatar_letter || "H" };
  window.HANU.settings = shapeSettings(settingsRes.data);

  window.HANU.people = people;
  window.HANU.goals = (goalsRes.data || []).map(r => shapeGoal(r, completionsByGoal[r.id] || []));
  window.HANU.reminders = (remindersRes.data || []).filter(r => r.state === "pending").map(shapeReminder);
  window.HANU.remindersMissed = (remindersRes.data || []).filter(r => r.state === "missed").map(shapeReminder);
  window.HANU.loops = (loopsRes.data || []).map(shapeLoop);
  window.HANU.memories = (memoriesRes.data || []).map(shapeMemory);
  window.HANU.memoryInbox = (inboxRes.data || []).map(shapeInboxItem);
  window.HANU.approvals = (approvalsRes.data || []).map(a => shapeApproval(a, peopleById));
  window.HANU.promises = (promisesRes.data || []).map(p => shapePromise(p, peopleById));
  window.HANU.decisions = (decisionsRes.data || []).map(shapeDecision);

  // Update nav counts
  for (const item of window.HANU.nav) {
    if (item.id === "goals")     item.count = window.HANU.goals.length;
    if (item.id === "reminders") item.count = window.HANU.reminders.length;
    if (item.id === "loops")     item.count = window.HANU.loops.length;
    if (item.id === "memory")    item.count = window.HANU.memories.length;
    if (item.id === "decisions") item.count = window.HANU.decisions.length;
    if (item.id === "promises")  item.count = window.HANU.promises.length;
    if (item.id === "people")    item.count = window.HANU.people.length;
    if (item.id === "approvals") item.count = window.HANU.approvals.length;
  }

  console.log("[hanu] loaded", {
    people: window.HANU.people.length,
    goals: window.HANU.goals.length,
    reminders: window.HANU.reminders.length,
    memories: window.HANU.memories.length,
  });

  window.dispatchEvent(new CustomEvent("hanu:loaded"));
}
window.hanuLoad = hanuLoad;

// -----------------------------------------------------------------------------
// Real-time subscriptions: re-fetch the affected slice on every change.
// -----------------------------------------------------------------------------
const _watchedTables = [
  "profiles", "settings", "people", "goals", "goal_completions",
  "reminders", "open_loops", "memories", "memory_inbox", "approvals",
  "promises", "decisions",
];

function hanuSubscribe(onChange) {
  const channel = sb.channel("hanu-rt");
  for (const table of _watchedTables) {
    channel.on("postgres_changes", { event: "*", schema: "public", table },
      async (payload) => {
        console.log("[hanu] realtime", table, payload.eventType);
        // Cheap path: refetch everything. For v1 fine.
        await hanuLoad();
        onChange && onChange();
      });
  }
  channel.subscribe((status) => {
    if (status === "SUBSCRIBED") console.log("[hanu] realtime subscribed");
  });
  return () => sb.removeChannel(channel);
}
window.hanuSubscribe = hanuSubscribe;

// -----------------------------------------------------------------------------
// Write helpers (used by modals). Names mirror Hermes' hanu_call tools.
// -----------------------------------------------------------------------------
window.hanu = {
  // Auth helpers — magic-link only. Exposed here so UI components (LoginScreen,
  // sidebar sign-out, etc.) can use a single namespace instead of poking at the
  // raw supabase client.
  //
  // Note: these two helpers return `{ ok, error }` rather than the raw
  // Supabase `{ data, error }` PostgrestResponse used by the table helpers
  // below — auth responses carry no useful `data` payload to surface.
  async sendMagicLink(email) {
    try {
      const { error } = await sb.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: window.location.origin },
      });
      if (error) return { ok: false, error: error.message || String(error) };
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err && err.message ? err.message : String(err) };
    }
  },
  async signOut() {
    let result = { ok: true };
    try {
      const { error } = await sb.auth.signOut();
      if (error) result = { ok: false, error: error.message || String(error) };
    } catch (err) {
      result = { ok: false, error: (err && err.message) ? err.message : String(err) };
    } finally {
      // Reload to guarantee no in-memory user data leaks across sessions, even
      // if signOut itself failed (Supabase still clears the token).
      window.location.reload();
    }
    return result;
  },

  async createGoal({ title, why, priority = "normal", commitment = 1, dailyAction = "", recovery = "", checkInTime = null, promiseToText = "Self" }) {
    return sb.from("goals").insert({
      user_id: HANU_USER_ID,
      title, why, priority: _uiToDb(priority),
      commitment: ["idea","planned","committed","promised","non_negotiable"][Math.min(4, Math.max(0, commitment))],
      daily_action: dailyAction, recovery_rule: recovery,
      check_in_time: checkInTime, promise_to_text: promiseToText,
      status: "active",
    }).select().single();
  },
  async createReminder({ title, when = "", recur = "once", priority = "normal", category = "personal", needsConfirm = false, followUpRule = null, personId = null }) {
    return sb.from("reminders").insert({
      user_id: HANU_USER_ID,
      title, scheduled_text: when, when_text: when,
      recur, priority: _uiToDb(priority), category: category.toLowerCase(),
      needs_confirm: needsConfirm, follow_up_rule: followUpRule, person_id: personId,
      state: "pending",
    }).select().single();
  },
  async createPerson({ name, relationship = "", profileType = "external", channel = "whatsapp", whatsapp = null, tone = "" }) {
    return sb.from("people").insert({
      user_id: HANU_USER_ID,
      name, relationship,
      profile_type: profileType,
      primary_channel: channel, whatsapp_number: whatsapp, tone,
      initials: name.split(" ").map(w => w[0]).slice(0, 2).join("").toUpperCase(),
    }).select().single();
  },
  async saveMemory({ text, kind = "other", privacy = "private", pinned = false, sensitiveCategory = null }) {
    return sb.from("memories").insert({
      user_id: HANU_USER_ID, text, kind: _uiToDb(kind), privacy: _uiToDb(privacy), pinned,
      sensitive_category: sensitiveCategory,
    }).select().single();
  },
  async updateMemory({ id, text, privacy, pinned, sensitiveCategory }) {
    const patch = {};
    if (text !== undefined) patch.text = text;
    if (privacy !== undefined) patch.privacy = _uiToDb(privacy);
    if (pinned !== undefined) patch.pinned = pinned;
    if (sensitiveCategory !== undefined) patch.sensitive_category = sensitiveCategory;
    return sb.from("memories").update(patch).eq("id", id).select().single();
  },
  async forgetMemory(id) {
    return sb.from("memories").update({ archived: true }).eq("id", id);
  },
  async resolveApproval({ id, state, replyText }) {
    return sb.from("approvals").update({
      state: _uiToDb(state), reply_text: replyText, resolved_at: new Date().toISOString(),
    }).eq("id", id);
  },
  async saveInboxItem({ id, kind = "other", privacy = "private" }) {
    // Promote a memory_inbox row to memories.
    const inbox = await sb.from("memory_inbox").select("*").eq("id", id).single();
    if (inbox.error) return inbox;
    const memo = await sb.from("memories").insert({
      user_id: HANU_USER_ID, text: inbox.data.text,
      kind: _uiToDb(kind), privacy: _uiToDb(privacy),
      source: "memory_inbox", source_message_id: inbox.data.source_message_id,
    }).select().single();
    if (!memo.error) {
      await sb.from("memory_inbox").update({ state: "saved", saved_memory_id: memo.data.id, resolved_at: new Date().toISOString() }).eq("id", id);
    }
    return memo;
  },
  async rejectInboxItem(id) {
    return sb.from("memory_inbox").update({ state: "rejected", resolved_at: new Date().toISOString() }).eq("id", id);
  },
  async setSetting(field, value) {
    return sb.from("settings").update({ [field]: value }).eq("user_id", HANU_USER_ID);
  },
};
