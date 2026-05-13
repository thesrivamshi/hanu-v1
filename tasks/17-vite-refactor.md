# 17 — Move UI from Babel-in-browser to Vite build

**Priority:** P3 (visible only as load latency; not breaking)
**Effort:** 1-2 days
**Depends on:** none (do after 16 so the build picks up the cleaned-up code)
**Status:** TODO
**Risk if skipped:** every page load downloads ~1MB of Babel Standalone + React dev + every `.jsx` file unminified, then compiles in the browser. First load on a 4G mobile network in India is 3-5 seconds. For a personal-OS dashboard opened many times per day, this is the most-felt friction.

---

## Context

`hanu-v1/project/index.html` currently loads:

```html
<script src="https://unpkg.com/react@18.3.1/umd/react.development.js"></script>
<script src="https://unpkg.com/react-dom@18.3.1/umd/react-dom.development.js"></script>
<script src="https://unpkg.com/@babel/standalone@7.29.0/babel.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.0/dist/umd/supabase.min.js"></script>
<script type="text/babel" src="data.jsx"></script>
<script type="text/babel" src="supabase-client.jsx"></script>
...
```

Files are loaded unminified, Babel runs in the browser, and the React dev build is shipped. A real build pipeline produces a single bundle (~150-200KB gzipped) that loads in 200-400ms on the same network.

Vite is the right choice: zero-config for plain React, fast HMR for development, single command to build for production. Migrating doesn't change the React code — only how it's compiled and served.

---

## Acceptance criteria

- `hanu-v1/project/` becomes a Vite app: `package.json`, `vite.config.js`, `src/` layout.
- `npm run build` produces a static `dist/` directory under 250KB gzipped.
- `dist/` is what nginx serves (replacing the current `project/` docroot).
- Functionality unchanged: every screen renders, auth flow works, realtime updates fire.
- Local dev: `npm run dev` serves the app on `localhost:5173` with HMR.
- Source maps included in production for debuggability (optional but recommended).

---

## Implementation steps

### Step 1 — Scaffold a Vite project alongside the prototype

Don't overwrite `hanu-v1/project/` immediately. Create a parallel `hanu-v1/ui/` and migrate:

```bash
cd /Users/srivamshi/MyDrafts/Hanu-v1/hanu-v1
npm create vite@latest ui -- --template react
cd ui
npm install
```

Choose plain JS (not TS) for v1 to keep the migration mechanical. TS conversion is a separate task.

### Step 2 — Install runtime deps

```bash
cd hanu-v1/ui
npm install @supabase/supabase-js
```

(React + ReactDOM come with the template.)

### Step 3 — Move source files

```bash
# From hanu-v1/project/ to hanu-v1/ui/src/
cp ../project/ambient.jsx       src/
cp ../project/app.jsx           src/
cp ../project/data.jsx          src/
cp ../project/modals.jsx        src/
cp ../project/screens-a.jsx     src/
cp ../project/screens-b.jsx     src/
cp ../project/screens-c.jsx     src/
cp ../project/shared.jsx        src/
cp ../project/supabase-client.jsx src/
cp ../project/tweaks-panel.jsx  src/
cp ../project/styles.css        src/
```

### Step 4 — Convert global-window pattern to ES modules

The current files use `window.HANU`, `window.sb`, etc. as a poor-man's module system. Convert to imports/exports:

#### Files that defined globals:
- `data.jsx` → `export const HANU = {...}; export const TONE_COPY = {...};`
- `supabase-client.jsx` → `export const sb = ...; export async function hanuLoad() {...}` etc.
- `shared.jsx` → already exports React components implicitly (since this is a single-file pattern); make them explicit exports.
- `ambient.jsx` → `export function Ambient(...)`
- `tweaks-panel.jsx` → `export function TweaksPanel(...)`
- `app.jsx` → keep `App` as the default export.

#### Files that referenced globals:
- Add `import { HANU, TONE_COPY } from "./data.jsx";` to `screens-a.jsx`, `screens-b.jsx`, `screens-c.jsx`, `modals.jsx`, `shared.jsx`, `app.jsx`.
- Add `import { sb, hanuLoad, hanuSubscribe } from "./supabase-client.jsx";` where needed.
- `app.jsx` imports `Ambient`, `Sidebar` (local), `Topbar` (local), screens, modals, `TweaksPanel`.

#### Entry point

Replace `index.html` script loads with a single ES module entry. Create `src/main.jsx`:

```jsx
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./app.jsx";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
```

