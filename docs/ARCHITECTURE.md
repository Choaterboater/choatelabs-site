# Architecture

`choatelabs-site` is a Cloudflare Worker with three responsibilities:

1. Serve static HTML/CSS/JS for `choatelabs.app` (the marketing site, project landing pages, the LUMINA web game).
2. Serve a tiny JSON API for the LUMINA leaderboard, backed by Cloudflare D1.
3. Pass `/casper/*` through to Casper's site on GitHub Pages.

```
                       ┌───────────────────────────────────────────────┐
   Browser / iOS  ──▶  │  Worker (src/worker.ts)                       │
   (Capacitor WV)      │                                               │
                       │   ┌─────────────────────────────────────┐     │
                       │   │ CORS check (origin allowlist)        │     │
                       │   └────────────────┬────────────────────┘     │
                       │                    │                          │
                       │     ┌──────────────┴───────────────┐          │
                       │     │ /lumina/api/score  POST      │──▶ D1    │
                       │     │ /lumina/api/top    GET       │──▶ D1    │
                       │     │ /lumina/api/*      OPTIONS   │          │
                       │     │ (404 for other api paths)    │          │
                       │     └──────────────────────────────┘          │
                       │                                               │
                       │     /casper/*  GET/HEAD  ──▶  GitHub Pages    │
                       │     everything else  ──▶  env.ASSETS.fetch()  │
                       └───────────────────────────────────────────────┘
```

## Worker entry — `src/worker.ts`

```ts
if (path.startsWith('/lumina/api/') && method === 'OPTIONS') → CORS preflight
if (path === '/lumina/api/score' && method === 'POST')      → handleScorePost
if (path === '/lumina/api/top'   && method === 'GET')       → handleTopGet
if (path.startsWith('/lumina/api/'))                        → 404
if (path === '/casper' || path.startsWith('/casper/'))      → proxyCasper (GitHub Pages)
otherwise                                                   → env.ASSETS.fetch(request)
```

## Casper — `/casper/*`

Casper's site is built and deployed by GitHub Pages from the Casper repo (its `site/` folder), at `https://choaterboater.github.io/casper/`. The Worker forwards `/casper/*` there with the path unchanged, so this repo holds no copy of it: a docs change merged in the Casper repo shows up at `choatelabs.app/casper/` once Pages redeploys.

- Only `GET` and `HEAD` are forwarded; `If-None-Match` / `If-Modified-Since` go along so browsers get `304`s.
- Only `content-type`, `cache-control`, `etag` and `last-modified` come back, plus the usual security headers.
- Pages redirects folders (`/casper` → `/casper/`) with an absolute `github.io` URL; the Worker rewrites that `Location` to a path so visitors stay on `choatelabs.app`.

The `ASSETS` binding is configured in `wrangler.jsonc`:

```jsonc
"assets": {
  "directory": ".",
  "binding": "ASSETS",
  "not_found_handling": "404-page",
  "run_worker_first": ["/lumina/api/*", "/casper", "/casper/*"]
}
```

`run_worker_first` is the list of paths the Worker answers, and it is the whole list: a request for any other path is served from the static files only, and one with no matching file gets `404.html` without the Worker running. A new Worker route has to be added there as well as in `src/worker.ts`.

Wrangler serves every file under the project root *except* anything matched by `.assetsignore`. That ignore file is what keeps `src/`, `functions/`, `wrangler.*`, `DEPLOY.md`, `.git*`, and `lumina-schema.sql` from ever being served as a static asset.

## CORS

The leaderboard is called from two contexts:

- The same-origin web build of LUMINA at `https://choatelabs.app/lumina/`.
- The iOS Capacitor WebView build, which uses `capacitor://localhost` (or `ionic://localhost`) as its origin.

The Worker enforces an allowlist:

```ts
ALLOWED_ORIGINS = {
  'https://choatelabs.app',
  'capacitor://localhost',
  'ionic://localhost',
  'http://localhost',           // dev
}
```

Unknown origins still get CORS headers, but the `Access-Control-Allow-Origin` value defaults back to `https://choatelabs.app`, which causes the browser to block the response — same effect as denying. This is intentional: the WebView's preflight on a non-simple POST will fail without explicit CORS, silently dropping every score submit, so we err on the side of *always* sending headers.

## D1 schema

Database name: `lumina-leaderboard` (binding `LUMINA_DB`).

```sql
scores         -- all-time global, one row per submitted run
scores_daily   -- daily challenge, UNIQUE (challenge_date, player_id) → best run per day
submit_log     -- player_id + sha256(ip) + timestamp for rate-limit / sanity
```

Indexes target the two hot queries: top-N by score (descending) and lookup-by-player. See `lumina-schema.sql` for the canonical definitions.

## Request flow — score submit

1. Game client POSTs JSON to `/lumina/api/score` with `{ player_id, initials, score, combo, duration_ms, perfects }`.
2. Worker accepts the preflight (`OPTIONS`) with CORS headers.
3. `handleScorePost` validates payload shape, checks `submit_log` for abusive frequency, hashes the IP, inserts into `scores` (and `scores_daily` if today's challenge), records to `submit_log`.
4. Response is wrapped with `withCors(...)` so the WebView accepts it.

## Request flow — top-N

1. Game client GETs `/lumina/api/top?board=global|daily&limit=N`.
2. `handleTopGet` runs a `SELECT … ORDER BY score DESC LIMIT N` against the appropriate table.
3. Response is JSON; cached by the browser per its own headers.

## Why a Worker (and not Pages)?

The site started life on Cloudflare Pages (see [../DEPLOY.md](../DEPLOY.md) for the original walkthrough). It moved to a Worker once LUMINA needed a leaderboard:

- Pages Functions could host the leaderboard, but staying on Workers lets the static assets and the API share one deploy, one config file, one custom domain, and one `wrangler deploy`.
- The `ASSETS` binding means we still get the "drop static files and they're served" simplicity of Pages.
- Same TLS story — Cloudflare provisions the cert for `choatelabs.app` automatically.
