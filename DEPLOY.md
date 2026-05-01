# Deploy `choatelabs.app` to Cloudflare Pages

Static site, registered on Porkbun, hosted free on Cloudflare Pages. ~15 minutes start to finish.

---

## What you have

```
website/
├── index.html                       → choatelabs.app/
├── about.html                       → choatelabs.app/about.html
├── 404.html                         → served on any unknown path
├── .assetsignore                    → tells Wrangler which files NOT to ship
├── DEPLOY.md                        → (this file, don't deploy)
└── mac-vendor-lookup/
    ├── index.html                   → choatelabs.app/mac-vendor-lookup/
    ├── privacy.html                 → choatelabs.app/mac-vendor-lookup/privacy.html
    └── support.html                 → choatelabs.app/mac-vendor-lookup/support.html

Note: cross-domain redirects (.com → .app, www → apex) are handled at the
DNS layer via Porkbun's URL Forwarding, not via _redirects. See Step 3.
```

The Swift app and App Store listing reference these exact paths. Don't rename them.

---

## Step 1 — Cloudflare account + Pages project

1. Sign in or create a free account at <https://dash.cloudflare.com>.
2. Left sidebar → **Workers & Pages** → **Create** → **Pages** tab → **Upload assets**.
3. Project name: `choatelabs` (becomes `choatelabs.pages.dev` until you add the custom domain).
4. Upload: drag the contents of `website/` into the upload zone. Skip `DEPLOY.md`.
5. Click **Deploy site**.

Verify the site at `https://choatelabs.pages.dev` within ~30 seconds:

- <https://choatelabs.pages.dev/>
- <https://choatelabs.pages.dev/about.html>
- <https://choatelabs.pages.dev/mac-vendor-lookup/>
- <https://choatelabs.pages.dev/mac-vendor-lookup/privacy.html>
- <https://choatelabs.pages.dev/mac-vendor-lookup/support.html>

---

## Step 2 — Connect `choatelabs.app` (custom domain)

In your new Pages project:

1. **Custom domains** tab → **Set up a custom domain**.
2. Enter `choatelabs.app` → **Continue**.
3. Cloudflare tells you to add a CNAME from `choatelabs.app` (root) to `choatelabs.pages.dev`. Apex CNAMEs are flattened automatically; Porkbun calls this an `ALIAS` record.
4. Repeat for `www.choatelabs.app` if you want both.
5. Repeat for `choatelabs.com` and `www.choatelabs.com` so they resolve before the redirects fire.

---

## Step 3 — DNS records at Porkbun

Sign in at <https://porkbun.com> → **Account → Domain Management**.

### For `choatelabs.app`:
- **Type:** `ALIAS` (or `CNAME` if ALIAS isn't offered for the apex)
- **Host:** leave blank
- **Answer:** `choatelabs.pages.dev`
- **TTL:** 600

Optional `www`:
- **Type:** `CNAME`
- **Host:** `www`
- **Answer:** `choatelabs.pages.dev`

### For `choatelabs.com` (so `.com` redirects to `.app`):

Either add the same DNS records and let the `_redirects` file handle the redirect, **or** use Porkbun's built-in URL forwarding:

- Domain Management → click `choatelabs.com` → **URL Forwarding** → forward `https://choatelabs.com/*` to `https://choatelabs.app/$1` (301 permanent).

URL forwarding is simpler. Use that for `.com`.

DNS propagates in 1–10 minutes on Porkbun.

---

## Step 4 — Wait for the green check

Cloudflare → Pages → your project → **Custom domains**. Status moves *Pending → Verifying → Active*. Cloudflare auto-provisions the SSL cert once Active. No manual cert work.

Verify:

```
curl -I https://choatelabs.app/
curl -I https://choatelabs.app/about.html
curl -I https://choatelabs.app/mac-vendor-lookup/privacy.html
curl -I https://choatelabs.app/mac-vendor-lookup/support.html
```

All should return `HTTP/2 200`.

---

## Step 5 — Email forwarding (Porkbun → Gmail)

The site references `stephen.choate@choatelabs.com`. Set this up before going public so the contact link works.

1. Porkbun Domain Management → click `choatelabs.com` → **Email Forwarding**.
2. Create a forward:
   - **From:** `stephen.choate`  (the part before `@choatelabs.com`)
   - **To:** `choate85@gmail.com`
3. Save. Porkbun's email forwarding is free for any domain registered with them.
4. Optional catchall:
   - **From:** leave blank → forwards everything `*@choatelabs.com` to your gmail.

Test from any account:
```
echo "test" | mail -s "test" stephen.choate@choatelabs.com
```
Or just send yourself an email to `stephen.choate@choatelabs.com` and confirm it lands in gmail. Forwarding usually activates within a few minutes.

> **Note:** This is forwarding only. To **send** mail *from* `stephen.choate@choatelabs.com` (so replies don't show your gmail), you need Gmail's "Send Mail As" feature configured with Porkbun's outbound SMTP credentials, or a paid email service (Fastmail, ProtonMail, Google Workspace). For now, replies from your gmail are fine — most people don't notice.

---

## Step 6 — Use these URLs in App Store Connect

| Field in App Store Connect           | URL                                                                |
|---------------------------------------|--------------------------------------------------------------------|
| Privacy Policy URL                    | `https://choatelabs.app/mac-vendor-lookup/privacy.html`            |
| Support URL                           | `https://choatelabs.app/mac-vendor-lookup/support.html`            |
| Marketing URL (optional)              | `https://choatelabs.app/mac-vendor-lookup/`                        |

The `SettingsView.swift` in the app already links to these paths. Both must respond with HTTP 200 before Apple review or your submission gets rejected.

---

## Updating the site later

**Drag-and-drop:** Pages project → **Create new deployment** → re-upload. Atomic, instant rollback.

**Git-connected (recommended after first deploy):**
1. Push `website/` to a GitHub repo (`choatelabs-site`).
2. Pages project → **Settings → Source** → **Connect to Git**.
3. Build command: blank. Output directory: `/`.
4. Every push to `main` auto-deploys.

---

## Troubleshooting

**`HTTP 308` or `HTTP 301` on the apex**
Cloudflare Pages may force HTTPS redirects. That's fine — the privacy/support URLs themselves should still 200.

**Apple rejects with "Privacy URL not accessible"**
```
curl -L -I https://choatelabs.app/mac-vendor-lookup/privacy.html
```
If not 200, DNS or Pages isn't fully live. Wait 15 min and retry.

**`.app` requires HTTPS — does the cert work?**
Yes. The `.app` TLD is on the HSTS preload list. Cloudflare provisions the cert automatically.

**The Konami code goat?**
↑ ↑ ↓ ↓ ← → ← → B A on the homepage. You're welcome.

**Local preview before deploying?**
```
cd website
python3 -m http.server 8000
```
Visit `http://localhost:8000/`.

---

When all four URLs above return 200 OK over HTTPS and `stephen.choate@choatelabs.com` forwards to your gmail, the website is App-Store-ready.