And update `index.html` (Vite-generated default already has it):

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Hanu — Personal Operating System</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Geist:wght@300;400;500;600;700&family=Geist+Mono:wght@400;500&display=swap" rel="stylesheet">
</head>
<body>
  <div id="root"></div>
  <script type="module" src="/src/main.jsx"></script>
</body>
</html>
```

### Step 5 — Env vars for Supabase

Move the (now non-secret, post-task-01) Supabase URL + publishable key to `.env.local`:

```
VITE_SUPABASE_URL=https://lcayzfqmemitlbjugbsq.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_NS72CcCYk7THrdm0JzCIMw_UG2Joy3j
```

In `supabase-client.jsx`:

```js
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_PUBLISHABLE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
```

Vite inlines `VITE_*` vars at build time. The publishable (anon) key is **safe** to ship in the bundle (it's designed for that, and RLS protects the data — assuming task 01 has removed the password). Do not put service-role keys in `VITE_*` env vars.

### Step 6 — Vite config

`hanu-v1/ui/vite.config.js`:

```js
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    sourcemap: true,
    outDir: "dist",
    target: "es2020",
  },
  server: {
    port: 5173,
    host: "127.0.0.1",
  },
});
```

### Step 7 — Build and deploy

```bash
cd hanu-v1/ui
npm run build
# Produces dist/index.html, dist/assets/*.js, dist/assets/*.css

# Copy to droplet:
rsync -av dist/ root@168.144.30.107:/var/www/hanu/
# (Or update nginx to point at this directory)
```

Verify nginx config (`/etc/nginx/sites-available/hanu`):

```nginx
server {
  listen 443 ssl http2;
  server_name ${HANU_HOST};
  root /var/www/hanu;
  index index.html;

  ssl_certificate /etc/letsencrypt/live/${HANU_HOST}/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/${HANU_HOST}/privkey.pem;

  # SPA fallback
  location / {
    try_files $uri /index.html;
  }

  # Long-cache for hashed assets
  location /assets/ {
    expires 1y;
    add_header Cache-Control "public, immutable";
  }
}
```

### Step 8 — Retire the prototype

After verifying production works:

```bash
mv hanu-v1/project hanu-v1/project.bak  # keep for one week
# After confirmation:
rm -rf hanu-v1/project.bak
mv hanu-v1/ui hanu-v1/project           # rename so the path stays familiar
```

### Step 9 — Update docs

`CLAUDE.md` — the bullet "The UI is **static HTML+JSX served raw** — Babel compiles in-browser" is now wrong. Replace with:

```markdown
The UI is a Vite + React app in `hanu-v1/project/`. Build with `npm run build`;
deploy `dist/` to nginx's docroot on the droplet.
```

---

## Verification

```bash
# Build succeeds and stays under budget:
cd hanu-v1/ui
npm run build
du -sh dist/
# Expected: under 1 MB total, under 250 KB gzipped

# Static check: no Babel runtime in bundle
grep -l "@babel/standalone" dist/assets/*.js
# Expected: no matches

# Smoke load times:
curl -o /dev/null -s -w "%{time_total}s\n" "https://${HANU_HOST}/"
# Expected: under 0.5s for the HTML

# Production smoke test in browser:
# - Auth works
# - All 12 screens render (or however many remain after task 19)
# - Real-time push still arrives
# - Tweaks panel state persists in localStorage
```

---

## Rollback

```bash
# On droplet:
rsync -av /var/www/hanu.bak/ /var/www/hanu/
# Restore the old static-HTML serve path.
```

Keep the `project.bak` directory for at least a week so this rollback is one rsync away.

---

## Files touched

- `hanu-v1/ui/` — new directory (becomes `hanu-v1/project/` after step 8).
- `hanu-v1/project/` — replaced by the build output and source.
- `.env.local` — add `VITE_*` vars.
- `.gitignore` — add `node_modules`, `dist`, `.env*` exclusions.
- nginx config on droplet — point at `/var/www/hanu` (built assets).
- `CLAUDE.md`, `BRIDGE_DESIGN.md` — update narrative.

---

## Notes

- Don't migrate to Next.js as the same task. Vite is the smaller jump from Babel-in-browser and gets 80% of the value. Next.js makes sense later when you need server-side rendering or API routes.
- The "Babel-in-browser" version uses React 18.3.1 development build. The Vite default uses React 19. If you want to stay on 18 to minimize surprise, pin React in `package.json` to `^18.3.0`.
- After this task, the project has a `package.json` for the first time. Set up dependabot or renovate-bot to flag dependency updates.
- The current `<script type="text/babel">` pattern means JSX is being parsed at runtime. ES modules with `.jsx` extension via Vite require correct file-by-file plugin handling — the React plugin handles `.jsx` automatically.
