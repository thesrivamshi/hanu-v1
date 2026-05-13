# 01 — Auth: HTTPS + magic-link, remove hardcoded password

**Priority:** P0 (critical security)
**Effort:** 4-6 hours
**Depends on:** none
**Status:** TODO
**Risk if skipped:** anyone scanning `168.144.30.107` can `curl http://168.144.30.107/supabase-client.jsx`, harvest the bootstrap email + password, log in as the user, and read every row in `memories`, `messages`, `promises`, etc. RLS doesn't help because the attacker becomes the legitimate `auth.uid()`.

---

## Context

Today, `hanu-v1/project/supabase-client.jsx:16-20` ships:

```js
const HANU_BOOTSTRAP_EMAIL = "desk.mightyminds@gmail.com";
const HANU_BOOTSTRAP_PASSWORD = "Hanu_Initial_Vamshi_2026_change_me";
```

These travel to the browser in plain JavaScript over HTTP (no TLS). The droplet IP is in IPv4 space; banner-grabbing scanners hit it within hours of going up. Once anyone has the credentials, the anon publishable key plus `signInWithPassword` gets them through RLS as the user.

The fix has two parts:
1. Replace password auth with magic-link (email OTP) so no long-lived secret lives in the browser.
2. Put nginx behind a real TLS cert so the auth flow itself isn't sniffable.

---

## Acceptance criteria

- `curl http://168.144.30.107/supabase-client.jsx` returns either an HTTPS redirect or 404 (no plaintext password in the response body).
- `curl https://<host>/supabase-client.jsx | grep -i password` finds nothing matching `Hanu_Initial_*` or any other live credential.
- Opening `https://<host>/` in a fresh browser prompts for the user's email, sends a magic link, and only signs in after the link is clicked.
- The current Supabase auth password has been rotated via dashboard.
- `https://<host>/` has a valid Let's Encrypt cert (`curl -vI https://<host>/ 2>&1 | grep -i 'subject\|issuer'` confirms).
- HTTP traffic to the host either redirects to HTTPS or refuses connection.

---

## Implementation steps

### Step 1 — Choose a hostname

Option A (recommended): use a free DDNS hostname pointing at `168.144.30.107`. Pick one from DuckDNS (`<chosen>.duckdns.org`) or no-ip.com. Let's Encrypt does not issue certs for raw IPs, only hostnames.

Option B (later): buy a real domain (Porkbun, Namecheap, ~$10/yr) and point its A record at the droplet. Same cert flow.

Record the chosen hostname; below, refer to it as `${HANU_HOST}`.

### Step 2 — Install certbot and provision the cert

On the droplet, as root:

```bash
apt-get update
apt-get install -y certbot python3-certbot-nginx
certbot --nginx -d "${HANU_HOST}" --non-interactive --agree-tos --email desk.mightyminds@gmail.com --redirect
```

`--redirect` tells certbot to add an HTTP→HTTPS 301 redirect to the nginx config automatically. Verify:

```bash
nginx -t
systemctl reload nginx
curl -I "http://${HANU_HOST}/" | grep -i location   # should show 'Location: https://...'
curl -I "https://${HANU_HOST}/" | head -3            # should be 200 OK
```

Certbot installs a daily renewal timer (`systemctl list-timers | grep certbot`).

### Step 3 — Rotate the Supabase auth password

Independent of the code change, the existing password is compromised by virtue of having lived in a public JS file. In Supabase dashboard:

1. Authentication → Users → `desk.mightyminds@gmail.com` → "Send password reset".
2. Click the link from the email, set a new strong password.
3. Do **not** put the new password anywhere in code.

### Step 4 — Migrate `supabase-client.jsx` to magic-link

Replace the bootstrap block (`supabase-client.jsx:16-49`) with a magic-link flow. Concrete diff sketch:

```js
// REMOVE these lines:
const HANU_BOOTSTRAP_EMAIL = "desk.mightyminds@gmail.com";
const HANU_BOOTSTRAP_PASSWORD = "Hanu_Initial_Vamshi_2026_change_me";

// REPLACE the ensureSignedIn() body with:
async function ensureSignedIn() {
  const { data: { session } } = await sb.auth.getSession();
  if (session && session.user) return session;

  // No session and no in-flight magic link → show the login surface.
  // The login surface is a tiny full-screen overlay defined in app.jsx
  // (or kept inline here for simplicity). It prompts for email, then calls:
  //
  //   await sb.auth.signInWithOtp({
  //     email,
  //     options: { emailRedirectTo: window.location.origin }
  //   });
  //
  // Supabase sends the magic link; user clicks it; Supabase redirects back
  // to the origin with the access_token in the URL fragment. Supabase JS
  // picks it up via detectSessionInUrl (on by default) and stores it.
  //
  // For v1 we just throw a sentinel error and let app.jsx render the login
  // screen.
  throw new Error("AUTH_REQUIRED");
}
```

