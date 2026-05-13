# Deploy: Task 01 — HTTPS + magic-link auth

This is the **ops half** of `tasks/01-auth-https-magic-link.md`. The code-side
work (removing the hardcoded password and switching the browser client to
magic-link) is already in this repo. What follows is the work that has to
happen on the droplet and in the Supabase dashboard. Until every step below is
done, the production site is **still vulnerable** even though the code change
is merged.

Run the steps in order. Do not skip the smoke tests at the end.

---

## 0. Inputs you need before you start

- SSH access to the droplet at `168.144.30.107` (assumed user `root`; adjust
  if you use a non-root sudo user).
- Owner/admin access to the Supabase project
  `lcayzfqmemitlbjugbsq.supabase.co`.
- A hostname you control that points (A record) at `168.144.30.107`. The
  rest of this doc uses `hanu.example.com` as a placeholder — replace
  every occurrence with your real hostname before running commands.
- Inbox access for `desk.mightyminds@gmail.com` (you'll click the magic
  link at the end).

---

## 1. Point a hostname at the droplet

1. In your DNS provider, create an `A` record:
   - **Name:** `hanu` (or whatever subdomain you want)
   - **Type:** `A`
   - **Value:** `168.144.30.107`
   - **TTL:** 300 (5 min) while you're setting this up; raise later.
2. Wait for propagation, then verify:

   ```bash
   dig +short hanu.example.com
   # expected: 168.144.30.107
   ```

Do not proceed until `dig` returns the droplet IP. certbot's HTTP-01
challenge will fail otherwise.

---

## 2. Install Let's Encrypt cert with certbot

SSH into the droplet, then run:

```bash
ssh root@168.144.30.107

# Install certbot + nginx plugin (Ubuntu/Debian)
apt-get update
apt-get install -y certbot python3-certbot-nginx

# Make sure nginx is running and serving the existing site on :80
systemctl status nginx

# Request and install the cert. Replace the hostname and email.
certbot --nginx \
  -d hanu.example.com \
  --non-interactive \
  --agree-tos \
  --redirect \
  -m you@your-real-email.com
```

