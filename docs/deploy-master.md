# Master deploy runbook

Everything you (the human) need to run on the droplet and in the Supabase dashboard to turn the committed code into a working Hanu. Walk top-to-bottom.

Targets:
- Droplet: `168.144.30.107` (Ubuntu 24.04, user `root`).
- Supabase project: `lcayzfqmemitlbjugbsq` (region ap-south-1).
- WhatsApp bot number: `+91 9100410143`, allowlist LID `75935407714503@lid`.
- Local repo: `/Users/srivamshi/MyDrafts/Hanu-v1`. GitHub: `thesrivamshi/hanu-v1`.

---

## 0. Prerequisites

You need:
- SSH key that can reach `root@168.144.30.107`.
- Supabase account access to project `lcayzfqmemitlbjugbsq` (dashboard).
- A hostname for HTTPS (DDNS or real domain). Free option: DuckDNS — `<chosen>.duckdns.org` pointing at `168.144.30.107`. Below we'll refer to your chosen hostname as `${HANU_HOST}`.
- The repo cloned on the droplet (or you'll rsync from your Mac). Either works.

---

## 1. Supabase: enable backups, allow-list, storage bucket

Dashboard work; no terminal.

1. **Project Settings → Database → Backups**: toggle Daily on.
2. **Authentication → Providers → Email**: ensure email magic-link is enabled. Disable signup (single-user) unless you're onboarding family today.
3. **Authentication → URL Configuration**:
   - Site URL: `https://${HANU_HOST}/`
   - Redirect URLs: include `https://${HANU_HOST}/` and `http://168.144.30.107/` (transitional, until HTTPS is live).
4. **Authentication → Users**: send a password reset for `desk.mightyminds@gmail.com` and set a fresh strong password. The new UI never uses passwords (magic-link only), but rotate as defense-in-depth.
5. **Storage → New bucket**: create `voice-notes`, **private**. Add this SQL policy:
   ```sql
   create policy "voice-notes owner read"
     on storage.objects for select
     using (bucket_id = 'voice-notes' and (storage.foldername(name))[1] = auth.uid()::text);
   create policy "voice-notes owner insert"
     on storage.objects for insert
     with check (bucket_id = 'voice-notes' and (storage.foldername(name))[1] = auth.uid()::text);
   ```

---

## 2. Migrations are already applied

During this build session every file under `supabase/migrations/` was applied to the remote project via the Supabase Management API. You can verify in Supabase dashboard → Database → Migrations: 15 migration rows dated 2026-05-13.

**Nothing to do here.** Recorded for completeness: if you ever restore from a fresh project, `supabase db push` from this repo replays them in lexical order.

---

## 3. Droplet: install dependencies

```bash
ssh root@168.144.30.107

# Pythons + tools that the workers need:
/usr/local/lib/hermes-agent/venv/bin/pip install \
  "mcp>=1.0" \
  supabase \
  python-dotenv \
  requests \
  pyyaml \
  openai \
  dateparser \
  fastapi \
  uvicorn

# certbot for TLS (only if not already installed):
apt-get update
apt-get install -y certbot python3-certbot-nginx

# Storage paths:
mkdir -p /var/log/hanu /var/backups/hanu /root/hanu-healthz
```

---

## 4. Sync the repo to the droplet

From your Mac:

```bash
cd /Users/srivamshi/MyDrafts/Hanu-v1
rsync -av --delete \
  --exclude '.git' --exclude 'hermes-agent' --exclude 'node_modules' --exclude '.env.local' --exclude 'FILL_IN_HERE.txt' \
  ./ root@168.144.30.107:/root/hanu-v1-repo/
```

(`/root/hanu-v1-repo/` is just a staging directory; the deploy steps below copy from it into the system paths Hermes expects.)

---

## 5. Droplet: install Hanu skill files

```bash
# Skill (tools.py, hanu_mcp_server.py, workers, etc.)
mkdir -p /root/.hermes/skills/hanu-bridge
rsync -av /root/hanu-v1-repo/hermes-hanu-skill/ /root/.hermes/skills/hanu-bridge/

# healthz
cp /root/hanu-v1-repo/ops/healthz/server.py /root/hanu-healthz/

# nginx site
cp /root/hanu-v1-repo/ops/nginx/hanu.conf /etc/nginx/sites-available/hanu
# substitute ${HANU_HOST} in the file (or use envsubst), then:
ln -sf /etc/nginx/sites-available/hanu /etc/nginx/sites-enabled/hanu

# UI bundle (served by nginx at /var/www/hanu)
mkdir -p /var/www/hanu
rsync -av /root/hanu-v1-repo/hanu-v1/project/ /var/www/hanu/

# systemd units
cp /root/hanu-v1-repo/ops/systemd/*.service /root/hanu-v1-repo/ops/systemd/*.timer /etc/systemd/system/

# Cron + logrotate
cp /root/hanu-v1-repo/ops/cron/hanu-backup.sh /usr/local/bin/
chmod +x /usr/local/bin/hanu-backup.sh
cp /root/hanu-v1-repo/ops/cron/hanu-backup /etc/cron.d/hanu-backup
cp /root/hanu-v1-repo/ops/logrotate/hanu /etc/logrotate.d/hanu
```

---

## 6. Droplet: environment

Edit `/root/.hermes/.env` (chmod 600). Required keys:

```
SUPABASE_URL=https://lcayzfqmemitlbjugbsq.supabase.co
SUPABASE_SECRET_KEY=<service-role-key-from-supabase-dashboard>
HANU_USER_ID=d804b9ed-5eaa-497c-8390-86ba02007a33
SUPABASE_DB_URL=postgres://postgres:<db-password>@db.lcayzfqmemitlbjugbsq.supabase.co:5432/postgres
OPENAI_API_KEY=<your-openai-key>
HANU_USER_LID=75935407714503@lid
HANU_HOST=<your-chosen-host>
HANU_HUMANIZE=on
```

Service-role key and DB password are in Supabase dashboard → Project Settings → API.

---

## 7. TLS via certbot

```bash
certbot --nginx -d "${HANU_HOST}" --non-interactive --agree-tos \
  --email desk.mightyminds@gmail.com --redirect
nginx -t && systemctl reload nginx
```

Confirm:
```bash
curl -fsSI "https://${HANU_HOST}/" >/dev/null && echo "HTTPS OK"
curl -s "https://${HANU_HOST}/supabase-client.jsx" | grep -i "BOOTSTRAP\|signInWithPassword" && echo "FAIL credentials leaked" || echo "OK"
```

---

## 8. Hermes config: MCP + disable built-ins

Open Hermes' config file (likely `/root/.hermes/cli-config.yaml`). Add:

```yaml
mcp_servers:
  hanu:
    command: /usr/local/lib/hermes-agent/venv/bin/python
    args:
      - /root/.hermes/skills/hanu-bridge/hanu_mcp_server.py
    env:
      SUPABASE_URL: "${SUPABASE_URL}"
      SUPABASE_SECRET_KEY: "${SUPABASE_SECRET_KEY}"
      HANU_USER_ID: "${HANU_USER_ID}"
    cwd: /root/.hermes/skills/hanu-bridge

tools:
  disabled: [memory, todo, cronjob, kanban, session_search]
```

Test the MCP server standalone before restarting Hermes:

```bash
/usr/local/lib/hermes-agent/venv/bin/python - <<'PY'
import asyncio
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client
async def main():
  p = StdioServerParameters(command="/usr/local/lib/hermes-agent/venv/bin/python",
                            args=["/root/.hermes/skills/hanu-bridge/hanu_mcp_server.py"])
  async with stdio_client(p) as (r, w):
    async with ClientSession(r, w) as s:
      await s.initialize()
      tools = await s.list_tools()
      print("count =", len(tools.tools))
      out = await s.call_tool("hanu_get_settings", {})
      print(out.content[0].text)
asyncio.run(main())
PY
```

Expected: `count = 40` and a JSON settings dict. If anything errors, fix `.env` and retry.

Keep `mirror-to-hanu.py` running for 48 hours after this. Don't delete it yet.

---

## 9. Start all workers + healthz

```bash
systemctl daemon-reload
systemctl enable --now \
  hermes-gateway \
  hanu-reminder-worker \
  hanu-transcription-worker \
  hanu-healthz \
  hermes-heartbeat.timer

systemctl status hermes-gateway --no-pager
systemctl status hanu-reminder-worker --no-pager
systemctl status hanu-transcription-worker --no-pager
systemctl status hanu-healthz --no-pager
```

Verify healthz responds:
```bash
curl -s "https://${HANU_HOST}/healthz" | jq .
# { "ok": true, "at": ... }
```

---

## 10. Baileys humanize patch

```bash
# Find the bridge:
find / -name 'package.json' 2>/dev/null | xargs grep -l '"@whiskeysockets/baileys"' 2>/dev/null
# Suppose it lives at /root/hanu-baileys:
cd /root/hanu-baileys
cp /root/hanu-v1-repo/ops/baileys-humanize/humanize.js ./

# Patch the message handler to use sendHuman:
#   const { sendHuman } = require('./humanize');
#   ... replace `sock.sendMessage(jid, content)` with `sendHuman(sock, jid, content)`

systemctl restart <baileys-systemd-unit-name>
journalctl -fu <baileys-systemd-unit-name> | grep -i 'typing for'  # send a test msg
```

---

## 11. External uptime monitor

Healthchecks.io free tier:
1. Sign up.
2. Add check pointing at `https://${HANU_HOST}/healthz`.
3. Schedule: every 5 minutes.
4. Grace period: 2 minutes.
5. Notification: email to `desk.mightyminds@gmail.com`.

---

## 12. Smoke test — actually use the app

1. Open `https://${HANU_HOST}/` in a private browser window.
2. Enter your email; receive magic link; click it.
3. Dashboard loads. Five tabs: Today, Memory, People, Reviews, Settings. Empty surfaces show the "Tell Hanu on WhatsApp" CTAs.
4. From your personal phone, message `+91 9100410143` on WhatsApp: `hi`.
5. Hanu should respond with the onboarding script (4 turns). Walk through it.
6. After turn 4, refresh the dashboard. You should see:
   - One memory (your preference).
   - One person (the important person you named).
   - One reminder or open loop or goal (the one thing for the week).

That's "the app working."

---

## 13. After 48 hours of stability

Once MCP routing is verified clean (no entries in `/var/log/hanu/hook-mirror.log` that indicate the model is still reaching for `memory`/`todo`/etc.):

```bash
# Remove the legacy mirror path:
rm /root/.hermes/skills/hanu-bridge/mirror-to-hanu.py
rm /usr/local/bin/hanu_call
# Remove the corresponding post_tool_call entry from Hermes config.
systemctl restart hermes-gateway
```

Then trim `SOUL.md` and `SKILL.md` per `tasks/03-hanu-mcp-server.md` step 8.

---

## What's deferred

| Task | Why deferred |
|---|---|
| Task 17 — Vite refactor | Babel-in-browser is slow but works; refactor is 1-2 days of mechanical ES-module conversion. Spec at `tasks/17-vite-refactor.md`. |
| Phase 2 tasks 26-30 | gbrain-inspired: compiled-truth memory split, typed knowledge graph, hybrid vector+FTS, signal detector, routing eval. Designed but not specced as `.md` files yet. |
| Voice-note UI surface | Backend ingestion done; waveform/transcript display in Memory tab is a separate UI task. |
| Conflict editor UI | Read-only list panel exists; resolve-from-UI deferred. |
| Family-critical UI toggle | Read site (KPI) wired; write site not. Set via WhatsApp ("this is family-critical") or directly via SQL for now. |

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Magic link email never arrives | Supabase Auth URL allow-list mismatch | Re-check step 1.3 |
| `hanu_get_settings` returns null | RLS denied because the signed-in `auth.uid()` doesn't match HANU_USER_ID | Confirm the user signing in IS `desk.mightyminds@gmail.com` |
| Reminders never fire | reminder_worker can't reach Hermes outbound API | Inspect `/var/log/hanu/reminder-worker.log`; the `_send_whatsapp` helper at the top of `reminder_worker.py` may need to call your actual Hermes/Baileys outbound endpoint |
| WhatsApp bot stops mid-conversation | Baileys session expired (linked-device re-pair needed) | Run the bridge's pairing flow; scan QR with the bot phone |
| `/healthz` returns 503 (heartbeat stale) | `hermes-heartbeat.timer` not enabled or `hermes-gateway` is the user-unit not system-unit | Adjust the heartbeat service to `systemctl --user is-active hermes-gateway` per your install style |
| Transcription_worker errors with `OpenAI SDK not installed` | venv pip didn't include `openai` | `/usr/local/lib/hermes-agent/venv/bin/pip install openai` |
