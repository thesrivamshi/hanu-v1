# 20 — Baileys: randomized delay + typing indicator (anti-ban hygiene)

**Priority:** P3 (becomes P1 the moment more than two people use the bot)
**Effort:** 2-3 hours
**Depends on:** none
**Status:** TODO
**Risk if skipped:** WhatsApp's heuristics flag accounts that reply instantly to every message with no typing-indicator. Hanu's natural behavior is a textbook bot signature. The dedicated bot number (+91 9100410143) is at non-trivial risk of being banned in weeks, not years.

---

## Context

`HANU_PROJECT_PLAN.md` §3 calls the ban risk "negligible for personal use." That underestimates current WhatsApp behavior. WhatsApp now actively detects:

- Sub-second response time across every message.
- Identical message-arrival → response-send latency.
- No typing-indicator simulation before a long reply.
- No "online" / "offline" presence variation.

Hanu's current Baileys bridge probably sends messages straight after Hermes returns text. We need to:

1. Add a randomized 1.5-4 second delay before sending.
2. Send `presence: 'composing'` (typing indicator) during the delay, switch to `'paused'` just before sending.
3. Vary delay roughly proportional to response length (longer reply = more believable typing time).
4. Drop the typing indicator entirely if the user has marked the bot as a "business" or muted; don't be intrusive.

---

## Acceptance criteria

- Every outbound message from the Baileys bridge waits 1.5-4 seconds before sending.
- During that wait, the bot's presence is set to `composing`.
- For replies > 200 characters, delay grows to 3-6 seconds.
- Configurable via env var `HANU_HUMANIZE=on|off` so it can be disabled in tests.
- Logs in `/var/log/hanu/baileys.log` show "typing for Xms" entries.

---

## Implementation steps

### Step 1 — Locate the Baileys send-message path

On the droplet, find the Baileys bridge process and code. Likely paths:

```bash
systemctl list-units --type=service --all | grep -i baileys
ps aux | grep -i baileys
find / -name "package.json" 2>/dev/null | xargs grep -l "baileys" 2>/dev/null
```

Most likely `/root/hanu-baileys/` or wherever the bridge was scripted. Locate the function that calls `sock.sendMessage(jid, content)` — that's the chokepoint.

### Step 2 — Add a delay helper

```js
// In the bridge source, near sock setup:
const HUMANIZE = process.env.HANU_HUMANIZE !== "off";

function randInt(lo, hi) {
  return Math.floor(Math.random() * (hi - lo + 1)) + lo;
}

function computeDelay(text) {
  const len = (text || "").length;
  const baseMs = randInt(1500, 2500);            // 1.5-2.5s base
  const perCharMs = randInt(20, 40);             // 20-40ms per char
  const total = baseMs + Math.min(len * perCharMs, 4000);  // cap added time at 4s
  return Math.min(total, 6000);                  // hard cap at 6s
}
```

### Step 3 — Wrap `sendMessage` with humanize

```js
async function sendHuman(sock, jid, content) {
  const text = content?.text || "";
  if (!HUMANIZE) {
    return sock.sendMessage(jid, content);
  }

  const delayMs = computeDelay(text);
  await sock.sendPresenceUpdate("composing", jid);
  console.log(`[hanu-baileys] typing for ${delayMs}ms before send to ${jid}`);
  await new Promise(r => setTimeout(r, delayMs));
  await sock.sendPresenceUpdate("paused", jid);
  return sock.sendMessage(jid, content);
}
```

Replace every call to `sock.sendMessage(jid, content)` in the bridge with `sendHuman(sock, jid, content)`.

### Step 4 — Optional: presence variation

WhatsApp's "online" / "last seen" presence is also fingerprinted. The bridge can periodically toggle:

```js
// Every 5-10 minutes, randomly go offline for 30-90 seconds:
setInterval(async () => {
  if (Math.random() < 0.3) {
    await sock.sendPresenceUpdate("unavailable", undefined);
    setTimeout(() => sock.sendPresenceUpdate("available", undefined),
               randInt(30_000, 90_000));
  }
}, randInt(5 * 60_000, 10 * 60_000));
```

Optional. Adds complexity. Skip for v1; consider after the first family member joins.

### Step 5 — Skip humanize for time-sensitive messages

Non-negotiable reminders during quiet hours (when the user has explicitly approved breaking quiet hours) should fire promptly. Add a `urgent: true` flag to the content envelope:

```js
async function sendHuman(sock, jid, content, opts = {}) {
  if (opts.urgent || !HUMANIZE) {
    return sock.sendMessage(jid, content);
  }
  ...
}
```

Wire `urgent: true` from the reminder firing worker when `priority === 'non_negotiable'`.

### Step 6 — Add a unit-ish test

A trivial Node script that exercises `computeDelay`:

```js
const cases = [
  ["", 1500, 4000],
  ["hi", 1500, 4000],
  ["a".repeat(50), 2000, 5000],
  ["a".repeat(500), 3000, 6000],
];
for (const [text, lo, hi] of cases) {
  const d = computeDelay(text);
  if (d < lo - 100 || d > hi + 100) {
    console.error("FAIL", text.slice(0, 20), d, "not in", lo, hi);
    process.exit(1);
  }
}
console.log("OK");
```

---

## Verification

```bash
# On droplet, tail the bridge log:
journalctl -fu <baileys-bridge-service-name> | grep -i 'typing for'

# Send 5 messages to the bot rapidly. Confirm:
# - Each response arrives 1.5-6s after sending.
# - Delays are NOT identical (variance present).
# - Long replies wait longer than short ones.
```

Externally, look at the bot's profile from your personal WhatsApp account while a reply is in progress. You should see "typing…" briefly before the message arrives.

---

## Rollback

Set `HANU_HUMANIZE=off` in the systemd unit's `Environment=` or `EnvironmentFile=` and restart the bridge:

```bash
systemctl set-environment HANU_HUMANIZE=off
systemctl restart <baileys-bridge-service>
```

---

## Files touched

- Baileys bridge source (Node) — `sendHuman` wrapper, replace all `sendMessage` calls.
- Bridge systemd unit — add `HANU_HUMANIZE=on` to environment.
- `hermes-hanu-skill/reminder_worker.py` — pass `urgent: true` for non-negotiable reminders (if the bridge accepts an opts envelope).

---

## Notes

- WhatsApp does NOT publish their bot-detection heuristics. Everything here is community-known best practice as of late 2025. Treat the rules as guidance, not certainty.
- A dedicated number reduces personal-account ban risk but doesn't eliminate bot-detection risk for the number itself. The mitigation is behavioral.
- For volumes above ~50 messages/day across multiple users, migrate to the official WhatsApp Business API (Meta verification required; costs money). That's a slice-6 concern.
- Do NOT bulk-send (broadcast lists) from a Baileys-bridged number. That triggers the strongest ban signal.
- The presence-variation work in step 4 has diminishing returns and adds complexity to the bridge's lifecycle. Add it only if a ban actually happens to the current number.
