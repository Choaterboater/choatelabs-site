# choatelabs-site

Source for [**choatelabs.app**](https://choatelabs.app/) — the personal site of Stephen Choate and the landing pages for Choate Labs projects. Static HTML/CSS/JS deployed to Cloudflare Workers (with an `ASSETS` static-assets binding) plus a tiny Worker that serves the LUMINA leaderboard API.

No build step, no framework. The homepage centerpiece is an interactive Three.js graph of the projects (`assets/lab-graph.js`, with Three.js vendored under `assets/vendor/` so there's no CDN dependency).

---

## What's here

| Path                          | Lives at                                   | What it is                                                                 |
| ----------------------------- | ------------------------------------------ | -------------------------------------------------------------------------- |
| `index.html`                  | `choatelabs.app/`                          | Landing page — intro, interactive project graph, numbered project index   |
| `about.html`                  | `choatelabs.app/about.html`                | About page                                                                 |
| `404.html`                    | served on unknown paths                    | Custom 404                                                                 |
| `assets/`                     | `choatelabs.app/assets/`                   | Shared stylesheet (`site.css`), project graph (`lab-graph.js`), vendored Three.js |
| `lumina/`                     | `choatelabs.app/lumina/`                   | LUMINA: Neon Orbit — web-native arcade game (PWA, App Store linked)        |
| `mac-vendor-lookup/`          | `choatelabs.app/mac-vendor-lookup/`        | Landing + privacy/support pages for the MAC Vendor Lookup iOS app          |
| `rackbeacon/`                 | `choatelabs.app/rackbeacon/`               | Landing + privacy/support pages for RackBeacon                             |
| `voltanode/`                  | `choatelabs.app/voltanode/`                | Landing page for VoltaNode                                                 |
| `choatelab/`                  | `choatelabs.app/choatelab/`                | Landing page for [ChoateLab](https://github.com/Choaterboater/ChoateLab) (self-hosted home-lab dashboard) |
| `src/worker.ts`               | Cloudflare Worker entry                    | Routes `/lumina/api/*` → leaderboard handlers; everything else → static    |
| `functions/lumina/api/`       | bound to Worker                            | `score.ts`, `top.ts`, `_shared.ts` — D1-backed leaderboard handlers        |
| `lumina-schema.sql`           | (run via wrangler)                         | D1 schema for `scores`, `scores_daily`, `submit_log`                       |
| `wrangler.jsonc`              | Wrangler config                            | Worker name, D1 binding (`LUMINA_DB`), static asset binding (`ASSETS`)     |
| `.assetsignore`               | tells Wrangler what NOT to ship as assets  | Excludes `src/`, `functions/`, `wrangler.*`, docs, dotfiles                |
| `DEPLOY.md`                   | docs only                                  | Original Cloudflare Pages walkthrough — kept for reference                 |

The Swift apps and App Store listings reference these exact paths. **Don't rename them** without updating the apps.

---

## Featured projects on the site

| Project                       | Status         | Where                                    |
| ----------------------------- | -------------- | ---------------------------------------- |
| **GreenCli**                  | v1.0 shipped   | `/greencli/` — macOS + Windows desktop terminal for Aruba/HPE networks |
| **LUMINA: Neon Orbit**        | Live           | `/lumina/` — web game + iOS App Store    |
| **MAC Vendor Lookup**         | Live           | `/mac-vendor-lookup/` — iOS app          |
| **VoltaNode**                 | Running        | `/voltanode/` — multi-strategy paper-trading bot platform |
| **RackBeacon**                | In development | `/rackbeacon/` — iOS app                 |
| **VintageCarParts**           | In development | `/vintagecarparts/` — iOS app            |
| **ChoateLab**                 | In development | `/choatelab/` — self-hosted home-lab dashboard, source on GitHub |
| **Threadback**, **Clearing**  | Ideas          | mentioned on the homepage, no pages yet  |

Projects appear twice on `index.html`: as a numbered entry in the project index, and as a node in the interactive graph. Both are plain markup/data in that one file — see [docs/PROJECTS.md](docs/PROJECTS.md) for the add-a-project checklist.

---

## Quick start

### Local preview (static only)

```bash
python3 -m http.server 8000
# open http://localhost:8000/
```

This serves the HTML pages but won't run the LUMINA leaderboard API (that needs Wrangler + D1).

### Local preview (with Worker + D1)

```bash
npm install -g wrangler
wrangler login

# create a local D1 instance and apply the schema
wrangler d1 create lumina-leaderboard            # only first time; copy the database_id into wrangler.jsonc
wrangler d1 execute lumina-leaderboard --file=lumina-schema.sql --local

wrangler dev
# open http://localhost:8787/
```

`wrangler dev` runs `src/worker.ts` and serves static assets from the project root according to `.assetsignore`.

### Deploy

```bash
# first deploy: apply the schema to the remote D1
wrangler d1 execute lumina-leaderboard --file=lumina-schema.sql --remote

wrangler deploy
```

Cloudflare Workers handles TLS automatically for `choatelabs.app`. DNS at Porkbun → ALIAS / CNAME to the Worker. See [DEPLOY.md](DEPLOY.md) for the original Pages walkthrough (largely still applicable, swap "Pages" for "Workers" once you've migrated DNS).

---

## Architecture (the short version)

```
                ┌────────────────────────────────────────┐
  Browser ───▶  │  Cloudflare Worker (src/worker.ts)     │
                │                                        │
                │   /lumina/api/score  POST  ─┐          │
                │   /lumina/api/top    GET   ─┼─▶ D1     │
                │   /lumina/api/*      OPTIONS┘ (CORS)   │
                │                                        │
                │   everything else  ─▶  env.ASSETS      │
                │                       (static HTML/JS) │
                └────────────────────────────────────────┘
```

- One Worker, one custom domain. No build step for the static pages — they're shipped as-is.
- Same-origin for `choatelabs.app`; the leaderboard CORS allowlist additionally accepts `capacitor://localhost` and `ionic://localhost` so the iOS Capacitor WebView build of LUMINA can submit scores.
- D1 database `lumina-leaderboard` holds three tables: `scores` (all-time), `scores_daily` (per-day challenge), `submit_log` (rate-limit / anti-cheat sanity).

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for a deeper walk-through and [docs/PROJECTS.md](docs/PROJECTS.md) for what each subdirectory contains.

---

## Project layout

```
choatelabs-site/
├── index.html, about.html, 404.html      # site shell
├── assets/                                # shared site.css, lab-graph.js, vendored Three.js
├── lumina/                                # LUMINA web game (PWA)
├── mac-vendor-lookup/                     # iOS app landing + privacy/support
├── rackbeacon/                            # iOS app landing + privacy/support
├── voltanode/                             # VoltaNode landing
├── src/
│   └── worker.ts                          # Cloudflare Worker entry
├── functions/
│   └── lumina/api/                        # leaderboard handlers (score, top, shared)
├── lumina-schema.sql                      # D1 schema
├── wrangler.jsonc                         # Workers config (incl. D1 + ASSETS bindings)
├── .assetsignore                          # what NOT to ship as static assets
├── DEPLOY.md                              # original Cloudflare Pages walkthrough
└── docs/                                  # see below
```

---

## Documentation

- [README.md](README.md) — this file
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — Worker + D1 architecture, request flow, CORS
- [docs/PROJECTS.md](docs/PROJECTS.md) — what lives under each subdirectory
- [DEPLOY.md](DEPLOY.md) — original deploy walkthrough (Cloudflare Pages → custom domain → email forwarding)
- [CONTRIBUTING.md](CONTRIBUTING.md) — workflow for changes

---

## License

MIT — see [LICENSE](LICENSE).
