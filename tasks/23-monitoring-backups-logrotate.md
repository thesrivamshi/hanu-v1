# 23 — Ops: backups, log rotation, healthcheck, external uptime monitor

**Priority:** P2
**Effort:** 3-4 hours
**Depends on:** none
**Status:** TODO
**Risk if skipped:** silent Hermes crash looks identical to "user is busy"; OpenAI rate-limit looks identical to "agent is processing"; log files grow unbounded and eventually fill the droplet; no Supabase snapshots means a misclick in the dashboard is unrecoverable.

---

## Context

The droplet runs:
- `hermes-gateway.service` (systemd user unit).
- `hanu-reminder-worker.service` (after task 05).
- `hanu-transcription-worker.service` (after task 11).
- Baileys bridge (systemd unit, name TBD).
- nginx (system service).

None of these are externally monitored. Nothing rotates logs. Supabase has snapshot capability but it's not enabled in the dashboard. No alerting exists.

We need the **minimum responsible setup** for a system that the user depends on daily:

1. Daily Supabase snapshots.
2. `logrotate` for `/var/log/hanu/*.log`.
3. A `/healthz` HTTP endpoint that returns 200 if the agent + DB are reachable.
4. An external uptime monitor (Healthchecks.io free tier) pinging `/healthz` every 5 minutes.
5. Alerts to the user's email + WhatsApp on outage.

---

## Acceptance criteria

- Supabase project has daily automated backups enabled.
- `/var/log/hanu/*.log` files rotate weekly, max 4 weeks of history.
- `https://${HANU_HOST}/healthz` returns 200 OK with body `{"ok": true}` when systems are nominal.
- External monitor pings `/healthz` every 5 minutes; if 2 consecutive pings fail, sends an email to the user.
- A systemd watchdog or healthcheck restarts `hermes-gateway.service` if it crashes (within 30 seconds).

---

## Implementation steps

### Step 1 — Enable Supabase daily snapshots

Supabase dashboard → Project Settings → Database → Backups. Toggle "Daily backups" on.

The Pro tier ($25/mo) includes 7-day retention. The free tier has more limited support — check current Supabase quota. For a personal-Hanu, daily snapshots with 7-day retention is the floor.

Alternatively, run a nightly `pg_dump` on the droplet:

```bash
# /usr/local/bin/hanu-backup.sh
#!/bin/bash
set -e
OUT="/var/backups/hanu/hanu-$(date +%Y%m%d_%H%M%S).sql.gz"
mkdir -p "$(dirname "$OUT")"
pg_dump "$SUPABASE_DB_URL" | gzip > "$OUT"
# Retain last 14 days:
find /var/backups/hanu -name 'hanu-*.sql.gz' -mtime +14 -delete
```

Cron:

```cron
# /etc/cron.d/hanu-backup
0 3 * * * root /usr/local/bin/hanu-backup.sh >/var/log/hanu/backup.log 2>&1
```

For larger DBs, dump only data (`pg_dump --data-only --no-owner`) and apply against a fresh schema on restore.

### Step 2 — Log rotation

`/etc/logrotate.d/hanu`:

```
/var/log/hanu/*.log {
  weekly
  rotate 4
  compress
  delaycompress
  missingok
  notifempty
  create 0640 root root
  sharedscripts
  postrotate
    systemctl reload-or-restart hermes-gateway hanu-reminder-worker hanu-transcription-worker 2>/dev/null || true
  endscript
}
```

Test:

```bash
logrotate -d /etc/logrotate.d/hanu     # dry run
logrotate -f /etc/logrotate.d/hanu     # force a rotation
ls -lh /var/log/hanu/
```

### Step 3 — Healthcheck endpoint

Add a `/healthz` to nginx that proxies to a tiny Python health server, or write a static heartbeat file maintained by Hermes.

Simplest option: a tiny Flask/FastAPI process on the droplet that checks:

```python
# /root/hanu-healthz/server.py
import os, time
from fastapi import FastAPI
from supabase import create_client

app = FastAPI()
sb = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SECRET_KEY"])

LAST_OK = {"at": 0}

@app.get("/healthz")
def healthz():
    # 1) Can we reach Supabase?
    try:
        sb.table("profiles").select("id").limit(1).execute()
    except Exception as e:
        return {"ok": False, "error": f"supabase: {e}"}, 503

    # 2) Is hermes-gateway running? (Read systemd state via dbus, or
    #    check a heartbeat file written by Hermes — simpler.)
    if os.path.exists("/var/run/hermes-gateway.heartbeat"):
        age = time.time() - os.stat("/var/run/hermes-gateway.heartbeat").st_mtime
        if age > 120:
            return {"ok": False, "error": f"hermes heartbeat stale: {age:.0f}s"}, 503

    LAST_OK["at"] = time.time()
    return {"ok": True, "at": LAST_OK["at"]}
```

systemd unit `/etc/systemd/system/hanu-healthz.service`:

```ini
[Unit]
Description=Hanu healthcheck endpoint
After=network.target
[Service]
Type=simple
User=root
EnvironmentFile=/root/.hermes/.env
WorkingDirectory=/root/hanu-healthz
ExecStart=/usr/local/lib/hermes-agent/venv/bin/uvicorn server:app --host 127.0.0.1 --port 8088
Restart=always
[Install]
WantedBy=multi-user.target
```

nginx upstream:

```nginx
server {
  listen 443 ssl http2;
  server_name ${HANU_HOST};
  ...
  location /healthz {
    proxy_pass http://127.0.0.1:8088/healthz;
    proxy_set_header Host $host;
    access_log off;
  }
}
```

Hermes-side heartbeat (touch a file every minute):

```python
# In hermes-agent's main loop, or a periodic hook:
open("/var/run/hermes-gateway.heartbeat", "w").close()
```

Or set up a systemd timer:

```ini
# /etc/systemd/system/hermes-heartbeat.timer
[Unit]
Description=Hermes heartbeat
[Timer]
OnBootSec=30
OnUnitActiveSec=60
[Install]
WantedBy=timers.target

# /etc/systemd/system/hermes-heartbeat.service
[Unit]
Description=Touch hermes heartbeat
[Service]
Type=oneshot
ExecStart=/bin/sh -c 'systemctl --user is-active hermes-gateway && touch /var/run/hermes-gateway.heartbeat'
```

### Step 4 — External monitor

Sign up for Healthchecks.io (free; 20 checks). Create a check pointing to `https://${HANU_HOST}/healthz`. Configure:

- Schedule: every 5 minutes.
- Grace period: 2 minutes (so a single failed ping doesn't alert).
- Notifications: email to `desk.mightyminds@gmail.com`.
- Optional: WhatsApp/Telegram/Discord channels.

(UptimeRobot is a similar alternative.)

### Step 5 — systemd Restart=always

Confirm each unit has `Restart=always` with a sane `RestartSec`. Auto-recovery from crashes is the cheapest reliability win.

```ini
[Service]
Restart=always
RestartSec=10
```

For long-running workers, add `StartLimitBurst=10 StartLimitIntervalSec=60` to prevent crashloop hammering. systemd will give up after 10 restarts in 60s and the external monitor catches it.

### Step 6 — Disk space monitor

```bash
# /etc/cron.d/hanu-disk-check
*/30 * * * * root df -h / | awk 'NR==2 && +$5>80 { exit 1 }' || logger -p user.warning "hanu droplet disk >80%"
```

Pipe `logger` output to a syslog-to-email forwarder, or replace with a healthcheck.io ping that fires on threshold breach.

---

## Verification

```bash
# Backup
ls -lh /var/backups/hanu/
# At least one .sql.gz; run /usr/local/bin/hanu-backup.sh manually and re-check.

# Logrotate
logrotate -f /etc/logrotate.d/hanu
ls /var/log/hanu/*.gz

# Healthz
curl -s "https://${HANU_HOST}/healthz" | jq .
# {"ok": true, "at": ...}

# Force a failure to test alerting:
systemctl --user stop hermes-gateway
sleep 130
curl -s "https://${HANU_HOST}/healthz" | jq .
# {"ok": false, "error": "hermes heartbeat stale..."}
# Healthchecks.io should fire an alert within the grace period.
systemctl --user start hermes-gateway
```

---

## Rollback

Each component is independent. Remove individually:

```bash
systemctl disable --now hanu-healthz
rm /etc/systemd/system/hanu-healthz.service
rm /etc/logrotate.d/hanu
rm /etc/cron.d/hanu-backup
```

Supabase backup toggle stays on (no rollback).

---

## Files touched

- `/etc/logrotate.d/hanu` (new, droplet)
- `/etc/cron.d/hanu-backup` (new, droplet)
- `/etc/cron.d/hanu-disk-check` (new, droplet)
- `/usr/local/bin/hanu-backup.sh` (new, droplet)
- `/root/hanu-healthz/server.py` (new, droplet)
- `/etc/systemd/system/hanu-healthz.service` (new, droplet)
- `/etc/systemd/system/hermes-heartbeat.{service,timer}` (new, droplet)
- nginx config — add `/healthz` location.
- Supabase dashboard — daily backups toggle.
- Healthchecks.io account — check configuration.

---

## Notes

- Healthchecks.io alerts are email-based by default. For louder signal, configure a WhatsApp webhook to ping a different number (not the Hanu bot number — that'd be circular).
- The heartbeat file approach is simple but not real-time. A failing Hermes that hangs without dying won't refresh the heartbeat and will alert within 2 minutes (default grace + 60s heartbeat age threshold). That's acceptable.
- The Supabase free tier may or may not include automated backups depending on current policy — check before paying. If absent, the cron-based `pg_dump` is sufficient for v1.
- Consider sending the daily backup off-droplet (S3, Backblaze B2, or even rsync to your Mac) so a droplet loss doesn't take backups with it. Free tiers exist on both.
