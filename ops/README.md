# ops/

Deploy artifacts for the droplet at `168.144.30.107`. Each file lives at the path indicated; the end-of-session runbook (see `docs/deploy-master.md` once committed) copies them into place.

## Layout

| Path | Destination | What |
|---|---|---|
| `systemd/hanu-reminder-worker.service` | `/etc/systemd/system/` | Fire + follow-up + recovery worker (tasks 5/6). |
| `systemd/hanu-transcription-worker.service` | `/etc/systemd/system/` | Voice-note Whisper worker (task 11). |
| `systemd/hanu-healthz.service` | `/etc/systemd/system/` | FastAPI /healthz (task 23). |
| `systemd/hermes-heartbeat.{service,timer}` | `/etc/systemd/system/` | Touches `/var/run/hermes-gateway.heartbeat` every 60s. |
| `nginx/hanu.conf` | `/etc/nginx/sites-available/hanu` (symlink into sites-enabled) | TLS-enabled vhost. |
| `cron/hanu-backup.sh` | `/usr/local/bin/hanu-backup.sh` | Nightly pg_dump. |
| `cron/hanu-backup` | `/etc/cron.d/hanu-backup` | Cron entry + disk alarm. |
| `logrotate/hanu` | `/etc/logrotate.d/hanu` | Weekly rotation of `/var/log/hanu/*.log`. |
| `healthz/server.py` | `/root/hanu-healthz/server.py` | FastAPI app (run by hanu-healthz.service). |

## Install order

1. Make `/var/log/hanu` and `/var/backups/hanu` directories.
2. Copy each file to its destination.
3. `chmod +x /usr/local/bin/hanu-backup.sh`.
4. `systemctl daemon-reload`.
5. Enable: `systemctl enable --now hanu-reminder-worker hanu-transcription-worker hanu-healthz hermes-heartbeat.timer`.
6. nginx: `nginx -t && systemctl reload nginx`.
7. External monitor: create a Healthchecks.io check pointing at `https://${HANU_HOST}/healthz`, 5-minute schedule, 2-minute grace.

## Daily Supabase backups

Enable in Supabase dashboard → Project Settings → Database → Backups (toggle on). The cron-based dump in `cron/hanu-backup.sh` is a belt-and-suspenders against dashboard mishap or paid-tier issues. Off-droplet replication is your call.