Add a `LoginScreen` component in `app.jsx`. Render it instead of the dashboard when `hanuLoad()` throws `AUTH_REQUIRED`:

```jsx
function LoginScreen() {
  const [email, setEmail] = React.useState("");
  const [sent, setSent] = React.useState(false);
  const [err, setErr] = React.useState(null);

  async function submit(e) {
    e.preventDefault();
    setErr(null);
    const { error } = await window.sb.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.origin },
    });
    if (error) setErr(error.message);
    else setSent(true);
  }

  if (sent) return <div className="login">Check your email for the link.</div>;
  return (
    <form className="login" onSubmit={submit}>
      <h1>Hanu</h1>
      <input type="email" required value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com"/>
      <button type="submit">Send link</button>
      {err && <p className="err">{err}</p>}
    </form>
  );
}
```

Update the `useEffect` in `App()` so a thrown `AUTH_REQUIRED` flips a state flag and renders `<LoginScreen/>` instead of the canvas.

### Step 5 — Configure Supabase URL allow-list

In Supabase dashboard → Authentication → URL Configuration:
- Site URL: `https://${HANU_HOST}/`
- Redirect URLs: `https://${HANU_HOST}/`

Magic links pointing at any URL not in this list will fail. The bootstrap password worked without this; magic link does not.

### Step 6 — Deploy and smoke test

```bash
# On dev machine:
rsync -av hanu-v1/project/ root@168.144.30.107:/var/www/hanu/
# (or whichever docroot nginx uses)

# On droplet, verify:
curl -s "https://${HANU_HOST}/supabase-client.jsx" | grep -i 'password\|bootstrap_email' && echo "FAIL: secrets still in file" || echo "OK: clean"
```

Open `https://${HANU_HOST}/` in a private browser window. Confirm the login surface renders. Enter the user's email. Confirm the magic link arrives. Click it. Confirm the dashboard loads and a session persists in `localStorage` (key `hanu-auth`).

### Step 7 — Optional hardening

- Restrict the `auth.users` allowed signup to just the user's email (Supabase dashboard → Authentication → Providers → Email → "Disable signups" once the user exists; magic link to existing users still works).
- Set `sb.auth.signOut` on a logout button in `SettingsScreen`.

---

## Verification

```bash
# 1) HTTPS works
curl -fsSI "https://${HANU_HOST}/" >/dev/null && echo "HTTPS OK"

# 2) HTTP redirects
test "$(curl -s -o /dev/null -w '%{http_code}' "http://${HANU_HOST}/")" = "301" && echo "HTTP→HTTPS redirect OK"

# 3) No secrets in JS bundle
curl -s "https://${HANU_HOST}/supabase-client.jsx" \
  | grep -E "BOOTSTRAP_PASSWORD|Hanu_Initial_Vamshi_2026|signInWithPassword" \
  && echo "FAIL: bundle still references hardcoded auth" || echo "OK: bundle clean"

# 4) Cert is real
echo | openssl s_client -connect "${HANU_HOST}:443" -servername "${HANU_HOST}" 2>/dev/null \
  | openssl x509 -noout -issuer -subject -dates
```

End-to-end: open the URL in a fresh private window; sign in via magic link; confirm dashboard loads; check `localStorage["hanu-auth"]` contains a valid session.

---

## Rollback

If magic link fails because of misconfigured Supabase URL allow-list and the user is locked out:

1. In Supabase dashboard → Authentication → Users, set a fresh strong password for the user.
2. Temporarily restore the `signInWithPassword` path in `supabase-client.jsx` using the new password.
3. Diagnose and re-apply.

Do not roll back the certbot install; HTTPS-only is the new minimum.

---

## Files touched

- `hanu-v1/project/supabase-client.jsx` — remove bootstrap credentials, change auth flow.
- `hanu-v1/project/app.jsx` — add `LoginScreen` render branch.
- `hanu-v1/project/styles.css` — add minimal `.login` styles.
- nginx config on droplet — added by certbot.
- Supabase dashboard — URL allow-list, password rotation.

---

## Notes for future maintenance

- Cert renews automatically via `certbot.timer`. Verify with `systemctl list-timers | grep certbot` at least quarterly.
- If you ever switch hostnames (DDNS → real domain), update both the Supabase URL allow-list and re-run `certbot --nginx -d <new-host>`.
- Magic link emails come from Supabase's default sender (`noreply@mail.app.supabase.io`). For a more trustworthy sender, configure SMTP in Supabase Auth settings later.
