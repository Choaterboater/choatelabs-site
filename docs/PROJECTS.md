# Projects

Each subdirectory under the repo root maps to a path on `choatelabs.app`. The Swift apps and App Store listings reference these exact paths — don't rename them.

## LUMINA: Neon Orbit (`/lumina/`)

A one-touch arcade survival game. Hold to reverse direction, sweep up energy, time your flips for triple-point Perfects. 6 skins, 4 trails, 5 upgrades, escalating waves.

- **Web build** — PWA served at `/lumina/`, installable from the browser via `install.html` and `manifest.json`.
- **iOS build** — wrapped with Capacitor, ships through the App Store; the WebView calls the leaderboard API at `/lumina/api/*` over `capacitor://localhost`, which is why the Worker's CORS allowlist accepts that origin.
- **Leaderboard** — global all-time + daily challenge, backed by D1 (`scores`, `scores_daily`). Schema in [`../lumina-schema.sql`](../lumina-schema.sql). Handlers in [`../functions/lumina/api/`](../functions/lumina/api).
- **Assets** — icons (`icon-1024.png`, `icon-192.png`, …), screenshots (`screenshot-1.png` … `screenshot-5.png`), and a `music.mp3` track live alongside the HTML.

## MAC Vendor Lookup (`/mac-vendor-lookup/`)

Native iOS app: identify the manufacturer behind any MAC address. Camera scan, bulk paste, full IEEE OUI database — 100% offline.

The site directory holds:

- `index.html` — public landing page.
- `privacy.html` — privacy policy.
- `support.html` — support page.

App Store Connect references these URLs verbatim. They **must** return HTTP 200 over HTTPS before review.

## GreenCli (`/greencli/`)

Desktop terminal for Aruba/HPE networks: SSH/Telnet/serial, multi-vendor syntax highlighting, encrypted credential vault, AI assistant. v1.0.0 shipped for macOS (arm64 + Intel, signed and notarized) and Windows x64 (MSI). The directory holds the landing page, `privacy.html`, `support.html`, and the installer binaries.

## RackBeacon (`/rackbeacon/`)

Native iOS app for documenting any rack, closet, or comms room. Scan device labels, place gear in the rack, capture rooms with LiDAR — all on-device. Status: in development.

Same three-page layout: `index.html`, `privacy.html`, `support.html`.

## VintageCarParts (`/vintagecarparts/`)

Native iOS app: point the camera at a vintage car part to identify it, see fitment, and check real eBay sold prices. Casting-number OCR, 216-part reference catalog, VIN-aware fitment. Status: in development.

Same three-page layout: `index.html`, `privacy.html`, `support.html`.

## VoltaNode (`/voltanode/`)

Multi-strategy paper-trading bot platform. EMA / MACD / mean-reversion / news-sentiment bots ride 24/7 crypto + market-hours stocks through Alpaca, with an LLM advisor stitching fundamentals, technicals, macro, and recent catalysts into a single thesis. Landing page only.

## ChoateLab (`/choatelab/`)

Self-hosted dashboard for the home lab — a single drag-and-drop home page for Docker, the *arr stack, Pi-hole, Home Assistant, Aruba, and 15+ other services. Source at [github.com/Choaterboater/ChoateLab](https://github.com/Choaterboater/ChoateLab). Status: in development. The landing page at `/choatelab/index.html` mirrors the format of the other project pages and links out to the GitHub repo for code and docs.

## Threadback, Clearing

Ideas mentioned in the "in the notebook" aside on `index.html` and shown as faint nodes in the homepage graph — no subdirectory yet.

---

## Adding a new project

1. Make `<project>/index.html` (and `privacy.html` / `support.html` if it's an iOS app).
2. In `index.html` at the repo root:
   - Copy one of the `<article class="project">` blocks in the project index, renumber it, and write the entry (name, mono status line, one short paragraph, link to `/<project>/`).
   - Add a node to the graph data in the `<script type="module">` block at the bottom of the file: `{ id: '<project>', label: '<project>', href: '/<project>/', group: '<network|asset|market|play|idea>' }`. Nodes without `href` render as faint "idea" nodes. Edges are computed automatically (hub spokes + same-group links).
   - Add the project to the footer link row.
3. If the project needs server-side endpoints:
   - Put handlers in `functions/<project>/api/*.ts`.
   - Add a router branch in `src/worker.ts` for `/<project>/api/*`.
   - If it uses D1, add a binding in `wrangler.jsonc` and a schema file at the repo root.
4. If new files shouldn't be served as static assets (e.g., a new `functions/` subtree or a schema file), add them to `.assetsignore`.
5. `wrangler deploy`.