What `--redirect` does: certbot rewrites the existing nginx server block so
plain HTTP (`:80`) issues a `301` to HTTPS. That satisfies one of the
acceptance criteria ("HTTP traffic to the host either redirects to HTTPS or
refuses connection").

Verify renewal is wired up:

```bash
systemctl list-timers | grep certbot
# expected: certbot.timer active, next run within ~12h
```

Test a dry-run renew so you find out *now* if anything is broken:

```bash
certbot renew --dry-run
```

---

## 3. Confirm nginx config looks right

Open `/etc/nginx/sites-enabled/` (or wherever your active config lives) and
sanity-check that:

- There's a `server` block listening on `443 ssl` with the certbot-managed
  `ssl_certificate` / `ssl_certificate_key` paths under
  `/etc/letsencrypt/live/hanu.example.com/`.
- The `:80` server block does `return 301 https://$host$request_uri;` (or
  similar). certbot adds this automatically with `--redirect`.
- The `server_name` matches the hostname you certified.

Reload after any edits:

```bash
nginx -t && systemctl reload nginx
```

---

## 4. Rotate the Supabase auth password

The old password (`Hanu_Initial_Vamshi_2026_change_me`) was shipped in
`supabase-client.jsx` over plain HTTP. Treat it as compromised.

1. Open the Supabase dashboard → **Authentication → Users**.
2. Find the user with id `d804b9ed-5eaa-497c-8390-86ba02007a33`
   (email `desk.mightyminds@gmail.com`).
3. Use **"Send password recovery"** *or* "Reset password" to set a new
   password. The new password is never stored in this repo and is never
   needed by the browser client — magic-link is the only sign-in path
   from now on. You only need a password at all to keep the account
   recoverable from the dashboard.
4. Save the new password in your password manager. Do not commit it
   anywhere.

---

## 5. Configure Supabase URL allow-list (so magic links work)

Magic links only succeed if Supabase recognizes the redirect target.

1. Supabase dashboard → **Authentication → URL Configuration**.
2. Set **Site URL** to your HTTPS origin, e.g.
   `https://hanu.example.com`.
3. Under **Redirect URLs**, add:
   - `https://hanu.example.com`
   - `https://hanu.example.com/*` (covers any path the app might land on)
4. Save.

While you're in Auth settings:

5. Under **Providers → Email**, confirm **"Enable Email provider"** is on
   and **"Confirm email"** is on.
6. Under **Email Templates → Magic Link**, sanity-check the template —
   the `{{ .ConfirmationURL }}` placeholder should be present.

---

## 6. Deploy the new code

How exactly you deploy depends on your existing pipeline. The files that
must reach the droplet are:

- `hanu-v1/project/supabase-client.jsx`
- `hanu-v1/project/app.jsx`
- `hanu-v1/project/styles.css`

If you `rsync` directly:

```bash
rsync -avz --delete \
  /local/path/Hanu-v1/hanu-v1/project/ \
  root@168.144.30.107:/var/www/hanu/project/
```

Then bust browser caches by either bumping the asset query strings in
`index.html` or hard-reloading your test browser.

---

## 7. Smoke tests (all must pass before declaring done)

Run from a machine that is **not** the droplet.

### 7a. No plaintext password on either protocol

```bash
# HTTP should redirect to HTTPS (or refuse). It must NOT serve the JS.
curl -sS -o /dev/null -w "%{http_code}\n" http://hanu.example.com/supabase-client.jsx
# expected: 301 or 308 (redirect), or connection refused

# HTTPS should serve the JS but with no live password in the body.
curl -sS https://hanu.example.com/supabase-client.jsx | grep -i -E "(password|Hanu_Initial_)"
# expected: no output. If you see HANU_BOOTSTRAP_PASSWORD anywhere, the
# deploy didn't ship the new file.
```

### 7b. Bypass-by-IP should not serve credentials

```bash
curl -sS http://168.144.30.107/supabase-client.jsx | grep -i -E "(password|Hanu_Initial_)"
# expected: no output. Either the IP-based vhost doesn't exist anymore,
# or it serves the new (passwordless) JS.
```

### 7c. Cert is valid

```bash
echo | openssl s_client -connect hanu.example.com:443 -servername hanu.example.com 2>/dev/null \
  | openssl x509 -noout -issuer -dates
# expected: issuer is Let's Encrypt, notAfter is ~90 days out
```

### 7d. Magic-link flow end-to-end

1. Open a **fresh browser profile** (or incognito) at
   `https://hanu.example.com/`.
2. You should see the login screen (Hanu mark + "Send magic link"
   button), not the dashboard.
3. Enter `desk.mightyminds@gmail.com`. Click **Send magic link**.
4. The UI should switch to the "Check your email" confirmation state.
5. Open the Gmail inbox. Click the magic link.
6. The browser should land back on `https://hanu.example.com/` and load
   the dashboard (Today screen, sidebar, your real data).

### 7e. Old password no longer works

If you kept the old password in a password manager just for this test,
open the Supabase dashboard → Authentication → and try to sign in via
SQL editor / API with the *old* credentials. It must fail. Then forget
the old password.

---

## 8. Optional hardening (do these soon, not necessarily today)

- Add HSTS to nginx: `add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;` inside the `:443` server block. Reload nginx.
- Add a `Content-Security-Policy` header limiting where scripts can load
  from (allow the Supabase CDN, your own origin, and the Babel CDN).
- Lock the Supabase project to email provider only — disable any unused
  social providers in the dashboard.
- Set up an uptime monitor (e.g. UptimeRobot, BetterStack) that pings
  `https://hanu.example.com/` and alerts on cert expiry < 7 days.

---

## Rollback plan

If something goes wrong post-deploy and the login screen wedges users
out:

1. SSH into the droplet.
2. Restore the previous `project/` directory from your deploy backup
   (or `git checkout` the prior commit and rsync again).
3. Reload nginx — no config change needed, just static files.
4. The browser will still try to use magic-link if the rolled-back code
   includes it; if you rolled back to a pre-task-01 version, users will
   hit the old (hardcoded) auth path again. That is bad but is at least
   a known state. Fix forward as fast as possible.

The cert itself is independent — once installed, rolling back app code
does not invalidate it.

---

## Done criteria recap

You're done with Task 01 only when **all** of these are true:

- [ ] DNS A record for the hostname resolves to `168.144.30.107`.
- [ ] `https://hanu.example.com/` loads with a valid Let's Encrypt cert.
- [ ] `http://hanu.example.com/...` redirects to HTTPS.
- [ ] `curl https://hanu.example.com/supabase-client.jsx | grep -i password` returns nothing.
- [ ] `curl http://168.144.30.107/supabase-client.jsx | grep -i password` returns nothing.
- [ ] Supabase user's password has been rotated via dashboard.
- [ ] Supabase Site URL + Redirect URLs include `https://hanu.example.com`.
- [ ] Fresh-browser test signs in successfully via magic link.
- [ ] certbot renewal dry-run passes.
