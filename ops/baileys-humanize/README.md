# Baileys humanize patch

The Baileys bridge that pairs Hanu with WhatsApp lives on the droplet, not in this repo. To reduce WhatsApp ban risk we want every outbound message to:

1. Wait a randomized 1.5-6s before sending (proportional to message length).
2. Set presence to `composing` (typing indicator) during the wait.
3. Honor an `urgent` flag that bypasses the delay (e.g., non-negotiable reminders).
4. Skip the delay entirely when the env var `HANU_HUMANIZE=off`.

## What to add

Copy `humanize.js` to the Baileys-bridge project root (next to `package.json`) and import it. Then replace **every** `sock.sendMessage(jid, content)` call with `sendHuman(sock, jid, content)` (and optionally `{ urgent: true }`).

## Apply

```bash
# On the droplet (path may differ; find with: find / -name 'package.json' -path '*baileys*'):
cd /root/hanu-baileys   # or wherever the bridge lives
# Drop humanize.js next to your other modules:
curl -L "https://raw.githubusercontent.com/thesrivamshi/hanu-v1/main/ops/baileys-humanize/humanize.js" -o humanize.js

# Patch index.js / message-handler.js to import sendHuman and call it instead
# of sock.sendMessage. Diff sketch:
#
#   + const { sendHuman } = require('./humanize');
#   - await sock.sendMessage(jid, content);
#   + await sendHuman(sock, jid, content);

# Configure (defaults are fine; disable for tests):
echo "HANU_HUMANIZE=on" >> /etc/default/hanu-baileys   # or however env is fed

systemctl restart hanu-baileys   # whichever unit runs the bridge
```

## Verification

Tail the bridge log:

```bash
journalctl -fu hanu-baileys | grep -i 'typing for'
```

Send 5 messages to the bot rapidly. Expect each response to arrive 1.5–6s after sending; delays should vary; long replies wait longer than short ones; the bot's profile briefly shows "typing…" before each reply.

## Toggle off

`systemctl set-environment HANU_HUMANIZE=off && systemctl restart hanu-baileys`.

## Note

WhatsApp does not publish its bot-detection rules. The values here (1.5-6s window, 20-40ms/char) are community best practice as of late 2025. Tune from observed bans. For volumes above ~50 messages/day across multiple users, migrate to the official Meta WhatsApp Business API.
