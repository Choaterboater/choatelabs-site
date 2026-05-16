# Contributing

`choatelabs-site` is a small personal repo, but PRs and issues are welcome.

## Development setup

```bash
git clone https://github.com/Choaterboater/choatelabs-site.git
cd choatelabs-site

# static-only preview (no Worker, no D1)
python3 -m http.server 8000
# open http://localhost:8000/

# full-stack preview (Worker + D1)
npm install -g wrangler
wrangler login
wrangler d1 execute lumina-leaderboard --file=lumina-schema.sql --local
wrangler dev
```

The static pages have no build step — edit HTML/CSS/JS in place and refresh.

## Deploy

```bash
wrangler deploy
```

The first time, also apply the schema to the remote D1:

```bash
wrangler d1 execute lumina-leaderboard --file=lumina-schema.sql --remote
```

## Style

- Stick to vanilla HTML / CSS / JS — no framework, no build step. The whole point of this repo is "edit, save, deploy."
- Inline styles are fine inside `<style>` blocks per page; keep CSS variables consistent with the design tokens at the top of `index.html` (`--noir`, `--chalk`, `--copper`, `--mint`, `--amber`, `--iris`, `--slate`).
- Worker code in `src/` and `functions/` is TypeScript, strict. Use `_shared.ts` for cross-handler helpers.
- Don't add files that shouldn't be served as static assets without updating `.assetsignore`.

## App Store URLs

The Swift apps reference exact paths under `/<project>/`:

| App                  | Required URLs                                                                                                   |
| -------------------- | --------------------------------------------------------------------------------------------------------------- |
| MAC Vendor Lookup    | `/mac-vendor-lookup/`, `/mac-vendor-lookup/privacy.html`, `/mac-vendor-lookup/support.html`                     |
| RackBeacon           | `/rackbeacon/`, `/rackbeacon/privacy.html`, `/rackbeacon/support.html`                                          |
| LUMINA: Neon Orbit   | `/lumina/`                                                                                                       |

Don't rename these or move them between Apple-review submissions — App Store Connect caches the URLs and the next submission will fail if they 404 or 301 elsewhere.

## Commit messages

Conventional-ish, present tense, scope optional:

```
feat(lumina): add daily challenge endpoint
fix(worker): preserve status on CORS-wrapped responses
docs: explain D1 schema in ARCHITECTURE.md
```

## Reporting issues

Include: the URL or request that's broken, what you expected, and (for API issues) the response body. Worker observability is enabled — if you have access to the Cloudflare dashboard, paste the relevant log lines.
